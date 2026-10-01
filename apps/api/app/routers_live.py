"""Live events (SSE + poll) and referral message threads."""

from __future__ import annotations

import asyncio
import json
import logging
import time
import uuid
from datetime import datetime, timedelta
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.auth import get_current_user, write_audit
from app.db import Referral, ReferralMessage, User, get_db
from app.services.live_events import (
    append_event,
    event_to_wire,
    scoped_events_query,
    user_can_access_referral,
)
from app.services.sse_tickets import consume_ticket, issue_ticket
from app.schemas import ReferralMessageCreate, ReferralMessageOut

router = APIRouter(tags=["live"])
bearer_optional = HTTPBearer(auto_error=False)
log = logging.getLogger("zeromalaria.live")

HEARTBEAT_SECONDS = 15
POLL_INTERVAL_SECONDS = 2


def _parse_since(since: str | None) -> datetime:
    if not since:
        return datetime.utcnow()
    raw = since.strip().replace("Z", "")
    try:
        return datetime.fromisoformat(raw)
    except ValueError as exc:
        raise HTTPException(400, "Invalid since timestamp (use ISO-8601)") from exc


def _user_from_bearer_or_ticket(
    creds: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer_optional)],
    ticket: Annotated[str | None, Query()] = None,
    access_token: Annotated[str | None, Query()] = None,
    db: Session = Depends(get_db),
) -> User:
    """SSE auth: opaque single-use ticket (preferred) or Authorization bearer.

    Query access_token is rejected (never put JWTs in URLs).
    """
    if access_token:
        raise HTTPException(
            401,
            detail="access_token_query_removed",
        )
    if ticket:
        user_id = consume_ticket(ticket)
        if not user_id:
            raise HTTPException(401, detail="invalid_or_expired_ticket")
        user = db.query(User).filter(User.id == user_id).first()
        if not user or not user.active:
            raise HTTPException(401, "User inactive or missing")
        return user
    if creds and creds.credentials:
        from app.auth import decode_token

        data = decode_token(creds.credentials)
        user = db.query(User).filter(User.id == data.get("sub")).first()
        if not user or not user.active:
            raise HTTPException(401, "User inactive or missing")
        return user
    raise HTTPException(401, "Not authenticated")


def _message_out(row: ReferralMessage) -> ReferralMessageOut:
    return ReferralMessageOut(
        id=row.id,
        referral_id=row.referral_id,
        sender_id=row.sender_id,
        sender_role=row.sender_role,
        body=row.body,
        created_at=row.created_at,
        read_at=row.read_at,
    )


@router.post("/events/ticket")
def create_event_ticket(
    user: Annotated[User, Depends(get_current_user)],
) -> dict[str, Any]:
    """Issue a short-lived single-use ticket for GET /events (EventSource)."""
    tid, expires_in = issue_ticket(user.id)
    return {"ticket": tid, "expires_in": expires_in}


@router.get("/events/poll")
def poll_events(
    user: Annotated[User, Depends(get_current_user)],
    db: Session = Depends(get_db),
    since: str | None = Query(None, description="ISO timestamp; events strictly after this"),
) -> dict[str, Any]:
    since_dt = _parse_since(since) if since else datetime.utcnow() - timedelta(seconds=10)
    rows = scoped_events_query(db, user, since_dt).limit(200).all()
    return {
        "events": [event_to_wire(r) for r in rows],
        "server_at": datetime.utcnow().isoformat() + "Z",
    }


@router.get("/events")
async def sse_events(
    request: Request,
    user: Annotated[User, Depends(_user_from_bearer_or_ticket)],
    db: Session = Depends(get_db),
    since: str | None = Query(None),
) -> StreamingResponse:
    since_dt = _parse_since(since) if since else datetime.utcnow()
    user_id = user.id

    async def generate():
        cursor = since_dt
        last_hb = time.monotonic()
        try:
            while True:
                if await request.is_disconnected():
                    break
                try:
                    db.expire_all()
                    # Re-load user scope each tick (session still bound)
                    u = db.query(User).filter(User.id == user_id).first()
                    if not u or not u.active:
                        break
                    rows = scoped_events_query(db, u, cursor).limit(50).all()
                    for row in rows:
                        wire = event_to_wire(row)
                        yield f"data: {json.dumps(wire)}\n\n"
                        if row.created_at and row.created_at > cursor:
                            cursor = row.created_at
                except Exception:
                    # Never dump stack traces for expected DB blips during reload
                    log.debug("sse poll tick failed", exc_info=False)

                now = time.monotonic()
                if now - last_hb >= HEARTBEAT_SECONDS:
                    # SSE comment heartbeat (not a data event) — keeps proxies alive
                    yield f": heartbeat {datetime.utcnow().isoformat()}Z\n\n"
                    last_hb = now
                await asyncio.sleep(POLL_INTERVAL_SECONDS)
        except asyncio.CancelledError:
            return
        except (GeneratorExit, BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            return
        except Exception:
            log.debug("sse stream ended", exc_info=False)
            return

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/referrals/{referral_id}/messages", response_model=list[ReferralMessageOut])
def list_messages(
    referral_id: str,
    user: Annotated[User, Depends(get_current_user)],
    db: Session = Depends(get_db),
) -> list[ReferralMessageOut]:
    referral = db.query(Referral).filter(Referral.id == referral_id).first()
    if not referral:
        raise HTTPException(404, "Referral not found")
    if not user_can_access_referral(user, referral):
        raise HTTPException(403, "Outside your scope")
    rows = (
        db.query(ReferralMessage)
        .filter(ReferralMessage.referral_id == referral_id)
        .order_by(ReferralMessage.created_at.asc())
        .all()
    )
    return [_message_out(r) for r in rows]


@router.post("/referrals/{referral_id}/messages", response_model=ReferralMessageOut)
def create_message(
    referral_id: str,
    body: ReferralMessageCreate,
    user: Annotated[User, Depends(get_current_user)],
    db: Session = Depends(get_db),
) -> ReferralMessageOut:
    referral = db.query(Referral).filter(Referral.id == referral_id).first()
    if not referral:
        raise HTTPException(404, "Referral not found")
    if not user_can_access_referral(user, referral):
        raise HTTPException(403, "Outside your scope")
    text = (body.body or "").strip()
    if not text:
        raise HTTPException(400, "Message body required")
    if len(text) > 2000:
        raise HTTPException(400, "Message too long")
    row = ReferralMessage(
        id=str(uuid.uuid4()),
        referral_id=referral_id,
        sender_id=user.id,
        sender_role=user.role,
        body=text,
        created_at=datetime.utcnow(),
    )
    db.add(row)
    append_event(
        db,
        event_type="referral.message",
        payload={
            "referral_id": referral_id,
            "message_id": row.id,
            "sender_role": user.role,
            "preview": text[:120],
        },
        chw_id=referral.chw_id,
        facility_id=referral.facility_id,
    )
    write_audit(
        db,
        action="referral_message",
        actor_id=user.id,
        actor_username=user.username,
        resource_type="referral",
        resource_id=referral_id,
        detail=text[:200],
    )
    db.commit()
    db.refresh(row)
    return _message_out(row)

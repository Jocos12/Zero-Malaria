"""Live events poll scoping, SSE tickets, and referral messages."""

from __future__ import annotations

import logging
import sys
import time
import uuid
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

API_ROOT = Path(__file__).resolve().parents[1]
if str(API_ROOT) not in sys.path:
    sys.path.insert(0, str(API_ROOT))

from app.auth import hash_password
from app.config import settings
from app.db import Base, Facility, User, configure_engine, init_db
from app.logging_filters import MaskSecretsFilter
from app.main import app
from app.services.sse_tickets import issue_ticket, reset_tickets_for_tests


@pytest.fixture()
def client(tmp_path):
    reset_tickets_for_tests()
    db_file = tmp_path / "live.db"
    configure_engine(f"sqlite:///{db_file}")
    from app import db as db_module

    Base.metadata.drop_all(bind=db_module.engine)
    init_db()
    db = db_module.SessionLocal()
    db.add(
        Facility(
            facility_id="HC-BUG-01",
            name="Nyamata HC",
            district="Bugesera",
            sector="Nyamata",
            pilot=1,
            remote=0,
            latitude=-2.18,
            longitude=30.14,
        )
    )
    pw = hash_password(settings.demo_password)
    db.add_all(
        [
            User(
                id="u-chw",
                username="chw.demo",
                password_hash=pw,
                display_name="CHW",
                role="CHW",
                facility_id="HC-BUG-01",
                district="Bugesera",
                chw_code="CHW-BUG-01-01",
                active=True,
            ),
            User(
                id="u-hc",
                username="health.center",
                password_hash=pw,
                display_name="Health Center",
                role="HEALTH_CENTER",
                facility_id="HC-BUG-01",
                district="Bugesera",
                active=True,
            ),
            User(
                id="u-rbc",
                username="rbc.admin",
                password_hash=pw,
                display_name="RBC",
                role="RBC_ADMIN",
                active=True,
            ),
        ]
    )
    db.commit()
    db.close()
    with TestClient(app) as c:
        yield c


def _login(client: TestClient, username: str) -> str:
    r = client.post("/auth/login", json={"username": username, "password": settings.demo_password})
    assert r.status_code == 200
    return r.json()["access_token"]


def _create_referral(client: TestClient) -> str:
    cid = str(uuid.uuid4())
    r = client.post(
        "/referrals",
        json={
            "client_uuid": cid,
            "facility_id": "HC-BUG-01",
            "chw_id": "CHW-BUG-01-01",
            "district": "Bugesera",
            "age_months": 24,
            "decision": "urgent_refer",
            "reasons": ["Demo"],
            "summary": "Live comm test",
        },
    )
    assert r.status_code == 200
    return r.json()["id"]


def test_message_create_and_list(client):
    rid = _create_referral(client)
    token = _login(client, "health.center")
    headers = {"Authorization": f"Bearer {token}"}
    post = client.post(
        f"/referrals/{rid}/messages",
        json={"body": "Prepare transport for this patient."},
        headers=headers,
    )
    assert post.status_code == 200
    assert post.json()["sender_role"] == "HEALTH_CENTER"
    listed = client.get(f"/referrals/{rid}/messages", headers=headers)
    assert listed.status_code == 200
    assert len(listed.json()) == 1


def test_poll_events_role_scoped(client):
    rid = _create_referral(client)
    chw_token = _login(client, "chw.demo")
    hc_token = _login(client, "health.center")
    chw_headers = {"Authorization": f"Bearer {chw_token}"}
    hc_headers = {"Authorization": f"Bearer {hc_token}"}

    client.post(
        f"/referrals/{rid}/messages",
        json={"body": "Need more clinical info."},
        headers=hc_headers,
    )

    chw_poll = client.get("/events/poll", headers=chw_headers)
    assert chw_poll.status_code == 200
    chw_types = {e["type"] for e in chw_poll.json()["events"]}
    assert "referral.created" in chw_types
    assert "referral.message" in chw_types

    rbc_token = _login(client, "rbc.admin")
    rbc_poll = client.get("/events/poll", headers={"Authorization": f"Bearer {rbc_token}"})
    assert rbc_poll.status_code == 200
    assert any(e["type"] == "referral.created" for e in rbc_poll.json()["events"])


def test_sse_ticket_single_use_and_rejects_jwt_query(client):
    from app.services.sse_tickets import consume_ticket

    token = _login(client, "chw.demo")
    headers = {"Authorization": f"Bearer {token}"}
    issued = client.post("/events/ticket", headers=headers)
    assert issued.status_code == 200
    body = issued.json()
    assert body["expires_in"] == 30
    ticket = body["ticket"]
    assert ticket and "eyJ" not in ticket  # opaque, not a JWT

    # Single-use: first consume ok, second fails (same as SSE auth dependency)
    assert consume_ticket(ticket) == "u-chw"
    assert consume_ticket(ticket) is None
    again = client.get(f"/events?ticket={ticket}")
    assert again.status_code == 401
    assert again.json()["detail"] == "invalid_or_expired_ticket"

    # JWT in query is rejected
    bad = client.get(f"/events?access_token={token}")
    assert bad.status_code == 401
    assert bad.json()["detail"] == "access_token_query_removed"


def test_sse_ticket_expires(client):
    token = _login(client, "chw.demo")
    headers = {"Authorization": f"Bearer {token}"}
    from app.auth import decode_token
    from app.services.sse_tickets import consume_ticket

    uid = decode_token(token)["sub"]
    tid, _ = issue_ticket(uid, ttl_seconds=1)
    time.sleep(1.2)
    assert consume_ticket(tid) is None
    r = client.get(f"/events?ticket={tid}")
    assert r.status_code == 401
    assert r.json()["detail"] == "invalid_or_expired_ticket"

    ok = client.post("/events/ticket", headers=headers)
    assert ok.status_code == 200


def test_sse_stream_headers_finite(client, monkeypatch):
    """Valid ticket opens SSE; sleep raises CancelledError so the stream ends cleanly."""
    import asyncio

    import app.routers_live as live

    token = _login(client, "chw.demo")
    ticket = client.post("/events/ticket", headers={"Authorization": f"Bearer {token}"}).json()["ticket"]

    async def boom(_delay):
        raise asyncio.CancelledError()

    monkeypatch.setattr(live.asyncio, "sleep", boom)
    with client.stream("GET", f"/events?ticket={ticket}&since=2020-01-01T00:00:00") as stream:
        assert stream.status_code == 200
        assert stream.headers.get("x-accel-buffering") == "no"
        assert "text/event-stream" in stream.headers.get("content-type", "")
        _ = b"".join(stream.iter_bytes())


def test_sse_ticket_role_scope_still_applies(client):
    """Ticket only authenticates; event rows remain role-scoped like poll."""
    _create_referral(client)
    chw_token = _login(client, "chw.demo")
    hc_token = _login(client, "health.center")

    # Ticket issuance requires auth; scoped poll proves RBAC still applies
    chw_t = client.post("/events/ticket", headers={"Authorization": f"Bearer {chw_token}"})
    hc_t = client.post("/events/ticket", headers={"Authorization": f"Bearer {hc_token}"})
    assert chw_t.status_code == 200 and hc_t.status_code == 200

    hc_poll = client.get("/events/poll", headers={"Authorization": f"Bearer {hc_token}"})
    chw_poll = client.get("/events/poll", headers={"Authorization": f"Bearer {chw_token}"})
    assert hc_poll.status_code == 200 and chw_poll.status_code == 200
    assert any(e["type"] == "referral.created" for e in chw_poll.json()["events"])
    assert any(e["type"] == "referral.created" for e in hc_poll.json()["events"])


def test_access_log_mask_filter_hides_ticket_and_token():
    filt = MaskSecretsFilter()
    record = logging.LogRecord(
        name="uvicorn.access",
        level=logging.INFO,
        pathname=__file__,
        lineno=1,
        msg='127.0.0.1:1 - "GET /events?ticket=SECRETVALUE&access_token=JWT.HERE HTTP/1.1" 200',
        args=(),
        exc_info=None,
    )
    assert filt.filter(record) is True
    out = record.getMessage()
    assert "SECRETVALUE" not in out
    assert "JWT.HERE" not in out
    assert "ticket=***" in out
    assert "access_token=***" in out

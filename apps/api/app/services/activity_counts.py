"""Auto aggregation and upsert for CHW daily activity counts."""

from __future__ import annotations

import uuid
from datetime import date, datetime, time, timedelta
from typing import Any

from sqlalchemy.orm import Session

from app.db import ActivityCount, CaseRecord, Referral

MAX_METRIC = 500
SOURCE_AUTO = "auto"
SOURCE_MANUAL = "manual"


def auto_client_uuid(chw_id: str, facility_id: str, day: str) -> str:
    return f"auto-{chw_id}-{facility_id}-{day}"


def parse_activity_date(value: str) -> date:
    return date.fromisoformat(value)


def validate_activity_date(day: date, *, today: date | None = None) -> None:
    today = today or datetime.utcnow().date()
    if day > today:
        raise ValueError("future_date")


def validate_metrics(payload: dict[str, int]) -> None:
    for key, val in payload.items():
        if val < 0 or val > MAX_METRIC:
            raise ValueError(f"invalid_metric:{key}")


def _day_window(day: date) -> tuple[datetime, datetime]:
    start = datetime.combine(day, time.min)
    end = datetime.combine(day, time.max)
    return start, end


def compute_auto_metrics(db: Session, *, chw_id: str, facility_id: str, day: date) -> dict[str, int]:
    """Aggregate referrals and triage cases for one CHW + facility + calendar day (UTC)."""
    day_str = day.isoformat()
    start, end = _day_window(day)

    referrals = (
        db.query(Referral)
        .filter(
            Referral.chw_id == chw_id,
            Referral.facility_id == facility_id,
            Referral.created_at >= start,
            Referral.created_at <= end,
        )
        .all()
    )

    cases = db.query(CaseRecord).filter(CaseRecord.chw_id == chw_id, CaseRecord.date == day_str).all()

    seen_keys: set[str] = set()
    for c in cases:
        seen_keys.add(c.case_id)
    for r in referrals:
        seen_keys.add(r.case_id or f"ref:{r.id}")

    patients_treated = sum(1 for r in referrals if r.status in ("treated", "arrived"))
    patients_treated += sum(1 for c in cases if c.decision == "treat_at_home")

    rdt_done = sum(1 for c in cases if c.tdr_result in ("positive", "negative", "invalid"))
    rdt_positive = sum(1 for c in cases if c.tdr_result == "positive")

    referred = len(referrals)

    metrics = {
        "patients_seen": min(len(seen_keys), MAX_METRIC),
        "patients_treated": min(patients_treated, MAX_METRIC),
        "rdt_done": min(rdt_done, MAX_METRIC),
        "rdt_positive": min(rdt_positive, MAX_METRIC),
        "referred": min(referred, MAX_METRIC),
    }
    validate_metrics(metrics)
    return metrics


def upsert_auto_activity(
    db: Session,
    *,
    chw_id: str,
    facility_id: str,
    day: date,
    commit: bool = True,
) -> ActivityCount:
    day_str = day.isoformat()
    cu = auto_client_uuid(chw_id, facility_id, day_str)
    metrics = compute_auto_metrics(db, chw_id=chw_id, facility_id=facility_id, day=day)
    now = datetime.utcnow()
    row = db.query(ActivityCount).filter(ActivityCount.client_uuid == cu).first()
    if row is None:
        row = ActivityCount(
            id=str(uuid.uuid4()),
            client_uuid=cu,
            chw_id=chw_id,
            facility_id=facility_id,
            date=day_str,
            source=SOURCE_AUTO,
            created_by=None,
            created_at=now,
            updated_at=now,
            version=1,
            **metrics,
        )
        db.add(row)
    else:
        row.patients_seen = metrics["patients_seen"]
        row.patients_treated = metrics["patients_treated"]
        row.rdt_done = metrics["rdt_done"]
        row.rdt_positive = metrics["rdt_positive"]
        row.referred = metrics["referred"]
        row.updated_at = now
        row.version = (row.version or 1) + 1
    if commit:
        db.commit()
        db.refresh(row)
    return row


def refresh_auto_for_scope(
    db: Session,
    *,
    chw_id: str | None = None,
    facility_id: str | None = None,
    date_from: date,
    date_to: date,
) -> None:
    """Upsert auto rows for each distinct chw+facility+day in range from referrals."""
    start, _ = _day_window(date_from)
    _, end = _day_window(date_to)
    q = db.query(Referral.chw_id, Referral.facility_id, Referral.created_at).filter(
        Referral.created_at >= start,
        Referral.created_at <= end,
    )
    if chw_id:
        q = q.filter(Referral.chw_id == chw_id)
    if facility_id:
        q = q.filter(Referral.facility_id == facility_id)

    keys: set[tuple[str, str, str]] = set()
    for cid, fid, created_at in q.all():
        if not cid or not fid or not created_at:
            continue
        d = created_at.date().isoformat()
        keys.add((cid, fid, d))

    if chw_id and facility_id:
        d = date_from
        while d <= date_to:
            keys.add((chw_id, facility_id, d.isoformat()))
            d += timedelta(days=1)

    for cid, fid, d_str in sorted(keys):
        upsert_auto_activity(db, chw_id=cid, facility_id=fid, day=date.fromisoformat(d_str), commit=False)
    db.commit()


def sum_metrics(rows: list[ActivityCount]) -> dict[str, int]:
    totals = {
        "patients_seen": 0,
        "patients_treated": 0,
        "rdt_done": 0,
        "rdt_positive": 0,
        "referred": 0,
    }
    for row in rows:
        totals["patients_seen"] += row.patients_seen
        totals["patients_treated"] += row.patients_treated
        totals["rdt_done"] += row.rdt_done
        totals["rdt_positive"] += row.rdt_positive
        totals["referred"] += row.referred
    return totals


def upsert_manual_row(
    db: Session,
    *,
    user_id: str,
    chw_id: str,
    facility_id: str,
    body_metrics: dict[str, int],
    client_uuid: str,
    day_str: str,
    note: str | None,
    expected_version: int | None,
) -> tuple[ActivityCount, str]:
    """Create or update a manual row. Returns (row, audit_action)."""
    now = datetime.utcnow()
    day = parse_activity_date(day_str)
    validate_activity_date(day)
    validate_metrics(body_metrics)

    existing = db.query(ActivityCount).filter(ActivityCount.client_uuid == client_uuid).first()
    if existing:
        if existing.source != SOURCE_MANUAL:
            raise ValueError("client_uuid_conflict_auto")
        if existing.chw_id != chw_id:
            raise ValueError("chw_scope")
        if expected_version is not None and expected_version != existing.version:
            raise ValueError("version_conflict")
        for k, v in body_metrics.items():
            setattr(existing, k, v)
        existing.note = note
        existing.date = day_str
        existing.updated_at = now
        existing.version = (existing.version or 1) + 1
        return existing, "activity_count_update"

    row = ActivityCount(
        id=str(uuid.uuid4()),
        client_uuid=client_uuid,
        chw_id=chw_id,
        facility_id=facility_id,
        date=day_str,
        source=SOURCE_MANUAL,
        note=note,
        version=1,
        created_by=user_id,
        created_at=now,
        updated_at=now,
        **body_metrics,
    )
    db.add(row)
    return row, "activity_count_create"


def activity_count_dict(row: ActivityCount) -> dict[str, Any]:
    return {
        "id": row.id,
        "client_uuid": row.client_uuid,
        "chw_id": row.chw_id,
        "facility_id": row.facility_id,
        "date": row.date,
        "patients_seen": row.patients_seen,
        "patients_treated": row.patients_treated,
        "rdt_done": row.rdt_done,
        "rdt_positive": row.rdt_positive,
        "referred": row.referred,
        "source": row.source,
        "note": row.note,
        "version": row.version,
        "created_by": row.created_by,
        "created_at": row.created_at,
        "updated_at": row.updated_at,
        "confirmed_by": row.confirmed_by,
        "confirmed_at": row.confirmed_at,
    }

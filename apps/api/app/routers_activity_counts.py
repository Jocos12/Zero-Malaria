"""Daily CHW activity counts — manual entry, auto aggregation, confirm, export."""

from __future__ import annotations

import csv
import io
from datetime import date, datetime, timedelta
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from sqlalchemy.orm import Session

from app.auth import (
    assert_facility_scope,
    get_current_user,
    require_permission,
    write_audit,
)
from app.db import ActivityCount, Facility, User, get_db
from app.roles import CHW, HEALTH_CENTER, RBC_ADMIN, SUPER_ADMIN, normalize_role
from app.schemas import ActivityCountCreate, ActivityCountOut, ActivityCountSummaryOut
from app.services.activity_counts import (
    SOURCE_MANUAL,
    activity_count_dict,
    parse_activity_date,
    refresh_auto_for_scope,
    sum_metrics,
    upsert_manual_row,
    validate_activity_date,
)

router = APIRouter(tags=["activity-counts"])

_METRIC_FIELDS = ("patients_seen", "patients_treated", "rdt_done", "rdt_positive", "referred")


def _row_out(row: ActivityCount) -> ActivityCountOut:
    return ActivityCountOut(**activity_count_dict(row))


def _apply_list_scope(q, user: User):
    role = normalize_role(user.role)
    if role == CHW:
        if not user.chw_code:
            raise HTTPException(400, "CHW account missing chw_code")
        return q.filter(ActivityCount.chw_id == user.chw_code)
    if role == HEALTH_CENTER:
        if not user.facility_id:
            raise HTTPException(400, "Facility account missing facility_id")
        return q.filter(ActivityCount.facility_id == user.facility_id)
    return q


def _scoped_activity_query(db: Session, user: User):
    return _apply_list_scope(db.query(ActivityCount), user)


def _week_bounds(today: date) -> tuple[date, date]:
    start = today - timedelta(days=today.weekday())
    return start, today


@router.post("/activity-counts", response_model=ActivityCountOut)
def upsert_manual_activity(
    body: ActivityCountCreate,
    user: Annotated[User, Depends(require_permission("activity:create"))],
    db: Session = Depends(get_db),
) -> ActivityCountOut:
    role = normalize_role(user.role)
    if role != CHW:
        raise HTTPException(403, detail="Only CHW may create manual activity counts")
    if not user.chw_code or not user.facility_id:
        raise HTTPException(400, "CHW account missing chw_code or facility_id")
    metrics = {k: getattr(body, k) for k in _METRIC_FIELDS}
    try:
        row, action = upsert_manual_row(
            db,
            user_id=user.id,
            chw_id=user.chw_code,
            facility_id=user.facility_id,
            body_metrics=metrics,
            client_uuid=body.client_uuid,
            day_str=body.date,
            note=body.note,
            expected_version=body.version,
        )
    except ValueError as exc:
        code = str(exc)
        if code == "future_date":
            raise HTTPException(400, detail="future_date") from exc
        if code == "client_uuid_conflict_auto":
            raise HTTPException(409, detail="client_uuid_conflict_auto") from exc
        if code == "chw_scope":
            raise HTTPException(403, detail="Outside your CHW scope") from exc
        if code == "version_conflict":
            raise HTTPException(409, detail={"code": "version_conflict"}) from exc
        if code.startswith("invalid_metric"):
            raise HTTPException(400, detail=code) from exc
        raise HTTPException(400, detail="invalid_date") from exc

    write_audit(
        db,
        action=action,
        actor_id=user.id,
        actor_username=user.username,
        resource_type="activity",
        resource_id=row.id,
        detail=f"date={body.date} client_uuid={body.client_uuid}",
        commit=False,
    )
    db.commit()
    db.refresh(row)
    return _row_out(row)


@router.get("/activity-counts", response_model=list[ActivityCountOut])
def list_activity_counts(
    user: Annotated[User, Depends(require_permission("activity:read"))],
    db: Session = Depends(get_db),
    district: Optional[str] = None,
    facility_id: Optional[str] = None,
    chw_id: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    refresh_auto: bool = Query(False, description="Recompute auto rows for filter range"),
) -> list[ActivityCountOut]:
    role = normalize_role(user.role)
    if role == CHW and chw_id and chw_id != user.chw_code:
        raise HTTPException(403, detail="Outside your CHW scope")
    if role == HEALTH_CENTER and facility_id and facility_id != user.facility_id:
        raise HTTPException(403, detail="Outside your facility scope")

    q = _scoped_activity_query(db, user)
    if role in {RBC_ADMIN, SUPER_ADMIN}:
        if district:
            fac_ids = [
                f.facility_id
                for f in db.query(Facility).filter(Facility.district == district).all()
            ]
            if fac_ids:
                q = q.filter(ActivityCount.facility_id.in_(fac_ids))
            else:
                return []
        if facility_id:
            q = q.filter(ActivityCount.facility_id == facility_id)
        if chw_id:
            q = q.filter(ActivityCount.chw_id == chw_id)
    elif role == HEALTH_CENTER and chw_id:
        q = q.filter(ActivityCount.chw_id == chw_id)

    if date_from:
        q = q.filter(ActivityCount.date >= date_from)
    if date_to:
        q = q.filter(ActivityCount.date <= date_to)

    if refresh_auto and date_from and date_to:
        try:
            d0 = parse_activity_date(date_from)
            d1 = parse_activity_date(date_to)
        except ValueError as exc:
            raise HTTPException(400, detail="invalid_date") from exc
        scope_chw = user.chw_code if role == CHW else chw_id
        scope_fac = user.facility_id if role in {CHW, HEALTH_CENTER} else facility_id
        refresh_auto_for_scope(
            db,
            chw_id=scope_chw,
            facility_id=scope_fac,
            date_from=d0,
            date_to=d1,
        )
        q = _scoped_activity_query(db, user)
        if role in {RBC_ADMIN, SUPER_ADMIN}:
            if district:
                fac_ids = [
                    f.facility_id
                    for f in db.query(Facility).filter(Facility.district == district).all()
                ]
                if fac_ids:
                    q = q.filter(ActivityCount.facility_id.in_(fac_ids))
            if facility_id:
                q = q.filter(ActivityCount.facility_id == facility_id)
            if chw_id:
                q = q.filter(ActivityCount.chw_id == chw_id)
        elif role == HEALTH_CENTER and chw_id:
            q = q.filter(ActivityCount.chw_id == chw_id)
        if date_from:
            q = q.filter(ActivityCount.date >= date_from)
        if date_to:
            q = q.filter(ActivityCount.date <= date_to)

    rows = q.order_by(ActivityCount.date.desc(), ActivityCount.chw_id).all()
    return [_row_out(r) for r in rows]


@router.get("/activity-counts/summary", response_model=ActivityCountSummaryOut)
def activity_summary(
    user: Annotated[User, Depends(require_permission("activity:read"))],
    db: Session = Depends(get_db),
    period: str = Query("today", pattern="^(today|week)$"),
    district: Optional[str] = None,
    facility_id: Optional[str] = None,
    chw_id: Optional[str] = None,
) -> ActivityCountSummaryOut:
    today = datetime.utcnow().date()
    if period == "today":
        date_from, date_to = today, today
    else:
        date_from, date_to = _week_bounds(today)

    role = normalize_role(user.role)
    scope_chw = user.chw_code if role == CHW else chw_id
    scope_fac = user.facility_id if role in {CHW, HEALTH_CENTER} else facility_id

    refresh_auto_for_scope(
        db,
        chw_id=scope_chw,
        facility_id=scope_fac,
        date_from=date_from,
        date_to=date_to,
    )

    q = _scoped_activity_query(db, user).filter(
        ActivityCount.date >= date_from.isoformat(),
        ActivityCount.date <= date_to.isoformat(),
    )
    if role in {RBC_ADMIN, SUPER_ADMIN}:
        if district:
            fac_ids = [
                f.facility_id
                for f in db.query(Facility).filter(Facility.district == district).all()
            ]
            if fac_ids:
                q = q.filter(ActivityCount.facility_id.in_(fac_ids))
            else:
                empty = {k: 0 for k in _METRIC_FIELDS}
                return ActivityCountSummaryOut(
                    date_from=date_from.isoformat(),
                    date_to=date_to.isoformat(),
                    auto_total=empty,
                    manual_total=empty,
                    combined=empty,
                )
        if facility_id:
            q = q.filter(ActivityCount.facility_id == facility_id)
        if chw_id:
            q = q.filter(ActivityCount.chw_id == chw_id)

    rows = q.all()
    auto_rows = [r for r in rows if r.source == "auto"]
    manual_rows = [r for r in rows if r.source == "manual"]
    auto_total = sum_metrics(auto_rows)
    manual_total = sum_metrics(manual_rows)
    combined = {k: auto_total[k] + manual_total[k] for k in _METRIC_FIELDS}

    return ActivityCountSummaryOut(
        date_from=date_from.isoformat(),
        date_to=date_to.isoformat(),
        auto_total=auto_total,
        manual_total=manual_total,
        combined=combined,
    )


@router.patch("/activity-counts/{row_id}/confirm", response_model=ActivityCountOut)
def confirm_activity(
    row_id: str,
    user: Annotated[User, Depends(require_permission("activity:update"))],
    db: Session = Depends(get_db),
) -> ActivityCountOut:
    role = normalize_role(user.role)
    if role != HEALTH_CENTER:
        raise HTTPException(403, detail="Only HEALTH_CENTER may confirm activity counts")
    row = db.query(ActivityCount).filter(ActivityCount.id == row_id).first()
    if not row:
        raise HTTPException(404, detail="Activity count not found")
    assert_facility_scope(user, row.facility_id)
    if row.source != SOURCE_MANUAL:
        raise HTTPException(400, detail="Only manual entries are confirmed")

    now = datetime.utcnow()
    row.confirmed_by = user.id
    row.confirmed_at = now
    row.updated_at = now
    row.version = (row.version or 1) + 1
    write_audit(
        db,
        action="activity_count_confirm",
        actor_id=user.id,
        actor_username=user.username,
        resource_type="activity",
        resource_id=row.id,
        detail=f"chw={row.chw_id} date={row.date}",
        commit=False,
    )
    db.commit()
    db.refresh(row)
    return _row_out(row)


@router.get("/activity-counts/export.csv")
def export_activity_csv(
    user: Annotated[User, Depends(require_permission("activity:export"))],
    db: Session = Depends(get_db),
    district: Optional[str] = None,
    facility_id: Optional[str] = None,
    chw_id: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
) -> Response:
    rows = list_activity_counts(
        user=user,
        db=db,
        district=district,
        facility_id=facility_id,
        chw_id=chw_id,
        date_from=date_from,
        date_to=date_to,
        refresh_auto=False,
    )
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(
        [
            "id",
            "client_uuid",
            "chw_id",
            "facility_id",
            "date",
            "source",
            "patients_seen",
            "patients_treated",
            "rdt_done",
            "rdt_positive",
            "referred",
            "version",
            "confirmed_at",
        ]
    )
    for item in rows:
        w.writerow(
            [
                item.id,
                item.client_uuid,
                item.chw_id,
                item.facility_id,
                item.date,
                item.source,
                item.patients_seen,
                item.patients_treated,
                item.rdt_done,
                item.rdt_positive,
                item.referred,
                item.version,
                item.confirmed_at.isoformat() if item.confirmed_at else "",
            ]
        )
    write_audit(
        db,
        action="activity_export",
        actor_id=user.id,
        actor_username=user.username,
        resource_type="activity",
        detail="csv",
    )
    return Response(
        content=buf.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=activity-counts.csv"},
    )

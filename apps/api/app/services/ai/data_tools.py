"""RBAC-scoped aggregate data tools for AI assistant (no PII in outputs)."""

from __future__ import annotations

import re
from datetime import date, datetime, time, timedelta
from typing import Any

from sqlalchemy.orm import Session

from app.auth import has_permission
from app.config import settings
from app.db import ActivityCount, CaseRecord, Facility, Referral, User
from app.roles import CHW, HEALTH_CENTER, RBC_ADMIN, SUPER_ADMIN, normalize_role
from app.services.activity_counts import refresh_auto_for_scope, sum_metrics

_METRIC_FIELDS = ("patients_seen", "patients_treated", "rdt_done", "rdt_positive", "referred")


def _week_bounds(today: date) -> tuple[date, date]:
    start = today - timedelta(days=today.weekday())
    return start, today


def _scoped_referrals(db: Session, user: User):
    q = db.query(Referral)
    role = normalize_role(user.role)
    if role == CHW:
        if not user.chw_code:
            return None
        return q.filter(Referral.chw_id == user.chw_code)
    if role == HEALTH_CENTER:
        if not user.facility_id:
            return None
        return q.filter(Referral.facility_id == user.facility_id)
    return q


def _scoped_activity(db: Session, user: User):
    q = db.query(ActivityCount)
    role = normalize_role(user.role)
    if role == CHW:
        if not user.chw_code:
            return None
        return q.filter(ActivityCount.chw_id == user.chw_code)
    if role == HEALTH_CENTER:
        if not user.facility_id:
            return None
        return q.filter(ActivityCount.facility_id == user.facility_id)
    return q


def _district_filter(q, db: Session, user: User):
    role = normalize_role(user.role)
    if role not in {RBC_ADMIN, SUPER_ADMIN}:
        return q
    if user.district:
        fac_ids = [
            f.facility_id for f in db.query(Facility).filter(Facility.district == user.district).all()
        ]
        if fac_ids:
            return q.filter(ActivityCount.facility_id.in_(fac_ids))
    return q


def get_my_counts(db: Session, user: User) -> dict[str, Any]:
    if not has_permission(db, user, "activity:read"):
        return {"ok": False, "denied": True, "tool": "get_my_counts"}
    q = _scoped_activity(db, user)
    if q is None:
        return {"ok": False, "error": "scope_missing", "tool": "get_my_counts"}
    today = datetime.utcnow().date()
    week_from, week_to = _week_bounds(today)
    role = normalize_role(user.role)
    scope_chw = user.chw_code if role == CHW else None
    scope_fac = user.facility_id if role in {CHW, HEALTH_CENTER} else None
    refresh_auto_for_scope(
        db,
        chw_id=scope_chw,
        facility_id=scope_fac,
        date_from=week_from,
        date_to=week_to,
    )
    q = _district_filter(q, db, user)
    rows_today = q.filter(ActivityCount.date == today.isoformat()).all()
    rows_week = q.filter(
        ActivityCount.date >= week_from.isoformat(),
        ActivityCount.date <= week_to.isoformat(),
    ).all()
    return {
        "ok": True,
        "tool": "get_my_counts",
        "today": sum_metrics(rows_today),
        "week": sum_metrics(rows_week),
        "period_today": today.isoformat(),
        "period_week_from": week_from.isoformat(),
        "period_week_to": week_to.isoformat(),
    }


def get_treated_counts(db: Session, user: User) -> dict[str, Any]:
    base = get_my_counts(db, user)
    if not base.get("ok"):
        return {**base, "tool": "get_treated_counts"}
    return {
        "ok": True,
        "tool": "get_treated_counts",
        "today_treated": base["today"]["patients_treated"],
        "week_treated": base["week"]["patients_treated"],
        "today_seen": base["today"]["patients_seen"],
        "week_seen": base["week"]["patients_seen"],
    }


def get_pending_referrals(db: Session, user: User) -> dict[str, Any]:
    if not has_permission(db, user, "referrals:read"):
        return {"ok": False, "denied": True, "tool": "get_pending_referrals"}
    q = _scoped_referrals(db, user)
    if q is None:
        return {"ok": False, "error": "scope_missing", "tool": "get_pending_referrals"}
    pending_status = ("sent", "received")
    rows = q.filter(Referral.status.in_(pending_status)).all()
    urgent = sum(1 for r in rows if r.decision == "urgent_refer")
    return {
        "ok": True,
        "tool": "get_pending_referrals",
        "pending_total": len(rows),
        "pending_urgent": urgent,
        "by_status": {
            st: sum(1 for r in rows if r.status == st) for st in pending_status
        },
    }


def get_overdue_alerts(db: Session, user: User) -> dict[str, Any]:
    if not has_permission(db, user, "alerts:read"):
        return {"ok": False, "denied": True, "tool": "get_overdue_alerts"}
    q = _scoped_referrals(db, user)
    if q is None:
        return {"ok": False, "error": "scope_missing", "tool": "get_overdue_alerts"}
    now = datetime.utcnow()
    cutoff = now - timedelta(hours=settings.overdue_hours)
    rows = (
        q.filter(
            Referral.arrived_at.is_(None),
            Referral.status.in_(["sent", "received"]),
            Referral.created_at <= cutoff,
        )
        .all()
    )
    urgent = sum(1 for r in rows if r.decision == "urgent_refer")
    return {
        "ok": True,
        "tool": "get_overdue_alerts",
        "overdue_total": len(rows),
        "overdue_urgent": urgent,
        "overdue_hours_threshold": settings.overdue_hours,
    }


def _compute_surge(db: Session, user: User, *, district: str | None) -> dict[str, int]:
    today = datetime.utcnow().date().isoformat()
    q = db.query(CaseRecord).filter(CaseRecord.date == today)
    if district:
        q = q.filter(CaseRecord.district == district)
    role = normalize_role(user.role)
    if role == CHW and user.chw_code:
        q = q.filter(CaseRecord.chw_id == user.chw_code)
    rows = q.all()
    day_start = datetime.combine(datetime.utcnow().date(), time.min)
    rq = db.query(Referral).filter(
        Referral.decision == "urgent_refer",
        Referral.created_at >= day_start,
    )
    scoped = _scoped_referrals(db, user)
    if scoped is not None:
        rq = scoped.filter(
            Referral.decision == "urgent_refer",
            Referral.created_at >= day_start,
        )
    urgent_refs = rq.count()
    return {"cases_today": len(rows), "urgent_referrals_today": urgent_refs}


def get_facility_kpis(db: Session, user: User) -> dict[str, Any]:
    if not has_permission(db, user, "analytics:read"):
        return {"ok": False, "denied": True, "tool": "get_facility_kpis"}
    role = normalize_role(user.role)
    district = user.district if role in {RBC_ADMIN, SUPER_ADMIN, HEALTH_CENTER} else None
    if role == HEALTH_CENTER and user.facility_id:
        fac = db.query(Facility).filter(Facility.facility_id == user.facility_id).first()
        district = fac.district if fac else district
    surge = _compute_surge(db, user, district=district)
    pending = get_pending_referrals(db, user)
    overdue = get_overdue_alerts(db, user)
    treated = get_treated_counts(db, user)
    kpis: dict[str, Any] = {
        "ok": True,
        "tool": "get_facility_kpis",
        "synthetic": True,
        "cases_today": surge["cases_today"],
        "urgent_referrals_today": surge["urgent_referrals_today"],
    }
    if pending.get("ok"):
        kpis["pending_referrals"] = pending["pending_total"]
    if overdue.get("ok"):
        kpis["overdue_alerts"] = overdue["overdue_total"]
    if treated.get("ok"):
        kpis["patients_treated_today"] = treated["today_treated"]
    return kpis


_TOOL_BY_NAME = {
    "get_my_counts": get_my_counts,
    "get_pending_referrals": get_pending_referrals,
    "get_overdue_alerts": get_overdue_alerts,
    "get_facility_kpis": get_facility_kpis,
    "get_treated_counts": get_treated_counts,
}

_TOOL_PICKERS: list[tuple[str, re.Pattern[str]]] = [
    ("get_treated_counts", re.compile(r"\b(treated|treatment|gupfusha|traités?)\b", re.I)),
    ("get_overdue_alerts", re.compile(r"\b(overdue|late|ntabwo|retard|alert)\b", re.I)),
    ("get_pending_referrals", re.compile(r"\b(pending|sent|inbox|oherejwe|référence)\b", re.I)),
    ("get_facility_kpis", re.compile(r"\b(kpi|dashboard|analytics|facility|ikigo|district)\b", re.I)),
    ("get_my_counts", re.compile(r"\b(my count|activity|today|how many|count|stats|numbers|ibibarura)\b", re.I)),
]


def pick_data_tools(message: str) -> list[str]:
    text = message or ""
    picked: list[str] = []
    for name, pat in _TOOL_PICKERS:
        if pat.search(text) and name not in picked:
            picked.append(name)
    if not picked:
        picked = ["get_my_counts", "get_pending_referrals", "get_overdue_alerts"]
    return picked


def run_data_tools(db: Session | None, user: User | None, message: str) -> dict[str, Any]:
    if db is None or user is None:
        return {"ok": False, "auth_required": True, "tools": {}}
    tools: dict[str, Any] = {}
    for name in pick_data_tools(message):
        fn = _TOOL_BY_NAME.get(name)
        if fn:
            tools[name] = fn(db, user)
    return {"ok": True, "tools": tools}


def format_data_facts_for_prompt(facts: dict[str, Any] | None) -> str:
    if not facts:
        return "(no data tools)"
    if facts.get("auth_required"):
        return "DATA_TOOLS=auth_required (user must be signed in for counts)"
    import json

    return "DATA_TOOLS=" + json.dumps(facts.get("tools") or {}, ensure_ascii=False)

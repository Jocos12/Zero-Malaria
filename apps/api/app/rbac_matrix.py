"""Default permission matrix and resource:action codes (4 roles)."""

from __future__ import annotations

from app.roles import CHW, HEALTH_CENTER, RBC_ADMIN, SUPER_ADMIN

ACTIONS = ("read", "create", "update", "delete", "export", "assign", "use")
RESOURCES = (
    "users",
    "roles",
    "permissions",
    "districts",
    "sectors",
    "cells",
    "villages",
    "facilities",
    "chw_profiles",
    "patients",
    "triages",
    "referrals",
    "referral_messages",
    "followups",
    "stock",
    "alerts",
    "analytics",
    "activity",
    "audit_logs",
    "config",
    "voice",
)

SCOPES = ("own", "village", "facility", "district", "national")


def all_permission_codes() -> list[str]:
    # voice:use is the only voice action used in the matrix (not every ACTION combo)
    codes = [f"{r}:{a}" for r in RESOURCES if r != "voice" for a in ACTIONS if a != "use"]
    codes.append("voice:use")
    return codes


def _all() -> set[str]:
    return set(all_permission_codes())


def _bundle(resource: str, *actions: str) -> set[str]:
    return {f"{resource}:{a}" for a in actions}


DEFAULT_MATRIX: dict[str, set[str]] = {
    SUPER_ADMIN: _all(),
    RBC_ADMIN: (
        _all()
        - _bundle("roles", "create", "update", "delete", "assign")
        - _bundle("permissions", "create", "update", "delete", "assign")
        - _bundle("activity", "create", "update")
    ),
    HEALTH_CENTER: {
        *_bundle("activity", "read", "update"),
        *_bundle("referrals", "read", "update"),
        *_bundle("referral_messages", "read", "create"),
        *_bundle("patients", "read"),
        *_bundle("triages", "read"),
        *_bundle("stock", "read", "update"),
        *_bundle("alerts", "read", "update"),
        *_bundle("followups", "read", "create"),
        *_bundle("facilities", "read"),
        *_bundle("chw_profiles", "read"),
        *_bundle("users", "read"),
        "voice:use",
    },
    CHW: {
        *_bundle("activity", "read", "create", "update"),
        *_bundle("triages", "read", "create"),
        *_bundle("referrals", "read", "create"),
        *_bundle("referral_messages", "read", "create"),
        *_bundle("followups", "read", "update"),
        *_bundle("alerts", "read"),
        *_bundle("patients", "read", "create"),
        *_bundle("villages", "read"),
        "voice:use",
    },
}

DEFAULT_SCOPE: dict[str, str] = {
    SUPER_ADMIN: "national",
    RBC_ADMIN: "national",
    HEALTH_CENTER: "facility",
    CHW: "own",
}

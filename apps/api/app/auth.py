"""Auth helpers: password hashing, JWT, RBAC permissions, audit logging."""

from __future__ import annotations

import hashlib
import secrets
from datetime import datetime, timedelta
from typing import Annotated, Callable, Iterable

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from passlib.context import CryptContext
from sqlalchemy.orm import Session

from app.config import settings
from app.db import (
    AuditLog,
    RolePermission,
    User,
    UserPermissionOverride,
    get_db,
)
from app.rbac_matrix import DEFAULT_SCOPE
from app.roles import (
    CHW,
    HEALTH_CENTER,
    RBC_ADMIN,
    SUPER_ADMIN,
    normalize_role,
    rank,
)

try:
    from argon2 import PasswordHasher
    from argon2.exceptions import VerifyMismatchError

    # Lower costs for local demo responsiveness (still stronger than bcrypt defaults).
    _argon2 = PasswordHasher(time_cost=2, memory_cost=65536, parallelism=1)
except Exception:  # pragma: no cover
    _argon2 = None

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
bearer = HTTPBearer(auto_error=False)

Role = str


def hash_password(password: str) -> str:
    if _argon2 is not None:
        return "argon2$" + _argon2.hash(password)
    return pwd_context.hash(password)


def verify_password(plain: str, hashed: str) -> bool:
    if hashed.startswith("argon2$") and _argon2 is not None:
        try:
            return _argon2.verify(hashed[len("argon2$") :], plain)
        except VerifyMismatchError:
            return False
        except Exception:
            return False
    return pwd_context.verify(plain, hashed)


COMMON_PASSWORDS = {
    "password",
    "password123",
    "1234567890",
    "qwertyuiop",
    "demo1234",
    "changeme12",
    "adminadmin",
}


def validate_password_policy(password: str, username: str) -> str | None:
    if len(password) < 10:
        return "password_too_short"
    if password.lower() == username.lower():
        return "password_matches_username"
    if password.lower() in COMMON_PASSWORDS:
        return "password_too_common"
    return None


def create_access_token(user: User, expires_hours: int | None = None) -> str:
    hours = expires_hours if expires_hours is not None else settings.jwt_expire_hours
    role = normalize_role(user.role)
    payload = {
        "sub": user.id,
        "username": user.username,
        "role": role,
        "facility_id": user.facility_id,
        "district": user.district,
        "type": "access",
        "exp": datetime.utcnow() + timedelta(hours=hours),
        "iat": datetime.utcnow(),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm="HS256")


def create_refresh_token_value() -> str:
    return secrets.token_urlsafe(48)


def hash_token(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def decode_token(token: str) -> dict:
    try:
        return jwt.decode(token, settings.jwt_secret, algorithms=["HS256"])
    except jwt.ExpiredSignatureError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"code": "token_expired", "message": "Token expired"},
        ) from exc
    except jwt.PyJWTError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"code": "token_invalid", "message": "Invalid token"},
        ) from exc


def write_audit(
    db: Session,
    *,
    action: str,
    actor_id: str | None = None,
    actor_username: str | None = None,
    resource_type: str | None = None,
    resource_id: str | None = None,
    detail: str | None = None,
    ip: str = "",
    commit: bool = True,
) -> None:
    db.add(
        AuditLog(
            action=action,
            actor_id=actor_id,
            actor_username=actor_username,
            resource_type=resource_type,
            resource_id=resource_id,
            detail=detail or "",
            ip=ip or "",
            created_at=datetime.utcnow(),
        )
    )
    if commit:
        db.commit()


def user_permissions(db: Session, user: User) -> set[str]:
    role = normalize_role(user.role)
    if role == SUPER_ADMIN:
        from app.rbac_matrix import all_permission_codes

        return set(all_permission_codes())
    perms = {
        r.permission_code
        for r in db.query(RolePermission).filter(RolePermission.role_code == role).all()
    }
    for ov in db.query(UserPermissionOverride).filter(UserPermissionOverride.user_id == user.id).all():
        if ov.allowed:
            perms.add(ov.permission_code)
        else:
            perms.discard(ov.permission_code)
    return perms


def has_permission(db: Session, user: User, code: str) -> bool:
    return code in user_permissions(db, user)


def data_scope(user: User) -> str:
    return DEFAULT_SCOPE.get(normalize_role(user.role), "own")


def get_current_user(
    creds: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)],
    db: Annotated[Session, Depends(get_db)],
) -> User:
    if creds is None or not creds.credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"code": "token_missing", "message": "Not authenticated"},
        )
    data = decode_token(creds.credentials)
    if data.get("type") not in (None, "access"):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"code": "token_invalid", "message": "Invalid token type"},
        )
    user = db.query(User).filter(User.id == data.get("sub")).first()
    if not user or not user.active or user.deleted_at is not None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"code": "token_invalid", "message": "User inactive or missing"},
        )
    # Normalize role in-memory for downstream checks
    user.role = normalize_role(user.role)
    return user


def require_roles(*roles: Role) -> Callable:
    allowed = {normalize_role(r) for r in roles}

    def _dep(
        user: Annotated[User, Depends(get_current_user)],
        db: Annotated[Session, Depends(get_db)],
    ) -> User:
        if normalize_role(user.role) not in allowed:
            write_audit(
                db,
                action="denied_access",
                actor_id=user.id,
                actor_username=user.username,
                detail=f"required_roles={','.join(sorted(allowed))}",
            )
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized for this action")
        return user

    return _dep


def require_permission(code: str) -> Callable:
    def _dep(
        user: Annotated[User, Depends(get_current_user)],
        db: Annotated[Session, Depends(get_db)],
    ) -> User:
        if not has_permission(db, user, code):
            write_audit(
                db,
                action="denied_permission",
                actor_id=user.id,
                actor_username=user.username,
                detail=f"required={code}",
            )
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail={"code": "missing_permission", "message": "Missing permission", "required": code},
            )
        return user

    return _dep


def assert_facility_scope(user: User, facility_id: str | None) -> None:
    role = normalize_role(user.role)
    if role in {SUPER_ADMIN, RBC_ADMIN}:
        return
    if role in {HEALTH_CENTER, CHW} and user.facility_id and facility_id == user.facility_id:
        return
    raise HTTPException(status_code=403, detail="Outside your facility scope")


def assert_chw_own(user: User, chw_id: str | None) -> None:
    role = normalize_role(user.role)
    if role != CHW:
        return
    if user.chw_code and chw_id == user.chw_code:
        return
    raise HTTPException(status_code=403, detail="Outside your CHW scope")


def can_manage_user(actor: User, target_role: str) -> bool:
    """Anti-escalation: actor may only manage roles at or below their rank, with SUPER_ADMIN exclusivity."""
    a = normalize_role(actor.role)
    t = normalize_role(target_role)
    if a == SUPER_ADMIN:
        return True
    if t in {SUPER_ADMIN, RBC_ADMIN}:
        return False
    if a == RBC_ADMIN:
        return t in {HEALTH_CENTER, CHW}
    return False


def assert_can_modify_user(db: Session, actor: User, target: User, *, new_role: str | None = None) -> None:
    a = normalize_role(actor.role)
    t_role = normalize_role(new_role or target.role)
    if actor.id == target.id and (new_role and normalize_role(new_role) != a):
        raise HTTPException(403, detail="Cannot change your own role")
    if not can_manage_user(actor, t_role):
        raise HTTPException(403, detail="Cannot manage this role")
    if normalize_role(target.role) == SUPER_ADMIN and a != SUPER_ADMIN:
        raise HTTPException(403, detail="Cannot edit SUPER_ADMIN")
    if a == RBC_ADMIN and normalize_role(target.role) == SUPER_ADMIN:
        raise HTTPException(403, detail="RBC_ADMIN cannot edit SUPER_ADMIN")
    if rank(t_role) > rank(a):
        raise HTTPException(403, detail="Cannot escalate above your own role")


def assert_not_last_super_admin(db: Session, target: User, *, demoting: bool = False) -> None:
    if normalize_role(target.role) != SUPER_ADMIN:
        return
    active_supers = (
        db.query(User)
        .filter(
            User.role == SUPER_ADMIN,
            User.active.is_(True),
            User.deleted_at.is_(None),
        )
        .count()
    )
    if active_supers <= 1 and (demoting or not target.active or target.deleted_at is not None):
        raise HTTPException(403, detail="Cannot deactivate, delete or demote the last SUPER_ADMIN")


def apply_scope_filter_users(query, user: User):
    role = normalize_role(user.role)
    scope = data_scope(user)
    if scope == "national" or role in {SUPER_ADMIN, RBC_ADMIN}:
        return query
    if scope == "facility" and user.facility_id:
        # HEALTH_CENTER: own facility users (typically CHWs), read-only in UI
        return query.filter(User.facility_id == user.facility_id)
    if scope == "own":
        return query.filter(User.id == user.id)
    return query.filter(User.id == user.id)


def mask_sensitive(data: dict) -> dict:
    out = dict(data)
    for key in ("password", "password_hash", "access_token", "refresh_token", "token"):
        if key in out and out[key]:
            out[key] = "***"
    return out

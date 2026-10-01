from datetime import datetime
from typing import Optional

from sqlalchemy import Boolean, DateTime, Float, Integer, String, Text, UniqueConstraint, create_engine, text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, sessionmaker

from app.config import settings


class Base(DeclarativeBase):
    pass


class Facility(Base):
    __tablename__ = "facilities"

    facility_id: Mapped[str] = mapped_column(String(32), primary_key=True)
    name: Mapped[str] = mapped_column(String(128))
    district: Mapped[str] = mapped_column(String(64), index=True)
    sector: Mapped[str] = mapped_column(String(64))
    facility_type: Mapped[str] = mapped_column(String(32), default="health_center")
    pilot: Mapped[int] = mapped_column(Integer, default=0)
    remote: Mapped[int] = mapped_column(Integer, default=0)
    latitude: Mapped[float] = mapped_column(Float)
    longitude: Mapped[float] = mapped_column(Float)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    deleted_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    version: Mapped[int] = mapped_column(Integer, default=1)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class CaseRecord(Base):
    __tablename__ = "cases"

    case_id: Mapped[str] = mapped_column(String(32), primary_key=True)
    date: Mapped[str] = mapped_column(String(16), index=True)
    district: Mapped[str] = mapped_column(String(64), index=True)
    sector: Mapped[str] = mapped_column(String(64))
    chw_id: Mapped[str] = mapped_column(String(32), index=True)
    age_months: Mapped[int] = mapped_column(Integer)
    sex: Mapped[str] = mapped_column(String(16))
    temperature_c: Mapped[float] = mapped_column(Float)
    fever_days: Mapped[int] = mapped_column(Integer)
    convulsions: Mapped[int] = mapped_column(Integer, default=0)
    unable_to_drink: Mapped[int] = mapped_column(Integer, default=0)
    vomiting_everything: Mapped[int] = mapped_column(Integer, default=0)
    lethargy: Mapped[int] = mapped_column(Integer, default=0)
    severe_breathing_difficulty: Mapped[int] = mapped_column(Integer, default=0)
    tdr_result: Mapped[str] = mapped_column(String(16))
    decision: Mapped[str] = mapped_column(String(32), index=True)
    referral_completed: Mapped[int] = mapped_column(Integer, default=0)
    arrival_delay_hours: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    outcome: Mapped[str] = mapped_column(String(32))


class StockRecord(Base):
    __tablename__ = "stock"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    facility_id: Mapped[str] = mapped_column(String(32), index=True)
    facility_name: Mapped[str] = mapped_column(String(128))
    district: Mapped[str] = mapped_column(String(64), index=True)
    week_start: Mapped[str] = mapped_column(String(16), index=True)
    commodity: Mapped[str] = mapped_column(String(64), index=True)
    unit: Mapped[str] = mapped_column(String(128))
    stock_on_hand: Mapped[int] = mapped_column(Integer)
    quantity_consumed: Mapped[int] = mapped_column(Integer)
    stockout: Mapped[int] = mapped_column(Integer, default=0)
    weeks_of_cover: Mapped[float] = mapped_column(Float)
    deleted_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    version: Mapped[int] = mapped_column(Integer, default=1)


class StockMovement(Base):
    __tablename__ = "stock_movements"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    facility_id: Mapped[str] = mapped_column(String(32), index=True)
    commodity: Mapped[str] = mapped_column(String(64), index=True)
    delta: Mapped[int] = mapped_column(Integer)
    reason: Mapped[str] = mapped_column(String(255), default="")
    actor_id: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)


class Referral(Base):
    __tablename__ = "referrals"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    client_uuid: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    case_id: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    facility_id: Mapped[str] = mapped_column(String(32), index=True)
    chw_id: Mapped[str] = mapped_column(String(32), index=True)
    district: Mapped[str] = mapped_column(String(64), index=True)
    sector: Mapped[str] = mapped_column(String(64))
    age_months: Mapped[int] = mapped_column(Integer)
    sex: Mapped[str] = mapped_column(String(16))
    decision: Mapped[str] = mapped_column(String(32), index=True)
    reasons_json: Mapped[str] = mapped_column(Text, default="[]")
    summary: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(32), default="sent", index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    received_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    arrived_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    treated_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    demo_flag: Mapped[bool] = mapped_column(Boolean, default=False)


class SyncEvent(Base):
    __tablename__ = "sync_events"

    client_uuid: Mapped[str] = mapped_column(String(64), primary_key=True)
    payload_type: Mapped[str] = mapped_column(String(32))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    username: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    email: Mapped[str] = mapped_column(String(128), default="", index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    display_name: Mapped[str] = mapped_column(String(128))
    role: Mapped[str] = mapped_column(String(32), index=True)  # UPPER_SNAKE roles
    phone: Mapped[str] = mapped_column(String(32), default="")
    district: Mapped[str] = mapped_column(String(64), default="", index=True)
    facility_id: Mapped[str] = mapped_column(String(32), default="", index=True)
    village: Mapped[str] = mapped_column(String(128), default="")
    village_id: Mapped[str] = mapped_column(String(64), default="", index=True)
    chw_code: Mapped[str] = mapped_column(String(32), default="")
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    must_change_password: Mapped[bool] = mapped_column(Boolean, default=False)
    # pending | changed | dismissed — gating uses this (+ PASSWORD_CHANGE_POLICY), not must_change alone
    password_prompt_status: Mapped[str] = mapped_column(String(16), default="changed")
    failed_login_count: Mapped[int] = mapped_column(Integer, default=0)
    locked_until: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    last_login: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    deleted_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True, index=True)
    version: Mapped[int] = mapped_column(Integer, default=1)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class RefreshToken(Base):
    __tablename__ = "refresh_tokens"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[str] = mapped_column(String(64), index=True)
    token_hash: Mapped[str] = mapped_column(String(128), unique=True, index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime, index=True)
    revoked_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class Permission(Base):
    __tablename__ = "permissions"

    code: Mapped[str] = mapped_column(String(64), primary_key=True)
    resource: Mapped[str] = mapped_column(String(64), index=True)
    action: Mapped[str] = mapped_column(String(32), index=True)
    description: Mapped[str] = mapped_column(String(255), default="")


class RoleRow(Base):
    """Named role catalog (mirrors canonical role codes)."""

    __tablename__ = "roles"

    code: Mapped[str] = mapped_column(String(32), primary_key=True)
    label_key: Mapped[str] = mapped_column(String(64), default="")
    locked: Mapped[bool] = mapped_column(Boolean, default=False)  # SUPER_ADMIN locked


class RolePermission(Base):
    __tablename__ = "role_permissions"
    __table_args__ = (UniqueConstraint("role_code", "permission_code", name="uq_role_perm"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    role_code: Mapped[str] = mapped_column(String(32), index=True)
    permission_code: Mapped[str] = mapped_column(String(64), index=True)


class UserPermissionOverride(Base):
    __tablename__ = "user_permission_overrides"
    __table_args__ = (UniqueConstraint("user_id", "permission_code", name="uq_user_perm"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[str] = mapped_column(String(64), index=True)
    permission_code: Mapped[str] = mapped_column(String(64), index=True)
    allowed: Mapped[bool] = mapped_column(Boolean, default=True)


class District(Base):
    __tablename__ = "districts"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(128), unique=True, index=True)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    deleted_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    version: Mapped[int] = mapped_column(Integer, default=1)


class Sector(Base):
    __tablename__ = "sectors"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    district_id: Mapped[str] = mapped_column(String(64), index=True)
    name: Mapped[str] = mapped_column(String(128), index=True)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    deleted_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    version: Mapped[int] = mapped_column(Integer, default=1)


class Cell(Base):
    __tablename__ = "cells"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    sector_id: Mapped[str] = mapped_column(String(64), index=True)
    name: Mapped[str] = mapped_column(String(128), index=True)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    deleted_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    version: Mapped[int] = mapped_column(Integer, default=1)


class Village(Base):
    __tablename__ = "villages"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    cell_id: Mapped[str] = mapped_column(String(64), index=True)
    name: Mapped[str] = mapped_column(String(128), index=True)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    deleted_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    version: Mapped[int] = mapped_column(Integer, default=1)


class AppConfig(Base):
    __tablename__ = "app_config"

    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[str] = mapped_column(Text, default="")
    label: Mapped[str] = mapped_column(String(255), default="")
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    version: Mapped[int] = mapped_column(Integer, default=1)


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    action: Mapped[str] = mapped_column(String(64), index=True)
    actor_id: Mapped[Optional[str]] = mapped_column(String(64), nullable=True, index=True)
    actor_username: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    resource_type: Mapped[Optional[str]] = mapped_column(String(64), nullable=True, index=True)
    resource_id: Mapped[Optional[str]] = mapped_column(String(64), nullable=True, index=True)
    detail: Mapped[str] = mapped_column(Text, default="")
    ip: Mapped[str] = mapped_column(String(64), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)


class ReferralMessage(Base):
    __tablename__ = "referral_messages"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    referral_id: Mapped[str] = mapped_column(String(64), index=True)
    sender_id: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    sender_role: Mapped[str] = mapped_column(String(32), default="")
    body: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)
    read_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)


class AppEvent(Base):
    __tablename__ = "app_events"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    event_type: Mapped[str] = mapped_column(String(64), index=True)
    payload_json: Mapped[str] = mapped_column(Text, default="{}")
    chw_id: Mapped[str] = mapped_column(String(32), default="", index=True)
    facility_id: Mapped[str] = mapped_column(String(32), default="", index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)


class ActivityCount(Base):
    __tablename__ = "activity_counts"
    __table_args__ = (
        UniqueConstraint("chw_id", "facility_id", "date", "source", name="uq_activity_chw_fac_date_src"),
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    client_uuid: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    chw_id: Mapped[str] = mapped_column(String(32), index=True)
    facility_id: Mapped[str] = mapped_column(String(32), index=True)
    date: Mapped[str] = mapped_column(String(10), index=True)
    patients_seen: Mapped[int] = mapped_column(Integer, default=0)
    patients_treated: Mapped[int] = mapped_column(Integer, default=0)
    rdt_done: Mapped[int] = mapped_column(Integer, default=0)
    rdt_positive: Mapped[int] = mapped_column(Integer, default=0)
    referred: Mapped[int] = mapped_column(Integer, default=0)
    source: Mapped[str] = mapped_column(String(16), default="manual", index=True)
    note: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    version: Mapped[int] = mapped_column(Integer, default=1)
    created_by: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    confirmed_by: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    confirmed_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)


class FollowUp(Base):
    __tablename__ = "follow_ups"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    referral_id: Mapped[Optional[str]] = mapped_column(String(64), nullable=True, index=True)
    chw_id: Mapped[str] = mapped_column(String(32), index=True)
    facility_id: Mapped[str] = mapped_column(String(32), default="")
    due_date: Mapped[str] = mapped_column(String(16), index=True)
    status: Mapped[str] = mapped_column(String(32), default="due")
    note: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


def _make_engine(url: str | None = None):
    return create_engine(
        url or settings.database_url,
        connect_args={"check_same_thread": False},
    )


engine = _make_engine()
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


def configure_engine(url: str) -> None:
    """Used by tests to point at an isolated SQLite file."""
    global engine, SessionLocal
    engine.dispose()
    engine = _make_engine(url)
    SessionLocal.configure(bind=engine)


def _ensure_columns() -> None:
    """Add missing columns on existing SQLite tables (idempotent)."""
    alters = [
        ("facilities", "facility_type", "VARCHAR(32) DEFAULT 'health_center'"),
        ("facilities", "active", "BOOLEAN DEFAULT 1"),
        ("facilities", "deleted_at", "DATETIME"),
        ("facilities", "version", "INTEGER DEFAULT 1"),
        ("facilities", "updated_at", "DATETIME"),
        ("stock", "deleted_at", "DATETIME"),
        ("stock", "version", "INTEGER DEFAULT 1"),
        ("users", "email", "VARCHAR(128) DEFAULT ''"),
        ("users", "must_change_password", "BOOLEAN DEFAULT 0"),
        ("users", "password_prompt_status", "VARCHAR(16) DEFAULT 'changed'"),
        ("users", "failed_login_count", "INTEGER DEFAULT 0"),
        ("users", "locked_until", "DATETIME"),
        ("users", "last_login", "DATETIME"),
        ("users", "deleted_at", "DATETIME"),
        ("users", "version", "INTEGER DEFAULT 1"),
        ("users", "updated_at", "DATETIME"),
        ("users", "village_id", "VARCHAR(64) DEFAULT ''"),
        ("audit_logs", "ip", "VARCHAR(64) DEFAULT ''"),
    ]
    with engine.begin() as conn:
        for table, col, decl in alters:
            try:
                conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {col} {decl}"))
            except Exception:
                pass  # column already exists


def init_db() -> None:
    Base.metadata.create_all(bind=engine)
    _ensure_columns()
    from app.migrate import run_migrations

    run_migrations()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

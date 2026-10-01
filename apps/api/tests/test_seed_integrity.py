"""Referral integrity checks after seed (isolated tmp DB)."""

from __future__ import annotations

import sys
from datetime import datetime, timedelta
from pathlib import Path

import pytest

API_ROOT = Path(__file__).resolve().parents[1]
if str(API_ROOT) not in sys.path:
    sys.path.insert(0, str(API_ROOT))

from app.config import settings
from app.db import Base, CaseRecord, Facility, Referral, ReferralMessage, SessionLocal, User, configure_engine, init_db
from app import seed as seed_module


@pytest.fixture()
def seeded_db(tmp_path):
    db_file = tmp_path / "seed_test.db"
    configure_engine(f"sqlite:///{db_file}")
    from app import db as db_module

    Base.metadata.drop_all(bind=db_module.engine)
    init_db()
    db = SessionLocal()
    seed_module.run_seed(db, "full")
    db.commit()
    yield db
    db.close()


def _assert_timestamp_order(row: Referral) -> None:
    t_created = row.created_at
    t_recv = row.received_at
    t_arr = row.arrived_at
    t_treat = row.treated_at
    if t_recv is not None:
        assert t_created < t_recv
    if t_arr is not None:
        assert t_recv is not None and t_recv < t_arr
    if t_treat is not None:
        assert t_arr is not None and t_arr < t_treat


def test_ensure_demo_users_on_empty_db(tmp_path):
    db_file = tmp_path / "empty.db"
    configure_engine(f"sqlite:///{db_file}")
    from app import db as db_module
    from app.auth import verify_password

    Base.metadata.drop_all(bind=db_module.engine)
    init_db()
    db = SessionLocal()
    try:
        created = seed_module.ensure_demo_users(db)
        db.commit()
        assert created == len(seed_module.DEMO_ACCOUNTS)
        admin = db.query(User).filter(User.username == "super.admin").one()
        assert admin.role == "SUPER_ADMIN"
        assert admin.active is True
        assert verify_password(settings.demo_password, admin.password_hash)
        assert seed_module.ensure_demo_users(db) == 0
    finally:
        db.close()


def test_referral_timestamps_ordering(seeded_db):
    for row in seeded_db.query(Referral).all():
        _assert_timestamp_order(row)


def test_no_orphan_facility_ids(seeded_db):
    facility_ids = {f.facility_id for f in seeded_db.query(Facility).all()}
    for row in seeded_db.query(Referral).all():
        assert row.facility_id in facility_ids


def test_at_least_one_overdue_urgent(seeded_db):
    today = datetime.fromisoformat(settings.demo_today)
    cutoff = today - timedelta(hours=settings.overdue_hours)
    overdue = [
        r
        for r in seeded_db.query(Referral).all()
        if r.decision == "urgent_refer"
        and r.status == "sent"
        and r.created_at <= cutoff
    ]
    assert len(overdue) >= 1


def test_prominent_pilot_districts(seeded_db):
    for district in ("Gisagara", "Nyamagabe"):
        pilots = (
            seeded_db.query(Facility)
            .filter(Facility.district == district, Facility.pilot == 1)
            .count()
        )
        assert pilots >= 1


def test_case_volume_and_roles(seeded_db):
    assert seeded_db.query(CaseRecord).count() >= 3000
    assert seeded_db.query(Referral).count() >= 60
    assert seeded_db.query(ReferralMessage).count() >= 20
    assert seeded_db.query(User).filter(User.role == "CHW").count() >= 30
    assert seeded_db.query(User).filter(User.role == "HEALTH_CENTER").count() >= 2
    assert seeded_db.query(User).filter(User.role == "RBC_ADMIN").count() >= 1
    assert seeded_db.query(User).filter(User.role == "SUPER_ADMIN").count() >= 1
    assert seeded_db.query(User).filter(User.role.in_(["SUPERVISOR", "RBC_OFFICER"])).count() == 0


def test_seed_deterministic_referral_ids(tmp_path):
    """Running full seed twice yields the same rich-* client_uuid set."""
    def _ids(db_file):
        configure_engine(f"sqlite:///{db_file}")
        from app import db as db_module

        Base.metadata.drop_all(bind=db_module.engine)
        init_db()
        db = SessionLocal()
        seed_module.run_seed(db, "full")
        db.commit()
        ids = sorted(r.client_uuid for r in db.query(Referral).filter(Referral.client_uuid.like("rich-%")).all())
        db.close()
        return ids

    a = _ids(tmp_path / "a.db")
    b = _ids(tmp_path / "b.db")
    assert a == b
    assert len(a) >= 60

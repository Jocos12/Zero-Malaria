"""AI data tools: RBAC scope and real aggregate counts."""

from __future__ import annotations

import sys
import uuid
from datetime import datetime, timedelta
from pathlib import Path

import pytest

API_ROOT = Path(__file__).resolve().parents[1]
if str(API_ROOT) not in sys.path:
    sys.path.insert(0, str(API_ROOT))

from app.auth import hash_password
from app.db import ActivityCount, Base, Facility, Referral, User, configure_engine, init_db
from app.roles import CHW, HEALTH_CENTER
from app.services.ai.data_tools import (
    get_my_counts,
    get_overdue_alerts,
    get_pending_referrals,
    run_data_tools,
)
from app.services.ai.local_mode import detect_intent, local_chat_answer


@pytest.fixture()
def db_session(tmp_path):
    db_file = tmp_path / "ai_tools.db"
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
    pw = hash_password("demo1234")
    chw_a = User(
        id="u-chw-a",
        username="chw.a",
        password_hash=pw,
        display_name="CHW A",
        role=CHW,
        facility_id="HC-BUG-01",
        district="Bugesera",
        chw_code="CHW-A",
        active=True,
    )
    chw_b = User(
        id="u-chw-b",
        username="chw.b",
        password_hash=pw,
        display_name="CHW B",
        role=CHW,
        facility_id="HC-BUG-01",
        district="Bugesera",
        chw_code="CHW-B",
        active=True,
    )
    hc = User(
        id="u-hc",
        username="hc.user",
        password_hash=pw,
        display_name="HC Nurse",
        role=HEALTH_CENTER,
        facility_id="HC-BUG-01",
        district="Bugesera",
        active=True,
    )
    db.add_all([chw_a, chw_b, hc])
    today = datetime.utcnow().date().isoformat()
    db.add(
        ActivityCount(
            id=str(uuid.uuid4()),
            client_uuid=f"manual-chw-a-{today}",
            chw_id="CHW-A",
            facility_id="HC-BUG-01",
            date=today,
            source="manual",
            patients_seen=4,
            patients_treated=2,
            rdt_done=3,
            rdt_positive=1,
            referred=1,
            version=1,
            created_by=chw_a.id,
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow(),
        )
    )
    old = datetime.utcnow() - timedelta(hours=30)
    db.add(
        Referral(
            id="ref-a-pending",
            client_uuid="ref-a-pending",
            chw_id="CHW-A",
            facility_id="HC-BUG-01",
            district="Bugesera",
            sector="Nyamata",
            age_months=24,
            sex="male",
            case_id="case-a",
            decision="urgent_refer",
            status="sent",
            summary="Demo pending",
            created_at=datetime.utcnow(),
        )
    )
    db.add(
        Referral(
            id="ref-b-overdue",
            client_uuid="ref-b-overdue",
            chw_id="CHW-B",
            facility_id="HC-BUG-01",
            district="Bugesera",
            sector="Nyamata",
            age_months=30,
            sex="female",
            case_id="case-b",
            decision="urgent_refer",
            status="sent",
            summary="Demo overdue",
            created_at=old,
        )
    )
    db.commit()
    yield db, chw_a, chw_b, hc
    db.close()


def test_detect_data_query_intent():
    assert detect_intent("How many referrals pending today?") == "data_query"
    assert detect_intent("How to refer transport") == "referral_steps"


def test_chw_counts_scoped_to_self(db_session):
    db, chw_a, chw_b, _hc = db_session
    out = get_my_counts(db, chw_a)
    assert out["ok"] is True
    # Manual row (4) + auto refresh from CHW-A referral (1) = 5; never includes CHW-B
    assert out["today"]["patients_seen"] == 5
    assert out["today"]["patients_treated"] >= 2

    out_b = get_my_counts(db, chw_b)
    assert out_b["ok"] is True
    assert out_b["today"]["patients_seen"] <= 1
    assert out_b["today"]["patients_seen"] != out["today"]["patients_seen"]


def test_pending_and_overdue_rbac_scope(db_session):
    db, chw_a, chw_b, hc = db_session
    pa = get_pending_referrals(db, chw_a)
    pb = get_pending_referrals(db, chw_b)
    assert pa["pending_total"] == 1
    assert pb["pending_total"] == 1

    oa = get_overdue_alerts(db, chw_a)
    ob = get_overdue_alerts(db, chw_b)
    assert oa["overdue_total"] == 0
    assert ob["overdue_total"] == 1

    hc_all = get_pending_referrals(db, hc)
    assert hc_all["pending_total"] == 2


def test_run_data_tools_requires_auth(db_session):
    db, chw_a, _, _ = db_session
    facts = run_data_tools(db, chw_a, "how many patients today")
    assert facts["ok"] is True
    assert "get_my_counts" in facts["tools"]
    assert facts["tools"]["get_my_counts"]["today"]["patients_seen"] == 5

    no_user = run_data_tools(db, None, "counts")
    assert no_user.get("auth_required") is True


def test_local_data_query_uses_facts_not_invented(db_session):
    db, chw_a, _, _ = db_session
    facts = run_data_tools(db, chw_a, "how many pending referrals")
    out = local_chat_answer(
        "how many pending referrals",
        None,
        language="en",
        data_facts=facts,
        use_case_context=False,
    )
    assert out["intent"] == "data_query"
    assert "1" in out["reply"]
    assert "Pending referrals" in out["reply"]

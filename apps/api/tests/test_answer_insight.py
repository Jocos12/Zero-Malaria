"""POST /ai/answer-insight: sanitize, no-downgrade, activity metrics."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

API_ROOT = Path(__file__).resolve().parents[1]
if str(API_ROOT) not in sys.path:
    sys.path.insert(0, str(API_ROOT))

from app.auth import hash_password
from app.db import Base, Facility, User, configure_engine, init_db
from app.main import app
from app.services.ai.activity_metrics import get_activity_snapshot, reset_activity_for_tests
from app.services.ai.answer_insight import run_answer_insight
from app.services.ai.guardrails import sanitize_case_snapshot


@pytest.fixture()
def client(tmp_path):
    reset_activity_for_tests()
    db_file = tmp_path / "answer_insight.db"
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
    db.add(
        User(
            id="u-chw",
            username="chw.demo",
            password_hash=pw,
            display_name="CHW",
            role="CHW",
            facility_id="HC-BUG-01",
            district="Bugesera",
            village="Nyamata",
            chw_code="CHW-BUG-01-01",
            active=True,
        )
    )
    db.commit()
    db.close()
    with TestClient(app) as c:
        yield c


def _token(client: TestClient) -> str:
    r = client.post("/auth/login", json={"username": "chw.demo", "password": "demo1234"})
    assert r.status_code == 200
    return r.json()["access_token"]


def test_sanitize_snapshot_strips_pii():
    snap = sanitize_case_snapshot(
        {
            "age_months": 18,
            "sex": "female",
            "name": "Jane Doe",
            "phone": "+250788123456",
            "village": "Somewhere",
            "gps": "-1.9,30.0",
            "temperature_c": 38.2,
            "fever_days": 2,
            "tdr_result": "negative",
            "convulsions": False,
            "language": "en",
        }
    )
    assert "name" not in snap
    assert "phone" not in snap
    assert "village" not in snap
    assert "gps" not in snap
    assert snap["age_band"] == "12_to_59m"
    assert snap["tdr_result"] == "negative"


def test_answer_insight_no_downgrade_and_metrics():
    reset_activity_for_tests()
    out = run_answer_insight(
        {
            "answers": {
                "age_months": 1,
                "sex": "male",
                "convulsions": True,
                "temperature_c": 36.2,
                "fever_days": 4,
                "tdr_result": "invalid",
                "rules_decision": "urgent_refer",
                "decision": "urgent_refer",
            },
            "language": "en",
        }
    )
    assert out["ok"] is True
    assert out["task"] == "answer_insight"
    data = out["data"]
    assert data["insights"]
    joined = " ".join(i["text"].lower() for i in data["insights"])
    assert "treat at home" not in joined
    assert "safe at home" not in joined
    assert any(w["id"] == "temp_vs_fever_days" for w in data["warnings"])
    snap = get_activity_snapshot()
    assert snap["by_task"].get("answer_insight", 0) >= 1


def test_answer_insight_http(client):
    reset_activity_for_tests()
    token = _token(client)
    res = client.post(
        "/ai/answer-insight",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "answers": {
                "age_months": 24,
                "sex": "female",
                "fever_days": 1,
                "tdr_result": "negative",
            },
            "language": "en",
        },
    )
    assert res.status_code == 200
    body = res.json()
    assert body["ok"] is True
    assert body["task"] == "answer_insight"
    assert "snapshot" in body["data"]
    assert "name" not in body["data"]["snapshot"]

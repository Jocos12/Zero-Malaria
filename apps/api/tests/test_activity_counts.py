"""Activity counts: RBAC, summary, idempotency, validation."""

from __future__ import annotations

import sys
from datetime import date, datetime, timedelta
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

API_ROOT = Path(__file__).resolve().parents[1]
if str(API_ROOT) not in sys.path:
    sys.path.insert(0, str(API_ROOT))

from app.auth import hash_password
from app.db import ActivityCount, Base, Facility, Referral, User, configure_engine, init_db
from app.main import app
from app.roles import CHW, HEALTH_CENTER, RBC_ADMIN


@pytest.fixture()
def client(tmp_path):
    db_file = tmp_path / "activity.db"
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
    db.add(
        Facility(
            facility_id="HC-OTHER",
            name="Other HC",
            district="Other",
            sector="X",
            pilot=0,
            remote=0,
            latitude=-2.0,
            longitude=30.0,
        )
    )
    pw = hash_password("demo1234")
    db.add_all(
        [
            User(
                id="u-chw-a",
                username="chw.a",
                password_hash=pw,
                display_name="CHW A",
                role=CHW,
                facility_id="HC-BUG-01",
                district="Bugesera",
                chw_code="CHW-A",
                active=True,
            ),
            User(
                id="u-chw-b",
                username="chw.b",
                password_hash=pw,
                display_name="CHW B",
                role=CHW,
                facility_id="HC-BUG-01",
                district="Bugesera",
                chw_code="CHW-B",
                active=True,
            ),
            User(
                id="u-hc",
                username="health.center",
                password_hash=pw,
                display_name="HC",
                role=HEALTH_CENTER,
                facility_id="HC-BUG-01",
                district="Bugesera",
                active=True,
            ),
            User(
                id="u-rbc",
                username="rbc.admin",
                password_hash=pw,
                display_name="RBC",
                role=RBC_ADMIN,
                active=True,
            ),
        ]
    )
    today = datetime.utcnow().date().isoformat()
    db.add(
        ActivityCount(
            id="manual-b-other",
            client_uuid="manual-chw-b-today",
            chw_id="CHW-B",
            facility_id="HC-BUG-01",
            date=today,
            source="manual",
            patients_seen=9,
            patients_treated=1,
            rdt_done=2,
            rdt_positive=1,
            referred=0,
            version=1,
            created_by="u-chw-b",
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow(),
        )
    )
    db.commit()
    db.close()
    with TestClient(app) as c:
        yield c


def _token(client: TestClient, username: str) -> str:
    r = client.post("/auth/login", json={"username": username, "password": "demo1234"})
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


def _headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def test_future_date_rejected(client):
    tok = _token(client, "chw.a")
    future = (datetime.utcnow().date() + timedelta(days=2)).isoformat()
    r = client.post(
        "/activity-counts",
        headers=_headers(tok),
        json={
            "client_uuid": "future-uuid",
            "date": future,
            "patients_seen": 1,
            "patients_treated": 0,
            "rdt_done": 0,
            "rdt_positive": 0,
            "referred": 0,
        },
    )
    assert r.status_code == 400
    assert r.json()["detail"] == "future_date"


def test_chw_cannot_see_other_chw_entries(client):
    tok = _token(client, "chw.a")
    r = client.get("/activity-counts", headers=_headers(tok))
    assert r.status_code == 200
    chw_ids = {row["chw_id"] for row in r.json()}
    assert chw_ids <= {"CHW-A"}


def test_hc_facility_scope(client):
    tok = _token(client, "health.center")
    r = client.get("/activity-counts", headers=_headers(tok))
    assert r.status_code == 200
    assert all(row["facility_id"] == "HC-BUG-01" for row in r.json())
    assert any(row["chw_id"] == "CHW-B" for row in r.json())


def test_idempotent_client_uuid(client):
    tok = _token(client, "chw.a")
    today = datetime.utcnow().date().isoformat()
    body = {
        "client_uuid": "idem-uuid-1",
        "date": today,
        "patients_seen": 3,
        "patients_treated": 1,
        "rdt_done": 2,
        "rdt_positive": 1,
        "referred": 0,
    }
    r1 = client.post("/activity-counts", headers=_headers(tok), json=body)
    assert r1.status_code == 200
    id1 = r1.json()["id"]
    ver = r1.json()["version"]

    body["patients_seen"] = 5
    body["version"] = ver
    r2 = client.post("/activity-counts", headers=_headers(tok), json=body)
    assert r2.status_code == 200
    assert r2.json()["id"] == id1
    assert r2.json()["patients_seen"] == 5
    assert r2.json()["version"] == ver + 1


def test_summary_no_double_count_within_source(client):
    tok = _token(client, "chw.a")
    today = datetime.utcnow().date().isoformat()
    db_module = __import__("app.db", fromlist=["SessionLocal"])
    db = db_module.SessionLocal()
    db.add(
        Referral(
            id="ref-sum-1",
            client_uuid="ref-sum-uuid",
            facility_id="HC-BUG-01",
            chw_id="CHW-A",
            district="Bugesera",
            sector="Nyamata",
            age_months=24,
            sex="female",
            decision="refer",
            status="arrived",
            created_at=datetime.utcnow(),
        )
    )
    db.add(
        ActivityCount(
            id="manual-a-today",
            client_uuid="manual-chw-a-today",
            chw_id="CHW-A",
            facility_id="HC-BUG-01",
            date=today,
            source="manual",
            patients_seen=4,
            patients_treated=2,
            rdt_done=1,
            rdt_positive=0,
            referred=1,
            version=1,
            created_by="u-chw-a",
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow(),
        )
    )
    db.commit()
    db.close()

    r = client.get("/activity-counts/summary", headers=_headers(tok), params={"period": "today"})
    assert r.status_code == 200
    data = r.json()
    assert data["auto_total"]["patients_seen"] >= 1
    assert data["manual_total"]["patients_seen"] == 4
    assert data["combined"]["patients_seen"] == data["auto_total"]["patients_seen"] + 4
    assert "auto_total" in data and "manual_total" in data

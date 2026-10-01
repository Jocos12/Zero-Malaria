"""Voice routes: 401 codes, 403 missing permission, 200/503 for CHW (never 401 when authed)."""

from __future__ import annotations

import sys
from datetime import datetime, timedelta
from pathlib import Path

import jwt
import pytest
from fastapi.testclient import TestClient

API_ROOT = Path(__file__).resolve().parents[1]
if str(API_ROOT) not in sys.path:
    sys.path.insert(0, str(API_ROOT))

from app.config import settings
from app.db import RolePermission, SessionLocal, init_db
from app.main import app
from app.migrate import seed_permissions_catalog, seed_role_permissions


@pytest.fixture(scope="module")
def client():
    init_db()
    db = SessionLocal()
    try:
        seed_permissions_catalog(db)
        seed_role_permissions(db)
        db.commit()
    finally:
        db.close()
    return TestClient(app)


def _demo_token(role: str = "CHW") -> str:
    c = TestClient(app)
    r = c.post("/auth/demo-login", json={"role": role})
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


def _expired_token() -> str:
    return jwt.encode(
        {
            "sub": "nobody",
            "type": "access",
            "exp": datetime.utcnow() - timedelta(hours=1),
            "iat": datetime.utcnow() - timedelta(hours=2),
        },
        settings.jwt_secret,
        algorithm="HS256",
    )


def test_transcribe_401_without_token(client: TestClient):
    r = client.post(
        "/voice/transcribe",
        data={"language": "rw"},
        files={"file": ("clip.webm", b"x" * 64, "audio/webm")},
    )
    assert r.status_code == 401
    detail = r.json().get("detail")
    code = detail.get("code") if isinstance(detail, dict) else None
    assert code == "token_missing"


def test_transcribe_401_expired_token(client: TestClient):
    r = client.post(
        "/voice/transcribe",
        data={"language": "rw"},
        files={"file": ("clip.webm", b"x" * 64, "audio/webm")},
        headers={"Authorization": f"Bearer {_expired_token()}"},
    )
    assert r.status_code == 401
    detail = r.json().get("detail")
    code = detail.get("code") if isinstance(detail, dict) else None
    assert code == "token_expired"


def test_transcribe_200_for_chw(client: TestClient):
    tok = _demo_token("CHW")
    r = client.post(
        "/voice/transcribe",
        data={"language": "rw"},
        files={"file": ("clip.webm", b"x" * 64, "audio/webm")},
        headers={"Authorization": f"Bearer {tok}"},
    )
    assert r.status_code in {200, 503}
    assert r.status_code != 401
    if r.status_code == 200:
        assert r.json().get("text")


def test_speak_and_capabilities_auth(client: TestClient):
    r0 = client.get("/voice/capabilities")
    assert r0.status_code == 401
    tok = _demo_token("CHW")
    r1 = client.get("/voice/capabilities", headers={"Authorization": f"Bearer {tok}"})
    assert r1.status_code == 200
    r2 = client.post(
        "/voice/speak",
        json={"text": "test", "language": "rw"},
        headers={"Authorization": f"Bearer {tok}"},
    )
    assert r2.status_code == 200


def test_403_without_voice_use(client: TestClient):
    """Strip voice:use from CHW grants temporarily → 403 not 401."""
    db = SessionLocal()
    try:
        db.query(RolePermission).filter(
            RolePermission.role_code == "CHW",
            RolePermission.permission_code == "voice:use",
        ).delete()
        db.commit()
    finally:
        db.close()

    try:
        tok = _demo_token("CHW")
        r = client.post(
            "/voice/transcribe",
            data={"language": "rw"},
            files={"file": ("clip.webm", b"x" * 64, "audio/webm")},
            headers={"Authorization": f"Bearer {tok}"},
        )
        assert r.status_code == 403
        detail = r.json().get("detail")
        assert isinstance(detail, dict)
        assert detail.get("code") == "missing_permission"
    finally:
        db = SessionLocal()
        try:
            seed_role_permissions(db)
            db.commit()
        finally:
            db.close()


def test_speak_401_token_missing(client: TestClient):
    r = client.post("/voice/speak", json={"text": "hi", "language": "rw"})
    assert r.status_code == 401
    detail = r.json().get("detail")
    assert isinstance(detail, dict)
    assert detail.get("code") == "token_missing"

from __future__ import annotations

import sys
from pathlib import Path

import pytest

API_ROOT = Path(__file__).resolve().parents[1]
if str(API_ROOT) not in sys.path:
    sys.path.insert(0, str(API_ROOT))

from app.config import settings
from app.services import pindo


class FakeResponse:
    def raise_for_status(self) -> None:
        return None

    def json(self) -> dict:
        return {
            "code": 200,
            "data": {"generated_audio_url": "media/generated/test.wav"},
            "status": "success",
        }


def test_pindo_tts_uses_bearer_token_and_normalizes_url(monkeypatch):
    monkeypatch.setattr(settings, "pindo_access_mode", "authenticated")
    monkeypatch.setattr(settings, "pindo_api_token", "secret-test-token")
    monkeypatch.setattr(settings, "pindo_api_base_url", "https://api.pindo.io")
    captured = {}

    def fake_post(url, **kwargs):
        captured["url"] = url
        captured.update(kwargs)
        return FakeResponse()

    monkeypatch.setattr(pindo.httpx, "post", fake_post)

    audio_url = pindo.synthesize_pindo_tts("Muraho neza!", 0.8)

    assert audio_url == "https://api.pindo.io/media/generated/test.wav"
    assert captured["url"] == "https://api.pindo.io/ai/tts/rw"
    assert captured["headers"]["Authorization"] == "Bearer secret-test-token"
    assert captured["json"] == {
        "text": "Muraho neza!",
        "lang": "rw",
        "speech_rate": 0.8,
    }


def test_pindo_public_mode_uses_public_endpoint_without_token(monkeypatch):
    monkeypatch.setattr(settings, "pindo_access_mode", "public")
    monkeypatch.setattr(settings, "pindo_api_token", "")
    captured = {}

    def fake_post(url, **kwargs):
        captured["url"] = url
        captured.update(kwargs)
        return FakeResponse()

    monkeypatch.setattr(pindo.httpx, "post", fake_post)
    pindo.synthesize_pindo_tts("Muraho neza!", 1.0)

    assert captured["url"] == "https://api.pindo.io/ai/tts/rw/public"
    assert "Authorization" not in captured["headers"]


@pytest.mark.parametrize("token", ["", "your-token", "   "])
def test_pindo_placeholder_is_not_configured(monkeypatch, token):
    monkeypatch.setattr(settings, "pindo_access_mode", "authenticated")
    monkeypatch.setattr(settings, "pindo_api_token", token)
    assert pindo.pindo_is_configured() is False
    with pytest.raises(pindo.PindoTtsError, match="not configured"):
        pindo.synthesize_pindo_tts("Muraho", 1.0)

"""Public or authenticated Pindo VoiceAI text-to-speech client."""

from __future__ import annotations

from urllib.parse import urljoin

import httpx

from app.config import settings


class PindoTtsError(RuntimeError):
    """Raised when Pindo TTS is unavailable or returns an invalid response."""


def pindo_is_configured() -> bool:
    if settings.pindo_access_mode == "public":
        return True
    token = settings.pindo_api_token.strip()
    return bool(token and token != "your-token")


def synthesize_pindo_tts(text: str, speech_rate: float) -> str:
    """Generate Kinyarwanda speech and return an absolute audio URL."""
    if not pindo_is_configured():
        raise PindoTtsError("Pindo TTS is not configured")

    base_url = settings.pindo_api_base_url.rstrip("/")
    public = settings.pindo_access_mode == "public"
    endpoint = f"{base_url}/ai/tts/rw/public" if public else f"{base_url}/ai/tts/rw"
    headers = {"Content-Type": "application/json"}
    if not public:
        headers["Authorization"] = f"Bearer {settings.pindo_api_token.strip()}"

    try:
        response = httpx.post(
            endpoint,
            headers=headers,
            json={"text": text, "lang": "rw", "speech_rate": speech_rate},
            timeout=settings.pindo_timeout_seconds,
        )
        response.raise_for_status()
    except httpx.HTTPError as exc:
        raise PindoTtsError("Pindo TTS request failed") from exc

    try:
        payload = response.json()
        audio_path = payload["data"]["generated_audio_url"]
    except (KeyError, TypeError, ValueError) as exc:
        raise PindoTtsError("Pindo TTS returned an invalid response") from exc

    if not isinstance(audio_path, str) or not audio_path.strip():
        raise PindoTtsError("Pindo TTS returned no audio URL")
    return urljoin(f"{base_url}/", audio_path.strip())

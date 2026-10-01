"""Pindo VoiceAI TTS for Kinyarwanda (triage question read-aloud only). Never logs the token."""

from __future__ import annotations

import logging
import os
import ssl
import time
from typing import Any

import httpx

log = logging.getLogger("zeromalaria.voice.pindo")

PINDO_TTS_URL = "https://api.pindo.io/ai/tts/rw"
PINDO_TTS_PUBLIC_URL = "https://api.pindo.io/ai/tts/rw/public"

# Short in-memory cache: digest → (url, expires_at)
_cache: dict[str, tuple[str, float]] = {}
CACHE_TTL_S = 3600.0
# Skip remote calls after billing / hard client errors (use local pack instead).
_skip_until = 0.0
_SKIP_TTL_S = 600.0
_ssl_verify: ssl.SSLContext | bool | None = None


def _verify() -> ssl.SSLContext | bool:
    """Match orchestrator TLS helpers (Windows/corporate certs)."""
    global _ssl_verify
    if _ssl_verify is not None:
        return _ssl_verify
    try:
        import certifi

        ctx = ssl.create_default_context(cafile=certifi.where())
        try:
            ctx.load_default_certs()
        except Exception:
            pass
        _ssl_verify = ctx
    except Exception:
        _ssl_verify = True
    return _ssl_verify


def pindo_token() -> str:
    return (
        os.getenv("PINDO_API_TOKEN")
        or os.getenv("ZM_PINDO_API_TOKEN")
        or ""
    ).strip()


def pindo_access_mode() -> str:
    return (
        os.getenv("PINDO_ACCESS_MODE")
        or os.getenv("ZM_PINDO_ACCESS_MODE")
        or "authenticated"
    ).strip().lower()


def pindo_configured() -> bool:
    mode = pindo_access_mode()
    if mode == "public":
        return True
    return bool(pindo_token())


def synthesize_rw(
    text: str,
    *,
    speech_rate: float = 1.0,
    cache_key: str | None = None,
    timeout: float = 12.0,
) -> dict[str, Any]:
    """Call Pindo TTS for Kinyarwanda. Returns {ok, audio_url, mode, error?}."""
    global _skip_until

    clean = (text or "").strip()
    if not clean:
        return {"ok": False, "audio_url": None, "mode": "pindo_tts", "error": "empty_text"}

    key = cache_key or clean[:80]
    hit = _cache.get(key)
    if hit and hit[1] > time.time():
        return {"ok": True, "audio_url": hit[0], "mode": "pindo_tts", "cached": True}

    if time.time() < _skip_until:
        return {"ok": False, "audio_url": None, "mode": "pindo_tts", "error": "cooling"}

    mode = pindo_access_mode()
    token = pindo_token()
    if mode != "public" and not token:
        return {"ok": False, "audio_url": None, "mode": "pindo_tts", "error": "no_token"}

    url = PINDO_TTS_PUBLIC_URL if mode == "public" else PINDO_TTS_URL
    headers = {"Content-Type": "application/json"}
    if mode != "public":
        headers["Authorization"] = f"Bearer {token}"

    body = {"text": clean[:2000], "lang": "rw", "speech_rate": float(speech_rate or 1.0)}
    try:
        # Short connect timeout so a bad network never wedges the whole API threadpool.
        to = httpx.Timeout(timeout, connect=2.0, read=timeout, write=5.0, pool=2.0)
        last_status = 0
        data: dict[str, Any] = {}
        with httpx.Client(timeout=to, verify=_verify()) as client:
            # Pindo occasionally returns 5xx; one quick retry usually recovers.
            for attempt in range(2):
                res = client.post(url, json=body, headers=headers)
                last_status = res.status_code
                if res.status_code == 200:
                    data = res.json() if res.content else {}
                    break
                snippet = (res.text or "")[:160].replace("\n", " ")
                log.warning("pindo_tts http=%s attempt=%s body=%s", res.status_code, attempt + 1, snippet)
                # Billing / auth errors: cool down so triage uses local RW pack immediately.
                if res.status_code in {401, 402, 403, 409}:
                    _skip_until = time.time() + _SKIP_TTL_S
                    return {
                        "ok": False,
                        "audio_url": None,
                        "mode": "pindo_tts",
                        "error": f"http_{res.status_code}",
                    }
                if res.status_code < 500 or attempt == 1:
                    return {
                        "ok": False,
                        "audio_url": None,
                        "mode": "pindo_tts",
                        "error": f"http_{res.status_code}",
                    }
                time.sleep(0.35)
        if last_status != 200:
            return {
                "ok": False,
                "audio_url": None,
                "mode": "pindo_tts",
                "error": f"http_{last_status}",
            }
        nested = data.get("data") if isinstance(data.get("data"), dict) else {}
        audio_url = (
            (nested or {}).get("generated_audio_url")
            or data.get("generated_audio_url")
            or data.get("audio_url")
            or data.get("url")
            or data.get("audio")
        )
        if isinstance(audio_url, dict):
            audio_url = audio_url.get("url") or audio_url.get("href")
        if not audio_url or not isinstance(audio_url, str):
            return {"ok": False, "audio_url": None, "mode": "pindo_tts", "error": "no_audio_url"}
        _cache[key] = (audio_url, time.time() + CACHE_TTL_S)
        return {"ok": True, "audio_url": audio_url, "mode": "pindo_tts", "cached": False}
    except Exception as exc:  # noqa: BLE001
        log.warning("pindo_tts failed: %s", type(exc).__name__)
        return {"ok": False, "audio_url": None, "mode": "pindo_tts", "error": "request_failed"}

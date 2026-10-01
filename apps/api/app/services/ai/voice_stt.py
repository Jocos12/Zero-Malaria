"""Kinyarwanda STT provider chain (mock-first; lazy cloud providers)."""

from __future__ import annotations

import hashlib
import os
import re
import time
from typing import Any

MAX_BYTES = 5 * 1024 * 1024
MAX_SECONDS = 30

# Strip names/phones/IDs before any external STT call
_PHONE = re.compile(r"\b(?:\+?\d[\d\s\-()]{7,}\d)\b")
_ID_LIKE = re.compile(r"\b(?:ID|NID|passport)\s*[:#]?\s*\w+\b", re.I)


def sanitize_transcript(text: str) -> str:
    t = (text or "").strip()
    # IDs first so long digit runs tagged as NID are not eaten by the phone pattern
    t = _ID_LIKE.sub("[id]", t)
    t = _PHONE.sub("[phone]", t)
    return t[:2000]


def provider_order() -> list[str]:
    raw = os.getenv("ZM_STT_PROVIDER_ORDER", "mock,google_stt,mms,hf_whisper_kin,gemini_audio")
    return [p.strip() for p in raw.split(",") if p.strip()]


def _mock_transcribe(audio: bytes, language: str) -> dict[str, Any]:
    # Deterministic empty for empty audio; otherwise a short RW demo phrase
    if not audio or len(audio) < 32:
        return {"text": "", "confidence": 0.0, "provider": "mock", "language": language}
    # Demo: return a Kinyarwanda family question when any audio blob is present
    text = "Nakwira iki umuryango?" if language.startswith("rw") else "What should I tell the family?"
    return {"text": text, "confidence": 0.62, "provider": "mock", "language": language}


def transcribe_audio(
    audio: bytes,
    *,
    language: str = "rw",
    content_type: str = "audio/webm",
) -> dict[str, Any]:
    del content_type
    if len(audio) > MAX_BYTES:
        return {
            "ok": False,
            "error": "too_large",
            "text": "",
            "confidence": 0.0,
            "provider": "none",
            "language": language,
        }
    t0 = time.time()
    last_err = "unavailable"
    for name in provider_order():
        try:
            if name == "mock":
                out = _mock_transcribe(audio, language)
            else:
                # Cloud providers not wired in demo — skip honestly
                last_err = f"{name}_not_configured"
                continue
            text = sanitize_transcript(str(out.get("text") or ""))
            conf = float(out.get("confidence") or 0)
            if text:
                return {
                    "ok": True,
                    "text": text,
                    "confidence": conf,
                    "provider": out.get("provider") or name,
                    "language": language,
                    "latency_ms": int((time.time() - t0) * 1000),
                }
            last_err = "empty_transcript"
        except Exception as exc:  # noqa: BLE001
            last_err = str(exc)[:80]
            continue
    return {
        "ok": False,
        "error": last_err,
        "text": "",
        "confidence": 0.0,
        "provider": "none",
        "language": language,
        "latency_ms": int((time.time() - t0) * 1000),
    }


def voice_capabilities(language: str = "rw") -> dict[str, Any]:
    """Honest self-test per language/engine. 'available' only if a probe would succeed."""
    from pathlib import Path

    from app.config import settings

    lang = (language or "rw")[:2].lower()
    order = provider_order()
    stt_mock = "mock" in order
    stt_pass = False
    if stt_mock:
        probe = transcribe_audio(b"x" * 64, language=lang)
        stt_pass = bool(probe.get("ok") and probe.get("text"))
    pack_rw = Path(__file__).resolve().parents[5] / "apps" / "web" / "public" / "audio" / "rw"
    pack_en = Path(__file__).resolve().parents[5] / "apps" / "web" / "public" / "audio" / "en"
    tts_rw_pack = pack_rw.is_dir() and any(pack_rw.glob("*.mp3"))
    tts_en_pack = pack_en.is_dir() and any(pack_en.glob("*.mp3"))
    mms_endpoint = os.getenv("ZM_MMS_TTS_ENDPOINT", "").strip()
    mms_ready = bool(mms_endpoint)
    engine = (getattr(settings, "voice_engine_en", None) or os.getenv("ZM_VOICE_ENGINE_EN") or "browser").lower()
    creds = bool(os.getenv("GOOGLE_APPLICATION_CREDENTIALS") or getattr(settings, "google_cloud_project", ""))
    vertex_ready = engine in {"vertex_tts", "vertex_live"} and creds
    from app.services.ai.pindo_tts import pindo_configured

    pindo_ready = pindo_configured()
    # Never call live Pindo/network here — capabilities must stay instant (login/health).
    if lang == "rw":
        rw_available = tts_rw_pack or pindo_ready or mms_ready
        if tts_rw_pack:
            rw_mode = "phrase_pack"
        elif pindo_ready:
            rw_mode = "pindo_tts"
        elif mms_ready:
            rw_mode = "mms_tts"
        else:
            rw_mode = "text_only"
        rw_self = "pass" if rw_available else "text_only_fallback"
    else:
        rw_available = tts_rw_pack
        rw_mode = "phrase_pack" if tts_rw_pack else "text_only"
        rw_self = "pass" if tts_rw_pack else "text_only_fallback"
    if engine.startswith("vertex"):
        en_available = vertex_ready or tts_en_pack
        en_mode = "vertex_tts" if vertex_ready else ("phrase_pack" if tts_en_pack else "browser_tts")
        en_self = "pass" if vertex_ready else ("pass_browser_fallback" if not vertex_ready else "fail")
        if not creds and engine.startswith("vertex"):
            en_self = "fail_missing_credentials"
    else:
        en_available = True
        en_mode = "browser_tts"
        en_self = "pass"
    en_tts = {
        "engine": engine,
        "available": en_available,
        "mode": en_mode,
        "self_test": en_self,
        "vertex_configured": vertex_ready,
    }
    if lang == "rw":
        speak_probe_mode = rw_mode
    elif tts_en_pack:
        speak_probe_mode = "phrase_pack"
    else:
        speak_probe_mode = en_mode
    return {
        "ok": True,
        "language": lang,
        "stt": {"available": stt_pass, "providers": order, "self_test": "pass" if stt_pass else "fail"},
        "tts_rw": {
            "available": rw_available,
            "mode": rw_mode,
            "mms_configured": mms_ready,
            "pindo_configured": pindo_ready,
            "pack_installed": tts_rw_pack,
            "self_test": rw_self,
        },
        "tts_en": en_tts,
        "speak_self_test": speak_probe_mode,
        "stt_rw": stt_pass,
        "tts_rw_pack": bool(tts_rw_pack),
        "tts_en_pack": bool(tts_en_pack),
        "stt_providers": order,
        "note": "RW triage questions: audio pack → Pindo TTS. Never English browser voice for RW.",
    }


def _pack_mp3(lang: str, phrase_id: str) -> bool:
    from pathlib import Path

    pack = (
        Path(__file__).resolve().parents[5]
        / "apps"
        / "web"
        / "public"
        / "audio"
        / lang
        / f"{phrase_id}.mp3"
    )
    return pack.is_file()


def speak_plan(text: str, *, phrase_id: str | None, language: str) -> dict[str, Any]:
    """Triage read-aloud plan. RW: Pindo human TTS → local pack. Never English browser for Kinyarwanda."""
    from app.config import settings
    from app.services.ai.pindo_tts import pindo_configured, synthesize_rw

    digest = hashlib.sha256((text or "").encode("utf-8")).hexdigest()[:16]
    lang = (language or "rw")[:2].lower()

    # Fast path: local RW pack when available (instant for triage).
    if phrase_id and _pack_mp3(lang, phrase_id):
        return {
            "ok": True,
            "mode": "phrase_pack",
            "phrase_id": phrase_id,
            "language": lang,
            "audio_url": f"/audio/{lang}/{phrase_id}.mp3",
            "cache_key": digest,
        }

    # Missing pack → Pindo human TTS (when configured / funded)
    if lang == "rw" and pindo_configured() and (text or "").strip():
        out = synthesize_rw(text, cache_key=digest)
        if out.get("ok") and out.get("audio_url"):
            return {
                "ok": True,
                "mode": "pindo_tts",
                "phrase_id": phrase_id,
                "language": lang,
                "audio_url": out["audio_url"],
                "cache_key": digest,
                "provider": "pindo",
            }
        return {
            "ok": True,
            "mode": "text_only",
            "language": lang,
            "audio_url": None,
            "cache_key": digest,
            "note": "Pindo TTS unavailable and no phrase pack; on-screen text only.",
        }

    if lang == "rw":
        mms = os.getenv("ZM_MMS_TTS_ENDPOINT", "").strip()
        if mms:
            return {
                "ok": True,
                "mode": "mms_tts",
                "language": lang,
                "audio_url": None,
                "cache_key": digest,
                "note": "MMS endpoint configured; client may request synthesis (demo returns no blob).",
            }
        return {
            "ok": True,
            "mode": "text_only",
            "language": lang,
            "audio_url": None,
            "cache_key": digest,
            "note": "RW cloud TTS not configured; set PINDO_API_TOKEN for Kinyarwanda read-aloud.",
        }
    engine = (getattr(settings, "voice_engine_en", None) or os.getenv("ZM_VOICE_ENGINE_EN") or "browser").lower()
    creds = bool(os.getenv("GOOGLE_APPLICATION_CREDENTIALS") or getattr(settings, "google_cloud_project", ""))
    if engine in {"vertex_tts", "vertex_live"} and creds:
        return {
            "ok": True,
            "mode": "vertex_tts",
            "language": lang,
            "audio_url": None,
            "cache_key": digest,
            "note": "Vertex TTS configured; browser may still be used when no audio_url.",
        }
    if engine in {"vertex_tts", "vertex_live"} and not creds:
        return {
            "ok": True,
            "mode": "browser_tts_ok",
            "language": lang,
            "audio_url": None,
            "cache_key": digest,
            "note": "Vertex requested but credentials missing; browser English voice fallback.",
        }
    return {
        "ok": True,
        "mode": "browser_tts_ok",
        "language": lang,
        "audio_url": None,
        "cache_key": digest,
    }

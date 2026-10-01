from __future__ import annotations

import os
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

REPO_ROOT = Path(__file__).resolve().parents[3]

try:
    from dotenv import load_dotenv

    # Load repo-root .env at import (never log values)
    load_dotenv(REPO_ROOT / ".env", override=False)
    load_dotenv(REPO_ROOT / "apps" / "api" / ".env", override=False)
except Exception:
    pass


def _env_first(*names: str, default: str = "") -> str:
    for n in names:
        v = os.getenv(n)
        if v is not None and str(v).strip() != "":
            return str(v).strip()
    return default


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="ZM_",
        env_file=str(REPO_ROOT / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_name: str = "ZeroMalaria API"
    database_url: str = f"sqlite:///{REPO_ROOT / 'apps' / 'api' / 'zeromalaria.db'}"
    cors_origins: list[str] = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:4173",
        "http://127.0.0.1:4173",
    ]
    demo_today: str = "2026-09-30"
    overdue_hours: int = 24
    llm_enabled: bool = False
    synthetic_badge: str = "Synthetic demo data"
    demo_mode: bool = True
    demo_password: str = "demo1234"
    jwt_secret: str = "zeromalaria-demo-secret-change-in-production"
    jwt_expire_hours: int = 8
    password_change_policy: str = "prompt"
    gemini_api_key: str = ""
    groq_api_key: str = ""
    gemini_model: str = "gemini-3.8-flash"
    groq_model: str = "openai/gpt-oss-20b"
    google_cloud_project: str = ""
    google_cloud_location: str = "us-central1"
    voice_engine_en: str = "browser"
    stt_provider_order: str = "mock,google_stt,mms,hf_whisper_kin,gemini_audio"
    ai_provider_order: str = "gemini,groq,local"
    ai_timeout_seconds: float = 12.0
    ai_chat_timeout_seconds: float = 8.0
    # After a recent 429, still try the provider but give up fast so Groq/Local can answer.
    ai_fail_fast_seconds: float = 2.5
    ai_provider_mode: str = "cascade"
    ai_circuit_cooldown_minutes: float = 2.0
    ai_debug: bool = False
    app_version: str = "0.2.0"


settings = Settings()

# Keys / AI config: prefer unprefixed names
settings.gemini_api_key = _env_first("GEMINI_API_KEY", "ZM_GEMINI_API_KEY", default=settings.gemini_api_key)
settings.groq_api_key = _env_first("GROQ_API_KEY", "ZM_GROQ_API_KEY", default=settings.groq_api_key)
settings.gemini_model = _env_first("GEMINI_MODEL", "ZM_GEMINI_MODEL", default=settings.gemini_model) or "gemini-3.8-flash"
settings.groq_model = _env_first("GROQ_MODEL", "ZM_GROQ_MODEL", default=settings.groq_model) or "openai/gpt-oss-20b"
settings.google_cloud_project = _env_first(
    "GOOGLE_CLOUD_PROJECT", "ZM_GOOGLE_CLOUD_PROJECT", default=settings.google_cloud_project
)
settings.ai_provider_mode = (
    _env_first("AI_PROVIDER_MODE", "ZM_AI_PROVIDER_MODE", default=settings.ai_provider_mode).lower() or "cascade"
)
settings.ai_provider_order = _env_first(
    "AI_PROVIDER_ORDER", "ZM_AI_PROVIDER_ORDER", default=settings.ai_provider_order
) or "gemini,groq,local"
cool = _env_first("AI_COOLDOWN_MINUTES", "AI_CIRCUIT_COOLDOWN_MINUTES", "ZM_AI_CIRCUIT_COOLDOWN_MINUTES")
if cool:
    try:
        settings.ai_circuit_cooldown_minutes = float(cool)
    except ValueError:
        pass
timeout = _env_first("AI_TIMEOUT_SECONDS", "ZM_AI_TIMEOUT_SECONDS")
if timeout:
    try:
        settings.ai_timeout_seconds = float(timeout)
    except ValueError:
        pass
chat_to = _env_first("AI_CHAT_TIMEOUT_SECONDS", "ZM_AI_CHAT_TIMEOUT_SECONDS")
if chat_to:
    try:
        settings.ai_chat_timeout_seconds = float(chat_to)
    except ValueError:
        pass
fail_fast = _env_first("AI_FAIL_FAST_SECONDS", "ZM_AI_FAIL_FAST_SECONDS")
if fail_fast:
    try:
        settings.ai_fail_fast_seconds = float(fail_fast)
    except ValueError:
        pass
dbg = _env_first("AI_DEBUG", "ZM_AI_DEBUG")
if dbg:
    settings.ai_debug = dbg.lower() in {"1", "true", "yes", "on"}


def reload_ai_keys_from_env() -> None:
    """Re-read .env into settings (so uvicorn --reload / late .env edits take effect). Never logs values."""
    try:
        from dotenv import load_dotenv

        load_dotenv(REPO_ROOT / ".env", override=True)
        load_dotenv(REPO_ROOT / "apps" / "api" / ".env", override=True)
    except Exception:
        pass
    settings.gemini_api_key = _env_first("GEMINI_API_KEY", "ZM_GEMINI_API_KEY", default="")
    settings.groq_api_key = _env_first("GROQ_API_KEY", "ZM_GROQ_API_KEY", default="")
    settings.gemini_model = (
        _env_first("GEMINI_MODEL", "ZM_GEMINI_MODEL", default=settings.gemini_model) or "gemini-3.8-flash"
    )
    settings.groq_model = (
        _env_first("GROQ_MODEL", "ZM_GROQ_MODEL", default=settings.groq_model) or "openai/gpt-oss-20b"
    )
    settings.ai_provider_mode = (
        _env_first("AI_PROVIDER_MODE", "ZM_AI_PROVIDER_MODE", default=settings.ai_provider_mode).lower()
        or "cascade"
    )
    timeout = _env_first("AI_TIMEOUT_SECONDS", "ZM_AI_TIMEOUT_SECONDS")
    if timeout:
        try:
            settings.ai_timeout_seconds = float(timeout)
        except ValueError:
            pass
    chat_to = _env_first("AI_CHAT_TIMEOUT_SECONDS", "ZM_AI_CHAT_TIMEOUT_SECONDS")
    if chat_to:
        try:
            settings.ai_chat_timeout_seconds = float(chat_to)
        except ValueError:
            pass
    fail_fast = _env_first("AI_FAIL_FAST_SECONDS", "ZM_AI_FAIL_FAST_SECONDS")
    if fail_fast:
        try:
            settings.ai_fail_fast_seconds = float(fail_fast)
        except ValueError:
            pass
    cool = _env_first("AI_COOLDOWN_MINUTES", "AI_CIRCUIT_COOLDOWN_MINUTES", "ZM_AI_CIRCUIT_COOLDOWN_MINUTES")
    if cool:
        try:
            settings.ai_circuit_cooldown_minutes = float(cool)
        except ValueError:
            pass

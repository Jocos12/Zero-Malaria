"""Per-provider health / circuit state (no secrets)."""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Any


@dataclass
class ProviderRuntime:
    configured: bool = False
    reachable: bool | None = None
    model: str | None = None
    quota_state: str = "ok"  # ok | cooling | exhausted
    last_error: str | None = None
    cooldown_until: float = 0.0
    last_latency_ms: int | None = None
    last_http_status: int | None = None

    def to_public(self) -> dict[str, Any]:
        cooling = time.time() < self.cooldown_until
        return {
            "configured": self.configured,
            "reachable": bool(self.reachable) if self.configured else False,
            "model": self.model,
            "quota_state": "cooling" if cooling else self.quota_state,
            "last_error": self.last_error,
            "cooldown_remaining_s": max(0, int(self.cooldown_until - time.time())) if cooling else 0,
            "last_latency_ms": self.last_latency_ms,
            "last_http_status": self.last_http_status,
        }


_state: dict[str, ProviderRuntime] = {
    "gemini": ProviderRuntime(),
    "groq": ProviderRuntime(),
    "local": ProviderRuntime(configured=True, reachable=True, quota_state="ok", model="protocol"),
}

_health_cache: dict[str, Any] = {"at": 0.0, "payload": None}
HEALTH_TTL_S = 60.0


def get_runtime(name: str) -> ProviderRuntime:
    return _state.setdefault(name, ProviderRuntime())


def mark_configured(name: str, configured: bool, model: str | None = None) -> None:
    rt = get_runtime(name)
    rt.configured = configured
    if model:
        rt.model = model
    if not configured:
        rt.reachable = False
        rt.last_error = "provider_not_configured"


def mark_success(name: str, latency_ms: int, *, http_status: int | None = 200) -> None:
    rt = get_runtime(name)
    rt.reachable = True
    rt.quota_state = "ok"
    rt.last_error = None
    rt.cooldown_until = 0.0
    rt.last_latency_ms = latency_ms
    rt.last_http_status = http_status


def mark_error(
    name: str,
    error: str,
    *,
    quota: bool = False,
    cooldown_minutes: float = 5.0,
    http_status: int | None = None,
    reachable: bool | None = False,
) -> None:
    rt = get_runtime(name)
    if reachable is not None:
        rt.reachable = reachable
    rt.last_error = error[:240]
    rt.last_http_status = http_status
    if quota:
        rt.quota_state = "cooling"
        rt.cooldown_until = time.time() + max(1.0, cooldown_minutes) * 60.0


def is_cooling(name: str) -> bool:
    return time.time() < get_runtime(name).cooldown_until


def public_health() -> dict[str, Any]:
    return {name: rt.to_public() for name, rt in _state.items()}


def get_cached_health(builder) -> dict[str, Any]:
    now = time.time()
    if _health_cache["payload"] and now - float(_health_cache["at"]) < HEALTH_TTL_S:
        return _health_cache["payload"]  # type: ignore[return-value]
    payload = builder()
    _health_cache["at"] = now
    _health_cache["payload"] = payload
    return payload


def invalidate_health_cache() -> None:
    _health_cache["at"] = 0.0
    _health_cache["payload"] = None


def humanize_http_error(status: int | None, body_snippet: str = "") -> str:
    body = (body_snippet or "").lower()
    if status == 401:
        return "401 bad key"
    if status == 403:
        if "1010" in body or "cloudflare" in body:
            return "403 blocked (network/CDN)"
        return "403 not allowed"
    if status == 404:
        if "no longer available" in body or "not found" in body or "model" in body:
            return "404 wrong model name"
        return "404 not found"
    if status == 429:
        return "429 quota"
    if status is not None and status >= 500:
        return f"{status} server error"
    if "timeout" in body or "timed out" in body:
        return "timeout"
    if "certificate" in body or "ssl" in body:
        return "ssl error"
    if "network" in body or "connect" in body:
        return "network"
    return (body_snippet or "error")[:120]

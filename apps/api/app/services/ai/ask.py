"""Ask-about-this-case — routes through cascade orchestrator."""

from __future__ import annotations

from typing import Any

from app.services.ai.orchestrator import orchestrate_chat


def answer_case_question(question: str, case: dict[str, Any], language: str = "en") -> dict[str, Any]:
    from app.services.ai.local_mode import detect_intent

    out = orchestrate_chat(
        question,
        history=[],
        case=case,
        language=language,
        task="ask",
        use_case_context=True,
    )
    text = out.get("text") or ""
    out_of_scope = detect_intent(question) == "drugs" or "not in the protocol pack" in text.lower()
    return {
        "answer": text,
        "out_of_scope": out_of_scope,
        "citations": [
            f"{s.get('file')}#{s.get('section')}" for s in (out.get("sources") or [])[:3]
        ],
        "provenance": ["Rule", "AI"] if not out.get("local_mode") else ["Rule", "Local"],
        "provider_used": out.get("provider_used"),
        "needs_native_review": (language or "").startswith("rw"),
        "rejected": bool(out.get("rejected")),
        "latency_ms": out.get("latency_ms"),
        "fallback_reason": out.get("fallback_reason"),
        "ui_reason": out.get("ui_reason"),
        "local_mode": bool(out.get("local_mode")),
        "snapshot": case,
    }

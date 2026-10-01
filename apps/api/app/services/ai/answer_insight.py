"""Per-answer AI enrichment for triage — explain/flag/escalate only."""

from __future__ import annotations

import time
from typing import Any

from app.services.ai.activity_metrics import record_ai_call
from app.services.ai.guardrails import (
    guard_agent_text,
    rejects_downgrade_or_dose,
    safe_fallback_text,
    sanitize_case_snapshot,
    scrub_injection,
)


def _local_enrichment(snapshot: dict[str, Any], language: str) -> dict[str, Any]:
    """Deterministic Layer-2-style enrichments without external LLM (always available)."""
    insights: list[dict[str, Any]] = []
    warnings: list[dict[str, Any]] = []
    danger = snapshot.get("danger_signs") or {}
    lang = (language or "en")[:8]
    locked = str(snapshot.get("rules_decision") or snapshot.get("decision") or "treat_at_home")

    age_band = snapshot.get("age_band") or "unknown"
    if age_band == "under_2m":
        text = (
            "Age band under 2 months — infant referral rule applies."
            if not lang.startswith("rw")
            else "Imyaka iri munsi ya amezi 2 — itegeko ryo kohereza."
        )
        text, rejected, _reason = guard_agent_text(text, locked, lang)
        insights.append(
            {
                "field": "age",
                "text": text,
                "source": "ai",
                "flag": "infant_refer",
                "rejected": rejected,
            }
        )

    temp = snapshot.get("temperature_c")
    fever_days = snapshot.get("fever_days")
    try:
        t = float(temp) if temp is not None else None
        d = int(fever_days) if fever_days is not None else None
    except (TypeError, ValueError):
        t, d = None, None
    if t is not None and d is not None and t < 37.5 and d >= 3:
        wtext = (
            "Please confirm: normal temperature but fever for 3+ days."
            if not lang.startswith("rw")
            else "Nyamuneka wemeze: ubushyuhe busanzwe ariko ubushyuhe bwamaze iminsi 3+."
        )
        warnings.append({"id": "temp_vs_fever_days", "text": wtext, "dismissible": True})

    if any(danger.values()):
        text = (
            "One or more danger signs reported — urgency stays locked; AI cannot downgrade."
            if not lang.startswith("rw")
            else "Hari ikimenyetso cy'akaga — ubutumwa bwihutirwa ntibuhinduka; AI ntishobora kugabanya."
        )
        if rejects_downgrade_or_dose(text, locked):
            text = safe_fallback_text(locked, lang)
            rejected = True
        else:
            text, rejected, _reason = guard_agent_text(text, locked, lang)
        insights.append(
            {
                "field": "danger",
                "text": text,
                "source": "ai",
                "flag": "danger",
                "rejected": rejected,
            }
        )

    tdr = snapshot.get("tdr_result")
    if tdr == "invalid":
        text = (
            "Invalid RDT — refer for repeat testing per protocol."
            if not lang.startswith("rw")
            else "TDR ntabwo yemewe — ohereza gusubiramo ikizamini."
        )
        text, rejected, _reason = guard_agent_text(text, locked, lang)
        insights.append(
            {"field": "tdr", "text": text, "source": "ai", "flag": "invalid_tdr", "rejected": rejected}
        )

    return {
        "insights": insights,
        "warnings": warnings,
        "label": "AI-generated, verify before use",
        "needs_native_review": lang.startswith("rw"),
        "snapshot": snapshot,
    }


def run_answer_insight(payload: dict[str, Any]) -> dict[str, Any]:
    """Fast local enrichment for triage typing (<50ms). Never blocks on cloud.

    Cloud LLM is for chat/ask/advisory — not per-keystroke Layer-2 (frontend aborts at 3s).
    """
    t0 = time.perf_counter()
    raw = dict(payload.get("answers") or payload.get("case") or payload)
    if payload.get("language"):
        raw["language"] = payload["language"]
    if isinstance(raw.get("free_text"), str):
        raw["free_text"] = scrub_injection(raw["free_text"])
    snapshot = sanitize_case_snapshot(raw)
    language = str(payload.get("language") or snapshot.get("language") or "en")
    data = _local_enrichment(snapshot, language)
    # Always add a short protocol-grounded tip so CHW always sees AI panel content
    locked = str(snapshot.get("rules_decision") or snapshot.get("decision") or "treat_at_home")
    danger = snapshot.get("danger_signs") or {}
    if any(danger.values()):
        tip = (
            "Ikimenyetso cy'akaga kijyanye n'icyemezo — AI ntishobora kugabanya ubwihutirwa."
            if language.startswith("rw")
            else "Un signe de danger confirme l’urgence — l’IA ne peut pas baisser la décision."
            if language.startswith("fr")
            else "A danger sign supports the locked decision — AI cannot lower urgency."
        )
    else:
        tip = (
            f"Amakuru yinjiye: age={snapshot.get('age_band')}, TDR={snapshot.get('tdr_result')}. Icyemezo gikurikira amategeko ({locked})."
            if language.startswith("rw")
            else f"Réponses: âge={snapshot.get('age_band')}, TDR={snapshot.get('tdr_result')}. Décision selon règles ({locked})."
            if language.startswith("fr")
            else f"Answers so far: age={snapshot.get('age_band')}, RDT={snapshot.get('tdr_result')}. Decision follows rules ({locked})."
        )
    tip, tip_rej, _ = guard_agent_text(tip, locked, language)
    data["insights"].append(
        {"field": "ai", "text": tip[:400], "source": "ai", "flag": "note", "rejected": tip_rej}
    )
    rejected = any(i.get("rejected") for i in data["insights"])
    latency = int((time.perf_counter() - t0) * 1000)
    record_ai_call(
        task="answer_insight",
        provider="local",
        latency_ms=latency,
        fallback=False,
        rejected=rejected,
    )
    return {
        "ok": True,
        "task": "answer_insight",
        "data": data,
        "provider_used": "local",
        "latency_ms": latency,
        "fallback_reason": None,
    }

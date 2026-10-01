"""AI-enriched recommendation card — wording only; decision locked by rules."""

from __future__ import annotations

import json
import re
from typing import Any

from app.services.ai.guardrails import rejection_reason, sanitize_case_snapshot
from app.services.ai.local_mode import recommendation_card
from app.services.ai.orchestrator import orchestrate_chat


def _strip_json_fence(text: str) -> str:
    raw = (text or "").strip()
    if raw.startswith("```"):
        raw = re.sub(r"^```(?:json)?\s*", "", raw, flags=re.I)
        raw = re.sub(r"\s*```$", "", raw)
    return raw.strip()


def _clean_field(text: str, locked: str) -> str | None:
    t = re.sub(r"(?i)\n*\s*AI-generated, verify with protocol\s*$", "", (text or "").strip()).strip()
    # Never show em/en dashes in CHW-facing wording
    t = re.sub(r"[\u2014\u2013\u2212]+", ". ", t)
    t = re.sub(r"\.\s*\.", ".", t)
    t = re.sub(r"\s{2,}", " ", t).strip()
    if not t or rejection_reason(t, locked):
        return None
    return t[:400]


def _clean_list(items: Any, locked: str, *, limit: int) -> list[str]:
    out: list[str] = []
    if not isinstance(items, list):
        return out
    for item in items:
        cleaned = _clean_field(str(item), locked)
        if cleaned:
            out.append(cleaned)
        if len(out) >= limit:
            break
    return out


def enhance_recommendation(
    *,
    answers: dict[str, Any],
    rules_decision: str,
    decision: str | None,
    reasons: list[str],
    triggered_rules: list[str],
    language: str,
    severe_risk: float | None = None,
    shap_factors: list[str] | None = None,
    ml_escalated: bool = False,
) -> dict[str, Any]:
    locked = rules_decision or decision or "treat_at_home"
    base = recommendation_card(
        {
            **answers,
            "rules_decision": locked,
            "decision": decision or locked,
            "reasons": reasons,
            "triggered_rules": triggered_rules,
        },
        language=language,
    )
    snap = sanitize_case_snapshot(
        {
            **answers,
            "rules_decision": locked,
            "decision": decision or locked,
            "severe_risk": severe_risk,
            "shap_factors": shap_factors or [],
            "ml_escalated": ml_escalated,
            "triggered_rules": triggered_rules,
            "language": language,
        }
    )
    risk = severe_risk
    risk_pct = f"{round(float(risk) * 100)}%" if isinstance(risk, (int, float)) else "unknown"
    factors = ", ".join(str(f) for f in (shap_factors or [])[:5]) or "none listed"

    prompt = (
        "You rewrite a malaria CHW recommendation for clarity using ALL triage answers. "
        "Return ONLY compact JSON (no markdown) with keys: "
        "why (string array, 1-2 items), what_to_do_now (string array, 3-4 steps), "
        "what_to_tell_family (string), when_to_come_back (string), "
        "ai_analysis (string, 2-4 sentences).\n"
        "ai_analysis MUST start with one clear bucket matching the locked decision: "
        "Treat/monitor locally, OR Urgent transfer, OR RDT not positive (negative/invalid) with suggestions. "
        "Then name the key answers that drove it (danger signs, fever days, RDT, age).\n"
        f"Locked decision (cannot change or lower): {locked}.\n"
        f"ML risk score: {risk_pct}; factors: {factors}; ml_escalated: {ml_escalated}.\n"
        f"Protocol baseline JSON: {json.dumps(base, ensure_ascii=False)}\n"
        f"Case snapshot: {json.dumps(snap, ensure_ascii=False)}\n"
        "Keep the same urgency. No drug names or doses. "
        f"Write in language code '{language}'. Be practical and precise for a CHW."
    )

    out = orchestrate_chat(
        prompt,
        history=[],
        case={**answers, **snap, "rules_decision": locked, "decision": decision or locked},
        language=language,
        task="recommendation",
    )
    text = _strip_json_fence(str(out.get("text") or ""))
    enhanced = dict(base)
    analysis = ""
    used_ai = False

    try:
        # Allow trailing prose after JSON object
        start = text.find("{")
        end = text.rfind("}")
        payload = json.loads(text[start : end + 1] if start >= 0 and end > start else text)
        if isinstance(payload, dict):
            # Keep what_to_do_now from the fixed protocol catalog — never overwrite with LLM steps.
            family = _clean_field(str(payload.get("what_to_tell_family") or ""), locked)
            when = _clean_field(str(payload.get("when_to_come_back") or ""), locked)
            analysis = _clean_field(str(payload.get("ai_analysis") or ""), locked) or ""
            if family:
                enhanced["what_to_tell_family"] = family
                used_ai = True
            if when:
                enhanced["when_to_come_back"] = when
                used_ai = True
            if analysis:
                used_ai = True
            # why stays rules-sourced in the UI DecisionView; ignore LLM why rewrites
    except (json.JSONDecodeError, TypeError, ValueError):
        # Soft fallback: use free-text as analysis only
        analysis = _clean_field(text, locked) or ""

    if not analysis:
        # Build a short local analysis so the strip is never empty after enhance
        title = enhanced.get("title") or locked
        tdr = str(answers.get("tdr_result") or snap.get("tdr_result") or "")
        lang = (language or "en")[:2].lower()
        if locked == "urgent_refer":
            bucket = {
                "rw": "Kohereza byihutirwa",
                "fr": "Transfert urgent",
                "en": "Urgent transfer",
            }.get(lang, "Urgent transfer")
        elif locked == "refer":
            bucket = {
                "rw": "Ohereza uyu munsi",
                "fr": "Référer aujourd'hui",
                "en": "Refer today",
            }.get(lang, "Refer today")
        elif tdr == "negative":
            bucket = {
                "rw": "TDR ntabwo yemeza malariya",
                "fr": "TDR non positif",
                "en": "RDT not positive",
            }.get(lang, "RDT not positive")
        else:
            bucket = {
                "rw": "Uvure / gukurikirana mu rugo",
                "fr": "Traiter / surveiller à domicile",
                "en": "Treat / monitor locally",
            }.get(lang, "Treat / monitor locally")
        why0 = ""
        why_list = enhanced.get("why") or []
        if isinstance(why_list, list) and why_list:
            why0 = str(why_list[0])
        if lang == "rw":
            analysis = (
                f"**{bucket}**. Icyemezo: {title}. {why0} "
                f"ML risk={risk_pct}. Kurikiza amabwiriza. AI ntishobora kugabanya ubwihutirwa."
            ).strip()
        elif lang == "fr":
            analysis = (
                f"**{bucket}**. Décision: {title}. {why0} "
                f"Risque ML={risk_pct}. Suivez le protocole. L'IA ne peut pas baisser l'urgence."
            ).strip()
        else:
            analysis = (
                f"**{bucket}**. Decision: {title}. {why0} "
                f"ML risk={risk_pct}. Follow protocol steps. AI cannot lower urgency."
            ).strip()

    enhanced["ai_enhanced"] = used_ai or bool(out.get("provider_used") and out.get("provider_used") != "local")
    enhanced["ai_analysis"] = analysis
    enhanced["label"] = "Byakozwe na AI" if language.startswith("rw") else "AI-generated"
    return {
        "card": enhanced,
        "provider_used": out.get("provider_used") or "local",
        "latency_ms": out.get("latency_ms") or 0,
        "fallback_reason": out.get("fallback_reason"),
        "local_mode": bool(out.get("local_mode")),
    }

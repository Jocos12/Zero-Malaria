"""Bounded AI-to-AI consult: Triage, Guideline, Referral agents + final CHW answer."""

from __future__ import annotations

import time
import uuid
from typing import Any, Iterator

from app.services.ai.activity_metrics import record_ai_call
from app.services.ai.guardrails import (
    guard_agent_text,
    sanitize_case_snapshot,
    scrub_injection,
)
from app.services.ai.router import (
    GeminiProvider,
    GroqProvider,
    LocalNlpProvider,
    load_protocol_excerpts,
)

MAX_ROUNDS = 2
MAX_TURNS = 6
TURN_TIMEOUT_S = 8.0
TOTAL_TIMEOUT_S = 25.0

# Preferred providers per agent (fallback chain applied in _speak)
AGENT_PROVIDER_PREF = {
    "triage": ["gemini", "groq", "local"],
    "guideline": ["groq", "gemini", "local"],
    "referral": ["gemini", "groq", "local"],
}

_SESSIONS: dict[str, dict[str, Any]] = {}


def _lang(code: str) -> str:
    c = (code or "en").lower()
    if c.startswith("rw"):
        return "rw"
    if c.startswith("fr"):
        return "fr"
    return "en"


def _provider_map() -> dict[str, Any]:
    return {
        "gemini": GeminiProvider(),
        "groq": GroqProvider(),
        "local": LocalNlpProvider(),
    }


def _local_turn(agent: str, snap: dict[str, Any], language: str) -> str:
    decision = str(snap.get("decision") or snap.get("rules_decision") or "treat_at_home")
    score = snap.get("ml_score")
    factors = ", ".join(snap.get("top_factors") or []) or "none"
    protocol = load_protocol_excerpts()
    cite = "docs/protocol/excerpts.md"
    if "infant" in protocol.lower() or snap.get("age_band") == "under_2m":
        cite = "rules/clinical_config.yaml (infant_refer_months)"

    if agent == "triage":
        if language == "rw":
            return (
                f"[Triage] Icyemezo: {decision}. ML score (demo): {score}. "
                f"Factors: {factors}. Ntabwo AI ihindura icyemezo."
            )
        if language == "fr":
            return (
                f"[Triage] Décision: {decision}. Score ML (démo): {score}. "
                f"Facteurs: {factors}. L'IA ne modifie pas la décision."
            )
        return (
            f"[Triage] Locked decision: {decision}. ML score (synthetic): {score}. "
            f"Top factors: {factors}. AI cannot change the decision."
        )
    if agent == "guideline":
        if language == "rw":
            return f"[Guideline] Amabwiriza: danger signs → urgent. Cite: {cite}."
        if language == "fr":
            return f"[Guideline] Protocole: signes de danger → urgent. Source: {cite}."
        return f"[Guideline] Protocol: danger signs require urgent referral. Cited: {cite}."
    # referral
    missing = "none flagged"
    if language == "rw":
        return (
            f"[Referral] Incamake ku muforomo: decision={decision}, age_band={snap.get('age_band')}, "
            f"RDT={snap.get('tdr_result')}, fever_days={snap.get('fever_days')}, missing={missing}."
        )
    if language == "fr":
        return (
            f"[Referral] Résumé infirmière: decision={decision}, age_band={snap.get('age_band')}, "
            f"RDT={snap.get('tdr_result')}, jours_fièvre={snap.get('fever_days')}, missing={missing}."
        )
    return (
        f"[Referral] Nurse summary: decision={decision}, age_band={snap.get('age_band')}, "
        f"RDT={snap.get('tdr_result')}, fever_days={snap.get('fever_days')}, missing={missing}."
    )


def _speak(agent: str, snap: dict[str, Any], language: str) -> tuple[str, str, int, bool]:
    """Returns text, provider, latency_ms, used_fallback — via cascade orchestrator."""
    from app.services.ai.orchestrator import orchestrate_chat

    role = {
        "triage": "As Triage Agent, explain urgency signals for this case.",
        "guideline": "As Guideline Agent, cite protocol sections that apply.",
        "referral": "As Referral Agent, say what to do for transport/handover now.",
    }.get(agent, "Explain this case briefly.")
    out = orchestrate_chat(
        role,
        history=[],
        case=snap,
        language=language,
        task="consult",
        use_case_context=True,
    )
    return (
        str(out.get("text") or _local_turn(agent, snap, language)),
        str(out.get("provider_used") or "local"),
        int(out.get("latency_ms") or 0),
        bool(out.get("fallback_reason") or out.get("local_mode")),
    )


def _final_answer(snap: dict[str, Any], language: str) -> str:
    decision = str(snap.get("decision") or snap.get("rules_decision") or "treat_at_home")
    if language == "rw":
        return (
            f"Iyi case ifite icyemezo: {decision}. "
            "Emeza ibisubizo, sobanura umuryango icyo gukora ubu. "
            "Niba ibimenyetso bibi byiyongera, ohereza vuba. "
            "Subiza isuzuma niba umwana adakira. "
            "AI-generated, verify before use."
        )
    if language == "fr":
        return (
            f"Ce cas a la décision: {decision}. "
            "Confirmez les réponses et expliquez à la famille quoi faire maintenant. "
            "Si des signes de danger apparaissent, référez d'urgence. "
            "Revenez si l'enfant ne s'améliore pas. "
            "AI-generated, verify before use."
        )
    return (
        f"This case recommendation is: {decision}. "
        "Confirm answers and tell the family what to do now. "
        "If danger signs appear, refer urgently. "
        "Come back if the child does not improve. "
        "AI-generated, verify before use."
    )


def run_consult(
    case: dict[str, Any],
    *,
    language: str = "en",
    follow_up: str | None = None,
    session_id: str | None = None,
) -> dict[str, Any]:
    """Run bounded consult (sync). Also stores session for polling."""
    lang = _lang(language)
    snap = sanitize_case_snapshot({**case, "language": lang})
    locked = str(snap.get("decision") or snap.get("rules_decision") or "treat_at_home")
    sid = session_id or str(uuid.uuid4())
    turns: list[dict[str, Any]] = []
    rejected_count = 0
    t0 = time.time()
    agents = ["triage", "guideline", "referral"]
    rounds = 1
    if follow_up:
        rounds = 1  # one extra bounded round
        scrub_injection(follow_up)

    turn_n = 0
    for _round in range(min(rounds, MAX_ROUNDS)):
        for agent in agents:
            if turn_n >= MAX_TURNS:
                break
            if time.time() - t0 > TOTAL_TIMEOUT_S:
                break
            text, provider, latency, fallback = _speak(agent, snap, lang)
            text, rejected, _reason = guard_agent_text(text, locked, lang)
            if rejected:
                rejected_count += 1
            turns.append(
                {
                    "agent": agent,
                    "role": {
                        "triage": "Triage Agent",
                        "guideline": "Guideline Agent",
                        "referral": "Referral Agent",
                    }[agent],
                    "text": text,
                    "provider": provider,
                    "latency_ms": latency,
                    "fallback": fallback,
                    "provenance": ["AI", "Rule"] if agent == "guideline" else ["AI", "ML"],
                    "rejected": rejected,
                }
            )
            record_ai_call(
                task="consult_turn",
                provider=provider,
                latency_ms=latency,
                fallback=fallback,
                rejected=rejected,
            )
            turn_n += 1
        if turn_n >= MAX_TURNS or time.time() - t0 > TOTAL_TIMEOUT_S:
            break

    final, fin_rejected, _reason = guard_agent_text(_final_answer(snap, lang), locked, lang)
    if fin_rejected:
        rejected_count += 1
    total_ms = int((time.time() - t0) * 1000)
    record_ai_call(
        task="consult",
        provider=turns[-1]["provider"] if turns else "local",
        latency_ms=total_ms,
        fallback=any(t.get("fallback") for t in turns),
        rejected=rejected_count > 0,
    )

    payload = {
        "session_id": sid,
        "final_answer": final,
        "turns": turns,
        "turn_count": len(turns),
        "max_turns": MAX_TURNS,
        "max_rounds": MAX_ROUNDS,
        "total_latency_ms": total_ms,
        "rejected_outputs": rejected_count,
        "decision_locked": locked,
        "snapshot": snap,
        "synthetic_note": "synthetic data, architecture demo only",
        "label": "AI-generated, verify before use",
        "done": True,
    }
    _SESSIONS[sid] = payload
    return payload


def get_consult_session(session_id: str) -> dict[str, Any] | None:
    return _SESSIONS.get(session_id)


def stream_consult_events(case: dict[str, Any], *, language: str = "en") -> Iterator[dict[str, Any]]:
    """Yield turn events then final (for SSE-style polling consumers)."""
    result = run_consult(case, language=language)
    for i, turn in enumerate(result["turns"]):
        yield {"type": "turn", "index": i, "turn": turn, "session_id": result["session_id"]}
    yield {
        "type": "final",
        "final_answer": result["final_answer"],
        "session_id": result["session_id"],
        "done": True,
    }

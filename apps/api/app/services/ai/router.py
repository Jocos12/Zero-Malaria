"""Multi-provider AI layer with ordered fallback. Never decides urgency or doses."""

from __future__ import annotations

import json
import re
import time
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from pydantic import BaseModel, Field, ValidationError

from app.config import settings
from app.nlp import extract_symptoms_mock
from app.services.ai.sanitize import sanitize_for_ai

REPO_ROOT = Path(__file__).resolve().parents[5]
PROTOCOL_EXCERPTS_PATH = REPO_ROOT / "docs" / "protocol" / "excerpts.md"

# Internal urgency rank (higher = more urgent). Public labels map similarly.
DECISION_URGENCY = {
    "treat_at_home": 0,
    "treat_locally": 0,
    "refer": 1,
    "monitor": 1,
    "urgent_refer": 2,
    "urgent_referral": 2,
}

# Matches clinical prescribing language in *user or model content* (not our refusal replies).
DRUG_PATTERN = re.compile(
    r"\b(artemether|lumefantrine|artesunate|quinine|coartem|asaq|mg/kg|tablets?|capsules?)\b",
    re.I,
)
DOSE_REQUEST = re.compile(r"\b(dose|dosage|prescribe|how many tablets)\b", re.I)


class ExtractResult(BaseModel):
    suggested_fields: dict[str, Any] = Field(default_factory=dict)
    matched_signs: list[str] = Field(default_factory=list)
    note: str = "Layer 3 NLP only. Does not choose the decision."
    needs_native_review: bool = False


class ExplainResult(BaseModel):
    explanation: str
    language: str = "en"
    needs_native_review: bool = False


class SummaryResult(BaseModel):
    summary: str
    needs_native_review: bool = False


class InsightResult(BaseModel):
    insight: str
    signal_level: str = "none"
    needs_native_review: bool = False


class ChatResult(BaseModel):
    reply: str
    open_triage: bool = False
    out_of_scope: bool = False
    needs_native_review: bool = False


class AdvisoryResult(BaseModel):
    """Strict advisory JSON. Never replaces the rules decision."""

    explanation_rw: str
    explanation_en: str
    inconsistencies: list[str] = Field(default_factory=list)
    caregiver_advice_rw: str
    handover_summary: str
    suggested_escalation: bool = False
    citations: list[str] = Field(default_factory=list)
    needs_native_review: bool = True
    # Echo of locked rules decision (AI cannot change this).
    rules_decision_locked: str = ""


class AIResponse(BaseModel):
    ok: bool = True
    task: str
    data: dict[str, Any]
    provider_used: str
    latency_ms: int
    fallback_reason: str | None = None


@dataclass
class CircuitState:
    failures: int = 0
    open_until: float = 0.0


class AIProvider(ABC):
    name: str = "base"

    @abstractmethod
    def complete(self, task: str, payload: dict[str, Any]) -> dict[str, Any]:
        ...


def load_protocol_excerpts() -> str:
    if PROTOCOL_EXCERPTS_PATH.exists():
        return PROTOCOL_EXCERPTS_PATH.read_text(encoding="utf-8")
    return ""


def apply_escalate_only_guardrail(
    rules_decision: str, advisory: dict[str, Any]
) -> dict[str, Any]:
    """Code guardrail: AI may only escalate urgency; never downgrade or override rules."""
    out = dict(advisory)
    out["rules_decision_locked"] = rules_decision
    # suggested_escalation may be true only if rules is not already max urgency
    rank = DECISION_URGENCY.get(rules_decision, 0)
    if rank >= 2:
        out["suggested_escalation"] = False
    else:
        out["suggested_escalation"] = bool(out.get("suggested_escalation"))
    # Strip any attempt to set a final decision field
    out.pop("decision", None)
    out.pop("final_decision", None)
    out.pop("override_decision", None)
    return out


def _local_advisory(payload: dict[str, Any]) -> dict[str, Any]:
    rules_decision = str(
        payload.get("rules_decision") or payload.get("decision") or "treat_at_home"
    )
    reasons = payload.get("reasons") or []
    triggered = payload.get("triggered_rules") or []
    missing = payload.get("missing_info") or []
    protocol_ref = str(payload.get("protocol_reference") or "")
    answers = payload.get("answers") or {}
    excerpts = str(payload.get("protocol_excerpts") or load_protocol_excerpts())

    citations: list[str] = []
    if "DS-01" in excerpts or any(
        t in triggered
        for t in (
            "convulsions",
            "unable_to_drink",
            "vomiting_everything",
            "lethargy",
            "severe_breathing_difficulty",
        )
    ):
        citations.append("DS-01")
    if "infant_age_referral" in triggered:
        citations.append("YI-01")
    if "persistent_fever_negative_tdr" in triggered:
        citations.append("FE-01")
    if "invalid_tdr_refer" in triggered:
        citations.append("TDR-01")
    if protocol_ref:
        citations.append(protocol_ref)
    if not citations:
        citations.append("GEN-01")

    inconsistencies: list[str] = []
    if missing:
        inconsistencies.append(f"Unanswered fields: {', '.join(missing)}")
    if answers.get("tdr_result") == "positive" and answers.get("fever_days") == 0:
        inconsistencies.append("TDR positive with fever_days=0 — verify history.")
    if answers.get("temperature_c") is not None:
        try:
            temp = float(answers["temperature_c"])
            if temp < 35 or temp > 42:
                inconsistencies.append("Temperature outside usual measurement range — recheck.")
        except (TypeError, ValueError):
            pass

    reason_line = "; ".join(str(r) for r in reasons[:4]) if reasons else "No danger-sign rule fired."
    explanation_en = (
        f"Rules recommendation is {rules_decision.replace('_', ' ')}. {reason_line} "
        "Confirm every answer. AI does not decide."
    )
    explanation_rw = (
        f"Inama ya amategeko ni {rules_decision}. {reason_line} "
        "Emeza ibisubizo byose. AI ntiyemeza icyemezo. "
        "[needs review]"
    )
    caregiver_advice_rw = (
        "Komeza gukurikirana umurwayi. Niba ibimenyetso bibi byiyongera, "
        "jya ku kigo nderabuzima vuba. [needs review]"
    )
    handover_summary = (
        f"Pre-arrival: rules={rules_decision}; triggers={','.join(triggered[:6]) or 'none'}; "
        f"reasons={reason_line}; citations={','.join(citations)}"
    )
    # Local heuristic: suggest escalation only when assessment incomplete (never downgrade).
    suggested = bool(missing) and DECISION_URGENCY.get(rules_decision, 0) < 2

    raw = AdvisoryResult(
        explanation_rw=explanation_rw,
        explanation_en=explanation_en,
        inconsistencies=inconsistencies,
        caregiver_advice_rw=caregiver_advice_rw,
        handover_summary=handover_summary,
        suggested_escalation=suggested,
        citations=citations,
        needs_native_review=True,
        rules_decision_locked=rules_decision,
    ).model_dump()
    return apply_escalate_only_guardrail(rules_decision, raw)


class LocalNlpProvider(AIProvider):
    name = "local"

    def complete(self, task: str, payload: dict[str, Any]) -> dict[str, Any]:
        lang = str(payload.get("language") or "en")
        if task == "advisory":
            return _local_advisory(payload)
        if task == "extract":
            text = str(payload.get("free_text") or "")
            raw = extract_symptoms_mock(text, lang)
            return ExtractResult(
                suggested_fields=raw.get("suggested_fields") or {},
                matched_signs=raw.get("matched_signs") or [],
                note=raw.get("note") or "",
                needs_native_review=lang.startswith("rw"),
            ).model_dump()
        if task == "explain":
            reasons = payload.get("reasons") or []
            decision = payload.get("decision") or "treat_at_home"
            lines = "; ".join(reasons[:5]) if reasons else "No danger-sign rule fired."
            text = (
                f"The recommendation is {decision.replace('_', ' ')}. {lines} "
                "Please confirm. This is decision support, not a diagnosis."
            )
            if lang.startswith("rw"):
                text = (
                    f"Inama ni {decision}. {lines} Emeza icyemezo. "
                    "Igikoresho cy'ubufasha, ntabwo gisimbura umuganga."
                )
            return ExplainResult(
                explanation=text, language=lang, needs_native_review=lang.startswith("rw")
            ).model_dump()
        if task == "summary":
            seed = str(payload.get("summary_seed") or "")
            decision = str(payload.get("decision") or "treat_at_home")
            if lang.startswith("rw"):
                summary = (
                    f"Incamake y'isura: icyemezo={decision}. {seed} "
                    "AI-generated, verify before use. [needs review]"
                )
            elif lang.startswith("fr"):
                summary = (
                    f"Résumé de visite: décision={decision}. {seed} "
                    "AI-generated, verify before use."
                )
            else:
                summary = (
                    f"Visit summary: decision={decision}. {seed} "
                    "AI-generated, verify before use."
                )
            return SummaryResult(
                summary=summary or "Visit summary unavailable offline.",
                needs_native_review=lang.startswith("rw"),
            ).model_dump()
        if task == "insights":
            stats = payload.get("aggregated_stats") or {}
            pct = stats.get("percent_change")
            level = stats.get("signal_level") or "none"
            if level == "none":
                insight = "No statistical increase signal in the selected period (synthetic demo data)."
            else:
                insight = (
                    f"Potential increase detected (statistical signal): {pct}% vs baseline "
                    f"in {stats.get('location', 'selected area')}. Recommended: verify with facility records."
                )
            return InsightResult(
                insight=insight, signal_level=level, needs_native_review=False
            ).model_dump()
        if task == "chat":
            msg = str(payload.get("message") or "").lower()
            danger = any(
                w in msg
                for w in ["convuls", "gusetsa", "unable to drink", "ntashobora kunywa", "unconscious", "letharg"]
            )
            if DRUG_PATTERN.search(msg) or DOSE_REQUEST.search(msg) or "give medicine" in msg:
                return ChatResult(
                    reply="I can't name medicines or give amounts. Please ask the health center nurse.",
                    out_of_scope=True,
                ).model_dump()
            if danger:
                return ChatResult(
                    reply="Those signs may need urgent referral. Open triage and confirm danger signs. I cannot decide alone.",
                    open_triage=True,
                ).model_dump()
            if any(w in msg for w in ["weather", "football", "politics", "joke"]):
                reply = (
                    "Sinshobora gusubiza icyo. Baza umuforomo ku kigo nderabuzima."
                    if lang.startswith("rw")
                    else "I can't answer that. Please ask the health center nurse."
                )
                return ChatResult(
                    reply=reply, out_of_scope=True, needs_native_review=lang.startswith("rw")
                ).model_dump()
            return ChatResult(
                reply="I can help explain triage steps. Use the guided form. Confirm every answer yourself.",
            ).model_dump()
        raise ValueError(f"Unknown task {task}")


class MockProvider(AIProvider):
    """Test double: can simulate quota/timeout/invalid JSON."""

    name = "mock"

    def __init__(self, mode: str = "ok") -> None:
        self.mode = mode

    def complete(self, task: str, payload: dict[str, Any]) -> dict[str, Any]:
        if self.mode == "timeout":
            raise TimeoutError("mock timeout")
        if self.mode == "quota":
            raise RuntimeError("429 quota exceeded")
        if self.mode == "invalid":
            return {"not": "valid schema", "dosage": "2 tablets artesunate"}
        return LocalNlpProvider().complete(task, payload)


class GeminiProvider(AIProvider):
    name = "gemini"

    def complete(self, task: str, payload: dict[str, Any]) -> dict[str, Any]:
        if not settings.gemini_api_key:
            raise RuntimeError("GEMINI_API_KEY not configured")
        from app.services.ai.orchestrator import call_gemini_chat, build_system_prompt
        from app.services.ai.protocol_retrieve import retrieve_protocol
        from app.services.ai.guardrails import sanitize_case_snapshot

        q = str(payload.get("question") or payload.get("summary_seed") or payload.get("free_text") or task)
        snap = sanitize_case_snapshot(payload)
        decision = str(snap.get("rules_decision") or payload.get("decision") or "treat_at_home")
        excerpts = retrieve_protocol(q, limit=4)
        system = build_system_prompt(decision, snap, excerpts, str(payload.get("language") or "en"))
        text, _status = call_gemini_chat(system, [{"role": "user", "content": q[:2000]}])
        return {"text": text, "summary": text, "explanation_en": text, "explanation_rw": text}


class GroqProvider(AIProvider):
    name = "groq"

    def complete(self, task: str, payload: dict[str, Any]) -> dict[str, Any]:
        if not settings.groq_api_key:
            raise RuntimeError("GROQ_API_KEY not configured")
        from app.services.ai.orchestrator import call_groq_chat, build_system_prompt
        from app.services.ai.protocol_retrieve import retrieve_protocol
        from app.services.ai.guardrails import sanitize_case_snapshot

        q = str(payload.get("question") or payload.get("summary_seed") or payload.get("free_text") or task)
        snap = sanitize_case_snapshot(payload)
        decision = str(snap.get("rules_decision") or payload.get("decision") or "treat_at_home")
        excerpts = retrieve_protocol(q, limit=4)
        system = build_system_prompt(decision, snap, excerpts, str(payload.get("language") or "en"))
        text, _status = call_groq_chat(system, [{"role": "user", "content": q[:2000]}])
        return {"text": text, "summary": text, "explanation_en": text, "explanation_rw": text}


class VertexProvider(AIProvider):
    name = "vertex"

    def complete(self, task: str, payload: dict[str, Any]) -> dict[str, Any]:
        if not settings.google_cloud_project:
            raise RuntimeError("Vertex disabled")
        raise RuntimeError("Vertex live call not configured")


TASK_MODELS = {
    "extract": ExtractResult,
    "explain": ExplainResult,
    "summary": SummaryResult,
    "insights": InsightResult,
    "chat": ChatResult,
    "advisory": AdvisoryResult,
}


class AIRouter:
    def __init__(self, providers: list[AIProvider] | None = None) -> None:
        self.circuits: dict[str, CircuitState] = {}
        if providers is not None:
            self.providers = providers
        else:
            order = [p.strip() for p in settings.ai_provider_order.split(",") if p.strip()]
            registry = {
                "gemini": GeminiProvider(),
                "groq": GroqProvider(),
                "vertex": VertexProvider(),
                "local": LocalNlpProvider(),
                "mock": MockProvider(),
            }
            self.providers = [registry[n] for n in order if n in registry]
            if not any(p.name == "local" for p in self.providers):
                self.providers.append(LocalNlpProvider())

    def _circuit_open(self, name: str) -> bool:
        state = self.circuits.get(name) or CircuitState()
        return time.time() < state.open_until

    def _fail(self, name: str) -> None:
        state = self.circuits.setdefault(name, CircuitState())
        state.failures += 1
        if state.failures >= 2:
            state.open_until = time.time() + 60

    def _ok(self, name: str) -> None:
        self.circuits[name] = CircuitState()

    def _validate(self, task: str, data: dict[str, Any]) -> dict[str, Any]:
        model = TASK_MODELS[task]
        parsed = model.model_validate(data)
        dumped = parsed.model_dump()
        blob = json.dumps(dumped)
        # Reject model inventing drug names; allow our own out-of-scope refusals.
        if dumped.get("out_of_scope"):
            return dumped
        if DRUG_PATTERN.search(blob) or re.search(r"\b\d+\s*mg\b", blob, re.I):
            raise ValueError("Provider output contained drug/dose language")
        if task == "advisory":
            rules_decision = str(dumped.get("rules_decision_locked") or "")
            dumped = apply_escalate_only_guardrail(rules_decision or "treat_at_home", dumped)
        return dumped

    def run(self, task: str, payload: dict[str, Any]) -> AIResponse:
        safe = sanitize_for_ai(payload)
        reasons: list[str] = []
        last_error = "none"
        for provider in self.providers:
            if provider.name != "local" and self._circuit_open(provider.name):
                reasons.append(f"{provider.name}:circuit_open")
                continue
            start = time.time()
            try:
                # Soft timeout simulation via settings (real HTTP would use httpx timeout)
                data = provider.complete(task, safe)
                validated = self._validate(task, data)
                latency = int((time.time() - start) * 1000)
                if latency > settings.ai_timeout_seconds * 1000 and provider.name != "local":
                    raise TimeoutError("exceeded AI_TIMEOUT_SECONDS")
                self._ok(provider.name)
                return AIResponse(
                    task=task,
                    data=validated,
                    provider_used=provider.name,
                    latency_ms=latency,
                    fallback_reason="; ".join(reasons) if reasons else None,
                )
            except (TimeoutError, RuntimeError, ValidationError, ValueError) as exc:
                last_error = str(exc)
                reasons.append(f"{provider.name}:{last_error}")
                if provider.name != "local":
                    self._fail(provider.name)
                continue
        # Absolute last resort
        local = LocalNlpProvider()
        data = self._validate(task, local.complete(task, safe))
        return AIResponse(
            task=task,
            data=data,
            provider_used="local",
            latency_ms=0,
            fallback_reason="; ".join(reasons) or last_error,
        )


_router: AIRouter | None = None


def get_ai_router() -> AIRouter:
    global _router
    if _router is None:
        _router = AIRouter()
    return _router

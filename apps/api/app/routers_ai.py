"""AI and voice HTTP routes."""

from __future__ import annotations

import json
import time
from typing import Annotated, Any, Generator, Optional

from fastapi import APIRouter, Depends, File, Form, UploadFile
from fastapi.responses import StreamingResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.auth import decode_token, get_current_user, require_permission, write_audit
from app.config import settings
from app.db import User, get_db
from app.services.ai.router import get_ai_router

router = APIRouter(tags=["ai"])
_bearer_opt = HTTPBearer(auto_error=False)


def optional_ai_user(
    creds: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer_opt)],
    db: Session = Depends(get_db),
) -> User | None:
    """Auth optional in demo mode so /m triage Layer-2 works without forcing login redirect."""
    if creds is None or not creds.credentials:
        if settings.demo_mode:
            return None
        return None
    try:
        data = decode_token(creds.credentials)
        return db.query(User).filter(User.id == data.get("sub")).first()
    except Exception:
        return None


def _audit_ai(db: Session, user: User | None, detail: str) -> None:
    if not user:
        return
    write_audit(
        db,
        action="ai_used",
        actor_id=user.id,
        actor_username=user.username,
        resource_type="ai",
        detail=detail,
    )


class ExtractBody(BaseModel):
    free_text: str
    language: str = "en"
    age_months: Optional[int] = None
    sex: Optional[str] = None
    temperature_c: Optional[float] = None
    fever_days: Optional[int] = None
    tdr_result: Optional[str] = None


class ExplainBody(BaseModel):
    decision: str
    reasons: list[str] = Field(default_factory=list)
    triggered_rules: list[str] = Field(default_factory=list)
    language: str = "en"


class InsightsBody(BaseModel):
    aggregated_stats: dict[str, Any]
    language: str = "en"


class ChatBody(BaseModel):
    message: str
    language: str = "en"
    decision: Optional[str] = None


class SpeakBody(BaseModel):
    phrase_id: str | None = None
    language: str = "rw"
    text: str = ""


class AdvisoryBody(BaseModel):
    answers: dict[str, Any] = Field(default_factory=dict)
    rules_decision: str
    public_decision: str | None = None
    reasons: list[str] = Field(default_factory=list)
    triggered_rules: list[str] = Field(default_factory=list)
    reason_details: list[dict[str, Any]] = Field(default_factory=list)
    missing_info: list[str] = Field(default_factory=list)
    protocol_reference: str = ""
    language: str = "rw"


class AdvisoryFeedbackBody(BaseModel):
    rules_decision: str
    chw_followed: bool
    suggested_escalation: bool = False


@router.get("/ai/health")
def ai_health() -> dict:
    """Per-provider status — no secrets. Cached ~60s."""
    from app.services.ai.orchestrator import health_payload

    return health_payload(force=False)


@router.get("/ai/status")
def ai_status(live: bool = False) -> dict:
    """Provider readiness for the UI.

    Default: instant (in-memory flags only — no outbound cloud calls).
    Pass ?live=1 for short fail-fast pings (Gemini/Groq ~2.5s max each).
    """
    from app.config import settings
    from app.services.ai.orchestrator import ping_provider, refresh_configured_flags
    from app.services.ai.provider_status import public_health

    refresh_configured_flags()
    chat_to = float(getattr(settings, "ai_chat_timeout_seconds", 8) or 8)

    if not live:
        runtime = public_health()
        providers: dict[str, dict] = {}
        for name in ("gemini", "groq", "local"):
            rt = runtime.get(name) or {}
            configured = True if name == "local" else bool(rt.get("configured"))
            quota = str(rt.get("quota_state") or "ok")
            if name == "local":
                status, reason = "ok", "PASS local protocol"
            elif not configured:
                status, reason = "no_key", "FAIL key missing"
            elif quota in {"cooling", "exhausted"}:
                status, reason = "rate_limited", str(rt.get("last_error") or "cooling")[:160]
            elif rt.get("reachable"):
                status, reason = "ok", "PASS"
            else:
                # Key present but not pinged yet — treat as ready so chat can try cascade.
                status, reason = ("ok", "ready") if configured else ("error", str(rt.get("last_error") or "unknown")[:160])
            providers[name] = {
                "provider": name,
                "status": status,
                "latency_ms": rt.get("last_latency_ms") or 0,
                "reason": reason,
                "model": rt.get("model"),
            }
        return {
            "ok": True,
            "providers": providers,
            "mode": settings.ai_provider_mode,
            "chat_timeout_seconds": chat_to,
            "live": False,
        }

    fail_fast = float(getattr(settings, "ai_fail_fast_seconds", 2.5) or 2.5)
    providers = {}
    for name in ("gemini", "groq", "local"):
        r = ping_provider(name, timeout=fail_fast)
        reason = str(r.get("reason") or "")
        if not r.get("configured") and name != "local":
            status = "no_key"
        elif r.get("pass"):
            status = "ok"
        elif "429" in reason or "quota" in reason.lower() or "cooling" in reason.lower():
            status = "rate_limited"
        elif "timeout" in reason.lower():
            status = "timeout"
        else:
            status = "error"
        providers[name] = {
            "provider": name,
            "status": status,
            "latency_ms": r.get("latency_ms"),
            "reason": reason[:160],
            "model": r.get("model"),
        }
    return {
        "ok": True,
        "providers": providers,
        "mode": settings.ai_provider_mode,
        "chat_timeout_seconds": chat_to,
        "live": True,
    }


@router.post("/ai/health/test")
def ai_health_test(
    user: Annotated[User | None, Depends(optional_ai_user)] = None,
    db: Session = Depends(get_db),
) -> dict:
    """Force fresh provider pings (never returns key values)."""
    from app.services.ai.orchestrator import health_payload

    out = health_payload(force=True)
    _audit_ai(db, user, "ai_health_test")
    return out


@router.post("/ai/advisory")
def ai_advisory(
    body: AdvisoryBody,
    user: Annotated[User | None, Depends(optional_ai_user)],
    db: Session = Depends(get_db),
) -> dict:
    """Advisory-only layer via cascade orchestrator. Rules decision stays authoritative."""
    from app.services.ai.orchestrator import orchestrate_chat

    try:
        q = (
            "In 3 short sentences, explain why this triage decision applies for the CHW, "
            "what to tell the caregiver, and what not to invent (no doses)."
        )
        case = {
            **(body.answers or {}),
            "rules_decision": body.rules_decision,
            "decision": body.rules_decision,
            "reasons": body.reasons,
            "triggered_rules": body.triggered_rules,
        }
        out = orchestrate_chat(
            q,
            history=[],
            case=case,
            language=body.language,
            task="advisory",
            use_case_context=True,
        )
        text = out.get("text") or ""
        _audit_ai(db, user, f"advisory via {out.get('provider_used')}")
        return {
            "ok": True,
            "task": "advisory",
            "data": {
                "explanation_en": text,
                "explanation_rw": text,
                "caregiver_advice_rw": text,
                "handover_summary": text[:400],
                "inconsistencies": [],
                "suggested_escalation": False,
                "citations": [f"{s.get('file')}#{s.get('section')}" for s in (out.get("sources") or [])[:3]],
                "needs_native_review": body.language.startswith("rw"),
                "rules_decision_locked": body.rules_decision,
            },
            "provider_used": out.get("provider_used"),
            "latency_ms": out.get("latency_ms"),
            "fallback_reason": out.get("fallback_reason"),
            "ui_reason": out.get("ui_reason"),
        }
    except Exception:
        return {
            "ok": False,
            "task": "advisory",
            "data": {},
            "provider_used": "none",
            "latency_ms": 0,
            "fallback_reason": "advisory_unavailable",
        }


@router.post("/ai/advisory-feedback")
def ai_advisory_feedback(
    body: AdvisoryFeedbackBody,
    user: Annotated[User, Depends(get_current_user)],
    db: Session = Depends(get_db),
) -> dict:
    write_audit(
        db,
        action="ai_advisory_feedback",
        actor_id=user.id,
        actor_username=user.username,
        resource_type="ai",
        detail=(
            f"chw_followed={body.chw_followed}; rules={body.rules_decision}; "
            f"suggested_escalation={body.suggested_escalation}"
        ),
    )
    return {"ok": True}


@router.post("/ai/extract-symptoms")
def ai_extract(
    body: ExtractBody,
    user: Annotated[User, Depends(get_current_user)],
    db: Session = Depends(get_db),
) -> dict:
    result = get_ai_router().run("extract", body.model_dump())
    write_audit(
        db,
        action="ai_used",
        actor_id=user.id,
        actor_username=user.username,
        resource_type="ai",
        detail=f"extract via {result.provider_used}",
    )
    return result.model_dump()


@router.post("/ai/explain")
def ai_explain(
    body: ExplainBody,
    user: Annotated[User, Depends(get_current_user)],
    db: Session = Depends(get_db),
) -> dict:
    result = get_ai_router().run("explain", body.model_dump())
    write_audit(
        db,
        action="ai_used",
        actor_id=user.id,
        actor_username=user.username,
        detail=f"explain via {result.provider_used}",
    )
    return result.model_dump()


class VisitSummaryBody(BaseModel):
    answers: dict[str, Any] = Field(default_factory=dict)
    decision: str = "treat_at_home"
    rules_decision: str | None = None
    reasons: list[str] = Field(default_factory=list)
    triggered_rules: list[str] = Field(default_factory=list)
    shap_factors: list[str] = Field(default_factory=list)
    severe_risk: float | None = None
    ml_escalated: bool = False
    language: str = "en"


class AskBody(BaseModel):
    question: str
    case: dict[str, Any] = Field(default_factory=dict)
    language: str = "en"


class ConsultBody(BaseModel):
    case: dict[str, Any] = Field(default_factory=dict)
    language: str = "en"
    follow_up: str | None = None
    session_id: str | None = None


class AnswerInsightBody(BaseModel):
    answers: dict[str, Any] = Field(default_factory=dict)
    language: str = "en"


class AiTraceBody(BaseModel):
    answers: dict[str, Any] = Field(default_factory=dict)
    result: dict[str, Any] = Field(default_factory=dict)
    language: str = "rw"
    ai_texts: list[str] = Field(default_factory=list)
    provider_used: str = "local"
    latency_ms: int = 0
    fallback_reason: str | None = None
    simulate_unsafe: bool = False


class AiCompareBody(BaseModel):
    answers: dict[str, Any] = Field(default_factory=dict)
    result: dict[str, Any] = Field(default_factory=dict)
    language: str = "rw"


@router.post("/ai/trace")
def ai_trace_endpoint(
    body: AiTraceBody,
    user: Annotated[User | None, Depends(optional_ai_user)] = None,
) -> dict:
    """Structured ai_trace for Result UI (rules locked; ML escalate-only; AI language only)."""
    from app.services.ai.ai_trace import apply_ai_guardrail, build_ai_trace

    texts = list(body.ai_texts)
    lang = body.language or "rw"
    if body.simulate_unsafe:
        texts.append("The patient is fine, no referral, safe at home. Give paracetamol 500mg.")
    locked = str(body.result.get("rules_decision") or body.result.get("decision") or "treat_at_home")
    _kept, preview_guard = apply_ai_guardrail(texts, locked, language=lang)
    trace = build_ai_trace(
        body.answers,
        body.result,
        language=lang,
        ai_texts=texts,
        provider_used=body.provider_used,
        latency_ms=body.latency_ms,
        fallback_reason=body.fallback_reason,
    )
    if body.simulate_unsafe:
        trace["guardrail"] = preview_guard
        trace["demo_safety_lock"] = True
    return {"ok": True, "task": "ai_trace", "data": trace}


@router.post("/ai/compare")
def ai_compare_endpoint(
    body: AiCompareBody,
    user: Annotated[User | None, Depends(optional_ai_user)] = None,
    db: Session = Depends(get_db),
) -> dict:
    """Compare Gemini | Groq | Local on the same explanation prompt."""
    from app.services.ai.ai_trace import compare_providers

    out = compare_providers(body.answers, body.result, language=body.language or "rw")
    _audit_ai(db, user, "ai compare")
    return out


@router.post("/ai/answer-insight")
def ai_answer_insight(
    body: AnswerInsightBody,
    user: Annotated[User | None, Depends(optional_ai_user)],
    db: Session = Depends(get_db),
) -> dict:
    """Per-answer enrichment. Sanitize → explain/flag only; never downgrade."""
    from app.services.ai.answer_insight import run_answer_insight

    result = run_answer_insight({"answers": body.answers, "language": body.language})
    _audit_ai(db, user, f"answer_insight via {result.get('provider_used')}")
    return result


class ChatTurn(BaseModel):
    role: str
    content: str


class AiChatBody(BaseModel):
    message: str
    language: str = "en"
    history: list[ChatTurn] = Field(default_factory=list)
    case: dict[str, Any] | None = None
    use_case_context: bool = True
    page_context: str = "general"
    page_id: str | None = None
    mode: str | None = None
    stream: bool = True


@router.post("/ai/chat")
def ai_chat(
    body: AiChatBody,
    user: Annotated[User | None, Depends(optional_ai_user)],
    db: Session = Depends(get_db),
):
    """Multi-turn CHW assistant via cascade orchestrator. SSE pseudo-stream."""
    from app.services.ai.orchestrator import orchestrate_chat

    hist = [{"role": t.role, "content": t.content} for t in body.history]

    def run_once() -> dict:
        page_ctx = (body.page_context or "general").strip().lower()
        if page_ctx not in {"case", "page", "general"}:
            page_ctx = "general"
        result = orchestrate_chat(
            body.message,
            history=hist,
            case=body.case if body.use_case_context else None,
            language=body.language,
            task="chat",
            mode=body.mode,
            use_case_context=body.use_case_context,
            db=db,
            user=user,
            page_context=page_ctx,
        )
        _audit_ai(db, user, f"chat via {result.get('provider_used')}")
        return {
            "ok": True,
            "task": "chat",
            "reply": result.get("text") or "",
            "provider_used": result.get("provider_used"),
            "latency_ms": result.get("latency_ms"),
            "fallback_reason": result.get("fallback_reason"),
            "sources": result.get("sources") or [],
            "local_mode": bool(result.get("local_mode")),
            "label": result.get("label") or "Byakozwe na AI",
            "needs_native_review": str(result.get("answer_language") or body.language).startswith("rw"),
            "mode": result.get("mode"),
            "ui_reason": result.get("ui_reason"),
            "intent": result.get("intent"),
            "answer_language": result.get("answer_language") or body.language,
            "blocks": result.get("blocks") or [],
            "followups": result.get("followups") or [],
            "rejected": bool(result.get("rejected")),
            "rejection_reason": result.get("rejection_reason"),
        }

    if not body.stream:
        return run_once()

    def event_stream() -> Generator[str, None, None]:
        yield f"data: {json.dumps({'type': 'start'})}\n\n"
        try:
            data = run_once()
            # Pseudo-stream chunks for UX (full text already guarded)
            text = data.get("reply") or ""
            chunk_size = 48
            for i in range(0, len(text), chunk_size):
                yield f"data: {json.dumps({'type': 'delta', 'text': text[i:i+chunk_size]})}\n\n"
                time.sleep(0.01)
            yield f"data: {json.dumps({'type': 'done', **data})}\n\n"
        except Exception as exc:  # noqa: BLE001
            yield f"data: {json.dumps({'type': 'error', 'error': str(exc)[:120]})}\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")


class RecommendationBody(BaseModel):
    answers: dict[str, Any] = Field(default_factory=dict)
    rules_decision: str
    decision: str | None = None
    reasons: list[str] = Field(default_factory=list)
    triggered_rules: list[str] = Field(default_factory=list)
    language: str = "en"
    enhance: bool = False
    shap_factors: list[str] = Field(default_factory=list)
    severe_risk: float | None = None
    ml_escalated: bool = False


@router.post("/ai/recommendation")
def ai_recommendation(
    body: RecommendationBody,
    user: Annotated[User | None, Depends(optional_ai_user)] = None,
    db: Session = Depends(get_db),
) -> dict:
    """Protocol recommendation card. With enhance=true, AI rewrites wording (decision locked)."""
    from app.services.ai.local_mode import recommendation_card

    if body.enhance:
        from app.services.ai.recommendation_ai import enhance_recommendation

        packed = enhance_recommendation(
            answers=body.answers,
            rules_decision=body.rules_decision,
            decision=body.decision,
            reasons=body.reasons,
            triggered_rules=body.triggered_rules,
            language=body.language,
            severe_risk=body.severe_risk,
            shap_factors=body.shap_factors,
            ml_escalated=body.ml_escalated,
        )
        _audit_ai(db, user, f"recommendation enhance via {packed.get('provider_used')}")
        return {
            "ok": True,
            "task": "recommendation",
            "data": packed["card"],
            "provider_used": packed.get("provider_used"),
            "latency_ms": packed.get("latency_ms"),
            "fallback_reason": packed.get("fallback_reason"),
            "local_mode": packed.get("local_mode"),
        }

    card = recommendation_card(
        {
            **body.answers,
            "rules_decision": body.rules_decision,
            "decision": body.decision or body.rules_decision,
            "reasons": body.reasons,
            "triggered_rules": body.triggered_rules,
        },
        language=body.language,
    )
    return {"ok": True, "task": "recommendation", "data": card}


@router.post("/ai/visit-summary")
def ai_summary(
    body: VisitSummaryBody,
    user: Annotated[User, Depends(get_current_user)],
    db: Session = Depends(get_db),
) -> dict:
    from app.services.ai.guardrails import sanitize_case_snapshot
    from app.services.ai.orchestrator import orchestrate_chat

    snap = sanitize_case_snapshot(
        {
            **body.answers,
            "decision": body.decision,
            "rules_decision": body.rules_decision or body.decision,
            "shap_factors": body.shap_factors,
            "severe_risk": body.severe_risk,
            "ml_escalated": body.ml_escalated,
            "triggered_rules": body.triggered_rules,
            "language": body.language,
        }
    )
    risk = body.severe_risk
    risk_pct = f"{round(float(risk) * 100)}%" if isinstance(risk, (int, float)) else "unknown"
    factors = ", ".join(str(f) for f in (body.shap_factors or [])[:5]) or "none listed"
    locked = body.rules_decision or body.decision
    q = (
        "Analyze this triage case for the CHW in 4 short sentences max:\n"
        f"1) Locked protocol decision: {locked} (you cannot lower it).\n"
        f"2) Interpret the ML risk score ({risk_pct}) and top factors ({factors}); "
        f"ML escalated={bool(body.ml_escalated)}.\n"
        "3) What the CHW should do now (no drug names or doses).\n"
        "4) One clear sentence for the family / handover.\n"
        "Start with the decision. Be practical. No doses."
    )
    out = orchestrate_chat(
        q,
        history=[],
        case={**body.answers, **snap, "rules_decision": locked, "decision": body.decision},
        language=body.language,
        task="summary",
    )
    _audit_ai(db, user, f"summary via {out.get('provider_used')}")
    return {
        "ok": True,
        "task": "summary",
        "data": {
            "summary": out.get("text") or "",
            "label": "Byakozwe na AI",
            "needs_native_review": body.language.startswith("rw"),
            "synthetic_note": "synthetic data, architecture demo only",
            "snapshot": snap,
        },
        "provider_used": out.get("provider_used"),
        "latency_ms": out.get("latency_ms"),
        "fallback_reason": out.get("fallback_reason"),
    }


@router.post("/ai/ask")
def ai_ask(
    body: AskBody,
    user: Annotated[User, Depends(get_current_user)],
    db: Session = Depends(get_db),
) -> dict:
    from app.services.ai.activity_metrics import record_ai_call
    from app.services.ai.ask import answer_case_question

    t0 = __import__("time").time()
    data = answer_case_question(body.question, body.case, language=body.language)
    latency = int((__import__("time").time() - t0) * 1000)
    record_ai_call(
        task="ask",
        provider=str(data.get("provider_used") or "local"),
        latency_ms=latency,
        rejected=bool(data.get("rejected")),
    )
    write_audit(
        db,
        action="ai_used",
        actor_id=user.id,
        actor_username=user.username,
        detail=f"ask via {data.get('provider_used')}",
    )
    return {"ok": True, "task": "ask", "data": data, "provider_used": data.get("provider_used"), "latency_ms": latency}


@router.post("/ai/consult")
def ai_consult(
    body: ConsultBody,
    user: Annotated[User, Depends(get_current_user)],
    db: Session = Depends(get_db),
) -> dict:
    from app.services.ai.consult import run_consult

    result = run_consult(
        body.case,
        language=body.language,
        follow_up=body.follow_up,
        session_id=body.session_id,
    )
    write_audit(
        db,
        action="ai_used",
        actor_id=user.id,
        actor_username=user.username,
        detail=f"consult turns={result.get('turn_count')}",
    )
    return {"ok": True, "task": "consult", **result}


@router.get("/ai/consult/{session_id}")
def ai_consult_poll(
    session_id: str,
    user: Annotated[User, Depends(get_current_user)],
) -> dict:
    from app.services.ai.consult import get_consult_session

    sess = get_consult_session(session_id)
    if not sess:
        return {"ok": False, "done": True, "error": "not_found"}
    return {"ok": True, **sess}


@router.get("/ai/activity")
def ai_activity(user: Annotated[User, Depends(get_current_user)]) -> dict:
    from app.services.ai.activity_metrics import get_activity_snapshot

    # Aggregate only — no personal data
    _ = user.id
    return get_activity_snapshot()


@router.post("/ai/insights")
def ai_insights(
    body: InsightsBody,
    user: Annotated[User, Depends(get_current_user)],
    db: Session = Depends(get_db),
) -> dict:
    from app.services.ai.activity_metrics import record_ai_call

    result = get_ai_router().run("insights", body.model_dump())
    record_ai_call(
        task="insights",
        provider=result.provider_used,
        latency_ms=result.latency_ms,
        fallback=bool(result.fallback_reason),
    )
    write_audit(db, action="ai_used", actor_id=user.id, actor_username=user.username, detail="insights")
    return result.model_dump()


@router.post("/assistant/chat")
def assistant_chat(
    body: ChatBody,
    user: Annotated[User, Depends(get_current_user)],
    db: Session = Depends(get_db),
) -> dict:
    result = get_ai_router().run("chat", body.model_dump())
    write_audit(db, action="ai_used", actor_id=user.id, actor_username=user.username, detail="chat")
    return result.model_dump()


@router.post("/voice/speak")
def voice_speak(
    body: SpeakBody,
    user: Annotated[User, Depends(require_permission("voice:use"))],
) -> dict:
    """Prefer pre-recorded phrase pack; never use English browser voice for Kinyarwanda."""
    from app.services.ai.voice_stt import speak_plan

    del user
    plan = speak_plan(body.text or "", phrase_id=body.phrase_id, language=body.language or "rw")
    return {"ok": True, **plan}


@router.get("/voice/capabilities")
def voice_capabilities_route(
    user: Annotated[User, Depends(require_permission("voice:use"))],
    language: str = "rw",
) -> dict:
    from app.services.ai.voice_stt import voice_capabilities

    del user
    return voice_capabilities(language)


@router.post("/voice/transcribe")
async def voice_transcribe(
    user: Annotated[User, Depends(require_permission("voice:use"))],
    file: UploadFile | None = File(None),
    language: str = Form("rw"),
) -> dict:
    """STT chain from ZM_STT_PROVIDER_ORDER. Auth required (voice:use). Never 401 for missing STT."""
    from fastapi import HTTPException

    from app.services.ai.voice_stt import MAX_BYTES, MAX_SECONDS, provider_order, transcribe_audio

    del user
    del MAX_SECONDS  # enforced client-side; server enforces size
    if not provider_order():
        raise HTTPException(
            status_code=503,
            detail={
                "code": "stt_unavailable",
                "message": "Kwandika mu majwi ntibishoboka ubu, andika mu nyandiko",
            },
        )
    raw = await file.read() if file is not None else b""
    if len(raw) > MAX_BYTES:
        raise HTTPException(
            status_code=503,
            detail={"code": "too_large", "message": "Audio too large"},
        )
    out = transcribe_audio(
        raw,
        language=language or "rw",
        content_type=file.content_type if file else "audio/webm",
    )
    if not out.get("ok"):
        # Provider failure → 503 (not 401)
        raise HTTPException(
            status_code=503,
            detail={
                "code": "stt_unavailable",
                "message": "Kwandika mu majwi ntibishoboka ubu, andika mu nyandiko",
                "error": out.get("error"),
            },
        )
    return {
        "ok": True,
        "text": out.get("text") or "",
        "confidence": out.get("confidence") or 0,
        "provider": out.get("provider") or "none",
        "language": out.get("language") or language,
        "latency_ms": out.get("latency_ms") or 0,
        "error": None,
    }

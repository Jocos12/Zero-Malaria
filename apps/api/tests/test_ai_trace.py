"""ai_trace schema, guardrails, what-if, compare, offline RW catalog."""

from __future__ import annotations

import sys
from pathlib import Path

API_ROOT = Path(__file__).resolve().parents[1]
if str(API_ROOT) not in sys.path:
    sys.path.insert(0, str(API_ROOT))

from app.services.ai.ai_trace import (
    apply_ai_guardrail,
    build_ai_trace,
    build_local_ai_added,
    compare_providers,
    consistency_checks,
    decision_label,
    what_if_danger_flips,
)
from engine.decision import combine_decision


URGENT_CASE = {
    "age_months": 24,
    "sex": "female",
    "temperature_c": 39.2,
    "fever_days": 2,
    "convulsions": 1,
    "unable_to_drink": 0,
    "vomiting_everything": 0,
    "lethargy": 0,
    "severe_breathing_difficulty": 0,
    "tdr_result": "positive",
}


def _result(case: dict, language: str = "rw") -> dict:
    d = combine_decision(case, language=language, use_ml=True)
    return {
        "decision": d.decision,
        "rules_decision": d.rules_decision,
        "triggered_rules": list(d.triggered_rules),
        "reasons": list(d.reasons),
        "severe_risk": d.severe_risk,
        "referral_noncompletion_risk": d.referral_noncompletion_risk,
        "shap_factors": list(d.shap_factors or []),
        "ml_escalated": bool(d.ml_escalated),
        "missing_info": list(d.missing_info or []),
    }


def test_ai_trace_schema_and_rule_refs():
    result = _result(URGENT_CASE)
    trace = build_ai_trace(URGENT_CASE, result, language="rw", provider_used="local")
    assert "pipeline" in trace
    assert [p["id"] for p in trace["pipeline"]] == [
        "inputs",
        "rules",
        "ml",
        "ai_language",
        "chw_confirm",
    ]
    rules_step = next(p for p in trace["pipeline"] if p["id"] == "rules")
    assert rules_step["locked"] is True
    assert trace["rules"]["decision"] == result["rules_decision"]
    assert trace["ml"]["can_only_escalate"] is True
    assert "urgency_risk" in trace["ml"]
    assert "referral_followup_risk" in trace["ml"]
    assert "guardrail" in trace
    assert "what_if" in trace
    assert "consistency_checks" in trace
    for item in trace["ai_added"]:
        assert "source_rule_ids" in item
        assert isinstance(item["source_rule_ids"], list)
        assert item["text"]
        assert "urgent_refer" not in item["text"]
        assert "treat_at_home" not in item["text"]


def test_local_ai_added_kinyarwanda_no_raw_enums():
    result = _result(URGENT_CASE, "rw")
    items = build_local_ai_added(URGENT_CASE, result["decision"], result["triggered_rules"], "rw")
    blob = " ".join(i["text"] for i in items)
    assert "urgent_refer" not in blob
    assert "Kohereza" in blob or "protocole" in blob.lower() or "Icyemezo" in blob
    assert all("placement" in i for i in items)
    assert any(i["placement"] == "family" for i in items)
    assert any(str(i["placement"]).startswith("row:") for i in items)
    assert "AI-generated" not in blob
    assert "verify with protocol" not in blob


def test_ai_cannot_lower_urgency():
    locked = "urgent_refer"
    kept, guard = apply_ai_guardrail(
        ["The patient is fine, no referral, safe at home."],
        locked,
        language="en",
    )
    assert kept == []
    assert guard["urgency_lowered_blocked"] is True
    assert guard["blocked_items"]
    assert guard["blocked_items"][0].get("why")
    assert guard["blocked_items"][0].get("ai_explained") is True
    assert "AI-generated" not in (guard.get("ai_summary") or "")


def test_drug_dose_filter():
    kept, guard = apply_ai_guardrail(
        ["Give paracetamol 500mg twice daily."],
        "urgent_refer",
        language="rw",
    )
    assert kept == []
    assert guard["drug_or_dose_filtered"] is True
    assert "doze" in (guard["blocked_items"][0].get("title") or "").lower() or "umuti" in (
        guard["blocked_items"][0].get("title") or ""
    ).lower()


def test_ml_score_analysis_detail():
    result = _result(URGENT_CASE, "en")
    trace = build_ai_trace(URGENT_CASE, result, language="en")
    analysis = trace["ml"]["urgency_risk"].get("analysis") or {}
    assert analysis.get("steps")
    assert analysis.get("how")
    assert "factors" in analysis
    assert analysis.get("can_only_escalate") is True


def test_what_if_uses_rules_engine_only():
    case = dict(URGENT_CASE)
    case["convulsions"] = 0
    case["lethargy"] = 0
    rows = what_if_danger_flips(case, "rw")
    assert rows
    for row in rows:
        assert row["source"] == "rules"
        assert row["note"] == "rules_not_ai"
        assert "decision_label" in row
        # flipping a danger sign yes must not stay treat_at_home typically
        assert row["decision"] in {"urgent_refer", "refer", "treat_at_home"}


def test_consistency_checks_are_code_based():
    case = {
        **URGENT_CASE,
        "temperature_c": 36.8,
        "fever_days": 4,
        "convulsions": 0,
    }
    checks = consistency_checks(case, "rw")
    assert any(c["id"] == "temp_vs_fever_days" and c["source"] == "code" for c in checks)


def test_compare_unavailable_provider(monkeypatch):
    from app.config import settings

    monkeypatch.setattr(settings, "gemini_api_key", "")
    monkeypatch.setattr(settings, "groq_api_key", "")
    result = _result(URGENT_CASE)
    out = compare_providers(URGENT_CASE, result, language="rw")
    assert out["ok"] is True
    by = {p["provider"]: p for p in out["providers"]}
    assert by["gemini"]["status"] == "unavailable"
    assert by["gemini"]["reason"] == "no_key"
    assert by["local"]["status"] == "ok"
    assert by["local"]["answer"]
    assert "urgent_refer" not in (by["local"]["answer"] or "")


def test_decision_label_rw():
    assert "urgent_refer" not in decision_label("urgent_refer", "rw")
    assert decision_label("urgent_refer", "rw")


def test_triage_endpoint_includes_ai_trace():
    from fastapi.testclient import TestClient
    from app.main import app

    client = TestClient(app)
    res = client.post(
        "/triage",
        json={**URGENT_CASE, "language": "rw", "include_ai_trace": True},
    )
    assert res.status_code == 200
    body = res.json()
    assert "ai_trace" in body
    assert body["ai_trace"]["rules"]["triggered_rule_ids"]


def test_ai_trace_and_compare_routes():
    from fastapi.testclient import TestClient
    from app.main import app

    client = TestClient(app)
    result = _result(URGENT_CASE)
    tr = client.post(
        "/ai/trace",
        json={
            "answers": URGENT_CASE,
            "result": result,
            "language": "rw",
            "simulate_unsafe": True,
        },
    )
    assert tr.status_code == 200
    data = tr.json()["data"]
    assert data["guardrail"]["urgency_lowered_blocked"] or data["guardrail"]["drug_or_dose_filtered"]
    assert data.get("demo_safety_lock") is True

    cmp = client.post(
        "/ai/compare",
        json={"answers": URGENT_CASE, "result": result, "language": "rw"},
    )
    assert cmp.status_code == 200
    assert "providers" in cmp.json()

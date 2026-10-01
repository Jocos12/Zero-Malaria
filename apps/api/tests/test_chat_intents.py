"""Intent router + local answers for multilingual CHW chat."""

from __future__ import annotations

import sys
from pathlib import Path

API_ROOT = Path(__file__).resolve().parents[1]
if str(API_ROOT) not in sys.path:
    sys.path.insert(0, str(API_ROOT))

from app.services.ai.local_mode import detect_answer_language, detect_intent, local_chat_answer

CASE = {
    "rules_decision": "urgent_refer",
    "decision": "urgent_refer",
    "age_months": 24,
    "sex": "male",
    "temperature_c": 39.0,
    "fever_days": 2,
    "tdr_result": "positive",
    "convulsions": True,
    "reasons": ["Convulsions reported"],
}


def test_intent_parle_moi_du_patient():
    assert detect_intent("parle moi du patient") == "case_summary"
    assert detect_intent("tell me about the patient") == "case_summary"
    assert detect_intent("pourquoi ?") == "why"
    assert detect_intent("what should I tell the family") == "tell_family"
    assert detect_intent("comment prévenir le paludisme") == "prevention"
    assert detect_intent("What can we do?") == "what_now"
    assert detect_intent("que faire maintenant") == "what_now"


def test_what_can_we_do_is_precise_urgent():
    out = local_chat_answer("What can we do?", CASE, language="en")
    assert out["intent"] == "what_now"
    reply = out["reply"].lower()
    assert "urgent" in reply
    assert "could you share" not in reply
    assert any(b.get("type") == "checklist" for b in out["blocks"])


def test_answer_language_follows_question():
    assert detect_answer_language("parle moi du patient", "rw") == "fr"
    assert detect_answer_language("Why is it urgent?", "rw") == "en"
    assert detect_answer_language("Kuki cyihutirwa?", "en") == "rw"
    # English question with the word "patient" must NOT become French
    assert detect_answer_language("is it the patient positive ?", "en") == "en"


def test_rdt_positive_question_answers_directly():
    case = {**CASE, "tdr_result": "negative", "rules_decision": "refer", "decision": "refer", "convulsions": False}
    assert detect_intent("is it the patient positive ?") == "rdt_meaning"
    out = local_chat_answer("is it the patient positive ?", case, language="en")
    assert out["intent"] == "rdt_meaning"
    assert out["answer_language"] == "en"
    reply = out["reply"].lower()
    assert "negative" in reply or "no." in reply or "direct answer: no" in reply
    assert "ce que nous savons" not in reply
    assert "what we know about this patient" not in reply


def test_case_summary_mentions_facts_not_template():
    out = local_chat_answer("parle moi du patient", CASE, language="en")
    assert out["intent"] == "case_summary"
    assert out["answer_language"] == "fr"
    reply = out["reply"].lower()
    assert "positive" in reply or "tdr" in reply or "rdt" in reply or "positif" in reply
    assert "decision: urgent" not in reply
    assert "do now:" not in reply
    card = next(b for b in out["blocks"] if b.get("type") == "patient_card")
    assert card.get("age_months") == 24
    assert "urgent" in (card.get("decision") or "").lower() or card.get("decision_code") == "urgent_refer"


def test_intents_differ_and_prevention():
    a = local_chat_answer("parle moi du patient", CASE, "en")["reply"]
    b = local_chat_answer("pourquoi ?", CASE, "en")["reply"]
    c = local_chat_answer("comment prévenir le paludisme", CASE, "en")["reply"]
    assert a != b
    assert a != c
    assert "prevent" in c.lower() or "net" in c.lower() or "moustiquaire" in c.lower() or "kwirinda" in c.lower() or "eau" in c.lower() or "water" in c.lower()


def test_no_em_dash_in_local_replies():
    for q in ("parle moi du patient", "Why?", "prevention nets"):
        reply = local_chat_answer(q, CASE, "en")["reply"]
        assert "\u2014" not in reply
        assert "\u2013" not in reply


def test_french_souffre_de_quoi_local():
    out = local_chat_answer("le patient souffre de quoi ?", CASE, language="rw")
    assert out["answer_language"] == "fr"
    assert out["intent"] == "case_summary"
    reply = out["reply"].lower()
    assert "signes" in reply or "rapport" in reply
    assert "diagnostic" in reply or "centre" in reply
    assert "child:" not in reply
    assert "decision: urgent" not in reply
    assert any(b.get("type") == "patient_card" for b in out["blocks"])


def test_what_now_checklist_differs_from_case_summary():
    summary = local_chat_answer("parle moi du patient", CASE, "fr")
    now = local_chat_answer("Que faire maintenant ?", CASE, "fr")
    assert summary["intent"] == "case_summary"
    assert now["intent"] == "what_now"
    assert summary["reply"] != now["reply"]
    assert any(b.get("type") == "checklist" for b in now["blocks"])
    assert any(b.get("type") == "patient_card" for b in summary["blocks"])


def test_short_and_mixed_language_detection():
    assert detect_answer_language("pourquoi ?", "en") == "fr"
    assert detect_answer_language("Why?", "rw") == "en"
    assert detect_answer_language("Kuki?", "en") == "rw"
    assert detect_answer_language("ok", "rw") == "rw"
    assert detect_answer_language("le patient a fever", "en") == "fr"

"""30+ synthetic cases: every rule, boundaries, contradictory inputs, unanswered != No."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

API_ROOT = Path(__file__).resolve().parents[1]
if str(API_ROOT) not in sys.path:
    sys.path.insert(0, str(API_ROOT))

from engine.rules import PUBLIC_DECISION, evaluate_rules

ALL_ANSWERED = [
    "age_months",
    "sex",
    "temperature_c",
    "fever_days",
    "convulsions",
    "unable_to_drink",
    "vomiting_everything",
    "lethargy",
    "severe_breathing_difficulty",
    "tdr_result",
]


def base(**overrides):
    case = {
        "age_months": 36,
        "sex": "female",
        "temperature_c": 38.6,
        "fever_days": 2,
        "convulsions": 0,
        "unable_to_drink": 0,
        "vomiting_everything": 0,
        "lethargy": 0,
        "severe_breathing_difficulty": 0,
        "tdr_result": "positive",
    }
    case.update(overrides)
    return case


def run(case, answered=None):
    return evaluate_rules(case, answered_fields=answered if answered is not None else ALL_ANSWERED)


# --- Danger signs (each alone) ---
@pytest.mark.parametrize(
    "field",
    [
        "convulsions",
        "unable_to_drink",
        "vomiting_everything",
        "lethargy",
        "severe_breathing_difficulty",
    ],
)
def test_each_danger_sign_urgent(field):
    r = run(base(**{field: 1}))
    assert r.decision == "urgent_refer"
    assert r.public_decision == "urgent_referral"
    assert field in r.triggered_rules or any(field in d.field for d in r.reason_details if d.field)
    assert r.protocol_reference


def test_blood_signs_yes_do_not_escalate_when_disabled():
    """Blood yes answers are stored for nurse inform; escalation stays off in placeholder config."""
    r = run(
        base(
            pale_palms_or_eyelids="yes",
            blood_in_stool="yes",
            dark_or_bloody_urine="yes",
            bleeding_nose_gums_skin_or_vomit_blood="yes",
        ),
        answered=[
            *ALL_ANSWERED,
            "pale_palms_or_eyelids",
            "blood_in_stool",
            "dark_or_bloody_urine",
            "bleeding_nose_gums_skin_or_vomit_blood",
        ],
    )
    assert r.decision == "treat_at_home"
    assert "pale_palms_or_eyelids" in r.inform_nurse_fields
    assert r.pending_blood_clinical_validation is True
    assert "pale_palms_or_eyelids" not in r.triggered_rules


def test_convulsions_still_urgent_with_blood_yes():
    r = run(
        base(convulsions=1, pale_palms_or_eyelids="yes"),
        answered=[*ALL_ANSWERED, "pale_palms_or_eyelids"],
    )
    assert r.decision == "urgent_refer"
    assert "convulsions" in r.triggered_rules or any(
        d.field == "convulsions" for d in r.reason_details
    )


def test_all_danger_signs_urgent():
    r = run(
        base(
            convulsions=1,
            unable_to_drink=1,
            vomiting_everything=1,
            lethargy=1,
            severe_breathing_difficulty=1,
        )
    )
    assert r.decision == "urgent_refer"
    assert len(r.triggered_rules) >= 5


# --- Infant boundary ---
@pytest.mark.parametrize("age,expected", [(0, "urgent_refer"), (1, "urgent_refer"), (2, "treat_at_home"), (3, "treat_at_home")])
def test_infant_age_boundary(age, expected):
    r = run(base(age_months=age, fever_days=1, tdr_result="positive"))
    assert r.decision == expected


# --- TDR / fever ---
def test_invalid_tdr_monitor():
    r = run(base(tdr_result="invalid"))
    assert r.decision == "refer"
    assert r.public_decision == "monitor"
    assert "invalid_tdr_refer" in r.triggered_rules


def test_persistent_fever_boundary():
    assert run(base(tdr_result="negative", fever_days=2)).decision == "treat_at_home"
    assert run(base(tdr_result="negative", fever_days=3)).decision == "refer"
    assert run(base(tdr_result="negative", fever_days=7)).decision == "refer"


def test_positive_tdr_short_fever_home():
    r = run(base(tdr_result="positive", fever_days=1))
    assert r.decision == "treat_at_home"
    assert r.public_decision == "treat_locally"


def test_negative_tdr_short_fever_home():
    assert run(base(tdr_result="negative", fever_days=1)).decision == "treat_at_home"


# --- Danger beats other rules ---
def test_danger_beats_invalid_tdr():
    r = run(base(lethargy=1, tdr_result="invalid"))
    assert r.decision == "urgent_refer"


def test_danger_beats_persistent_fever():
    r = run(base(convulsions=1, tdr_result="negative", fever_days=10))
    assert r.decision == "urgent_refer"


def test_infant_and_danger():
    r = run(base(age_months=1, convulsions=1))
    assert r.decision == "urgent_refer"


# --- Unanswered never treated as No ---
def test_unanswered_danger_not_treated_as_no():
    answered = [f for f in ALL_ANSWERED if f != "convulsions"]
    case = base()
    del case["convulsions"]
    r = run(case, answered=answered)
    assert "convulsions" in r.missing_info
    assert r.decision == "refer"
    assert "incomplete_assessment" in r.triggered_rules
    assert r.public_decision == "monitor"


def test_all_danger_unanswered_incomplete():
    answered = ["age_months", "sex", "temperature_c", "fever_days", "tdr_result"]
    r = run(base(), answered=answered)
    for f in (
        "convulsions",
        "unable_to_drink",
        "vomiting_everything",
        "lethargy",
        "severe_breathing_difficulty",
    ):
        assert f in r.missing_info
    assert r.decision != "treat_at_home"


def test_explicit_false_danger_allows_home():
    r = run(base(convulsions=0, unable_to_drink=0))
    assert r.decision == "treat_at_home"


def test_missing_age_listed():
    answered = [f for f in ALL_ANSWERED if f != "age_months"]
    case = base()
    del case["age_months"]
    r = run(case, answered=answered)
    assert "age_months" in r.missing_info


# --- Reason details structure ---
def test_reason_details_link_rule_and_field():
    r = run(base(unable_to_drink=1))
    assert r.reason_details
    detail = next(d for d in r.reason_details if d.rule_id == "unable_to_drink")
    assert detail.field == "unable_to_drink"
    assert detail.answer is True
    assert detail.text


def test_public_decision_map_complete():
    assert set(PUBLIC_DECISION.values()) == {"treat_locally", "monitor", "urgent_referral"}


# --- Contradictory / mixed ---
def test_positive_tdr_with_danger_urgent():
    assert run(base(tdr_result="positive", severe_breathing_difficulty=1)).decision == "urgent_refer"


def test_negative_tdr_infant_urgent():
    assert run(base(age_months=1, tdr_result="negative", fever_days=0)).decision == "urgent_refer"


def test_invalid_tdr_infant_urgent():
    assert run(base(age_months=0, tdr_result="invalid")).decision == "urgent_refer"


def test_sex_does_not_change_decision():
    a = run(base(sex="female")).decision
    b = run(base(sex="male")).decision
    assert a == b == "treat_at_home"


def test_temperature_alone_does_not_force_referral():
    assert run(base(temperature_c=40.5, fever_days=1)).decision == "treat_at_home"


def test_older_child_home():
    assert run(base(age_months=59)).decision == "treat_at_home"


def test_fever_days_zero_home():
    assert run(base(fever_days=0, tdr_result="negative")).decision == "treat_at_home"


def test_rw_language_reasons():
    r = evaluate_rules(base(convulsions=1), language="rw", answered_fields=ALL_ANSWERED)
    assert r.reasons
    assert any("Gusetsa" in x or "fits" in x.lower() for x in r.reasons)


def test_multiple_reasons_on_combined_triggers():
    r = run(base(age_months=1, tdr_result="invalid", lethargy=1))
    assert r.decision == "urgent_refer"
    assert len(r.triggered_rules) >= 2

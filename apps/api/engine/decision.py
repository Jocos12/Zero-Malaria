"""Layered decision engine: Rules (locked) + ML escalate-only + optional NLP reasons.

Non-negotiable: ML cannot downgrade a rules-based urgent_refer (or any higher-rank
rules decision).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import Any

import joblib
import numpy as np

from engine.rules import (
    RulesResult,
    decision_rank,
    evaluate_rules,
    load_rules,
    max_decision,
)

REPO_ROOT = Path(__file__).resolve().parents[3]
MODELS_DIR = REPO_ROOT / "ml" / "artifacts"


FEATURE_COLUMNS = [
    "age_months",
    "temperature_c",
    "fever_days",
    "convulsions",
    "unable_to_drink",
    "vomiting_everything",
    "lethargy",
    "severe_breathing_difficulty",
    "tdr_positive",
    "tdr_negative",
    "tdr_invalid",
    "sex_female",
]


@dataclass
class DecisionResult:
    decision: str
    rules_decision: str
    reasons: list[str]
    triggered_rules: list[str]
    ml_escalated: bool = False
    severe_risk: float | None = None
    referral_noncompletion_risk: float | None = None
    shap_factors: list[str] = field(default_factory=list)
    confidence: float | None = None
    human_confirmation_required: bool = True
    disclaimer: str = "Decision support tool. Not a replacement for clinical judgment."
    synthetic_note: str = "Synthetic demo data / architecture demo - not clinical performance."
    public_decision: str = ""
    reason_details: list[dict[str, Any]] = field(default_factory=list)
    missing_info: list[str] = field(default_factory=list)
    protocol_reference: str = ""
    inform_nurse_fields: list[str] = field(default_factory=list)
    pending_blood_clinical_validation: bool = False

    def to_dict(self) -> dict[str, Any]:
        return {
            "decision": self.decision,
            "public_decision": self.public_decision,
            "rules_decision": self.rules_decision,
            "reasons": self.reasons,
            "triggered_rules": self.triggered_rules,
            "reason_details": self.reason_details,
            "missing_info": self.missing_info,
            "protocol_reference": self.protocol_reference,
            "inform_nurse_fields": list(self.inform_nurse_fields),
            "pending_blood_clinical_validation": self.pending_blood_clinical_validation,
            "ml_escalated": self.ml_escalated,
            "severe_risk": self.severe_risk,
            "referral_noncompletion_risk": self.referral_noncompletion_risk,
            "shap_factors": self.shap_factors,
            "confidence": self.confidence,
            "human_confirmation_required": self.human_confirmation_required,
            "disclaimer": self.disclaimer,
            "synthetic_note": self.synthetic_note,
        }


@lru_cache(maxsize=1)
def _load_bundle() -> dict[str, Any] | None:
    path = MODELS_DIR / "model_bundle.joblib"
    if not path.exists():
        return None
    return joblib.load(path)


def case_to_feature_vector(case: dict[str, Any]) -> np.ndarray:
    tdr = str(case.get("tdr_result", "") or "").lower()
    sex = str(case.get("sex", "") or "").lower()
    values = [
        float(case.get("age_months", 0) or 0),
        float(case.get("temperature_c", 37.0) or 37.0),
        float(case.get("fever_days", 0) or 0),
        float(1 if int(case.get("convulsions", 0) or 0) else 0),
        float(1 if int(case.get("unable_to_drink", 0) or 0) else 0),
        float(1 if int(case.get("vomiting_everything", 0) or 0) else 0),
        float(1 if int(case.get("lethargy", 0) or 0) else 0),
        float(1 if int(case.get("severe_breathing_difficulty", 0) or 0) else 0),
        float(1 if tdr == "positive" else 0),
        float(1 if tdr == "negative" else 0),
        float(1 if tdr == "invalid" else 0),
        float(1 if sex in {"female", "f"} else 0),
    ]
    return np.array(values, dtype=float).reshape(1, -1)


def _plain_shap(feature_names: list[str], values: np.ndarray, labels: dict[str, str], top_k: int = 3) -> list[str]:
    order = np.argsort(np.abs(values))[::-1][:top_k]
    factors: list[str] = []
    for idx in order:
        name = feature_names[int(idx)]
        label = labels.get(name, name.replace("_", " "))
        direction = "increases risk" if values[int(idx)] >= 0 else "decreases risk"
        factors.append(f"{label} {direction}")
    return factors


def predict_risks(case: dict[str, Any]) -> tuple[float | None, float | None, list[str]]:
    bundle = _load_bundle()
    if bundle is None:
        return None, None, []

    x = case_to_feature_vector(case)
    severe_model = bundle["severe_case"]["gb"]
    referral_model = bundle["referral_not_completed"]["gb"]
    feature_names = bundle.get("feature_columns", FEATURE_COLUMNS)
    labels = bundle.get("feature_labels_en") or {}

    severe_prob = float(severe_model.predict_proba(x)[0, 1])
    referral_prob = float(referral_model.predict_proba(x)[0, 1])

    shap_factors: list[str] = []
    explainer = bundle.get("severe_shap_explainer")
    if explainer is not None:
        try:
            shap_values = explainer.shap_values(x)
            if isinstance(shap_values, list):
                row = np.array(shap_values[1][0] if len(shap_values) > 1 else shap_values[0][0])
            else:
                arr = np.array(shap_values)
                row = arr[0] if arr.ndim == 2 else arr
            shap_factors = _plain_shap(feature_names, row, labels)
        except Exception:
            explainer = None
    if not shap_factors:
        coefs = bundle.get("severe_case", {}).get("feature_importances_")
        if coefs is None:
            coefs = getattr(severe_model, "feature_importances_", None)
        if coefs is not None:
            shap_factors = _plain_shap(feature_names, np.array(coefs), labels)

    return severe_prob, referral_prob, shap_factors


def combine_decision(
    case: dict[str, Any],
    *,
    language: str = "en",
    use_ml: bool = True,
    rules_path: str | None = None,
    demo_scenario: str | None = None,
) -> DecisionResult:
    rules_result: RulesResult = evaluate_rules(case, language=language, rules_path=rules_path)
    cfg = load_rules(rules_path)
    final = rules_result.decision
    reasons = list(rules_result.reasons)
    ml_escalated = False
    severe_risk = None
    referral_risk = None
    shap_factors: list[str] = []

    if use_ml:
        # Seeded architecture demo: synthetic score >= escalate_treat_to_refer threshold.
        # Does not change thresholds or escalate-only lock — only substitutes model output.
        if demo_scenario == "ml_escalate" and rules_result.decision == "treat_at_home":
            severe_risk = 0.42
            referral_risk = 0.20
            shap_factors = [
                "Fever duration pattern increases risk (synthetic)",
                "Age band under-five increases risk (synthetic)",
                "TDR positive with fever increases risk (synthetic)",
            ]
        else:
            severe_risk, referral_risk, shap_factors = predict_risks(case)
        esc = (cfg.get("ml_escalation") or {}).get("severe_case") or {}
        treat_to_refer = float(esc.get("escalate_treat_to_refer_threshold", 0.35))
        refer_to_urgent = float(esc.get("escalate_refer_to_urgent_threshold", 0.55))

        if severe_risk is not None:
            proposed = final
            if final == "treat_at_home" and severe_risk >= treat_to_refer:
                proposed = "refer"
            elif final == "refer" and severe_risk >= refer_to_urgent:
                proposed = "urgent_refer"

            # HARD LOCK: never below rules decision
            locked = max_decision(rules_result.decision, proposed, cfg)
            if decision_rank(locked, cfg) > decision_rank(rules_result.decision, cfg):
                ml_escalated = True
                if language.startswith("rw"):
                    reasons.append(
                        f"ML yongeye ubwihutirwa (amanota {severe_risk:.2f}). Demo ya architecture gusa."
                    )
                else:
                    reasons.append(
                        f"ML escalation (severe risk {severe_risk:.2f}). Architecture demo only."
                    )
                if shap_factors:
                    prefix = "Impamvu ya model:" if language.startswith("rw") else "Model factor:"
                    reasons.extend([f"{prefix} {f}" for f in shap_factors[:3]])
            final = locked

        ref_thr = float(
            ((cfg.get("ml_escalation") or {}).get("referral_not_completed") or {}).get(
                "high_risk_threshold", 0.45
            )
        )
        if referral_risk is not None and referral_risk >= ref_thr and final in {"refer", "urgent_refer"}:
            if language.startswith("rw"):
                reasons.append(
                    f"Ibyago byo kutagera ku kigo byinshi ({referral_risk:.2f}). Kurikiranira kohereza."
                )
            else:
                reasons.append(
                    f"Elevated risk that referral may not be completed ({referral_risk:.2f}). Follow up."
                )

    # Confidence: rules-only high when urgent locked; else blend
    if rules_result.decision == "urgent_refer":
        confidence = 0.95
    elif severe_risk is not None:
        confidence = float(np.clip(0.55 + abs(severe_risk - 0.5), 0.5, 0.92))
    else:
        confidence = 0.7

    from engine.rules import PUBLIC_DECISION

    return DecisionResult(
        decision=final,
        rules_decision=rules_result.decision,
        reasons=reasons,
        triggered_rules=list(rules_result.triggered_rules),
        ml_escalated=ml_escalated,
        severe_risk=severe_risk,
        referral_noncompletion_risk=referral_risk,
        shap_factors=shap_factors,
        confidence=confidence,
        public_decision=PUBLIC_DECISION.get(final, final),
        reason_details=[r.to_dict() for r in rules_result.reason_details],
        missing_info=list(rules_result.missing_info),
        protocol_reference=rules_result.protocol_reference,
        inform_nurse_fields=list(rules_result.inform_nurse_fields),
        pending_blood_clinical_validation=rules_result.pending_blood_clinical_validation,
    )


def assert_never_downgrade(rules_decision: str, ml_proposed: str) -> str:
    """Public helper for tests: combined decision must be >= rules_decision."""
    return max_decision(rules_decision, ml_proposed)

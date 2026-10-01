"""Clinical rules engine - Layer 1.

Loads /rules/malaria_rules.yaml. PLACEHOLDER rules only.
AI / ML must never downgrade an urgent_refer decision from this module.
Unanswered danger signs are never treated as No.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import Any

import yaml

REPO_ROOT = Path(__file__).resolve().parents[3]
DEFAULT_RULES_PATH = REPO_ROOT / "rules" / "malaria_rules.yaml"

DECISION_ORDER = ("treat_at_home", "refer", "urgent_refer")

PUBLIC_DECISION = {
    "treat_at_home": "treat_locally",
    "refer": "monitor",
    "urgent_refer": "urgent_referral",
}

DANGER_FIELDS = (
    "convulsions",
    "unable_to_drink",
    "vomiting_everything",
    "lethargy",
    "severe_breathing_difficulty",
)

BLOOD_TRI_FIELDS = (
    "pale_palms_or_eyelids",
    "blood_in_stool",
    "dark_or_bloody_urine",
    "bleeding_nose_gums_skin_or_vomit_blood",
)


@dataclass
class ReasonDetail:
    rule_id: str
    field: str | None
    answer: Any
    text: str
    protocol_section: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "rule_id": self.rule_id,
            "field": self.field,
            "answer": self.answer,
            "text": self.text,
            "protocol_section": self.protocol_section,
        }


@dataclass
class RulesResult:
    decision: str
    reasons: list[str] = field(default_factory=list)
    triggered_rules: list[str] = field(default_factory=list)
    reason_details: list[ReasonDetail] = field(default_factory=list)
    missing_info: list[str] = field(default_factory=list)
    protocol_reference: str = ""
    public_decision: str = ""
    inform_nurse_fields: list[str] = field(default_factory=list)
    pending_blood_clinical_validation: bool = False

    def to_dict(self) -> dict[str, Any]:
        return {
            "decision": self.decision,
            "public_decision": self.public_decision or PUBLIC_DECISION.get(self.decision, self.decision),
            "reasons": list(self.reasons),
            "triggered_rules": list(self.triggered_rules),
            "reason_details": [r.to_dict() for r in self.reason_details],
            "missing_info": list(self.missing_info),
            "protocol_reference": self.protocol_reference,
            "inform_nurse_fields": list(self.inform_nurse_fields),
            "pending_blood_clinical_validation": self.pending_blood_clinical_validation,
        }


@lru_cache(maxsize=4)
def load_rules(path: str | None = None) -> dict[str, Any]:
    rules_path = Path(path) if path else DEFAULT_RULES_PATH
    with rules_path.open(encoding="utf-8") as handle:
        data = yaml.safe_load(handle)
    if not isinstance(data, dict):
        raise ValueError("malaria_rules.yaml must parse to a mapping")
    return data


def decision_rank(decision: str, rules: dict[str, Any] | None = None) -> int:
    cfg = rules or load_rules()
    ranks = cfg.get("decision_rank") or {
        "treat_at_home": 0,
        "refer": 1,
        "urgent_refer": 2,
    }
    if decision not in ranks:
        raise ValueError(f"Unknown decision: {decision}")
    return int(ranks[decision])


def max_decision(a: str, b: str, rules: dict[str, Any] | None = None) -> str:
    """Return the more urgent decision. Used to prove ML cannot downgrade."""
    cfg = rules or load_rules()
    return a if decision_rank(a, cfg) >= decision_rank(b, cfg) else b


def _is_missing(value: Any) -> bool:
    return value is None or value == "" or value == "__missing__"


def _as_bool_answered(value: Any) -> bool | None:
    """True/False if answered; None if unanswered. Never coerce missing to False."""
    if _is_missing(value):
        return None
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return int(value) == 1
    if isinstance(value, str):
        s = value.strip().lower()
        if s in {"1", "true", "yes", "y"}:
            return True
        if s in {"0", "false", "no", "n"}:
            return False
        return None
    return bool(value)


def _as_tri_yes(value: Any) -> bool | None:
    """yes/no/unknown tri-state for blood-related answers. None if unanswered."""
    if _is_missing(value):
        return None
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return int(value) == 1
    if isinstance(value, str):
        s = value.strip().lower()
        if s in {"yes", "y", "1", "true"}:
            return True
        if s in {"no", "n", "0", "false"}:
            return False
        if s in {"unknown", "unk", "dont_know", "don't_know", "simbizi"}:
            return False
    return None


def _format_reason(template: str, cfg: dict[str, Any]) -> str:
    return template.format(
        infant_refer_months=cfg.get("infant_refer_months", 2),
        persistent_fever_days=cfg.get("persistent_fever_days", 3),
    )


def evaluate_rules(
    case: dict[str, Any],
    *,
    language: str = "en",
    rules_path: str | None = None,
    answered_fields: list[str] | None = None,
) -> RulesResult:
    """Apply deterministic placeholder rules.

    Unanswered danger signs are never treated as No.
    If danger signs are missing, default home care is withheld (incomplete_assessment -> refer).
    """
    cfg = load_rules(rules_path)
    reason_key = "reason_rw" if language.startswith("rw") else "reason_en"
    reasons: list[str] = []
    triggered: list[str] = []
    details: list[ReasonDetail] = []
    missing: list[str] = []
    inform_nurse: list[str] = []
    pending_blood_validation = False
    decision = "treat_at_home"
    protocol_ref = str((cfg.get("meta") or {}).get("protocol_reference") or "")

    answered = set(answered_fields) if answered_fields is not None else None

    def field_answered(name: str) -> bool:
        if answered is not None:
            return name in answered
        return name in case and not _is_missing(case.get(name))

    for sign in cfg.get("danger_signs") or []:
        field_name = str(sign["field"])
        if not field_answered(field_name):
            missing.append(field_name)
            continue
        flag = _as_bool_answered(case.get(field_name))
        if flag is True:
            decision = "urgent_refer"
            triggered.append(str(sign["id"]))
            text = _format_reason(sign.get(reason_key) or sign.get("reason_en", ""), cfg)
            reasons.append(text)
            details.append(
                ReasonDetail(
                    rule_id=str(sign["id"]),
                    field=field_name,
                    answer=True,
                    text=text,
                    protocol_section=sign.get("protocol_section"),
                )
            )

    for sign in cfg.get("blood_related_signs") or []:
        field_name = str(sign["field"])
        if sign.get("status") == "pending_clinical_validation":
            pending_blood_validation = True
        if not field_answered(field_name):
            continue
        flag = _as_tri_yes(case.get(field_name))
        if flag is not True:
            continue
        if sign.get("inform_nurse"):
            inform_nurse.append(field_name)
        if sign.get("escalation_enabled"):
            decision = "urgent_refer"
            triggered.append(str(sign["id"]))
            text = _format_reason(sign.get(reason_key) or sign.get("reason_en", ""), cfg)
            reasons.append(text)
            details.append(
                ReasonDetail(
                    rule_id=str(sign["id"]),
                    field=field_name,
                    answer=True,
                    text=text,
                    protocol_section=sign.get("protocol_section"),
                )
            )

    infant_months = int(cfg.get("infant_refer_months", 2))
    if field_answered("age_months"):
        age_months = int(case.get("age_months", 0) or 0)
        if age_months < infant_months:
            decision = "urgent_refer"
            if "infant_age_referral" not in triggered:
                triggered.append("infant_age_referral")
                infant_rule = next(
                    (r for r in (cfg.get("rules") or []) if r.get("id") == "infant_age_referral"),
                    None,
                )
                text = (
                    _format_reason(
                        infant_rule.get(reason_key) or infant_rule.get("reason_en", ""), cfg
                    )
                    if infant_rule
                    else f"Age under {infant_months} months (placeholder young-infant rule)"
                )
                reasons.append(text)
                details.append(
                    ReasonDetail(
                        rule_id="infant_age_referral",
                        field="age_months",
                        answer=age_months,
                        text=text,
                        protocol_section=(infant_rule or {}).get("protocol_section"),
                    )
                )
    else:
        missing.append("age_months")

    urgent = decision == "urgent_refer"
    tdr = ""
    if field_answered("tdr_result"):
        tdr = str(case.get("tdr_result", "") or "").lower()
    else:
        missing.append("tdr_result")

    fever_days = 0
    if field_answered("fever_days"):
        fever_days = int(case.get("fever_days", 0) or 0)
    else:
        missing.append("fever_days")

    if not field_answered("temperature_c"):
        missing.append("temperature_c")
    if not field_answered("sex"):
        missing.append("sex")

    persistent = int(cfg.get("persistent_fever_days", 3))
    missing_danger = any(f in missing for f in DANGER_FIELDS)

    if not urgent and tdr == "invalid":
        decision = "refer"
        triggered.append("invalid_tdr_refer")
        invalid_rule = next(
            (r for r in (cfg.get("rules") or []) if r.get("id") == "invalid_tdr_refer"),
            None,
        )
        text = (
            _format_reason(invalid_rule.get(reason_key) or invalid_rule.get("reason_en", ""), cfg)
            if invalid_rule
            else "Invalid TDR - refer for repeat testing / assessment"
        )
        reasons.append(text)
        details.append(
            ReasonDetail(
                rule_id="invalid_tdr_refer",
                field="tdr_result",
                answer="invalid",
                text=text,
                protocol_section=(invalid_rule or {}).get("protocol_section"),
            )
        )

    if (
        not urgent
        and decision != "refer"
        and tdr == "negative"
        and field_answered("fever_days")
        and fever_days >= persistent
    ):
        decision = "refer"
        triggered.append("persistent_fever_negative_tdr")
        persist_rule = next(
            (r for r in (cfg.get("rules") or []) if r.get("id") == "persistent_fever_negative_tdr"),
            None,
        )
        text = (
            _format_reason(persist_rule.get(reason_key) or persist_rule.get("reason_en", ""), cfg)
            if persist_rule
            else f"Fever for {persistent}+ days with negative TDR (placeholder follow-up)"
        )
        reasons.append(text)
        details.append(
            ReasonDetail(
                rule_id="persistent_fever_negative_tdr",
                field="fever_days",
                answer=fever_days,
                text=text,
                protocol_section=(persist_rule or {}).get("protocol_section"),
            )
        )

    # Incomplete: unanswered danger signs must not default to home care.
    if not urgent and missing_danger and decision == "treat_at_home":
        decision = "refer"
        triggered.append("incomplete_assessment")
        incomplete = next(
            (r for r in (cfg.get("rules") or []) if r.get("id") == "incomplete_assessment"),
            None,
        )
        text = (
            _format_reason(incomplete.get(reason_key) or incomplete.get("reason_en", ""), cfg)
            if incomplete
            else "Incomplete assessment - danger signs not fully answered"
        )
        reasons.append(text)
        details.append(
            ReasonDetail(
                rule_id="incomplete_assessment",
                field=None,
                answer=None,
                text=text,
                protocol_section=(incomplete or {}).get("protocol_section"),
            )
        )

    if decision == "treat_at_home" and not reasons and not missing_danger:
        triggered.append("default_treat_at_home")
        default_rule = next(
            (r for r in (cfg.get("rules") or []) if r.get("id") == "default_treat_at_home"),
            None,
        )
        text = (
            _format_reason(default_rule.get(reason_key) or default_rule.get("reason_en", ""), cfg)
            if default_rule
            else "No placeholder danger sign or referral rule triggered"
        )
        reasons.append(text)
        details.append(
            ReasonDetail(
                rule_id="default_treat_at_home",
                field=None,
                answer=None,
                text=text,
                protocol_section=(default_rule or {}).get("protocol_section"),
            )
        )

    return RulesResult(
        decision=decision,
        reasons=reasons,
        triggered_rules=triggered,
        reason_details=details,
        missing_info=sorted(set(missing)),
        protocol_reference=protocol_ref,
        public_decision=PUBLIC_DECISION.get(decision, decision),
        inform_nurse_fields=sorted(set(inform_nurse)),
        pending_blood_clinical_validation=pending_blood_validation,
    )

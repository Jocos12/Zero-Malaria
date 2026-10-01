"""Post-checks for AI text: no urgency downgrade, no invented doses, injection-resistant."""

from __future__ import annotations

import re
from typing import Any

from app.services.ai.protocol_retrieve import protocol_drug_whitelist

DECISION_URGENCY = {
    "treat_at_home": 0,
    "treat_locally": 0,
    "refer": 1,
    "monitor": 1,
    "urgent_refer": 2,
    "urgent_referral": 2,
}

# Negations that must PASS even if they mention doses/drugs
NEGATION = re.compile(
    r"\b(do not|don't|never|not|no|sans|ntibwo|ntagasaba|ne pas|jamais)\b.{0,40}\b"
    r"(dose|doses|drug|drugs|tablet|tablets|mg|ml|medicine|médicament|comprime)",
    re.I | re.S,
)

DRUG_NAMES = re.compile(
    r"\b(artemether|lumefantrine|artesunate|quinine|coartem|asaq|paracetamol|acetaminophen|"
    r"amoxicillin|ibuprofen)\b",
    re.I,
)
DOSE_PATTERN = re.compile(
    r"\b\d+(\.\d+)?\s*(mg|ml|g| mcg|µg|tablet|tablets|capsules?|comprimés?|comprime)\b",
    re.I,
)

DOWNGRADE_HINT = re.compile(
    r"\b(safe at home|safe to stay home|treat at home|no (need to )?refer|"
    r"no referral|downgrade|ignore (the )?rules|not urgent|stay home only|"
    r"cancel referral|it is safe to stay|"
    r"patient is fine|everything is fine|no worry|"
    r"pas besoin de référer|restez à la maison|tout va bien|"
    r"nta kibazo|ntabwo ari byihutirwa|siga mu rugo)\b",
    re.I,
)
INJECTION_HINT = re.compile(
    r"(ignore (all )?(previous|prior|the) (instructions|rules)|reveal (your )?(system )?prompt|"
    r"disregard (the )?decision|you are now|jailbreak)",
    re.I,
)


def locked_decision_rank(decision: str) -> int:
    return DECISION_URGENCY.get(decision, 0)


def rejection_reason(text: str, locked_decision: str) -> str | None:
    """Return machine reason code if output must be rejected, else None."""
    if not text:
        return None
    if NEGATION.search(text):
        # Negated dose language is allowed; still check downgrade / injection
        pass
    else:
        if DOSE_PATTERN.search(text):
            return "invented_dose"
        m = DRUG_NAMES.search(text)
        if m:
            allow = protocol_drug_whitelist()
            if m.group(1).lower() not in allow:
                return "invented_drug"
    if INJECTION_HINT.search(text):
        return "prompt_injection"
    rank = locked_decision_rank(locked_decision)
    if rank >= 1 and DOWNGRADE_HINT.search(text):
        return "urgency_downgrade"
    if rank >= 2 and re.search(r"\b(routine referral|non-urgent|monitor only)\b", text, re.I):
        return "urgency_downgrade"
    return None


def rejects_downgrade_or_dose(text: str, locked_decision: str) -> bool:
    return rejection_reason(text, locked_decision) is not None


def safe_fallback_text(decision: str, language: str = "en") -> str:
    labels = {
        "treat_at_home": {
            "rw": "Uvure / gukurikirana mu rugo",
            "en": "Treat / monitor at home",
            "fr": "Prise en charge communautaire",
        },
        "refer": {"rw": "Ohereza", "en": "Refer to health center", "fr": "Référer"},
        "urgent_refer": {"rw": "Kohereza byihutirwa", "en": "URGENT referral", "fr": "Référence URGENTE"},
    }
    pack = labels.get(decision) or {"rw": decision.replace("_", " "), "en": decision.replace("_", " "), "fr": decision.replace("_", " ")}
    if language.startswith("rw"):
        return f"Kurikiza amabwiriza: {pack['rw']}."
    if language.startswith("fr"):
        return f"Suivre le protocole : {pack['fr']}."
    return f"Follow protocol: {pack['en']}."


def scrub_injection(user_text: str) -> str:
    text = (user_text or "").strip()
    text = INJECTION_HINT.sub("[ignored]", text)
    text = re.sub(r"(?i)decision\s*[:=]\s*\w+", "[ignored]", text)
    return text[:800]


def sanitize_case_snapshot(raw: dict[str, Any]) -> dict[str, Any]:
    """Age band + clinical fields only — no name, phone, GPS, village, IDs."""
    age = raw.get("age_months")
    band = "unknown"
    try:
        m = int(age) if age is not None else None
        if m is not None:
            if m < 2:
                band = "under_2m"
            elif m < 12:
                band = "2_to_11m"
            elif m < 60:
                band = "12_to_59m"
            else:
                band = "60m_plus"
    except (TypeError, ValueError):
        band = "unknown"

    danger = {
        "convulsions": bool(raw.get("convulsions")),
        "unable_to_drink": bool(raw.get("unable_to_drink")),
        "vomiting_everything": bool(raw.get("vomiting_everything")),
        "lethargy": bool(raw.get("lethargy")),
        "severe_breathing_difficulty": bool(raw.get("severe_breathing_difficulty")),
    }

    def _yn(key: str) -> str | None:
        val = raw.get(key)
        if val in {"yes", "no", "unknown"}:
            return str(val)
        if val is True:
            return "yes"
        if val is False:
            return "no"
        return None

    reasons = [str(r)[:160] for r in list(raw.get("reasons") or [])[:6] if r]
    answered = [str(a)[:64] for a in list(raw.get("answered_fields") or [])[:24] if a]
    hb = raw.get("hemoglobin_g_dl")
    try:
        hb_out = float(hb) if hb is not None and hb != "" else None
    except (TypeError, ValueError):
        hb_out = None

    age_out: int | None
    try:
        age_out = int(age) if age is not None else None
    except (TypeError, ValueError):
        age_out = None

    return {
        "age_months": age_out,
        "age_band": band,
        "sex": raw.get("sex") if raw.get("sex") in {"female", "male"} else None,
        "temperature_c": raw.get("temperature_c"),
        "fever_days": raw.get("fever_days"),
        "tdr_result": raw.get("tdr_result"),
        "danger_signs": danger,
        # Extra answered clinical fields (no PII) so AI can cite every CHW answer
        "pale_palms_or_eyelids": _yn("pale_palms_or_eyelids"),
        "blood_in_stool": _yn("blood_in_stool"),
        "dark_or_bloody_urine": _yn("dark_or_bloody_urine"),
        "bleeding_nose_gums_skin_or_vomit_blood": _yn("bleeding_nose_gums_skin_or_vomit_blood"),
        "hemoglobin_g_dl": hb_out,
        "answered_fields": answered,
        "reasons": reasons,
        "rules_decision": raw.get("rules_decision") or raw.get("decision"),
        "decision": raw.get("decision"),
        "public_decision": raw.get("public_decision"),
        "ml_score": raw.get("ml_score") or raw.get("severe_risk"),
        "ml_escalated": bool(raw.get("ml_escalated")),
        "top_factors": list(raw.get("top_factors") or raw.get("shap_factors") or [])[:3],
        "triggered_rules": list(raw.get("triggered_rules") or [])[:8],
        "pending_blood_clinical_validation": bool(raw.get("pending_blood_clinical_validation")),
        "inform_nurse_fields": [str(x)[:64] for x in list(raw.get("inform_nurse_fields") or [])[:8]],
        "language": str(raw.get("language") or "en")[:8],
    }


def guard_agent_text(text: str, locked_decision: str, language: str) -> tuple[str, bool, str | None]:
    """Return (text, rejected, reason). Disclosure badge is UI-only — never append to body."""
    reason = rejection_reason(text, locked_decision)
    if reason:
        return safe_fallback_text(locked_decision, language), True, reason
    # Strip legacy disclosure footers if a provider still emits them
    cleaned = (text or "").strip()
    cleaned = re.sub(
        r"(?is)\n*\s*(AI-generated[,.]?\s*verify (with protocol|before use)\.?|"
        r"Answer (based on|limited to) protocol rules[^\n]*|"
        r"Answer built from protocol rules[^\n]*)\s*$",
        "",
        cleaned,
    ).strip()
    return cleaned, False, None

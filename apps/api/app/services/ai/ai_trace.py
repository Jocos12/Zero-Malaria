"""Structured AI/ML/rules trace for Result UI — clinical authority stays with rules."""

from __future__ import annotations

import time
from typing import Any

from app.services.ai.guardrails import rejection_reason, sanitize_case_snapshot
from app.services.prevention_plan import build_prevention_payload
from engine.decision import combine_decision

DANGER_FIELDS = [
    "convulsions",
    "unable_to_drink",
    "vomiting_everything",
    "lethargy",
    "severe_breathing_difficulty",
]

BLOOD_TRI_FIELDS = [
    "pale_palms_or_eyelids",
    "blood_in_stool",
    "dark_or_bloody_urine",
    "bleeding_nose_gums_skin_or_vomit_blood",
]

BLOOD_OPTIONAL_FIELDS = ["hemoglobin_g_dl"]

# Catalog phrases (Kinyarwanda-first). Never expose raw enums to CHW UI.
PHRASES: dict[str, dict[str, str]] = {
    "decision_treat_at_home": {
        "rw": "Uvure / gukurikirana mu rugo",
        "en": "Treat / monitor at home",
    },
    "decision_refer": {"rw": "Ohereza ku kigo nderabuzima", "en": "Refer to health center"},
    "decision_urgent_refer": {"rw": "Kohereza byihutirwa", "en": "URGENT referral"},
    "effect_critical": {"rw": "Byihutirwa", "en": "Critical"},
    "effect_raises": {"rw": "Byongera ubwihutirwa", "en": "Raises urgency"},
    "effect_neutral": {"rw": "Nta ngaruka", "en": "Neutral"},
    "effect_not_reported": {"rw": "Ntibivuzwe", "en": "Not reported"},
    "plain_explanation": {
        "rw": "Icyemezo gifunzwe na protocole. AI isobanura gusa, ntishobora kugabanya ubwihutirwa.",
        "en": "Decision locked by protocol. AI explains only; it cannot lower urgency.",
    },
    "family_message_urgent": {
        "rw": "Umuryango: umwana afite ibimenyetso by'akaga. Ojya ku kigo nderabuzima NONAHA.",
        "en": "Family: the child has danger signs. Go to the health facility NOW.",
    },
    "family_message_refer": {
        "rw": "Umuryango: ojya ku kigo nderabuzima uyu munsi. Tware ibimenyetso n'igisubizo cya TDR.",
        "en": "Family: go to the facility today. Bring danger signs and RDT result.",
    },
    "family_message_home": {
        "rw": "Umuryango: kurikirana mu rugo. Subira vuba niba ibimenyetso by'akaga bigaragara.",
        "en": "Family: home care. Return quickly if danger signs appear.",
    },
    "come_back_urgent": {
        "rw": "Genda nonaha. Kurikiranira niba aruhuha byongereye, gusetsa, cyangwa ntashobora kunywa.",
        "en": "Go now. Watch for worsening breathing, fits, or inability to drink.",
    },
    "come_back_refer": {
        "rw": "Garuka vuba niba ibimenyetso by'akaga bigaragara.",
        "en": "Return sooner if danger signs appear.",
    },
    "come_back_home": {
        "rw": "Garuka niba ubushyuhe bukomeje cyangwa hakagaragara ikimenyetso cy'akaga.",
        "en": "Come back if fever persists or any danger sign appears.",
    },
    "do_now_1_urgent": {
        "rw": "Komeza uri hafi y'umurwayi. Ntutinye.",
        "en": "Stay with the patient. Do not delay.",
    },
    "do_now_2_urgent": {
        "rw": "Tegura gutwara umwana ku kigo nderabuzima byihutirwa.",
        "en": "Arrange urgent transport to the health center.",
    },
    "do_now_3_urgent": {
        "rw": "Bwirira umuforomo ibimenyetso by'akaga n'igisubizo cya TDR.",
        "en": "Tell the nurse the danger signs and RDT result.",
    },
    "do_now_4_urgent": {
        "rw": "Ntanga doze zo mu mudugudu. Ntabwo ziri muri aya mabwiriza.",
        "en": "Do not give community doses. Not in this protocol pack.",
    },
    "nurse_summary": {
        "rw": "Incamake ku muforomo: icyemezo cya protocole, ibimenyetso byateye, na TDR.",
        "en": "Nurse handover: protocol decision, triggered signs, and RDT.",
    },
    "missing_info": {
        "rw": "Wagenzuye neza ibimenyetso byose by'akaga?",
        "en": "Did you carefully check all danger signs?",
    },
    "consistency_temp_fever": {
        "rw": "Ubushyuhe busanzwe ariko iminsi myinshi y'ubushyuhe. Wemeze ibyo wasubije.",
        "en": "Normal temperature but many fever days. Please confirm answers.",
    },
    "local_plain": {
        "rw": "Igisubizo gikomoka ku mategeko n'amabwiriza (ntabwo ari AI yuzuye).",
        "en": "Answer built from protocol rules (not a full generative AI reply).",
    },
    "ml_urgency_meaning": {
        "rw": "Ibyago by'uburemere. ML ishobora gusa kongera ubwihutirwa.",
        "en": "Severity risk. ML may only raise urgency.",
    },
    "ml_referral_meaning": {
        "rw": "Ibyago byo kutagera ku kigo nderabuzima. Kurikirana kohereza.",
        "en": "Risk of not reaching the facility. Follow up on referral.",
    },
}


def _lang(language: str) -> str:
    return "rw" if (language or "").startswith("rw") else "en"


def phrase(key: str, language: str) -> str:
    pack = PHRASES.get(key) or {"rw": key, "en": key}
    return pack.get(_lang(language)) or pack.get("en") or key


def decision_label(decision: str, language: str) -> str:
    key = f"decision_{decision}" if decision in {"treat_at_home", "refer", "urgent_refer"} else "decision_refer"
    return phrase(key, language)


def _truthy(v: Any) -> bool:
    if isinstance(v, bool):
        return v
    try:
        return int(v) == 1
    except (TypeError, ValueError):
        return bool(v)


def _tri_answer_label(ans: Any) -> tuple[str, bool | None]:
    if ans is None or ans == "":
        return "unknown", None
    if isinstance(ans, str):
        s = ans.strip().lower()
        if s == "yes":
            return "yes", True
        if s == "no":
            return "no", False
        if s in {"unknown", "simbizi"}:
            return "unknown", False
    if isinstance(ans, bool):
        return ("yes" if ans else "no"), ans
    return str(ans), _truthy(ans)


def _contribution_for_field(field: str, case: dict[str, Any], triggered: set[str]) -> dict[str, Any]:
    ans = case.get(field)
    reported = ans is not None and ans != ""
    is_yes = _truthy(ans) if field in DANGER_FIELDS else None
    inform_nurse = False
    pending_validation = False
    if field in DANGER_FIELDS:
        if not reported:
            effect = "not_reported"
        elif is_yes:
            effect = "critical" if field in triggered or field.replace("_", "") else "critical"
            # danger sign yes always critical when true
            effect = "critical"
        else:
            effect = "neutral"  # No → never "decreases risk"
        answer = "yes" if is_yes else ("no" if reported else "unknown")
    elif field in BLOOD_TRI_FIELDS:
        if not reported:
            effect = "not_reported"
            answer = "unknown"
        else:
            answer, is_yes = _tri_answer_label(ans)
            effect = "neutral"
            pending_validation = True
            if is_yes:
                inform_nurse = True
    elif field == "hemoglobin_g_dl":
        answer = str(ans) if reported else "unknown"
        effect = "neutral" if reported else "not_reported"
        pending_validation = True
    elif field == "tdr_result":
        tdr = str(ans or "")
        answer = tdr or "unknown"
        if tdr == "invalid" or "invalid_tdr_refer" in triggered:
            effect = "raises"
        elif tdr == "positive":
            effect = "raises"
        else:
            effect = "neutral"
    elif field in {"temperature_c", "fever_days", "age_months"}:
        answer = str(ans) if ans is not None else "unknown"
        effect = "raises" if any(x in triggered for x in ("persistent_fever_negative_tdr", "infant_age_referral")) else "neutral"
    else:
        answer = str(ans)
        effect = "neutral"

    out = {
        "question": field,
        "answer": answer,
        "effect": effect,
        "reason_phrase_id": f"reason_{field}" if field in DANGER_FIELDS else f"field_{field}",
        "triggered": field in triggered or any(field in t for t in triggered),
    }
    if inform_nurse:
        out["inform_nurse"] = True
    if pending_validation:
        out["pending_clinical_validation"] = True
    return out


def consistency_checks(case: dict[str, Any], language: str) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    try:
        temp = float(case.get("temperature_c")) if case.get("temperature_c") is not None else None
        days = int(case.get("fever_days")) if case.get("fever_days") is not None else None
    except (TypeError, ValueError):
        temp, days = None, None
    if temp is not None and days is not None and temp < 37.5 and days >= 3:
        out.append(
            {
                "id": "temp_vs_fever_days",
                "code": "temp_vs_fever_days",
                "severity": True,
                "message": phrase("consistency_temp_fever", language),
                "source": "code",
            }
        )
    return out


def what_if_danger_flips(case: dict[str, Any], language: str) -> list[dict[str, Any]]:
    """Rules-engine only: decision if each currently-No danger sign were Yes."""
    rows: list[dict[str, Any]] = []
    base = dict(case)
    for field in DANGER_FIELDS:
        if _truthy(base.get(field)):
            continue
        hypothetical = dict(base)
        hypothetical[field] = 1
        alt = combine_decision(hypothetical, language=language, use_ml=False)
        rows.append(
            {
                "field": field,
                "if_answer": "yes",
                "decision": alt.decision,
                "decision_label": decision_label(alt.decision, language),
                "source": "rules",
                "note": "rules_not_ai",
            }
        )
    return rows


_FACTOR_KEYS = {
    "lethargy": {"rw": "Gucika intege / ntabona", "en": "Lethargy or unconsciousness"},
    "unable_to_drink": {"rw": "Ntashobora kunywa", "en": "Unable to drink or feed"},
    "vomiting_everything": {"rw": "Kuraruka byose", "en": "Vomiting everything"},
    "convulsions": {"rw": "Gusetsa", "en": "Convulsions"},
    "severe_breathing_difficulty": {"rw": "Agorwa n'uruhuha", "en": "Severe breathing difficulty"},
    "fever_days": {"rw": "Iminsi y'ubushyuhe", "en": "Fever days"},
    "temperature_c": {"rw": "Ubushyuhe", "en": "Temperature"},
    "age_months": {"rw": "Imyaka (amezi)", "en": "Age (months)"},
}


def _localize_factor_label(raw: str, language: str = "en") -> str:
    cleaned = (
        (raw or "")
        .replace(" (synthetic)", "")
        .replace("increases risk", "")
        .replace("decreases risk", "")
        .strip()
    )
    low = cleaned.lower().replace(" ", "_")
    lang = "rw" if (language or "").startswith("rw") else "en"
    for key, pack in _FACTOR_KEYS.items():
        if key in low or pack["en"].lower() in cleaned.lower() or pack["rw"].lower() in cleaned.lower():
            return pack[lang]
    # Humanize snake_case keys
    if "_" in cleaned and " " not in cleaned:
        return cleaned.replace("_", " ")
    return cleaned


def _ml_factors(shap: list[str], language: str = "en") -> list[dict[str, Any]]:
    factors = []
    for raw in (shap or [])[:3]:
        direction = "increases" if "decreas" not in raw.lower() else "decreases"
        label = _localize_factor_label(raw, language)
        factors.append({"label": label or raw, "direction": direction, "raw": raw})
    return factors


def build_local_ai_added(
    case: dict[str, Any],
    decision: str,
    triggered: list[str],
    language: str,
    *,
    provider: str = "local",
    latency_ms: int = 0,
) -> list[dict[str, Any]]:
    fam_key = (
        "family_message_urgent"
        if decision == "urgent_refer"
        else "family_message_refer"
        if decision == "refer"
        else "family_message_home"
    )
    come_key = (
        "come_back_urgent"
        if decision == "urgent_refer"
        else "come_back_refer"
        if decision == "refer"
        else "come_back_home"
    )
    refs = list(triggered)[:8]
    items: list[dict[str, Any]] = [
        {
            "type": "plain_explanation",
            "placement": "summary",
            "text": phrase("plain_explanation", language),
            "provider": provider,
            "latency_ms": latency_ms,
            "source_rule_ids": refs,
        },
        {
            "type": "family_message",
            "placement": "family",
            "text": phrase(fam_key, language),
            "provider": provider,
            "latency_ms": latency_ms,
            "source_rule_ids": refs,
        },
        {
            "type": "come_back",
            "placement": "summary",
            "text": phrase(come_key, language),
            "provider": provider,
            "latency_ms": latency_ms,
            "source_rule_ids": refs,
        },
        {
            "type": "nurse_summary",
            "placement": "nurse",
            "text": f"{phrase('nurse_summary', language)} ({decision_label(decision, language)})",
            "provider": provider,
            "latency_ms": latency_ms,
            "source_rule_ids": refs,
        },
    ]
    if decision == "urgent_refer":
        for key in ("do_now_1_urgent", "do_now_2_urgent", "do_now_3_urgent", "do_now_4_urgent"):
            items.append(
                {
                    "type": "do_now",
                    "placement": "summary",
                    "text": phrase(key, language),
                    "provider": provider,
                    "latency_ms": latency_ms,
                    "source_rule_ids": refs,
                }
            )
    missing = case.get("missing_info")
    if missing:
        items.append(
            {
                "type": "missing_info",
                "placement": "summary",
                "text": phrase("missing_info", language),
                "provider": provider,
                "latency_ms": latency_ms,
                "source_rule_ids": list(triggered)[:8],
            }
        )
    for chk in consistency_checks(case, language):
        items.append(
            {
                "type": "consistency_check",
                "placement": "summary",
                "text": chk["message"],
                "provider": provider,
                "latency_ms": latency_ms,
                "source_rule_ids": list(triggered)[:8],
            }
        )
    # Per-row plain explanations for triggered danger signs (Rules + AI Analysis)
    for rid in refs:
        if rid in DANGER_FIELDS:
            items.append(
                {
                    "type": "row_meaning",
                    "placement": f"row:{rid}",
                    "text": f"{_localize_factor_label(rid, language)}. {phrase('effect_critical', language)}.",
                    "provider": provider,
                    "latency_ms": latency_ms,
                    "source_rule_ids": [rid],
                }
            )
    return items


def _guardrail_explain(reason: str, language: str) -> dict[str, str]:
    """Plain-language AI explanation for a blocked reply (catalog, not free LLM)."""
    rw = (language or "").startswith("rw")
    catalog = {
        "urgency_downgrade": {
            "title_rw": "AI yagerageje kugabanya ubwihutirwa",
            "title_en": "AI tried to lower urgency",
            "why_rw": "Igisubizo cyavugaga ko umurwayi ari meza cyangwa nta kohereza. Amategeko afunze icyemezo; AI ntishobora kugabanya.",
            "why_en": "The reply said the patient is fine or needs no referral. Protocol locks the decision; AI cannot lower urgency.",
            "action_rw": "Komeza icyemezo gifunzwe. Ohereza nk'uko amabwiriza abivuga.",
            "action_en": "Keep the locked decision. Refer as the protocol requires.",
        },
        "invented_dose": {
            "title_rw": "AI yavuze doze / umuti udafite mu mabwiriza",
            "title_en": "AI invented a dose or medicine",
            "why_rw": "Igisubizo cyavuze amazina y'umuti cyangwa doze. Ibi ntabwo biri muri aya mabwiriza yo mu mudugudu.",
            "why_en": "The reply named a medicine or dose. Community protocol pack does not include dosing.",
            "action_rw": "Ntanga umuti. Baza umuforomo. Komeza kohereza.",
            "action_en": "Do not give medicine. Ask the nurse. Keep the referral.",
        },
        "invented_drug": {
            "title_rw": "AI yavuze umuti udafite mu mabwiriza",
            "title_en": "AI invented a drug name",
            "why_rw": "Izina ry'umuti ntabwo riri mu mabwiriza. AI ntishobora gutanga umuti.",
            "why_en": "That drug name is not in this protocol pack. AI must not prescribe.",
            "action_rw": "Ntanga umuti. Kurikiza icyemezo gifunzwe.",
            "action_en": "Do not give medicine. Follow the locked decision.",
        },
    }
    row = catalog.get(reason) or {
        "title_rw": "Igisubizo cyahagaritswe n'igenzura",
        "title_en": "Reply blocked by safety check",
        "why_rw": "Igisubizo nticyemewe n'igenzura ry'umutekano.",
        "why_en": "The reply failed a safety check.",
        "action_rw": "Komeza icyemezo cya protocole.",
        "action_en": "Keep the protocol decision.",
    }
    return {
        "title": row["title_rw"] if rw else row["title_en"],
        "why": row["why_rw"] if rw else row["why_en"],
        "action": row["action_rw"] if rw else row["action_en"],
    }


def apply_ai_guardrail(
    texts: list[str],
    locked_decision: str,
    language: str = "en",
) -> tuple[list[str], dict[str, Any]]:
    kept: list[str] = []
    blocked: list[dict[str, Any]] = []
    urgency_blocked = False
    dose_filtered = False
    for t in texts:
        reason = rejection_reason(t, locked_decision)
        if reason:
            expl = _guardrail_explain(reason, language)
            blocked.append(
                {
                    "text": t[:200],
                    "reason": reason,
                    "title": expl["title"],
                    "why": expl["why"],
                    "action": expl["action"],
                    "ai_explained": True,
                }
            )
            if reason == "urgency_downgrade":
                urgency_blocked = True
            if reason in {"invented_dose", "invented_drug"}:
                dose_filtered = True
        else:
            kept.append(t)
    rw = (language or "").startswith("rw")
    if blocked:
        ai_summary = (
            "AI yagerageje gusubiza nabi; igenzura ryabihagaritse. Icyemezo gifunzwe nticyahindutse."
            if rw
            else "AI produced an unsafe reply; the safety lock blocked it. The locked decision is unchanged."
        )
    else:
        ai_summary = (
            "Nta gisubizo cyabuze igenzura. AI isobanura gusa."
            if rw
            else "No unsafe AI reply detected. AI explains only."
        )
    return kept, {
        "urgency_lowered_blocked": urgency_blocked,
        "blocked_items": blocked,
        "drug_or_dose_filtered": dose_filtered,
        "ai_summary": ai_summary,
    }


def build_ai_trace(
    case: dict[str, Any],
    result: dict[str, Any],
    *,
    language: str = "rw",
    ai_texts: list[str] | None = None,
    provider_used: str = "local",
    latency_ms: int = 0,
    fallback_reason: str | None = None,
) -> dict[str, Any]:
    t0 = time.time()
    snap = sanitize_case_snapshot({**case, **result, "language": language})
    decision = str(result.get("decision") or "treat_at_home")
    rules_decision = str(result.get("rules_decision") or decision)
    triggered = list(result.get("triggered_rules") or [])
    triggered_set = set(triggered)

    contributions = []
    for field in (
        DANGER_FIELDS
        + BLOOD_TRI_FIELDS
        + BLOOD_OPTIONAL_FIELDS
        + ["temperature_c", "fever_days", "tdr_result", "age_months"]
    ):
        contributions.append(_contribution_for_field(field, case, triggered_set))

    ai_added = build_local_ai_added(
        {**case, "missing_info": result.get("missing_info")},
        decision,
        triggered,
        language,
        provider=provider_used or "local",
        latency_ms=latency_ms,
    )
    # Merge optional LLM texts (guarded)
    raw_texts = list(ai_texts or [])
    kept, guard = apply_ai_guardrail(raw_texts, rules_decision, language=language)
    for text in kept:
        ai_added.append(
            {
                "type": "plain_explanation",
                "text": text,
                "provider": provider_used or "local",
                "latency_ms": latency_ms,
                "source_rule_ids": triggered[:8],
            }
        )

    now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    pipeline = [
        {"id": "inputs", "status": "done", "provider": "chw", "latency_ms": 0, "timestamp": now, "locked": False},
        {
            "id": "rules",
            "status": "done",
            "provider": "protocol",
            "latency_ms": 0,
            "timestamp": now,
            "locked": True,
            "decision": rules_decision,
            "decision_label": decision_label(rules_decision, language),
        },
        {
            "id": "ml",
            "status": "done" if result.get("severe_risk") is not None else "skipped",
            "provider": "ml_local",
            "latency_ms": 0,
            "timestamp": now,
            "locked": False,
            "escalated_by_ml": bool(result.get("ml_escalated")),
        },
        {
            "id": "ai_language",
            "status": "done",
            "provider": provider_used or "local",
            "latency_ms": latency_ms,
            "timestamp": now,
            "locked": False,
            "fallback_reason": fallback_reason,
        },
        {"id": "chw_confirm", "status": "pending", "provider": "chw", "latency_ms": 0, "timestamp": now, "locked": False},
    ]

    severe = result.get("severe_risk")
    referral = result.get("referral_noncompletion_risk")
    factors = _ml_factors(list(result.get("shap_factors") or []), language)
    rw = (language or "").startswith("rw")
    severe_pct = int(round(float(severe) * 100)) if isinstance(severe, (int, float)) else None
    referral_pct = int(round(float(referral) * 100)) if isinstance(referral, (int, float)) else None

    def _score_analysis(kind: str, score: Any, pct: int | None) -> dict[str, Any]:
        missing_pct_rw = "ntabwo ahari"
        missing_pct_en = "unavailable"
        steps = []
        if rw:
            steps = [
                "1) Model ya demo isoma ibisubizo (ibimenyetso, ubushyuhe, TDR, imyaka).",
                "2) Iteganya amanota y'akaga hagati ya 0 na 1 (hano: "
                + (f"{pct}%" if pct is not None else "ntabwo ahari")
                + ").",
                "3) SHAP yerekana impamvu zikomeye (hepfo).",
                "4) ML ishobora gusa kongera ubwihutirwa; ntabwo igabanya icyemezo cya protocole.",
                "5) CHW ni we wemeza icyemezo mbere yo gukora.",
            ]
            pct_text = f"{pct}%" if pct is not None else missing_pct_rw
            how = (
                f"Amanota ya {('uburemere' if kind == 'severity' else 'kutagera ku kigo')} "
                f"ni {pct_text}. Ni signal ya architecture demo, si ubushobozi bwa kliniki."
            )
            if kind == "severity" and result.get("ml_escalated"):
                how += " ML yongeye ubwihutirwa kuri iki cyemezo."
            elif kind == "severity":
                how += " Amategeko yarigeze ubwihutirwa; ML ntiyongeyeho."
        else:
            steps = [
                "1) Demo model reads case features (danger signs, fever, RDT, age).",
                "2) It outputs a risk score from 0 to 1 (here: "
                + (f"{pct}%" if pct is not None else "unavailable")
                + ").",
                "3) SHAP lists the strongest contributing factors (below).",
                "4) ML may only raise urgency; it never lowers the protocol decision.",
                "5) The CHW must confirm before acting.",
            ]
            pct_text = f"{pct}%" if pct is not None else missing_pct_en
            how = (
                f"{'Severity' if kind == 'severity' else 'Facility-reach'} risk is "
                f"{pct_text}. Architecture-demo signal only, not clinical performance."
            )
            if kind == "severity" and result.get("ml_escalated"):
                how += " ML raised urgency for this case."
            elif kind == "severity":
                how += " Rules already set urgency; ML did not escalate further."
        return {
            "how": how,
            "steps": steps,
            "factors": factors,
            "escalated_by_ml": bool(result.get("ml_escalated")) if kind == "severity" else False,
            "can_only_escalate": True,
            "synthetic": True,
            "score": score,
            "score_pct": pct,
        }

    return {
        "pipeline": pipeline,
        "rules": {
            "decision": rules_decision,
            "decision_label": decision_label(rules_decision, language),
            "final_decision": decision,
            "final_decision_label": decision_label(decision, language),
            "triggered_rule_ids": triggered,
            "contributions": contributions,
            "inform_nurse_fields": list(result.get("inform_nurse_fields") or []),
            "pending_blood_clinical_validation": bool(result.get("pending_blood_clinical_validation")),
        },
        "ml": {
            "urgency_risk": {
                "score": severe,
                "meaning": phrase("ml_urgency_meaning", language),
                "label_key": "severity_risk",
                "analysis": _score_analysis("severity", severe, severe_pct),
            },
            "referral_followup_risk": {
                "score": referral,
                "meaning": phrase("ml_referral_meaning", language),
                "label_key": "referral_followup_risk",
                "analysis": _score_analysis("referral", referral, referral_pct),
            },
            "top_factors": factors,
            "escalated_by_ml": bool(result.get("ml_escalated")),
            "synthetic": True,
            "can_only_escalate": True,
        },
        "ai_added": ai_added,
        "guardrail": guard,
        "consistency_checks": consistency_checks(case, language),
        "what_if": what_if_danger_flips(case, language),
        "prevention_plan": build_prevention_payload(
            {**case, "decision": decision, "tdr_result": case.get("tdr_result") or snap.get("tdr_result")},
            language=language,
        ),
        "impact": {
            "urgency_changed": "never_locked",
            "wording_items": len(ai_added),
            "checks_run": len(consistency_checks(case, language)) + len(guard.get("blocked_items") or []),
            "time_added_ms": latency_ms,
            "provider": provider_used or "local",
            "fallback_reason": fallback_reason,
            "fallback_chain": "gemini>groq>local",
        },
        "snapshot": snap,
        "build_ms": int((time.time() - t0) * 1000),
        "language": language,
    }


def compare_providers(
    case: dict[str, Any],
    result: dict[str, Any],
    *,
    language: str = "rw",
) -> dict[str, Any]:
    """Run the same explanation prompt on Gemini, Groq, Local (configured only)."""
    from app.config import settings
    from app.services.ai.orchestrator import orchestrate_chat

    locked = str(result.get("rules_decision") or result.get("decision") or "treat_at_home")
    prompt = (
        "In 2 short sentences for a CHW, explain why this malaria triage decision is locked. "
        f"Decision label: {decision_label(locked, language)}. "
        "Do not lower urgency. No drug names or doses. "
        f"Reply in language '{language}'."
    )
    providers = []
    for name, configured in (
        ("gemini", bool(settings.gemini_api_key)),
        ("groq", bool(settings.groq_api_key)),
        ("local", True),
    ):
        if not configured and name != "local":
            providers.append(
                {
                    "provider": name,
                    "status": "unavailable",
                    "reason": "no_key",
                    "answer": None,
                    "latency_ms": 0,
                    "agreement": None,
                }
            )
            continue
        if name == "local":
            t0 = time.perf_counter()
            text = phrase("plain_explanation", language) + " " + decision_label(locked, language)
            ms = int((time.perf_counter() - t0) * 1000)
            bad = rejection_reason(text, locked)
            providers.append(
                {
                    "provider": "local",
                    "status": "ok",
                    "answer": text,
                    "latency_ms": ms,
                    "agreement": "same_decision" if not bad else "differs",
                    "reason": bad,
                }
            )
            continue
        # Force single provider via order
        prev_order = settings.ai_provider_order
        try:
            settings.ai_provider_order = f"{name},local"
            out = orchestrate_chat(
                prompt,
                history=[],
                case={**case, "rules_decision": locked, "decision": result.get("decision")},
                language=language,
                task="compare",
                mode="cascade",
            )
            text = str(out.get("text") or "")
            bad = rejection_reason(text, locked)
            providers.append(
                {
                    "provider": name,
                    "status": "ok" if out.get("provider_used") == name else "fallback",
                    "answer": text,
                    "latency_ms": int(out.get("latency_ms") or 0),
                    "agreement": "same_decision" if not bad else "differs",
                    "reason": bad or out.get("fallback_reason"),
                    "provider_used": out.get("provider_used"),
                }
            )
        except Exception as exc:  # noqa: BLE001
            providers.append(
                {
                    "provider": name,
                    "status": "unavailable",
                    "reason": str(exc)[:120],
                    "answer": None,
                    "latency_ms": 0,
                    "agreement": None,
                }
            )
        finally:
            settings.ai_provider_order = prev_order

    agree = [p for p in providers if p.get("agreement") == "same_decision"]
    return {
        "ok": True,
        "providers": providers,
        "summary": {
            "agree_count": len(agree),
            "locked_decision_label": decision_label(locked, language),
        },
    }

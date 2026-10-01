"""LOCAL MODE: intent-matched protocol answers (not generative AI)."""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

import yaml

from app.services.ai.guardrails import sanitize_case_snapshot
from app.services.ai.protocol_retrieve import retrieve_protocol

REPO = Path(__file__).resolve().parents[5]
PROTOCOL = REPO / "docs" / "protocol" / "excerpts.md"
CLINICAL = REPO / "rules" / "clinical_config.yaml"


def local_limit_message(language: str = "en") -> str:
    if (language or "").startswith("rw"):
        return "Igisubizo gikomoka ku mategeko n'amabwiriza."
    return "Answer based on protocol rules."


LOCAL_LIMIT = local_limit_message("en")

Intent = str
# case_summary | why | what_now | tell_family | return_signs | prevention | rdt_meaning
# | referral_steps | general_malaria_info | follow_up | drugs | out_of_scope | unknown

INTENT_PATTERNS: list[tuple[Intent, re.Pattern[str]]] = [
    (
        "case_summary",
        re.compile(
            r"\b("
            r"parle\s*moi|parlez[-\s]?moi|dis[-\s]?moi|raconte|tell me about|about the (patient|child|case)|"
            r"who is (this|the) (patient|child)|summarize|summary|imiterere|mbwira|sobanura umwana|"
            r"uyu murwayi|this (patient|child|case)|patient info|case overview|"
            r"souffre|souffres|de quoi|what('s| is) wrong|what does .+ (have|suffer)|"
            r"which danger signs|danger signs (were )?reported|ibimenyetso by[' ]akaga|"
            r"signes? de danger"
            r")\b|\bdu patient\b|\babout (him|her|them)\b",
            re.I,
        ),
    ),
    (
        "why",
        re.compile(
            r"^\s*(why|kuki|pourquoi|impamvu)\b|"
            r"\b(why|kuki|impamvu|pourquoi)\b|"
            r"\b(which rules|what rules|quelles? règles?|amategeko ki|rules? triggered|triggered this)\b|"
            r"\bwhy this decision\b|\bkuki iki cyemezo\b|\bpourquoi cette décision\b",
            re.I,
        ),
    ),
    (
        "what_now",
        re.compile(
            r"\b("
            r"what (should|do|can) (i|we) do|what now|what to do|que (puis[- ]je|peut[- ]on|pouvons[- ]nous)?\s*faire|"
            r"que faire|nakora|ngomba gukora|icyo gukora|suggestions?|"
            r"maintenant|maintenant\s*\?|based on all (my )?(triage )?answers|"
            r"treat at home|urgent transfer|not positive|"
            r"suggestion|recommandation|recommendation|advice|conseil"
            r")\b",
            re.I,
        ),
    ),
    (
        "tell_family",
        re.compile(
            r"\b(family|umuryango|tell the family|what (should|do) i tell|explique[rz]? (à|a) (la )?famille|"
            r"dire à la famille|sobanura (umuryango)?)\b",
            re.I,
        ),
    ),
    (
        "return_signs",
        re.compile(
            r"\b(come back|when (should|do)|return sign|when to return|garuka|ibimenyetso|"
            r"bazagaruka|revenir|signes? d[' ]alerte)\b",
            re.I,
        ),
    ),
    (
        "prevention",
        re.compile(
            r"\b(prevent\w*|prévenir|prevention|prévention|kwirinda|net|moustiquaire|"
            r"paludisme chez|éviter le paludisme|comment prévenir)\b",
            re.I,
        ),
    ),
    (
        "rdt_meaning",
        re.compile(
            r"\b("
            r"rdt|tdr|test (result|positif|négatif|positive|negative)|rapide|"
            r"positive|negative|positif|négatif|pozitif|"
            r"is (the |this |it )?(patient |child )?(positive|negative)|"
            r"patient (positive|negative)|positif\s*\?|négatif\s*\?"
            r")\b",
            re.I,
        ),
    ),
    (
        "data_query",
        re.compile(
            r"\b("
            r"how many|how much|count|stats|numbers|dashboard|kpi|analytics|"
            r"pending referral|overdue|my count|activity count|patients treated|patients seen|"
            r"combien|nombre|statistiques|alertes en retard|"
            r"mbarwa|ibanga|ibibarura|bangahe|"
            r"today|this week|aujourd|"
            r"pending|inbox"
            r")\b",
            re.I,
        ),
    ),
    (
        "referral_steps",
        re.compile(
            r"\b(referral steps|how to refer|transport|ohereza|référence|transfert)\b|\brefer\b",
            re.I,
        ),
    ),
    (
        "follow_up",
        re.compile(r"\b(follow[-\s]?up|suivi|garuka|prochaine visite|next visit)\b", re.I),
    ),
    (
        "general_malaria_info",
        re.compile(r"\b(what is malaria|c[' ]est quoi (le )?paludisme|malaria (is|means)|paludisme)\b", re.I),
    ),
    (
        "drugs",
        re.compile(
            r"\b(drug|dose|paracetamol|acetaminophen|medicine|tablet|umuti|artesunate|give)\b",
            re.I,
        ),
    ),
    (
        "patient",
        re.compile(
            r"\b(patient|umurwayi|child|umwana|how old|age|imyaka|sex|igitsina|"
            r"this case|signs|ibimenyetso|status|imiterere)\b",
            re.I,
        ),
    ),
]


def detect_intent(message: str) -> Intent:
    text = message or ""
    for intent, pat in INTENT_PATTERNS:
        if pat.search(text):
            return intent
    return "unknown"


def detect_answer_language(message: str, ui_language: str = "en") -> str:
    """Answer in the language of the question; UI language breaks ties."""
    t = (message or "").strip()
    ui = (ui_language or "en")[:2].lower()
    if ui not in {"rw", "en", "fr"}:
        ui = "en"
    fr_score = 0
    en_score = 0
    rw_score = 0
    if re.search(r"[àâäéèêëïîôùûüçœæ]", t, re.I):
        fr_score += 2
    # Do NOT treat bare "patient" as French (shared with English).
    if re.search(
        r"\b(le|la|les|des|du|de|un|une|je|vous|parle|pourquoi|prévenir|famille|"
        r"souffre|quoi|faire|maintenant|référence|paludisme|comment|est[- ]ce|"
        r"positif|négatif|référer)\b",
        t,
        re.I,
    ):
        fr_score += 2
    if re.search(
        r"\b(murakoze|umwana|umuryango|kuki|nakora|ibimenyetso|ohereza|amezi|ngomba|"
        r"sobanura|icyemezo|mbwira)\b",
        t,
        re.I,
    ):
        rw_score += 2
    if re.search(
        r"\b(the|what|why|how|should|tell|family|prevent|now|about|is|are|was|"
        r"positive|negative|patient|child)\b",
        t,
        re.I,
    ):
        en_score += 2
    # Strong French only with article + patient / souffre
    if re.search(r"\b(le|du|un|ce)\s+patient\b", t, re.I) or re.search(r"\bsouffre", t, re.I):
        fr_score += 3
    best = max(fr_score, en_score, rw_score)
    if best == 0:
        return ui
    winners = [lang for lang, score in (("fr", fr_score), ("en", en_score), ("rw", rw_score)) if score == best]
    if len(winners) > 1:
        return ui if ui in winners else winners[0]
    return winners[0]


def load_clinical_meta() -> dict[str, Any]:
    if not CLINICAL.exists():
        return {"validated": False, "protocol_version": "unknown", "protocol_name": "unknown"}
    data = yaml.safe_load(CLINICAL.read_text(encoding="utf-8")) or {}
    meta = data.get("meta") or {}
    version = str(meta.get("protocol_version") or "")
    validated = "TODO_CLINICAL_REVIEW" not in version and not bool(meta.get("synthetic_demo"))
    return {
        "validated": validated,
        "protocol_version": version,
        "protocol_name": meta.get("protocol_name") or "",
        "source_file": "rules/clinical_config.yaml",
    }


_DANGER_LABELS = {
    "convulsions": {"rw": "gusetsa", "en": "convulsions", "fr": "convulsions"},
    "unable_to_drink": {
        "rw": "ntashobora kunywa",
        "en": "unable to drink",
        "fr": "incapable de boire",
    },
    "vomiting_everything": {
        "rw": "kuraruka byose",
        "en": "vomiting everything",
        "fr": "vomissements de tout",
    },
    "lethargy": {
        "rw": "gucika intege / ntabona",
        "en": "lethargy or unconsciousness",
        "fr": "léthargie ou inconscience",
    },
    "severe_breathing_difficulty": {
        "rw": "agorwa n'uruhuha",
        "en": "severe breathing difficulty",
        "fr": "détresse respiratoire sévère",
    },
}


def _lang3(language: str) -> str:
    l = (language or "en")[:2].lower()
    return l if l in {"rw", "en", "fr"} else "en"


def _label_danger(key: str, language: str) -> str:
    row = _DANGER_LABELS.get(key) or {}
    lang = _lang3(language)
    return str(row.get(lang) or row.get("en") or key)


def _decision_title(decision: str, language: str) -> str:
    lang = _lang3(language)
    table = {
        "treat_at_home": {
            "rw": "Uvure / gukurikirana mu rugo",
            "en": "Treat / monitor locally",
            "fr": "Traiter / surveiller à domicile",
        },
        "refer": {
            "rw": "Ohereza",
            "en": "Refer to health center",
            "fr": "Référer au centre de santé",
        },
        "urgent_refer": {
            "rw": "Kohereza byihutirwa",
            "en": "Urgent referral",
            "fr": "Référence urgente",
        },
    }
    return (table.get(decision) or {}).get(lang) or decision


def _fired_danger(case: dict[str, Any]) -> list[str]:
    danger = case.get("danger_signs") or {}
    if not isinstance(danger, dict):
        danger = {}
    out = []
    for k in _DANGER_LABELS:
        if case.get(k) or danger.get(k):
            out.append(k)
    return out


def recommendation_card(case: dict[str, Any], language: str = "en") -> dict[str, Any]:
    snap = sanitize_case_snapshot(case)
    decision = str(case.get("rules_decision") or case.get("decision") or "treat_at_home")
    meta = load_clinical_meta()
    lang = _lang3(language)
    title = _decision_title(decision, lang)

    triggered = list(case.get("triggered_rules") or [])
    why_bits: list[str] = []
    for rid in triggered[:3]:
        if rid in _DANGER_LABELS:
            lab = _label_danger(rid, lang)
            if lang == "rw":
                why_bits.append(f"{lab} byavuzwe")
            elif lang == "fr":
                why_bits.append(f"{lab} signalé(e)")
            else:
                why_bits.append(f"{lab.capitalize()} was reported")
        elif rid == "invalid_tdr_refer":
            why_bits.append(
                "TDR ntabwo yemewe" if lang == "rw" else ("TDR non valide" if lang == "fr" else "Invalid RDT")
            )
        elif rid == "infant_age_referral":
            why_bits.append(
                "Imyaka y'umwana muto"
                if lang == "rw"
                else ("Tranche d'âge nourrisson" if lang == "fr" else "Young-infant age band")
            )
    if not why_bits:
        for k in _fired_danger(case)[:2]:
            lab = _label_danger(k, lang)
            if lang == "rw":
                why_bits.append(f"{lab} byavuzwe")
            elif lang == "fr":
                why_bits.append(f"{lab} signalé(e)")
            else:
                why_bits.append(f"{lab.capitalize()} was reported")
    if not why_bits:
        why_bits.append(
            "Amategeko ntiyabonye ikimenyetso cy'akaga."
            if lang == "rw"
            else (
                "Les règles n'ont pas trouvé de signe de danger sur les réponses."
                if lang == "fr"
                else "Rules found no danger-sign trigger on the answered fields."
            )
        )

    catalogs = {
        "urgent_refer": {
            "rw": {
                "steps": [
                    "Komeza uri hafi y'umurwayi; ntutinye.",
                    "Tegura gutwara umwana ku kigo nderabuzima byihutirwa.",
                    "Bwirira umuforomo ibimenyetso by'akaga n'igisubizo cya TDR.",
                    "Ntanga doze zo mu mudugudu. Ntabwo ziri muri aya mabwiriza.",
                ],
                "family": "Sobanurira umuryango ko hari ibimenyetso by'akaga. Bagende ku kigo nderabuzima NONAHA.",
                "when": "Genda nonaha. Kurikiranira niba aruhuha byongereye, gusetsa, cyangwa ntashobora kunywa.",
            },
            "fr": {
                "steps": [
                    "Restez auprès du patient; ne tardez pas.",
                    "Organisez un transport urgent vers le centre de santé.",
                    "Informez l'infirmier des signes de danger et du résultat TDR.",
                    "Ne donnez pas de doses communautaires. Pas dans ce protocole.",
                ],
                "family": "Expliquez à la famille que des signes de danger exigent des soins urgents maintenant.",
                "when": "Partez maintenant. Surveillez la respiration, les convulsions, ou l'incapacité à boire.",
            },
            "en": {
                "steps": [
                    "Stay with the patient. Do not delay.",
                    "Arrange urgent transport to the health center.",
                    "Tell the nurse the danger signs and RDT result.",
                    "Do not give community doses. Not in this protocol pack.",
                ],
                "family": "Explain that danger signs require urgent facility care now.",
                "when": "Go now. Watch for worsening breathing, fits, or inability to drink.",
            },
        },
        "refer": {
            "rw": {
                "steps": [
                    "Tegura incamake yo kohereza.",
                    "Ohereza umurwayi ku kigo nderabuzima uyu munsi.",
                    "Sobanurira umurezi ibimenyetso by'akaga mu nzira.",
                ],
                "family": "Sobanura impamvu yo kohereza. Bazane igisubizo cya TDR niba kibonetse.",
                "when": "Garuka vuba niba ibimenyetso by'akaga bigaragara. Kurikiza amabwiriza y'ikigo.",
            },
            "fr": {
                "steps": [
                    "Préparez un résumé de référence.",
                    "Envoyez le patient au centre de santé aujourd'hui.",
                    "Conseils sur les signes de danger pendant le trajet.",
                ],
                "family": "Expliquez pourquoi la référence est nécessaire et quoi apporter (TDR si disponible).",
                "when": "Revenez plus tôt si des signes de danger apparaissent.",
            },
            "en": {
                "steps": [
                    "Prepare a referral handover summary.",
                    "Send the patient to the health facility today.",
                    "Advise caregiver on danger signs while traveling.",
                ],
                "family": "Explain why referral is needed and what to bring (RDT result if available).",
                "when": "Return sooner if danger signs appear. Otherwise follow facility advice.",
            },
        },
        "treat_at_home": {
            "rw": {
                "steps": [
                    "Zuza ibibazo byasigaye niba bikenewe.",
                    "Tanga inama zo kuvura mu rugo no gukurikirana ubushyuhe.",
                    "Sobanura ibimenyetso by'akaga bisaba kugaruka vuba.",
                ],
                "family": "Kurikiranira gusetsa, kutashobora kunywa, kuraruka byose, gucika intege, cyangwa agorwa n'uruhuha.",
                "when": "Garuka niba ubushyuhe bukomeje cyangwa hakagaragara ikimenyetso cy'akaga.",
            },
            "fr": {
                "steps": [
                    "Complétez les questions manquantes si besoin.",
                    "Conseils de suivi de la fièvre à domicile selon le protocole.",
                    "Expliquez les signes de danger qui exigent un retour immédiat.",
                ],
                "family": "Surveillez convulsions, incapacité à boire, vomissements de tout, léthargie, détresse respiratoire.",
                "when": "Revenez si la fièvre persiste ou si un signe de danger apparaît.",
            },
            "en": {
                "steps": [
                    "Complete any missing assessment questions if still open.",
                    "Advise home care and fever follow-up per protocol.",
                    "Explain danger signs that require immediate return.",
                ],
                "family": "Watch for fits, inability to drink, vomiting everything, lethargy, or severe breathing difficulty.",
                "when": "Come back if fever persists or any danger sign appears.",
            },
        },
    }
    pack = (catalogs.get(decision) or catalogs["treat_at_home"])[lang]
    urgency = "urgent" if decision == "urgent_refer" else ("routine" if decision == "refer" else "none")
    return {
        "title": title,
        "decision": decision,
        "why": why_bits[:2],
        "what_to_do_now": pack["steps"],
        "what_to_tell_family": pack["family"],
        "when_to_come_back": pack["when"],
        "referral": {"needed": decision != "treat_at_home", "urgency": urgency},
        "protocol_meta": meta,
        "age_band": snap.get("age_band"),
        "sex": snap.get("sex"),
        "label": (
            "Inama ivuye ku mategeko."
            if lang == "rw"
            else (
                "Recommandation issue du protocole (règles)."
                if lang == "fr"
                else "Protocol-sourced recommendation (rules)."
            )
        ),
    }


def _patient_card_block(case: dict[str, Any] | None, card: dict[str, Any], lang: str) -> dict[str, Any]:
    c = case or {}
    fired = _fired_danger(c)
    sex = str(c.get("sex") or "")
    sex_l = {
        "fr": {"male": "garçon", "female": "fille"}.get(sex.lower(), sex or "non précisé"),
        "rw": {"male": "gabo", "female": "gore"}.get(sex.lower(), sex or "ntibivugwa"),
        "en": sex or "not recorded",
    }[lang if lang in {"fr", "rw", "en"} else "en"]
    tdr = str(c.get("tdr_result") or "")
    tdr_l = {
        "positive": {"fr": "positif", "en": "positive", "rw": "positive"},
        "negative": {"fr": "négatif", "en": "negative", "rw": "negative"},
        "invalid": {"fr": "non valide", "en": "invalid", "rw": "ntabwo yemewe"},
    }.get(tdr, {}).get(lang, tdr or ("non précisé" if lang == "fr" else ("ntibivugwa" if lang == "rw" else "not recorded")))
    signs = [_label_danger(k, lang) for k in fired]
    return {
        "type": "patient_card",
        "age_months": c.get("age_months"),
        "sex": sex_l,
        "tdr": tdr_l,
        "temperature_c": c.get("temperature_c"),
        "fever_days": c.get("fever_days"),
        "signs": signs,
        "decision": card.get("title"),
        "decision_code": card.get("decision"),
    }


def _format_data_reply(lang: str, facts: dict[str, Any] | None) -> str | None:
    if not facts:
        return None
    if facts.get("auth_required"):
        return {
            "en": "Sign in to see your activity and referral counts.",
            "fr": "Connectez-vous pour voir vos chiffres d'activité et de références.",
            "rw": "Injira kugira ngo urebe ibibarura byawe n'ubwoherezwa.",
        }[lang if lang in {"en", "fr", "rw"} else "en"]
    tools = facts.get("tools") or {}
    parts: list[str] = []
    for _name, payload in tools.items():
        if not isinstance(payload, dict) or not payload.get("ok"):
            if payload.get("denied"):
                continue
            continue
        if payload.get("tool") == "get_my_counts":
            t = payload.get("today") or {}
            w = payload.get("week") or {}
            if lang == "fr":
                parts.append(
                    f"Aujourd'hui: {t.get('patients_seen', 0)} vus, {t.get('patients_treated', 0)} traités. "
                    f"Cette semaine: {w.get('patients_seen', 0)} vus."
                )
            elif lang == "rw":
                parts.append(
                    f"Uyu munsi: abarwayi {t.get('patients_seen', 0)}, bapfushijwe {t.get('patients_treated', 0)}. "
                    f"Iki cyumweru: {w.get('patients_seen', 0)}."
                )
            else:
                parts.append(
                    f"Today: {t.get('patients_seen', 0)} seen, {t.get('patients_treated', 0)} treated. "
                    f"This week: {w.get('patients_seen', 0)} seen."
                )
        elif payload.get("tool") == "get_pending_referrals":
            n = payload.get("pending_total", 0)
            u = payload.get("pending_urgent", 0)
            if lang == "fr":
                parts.append(f"Références en attente: {n} ({u} urgentes).")
            elif lang == "rw":
                parts.append(f"Uwoherezwa utegereje: {n} ({u} byihutirwa).")
            else:
                parts.append(f"Pending referrals: {n} ({u} urgent).")
        elif payload.get("tool") == "get_overdue_alerts":
            n = payload.get("overdue_total", 0)
            if lang == "fr":
                parts.append(f"Alertes en retard (non arrivés): {n}.")
            elif lang == "rw":
                parts.append(f"Amatangazo atageze: {n}.")
            else:
                parts.append(f"Overdue not-arrived alerts: {n}.")
        elif payload.get("tool") == "get_treated_counts":
            parts.append(
                {
                    "fr": f"Traités aujourd'hui: {payload.get('today_treated', 0)}.",
                    "rw": f"Bapfushijwe uyu munsi: {payload.get('today_treated', 0)}.",
                    "en": f"Treated today: {payload.get('today_treated', 0)}.",
                }[lang if lang in {"en", "fr", "rw"} else "en"]
            )
        elif payload.get("tool") == "get_facility_kpis":
            if lang == "fr":
                parts.append(
                    f"Cas aujourd'hui (zone): {payload.get('cases_today', 0)}. "
                    f"Références urgentes: {payload.get('urgent_referrals_today', 0)}."
                )
            elif lang == "rw":
                parts.append(
                    f"Indwara uyu munsi: {payload.get('cases_today', 0)}. "
                    f"Uwoherezwa byihutirwa: {payload.get('urgent_referrals_today', 0)}."
                )
            else:
                parts.append(
                    f"Cases today (scope): {payload.get('cases_today', 0)}. "
                    f"Urgent referrals: {payload.get('urgent_referrals_today', 0)}."
                )
    if not parts:
        return {
            "en": "No counts available for your role, or data is empty.",
            "fr": "Aucun chiffre disponible pour votre rôle, ou données vides.",
            "rw": "Nta mibare iboneka ku ruhare rwawe, cyangwa nta makuru.",
        }[lang if lang in {"en", "fr", "rw"} else "en"]
    lead = {
        "en": "**Here are your real numbers from the app** (not guessed):",
        "fr": "**Voici vos vrais chiffres depuis l'application** (pas inventés):",
        "rw": "**Dore imibare yawe nyayo iva mu app** (ntabwo byahanutse):",
    }[lang if lang in {"en", "fr", "rw"} else "en"]
    return lead + "\n\n" + "\n".join(f"- {p}" for p in parts)


def _section_text(
    intent: Intent,
    language: str,
    case: dict[str, Any] | None,
    *,
    data_facts: dict[str, Any] | None = None,
    use_case: bool = True,
) -> tuple[str, list[dict[str, str]], list[dict[str, Any]]]:
    lang = _lang3(language)
    decision = "treat_at_home"
    if case:
        decision = str(case.get("rules_decision") or case.get("decision") or decision)
    card = recommendation_card(case or {"rules_decision": decision}, language=lang)
    blocks: list[dict[str, Any]] = []

    if intent == "data_query":
        text = _format_data_reply(lang, data_facts)
        if text:
            return text, [{"title": "data_tools", "id": "server"}], blocks
        text = {
            "en": "Ask about today's counts, pending referrals, or overdue alerts.",
            "fr": "Demandez les chiffres du jour, références en attente ou alertes en retard.",
            "rw": "Baza ibibarura by'uyu munsi, uwoherezwa cyangwa amatangazo.",
        }[lang]
        return text, [], blocks

    if intent == "drugs":
        msg = {
            "rw": (
                "**Ntabwo nshobora gutanga umuti cyangwa doze.** "
                "Iyi app ntabwo igira amabwiriza yo gutanga imiti. "
                "Baza umuforomo ku kigo nderabuzima, kandi kurikiza icyemezo cy'amategeko."
            ),
            "fr": (
                "**Je ne peux pas donner de médicament ni de dose.** "
                "Cette app ne prescrit pas. "
                "Demandez à l'infirmier du centre, et suivez la décision du protocole."
            ),
            "en": (
                "**I cannot give a drug name or dose.** "
                "This app does not prescribe. "
                "Ask the nurse at the facility, and follow the protocol decision."
            ),
        }[lang]
        return msg, retrieve_protocol("dose medicine pre-referral", limit=2), blocks

    if intent == "why":
        why_items = list(card["why"][:5])
        label = str(card.get("title") or decision)
        fired = _fired_danger(case or {})
        signs = ", ".join(_label_danger(k, lang) for k in fired)
        blocks.append({"type": "bullets", "items": why_items})
        if lang == "fr":
            text = (
                f"**Pourquoi cette décision ?** Le protocole a choisi **{label}**.\n\n"
                + (
                    f"Les signes rapportés qui déclenchent la règle: {signs}.\n\n"
                    if fired
                    else ""
                )
                + "Je m'appuie sur vos réponses et les règles RBC. "
                "Je ne baisse jamais l'urgence. Si vous voulez, je peux dire quoi faire maintenant."
            )
        elif lang == "rw":
            text = (
                f"**Kuki iki cyemezo?** Amategeko yahisemo **{label}**.\n\n"
                + (f"Ibimenyetso byavuzwe: {signs}.\n\n" if fired else "")
                + "Ikoresha ibisubizo byawe n'amategeko. "
                "Ntabwo ngabanya ubwihutirwa. Nshobora kukubwira icyo gukora none."
            )
        else:
            text = (
                f"**Why this decision?** The protocol chose **{label}**.\n\n"
                + (f"Reported signs that trigger the rule: {signs}.\n\n" if fired else "")
                + "I use your answers and RBC rules only. "
                "I never lower urgency. Ask what to do now if you want next steps."
            )
        return text, retrieve_protocol("danger signs urgent referral", limit=3), blocks

    if intent in {"what_now", "referral_steps", "referral"}:
        steps = list(card["what_to_do_now"][:5])
        blocks.append({"type": "checklist", "items": steps})
        tdr = str((case or {}).get("tdr_result") or "")
        fired = _fired_danger(case or {})
        signs = ", ".join(_label_danger(k, lang) for k in fired)
        if decision == "urgent_refer":
            bucket_fr = "**Transfert urgent**"
            bucket_rw = "**Kohereza byihutirwa**"
            bucket_en = "**Urgent transfer**"
        elif decision == "refer":
            bucket_fr = "**Référer aujourd'hui** (pas le plus urgent, mais pas traitement seul à domicile)"
            bucket_rw = "**Ohereza uyu munsi** (ntibihutirwa cyane, ariko sivura wenyine)"
            bucket_en = "**Refer today** (not the highest urgency, but not home-only care)"
        elif tdr == "negative":
            bucket_fr = "**TDR non positif** — surveiller / conseils à domicile selon le protocole"
            bucket_rw = "**TDR ntabwo yemeza malariya** — gukurikirana mu rugo hakurikijwe amabwiriza"
            bucket_en = "**RDT not positive** — monitor / home advice per protocol"
        else:
            bucket_fr = "**Traiter / surveiller à domicile** — pas de signe de danger forçant un transfert urgent"
            bucket_rw = "**Uvure / gukurikirana mu rugo** — nta kimenyetso cy'akaga gisaba kohereza byihutirwa"
            bucket_en = "**Treat / monitor locally** — no danger sign forcing urgent transfer"
        if lang == "fr":
            text = (
                f"{bucket_fr}. Décision du protocole: **{card['title']}**.\n\n"
                + (f"Signes rapportés: {signs}.\n\n" if signs else "")
                + (f"Résultat TDR: **{tdr}**.\n\n" if tdr else "")
                + "Faites chaque étape ci-dessous. Pas de doses communautaires dans ce protocole."
            )
        elif lang == "rw":
            text = (
                f"{bucket_rw}. Icyemezo: **{card['title']}**.\n\n"
                + (f"Ibimenyetso byavuzwe: {signs}.\n\n" if signs else "")
                + (f"TDR: **{tdr}**.\n\n" if tdr else "")
                + "Kora buri ntambwe hepfo. Nta doze zo mu mudugudu muri aya mabwiriza."
            )
        else:
            text = (
                f"{bucket_en}. Protocol decision: **{card['title']}**.\n\n"
                + (f"Reported signs: {signs}.\n\n" if signs else "")
                + (f"RDT result: **{tdr}**.\n\n" if tdr else "")
                + "Follow each step below. No community drug doses in this protocol pack."
            )
        return text, retrieve_protocol("referral transport danger", limit=3), blocks

    if intent in {"tell_family", "family"}:
        quote = str(card["what_to_tell_family"])
        blocks.append({"type": "quote", "text": quote})
        if lang == "fr":
            text = (
                "**Voici un message clair à lire à la famille.** "
                "Parlez lentement, confirmez qu'ils ont compris, puis aidez pour le trajet."
            )
        elif lang == "rw":
            text = (
                "**Ubu ni ubutumwa bwumvikana bwo gusoma ku muryango.** "
                "Vuga gahoro, reba niba bumvise, hanyuma bafashe mu nzira."
            )
        else:
            text = (
                "**Here is a clear message to read to the family.** "
                "Speak slowly, check they understand, then help with transport."
            )
        return text, retrieve_protocol("caregiver family danger", limit=2), blocks

    if intent in {"return_signs", "come_back", "follow_up"}:
        when = str(card["when_to_come_back"])
        blocks.append({"type": "bullets", "items": [when]})
        if lang == "fr":
            text = (
                "**Quand revenir, et quoi surveiller.**\n\n"
                f"{when}\n\n"
                "Si un signe de danger apparaît, partez vers le centre sans attendre."
            )
        elif lang == "rw":
            text = (
                "**Igihe cyo kugaruka n'ibyo kureba.**\n\n"
                f"{when}\n\n"
                "Niba ikimenyetso cy'akaga kigaragara, bagende ku kigo batatinye."
            )
        else:
            text = (
                "**When to come back, and what to watch.**\n\n"
                f"{when}\n\n"
                "If any danger sign appears, go to the facility without delay."
            )
        return text, retrieve_protocol("danger signs return fever", limit=3), blocks

    if intent in {"case_summary", "patient"} and use_case and case:
        card_b = _patient_card_block(case, card, lang)
        blocks.append(card_b)
        signs = ", ".join(card_b["signs"]) or {
            "fr": "aucun signe de danger signalé",
            "rw": "nta kimenyetso cy'akaga cyavuzwe",
            "en": "no danger signs reported",
        }[lang]
        age = card_b.get("age_months")
        age_txt = (
            f"{age} mois"
            if lang == "fr" and age is not None
            else (f"amezi {age}" if lang == "rw" and age is not None else (f"{age} months" if age is not None else ""))
        )
        # Medical honesty: reported signs + protocol decision; no diagnosis
        if lang == "fr":
            text = (
                f"**Ce que nous savons sur ce patient:** {age_txt}, {card_b['sex']}.\n\n"
                f"Signes rapportés: {signs}. Résultat TDR: **{card_b['tdr']}**.\n\n"
                f"Décision du protocole: **{card['title']}**. "
                "Je décris ce qui a été signalé et ce que les règles ont décidé. "
                "Le diagnostic appartient au centre de santé."
            )
        elif lang == "rw":
            text = (
                f"**Ibyo tuzi kuri uyu murwayi:** {age_txt}, {card_b['sex']}.\n\n"
                f"Ibimenyetso byavuzwe: {signs}. TDR: **{card_b['tdr']}**.\n\n"
                f"Icyemezo cy'amategeko: **{card['title']}**. "
                "Nsobanura ibyavuzwe n'icyemezo cy'amategeko. "
                "Diagnosis ikorwa ku kigo nderabuzima."
            )
        else:
            text = (
                f"**What we know about this patient:** {age_txt}, {card_b['sex']}.\n\n"
                f"Reported signs: {signs}. RDT: **{card_b['tdr']}**.\n\n"
                f"Protocol decision: **{card['title']}**. "
                "I describe what was reported and what the rules decided. "
                "Diagnosis belongs to the health center."
            )
        return text, retrieve_protocol("danger signs urgent referral", limit=2), blocks

    if intent in {"rdt_meaning", "rdt"}:
        tdr = str((case or {}).get("tdr_result") or "")
        src = retrieve_protocol("tdr rdt malaria test", limit=3)
        if tdr == "positive":
            text = {
                "rw": (
                    "**Oya / Yego ku TDR:** Igisubizo cya TDR ni **positive** (yemeza malariya).\n\n"
                    f"Icyemezo cy'amategeko: **{card['title']}**. "
                    "Ntabwo ari diagnosis yo ku kigo; ni igisubizo cy'ikizamini n'amategeko."
                ),
                "fr": (
                    "**Réponse directe:** le TDR est **positif** (indique le paludisme).\n\n"
                    f"Décision du protocole: **{card['title']}**. "
                    "Ce n'est pas un diagnostic final du centre; c'est le résultat du test + les règles."
                ),
                "en": (
                    "**Direct answer:** the RDT is **positive** (malaria indicated on the test).\n\n"
                    f"Protocol decision: **{card['title']}**. "
                    "This is the test result plus rules, not a final facility diagnosis."
                ),
            }[lang]
        elif tdr == "negative":
            text = {
                "rw": (
                    "**Oya:** TDR ni **negative** (ntabwo yemeza malariya).\n\n"
                    f"Ariko amategeko ashya **{card['title']}** "
                    "(urugero: ubushyuhe bwohamye). Kurikiza icyemezo, ntibivugurure TDR."
                ),
                "fr": (
                    "**Réponse directe: non.** Le TDR est **négatif** (pas de paludisme indiqué par le test).\n\n"
                    f"Pourtant le protocole décide **{card['title']}** "
                    "(ex. fièvre persistante). Suivez cette décision; le TDR négatif ne l'annule pas."
                ),
                "en": (
                    "**Direct answer: no.** The RDT is **negative** (test does not indicate malaria).\n\n"
                    f"The protocol still says **{card['title']}** "
                    "(for example persistent fever). Follow that decision; a negative RDT does not cancel it."
                ),
            }[lang]
        elif tdr == "invalid":
            text = {
                "rw": (
                    "**TDR ntabwo yemewe.** Bisaba gusubiramo ikizamini cyangwa kohereza.\n\n"
                    f"Icyemezo cy'amategeko: **{card['title']}**."
                ),
                "fr": (
                    "**TDR non valide.** Refaire le test ou référer selon le protocole.\n\n"
                    f"Décision du protocole: **{card['title']}**."
                ),
                "en": (
                    "**The RDT is invalid.** Re-test or refer per protocol.\n\n"
                    f"Protocol decision: **{card['title']}**."
                ),
            }[lang]
        else:
            text = {
                "rw": f"TDR ntiyanditswe. Kurikiza icyemezo: **{card['title']}**.",
                "fr": f"TDR non précisé. Suivre la décision: **{card['title']}**.",
                "en": f"RDT was not recorded. Follow decision: **{card['title']}**.",
            }[lang]
        return text, src, blocks

    if intent == "prevention":
        items_txt: list[str] = []
        try:
            from app.services.prevention_plan import build_prevention_plan

            plan = build_prevention_plan(case or {}, language=lang)
            for it in (plan.get("items") or plan.get("protocol_items") or [])[:5]:
                msg = it.get("why_for_patient") or it.get("family_message")
                if msg:
                    items_txt.append(str(msg).strip())
        except Exception:
            items_txt = []
        if not items_txt:
            items_txt = {
                "fr": [
                    "Dormir sous moustiquaire chaque nuit",
                    "Enlever l'eau stagnante autour de la maison",
                    "Consulter tôt pour toute fièvre",
                ],
                "rw": [
                    "Kuryama mu mangu y'imiduga buri joro",
                    "Gukuraho amazi ahagaze",
                    "Jya ku kigo vuba niba hari ubushyuhe",
                ],
                "en": [
                    "Sleep under a treated net every night",
                    "Clear standing water around the home",
                    "Seek care early for any fever",
                ],
            }[lang]
        blocks.append({"type": "bullets", "items": items_txt, "why_caption": "prevention"})
        bullets = "\n".join(f"- {s}" for s in items_txt)
        if lang == "fr":
            text = (
                "**Oui. Voici des messages de prévention utiles** "
                "(catalogue en attente de validation clinique).\n\n"
                f"{bullets}\n\n"
                "Expliquez-les simplement à la famille. Pas de médicaments ni de doses ici."
            )
        elif lang == "rw":
            text = (
                "**Yego. Dore ubutumwa bwo kwirinda bufite akamaro** "
                "(birategereje kwemezwa n'umuganga).\n\n"
                f"{bullets}\n\n"
                "Bisobanurire umuryango mu magambo yoroshye. Nta miti cyangwa doze hano."
            )
        else:
            text = (
                "**Yes. Here are useful prevention messages** "
                "(catalog pending clinical validation).\n\n"
                f"{bullets}\n\n"
                "Explain them simply to the family. No drugs or doses here."
            )
        return text, [{"title": "prevention_catalog", "id": "prevention.yaml"}], blocks

    if intent == "general_malaria_info":
        text = {
            "fr": (
                "**Le paludisme est transmis par les moustiques.** "
                "Fièvre, frissons et signes de danger demandent une évaluation rapide.\n\n"
                "Dans ZeroMalaria, les règles du protocole décident de l'urgence. "
                "Posez une question précise (patient, prévention, que faire maintenant)."
            ),
            "rw": (
                "**Malariya itwarwa n'imiduga.** "
                "Ubushyuhe n'ibimenyetso by'akaga bisaba isuzuma ryihuse.\n\n"
                "Muri ZeroMalaria, amategeko ashya ubwihutirwa. "
                "Baza ikibazo cyumvikana (umurwayi, kwirinda, icyo gukora none)."
            ),
            "en": (
                "**Malaria is spread by mosquitoes.** "
                "Fever, chills, and danger signs need quick assessment.\n\n"
                "In ZeroMalaria, protocol rules set urgency. "
                "Ask a specific question (this patient, prevention, what to do now)."
            ),
        }[lang]
        return text, retrieve_protocol("malaria fever mosquito", limit=2), blocks

    if use_case and case:
        src = retrieve_protocol(str((case or {}).get("decision") or "malaria danger referral"), limit=2)
        decision_title = card["title"]
        text = {
            "fr": (
                f"Pour ce cas, le protocole indique **{decision_title}**. "
                "Demandez: que faire maintenant, pourquoi, ou que dire à la famille."
            ),
            "rw": (
                f"Kuri uyu murimo, amategeko avuga **{decision_title}**. "
                "Baza: icyo gukora none, kuki, cyangwa icyo kubwira umuryango."
            ),
            "en": (
                f"For this case, the protocol says **{decision_title}**. "
                "Ask: what to do now, why, or what to tell the family."
            ),
        }[lang]
        return text, src, blocks

    text = {
        "fr": (
            "**Bonjour.** Je peux vous aider comme un assistant de chat.\n\n"
            "Demandez: chiffres du jour, références en attente, alertes, "
            "ou conseils paludisme. Ouvrez un triage pour des questions sur un patient précis."
        ),
        "rw": (
            "**Muraho.** Nshobora kukufasha nka umufasha wo kuganira.\n\n"
            "Baza: imibare y'uyu munsi, uwoherezwa, amatangazo, "
            "cyangwa inama za malariya. Fungura triage niba ushaka kubaza ku murwayi."
        ),
        "en": (
            "**Hello.** I can help like a chat assistant.\n\n"
            "Ask about today's counts, pending referrals, alerts, "
            "or malaria advice. Open a triage when you want questions about a specific patient."
        ),
    }[lang]
    return text, retrieve_protocol("malaria fever chw", limit=2), blocks


def local_chat_answer(
    message: str,
    case: dict[str, Any] | None,
    language: str = "en",
    history: list[dict[str, str]] | None = None,
    *,
    data_facts: dict[str, Any] | None = None,
    use_case_context: bool = True,
) -> dict[str, Any]:
    prior = " ".join(
        (h.get("content") or "")[:120]
        for h in (history or [])[-4:]
        if (h.get("role") or "") == "user"
    )
    answer_lang = detect_answer_language(message or prior, language)
    intent = detect_intent(message)
    use_case = use_case_context and bool(case)
    # With an open case, vague questions get a precise action brief (not a clarifying ask).
    if intent == "unknown" and use_case:
        intent = "what_now"
    body, sources, blocks = _section_text(
        intent, answer_lang, case, data_facts=data_facts, use_case=use_case
    )
    followups = {
        "case_summary": {
            "fr": ["Que faire maintenant ?", "Que dire à la famille ?", "Pourquoi cette décision ?"],
            "en": ["What should I do now?", "What should I tell the family?", "Why this decision?"],
            "rw": ["Nakora iki none?", "Nakwira iki umuryango?", "Kuki iki cyemezo?"],
        },
        "what_now": {
            "fr": [
                "Pourquoi cette décision ?",
                "Quelles règles ont déclenché ça ?",
                "Que dire à la famille ?",
                "Quand revenir ?",
            ],
            "en": [
                "Why this decision?",
                "Which rules triggered this?",
                "What should I tell the family?",
                "When to come back?",
            ],
            "rw": [
                "Kuki iki cyemezo?",
                "Ni amategeko ki yateye iki cyemezo?",
                "Nakwira iki umuryango?",
                "Bazagaruka ryari?",
            ],
        },
        "why": {
            "fr": [
                "Que faire maintenant ?",
                "Quelles règles ont déclenché ça ?",
                "Que dire à la famille ?",
            ],
            "en": [
                "What should I do now?",
                "Which rules triggered this?",
                "What should I tell the family?",
            ],
            "rw": [
                "Nakora iki none?",
                "Ni amategeko ki yateye iki cyemezo?",
                "Nakwira iki umuryango?",
            ],
        },
        "unknown": {
            "fr": [
                "Pourquoi cette décision ?",
                "Que faire maintenant ?",
                "Quelles règles ont déclenché ça ?",
            ],
            "en": [
                "Why this decision?",
                "What should I do now?",
                "Which rules triggered this?",
            ],
            "rw": [
                "Kuki iki cyemezo?",
                "Nakora iki none?",
                "Ni amategeko ki yateye iki cyemezo?",
            ],
        },
    }.get(intent, {}).get(answer_lang, [])
    return {
        "reply": (body or "").strip(),
        "provider_used": "local",
        "sources": sources,
        "blocks": blocks,
        "followups": followups,
        "rejected": False,
        "local_mode": True,
        "intent": intent,
        "answer_language": answer_lang,
        "needs_native_review": answer_lang.startswith("rw"),
        "label": "Byakozwe na AI" if answer_lang.startswith("rw") else "AI-generated",
    }

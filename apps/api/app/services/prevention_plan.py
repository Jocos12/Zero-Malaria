"""Personalized prevention plan from protocol catalog (no drugs/doses)."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Any

import yaml

CATALOG_PATH = Path(__file__).resolve().parents[1] / "protocol" / "prevention.yaml"

# Fixed subset for Rules-only Analysis (core community messages).
PROTOCOL_ONLY_IDS = frozenset(
    {
        "itn_net",
        "standing_water",
        "dusk_dawn",
        "early_fever_care",
        "follow_up_return",
        "household_share",
    }
)


def _lang(language: str) -> str:
    return "rw" if (language or "").startswith("rw") else "en"


def _fill_template(template: str, case: dict[str, Any]) -> str:
    village = case.get("village") or case.get("village_name") or ""
    if not str(village).strip():
        village = "this village" if _lang(str(case.get("language") or "en")) == "en" else "iki gace"
    replacements = {
        "age_months": str(case.get("age_months") if case.get("age_months") is not None else ""),
        "decision": str(case.get("decision") or ""),
        "tdr_result": str(case.get("tdr_result") or case.get("tdr") or ""),
        "village": str(village),
    }
    out = template or ""
    for key, val in replacements.items():
        out = out.replace("{" + key + "}", val)
    return out.strip()


def _age_months(case: dict[str, Any]) -> int | None:
    raw = case.get("age_months")
    if raw is None:
        return None
    try:
        return int(raw)
    except (TypeError, ValueError):
        return None


def _applies(item: dict[str, Any], case: dict[str, Any]) -> bool:
    cond = item.get("applies_when") or {}
    if not cond:
        return True
    age = _age_months(case)
    if cond.get("village_present") and not (case.get("village") or case.get("village_name")):
        return False
    if "age_months_max" in cond and age is not None and age > int(cond["age_months_max"]):
        return False
    if "age_months_min" in cond and age is not None and age < int(cond["age_months_min"]):
        return False
    if "decision" in cond:
        allowed = cond["decision"]
        if not isinstance(allowed, list):
            allowed = [allowed]
        if str(case.get("decision") or "") not in {str(x) for x in allowed}:
            return False
    if "tdr_result" in cond:
        allowed = cond["tdr_result"]
        if not isinstance(allowed, list):
            allowed = [allowed]
        tdr = str(case.get("tdr_result") or case.get("tdr") or "")
        if tdr not in {str(x) for x in allowed}:
            return False
    if cond.get("pregnancy"):
        if not (case.get("pregnancy") or case.get("is_pregnant") or case.get("pregnant")):
            return False
    return True


@lru_cache(maxsize=1)
def _load_catalog() -> dict[str, Any]:
    raw = yaml.safe_load(CATALOG_PATH.read_text(encoding="utf-8")) or {}
    items = raw.get("items") or []
    by_id = {str(row["id"]): row for row in items if row.get("id")}
    meta = raw.get("meta") or {}
    return {"meta": meta, "by_id": by_id, "items": items}


def build_prevention_plan(
    case: dict[str, Any],
    *,
    language: str = "rw",
    scope: str = "full",
) -> list[dict[str, Any]]:
    """Return prevention items for a case. scope: full | protocol."""
    catalog = _load_catalog()
    lang = _lang(language)
    ctx = {**case, "language": language}
    out: list[dict[str, Any]] = []
    for row in catalog["items"]:
        cid = str(row.get("id") or "")
        if scope == "protocol" and cid not in PROTOCOL_ONLY_IDS:
            continue
        if not _applies(row, ctx):
            continue
        why_key = f"why_template_{lang}"
        fam_key = f"family_msg_{lang}"
        why_tpl = str(row.get(why_key) or row.get("why_template_en") or "")
        fam_tpl = str(row.get(fam_key) or row.get("family_msg_en") or "")
        out.append(
            {
                "catalog_id": cid,
                "who": str(row.get("who") or "chw"),
                "when": str(row.get("when") or ""),
                "why_for_patient": _fill_template(why_tpl, ctx),
                "family_message": _fill_template(fam_tpl, ctx),
                "source_ref": str(row.get("source_ref") or ""),
                "ai_reworded": False,
            }
        )
    return out


def build_prevention_payload(case: dict[str, Any], *, language: str = "rw") -> dict[str, Any]:
    meta = _load_catalog().get("meta") or {}
    return {
        "version": str(meta.get("version") or ""),
        "pending_clinical_validation": bool(meta.get("pending_clinical_validation", True)),
        "items": build_prevention_plan(case, language=language, scope="full"),
        "protocol_items": build_prevention_plan(case, language=language, scope="protocol"),
    }

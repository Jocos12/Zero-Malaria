"""Prevention plan catalog and personalization."""

from __future__ import annotations

import sys
from pathlib import Path

API_ROOT = Path(__file__).resolve().parents[1]
if str(API_ROOT) not in sys.path:
    sys.path.insert(0, str(API_ROOT))

from app.services.prevention_plan import PROTOCOL_ONLY_IDS, build_prevention_payload, build_prevention_plan


def _no_em_dash(blob: str) -> None:
    assert "\u2014" not in blob
    assert "\u2013" not in blob


def test_under5_gets_extra_item():
    case = {
        "age_months": 24,
        "sex": "female",
        "tdr_result": "negative",
        "decision": "treat_at_home",
    }
    items = build_prevention_plan(case, language="en", scope="full")
    ids = {i["catalog_id"] for i in items}
    assert "under5_extra" in ids
    assert "pregnant_extra" not in ids


def test_older_child_skips_under5_extra():
    case = {
        "age_months": 72,
        "tdr_result": "negative",
        "decision": "treat_at_home",
    }
    ids = {i["catalog_id"] for i in build_prevention_plan(case, language="en", scope="full")}
    assert "under5_extra" not in ids


def test_protocol_subset_is_fixed_core():
    case = {"age_months": 24, "decision": "treat_at_home", "tdr_result": "positive"}
    payload = build_prevention_payload(case, language="rw")
    protocol_ids = {i["catalog_id"] for i in payload["protocol_items"]}
    assert protocol_ids.issubset(PROTOCOL_ONLY_IDS)
    assert "under5_extra" not in protocol_ids


def test_plan_copy_has_no_em_dash():
    case = {"age_months": 24, "decision": "treat_at_home", "tdr_result": "positive"}
    payload = build_prevention_payload(case, language="en")
    _no_em_dash(str(payload))
    for item in payload["items"]:
        assert item["why_for_patient"]
        assert item["catalog_id"]

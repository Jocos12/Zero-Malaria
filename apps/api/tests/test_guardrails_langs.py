"""Guardrails block drug/dose/fine/downgrade in en, fr, rw."""

from __future__ import annotations

import sys
from pathlib import Path

API_ROOT = Path(__file__).resolve().parents[1]
if str(API_ROOT) not in sys.path:
    sys.path.insert(0, str(API_ROOT))

from app.services.ai.guardrails import guard_agent_text, rejection_reason


def test_blocks_drug_dose_fine_downgrade_all_langs():
    locked = "urgent_refer"
    samples = [
        ("Give paracetamol 500 mg now", "en"),
        ("Donnez du paracétamol 500 mg", "fr"),
        ("Mupa umuti wa paracetamol 500 mg", "rw"),
        ("The patient is fine, no referral", "en"),
        ("Tout va bien, pas besoin de référer", "fr"),
        ("Nta kibazo, siga mu rugo", "rw"),
        ("Safe at home, cancel referral", "en"),
    ]
    for text, lang in samples:
        assert rejection_reason(text, locked) is not None, text
        out, rejected, reason = guard_agent_text(text, locked, lang)
        assert rejected is True
        assert reason
        assert "\u2014" not in out
        if lang == "fr":
            assert "protocole" in out.lower() or "urgence" in out.lower() or "référ" in out.lower()
        elif lang == "rw":
            assert "amabwiriza" in out.lower() or "ohereza" in out.lower() or "kohereza" in out.lower()

#!/usr/bin/env python3
"""Generate TypeScript rules module from rules/malaria_rules.yaml (single source)."""

from __future__ import annotations

import json
from pathlib import Path

import yaml

REPO = Path(__file__).resolve().parents[3]
YAML_PATH = REPO / "rules" / "malaria_rules.yaml"
OUT_PATH = REPO / "apps" / "web" / "src" / "rules" / "malariaRules.generated.ts"


def main() -> None:
    cfg = yaml.safe_load(YAML_PATH.read_text(encoding="utf-8"))
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(cfg, indent=2)
    content = f"""/* AUTO-GENERATED from rules/malaria_rules.yaml — do not edit by hand.
 * Run: python apps/web/scripts/generate_rules_ts.py
 * PLACEHOLDER - TO BE VALIDATED against Rwanda national malaria treatment guidelines
 * and WHO iCCM guidance by a clinician.
 */
export const MALARIA_RULES = {payload} as const;

export type MalariaRules = typeof MALARIA_RULES;
"""
    OUT_PATH.write_text(content, encoding="utf-8")
    print(f"Wrote {OUT_PATH}")


if __name__ == "__main__":
    main()

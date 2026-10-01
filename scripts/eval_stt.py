#!/usr/bin/env python3
"""Evaluate STT providers on a folder of Kinyarwanda clips.

Usage:
  python scripts/eval_stt.py --clips path/to/wavs --refs path/to/refs.tsv

refs.tsv columns: filename\\texpected_text
Reports word error rate and danger-word recall per provider (mock by default).
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "apps" / "api"))

from app.services.ai.voice_stt import provider_order, sanitize_transcript, transcribe_audio  # noqa: E402

DANGER_WORDS = {
    "gusetsa",
    "convulsions",
    "ntashobora",
    "kunywa",
    "kuraruka",
    "gucika",
    "intege",
    "uruhuha",
    "lethargy",
}


def wer(ref: str, hyp: str) -> float:
    r = ref.lower().split()
    h = hyp.lower().split()
    if not r:
        return 0.0 if not h else 1.0
    # Simple Levenshtein on tokens
    dp = [[0] * (len(h) + 1) for _ in range(len(r) + 1)]
    for i in range(len(r) + 1):
        dp[i][0] = i
    for j in range(len(h) + 1):
        dp[0][j] = j
    for i in range(1, len(r) + 1):
        for j in range(1, len(h) + 1):
            cost = 0 if r[i - 1] == h[j - 1] else 1
            dp[i][j] = min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost)
    return dp[-1][-1] / max(1, len(r))


def danger_recall(ref: str, hyp: str) -> float:
    need = {w for w in DANGER_WORDS if w in ref.lower()}
    if not need:
        return 1.0
    hit = sum(1 for w in need if w in hyp.lower())
    return hit / len(need)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--clips", type=Path, required=True)
    ap.add_argument("--refs", type=Path, required=True)
    args = ap.parse_args()
    rows = []
    for line in args.refs.read_text(encoding="utf-8").splitlines():
        if not line.strip() or line.startswith("#"):
            continue
        name, expected = line.split("\t", 1)
        rows.append((name.strip(), expected.strip()))

    print("providers:", ", ".join(provider_order()))
    wers: list[float] = []
    recalls: list[float] = []
    for name, expected in rows:
        path = args.clips / name
        audio = path.read_bytes() if path.exists() else b""
        out = transcribe_audio(audio, language="rw")
        hyp = sanitize_transcript(str(out.get("text") or ""))
        w = wer(expected, hyp)
        r = danger_recall(expected, hyp)
        wers.append(w)
        recalls.append(r)
        print(f"{name}\twer={w:.2f}\trecall={r:.2f}\tprovider={out.get('provider')}\thyp={hyp[:60]}")
    if wers:
        print(f"MEAN_WER\t{sum(wers)/len(wers):.3f}")
        print(f"MEAN_DANGER_RECALL\t{sum(recalls)/len(recalls):.3f}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

"""Keyword / light BM25 retrieval over protocol markdown + clinical_config."""

from __future__ import annotations

import math
import re
from pathlib import Path
from typing import Any

REPO = Path(__file__).resolve().parents[5]
PROTOCOL_DIR = REPO / "docs" / "protocol"
CLINICAL = REPO / "rules" / "clinical_config.yaml"

_TOKEN = re.compile(r"[a-zA-Zàâäéèêëïîôùûüç']{3,}", re.I)


def _tokenize(text: str) -> list[str]:
    return [t.lower() for t in _TOKEN.findall(text or "")]


def _load_sections() -> list[dict[str, str]]:
    sections: list[dict[str, str]] = []
    if PROTOCOL_DIR.exists():
        for path in sorted(PROTOCOL_DIR.glob("*.md")):
            text = path.read_text(encoding="utf-8")
            parts = re.split(r"\n##\s+", text)
            for i, part in enumerate(parts):
                if not part.strip():
                    continue
                lines = part.strip().splitlines()
                if i == 0 and not text.lstrip().startswith("##"):
                    title = path.stem
                    body = part.strip()
                else:
                    title = lines[0].strip() if lines else path.stem
                    body = "\n".join(lines[1:]).strip()
                sections.append(
                    {
                        "section": title,
                        "excerpt": body[:800],
                        "file": f"docs/protocol/{path.name}",
                    }
                )
    if CLINICAL.exists():
        raw = CLINICAL.read_text(encoding="utf-8")
        sections.append(
            {
                "section": "clinical_config",
                "excerpt": raw[:800],
                "file": "rules/clinical_config.yaml",
            }
        )
    return sections


def retrieve_protocol(query: str, limit: int = 5) -> list[dict[str, str]]:
    """Return top protocol passages for query (keyword BM25-ish)."""
    docs = _load_sections()
    if not docs:
        return []
    q_tokens = _tokenize(query)
    if not q_tokens:
        return docs[: min(2, limit)]

    df: dict[str, int] = {}
    doc_tokens: list[list[str]] = []
    for d in docs:
        toks = _tokenize(d["section"] + " " + d["excerpt"])
        doc_tokens.append(toks)
        for t in set(toks):
            df[t] = df.get(t, 0) + 1

    n = len(docs)
    avgdl = sum(len(t) for t in doc_tokens) / max(1, n)
    k1, b = 1.2, 0.75
    scored: list[tuple[float, dict[str, str]]] = []
    boosts = {
        "vomit": ("vomit", "vomiting"),
        "danger": ("danger", "urgent", "convulsion"),
        "fever": ("fever", "temperature"),
        "drug": ("dose", "medicine", "pre-referral", "drug"),
        "rdt": ("rdt", "tdr", "diagnostic"),
        "refer": ("refer", "referral", "transport"),
        "family": ("family", "caregiver"),
        "why": ("danger", "urgent", "rule"),
    }
    q_lower = (query or "").lower()
    for doc, toks in zip(docs, doc_tokens, strict=True):
        score = 0.0
        dl = len(toks) or 1
        tf: dict[str, int] = {}
        for t in toks:
            tf[t] = tf.get(t, 0) + 1
        for qt in q_tokens:
            if qt not in tf:
                continue
            idf = math.log(1 + (n - df.get(qt, 0) + 0.5) / (df.get(qt, 0) + 0.5))
            denom = tf[qt] + k1 * (1 - b + b * dl / avgdl)
            score += idf * (tf[qt] * (k1 + 1)) / denom
        for key, words in boosts.items():
            if key in q_lower or any(w in q_lower for w in words):
                blob = (doc["section"] + " " + doc["excerpt"]).lower()
                if any(w in blob for w in words):
                    score += 2.5
        scored.append((score, doc))
    scored.sort(key=lambda x: -x[0])
    out = [d for s, d in scored if s > 0][:limit]
    if not out:
        out = [d for _, d in scored[: min(2, limit)]]
    return out


def format_excerpts_for_prompt(excerpts: list[dict[str, str]]) -> str:
    bits: list[str] = []
    for e in excerpts:
        bits.append(f"[{e.get('file')}#{e.get('section')}]\n{e.get('excerpt', '')[:500]}")
    return "\n\n".join(bits)


def protocol_drug_whitelist() -> set[str]:
    """Drug names that appear in protocol files (empty pack → none allowed)."""
    names: set[str] = set()
    text = ""
    if PROTOCOL_DIR.exists():
        for path in PROTOCOL_DIR.glob("*.md"):
            text += "\n" + path.read_text(encoding="utf-8").lower()
    # This pack explicitly says doses are NOT implemented — whitelist stays empty
    # unless a real drug name is written in protocol.
    for candidate in ("artemether", "lumefantrine", "artesunate", "quinine", "coartem", "asaq", "paracetamol", "acetaminophen"):
        if candidate in text and "not implemented" not in text:
            names.add(candidate)
    return names

"""Mask secrets in access / app logs (tokens, SSE tickets)."""

from __future__ import annotations

import logging
import re

_SENSITIVE_QS = re.compile(
    r"((?:access_token|ticket|refresh_token|password|authorization)=)[^&\s\"']+",
    re.I,
)


class MaskSecretsFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        try:
            msg = record.getMessage()
            masked = _SENSITIVE_QS.sub(r"\1***", msg)
            if masked != msg:
                record.msg = masked
                record.args = ()
        except Exception:
            pass
        return True


def install_secret_masking() -> None:
    filt = MaskSecretsFilter()
    for name in ("uvicorn.access", "uvicorn.error", "uvicorn", "fastapi"):
        logging.getLogger(name).addFilter(filt)

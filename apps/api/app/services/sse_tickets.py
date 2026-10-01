"""Short-lived, single-use opaque tickets for EventSource SSE (no JWT in URL)."""

from __future__ import annotations

import secrets
import threading
import time
from dataclasses import dataclass


TICKET_TTL_SECONDS = 30


@dataclass
class _Ticket:
    user_id: str
    expires_at: float
    used: bool = False


_lock = threading.Lock()
_tickets: dict[str, _Ticket] = {}


def _purge_locked(now: float) -> None:
    dead = [k for k, t in _tickets.items() if t.used or t.expires_at <= now]
    for k in dead:
        _tickets.pop(k, None)


def issue_ticket(user_id: str, *, ttl_seconds: int = TICKET_TTL_SECONDS) -> tuple[str, int]:
    """Return (opaque_ticket, expires_in_seconds)."""
    tid = secrets.token_urlsafe(32)
    now = time.time()
    with _lock:
        _purge_locked(now)
        _tickets[tid] = _Ticket(user_id=user_id, expires_at=now + max(1, ttl_seconds))
    return tid, max(1, ttl_seconds)


def consume_ticket(ticket: str) -> str | None:
    """Atomically consume a ticket. Returns user_id or None if invalid/expired/used."""
    if not ticket or not str(ticket).strip():
        return None
    now = time.time()
    with _lock:
        _purge_locked(now)
        row = _tickets.get(ticket)
        if row is None:
            return None
        if row.used or row.expires_at <= now:
            _tickets.pop(ticket, None)
            return None
        row.used = True
        _tickets.pop(ticket, None)
        return row.user_id


def reset_tickets_for_tests() -> None:
    with _lock:
        _tickets.clear()

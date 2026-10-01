# ZeroMalaria - Progress

**Decision support tool. Not a replacement for clinical judgment.**  
**Synthetic demo data** only.

## Current sprint: Web-only app, treated counts, blood Qs, read-aloud, global AI — 2026-10-01

**Branch:** `feature/result-modal` (local only — do not push; do not edit `main`).

### Assumptions

- One responsive WebShell; `/m/*` = redirects only.
- Patients = merged API + Dexie; badges match list counts.
- Blood questions stored/shown; escalation off until SUPER_ADMIN enables YAML flag.
- Treated counts: auto + manual never double-counted within a source; combined = auto + manual.
- Read-aloud from phrase packs; never English voice for Kinyarwanda.
- No U+2014/U+2013 or lone `-` as empty placeholder (i18n:check enforced).
- Blood / prevention / RW phrases not presented as clinically validated.
- Live SSE: no JWT in query string; short-lived single-use ticket; RBAC scope on poll/SSE.

### Implemented

| Step | Status |
| --- | --- |
| 0 Audit | Done |
| 1 Web-only + patients + placeholders | Done |
| 2 Treated-patient activity_counts + UI | Done |
| 3 Blood questions (pending validation) | Done |
| 4 Global AI + RBAC data tools | Done |
| 5 Read-aloud triage | Done |
| 6 Design polish (web shell / templates) | Partial (web-only shell; PageHeader polish light) |
| 7 Tests / docs / gates | Done |
| SSE ticket + reconnect robustness | Done (2026-10-01) |

### SSE / live events (2026-10-01)

- `POST /events/ticket` (auth) → opaque ticket, TTL 30s, single-use.
- `GET /events?ticket=…` (no `access_token` query; rejected if present).
- Heartbeat SSE comment every 15s; `X-Accel-Buffering: no`; clean client disconnect.
- Access logs mask `ticket` / `access_token` / `refresh_token`.
- Web: ticket + EventSource, exponential backoff reconnect, `/events/poll` fallback (no console spam).
- Vite proxy: silence expected ECONNRESET on `/events`.
- `make dev` / `scripts/dev.ps1` for uvicorn `--reload` + clear missing-venv error.

### Mocked / not verified

- Live Gemini when quota exhausted (falls back Local / Groq).
- Vertex TTS / MMS-TTS Kinyarwanda when credentials missing (honest unavailable + text).
- Full Playwright matrix for treated-counts + read-aloud phrase ids (unit/API covered; e2e shell/chat updated to `/app`).

### Gates log

| Step | pytest | build | lint | i18n:check |
| --- | --- | --- | --- | --- |
| Prior (chat dossier) | OK (158) | OK | OK | OK (929) |
| This sprint | OK (170) | OK | OK (2 warn) | OK (1012 keys, 593 draft) |
| SSE ticket / reconnect | OK (179) | OK | OK (2 warn) | OK (1017 keys, 598 draft) |

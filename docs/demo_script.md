# 3-minute live demo script — ZeroMalaria

**Synthetic demo data.** Decision support tool. Not a replacement for clinical judgment.  
Pilot framing districts: **Gisagara** and **Nyamagabe** (*source: RBC problem canvas, to be verified*).

## Setup (before judges enter)

1. Seed: `.\.venv\Scripts\python apps\api\app\seed.py` (or `make seed`)
2. API: `cd apps\api` → `..\..\.venv\Scripts\python -m uvicorn app.main:app --reload --port 8000`
3. Web: `cd apps\web` → `npm run dev`
4. Login as `rbc.admin` / `demo1234` (username + password only — no role buttons)
5. Open Presenter menu → **Live Demo Board** (`/demo/board`) on a large screen

## Minute-by-minute

### 0:00–0:25 — Problem vs existing tools
Village paper triage; RapidSMS is async with no decision support; ePOCT+ stops at the facility door; drones fix stock not triage accuracy. ZeroMalaria closes the **village → clinic → follow-up** loop.

### 0:25–1:10 — Live Demo Board (cross-role)
On `/demo/board`, click **Run loop demo**. Point at the three panes:

1. CHW creates urgent referral  
2. Health center inbox receives it (badge / new row)  
3. Status moves Received → Arrived; RBC pane stays on the same data stream  

Say: one action ripples across roles — not three disconnected apps.

### 1:10–1:50 — Web triage + read-aloud + treated counts
Login as CHW → `/app/home` (single web app; `/m/*` redirects). Open **New triage** `/app/triage`.  
Enable **Soma ibibazo mu majwi** (read-aloud). Answer danger signs + blood questions (pending clinical validation, inform nurse only).  
Convulsions → red **Byihutirwa / URGENT**. Emphasize: rules lock urgency; blood Qs do not auto-escalate; ML cannot downgrade.  
After confirm: **Patients** list shows the case; **Andika umubare w'abarwayi bavuwe** records treated numbers; RBC dashboard shows auto vs manual KPIs.  
Global assistant (Ctrl+J): ask in French or “how many patients treated this week?” (real RBAC-scoped numbers).

**30-second AI moment (Result screen):**
1. Point at the locked red banner — “Decision set by clinical rules. AI cannot change it.”
2. Show **What to do now** checkboxes — fixed catalog steps (not LLM).
3. Toggle **Rules only → Rules + AI** inside AI support: risk band **High** (not a fake 100%), top factors (ML), then AI summary with discreet “Answered by Groq/Gemini”.
4. Presenter → **Simulate offline** — decision and catalog steps unchanged; AI summary falls back to offline message.
5. Confirm → handover.

### 60-second insert — how the AI helps, and why it is safe
Use on the Result modal after an urgent case:

1. **Rules only** — grey “AI off” strip; Analysis dossier shows Decision path, Answers table, Missing data, Protocol evidence (no ML gauges, no AI meaning column). Verdict banner stays in the modal header only.
2. Flip to **Rules + AI** — same dossier plus AI/ML chips: plain-language meanings, ML gauges, consistency, patient prevention plan, nurse summary, questions to ask. Counter of AI/ML items + Show differences.
3. **Assistant** — ask “le patient souffre de quoi ?” → French reply + Patient card (not an English template). Chips/follow-ups match the question language. Provider chips show real `/ai/status` (ok / rate_limited / …); badge tooltip shows fallback reason.
4. **Pipeline** — Inputs → Rules (locked) → ML → AI language → CHW confirm. Click Rules: “AI cannot lower urgency.”
5. **Safety checks → Test safety lock** — simulated “patient is fine / dose” reply blocked in en/fr/rw; decision stays urgent.
6. **Compare** — Gemini | Groq | Local: latency + “Same decision” / unavailable reason (never fake content).

Close: AI words and checks; rules own urgency; CHW confirms.

### 1:50–2:20 — Nurse thread
`/app/referrals` → open the urgent row → mark **Received** → send quick message “Prepare transport”.  
CHW **My referrals** advances; overdue **Alerts** for never-arrived cases.

### 2:20–3:00 — RBC dashboard
`/app/dashboard`: hotspot banner **Potential increase detected (statistical signal)** (never “outbreak confirmed”), funnel drop-off, stock pressure, **Synthetic demo data** badge. Close on disclaimer.

## Offline backup (if Wi‑Fi fails)

Presenter → Simulate offline → Case B on `/m/triage` → urgent still works → restore network → sync clears pending.

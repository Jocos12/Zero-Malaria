# ZeroMalaria

**AI for Public Good Challenge Hackathon** — University of Rwanda, UR UNIPOD  
**Sector:** Health · **Intended owner institution:** Rwanda Biomedical Centre (RBC)

Offline-first, AI-assisted malaria **triage and referral** platform for Rwanda:

| Experience | Who (role) | Routes |
| --- | --- | --- |
| CHW web app | `CHW` | `/app/home`, `/app/triage`, `/app/my-patients`, … |
| Health center | `HEALTH_CENTER` | `/app/referrals` inbox, facility tools |
| District / national ops | `RBC_ADMIN` | `/app/dashboard`, Users (scoped), facilities |
| Platform admin | `SUPER_ADMIN` | Full `/app/*` admin (users, RBAC, audit) |

Single responsive web shell (`/app/*`): fixed sidebar (drawer below 1024px), sticky header, only main content scrolls; create/edit/confirm use centered modals (bottom sheet below 640px). Legacy `/m/*` paths redirect to `/app/*`.

> **Decision support tool. Not a replacement for clinical judgment.**  
> **Synthetic demo data only** — not a patient registry, not clinical validation.

---

## Table of contents

1. [What this project does](#1-what-this-project-does)
2. [Tech stack (everything we used)](#2-tech-stack-everything-we-used)
3. [Repository layout](#3-repository-layout)
4. [Prerequisites](#4-prerequisites)
5. [Environment variables](#5-environment-variables)
6. [Install and run](#6-install-and-run)
7. [Demo accounts and roles](#7-demo-accounts-and-roles)
8. [Medical safety model](#8-medical-safety-model)
9. [Auth, AI, and voice](#9-auth-ai-and-voice)
10. [Tests and quality checks](#10-tests-and-quality-checks)
11. [What is real vs mocked](#11-what-is-real-vs-mocked)
12. [What to push / what not to commit](#12-what-to-push--what-not-to-commit)
13. [Documentation index](#13-documentation-index)
14. [License and disclaimer](#14-license-and-disclaimer)

---

## 1. What this project does

1. **CHW guided triage** — one question per step (age, sex, fever, danger signs, TDR), works **offline** with the same clinical rules as the API.
2. **Layered decision** — deterministic rules → optional ML escalation → NLP/voice for language only. CHW must **confirm**.
3. **Digital referral handover** — QR / copy summary; sync queue when back online.
4. **Nurse inbox** — receive → arrived → treated; overdue alerts if the patient never arrives.
5. **RBC dashboard** — KPIs, map, forecast band, referral funnel, stock pressure, hotspot **statistical signals** (never “outbreak confirmed”).
6. **Voice (“Vuga na Zero”)** — read-aloud from a fixed phrase catalog; optional mic for yes/no; never diagnoses or names drugs.

---

## 2. Tech stack (everything we used)

### Frontend (`apps/web`)

| Technology | Role |
| --- | --- |
| **React 18** + **TypeScript** | UI |
| **Vite 6** | Dev server + production build |
| **Tailwind CSS 3** | Design tokens / layout |
| **Framer Motion** | Page transitions, list stagger (respects `prefers-reduced-motion`) |
| **React Router 6** | `/login`, `/app/*`, `/m/*` |
| **i18next** + **react-i18next** | English + Kinyarwanda (`en.json` / `rw.json`) |
| **Dexie** (IndexedDB) | Offline referrals + sync queue |
| **Recharts** | Dashboard charts |
| **Leaflet** + **react-leaflet** | District map |
| **lucide-react** | Icons only (no emoji UI) |
| **Zod** | Form validation (login, triage, users) |
| **qrcode** | Referral / mobile QR |
| **@fontsource/inter** | Inter font |
| **vite-plugin-pwa** | Installable offline PWA |
| **Vitest** | Unit tests |
| **ESLint** | Lint |
| **Playwright** | Optional screenshots (`npm run screenshots`) |

### Backend (`apps/api`)

| Technology | Role |
| --- | --- |
| **Python 3.11+** | Runtime |
| **FastAPI** + **Uvicorn** | HTTP API |
| **SQLAlchemy 2** + **SQLite** | Persistence (`zeromalaria.db`) |
| **Pydantic** / **pydantic-settings** | Schemas + `ZM_*` config |
| **PyYAML** | Load `rules/malaria_rules.yaml` |
| **PyJWT** + **passlib[bcrypt]** | Auth tokens + password hashes |
| **pandas** / **numpy** | Seed + analytics aggregates |
| **scikit-learn** + **SHAP** + **joblib** | Layer-2 risk models (architecture demo metrics) |
| **httpx** | Optional outbound AI calls |
| **pytest** | API / engine tests |
| **python-dotenv** | Local `.env` |

### Shared clinical / ML / data

| Path | Role |
| --- | --- |
| `rules/malaria_rules.yaml` | **Single source of truth** for triage rules (placeholder — clinician validation required) |
| `apps/api/engine/` | Python rules + decision combine (ML escalate-only) |
| `apps/web/src/rules/` | TypeScript rules generated from the same YAML |
| `ml/` | Train scripts + model artifacts (synthetic) |
| `data/` | Synthetic CSVs (facilities, cases, stock) |

### Optional / demo tooling

| Tool | Role |
| --- | --- |
| `scripts/demo.ps1` | Windows one-shot seed + start hint |
| `Makefile` | `install`, `train`, `seed`, `api`, `web`, `test` |
| `apps/web/scripts/generate_audio_pack.py` | Mock voice manifests under `public/audio/` |
| Gemini / Groq / Vertex (optional keys) | Layer-3 AI with fallback to **Local NLP** |

---

## 3. Repository layout

```text
ZeroMalaria/
├── README.md                 ← you are here
├── PROGRESS.md               ← build status / how to test
├── .env.example              ← copy to .env (do not commit .env)
├── Makefile
├── rules/malaria_rules.yaml  ← clinical rules (placeholder)
├── data/                     ← synthetic CSVs
├── ml/                       ← train models
├── docs/                     ← architecture, demo script, ethics, voice
├── scripts/demo.ps1
├── apps/
│   ├── api/                  ← FastAPI + SQLite + engines + tests
│   └── web/                  ← React PWA (Vite)
```

---

## 4. Prerequisites

- **Node.js** 20+ and npm  
- **Python** 3.11+  
- Windows PowerShell or a Unix shell (commands below show PowerShell)  
- Optional: Git for push/clone  

If `pip` fails with SSL errors on some networks:

```powershell
python -m pip install --trusted-host pypi.org --trusted-host files.pythonhosted.org -r apps\api\requirements.txt -r ml\requirements.txt
```

If `npm install` fails with SSL:

```powershell
cd apps\web
npm install --strict-ssl false
```

---

## 5. Environment variables

Copy the example file (never commit real secrets):

```powershell
copy .env.example .env
```

| Variable | Where | Purpose | Demo default |
| --- | --- | --- | --- |
| `ZM_DEMO_MODE` | API | Enables `POST /auth/demo-login` | `true` |
| `ZM_DEMO_PASSWORD` | API | Password for seeded `*.demo` users | `demo1234` |
| `ZM_JWT_SECRET` | API | JWT signing secret | demo string (change if `ZM_DEMO_MODE=false`) |
| `GEMINI_API_KEY` | API only | Gemini key (never in frontend) | empty → skip / local |
| `GROQ_API_KEY` | API only | Groq key (never in frontend) | empty → skip / local |
| `GEMINI_MODEL` | API | Gemini model id | `gemini-3.8-flash` |
| `GROQ_MODEL` | API | Groq model id | `openai/gpt-oss-20b` |
| `AI_TIMEOUT_SECONDS` | API | Per-provider timeout | `10` |
| `AI_COOLDOWN_MINUTES` | API | Circuit breaker after 429 | `5` |
| `AI_DEBUG` | API | Extra AI logs (no secrets) | `false` |
| `ZM_GEMINI_API_KEY` / `ZM_GROQ_API_KEY` | API | Aliases for the keys above | empty |
| `ZM_GOOGLE_CLOUD_PROJECT` | API | Optional Vertex | empty → skip |
| `ZM_AI_PROVIDER_ORDER` | API | Fallback chain | `gemini,groq,local` |
| `ZM_AI_TIMEOUT_SECONDS` | API | Per-provider timeout (seconds) | `8` |
| `AI_PROVIDER_MODE` | API | `cascade` \| `race` \| `consensus` | `cascade` |
| `AI_CIRCUIT_COOLDOWN_MINUTES` | API | Quota cooldown after 429 | `10` |

Check `GET /ai/health` for `{configured, reachable, quota_state, last_error}` per provider (no secrets). Vite proxies `/api/*` → API (strips `/api`).
| `VITE_DEMO_MODE` | Web (`.env.development`) | Show demo login buttons | `true` in development; `false` in production build |

**Security:** If `ZM_DEMO_MODE=false` and JWT secret or demo password are still the example defaults, the API **refuses to start**.  
**Frontend never receives API keys** — only `VITE_*` public flags.

Also see `apps/web/.env.development` and `apps/web/.env.production` for `VITE_DEMO_MODE`.

---

## 6. Install and run

### Option A — step by step

```powershell
# From repo root
python -m venv .venv
.\.venv\Scripts\python -m pip install -r apps\api\requirements.txt -r ml\requirements.txt

cd apps\web
npm install
cd ..\..

# Optional: train synthetic ML artifacts
.\.venv\Scripts\python ml\train.py

# Seed SQLite (users + synthetic cases + demo referrals)
.\.venv\Scripts\python apps\api\app\seed.py

# Terminal 1 — API (http://127.0.0.1:8000)
cd apps\api
..\..\.venv\Scripts\python -m uvicorn app.main:app --reload --port 8000

# Terminal 2 — Web (http://localhost:5173)
cd apps\web
npm run rules
npm run dev
```

- App: http://localhost:5173  
- API docs: http://127.0.0.1:8000/docs  
- Vite proxies `/api` → port `8000`

### Option B — Makefile

```powershell
make install
make train
make seed
# two terminals:
make api
make web
```

### Option C — Windows helper

```powershell
.\scripts\demo.ps1
```

### Regenerate TypeScript rules from YAML

```powershell
cd apps\web
npm run rules
```

### Optional voice pack manifests

```powershell
cd apps\web
node scripts/export_phrases_json.mjs
python scripts/generate_audio_pack.py
```

Details: [docs/voice_setup.md](docs/voice_setup.md).

---

## 7. Demo accounts and roles

### Demo only

After `make seed` / `seed.py`, the terminal prints this table. Password is **`ZM_DEMO_PASSWORD`** (default **`demo1234`**). **Never shown in the login UI** — role is detected from the account after username/password login.

| Username | Role (code) | Lands on (desktop) |
| --- | --- | --- |
| `chw.demo` | CHW | `/app/home` |
| `health.center` | HEALTH_CENTER | `/app/referrals` |
| `rbc.admin` | RBC_ADMIN | `/app/dashboard` |
| `super.admin` | SUPER_ADMIN | `/app/dashboard` |

- There is **no public sign-up** and **no role picker** on login.  
- `VITE_DEMO_MODE` only controls the synthetic-data banner (and presenter tools), not login buttons.  
- When `ZM_DEMO_MODE=false`, the API refuses to start with the default JWT secret or default demo password.  
- Admin-created users may see a **dismissible password modal** once (`password_prompt_status=pending`); Ignore is remembered server-side. Demo accounts never show it. Policy: `ZM_PASSWORD_CHANGE_POLICY=prompt|enforce` (see [docs/rbac.md](docs/rbac.md)).  
- Roles / permissions: [docs/rbac.md](docs/rbac.md).

Default UI language on first load: **Kinyarwanda** (`rw`), switchable to English.

---

## 8. Medical safety model

| Layer | What it does | What it must not do |
| --- | --- | --- |
| **1 — Rules** (`malaria_rules.yaml`) | Danger signs → **urgent referral**; never downgraded | Invent clinical thresholds |
| **2 — ML** | May only **escalate** urgency; SHAP factors for explainability | Downgrade a rules urgent decision |
| **3 — AI / voice** | Extract symptoms, explain, translate, chat | Diagnose, name drugs, give doses, invent facts |

Always visible:

- Disclaimer: *Decision support tool. Not a replacement for clinical judgment.*  
- **Synthetic demo data** badge  
- Guideline placeholder banner from the YAML meta version  

Clinical rules file opens with:  
`PLACEHOLDER - TO BE VALIDATED against the Rwanda national malaria treatment guidelines and WHO iCCM guidance by a clinician`.

---

## 9. Auth, AI, and voice

### Auth

- JWT access token (~8 hours), bcrypt password hashes  
- Login rate limit (5 attempts / minute / username+IP)  
- Audit log: login, logout, failed login, user changes, AI use  
- Offline CHW session grace after first online login (client session storage)

### AI router (`apps/api/app/services/ai/`)

Order from env (default): **Gemini → Groq → Local NLP**.  
Privacy sanitizer strips names, IDs, phones, addresses before external calls.  
Invalid JSON / drug-dose language → reject and fall through.

### Voice

Visible flow: **Listen → Transcribe → Think → Speak** (UI stepper). Auth: `voice:use` + shared API client (FormData never sets Content-Type).

Playback / engine order:

1. `/public/audio/{rw|en}/<phrase_id>.mp3`  
2. `POST /voice/speak` plan (phrase pack preferred)  
3. English: `ZM_VOICE_ENGINE_EN=browser | vertex_tts | vertex_live` (Vertex needs `GOOGLE_APPLICATION_CREDENTIALS`, `ZM_GOOGLE_CLOUD_PROJECT`, `ZM_GOOGLE_CLOUD_LOCATION`; enable Speech-to-Text, Cloud Text-to-Text, Vertex AI APIs)  
4. Kinyarwanda: pack → MMS TTS (`ZM_MMS_TTS_ENDPOINT` if set) → **text only** — never English browser voice for RW  
5. STT: `ZM_STT_PROVIDER_ORDER` (demo default starts with `mock`)  
6. Triage **read-aloud**: phrase-pack only (toggle on `/app/triage`); volume / Loud boost via Web Audio; `/voice/capabilities` reports honest engine status

Result decision audio uses **fixed catalog + triggered rules only** — not free LLM text. Prevention / chat answers may be spoken from guarded `/ai/chat` text after symbol cleanup. Blood-related triage questions are stored with `pending_clinical_validation` (inform nurse; no auto-escalation until RBC enables).

### AI chat

`POST /ai/chat` (SSE): intent router (`case_summary`, `why`, `tell_family`, `prevention`, …) + case snapshot (no names/phones/IDs) → Gemini → Groq → intent-aware Local. Answers follow the **question language** (RW / EN / FR).

---

## 10. Tests and quality checks

```powershell
# API
.\.venv\Scripts\python -m pytest apps\api\tests -q

# Web
cd apps\web
npm run i18n:check    # no TODO_REVIEW_RW in JSON; en/rw key parity
npm test              # Vitest (rules, auth map, voice, Zod)
npm run lint
npm run build

# Optional screenshots (API + web must be running)
npm run screenshots
```

`npm run i18n:check` fails if any translation value still contains the string `TODO_REVIEW_RW`. Keys needing native review are listed in `apps/web/src/i18n/needs_review.rw.json`.

---

## 11. What is real vs mocked

| Feature | Status |
| --- | --- |
| Rules engine (YAML → Python + TS) | Real, offline |
| Offline triage + Dexie sync queue | Real |
| JWT auth + role isolation | Real |
| Seeded SQLite analytics | Real aggregates on **synthetic** data |
| ML models | Trained on synthetic data — **architecture demo metrics only** |
| Gemini / Groq / Vertex | Optional; without keys → **Local NLP** |
| Cloud TTS / STT | Mock unless configured |
| Audio pack MP3s | Manifests / placeholders; native recordings recommended |
| Hotspot wording | Statistical signal only — not outbreak confirmation |
| App shell scroll / Users CRUD UI | Real UI; Playwright scroll assertions in `e2e/shell-scroll.spec.ts` (needs API + web) |
| Geography / Stock admin tables | List APIs exist; dedicated CRUD UIs still thin vs Users template |
| Screenshot pack light+dark | Partial under `docs/screenshots/` — full visual QA not fully verified |

---

## 12. What to push / what not to commit

### Safe to push

- Source under `apps/`, `rules/`, `data/` (synthetic CSVs), `ml/` scripts, `docs/`, `scripts/`  
- `.env.example`, `README.md`, `PROGRESS.md`, `Makefile`  
- Generated rules TS if you keep it in repo (`apps/web/src/rules/malariaRules.generated.ts`)  

### Do **not** commit

| Path / pattern | Why |
| --- | --- |
| `.env` | Secrets |
| `apps/api/zeromalaria.db` | Local SQLite (in `.gitignore`) |
| `node_modules/`, `.venv/`, `dist/` | Installable locally |
| `ml/artifacts/` | Large / regenerable (`make train`) |
| Real API keys, patient data | Privacy + security |

`.gitignore` already includes `.env`, `node_modules/`, `apps/web/dist/`, `apps/api/zeromalaria.db`, `ml/artifacts/`.

### Suggested git remote push

```powershell
git status
git add .
# review that .env and *.db are not staged
git commit -m "Add ZeroMalaria hackathon demo: CHW PWA, facility inbox, RBC dashboard"
git push -u origin HEAD
```

---

## 13. Documentation index

| Document | Purpose |
| --- | --- |
| [PROGRESS.md](PROGRESS.md) | Current status and smoke-test checklist |
| [docs/README.md](docs/README.md) | Product brief + longer narrative |
| [docs/architecture.md](docs/architecture.md) | Roles, offline/online, AI fallback (Mermaid) |
| [docs/voice_setup.md](docs/voice_setup.md) | Voice pack generation and review |
| [docs/demo_script.md](docs/demo_script.md) | 3-minute live demo |
| [docs/pitch_outline.md](docs/pitch_outline.md) | 5-minute pitch |
| [docs/ethics_and_safety.md](docs/ethics_and_safety.md) | Ethics and safety |
| [docs/qa_cheatsheet.md](docs/qa_cheatsheet.md) | Judge Q&A |
| [docs/demo_polish.md](docs/demo_polish.md) | Pre-demo checklist |
| [data/README.md](data/README.md) | How synthetic data was built |

---

## 14. License and disclaimer

Hackathon student prototype for educational demonstration.

- Clinical rules and thresholds are **placeholders** pending clinician validation against Rwanda national malaria treatment guidelines and WHO iCCM guidance.  
- Models are **not clinically validated**.  
- Do not use with real patients without institutional approval, privacy review, and guideline validation.  
- Optional future TTS models (e.g. MMS) may have **non-commercial** licenses — check before field deployment.

---

**Quick links after start**

| URL | Screen |
| --- | --- |
| http://localhost:5173/login | Login (demo buttons if `VITE_DEMO_MODE`) |
| http://localhost:5173/app/home | CHW home |
| http://localhost:5173/app/triage | Guided triage |
| http://localhost:5173/app/referrals | Nurse inbox |
| http://localhost:5173/app/dashboard | Supervisor / RBC dashboard |
| http://127.0.0.1:8000/docs | OpenAPI |

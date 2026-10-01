# Voice setup — Vuga na Zero

**Decision support tool.** Result audio uses only rules-engine output + fixed catalog text — never LLM free text.

## Playback chain (Kinyarwanda only)

1. Backend `POST /voice/speak` calls Pindo VoiceAI TTS in public or authenticated mode.
2. Pre-recorded `/public/audio/rw/<phrase_id>.mp3` is the offline fallback.
3. Silent fallback keeps the phrase highlighted on screen.

Browser `speechSynthesis` has been removed. English voice output is disabled because Pindo TTS currently supports Kinyarwanda only.

## Pindo access modes

Public mode is enabled by default for development. It calls the free, per-IP rate-limited `/ai/tts/rw/public` endpoint and sends no token:

```dotenv
ZM_PINDO_ACCESS_MODE=public
```

For authenticated production access:

1. Sign in or register at <https://app.pindo.io/login>.
2. Open your profile icon, then **Security**.
3. Copy the API token and replace the placeholder in the root `.env`:

```dotenv
ZM_PINDO_API_TOKEN=your-real-token
ZM_PINDO_ACCESS_MODE=authenticated
ZM_PINDO_API_BASE_URL=https://api.pindo.io
ZM_PINDO_TIMEOUT_SECONDS=20
```

The token is read only by FastAPI and is ignored in public mode. Never create a `VITE_PINDO_*` variable.

## Generate audio pack (demo / Mock)

```powershell
cd apps\web
node scripts/export_phrases_json.mjs
python scripts/generate_audio_pack.py
```

Writes manifests under `public/audio/{en,rw}/manifest.json`. Placeholder audio is labeled **needs native review**.

Optional future: MMS-TTS kin via Hugging Face (check model license — often non-commercial). Document any commercial restriction before field use.

## Native review

Presenter menu (demo) or `/app/settings/voice-review`: play each phrase, mark Reviewed (stored in `localStorage`). In production mode, unreviewed urgent/result audio should not be used; demo mode allows unreviewed with a badge.

## Capability check

Settings → Voice reports whether the backend has a real Pindo token configured. English is text-only.

## Env

| Variable | Purpose |
| --- | --- |
| `ZM_PINDO_ACCESS_MODE` | `public` for free rate-limited access or `authenticated` for account billing |
| `ZM_PINDO_API_TOKEN` | Pindo bearer token; server-side only |
| `ZM_PINDO_API_BASE_URL` | Defaults to `https://api.pindo.io` |
| `ZM_PINDO_TIMEOUT_SECONDS` | Pindo request timeout |
| `VITE_DEMO_MODE` | Unlock overlay + demo presenter tools |

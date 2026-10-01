# Talking AI assistant avatar

Scoped to the **AI assistant** panel (`AssistantChat`). SVG health-worker + spoken turn-taking in Kinyarwanda / French / English.

## Files

| File | Role |
|------|------|
| `AssistantAvatar.tsx` | SVG + CSS motion (idle / listening / thinking / speaking / greeting) |
| `useConversation.ts` | Turn state machine + filler rotation + memory helper |
| `useAvatarState.ts` | Turn → mood |
| `useLipSync.ts` | AnalyserNode / synthetic mouth levels |
| `speakQueue.ts` | Sentence-by-sentence TTS after safety sanitize |
| `safeSpeak.ts` | Strip doses / “patient is fine” / names before speech |
| `phrases.ts` | Greeting, fillers, ASR unclear, offline, safety lines |
| `audioCache.ts` | Dexie cache for **fixed** phrases only (no mic recordings) |

## Turn machine

`idle → listening → thinking → speaking → idle`  
(+ `greeting` once per browser session on open)

| Trigger | State |
|---------|--------|
| Panel open (once/session) | `greeting` + short hello |
| Record | `listening` (barge-in stops TTS) |
| Send question | `thinking` + filler (never same twice) |
| Safe sentence ready / play | `speaking` |
| TTS idle / stop | `idle` |

## Memory

Last **6** messages sent with each `/ai/chat` call. **New conversation** clears the thread.

## Backend prompt

`build_system_prompt` asks for **2–3 short spoken sentences** + **one follow-up question**, matching the user language. Safety rules unchanged (no doses, no urgency downgrade).

## Assumptions

- Browser `speechSynthesis` for TTS (RW quality depends on the device).
- Lip sync is synthetic for speechSynthesis; AnalyserNode when an `HTMLAudioElement` is attached.
- Language: manual RW/FR/EN selector + light heuristic from the question text.
- Provider names (Gemini / Groq / Local) are **hidden** in this panel.
- Fixed phrase audio can be cached in IndexedDB; live mic audio is never stored.

## Accessibility

Large controls, `aria-label`s, `prefers-reduced-motion` → static avatar + state label.

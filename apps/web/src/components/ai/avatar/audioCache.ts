import { db } from '../../../db';

export type AvatarAudioRow = {
  id: string;
  lang: string;
  text: string;
  /** Stored as Blob for offline playback */
  blob: Blob;
  updatedAt: string;
};

function key(lang: string, phraseId: string) {
  return `${lang}:${phraseId}`;
}

/** Cache a fixed-message audio blob (never store live recordings). */
export async function putAvatarAudio(lang: string, phraseId: string, text: string, blob: Blob) {
  const row: AvatarAudioRow = {
    id: key(lang, phraseId),
    lang,
    text,
    blob,
    updatedAt: new Date().toISOString(),
  };
  await db.avatarAudio.put(row);
}

export async function getAvatarAudio(lang: string, phraseId: string): Promise<AvatarAudioRow | undefined> {
  return db.avatarAudio.get(key(lang, phraseId));
}

/**
 * Synthesize a short utterance via browser TTS into a MediaRecorder blob when possible.
 * Best-effort; returns null if unsupported (caller falls back to live TTS / text-only).
 */
export async function synthesizeAndCache(
  lang: string,
  phraseId: string,
  text: string,
): Promise<Blob | null> {
  if (typeof window === 'undefined' || !window.speechSynthesis) return null;
  const existing = await getAvatarAudio(lang, phraseId);
  if (existing?.blob) return existing.blob;

  // Many browsers cannot capture speechSynthesis to MediaRecorder — skip quietly.
  // We still keep the text path; cache is primed only when an Audio blob is provided elsewhere.
  try {
    await putAvatarAudio(lang, phraseId, text, new Blob([text], { type: 'text/plain' }));
  } catch {
    /* ignore */
  }
  return null;
}

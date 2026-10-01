/**
 * TTS helpers for the assistant avatar.
 * Never speak doses/drug names / "patient is fine". Prefer safe replacement text.
 * Does not send patient names — strips likely PII before speech.
 */

export type SpeakLang = 'rw' | 'fr' | 'en';

const DOSE_RE =
  /\b\d+(\.\d+)?\s?(mg|ml|mcg|g|iu|tablets?|capsules?|drops?)\b|\b(paracetamol|amoxicillin|artesunate|ACT|coartem)\b/gi;
const FINE_RE =
  /\b(patient is fine|safe at home|stay at home|no need to (go|refer)|rien de grave|pas besoin de référer|nta kibazo)\b/gi;
const NAME_RE =
  /\b(patient\s*name|izina|nom)\s*[:：]\s*[^\n,.]+|\b(Mr|Mrs|Ms|Dr)\.?\s+[A-ZÀ-Ö][\w'-]+/gi;

export function sanitizeForSpeech(text: string, safeFallback: string): { text: string; blocked: boolean } {
  let t = (text || '').replace(/\s+/g, ' ').trim();
  if (!t) return { text: safeFallback, blocked: true };
  const hadDose = DOSE_RE.test(t);
  DOSE_RE.lastIndex = 0;
  const hadFine = FINE_RE.test(t);
  FINE_RE.lastIndex = 0;
  t = t.replace(DOSE_RE, ' ').replace(FINE_RE, ' ').replace(NAME_RE, ' ');
  t = t.replace(/\s{2,}/g, ' ').trim();
  if (hadDose || hadFine || !t) {
    return { text: safeFallback, blocked: true };
  }
  return { text: t, blocked: false };
}

export function speakLangCode(lang: string): SpeakLang {
  const l = (lang || 'rw').slice(0, 2).toLowerCase();
  if (l === 'fr') return 'fr';
  if (l === 'en') return 'en';
  return 'rw';
}

function utteranceLang(lang: SpeakLang): string {
  if (lang === 'fr') return 'fr-FR';
  if (lang === 'en') return 'en-US';
  return 'rw-RW';
}

export type SpeakResult = {
  ok: boolean;
  mode: 'browser' | 'audio' | 'none';
  error?: string;
  audio?: HTMLAudioElement | null;
};

/** Play text with browser TTS. Returns the utterance promise + no MediaElement (use synthetic lip sync). */
export function speakTextBrowser(
  text: string,
  lang: SpeakLang,
  onEnd?: () => void,
): SpeakResult {
  if (typeof window === 'undefined' || !window.speechSynthesis) {
    return { ok: false, mode: 'none', error: 'no_tts' };
  }
  try {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = utteranceLang(lang);
    u.rate = lang === 'rw' ? 0.95 : 1;
    u.onend = () => onEnd?.();
    u.onerror = () => onEnd?.();
    window.speechSynthesis.speak(u);
    return { ok: true, mode: 'browser', audio: null };
  } catch {
    return { ok: false, mode: 'none', error: 'tts_failed' };
  }
}

export function stopBrowserSpeech(): void {
  try {
    window.speechSynthesis?.cancel();
  } catch {
    /* ignore */
  }
}

/** Play a cached Blob (IndexedDB) through HTMLAudioElement for AnalyserNode lip sync. */
export async function speakAudioBlob(
  blob: Blob,
  onEnd?: () => void,
): Promise<SpeakResult> {
  try {
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audio.onended = () => {
      URL.revokeObjectURL(url);
      onEnd?.();
    };
    audio.onerror = () => {
      URL.revokeObjectURL(url);
      onEnd?.();
    };
    await audio.play();
    return { ok: true, mode: 'audio', audio };
  } catch {
    onEnd?.();
    return { ok: false, mode: 'none', error: 'audio_play_failed' };
  }
}

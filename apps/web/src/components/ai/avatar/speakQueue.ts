import { sanitizeForSpeech, speakTextBrowser, stopBrowserSpeech, type SpeakLang } from './safeSpeak';

/** Split text into speakable sentences (keeps punctuation). */
export function splitSentences(text: string): string[] {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  if (!t) return [];
  const parts = t.match(/[^.!?…]+[.!?…]+|[^.!?…]+$/g) || [t];
  return parts.map((p) => p.trim()).filter(Boolean);
}

type QueueItem = { text: string; lang: SpeakLang; safeFallback: string };

/**
 * Speak sentences one-by-one after safety sanitize.
 * Used for streaming: call enqueue() as each full sentence arrives.
 */
export function createSpeakQueue(opts: {
  onStart?: () => void;
  onIdle?: () => void;
  onBlocked?: () => void;
  onTtsFail?: () => void;
}) {
  let queue: QueueItem[] = [];
  let playing = false;
  let stopped = false;

  const pump = () => {
    if (stopped || playing) return;
    const next = queue.shift();
    if (!next) {
      opts.onIdle?.();
      return;
    }
    const { text, blocked } = sanitizeForSpeech(next.text, next.safeFallback);
    if (blocked) opts.onBlocked?.();
    playing = true;
    opts.onStart?.();
    const res = speakTextBrowser(text, next.lang, () => {
      playing = false;
      pump();
    });
    if (!res.ok) {
      playing = false;
      opts.onTtsFail?.();
      opts.onIdle?.();
    }
  };

  return {
    enqueue(text: string, lang: SpeakLang, safeFallback: string) {
      if (stopped || !text.trim()) return;
      queue.push({ text: text.trim(), lang, safeFallback });
      pump();
    },
    /** Enqueue only sentences not yet spoken from a growing buffer. */
    enqueueNewSentences(
      fullText: string,
      alreadySpokenCount: number,
      lang: SpeakLang,
      safeFallback: string,
    ): number {
      const all = splitSentences(fullText);
      // Keep last fragment unsoken until complete (ends with .!?)
      const complete =
        /[.!?…]\s*$/.test(fullText.trim()) || all.length === 0
          ? all
          : all.slice(0, -1);
      const fresh = complete.slice(alreadySpokenCount);
      for (const s of fresh) this.enqueue(s, lang, safeFallback);
      return alreadySpokenCount + fresh.length;
    },
    stop() {
      stopped = true;
      queue = [];
      playing = false;
      stopBrowserSpeech();
      opts.onIdle?.();
    },
    reset() {
      stopped = false;
      queue = [];
      playing = false;
    },
    get busy() {
      return playing || queue.length > 0;
    },
  };
}

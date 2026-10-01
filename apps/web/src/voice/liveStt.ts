/**
 * Live browser speech-to-text: writes interim + final transcripts as the user speaks.
 * Click start → speak → click stop (or auto-end). Prefer this for chat dictation.
 */

export type LiveSttHandle = {
  stop: () => void;
};

type RecResult = {
  isFinal?: boolean;
  0?: { transcript?: string };
};

type RecEvent = {
  resultIndex: number;
  results: ArrayLike<RecResult>;
};

type Rec = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((ev: RecEvent) => void) | null;
  onerror: ((ev?: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

function getSpeechRecognition(): (new () => Rec) | null {
  const w = window as unknown as {
    SpeechRecognition?: new () => Rec;
    webkitSpeechRecognition?: new () => Rec;
  };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

export function browserSttAvailable(): boolean {
  return Boolean(getSpeechRecognition());
}

function sttLang(uiLang: string): string {
  const l = (uiLang || 'en').slice(0, 2).toLowerCase();
  if (l === 'fr') return 'fr-FR';
  if (l === 'rw') return 'rw-RW'; // may fall back to en in some browsers
  return 'en-US';
}

/**
 * Start continuous recognition. Calls onPartial with the full transcript so far
 * (final segments + current interim). Resolves when recognition ends.
 */
export function startLiveStt(opts: {
  language: string;
  onPartial: (text: string) => void;
  onError?: (code: string) => void;
}): LiveSttHandle | null {
  const SR = getSpeechRecognition();
  if (!SR) return null;

  const rec = new SR();
  let finals = '';
  let stopped = false;

  rec.lang = sttLang(opts.language);
  rec.continuous = true;
  rec.interimResults = true;
  rec.maxAlternatives = 1;

  rec.onresult = (ev) => {
    let interim = '';
    for (let i = ev.resultIndex; i < ev.results.length; i++) {
      const row = ev.results[i];
      const piece = row?.[0]?.transcript || '';
      if (row?.isFinal) {
        finals = `${finals}${finals && !finals.endsWith(' ') ? ' ' : ''}${piece}`.trim();
      } else {
        interim += piece;
      }
    }
    const full = `${finals}${finals && interim ? ' ' : ''}${interim}`.trim();
    if (full) opts.onPartial(full);
  };

  rec.onerror = (ev) => {
    const code = String(ev?.error || 'stt_error');
    // 'no-speech' / 'aborted' are normal when user stops
    if (code !== 'aborted' && code !== 'no-speech') {
      opts.onError?.(code);
    }
  };

  rec.onend = () => {
    stopped = true;
  };

  try {
    rec.start();
  } catch {
    opts.onError?.('start_failed');
    return null;
  }

  return {
    stop: () => {
      if (stopped) return;
      stopped = true;
      try {
        rec.stop();
      } catch {
        try {
          rec.abort();
        } catch {
          /* ignore */
        }
      }
    },
  };
}

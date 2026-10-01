import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';
import { getPhrase, type PhraseId, type VoiceLang } from './phrases';
import {
  getLanguageCapabilities,
  getSpeed,
  isAudioUnlocked,
  isMuted,
  probePreRecordedAudio,
  setMuted,
  setSpeed,
  speakSequence,
  stopSpeaking,
  unlockAudio,
  type PlaybackSource,
  type VoiceSpeed,
} from './speak';
import { parseVoiceIntents, type VoiceIntents } from './intents';

export type VoiceMachineState = 'idle' | 'speaking' | 'listening' | 'confirming';

export type { VoiceIntents };
export { parseVoiceIntents };

type ListenResult = { transcript: string; intents: VoiceIntents };

export type PlayOptions = {
  /** Override UI language for this playback (triage always uses rw / Pindo). */
  language?: VoiceLang;
};

type VoiceContextValue = {
  state: VoiceMachineState;
  unlocked: boolean;
  mute: boolean;
  speed: VoiceSpeed;
  highlightId: PhraseId | null;
  playbackSource: PlaybackSource | null;
  pendingTranscript: string | null;
  pendingIntents: VoiceIntents | null;
  unlock: () => void;
  play: (ids: PhraseId[], opts?: PlayOptions) => Promise<void>;
  stop: () => void;
  replay: () => Promise<void>;
  setSlower: () => void;
  setMute: (mute: boolean) => void;
  toggleMute: () => void;
  listen: () => Promise<ListenResult | null>;
  confirmHeard: () => ListenResult | null;
  cancelHeard: () => void;
  capabilities: ReturnType<typeof getLanguageCapabilities>;
};

const VoiceContext = createContext<VoiceContextValue | null>(null);

function voiceLangFromI18n(code: string): VoiceLang {
  return code.startsWith('rw') ? 'rw' : 'en';
}

export function VoiceProvider({ children }: { children: ReactNode }) {
  const { i18n } = useTranslation();
  const lang = voiceLangFromI18n(i18n.language);

  const [state, setState] = useState<VoiceMachineState>('idle');
  const [unlocked, setUnlocked] = useState(() => isAudioUnlocked());
  const [mute, setMuteState] = useState(() => isMuted());
  const [speed, setSpeedState] = useState<VoiceSpeed>(() => getSpeed());
  const [highlightId, setHighlightId] = useState<PhraseId | null>(null);
  const [playbackSource, setPlaybackSource] = useState<PlaybackSource | null>(null);
  const [pendingTranscript, setPendingTranscript] = useState<string | null>(null);
  const [pendingIntents, setPendingIntents] = useState<VoiceIntents | null>(null);
  const [caps, setCaps] = useState(() => getLanguageCapabilities(lang));

  const lastIds = useRef<PhraseId[]>([]);
  const lastLang = useRef<VoiceLang>(lang);
  const listenResolve = useRef<((value: ListenResult | null) => void) | null>(null);

  useEffect(() => {
    void probePreRecordedAudio(lang).then((ok) => {
      setCaps((c) => ({ ...c, audioPack: ok }));
    });
  }, [lang]);

  const unlock = useCallback(() => {
    unlockAudio();
    setUnlocked(true);
  }, []);

  const stop = useCallback(() => {
    stopSpeaking();
    setState('idle');
    setHighlightId(null);
  }, []);

  const play = useCallback(
    async (ids: PhraseId[], opts?: PlayOptions) => {
      if (!ids.length) return;
      const speakLang = opts?.language ?? lang;
      lastIds.current = ids;
      lastLang.current = speakLang;
      stopSpeaking();
      setState('speaking');
      try {
        await speakSequence(
          ids,
          speakLang,
          (id) => setHighlightId(id),
          (_id, source) => setPlaybackSource(source),
        );
      } finally {
        setState((s) => (s === 'speaking' ? 'idle' : s));
      }
    },
    [lang],
  );

  const replay = useCallback(async () => {
    if (lastIds.current.length) await play(lastIds.current, { language: lastLang.current });
  }, [play]);

  const setSlower = useCallback(() => {
    const prev = getSpeed();
    const next: VoiceSpeed = prev === 1.25 ? 1 : prev === 1 ? 0.75 : 0.75;
    setSpeed(next);
    setSpeedState(next);
    void play(['slower_hint', ...lastIds.current], { language: lastLang.current });
  }, [play]);

  const setMute = useCallback((m: boolean) => {
    setMuted(m);
    setMuteState(m);
  }, []);

  const toggleMute = useCallback(() => {
    const next = !isMuted();
    setMuted(next);
    setMuteState(next);
  }, []);

  const listen = useCallback((): Promise<ListenResult | null> => {
    type Rec = {
      lang: string;
      interimResults: boolean;
      maxAlternatives: number;
      onresult: ((event: { results?: ArrayLike<ArrayLike<{ transcript?: string }>> }) => void) | null;
      onerror: (() => void) | null;
      onend: (() => void) | null;
      start: () => void;
    };
    const w = window as unknown as {
      SpeechRecognition?: new () => Rec;
      webkitSpeechRecognition?: new () => Rec;
    };
    const SR = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!SR || !caps.sttBrowser) return Promise.resolve(null);

    unlock();
    stopSpeaking();

    return new Promise((resolve) => {
      listenResolve.current = resolve;
      setState('listening');
      try {
        const rec = new SR();
        // Browser STT is most reliable with en-US; UI language stays separate for replies.
        rec.lang = 'en-US';
        rec.interimResults = false;
        rec.maxAlternatives = 1;
        rec.onresult = (event) => {
          const transcript = event.results?.[0]?.[0]?.transcript?.trim() || '';
          const intents = parseVoiceIntents(transcript, lang);
          setPendingTranscript(transcript);
          setPendingIntents(intents);
          setState('confirming');
          resolve({ transcript, intents });
          listenResolve.current = null;
        };
        rec.onerror = () => {
          setState('idle');
          resolve(null);
          listenResolve.current = null;
        };
        rec.onend = () => {
          setState((s) => (s === 'listening' ? 'idle' : s));
        };
        rec.start();
      } catch {
        setState('idle');
        resolve(null);
        listenResolve.current = null;
      }
    });
  }, [caps.sttBrowser, lang, unlock]);

  const confirmHeard = useCallback((): ListenResult | null => {
    if (!pendingTranscript) return null;
    const out = { transcript: pendingTranscript, intents: pendingIntents || {} };
    setPendingTranscript(null);
    setPendingIntents(null);
    setState('idle');
    return out;
  }, [pendingIntents, pendingTranscript]);

  const cancelHeard = useCallback(() => {
    setPendingTranscript(null);
    setPendingIntents(null);
    setState('idle');
  }, []);

  const value = useMemo(
    (): VoiceContextValue => ({
      state,
      unlocked,
      mute,
      speed,
      highlightId,
      playbackSource,
      pendingTranscript,
      pendingIntents,
      unlock,
      play,
      stop,
      replay,
      setSlower,
      setMute,
      toggleMute,
      listen,
      confirmHeard,
      cancelHeard,
      capabilities: caps,
    }),
    [
      state,
      unlocked,
      mute,
      speed,
      highlightId,
      playbackSource,
      pendingTranscript,
      pendingIntents,
      unlock,
      play,
      stop,
      replay,
      setSlower,
      setMute,
      toggleMute,
      listen,
      confirmHeard,
      cancelHeard,
      caps,
    ],
  );

  return <VoiceContext.Provider value={value}>{children}</VoiceContext.Provider>;
}

export function useVoice(): VoiceContextValue {
  const ctx = useContext(VoiceContext);
  if (!ctx) throw new Error('useVoice must be used within VoiceProvider');
  return ctx;
}

export function useVoicePhraseText(id: PhraseId): string {
  const { i18n } = useTranslation();
  const lang = voiceLangFromI18n(i18n.language);
  return getPhrase(id, lang);
}

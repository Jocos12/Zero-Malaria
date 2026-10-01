import { api } from '../api/client';
import { getPhrase, type PhraseId, type VoiceLang } from './phrases';

const MUTE_KEY = 'zm_voice_mute';
const SPEED_KEY = 'zm_voice_speed';
const VOLUME_KEY = 'zm_voice_volume';
const GAIN_KEY = 'zm_voice_gain_boost';

export type VoiceSpeed = 0.75 | 1 | 1.25;
export type PlaybackSource = 'audio_pack' | 'pindo' | 'text';

let audioUnlocked = false;
let currentAudio: HTMLAudioElement | null = null;
let sequenceToken = 0;
let gestureHookInstalled = false;
const audioPackCache: Partial<Record<VoiceLang, boolean>> = {};
const missingAudioLogged = new Set<string>();
let audioCtx: AudioContext | null = null;
let gainNode: GainNode | null = null;
let compressor: DynamicsCompressorNode | null = null;
const wiredElements = new WeakSet<HTMLAudioElement>();

/** Fail-fast probe for missing pack files (never hang the UI). */
const MP3_PROBE_MS = 400;
/** Pindo RW TTS can take a few seconds; keep triage responsive but allow synthesis. */
const CLOUD_TTS_MS = 12000;
/** Silent text highlight must not feel like a stalled step. */
const SILENT_FALLBACK_MS = 80;

function readMute(): boolean {
  return localStorage.getItem(MUTE_KEY) === '1';
}

function readSpeed(): VoiceSpeed {
  const v = Number(localStorage.getItem(SPEED_KEY));
  if (v === 0.75 || v === 1 || v === 1.25) return v;
  if (v === 0.8) return 0.75;
  if (v === 1.2) return 1.25;
  return 1;
}

function readVolume(): number {
  const v = Number(localStorage.getItem(VOLUME_KEY));
  if (Number.isFinite(v)) return Math.min(100, Math.max(0, v));
  const fromReadAloud = (() => {
    try {
      const raw = localStorage.getItem('zm_read_aloud_prefs');
      if (!raw) return 85;
      const p = JSON.parse(raw) as { volume?: number };
      return typeof p.volume === 'number' ? p.volume : 85;
    } catch {
      return 85;
    }
  })();
  return fromReadAloud;
}

function readGainBoost(): number {
  const v = Number(localStorage.getItem(GAIN_KEY));
  if (Number.isFinite(v)) return Math.min(200, Math.max(100, v));
  try {
    const raw = localStorage.getItem('zm_read_aloud_prefs');
    if (!raw) return 100;
    const p = JSON.parse(raw) as { gainBoost?: number };
    return typeof p.gainBoost === 'number' ? Math.min(200, Math.max(100, p.gainBoost)) : 100;
  } catch {
    return 100;
  }
}

export function setPlaybackVolume(volume: number): void {
  localStorage.setItem(VOLUME_KEY, String(Math.min(100, Math.max(0, volume))));
  applyGain();
}

export function setPlaybackGainBoost(percent: number): void {
  localStorage.setItem(GAIN_KEY, String(Math.min(200, Math.max(100, percent))));
  applyGain();
}

export function getPlaybackVolume(): number {
  return readVolume();
}

function ensureAudioGraph(): void {
  if (typeof window === 'undefined') return;
  if (!audioCtx) {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    audioCtx = new Ctx();
    compressor = audioCtx.createDynamicsCompressor();
    gainNode = audioCtx.createGain();
    gainNode.connect(compressor);
    compressor.connect(audioCtx.destination);
    compressor.threshold.value = -6;
    compressor.knee.value = 8;
    compressor.ratio.value = 16;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.15;
  }
  applyGain();
}

function applyGain(): void {
  if (!gainNode) return;
  const vol = readVolume() / 100;
  const boost = readGainBoost() / 100;
  gainNode.gain.value = Math.min(2, vol * boost);
}

function wireElementToGraph(audio: HTMLAudioElement): void {
  ensureAudioGraph();
  if (!audioCtx || !gainNode || wiredElements.has(audio)) return;
  try {
    const source = audioCtx.createMediaElementSource(audio);
    source.connect(gainNode);
    wiredElements.add(audio);
  } catch {
    /* element may already be wired */
  }
}

async function resumeAudioContext(): Promise<void> {
  if (audioCtx?.state === 'suspended') {
    try {
      await audioCtx.resume();
    } catch {
      /* ignore */
    }
  }
}

export function isMuted(): boolean {
  return readMute();
}

export function setMuted(mute: boolean): void {
  localStorage.setItem(MUTE_KEY, mute ? '1' : '0');
}

export function getSpeed(): VoiceSpeed {
  return readSpeed();
}

export function setSpeed(speed: VoiceSpeed): void {
  localStorage.setItem(SPEED_KEY, String(speed));
}

export function isAudioUnlocked(): boolean {
  return audioUnlocked;
}

/** Call on first user gesture so mobile browsers allow playback. */
export function unlockAudio(): void {
  audioUnlocked = true;
  if (gestureHookInstalled || typeof window === 'undefined') return;
  gestureHookInstalled = true;
  const unlock = () => {
    audioUnlocked = true;
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
  };
  window.addEventListener('pointerdown', unlock, { once: true });
  window.addEventListener('keydown', unlock, { once: true });
}

export function stopSpeaking(): void {
  sequenceToken += 1;
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.currentTime = 0;
    currentAudio = null;
  }
}

function sttBrowserAvailable(): boolean {
  if (typeof window === 'undefined') return false;
  const w = window as unknown as {
    SpeechRecognition?: unknown;
    webkitSpeechRecognition?: unknown;
  };
  return Boolean(w.SpeechRecognition || w.webkitSpeechRecognition);
}

export function getLanguageCapabilities(lang: VoiceLang): {
  ttsPindo: boolean;
  sttBrowser: boolean;
  audioPack: boolean;
} {
  const cachedPack = audioPackCache[lang];
  return {
    ttsPindo: lang === 'rw' && (typeof navigator === 'undefined' || navigator.onLine),
    sttBrowser: sttBrowserAvailable(),
    audioPack: lang === 'rw' && (cachedPack ?? false),
  };
}

function warnMissingAudio(lang: VoiceLang, id: string) {
  const key = `${lang}/${id}`;
  if (missingAudioLogged.has(key)) return;
  missingAudioLogged.add(key);
  if (import.meta.env.DEV) {
    console.warn(`[voice] Missing pre-recorded audio: /audio/${lang}/${id}.mp3 (falling back to text)`);
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const t = window.setTimeout(() => resolve(fallback), ms);
    promise
      .then((v) => {
        window.clearTimeout(t);
        resolve(v);
      })
      .catch(() => {
        window.clearTimeout(t);
        resolve(fallback);
      });
  });
}

async function probeMp3Exists(url: string): Promise<boolean> {
  if (typeof fetch === 'undefined') return true;
  try {
    const ctrl = new AbortController();
    const timer = window.setTimeout(() => ctrl.abort(), MP3_PROBE_MS);
    const res = await fetch(url, { method: 'HEAD', signal: ctrl.signal, cache: 'force-cache' });
    window.clearTimeout(timer);
    return res.ok;
  } catch {
    return false;
  }
}

async function tryMp3(
  id: PhraseId,
  lang: VoiceLang,
  speed: VoiceSpeed,
  failMs = 2500,
): Promise<boolean> {
  const url = `/audio/${lang}/${id}.mp3`;
  // Play directly — do not await a HEAD probe on the UI path (HEAD can hang or 405).
  // Optional short existence cache warm-up runs in the background only.
  void withTimeout(probeMp3Exists(url), MP3_PROBE_MS, false).then((exists) => {
    if (exists) audioPackCache[lang] = true;
  });
  return new Promise((resolve) => {
    const audio = new Audio(url);
    audio.preload = 'auto';
    audio.playbackRate = speed;
    wireElementToGraph(audio);
    void resumeAudioContext();
    currentAudio = audio;
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(failTimer);
      if (!ok) warnMissingAudio(lang, id);
      resolve(ok);
    };
    const failTimer = window.setTimeout(() => finish(false), failMs);
    audio.onended = () => finish(true);
    audio.onerror = () => finish(false);
    void audio.play().then(
      () => {
        /* playing — resolve onended */
      },
      () => finish(false),
    );
  });
}

async function tryPindoTts(
  id: PhraseId,
  lang: VoiceLang,
  text: string,
  speed: VoiceSpeed,
): Promise<{ url: string; mode: string } | null> {
  if (lang !== 'rw') return null;
  try {
    const res = await withTimeout(
      api.voiceSpeak({ phrase_id: id, language: 'rw', text, speech_rate: speed }),
      CLOUD_TTS_MS,
      { audio_url: null } as Record<string, unknown>,
    );
    const url = typeof res.audio_url === 'string' ? res.audio_url : null;
    if (!url) return null;
    const provider = typeof res.provider_used === 'string' ? res.provider_used : '';
    const mode = typeof res.mode === 'string' ? res.mode : provider || 'pindo';
    return { url, mode };
  } catch {
    return null;
  }
}

async function tryPindoAudio(url: string, speed: VoiceSpeed): Promise<boolean> {
  return new Promise((resolve) => {
    const audio = new Audio(url);
    audio.playbackRate = speed;
    wireElementToGraph(audio);
    void resumeAudioContext();
    currentAudio = audio;
    const t = window.setTimeout(() => resolve(false), 8000);
    audio.onended = () => {
      window.clearTimeout(t);
      resolve(true);
    };
    audio.onerror = () => {
      window.clearTimeout(t);
      resolve(false);
    };
    void audio.play().catch(() => {
      window.clearTimeout(t);
      resolve(false);
    });
  });
}

async function silentHighlight(): Promise<void> {
  await new Promise((r) => setTimeout(r, SILENT_FALLBACK_MS));
}

export async function speakPhrase(
  id: PhraseId,
  lang: VoiceLang,
  onHighlight?: (id: PhraseId) => void,
): Promise<{ source: PlaybackSource }> {
  unlockAudio();
  const speed = readSpeed();
  const text = getPhrase(id, lang);
  onHighlight?.(id);

  if (readMute()) {
    await silentHighlight();
    return { source: 'text' };
  }

  // Pindo TTS supports Kinyarwanda only. English stays on-screen text.
  if (lang !== 'rw') {
    await silentHighlight();
    return { source: 'text' };
  }

  const online = typeof navigator === 'undefined' || navigator.onLine;
  if (online) {
    const pindo = await tryPindoTts(id, lang, text, speed);
    if (pindo && audioUnlocked && (await tryPindoAudio(pindo.url, speed))) {
      if (pindo.mode === 'phrase_pack') {
        audioPackCache[lang] = true;
        return { source: 'audio_pack' };
      }
      return { source: 'pindo' };
    }
  }

  if (audioUnlocked && (await tryMp3(id, lang, speed))) {
    audioPackCache[lang] = true;
    return { source: 'audio_pack' };
  }

  await silentHighlight();
  return { source: 'text' };
}

export async function speakSequence(
  ids: PhraseId[],
  lang: VoiceLang,
  onHighlight?: (id: PhraseId) => void,
  onSource?: (id: PhraseId, source: PlaybackSource) => void,
): Promise<void> {
  const token = ++sequenceToken;
  for (const id of ids) {
    if (token !== sequenceToken) break;
    const { source } = await speakPhrase(id, lang, onHighlight);
    onSource?.(id, source);
  }
}

export async function probePreRecordedAudio(
  lang: VoiceLang = 'en',
  sampleId: PhraseId | string = 'disclaimer',
): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  try {
    const res = await fetch(`/audio/${lang}/${sampleId}.mp3`, { method: 'HEAD' });
    const ok = res.ok;
    audioPackCache[lang] = ok;
    return ok;
  } catch {
    audioPackCache[lang] = false;
    return false;
  }
}

export async function probeCloudReachable(): Promise<boolean> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return false;
  try {
    const status = await api.voiceStatus();
    return status.provider === 'pindo' && status.configured && status.supported_languages.includes('rw');
  } catch {
    return false;
  }
}

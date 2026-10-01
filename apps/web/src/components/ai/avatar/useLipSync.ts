import { useEffect, useRef, useState } from 'react';

export type LipSyncHandle = {
  /** Attach an HTMLAudioElement for AnalyserNode-driven mouth levels. */
  attachAudio: (audio: HTMLAudioElement | null) => void;
  /** Drive a soft envelope when using speechSynthesis (no raw PCM). */
  startSynthetic: () => void;
  stop: () => void;
};

/**
 * Mouth open amount 0..1 from Web Audio AnalyserNode, or a synthetic pulse
 * for speechSynthesis. Respects prefers-reduced-motion (returns 0).
 */
export function useLipSync(active: boolean, reduceMotion: boolean): {
  level: number;
  lip: LipSyncHandle;
} {
  const [level, setLevel] = useState(0);
  const ctxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const rafRef = useRef(0);
  const synthRef = useRef(0);
  const wired = useRef<HTMLAudioElement | null>(null);

  const stop = () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = 0;
    if (synthRef.current) window.clearInterval(synthRef.current);
    synthRef.current = 0;
    setLevel(0);
  };

  const tickAnalyser = () => {
    const analyser = analyserRef.current;
    if (!analyser) return;
    const data = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteTimeDomainData(data);
    let sum = 0;
    for (let i = 0; i < data.length; i++) {
      const v = (data[i]! - 128) / 128;
      sum += v * v;
    }
    const rms = Math.sqrt(sum / data.length);
    setLevel(Math.min(1, rms * 4.2));
    rafRef.current = requestAnimationFrame(tickAnalyser);
  };

  const ensureGraph = () => {
    if (typeof window === 'undefined') return null;
    if (!ctxRef.current) {
      const Ctx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return null;
      ctxRef.current = new Ctx();
      const analyser = ctxRef.current.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.7;
      analyser.connect(ctxRef.current.destination);
      analyserRef.current = analyser;
    }
    return ctxRef.current;
  };

  const lip: LipSyncHandle = {
    attachAudio: (audio) => {
      stop();
      if (!audio || reduceMotion || !active) {
        wired.current = null;
        return;
      }
      const ctx = ensureGraph();
      const analyser = analyserRef.current;
      if (!ctx || !analyser) return;
      void ctx.resume().catch(() => undefined);
      try {
        if (wired.current !== audio) {
          sourceRef.current?.disconnect();
          const src = ctx.createMediaElementSource(audio);
          src.connect(analyser);
          sourceRef.current = src;
          wired.current = audio;
        }
        rafRef.current = requestAnimationFrame(tickAnalyser);
      } catch {
        /* already wired elsewhere — fall back to synthetic */
        lip.startSynthetic();
      }
    },
    startSynthetic: () => {
      stop();
      if (reduceMotion || !active) return;
      let t = 0;
      synthRef.current = window.setInterval(() => {
        t += 1;
        // Soft syllable-like pulse
        const pulse = 0.25 + 0.55 * Math.abs(Math.sin(t / 3.2));
        setLevel(pulse * (0.7 + 0.3 * Math.sin(t / 7)));
      }, 80);
    },
    stop,
  };

  useEffect(() => {
    if (!active || reduceMotion) stop();
    return () => stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- cleanup only
  }, [active, reduceMotion]);

  return { level: reduceMotion ? 0 : level, lip };
}

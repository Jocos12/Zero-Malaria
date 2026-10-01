/** Per-user read-aloud prefs (local until a profile API exists). */

export type ReadAloudPrefs = {
  enabled: boolean;
  volume: number;
  /** Playback gain multiplier as percent (100 = normal, up to 200). */
  gainBoost: number;
  autoListen: boolean;
};

const KEY = 'zm_read_aloud_prefs';

const DEFAULTS: ReadAloudPrefs = {
  enabled: false,
  volume: 85,
  gainBoost: 100,
  autoListen: false,
};

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

export function loadReadAloudPrefs(): ReadAloudPrefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<ReadAloudPrefs>;
    return {
      enabled: Boolean(parsed.enabled),
      volume: clamp(Number(parsed.volume ?? DEFAULTS.volume), 0, 100),
      gainBoost: clamp(Number(parsed.gainBoost ?? DEFAULTS.gainBoost), 100, 200),
      autoListen: Boolean(parsed.autoListen),
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveReadAloudPrefs(patch: Partial<ReadAloudPrefs>): ReadAloudPrefs {
  const next = { ...loadReadAloudPrefs(), ...patch };
  next.volume = clamp(next.volume, 0, 100);
  next.gainBoost = clamp(next.gainBoost, 100, 200);
  localStorage.setItem(KEY, JSON.stringify(next));
  return next;
}

export function loudPreset(): ReadAloudPrefs {
  return saveReadAloudPrefs({ volume: 100, gainBoost: 200 });
}

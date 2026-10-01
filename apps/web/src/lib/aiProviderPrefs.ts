/** Demo Presenter prefs for AI provider mode (hidden from CHW UI). */

export type AiProviderMode = 'cascade' | 'race' | 'consensus';

const MODE_KEY = 'zm_ai_provider_mode';

export function getAiProviderMode(): AiProviderMode {
  try {
    const v = localStorage.getItem(MODE_KEY);
    if (v === 'race' || v === 'consensus' || v === 'cascade') return v;
  } catch {
    /* ignore */
  }
  return 'cascade';
}

export function setAiProviderMode(mode: AiProviderMode): void {
  try {
    localStorage.setItem(MODE_KEY, mode);
    window.dispatchEvent(new CustomEvent('zm-ai-provider-mode', { detail: mode }));
  } catch {
    /* ignore */
  }
}

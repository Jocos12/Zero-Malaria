import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getLanguageCapabilities } from './speak';

describe('Pindo TTS language capabilities', () => {
  beforeEach(() => {
    vi.stubGlobal('navigator', { onLine: true });
    vi.stubGlobal('window', {});
  });

  it('enables online Pindo TTS for Kinyarwanda', () => {
    expect(getLanguageCapabilities('rw').ttsPindo).toBe(true);
  });

  it('does not expose English TTS', () => {
    const capabilities = getLanguageCapabilities('en');
    expect(capabilities.ttsPindo).toBe(false);
    expect(capabilities.audioPack).toBe(false);
  });

  it('marks Pindo unavailable while offline', () => {
    vi.stubGlobal('navigator', { onLine: false });
    expect(getLanguageCapabilities('rw').ttsPindo).toBe(false);
  });
});

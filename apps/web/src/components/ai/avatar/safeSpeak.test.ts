import { describe, expect, it } from 'vitest';
import { sanitizeForSpeech, speakLangCode } from './safeSpeak';

describe('sanitizeForSpeech', () => {
  it('blocks dose and fine-at-home phrases', () => {
    const fb = 'SAFE';
    expect(sanitizeForSpeech('Give 250 mg paracetamol', fb).blocked).toBe(true);
    expect(sanitizeForSpeech('The patient is fine at home', fb).text).toBe('SAFE');
  });

  it('keeps safe protocol text', () => {
    const out = sanitizeForSpeech('Arrange urgent transport now.', 'SAFE');
    expect(out.blocked).toBe(false);
    expect(out.text).toContain('urgent transport');
  });

  it('maps language codes', () => {
    expect(speakLangCode('rw-RW')).toBe('rw');
    expect(speakLangCode('fr')).toBe('fr');
    expect(speakLangCode('en')).toBe('en');
  });
});

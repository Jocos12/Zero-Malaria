import { describe, expect, it } from 'vitest';
import { ruleSentence, shortReason } from './ruleSentences';

describe('ruleSentences', () => {
  it('never returns raw snake_case keys for known rules', () => {
    for (const id of [
      'unable_to_drink',
      'vomiting_everything',
      'convulsions',
      'lethargy',
      'severe_breathing_difficulty',
      'invalid_tdr_refer',
    ]) {
      const en = ruleSentence(id, 'en');
      expect(en).not.toMatch(/_/);
      expect(en.length).toBeGreaterThan(5);
    }
  });

  it('humanizes unknown keys', () => {
    expect(ruleSentence('custom_rule_x', 'en')).toBe('custom rule x');
  });

  it('prefers reasons then triggered', () => {
    expect(shortReason(['Fits seen'], ['convulsions'], 'en')).toMatch(/Convulsions/i);
    expect(shortReason(['Fits seen'], ['convulsions'], 'rw')).toMatch(/Gusetsa|fits/i);
    expect(shortReason([], ['convulsions'], 'en')).toMatch(/Convulsions/i);
  });
});

import { describe, expect, it } from 'vitest';
import {
  buildConsistencyWarnings,
  buildLocalAnswerInsights,
  hashSnapshot,
} from './localAnswerInsights';
import type { TriageInput } from '../types';

const base: TriageInput = {
  age_months: 12,
  sex: 'female',
  temperature_c: 36.5,
  fever_days: 3,
  convulsions: false,
  unable_to_drink: false,
  vomiting_everything: false,
  lethargy: false,
  severe_breathing_difficulty: false,
  tdr_result: 'negative',
};

describe('localAnswerInsights Layer 1', () => {
  it('builds age insight in under 50ms', () => {
    const answered = new Set(['age', 'sex']);
    const t0 = performance.now();
    const insights = buildLocalAnswerInsights(base, answered, 'en');
    const elapsed = performance.now() - t0;
    expect(insights.some((i) => i.field === 'age' && i.source === 'rule')).toBe(true);
    expect(elapsed).toBeLessThan(50);
  });

  it('flags danger signs as critical', () => {
    const form = { ...base, convulsions: true };
    const insights = buildLocalAnswerInsights(form, new Set(['convulsions']), 'en');
    expect(insights[0]?.flag).toBe('danger');
    expect(insights[0]?.contribution).toBe('critical');
  });

  it('shows consistency warning for normal temp + long fever without blocking', () => {
    const warnings = buildConsistencyWarnings(base, new Set(['temperature', 'feverDays']), 'en');
    expect(warnings.some((w) => w.id === 'temp_vs_fever_days')).toBe(true);
    expect(warnings.every((w) => w.dismissible)).toBe(true);
  });

  it('hashes snapshot without PII keys', () => {
    const h = hashSnapshot(base, ['age', 'sex']);
    expect(h).not.toMatch(/name|phone|gps|village/i);
    expect(h).toContain('age_months');
  });
});

import { describe, expect, it } from 'vitest';
import { decisionRank, evaluateRules, maxDecision } from './engine';

const base = {
  age_months: 36,
  sex: 'female' as const,
  temperature_c: 38.6,
  fever_days: 2,
  convulsions: false,
  unable_to_drink: false,
  vomiting_everything: false,
  lethargy: false,
  severe_breathing_difficulty: false,
  tdr_result: 'positive' as const,
};

describe('offline rules engine', () => {
  it('treats simple malaria at home', () => {
    expect(evaluateRules(base).decision).toBe('treat_at_home');
  });

  it('urgent on convulsions', () => {
    expect(evaluateRules({ ...base, convulsions: true }).decision).toBe('urgent_refer');
  });

  it('does not urgent-refer from blood signs alone when escalation disabled', () => {
    const r = evaluateRules(
      {
        ...base,
        pale_palms_or_eyelids: 'yes',
        blood_in_stool: 'yes',
      },
      'en',
      [
        'age_months',
        'sex',
        'temperature_c',
        'fever_days',
        'convulsions',
        'unable_to_drink',
        'vomiting_everything',
        'lethargy',
        'severe_breathing_difficulty',
        'pale_palms_or_eyelids',
        'blood_in_stool',
        'tdr_result',
      ],
    );
    expect(r.decision).toBe('treat_at_home');
    expect(r.inform_nurse_fields).toContain('pale_palms_or_eyelids');
    expect(r.pending_blood_clinical_validation).toBe(true);
  });

  it('never lets maxDecision downgrade urgent', () => {
    expect(maxDecision('urgent_refer', 'treat_at_home')).toBe('urgent_refer');
    expect(decisionRank(maxDecision('urgent_refer', 'refer'))).toBeGreaterThanOrEqual(
      decisionRank('urgent_refer'),
    );
  });
});

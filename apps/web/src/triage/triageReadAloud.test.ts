import { describe, expect, it } from 'vitest';
import { phraseIdsForTriageStep } from './triageReadAloud';

describe('phraseIdsForTriageStep', () => {
  it('includes question and yes/no options for convulsions', () => {
    expect(phraseIdsForTriageStep('convulsions', 'convulsions')).toEqual([
      'convulsions',
      'prompt_yes',
      'prompt_no',
    ]);
  });

  it('includes sex options', () => {
    expect(phraseIdsForTriageStep('sex', 'sex')).toEqual(['sex', 'opt_female', 'opt_male']);
  });

  it('includes TDR options', () => {
    expect(phraseIdsForTriageStep('tdr', 'tdr')).toEqual([
      'tdr',
      'opt_positive',
      'opt_negative',
      'opt_invalid',
    ]);
  });
});

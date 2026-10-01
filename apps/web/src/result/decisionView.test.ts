import { describe, expect, it } from 'vitest';
import type { DecisionResult, TriageInput } from '../types';
import {
  assertCatalogNextSteps,
  assertRuleReasonsNotAi,
  buildDecisionView,
  scoreToRiskBand,
} from './decisionView';

const baseInput: TriageInput = {
  age_months: 24,
  sex: 'male',
  temperature_c: 39,
  fever_days: 2,
  convulsions: true,
  unable_to_drink: false,
  vomiting_everything: true,
  lethargy: false,
  severe_breathing_difficulty: false,
  tdr_result: 'positive',
};

function result(partial: Partial<DecisionResult>): DecisionResult {
  return {
    decision: 'urgent_refer',
    rules_decision: 'urgent_refer',
    public_decision: 'urgent_referral',
    reasons: ['Convulsions reported'],
    triggered_rules: ['convulsions', 'vomiting_everything'],
    reason_details: [],
    missing_info: [],
    protocol_reference: 'rules/clinical_config.yaml',
    ml_escalated: false,
    severe_risk: 1,
    shap_factors: ['convulsions', 'vomiting_everything', 'severe_breathing_difficulty'],
    confidence: 0.9,
    human_confirmation_required: true,
    disclaimer: 'demo',
    ...partial,
  };
}

describe('DecisionView', () => {
  it('maps synthetic 1.0 score to High band (never bare 100% as primary)', () => {
    expect(scoreToRiskBand(1)).toBe('high');
    expect(scoreToRiskBand(0.99)).toBe('high');
    expect(scoreToRiskBand(0.5)).toBe('medium');
    expect(scoreToRiskBand(0.1)).toBe('low');
    const view = buildDecisionView(baseInput, result({ severe_risk: 1 }));
    expect(view.risk.band).toBe('high');
    expect(view.risk.synthetic).toBe(true);
    expect(view.risk.source).toBe('ml');
  });

  it('marks reasons as rule provenance only (never AI)', () => {
    const view = buildDecisionView(baseInput, result({}));
    assertRuleReasonsNotAi(view);
    expect(view.reasons.every((r) => r.source === 'rule')).toBe(true);
  });

  it('uses fixed catalog next_steps for urgent and refer (never LLM)', () => {
    const urgent = buildDecisionView(baseInput, result({ decision: 'urgent_refer' }));
    assertCatalogNextSteps(urgent);
    expect(urgent.next_steps.every((s) => s.source === 'catalog')).toBe(true);
    expect(urgent.next_steps.map((s) => s.phrase_id)).toEqual([
      'next_urgent_1',
      'next_urgent_2',
      'next_urgent_3',
      'next_urgent_4',
    ]);

    const refer = buildDecisionView(
      baseInput,
      result({ decision: 'refer', rules_decision: 'refer', triggered_rules: ['invalid_tdr_refer'] }),
    );
    assertCatalogNextSteps(refer);
    expect(refer.next_steps.every((s) => s.source === 'catalog')).toBe(true);
  });

  it('exposes ML escalation only when ml raised the decision', () => {
    const view = buildDecisionView(
      baseInput,
      result({
        decision: 'urgent_refer',
        rules_decision: 'treat_at_home',
        ml_escalated: true,
        severe_risk: 0.8,
      }),
    );
    expect(view.decision_source).toBe('ml_escalation');
    expect(view.escalation?.from).toBe('treat_at_home');
    expect(view.escalation?.to).toBe('urgent_refer');
  });

  it('guideline note is always placeholder status', () => {
    const view = buildDecisionView(baseInput, result({}));
    expect(view.guideline.status).toBe('placeholder');
  });
});

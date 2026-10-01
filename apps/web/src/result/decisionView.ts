/**
 * Single DecisionView selector — UI must not mix rules / ML / AI provenance.
 */
import { mlEscalateThreshold } from '../lib/decisionGuard';
import type { Decision, DecisionResult, TriageInput } from '../types';
import {
  NEXT_STEPS_BY_DECISION,
  reasonPhraseIdForRuleOrSign,
  type PhraseId,
} from '../voice/phrases';

export type ProvenanceSource = 'rule' | 'ml' | 'ai' | 'catalog';

export type RiskBand = 'low' | 'medium' | 'high';

export type DecisionViewReason = {
  id: string;
  text_key: string;
  source: 'rule';
};

export type DecisionViewStep = {
  phrase_id: PhraseId;
  source: 'catalog';
};

export type DecisionViewFactor = {
  label_key: string;
  direction: 'increases' | 'decreases' | 'neutral';
};

export type DecisionView = {
  decision: Decision;
  decision_source: 'rules' | 'ml_escalation';
  reasons: DecisionViewReason[];
  next_steps: DecisionViewStep[];
  risk: {
    band: RiskBand;
    score: number | null;
    top_factors: DecisionViewFactor[];
    source: 'ml';
    synthetic: true;
  };
  ai_summary: {
    text: string;
    provider: string;
    latency_ms: number;
    fallback_reason: string | null;
    needs_native_review: boolean;
  } | null;
  escalation: {
    from: Decision;
    to: Decision;
    score: number | null;
    threshold: number;
  } | null;
  guideline: {
    version: string;
    status: 'placeholder';
  };
  patient: {
    age_months: number;
    sex: 'female' | 'male' | null;
  };
};

export function scoreToRiskBand(score: number | null | undefined): RiskBand {
  if (score == null || Number.isNaN(score)) return 'medium';
  const s = Math.min(1, Math.max(0, score));
  if (s < 0.34) return 'low';
  if (s < 0.67) return 'medium';
  return 'high';
}

/** Display helpers — never expose a bare "100%" as the primary risk UI. */
export function riskBandLabelKey(band: RiskBand): string {
  if (band === 'low') return 'result.riskLow';
  if (band === 'medium') return 'result.riskMedium';
  return 'result.riskHigh';
}

function factorFromShap(raw: string): DecisionViewFactor {
  const key = raw.replace(/\s+/g, '_').toLowerCase();
  const direction: DecisionViewFactor['direction'] = /decreas|lower|reduc/i.test(raw)
    ? 'decreases'
    : /increas|risk|danger/i.test(raw)
      ? 'increases'
      : 'neutral';
  return { label_key: key || raw, direction };
}

export function catalogNextSteps(decision: Decision): DecisionViewStep[] {
  const ids = NEXT_STEPS_BY_DECISION[decision] || NEXT_STEPS_BY_DECISION.treat_at_home;
  return ids.map((phrase_id) => ({ phrase_id, source: 'catalog' as const }));
}

export function buildDecisionView(
  input: TriageInput,
  result: DecisionResult,
  aiSummary?: DecisionView['ai_summary'],
): DecisionView {
  const decision = (result.decision || result.rules_decision || 'treat_at_home') as Decision;
  const rulesDecision = (result.rules_decision || decision) as Decision;
  const decision_source: DecisionView['decision_source'] = result.ml_escalated
    ? 'ml_escalation'
    : 'rules';

  const ruleIds =
    result.triggered_rules?.length > 0
      ? result.triggered_rules
      : (result.reason_details || []).map((r) => r.rule_id).filter(Boolean);

  const reasons: DecisionViewReason[] = [];
  for (const id of ruleIds) {
    const phrase = reasonPhraseIdForRuleOrSign(id);
    reasons.push({
      id,
      text_key: phrase || `reason_${id}`,
      source: 'rule',
    });
  }
  if (!reasons.length && result.reasons?.length) {
    reasons.push({
      id: 'primary_reason',
      text_key: result.reasons[0],
      source: 'rule',
    });
  }

  const score = typeof result.severe_risk === 'number' ? result.severe_risk : null;
  const band = scoreToRiskBand(score);
  const top_factors = (result.shap_factors || []).slice(0, 3).map(factorFromShap);

  const escalation =
    result.ml_escalated && rulesDecision !== decision
      ? {
          from: rulesDecision,
          to: decision,
          score,
          threshold: mlEscalateThreshold(),
        }
      : null;

  return {
    decision,
    decision_source,
    reasons,
    next_steps: catalogNextSteps(decision),
    risk: {
      band,
      score,
      top_factors,
      source: 'ml',
      synthetic: true,
    },
    ai_summary: aiSummary ?? null,
    escalation,
    guideline: {
      version: result.protocol_reference || 'clinical_config.yaml',
      status: 'placeholder',
    },
    patient: {
      age_months: input.age_months,
      sex: input.sex === 'female' || input.sex === 'male' ? input.sex : null,
    },
  };
}

/** Guard used in tests: next_steps must be catalog-only for refer/urgent. */
export function assertCatalogNextSteps(view: DecisionView): void {
  if (view.decision === 'treat_at_home' || view.decision === 'refer' || view.decision === 'urgent_refer') {
    for (const step of view.next_steps) {
      if (step.source !== 'catalog') {
        throw new Error(`next_steps must be catalog for ${view.decision}, got ${step.source}`);
      }
    }
  }
}

/** Guard used in tests: rule reasons must never carry AI provenance. */
export function assertRuleReasonsNotAi(view: DecisionView): void {
  for (const r of view.reasons) {
    if (r.source !== 'rule') {
      throw new Error(`reason ${r.id} must be rule provenance, got ${r.source}`);
    }
  }
}

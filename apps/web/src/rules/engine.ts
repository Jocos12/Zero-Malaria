import { MALARIA_RULES } from './malariaRules.generated';
import type {
  Decision,
  PublicDecision,
  ReasonDetail,
  RulesResult,
  TriageInput,
} from '../types';

type Lang = 'en' | 'rw';

const PUBLIC_DECISION: Record<Decision, PublicDecision> = {
  treat_at_home: 'treat_locally',
  refer: 'monitor',
  urgent_refer: 'urgent_referral',
};

const DANGER_FIELDS = [
  'convulsions',
  'unable_to_drink',
  'vomiting_everything',
  'lethargy',
  'severe_breathing_difficulty',
] as const;

function isTriYes(value: unknown): boolean | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1;
  if (typeof value === 'string') {
    const s = value.trim().toLowerCase();
    if (s === 'yes' || s === 'y' || s === '1' || s === 'true') return true;
    if (s === 'no' || s === 'n' || s === '0' || s === 'false') return false;
    if (s === 'unknown' || s === 'simbizi') return false;
  }
  return null;
}

function reasonOf(
  obj: { reason_en: string; reason_rw?: string; protocol_section?: string },
  lang: Lang,
  cfg: typeof MALARIA_RULES,
): string {
  const template = lang === 'rw' && obj.reason_rw ? obj.reason_rw : obj.reason_en;
  return template
    .replaceAll('{infant_refer_months}', String(cfg.infant_refer_months))
    .replaceAll('{persistent_fever_days}', String(cfg.persistent_fever_days));
}

export function decisionRank(decision: Decision): number {
  return MALARIA_RULES.decision_rank[decision];
}

export function maxDecision(a: Decision, b: Decision): Decision {
  return decisionRank(a) >= decisionRank(b) ? a : b;
}

export function toPublicDecision(decision: Decision): PublicDecision {
  return PUBLIC_DECISION[decision];
}

/** Offline Layer 1 - same YAML as the API. Never invents thresholds. */
export function evaluateRules(
  input: TriageInput,
  language: Lang = 'en',
  answeredFields?: Iterable<string>,
): RulesResult {
  const cfg = MALARIA_RULES;
  const reasons: string[] = [];
  const triggered: string[] = [];
  const reason_details: ReasonDetail[] = [];
  const missing: string[] = [];
  const informNurse: string[] = [];
  let pendingBloodValidation = false;
  let decision: Decision = 'treat_at_home';
  const answered = answeredFields ? new Set(answeredFields) : null;

  const isAnswered = (name: string) => {
    if (answered) return answered.has(name);
    return true; // legacy: treat all fields as answered when set not provided
  };

  for (const sign of cfg.danger_signs) {
    const field = sign.field as keyof TriageInput;
    if (!isAnswered(String(field))) {
      missing.push(String(field));
      continue;
    }
    if (input[field]) {
      decision = 'urgent_refer';
      triggered.push(sign.id);
      const text = reasonOf(sign, language, cfg);
      reasons.push(text);
      reason_details.push({
        rule_id: sign.id,
        field: String(field),
        answer: true,
        text,
        protocol_section: 'protocol_section' in sign ? String((sign as { protocol_section?: string }).protocol_section || '') : null,
      });
    }
  }

  const bloodSigns = (cfg as { blood_related_signs?: typeof cfg.danger_signs }).blood_related_signs || [];
  for (const sign of bloodSigns) {
    const field = sign.field as keyof TriageInput;
    if ((sign as { status?: string }).status === 'pending_clinical_validation') {
      pendingBloodValidation = true;
    }
    if (!isAnswered(String(field))) continue;
    if (isTriYes(input[field]) !== true) continue;
    if ((sign as { inform_nurse?: boolean }).inform_nurse) {
      informNurse.push(String(field));
    }
    if ((sign as { escalation_enabled?: boolean }).escalation_enabled) {
      decision = 'urgent_refer';
      triggered.push(sign.id);
      const text = reasonOf(sign, language, cfg);
      reasons.push(text);
      reason_details.push({
        rule_id: sign.id,
        field: String(field),
        answer: true,
        text,
        protocol_section:
          'protocol_section' in sign ? String((sign as { protocol_section?: string }).protocol_section || '') : null,
      });
    }
  }

  if (!isAnswered('age_months')) {
    missing.push('age_months');
  } else if (input.age_months < cfg.infant_refer_months) {
    decision = 'urgent_refer';
    if (!triggered.includes('infant_age_referral')) {
      triggered.push('infant_age_referral');
      const infant = cfg.rules.find((r) => r.id === 'infant_age_referral');
      if (infant) {
        const text = reasonOf(infant, language, cfg);
        reasons.push(text);
        reason_details.push({
          rule_id: 'infant_age_referral',
          field: 'age_months',
          answer: input.age_months,
          text,
          protocol_section: 'protocol_section' in infant ? String((infant as { protocol_section?: string }).protocol_section || '') : null,
        });
      }
    }
  }

  const urgent = decision === 'urgent_refer';

  if (!isAnswered('tdr_result')) missing.push('tdr_result');
  if (!isAnswered('fever_days')) missing.push('fever_days');
  if (!isAnswered('temperature_c')) missing.push('temperature_c');
  if (!isAnswered('sex')) missing.push('sex');

  if (!urgent && isAnswered('tdr_result') && input.tdr_result === 'invalid') {
    decision = 'refer';
    triggered.push('invalid_tdr_refer');
    const rule = cfg.rules.find((r) => r.id === 'invalid_tdr_refer');
    if (rule) {
      const text = reasonOf(rule, language, cfg);
      reasons.push(text);
      reason_details.push({
        rule_id: 'invalid_tdr_refer',
        field: 'tdr_result',
        answer: 'invalid',
        text,
        protocol_section: 'protocol_section' in rule ? String((rule as { protocol_section?: string }).protocol_section || '') : null,
      });
    }
  }

  if (
    !urgent &&
    decision !== 'refer' &&
    isAnswered('tdr_result') &&
    isAnswered('fever_days') &&
    input.tdr_result === 'negative' &&
    input.fever_days >= cfg.persistent_fever_days
  ) {
    decision = 'refer';
    triggered.push('persistent_fever_negative_tdr');
    const rule = cfg.rules.find((r) => r.id === 'persistent_fever_negative_tdr');
    if (rule) {
      const text = reasonOf(rule, language, cfg);
      reasons.push(text);
      reason_details.push({
        rule_id: 'persistent_fever_negative_tdr',
        field: 'fever_days',
        answer: input.fever_days,
        text,
        protocol_section: 'protocol_section' in rule ? String((rule as { protocol_section?: string }).protocol_section || '') : null,
      });
    }
  }

  const missingDanger = DANGER_FIELDS.some((f) => missing.includes(f));
  if (!urgent && missingDanger && decision === 'treat_at_home') {
    decision = 'refer';
    triggered.push('incomplete_assessment');
    const rule = cfg.rules.find((r) => r.id === 'incomplete_assessment');
    const text = rule
      ? reasonOf(rule, language, cfg)
      : 'Incomplete assessment - danger signs not fully answered';
    reasons.push(text);
    reason_details.push({
      rule_id: 'incomplete_assessment',
      field: null,
      answer: null,
      text,
      protocol_section: rule && 'protocol_section' in rule ? String((rule as { protocol_section?: string }).protocol_section || '') : null,
    });
  }

  if (decision === 'treat_at_home' && reasons.length === 0 && !missingDanger) {
    triggered.push('default_treat_at_home');
    const rule = cfg.rules.find((r) => r.id === 'default_treat_at_home');
    if (rule) {
      const text = reasonOf(rule, language, cfg);
      reasons.push(text);
      reason_details.push({
        rule_id: 'default_treat_at_home',
        field: null,
        answer: null,
        text,
        protocol_section: 'protocol_section' in rule ? String((rule as { protocol_section?: string }).protocol_section || '') : null,
      });
    }
  }

  const protocol_reference =
    'protocol_reference' in cfg.meta ? String((cfg.meta as { protocol_reference?: string }).protocol_reference || '') : '';

  return {
    decision,
    public_decision: toPublicDecision(decision),
    reasons,
    triggered_rules: triggered,
    reason_details,
    missing_info: [...new Set(missing)].sort(),
    protocol_reference,
    inform_nurse_fields: [...new Set(informNurse)].sort(),
    pending_blood_clinical_validation: pendingBloodValidation,
  };
}

export function localDecide(
  input: TriageInput,
  language: Lang = 'en',
  answeredFields?: Iterable<string>,
) {
  const rules = evaluateRules(input, language, answeredFields);
  return {
    ...rules,
    rules_decision: rules.decision,
    ml_escalated: false,
    severe_risk: null as number | null,
    shap_factors: [] as string[],
    confidence: rules.decision === 'urgent_refer' ? 0.95 : 0.72,
    human_confirmation_required: true as const,
    disclaimer: cfgDisclaimer(),
    ai_advisory: null,
  };
}

function cfgDisclaimer(): string {
  return (
    MALARIA_RULES.meta.disclaimer ||
    'Decision support tool. Not a replacement for clinical judgment.'
  );
}

export { MALARIA_RULES };

export type Decision = 'treat_at_home' | 'refer' | 'urgent_refer';
/** Public labels for UI / eval (maps from Decision). */
export type PublicDecision = 'treat_locally' | 'monitor' | 'urgent_referral';

export type YesNoUnknownAnswer = 'yes' | 'no' | 'unknown';

export type TriageInput = {
  age_months: number;
  sex: 'female' | 'male';
  temperature_c: number;
  fever_days: number;
  convulsions: boolean;
  unable_to_drink: boolean;
  vomiting_everything: boolean;
  lethargy: boolean;
  severe_breathing_difficulty: boolean;
  pale_palms_or_eyelids?: YesNoUnknownAnswer;
  blood_in_stool?: YesNoUnknownAnswer;
  dark_or_bloody_urine?: YesNoUnknownAnswer;
  bleeding_nose_gums_skin_or_vomit_blood?: YesNoUnknownAnswer;
  hemoglobin_g_dl?: number | null;
  tdr_result: 'positive' | 'negative' | 'invalid';
};

export type ReasonDetail = {
  rule_id: string;
  field: string | null;
  answer: unknown;
  text: string;
  protocol_section?: string | null;
};

export type RulesResult = {
  decision: Decision;
  public_decision: PublicDecision;
  reasons: string[];
  triggered_rules: string[];
  reason_details: ReasonDetail[];
  missing_info: string[];
  protocol_reference: string;
  inform_nurse_fields?: string[];
  pending_blood_clinical_validation?: boolean;
};

export type AiTraceEffect = 'critical' | 'raises' | 'neutral' | 'not_reported';

export type AiTraceContribution = {
  question: string;
  answer: string;
  effect: AiTraceEffect;
  reason_phrase_id?: string;
  triggered?: boolean;
  inform_nurse?: boolean;
  pending_clinical_validation?: boolean;
};

export type AiTraceMlFactor = {
  label: string;
  direction?: string;
  raw?: string;
};

export type AiTraceAiAdded = {
  placement?: string;
  type: string;
  text: string;
  provider?: string;
  latency_ms?: number;
  source_rule_ids?: string[];
};

export type AiTracePipelineStep = {
  id: string;
  status: string;
  provider?: string;
  latency_ms?: number;
  timestamp?: string;
  locked?: boolean;
  decision?: string;
  decision_label?: string;
  escalated_by_ml?: boolean;
  fallback_reason?: string | null;
};

export type AiTraceWhatIf = {
  field: string;
  if_answer: string;
  decision: string;
  decision_label: string;
  source?: string;
  note?: string;
};

export type AiTraceGuardrail = {
  urgency_lowered_blocked?: boolean;
  blocked_items?: Array<{
    text: string;
    reason: string;
    title?: string;
    why?: string;
    action?: string;
    ai_explained?: boolean;
  }>;
  drug_or_dose_filtered?: boolean;
  ai_summary?: string;
};

export type PreventionPlanItem = {
  catalog_id: string;
  who: string;
  when: string;
  why_for_patient: string;
  family_message?: string;
  source_ref?: string;
  ai_reworded?: boolean;
};

export type PreventionPlan = {
  version?: string;
  pending_clinical_validation?: boolean;
  items: PreventionPlanItem[];
  protocol_items: PreventionPlanItem[];
};

export type AiTraceImpact = {
  urgency_changed?: string;
  wording_items?: number;
  checks_run?: number;
  time_added_ms?: number;
  provider?: string;
  fallback_reason?: string | null;
  fallback_chain?: string;
};

export type AiTrace = {
  pipeline: AiTracePipelineStep[];
  rules: {
    decision: string;
    decision_label: string;
    final_decision?: string;
    final_decision_label?: string;
    triggered_rule_ids: string[];
    contributions: AiTraceContribution[];
    inform_nurse_fields?: string[];
    pending_blood_clinical_validation?: boolean;
  };
  ml: {
    urgency_risk: {
      score: number | null;
      meaning?: string;
      label_key?: string;
      analysis?: {
        how?: string;
        steps?: string[];
        factors?: AiTraceMlFactor[];
        escalated_by_ml?: boolean;
        can_only_escalate?: boolean;
        synthetic?: boolean;
        score?: number | null;
        score_pct?: number | null;
      };
    };
    referral_followup_risk: {
      score: number | null;
      meaning?: string;
      label_key?: string;
      analysis?: {
        how?: string;
        steps?: string[];
        factors?: AiTraceMlFactor[];
        escalated_by_ml?: boolean;
        can_only_escalate?: boolean;
        synthetic?: boolean;
        score?: number | null;
        score_pct?: number | null;
      };
    };
    top_factors: AiTraceMlFactor[];
    escalated_by_ml?: boolean;
    synthetic?: boolean;
    can_only_escalate?: boolean;
  };
  ai_added: AiTraceAiAdded[];
  guardrail: AiTraceGuardrail;
  consistency_checks: Array<{
    id?: string;
    code?: string;
    severity?: boolean;
    message: string;
    source?: string;
  }>;
  what_if: AiTraceWhatIf[];
  prevention_plan?: PreventionPlan;
  impact: AiTraceImpact;
  snapshot?: Record<string, unknown>;
  build_ms?: number;
  language?: string;
  demo_safety_lock?: boolean;
};

export type AiCompareProvider = {
  provider: string;
  status: string;
  answer?: string | null;
  latency_ms?: number;
  agreement?: string | null;
  reason?: string | null;
  provider_used?: string;
};

export type AiCompareResult = {
  ok?: boolean;
  providers: AiCompareProvider[];
  summary?: {
    agree_count?: number;
    locked_decision_label?: string;
  };
};

export type DecisionResult = RulesResult & {
  rules_decision: Decision;
  ml_escalated: boolean;
  severe_risk: number | null;
  shap_factors: string[];
  confidence: number;
  human_confirmation_required: true;
  disclaimer: string;
  ai_advisory?: AiAdvisory | null;
  ai_trace?: AiTrace;
};

export type AiAdvisory = {
  explanation_rw: string;
  explanation_en: string;
  inconsistencies: string[];
  caregiver_advice_rw: string;
  handover_summary: string;
  suggested_escalation: boolean;
  citations: string[];
  needs_native_review: boolean;
  chw_followed?: boolean | null;
};

export type ReferralStatus = 'sent' | 'received' | 'arrived' | 'treated';

export type LocalReferral = {
  id?: number;
  client_uuid: string;
  facility_id: string;
  chw_id: string;
  district: string;
  sector: string;
  age_months: number;
  sex: string;
  decision: 'refer' | 'urgent_refer';
  reasons: string[];
  summary: string;
  status: ReferralStatus;
  created_at: string;
  received_at?: string;
  arrived_at?: string;
  treated_at?: string;
  synced: boolean;
  demo?: boolean;
};

export type SyncQueueItem = {
  id?: number;
  client_uuid: string;
  type: 'referral' | 'activity_count';
  payload: Record<string, unknown>;
  created_at: string;
};

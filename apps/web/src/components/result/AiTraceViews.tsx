/**
 * Assumptions:
 * - Clinical urgency stays locked to rules; ML escalate-only; AI wording/checks only.
 * - Never render raw decision enums (urgent_refer etc.) — use decision_label / i18n.
 * - What-if flips are rules-engine only from ai_trace.what_if (do not mutate saved triage).
 * - Offline quick chips answer from ai_trace when present; network compare is optional.
 */
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Gauge,
  Lock,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Volume2,
} from 'lucide-react';
import { motion, useReducedMotion } from 'framer-motion';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/client';
import { cn } from '../../lib/cn';
import { easeOut } from '../../lib/motion';
import type {
  AiCompareProvider,
  AiCompareResult,
  AiTrace,
  AiTraceContribution,
  Decision,
  DecisionResult,
  TriageInput,
} from '../../types';
import { Badge, Button, Card } from '../ui';
import { ProtocolNoticeBar } from './RecommendationCard';
import { stripDashes } from './protocolCopy';
import { ruleSentence } from './ruleSentences';

const DANGER_FIELDS = [
  'convulsions',
  'unable_to_drink',
  'vomiting_everything',
  'lethargy',
  'severe_breathing_difficulty',
] as const;

const BLOOD_TRI_FIELDS = [
  'pale_palms_or_eyelids',
  'blood_in_stool',
  'dark_or_bloody_urine',
  'bleeding_nose_gums_skin_or_vomit_blood',
  'hemoglobin_g_dl',
] as const;

const FIELD_I18N: Record<string, string> = {
  convulsions: 'triage.convulsions',
  unable_to_drink: 'triage.unableToDrink',
  vomiting_everything: 'triage.vomitingEverything',
  lethargy: 'triage.lethargy',
  severe_breathing_difficulty: 'triage.breathing',
  pale_palms_or_eyelids: 'triage.palePalms',
  blood_in_stool: 'triage.bloodInStool',
  dark_or_bloody_urine: 'triage.bloodyUrine',
  bleeding_nose_gums_skin_or_vomit_blood: 'triage.bleedingSigns',
  hemoglobin_g_dl: 'triage.hemoglobin',
  temperature_c: 'triage.temperature',
  fever_days: 'triage.feverDays',
  tdr_result: 'triage.tdr',
  age_months: 'triage.age',
};

function fieldLabel(field: string, t: (k: string) => string): string {
  const key = FIELD_I18N[field];
  return key ? t(key) : field.replace(/_/g, ' ');
}

function decisionTone(decision: string): 'danger' | 'warning' | 'success' {
  if (decision === 'urgent_refer') return 'danger';
  if (decision === 'refer') return 'warning';
  return 'success';
}

function decisionI18n(decision: string, t: (k: string) => string): string {
  if (decision === 'urgent_refer') return t('result.urgent');
  if (decision === 'refer') return t('result.refer');
  return t('result.treat');
}

function effectChip(effect: string, t: (k: string) => string) {
  if (effect === 'critical') return { tone: 'danger' as const, label: t('ai.effectCritical') };
  if (effect === 'raises') return { tone: 'warning' as const, label: t('ai.effectRaises') };
  if (effect === 'not_reported') return { tone: 'neutral' as const, label: t('ai.notReported') };
  return { tone: 'neutral' as const, label: t('ai.effectNeutral') };
}

function answerDisplay(c: AiTraceContribution, t: (k: string) => string): string {
  if (c.answer === 'yes') return t('triage.yes');
  if (c.answer === 'no') return t('triage.no');
  if (c.answer === 'unknown' || !c.answer) return t('ai.notReported');
  return String(c.answer);
}

function ruleIdForContribution(c: AiTraceContribution, triggered: string[]): string {
  if (triggered.includes(c.question)) return c.question;
  if (c.question === 'tdr_result') {
    return triggered.find((id) => id.includes('tdr') || id.includes('invalid')) || '';
  }
  if (c.question === 'temperature_c' || c.question === 'fever_days') {
    return triggered.find((id) => id.includes('fever')) || '';
  }
  if (c.question === 'age_months') {
    return triggered.find((id) => id.includes('age') || id.includes('infant')) || '';
  }
  return triggered.find((id) => id.includes(c.question)) || '';
}

function dossierSection(title: string, testId: string, children: ReactNode) {
  return (
    <section
      className="space-y-2 rounded-[14px] border border-border bg-surface p-3 shadow-sm"
      data-testid={testId}
    >
      <h3 className="text-[13px] font-semibold uppercase tracking-wide text-ink-muted">{title}</h3>
      {children}
    </section>
  );
}

export function ImpactStrip({
  trace,
  mode,
}: {
  trace: AiTrace | null;
  mode: 'rules' | 'rules_ai';
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  if (mode !== 'rules_ai' || !trace?.impact) return null;
  const imp = trace.impact;
  const added = (imp.wording_items ?? 0) + (imp.checks_run ?? 0);
  return (
    <div
      className="mb-2 rounded-[12px] border border-info/30 bg-info/5 text-xs"
      data-testid="ai-impact-strip"
      aria-label={t('ai.impactTitle')}
    >
      <button
        type="button"
        className="flex w-full flex-wrap items-center gap-2 px-3 py-2 text-left"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        data-testid="ai-impact-toggle"
      >
        <Sparkles className="h-3.5 w-3.5 shrink-0 text-info" aria-hidden />
        <span className="font-semibold text-ink">{t('ai.impactTitle')}</span>
        <Badge tone="info">{t('ai.itemsAddedByAiMl', { count: added })}</Badge>
        <span className="ml-auto text-[11px] font-semibold text-ink-muted">{open ? '−' : '+'}</span>
      </button>
      {open ? (
        <div className="flex flex-wrap items-center gap-2 border-t border-info/20 px-3 py-2">
          <Badge tone="success">{t('ai.impactUrgencyNever')}</Badge>
          <span className="text-ink-muted">{t('ai.impactWording', { count: imp.wording_items ?? 0 })}</span>
          <span className="text-ink-muted">{t('ai.impactChecks', { count: imp.checks_run ?? 0 })}</span>
        </div>
      ) : null}
    </div>
  );
}

export function VerdictCard({
  result,
  trace,
  reasonLine,
}: {
  result: DecisionResult;
  trace: AiTrace | null;
  reasonLine?: string;
}) {
  const { t } = useTranslation();
  const decision = (trace?.rules?.final_decision || result.decision) as Decision;
  const label =
    trace?.rules?.final_decision_label || decisionI18n(decision, t);
  const tone = decisionTone(decision);
  const banner =
    tone === 'danger' ? 'bg-danger text-white' : tone === 'warning' ? 'bg-warning text-white' : 'bg-success text-white';
  const reduce = useReducedMotion();
  return (
    <motion.div
      className={cn('mb-3 rounded-[18px] px-4 py-4 shadow-sm', banner)}
      data-testid="verdict-card"
      initial={reduce ? false : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: reduce ? 0 : 0.26, ease: [0.22, 1, 0.36, 1] }}
    >
      <div className="flex items-start gap-2">
        <p
          className={cn(
            'min-w-0 flex-1 text-xl font-bold leading-tight tracking-tight',
            tone === 'danger' && !reduce && 'motion-safe:animate-[zm-pulse-once_1.2s_ease-out_1]',
          )}
        >
          {label}
        </p>
        <span
          className="inline-flex shrink-0 items-center gap-1 rounded-full bg-white/20 px-2.5 py-1 text-[11px] font-semibold"
          title={t('ai.decisionLockedByProtocol')}
        >
          <Lock className="h-3 w-3" aria-hidden />
          {t('ai.decisionLockedByProtocol')}
        </span>
      </div>
      {reasonLine ? <p className="mt-1.5 text-sm opacity-95">{reasonLine}</p> : null}
    </motion.div>
  );
}

export function RecommendationHierarchy({
  result,
  trace,
  language,
  doNow,
  tellFamily,
  comeBack,
  showAiBadges,
  onReadFamily,
  protocolMeta,
}: {
  result: DecisionResult;
  trace: AiTrace | null;
  language: string;
  doNow: string[];
  tellFamily: string;
  comeBack: string;
  showAiBadges?: boolean;
  onReadFamily?: () => void;
  protocolMeta?: {
    validated?: boolean;
    protocol_version?: string;
    protocol_name?: string;
    source_file?: string;
  };
}) {
  const { t } = useTranslation();
  const [whyOpen, setWhyOpen] = useState(false);
  const familyAi = showAiBadges && Boolean(trace?.ai_added?.some((a) => a.type === 'family_message'));
  const ruleIds = trace?.rules?.triggered_rule_ids || result.triggered_rules || [];
  const referralRisk = trace?.ml?.referral_followup_risk?.score;

  const reduce = useReducedMotion();
  const card = 'rounded-[18px] border border-border bg-surface p-4 shadow-sm';
  return (
    <div className="space-y-3" data-testid="recommendation-hierarchy">
      <ProtocolNoticeBar meta={protocolMeta} />
      {(
        [
          {
            id: 'do',
            node: (
              <section className={card} data-testid="rec-do-now">
                <h4 className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
                  {t('result.whatNowSteps')}
                </h4>
                <ol className="mt-2.5 list-decimal space-y-1.5 pl-4 text-[15px] leading-snug">
                  {(doNow.length ? doNow : [t('common.empty')]).slice(0, 4).map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ol>
              </section>
            ),
          },
          {
            id: 'family',
            node: (
              <section
                className={cn(
                  card,
                  familyAi && showAiBadges ? 'border-success/35 bg-success/5' : '',
                )}
                data-testid="rec-tell-family"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <h4 className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
                    {t('result.tellFamily')}
                  </h4>
                  {familyAi ? (
                    <Badge tone="success" className="inline-flex items-center gap-1">
                      <Sparkles className="h-3 w-3" aria-hidden />
                      {t('ai.aiAddedBadge')}
                    </Badge>
                  ) : null}
                  {onReadFamily ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className="min-h-11"
                      leftIcon={<Volume2 className="h-3.5 w-3.5" />}
                      onClick={onReadFamily}
                    >
                      {t('result.readAloud')}
                    </Button>
                  ) : null}
                </div>
                <p className="mt-2.5 text-[15px] leading-snug">{tellFamily || t('common.empty')}</p>
              </section>
            ),
          },
          {
            id: 'back',
            node: (
              <section className={card} data-testid="rec-come-back">
                <h4 className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
                  {t('result.whenBack')}
                </h4>
                <p className="mt-2.5 text-[15px] leading-snug">{comeBack || t('common.empty')}</p>
              </section>
            ),
          },
        ] as const
      ).map((item, i) => (
        <motion.div
          key={item.id}
          initial={reduce ? false : { opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: reduce ? 0 : 0.05 + i * 0.05, duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
        >
          {item.node}
        </motion.div>
      ))}
      <div className="overflow-hidden rounded-[18px] border border-border bg-surface shadow-sm">
        <button
          type="button"
          className="flex min-h-11 w-full items-center justify-between px-4 py-3 text-left text-sm font-semibold transition-colors hover:bg-surface-muted/60"
          aria-expanded={whyOpen}
          onClick={() => setWhyOpen((v) => !v)}
          data-testid="rec-why-accordion"
        >
          {t('result.why')}
          <ChevronDown
            className={cn('h-4 w-4 shrink-0 transition-transform duration-200', whyOpen ? 'rotate-180' : 'rotate-0')}
            aria-hidden
          />
        </button>
        <motion.div
          initial={false}
          animate={{ height: whyOpen ? 'auto' : 0, opacity: whyOpen ? 1 : 0 }}
          transition={{ duration: reduce ? 0 : 0.22, ease: [0.22, 1, 0.36, 1] }}
          className="overflow-hidden"
        >
          <div className="space-y-2 border-t border-border px-4 py-3 text-sm">
            {typeof referralRisk === 'number' ? (
              <p className="text-ink-muted">
                {t('ai.facilityReachRisk')}: {Math.round(referralRisk * 100)}%
              </p>
            ) : null}
            <ul className="space-y-1.5">
              {ruleIds.map((rid) => (
                <li key={rid} className="flex items-start gap-2" data-rule-id={rid}>
                  <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" aria-hidden />
                  <span>{ruleSentence(rid, language)}</span>
                </li>
              ))}
            </ul>
          </div>
        </motion.div>
      </div>
    </div>
  );
}

function SourceChips({ sources, t }: { sources: Array<'rule' | 'ml' | 'ai'>; t: (k: string) => string }) {
  return (
    <span className="inline-flex flex-wrap gap-1">
      {sources.includes('rule') ? (
        <span title={t('ai.provenanceRule')} className="inline-flex">
          <Badge tone="primary">{t('ai.provenanceRule')}</Badge>
        </span>
      ) : null}
      {sources.includes('ml') ? (
        <span title={t('ai.provenanceMl')} className="inline-flex">
          <Badge tone="info" className="!bg-purple-100 !text-purple-700 dark:!bg-purple-900/40 dark:!text-purple-200">
            {t('ai.provenanceMl')}
          </Badge>
        </span>
      ) : null}
      {sources.includes('ai') ? (
        <span title={t('ai.provenanceAi')} className="inline-flex">
          <Badge tone="success">{t('ai.provenanceAi')}</Badge>
        </span>
      ) : null}
    </span>
  );
}

const FACTOR_LABELS: Record<string, { rw: string; en: string }> = {
  lethargy: { rw: 'Gucika intege / ntabona', en: 'Lethargy or unconsciousness' },
  unable_to_drink: { rw: 'Ntashobora kunywa', en: 'Unable to drink or feed' },
  vomiting_everything: { rw: 'Kuraruka byose', en: 'Vomiting everything' },
  convulsions: { rw: 'Gusetsa', en: 'Convulsions' },
  severe_breathing_difficulty: { rw: "Agorwa n'uruhuha", en: 'Severe breathing difficulty' },
  fever_days: { rw: "Iminsi y'ubushyuhe", en: 'Fever days' },
  temperature_c: { rw: 'Ubushyuhe', en: 'Temperature' },
  age_months: { rw: 'Imyaka (amezi)', en: 'Age (months)' },
};

function localizeFactorLabel(raw: string, language: string): string {
  const cleaned = (raw || '')
    .replace(/\s*\(synthetic\)/gi, '')
    .replace(/\bincreases risk\b/gi, '')
    .replace(/\bdecreases risk\b/gi, '')
    .trim();
  const low = cleaned.toLowerCase().replace(/\s+/g, '_');
  const rw = language.startsWith('rw');
  for (const [key, pack] of Object.entries(FACTOR_LABELS)) {
    if (low.includes(key) || cleaned.toLowerCase().includes(pack.en.toLowerCase().split(' ')[0]!)) {
      return rw ? pack.rw : pack.en;
    }
  }
  return cleaned.replace(/_/g, ' ');
}

function MlGauge({
  label,
  score,
  meaning,
  analysis,
  language,
  testId,
}: {
  label: string;
  score: number | null | undefined;
  meaning?: string;
  analysis?: NonNullable<AiTrace['ml']['urgency_risk']['analysis']>;
  language: string;
  testId?: string;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const pct = score != null ? Math.round(Math.min(1, Math.max(0, score)) * 100) : null;
  const factors = analysis?.factors || [];
  return (
    <div
      className={cn(
        'rounded-[12px] border border-border bg-surface p-3 transition-shadow',
        open && 'ring-2 ring-info/30',
      )}
      data-testid={testId || 'ml-gauge'}
    >
      <button
        type="button"
        className="w-full text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        data-testid={testId ? `${testId}-toggle` : 'ml-gauge-toggle'}
        title={t('ai.clickScoreForDetail')}
      >
        <div className="mb-1 flex justify-between text-xs">
          <span className="font-semibold">{label}</span>
          <span className="inline-flex items-center gap-1 font-mono font-bold text-info">
            {pct != null ? `${pct}%` : t('common.unavailable')}
            <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-180')} aria-hidden />
          </span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-surface-muted">
          <div className="h-full rounded-full bg-info transition-all" style={{ width: `${pct ?? 0}%` }} />
        </div>
        {meaning ? (
          <p className="mt-1 text-[11px] text-ink-muted">{stripDashes(meaning)}</p>
        ) : null}
        <p className="mt-1 text-[10px] font-semibold text-info">{t('ai.clickScoreForDetail')}</p>
      </button>
      {open ? (
        <div
          className="mt-2 space-y-2 border-t border-border pt-2 text-sm"
          data-testid={testId ? `${testId}-detail` : 'ml-gauge-detail'}
        >
          <div className="flex flex-wrap items-center gap-1">
            <Badge tone="success" className="normal-case">
              {t('ai.aiBadge')}
            </Badge>
            <Badge tone="info" className="normal-case">
              {t('ai.provenanceMl')}
            </Badge>
          </div>
          <p className="leading-snug text-ink">
            {stripDashes(analysis?.how || meaning || t('result.notAvailable'))}
          </p>
          {analysis?.steps?.length ? (
            <ol className="list-decimal space-y-1 pl-4 text-[13px] text-ink">
              {analysis.steps.map((s) => (
                <li key={s}>{s.replace(/^\d+\)\s*/, '')}</li>
              ))}
            </ol>
          ) : null}
          {factors.length ? (
            <ul className="space-y-1">
              <li className="text-[11px] font-semibold uppercase text-ink-muted">{t('ai.topFactors')}</li>
              {factors.slice(0, 5).map((f) => (
                <li key={f.label} className="flex flex-wrap items-center gap-1.5">
                  <Badge tone="info" className="normal-case">
                    {localizeFactorLabel(f.label, language)}
                  </Badge>
                  {f.direction === 'increases' ? (
                    <span className="text-[11px] text-warning">{t('ai.effectRaises')}</span>
                  ) : f.direction === 'decreases' ? (
                    <span className="text-[11px] text-ink-muted">{t('ai.effectNeutral')}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
          <p className="text-[11px] text-ink-muted">{t('ai.mlEscalateOnly')}</p>
          {analysis?.synthetic !== false ? (
            <p className="text-[11px] text-ink-muted">{t('ai.syntheticMetrics')}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function AnalysisGrouped({
  trace,
  mode,
  highlightAi,
  language,
  missingInfo,
  protocolReference,
}: {
  trace: AiTrace | null;
  mode: 'rules' | 'rules_ai';
  highlightAi?: boolean;
  language: string;
  missingInfo?: string[];
  protocolReference?: string;
}) {
  const { t } = useTranslation();
  const [notReportedOpen, setNotReportedOpen] = useState<Record<string, boolean>>({});

  const triggeredRuleIds = trace?.rules?.triggered_rule_ids || [];
  const rulesDecision = trace?.rules?.decision || '';
  const finalDecision = trace?.rules?.final_decision || rulesDecision;
  const precedenceApplied = Boolean(finalDecision && rulesDecision && finalDecision !== rulesDecision);

  const groups = useMemo(() => {
    const contributions = trace?.rules?.contributions || [];
    const danger = contributions.filter((c) => DANGER_FIELDS.includes(c.question as (typeof DANGER_FIELDS)[number]));
    const measurements = contributions.filter((c) =>
      ['temperature_c', 'fever_days', 'age_months'].includes(c.question),
    );
    const rdt = contributions.filter((c) => c.question === 'tdr_result');
    const blood = contributions.filter((c) =>
      (BLOOD_TRI_FIELDS as readonly string[]).includes(c.question),
    );
    return [
      { id: 'danger', title: t('ai.groupDanger'), rows: danger },
      { id: 'blood', title: t('ai.groupBlood'), rows: blood },
      { id: 'measurements', title: t('ai.groupMeasurements'), rows: measurements },
      { id: 'rdt', title: t('ai.groupRdt'), rows: rdt },
    ];
  }, [trace, t]);

  const rowMeaning = (qid: string) =>
    (trace?.ai_added || []).find(
      (a) => a.placement === `row:${qid}` || (a.type === 'row_meaning' && a.source_rule_ids?.includes(qid)),
    )?.text || '';

  const missingPrompts = useMemo(() => {
    const fromResult = (missingInfo || []).map((text) => ({ text, source: 'result' as const }));
    const fromAi = (trace?.ai_added || [])
      .filter((a) => a.type === 'missing_info')
      .map((a) => ({ text: a.text, source: 'ai' as const }));
    const seen = new Set<string>();
    const merged: { text: string; source: 'result' | 'ai' }[] = [];
    for (const row of [...fromResult, ...fromAi]) {
      const key = row.text.trim();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      merged.push(row);
    }
    return merged;
  }, [missingInfo, trace?.ai_added]);

  const aiAddedCount = (trace?.ai_added || []).length;
  const consistency = (trace?.ai_added || []).filter((a) => a.type === 'consistency_check');
  const nurseSummaries = (trace?.ai_added || []).filter((a) => a.type === 'nurse_summary');
  const preventionItems =
    mode === 'rules'
      ? trace?.prevention_plan?.protocol_items || []
      : trace?.prevention_plan?.items || [];

  const preventionWho = (who: string) => {
    if (who === 'family') return t('result.preventionWhoFamily');
    if (who === 'facility') return t('result.preventionWhoFacility');
    return t('result.preventionWhoChw');
  };

  const renderAnswerRow = (c: AiTraceContribution, highlighted: boolean) => {
    const eff = effectChip(c.effect, t);
    const ruleId = ruleIdForContribution(c, triggeredRuleIds);
    const sources: Array<'rule' | 'ml' | 'ai'> = ['rule'];
    const meaningRaw =
      mode === 'rules_ai' ? rowMeaning(c.question) || (c.triggered ? ruleSentence(c.question, language) : '') : '';
    if (mode === 'rules_ai' && c.triggered) sources.push('ml');
    if (mode === 'rules_ai' && (highlightAi || c.triggered) && meaningRaw) sources.push('ai');

    return (
      <tr
        key={c.question}
        className={cn(
          'border-t border-border text-sm',
          highlighted ? 'bg-warning-soft/30' : '',
          mode === 'rules_ai' && highlightAi && c.triggered && meaningRaw ? 'ring-1 ring-inset ring-success/25' : '',
        )}
        data-testid={`analysis-row-${c.question}`}
        data-mode={mode}
      >
        <td className="px-2 py-2 align-top">
          <span className="font-medium">{fieldLabel(c.question, t)}</span>
          {c.inform_nurse ? (
            <Badge tone="info" className="ml-1 normal-case" data-testid={`inform-nurse-${c.question}`}>
              {t('ai.informNurseFlag')}
            </Badge>
          ) : null}
        </td>
        <td className="px-2 py-2 align-top">{answerDisplay(c, t)}</td>
        <td className="px-2 py-2 align-top">
          <Badge tone={eff.tone}>{eff.label}</Badge>
        </td>
        <td className="px-2 py-2 align-top font-mono text-[11px] text-ink-muted" data-testid={`rule-id-${c.question}`}>
          {ruleId || (c.effect === 'not_reported' ? '' : t('common.unavailable'))}
        </td>
        {mode === 'rules_ai' ? (
          <td className="px-2 py-2 align-top" data-testid={`ai-meaning-${c.question}`}>
            {meaningRaw ? (
              <div className={cn(highlightAi && 'rounded-md border-l-2 border-success pl-2')}>
                <p className="text-ink-muted">{stripDashes(meaningRaw)}</p>
                <Badge tone="success" className="mt-1 normal-case">
                  {t('ai.aiBadge')}
                </Badge>
              </div>
            ) : null}
          </td>
        ) : null}
        <td className="px-2 py-2 align-top">
          <SourceChips sources={mode === 'rules' ? ['rule'] : sources} t={t} />
        </td>
      </tr>
    );
  };

  const inputSummary = useMemo(() => {
    const contribs = trace?.rules?.contributions || [];
    const answered = contribs.filter((c) => c.effect !== 'not_reported').length;
    return t('ai.decisionPathInputsSummary', { answered, total: contribs.length });
  }, [trace?.rules?.contributions, t]);

  return (
    <div className="space-y-3" data-testid="analysis-grouped" data-analysis-mode={mode}>
      {mode === 'rules' ? (
        <div
          className="rounded-[12px] border border-border bg-surface-muted px-3 py-2 text-sm text-ink-muted"
          data-testid="analysis-rules-only-banner"
          role="status"
        >
          {t('ai.analysisRulesOnlyBanner')}
        </div>
      ) : (
        <div
          className="rounded-[12px] border border-success/30 bg-success/5 px-3 py-2 text-sm"
          data-testid="analysis-rules-ai-banner"
          role="status"
        >
          {t('ai.analysisRulesAiBanner')}
          {highlightAi ? (
            <span className="ml-2 font-semibold text-success">
              {t('ai.itemsAddedByAiMl', { count: aiAddedCount })}
            </span>
          ) : null}
        </div>
      )}

      {dossierSection(
        t('ai.decisionPath'),
        'decision-path',
        <ol className="space-y-2 text-sm">
          <li className="flex gap-2" data-testid="decision-path-inputs">
            <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-surface-muted text-[11px] font-bold">
              1
            </span>
            <div>
              <p className="font-semibold text-ink">{t('ai.decisionPathInputs')}</p>
              <p className="text-ink-muted">{inputSummary}</p>
            </div>
          </li>
          <li className="flex gap-2" data-testid="decision-path-rules">
            <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-surface-muted text-[11px] font-bold">
              2
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-ink">{t('ai.decisionPathRules')}</p>
              <ul className="mt-1 space-y-1">
                {(triggeredRuleIds.length ? triggeredRuleIds : ['default_treat_at_home']).map((rid) => (
                  <li key={rid} className="flex flex-wrap items-start gap-2" data-rule-id={rid}>
                    <Badge tone="primary" className="font-mono normal-case">
                      {rid}
                    </Badge>
                    <span className="text-ink-muted">{ruleSentence(rid, language)}</span>
                  </li>
                ))}
              </ul>
            </div>
          </li>
          <li className="flex gap-2" data-testid="decision-path-precedence">
            <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-surface-muted text-[11px] font-bold">
              3
            </span>
            <div>
              <p className="font-semibold text-ink">{t('ai.decisionPathPrecedence')}</p>
              <p className="text-ink-muted">
                {precedenceApplied
                  ? t('ai.decisionPrecedenceMl', {
                      rules: trace?.rules?.decision_label || decisionI18n(rulesDecision, t),
                      final: trace?.rules?.final_decision_label || decisionI18n(finalDecision, t),
                    })
                  : t('ai.decisionPrecedenceRulesOnly')}
              </p>
            </div>
          </li>
          <li className="flex gap-2" data-testid="decision-path-final">
            <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent/15 text-[11px] font-bold text-accent">
              4
            </span>
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-semibold text-ink">{t('ai.decisionPathFinal')}</p>
              <Badge tone={decisionTone(finalDecision) === 'danger' ? 'danger' : decisionTone(finalDecision) === 'warning' ? 'warning' : 'success'}>
                {trace?.rules?.final_decision_label || decisionI18n(finalDecision, t)}
              </Badge>
              <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-ink-muted">
                <Lock className="h-3 w-3" aria-hidden />
                {t('ai.decisionLockedByProtocol')}
              </span>
            </div>
          </li>
        </ol>,
      )}

      {trace?.rules?.pending_blood_clinical_validation ? (
        <p
          className="rounded-[10px] border border-border bg-surface-muted px-3 py-2 text-[12px] text-ink-muted"
          data-testid="blood-clinical-validation-notice"
          role="status"
        >
          {t('ai.bloodPendingValidation')}
        </p>
      ) : null}

      {dossierSection(
        t('ai.answersTable'),
        'answers-table',
        <div className="space-y-4">
          {groups.map((g) => {
            const reported = g.rows.filter((r) => r.effect !== 'not_reported');
            const notReported = g.rows.filter((r) => r.effect === 'not_reported');
            const open = notReportedOpen[g.id];
            return (
              <div key={g.id} data-testid={`analysis-group-${g.id}`}>
                <p className="mb-1 text-[12px] font-semibold text-ink">{g.title}</p>
                <div className="overflow-x-auto rounded-[10px] border border-border">
                  <table className="w-full min-w-[480px] border-collapse text-left">
                    <thead className="bg-surface-muted/80 text-[10px] font-semibold uppercase text-ink-muted">
                      <tr>
                        <th className="px-2 py-1.5">{t('result.colQuestion')}</th>
                        <th className="px-2 py-1.5">{t('result.colAnswer')}</th>
                        <th className="px-2 py-1.5">{t('result.colFlag')}</th>
                        <th className="px-2 py-1.5">{t('ai.colRuleId')}</th>
                        {mode === 'rules_ai' ? <th className="px-2 py-1.5">{t('result.colMeaning')}</th> : null}
                        <th className="px-2 py-1.5">{t('result.colSource')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {reported.map((c) =>
                        renderAnswerRow(c, c.triggered || c.effect === 'critical' || c.effect === 'raises'),
                      )}
                    </tbody>
                  </table>
                </div>
                {notReported.length ? (
                  <div className="mt-1">
                    <button
                      type="button"
                      className="text-xs font-semibold text-ink-muted underline-offset-2 hover:underline"
                      onClick={() => setNotReportedOpen((prev) => ({ ...prev, [g.id]: !prev[g.id] }))}
                      data-testid={`not-reported-toggle-${g.id}`}
                    >
                      {t('ai.collapsedNotReported', { count: notReported.length })}
                    </button>
                    {open ? (
                      <div className="mt-2 overflow-x-auto rounded-[10px] border border-border">
                        <table className="w-full min-w-[480px] border-collapse text-left">
                          <tbody>{notReported.map((c) => renderAnswerRow(c, false))}</tbody>
                        </table>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>,
      )}

      {dossierSection(
        t('ai.missingData'),
        'missing-data',
        missingPrompts.length ? (
          <ul className="space-y-1.5 text-sm">
            {missingPrompts.map((m) => (
              <li
                key={m.text}
                className="rounded-[10px] border border-border/80 bg-surface-muted/50 px-2.5 py-2 text-ink-muted"
              >
                {stripDashes(m.text)}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-ink-muted">{t('common.empty')}</p>
        ),
      )}

      {dossierSection(
        t('ai.protocolEvidence'),
        'protocol-evidence',
        <div className="space-y-2 text-sm">
          <p>
            <span className="font-semibold text-ink">{t('result.protocolRef')}:</span>{' '}
            <span className="text-ink-muted">{protocolReference || t('common.unavailable')}</span>
          </p>
          {trace?.prevention_plan?.version ? (
            <p>
              <span className="font-semibold text-ink">{t('ai.protocolVersion')}:</span>{' '}
              <span className="text-ink-muted">{trace.prevention_plan.version}</span>
            </p>
          ) : null}
          <p className="text-ink-muted">{t('ai.protocolValidationPending')}</p>
          {triggeredRuleIds.length ? (
            <div>
              <p className="mb-1 text-[11px] font-semibold uppercase text-ink-muted">{t('ai.protocolLinesTitle')}</p>
              <ul className="list-disc space-y-0.5 pl-4 text-ink-muted">
                {triggeredRuleIds.map((rid) => (
                  <li key={rid}>
                    <span className="font-mono text-[11px] text-ink">{rid}</span>: {ruleSentence(rid, language)}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>,
      )}

      {mode === 'rules_ai' && trace?.ml ? (
        <div className="space-y-2" data-testid="ml-gauges">
          <div className="grid gap-2 sm:grid-cols-2">
            <MlGauge
              label={t('ai.severityRisk')}
              score={trace.ml.urgency_risk?.score}
              meaning={trace.ml.urgency_risk?.meaning || t('ai.mlEscalateOnly')}
              analysis={trace.ml.urgency_risk?.analysis}
              language={language}
              testId="ml-gauge-severity"
            />
            <MlGauge
              label={t('ai.facilityReachRisk')}
              score={trace.ml.referral_followup_risk?.score}
              meaning={trace.ml.referral_followup_risk?.meaning}
              analysis={trace.ml.referral_followup_risk?.analysis}
              language={language}
              testId="ml-gauge-referral"
            />
          </div>
          {trace.ml.top_factors?.length ? (
            <ul className="rounded-[12px] border border-border bg-surface p-3 text-sm" data-testid="ml-top-factors">
              <li className="mb-1 text-[11px] font-semibold uppercase text-ink-muted">
                {t('ai.topFactors')} · {t('ai.mlEscalateOnly')}
              </li>
              {trace.ml.top_factors.slice(0, 3).map((f) => (
                <li key={f.label} className="flex items-start gap-2">
                  <Gauge className="mt-0.5 h-3.5 w-3.5 shrink-0 text-info" aria-hidden />
                  <Badge tone="info" className="normal-case">
                    {localizeFactorLabel(f.label, language)}
                  </Badge>
                </li>
              ))}
              {trace.ml.synthetic ? (
                <li className="mt-2 text-[11px] text-ink-muted">{t('ai.syntheticMetrics')}</li>
              ) : null}
            </ul>
          ) : null}
        </div>
      ) : null}

      {preventionItems.length ? (
        <section
          className="space-y-2 rounded-[12px] border border-border bg-surface p-3"
          data-testid="prevention-plan"
        >
          <h3 className="text-[14px] font-semibold text-ink">{t('result.preventionPlanTitle')}</h3>
          <ul className="space-y-2">
            {preventionItems.map((item) => (
              <li
                key={item.catalog_id}
                className="rounded-[10px] border border-border/80 bg-surface-muted/40 p-2.5 text-sm"
                data-testid={`prevention-item-${item.catalog_id}`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone="neutral" className="normal-case">
                    {preventionWho(item.who)}
                  </Badge>
                  {item.when ? (
                    <span className="text-[11px] text-ink-muted">
                      {t('result.preventionWhen')}: {stripDashes(item.when)}
                    </span>
                  ) : null}
                  {mode === 'rules_ai' && item.ai_reworded ? (
                    <Badge tone="success" className="normal-case">
                      {t('ai.aiBadge')}
                    </Badge>
                  ) : null}
                </div>
                <p className="mt-1 leading-snug text-ink">{stripDashes(item.why_for_patient)}</p>
                {item.family_message ? (
                  <p className="mt-1 text-[13px] text-ink-muted">{stripDashes(item.family_message)}</p>
                ) : null}
              </li>
            ))}
          </ul>
          {trace?.prevention_plan?.pending_clinical_validation ? (
            <p className="text-[11px] text-ink-muted">{t('ai.preventionPendingValidation')}</p>
          ) : null}
        </section>
      ) : null}

      {mode === 'rules_ai' && consistency.length ? (
        <div className="rounded-[12px] border border-border bg-surface p-3 text-sm" data-testid="analysis-consistency">
          <p className="text-[11px] font-semibold uppercase text-ink-muted">{t('ai.safetyChecks')}</p>
          <ul className="mt-1 space-y-1">
            {consistency.map((c) => (
              <li key={c.text}>{c.text}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {mode === 'rules_ai' && nurseSummaries.length ? (
        <section className="rounded-[12px] border border-border bg-surface p-3 text-sm" data-testid="analysis-nurse-summary">
          <p className="text-[11px] font-semibold uppercase text-ink-muted">{t('ai.nurseSummarySection')}</p>
          <ul className="mt-1 space-y-1">
            {nurseSummaries.map((n) => (
              <li key={n.text} className={cn(highlightAi && 'rounded-md border-l-2 border-success pl-2')}>
                {stripDashes(n.text)}
                <Badge tone="success" className="ml-1 normal-case">
                  {t('ai.aiBadge')}
                </Badge>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {mode === 'rules_ai' && missingPrompts.length ? (
        <section
          className="rounded-[12px] border border-info/30 bg-info/5 p-3 text-sm"
          data-testid="analysis-questions-to-ask"
        >
          <p className="text-[11px] font-semibold uppercase text-ink-muted">{t('ai.questionsToAsk')}</p>
          <ul className="mt-1 space-y-1">
            {missingPrompts.map((m) => (
              <li key={`ask-${m.text}`}>{stripDashes(m.text)}</li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

export function PipelineStepper({
  trace,
  mode,
}: {
  trace: AiTrace | null;
  mode: 'rules' | 'rules_ai';
}) {
  const { t } = useTranslation();
  const [openId, setOpenId] = useState<string | null>(null);
  if (mode !== 'rules_ai' || !trace?.pipeline?.length) return null;

  const labels: Record<string, string> = {
    inputs: t('ai.pipelineInputs'),
    rules: t('ai.pipelineRules'),
    ml: t('ai.pipelineMl'),
    ai_language: t('ai.pipelineAi'),
    chw_confirm: t('ai.pipelineChw'),
  };

  return (
    <div className="mt-3 rounded-[14px] border border-border bg-surface p-3 shadow-sm" data-testid="pipeline-stepper">
      <h3 className="text-[14px] font-semibold uppercase tracking-wide text-ink-muted">{t('ai.pipelineTitle')}</h3>
      <ol className="mt-2 flex flex-wrap gap-1">
        {trace.pipeline.map((step, i) => (
          <li key={step.id} className="flex items-center gap-1">
            {i > 0 ? <ChevronRight className="h-3 w-3 text-ink-muted" aria-hidden /> : null}
            <button
              type="button"
              className={cn(
                'rounded-full px-2.5 py-1 text-xs font-semibold',
                openId === step.id ? 'bg-primary text-primary-foreground' : 'bg-surface-muted text-ink',
                step.locked && 'ring-1 ring-accent/40',
              )}
              onClick={() => setOpenId((v) => (v === step.id ? null : step.id))}
              data-testid={`pipeline-step-${step.id}`}
            >
              {labels[step.id] || step.id}
              {step.locked ? <Lock className="ml-1 inline h-3 w-3" aria-hidden /> : null}
            </button>
          </li>
        ))}
      </ol>
      {openId ? (
        <div className="mt-2 rounded-[10px] bg-surface-muted p-2 text-xs text-ink-muted">
          {(() => {
            const step = trace.pipeline.find((s) => s.id === openId);
            if (!step) return null;
            return (
              <ul className="space-y-0.5">
                {step.locked ? <li>{t('ai.decisionLockedByProtocol')}</li> : null}
                {step.id === 'ml' ? <li>{t('ai.mlEscalateOnly')}</li> : null}
                {step.id === 'ai_language' ? <li>{t('ai.assistantStatus')}</li> : null}
                {step.decision_label ? <li>{step.decision_label}</li> : null}
              </ul>
            );
          })()}
        </div>
      ) : null}
    </div>
  );
}

export function WhatIfPanel({
  trace,
  mode,
}: {
  trace: AiTrace | null;
  mode: 'rules' | 'rules_ai';
}) {
  const { t } = useTranslation();
  const [enabled, setEnabled] = useState(false);
  if (mode !== 'rules_ai' || !trace?.what_if?.length) return null;
  return (
    <div className="mt-3 rounded-[14px] border border-border bg-surface p-3 shadow-sm" data-testid="what-if-panel">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-[14px] font-semibold uppercase tracking-wide text-ink-muted">{t('ai.whatIf')}</h3>
        <label className="inline-flex items-center gap-2 text-xs font-semibold">
          <input
            type="checkbox"
            className="h-4 w-4 accent-primary"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            data-testid="what-if-toggle"
          />
          {t('ai.whatIf')}
        </label>
      </div>
      <p className="mt-1 text-[11px] text-ink-muted">{t('ai.whatIfRulesOnly')}</p>
      {enabled ? (
        <ul className="mt-2 space-y-1.5 text-sm">
          {trace.what_if.map((row) => (
            <li key={row.field} className="flex flex-wrap items-center gap-2 rounded-[10px] bg-surface-muted px-2 py-1.5">
              <span className="font-medium">{fieldLabel(row.field, t)}</span>
              <span className="text-ink-muted">→</span>
              <Badge tone={decisionTone(row.decision) === 'danger' ? 'danger' : decisionTone(row.decision) === 'warning' ? 'warning' : 'success'}>
                {row.decision_label || decisionI18n(row.decision, t)}
              </Badge>
              <Badge tone="primary">{t('ai.provenanceRule')}</Badge>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function GuardrailPanel({
  trace,
  mode,
  answers,
  result,
  language,
  onTraceUpdate,
}: {
  trace: AiTrace | null;
  mode: 'rules' | 'rules_ai';
  answers: TriageInput;
  result: DecisionResult;
  language: string;
  onTraceUpdate?: (next: AiTrace) => void;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  if (mode !== 'rules_ai' || !trace) return null;
  const blocked = trace.guardrail?.blocked_items || [];
  const passes = blocked.length === 0 && !trace.demo_safety_lock;

  const testLock = async () => {
    setBusy(true);
    try {
      const res = await api.aiTrace({
        answers: answers as unknown as Record<string, unknown>,
        result: result as unknown as Record<string, unknown>,
        language,
        simulate_unsafe: true,
      });
      const data = (res.data || null) as AiTrace | null;
      if (data) onTraceUpdate?.(data);
    } catch {
      /* ignore */
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-3 rounded-[14px] border border-border bg-surface p-3 shadow-sm" data-testid="guardrail-panel">
      <div className="flex flex-wrap items-center gap-2">
        {passes ? (
          <ShieldCheck className="h-4 w-4 text-success" aria-hidden />
        ) : (
          <ShieldAlert className="h-4 w-4 text-warning" aria-hidden />
        )}
        <h3 className="text-[14px] font-semibold uppercase tracking-wide text-ink-muted">
          {t('ai.safetyChecks')}
        </h3>
        <Badge tone={passes ? 'success' : 'warning'}>
          {passes ? t('ai.safetyPass') : t('ai.safetyBlocked', { count: blocked.length })}
        </Badge>
        <Badge tone="success" className="normal-case">
          {t('ai.aiBadge')}
        </Badge>
      </div>
      {trace.guardrail?.ai_summary ? (
        <p className="mt-2 text-sm leading-snug text-ink" data-testid="guardrail-ai-summary">
          {trace.guardrail.ai_summary}
        </p>
      ) : null}
      {blocked.length ? (
        <ul className="mt-2 space-y-2" data-testid="guardrail-blocked-list">
          {blocked.map((b, i) => (
            <li
              key={`${b.reason}-${i}`}
              className="rounded-[12px] border border-warning/30 bg-warning-soft/40 px-3 py-2 text-sm"
            >
              <div className="flex flex-wrap items-center gap-1.5">
                <p className="font-semibold text-warning">
                  {b.title || t(`ai.guardReason.${b.reason}`, { defaultValue: b.reason })}
                </p>
                <Badge tone="success" className="normal-case">
                  {t('ai.aiBadge')}
                </Badge>
              </div>
              {b.why ? <p className="mt-1 text-ink">{b.why}</p> : null}
              {b.action ? (
                <p className="mt-1 text-[13px] font-medium text-ink">
                  {t('ai.guardAction')}: {b.action}
                </p>
              ) : null}
              <details className="mt-1 text-[11px] text-ink-muted">
                <summary className="cursor-pointer font-semibold">{t('ai.guardBlockedRaw')}</summary>
                <p className="mt-0.5 font-mono">
                  {b.reason}: {b.text}
                </p>
              </details>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-xs text-ink-muted">{t('ai.guardPassHint')}</p>
      )}
      <Button
        className="mt-2"
        size="sm"
        variant="outline"
        disabled={busy}
        onClick={() => void testLock()}
        data-testid="test-safety-lock"
      >
        {t('ai.testSafetyLock')}
      </Button>
    </div>
  );
}

function compareReason(p: AiCompareProvider, t: (k: string) => string): string {
  if (p.status === 'unavailable') {
    if (p.reason === 'no_key') return t('ai.scoreUnavailableNoKey');
    return p.reason || t('ai.summaryUnavailable');
  }
  if (p.agreement === 'same_decision') return t('ai.sameDecision');
  if (p.agreement === 'differs') return t('ai.differs');
  return p.reason || '';
}

export function AiComparePanel({
  online,
  input,
  result,
  language,
  mode,
  collapsedDefault = false,
}: {
  online: boolean;
  input: TriageInput;
  result: DecisionResult;
  language: string;
  mode: 'rules' | 'rules_ai';
  collapsedDefault?: boolean;
}) {
  const { t } = useTranslation();
  const [data, setData] = useState<AiCompareResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(!collapsedDefault);
  const ORDER = ['gemini', 'groq', 'local'] as const;
  const [tabIdx, setTabIdx] = useState(0);

  useEffect(() => {
    if (mode !== 'rules_ai' || !online) {
      setData(null);
      return;
    }
    let cancelled = false;
    setBusy(true);
    void api
      .aiCompare({
        answers: input as unknown as Record<string, unknown>,
        result: result as unknown as Record<string, unknown>,
        language,
      })
      .then((res) => {
        if (cancelled) return;
        setData(res as unknown as AiCompareResult);
      })
      .catch(() => {
        if (!cancelled) setData(null);
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [online, input, result, language, mode]);

  if (mode !== 'rules_ai') return null;

  if (!online) {
    return (
      <Card className="mt-2 rounded-[18px]" data-testid="ai-compare-panel">
        <p className="text-sm text-ink-muted">{t('ai.compareOffline')}</p>
      </Card>
    );
  }

  const providers = data?.providers || [];
  const byName = Object.fromEntries(providers.map((p) => [p.provider, p]));
  const slots = ORDER.map((id, i) => ({
    id,
    idx: i,
    label: t(`ai.compareOpinion${i + 1}` as 'ai.compareOpinion1'),
    row: byName[id] as AiCompareProvider | undefined,
  }));
  const active = slots[tabIdx]?.row;
  const agree = data?.summary?.agree_count ?? 0;

  return (
    <div
      className="mt-1 rounded-[18px] border border-border bg-surface p-3 shadow-sm"
      data-testid="ai-compare-panel"
    >
      <button
        type="button"
        className="mb-2 flex w-full flex-wrap items-center gap-2 text-left"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        data-testid="compare-toggle"
      >
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">{t('ai.compareTitle')}</p>
        {data?.summary ? (
          <Badge tone={agree >= 2 ? 'success' : 'warning'}>
            {t('ai.compareAgree', { count: agree, label: data.summary.locked_decision_label || '' })}
          </Badge>
        ) : null}
        <span className="ml-auto text-[11px] font-semibold text-ink-muted">{expanded ? '−' : '+'}</span>
      </button>
      {!expanded ? null : (
      <>
      <div className="flex gap-1" role="tablist" aria-label={t('ai.compareTitle')}>
        {slots.map((s) => (
          <button
            key={s.id}
            type="button"
            role="tab"
            aria-selected={tabIdx === s.idx}
            className={cn(
              'min-h-11 flex-1 rounded-full px-2 py-2 text-[12px] font-semibold transition-transform active:scale-[0.98]',
              tabIdx === s.idx ? 'bg-primary text-primary-foreground' : 'bg-surface-muted text-ink-muted',
            )}
            onClick={() => setTabIdx(s.idx)}
            data-testid={`compare-tab-${s.idx + 1}`}
          >
            {s.label}
          </button>
        ))}
      </div>
      <div className="mt-2.5 min-h-[72px] text-sm" data-testid="compare-body">
        {busy && !active ? (
          <p className="text-ink-muted">{t('ai.scoreLoading')}</p>
        ) : active ? (
          <>
            <div className="mb-1.5 flex flex-wrap gap-2 text-[11px] text-ink-muted">
              {active.agreement === 'same_decision' ? (
                <Badge tone="success">{t('ai.sameDecision')}</Badge>
              ) : active.agreement === 'differs' ? (
                <Badge tone="warning">{t('ai.differs')}</Badge>
              ) : null}
            </div>
            {active.status === 'unavailable' || !active.answer ? (
              <p className="text-ink-muted">{compareReason(active, t)}</p>
            ) : (
              <>
                <p className="leading-snug">{active.answer}</p>
                <Badge tone="success" className="mt-1.5 normal-case" data-testid="answered-by-badge">
                  {t('ai.aiBadge')}
                </Badge>
              </>
            )}
          </>
        ) : (
          <p className="text-ink-muted">{t('ai.summaryUnavailable')}</p>
        )}
      </div>
      </>
      )}
    </div>
  );
}

export function AiOffState() {
  const { t } = useTranslation();
  return (
    <div
      className="mt-3 flex items-center gap-2 rounded-[14px] border border-border bg-surface-muted/80 px-3 py-3 text-sm text-ink-muted"
      data-testid="ai-off-state"
      role="status"
    >
      <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-surface text-ink-muted opacity-60">
        <Sparkles className="h-4 w-4" aria-hidden />
      </span>
      <p>{t('ai.aiOff')}</p>
    </div>
  );
}

export function TraceQuickChips({
  trace,
  result,
  language,
  onPick,
}: {
  trace: AiTrace | null;
  result: DecisionResult;
  language: string;
  onPick?: (text: string) => void;
}) {
  const { t } = useTranslation();
  const chips = [
    { key: 'why', label: t('ai.askWhy') },
    { key: 'now', label: t('ai.askWhatNow') },
    { key: 'family', label: t('ai.askTellFamily') },
    { key: 'back', label: t('ai.askComeBack') },
  ] as const;

  const answerFor = (key: (typeof chips)[number]['key']): string => {
    if (!trace) {
      return decisionI18n(result.decision, t);
    }
    if (key === 'why') {
      const rules = (trace.rules.triggered_rule_ids || []).slice(0, 3).map((r) => ruleSentence(r, language));
      return [trace.rules.final_decision_label || decisionI18n(result.decision, t), ...rules].filter(Boolean).join(' · ');
    }
    if (key === 'now') {
      return (
        trace.ai_added.find((a) => a.type === 'plain_explanation')?.text ||
        t('ai.localLimitedRw')
      );
    }
    if (key === 'family') {
      return (
        trace.ai_added.find((a) => a.type === 'family_message')?.text ||
        t('ai.localLimitedRw')
      );
    }
    return t('result.whenBack');
  };

  return (
    <div className="flex flex-wrap gap-1.5 px-2 pb-1" data-testid="trace-quick-chips">
      {chips.map((c) => (
        <Button
          key={c.key}
          size="sm"
          variant="outline"
          onClick={() => onPick?.(answerFor(c.key))}
        >
          {c.label}
        </Button>
      ))}
    </div>
  );
}

export function ModeSwitchFrame({
  mode,
  children,
}: {
  mode: 'rules' | 'rules_ai';
  children: ReactNode;
}) {
  const reduce = useReducedMotion();
  // No AnimatePresence: exit stacking left both modes in the DOM under test.
  return (
    <motion.div
      key={mode}
      initial={reduce ? false : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={easeOut}
      data-testid={`mode-frame-${mode}`}
    >
      {children}
    </motion.div>
  );
}

export function ShowDifferencesSwitch({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  const { t } = useTranslation();
  return (
    <label className="inline-flex items-center gap-2 text-xs font-semibold" data-testid="show-differences">
      <input
        type="checkbox"
        className="h-4 w-4 accent-primary"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      {t('ai.showDifferences')}
    </label>
  );
}

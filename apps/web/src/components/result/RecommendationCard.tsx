import {
  AlertTriangle,
  ClipboardList,
  Gauge,
  HeartHandshake,
  Info,
  ListOrdered,
  MessageCircle,
  Sparkles,
  X,
} from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/client';
import { cn } from '../../lib/cn';
import type { AiTrace, DecisionResult, TriageInput } from '../../types';
import { Badge } from '../ui';
import { mlFactorLabels } from './AiResultPanels';
import {
  protocolComeBack,
  protocolFamily,
  protocolSteps,
  protocolWhy,
  stripDashes,
} from './protocolCopy';
import { ruleSentence } from './ruleSentences';

type CardData = {
  title: string;
  decision: string;
  why: string[];
  what_to_do_now: string[];
  what_to_tell_family: string;
  when_to_come_back: string;
  referral: { needed: boolean; urgency: string };
  ai_enhanced?: boolean;
  ai_analysis?: string;
  label?: string;
  protocol_meta?: {
    validated?: boolean;
    protocol_version?: string;
    protocol_name?: string;
    source_file?: string;
  };
};

type ProviderMeta = {
  provider_used?: string;
  latency_ms?: number;
  fallback_reason?: string | null;
} | null;

function MiniCard({
  icon,
  title,
  children,
  testId,
  aiEnhanced,
  loading,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
  testId?: string;
  aiEnhanced?: boolean;
  loading?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <article
      className="flex min-h-0 flex-col rounded-[14px] border border-border bg-surface p-3 shadow-sm"
      data-testid={testId}
    >
      <h4 className="flex flex-wrap items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
        <span className="text-primary" aria-hidden>
          {icon}
        </span>
        {title}
        {aiEnhanced ? (
          <Badge tone="success" className="normal-case tracking-normal">
            {t('ai.aiAddedBadge')}
          </Badge>
        ) : null}
      </h4>
      <div className="mt-2 min-h-0 flex-1 overflow-y-auto text-[15px] leading-snug text-ink">
        {loading ? (
          <div className="space-y-1.5" aria-busy="true">
            <div className="h-3 animate-pulse rounded bg-surface-muted" />
            <div className="h-3 w-4/5 animate-pulse rounded bg-surface-muted" />
          </div>
        ) : (
          children
        )}
      </div>
    </article>
  );
}

export function ProtocolNoticeBar({
  meta,
}: {
  meta?: CardData['protocol_meta'];
}) {
  const { t } = useTranslation();
  const [dismissed, setDismissed] = useState(() => {
    try {
      return sessionStorage.getItem('zm_protocol_notice_dismissed') === '1';
    } catch {
      return false;
    }
  });
  if (!meta || meta.validated || dismissed) return null;
  const tip = `${meta.source_file || 'rules/clinical_config.yaml'} · ${meta.protocol_version || '-'}`;
  return (
    <div
      className="mb-2 flex items-center gap-2 rounded-full border border-info/25 bg-info/5 px-3 py-1 text-[11px] text-ink-muted"
      role="status"
      data-testid="protocol-pending-bar"
      title={tip}
    >
      <Info className="h-3.5 w-3.5 shrink-0 text-info" aria-hidden />
      <span className="min-w-0 flex-1 truncate font-medium">{t('result.protocolPending')}</span>
      <button
        type="button"
        className="shrink-0 rounded-control p-1 hover:bg-info/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
        aria-label={t('common.close')}
        onClick={() => {
          setDismissed(true);
          try {
            sessionStorage.setItem('zm_protocol_notice_dismissed', '1');
          } catch {
            /* ignore */
          }
        }}
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

export function AiCaseStrip({
  online,
  result,
  summary,
  summaryMeta,
  summaryLoading,
  enhanceEnabled,
  aiTrace = null,
  language = 'en',
}: {
  online: boolean;
  result: DecisionResult;
  summary?: string | null;
  summaryMeta?: ProviderMeta;
  summaryLoading?: boolean;
  enhanceEnabled?: boolean;
  aiTrace?: AiTrace | null;
  language?: string;
}) {
  const { t } = useTranslation();
  const score = aiTrace?.ml?.urgency_risk?.score ?? result.severe_risk;
  const pct = score != null ? Math.round(Math.min(1, Math.max(0, score)) * 100) : null;
  const factors = mlFactorLabels(result, aiTrace, language);
  const analysisLoading = Boolean(summaryLoading && !summary);
  const analysisText = (summary || '').trim();

  return (
    <div
      className="mt-2 rounded-[14px] border border-info/30 bg-surface px-3 py-2.5 shadow-sm"
      data-testid="ai-case-strip"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Gauge className="h-4 w-4 text-info" aria-hidden />
        <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
          {t('result.aiDidForCase')}
        </p>
      </div>

      <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_auto] sm:items-start">
        <div data-testid="risk-score-gauge" data-state={score != null ? 'available' : 'unavailable'}>
          <div className="mb-1 flex justify-between text-xs">
            <span>
              {t('ai.riskScore')}{' '}
              <span className="text-[10px] text-ink-muted">({t('ai.mlLabel')})</span>
            </span>
            {score != null ? (
              <span className="font-mono">{pct}%</span>
            ) : (
              <span className="text-ink-muted">{t('common.unavailable')}</span>
            )}
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-surface-muted">
            <div
              className="h-full rounded-full bg-info transition-all duration-200"
              style={{ width: `${score != null ? pct ?? 0 : 0}%` }}
            />
          </div>
          {factors.length ? (
            <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-ink">
              {factors.map((f) => (
                <li key={f} className="inline-flex items-center gap-1">
                  <Sparkles className="h-3 w-3 text-info" aria-hidden />
                  {f.replace(/_/g, ' ')}
                </li>
              ))}
            </ul>
          ) : null}
          <p className="mt-1 text-[11px] text-ink-muted">
            {t('result.mlEscalated')}: {result.ml_escalated ? t('triage.yes') : t('triage.no')}
            <span className="ml-2 text-[10px]">{t('ai.syntheticMetrics')}</span>
          </p>
        </div>
      </div>

      <div className="mt-2 rounded-[10px] bg-surface-muted/80 px-2.5 py-2" data-testid="ai-case-analysis">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
            {t('ai.caseAnalysis')}
          </p>
          {summaryMeta?.provider_used && summaryMeta.provider_used !== 'none' ? (
            <Badge tone="info">{t('ai.assistantStatus')}</Badge>
          ) : null}
        </div>
        {!enhanceEnabled ? (
          <p className="mt-1.5 text-xs text-ink-muted">{t('result.enableRulesAiForAnalysis')}</p>
        ) : analysisLoading ? (
          <div className="mt-2 space-y-1.5" aria-busy="true" aria-live="polite">
            <p className="text-xs text-ink-muted">{t('ai.caseAnalysisLoading')}</p>
            <div className="h-3 animate-pulse rounded bg-surface" />
            <div className="h-3 w-4/5 animate-pulse rounded bg-surface" />
          </div>
        ) : analysisText ? (
          <>
            <p className="mt-1.5 text-sm leading-relaxed text-ink" data-testid="ai-case-analysis-text">
              {stripDashes(analysisText)}
            </p>
            <span className="mt-1 inline-flex rounded-full bg-success/15 px-2 py-0.5 text-[10px] font-semibold text-success">
              {t('ai.aiBadge')}
            </span>
          </>
        ) : (
          <p className="mt-1.5 text-xs text-ink-muted">
            {!online ? t('ai.insightsOffline') : t('ai.caseAnalysisUnavailable')}
          </p>
        )}
      </div>
    </div>
  );
}

function persistVisitSummary(summary: string) {
  try {
    const raw = sessionStorage.getItem('zm_last_triage');
    if (!raw) return;
    const parsed = JSON.parse(raw);
    parsed.ai_visit_summary = summary;
    sessionStorage.setItem('zm_last_triage', JSON.stringify(parsed));
  } catch {
    /* ignore */
  }
}

export function RecommendationGrid({
  input,
  result,
  language,
  online,
  enhanceAi = false,
  aiTrace = null,
}: {
  input: TriageInput;
  result: DecisionResult;
  language: string;
  online: boolean;
  enhanceAi?: boolean;
  aiTrace?: AiTrace | null;
}) {
  const { t } = useTranslation();
  const [card, setCard] = useState<CardData | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [summaryMeta, setSummaryMeta] = useState<ProviderMeta>(null);

  useEffect(() => {
    let cancelled = false;
    setAiLoading(Boolean(enhanceAi && online));
    setSummaryMeta(null);

    void api
      .aiRecommendation({
        answers: input as unknown as Record<string, unknown>,
        rules_decision: result.rules_decision || result.decision,
        decision: result.decision,
        reasons: result.reasons,
        triggered_rules: result.triggered_rules,
        language,
        enhance: Boolean(enhanceAi && online),
        shap_factors: result.shap_factors,
        severe_risk: result.severe_risk,
        ml_escalated: result.ml_escalated,
      })
      .then((res) => {
        if (cancelled) return;
        const data = (res.data || null) as CardData | null;
        setCard(data);
        if (enhanceAi && online) {
          setSummaryMeta({
            provider_used: String(res.provider_used || 'local'),
            latency_ms: Number(res.latency_ms || 0),
            fallback_reason: res.fallback_reason ? String(res.fallback_reason) : null,
          });
          const analysis = String(data?.ai_analysis || '').trim();
          if (analysis) persistVisitSummary(analysis);
        }
        setAiLoading(false);
      })
      .catch(() => {
        if (!cancelled) {
          setCard(null);
          setAiLoading(false);
          if (enhanceAi) {
            setSummaryMeta({ provider_used: 'none', latency_ms: 0, fallback_reason: 'unavailable' });
          }
        }
      });
    return () => {
      cancelled = true;
    };
  }, [input, result, language, enhanceAi, online]);

  const decision = result.rules_decision || result.decision;
  const familyFromTrace = Boolean(aiTrace?.ai_added?.some((a) => a.type === 'family_message'));
  const analysisFromTrace = Boolean(aiTrace?.ai_added?.some((a) => a.type === 'plain_explanation'));
  const aiEnhanced = Boolean(enhanceAi && (card?.ai_enhanced || familyFromTrace || analysisFromTrace));
  const localWhy = protocolWhy(result.triggered_rules, language);
  const why = (
    localWhy.length
      ? localWhy
      : result.triggered_rules?.length
        ? result.triggered_rules.map((rid) => ruleSentence(rid, language))
        : card?.why || []
  )
    .slice(0, 2)
    .map((w) => stripDashes(w.includes('_') && !w.includes(' ') ? ruleSentence(w, language) : w));
  // Prefer localized protocol catalog so language switch always updates steps/family/come-back
  const steps = protocolSteps(decision, language);
  const tellFamily = stripDashes(protocolFamily(decision, language) || t('common.empty'));
  const comeBack = stripDashes(protocolComeBack(decision, language) || t('common.empty'));
  const referralNeeded = card?.referral?.needed ?? decision !== 'treat_at_home';
  const urgency =
    card?.referral?.urgency ||
    (decision === 'urgent_refer' ? 'urgent' : decision === 'refer' ? 'routine' : 'none');
  const showCardSkeleton = Boolean(enhanceAi && online && aiLoading && !card);

  return (
    <div className="flex min-h-0 flex-col" data-testid="recommendation-card">
      <ProtocolNoticeBar meta={card?.protocol_meta} />
      {enhanceAi ? (
        <div
          className="mb-2 flex flex-wrap items-center gap-2 rounded-[12px] border border-info/25 bg-info/5 px-3 py-1.5 text-xs text-ink"
          data-testid="ai-rec-banner"
        >
          <Sparkles className="h-3.5 w-3.5 text-info" aria-hidden />
          <span className="font-medium">{t('result.aiWordingBanner')}</span>
          {aiLoading ? (
            <span className="text-ink-muted">{t('ai.caseAnalysisLoading')}</span>
          ) : summaryMeta?.provider_used && summaryMeta.provider_used !== 'none' ? (
            <Badge tone="info">{t('ai.assistantStatus')}</Badge>
          ) : null}
        </div>
      ) : null}

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-2 sm:grid-cols-2" data-testid="rec-card-grid">
        <MiniCard
          icon={<ClipboardList className="h-3.5 w-3.5" />}
          title={t('result.why')}
          testId="rec-why"
          aiEnhanced={aiEnhanced}
          loading={showCardSkeleton}
        >
          <ul className="list-disc space-y-1 pl-4">
            {why.length ? why.map((w) => <li key={w}>{w}</li>) : <li>{t('common.empty')}</li>}
          </ul>
        </MiniCard>
        <MiniCard
          icon={<ListOrdered className="h-3.5 w-3.5" />}
          title={t('result.whatNowSteps')}
          testId="rec-steps"
          aiEnhanced={aiEnhanced}
          loading={showCardSkeleton}
        >
          <ol className="list-decimal space-y-1 pl-4">
            {steps.slice(0, 4).map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ol>
        </MiniCard>
        <MiniCard
          icon={<MessageCircle className="h-3.5 w-3.5" />}
          title={t('result.tellFamily')}
          testId="rec-family"
          aiEnhanced={Boolean(enhanceAi && (aiEnhanced || familyFromTrace))}
          loading={showCardSkeleton}
        >
          <p>{tellFamily}</p>
        </MiniCard>
        <MiniCard
          icon={<HeartHandshake className="h-3.5 w-3.5" />}
          title={t('result.whenBack')}
          testId="rec-when"
          aiEnhanced={false}
          loading={showCardSkeleton}
        >
          <p>{comeBack}</p>
        </MiniCard>
      </div>

      <div
        className={cn(
          'mt-2 flex items-center gap-2 rounded-[12px] px-3 py-1.5 text-sm font-semibold text-white',
          urgency === 'urgent' ? 'bg-danger' : referralNeeded ? 'bg-warning' : 'bg-success',
        )}
        data-testid="referral-strip"
      >
        <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
        {t('result.referralNeeded')}:{' '}
        {referralNeeded ? `${t('triage.yes')}: ${urgency}` : t('triage.no')}
      </div>

      <AiCaseStrip
        online={online}
        result={result}
        summary={enhanceAi ? card?.ai_analysis || null : null}
        summaryMeta={enhanceAi ? summaryMeta : null}
        summaryLoading={enhanceAi && aiLoading}
        enhanceEnabled={enhanceAi}
        aiTrace={aiTrace}
        language={language}
      />
      <p className="mt-1 text-[10px] text-ink-muted">{t('result.protocolStepsLocked')}</p>
    </div>
  );
}

/** @deprecated use RecommendationGrid — kept name for imports */
export function RecommendationCard(props: {
  input: TriageInput;
  result: DecisionResult;
  language: string;
}) {
  return (
    <RecommendationGrid
      {...props}
      online={typeof navigator !== 'undefined' ? navigator.onLine : true}
      enhanceAi
    />
  );
}

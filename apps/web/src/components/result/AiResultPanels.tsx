import { Bot, ChevronDown, ChevronUp, Gauge, MessageSquare, Sparkles } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/client';
import { Badge, Button, Card } from '../ui';
import { mlEscalateThreshold } from '../../lib/decisionGuard';
import type { AiTrace, DecisionResult, TriageInput } from '../../types';
import { VoiceControls } from '../voice/VoiceControls';
import { cn } from '../../lib/cn';

const FACTOR_I18N: Record<string, { rw: string; en: string }> = {
  lethargy: { rw: 'Gucika intege / ntabona', en: 'Lethargy or unconsciousness' },
  unable_to_drink: { rw: 'Ntashobora kunywa', en: 'Unable to drink or feed' },
  vomiting_everything: { rw: 'Kuraruka byose', en: 'Vomiting everything' },
  convulsions: { rw: 'Gusetsa', en: 'Convulsions' },
  severe_breathing_difficulty: { rw: "Agorwa n'uruhuha", en: 'Severe breathing difficulty' },
  fever_days: { rw: "Iminsi y'ubushyuhe", en: 'Fever days' },
  temperature_c: { rw: 'Ubushyuhe', en: 'Temperature' },
  age_months: { rw: 'Imyaka (amezi)', en: 'Age (months)' },
};

function localizeFactor(raw: string, lang: string): string {
  const cleaned = raw
    .replace(/\s*\(synthetic\)/gi, '')
    .replace(/\bincreases risk\b/gi, '')
    .replace(/\bdecreases risk\b/gi, '')
    .trim();
  const low = cleaned.toLowerCase().replace(/\s+/g, '_');
  const rw = lang.startsWith('rw');
  for (const [key, pack] of Object.entries(FACTOR_I18N)) {
    if (low.includes(key) || cleaned.toLowerCase().includes(pack.en.toLowerCase())) {
      return rw ? pack.rw : pack.en;
    }
  }
  return cleaned.replace(/_/g, ' ');
}

/** Prefer ai_trace.ml.top_factors; never surface "decreases risk" for No answers. */
export function mlFactorLabels(result: DecisionResult, trace?: AiTrace | null, language = 'en'): string[] {
  const fromTrace = (trace?.ml?.top_factors || result.ai_trace?.ml?.top_factors || [])
    .map((f) => localizeFactor(f.label, language))
    .filter(Boolean);
  if (fromTrace.length) return fromTrace.slice(0, 3);
  return (result.shap_factors || [])
    .slice(0, 3)
    .map((f) => localizeFactor(f, language))
    .filter(Boolean);
}

export type AiMode = 'rules' | 'rules_ai';

type ProviderInfo = {
  provider_used?: string;
  latency_ms?: number;
  fallback_reason?: string | null;
};

function ProvBadge({ info, t }: { info: ProviderInfo | null; t: (k: string) => string }) {
  if (!info?.provider_used) return null;
  return (
    <span className="inline-flex flex-wrap items-center gap-1 text-[11px] text-ink-muted">
      <Badge tone="info">{t('ai.assistantStatus')}</Badge>
    </span>
  );
}

function ProvChips({
  rule,
  ml,
  ai,
  t,
}: {
  rule?: boolean;
  ml?: boolean;
  ai?: boolean;
  t: (k: string) => string;
}) {
  return (
    <span className="inline-flex flex-wrap gap-1">
      {rule ? <Badge tone="primary">{t('ai.provenanceRule')}</Badge> : null}
      {ml ? <Badge tone="info">{t('ai.provenanceMl')}</Badge> : null}
      {ai ? <Badge tone="accent">{t('ai.provenanceAi')}</Badge> : null}
    </span>
  );
}

export function AiInsightsCard({
  online,
  result,
  mode,
  summary,
  summaryMeta,
  summaryLoading = false,
  scoreState,
  onCopySummary,
  onAttachSummary,
  summaryAttached = false,
  advisory = null,
}: {
  online: boolean;
  result: DecisionResult;
  mode: AiMode;
  summary: string | null;
  summaryMeta: ProviderInfo | null;
  summaryLoading?: boolean;
  /** Explicit gauge state override: loading | available | unavailable */
  scoreState?: 'loading' | 'available' | 'unavailable';
  onCopySummary?: () => void;
  onAttachSummary?: () => void;
  summaryAttached?: boolean;
  advisory?: {
    explanation_en?: string;
    explanation_rw?: string;
    suggested_escalation?: boolean;
    handover_summary?: string;
  } | null;
}) {
  const { t } = useTranslation();
  const score = result.severe_risk;
  const pct = score != null ? Math.round(Math.min(1, Math.max(0, score)) * 100) : null;
  const factors = mlFactorLabels(result, result.ai_trace);

  const gauge: 'loading' | 'available' | 'unavailable' =
    scoreState ||
    (!online
      ? 'unavailable'
      : summaryLoading && score == null
        ? 'loading'
        : score != null
          ? 'available'
          : 'unavailable');

  const fb = String(summaryMeta?.fallback_reason || '');
  const unavailableReason = !online
    ? t('ai.scoreUnavailableOffline')
    : fb.includes('timeout')
      ? t('ai.scoreUnavailableTimeout')
      : fb.includes('429') || fb.includes('quota')
        ? t('ai.scoreUnavailableQuota')
        : fb.includes('404') || fb.includes('not found')
          ? t('ai.scoreUnavailableRoute')
          : fb.includes('not configured') || !summaryMeta?.provider_used || summaryMeta.provider_used === 'none'
            ? t('ai.scoreUnavailableNoKey')
            : t('ai.summaryUnavailable');
  const providerTooltip = [
    summaryMeta?.provider_used || 'none',
    typeof summaryMeta?.latency_ms === 'number' ? `${summaryMeta.latency_ms}ms` : null,
    summaryMeta?.fallback_reason || unavailableReason,
  ]
    .filter(Boolean)
    .join(' · ');

  if (mode === 'rules') {
    return (
      <Card className="mt-4" aria-label={t('ai.insightsTitle')}>
        <p className="text-sm text-ink-muted">{t('ai.modeRulesOnly')}</p>
      </Card>
    );
  }

  return (
    <Card className="mt-4 border-2 border-info/30" aria-label={t('ai.insightsTitle')} data-testid="ai-insights-card">
      <div className="flex flex-wrap items-center gap-2">
        <Gauge className="h-5 w-5 text-info" aria-hidden />
        <h3 className="font-semibold">{t('ai.insightsTitle')}</h3>
        <ProvChips rule ml={Boolean(result.ml_escalated || score != null)} ai t={t} />
      </div>
      <p className="mt-1 text-[11px] text-ink-muted">{t('ai.syntheticMetrics')}</p>

      <div className="mt-3" data-testid="risk-score-gauge" data-state={gauge}>
        <div className="mb-1 flex justify-between text-xs">
          <span>
            {t('ai.riskScore')} <ProvChips ml t={t} />
          </span>
          {gauge === 'loading' ? (
            <span className="font-mono text-ink-muted">{t('ai.scoreLoading')}</span>
          ) : gauge === 'available' ? (
            <span className="font-mono">{pct}%</span>
          ) : (
            <span className="text-ink-muted" title={providerTooltip}>
              {unavailableReason}
            </span>
          )}
        </div>
        {gauge === 'loading' ? (
          <div className="h-2 animate-pulse rounded-full bg-surface-muted" data-testid="risk-score-skeleton" />
        ) : (
          <div
            className="h-2 overflow-hidden rounded-full bg-surface-muted"
            role="meter"
            aria-valuenow={gauge === 'available' ? (pct ?? 0) : 0}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={t('ai.riskScore')}
          >
            <div
              className="h-full rounded-full bg-info transition-all"
              style={{ width: `${gauge === 'available' ? pct ?? 0 : 0}%` }}
            />
          </div>
        )}
      </div>

      {factors.length ? (
        <ul className="mt-3 space-y-1 text-sm">
          <li className="text-xs font-semibold uppercase text-ink-muted">
            {t('ai.topFactors')} <ProvChips ml t={t} />
          </li>
          {factors.map((f) => (
            <li key={f} className="flex items-start gap-2">
              <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-info" aria-hidden />
              <span>{f}</span>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="mt-4 rounded-control bg-surface-muted p-3">
        <p className="text-xs font-semibold uppercase text-ink-muted">
          {t('ai.summaryTitle')} <ProvChips ai t={t} />
        </p>
        {summaryLoading && !summary ? (
          <div className="mt-2 h-16 animate-pulse rounded-control bg-surface" data-testid="summary-skeleton" />
        ) : summary ? (
          <>
            <p className="mt-1 text-sm leading-relaxed">{summary}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Badge tone="warning">{t('ai.summaryLabel')}</Badge>
              <Badge tone="warning">{t('ai.needsNativeReview')}</Badge>
              {onCopySummary ? (
                <Button size="sm" variant="outline" onClick={onCopySummary}>
                  {t('ai.copySummary')}
                </Button>
              ) : null}
              {onAttachSummary ? (
                <Button size="sm" variant="secondary" onClick={onAttachSummary} disabled={summaryAttached}>
                  {summaryAttached ? t('ai.summaryAttached') : t('ai.attachSummary')}
                </Button>
              ) : null}
            </div>
            <div className="mt-2">
              <ProvBadge info={summaryMeta} t={t} />
            </div>
          </>
        ) : (
          <p className="mt-1 text-sm text-ink-muted">
            {!online ? t('ai.insightsOffline') : t('ai.summaryUnavailable')}
          </p>
        )}
      </div>

      <div className="mt-3">
        <p className="text-xs font-semibold text-ink-muted">{t('ai.problemAiAdded')}</p>
        <ul className="mt-1 list-disc pl-5 text-sm text-ink-muted">
          {score != null ? (
            <li>
              {t('ai.riskScore')}: {score.toFixed(2)}
            </li>
          ) : null}
          {factors.map((f) => (
            <li key={`a-${f}`}>{f}</li>
          ))}
          {result.ml_escalated ? <li>{t('ai.mlEscalateShort')}</li> : null}
          {advisory?.suggested_escalation ? <li>{t('result.aiEscalateHint')}</li> : null}
          {advisory?.handover_summary ? <li>{advisory.handover_summary.slice(0, 120)}</li> : null}
          {summary ? <li>{t('ai.summaryTitle')}</li> : null}
        </ul>
        <p className="mt-2 text-[11px] text-ink-muted">{t('ai.syntheticMetrics')}</p>
      </div>
    </Card>
  );
}

export function MlEscalateBanner({ result }: { result: DecisionResult }) {
  const { t } = useTranslation();
  if (!result.ml_escalated) return null;
  const thr = mlEscalateThreshold();
  const score = result.severe_risk != null ? result.severe_risk.toFixed(2) : '-';
  return (
    <div
      className="mt-3 rounded-card border border-warning/40 bg-warning-soft p-3 text-sm text-warning"
      role="status"
    >
      <p className="font-semibold">
        {t('ai.mlEscalateBanner', {
          rules: result.rules_decision.replace(/_/g, ' '),
          final: result.decision.replace(/_/g, ' '),
        })}
      </p>
      <p className="mt-1 text-xs">
        {t('ai.mlScoreThreshold', { score, threshold: thr })} · {t('ai.syntheticMetrics')}
      </p>
      <ProvChips rule ml t={t} />
    </div>
  );
}

export function AskAiPanel({
  online,
  input,
  result,
  language,
}: {
  online: boolean;
  input: TriageInput;
  result: DecisionResult;
  language: string;
}) {
  const { t } = useTranslation();
  const [q, setQ] = useState('');
  const [answer, setAnswer] = useState<string | null>(null);
  const [meta, setMeta] = useState<ProviderInfo | null>(null);
  const [busy, setBusy] = useState(false);

  const casePayload = {
    ...input,
    decision: result.decision,
    rules_decision: result.rules_decision,
    severe_risk: result.severe_risk,
    ml_score: result.severe_risk,
    ml_escalated: result.ml_escalated,
    shap_factors: result.shap_factors,
    top_factors: result.shap_factors?.slice(0, 3),
    triggered_rules: result.triggered_rules,
    language,
  };

  const ask = async (question: string) => {
    if (!online || !question.trim()) return;
    setBusy(true);
    setAnswer(null);
    try {
      const res = await api.aiAsk({ question, case: casePayload, language });
      const data = (res.data || {}) as { answer?: string };
      setAnswer(data.answer || '');
      setMeta({
        provider_used: String(res.provider_used || 'local'),
        latency_ms: Number(res.latency_ms || 0),
      });
    } catch {
      setAnswer(null);
    } finally {
      setBusy(false);
    }
  };

  if (!online) {
    return (
      <Card className="mt-4">
        <p className="text-sm text-ink-muted">{t('ai.askOffline')}</p>
      </Card>
    );
  }

  const chips = [
    { key: 'why', label: t('ai.askWhy') },
    { key: 'now', label: t('ai.askWhatNow') },
    { key: 'vomit', label: t('ai.askVomit') },
    { key: 'back', label: t('ai.askComeBack') },
  ];

  return (
    <Card className="mt-4" aria-label={t('ai.askTitle')}>
      <div className="flex items-center gap-2">
        <MessageSquare className="h-5 w-5 text-primary" aria-hidden />
        <h3 className="font-semibold">{t('ai.askTitle')}</h3>
        <ProvChips ai t={t} />
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {chips.map((c) => (
          <Button key={c.key} size="sm" variant="outline" disabled={busy} onClick={() => void ask(c.label)}>
            {c.label}
          </Button>
        ))}
      </div>
      <div className="mt-3 flex gap-2">
        <input
          className="min-h-11 flex-1 rounded-control border border-border bg-surface px-3 text-sm"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t('ai.askPlaceholder')}
          aria-label={t('ai.askPlaceholder')}
        />
        <Button size="sm" disabled={busy || !q.trim()} onClick={() => void ask(q)}>
          {t('ai.askSubmit')}
        </Button>
      </div>
      <VoiceControls
        className="mt-2"
        phraseIds={['why_generic']}
        compact
        language={language.startsWith('rw') ? 'rw' : 'en'}
        onTranscriptConfirmed={({ transcript }) => {
          setQ(transcript);
          void ask(transcript);
        }}
      />
      {answer ? (
        <div className="mt-3 rounded-control bg-surface-muted p-3 text-sm">
          <p>{answer}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Badge tone="warning">{t('ai.verifyLabel')}</Badge>
            <ProvChips rule ai t={t} />
          </div>
          <div className="mt-1">
            <ProvBadge info={meta} t={t} />
          </div>
        </div>
      ) : null}
    </Card>
  );
}

type ConsultTurn = {
  agent: string;
  role: string;
  text: string;
  provider: string;
  latency_ms: number;
  provenance?: string[];
  rejected?: boolean;
};

export function AiConsultPanel({
  online,
  input,
  result,
  language,
}: {
  online: boolean;
  input: TriageInput;
  result: DecisionResult;
  language: string;
}) {
  const { t } = useTranslation();
  const [finalAnswer, setFinal] = useState<string | null>(null);
  const [turns, setTurns] = useState<ConsultTurn[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [follow, setFollow] = useState('');
  const [sessionId, setSessionId] = useState<string | undefined>();

  const casePayload = {
    ...input,
    decision: result.decision,
    rules_decision: result.rules_decision,
    severe_risk: result.severe_risk,
    ml_score: result.severe_risk,
    ml_escalated: result.ml_escalated,
    shap_factors: result.shap_factors,
    top_factors: result.shap_factors?.slice(0, 3),
    triggered_rules: result.triggered_rules,
    language,
  };

  const run = async (followUp?: string) => {
    if (!online) return;
    setBusy(true);
    try {
      const res = await api.aiConsult({
        case: casePayload,
        language,
        follow_up: followUp,
        session_id: followUp ? sessionId : undefined,
      });
      setFinal(String(res.final_answer || ''));
      setTurns((res.turns as ConsultTurn[]) || []);
      setSessionId(String(res.session_id || ''));
      setOpen(false);
    } catch {
      setFinal(null);
    } finally {
      setBusy(false);
    }
  };

  if (!online) {
    return (
      <Card className="mt-4">
        <p className="text-sm text-ink-muted">{t('ai.consultOffline')}</p>
        <p className="mt-2 text-sm">
          {t('ai.verifyLabel')}: {result.decision.replace(/_/g, ' ')}
        </p>
      </Card>
    );
  }

  return (
    <div className="mt-1" aria-label={t('ai.consultTitle')} data-testid="ai-consult-panel">
      <Button
        className="w-full"
        size="sm"
        variant="secondary"
        leftIcon={<Bot className="h-4 w-4" />}
        disabled={busy}
        onClick={() => void run()}
      >
        {busy ? t('ai.consultRunning') : t('ai.consultButton')}
      </Button>
      {finalAnswer ? (
        <div className="mt-3 rounded-card bg-[var(--color-accent-soft)] p-4 ring-2 ring-accent/40">
          <p className="text-xs font-semibold uppercase tracking-wide text-accent">{t('ai.consultFinal')}</p>
          <p className="mt-2 text-sm font-medium leading-relaxed">{finalAnswer}</p>
          <Badge tone="warning" className="mt-2">
            {t('ai.verifyLabel')}
          </Badge>
        </div>
      ) : null}
      {turns.length ? (
        <div className="mt-3">
          <button
            type="button"
            className="flex w-full items-center justify-between text-sm font-semibold"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
          >
            {open ? t('ai.consultCollapse') : t('ai.consultExpand')}
            {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
          {open ? (
            <ul className="mt-2 space-y-2">
              {turns.map((turn, i) => (
                <li key={`${turn.agent}-${i}`} className="rounded-control border border-border p-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{turn.role}</span>
                    <ProvChips ai rule={turn.agent === 'guideline'} ml={turn.agent === 'triage'} t={t} />
                    <ProvBadge
                      info={{ provider_used: turn.provider, latency_ms: turn.latency_ms }}
                      t={t}
                    />
                  </div>
                  <p className="mt-1">{turn.text}</p>
                </li>
              ))}
            </ul>
          ) : null}
          <div className="mt-3 flex gap-2">
            <input
              className="min-h-11 flex-1 rounded-control border border-border px-3 text-sm"
              value={follow}
              onChange={(e) => setFollow(e.target.value)}
              placeholder={t('ai.consultFollowPlaceholder')}
              aria-label={t('ai.consultFollowUp')}
            />
            <Button
              size="sm"
              disabled={busy || !follow.trim()}
              onClick={() => {
                const f = follow;
                setFollow('');
                void run(f);
              }}
            >
              {t('ai.consultFollowUp')}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function AiModeToggle({
  mode,
  onChange,
}: {
  mode: AiMode;
  onChange: (m: AiMode) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="mt-0 flex rounded-full bg-surface-muted p-0.5 text-xs" role="group" aria-label={t('ai.modeRulesAi')}>
      <button
        type="button"
        className={cn(
          'flex-1 rounded-full px-3 py-2 font-semibold',
          mode === 'rules' ? 'bg-surface shadow-card text-ink' : 'text-ink-muted',
        )}
        onClick={() => onChange('rules')}
        data-testid="ai-mode-rules"
      >
        {t('ai.modeRulesOnly')}
      </button>
      <button
        type="button"
        className={cn(
          'flex-1 rounded-full px-3 py-2 font-semibold',
          mode === 'rules_ai' ? 'bg-surface shadow-card text-ink' : 'text-ink-muted',
        )}
        onClick={() => onChange('rules_ai')}
        data-testid="ai-mode-rules-ai"
      >
        {t('ai.modeRulesAi')}
      </button>
    </div>
  );
}

/** Prefetch visit summary when online. */
export function useVisitSummary(
  online: boolean,
  input: TriageInput | null,
  result: DecisionResult | null,
  language: string,
) {
  const [summary, setSummary] = useState<string | null>(null);
  const [meta, setMeta] = useState<ProviderInfo | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!online || !input || !result) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    // Allow cascade (Gemini→Groq→Local); keep UI skeleton until reply or soft timeout
    const timer = window.setTimeout(() => {
      if (!cancelled) {
        setLoading(false);
        setMeta((m) => m || { provider_used: 'none', latency_ms: 20000, fallback_reason: 'timeout' });
      }
    }, 20000);
    void api
      .aiVisitSummary({
        answers: input as unknown as Record<string, unknown>,
        decision: result.decision,
        rules_decision: result.rules_decision,
        reasons: result.reasons,
        triggered_rules: result.triggered_rules,
        shap_factors: result.shap_factors,
        severe_risk: result.severe_risk,
        ml_escalated: result.ml_escalated,
        language,
      })
      .then((res) => {
        if (cancelled) return;
        window.clearTimeout(timer);
        const data = (res.data || {}) as { summary?: string };
        setSummary(data.summary || null);
        setMeta({
          provider_used: String(res.provider_used || 'local'),
          latency_ms: Number(res.latency_ms || 0),
          fallback_reason: res.fallback_reason ? String(res.fallback_reason) : null,
        });
        setLoading(false);
        try {
          const raw = sessionStorage.getItem('zm_last_triage');
          if (!raw) return;
          const parsed = JSON.parse(raw);
          parsed.ai_visit_summary = data.summary;
          sessionStorage.setItem('zm_last_triage', JSON.stringify(parsed));
        } catch {
          /* ignore */
        }
      })
      .catch(() => {
        if (!cancelled) {
          window.clearTimeout(timer);
          setSummary(null);
          setMeta({ provider_used: 'none', latency_ms: 0, fallback_reason: 'unavailable' });
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [online, input, result, language]);

  return { summary, meta, loading };
}

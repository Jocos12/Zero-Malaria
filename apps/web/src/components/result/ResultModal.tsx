import {
  CircleAlert,
  Home,
  Lock,
  Siren,
  Volume2,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api/client';
import { setLanguage } from '../../i18n';
import { assertNoDowngrade } from '../../lib/decisionGuard';
import { cn } from '../../lib/cn';
import type { AiAdvisory, AiTrace, DecisionResult, TriageInput } from '../../types';
import type { AnswerInsight } from '../../triage/localAnswerInsights';
import { buildResultSequence, type VoiceLang } from '../../voice/phrases';
import { useVoice } from '../../voice/VoiceContext';
import { useTheme } from '../../theme/ThemeContext';
import { Modal } from '../Modal';
import { Button } from '../ui';
import { VoiceControls } from '../voice/VoiceControls';
import { AssistantChat } from '../ai/AssistantChat';
import { AiModeToggle, type AiMode } from './AiResultPanels';
import {
  AiComparePanel,
  AiOffState,
  AnalysisGrouped,
  GuardrailPanel,
  ImpactStrip,
  ModeSwitchFrame,
  PipelineStepper,
  RecommendationHierarchy,
  ShowDifferencesSwitch,
  VerdictCard,
  WhatIfPanel,
} from './AiTraceViews';
import { RecommendationGrid } from './RecommendationCard';
import {
  protocolComeBack,
  protocolFamily,
  protocolSteps,
  stripDashes,
} from './protocolCopy';
import { shortReason } from './ruleSentences';
export type SavedTriage = {
  input: TriageInput;
  result: DecisionResult;
  demo?: string;
  ai_extract_used?: boolean;
  answered_fields?: string[];
  answer_insights?: AnswerInsight[];
  timing?: Record<string, unknown>;
};
function persistAdvisory(advisory: AiAdvisory | null) {
  const raw = sessionStorage.getItem('zm_last_triage');
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw) as SavedTriage & { result: DecisionResult };
    parsed.result = { ...parsed.result, ai_advisory: advisory };
    sessionStorage.setItem('zm_last_triage', JSON.stringify(parsed));
  } catch {
    /* ignore */
  }
}
function persistAiTrace(trace: AiTrace | null) {
  const raw = sessionStorage.getItem('zm_last_triage');
  if (!raw || !trace) return;
  try {
    const parsed = JSON.parse(raw) as SavedTriage & { result: DecisionResult };
    parsed.result = { ...parsed.result, ai_trace: trace };
    sessionStorage.setItem('zm_last_triage', JSON.stringify(parsed));
  } catch {
    /* ignore */
  }
}
function ageBandChip(months: number, t: (k: string, o?: Record<string, unknown>) => string): string {
  if (months < 2) return t('result.chipAgeUnder2');
  if (months < 12) return t('result.chipAgeInfant');
  if (months < 60) return t('result.chipAgeUnder5');
  return t('result.chipAgeOlder');
}
function readSaved(): SavedTriage | null {
  try {
    const raw = sessionStorage.getItem('zm_last_triage');
    if (!raw) return null;
    return JSON.parse(raw) as SavedTriage;
  } catch {
    return null;
  }
}
function useIsLg() {
  const [lg, setLg] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia('(min-width: 1024px)').matches : true,
  );
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    const on = () => setLg(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return lg;
}
export function ResultModal({
  open,
  onClose,
  triagePath,
}: {
  open: boolean;
  onClose: () => void;
  triagePath: string;
}) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { offlineSim } = useTheme();
  const voice = useVoice();
  const isLg = useIsLg();
  const [saved, setSaved] = useState<SavedTriage | null>(() => readSaved());
  const [confirmed, setConfirmed] = useState(false);
  const [referralCreated, setReferralCreated] = useState(false);
  const [advisory, setAdvisory] = useState<AiAdvisory | null>(null);
  const [aiTrace, setAiTrace] = useState<AiTrace | null>(null);
  const [aiMode, setAiMode] = useState<AiMode>('rules_ai');
  const [showDiff, setShowDiff] = useState(true);
  const [leftTab, setLeftTab] = useState<'recommendation' | 'analysis'>('recommendation');
  const [mobileTab, setMobileTab] = useState<'recommendation' | 'assistant'>('recommendation');
  const [audioOpen, setAudioOpen] = useState(false);
  const advisoryFetched = useRef(false);
  const traceFetched = useRef(false);
  const audioRef = useRef<HTMLDivElement>(null);
  const leftScrollRef = useRef<HTMLDivElement>(null);
  const leftScrollTop = useRef(0);
  const lang: VoiceLang = i18n.language.startsWith('rw') ? 'rw' : 'en';
  const uiLang = i18n.language.startsWith('rw') ? 'rw' : 'en';
  const online = !offlineSim && (typeof navigator !== 'undefined' ? navigator.onLine : true);
  const handoverPath = '/m/handover';
  useEffect(() => {
    if (open) {
      setSaved(readSaved());
      advisoryFetched.current = false;
      traceFetched.current = false;
      setConfirmed(false);
      setReferralCreated(false);
      setLeftTab('recommendation');
      setMobileTab('recommendation');
      setAiTrace(null);
    }
  }, [open]);
  useEffect(() => {
    if (!audioOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (audioRef.current && !audioRef.current.contains(e.target as Node)) setAudioOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [audioOpen]);
  const guardedResult = useMemo(() => {
    if (!saved) return null;
    const raw = saved.result;
    return {
      ...raw,
      decision: assertNoDowngrade(raw.rules_decision || raw.decision, raw.decision) as DecisionResult['decision'],
    };
  }, [saved]);
  useEffect(() => {
    if (!open || !saved || !online || advisoryFetched.current) return;
    advisoryFetched.current = true;
    const { input, result } = saved;
    void api
      .aiAdvisory({
        answers: {
          ...(input as unknown as Record<string, unknown>),
          answered_fields: saved.answered_fields,
          pending_blood_clinical_validation: result.pending_blood_clinical_validation,
          inform_nurse_fields: result.inform_nurse_fields,
        },
        rules_decision: result.rules_decision || result.decision,
        public_decision: result.public_decision,
        reasons: result.reasons,
        triggered_rules: result.triggered_rules,
        reason_details: result.reason_details,
        missing_info: result.missing_info,
        protocol_reference: result.protocol_reference,
        language: lang,
      })
      .then((res) => {
        if (!res?.ok || !res.data || typeof res.data !== 'object') return;
        const d = res.data as Record<string, unknown>;
        if (typeof d.explanation_rw !== 'string' || typeof d.explanation_en !== 'string') return;
        const next: AiAdvisory = {
          explanation_rw: String(d.explanation_rw),
          explanation_en: String(d.explanation_en),
          inconsistencies: Array.isArray(d.inconsistencies) ? d.inconsistencies.map(String) : [],
          caregiver_advice_rw: String(d.caregiver_advice_rw || ''),
          handover_summary: String(d.handover_summary || ''),
          suggested_escalation: Boolean(d.suggested_escalation),
          citations: Array.isArray(d.citations) ? d.citations.map(String) : [],
          needs_native_review: d.needs_native_review !== false,
          chw_followed: null,
        };
        setAdvisory(next);
        persistAdvisory(next);
      })
      .catch(() => {
        /* rules alone */
      });
  }, [open, saved, online, lang]);
  const traceLangRef = useRef<string>('');
  useEffect(() => {
    if (!open || !saved || !guardedResult) return;
    const want = uiLang.slice(0, 2);
    if (traceLangRef.current === want && aiTrace?.impact) return;
    const existing = guardedResult.ai_trace || saved.result.ai_trace;
    if (
      existing?.impact &&
      (!existing.language || String(existing.language).startsWith(want))
    ) {
      setAiTrace(existing);
      traceLangRef.current = want;
      return;
    }
    let cancelled = false;
    void api
      .aiTrace({
        answers: {
          ...(saved.input as unknown as Record<string, unknown>),
          answered_fields: saved.answered_fields,
          reasons: guardedResult.reasons,
          triggered_rules: guardedResult.triggered_rules,
          pending_blood_clinical_validation: guardedResult.pending_blood_clinical_validation,
          inform_nurse_fields: guardedResult.inform_nurse_fields,
        },
        result: guardedResult as unknown as Record<string, unknown>,
        language: uiLang,
      })
      .then((res) => {
        if (cancelled) return;
        const data = (res.data || null) as AiTrace | null;
        if (data) {
          const withLang = { ...data, language: data.language || uiLang };
          setAiTrace(withLang);
          persistAiTrace(withLang);
          traceLangRef.current = want;
        }
      })
      .catch(() => {
        /* optional */
      });
    return () => {
      cancelled = true;
    };
  }, [open, saved, guardedResult, uiLang, aiTrace]);
  // advisory persisted for handover
  void advisory;
  void voice;
  const rememberScroll = () => {
    if (leftScrollRef.current) leftScrollTop.current = leftScrollRef.current.scrollTop;
  };
  const restoreScroll = () => {
    requestAnimationFrame(() => {
      if (leftScrollRef.current) leftScrollRef.current.scrollTop = leftScrollTop.current;
    });
  };
  const onModeChange = (m: AiMode) => {
    rememberScroll();
    setAiMode(m);
    restoreScroll();
  };
  if (!open) return null;
  if (!saved || !guardedResult) {
    return (
      <Modal open onClose={onClose} title={t('result.title')} testId="result-modal" size="xl" footer={<Button onClick={onClose}>{t('common.close')}</Button>}>
        <p className="text-sm text-ink-muted">{t('common.empty')}</p>
      </Modal>
    );
  }
  const result = guardedResult;
  const decision = result.decision;
  const conf =
    decision === 'urgent_refer'
      ? { tone: 'danger' as const, label: t('result.urgent'), Icon: Siren }
      : decision === 'refer'
        ? { tone: 'warning' as const, label: t('result.refer'), Icon: CircleAlert }
        : { tone: 'success' as const, label: t('result.treat'), Icon: Home };
  const bannerCls =
    conf.tone === 'danger'
      ? 'bg-danger text-white'
      : conf.tone === 'warning'
        ? 'bg-warning text-white'
        : 'bg-success text-white';
  const reasonSentence =
    stripDashes(shortReason(result.reasons, result.triggered_rules, uiLang)) || t('result.why');
  const sexLabel =
    saved.input.sex === 'female' ? t('triage.female') : saved.input.sex === 'male' ? t('triage.male') : '-';
  const ageLabel = ageBandChip(saved.input.age_months ?? 0, t);
  const mainSequence = buildResultSequence(result.decision, result.triggered_rules);
  const missing = result.missing_info || [];
  const familyText = stripDashes(
    protocolFamily(decision, uiLang) ||
      aiTrace?.ai_added?.find((a) => a.type === 'family_message')?.text ||
      '',
  );
  const comeBackText = stripDashes(
    protocolComeBack(decision, uiLang) ||
      aiTrace?.ai_added?.find((a) => a.type === 'come_back')?.text ||
      '',
  );
  // Always use FE protocol catalog so RW/EN switch updates steps immediately
  const doNow = protocolSteps(decision, uiLang);
  const ctaSolid =
    decision === 'urgent_refer'
      ? 'bg-danger text-white hover:bg-danger/90 disabled:bg-danger/40 disabled:text-white/80'
      : decision === 'refer'
        ? 'bg-warning text-white hover:bg-warning/90 disabled:bg-warning/40 disabled:text-white/80'
        : 'bg-success text-white hover:bg-success/90 disabled:bg-success/40 disabled:text-white/80';
  const primaryAction = () => {
    setReferralCreated(true);
    if (decision === 'treat_at_home') {
      navigate(saved.demo === 'A' ? `${triagePath}?demo=B` : triagePath.replace(/triage.*/, 'home'));
    } else {
      navigate(handoverPath);
    }
  };
  const langShort = i18n.language.startsWith('rw') ? 'rw' : 'en';
  const switchLang = (lng: 'rw' | 'en') => {
    setLanguage(lng);
    traceLangRef.current = '';
  };
  const header = (
    <div className="flex w-full flex-wrap items-center gap-2" data-testid="result-header-compact">
      <div className={cn('flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-[12px] px-3 py-1.5', bannerCls)} data-testid="result-decision-banner">
        <conf.Icon className="h-5 w-5 shrink-0" strokeWidth={1.75} aria-hidden />
        <p className="min-w-0 truncate text-[15px] font-bold leading-none" data-testid="result-decision-title">
          {conf.label}
          <span className="ml-2 font-normal opacity-95">· {reasonSentence}</span>
        </p>
        <span className="hidden shrink-0 rounded-full bg-white/20 px-2 py-0.5 text-[11px] font-semibold sm:inline" data-testid="result-age-sex-chip">
          {ageLabel} · {sexLabel}
        </span>
        <span className="inline-flex shrink-0 items-center" title={t('result.protocolLockTooltip')} data-testid="result-lock">
          <Lock className="h-3.5 w-3.5 opacity-90" aria-label={t('result.protocolLockTooltip')} />
        </span>
      </div>
      <div
        className="inline-flex shrink-0 rounded-full bg-surface-muted p-0.5"
        data-testid="result-lang-switch"
        role="group"
        aria-label={t('lang.title')}
      >
        {(
          [
            { id: 'rw' as const, label: t('lang.kinyarwanda') },
            { id: 'en' as const, label: t('lang.english') },
          ] as const
        ).map((opt) => (
          <button
            key={opt.id}
            type="button"
            className={cn(
              'min-h-9 rounded-full px-2.5 py-1 text-[12px] font-semibold transition-colors',
              'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2',
              langShort === opt.id ? 'bg-primary text-primary-foreground shadow-sm' : 'text-ink-muted hover:text-ink',
            )}
            aria-pressed={langShort === opt.id}
            data-testid={`result-lang-${opt.id}`}
            onClick={() => switchLang(opt.id)}
          >
            {opt.id === 'rw' ? 'RW' : 'EN'}
            <span className="sr-only">{opt.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
  const leftPane = (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-3 pt-2 lg:w-[55%]" data-testid="result-left-col">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-full bg-surface-muted p-0.5 text-xs font-semibold" role="tablist" aria-label={t('result.leftTabs')}>
          <button
            type="button"
            role="tab"
            aria-selected={leftTab === 'recommendation'}
            className={cn(
              'rounded-full px-3 py-1.5 transition-colors duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2',
              leftTab === 'recommendation' ? 'bg-surface text-ink shadow-sm' : 'text-ink-muted',
            )}
            onClick={() => setLeftTab('recommendation')}
            data-testid="tab-recommendation"
          >
            {t('result.tabRecommendation')}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={leftTab === 'analysis'}
            className={cn(
              'rounded-full px-3 py-1.5 transition-colors duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2',
              leftTab === 'analysis' ? 'bg-surface text-ink shadow-sm' : 'text-ink-muted',
            )}
            onClick={() => setLeftTab('analysis')}
            data-testid="tab-analysis"
          >
            {t('result.tabAnalysis')}
          </button>
        </div>
        <div className="min-w-[180px] flex-1" data-testid="ai-mode-toggle-wrap">
          <AiModeToggle mode={aiMode} onChange={onModeChange} />
        </div>
        {aiMode === 'rules_ai' ? (
          <ShowDifferencesSwitch checked={showDiff} onChange={setShowDiff} />
        ) : null}
      </div>
      <div
        ref={leftScrollRef}
        className="zm-scroll-pane zm-scroll-fade flex-1 pb-2"
        tabIndex={0}
        data-testid="result-left-scroll"
      >
        <ModeSwitchFrame mode={aiMode}>
          {leftTab === 'recommendation' ? (
            <>
              {aiMode === 'rules_ai' ? <ImpactStrip trace={aiTrace} mode={aiMode} /> : null}
              <VerdictCard result={result} trace={aiTrace} reasonLine={reasonSentence} />
            </>
          ) : null}
          {leftTab === 'recommendation' ? (
            <>
              {aiMode === 'rules_ai' ? (
                <RecommendationHierarchy
                  result={result}
                  trace={aiTrace}
                  language={uiLang}
                  doNow={doNow}
                  tellFamily={familyText}
                  comeBack={comeBackText}
                  showAiBadges={showDiff}
                />
              ) : null}
              <RecommendationGrid
                input={saved.input}
                result={result}
                language={uiLang}
                online={online}
                enhanceAi={aiMode === 'rules_ai'}
                aiTrace={aiTrace}
              />
              {aiMode === 'rules' ? <AiOffState /> : null}
              {aiMode === 'rules_ai' ? (
                <>
                  <PipelineStepper trace={aiTrace} mode={aiMode} />
                  <WhatIfPanel trace={aiTrace} mode={aiMode} />
                  <GuardrailPanel
                    trace={aiTrace}
                    mode={aiMode}
                    answers={saved.input}
                    result={result}
                    language={uiLang}
                    onTraceUpdate={(next) => {
                      setAiTrace(next);
                      persistAiTrace(next);
                    }}
                  />
                </>
              ) : null}
            </>
          ) : (
            <AnalysisGrouped
              trace={aiTrace}
              mode={aiMode}
              highlightAi={aiMode === 'rules_ai' && showDiff}
              language={uiLang}
              missingInfo={result.missing_info}
              protocolReference={result.protocol_reference}
            />
          )}
        </ModeSwitchFrame>
      </div>
    </div>
  );
  const rightPane = (
    <div
      className="flex min-h-0 flex-1 flex-col overflow-hidden border-t border-border lg:w-[45%] lg:border-l lg:border-t-0"
      data-testid="result-right-col"
      tabIndex={0}
    >
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <AssistantChat
          embedded
          column
          open
          chwSimple
          caseInput={saved.input}
          caseResult={result}
          answeredFields={saved.answered_fields}
          language={uiLang}
          lockedDecision={decision}
          hasCaseAvailable
          contextMode="case"
          pageId="triage"
        />
      </div>
      <div className="shrink-0 border-t border-border px-2 pb-2 pt-1">
        <AiComparePanel
          online={online}
          input={saved.input}
          result={result}
          language={uiLang}
          mode={aiMode}
          collapsedDefault
        />
      </div>
    </div>
  );
  const informNurseBlood = result.inform_nurse_fields || [];
  const footer = (
    <div className="flex w-full flex-col gap-2" data-testid="result-footer">
      {result.pending_blood_clinical_validation ? (
        <div
          className="w-full rounded-[12px] border border-border bg-surface-muted px-3 py-2 text-xs text-ink"
          data-testid="result-blood-validation-notice"
          role="status"
        >
          <p className="font-semibold">{t('result.bloodPendingValidation')}</p>
          {informNurseBlood.length ? (
            <p className="mt-1 text-ink-muted">{t('result.informNurseBlood')}</p>
          ) : null}
        </div>
      ) : null}
      {missing.length ? (
        <div className="w-full rounded-[12px] bg-info/10 px-3 py-1.5 text-xs text-ink" role="status">
          <p className="font-semibold">{t('result.completenessTitle')}</p>
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <label className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold">
          <input
            type="checkbox"
            className="h-5 w-5 accent-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
            data-testid="result-confirm"
          />
          {t('result.confirm')}
        </label>
        <div className="ml-auto flex flex-wrap items-end gap-2">
          <div className="relative" ref={audioRef}>
            <Button
              variant="outline"
              size="sm"
              className="min-h-11"
              onClick={() => setAudioOpen((v) => !v)}
              aria-label={t('result.readAloud')}
              aria-expanded={audioOpen}
              data-testid="result-audio-btn"
              leftIcon={<Volume2 className="h-4 w-4" />}
            >
              {t('result.readAloud')}
            </Button>
            {audioOpen ? (
              <div
                className="absolute bottom-full right-0 z-20 mb-2 w-[280px] rounded-[18px] border border-border bg-surface p-3 shadow-lift"
                data-testid="result-audio-popover"
              >
                <VoiceControls phraseIds={mainSequence} showLabels language={lang} />
              </div>
            ) : null}
          </div>
          <div className="flex flex-col items-stretch gap-1">
            <Button
              size="sm"
              className={cn('min-h-11 min-w-[200px] font-bold shadow-sm disabled:opacity-55', ctaSolid)}
              disabled={!confirmed}
              onClick={primaryAction}
              data-testid="result-primary-cta"
            >
              {decision === 'treat_at_home' ? t('result.markTreated') : t('result.createHandover')}
            </Button>
            {!confirmed ? (
              <span className="max-w-[220px] text-[11px] font-medium text-ink-muted" data-testid="result-confirm-hint">
                {t('result.confirmFirst')}
              </span>
            ) : null}
          </div>
          <Button size="sm" variant="ghost" className="min-h-11" onClick={onClose} data-testid="result-close">
            {t('common.close')}
          </Button>
        </div>
      </div>
    </div>
  );
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('result.title')}
      header={header}
      footer={footer}
      size="full"
      fillBody
      dirty={!referralCreated}
      onDiscardConfirm={() => {
        /* close without referral */
      }}
      testId="result-modal"
    >
      {!isLg ? (
        <div className="flex shrink-0 gap-1 border-b border-border px-3 py-2" role="tablist" data-testid="result-mobile-tabs">
          <button
            type="button"
            role="tab"
            aria-selected={mobileTab === 'recommendation'}
            className={cn(
              'flex-1 rounded-[12px] px-3 py-2 text-sm font-semibold transition-colors duration-150',
              mobileTab === 'recommendation' ? 'bg-primary text-primary-foreground' : 'bg-surface-muted text-ink-muted',
            )}
            onClick={() => setMobileTab('recommendation')}
          >
            {t('result.tabRecommendation')}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mobileTab === 'assistant'}
            className={cn(
              'flex-1 rounded-[12px] px-3 py-2 text-sm font-semibold transition-colors duration-150',
              mobileTab === 'assistant' ? 'bg-primary text-primary-foreground' : 'bg-surface-muted text-ink-muted',
            )}
            onClick={() => setMobileTab('assistant')}
            data-testid="tab-assistant-mobile"
          >
            {t('result.tabAssistant')}
          </button>
        </div>
      ) : null}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden lg:flex-row" data-testid="result-body-split">
        {isLg || mobileTab === 'recommendation' ? leftPane : null}
        {isLg || mobileTab === 'assistant' ? rightPane : null}
      </div>
    </Modal>
  );
}

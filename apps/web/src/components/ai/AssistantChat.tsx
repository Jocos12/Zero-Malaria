import {
  Bot,
  Copy,
  Mic,
  Plus,
  RefreshCw,
  Send,
  Square,
  ThumbsDown,
  ThumbsUp,
  Volume2,
  X,
} from 'lucide-react';
import { motion, useReducedMotion } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, authFetch, type ApiError } from '../../api/client';
import { classifyAiError, failReasonI18nKey, type AiFailReason } from '../../lib/aiErrors';
import { getAiProviderMode, type AiProviderMode } from '../../lib/aiProviderPrefs';
import { cn } from '../../lib/cn';
import { useTheme } from '../../theme/ThemeContext';
import { useVoice } from '../../voice/VoiceContext';
import { startLiveStt, type LiveSttHandle } from '../../voice/liveStt';
import type { DecisionResult, TriageInput } from '../../types';
import { Button, IconButton } from '../ui';
import { ChatBlocks, SafeMarkdown, type ChatBlock } from './ChatBlocks';
import { VoiceFlowStepper, type VoiceFlowStep } from '../voice/VoiceFlowStepper';
import {
  PAGE_CHIP_KEYS,
  type AssistantContextMode,
  type AssistantPageId,
} from '../../hooks/useAssistantPageContext';
import {
  AssistantAvatar,
  asrUnclearPhrase,
  createSpeakQueue,
  greetingPhrase,
  hasGreetedThisSession,
  markGreetedThisSession,
  memorySlice,
  offlinePhrase,
  safetyBlockedPhrase,
  sanitizeForSpeech,
  speakLangCode,
  speakTextBrowser,
  stopBrowserSpeech,
  useAvatarState,
  useConversation,
  useLipSync,
  type SpeakLang,
} from './avatar';

type Msg = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  provider?: string;
  latency_ms?: number;
  sources?: Array<{ section?: string; file?: string }>;
  local_mode?: boolean;
  streaming?: boolean;
  corrected?: boolean;
  failReason?: AiFailReason;
  feedback?: 'up' | 'down' | null;
  ui_reason?: string;
  fallback_reason?: string;
  blocks?: ChatBlock[];
  followups?: string[];
  intent?: string;
  answer_language?: string;
};

const CASE_CHIPS = [
  { key: 'askWhy' },
  { key: 'askWhatNow' },
  { key: 'askWhichRules' },
  { key: 'askDangerSigns' },
  { key: 'askTellFamily' },
  { key: 'askComeBack' },
] as const;

function stripDisclosure(text: string) {
  return (text || '')
    .replace(/[\u2014\u2013\u2212]+/g, '. ')
    .replace(/\.\s*\./g, '.')
    .replace(
      /\n*\s*(AI-generated[,.]?\s*verify[^\n]*|Answer (based on|limited to) protocol rules[^\n]*|Answer built from protocol rules[^\n]*|Igisubizo gikomoka ku mategeko[^\n]*)\s*$/gi,
      '',
    )
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function TypingDots() {
  return (
    <span className="inline-flex items-center gap-1 px-1" data-testid="typing-indicator" aria-live="polite">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="h-1.5 w-1.5 rounded-full bg-ink-muted motion-safe:animate-pulse"
          style={{ animationDelay: `${i * 160}ms` }}
        />
      ))}
    </span>
  );
}

export function AssistantChat({
  embedded = false,
  column = false,
  open,
  onClose,
  caseInput,
  caseResult,
  answeredFields,
  language = 'en',
  lockedDecision: _lockedDecision,
  /** CHW Result: hide provider mode select; discreet status only */
  chwSimple = false,
  hasCaseAvailable = false,
  pageId = 'default' as AssistantPageId,
  contextMode = 'general' as AssistantContextMode,
}: {
  embedded?: boolean;
  column?: boolean;
  open?: boolean;
  onClose?: () => void;
  caseInput?: TriageInput | null;
  caseResult?: DecisionResult | null;
  answeredFields?: string[];
  language?: string;
  lockedDecision?: string;
  chwSimple?: boolean;
  hasCaseAvailable?: boolean;
  pageId?: AssistantPageId;
}) {
  const { t, i18n } = useTranslation();
  const reduce = useReducedMotion();
  const { offlineSim } = useTheme();
  const voice = useVoice();
  const online = !offlineSim && (typeof navigator !== 'undefined' ? navigator.onLine : true);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [sttConfirm, setSttConfirm] = useState<string | null>(null);
  const [sttError, setSttError] = useState<string | null>(null);
  const [voiceStep, setVoiceStep] = useState<VoiceFlowStep>('idle');
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const [ttsHint, setTtsHint] = useState<string | null>(null);
  const [asrRetry, setAsrRetry] = useState(false);
  const [voiceLang, setVoiceLang] = useState<SpeakLang>(() => speakLangCode(language || 'rw'));
  const lastAudioRef = useRef<Blob | null>(null);
  const liveSttRef = useRef<LiveSttHandle | null>(null);
  const mediaLoopStopRef = useRef<(() => Promise<void>) | null>(null);
  const draftBeforeListenRef = useRef('');
  const liveAccumRef = useRef('');
  const spokenCountRef = useRef(0);
  const speakQueueRef = useRef<ReturnType<typeof createSpeakQueue> | null>(null);
  const conv = useConversation(voiceLang);
  const { level: mouthLevel, lip } = useLipSync(
    conv.turn === 'speaking' || conv.turn === 'greeting' || Boolean(speakingId),
    Boolean(reduce),
  );
  const avatarMood = useAvatarState({ turn: conv.turn });

  useEffect(() => {
    setVoiceLang(speakLangCode(language || i18n.language || 'rw'));
  }, [language, i18n.language]);

  useEffect(() => {
    speakQueueRef.current = createSpeakQueue({
      onStart: () => {
        conv.setSpeaking();
        lip.startSynthetic();
      },
      onIdle: () => {
        lip.stop();
        setSpeakingId(null);
        if (conv.turn === 'speaking' || conv.turn === 'greeting') conv.setIdle();
      },
      onBlocked: () => setTtsHint(t('ai.avatarSafetySpeak')),
      onTtsFail: () => setTtsHint(t('ai.avatarTtsUnavailable')),
    });
    return () => {
      speakQueueRef.current?.stop();
      speakQueueRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- queue once
  }, []);

  // Greeting once per browser session when panel is visible
  useEffect(() => {
    const visible = open !== false || embedded || column;
    if (!visible || hasGreetedThisSession()) return;
    markGreetedThisSession();
    const text = greetingPhrase(voiceLang);
    conv.setGreeting();
    setSpeakingId('greeting');
    voice.unlock();
    const res = speakTextBrowser(text, voiceLang, () => {
      lip.stop();
      setSpeakingId(null);
      conv.setIdle();
    });
    if (res.ok) lip.startSynthetic();
    else {
      setSpeakingId(null);
      conv.setIdle();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once on open
  }, [open, embedded, column]);

  useEffect(() => {
    return () => {
      liveSttRef.current?.stop();
      liveSttRef.current = null;
      void mediaLoopStopRef.current?.();
      mediaLoopStopRef.current = null;
      speakQueueRef.current?.stop();
      stopBrowserSpeech();
      lip.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- unmount cleanup only
  }, []);
  const [useCase, setUseCase] = useState(
    () => Boolean(caseInput) && (contextMode === 'case' || embedded),
  );
  const [mode, setMode] = useState<AiProviderMode>(() => getAiProviderMode());
  const [assistantReady, setAssistantReady] = useState(true);
  const [providerStatus, setProviderStatus] = useState<
    Record<string, { status?: string; reason?: string; latency_ms?: number }>
  >({});
  const [lastFail, setLastFail] = useState<AiFailReason | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const showModeSelect = Boolean(import.meta.env.VITE_DEMO_MODE !== 'false') && !chwSimple && !embedded;
  const streamBuf = useRef({
    text: '',
    provider: 'local',
    latency_ms: 0,
    local_mode: true,
    sources: undefined as Msg['sources'],
    corrected: false,
    ui_reason: undefined as string | undefined,
    fallback_reason: undefined as string | undefined,
    blocks: undefined as ChatBlock[] | undefined,
    followups: undefined as string[] | undefined,
    intent: undefined as string | undefined,
    answer_language: undefined as string | undefined,
  });

  useEffect(() => {
    // Result modal / triage always bind to the open case when answers exist.
    setUseCase(Boolean(caseInput) && (contextMode === 'case' || embedded));
  }, [contextMode, caseInput, embedded]);

  useEffect(() => {
    const sync = () => setMode(getAiProviderMode());
    sync();
    window.addEventListener('zm-ai-provider-mode', sync);
    return () => window.removeEventListener('zm-ai-provider-mode', sync);
  }, []);

  useEffect(() => {
    if (!open && !embedded) return;
    void api
      .aiStatus()
      .then((h) => {
        const providers = h.providers || {};
        setProviderStatus(providers);
        const anyOk = Object.values(providers).some((p) => p?.status === 'ok');
        setAssistantReady(online && (anyOk || Boolean(providers.local)));
      })
      .catch(() => {
        void api
          .aiHealth()
          .then((h) => {
            const providers = (h.providers || {}) as Record<
              string,
              { reachable?: boolean; configured?: boolean }
            >;
            const any =
              Boolean(providers.local) ||
              Object.values(providers).some((p) => p?.reachable || p?.configured);
            setAssistantReady(online && (any || true));
          })
          .catch(() => setAssistantReady(online));
      });
  }, [open, embedded, online]);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (typeof el.scrollTo === 'function') {
      el.scrollTo({ top: el.scrollHeight, behavior: reduce ? 'auto' : 'smooth' });
    } else {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages, busy, reduce]);

  const locked =
    _lockedDecision || caseResult?.rules_decision || caseResult?.decision || undefined;
  const casePayload =
    useCase && caseInput
      ? {
          ...(caseInput as unknown as Record<string, unknown>),
          answered_fields: answeredFields,
          rules_decision: locked,
          decision: caseResult?.decision || locked,
          public_decision: caseResult?.public_decision,
          reasons: caseResult?.reasons,
          triggered_rules: caseResult?.triggered_rules,
          reason_details: caseResult?.reason_details,
          missing_info: caseResult?.missing_info,
          inform_nurse_fields: caseResult?.inform_nurse_fields,
          pending_blood_clinical_validation: caseResult?.pending_blood_clinical_validation,
          severe_risk: caseResult?.severe_risk,
          shap_factors: caseResult?.shap_factors,
          ml_escalated: caseResult?.ml_escalated,
        }
      : null;

  const stop = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setBusy(false);
    setMessages((m) => m.map((x) => (x.streaming ? { ...x, streaming: false } : x)));
  };

  const chipLabel = (key: string) => t(`ai.${key}`);

  const effectiveContextMode: AssistantContextMode =
    useCase && casePayload ? 'case' : contextMode === 'page' ? 'page' : 'general';

  const contextChipLabel =
    effectiveContextMode === 'case'
      ? t('ai.contextCase')
      : effectiveContextMode === 'page'
        ? t('ai.contextPage')
        : t('ai.contextGeneral');

  const emptyTitle =
    effectiveContextMode === 'case'
      ? t('ai.askAnythingCase')
      : effectiveContextMode === 'page'
        ? t('ai.askAnythingPage')
        : t('ai.askAnythingGeneral');

  const emptyHint =
    effectiveContextMode === 'case' ? t('ai.askAnythingHintCase') : t('ai.askAnythingHint');

  const stopAllSpeech = () => {
    speakQueueRef.current?.stop();
    speakQueueRef.current?.reset();
    stopBrowserSpeech();
    lip.stop();
    setSpeakingId(null);
  };

  const playAnswer = (id: string, raw: string) => {
    voice.unlock();
    if (speakingId === id) {
      stopAllSpeech();
      conv.setIdle();
      return;
    }
    stopAllSpeech();
    speakQueueRef.current?.reset();
    const safeFb = safetyBlockedPhrase(voiceLang);
    const { text: safe, blocked } = sanitizeForSpeech(stripDisclosure(raw), safeFb);
    setTtsHint(blocked ? t('ai.avatarSafetySpeak') : null);
    setSpeakingId(id);
    conv.setSpeaking();
    speakQueueRef.current?.enqueue(safe, voiceLang, safeFb);
    lip.startSynthetic();
  };

  const speakOfflineNotice = () => {
    const text = offlinePhrase(voiceLang);
    setTtsHint(null);
    stopAllSpeech();
    speakQueueRef.current?.reset();
    setSpeakingId('offline');
    conv.setSpeaking();
    speakQueueRef.current?.enqueue(text, voiceLang, text);
    lip.startSynthetic();
    return text;
  };

  const speakAsrUnclear = () => {
    const text = asrUnclearPhrase(voiceLang);
    setAsrRetry(true);
    setSttError(text);
    stopAllSpeech();
    speakQueueRef.current?.reset();
    setSpeakingId('asr-unclear');
    conv.setSpeaking();
    speakQueueRef.current?.enqueue(text, voiceLang, text);
    lip.startSynthetic();
  };

  const quickChipKeys =
    useCase && casePayload
      ? CASE_CHIPS.map((c) => c.key)
      : (PAGE_CHIP_KEYS[pageId] ?? PAGE_CHIP_KEYS.default);

  const send = async (text: string) => {
    const content = text.trim();
    if (!content || busy) return;
    setLastFail(null);
    setAsrRetry(false);
    setTtsHint(null);
    // Detect question language for answer + TTS
    const detected = speakLangCode(content.match(/[àâäéèêëïîôùûüç]/i)
      ? 'fr'
      : content.match(
            /\b(ni|nga|umu|aba|reka|muraho|ikibazo|umuryango|ubuzima)\b/i,
          )
        ? 'rw'
        : content.match(/[a-z]/i)
          ? speakLangCode(voiceLang)
          : voiceLang);
    if (detected) setVoiceLang(detected);

    const userMsg: Msg = { id: `u-${Date.now()}`, role: 'user', content };
    const hist = memorySlice(
      [...messages, userMsg]
        .filter((m) => !m.streaming)
        .map((m) => ({ role: m.role, content: m.content })),
      6,
    );
    const asstId = `a-${Date.now()}`;
    setMessages((m) => [...m, userMsg, { id: asstId, role: 'assistant', content: '', streaming: true }]);
    setDraft('');
    setBusy(true);
    conv.setThinking();
    // Immediate nod + filler (never same twice in a row)
    const filler = conv.nextFiller();
    if (filler && online) {
      stopAllSpeech();
      speakQueueRef.current?.reset();
      setSpeakingId('filler');
      speakQueueRef.current?.enqueue(filler, voiceLang, filler);
      lip.startSynthetic();
    }
    spokenCountRef.current = 0;
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const safeFb = safetyBlockedPhrase(voiceLang);

    try {
      const chatBody = () =>
        JSON.stringify({
          message: content,
          history: hist.slice(0, -1),
          case: casePayload,
          language: voiceLang || language || i18n.language,
          stream: true,
          mode,
          use_case_context: Boolean(casePayload),
          page_context: effectiveContextMode,
          page_id: pageId,
        });
      const res = await authFetch('/ai/chat', {
        method: 'POST',
        headers: { Accept: 'text/event-stream' },
        body: chatBody(),
        rebuildBody: chatBody,
        signal: ctrl.signal,
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      streamBuf.current = {
        text: '',
        provider: 'local',
        latency_ms: 0,
        local_mode: true,
        sources: undefined,
        corrected: false,
        ui_reason: undefined,
      };

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const parts = buf.split('\n\n');
          buf = parts.pop() || '';
          for (const block of parts) {
            const line = block.split('\n').find((l) => l.startsWith('data:'));
            if (!line) continue;
            try {
              const payload = JSON.parse(line.slice(5).trim()) as Record<string, unknown>;
              const chunkType = String(payload.type || '');
              // Backend SSE uses type=delta; older clients used type=token
              if (
                (chunkType === 'delta' || chunkType === 'token') &&
                typeof payload.text === 'string'
              ) {
                const next = stripDisclosure(streamBuf.current.text + payload.text);
                streamBuf.current = { ...streamBuf.current, text: next };
                setMessages((m) =>
                  m.map((x) => (x.id === asstId ? { ...x, content: next, streaming: true } : x)),
                );
                // Speak sentence-by-sentence once each sentence clears the safety lock
                spokenCountRef.current =
                  speakQueueRef.current?.enqueueNewSentences(
                    next,
                    spokenCountRef.current,
                    voiceLang,
                    safeFb,
                  ) ?? spokenCountRef.current;
                if (speakQueueRef.current?.busy) {
                  setSpeakingId(asstId);
                  conv.setSpeaking();
                }
              }
              if (chunkType === 'done') {
                const replyText = stripDisclosure(
                  String(payload.reply || payload.text || streamBuf.current.text || ''),
                );
                streamBuf.current = {
                  text: replyText,
                  provider: String(payload.provider_used || 'local'),
                  latency_ms: Number(payload.latency_ms || 0),
                  local_mode: Boolean(payload.local_mode),
                  sources: (payload.sources as Msg['sources']) || [],
                  corrected: Boolean(payload.corrected || payload.rejected),
                  ui_reason: payload.ui_reason ? String(payload.ui_reason) : undefined,
                  fallback_reason: payload.fallback_reason
                    ? String(payload.fallback_reason)
                    : undefined,
                  blocks: Array.isArray(payload.blocks)
                    ? (payload.blocks as ChatBlock[])
                    : undefined,
                  followups: Array.isArray(payload.followups)
                    ? (payload.followups as string[])
                    : undefined,
                  intent: payload.intent ? String(payload.intent) : undefined,
                  answer_language: payload.answer_language
                    ? String(payload.answer_language)
                    : undefined,
                };
              }
            } catch {
              /* ignore partial */
            }
          }
        }
      } else {
        const json = (await res.json()) as Record<string, unknown>;
        streamBuf.current = {
          text: stripDisclosure(String(json.reply || json.text || '')),
          provider: String(json.provider_used || 'local'),
          latency_ms: Number(json.latency_ms || 0),
          local_mode: Boolean(json.local_mode),
          sources: undefined,
          corrected: false,
          ui_reason: undefined,
          fallback_reason: json.fallback_reason ? String(json.fallback_reason) : undefined,
          blocks: Array.isArray(json.blocks) ? (json.blocks as ChatBlock[]) : undefined,
          followups: Array.isArray(json.followups) ? (json.followups as string[]) : undefined,
          intent: json.intent ? String(json.intent) : undefined,
          answer_language: json.answer_language ? String(json.answer_language) : undefined,
        };
      }

      const done = streamBuf.current;
      let reply = (done.text || '').trim();
      // Non-stream JSON fallback if SSE body empty
      if (!reply) {
        try {
          const jsonBody = () =>
            JSON.stringify({
              message: content,
              history: hist.slice(0, -1),
              case: casePayload,
              language: voiceLang || language || i18n.language,
              stream: false,
              mode,
              use_case_context: Boolean(casePayload),
              page_context: effectiveContextMode,
              page_id: pageId,
            });
          const jsonRes = await authFetch('/ai/chat', {
            method: 'POST',
            body: jsonBody(),
            rebuildBody: jsonBody,
            signal: ctrl.signal,
          });
          if (jsonRes.ok) {
            const body = (await jsonRes.json()) as Record<string, unknown>;
            reply = String(body.reply || body.text || '').trim();
            if (Array.isArray(body.blocks)) done.blocks = body.blocks as ChatBlock[];
            if (Array.isArray(body.followups)) done.followups = body.followups as string[];
            if (body.fallback_reason) done.fallback_reason = String(body.fallback_reason);
            if (body.answer_language) done.answer_language = String(body.answer_language);
            if (body.intent) done.intent = String(body.intent);
          }
        } catch {
          /* keep empty */
        }
      }
      const meta = {
        content: reply || t('ai.chatReferNurse'),
        provider: done.provider,
        latency_ms: done.latency_ms,
        local_mode: done.local_mode,
        sources: done.sources,
        corrected: done.corrected,
        ui_reason: done.ui_reason,
        fallback_reason: done.fallback_reason,
        blocks: done.blocks,
        followups: done.followups,
        intent: done.intent,
        answer_language: done.answer_language,
        streaming: false,
      };
      setMessages((m) =>
        m.map((x) =>
          x.id === asstId
            ? {
                ...x,
                ...meta,
                content: meta.content,
                streaming: false,
              }
            : x,
        ),
      );
      // Finish any remaining sentences after stream ends
      spokenCountRef.current =
        speakQueueRef.current?.enqueueNewSentences(
          meta.content,
          spokenCountRef.current,
          voiceLang,
          safeFb,
        ) ?? spokenCountRef.current;
      // If nothing spoken yet (no sentence punctuation), speak the full safe reply
      if (spokenCountRef.current === 0 && meta.content.trim()) {
        setSpeakingId(asstId);
        speakQueueRef.current?.enqueue(meta.content, voiceLang, safeFb);
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      const reason = classifyAiError(err, online);
      setLastFail(reason);
      const offlineText = !online || reason === 'offline' ? speakOfflineNotice() : null;
      setMessages((m) =>
        m.map((x) =>
          x.id === asstId
            ? {
                ...x,
                content: offlineText || t(failReasonI18nKey(reason)),
                provider: 'local',
                local_mode: true,
                failReason: reason,
                streaming: false,
              }
            : x,
        ),
      );
      if (!offlineText) conv.setIdle();
    } finally {
      setBusy(false);
      abortRef.current = null;
      if (!speakQueueRef.current?.busy) conv.setIdle();
    }
  };

  const empty = messages.length === 0;
  const statusReady = assistantReady && online;
  const lastAssistantId = [...messages].reverse().find((m) => m.role === 'assistant' && !m.streaming)?.id;

  const chipRow = (
    <div
      className="flex shrink-0 gap-2 overflow-x-auto px-3 py-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      data-testid="chat-quick-chips"
      role="list"
    >
      {quickChipKeys.map((key) => (
        <button
          key={key}
          type="button"
          role="listitem"
          disabled={busy}
          className={cn(
            'min-h-11 shrink-0 rounded-full border border-border bg-surface-muted px-3.5 py-2 text-[13px] font-medium',
            'transition-transform duration-150 hover:bg-primary-soft active:scale-[0.98]',
            'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50',
          )}
          onClick={() => void send(chipLabel(key))}
        >
          {chipLabel(key)}
        </button>
      ))}
    </div>
  );

  const panel = (
    <motion.div
      className={cn(
        'flex flex-col bg-surface text-ink',
        column ? 'h-full min-h-0' : embedded ? 'min-h-[420px] rounded-[18px] border border-border' : 'h-full',
      )}
      data-testid="assistant-chat"
      initial={reduce || !embedded ? false : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: reduce ? 0 : 0.25, ease: [0.22, 1, 0.36, 1] }}
    >
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2.5">
        <div className="flex min-w-0 flex-col gap-0.5">
          <p className="flex flex-wrap items-center gap-2 text-[15px] font-semibold">
            <Bot className="h-4 w-4 text-info" aria-hidden />
            {t('ai.assistantTitle')}
            <span
              className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-muted px-2.5 py-1 text-[11px] font-semibold text-ink-muted"
              data-testid="assistant-status"
              title={statusReady ? t('ai.assistantReady') : t('ai.assistantUnavailable')}
            >
              <span
                className={cn('h-2 w-2 rounded-full', statusReady ? 'bg-success' : 'bg-ink-muted')}
                aria-hidden
              />
              {t('ai.assistantStatus')}
            </span>
          </p>
          <p className="text-[11px] font-medium text-ink-muted" data-testid="avatar-disclaimer">
            {t('ai.avatarDisclaimer')}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <div
            className="inline-flex min-h-11 items-center gap-0.5 rounded-[12px] border border-border p-0.5"
            role="group"
            aria-label={t('ai.avatarVoiceLang')}
            data-testid="avatar-lang-select"
          >
            {(['rw', 'fr', 'en'] as const).map((code) => (
              <button
                key={code}
                type="button"
                className={cn(
                  'min-h-10 min-w-10 rounded-[10px] px-2 text-[11px] font-bold uppercase',
                  voiceLang === code ? 'bg-primary text-primary-foreground' : 'text-ink-muted',
                )}
                aria-pressed={voiceLang === code}
                onClick={() => setVoiceLang(code)}
              >
                {code}
              </button>
            ))}
          </div>
          {showModeSelect ? (
            <select
              className="min-h-11 rounded-[12px] border border-border bg-surface px-2 py-1 text-[11px]"
              value={mode}
              aria-label={t('ai.providerMode')}
              data-testid="provider-mode-select"
              onChange={(e) => setMode(e.target.value as AiProviderMode)}
            >
              <option value="cascade">{t('ai.modeAuto')}</option>
              <option value="race">{t('ai.modeRace')}</option>
              <option value="consensus">{t('ai.modeConsensus')}</option>
            </select>
          ) : null}
          <span
            className={cn(
              'min-h-11 rounded-full border px-2.5 py-1 text-[11px] font-semibold',
              effectiveContextMode === 'case'
                ? 'border-primary bg-primary-soft text-primary'
                : 'border-border text-ink-muted',
            )}
            data-testid="assistant-context-chip"
            data-context={effectiveContextMode}
          >
            {contextChipLabel}
          </span>
          {!chwSimple && hasCaseAvailable && caseInput ? (
            <button
              type="button"
              className={cn(
                'min-h-11 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-transform duration-150 active:scale-[0.98]',
                useCase ? 'border-primary bg-primary-soft text-primary' : 'border-border text-ink-muted',
              )}
              onClick={() => setUseCase((v) => !v)}
              data-testid="context-case-toggle"
            >
              {useCase ? t('ai.contextUseCaseOn') : t('ai.contextUseCaseOff')}
            </button>
          ) : null}
          <IconButton
            label={t('ai.newConversation')}
            data-testid="avatar-new-conversation"
            onClick={() => {
              stop();
              stopAllSpeech();
              setMessages([]);
              setLastFail(null);
              setAsrRetry(false);
              setTtsHint(null);
              spokenCountRef.current = 0;
              conv.setIdle();
            }}
          >
            <Plus className="h-4 w-4" />
          </IconButton>
          {onClose && (!embedded || chwSimple) ? (
            <IconButton label={t('common.close')} onClick={onClose}>
              <X className="h-4 w-4" />
            </IconButton>
          ) : null}
        </div>
      </header>

      {!online ? (
        <p className="shrink-0 bg-warning-soft px-3 py-1 text-[11px] font-medium text-warning">{t('ai.localModeBanner')}</p>
      ) : null}

      <div
        ref={scroller}
        className="zm-scroll-pane min-h-0 flex-1 space-y-3 px-3 py-2"
        tabIndex={0}
        data-testid="chat-messages"
      >
        {!empty ? (
          <div
            className="sticky top-0 z-[1] flex items-center gap-2 border-b border-border/60 bg-surface/95 py-1.5 backdrop-blur-sm"
            data-testid="avatar-chat-rail"
          >
            <AssistantAvatar
              mood={avatarMood}
              mouthLevel={mouthLevel}
              size="sm"
              reduceMotion={Boolean(reduce)}
              label={t('ai.avatarLabel')}
              stateLabel={t(`ai.avatarState.${avatarMood}`)}
            />
            <p className="text-[11px] font-medium text-ink-muted">{t('ai.avatarDisclaimer')}</p>
          </div>
        ) : null}
        {empty ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-2 py-6 text-center" data-testid="chat-empty">
            <AssistantAvatar
              mood={avatarMood}
              mouthLevel={mouthLevel}
              size="lg"
              reduceMotion={Boolean(reduce)}
              label={t('ai.avatarLabel')}
              stateLabel={t(`ai.avatarState.${avatarMood}`)}
            />
            <p className="text-[16px] font-semibold">{emptyTitle}</p>
            <p className="max-w-xs text-xs text-ink-muted">{emptyHint}</p>
            <p className="max-w-xs text-[11px] font-medium text-ink-muted">{t('ai.avatarDisclaimer')}</p>
          </div>
        ) : (
          messages.map((m, idx) => {
            const isLastAi = m.role === 'assistant' && m.id === lastAssistantId;
            return (
              <div key={m.id} className="space-y-2">
                <motion.div
                  initial={reduce ? false : { opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{
                    delay: reduce ? 0 : Math.min(idx, 6) * 0.05,
                    duration: 0.22,
                    ease: [0.22, 1, 0.36, 1],
                  }}
                  className={cn(
                    'group max-w-[min(92%,70ch)] rounded-[18px] px-4 py-3 shadow-sm',
                    m.role === 'user'
                      ? 'ml-auto bg-primary text-primary-foreground'
                      : 'mr-auto border border-border/60 bg-surface text-left',
                  )}
                  title={m.latency_ms != null ? `${m.latency_ms}ms` : undefined}
                >
                  {m.role === 'assistant' ? (
                    m.streaming && !m.content ? (
                      <TypingDots />
                    ) : (
                      <div className="space-y-1">
                        <SafeMarkdown text={stripDisclosure(m.content || '')} />
                        <ChatBlocks
                          blocks={m.blocks}
                          onReadAloud={(text) => playAnswer(`${m.id}-block`, text)}
                        />
                      </div>
                    )
                  ) : (
                    <p className="text-[15px]">{m.content}</p>
                  )}
                  {m.role === 'assistant' && !m.streaming ? (
                    <div className="mt-2 space-y-1 border-t border-border/50 pt-1.5 text-[10px] text-ink-muted">
                      {m.corrected ? (
                        <p className="font-semibold text-warning">{t('ai.answerCorrected')}</p>
                      ) : null}
                      {m.failReason ? (
                        <div className="flex items-center gap-2">
                          <span className="text-warning">{t(failReasonI18nKey(m.failReason))}</span>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              void send(
                                messages.filter((x) => x.role === 'user').slice(-1)[0]?.content || '',
                              )
                            }
                          >
                            {t('ai.retry')}
                          </Button>
                        </div>
                      ) : null}
                      <div className="flex flex-wrap items-center gap-1 opacity-90 transition-opacity group-hover:opacity-100">
                        <IconButton
                          label={
                            speakingId === m.id ? t('ai.avatarStopSpeak') : t('ai.readAloudReply')
                          }
                          data-testid={`avatar-speak-${m.id}`}
                          onClick={() => playAnswer(m.id, m.content)}
                        >
                          {speakingId === m.id ? (
                            <Square className="h-3.5 w-3.5 text-danger" />
                          ) : (
                            <Volume2 className="h-3.5 w-3.5" />
                          )}
                        </IconButton>
                        {!chwSimple ? (
                          <>
                            <IconButton
                              label={t('ai.copySummary')}
                              onClick={() => void navigator.clipboard?.writeText(m.content)}
                            >
                              <Copy className="h-3.5 w-3.5" />
                            </IconButton>
                            <IconButton
                              label={t('ai.regenerate')}
                              onClick={() => {
                                const lastUser = [...messages].reverse().find((x) => x.role === 'user');
                                if (lastUser) void send(lastUser.content);
                              }}
                            >
                              <RefreshCw className="h-3.5 w-3.5" />
                            </IconButton>
                            <IconButton
                              label={t('ai.thumbsUp')}
                              onClick={() =>
                                setMessages((prev) =>
                                  prev.map((x) => (x.id === m.id ? { ...x, feedback: 'up' } : x)),
                                )
                              }
                            >
                              <ThumbsUp
                                className={cn('h-3.5 w-3.5', m.feedback === 'up' && 'text-success')}
                              />
                            </IconButton>
                            <IconButton
                              label={t('ai.thumbsDown')}
                              onClick={() =>
                                setMessages((prev) =>
                                  prev.map((x) => (x.id === m.id ? { ...x, feedback: 'down' } : x)),
                                )
                              }
                            >
                              <ThumbsDown
                                className={cn('h-3.5 w-3.5', m.feedback === 'down' && 'text-danger')}
                              />
                            </IconButton>
                          </>
                        ) : null}
                      </div>
                    </div>
                  ) : null}
                </motion.div>
                {isLastAi && m.followups?.length ? (
                  <div
                    className="flex flex-wrap gap-2 pl-1"
                    data-testid="chat-followup-chips"
                    role="list"
                  >
                    {m.followups.slice(0, 3).map((q) => (
                      <button
                        key={q}
                        type="button"
                        role="listitem"
                        disabled={busy}
                        className="min-h-10 rounded-full border border-border bg-surface px-3 py-1.5 text-[12px] font-medium hover:bg-primary-soft disabled:opacity-50"
                        onClick={() => void send(q)}
                      >
                        {q}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })
        )}
        {busy && messages.some((m) => m.streaming && m.content) ? (
          <p className="text-xs text-ink-muted">{t('ai.typing')}</p>
        ) : null}
      </div>

      {/* Suggested questions (user clicks; never auto-sent). Show for open case + empty FAB chat. */}
      {empty || (chwSimple && effectiveContextMode === 'case') ? chipRow : null}

      {lastFail && empty ? (
        <div className="mx-3 mb-1 flex items-center gap-2 rounded-[12px] bg-warning-soft px-2 py-1.5 text-xs text-warning">
          <span>{t(failReasonI18nKey(lastFail))}</span>
          <Button size="sm" variant="outline" onClick={() => setLastFail(null)}>
            {t('ai.retry')}
          </Button>
        </div>
      ) : null}

      <footer className="shrink-0 border-t border-border p-2.5" data-testid="chat-composer">
        {sttConfirm ? (
          <div className="mb-2 rounded-[12px] bg-info/10 px-3 py-2 text-sm" data-testid="stt-confirm">
            <p>{t('ai.sttConfirmHeard', { text: sttConfirm })}</p>
            <p className="mt-1 text-xs text-ink-muted">{t('ai.sttEditHint')}</p>
            <div className="mt-1 flex gap-2">
              <Button
                size="sm"
                onClick={() => {
                  setDraft(sttConfirm);
                  setSttConfirm(null);
                }}
              >
                {t('triage.yes')}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setDraft('');
                  setSttConfirm(null);
                }}
              >
                {t('triage.no')}
              </Button>
            </div>
          </div>
        ) : null}
        {ttsHint ? (
          <p className="mb-2 text-xs text-warning" data-testid="avatar-tts-hint" role="status">
            {ttsHint}
          </p>
        ) : null}
        {sttError || asrRetry ? (
          <div className="mb-2 flex flex-wrap items-center gap-2" data-testid="stt-error" role="status">
            <p className="text-xs text-warning">{sttError || asrUnclearPhrase(voiceLang)}</p>
            {asrRetry ? (
              <Button
                size="sm"
                variant="outline"
                data-testid="avatar-asr-retry"
                onClick={() => {
                  setAsrRetry(false);
                  setSttError(null);
                  const mic = document.querySelector<HTMLButtonElement>('[data-testid="chat-mic"]');
                  mic?.click();
                }}
              >
                {t('ai.avatarAsrRetry')}
              </Button>
            ) : null}
          </div>
        ) : null}
        {voiceStep !== 'idle' ? (
          <VoiceFlowStepper step={voiceStep} provider="stt→chat→tts" className="mb-2" />
        ) : null}
        <div className="flex items-end gap-2">
          <textarea
            className={cn(
              'min-h-11 flex-1 resize-none rounded-[14px] border border-border bg-surface px-3 py-2.5 text-[15px]',
              'transition-shadow duration-150',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2',
              'disabled:opacity-50',
            )}
            data-testid="chat-input"
            value={draft}
            rows={2}
            placeholder={t('ai.askPlaceholder')}
            aria-label={t('ai.assistantTitle')}
            disabled={busy}
            onChange={(e) => {
              setSttError(null);
              setDraft(e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void send(draft);
              }
            }}
          />
          <IconButton
            label={listening ? t('voice.tooltipMicStop') : t('voice.tooltipMic')}
            showLabel
            className={cn(
              'min-h-11 min-w-11 active:scale-[0.98]',
              listening && 'ring-2 ring-danger/50',
            )}
            disabled={busy && conv.turn !== 'speaking' && conv.turn !== 'greeting'}
            data-testid="chat-mic"
            onClick={() => {
              void (async () => {
                // Toggle stop: keep whatever was written live into the draft
                if (listening) {
                  liveSttRef.current?.stop();
                  liveSttRef.current = null;
                  if (mediaLoopStopRef.current) {
                    setVoiceStep('transcribe');
                    await mediaLoopStopRef.current();
                    mediaLoopStopRef.current = null;
                  }
                  setListening(false);
                  setVoiceStep('idle');
                  const heard = (liveAccumRef.current || draft).trim();
                  if (!heard) speakAsrUnclear();
                  else {
                    setSttConfirm(heard);
                    conv.setIdle();
                  }
                  return;
                }

                // Barge-in: stop TTS immediately and listen
                if (
                  conv.turn === 'speaking' ||
                  conv.turn === 'greeting' ||
                  speakingId ||
                  speakQueueRef.current?.busy
                ) {
                  stopAllSpeech();
                  conv.bargeInToListen();
                }

                setSttError(null);
                setSttConfirm(null);
                setAsrRetry(false);
                try {
                  voice.unlock();
                  const lang = voiceLang || (language || i18n.language || 'rw').slice(0, 2);
                  draftBeforeListenRef.current = draft.trim();
                  liveAccumRef.current = '';
                  setListening(true);
                  conv.setListening();
                  setVoiceStep('listen');

                  const writeLive = (spoken: string) => {
                    liveAccumRef.current = spoken;
                    const base = draftBeforeListenRef.current;
                    setDraft(base ? `${base} ${spoken}` : spoken);
                  };

                  // Prefer live browser STT so every word appears in the box as you speak
                  const live = startLiveStt({
                    language: lang,
                    onPartial: writeLive,
                    onError: (code) => {
                      if (code === 'not-allowed' || code === 'service-not-allowed') {
                        setSttError(t('ai.sttUnavailable'));
                      }
                    },
                  });
                  if (live) {
                    liveSttRef.current = live;
                    return;
                  }
                  // Fallback: rolling MediaRecorder → server STT every few seconds
                  if (typeof MediaRecorder !== 'undefined' && navigator.mediaDevices?.getUserMedia) {
                    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                    let stopped = false;
                    let doneResolve: (() => void) | null = null;
                    const donePromise = new Promise<void>((r) => {
                      doneResolve = r;
                    });
                    const pieces: string[] = [];
                    let activeRec: MediaRecorder | null = null;

                    const recordClip = (ms: number) =>
                      new Promise<Blob>((resolve) => {
                        const chunks: BlobPart[] = [];
                        const rec = new MediaRecorder(stream);
                        activeRec = rec;
                        rec.ondataavailable = (e) => {
                          if (e.data.size) chunks.push(e.data);
                        };
                        rec.onstop = () => {
                          activeRec = null;
                          resolve(new Blob(chunks, { type: 'audio/webm' }));
                        };
                        rec.start();
                        window.setTimeout(() => {
                          try {
                            if (rec.state !== 'inactive') rec.stop();
                          } catch {
                            activeRec = null;
                            resolve(new Blob());
                          }
                        }, ms);
                      });

                    mediaLoopStopRef.current = async () => {
                      stopped = true;
                      try {
                        if (activeRec && activeRec.state !== 'inactive') activeRec.stop();
                      } catch {
                        /* ignore */
                      }
                      await donePromise;
                    };

                    void (async () => {
                      try {
                        while (!stopped) {
                          const blob = await recordClip(2800);
                          if (blob.size < 400) {
                            if (stopped) break;
                            continue;
                          }
                          setVoiceStep('transcribe');
                          lastAudioRef.current = blob;
                          try {
                            const out = await api.voiceTranscribe(blob, lang);
                            if (out.ok && out.text?.trim()) {
                              pieces.push(out.text.trim());
                              writeLive(pieces.join(' '));
                              if (!stopped) setVoiceStep('listen');
                            }
                          } catch (err) {
                            const ae = err as ApiError;
                            if (ae.status === 401 || ae.code?.startsWith('token_')) {
                              setSttError(t('ai.sessionExpired'));
                              stopped = true;
                              break;
                            }
                          }
                        }
                      } catch {
                        if (!liveAccumRef.current) setSttError(t('ai.sttUnavailable'));
                      } finally {
                        stream.getTracks().forEach((tr) => tr.stop());
                        doneResolve?.();
                        mediaLoopStopRef.current = null;
                        setListening(false);
                        setVoiceStep('idle');
                        if (!liveAccumRef.current.trim()) speakAsrUnclear();
                        else {
                          setSttConfirm(liveAccumRef.current.trim());
                          conv.setIdle();
                        }
                      }
                    })();
                    return;
                  }

                  // Last resort: one-shot browser listen (no interim)
                  const heard = await voice.listen();
                  setVoiceStep('transcribe');
                  voice.confirmHeard();
                  const text = heard?.transcript?.trim();
                  if (text) {
                    writeLive(text);
                    setSttConfirm(text);
                    conv.setIdle();
                  } else speakAsrUnclear();
                  setListening(false);
                  setVoiceStep('idle');
                } catch {
                  voice.cancelHeard();
                  liveSttRef.current?.stop();
                  liveSttRef.current = null;
                  void mediaLoopStopRef.current?.();
                  mediaLoopStopRef.current = null;
                  speakAsrUnclear();
                  setListening(false);
                  setVoiceStep('idle');
                }
              })();
            }}
          >
            <Mic className={cn('h-4 w-4', listening && 'text-danger')} />
          </IconButton>
          {busy ? (
            <Button
              size="sm"
              variant="danger"
              className="min-h-11 min-w-11 active:scale-[0.98]"
              onClick={stop}
              aria-label={t('ai.stop')}
            >
              <Square className="h-4 w-4" />
            </Button>
          ) : (
            <Button
              size="sm"
              className="min-h-11 min-w-11 active:scale-[0.98]"
              disabled={!draft.trim()}
              onClick={() => void send(draft)}
              aria-label={t('ai.askSubmit')}
              data-testid="chat-send"
            >
              <Send className="h-4 w-4" />
            </Button>
          )}
        </div>
      </footer>
    </motion.div>
  );

  if (embedded) return panel;
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[70] flex items-end justify-center bg-ink/30 p-0 sm:items-stretch sm:justify-end sm:bg-ink/20 sm:p-0"
      data-testid="assistant-overlay"
    >
      <button type="button" className="absolute inset-0 sm:relative sm:flex-1" aria-label={t('common.close')} onClick={onClose} />
      <div className="relative flex max-h-[min(92vh,720px)] w-full max-w-lg flex-col rounded-t-[20px] shadow-lift sm:h-full sm:max-h-none sm:max-w-lg sm:rounded-none">
        {panel}
      </div>
    </div>
  );
}

export function AssistantFab({ onOpen }: { onOpen: () => void }) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      onClick={onOpen}
      className="fixed bottom-5 right-5 z-[55] inline-flex min-h-11 items-center gap-2 rounded-full bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground shadow-lift transition-transform duration-150 active:scale-[0.98]"
      aria-label={t('ai.assistantFab')}
      data-testid="assistant-fab"
    >
      <Bot className="h-4 w-4" aria-hidden />
      {t('ai.assistantFab')}
    </button>
  );
}

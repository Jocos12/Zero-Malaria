import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';
import type { TriageInput } from '../types';
import { TRIAGE_DIALOGUE, TRIAGE_DIALOGUE_ORDER, type DialogueNode } from './dialogue';
import { parseVoiceIntents, type VoiceIntents } from './intents';
import { reasonPhraseIdForRuleOrSign, type VoiceLang } from './phrases';
import { useVoice } from './VoiceContext';

export type ConversationMachineState =
  | 'idle'
  | 'greeting'
  | 'asking'
  | 'listening'
  | 'confirming'
  | 'responding';

type ListenResult = { transcript: string; intents: VoiceIntents };

type ConversationHandlers = {
  onNode?: (nodeId: string) => void;
  onPatch?: (patch: Partial<TriageInput>) => void;
  onComplete?: (form: TriageInput) => void;
};

type ConversationContextValue = {
  convState: ConversationMachineState;
  active: boolean;
  currentNodeId: string | null;
  currentNode: DialogueNode | null;
  caption: string;
  startGuidedTriage: (
    baseForm: TriageInput,
    handlers?: ConversationHandlers,
    options?: { mockTranscripts?: string[] },
  ) => Promise<void>;
  stopConversation: () => void;
  confirmAndAdvance: () => void;
  cancelListen: () => void;
};

const ConversationContext = createContext<ConversationContextValue | null>(null);

function voiceLangFromI18n(code: string): VoiceLang {
  return code.startsWith('rw') ? 'rw' : 'en';
}

function applyIntentsToSlot(node: DialogueNode, intents: VoiceIntents): Partial<TriageInput> | null {
  const slot = node.slot;
  if (slot === 'age_months' && intents.number !== undefined) {
    return { age_months: Math.max(0, Math.round(intents.number)) };
  }
  if (slot === 'temperature_c' && intents.number !== undefined) {
    return { temperature_c: intents.number };
  }
  if (slot === 'fever_days' && intents.number !== undefined) {
    return { fever_days: Math.max(0, Math.round(intents.number)) };
  }
  if (slot === 'sex') {
    if (intents.female || (intents.yes && !intents.no)) return { sex: 'female' };
    if (intents.male || intents.no) return { sex: 'male' };
  }
  const boolSlots = [
    'convulsions',
    'unable_to_drink',
    'vomiting_everything',
    'lethargy',
    'severe_breathing_difficulty',
  ] as const;
  if ((boolSlots as readonly string[]).includes(slot)) {
    if (intents.yes) return { [slot]: true } as Partial<TriageInput>;
    if (intents.no) return { [slot]: false } as Partial<TriageInput>;
  }
  if (slot === 'tdr_result') {
    if (intents.positive) return { tdr_result: 'positive' };
    if (intents.negative) return { tdr_result: 'negative' };
    if (intents.invalid) return { tdr_result: 'invalid' };
  }
  const triSlots = [
    'pale_palms_or_eyelids',
    'blood_in_stool',
    'dark_or_bloody_urine',
    'bleeding_nose_gums_skin_or_vomit_blood',
  ] as const;
  if ((triSlots as readonly string[]).includes(slot)) {
    if (intents.yes) return { [slot]: 'yes' } as Partial<TriageInput>;
    if (intents.no) return { [slot]: 'no' } as Partial<TriageInput>;
    if (intents.unknown) return { [slot]: 'unknown' } as Partial<TriageInput>;
  }
  if (slot === 'hemoglobin_g_dl' && intents.number !== undefined) {
    return { hemoglobin_g_dl: intents.number };
  }
  return null;
}

const DANGER_REASON: Partial<Record<string, string>> = {
  convulsions: 'convulsions',
  unable_to_drink: 'unable_to_drink',
  vomiting_everything: 'vomiting_everything',
  lethargy: 'lethargy',
  severe_breathing_difficulty: 'severe_breathing_difficulty',
};

export function ConversationProvider({ children }: { children: ReactNode }) {
  const { i18n } = useTranslation();
  const lang = voiceLangFromI18n(i18n.language);
  const voice = useVoice();

  const [convState, setConvState] = useState<ConversationMachineState>('idle');
  const [active, setActive] = useState(false);
  const [currentNodeId, setCurrentNodeId] = useState<string | null>(null);
  const [caption, setCaption] = useState('');

  const abortRef = useRef(false);
  const formRef = useRef<TriageInput | null>(null);
  const handlersRef = useRef<ConversationHandlers>({});
  const confirmWaitRef = useRef<((result: ListenResult | null) => void) | null>(null);
  const mockQueueRef = useRef<string[]>([]);
  const autoConfirmMockRef = useRef(false);

  const stopConversation = useCallback(() => {
    abortRef.current = true;
    confirmWaitRef.current?.(null);
    confirmWaitRef.current = null;
    mockQueueRef.current = [];
    voice.stop();
    voice.cancelHeard();
    setActive(false);
    setConvState('idle');
    setCurrentNodeId(null);
    setCaption('');
  }, [voice]);

  const waitForConfirm = useCallback((): Promise<ListenResult | null> => {
    return new Promise((resolve) => {
      confirmWaitRef.current = resolve;
    });
  }, []);

  const confirmAndAdvance = useCallback(() => {
    const heard = voice.confirmHeard();
    if (heard && confirmWaitRef.current) {
      confirmWaitRef.current(heard);
      confirmWaitRef.current = null;
    }
  }, [voice]);

  const cancelListen = useCallback(() => {
    voice.cancelHeard();
    if (confirmWaitRef.current) {
      confirmWaitRef.current(null);
      confirmWaitRef.current = null;
    }
  }, [voice]);

  const listenOnce = useCallback(async (): Promise<ListenResult | null> => {
    const mock = mockQueueRef.current.shift();
    if (mock !== undefined) {
      const intents = parseVoiceIntents(mock, lang);
      setConvState('confirming');
      setCaption(mock);
      return { transcript: mock, intents };
    }
    setConvState('listening');
    const raw = await voice.listen();
    if (!raw) return null;
    setCaption(raw.transcript);
    setConvState('confirming');
    if (autoConfirmMockRef.current) {
      return voice.confirmHeard() ?? raw;
    }
    const confirmed = await waitForConfirm();
    return confirmed;
  }, [lang, voice, waitForConfirm]);

  const startGuidedTriage = useCallback(
    async (
      baseForm: TriageInput,
      handlers?: ConversationHandlers,
      options?: { mockTranscripts?: string[] },
    ) => {
      stopConversation();
      abortRef.current = false;
      handlersRef.current = handlers || {};
      formRef.current = { ...baseForm };
      mockQueueRef.current = [...(options?.mockTranscripts || [])];
      autoConfirmMockRef.current = Boolean(options?.mockTranscripts?.length);
      setActive(true);
      voice.unlock();

      const rw = { language: 'rw' as const };
      setConvState('greeting');
      await voice.play(['guided_greeting'], rw);
      if (abortRef.current) return;

      for (const nodeId of TRIAGE_DIALOGUE_ORDER) {
        if (abortRef.current) break;
        const node = TRIAGE_DIALOGUE[nodeId];
        setCurrentNodeId(nodeId);
        handlersRef.current.onNode?.(nodeId);
        setConvState('asking');

        await voice.play([node.phraseId], rw);
        if (abortRef.current) break;

        let heard = await listenOnce();
        if (!heard || abortRef.current) break;

        let patch = applyIntentsToSlot(node, heard.intents);
        if (!patch && node.repromptPhraseId) {
          await voice.play([node.repromptPhraseId], rw);
          heard = await listenOnce();
          if (!heard || abortRef.current) break;
          patch = applyIntentsToSlot(node, heard.intents);
        }

        if (patch && formRef.current) {
          formRef.current = { ...formRef.current, ...patch };
          handlersRef.current.onPatch?.(patch);
        }

        if (node.danger && heard.intents.yes) {
          const signId = DANGER_REASON[node.slot];
          const reasonId = signId ? reasonPhraseIdForRuleOrSign(signId) : null;
          if (reasonId) {
            setConvState('responding');
            await voice.play([reasonId, 'confirm_danger_sign'], rw);
            setConvState('listening');
            const confirmDanger = await listenOnce();
            if (!confirmDanger?.intents.yes || abortRef.current) {
              await voice.play([node.repromptPhraseId || node.phraseId], rw);
              continue;
            }
          }
        }
      }

      if (!abortRef.current && formRef.current) {
        setConvState('responding');
        handlersRef.current.onComplete?.(formRef.current);
      }
      setActive(false);
      setConvState('idle');
      setCurrentNodeId(null);
      setCaption('');
    },
    [listenOnce, stopConversation, voice],
  );

  const currentNode = currentNodeId ? TRIAGE_DIALOGUE[currentNodeId] : null;

  const value = useMemo(
    (): ConversationContextValue => ({
      convState,
      active,
      currentNodeId,
      currentNode,
      caption,
      startGuidedTriage,
      stopConversation,
      confirmAndAdvance,
      cancelListen,
    }),
    [
      convState,
      active,
      currentNodeId,
      currentNode,
      caption,
      startGuidedTriage,
      stopConversation,
      confirmAndAdvance,
      cancelListen,
    ],
  );

  return <ConversationContext.Provider value={value}>{children}</ConversationContext.Provider>;
}

export function useConversation(): ConversationContextValue {
  const ctx = useContext(ConversationContext);
  if (!ctx) throw new Error('useConversation must be used within ConversationProvider');
  return ctx;
}

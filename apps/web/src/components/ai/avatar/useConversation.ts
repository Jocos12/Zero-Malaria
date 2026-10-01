import { useCallback, useMemo, useRef, useState } from 'react';
import { fillerPhrases } from './phrases';
import type { SpeakLang } from './safeSpeak';

export type TurnState = 'idle' | 'greeting' | 'listening' | 'thinking' | 'speaking';

export type ChatTurn = { role: 'user' | 'assistant'; content: string };

const GREETED_KEY = 'zm_avatar_greeted_session';

export function hasGreetedThisSession(): boolean {
  try {
    return sessionStorage.getItem(GREETED_KEY) === '1';
  } catch {
    return false;
  }
}

export function markGreetedThisSession(): void {
  try {
    sessionStorage.setItem(GREETED_KEY, '1');
  } catch {
    /* ignore */
  }
}

export function clearGreetedThisSession(): void {
  try {
    sessionStorage.removeItem(GREETED_KEY);
  } catch {
    /* ignore */
  }
}

/** Keep the last N chat messages for AI memory (default 6). */
export function memorySlice(messages: ChatTurn[], limit = 6): ChatTurn[] {
  return messages.filter((m) => m.content.trim()).slice(-limit);
}

/**
 * Turn-taking + filler rotation for the talking avatar.
 * Wire: Record → listening; send → thinking (+ filler); TTS → speaking; done → idle.
 */
export function useConversation(lang: SpeakLang) {
  const [turn, setTurn] = useState<TurnState>('idle');
  const lastFillerRef = useRef(-1);

  const setIdle = useCallback(() => setTurn('idle'), []);
  const setListening = useCallback(() => setTurn('listening'), []);
  const setThinking = useCallback(() => setTurn('thinking'), []);
  const setSpeaking = useCallback(() => setTurn('speaking'), []);
  const setGreeting = useCallback(() => setTurn('greeting'), []);

  /** Pick a filler that is not the same as last time. */
  const nextFiller = useCallback((): string => {
    const list = fillerPhrases(lang);
    if (!list.length) return '';
    let idx = Math.floor(Math.random() * list.length);
    if (list.length > 1 && idx === lastFillerRef.current) {
      idx = (idx + 1) % list.length;
    }
    lastFillerRef.current = idx;
    return list[idx] || '';
  }, [lang]);

  /** Barge-in: stop speaking path and enter listening. */
  const bargeInToListen = useCallback(() => {
    setTurn('listening');
  }, []);

  const mood = useMemo(() => {
    if (turn === 'greeting') return 'greeting' as const;
    if (turn === 'listening') return 'listening' as const;
    if (turn === 'thinking') return 'thinking' as const;
    if (turn === 'speaking') return 'speaking' as const;
    return 'idle' as const;
  }, [turn]);

  return {
    turn,
    mood,
    setIdle,
    setListening,
    setThinking,
    setSpeaking,
    setGreeting,
    nextFiller,
    bargeInToListen,
  };
}

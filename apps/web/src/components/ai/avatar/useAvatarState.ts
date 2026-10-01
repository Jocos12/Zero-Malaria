import { useMemo } from 'react';
import type { AvatarMood } from './AssistantAvatar';
import type { TurnState } from './useConversation';

export type { AvatarMood };

export type AvatarStateInput = {
  turn?: TurnState;
  listening?: boolean;
  thinking?: boolean;
  speaking?: boolean;
  greeting?: boolean;
};

/** Prefer explicit turn from useConversation; else map boolean flags. */
export function useAvatarState(input: AvatarStateInput): AvatarMood {
  return useMemo(() => {
    if (input.turn) {
      if (input.turn === 'greeting') return 'greeting';
      if (input.turn === 'listening') return 'listening';
      if (input.turn === 'thinking') return 'thinking';
      if (input.turn === 'speaking') return 'speaking';
      return 'idle';
    }
    if (input.greeting) return 'greeting';
    if (input.listening) return 'listening';
    if (input.speaking) return 'speaking';
    if (input.thinking) return 'thinking';
    return 'idle';
  }, [input.turn, input.listening, input.speaking, input.thinking, input.greeting]);
}

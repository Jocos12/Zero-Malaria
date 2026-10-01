import { describe, expect, it } from 'vitest';
import { memorySlice } from './useConversation';
import { splitSentences } from './speakQueue';

describe('splitSentences', () => {
  it('splits on punctuation', () => {
    expect(splitSentences('Hello. World! OK?')).toEqual(['Hello.', 'World!', 'OK?']);
  });
});

describe('memorySlice', () => {
  it('keeps last 6 messages', () => {
    const msgs = Array.from({ length: 10 }, (_, i) => ({
      role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
      content: `m${i}`,
    }));
    expect(memorySlice(msgs, 6)).toHaveLength(6);
    expect(memorySlice(msgs, 6)[0]?.content).toBe('m4');
  });
});

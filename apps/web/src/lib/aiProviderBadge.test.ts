import { describe, expect, it } from 'vitest';
import { providerReplyBadge } from './aiProviderBadge';

describe('providerReplyBadge', () => {
  it('maps gemini/groq/local to short badges', () => {
    expect(providerReplyBadge('gemini')).toBe('AI G');
    expect(providerReplyBadge('groq')).toBe('AI Q');
    expect(providerReplyBadge('local')).toBe('AI L');
    expect(providerReplyBadge(undefined)).toBe('AI L');
  });
});

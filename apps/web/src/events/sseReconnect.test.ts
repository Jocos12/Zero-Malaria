import { describe, expect, it } from 'vitest';
import {
  buildEventsUrl,
  nextBackoffMs,
  shouldFallBackToPollOnly,
  SSE_MAX_RECONNECT_ATTEMPTS,
} from './sseReconnect';

describe('sseReconnect', () => {
  it('uses exponential backoff capped at 30s', () => {
    expect(nextBackoffMs(0)).toBe(1000);
    expect(nextBackoffMs(1)).toBe(2000);
    expect(nextBackoffMs(2)).toBe(4000);
    expect(nextBackoffMs(10)).toBe(30000);
  });

  it('falls back to poll-only after max attempts', () => {
    expect(shouldFallBackToPollOnly(SSE_MAX_RECONNECT_ATTEMPTS - 1)).toBe(false);
    expect(shouldFallBackToPollOnly(SSE_MAX_RECONNECT_ATTEMPTS)).toBe(true);
  });

  it('builds events URL with ticket (never access_token)', () => {
    const url = buildEventsUrl('/api', 'opaque-ticket', '2026-10-01T00:00:00.000Z');
    expect(url).toContain('/api/events?');
    expect(url).toContain('ticket=opaque-ticket');
    expect(url).toContain('since=');
    expect(url).not.toContain('access_token');
  });
});

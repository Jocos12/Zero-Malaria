/** Pure helpers for SSE reconnect / poll fallback (unit-tested). */

export type SseTransportMode = 'sse' | 'poll';

export function nextBackoffMs(attempt: number, baseMs = 1000, maxMs = 30000): number {
  const n = Math.max(0, Math.floor(attempt));
  return Math.min(maxMs, baseMs * 2 ** n);
}

/** After this many failed SSE opens, stay on poll-only until next auth cycle. */
export const SSE_MAX_RECONNECT_ATTEMPTS = 6;

export function shouldFallBackToPollOnly(attempt: number): boolean {
  return attempt >= SSE_MAX_RECONNECT_ATTEMPTS;
}

export function buildEventsUrl(
  apiBase: string,
  ticket: string,
  since: string,
): string {
  const base = apiBase.replace(/\/$/, '');
  const q = new URLSearchParams({ ticket, since });
  return `${base}/events?${q.toString()}`;
}

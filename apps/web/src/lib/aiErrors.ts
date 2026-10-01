/** Map network / provider failures to precise UI reasons (never vague "offline" alone). */

export type AiFailReason =
  | 'offline'
  | 'provider_not_configured'
  | 'quota_exhausted'
  | 'timeout'
  | 'route_not_found'
  | 'unauthorized'
  | 'unavailable';

export function classifyAiError(err: unknown, online: boolean): AiFailReason {
  if (!online) return 'offline';
  const status = (err as { status?: number })?.status;
  const msg = String((err as Error)?.message || err || '').toLowerCase();
  if (status === 404 || msg.includes('404') || msg.includes('not found')) return 'route_not_found';
  if (status === 401 || msg.includes('unauthorized')) return 'unauthorized';
  if (msg.includes('429') || msg.includes('quota') || msg.includes('resource_exhausted')) {
    return 'quota_exhausted';
  }
  if (msg.includes('timeout') || msg.includes('aborted')) return 'timeout';
  if (msg.includes('not configured') || msg.includes('provider_not_configured') || msg.includes('no key')) {
    return 'provider_not_configured';
  }
  if (msg.includes('failed to fetch') || msg.includes('networkerror')) return 'offline';
  return 'unavailable';
}

export function failReasonI18nKey(reason: AiFailReason): string {
  const map: Record<AiFailReason, string> = {
    offline: 'ai.scoreUnavailableOffline',
    provider_not_configured: 'ai.scoreUnavailableNoKey',
    quota_exhausted: 'ai.scoreUnavailableQuota',
    timeout: 'ai.scoreUnavailableTimeout',
    route_not_found: 'ai.scoreUnavailableRoute',
    unauthorized: 'ai.scoreUnavailableAuth',
    unavailable: 'ai.summaryUnavailable',
  };
  return map[reason];
}

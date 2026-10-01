/** Short CHW-facing badge for which cloud/local answered (never full vendor names). */

export function providerReplyBadge(provider?: string | null): 'AI G' | 'AI Q' | 'AI L' {
  const p = String(provider || 'local').toLowerCase();
  if (p.includes('gemini') || p === 'g') return 'AI G';
  if (p.includes('groq') || p === 'q') return 'AI Q';
  return 'AI L';
}

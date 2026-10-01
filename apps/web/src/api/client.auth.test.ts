import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SESSION_KEY, __clientTest, api } from './client';

describe('API client — FormData auth + refresh-on-401', () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    sessionStorage.clear();
  });

  it('sends Authorization on voiceTranscribe FormData without Content-Type', async () => {
    sessionStorage.setItem(
      SESSION_KEY,
      JSON.stringify({ access_token: 'access-1', refresh_token: 'refresh-1' }),
    );
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      expect(headers.get('Authorization')).toBe('Bearer access-1');
      expect(headers.get('Content-Type')).toBeNull();
      expect(init?.body).toBeInstanceOf(FormData);
      expect(init?.credentials).toBe('include');
      return new Response(
        JSON.stringify({ ok: true, text: 'Muraho', confidence: 0.9 }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const out = await api.voiceTranscribe(new Blob(['x'.repeat(64)], { type: 'audio/webm' }), 'rw');
    expect(out.text).toBe('Muraho');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('on 401 refreshes once and retries with a fresh FormData', async () => {
    sessionStorage.setItem(
      SESSION_KEY,
      JSON.stringify({ access_token: 'expired', refresh_token: 'refresh-1' }),
    );
    const formBodies: FormData[] = [];
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.includes('/auth/refresh')) {
        return new Response(
          JSON.stringify({
            access_token: 'access-2',
            refresh_token: 'refresh-2',
            token_type: 'bearer',
            user: { id: 'u1', username: 'chw.demo', role: 'CHW', display_name: 'CHW', phone: '', district: '', facility_id: '', village: '', chw_code: '', active: true },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (u.includes('/voice/transcribe')) {
        const headers = new Headers(init?.headers);
        if (init?.body instanceof FormData) formBodies.push(init.body);
        if (headers.get('Authorization') === 'Bearer expired') {
          return new Response(JSON.stringify({ detail: { code: 'token_expired', message: 'Token expired' } }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        expect(headers.get('Authorization')).toBe('Bearer access-2');
        expect(headers.get('Content-Type')).toBeNull();
        return new Response(
          JSON.stringify({ ok: true, text: 'retry-ok', confidence: 0.8 }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response('not found', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const out = await api.voiceTranscribe(new Blob(['y'.repeat(64)], { type: 'audio/webm' }), 'rw');
    expect(out.text).toBe('retry-ok');
    // 1 transcribe 401 + 1 refresh + 1 transcribe retry
    expect(fetchMock.mock.calls.filter((c) => String(c[0]).includes('/voice/transcribe'))).toHaveLength(2);
    expect(fetchMock.mock.calls.filter((c) => String(c[0]).includes('/auth/refresh'))).toHaveLength(1);
    expect(formBodies).toHaveLength(2);
    expect(formBodies[0]).not.toBe(formBodies[1]);
    expect(__clientTest.readStore().access_token).toBe('access-2');
  });
});

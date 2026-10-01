const API_BASE = import.meta.env.VITE_API_BASE || '/api';
export const SESSION_KEY = 'zm_session';

export type PasswordPromptStatus = 'pending' | 'changed' | 'dismissed';

export type AuthUser = {
  id: string;
  username: string;
  email?: string;
  display_name: string;
  role: 'CHW' | 'HEALTH_CENTER' | 'RBC_ADMIN' | 'SUPER_ADMIN';
  phone: string;
  district: string;
  facility_id: string;
  village: string;
  village_id?: string;
  chw_code: string;
  active: boolean;
  permissions?: string[];
  /** Legacy; only true under enforce+pending. Prefer password_prompt_status. */
  must_change_password?: boolean;
  password_prompt_status?: PasswordPromptStatus;
  deleted_at?: string | null;
  version?: number;
};

export type LoginResponse = {
  access_token: string;
  refresh_token?: string;
  token_type: string;
  user: AuthUser;
  must_change_password?: boolean;
  password_prompt_status?: PasswordPromptStatus;
  password_change_policy?: 'prompt' | 'enforce';
};

export type PageResult<T> = {
  items: T[];
  total: number;
  page: number;
  page_size: number;
};

export type LiveWireEvent = {
  type: string;
  payload: Record<string, unknown>;
  at: string;
};

export type ReferralMessage = {
  id: string;
  referral_id: string;
  sender_id?: string | null;
  sender_role: string;
  body: string;
  created_at: string;
  read_at?: string | null;
};

export type ApiError = Error & { status?: number; code?: string; body?: unknown };

export type ActivityCountMetrics = {
  patients_seen: number;
  patients_treated: number;
  rdt_done: number;
  rdt_positive: number;
  referred: number;
};

export type ActivityCountRow = ActivityCountMetrics & {
  id: string;
  client_uuid: string;
  chw_id: string;
  facility_id: string;
  date: string;
  source: 'auto' | 'manual';
  note?: string | null;
  version: number;
  created_by?: string | null;
  created_at: string;
  updated_at: string;
  confirmed_by?: string | null;
  confirmed_at?: string | null;
};

export type ActivityCountSummary = {
  synthetic: boolean;
  date_from: string;
  date_to: string;
  auto_total: ActivityCountMetrics;
  manual_total: ActivityCountMetrics;
  combined: ActivityCountMetrics;
  note: string;
};

export type ActivityCountUpsertBody = ActivityCountMetrics & {
  client_uuid: string;
  date: string;
  note?: string | null;
  version?: number | null;
};

type ActivityCountQuery = Record<string, string | number | boolean | undefined>;

function activityCountsQuery(params?: ActivityCountQuery): string {
  const q = new URLSearchParams();
  Object.entries(params || {}).forEach(([k, v]) => {
    if (v !== undefined && v !== '') q.set(k, String(v));
  });
  const s = q.toString();
  return s ? `?${s}` : '';
}

export function activityCountsList(params?: ActivityCountQuery) {
  return request<ActivityCountRow[]>(`/activity-counts${activityCountsQuery(params)}`);
}

export function activityCountsSummary(params?: ActivityCountQuery & { period?: 'today' | 'week' }) {
  return request<ActivityCountSummary>(`/activity-counts/summary${activityCountsQuery(params)}`);
}

export function activityCountsUpsert(body: ActivityCountUpsertBody) {
  return request<ActivityCountRow>('/activity-counts', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function activityCountsConfirm(id: string) {
  return request<ActivityCountRow>(`/activity-counts/${encodeURIComponent(id)}/confirm`, {
    method: 'PATCH',
    body: '{}',
  });
}

export async function activityCountsExport(params?: ActivityCountQuery): Promise<Blob> {
  const res = await authFetch(`/activity-counts/export.csv${activityCountsQuery(params)}`);
  if (!res.ok) {
    const text = await res.text();
    const err = new Error(text || res.statusText) as ApiError;
    err.status = res.status;
    throw err;
  }
  return res.blob();
}

type SessionStore = {
  access_token?: string;
  refresh_token?: string;
  user?: AuthUser;
  offline_until?: number;
};

let refreshInFlight: Promise<boolean> | null = null;

export function clearAuthSession(redirect = true) {
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch {
    /* ignore */
  }
  if (
    redirect &&
    typeof window !== 'undefined' &&
    !window.location.pathname.startsWith('/login')
  ) {
    window.location.assign('/login');
  }
}

function readStore(): SessionStore {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as SessionStore;
  } catch {
    return {};
  }
}

function patchStore(patch: Partial<SessionStore>) {
  try {
    const cur = readStore();
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ ...cur, ...patch }));
  } catch {
    /* ignore */
  }
}

function authHeaders(): Record<string, string> {
  const token = readStore().access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function parseAuthCode(detail: unknown): string | undefined {
  if (typeof detail === 'string') {
    if (detail.includes('token_missing') || detail === 'Not authenticated') return 'token_missing';
    if (detail.includes('token_expired') || detail.toLowerCase().includes('expired')) return 'token_expired';
    if (detail.includes('token_invalid') || detail.toLowerCase().includes('invalid')) return 'token_invalid';
    return undefined;
  }
  if (detail && typeof detail === 'object' && 'code' in (detail as object)) {
    return String((detail as { code?: string }).code || '');
  }
  return undefined;
}

async function tryRefreshSession(): Promise<boolean> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    try {
      const store = readStore();
      const res = await fetch(`${API_BASE}/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ refresh_token: store.refresh_token || undefined }),
      });
      if (!res.ok) return false;
      const data = (await res.json()) as LoginResponse;
      if (!data.access_token) return false;
      patchStore({
        access_token: data.access_token,
        refresh_token: data.refresh_token || store.refresh_token,
        user: data.user || store.user,
      });
      return true;
    } catch {
      return false;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

type RequestOptions = RequestInit & {
  /** Skip Content-Type so the browser sets multipart boundary for FormData */
  formData?: boolean;
  _retried?: boolean;
  /** Rebuild body after 401 refresh (consumed FormData/Blob cannot be resent) */
  rebuildBody?: () => BodyInit | null | undefined;
};

async function request<T>(path: string, init?: RequestOptions): Promise<T> {
  const isForm = Boolean(init?.formData || init?.body instanceof FormData);
  const headers: Record<string, string> = { ...authHeaders() };
  if (!isForm) headers['Content-Type'] = 'application/json';
  const extra = init?.headers;
  if (extra && typeof extra === 'object' && !(extra instanceof Headers)) {
    Object.assign(headers, extra as Record<string, string>);
  }
  // Never force Content-Type on FormData
  if (isForm) delete headers['Content-Type'];

  const { formData: _fd, _retried, rebuildBody, ...fetchInit } = init || {};
  void _fd;

  const res = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    ...fetchInit,
    headers,
  });

  if (res.status === 401) {
    let code = 'token_invalid';
    try {
      const payload = (await res.clone().json()) as { detail?: unknown; code?: string };
      code = payload.code || parseAuthCode(payload.detail) || code;
    } catch {
      /* ignore */
    }
    if (!_retried && !path.startsWith('/auth/login') && path !== '/auth/refresh') {
      const ok = await tryRefreshSession();
      if (ok) {
        const retry: RequestOptions = { ...init, _retried: true };
        if (rebuildBody) retry.body = rebuildBody();
        return request<T>(path, retry);
      }
    }
    clearAuthSession(true);
    const err = new Error(code) as ApiError;
    err.status = 401;
    err.code = code;
    throw err;
  }

  if (!res.ok) {
    const text = await res.text();
    let body: unknown = text;
    try {
      body = text ? JSON.parse(text) : undefined;
    } catch {
      /* keep text */
    }
    const err = new Error(text || res.statusText) as ApiError;
    err.status = res.status;
    err.body = body;
    if (body && typeof body === 'object' && body !== null && 'code' in body) {
      err.code = String((body as { code?: string }).code || '');
    }
    throw err;
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

/**
 * Authenticated fetch that returns the Response (for SSE).
 * Same refresh-on-401 as `request` (once), then throws ApiError.
 */
export async function authFetch(path: string, init?: RequestOptions): Promise<Response> {
  const isForm = Boolean(init?.formData || init?.body instanceof FormData);
  const headers: Record<string, string> = { ...authHeaders() };
  if (!isForm) headers['Content-Type'] = 'application/json';
  const extra = init?.headers;
  if (extra && typeof extra === 'object' && !(extra instanceof Headers)) {
    Object.assign(headers, extra as Record<string, string>);
  }
  if (isForm) delete headers['Content-Type'];
  const { formData: _fd, _retried, rebuildBody, ...fetchInit } = init || {};
  void _fd;
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    ...fetchInit,
    headers,
  });
  if (res.status === 401) {
    let code = 'token_invalid';
    try {
      const payload = (await res.clone().json()) as { detail?: unknown; code?: string };
      code = payload.code || parseAuthCode(payload.detail) || code;
    } catch {
      /* ignore */
    }
    if (!_retried && !path.startsWith('/auth/login') && path !== '/auth/refresh') {
      const ok = await tryRefreshSession();
      if (ok) {
        const retry: RequestOptions = { ...init, _retried: true };
        if (rebuildBody) retry.body = rebuildBody();
        return authFetch(path, retry);
      }
    }
    clearAuthSession(true);
    const err = new Error(code) as ApiError;
    err.status = 401;
    err.code = code;
    throw err;
  }
  return res;
}

/** @internal unit-test helpers */
export const __clientTest = { tryRefreshSession, authHeaders, request, patchStore, readStore, authFetch };

export const api = {
  health: () => request<{ status: string }>('/health'),
  login: async (username: string, password: string) => {
    const data = await request<LoginResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
    patchStore({
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      user: data.user,
    });
    return data;
  },
  demoLogin: async (role: AuthUser['role']) => {
    const data = await request<LoginResponse>('/auth/demo-login', {
      method: 'POST',
      body: JSON.stringify({ role }),
    });
    patchStore({
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      user: data.user,
    });
    return data;
  },
  me: () => request<AuthUser>('/auth/me'),
  logout: () => request<{ ok: boolean }>('/auth/logout', { method: 'POST' }),
  listUsers: (params?: Record<string, string | number | undefined>) => {
    const q = new URLSearchParams();
    Object.entries(params || {}).forEach(([k, v]) => {
      if (v !== undefined && v !== '') q.set(k, String(v));
    });
    const suffix = q.toString() ? `?${q}` : '';
    return request<PageResult<AuthUser>>(`/users${suffix}`);
  },
  createUser: (body: {
    username: string;
    password: string;
    display_name: string;
    role?: string;
    email?: string;
    phone?: string;
    district?: string;
    facility_id?: string;
    village?: string;
    village_id?: string;
    chw_code?: string;
  }) => request<AuthUser>('/users', { method: 'POST', body: JSON.stringify(body) }),
  patchUser: (
    userId: string,
    body: Partial<{
      active: boolean;
      role: string;
      facility_id: string;
      village: string;
      village_id: string;
      district: string;
      phone: string;
      email: string;
      display_name: string;
      version: number;
    }>,
  ) => request<AuthUser>(`/users/${userId}`, { method: 'PATCH', body: JSON.stringify(body) }),
  softDeleteUser: (userId: string) =>
    request<AuthUser>(`/users/${userId}`, { method: 'DELETE' }),
  restoreUser: (userId: string) =>
    request<AuthUser>(`/users/${userId}/restore`, { method: 'POST' }),
  resetPassword: (userId: string) =>
    request<{ temporary_password: string }>(`/users/${userId}/reset-password`, { method: 'POST' }),
  changePassword: (current_password: string, new_password: string) =>
    request<{ ok: boolean; password_prompt_status?: PasswordPromptStatus }>('/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ current_password, new_password }),
    }),
  dismissPasswordPrompt: () =>
    request<{ ok: boolean; password_prompt_status?: PasswordPromptStatus }>(
      '/auth/password-prompt/dismiss',
      { method: 'POST' },
    ),
  rbacMatrix: () =>
    request<{ roles: string[]; permissions: string[]; granted: Record<string, string[]> }>('/rbac/matrix'),
  rbacToggle: (role_code: string, permission_code: string, allowed: boolean) =>
    request('/rbac/matrix/toggle', {
      method: 'POST',
      body: JSON.stringify({ role_code, permission_code, allowed }),
    }),
  listAuditLogs: (params?: Record<string, string | number | undefined>) => {
    const q = new URLSearchParams();
    Object.entries(params || {}).forEach(([k, v]) => {
      if (v !== undefined && v !== '') q.set(k, String(v));
    });
    const suffix = q.toString() ? `?${q}` : '';
    return request<PageResult<Record<string, unknown>>>(`/admin/audit-logs${suffix}`);
  },
  listAdminFacilities: (params?: Record<string, string | number | undefined>) => {
    const q = new URLSearchParams();
    Object.entries(params || {}).forEach(([k, v]) => {
      if (v !== undefined && v !== '') q.set(k, String(v));
    });
    const suffix = q.toString() ? `?${q}` : '';
    return request<PageResult<Record<string, unknown>>>(`/admin/facilities${suffix}`);
  },
  listAdminStock: (params?: Record<string, string | number | undefined>) => {
    const q = new URLSearchParams();
    Object.entries(params || {}).forEach(([k, v]) => {
      if (v !== undefined && v !== '') q.set(k, String(v));
    });
    const suffix = q.toString() ? `?${q}` : '';
    return request<PageResult<Record<string, unknown>>>(`/admin/stock${suffix}`);
  },
  getConfig: () => request<{ key: string; value: string; label: string }[]>('/admin/config'),
  patchConfig: (key: string, value: string) =>
    request<{ key: string; value: string; label: string }>(`/admin/config/${key}`, {
      method: 'PATCH',
      body: JSON.stringify({ value }),
    }),

  triage: (body: unknown) => request('/triage', { method: 'POST', body: JSON.stringify(body) }),
  referrals: (params?: { facility_id?: string; chw_id?: string }) => {
    const q = new URLSearchParams();
    if (params?.facility_id) q.set('facility_id', params.facility_id);
    if (params?.chw_id) q.set('chw_id', params.chw_id);
    const suffix = q.toString() ? `?${q}` : '';
    return request<any[]>(`/referrals${suffix}`);
  },
  scopedReferrals: () => request<any[]>('/referrals/scoped'),
  createReferral: (body: unknown) =>
    request('/referrals', { method: 'POST', body: JSON.stringify(body) }),
  patchStatus: (id: string, status: string) =>
    request(`/referrals/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }),
  createEventTicket: () =>
    request<{ ticket: string; expires_in: number }>('/events/ticket', {
      method: 'POST',
      body: '{}',
    }),
  pollEvents: (since?: string) => {
    const q = since ? `?since=${encodeURIComponent(since)}` : '';
    return request<{ events: LiveWireEvent[]; server_at: string }>(`/events/poll${q}`);
  },
  listReferralMessages: (referralId: string) =>
    request<ReferralMessage[]>(`/referrals/${referralId}/messages`),
  postReferralMessage: (referralId: string, body: string) =>
    request<ReferralMessage>(`/referrals/${referralId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ body }),
    }),
  alerts: (chw_id?: string) =>
    request<any[]>(`/alerts${chw_id ? `?chw_id=${encodeURIComponent(chw_id)}` : ''}`),
  kpis: (district?: string) =>
    request<any>(`/analytics/kpis${district ? `?district=${encodeURIComponent(district)}` : ''}`),
  surge: (params?: Record<string, string>) => {
    const q = new URLSearchParams(params || {});
    return request<any>(`/analytics/surge?${q}`);
  },
  stock: (params?: Record<string, string>) => {
    const q = new URLSearchParams(params || {});
    return request<any>(`/analytics/stock?${q}`);
  },
  funnel: (district?: string) =>
    request<any>(`/analytics/funnel${district ? `?district=${encodeURIComponent(district)}` : ''}`),
  hotspots: (params?: Record<string, string>) => {
    const q = new URLSearchParams(params || {});
    const suffix = q.toString() ? `?${q}` : '';
    return request<any>(`/analytics/hotspots${suffix}`);
  },
  facilities: () => request<any[]>('/facilities'),
  sync: (items: unknown[]) =>
    request('/sync', { method: 'POST', body: JSON.stringify({ items }) }),
  extract: (text: string, language: string) =>
    request('/nlp/extract', { method: 'POST', body: JSON.stringify({ text, language }) }),
  aiExtract: (body: {
    free_text: string;
    language?: string;
    age_months?: number;
    sex?: string;
    temperature_c?: number;
    fever_days?: number;
    tdr_result?: string;
  }) => request<Record<string, unknown>>('/ai/extract-symptoms', { method: 'POST', body: JSON.stringify(body) }),
  aiExplain: (body: {
    decision: string;
    reasons?: string[];
    triggered_rules?: string[];
    language?: string;
  }) => request<Record<string, unknown>>('/ai/explain', { method: 'POST', body: JSON.stringify(body) }),
  aiAdvisory: (body: {
    answers: Record<string, unknown>;
    rules_decision: string;
    public_decision?: string;
    reasons?: string[];
    triggered_rules?: string[];
    reason_details?: unknown[];
    missing_info?: string[];
    protocol_reference?: string;
    language?: string;
  }) => request<Record<string, unknown>>('/ai/advisory', { method: 'POST', body: JSON.stringify(body) }),
  aiAdvisoryFeedback: (body: {
    rules_decision: string;
    chw_followed: boolean;
    suggested_escalation?: boolean;
  }) =>
    request<Record<string, unknown>>('/ai/advisory-feedback', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  aiVisitSummary: (body: {
    answers: Record<string, unknown>;
    decision: string;
    rules_decision?: string;
    reasons?: string[];
    triggered_rules?: string[];
    shap_factors?: string[];
    severe_risk?: number | null;
    ml_escalated?: boolean;
    language?: string;
  }) => request<Record<string, unknown>>('/ai/visit-summary', { method: 'POST', body: JSON.stringify(body) }),
  aiAsk: (body: { question: string; case: Record<string, unknown>; language?: string }) =>
    request<Record<string, unknown>>('/ai/ask', { method: 'POST', body: JSON.stringify(body) }),
  aiConsult: (body: {
    case: Record<string, unknown>;
    language?: string;
    follow_up?: string;
    session_id?: string;
  }) => request<Record<string, unknown>>('/ai/consult', { method: 'POST', body: JSON.stringify(body) }),
  aiActivity: () => request<Record<string, unknown>>('/ai/activity'),
  aiInsights: (body: { aggregated_stats: Record<string, unknown>; language?: string }) =>
    request<Record<string, unknown>>('/ai/insights', { method: 'POST', body: JSON.stringify(body) }),
  assistantChat: (body: { message: string; language?: string; decision?: string }) =>
    request<Record<string, unknown>>('/assistant/chat', { method: 'POST', body: JSON.stringify(body) }),
  voiceSpeak: (body: { phrase_id?: string; language?: string; text: string }) =>
    request<Record<string, unknown>>('/voice/speak', { method: 'POST', body: JSON.stringify(body) }),
  voiceCapabilities: (language = 'rw') =>
    request<Record<string, unknown>>(`/voice/capabilities?language=${encodeURIComponent(language)}`),
  voiceTranscribe: (blob: Blob, language = 'rw') => {
    const build = () => {
      const fd = new FormData();
      fd.append('file', blob, 'clip.webm');
      fd.append('language', language);
      return fd;
    };
    return request<{
      ok?: boolean;
      text?: string;
      confidence?: number;
      provider?: string;
      language?: string;
      error?: string;
      code?: string;
    }>('/voice/transcribe', {
      method: 'POST',
      formData: true,
      body: build(),
      rebuildBody: build,
    });
  },
  aiTrace: (body: Record<string, unknown>) =>
    request<Record<string, unknown>>('/ai/trace', { method: 'POST', body: JSON.stringify(body) }),
  aiCompare: (body: Record<string, unknown>) =>
    request<Record<string, unknown>>('/ai/compare', { method: 'POST', body: JSON.stringify(body) }),
  aiRecommendation: (body: Record<string, unknown>) =>
    request<Record<string, unknown>>('/ai/recommendation', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  aiAnswerInsight: (body: Record<string, unknown>) =>
    request<Record<string, unknown>>('/ai/answer-insight', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  aiHealth: () =>
    request<{ ok?: boolean; providers?: Record<string, { reachable?: boolean; configured?: boolean }> }>(
      '/ai/health',
    ),
  aiStatus: () =>
    request<{
      ok?: boolean;
      providers?: Record<
        string,
        { provider?: string; status?: string; latency_ms?: number; reason?: string; model?: string }
      >;
      chat_timeout_seconds?: number;
    }>('/ai/status'),
  aiHealthTest: () => request<Record<string, unknown>>('/ai/health/test', { method: 'POST', body: '{}' }),

  activityCountsList,
  activityCountsSummary,
  activityCountsUpsert,
  activityCountsConfirm,
  activityCountsExport,
};

/**
 * Result opens as modal over triage; /m/result route is gone as a page.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import i18n from '../../i18n';

vi.mock('../../api/client', () => ({
  api: {
    extract: () => new Promise(() => {}),
    triage: () => new Promise(() => {}),
    voiceSpeak: () => new Promise(() => {}),
    health: () => new Promise(() => {}),
    aiAnswerInsight: () => new Promise(() => {}),
    aiAdvisory: () => new Promise(() => {}),
    aiVisitSummary: async () => ({
      ok: true,
      data: {
        summary:
          'Urgent referral locked by danger signs. ML risk is high from convulsions and vomiting. Arrange transport now. Tell the family to go immediately.',
      },
      provider_used: 'local',
      latency_ms: 12,
    }),
    aiAsk: () => new Promise(() => {}),
    aiConsult: () => new Promise(() => {}),
    aiTrace: async () => ({
      ok: true,
      data: {
        pipeline: [
          { id: 'inputs', status: 'done' },
          { id: 'rules', status: 'done', locked: true, decision_label: 'Treat at home' },
          { id: 'ml', status: 'done' },
          { id: 'ai_language', status: 'done', provider: 'local' },
          { id: 'chw_confirm', status: 'pending' },
        ],
        rules: {
          decision: 'treat_at_home',
          decision_label: 'Treat at home',
          final_decision: 'treat_at_home',
          final_decision_label: 'Treat at home',
          triggered_rule_ids: ['default_treat_at_home'],
          contributions: [
            {
              question: 'convulsions',
              answer: 'no',
              effect: 'neutral',
              triggered: false,
            },
          ],
        },
        ml: {
          urgency_risk: { score: 0.12, meaning: 'Severity risk' },
          referral_followup_risk: { score: 0.2, meaning: 'Facility risk' },
          top_factors: [{ label: 'fever_days' }],
          synthetic: true,
          can_only_escalate: true,
        },
        ai_added: [{ type: 'family_message', text: 'Watch for danger signs', provider: 'local' }],
        guardrail: { blocked_items: [] },
        consistency_checks: [],
        what_if: [],
        impact: {
          urgency_changed: 'never_locked',
          wording_items: 1,
          checks_run: 0,
          time_added_ms: 8,
          provider: 'local',
          fallback_chain: '',
        },
        language: 'en',
      },
    }),
    aiCompare: async () => ({
      ok: true,
      providers: [
        { provider: 'local', status: 'ok', answer: 'Locked by protocol.', latency_ms: 2, agreement: 'same_decision' },
        { provider: 'gemini', status: 'unavailable', reason: 'no_key', answer: null, latency_ms: 0 },
        { provider: 'groq', status: 'unavailable', reason: 'no_key', answer: null, latency_ms: 0 },
      ],
      summary: { agree_count: 1, locked_decision_label: 'Treat at home' },
    }),
    aiRecommendation: async () => ({
      ok: true,
      data: {
        title: 'Treat / monitor locally',
        decision: 'treat_at_home',
        why: ['No danger signs'],
        what_to_do_now: ['Advise home care'],
        what_to_tell_family: 'Watch for danger signs',
        when_to_come_back: 'Return if fever persists',
        referral: { needed: false, urgency: 'none' },
        protocol_meta: { validated: false, source_file: 'rules/clinical_config.yaml' },
      },
    }),
    aiChat: async () => ({ ok: true, reply: 'Refer to nurse.', provider_used: 'local' }),
    aiStatus: async () => ({
      ok: true,
      providers: {
        gemini: { status: 'ok' },
        groq: { status: 'ok' },
        local: { status: 'ok' },
      },
    }),
    aiHealth: async () => ({
      ok: true,
      providers: {
        gemini: { configured: false, quota_state: 'ok' },
        groq: { configured: false, quota_state: 'ok' },
        local: { configured: true, quota_state: 'ok' },
      },
    }),
  },
  SESSION_KEY: 'zm_session',
  clearAuthSession: () => {},
}));

vi.mock('../../db', () => ({
  saveTriageDraft: async () => {},
  loadTriageDraft: async () => undefined,
  clearTriageDraft: async () => {},
  db: {},
}));

vi.mock('../../auth/AuthContext', () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
  useAuth: () => ({
    user: { id: 'u1', username: 'chw', role: 'chw', permissions: [], must_change_password: false },
    token: 'test',
    loading: false,
    demoModeEnabled: true,
    passwordChangePolicy: 'prompt' as const,
    login: async () => ({} as never),
    logout: async () => {},
    switchRole: async () => ({} as never),
    refreshMe: async () => {},
    setPasswordPromptStatus: () => {},
  }),
  isDemoModeEnabled: () => true,
}));

vi.mock('../shells', () => ({
  WebShell: ({ children }: { children: React.ReactNode }) => <div data-testid="web-shell">{children}</div>,
  ChwShell: ({ children }: { children: React.ReactNode }) => <div data-testid="chw-shell">{children}</div>,
}));

import { TriagePage } from '../../pages/TriagePage';
import { ThemeProvider } from '../../theme/ThemeContext';
import { VoiceProvider } from '../../voice/VoiceContext';
import { ConversationProvider } from '../../voice/ConversationContext';
import { ToastProvider } from '../ToastProvider';
describe('Result modal routing', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    await i18n.changeLanguage('en');
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: (query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }),
    });
    // @ts-expect-error act env
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    sessionStorage.setItem(
      'zm_last_triage',
      JSON.stringify({
        input: {
          age_months: 24,
          sex: 'female',
          temperature_c: 38,
          fever_days: 2,
          convulsions: false,
          unable_to_drink: false,
          vomiting_everything: false,
          lethargy: false,
          severe_breathing_difficulty: false,
          tdr_result: 'negative',
        },
        result: {
          decision: 'treat_at_home',
          rules_decision: 'treat_at_home',
          public_decision: 'treat_locally',
          reasons: ['No danger signs'],
          triggered_rules: ['default_treat_at_home'],
          confidence: 0.8,
          ml_escalated: false,
          severe_risk: 0.12,
          shap_factors: ['fever_days'],
          missing_info: [],
        },
        answer_insights: [
          {
            field: 'age',
            text: 'Age 24 mo — used for community-care age bands.',
            source: 'rule',
            contribution: 'low',
          },
        ],
      }),
    );
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    act(() => root?.unmount());
    container.remove();
    sessionStorage.clear();
  });

  it('opens result modal over triage shell when result=open', async () => {
    root = createRoot(container);
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={['/app/triage?result=open']}>
          <ThemeProvider>
            <ToastProvider>
              <VoiceProvider>
                <ConversationProvider>
                  <Routes>
                    <Route path="/app/triage" element={<TriagePage />} />
                  </Routes>
                </ConversationProvider>
              </VoiceProvider>
            </ToastProvider>
          </ThemeProvider>
        </MemoryRouter>,
      );
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    // Modal portals to document.body
    expect(document.querySelector('[data-testid="result-modal"]')).toBeTruthy();
    expect(document.querySelector('[data-testid="modal-sticky-header"]')).toBeTruthy();
    expect(document.querySelector('[data-testid="modal-sticky-footer"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="web-shell"]')).toBeTruthy();
    expect(document.querySelector('[data-testid="open-web-banner"]')).toBeFalsy();
  });

  it('toggles rules vs rules_ai sections (ai-off vs impact strip)', async () => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: (query: string) => ({
        matches:
          query.includes('min-width: 1024px') || query.includes('prefers-reduced-motion'),
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }),
    });
    root = createRoot(container);
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={['/app/triage?result=open']}>
          <ThemeProvider>
            <ToastProvider>
              <VoiceProvider>
                <ConversationProvider>
                  <Routes>
                    <Route path="/app/triage" element={<TriagePage />} />
                  </Routes>
                </ConversationProvider>
              </VoiceProvider>
            </ToastProvider>
          </ThemeProvider>
        </MemoryRouter>,
      );
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 80));
    });
    expect(document.querySelector('[data-testid="result-modal"]')).toBeTruthy();
    // default mode is rules_ai
    expect(document.querySelector('[data-testid="ai-impact-strip"]')).toBeTruthy();

    const rulesBtn = document.querySelector('[data-testid="ai-mode-rules"]') as HTMLButtonElement | null;
    expect(rulesBtn).toBeTruthy();
    await act(async () => {
      rulesBtn?.click();
      await new Promise((r) => setTimeout(r, 80));
    });
    expect(document.querySelector('[data-testid="ai-off-state"]')).toBeTruthy();
    expect(document.querySelector('[data-testid="ai-impact-strip"]')).toBeFalsy();

    const aiBtn = document.querySelector('[data-testid="ai-mode-rules-ai"]') as HTMLButtonElement | null;
    await act(async () => {
      aiBtn?.click();
      await new Promise((r) => setTimeout(r, 80));
    });
    expect(document.querySelector('[data-testid="ai-impact-strip"]')).toBeTruthy();
  });
});

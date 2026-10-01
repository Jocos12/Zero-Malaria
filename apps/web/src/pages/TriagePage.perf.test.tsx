/**
 * Step 2 (sex) choices must paint quickly even if speechSynthesis never resolves
 * and network fetch hangs.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import i18n from '../i18n';

vi.mock('../api/client', () => ({
  api: {
    extract: () => new Promise(() => {}),
    triage: () => new Promise(() => {}),
    voiceSpeak: () => new Promise(() => {}),
    health: () => new Promise(() => {}),
  },
  SESSION_KEY: 'zm_session',
  clearAuthSession: () => {},
}));

vi.mock('../db', () => ({
  saveTriageDraft: () => new Promise(() => {}),
  loadTriageDraft: async () => undefined,
  clearTriageDraft: async () => {},
  db: {},
}));

vi.mock('../auth/AuthContext', () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
  useAuth: () => ({
    user: {
      id: 'u1',
      username: 'chw',
      role: 'chw',
      permissions: [],
      must_change_password: false,
      password_prompt_status: 'changed',
    },
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

vi.mock('../components/shells', () => ({
  WebShell: ({ children }: { children: React.ReactNode }) => <div data-testid="shell">{children}</div>,
  ChwShell: ({ children }: { children: React.ReactNode }) => <div data-testid="shell">{children}</div>,
}));

vi.mock('../voice/speak', async () => {
  const actual = await vi.importActual<typeof import('../voice/speak')>('../voice/speak');
  return {
    ...actual,
    speakSequence: () => new Promise(() => {}),
    speakPhrase: () => new Promise(() => {}),
    probePreRecordedAudio: async () => false,
    unlockAudio: () => {},
    stopSpeaking: () => {},
    isMuted: () => false,
    setMuted: () => {},
    getSpeed: () => 1 as const,
    setSpeed: () => {},
    isAudioUnlocked: () => true,
    getLanguageCapabilities: () => ({
      ttsBrowser: false,
      sttBrowser: false,
      audioPack: false,
      cloudReachable: false,
    }),
  };
});

import { TriagePage } from './TriagePage';
import { ThemeProvider } from '../theme/ThemeContext';
import { VoiceProvider } from '../voice/VoiceContext';
import { ConversationProvider } from '../voice/ConversationContext';
import { ToastProvider } from '../components/ToastProvider';

function mountTriage(container: HTMLElement): Root {
  const root = createRoot(container);
  act(() => {
    root.render(
      <MemoryRouter initialEntries={['/app/triage']}>
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
  return root;
}

describe('TriagePage step performance', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    await i18n.changeLanguage('rw');
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
    Object.defineProperty(window, 'speechSynthesis', {
      configurable: true,
      value: {
        getVoices: () => [],
        speak: () => {},
        cancel: () => {},
        pending: false,
        speaking: false,
        paused: false,
        addEventListener: () => {},
        removeEventListener: () => {},
      },
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise(() => {})),
    );
    // Ensure React act() warnings don't fail the suite under jsdom.
    // @ts-expect-error vitest jsdom flag
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    container.remove();
    vi.unstubAllGlobals();
  });

  it('shows sex choices in under 200ms after advancing from age', async () => {
    root = mountTriage(container);

    // Wait for async draft load + first paint
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });

    const ageStep = container.querySelector('[data-testid="triage-step-age"]');
    expect(ageStep, `age step should render; html=${container.innerHTML.slice(0, 400)}`).toBeTruthy();

    const ageChip = Array.from(container.querySelectorAll('button')).find((b) =>
      /6/.test(b.textContent || ''),
    );
    expect(ageChip, 'age chip containing 6 should be present').toBeTruthy();

    const t0 = performance.now();
    await act(async () => {
      ageChip!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      // flush setTimeout(0) advance used by selectChoice
      await new Promise((r) => setTimeout(r, 0));
      await new Promise((r) => setTimeout(r, 0));
    });

    const sexStep = container.querySelector('[data-testid="triage-step-sex"]') as HTMLElement | null;
    const elapsed = performance.now() - t0;
    expect(sexStep, 'sex step should render').toBeTruthy();
    expect((sexStep!.textContent || '').length).toBeGreaterThan(5);
    // Gore / Gabo (or en Female/Male) must be visible
    const text = sexStep!.textContent || '';
    expect(/Gore|Gabo|Female|Male|gore|gabo/i.test(text)).toBe(true);
    expect(elapsed).toBeLessThan(200);
  });
});

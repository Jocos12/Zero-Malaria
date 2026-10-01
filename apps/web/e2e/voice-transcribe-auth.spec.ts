import { expect, test, type Page, type ConsoleMessage } from '@playwright/test';

const API = process.env.ZM_API || 'http://127.0.0.1:8000';
const PASSWORD = process.env.ZM_DEMO_PASSWORD || 'demo1234';

const TRIAGE = {
  input: {
    age_months: 24,
    sex: 'male',
    temperature_c: 39,
    fever_days: 2,
    convulsions: true,
    unable_to_drink: false,
    vomiting_everything: false,
    lethargy: false,
    severe_breathing_difficulty: false,
    tdr_result: 'positive',
  },
  result: {
    decision: 'urgent_refer',
    rules_decision: 'urgent_refer',
    public_decision: 'urgent_referral',
    reasons: ['Convulsions reported'],
    triggered_rules: ['convulsions'],
    confidence: 0.9,
    ml_escalated: false,
    severe_risk: 0.72,
    shap_factors: ['convulsions', 'fever_days', 'temperature_c'],
    missing_info: [],
  },
  answer_insights: [],
};

async function loginAndSeed(page: Page, sessionExtra: Record<string, unknown> = {}) {
  const login = await page.request.post(`${API}/auth/login`, {
    data: { username: 'chw.demo', password: PASSWORD },
  });
  expect(login.ok()).toBeTruthy();
  const data = await login.json();
  await page.addInitScript(
    ({ session, triage }) => {
      sessionStorage.setItem('zm_session', JSON.stringify(session));
      sessionStorage.setItem('zm_last_triage', JSON.stringify(triage));
      localStorage.setItem('zm_lang', 'rw');
      localStorage.setItem('zm_preferred_view', 'web');
      void navigator.serviceWorker?.getRegistrations().then((regs) => {
        regs.forEach((r) => void r.unregister());
      });
    },
    {
      session: {
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        user: data.user,
        offline_until: Date.now() + 86400000,
        ...sessionExtra,
      },
      triage: TRIAGE,
    },
  );
}

async function installFakeMedia(page: Page) {
  await page.addInitScript(() => {
    class FakeMediaRecorder {
      state = 'inactive';
      ondataavailable: ((e: { data: Blob }) => void) | null = null;
      onerror: (() => void) | null = null;
      onstop: (() => void) | null = null;
      start() {
        this.state = 'recording';
        queueMicrotask(() => {
          this.ondataavailable?.({
            data: new Blob([new Uint8Array(128).fill(1)], { type: 'audio/webm' }),
          });
        });
      }
      stop() {
        this.state = 'inactive';
        this.onstop?.();
      }
    }
    // @ts-expect-error test shim
    window.MediaRecorder = FakeMediaRecorder;
    navigator.mediaDevices.getUserMedia = async () =>
      ({
        getTracks: () => [{ stop: () => undefined }],
      }) as unknown as MediaStream;
  });
}

async function openResultChat(page: Page) {
  await page.goto('/app/triage?result=open');
  await expect(page.getByTestId('result-modal')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('chat-mic')).toBeVisible({ timeout: 15_000 });
}

test.describe('Voice transcribe auth', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('CHW record uses auth; mocked STT fills draft; no 401 console', async ({ page }) => {
    const unauthorized: string[] = [];
    page.on('console', (msg: ConsoleMessage) => {
      const text = msg.text();
      if (/401|Unauthorized/i.test(text)) unauthorized.push(text);
    });
    page.on('response', (res) => {
      if (res.url().includes('/voice/transcribe') && res.status() === 401) {
        unauthorized.push(`HTTP 401 ${res.url()}`);
      }
    });

    await loginAndSeed(page);
    await installFakeMedia(page);

    await page.route('**/api/voice/transcribe', async (route) => {
      const headers = route.request().headers();
      expect(headers.authorization || headers.Authorization).toMatch(/^Bearer\s+/);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          text: 'Nakwira iki umuryango?',
          confidence: 0.9,
          provider: 'mock',
          language: 'rw',
        }),
      });
    });

    await openResultChat(page);
    await page.getByTestId('chat-mic').click();
    await expect(page.getByTestId('chat-input')).toHaveValue(/Nakwira iki umuryango/i, {
      timeout: 12_000,
    });
    expect(unauthorized).toEqual([]);
  });

  test('expired token refreshes silently then succeeds', async ({ page }) => {
    await loginAndSeed(page);
    await installFakeMedia(page);

    let transcribeHits = 0;
    await page.route('**/api/voice/transcribe', async (route) => {
      transcribeHits += 1;
      if (transcribeHits === 1) {
        await route.fulfill({
          status: 401,
          contentType: 'application/json',
          body: JSON.stringify({ detail: { code: 'token_expired', message: 'Token expired' } }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          text: 'Murakoze',
          confidence: 0.95,
          provider: 'mock',
          language: 'rw',
        }),
      });
    });

    await page.route('**/api/auth/refresh', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          access_token: 'fresh-access',
          refresh_token: 'fresh-refresh',
          token_type: 'bearer',
          user: {
            id: 'u1',
            username: 'chw.demo',
            role: 'CHW',
            display_name: 'CHW Demo',
            phone: '',
            district: '',
            facility_id: '',
            village: '',
            chw_code: 'CHW1',
            active: true,
          },
        }),
      });
    });

    await openResultChat(page);
    await page.getByTestId('chat-mic').click();
    await expect(page.getByTestId('chat-input')).toHaveValue(/Murakoze/i, {
      timeout: 12_000,
    });
    expect(transcribeHits).toBe(2);
    await expect(page).not.toHaveURL(/\/login/);
  });
});

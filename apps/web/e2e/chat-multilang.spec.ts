import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const shotDir = join(__dirname, '../../../docs/screenshots');
mkdirSync(shotDir, { recursive: true });

const API = process.env.ZM_API || 'http://127.0.0.1:8000';
const PASSWORD = process.env.ZM_DEMO_PASSWORD || 'demo1234';

const TRIAGE = {
  input: {
    age_months: 12,
    sex: 'female',
    temperature_c: 38.5,
    fever_days: 2,
    convulsions: true,
    unable_to_drink: false,
    vomiting_everything: false,
    lethargy: false,
    severe_breathing_difficulty: false,
    tdr_result: 'invalid',
  },
  result: {
    decision: 'urgent_refer',
    rules_decision: 'urgent_refer',
    public_decision: 'urgent_referral',
    reasons: ['Convulsions reported'],
    triggered_rules: ['convulsions'],
    confidence: 0.9,
    ml_escalated: false,
    severe_risk: 0.7,
    referral_noncompletion_risk: 0.4,
    shap_factors: ['convulsions'],
    missing_info: [],
    reason_details: [],
    protocol_reference: 'demo',
    human_confirmation_required: true,
    disclaimer: 'Decision support tool.',
  },
};

async function loginAndSeed(page: Page) {
  const res = await page.request.post(`${API}/auth/login`, {
    data: { username: 'chw.demo', password: PASSWORD },
  });
  const login = res.ok()
    ? res
    : await page.request.post(`${API}/auth/login`, {
        data: { username: 'super.admin', password: PASSWORD },
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
        user: data.user,
        offline_until: Date.now() + 86400000,
      },
      triage: TRIAGE,
    },
  );
}

async function openAssistant(page: Page) {
  await page.goto('/app/triage?result=open');
  await expect(page.getByTestId('result-modal')).toBeVisible({ timeout: 20_000 });
  const mobileTab = page.getByTestId('tab-assistant-mobile');
  if (await mobileTab.isVisible().catch(() => false)) {
    await mobileTab.click();
  }
  await expect(page.getByTestId('assistant-chat')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('chat-input')).toBeVisible({ timeout: 10_000 });
}

async function ask(page: Page, text: string) {
  const input = page.getByTestId('chat-input');
  const msgs = page.getByTestId('chat-messages');
  const before = (await msgs.innerText()).length;
  await input.fill(text);
  await page.getByTestId('chat-send').click();
  await expect
    .poll(async () => (await msgs.innerText()).length, { timeout: 45_000 })
    .toBeGreaterThan(before + text.length);
}

test.describe('Multilingual structured chat + Analysis dossier', () => {
  test('French question → French answer + patient card', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await loginAndSeed(page);
    await openAssistant(page);
    await ask(page, 'le patient souffre de quoi ?');
    const msgs = page.getByTestId('chat-messages');
    const text = await msgs.innerText();
    expect(text.toLowerCase()).toMatch(/signes|rapport|tdr|protocole|diagnostic|centre/);
    expect(text.toLowerCase()).not.toMatch(/child:\s*12 months/);
    expect(text.toLowerCase()).not.toMatch(/decision:\s*urgent referral/);
    await expect(page.getByTestId('chat-patient-card')).toBeVisible({ timeout: 10_000 });
    await page.screenshot({ path: join(shotDir, 'chat-fr-souffre-1440-light.png'), fullPage: false });
  });

  test('English and Kinyarwanda follow question language', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await loginAndSeed(page);
    await page.addInitScript(() => {
      localStorage.setItem('zm_theme', 'dark');
      document.documentElement.classList.add('dark');
    });
    await openAssistant(page);
    await ask(page, 'Why is it urgent?');
    let text = (await page.getByTestId('chat-messages').innerText()).toLowerCase();
    expect(text).toMatch(/urgent|protocol|danger|referral|convulsion/);
    expect(text).not.toMatch(/signes rapport/);

    await ask(page, 'Kuki cyihutirwa?');
    text = (await page.getByTestId('chat-messages').innerText()).toLowerCase();
    expect(text).toMatch(/amategeko|ohereza|ibimenyetso|cyihutirwa|kohereza/);
    await page.screenshot({ path: join(shotDir, 'chat-rw-why-390-dark.png'), fullPage: false });
  });

  test('Analysis Rules only vs Rules + AI sections differ', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await loginAndSeed(page);
    await page.goto('/app/triage?result=open');
    await expect(page.getByTestId('result-modal')).toBeVisible({ timeout: 20_000 });

    await page.getByTestId('ai-mode-rules').click();
    await page.getByTestId('tab-analysis').click();
    await expect(page.getByTestId('analysis-grouped')).toHaveAttribute('data-analysis-mode', 'rules');
    await expect(page.getByTestId('decision-path')).toBeVisible();
    await expect(page.getByTestId('answers-table')).toBeVisible();
    await expect(page.getByTestId('analysis-rules-only-banner')).toBeVisible();
    await expect(page.getByTestId('ml-gauges')).toHaveCount(0);
    const analysisRules = await page.getByTestId('analysis-grouped').innerText();
    expect(analysisRules).not.toMatch(/\u2014|\u2013/);

    await page.getByTestId('ai-mode-rules-ai').click();
    await expect(page.getByTestId('analysis-grouped')).toHaveAttribute('data-analysis-mode', 'rules_ai');
    await expect(page.getByTestId('ml-gauges')).toBeVisible();
    await expect(page.getByTestId('analysis-rules-ai-banner')).toBeVisible();
    await page.screenshot({ path: join(shotDir, 'analysis-rules-ai-dossier-1440.png'), fullPage: false });
  });
});

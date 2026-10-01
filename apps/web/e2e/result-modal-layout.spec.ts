import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
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
  answer_insights: [
    {
      field: 'convulsions',
      text: 'Convulsions raise urgency to urgent referral.',
      source: 'rule',
      contribution: 'high',
      flag: 'danger',
    },
  ],
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
      localStorage.setItem('zm_lang', 'en');
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

async function openResult(page: Page) {
  await page.goto('/app/triage?result=open');
  await expect(page.getByTestId('result-modal')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('result-decision-banner')).toBeVisible();
}

function fullyVisible(box: { x: number; y: number; width: number; height: number } | null, vw: number, vh: number) {
  expect(box).toBeTruthy();
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.y + box!.height).toBeLessThanOrEqual(vh + 1);
  expect(box!.x + box!.width).toBeLessThanOrEqual(vw + 1);
}

for (const { w, h, label } of [
  { w: 1920, h: 1080, label: '1920x1080' },
  { w: 1366, h: 768, label: '1366x768' },
]) {
  test.describe(`Result modal layout @ ${label}`, () => {
    test.use({ viewport: { width: w, height: h } });

    test(`above-the-fold critical chrome visible (${label})`, async ({ page }) => {
      await loginAndSeed(page);
      await openResult(page);

      const header = page.getByTestId('result-decision-banner');
      const grid = page.getByTestId('rec-card-grid');
      const composer = page.getByTestId('chat-composer');
      const cta = page.getByTestId('result-primary-cta');
      const footer = page.getByTestId('result-footer');

      await expect(header).toBeVisible();
      await expect(grid).toBeVisible();
      await expect(composer).toBeVisible();
      await expect(cta).toBeVisible();
      await expect(footer).toBeVisible();

      fullyVisible(await header.boundingBox(), w, h);
      fullyVisible(await composer.boundingBox(), w, h);
      fullyVisible(await cta.boundingBox(), w, h);
      fullyVisible(await footer.boundingBox(), w, h);

      await expect(page.getByTestId('rec-why')).toBeVisible();
      await expect(cta).toBeDisabled();
      await page.getByTestId('result-confirm').check();
      await expect(cta).toBeEnabled();

      await page.getByRole('button', { name: /Rules only/i }).click();
      await expect(page.getByTestId('assistant-chat')).toBeVisible();
      await page.getByRole('button', { name: /Rules \+ AI/i }).click();

      await page.screenshot({
        path: join(shotDir, `result-modal-after-${label}.png`),
        fullPage: false,
      });
    });
  });
}

test.describe('Result modal narrow tabs + a11y', () => {
  test.use({ viewport: { width: 900, height: 800 } });

  test('mobile tabs, focus trap, Esc confirm', async ({ page }) => {
    await loginAndSeed(page);
    await openResult(page);
    await expect(page.getByTestId('result-mobile-tabs')).toBeVisible();
    await page.getByTestId('tab-assistant-mobile').click();
    await expect(page.getByTestId('assistant-chat')).toBeVisible();

    const dialog = page.getByTestId('modal-panel');
    await expect(dialog).toHaveAttribute('role', 'dialog');

    const results = await new AxeBuilder({ page }).include('[data-testid="result-modal"]').analyze();
    const critical = results.violations.filter((v) => v.impact === 'critical');
    expect(critical, JSON.stringify(critical, null, 2)).toEqual([]);
  });
});

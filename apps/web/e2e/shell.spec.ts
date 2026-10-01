import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const shotDir = join(__dirname, '../../../docs/screenshots');
mkdirSync(shotDir, { recursive: true });

const API = process.env.ZM_API || 'http://127.0.0.1:8000';
const PASSWORD = process.env.ZM_DEMO_PASSWORD || 'demo1234';

async function loginViaApi(page: Page, username: string) {
  const res = await page.request.post(`${API}/auth/login`, {
    data: { username, password: PASSWORD },
  });
  expect(res.ok()).toBeTruthy();
  const data = await res.json();
  await page.addInitScript(
    ({ session }) => {
      sessionStorage.setItem('zm_session', JSON.stringify(session));
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
    },
  );
}

test.describe('Web shell @ 1440x900', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('CHW lands on /app/home with sidebar, no phone frame', async ({ page }) => {
    await loginViaApi(page, 'chw.demo');
    await page.goto('/');
    await page.waitForURL(/\/app\/home/, { timeout: 15000 });
    await expect(page.getByTestId('web-sidebar')).toBeVisible();
    await expect(page.getByTestId('mobile-tab-bar')).toHaveCount(0);
    await expect(page.getByTestId('open-web-banner')).toHaveCount(0);
    await page.screenshot({
      path: join(shotDir, 'shell-web-chw-home-1440.png'),
      fullPage: true,
    });
  });
});

test.describe('Web shell @ 390x844', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('CHW /app/home uses drawer, no bottom tab bar', async ({ page }) => {
    await loginViaApi(page, 'chw.demo');
    await page.goto('/app/home');
    await expect(page.getByTestId('mobile-tab-bar')).toHaveCount(0);
    await page.screenshot({
      path: join(shotDir, 'shell-web-chw-home-390.png'),
      fullPage: true,
    });
  });

  test('/m/home redirects to /app/home', async ({ page }) => {
    await loginViaApi(page, 'chw.demo');
    await page.goto('/m/home');
    await page.waitForURL(/\/app\/home/, { timeout: 15000 });
  });
});

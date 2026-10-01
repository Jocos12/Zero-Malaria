import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.ZM_BASE || 'http://127.0.0.1:4173';

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  use: {
    baseURL,
    trace: 'on-first-retry',
    // PWA Workbox otherwise serves stale bundles (breaks e2e after rebuild)
    serviceWorkers: 'block',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // Prefer system Chrome when sandbox TLS blocks playwright browser download
        channel: process.env.PW_CHANNEL || 'chrome',
      },
    },
  ],
});


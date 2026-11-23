import { defineConfig, devices } from '@playwright/test';

const slowBrowserHost = process.env.EXERCISE_TRACKER_E2E_SLOW === '1';

export default defineConfig({
  testDir: './e2e',
  timeout: slowBrowserHost ? 180_000 : 30_000,
  expect: {
    timeout: slowBrowserHost ? 20_000 : 5_000,
  },
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  failOnFlakyTests: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? 'github' : 'list',
  globalSetup: './e2e/global-setup.ts',
  use: {
    baseURL: 'http://127.0.0.1:4174',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'desktop-chromium',
      use: { ...devices['Desktop Chrome'], channel: process.env.PLAYWRIGHT_CHANNEL },
    },
    {
      name: 'mobile-chromium',
      use: { ...devices['Pixel 5'], channel: process.env.PLAYWRIGHT_CHANNEL },
    },
  ],
});

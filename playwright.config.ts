import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 2,
  timeout: 30_000,
  expect: { timeout: 7_000 },
  reporter: [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    // GitHub-hosted runners use UTC. The application and its seeded study
    // schedule operate in Asia/Shanghai, so keep browser calendar semantics
    // identical locally and in CI.
    timezoneId: 'Asia/Shanghai',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 4173',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'] } },
    {
      name: 'small-screen',
      // Cover the unchanged tablet workspace. Dedicated phone behavior and the
      // exact 600px non-phone boundary are exercised explicitly in app-shell.
      use: { ...devices['iPhone 13'], viewport: { width: 820, height: 1180 }, browserName: 'chromium', isMobile: false },
    },
  ],
});

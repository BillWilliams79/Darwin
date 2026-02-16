import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.BASE_URL || 'https://localhost:3000';

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [['html', { open: 'never' }]],
  use: {
    baseURL,
    ignoreHTTPSErrors: true,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'setup',
      testMatch: /auth\.setup\.ts/,
    },
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        storageState: '.auth/user.json',
      },
      dependencies: ['setup'],
    },
  ],
  webServer: {
    command: 'npm start',
    url: 'https://localhost:3000',
    ignoreHTTPSErrors: true,
    reuseExistingServer: !process.env.CI,
    cwd: '..',
    timeout: 30000,
  },
});

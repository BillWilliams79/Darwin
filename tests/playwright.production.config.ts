import { defineConfig, devices } from '@playwright/test';

// Production smoke targets the real production site (darwin.one), so the test
// helper's direct REST calls and pre-test cleanup must target production darwin
// to stay coherent with the UI. The shared default is darwin_dev (req #2750);
// pin it back to darwin here. This config module loads before any test imports
// helpers/api.ts, which reads process.env.TEST_DATABASE at import time.
process.env.TEST_DATABASE = process.env.TEST_DATABASE || 'darwin';

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'https://darwin.one',
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
});

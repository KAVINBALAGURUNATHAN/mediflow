import { defineConfig, devices } from '@playwright/test';

// Both servers are started by Playwright itself rather than being left to the
// developer, so `npx playwright test` is the whole command. `reuseExistingServer`
// means an already-running `npm run dev` is used as-is instead of colliding
// with a second one on the same port.
//
// The backend is pointed at the same MongoDB the app normally uses. These tests
// therefore read real data and must not depend on any particular record
// existing - anything a test needs, it creates and then removes.
export default defineConfig({
  testDir: './tests',

  // A failing assertion here usually means a genuinely broken page, so failing
  // fast beats retrying and hiding a flake that is actually a bug.
  retries: 0,
  fullyParallel: false,
  workers: 1,

  reporter: [['list']],

  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  webServer: [
    {
      command: 'node server.js',
      cwd: '../backend',
      url: 'http://localhost:5000/',
      reuseExistingServer: true,
      // Atlas connections from a cold start are not instant.
      timeout: 90_000,
      stdout: 'ignore',
      stderr: 'pipe',
    },
    {
      command: 'npm run dev',
      url: 'http://localhost:5173',
      reuseExistingServer: true,
      timeout: 90_000,
      stdout: 'ignore',
      stderr: 'pipe',
    },
  ],
});

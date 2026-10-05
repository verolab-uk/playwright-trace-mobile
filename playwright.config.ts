import { defineConfig, devices } from '@playwright/test';

const port = 4173;

export default defineConfig({
  testDir: 'tests',
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    ...devices['Desktop Chrome'],
    baseURL: `http://localhost:${port}`,
    launchOptions: { executablePath: process.env.CHROMIUM_EXECUTABLE_PATH },
  },
  webServer: {
    command: 'node tests/serve.mjs',
    env: { PORT: String(port) },
    port,
    reuseExistingServer: !process.env.CI,
  },
});

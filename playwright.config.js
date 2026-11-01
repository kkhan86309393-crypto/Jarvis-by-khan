import { defineConfig, devices } from '@playwright/test';

const baseURL = 'http://127.0.0.1:4173';

export default defineConfig({
  testDir: './browser-tests',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  outputDir: './test-results',
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    serviceWorkers: 'block',
  },
  projects: [
    {
      name: 'desktop-chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 1000 },
      },
    },
    {
      name: 'android-mobile',
      use: {
        ...devices['Pixel 7'],
        defaultBrowserType: 'chromium',
      },
    },
  ],
  webServer: {
    command: 'node server.js',
    url: `${baseURL}/`,
    env: {
      NODE_ENV: 'test',
      AI_API_KEY: '',
      AI_PROVIDER: '',
      AI_MODEL: '',
      AI_BASE_URL: '',
      OLLAMA_BASE_URL: '',
      OLLAMA_MODEL: '',
      APP_ACCESS_TOKEN: '',
    },
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});

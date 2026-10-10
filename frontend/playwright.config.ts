import { defineConfig, devices } from '@playwright/test';

const API_PORT = 8790;
const WEB_PORT = 5180;

/**
 * End-to-end smoke test: real browser, real frontend, local API with the mock AI.
 * Set PW_CHROMIUM_PATH to reuse an installed Chromium; otherwise run
 * `npx playwright install chromium` once.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: 'retain-on-failure',
    launchOptions: { executablePath: process.env.PW_CHROMIUM_PATH || undefined },
    permissions: ['geolocation'],
    // A lane near DTU, inside the demo ward.
    geolocation: { latitude: 28.73425, longitude: 77.12145 },
    locale: 'en-IN',
    timezoneId: 'Asia/Kolkata',
  },
  projects: [
    {
      name: 'phone',
      use: {
        ...devices['Pixel 7'],
        launchOptions: { executablePath: process.env.PW_CHROMIUM_PATH || undefined },
      },
    },
  ],
  webServer: [
    {
      command: `npm run start:local -w backend`,
      cwd: '..',
      url: `http://localhost:${API_PORT}/health`,
      env: { PORT: String(API_PORT), OFFLINE: '1', APP_URL: `http://localhost:${WEB_PORT}` },
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: `npx vite --port ${WEB_PORT} --strictPort`,
      url: `http://localhost:${WEB_PORT}`,
      env: { VITE_AUTH_MODE: 'local', VITE_API_URL: `http://localhost:${API_PORT}` },
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});

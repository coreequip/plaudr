import { defineConfig, devices } from '@playwright/test';

const ROOMWS_PORT = 18080;
const WEB_PORT = 5174;

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    ...devices['Desktop Chrome'],
    launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] },
    permissions: ['microphone'],
  },
  webServer: [
    {
      command: 'go run .',
      cwd: '../vendor/room_ws/server',
      env: { ROOMWS_PORT: String(ROOMWS_PORT), ROOMWS_RATE_LIMIT: '0' },
      url: `http://localhost:${ROOMWS_PORT}/health`,
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: `npx vite --port ${WEB_PORT} --strictPort`,
      env: { VITE_ROOMWS_URL: `ws://localhost:${ROOMWS_PORT}`, VITE_TURN_URL: `http://localhost:${ROOMWS_PORT}/turn` },
      url: `http://localhost:${WEB_PORT}`,
      reuseExistingServer: false,
    },
  ],
});

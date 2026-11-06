import { devices, type PlaywrightTestConfig } from '@playwright/test';
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '.env') });

const config: PlaywrightTestConfig = {
  testDir: './specs',
  timeout: 30 * 1000,
  expect: {
    timeout: 10 * 1000,
  },
  fullyParallel: true,
  // One worker by default: the specs create and void their own patients on a shared server (`--workers=N` overrides it).
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? [['junit', { outputFile: 'results.xml' }], ['html']] : [['html', { open: 'never' }]],
  globalSetup: require.resolve('./core/global-setup'),
  use: {
    // Trailing slash is required so that relative page.goto() paths keep the "/openmrs" prefix.
    baseURL: `${process.env.E2E_BASE_URL}/`,
    actionTimeout: 10 * 1000,
    storageState: 'storageState.json',
    video: 'retain-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
      },
    },
  ],
};

export default config;

import { devices, type PlaywrightTestConfig } from '@playwright/test';
import type { PihemrWorkerOptions } from '@pih/pihemr-e2e/src/site';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { getSite } from './core/site';
dotenv.config({ path: path.resolve(__dirname, '.env') });

// A slow server needs longer timeouts: E2E_TIMEOUT_FACTOR multiplies the test, expect and action timeouts (1, the default, suits the ci servers).
const factor = Number(process.env.E2E_TIMEOUT_FACTOR ?? 1);

const config: PlaywrightTestConfig<{}, PihemrWorkerOptions> = {
  testDir: './specs',
  // Applies tsconfig.json's `paths` to every file, including the specs shared from pihemr (@pih/pihemr-e2e) outside this repo.
  tsconfig: './tsconfig.json',
  timeout: 30 * 1000 * factor,
  expect: {
    timeout: 15 * 1000 * factor,
  },
  fullyParallel: true,
  // One worker by default: the specs create and void their own patients on a shared server (`--workers=N` overrides it).
  workers: Number(process.env.E2E_WORKERS ?? 1),
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? [['junit', { outputFile: 'results.xml' }], ['html']] : [['html', { open: 'never' }]],
  globalSetup: require.resolve('./core/global-setup'),
  use: {
    // The site of the shared fixtures from pihemr (@pih/pihemr-e2e); see core/site.ts.
    siteConfig: { getSite },
    // Trailing slash is required so that relative page.goto() paths keep the "/openmrs" prefix.
    baseURL: `${process.env.E2E_BASE_URL}/`,
    actionTimeout: 15 * 1000 * factor,
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

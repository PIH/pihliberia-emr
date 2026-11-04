import { request } from '@playwright/test';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { NCD_CLINIC_LOCATION_UUID } from './constants';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

async function globalSetup() {
  const requestContext = await request.newContext();
  const token = Buffer.from(
    `${process.env.E2E_USER_ADMIN_USERNAME}:${process.env.E2E_USER_ADMIN_PASSWORD}`,
  ).toString('base64');

  // The HTML Form Entry UI needs a session location, so set one when logging in.
  const res = await requestContext.post(`${process.env.E2E_BASE_URL}/ws/rest/v1/session`, {
    data: { locale: 'en', sessionLocation: NCD_CLINIC_LOCATION_UUID },
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Basic ${token}`,
    },
  });

  if (!res.ok()) {
    throw new Error(`Global setup login failed: ${res.status()}`);
  }

  await requestContext.storageState({ path: 'storageState.json' });
  await requestContext.dispose();
}

export default globalSetup;

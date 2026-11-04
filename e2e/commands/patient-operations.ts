import { type APIRequestContext, expect } from '@playwright/test';
import { LIBERIA_EMR_ID_IDENTIFIER_TYPE_UUID, HEALTH_FACILITY_VISIT_LOCATION_UUID } from '../core/constants';

export interface TestPatient {
  uuid: string;
  person: { uuid: string; gender: string; birthdate: string };
}

export interface CreatePatientOptions {
  givenName?: string;
  familyName?: string;
  gender?: 'M' | 'F';
  birthdate?: string;
}

// Liberia EMR ID has no format or validator (identifierTypes.csv), so any unused string is accepted. Random letters
// keep the identifier clear of the numbers the idgen source hands out.
const IDENTIFIER_CHARS = 'ACDEFGHJKLMNPRTUVWXY';

function randomIdentifier(): string {
  return 'AUTO' + Array.from({ length: 6 }, () => IDENTIFIER_CHARS[Math.floor(Math.random() * IDENTIFIER_CHARS.length)]).join('');
}

// Creates a synthetic patient. Names contain no digits.
export const createPatient = async (api: APIRequestContext, opts: CreatePatientOptions = {}): Promise<TestPatient> => {
  const res = await api.post('patient', {
    data: {
      identifiers: [
        {
          identifier: randomIdentifier(),
          identifierType: LIBERIA_EMR_ID_IDENTIFIER_TYPE_UUID,
          location: HEALTH_FACILITY_VISIT_LOCATION_UUID,
          preferred: true,
        },
      ],
      person: {
        gender: opts.gender ?? 'F',
        birthdate: opts.birthdate ?? '1990-01-01',
        birthdateEstimated: false,
        names: [{ givenName: opts.givenName ?? 'AutoE', familyName: opts.familyName ?? 'Tester', preferred: true }],
        addresses: [],
        attributes: [],
      },
    },
  });
  expect(res.ok(), `create patient: ${res.status()}`).toBeTruthy();
  return res.json();
};

export const deletePatient = async (api: APIRequestContext, uuid: string): Promise<void> => {
  const res = await api.delete(`patient/${uuid}`);
  expect(res.ok(), `void patient: ${res.status()}`).toBeTruthy();
};

// Birthdate for a patient who is `years` old today. The date is two days before the birthday: the browser
// machine, the test runner and the server may be in different timezones, and a patient born exactly
// `years` ago would read as `years - 1` on a server whose date is a day behind.
export const birthdateYearsAgo = (years: number): string => {
  const d = new Date();
  d.setFullYear(d.getFullYear() - years);
  d.setDate(d.getDate() - 2);
  return d.toISOString().slice(0, 10);
};

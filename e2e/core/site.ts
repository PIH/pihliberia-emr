import type { SiteSettings } from '@pih/pihemr-e2e/src/site';
// (`@pih/pihemr-e2e/src/site`, not the package root: the config imports this file, and only that entry loads no Playwright code. See pihemr/e2e/README.md.)
import {
  FAMILY_MEDICINE_FOLLOWUP_ENCOUNTER_TYPE_UUID,
  FAMILY_MEDICINE_INTAKE_ENCOUNTER_TYPE_UUID,
  HEALTH_FACILITY_VISIT_LOCATION_UUID,
  LIBERIA_EMR_ID_IDENTIFIER_SOURCE_UUID,
  LIBERIA_EMR_ID_IDENTIFIER_TYPE_UUID,
  NCD_CLINIC_LOCATION_UUID,
} from './constants';

const requireEnv = (name: string): string => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set (see .env.example)`);
  }
  return value;
};

// What makes the shared fixtures of pihemr (@pih/pihemr-e2e) Liberia's. playwright.config.ts passes it as `use: { siteConfig: { getSite } }`; it is called when the
// first test of a worker needs it, so a missing setting fails that test and does not break `playwright test --list`.
export const getSite = (): SiteSettings => ({
  api: {
    baseUrl: requireEnv('E2E_BASE_URL'),
    username: requireEnv('E2E_USER_ADMIN_USERNAME'),
    password: requireEnv('E2E_USER_ADMIN_PASSWORD'),
  },
  patientIdentifier: { typeUuid: LIBERIA_EMR_ID_IDENTIFIER_TYPE_UUID, sourceUuid: LIBERIA_EMR_ID_IDENTIFIER_SOURCE_UUID },
  visitLocationUuid: HEALTH_FACILITY_VISIT_LOCATION_UUID,
  // "NCD Clinic": the session location of the run and the location of the encounters the harness creates
  sessionLocationUuid: NCD_CLINIC_LOCATION_UUID,
  defaultProviderName: process.env.E2E_DEFAULT_PROVIDER_NAME,
  // What the shared specs that depend on the site's encounter types and formulary need (see SiteSpecFacts in @pih/pihemr-e2e)
  specs: {
    'section-chief-complaint': {
      parents: [{ name: 'Family Medicine Followup', encounterTypeUuid: FAMILY_MEDICINE_FOLLOWUP_ENCOUNTER_TYPE_UUID }],
    },
    'section-review-of-systems': {
      parent: { name: 'Family Medicine Intake', encounterTypeUuid: FAMILY_MEDICINE_INTAKE_ENCOUNTER_TYPE_UUID },
    },
    'section-prescriptions-print': {
      parent: { name: 'Family Medicine Intake', encounterTypeUuid: FAMILY_MEDICINE_INTAKE_ENCOUNTER_TYPE_UUID },
      drugs: ['Paracetamol', 'Amoxicillin'],
      planFormMedication: 'Amoxicillin, 250mg tablet',
    },
  },
});

import type { PihemrFixtures, PihemrWorkerFixtures } from '@pih/pihemr-e2e';

// The fixtures (api, createSectionEncounter, createEntryContext, attachDiagnostics, failOnJsError, allowedJsErrors) are implemented once, in pihemr
// (e2e/src/fixtures/test.ts). The site they act on is Liberia's: core/site.ts, set in playwright.config.ts (`use: { siteConfig: { getSite } }`).
export { test, expect } from '@pih/pihemr-e2e';
export type CustomTestFixtures = PihemrFixtures;
export type CustomWorkerFixtures = PihemrWorkerFixtures;
export type { EntryContext, SectionEncounter, SectionEncounterOptions } from '@pih/pihemr-e2e';
export { birthdateYearsAgo } from '@pih/pihemr-e2e';

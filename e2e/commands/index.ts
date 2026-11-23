// The reads that specs call directly (and the patient and cleanup commands the fixtures use) are in @pih/pihemr-e2e; this file only gives the specs one
// place to import them from.
export { birthdateYearsAgo, cleanupPatient, getEncounterObs, getPatientEncounters } from '@pih/pihemr-e2e';
export type { EncounterObs, PatientEncounter } from '@pih/pihemr-e2e';

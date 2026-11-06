import type { APIRequestContext } from '@playwright/test';
import { deletePatient } from './patient-operations';
import { voidClinicalDataForPatient } from './encounter-operations';
import { voidProgramEnrollments } from './program-operations';

// Voids a synthetic patient with everything the test created: encounters (with their obs and orders), visits and
// program enrollments, then the patient. Nothing is purged, so the user does not need the Purge privileges; the voided
// patients keep their `Auto… Tester` name, so a name-filtered cleanup can still find them.
export const cleanupPatient = async (api: APIRequestContext, patientUuid: string): Promise<void> => {
  await voidClinicalDataForPatient(api, patientUuid);
  await voidProgramEnrollments(api, patientUuid);
  await deletePatient(api, patientUuid);
};

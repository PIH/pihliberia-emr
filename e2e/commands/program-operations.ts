import { type APIRequestContext, expect } from '@playwright/test';

// Saving some section forms enrolls the patient in a program (e.g. section-ncd-followup enrolls in NCD).
// Enrollments are voided with the patient, so they stop counting in program reports.
export const voidProgramEnrollments = async (api: APIRequestContext, patientUuid: string): Promise<void> => {
  const res = await api.get(`programenrollment?patient=${patientUuid}&v=custom:(uuid)&limit=100`);
  expect(res.ok()).toBeTruthy();
  for (const enrollment of (await res.json()).results) {
    const del = await api.delete(`programenrollment/${enrollment.uuid}`);
    expect(del.ok(), `void enrollment: ${del.status()}`).toBeTruthy();
  }
};

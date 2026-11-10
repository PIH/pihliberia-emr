import { type APIRequestContext, expect } from '@playwright/test';
import {
  CLINIC_OR_HOSPITAL_VISIT_TYPE_UUID,
  HEALTH_FACILITY_VISIT_LOCATION_UUID,
  NCD_CLINIC_LOCATION_UUID,
} from '../core/constants';

export interface TestEncounter {
  uuid: string;
  visitUuid: string;
}

// Every datetime the harness sends is 60 seconds in the past. The server rejects an encounter (and a visit start, and an obs)
// dated after its own clock ("Encounter.datetimeShouldBeBeforeCurrent", HTTP 400), and a developer machine's clock that leads the
// server's by even 200 ms made about one create in ten fail at random. Do not use a bare new Date() for these.

// Starts a visit for the patient. Entry forms (the ones that create the encounter) open inside a visit.
export const createVisit = async (api: APIRequestContext, patientUuid: string): Promise<string> => {
  const res = await api.post('visit', {
    data: {
      patient: patientUuid,
      visitType: CLINIC_OR_HOSPITAL_VISIT_TYPE_UUID,
      location: HEALTH_FACILITY_VISIT_LOCATION_UUID,
      startDatetime: new Date(Date.now() - 60_000).toISOString(),
    },
  });
  expect(res.ok(), `create visit: ${res.status()}`).toBeTruthy();
  return (await res.json()).uuid;
};

export interface PatientEncounter {
  uuid: string;
  encounterType: { uuid: string };
}

// Encounters of one test patient (never call this with a patient the test did not create).
export const getPatientEncounters = async (api: APIRequestContext, patientUuid: string): Promise<PatientEncounter[]> => {
  const res = await api.get(`encounter?patient=${patientUuid}&v=custom:(uuid,encounterType:(uuid))&limit=100`);
  expect(res.ok(), `get encounters: ${res.status()}`).toBeTruthy();
  return (await res.json()).results;
};

// Starts a visit for the patient and records an empty encounter of the given type in it. The section
// forms are edit forms for an existing encounter, so the encounter has to exist before the form opens.
export const createVisitWithEncounter = async (
  api: APIRequestContext,
  patientUuid: string,
  encounterTypeUuid: string,
): Promise<TestEncounter> => {
  const now = new Date(Date.now() - 60_000).toISOString();

  const visitRes = await api.post('visit', {
    data: {
      patient: patientUuid,
      visitType: CLINIC_OR_HOSPITAL_VISIT_TYPE_UUID,
      location: HEALTH_FACILITY_VISIT_LOCATION_UUID,
      startDatetime: now,
    },
  });
  expect(visitRes.ok(), `create visit: ${visitRes.status()}`).toBeTruthy();
  const visit = await visitRes.json();

  const encRes = await api.post('encounter', {
    data: {
      patient: patientUuid,
      encounterType: encounterTypeUuid,
      location: NCD_CLINIC_LOCATION_UUID,
      encounterDatetime: now,
      visit: visit.uuid,
    },
  });
  expect(encRes.ok(), `create encounter: ${encRes.status()}`).toBeTruthy();
  const encounter = await encRes.json();

  return { uuid: encounter.uuid, visitUuid: visit.uuid };
};

export interface EncounterObs {
  display: string;
  concept: { uuid: string; display: string };
  value: unknown;
}

// Obs recorded on one encounter (the encounter belongs to a patient this test created).
export const getEncounterObs = async (api: APIRequestContext, encounterUuid: string): Promise<EncounterObs[]> => {
  const res = await api.get(`obs?encounter=${encounterUuid}&v=custom:(display,concept:(uuid,display),value)&limit=200`);
  expect(res.ok(), `get obs: ${res.status()}`).toBeTruthy();
  return (await res.json()).results;
};

// Voids what the test created for the patient: encounters (which voids their obs and orders), then visits.
// Nothing is purged, so the user does not need the Purge privileges. Saving a section form twice voids the first save's
// obs, so listing the encounters and visits is enough; there is no foreign key to work around.
export const voidClinicalDataForPatient = async (api: APIRequestContext, patientUuid: string): Promise<void> => {
  const encRes = await api.get(`encounter?patient=${patientUuid}&limit=100`);
  expect(encRes.ok()).toBeTruthy();
  for (const encounter of (await encRes.json()).results) {
    const res = await api.delete(`encounter/${encounter.uuid}`);
    expect(res.ok(), `void encounter ${encounter.uuid}: ${res.status()} ${await res.text()}`).toBeTruthy();
  }

  const visitRes = await api.get(`visit?patient=${patientUuid}&includeInactive=true&limit=100`);
  expect(visitRes.ok()).toBeTruthy();
  for (const visit of (await visitRes.json()).results) {
    const res = await api.delete(`visit/${visit.uuid}`);
    expect(res.ok(), `void visit ${visit.uuid}: ${res.status()} ${await res.text()}`).toBeTruthy();
  }
};

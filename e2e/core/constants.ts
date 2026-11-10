// Metadata uuids for the Liberia configuration (pihliberia-emr). Encounter types are the formEncounterType of
// the forms (or, for the section forms, the parent encounter type); locations, the identifier type and the visit
// type come from the repo's locations.csv, identifierTypes.csv and the pihemr visit types. Verify against the
// target server's REST metadata endpoints if a spec cannot create its fixtures.
//
// Checked against the local server on :7072 (locations and their tags, 2026-11-09) and exercised by the suite.

// "Liberia EMR ID": no format, no validator (see commands/patient-operations.ts).
export const LIBERIA_EMR_ID_IDENTIFIER_TYPE_UUID = '0bc545e0-f401-11e4-b939-0800200c9a66';

// "Health Facility": the only location with the Visit Location tag, so visits are created here.
export const HEALTH_FACILITY_VISIT_LOCATION_UUID = '5af1ffcd-5178-11ea-a500-645d86728797';
// "NCD Clinic": a Login Location carrying both the Consult Note Location and the NCD Consult Location tags (the
// encounterLocation widgets of the consult forms offer only locations with those tags and default to the session
// location); used as session and encounter location. Forms that need another tag (dispensing: "Dispensing Location"
// is on MCH Clinic, Mental Health Clinic and Pharmacy only) pick their location in the form.
export const NCD_CLINIC_LOCATION_UUID = 'b7cfea60-5179-11ea-a500-645d86728797';
export const MCH_CLINIC_LOCATION_UUID = '2e8c9500-bd41-11ea-aee0-3c6aa7c392cc';
export const MENTAL_HEALTH_CLINIC_LOCATION_UUID = '8b8dad4c-5179-11ea-a500-645d86728797';
export const PHARMACY_LOCATION_UUID = '0fff0fae-ff2c-11ea-85b1-3c6aa7c392cc';

export const CLINIC_OR_HOSPITAL_VISIT_TYPE_UUID = 'f01c54cb-2225-471a-9cd5-d348552c337c';

// Encounter type uuids: add one per form as the specs need it (formEncounterType of the form, resolved to a name in
// ~/openmrs/<server>/configuration/encountertypes/).

// formEncounterType of the forms in htmlforms/ (names from encountertypes/encounterTypes.csv and liberiaEncounterTypes.csv)
export const CHECKIN_ENCOUNTER_TYPE_UUID = '55a0d3ea-a4d7-4e88-8f01-5aceb2d3c61b'; // checkin.xml
export const VITALS_ENCOUNTER_TYPE_UUID = '4fb47712-34a6-40d2-8ed3-e153abbd25b7'; // vitals.xml
export const CONSULT_ENCOUNTER_TYPE_UUID = '92fd09b4-5335-4f7e-9f63-b2a663fd09a6'; // outpatientConsult.xml
export const PATIENT_REGISTRATION_ENCOUNTER_TYPE_UUID = '873f968a-73a8-4f9c-ac78-9f4778b751b6'; // patientRegistration-social.xml
export const ANC_INTAKE_ENCOUNTER_TYPE_UUID = '00e5e810-90ec-11e8-9eb6-529269fb1459'; // anc-initial.xml
export const ANC_FOLLOWUP_ENCOUNTER_TYPE_UUID = '00e5e946-90ec-11e8-9eb6-529269fb1459'; // anc-followup.xml
export const MCH_DELIVERY_ENCOUNTER_TYPE_UUID = '00e5ebb2-90ec-11e8-9eb6-529269fb1459'; // anc-delivery.xml
export const MEDICATION_DISPENSING_ENCOUNTER_TYPE_UUID = '8ff50dea-18a1-4609-b4c9-3f8f2d611b84'; // dispensing.xml
export const LAB_RESULTS_ENCOUNTER_TYPE_UUID = '4d77916a-0620-11e5-a6c0-1697f925ec7b'; // labResults.xml
export const EPILEPSY_INTAKE_ENCOUNTER_TYPE_UUID = '7336a05e-4bd1-4e52-81c1-207697afc868'; // epilepsyIntake.xml
export const EPILEPSY_FOLLOWUP_ENCOUNTER_TYPE_UUID = '74e06462-243e-4fad-8d7c-0bb3921322f1'; // epilepsy.xml
export const FAMILY_MEDICINE_INTAKE_ENCOUNTER_TYPE_UUID = '1d1faf4f-a848-44c8-ac44-ada8aa5ae40c'; // family-medicine-intake.xml
export const FAMILY_MEDICINE_FOLLOWUP_ENCOUNTER_TYPE_UUID = '84d5e978-66d1-4a2c-b209-95d47c911dd8'; // family-medicine-followup.xml
export const MENTAL_HEALTH_INTAKE_ENCOUNTER_TYPE_UUID = 'fccd53c2-f802-439b-a7a2-2d680bd8b81b'; // mentalHealthIntake.xml
export const MENTAL_HEALTH_CONSULT_ENCOUNTER_TYPE_UUID = 'a8584ab8-cc2a-11e5-9956-625662870761'; // mentalHealthFollowup.xml
export const NCD_INITIAL_ENCOUNTER_TYPE_UUID = 'ae06d311-1866-455b-8a64-126a9bd74171'; // ncd-initial.xml
export const NCD_FOLLOWUP_ENCOUNTER_TYPE_UUID = '5cbfd6a2-92d9-4ad0-b526-9d29bfe1d10c'; // ncd-followup.xml

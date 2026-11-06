# End-to-end tests

Playwright tests for the Liberia HTML forms. The layout follows `pihmalawi-emr/e2e` (`core/`, `fixtures/`, `commands/`, `pages/`, `specs/`); the harness is copied from `zl-emr/e2e` and `pihsl-emr/e2e` and can move to a shared package later.

> **Status:** written without a server, then run and fixed against a local Liberia server (Nov 2026): the full suite (332 tests) ran in about 13 minutes with `E2E_WORKERS=3`; after the fixes every spec passes (the specs fixed after that run were re-run on their own). Tests marked `test.fail()` assert the *intended* behaviour of a known form bug and pass while the bug exists: the ones that failed in the run failed as predicted, but a marker is only confirmed for the intended reason when its failure message says so, so check that when you fix a bug and remove the marker.

## Running locally

Needs a running Liberia OpenMRS server (the example uses `http://localhost:7070/openmrs`, config `liberia,liberia-harper,liberia-harper-jjd-ci`) and Node.js 22+ (`nvm use`).

```bash
cd e2e
npm install
npx playwright install chromium
cp .env.example .env    # then edit: URL and admin credentials of your server; quote values containing spaces
npx playwright test
```

Use a server with **test data only**. The specs create their own synthetic patients (`Auto<Something> Tester`) and write to the server; after each test the fixtures **void** what the test created (encounters with their obs and orders, visits, program enrollments, then the patient). Nothing is purged, so the login does not need the Purge privileges. The voided patients stay in the database.

The login (`core/global-setup.ts`) sets the session location to **NCD Clinic**, which carries the "Consult Note Location" and "NCD Consult Location" tags that the consult forms' location widgets need. A form that needs another tag picks its location in the form (dispensing: MCH Clinic, Mental Health Clinic or Pharmacy; the mental health and epilepsy forms: Mental Health Clinic). The API user needs a Provider account, or forms that auto-submit or require a provider cannot save.

Every test also fails on an uncaught JavaScript error in its pages (the `failOnJsError` auto fixture in `core/test.ts`); `console.error` output is not counted. When a test fails, the `attachDiagnostics` auto fixture attaches the failed requests, the form submit and its response, the console errors and the API user's providers as `server-diagnostics`.

The specs share one login session, so if the machine sleeps during a long run the session expires and every later test fails with `create patient: 401`. Keep the machine awake, e.g. `systemd-inhibit --what=sleep:idle npx playwright test`. Run a few specs at a time while iterating (`npx playwright test specs/<form>`).

## Forms tested

One spec per form, in `specs/<xml file name without .xml>/`. *Form name*, *Form version*, *Form uuid* and *Encounter uuid* are the `formName`, `formVersion`, `formUuid` and `formEncounterType` of the form's `<htmlform>` element; *Encounter* is the name of that encounter type. Keep a row here when you add, rename or remove a spec, and update it when the form's version or uuid changes. Versioned copies (`*_v1.0.xml`) and `retired/` forms are not tested, nor are the forms Liberia gets from the parent pihemr content without overriding them (e.g. `primary-care-*`, `mentalHealth.xml`, `ancIntake.xml`).

### Top-level (entry) forms

| XML file | Form name | Form version | Form uuid | Encounter | Encounter uuid |
|---|---|---|---|---|---|
| `anc-delivery.xml` | MCH Delivery | 1.1 | `ff193c33-5a51-11eb-b3e1-34c93de76af3` | MCH Delivery | `00e5ebb2-90ec-11e8-9eb6-529269fb1459` |
| `anc-followup.xml` | ANC Followup | 1.1 | `9107ccca-d1e3-11ea-9995-3c6aa7c392cc` | ANC Followup | `00e5e946-90ec-11e8-9eb6-529269fb1459` |
| `anc-initial.xml` | ANC Initial | 1.1 | `7bff46e5-d1e3-11ea-9995-3c6aa7c392cc` | ANC Intake | `00e5e810-90ec-11e8-9eb6-529269fb1459` |
| `checkin.xml` | Check-In | 2.0 | `54E29E26-123E-4137-8F26-91D8227C1D5B` | Check-In | `55a0d3ea-a4d7-4e88-8f01-5aceb2d3c61b` |
| `dispensing.xml` | Dispensing | 1.0 | `ba22eda5-148d-456e-8adc-f36247d1f7c3` | Medication Dispensing | `8ff50dea-18a1-4609-b4c9-3f8f2d611b84` |
| `epilepsy.xml` | Epilepsy Followup | 1.0 | `4a101cb7-fab3-4d69-8fe2-84671ae82f6e` | Epilepsy Followup | `74e06462-243e-4fad-8d7c-0bb3921322f1` |
| `epilepsyIntake.xml` | Epilepsy Intake | 1.0 | `e0e49050-85d8-444d-a587-c9769d0899f6` | Epilepsy Intake | `7336a05e-4bd1-4e52-81c1-207697afc868` |
| `family-medicine-followup.xml` | Family Medicine Followup | 2.0 | `1d4e250c-972a-4c75-b0d8-80d6527cc1a0` | Family Medicine Followup | `84d5e978-66d1-4a2c-b209-95d47c911dd8` |
| `family-medicine-intake.xml` | Family Medicine Intake | 2.0 | `c0d1a35a-f40c-426f-be6e-033e9fc4e69b` | Family Medicine Intake | `1d1faf4f-a848-44c8-ac44-ada8aa5ae40c` |
| `labResults.xml` | Lab results | 1.0 | `4d778ef4-0620-11e5-a6c0-1697f925ec7b` | Laboratory Results | `4d77916a-0620-11e5-a6c0-1697f925ec7b` |
| `mentalHealthFollowup.xml` | Mental Health Followup | 1.0 | `e1cff6a2-651a-11e8-adc0-fa7ae01bbebc` | Mental Health Consult | `a8584ab8-cc2a-11e5-9956-625662870761` |
| `mentalHealthIntake.xml` | Mental Health Intake | 1.0 | `23d64659-9325-443c-a166-5945c88f299a` | Mental Health Intake | `fccd53c2-f802-439b-a7a2-2d680bd8b81b` |
| `ncd-followup.xml` | NCD Followup | 2.0 | `4cabb024-7f47-441c-9a08-9318122f711a` | NCD Followup Consult | `5cbfd6a2-92d9-4ad0-b526-9d29bfe1d10c` |
| `ncd-initial.xml` | NCD Initial | 2.0 | `edf1cecf-f1fc-4917-8bcb-2bd9669eb2f7` | NCD Initial Consult | `ae06d311-1866-455b-8a64-126a9bd74171` |
| `outpatientConsult.xml` | Clinic Consult | 1.0 | `a3fc5c38-eb32-11e2-981f-96c0fcb18276` | Consultation | `92fd09b4-5335-4f7e-9f63-b2a663fd09a6` |
| `patientRegistration-social.xml` | Patient Registration Social | 1.0 | `3C953068-B460-4B1A-8889-0AAD43447CD7` | Patient Registration | `873f968a-73a8-4f9c-ac78-9f4778b751b6` |
| `peds.xml` | Pediatrics form | 1.0 | `fac9d9a2-d0bc-11ea-9995-3c6aa7c392cc` | PEDS Form | `fac9d9a2-d0bc-11ea-9995-3c6aa7c392cc` |
| `vitals.xml` | Vitals | 2.2 | `68728aa6-4985-11e2-8815-657001b58a90` | Vital Signs | `4fb47712-34a6-40d2-8ed3-e153abbd25b7` |

### Section forms

A `section-*` form has no `formEncounterType`: its *Encounter* column lists the encounter types the spec creates for it (`<br>` separates several, in the same order in both columns).

| XML file | Form name | Form version | Form uuid | Encounter | Encounter uuid |
|---|---|---|---|---|---|
| `med-order.xml` | OB-GYN Plan | 1.0 | `3616e6be-1671-4031-9cc9-a0f1f4b1d100` | ANC Intake | `00e5e810-90ec-11e8-9eb6-529269fb1459` |
| `section-diabetes.xml` | Diabetes | 1.0 | `d26b1ddf-d410-4a9f-be0f-b516e7c26c40` | NCD Followup Consult<br>NCD Initial Consult | `5cbfd6a2-92d9-4ad0-b526-9d29bfe1d10c`<br>`ae06d311-1866-455b-8a64-126a9bd74171` |
| `section-dx.xml` | Diagnostic | 1.0 | `3498f204-a6fa-4df0-b7fd-a94eb03a43c9` | Family Medicine Intake | `1d1faf4f-a848-44c8-ac44-ada8aa5ae40c` |
| `section-exam.xml` | Examen physique | 1.0 | `b34b71f4-03f1-11e5-8418-1697f925ec7b` | NCD Initial Consult<br>OB/GYN<br>PMTCT Intake<br>PMTCT Followup | `ae06d311-1866-455b-8a64-126a9bd74171`<br>`d83e98fd-dc7b-420f-aa3f-36f648b4483d`<br>`584124b9-1f10-4757-ba09-91fc9075af92`<br>`95e03e7d-9aeb-4a99-bd7a-94e8591ec2c5` |
| `section-heart-failure.xml` | Heart Failure | 1.0 | `8301277b-1062-4c15-8701-9771ac95e599` | NCD Followup Consult<br>NCD Initial Consult | `5cbfd6a2-92d9-4ad0-b526-9d29bfe1d10c`<br>`ae06d311-1866-455b-8a64-126a9bd74171` |
| `section-history.xml` | History | 1.0 | `162091b1-0060-4e56-8c17-7015aeddf608` | Family Medicine Intake<br>NCD Initial Consult | `1d1faf4f-a848-44c8-ac44-ada8aa5ae40c`<br>`ae06d311-1866-455b-8a64-126a9bd74171` |
| `section-hospital.xml` | NCD hospitalization | 1.0 | `2d52173d-6030-4284-940a-0d0e79e48491` | NCD Followup Consult<br>NCD Initial Consult | `5cbfd6a2-92d9-4ad0-b526-9d29bfe1d10c`<br>`ae06d311-1866-455b-8a64-126a9bd74171` |
| `section-hypertension.xml` | Hypertension | 1.0 | `3a1d79fe-9aa0-4289-bcea-c70aae516234` | NCD Followup Consult<br>NCD Initial Consult | `5cbfd6a2-92d9-4ad0-b526-9d29bfe1d10c`<br>`ae06d311-1866-455b-8a64-126a9bd74171` |
| `section-kidney.xml` | Chronic Kidney Disease | 1.0 | `1a66029d-0e0c-410b-9fa6-8ea26f697cb8` | NCD Followup Consult<br>NCD Initial Consult | `5cbfd6a2-92d9-4ad0-b526-9d29bfe1d10c`<br>`ae06d311-1866-455b-8a64-126a9bd74171` |
| `section-liver.xml` | Liver Disease | 1.0 | `4357b34b-ab3a-4404-ab33-a73104b26fdb` | NCD Followup Consult<br>NCD Initial Consult | `5cbfd6a2-92d9-4ad0-b526-9d29bfe1d10c`<br>`ae06d311-1866-455b-8a64-126a9bd74171` |
| `section-lung.xml` | Chronic Lung Disease | 1.0 | `add648f7-7d24-47ce-9456-8006021e074e` | NCD Followup Consult<br>NCD Initial Consult | `5cbfd6a2-92d9-4ad0-b526-9d29bfe1d10c`<br>`ae06d311-1866-455b-8a64-126a9bd74171` |
| `section-ncd-followup.xml` | NCD Visit Information | 1.0 | `1d764c06-ebdc-42fa-b75a-d5b789e3f630` | NCD Followup Consult<br>NCD Initial Consult<br>Vital Signs | `5cbfd6a2-92d9-4ad0-b526-9d29bfe1d10c`<br>`ae06d311-1866-455b-8a64-126a9bd74171`<br>`4fb47712-34a6-40d2-8ed3-e153abbd25b7` |
| `section-ncd-history.xml` | NCD History | 1.0 | `b0b5ed18-f477-45d5-87f9-ad3df76e9b5b` | NCD Followup Consult<br>NCD Initial Consult | `5cbfd6a2-92d9-4ad0-b526-9d29bfe1d10c`<br>`ae06d311-1866-455b-8a64-126a9bd74171` |
| `section-ncd-plan.xml` | NCD Plan | 1.0 | `aa8d9374-f343-4818-8433-66f4e6145a7f` | NCD Followup Consult | `5cbfd6a2-92d9-4ad0-b526-9d29bfe1d10c` |
| `section-other-ncd.xml` | Other NCDs | 1.0 | `319412b8-215c-428d-a1d2-f15c1a96b4d1` | NCD Initial Consult | `ae06d311-1866-455b-8a64-126a9bd74171` |
| `section-palliative.xml` | Palliative Care | 1.0 | `226796bc-24b0-4af7-98b3-f07b26e390cf` | NCD Followup Consult<br>NCD Initial Consult | `5cbfd6a2-92d9-4ad0-b526-9d29bfe1d10c`<br>`ae06d311-1866-455b-8a64-126a9bd74171` |
| `section-review-of-systems.xml` | Review of Systems | 1.0 | `1c57f8d3-65eb-4619-a375-7612b79a7b13` | Family Medicine Intake | `1d1faf4f-a848-44c8-ac44-ada8aa5ae40c` |
| `section-sickle-cell.xml` | Sickle Cell | 1.0 | `23afe1ed-76c4-4642-b37b-44944a9dbed9` | NCD Followup Consult<br>NCD Initial Consult | `5cbfd6a2-92d9-4ad0-b526-9d29bfe1d10c`<br>`ae06d311-1866-455b-8a64-126a9bd74171` |

`peds.xml` has no `formEncounterType`; the encounter type its spec creates is the one whose uuid equals the form's own uuid (`LiberiaConfigConstants.ENCOUNTERTYPE_LIBERIAPEDSFORM_UUID`). `med-order.xml` ("OB-GYN Plan") is only a section of the ANC Intake, ANC Followup and MCH Delivery forms; its spec uses an ANC Intake parent. `section-exam.xml` and `section-other-ncd.xml` are not referenced by anything in the Liberia config (see `htmlforms/documentation/_availability.e2e.md`) but are tested anyway.

## Section specs

`specs/section-<x>/` tests a standalone form that edits an existing encounter (on the visit page it opens from the section's edit pencil, see `scripts/visit/encounterTypeConfig.js`). Each spec creates a patient, a visit and an empty encounter of the parent encounter type over REST (`createSectionEncounter`), opens `editHtmlFormWithStandardUi.page?...definitionUiResource=file:configuration/pih/htmlforms/<form>.xml` directly (`SectionFormPage`), so the visit-page gating of `_availability.e2e.md` is not exercised, and asserts the form's conditions, scripts and saved obs.

## Top-level (entry form) specs

`specs/<form>/` for a top-level form tests a form that **creates** the encounter: `createEntryContext` (patient with an active visit, no encounter), `EntryFormPage` (`enterHtmlFormWithStandardUi.page`), then the new encounter is read back with `getPatientEncounters` / `getEncounterObs`. Notes:

- `ncd-initial`, `ncd-followup` and the two `family-medicine-*` forms are shells (who/when/where, then the section forms): in ENTER they submit themselves on load when the location has a value.
- Many forms use the HFE `<submit>` tag, which renders `input.submitButton` inside `#buttons`, not `#submit`.
- `labResults` is opened without a visit in production; its spec builds its own URL without `visitId`.
- `vitals` and `checkin` run their scripts (unit converters, breadcrumb questions) in the Simple UI; the specs use `enterHtmlFormWithSimpleUi.page` where needed.

### Known form bugs

Tests for behaviour that is currently broken assert the **intended** behaviour and are marked `test.fail()` with the finding id (e.g. `section-ncd-history` V1). They stay green while the bug exists and fail once it is fixed: remove the marker then. All of them are **unconfirmed** because the specs were never run. The findings, scripts and side effects of each form are in the header comment of its spec; shared subforms and scripts are documented once in `htmlforms/documentation/_shared.e2e.md`, and when each form is offered in `_availability.e2e.md`. The skill for writing specs is `htmlforms/documentation/hfe-e2e-specs.skill.md`.

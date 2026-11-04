import { type APIRequestContext } from '@playwright/test';
import { test, expect, birthdateYearsAgo, type SectionEncounter } from '../../core';
import {
  NCD_CLINIC_LOCATION_UUID,
  NCD_FOLLOWUP_ENCOUNTER_TYPE_UUID,
  NCD_INITIAL_ENCOUNTER_TYPE_UUID,
  VITALS_ENCOUNTER_TYPE_UUID,
} from '../../core/constants';
import { getEncounterObs } from '../../commands';
import { SectionFormPage, ViewFormPage, expectViewShowsSavedObs } from '../../pages';

// section-ncd-followup.xml ("NCD Visit Information"): the first section of an NCD Followup encounter: type of visit, social support and
// school (followup only), NCD categories, vitals (last vitals of the visit, BP, MUAC for children, BMI result) and clinical notes. On the
// visit page it is the `pihcore-ncd-followup` section of NCD Followup encounters (_availability.e2e.md "Sections"); the specs create an NCD
// Followup encounter (and an NCD Initial one for the branches on it) and open the edit URL directly, which skips that gating.
// First written without a server (locators from the XML), then run and fixed against a local Liberia server: see README.md.
//
// Conditions in the form, from documentation inventory (section-ncd-followup.inv.md):
//   ifMode VIEW include=false :39, :532   heading; Next/Save/Cancel (no top-row buttons, unlike the other NCD sections)
//   includeIf encounterType == NCD Followup (5cbfd6a2) :166  "Patient Details" section (#visit-details) with the two `when` below
//   when social support = yes  :188  shows #specify-support      when missed school = yes :209  shows #days-missed
//   toggle PIH:NCD category    :244  shows {nickname}-onset-date, which :248 renders only for NCD Initial (ae06d311)
//   includeIf age at encounter < 13 :419, :489  last-vitals MUAC cell (#last_muac_mm) and the MUAC radios (#muac-results)
//   ifMode VIEW include=true / false :465, :475   the BP obs twice (same ids, never rendered together: the lead "duplicate id" is no defect)
// Scripts (:45-161): on load it GETs /ws/rest/v1/visit/<visit> with its encounters and obs, and for the first Vitals encounter that has obs
//   fills #last_* (BP x2, HR, temperature, MUAC, respiratory rate, O2 sat, weight, height, FBG/RBG) and shows #lastVitals; BMI = weight /
//   (height/100)^2, 1 decimal. Then setUpNextAndSubmitButtons() (see _shared.e2e.md). It also runs in VIEW.
// Side effects on save: <enrollInProgram programId="NCD" locationTag="Program Location"> (:231), tested.
// Not covered here: Next (needs the visit page), FBG/RBG, the second BP set, the onset-date obs, the "last vitals" date and time text.
// EDIT is covered by the save test; VIEW by the save test (generic check on the safe fields) and targeted tests for the custom labels.
//
// Findings (V1.. High -> Low):
//   V1 Low  :87-152   "most recent vitals" takes the first Vitals encounter with obs in the REST order of the visit, then `break`s: with two
//                     Vitals encounters in one visit the one shown depends on that order (unconfirmed).
//   V2 Low  :508-511  BMI answers CIEL:115115 (concept "Obesity") and CIEL:133952 ("Morbid Obesity") are labelled "Moderate obese
//                     (BMI 30.0 - 34.9)" and "Severe obese (BMI 35.0 - 39.9)": labels and concepts differ (unconfirmed which is intended).
//   V3 Info :244-249  the onset dates exist only for NCD Initial, and no Liberia parent shows this section for NCD Initial (reachable by URL).
//   V4 Info :70-76    unused JS variables (`currentEncounterDate`, `serverEncounterDate`, `options`, `patientUuid`); `$encounterDate` is a
//                     #set inside the complexExpression, not an undefined macro.

const FORM = 'section-ncd-followup.xml';
const PATIENT = { givenName: 'AutoNcdVisit', familyName: 'Tester', gender: 'F' as const };
const yes = /^yes$/i;
const no = /^no$/i;
const numberOf = (n: number) => new RegExp(`^${n}(\\.0)?$`);

// Concept uuids the form's script reads (:50-51).
const WEIGHT_CONCEPT_UUID = '3ce93b62-26fe-102b-80cb-0017a47871b2';
const HEIGHT_CONCEPT_UUID = '3ce93cf2-26fe-102b-80cb-0017a47871b2';

// Records a Vitals encounter (weight, height) in the visit of the section encounter.
const addVitals = async (api: APIRequestContext, section: SectionEncounter, weightKg: number, heightCm: number) => {
  const now = new Date().toISOString();
  const res = await api.post('encounter', {
    data: {
      patient: section.patient.uuid,
      encounterType: VITALS_ENCOUNTER_TYPE_UUID,
      location: NCD_CLINIC_LOCATION_UUID,
      encounterDatetime: now,
      visit: section.encounter.visitUuid,
      obs: [
        { concept: WEIGHT_CONCEPT_UUID, value: weightKg, obsDatetime: now },
        { concept: HEIGHT_CONCEPT_UUID, value: heightCm, obsDatetime: now },
      ],
    },
  });
  expect(res.ok(), `create vitals encounter: ${res.status()}`).toBeTruthy();
};

test.describe('section-ncd-followup (NCD Followup encounter)', () => {
  let section: SectionEncounter;

  test.beforeEach(async ({ page, createSectionEncounter }) => {
    section = await createSectionEncounter({ encounterTypeUuid: NCD_FOLLOWUP_ENCOUNTER_TYPE_UUID, patient: PATIENT });
    await SectionFormPage.openEdit(page, FORM, section);
  });

  test('offers the Patient Details section, the heading and Next / Save / Cancel', async ({ page }) => {
    // includeIf :166, state "NCD Followup"; ifMode :39, :532
    await expect(page.locator('#visit-details')).toBeVisible();
    await expect(page.locator('h1:not(.name)')).toBeVisible();
    await expect(page.locator('#buttons #next')).toBeVisible();
    await expect(page.locator('#buttons #submit')).toBeVisible();
    await expect(page.locator('#buttons #cancel')).toBeVisible();
    await expect(page.locator('#diabetes-onset-date')).toHaveCount(0); // includeIf :248, state "not NCD Initial"
  });

  test('social support "yes" shows the support types; "no" hides and clears them', async ({ page }) => {
    // when :188
    const target = page.locator('#specify-support');
    await expect(target).toBeHidden();
    await page.locator('#social-support').getByLabel(yes).check();
    await expect(target).toBeVisible();
    await target.getByLabel('Transport', { exact: true }).check();
    await page.locator('#social-support').getByLabel(no).check();
    await expect(target).toBeHidden();
    await page.locator('#social-support').getByLabel(yes).check();
    await expect(target.getByLabel('Transport', { exact: true })).not.toBeChecked();
  });

  test('missed school "yes" shows the days of lost schooling', async ({ page }) => {
    // when :209
    await expect(page.locator('#days-missed')).toBeHidden();
    await page.locator('#missed-school').getByLabel(yes).check();
    await expect(page.locator('#days-missed')).toBeVisible();
    await page.locator('#missed-school').getByLabel(no).check();
    await expect(page.locator('#days-missed')).toBeHidden();
  });

  test('the MUAC radios are not offered to an adult', async ({ page }) => {
    // includeIf :489 and :419, state "age at encounter >= 13"
    await expect(page.locator('#muac-results')).toHaveCount(0);
    await expect(page.locator('#last_muac_mm')).toHaveCount(0);
    await expect(page.locator('#bmi-results')).toBeVisible();
  });

  test('shows no "last vitals" block when the visit has no Vitals encounter', async ({ page }) => {
    // script :80: nothing to show
    await expect(page.locator('#lastVitals')).toBeHidden();
  });

  test('shows the last vitals of the visit with the BMI computed from weight and height', async ({ page, api }) => {
    // script :80-157 (assumes `.show()` overrides the `hidden` class of #lastVitals; doubt: bootstrap's `.hidden { display: none !important }`)
    await addVitals(api, section, 70, 170);
    await SectionFormPage.openEdit(page, FORM, section);
    await expect(page.locator('#lastVitals')).toBeVisible();
    await expect(page.locator('#last_weight')).toHaveText('70');
    await expect(page.locator('#last_height')).toHaveText('170');
    await expect(page.locator('#last_bmi')).toHaveText('24.2'); // 70 / 1.7^2
  });

  test('saves the visit information, enrols the patient in the NCD program, and EDIT and VIEW show it again', async ({ page, api }) => {
    await page.locator('#social-support').getByLabel(yes).check();
    await page.locator('#missed-school').getByLabel(no).check();
    await page.locator('#diabetes-onset-q input[type=checkbox]').check();
    await page.locator('#bp_systolic input').fill('120');
    await page.locator('#bp_diastolic input').fill('80');
    await page.locator('textarea').fill('Stable, continue treatment');
    await new SectionFormPage(page, FORM).save();
    await new SectionFormPage(page, FORM).expectSaved();

    const obs = await getEncounterObs(api, section.encounter.uuid);
    const values = obs.map((o) => (o.value && typeof o.value === 'object' ? String((o.value as { display: string }).display) : o.value));
    expect(values).toContain('Stable, continue treatment');
    expect(values).toEqual(expect.arrayContaining([120, 80]));
    expect(obs.map((o) => `${o.concept.display}: ${o.display}`.toLowerCase()).some((d) => d.includes('diabetes'))).toBeTruthy();

    // <enrollInProgram programId="NCD"> :231
    const res = await api.get(`programenrollment?patient=${section.patient.uuid}&v=custom:(program:(name))`);
    expect(res.ok()).toBeTruthy();
    const enrollments = (await res.json()).results as Array<{ program: { name: string } }>;
    expect(enrollments.some((e) => /ncd/i.test(e.program.name))).toBeTruthy();

    // EDIT starts from the saved values (the `when` of :188 shows its target for "yes")
    await SectionFormPage.openEdit(page, FORM, section);
    await expect(page.locator('#social-support').getByLabel(yes)).toBeChecked();
    await expect(page.locator('#specify-support')).toBeVisible();
    await expect(page.locator('#missed-school').getByLabel(no)).toBeChecked();
    await expect(page.locator('#days-missed')).toBeHidden();
    await expect(page.locator('#diabetes-onset-q input[type=checkbox]')).toBeChecked();
    await expect(page.locator('#bp_systolic input')).toHaveValue(/^120(\.0)?$/);
    await expect(page.locator('textarea')).toHaveValue('Stable, continue treatment');

    // VIEW: the saved text, number and Yes/No / category values; the VIEW branch of the BP obs (:465), no heading, no buttons
    const view = await expectViewShowsSavedObs(page, api, FORM, section.encounter.uuid);
    const shown = await view.valueTexts();
    expect(shown).toContain('Stable, continue treatment');
    expect(shown).toContain('[X] Diabetes');
    expect(shown.some((t) => numberOf(120).test(t))).toBeTruthy();
    expect(shown.some((t) => numberOf(80).test(t))).toBeTruthy();
    await expect(view.page.locator('#bp_systolic .value')).toHaveText(numberOf(120));
    await expect(view.page.locator('#social-support .value')).toHaveText(/\[X\]\s*yes/i);
    await expect(view.page.locator('#days-missed .value, #specify-support .value')).toHaveCount(0); // nothing saved there
    await expect(view.page.locator('h1')).toHaveCount(0);
    await expect(view.page.locator('#buttons, #next, #submit')).toHaveCount(0);
  });

  test('VIEW: shows the answers whose label differs from the concept name', async ({ page, api }) => {
    await page.locator('#visit-details').getByLabel(/^Scheduled$/i).check();
    await page.locator('#social-support').getByLabel(yes).check();
    await page.locator('#specify-support').getByLabel('Transport', { exact: true }).check();
    await page.locator('#bmi-results').getByLabel(/^Normal/).check();
    await new SectionFormPage(page, FORM).save();
    await new SectionFormPage(page, FORM).expectSaved();

    // The generic check is not used: "Scheduled", "Transport" and "Normal (BMI ...)" are answerCodes, the concepts are named differently.
    const view = await ViewFormPage.open(page, FORM, section.encounter.uuid);
    const shown = await view.valueTexts();
    expect(shown.some((t) => /^\[X\]\s*Scheduled/.test(t))).toBeTruthy();
    expect(shown).toContain('[X] Transport');
    expect(shown.some((t) => /^\[X\]\s*Normal \(BMI/.test(t))).toBeTruthy();
    await expect(view.page.locator('#muac-results')).toHaveCount(0);
  });
});

test.describe('section-ncd-followup (child)', () => {
  test('offers the MUAC radios and the MUAC of the last vitals to a patient under 13', async ({ page, createSectionEncounter }) => {
    // includeIf :489 and :419, state "age at encounter < 13"
    const section = await createSectionEncounter({
      encounterTypeUuid: NCD_FOLLOWUP_ENCOUNTER_TYPE_UUID,
      patient: { givenName: 'AutoNcdChild', familyName: 'Tester', gender: 'M', birthdate: birthdateYearsAgo(5) },
    });
    await SectionFormPage.openEdit(page, FORM, section);
    await expect(page.locator('#muac-results')).toBeVisible();
    await expect(page.locator('#muac-results').getByLabel(/^green$/i)).toBeVisible();
    await expect(page.locator('#last_muac_mm')).toHaveCount(1);
  });
});

test.describe('section-ncd-followup (NCD Initial encounter)', () => {
  let section: SectionEncounter;

  test.beforeEach(async ({ page, createSectionEncounter }) => {
    section = await createSectionEncounter({ encounterTypeUuid: NCD_INITIAL_ENCOUNTER_TYPE_UUID, patient: PATIENT });
    await SectionFormPage.openEdit(page, FORM, section);
  });

  test('does not offer the Patient Details section for an NCD Initial encounter', async ({ page }) => {
    // includeIf :166, state "not NCD Followup"
    await expect(page.locator('#visit-details')).toHaveCount(0);
    await expect(page.locator('#social-support')).toHaveCount(0);
    await expect(page.locator('#ncd_info')).toBeVisible();
  });

  test('ticking an NCD category shows its onset date; unticking hides it (V3)', async ({ page }) => {
    // toggle :244 with includeIf :248, state "NCD Initial"
    const onset = page.locator('#diabetes-onset-date');
    await expect(onset).toBeHidden();
    await page.locator('#diabetes-onset-q input[type=checkbox]').check();
    await expect(onset).toBeVisible();
    await page.locator('#diabetes-onset-q input[type=checkbox]').uncheck();
    await expect(onset).toBeHidden();
  });
});

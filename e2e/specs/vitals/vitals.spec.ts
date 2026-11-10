import { type Page, type APIRequestContext } from '@playwright/test';
import { test, expect, birthdateYearsAgo, type CustomTestFixtures, type EntryContext } from '../../core';
import { VITALS_ENCOUNTER_TYPE_UUID } from '../../core/constants';
import { getEncounterObs, getPatientEncounters } from '../../commands';
import { EntryFormPage, expectViewShowsSavedObs, VISIT_PAGE_URL, visitPagePath } from '../../pages';

// vitals.xml v2.2: the one-question-per-screen (Simple UI) "Vitals": height, weight, BMI, temperature, pulse, respiratory rate, BP, SpO2,
// random / fasting glucose, HbA1c, MUAC, head circumference, MUAC/HC ratio, chief complaint. Production opens it in the Simple UI (visit
// action, home app and edit, _availability.e2e.md), so every test does too (local helper openSimple, direct URL in a visit the fixture
// creates); availability (Vitals Location tag, retro privilege) is not exercised. The visit is open, so provider, location and date are
// hidden defaults (current user, session location, now): no Details question. First written without a server (locators from the XML), then run and fixed against a local Liberia server: see README.md.
//
// Conditions in the form, from documentation inventory (vitals.inv.md); ages are as of today (ENTER):
//   includeIf age > 5            :149, :507   BMI script / BMI question; the same block adds class "expected" to the BP inputs (:192)
//   includeIf age < 13 or female :234, :628   cm<->mm script / MUAC question (cm input + mm obs)
//   includeIf age < 3            :318, :667   ratio script / head circumference + MUAC/HC ratio questions
//   includeIf $visit.open :395 / !open + retro privilege :410-:455   hidden defaults / editable provider, location, date (closed visit,
//     not covered); the two #encounterDate (:401, :450) sit in these exclusive branches, so the inventory's duplicate-id lead is a false positive
//   ifMode VIEW (include true/false) :19-:644  view-only vs entry-only blocks (VIEW: on the visit page)
// Scripts: ExitHandlers :90-143 inches -> cm (x2.54), lbs -> kg (/2.2), Fahrenheit -> Celsius ((F-32)*5/9), one decimal, source field
//   cleared; BMI :152-188 = kg/(cm/100)^2, one decimal, hidden while weight or height is missing; cm -> mm (x10) :252-258 and mm -> cm
//   (/10) :262-270 on leaving the MUAC question, cm shown again from the saved mm on load (EDIT :276-281); ratio :320-356 = (mm/10)/HC;
//   VIEW scripts :201-228 (BMI), :288-311 (MUAC in cm, "____" when none), :361-387 (ratio). The converter inputs carry min/max (inches 4-89,
//   lbs 0.3-550, F 77-109, cm 5-30): a violation shows "Minimum: n" / "Maximum: n" and blocks moving forward.
// Side effects on save: none (no program, order or disposition). Encounter type 4fb47712-... (Vitals). Converter inputs are not saved.
// Not covered: the closed-visit provider/location/date fieldset (needs a closed visit and retro privilege), EPLD (not used here), the
//   Standard UI beyond V3, visit-page launch gating. VIEW: saved values, BMI / MUAC-in-cm / ratio computed by the VIEW scripts.
//
// Findings:
//   V1 Medium :252-270  cmExitHandler converts cm -> mm whenever the cm field has a value, on every exit from the MUAC question: once cm was
//                       typed or (EDIT :276-281) prefilled, a new mm value is replaced by cm*10 (same code as zl-emr vitals_v2.2 V1, which
//                       reproduced it). Fix: convert only the field that changed (clear the other). (TESTED with test.fail, ENTER)
//   V2 Low    :237-239  convertCmToMm = cm*10 unrounded: 15.35 cm writes 153.5 into the integer-only mm obs (OCL: allow_decimal=false),
//                       which then fails on a field the user did not type. Fix: Math.round(cm * 10).
//   V3 Info   :90-143, :252-273  ExitHandlers exists only in the Simple UI: a Standard UI entry throws "ExitHandlers is not defined" and no
//                       converter runs (users never open it that way).
//   V4 Info   :192-197  "expected" is added to the BP inputs only when age > 5 (inside the BMI includeIf); :264 console.log('mm') left in.

const FORM = 'vitals.xml';

// Local helpers.
const openSimple = async (page: Page, context: EntryContext) => {
  await page.goto(EntryFormPage.enterUrl(FORM, context).replace('enterHtmlFormWithStandardUi', 'enterHtmlFormWithSimpleUi'));
  await page.waitForLoadState('networkidle');
  await expect(page.locator('li.question-legend').first()).toBeVisible();
};
const editSimple = async (page: Page, context: EntryContext, encounterUuid: string) => {
  const params = new URLSearchParams({
    patientId: context.patient.uuid,
    visitId: context.visitUuid,
    encounterId: encounterUuid,
    definitionUiResource: `file:configuration/pih/htmlforms/${FORM}`,
    returnUrl: visitPagePath(context.visitUuid),
  });
  await page.goto(`htmlformentryui/htmlform/editHtmlFormWithSimpleUi.page?${params.toString()}`);
  await page.waitForLoadState('networkidle');
  await expect(page.locator('li.question-legend').first()).toBeVisible();
};
// The first breadcrumb li holds every label run together, hence the anchored regex.
const goTo = async (page: Page, label: string) => {
  await page.locator('#formBreadcrumb li', { hasText: new RegExp(`^\\s*${label}\\s*$`) }).click();
};
const fillQuestion = async (page: Page, label: string, selector: string, value: string) => {
  await goTo(page, label);
  await page.locator(selector).fill(value);
};
const saveSimple = async (page: Page) => {
  await goTo(page, 'Confirm');
  await page.locator('#confirmationQuestion button.submitButton').click();
  await expect(page).toHaveURL(VISIT_PAGE_URL);
};
const newPatient = (createEntryContext: CustomTestFixtures['createEntryContext'], gender: 'M' | 'F', age: number) =>
  createEntryContext({ givenName: 'AutoVitals', familyName: 'Tester', gender, birthdate: birthdateYearsAgo(age) });
const savedVitals = async (api: APIRequestContext, patientUuid: string) => {
  const encounters = await getPatientEncounters(api, patientUuid);
  expect(encounters).toHaveLength(1);
  expect(encounters[0].encounterType.uuid).toBe(VITALS_ENCOUNTER_TYPE_UUID);
  return {
    encounterUuid: encounters[0].uuid,
    displays: (await getEncounterObs(api, encounters[0].uuid)).map((o) => o.display),
  };
};
// An adult woman with a full set of answers (13 obs); returns the encounter for the EDIT and VIEW tests.
const saveFullVitals = async (page: Page, api: APIRequestContext, context: EntryContext) => {
  await openSimple(page, context);
  await fillQuestion(page, 'Height', '#height_cm input', '170');
  await fillQuestion(page, 'Weight', '#weight_kg input', '70');
  await fillQuestion(page, 'Temperature', '#temperature_c input', '37.5');
  await fillQuestion(page, 'Heart Rate', '#heart_rate input', '80');
  await fillQuestion(page, 'Respiratory Rate', '#respiratory_rate input', '18');
  await fillQuestion(page, 'Blood Pressure', '#bp_systolic input', '120');
  await page.locator('#bp_diastolic input').fill('80');
  await fillQuestion(page, 'SpO2', '#o2_sat input', '98');
  await fillQuestion(page, 'Blood Glucose \\(RBS\\)', '#glucose_after_meal input', '110');
  await fillQuestion(page, 'Blood Glucose \\(FBS\\)', '#fasting_glucose_test input', '95');
  await fillQuestion(page, 'HbA1C', '#HbA1C input', '6.5');
  await fillQuestion(page, 'MUAC', '#muac_cm', '15');
  await fillQuestion(page, 'Chief Complaint', '#chief_complaint input', 'cough');
  await saveSimple(page);
  return savedVitals(api, context.patient.uuid);
};

test.describe('vitals', () => {
  // includeIf :149/:507 (BMI + "expected"), :234/:628 (MUAC), :318/:667 (head circumference + ratio)
  const profiles = [
    { name: 'adult woman', gender: 'F', age: 30, bmi: true, muac: true, head: false },
    { name: 'adult man (no MUAC question)', gender: 'M', age: 30, bmi: true, muac: false, head: false },
    { name: '13 year old boy', gender: 'M', age: 13, bmi: true, muac: false, head: false },
    { name: '12 year old boy', gender: 'M', age: 12, bmi: true, muac: true, head: false },
    { name: '5 year old boy (age > 5 is false)', gender: 'M', age: 5, bmi: false, muac: true, head: false },
    { name: '3 year old girl (age < 3 is false)', gender: 'F', age: 3, bmi: false, muac: true, head: false },
    { name: '2 year old boy', gender: 'M', age: 2, bmi: false, muac: true, head: true },
  ] as const;

  for (const p of profiles) {
    test(`age/gender conditional questions for the ${p.name}`, async ({ page, createEntryContext }) => {
      const context = await newPatient(createEntryContext, p.gender, p.age);
      await openSimple(page, context);
      await expect(page.locator('#weight_kg')).toHaveCount(1);

      await expect(page.locator('#calculated-bmi-wrapper')).toHaveCount(p.bmi ? 1 : 0);
      await expect(page.locator('#bp_systolic > input.expected')).toHaveCount(p.bmi ? 1 : 0); // :192, V4
      await expect(page.locator('#bp_diastolic > input.expected')).toHaveCount(p.bmi ? 1 : 0);
      await expect(page.locator('#muac_cm')).toHaveCount(p.muac ? 1 : 0);
      await expect(page.locator('#muac_mm')).toHaveCount(p.muac ? 1 : 0);
      await expect(page.locator('#formBreadcrumb li', { hasText: /^\s*MUAC\s*$/ })).toHaveCount(p.muac ? 1 : 0);
      await expect(page.locator('#head_cm')).toHaveCount(p.head ? 1 : 0);
      await expect(page.locator('#calculated-ratio-wrapper')).toHaveCount(p.head ? 1 : 0);
    });
  }

  test('the entry-only converter inputs (inches, lbs, Fahrenheit, MUAC cm) are rendered in ENTER', async ({ page, createEntryContext }) => {
    // ifMode VIEW include=false :463, :487, :536, :644 (absent in VIEW, see the VIEW test)
    const context = await newPatient(createEntryContext, 'F', 30);
    await openSimple(page, context);
    await expect(page.locator('#height_inches, #weight_lbs, #temperature_f, #muac_cm')).toHaveCount(4);
  });

  test('Simple UI: inches, lbs and Fahrenheit fill the metric fields and clear the source field; BMI follows', async ({ page, createEntryContext }) => {
    // ExitHandlers :90-143: 70 in = 177.8 cm, 154 lb = 70.0 kg, 100 F = 37.8 C; BMI = 70 / 1.778^2 = 22.1
    const context = await newPatient(createEntryContext, 'F', 30);
    await openSimple(page, context);
    await fillQuestion(page, 'Height', '#height_inches', '70');
    await fillQuestion(page, 'Weight', '#weight_lbs', '154');
    await expect(page.locator('#height_cm input')).toHaveValue('177.8');
    await expect(page.locator('#height_inches')).toHaveValue('');
    await goTo(page, '\\(Calculated\\) BMI');
    await expect(page.locator('#weight_kg input')).toHaveValue('70.0');
    await expect(page.locator('#weight_lbs')).toHaveValue('');
    await expect(page.locator('#calculated-bmi')).toHaveText('22.1');
    await fillQuestion(page, 'Temperature', '#temperature_f', '100');
    await goTo(page, 'Heart Rate');
    await expect(page.locator('#temperature_c input')).toHaveValue('37.8');
    await expect(page.locator('#temperature_f')).toHaveValue('');
  });

  test('Simple UI: BMI is shown only when both weight and height have a value', async ({ page, createEntryContext }) => {
    // updateBmi :165-179: hide the value and keep the instructions when either is missing
    const context = await newPatient(createEntryContext, 'M', 30);
    await openSimple(page, context);
    await fillQuestion(page, 'Height', '#height_cm input', '170');
    await goTo(page, '\\(Calculated\\) BMI');
    await expect(page.locator('#calculated-bmi-wrapper')).toBeHidden();
    await expect(page.locator('#no-calculated-bmi')).toBeVisible();
    await fillQuestion(page, 'Weight', '#weight_kg input', '70');
    await goTo(page, '\\(Calculated\\) BMI');
    await expect(page.locator('#calculated-bmi-wrapper')).toBeVisible();
    await expect(page.locator('#calculated-bmi')).toHaveText('24.2');
    await expect(page.locator('#no-calculated-bmi')).toBeHidden();
    await fillQuestion(page, 'Weight', '#weight_kg input', '');
    await goTo(page, '\\(Calculated\\) BMI');
    await expect(page.locator('#calculated-bmi-wrapper')).toBeHidden();
  });

  test('Simple UI: MUAC converts cm to mm, and mm to cm while cm is empty (adult woman)', async ({ page, createEntryContext }) => {
    // cmExitHandler :252-258, mmExitHandler :262-270
    const context = await newPatient(createEntryContext, 'F', 30);
    await openSimple(page, context);
    await fillQuestion(page, 'MUAC', '#muac_cm', '15');
    await goTo(page, 'Chief Complaint');
    await expect(page.locator('#muac_mm input')).toHaveValue('150');
    await page.reload();
    await page.waitForLoadState('networkidle');
    await fillQuestion(page, 'MUAC', '#muac_mm input', '200');
    await goTo(page, 'Chief Complaint');
    await expect(page.locator('#muac_cm')).toHaveValue('20');
  });

  // V1: remove test.fail() when fixed
  test.fail('V1 a MUAC typed in mm after one in cm replaces it, and cm follows', async ({ page, createEntryContext }) => {
    // :252-258: leaving the question writes cm*10 back into the mm obs whenever cm has a value
    const context = await newPatient(createEntryContext, 'F', 30);
    await openSimple(page, context);
    await fillQuestion(page, 'MUAC', '#muac_cm', '15');
    await goTo(page, 'Chief Complaint'); // leave: cm 15 -> mm 150
    await fillQuestion(page, 'MUAC', '#muac_mm input', '200');
    await goTo(page, 'Chief Complaint'); // leave: cmExitHandler writes 150 back
    await expect(page.locator('#muac_mm input')).toHaveValue('200');
    await expect(page.locator('#muac_cm')).toHaveValue('20');
  });

  test('Simple UI: the MUAC/HC ratio is calculated for a child under 3 and hidden while a value is missing', async ({ page, createEntryContext }) => {
    // ratio :333-347: (mm/10)/HC = (150/10)/50 = 0.3; the mm comes from cm 15 through the cm handler
    const context = await newPatient(createEntryContext, 'M', 2);
    await openSimple(page, context);
    await fillQuestion(page, 'MUAC', '#muac_cm', '15');
    await fillQuestion(page, 'Head Circumference', '#head_cm input', '50');
    await goTo(page, '\\(Calculated\\) MUAC/HC');
    await expect(page.locator('#calculated-ratio')).toHaveText('0.3');
    await expect(page.locator('#no-calculated-ratio')).toBeHidden();
    await fillQuestion(page, 'Head Circumference', '#head_cm input', '');
    await goTo(page, '\\(Calculated\\) MUAC/HC');
    await expect(page.locator('#calculated-ratio-wrapper')).toBeHidden();
  });

  test('a converter input outside its range shows the message and blocks moving forward', async ({ page, createEntryContext }) => {
    // min/max on the free inputs: MUAC cm 5-30 (:647), Fahrenheit 77-109 (:539)
    const context = await newPatient(createEntryContext, 'F', 30);
    await openSimple(page, context);
    await fillQuestion(page, 'MUAC', '#muac_cm', '4');
    await goTo(page, 'Chief Complaint');
    await expect(page.locator('span.field-error:visible', { hasText: 'Minimum: 5' })).toBeVisible();
    await expect(page.locator('li.question-legend.focused', { hasText: /^\s*MUAC\s*$/ })).toBeVisible();
    await page.locator('#muac_cm').fill('31');
    await goTo(page, 'Chief Complaint');
    await expect(page.locator('span.field-error:visible', { hasText: 'Maximum: 30' })).toBeVisible();
    await page.locator('#muac_cm').fill('15');
    await goTo(page, 'Chief Complaint');
    await expect(page.locator('#chief_complaint input')).toBeVisible();

    await fillQuestion(page, 'Temperature', '#temperature_f', '120');
    await goTo(page, 'Heart Rate');
    await expect(page.locator('span.field-error:visible', { hasText: 'Maximum: 109' })).toBeVisible();
    await expect(page.locator('li.question-legend.focused', { hasText: /^\s*Temperature\s*$/ })).toBeVisible();
  });

  test('a value outside the concept range (pulse 999) blocks the save', async ({ page, api, createEntryContext }) => {
    // numeric range of the concept (not form specific): pulse max 300
    const context = await newPatient(createEntryContext, 'M', 30);
    await openSimple(page, context);
    await fillQuestion(page, 'Heart Rate', '#heart_rate input', '999');
    await goTo(page, 'Confirm');
    await expect(page.locator('span.field-error:visible', { hasText: 'Maximum: 300' })).toBeVisible();
    await expect(page.locator('#confirmationQuestion button.submitButton')).toBeHidden();
    expect(await getPatientEncounters(api, context.patient.uuid)).toHaveLength(0);
  });

  test('saves the vitals as one Vitals encounter (13 obs); the cm field, the BMI and the converter inputs are not saved', async ({
    page,
    api,
    createEntryContext,
  }) => {
    const context = await newPatient(createEntryContext, 'F', 30);
    const { displays } = await saveFullVitals(page, api, context);

    expect(displays).toHaveLength(13);
    expect(displays).toEqual(
      expect.arrayContaining([
        'Height (cm): 170.0',
        'Weight (kg): 70.0',
        'Temperature (C): 37.5',
        'Pulse: 80',
        'Respiratory rate: 18',
        'Systolic: 120',
        'Diastolic: 80',
        'Blood oxygen saturation: 98',
        'Middle upper arm circumference (mm): 150',
        'Chief complaint (text): cough',
      ]),
    );
    expect(displays.some((d) => /post-prandial blood glucose.*110/i.test(d))).toBe(true); // CIEL:160914
    expect(displays.some((d) => /fasting blood glucose.*95/i.test(d))).toBe(true); // CIEL:160912
    expect(displays.some((d) => /hba1c.*6\.5/i.test(d))).toBe(true);
  });

  test('EDIT (Simple UI): the cm field and the BMI are filled again from the saved values', async ({ page, api, createEntryContext }) => {
    // on-load script :276-281 (cm from the saved mm); BMI :181-187 runs on load
    const context = await newPatient(createEntryContext, 'F', 30);
    const { encounterUuid } = await saveFullVitals(page, api, context);

    await editSimple(page, context, encounterUuid);
    await goTo(page, 'MUAC');
    await expect(page.locator('#muac_cm')).toHaveValue('15');
    await expect(page.locator('#muac_mm input')).toHaveValue('150');
    await goTo(page, '\\(Calculated\\) BMI');
    await expect(page.locator('#calculated-bmi')).toHaveText('24.2');
    await expect(page.locator('#heart_rate input')).toHaveValue('80');
  });

  test('EDIT (Simple UI): changing the weight replaces the saved weight and the BMI follows', async ({ page, api, createEntryContext }) => {
    const context = await newPatient(createEntryContext, 'F', 30);
    const { encounterUuid } = await saveFullVitals(page, api, context);

    await editSimple(page, context, encounterUuid);
    await fillQuestion(page, 'Weight', '#weight_kg input', '80');
    await goTo(page, '\\(Calculated\\) BMI');
    await expect(page.locator('#calculated-bmi')).toHaveText('27.7'); // 80 / 1.7^2
    await saveSimple(page);
    await expect
      .poll(async () => (await getEncounterObs(api, encounterUuid)).map((o) => o.display))
      .toEqual(expect.arrayContaining(['Weight (kg): 80.0']));
    expect((await getEncounterObs(api, encounterUuid)).map((o) => o.display)).not.toContain('Weight (kg): 70.0');
  });

  // VIEW :19-644 (on the visit page). The entry-only converter inputs (:463, :487, :536, :644) are ifMode VIEW include=false.
  test('VIEW: shows the saved values, no converter inputs and no Save button; unanswered head circumference is not offered to an adult', async ({
    page,
    api,
    createEntryContext,
  }) => {
    const context = await newPatient(createEntryContext, 'F', 30);
    const { encounterUuid } = await saveFullVitals(page, api, context);

    const view = (await expectViewShowsSavedObs(page, api, FORM, encounterUuid)).page;
    await expect(view.locator('#height_cm .value')).toContainText('170');
    await expect(view.locator('#weight_kg .value')).toContainText('70');
    await expect(view.locator('#temperature_c .value')).toContainText('37.5');
    await expect(view.locator('#bp_systolic .value')).toContainText('120');
    await expect(view.locator('#bp_diastolic .value')).toContainText('80');
    await expect(view.locator('#o2_sat .value')).toContainText('98');
    await expect(view.locator('#glucose_after_meal .value')).toContainText('110');
    await expect(view.locator('#fasting_glucose_test .value')).toContainText('95');
    await expect(view.locator('#HbA1C .value')).toContainText('6.5');
    await expect(view.locator('#muac_mm .value')).toContainText('150'); // saved in mm (the cm field is not an obs)
    await expect(view.locator('#chief_complaint .value')).toContainText('cough');
    await expect(view.locator('#head_cm')).toHaveCount(0); // :667, not offered to an adult
    await expect(view.locator('#height_inches, #weight_lbs, #temperature_f, #muac_cm, input.submitButton')).toHaveCount(0);
  });

  // VIEW scripts :201-228 (BMI), :288-311 (MUAC in cm), run by the harness the way the visit page runs them
  test('VIEW: the scripts compute the BMI and show the MUAC in cm', async ({ page, api, createEntryContext }) => {
    const context = await newPatient(createEntryContext, 'F', 30);
    const { encounterUuid } = await saveFullVitals(page, api, context);

    const view = (await expectViewShowsSavedObs(page, api, FORM, encounterUuid)).page;
    await expect(view.locator('#calculated-bmi')).toHaveText('24.2'); // 70 / 1.7^2
    await expect(view.locator('#muac_cm_display')).toHaveText('15'); // 150 mm
  });

  test('VIEW: a child under 3 gets the MUAC/HC ratio and no BMI; what was not filled in is not shown as a value', async ({ page, api, createEntryContext }) => {
    // VIEW script :361-387 (age < 3), no BMI block (:149)
    const context = await newPatient(createEntryContext, 'M', 2);
    await openSimple(page, context);
    await fillQuestion(page, 'MUAC', '#muac_mm input', '140');
    await fillQuestion(page, 'Head Circumference', '#head_cm input', '45');
    await saveSimple(page);
    const { encounterUuid } = await savedVitals(api, context.patient.uuid);

    const view = (await expectViewShowsSavedObs(page, api, FORM, encounterUuid)).page;
    await expect(view.locator('#head_cm .value')).toContainText('45');
    await expect(view.locator('#calculated-ratio')).toHaveText('0.3'); // (140 / 10) / 45
    await expect(view.locator('#muac_cm_display')).toHaveText('14');
    await expect(view.locator('#calculated-bmi-wrapper')).toHaveCount(0);
    await expect(view.locator('#height_cm .value, #weight_kg .value, #chief_complaint .value')).toHaveCount(0);
  });
});

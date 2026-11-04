import { type APIRequestContext, type Page } from '@playwright/test';
import { test, expect, type CustomTestFixtures, type EntryContext } from '../../core';
import { MEDICATION_DISPENSING_ENCOUNTER_TYPE_UUID, PHARMACY_LOCATION_UUID } from '../../core/constants';
import { getEncounterObs, getPatientEncounters } from '../../commands';
import { EntryFormPage, ViewFormPage, buttonsSubmit, viewMismatches, VISIT_PAGE_URL, visitPagePath } from '../../pages';

// dispensing.xml v1.0: "Dispensing": type and location of the prescription (required), the optional prescriber group and up to 7 medication
// blocks (drug, dose, unit, frequency, duration, route, amount, instructions). Opened with enterHtmlFormWithStandardUi inside a visit the
// fixture creates (the Standard UI visit action; the dispensing app's own launch URL is unverified, _availability.e2e.md); availability
// (App: dispensing.app.dispense, Task: mirebalais.dispensing, Dispensing Location tag) is not exercised. The harness user is the `admin` superuser,
// for whom $user.hasRole(...) is always true, so the sysAdmin block (:167) renders: provider, location and date selects in #who-where-when-view.
// The session location (NCD Clinic) has no Dispensing Location tag, so the location select starts blank: every save picks Pharmacy (a
// pharmacist-only user would get the :183 block instead: not covered). First written without a server (locators from the XML), then run and fixed against a local Liberia server: see README.md.
//
// Conditions in the form, from documentation inventory (dispensing.inv.md):
//   includeIf sysAdmin :167-181 / pharmacist roles and not sysAdmin :183-209  editable provider, location (tag Dispensing Location), date / hidden
//     provider and location + (ENTER) a read-only name and the location select + (not VIEW) the date; ifMode VIEW include=false :157, :331  h2, buttons
// Scripts: :63-155 a beforeValidation hook (the only validation; Save is not disabled): per fieldset.medication, if any input/select has a value
//   then every field except instructions (and duration + duration unit when the frequency label is "STAT") must be filled, else the block's
//   p.field-error shows "Missing required fields" and the save is blocked; if no block has a value the first block shows "All fields are
//   required!". Nothing else (no show/hide, no derived value). The required type and location of the prescription are server-side (required="true").
// Side effects on save: none (no postSubmissionAction, no orders); one Medication Dispensing encounter (8ff50dea-...) with one Dispensing
//   construct group per filled medication block (showIfEmpty=false). The drug is a remote autocomplete (drugSearch.form) saved as valueDrug.
// Not covered here: the pharmacist-role variant, the retired stock-out checkbox (:315-324 is commented out), blocks 3-7 (same markup as 1-2).
//
// Findings:
//   V1 High   :288   answerCodes "OD,BID,TID,QD,..." labels PIH:QID (four times daily) "QD" (once daily elsewhere: mentalHealth*, epilepsy* use
//                    "QD" for PIH:OD and "QID" for PIH:QID): the pharmacist who picks "QD" saves four times a day. Fix: "QID". (TESTED, test.fail)
//   V2 Medium :63-155 the script is outside any ifMode, so it also runs in VIEW (visit page), where htmlForm is undefined: "htmlForm is not
//                    defined" on load. Fix: wrap it in <ifMode mode="VIEW" include="false">. (TESTED, VIEW test.fail)
//   V3 Low    :219, :229  ids with spaces ("Timing of hospital prescription", "Discharge location"): #id selectors are invalid CSS. The specs use [id="..."].
//   V4 Low    :277   the Text-obs answers list "UI, Bottle, Tube" is split on "," only, so " Bottle" and " Tube" keep a leading space in the saved value.
//   V5 Low    :128   `.length = 0` assigns instead of comparing, so the blur handler always takes the else branch (only the re-highlighting is wrong).
//   V6 Low    :219-244 answerCodes "Discharge,Inpatient,OPD,Dr,RN,NA,PA" and the labels "Title" / "License #" are raw English, not message codes.
//   V7 Low    :183   roles pharmacyAide and pharmacyManager are not in roles_liberia.csv (only Application Role: pharmacist) (unconfirmed: other role files)

const FORM = 'dispensing.xml';
const DRUG = { search: 'Paracetamol', pick: '500mg tablet', name: 'Paracetamol, 500mg tablet' };
const DRUG_2 = { search: 'Acetylsalicylic', pick: '81mg tablet', name: 'Acetylsalicylic acid, 81mg tablet' };
const newPatient = (createEntryContext: CustomTestFixtures['createEntryContext']) =>
  createEntryContext({ givenName: 'AutoDispense', familyName: 'Tester', gender: 'F' });

const whoWhereWhen = (page: Page) => page.locator('#who-where-when-view');
const locationSelect = (page: Page) =>
  whoWhereWhen(page).locator('select').filter({ has: page.locator('option', { hasText: 'Pharmacy' }) }).first();
const medication = (page: Page, n: number) => page.locator('fieldset.medication').nth(n - 1);
const medError = (page: Page, n: number) => medication(page, n).locator('p.field-error');
const submit = (page: Page) => buttonsSubmit(page);

// The provider select (first select of the table, "Choose a Provider" first): keep the preselected current user, else pick the configured one.
const ensureProvider = async (page: Page) => {
  const select = whoWhereWhen(page).locator('select').first();
  if ((await select.count()) === 0 || !(await select.isVisible()) || (await select.inputValue()) !== '') {
    return;
  }
  const providerName = process.env.E2E_DEFAULT_PROVIDER_NAME;
  const labels = await select.locator('option').allTextContents();
  if (providerName && labels.includes(providerName)) {
    await select.selectOption({ label: providerName });
  } else {
    await select.selectOption({ index: 1 });
  }
};
const chooseLocation = async (page: Page, label = 'Pharmacy') => {
  await locationSelect(page).selectOption({ label });
};
const fillPrescription = async (page: Page) => {
  await page.locator('[id="Timing of hospital prescription"]').getByLabel('Inpatient', { exact: true }).check();
  await page.locator('[id="Discharge location"] select').selectOption({ label: 'NCD Clinic' });
};
const pickDrug = async (page: Page, n: number, drug: { search: string; pick: string }) => {
  const input = page.locator(`#name${n} input.ui-autocomplete-input`);
  await input.click();
  await input.pressSequentially(drug.search, { delay: 40 });
  await page.locator('ul.ui-autocomplete li', { hasText: drug.pick }).first().click();
  await expect(page.locator(`#name${n} input[type="hidden"]`)).toHaveValue(/^Drug:\d+$/);
};
const fillMedication = async (
  page: Page,
  n: number,
  o: { drug?: { search: string; pick: string }; frequency?: string; duration?: boolean; instructions?: string } = {},
) => {
  await pickDrug(page, n, o.drug ?? DRUG);
  await page.locator(`#dose${n} input`).fill('2');
  await page.locator(`#doseUnit${n} select`).selectOption({ label: 'Tablet' });
  await page.locator(`#frequencyCoded${n} select`).selectOption({ label: o.frequency ?? 'BID' });
  if (o.duration !== false) {
    await page.locator(`#duration${n} input`).fill('5');
    await page.locator(`#durationUnit${n} select`).selectOption({ label: 'Days' });
  }
  await page.locator(`#route-${n} select`).selectOption({ label: 'Oral' });
  await page.locator(`#amount${n} input`).fill('20');
  if (o.instructions) {
    await page.locator(`#instructions${n} input`).fill(o.instructions);
  }
};
const openForm = async (page: Page, context: EntryContext) => {
  const form = await EntryFormPage.open(page, FORM, context);
  await expect(page.locator('#typePrescription')).toBeVisible();
  await ensureProvider(page);
  return form;
};
const savedEncounter = async (api: APIRequestContext, patientUuid: string) => {
  const encounters = await getPatientEncounters(api, patientUuid);
  expect(encounters.map((e) => e.encounterType.uuid)).toEqual([MEDICATION_DISPENSING_ENCOUNTER_TYPE_UUID]);
  return { encounterUuid: encounters[0].uuid, obs: await getEncounterObs(api, encounters[0].uuid) };
};
// Two medication blocks, the prescriber group and the Pharmacy location; returns what the EDIT and VIEW tests need.
const saveFull = async (page: Page, api: APIRequestContext, createEntryContext: CustomTestFixtures['createEntryContext']) => {
  const context = await newPatient(createEntryContext);
  const form = await openForm(page, context);
  await chooseLocation(page);
  await fillPrescription(page);
  await page.locator('.provider input[type="text"]').nth(0).fill('Test Prescriber');
  await page.locator('.provider').getByLabel('Dr', { exact: true }).check();
  await page.locator('.provider input[type="text"]').nth(1).fill('12345');
  await fillMedication(page, 1, { instructions: 'after meals' });
  await fillMedication(page, 2, { drug: DRUG_2, frequency: 'OD' });
  await submit(page).click();
  await form.expectSaved();
  return { context, ...(await savedEncounter(api, context.patient.uuid)) };
};

test.describe('dispensing', () => {
  // includeIf sysAdmin :167 + encounterLocation tags "Dispensing Location" :175
  test('the location select offers only the Dispensing Location locations and starts blank at a session location without the tag', async ({
    page,
    createEntryContext,
  }) => {
    await openForm(page, await newPatient(createEntryContext));
    const names = (await locationSelect(page).locator('option').allTextContents()).map((t) => t.trim()).filter((t) => t !== '');
    expect(names).toEqual(expect.arrayContaining(['Pharmacy', 'MCH Clinic', 'Mental Health Clinic']));
    expect(names).not.toContain('NCD Clinic');
    expect(names).not.toContain('Records Room');
    await expect(locationSelect(page)).toHaveValue(''); // the session location NCD Clinic is not in the list
  });

  // script :149-151
  test('Save with nothing entered shows "All fields are required!" on the first medication and saves nothing', async ({ page, api, createEntryContext }) => {
    const context = await newPatient(createEntryContext);
    await openForm(page, context);
    await submit(page).click();
    await expect(medError(page, 1)).toHaveText('All fields are required!');
    await expect(page).not.toHaveURL(VISIT_PAGE_URL);
    expect(await getPatientEncounters(api, context.patient.uuid)).toHaveLength(0);
  });

  // script :71-90 requiredAndEmpty, :121 message
  test('a medication block with only some fields filled shows "Missing required fields" and blocks the save', async ({ page, api, createEntryContext }) => {
    const context = await newPatient(createEntryContext);
    await openForm(page, context);
    await chooseLocation(page);
    await fillPrescription(page);
    await page.locator('#dose1 input').fill('2');
    await submit(page).click();
    await expect(medError(page, 1)).toHaveText('Missing required fields');
    await expect(medError(page, 2)).toHaveText('');
    await expect(page).not.toHaveURL(VISIT_PAGE_URL);
    expect(await getPatientEncounters(api, context.patient.uuid)).toHaveLength(0);
  });

  // required="true" :219, :229 are server-side: the client hook passes with one complete medication
  test('a complete medication without the type of prescription is refused as Required', async ({ page, api, createEntryContext }) => {
    const context = await newPatient(createEntryContext);
    await openForm(page, context);
    await chooseLocation(page);
    await page.locator('[id="Discharge location"] select').selectOption({ label: 'NCD Clinic' });
    await fillMedication(page, 1);
    await submit(page).click();
    await expect(page.locator('span.field-error', { hasText: /required/i }).first()).toBeVisible();
    await expect(page).not.toHaveURL(VISIT_PAGE_URL);
    expect(await getPatientEncounters(api, context.patient.uuid)).toHaveLength(0);
  });

  // EPLD-style widget :175: an encounter needs a location; the preselect is blank here
  test('a complete form without a dispensing location is refused as Required', async ({ page, api, createEntryContext }) => {
    const context = await newPatient(createEntryContext);
    await openForm(page, context);
    await fillPrescription(page);
    await fillMedication(page, 1);
    await submit(page).click();
    await expect(page.locator('span.field-error', { hasText: /required/i }).first()).toBeVisible();
    await expect(page).not.toHaveURL(VISIT_PAGE_URL);
    expect(await getPatientEncounters(api, context.patient.uuid)).toHaveLength(0);
  });

  // script :84-85: duration and duration unit are optional only when the frequency label is "STAT"
  test('STAT makes the duration optional; any other frequency requires it', async ({ page, api, createEntryContext }) => {
    const context = await newPatient(createEntryContext);
    const form = await openForm(page, context);
    await chooseLocation(page);
    await fillPrescription(page);
    await fillMedication(page, 1, { duration: false, frequency: 'BID' });
    await submit(page).click();
    await expect(medError(page, 1)).toHaveText('Missing required fields');
    expect(await getPatientEncounters(api, context.patient.uuid)).toHaveLength(0);

    await page.locator(`#frequencyCoded1 select`).selectOption({ label: 'STAT' });
    await submit(page).click();
    await form.expectSaved();
    const { obs } = await savedEncounter(api, context.patient.uuid);
    const displays = obs.map((o) => o.display);
    expect(displays.some((d) => /^Medication frequency: STAT/i.test(d))).toBe(true);
    expect(displays.some((d) => /^Medication duration/i.test(d))).toBe(false);
    expect(obs.some((o) => o.concept.display === 'Prescriber construct')).toBe(false); // the prescriber is optional
  });

  // V1: remove test.fail() when the label is fixed
  test.fail('V1 the frequency for PIH:QID is offered as "QID", not "QD"', async ({ page, createEntryContext }) => {
    // answerCodes :288 has "QD" in the position of PIH:QID (the 4th answer)
    await openForm(page, await newPatient(createEntryContext));
    const labels = (await page.locator('#frequencyCoded1 select option').allTextContents()).map((t) => t.trim());
    expect(labels).toContain('QID');
    expect(labels).not.toContain('QD');
  });

  test('saves two medications and the prescriber as one Dispensing encounter at the chosen location', async ({ page, api, createEntryContext }) => {
    const { encounterUuid, obs } = await saveFull(page, api, createEntryContext);
    const displays = obs.map((o) => o.display);

    expect(obs.filter((o) => o.concept.display === 'Dispensing construct')).toHaveLength(2); // showIfEmpty=false: blocks 3-7 are not saved
    expect(obs.filter((o) => o.concept.display === 'Prescriber construct')).toHaveLength(1);
    expect(displays.some((d) => /^Timing of hospital prescription: Hospitalized/i.test(d))).toBe(true);
    expect(obs.some((o) => o.concept.display === 'Discharge location')).toBe(true); // location id as text
    expect(displays.some((d) => /^Name of clinician \(text\): Test Prescriber/i.test(d))).toBe(true);
    expect(displays.some((d) => /^Type of provider: Doctor/i.test(d))).toBe(true);
    expect(displays.some((d) => /^License identifier number: 12345/i.test(d))).toBe(true);
    expect(displays.filter((d) => /^Medication\(s\) name:/i.test(d))).toEqual(
      expect.arrayContaining([expect.stringContaining(DRUG.name), expect.stringContaining(DRUG_2.name)]),
    );
    expect(displays.filter((d) => /^Quantity of medication prescribed per dose.*\b2\b/i.test(d))).toHaveLength(2);
    expect(displays.filter((d) => /^Units of medication prescribed per dose, non-coded: Tablet/i.test(d))).toHaveLength(2);
    expect(displays.some((d) => /^Medication frequency: BID/i.test(d))).toBe(true);
    expect(displays.some((d) => /^Medication frequency: OD/i.test(d))).toBe(true);
    expect(displays.filter((d) => /^Medication duration.*\b5\b/i.test(d))).toHaveLength(2);
    expect(displays.filter((d) => /^Time units: Days/i.test(d))).toHaveLength(2);
    expect(displays.filter((d) => /Routes of administration \(coded\): Oral/i.test(d))).toHaveLength(2);
    expect(displays.filter((d) => /^Quantity of medication dispensed.*\b20\b/i.test(d))).toHaveLength(2);
    expect(displays.filter((d) => /^Prescription instructions, non-coded: after meals/i.test(d))).toHaveLength(1);

    const encounter = await (await api.get(`encounter/${encounterUuid}?v=custom:(location:(uuid))`)).json();
    expect(encounter.location.uuid).toBe(PHARMACY_LOCATION_UUID);
  });

  test('EDIT starts from the saved prescription and medications, and a changed instruction replaces the saved one', async ({ page, api, createEntryContext }) => {
    const { context, encounterUuid } = await saveFull(page, api, createEntryContext);

    const params = new URLSearchParams({
      patientId: context.patient.uuid,
      encounterId: encounterUuid,
      definitionUiResource: `file:configuration/pih/htmlforms/${FORM}`,
      returnUrl: visitPagePath(context.visitUuid),
    });
    await page.goto(`htmlformentryui/htmlform/editHtmlFormWithStandardUi.page?${params.toString()}`);
    await expect(page.locator('#typePrescription')).toBeVisible();
    await expect(page.locator('[id="Timing of hospital prescription"]').getByLabel('Inpatient', { exact: true })).toBeChecked();
    await expect(page.locator('#name1 input.ui-autocomplete-input')).toHaveValue(DRUG.name);
    await expect(page.locator('#dose1 input')).toHaveValue('2');
    await expect(page.locator('#doseUnit1 select option:checked')).toHaveText('Tablet');
    await expect(page.locator('#frequencyCoded1 select option:checked')).toHaveText('BID');
    await expect(page.locator('#instructions1 input')).toHaveValue('after meals');
    await expect(page.locator('.provider input[type="text"]').nth(0)).toHaveValue('Test Prescriber');

    await page.locator('#instructions1 input').fill('before meals');
    await submit(page).click();
    await expect(page).toHaveURL(VISIT_PAGE_URL);
    await expect
      .poll(async () => (await getEncounterObs(api, encounterUuid)).map((o) => o.display))
      .toEqual(expect.arrayContaining([expect.stringMatching(/^Prescription instructions, non-coded: before meals/i)]));
    const after = (await getEncounterObs(api, encounterUuid)).map((o) => o.display);
    expect(after.some((d) => /after meals/.test(d))).toBe(false);
  });

  // V2: remove test.fail() when the script is wrapped in ifMode VIEW include="false"
  test.fail('V2 VIEW: a saved dispensing encounter renders its medications without a script error', async ({
    page,
    api,
    createEntryContext,
  }) => {
    // :63-155 runs in VIEW and calls htmlForm.getBeforeValidation(), undefined on the visit page: ViewFormPage.open throws / failOnJsError fails
    const { encounterUuid, obs } = await saveFull(page, api, createEntryContext);
    const labels: Record<string, string> = {
      'Timing of hospital prescription: Hospitalized': '[X] Inpatient', // answerCodes :219-222
      'Type of provider: Doctor': '[X] Dr',
    };
    for (const o of obs) {
      if (o.concept.display === 'Discharge location') {
        labels[o.display] = 'NCD Clinic'; // style="location" saves the location id as text, the VIEW prints its name
      }
      if (/^Medication frequency: (BID|OD)/.test(o.display)) {
        labels[o.display] = o.display.includes('BID') ? 'BID' : 'OD'; // the form's own labels
      }
    }
    const view = await ViewFormPage.open(page, FORM, encounterUuid);
    expect(await viewMismatches(api, view, encounterUuid, labels)).toEqual([]);
    await expect(view.page.locator('fieldset.medication')).toHaveCount(2); // showIfEmpty=false hides blocks 3-7
    await expect(view.page.locator('[id="Discharge location"] .value')).toHaveText('NCD Clinic');
    // ifMode VIEW include=false :157, :331: the heading and the Save / Cancel buttons are not in the VIEW
    await expect(view.page.locator('h2, #buttons, button.submitButton')).toHaveCount(0);
  });
});

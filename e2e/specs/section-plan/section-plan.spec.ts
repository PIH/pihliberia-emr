import { type Page } from '@playwright/test';
import { test, expect, birthdateYearsAgo, type SectionEncounter, type SectionEncounterOptions } from '../../core';
import { FAMILY_MEDICINE_FOLLOWUP_ENCOUNTER_TYPE_UUID, FAMILY_MEDICINE_INTAKE_ENCOUNTER_TYPE_UUID } from '../../core/constants';
import { getEncounterObs } from '../../commands';
import { SectionFormPage, VISIT_PAGE_URL, VisitPage, addMedication, expectObs, expectViewShowsSavedObs, isoDate, obsDisplays, pickDate, viewDate } from '../../pages';

// section-plan.xml (pihemr, v2.0): "Plan": clinical management plan text, lab orders (pihLabOrder), radiology, medication orders (drug order
// widget), disposition (encounterDisposition) + comment + return visit date. On the visit page it is the `pihcore-plan` section, the last one, of
// Family Medicine Intake and Followup (_availability.e2e.md "Sections"); the specs create the parent encounter over REST and open the section's edit
// URL directly (skips that gating). The form uses the HFE <submit> tag: there is no #submit, the button is `#buttons input.submitButton`.
// Runs on the local Liberia server (Harper stack). The Family Medicine types are neither NCD type the form tests for, so only the "not NCD" arms
// are seen here (the NCD-only parts, :113-201 suggested treatments and free-text dosing, and :206 the #assistance table, are not reachable from
// Liberia: the Liberia NCD encounters use section-ncd-plan.xml).
//
// Conditions in the form, from documentation inventory (section-plan.inv.md). NCD = NCD initial (ae06d311) or followup (5cbfd6a2):
//   includeIf !radiology component   :72   Chest X-ray checkbox + "other" autocomplete (PIH:Radiology image ordered); the `radiology` component is NOT in the
//                                          Liberia component lists, so this is the arm Liberia users see (ZL, with the component on, sees :94 "At HUM, use Radiology order")
//   includeIf type not NCD           :108  standard drug-order-widget.xml (shared: Add Medication button, medication select, dose, frequency, route, ...)
//   includeIf type not NCD           :292  return visit date (#apptDate, allowPastDates=false); NCD has none
//   ifMode VIEW include=false :25,:48,:304   validation script, <h1>, the #buttons row (Save, Cancel); absent in VIEW
// Scripts: :28-44 getBeforeValidation: a disposition picked while one of its visible fields (transfer site, transfer location) is empty ->
//   "Please fill out all fields associated with the selected disposition" and the save is stopped. Disposition widget (shared; the Liberia list,
//   pih-dispositions-liberia.json): Admission and ED Observation have no extra field, Transfer out of hospital shows the sites, Transfer within hospital the location.
//   There is no Discharge and no Death.
// Side effects on save: postSubmissionAction ApplyDispositionAction (:5, pihcore); drug orders (one saved below; voided with the encounter); lab orders
//   (pihLabOrder) are not saved.
// VIEW is tested on the visit page, which shows the section's own VIEW (`pihcore-plan` has an active templateModelUrl and
//   viewPlanSectionWithHtmlFormLong.page in encounterTypeConfig.js :139-148): expectViewShowsSavedObs.
// Findings: see pihemr _findings.e2e.md#section-plan.xml. V1 (`formUuid` shared with pihemr's ncd-initial.xml) does not apply to Liberia: its ncd-initial.xml
//   has its own uuid. V2 (duplicate id="clinical-management-plan") applies; V3 is the radiology arm tested below.
// Not covered here: pihLabOrder (an order widget; a lab order cannot be undone except by voiding the encounter), drug order revise / renew / discontinue,
//   saving the Transfer dispositions (ApplyDispositionAction), #apptDate error cases.

const FORM = 'section-plan.xml';
const SAVE = '#buttons input.submitButton';
// The disposition widget prints the disposition's name ("ED Observation"); the obs value is the category concept "Emergency Department observation".
const DISPOSITION_LABELS: Record<string, string> = { 'Disposition categories: Emergency Department observation': 'ED Observation' };

const PARENTS = [
  { name: 'Family Medicine Intake', uuid: FAMILY_MEDICINE_INTAKE_ENCOUNTER_TYPE_UUID },
  { name: 'Family Medicine Followup', uuid: FAMILY_MEDICINE_FOLLOWUP_ENCOUNTER_TYPE_UUID },
];

const open = async (
  page: Page,
  create: (o: SectionEncounterOptions) => Promise<SectionEncounter>,
  encounterTypeUuid: string,
  patient: { gender?: 'M' | 'F'; age?: number } = {},
): Promise<SectionEncounter> => {
  const section = await create({
    encounterTypeUuid,
    patient: { givenName: 'AutoPlan', familyName: 'Tester', gender: patient.gender ?? 'F', birthdate: birthdateYearsAgo(patient.age ?? 30) },
  });
  await page.goto(SectionFormPage.editUrl(FORM, section));
  await expect(page.locator(SAVE)).toBeVisible();
  return section;
};
const save = async (page: Page) => {
  await page.locator(SAVE).click();
  await expect(page).toHaveURL(VISIT_PAGE_URL);
};
const disposition = (page: Page) => page.locator('#disposition select').first();

test.describe('section-plan under each Family Medicine parent', () => {
  for (const parent of PARENTS) {
    test(`${parent.name}: standard drug widget, radiology checkbox and return visit date, none of the NCD parts`, async ({ page, createSectionEncounter }) => {
      // includeIf :72 / :108 / :113 / :206 / :292
      await open(page, createSectionEncounter, parent.uuid);
      await expect(page.locator('#drug-orders textarea'), 'free-text dosing instructions exist only in the NCD widget').toHaveCount(0);
      await expect(page.locator('#drug-orders .three-columns')).toHaveCount(0);
      await expect(page.locator('#drug-orders #order-action-button-NEW')).toBeVisible();
      await expect(page.locator('#apptDate')).toHaveCount(1);
      await expect(page.locator('#assistance')).toHaveCount(0);
      // always present
      await expect(page.locator('#clinical-management-plan textarea')).toBeVisible();
      await expect(page.locator('#test-orders')).toBeVisible();
      await expect(page.locator('#disposition-section')).toBeVisible();
      // includeIf :72: the radiology component is off, so the Chest X-ray checkbox and the "other" autocomplete are offered, not the :94 text
      await expect(page.locator('#radiology-orders input[type=checkbox]')).toHaveCount(1);
      await expect(page.locator('#radiology-orders input[type=text]')).toHaveCount(1);
      await expect(page.locator('#radiology-orders')).not.toContainText('At HUM, use');
    });
  }

  test('ENTER/EDIT shows the heading, Save and Cancel', async ({ page, createSectionEncounter }) => {
    // ifMode VIEW include=false :48, :304
    await open(page, createSectionEncounter, FAMILY_MEDICINE_INTAKE_ENCOUNTER_TYPE_UUID);
    await expect(page.locator('form#htmlform h1')).toBeVisible();
    await expect(page.locator(SAVE)).toBeVisible();
    await expect(page.locator('#buttons .cancel')).toBeVisible();
  });

  test('the visit page lists pihcore-plan as the last section of the Intake and the Followup encounter', async ({ page, createSectionEncounter }) => {
    for (const parent of PARENTS) {
      const section = await open(page, createSectionEncounter, parent.uuid);
      const visit = await VisitPage.openOfEncounter(page, section.encounter.uuid);
      await visit.expand(visit.encounterOfType(parent.uuid));
      const ids = await visit.shownSectionIds();
      expect(ids[ids.length - 1], `last section of ${parent.name}`).toBe('pihcore-plan');
    }
  });
});

test.describe('section-plan disposition', () => {
  test('each disposition shows its own extra field', async ({ page, createSectionEncounter }) => {
    // disposition widget (shared) wired by setupWhenThen; the Liberia list has no Discharge or Death
    await open(page, createSectionEncounter, FAMILY_MEDICINE_INTAKE_ENCOUNTER_TYPE_UUID);
    const sites = page.locator('#transferExternalLocation');
    const within = page.locator('#transferInternalLocation');
    await expect(sites).toBeHidden();
    await expect(within).toBeHidden();
    const options = (await disposition(page).locator('option').allTextContents()).map((t) => t.trim()).filter((t) => t !== '');
    expect(options).toEqual(['Admission', 'ED Observation', 'Transfer out of hospital', 'Transfer within hospital']);
    await disposition(page).selectOption({ label: 'Transfer out of hospital' });
    await expect(sites).toBeVisible();
    await expect(within).toBeHidden();
    await disposition(page).selectOption({ label: 'Transfer within hospital' });
    await expect(within).toBeVisible();
    await expect(sites).toBeHidden();
    for (const label of ['Admission', 'ED Observation']) {
      await disposition(page).selectOption({ label });
      await expect(sites, label).toBeHidden();
      await expect(within, label).toBeHidden();
    }
  });

  test('a transfer without its site or location is rejected and nothing is submitted; ED Observation saves', async ({ page, api, createSectionEncounter }) => {
    // getBeforeValidation :28-44
    const section = await open(page, createSectionEncounter, FAMILY_MEDICINE_INTAKE_ENCOUNTER_TYPE_UUID);
    const submits: string[] = [];
    page.on('request', (r) => {
      if (r.method() === 'POST' && r.url().includes('/submit.action')) {
        submits.push(r.url());
      }
    });
    for (const label of ['Transfer out of hospital', 'Transfer within hospital']) {
      await disposition(page).selectOption({ label });
      await page.locator(SAVE).click();
      await expect(page.locator('#disposition .field-error').first(), label).toHaveText('Please fill out all fields associated with the selected disposition');
    }
    await page.waitForTimeout(1000);
    expect(submits).toEqual([]);
    await expect(page).not.toHaveURL(VISIT_PAGE_URL);

    // a disposition without extra fields passes the same rule; the error is cleared
    await disposition(page).selectOption({ label: 'ED Observation' });
    await page.locator(SAVE).click();
    await expect(page).toHaveURL(VISIT_PAGE_URL);
    expectObs(await obsDisplays(api, section.encounter.uuid), 'disposition');
    // ApplyDispositionAction: ED Observation leaves the visit open
    const visit = await api.get(`visit/${section.encounter.visitUuid}?v=custom:(stopDatetime)`);
    expect((await visit.json()).stopDatetime).toBeNull();
  });
});

test.describe('section-plan under Family Medicine Intake', () => {
  const RETURN = isoDate(14);

  test('saves the plan, a medication order, the disposition, its comment and the return visit date; EDIT and VIEW show them', async ({ page, api, createSectionEncounter }) => {
    test.slow();
    const section = await open(page, createSectionEncounter, FAMILY_MEDICINE_INTAKE_ENCOUNTER_TYPE_UUID);
    await page.locator('#clinical-management-plan textarea').fill('Rest and fluids');
    await addMedication(page, 'Amoxicillin, 250mg tablet');
    await disposition(page).selectOption({ label: 'ED Observation' });
    await page.locator('#disposition-section input[type=text]:not([readonly])').first().fill('Back if worse');
    await pickDate(page.locator('#apptDate input[readonly]'), RETURN);
    await save(page);

    expectObs(await obsDisplays(api, section.encounter.uuid), 'Rest and fluids', 'Back if worse', 'disposition');
    const orders = await api.get(`order?patient=${section.patient.uuid}&v=custom:(action,drug:(display),dose,quantity)`);
    expect(orders.ok()).toBeTruthy();
    const list = (await orders.json()).results as Array<{ action: string; drug: { display: string } | null; dose: number; quantity: number }>;
    expect(list).toHaveLength(1);
    expect(list[0].action).toBe('NEW');
    expect(list[0].drug?.display).toContain('Amoxicillin');
    expect(list[0].dose).toBe(250);
    expect(list[0].quantity).toBe(20);

    // EDIT starts from the saved values
    await page.goto(SectionFormPage.editUrl(FORM, section));
    await expect(page.locator(SAVE)).toBeVisible();
    await expect(page.locator('#clinical-management-plan textarea')).toHaveValue('Rest and fluids');
    await expect(disposition(page).locator('option:checked')).toHaveText('ED Observation');
    await expect(page.locator('#disposition-section input[type=text]:not([readonly])').first()).toHaveValue('Back if worse');

    // VIEW on the visit page
    const view = await expectViewShowsSavedObs(page, api, FORM, section.encounter.uuid, DISPOSITION_LABELS);
    const shown = (await view.valueTexts()).join(' | ');
    expect(shown).toContain('Rest and fluids');
    expect(shown).toContain('Back if worse');
    expect(shown).toContain('ED Observation');
    expect(shown).toContain(viewDate(RETURN));
    await expect(view.root.locator('#buttons, input.submitButton, h1')).toHaveCount(0);
  });

  test('VIEW: nothing but the plan text is shown when only the plan text is saved', async ({ page, api, createSectionEncounter }) => {
    test.slow();
    const section = await open(page, createSectionEncounter, FAMILY_MEDICINE_INTAKE_ENCOUNTER_TYPE_UUID);
    await page.locator('#clinical-management-plan textarea').fill('Only a plan');
    await save(page);
    const view = await expectViewShowsSavedObs(page, api, FORM, section.encounter.uuid, {});
    expect(await view.valueTexts()).toEqual(['Only a plan']);
  });
});

test.describe('section-plan under Family Medicine Followup', () => {
  test('saves the Chest X-ray order (the radiology component is off); EDIT and VIEW show it', async ({ page, api, createSectionEncounter }) => {
    test.slow();
    // includeIf :72, obs PIH:Radiology image ordered = PIH:Chest 1 view (XRay)
    const section = await open(page, createSectionEncounter, FAMILY_MEDICINE_FOLLOWUP_ENCOUNTER_TYPE_UUID);
    await page.locator('#radiology-orders input[type=checkbox]').check();
    await page.locator('#clinical-management-plan textarea').fill('X-ray then review');
    await save(page);

    const obs = await getEncounterObs(api, section.encounter.uuid);
    expect(obs.map((o) => o.display.toLowerCase()).filter((d) => d.includes('radiology image order') && d.includes('chest'))).toHaveLength(1);

    await page.goto(SectionFormPage.editUrl(FORM, section));
    await expect(page.locator('#radiology-orders input[type=checkbox]')).toBeChecked();
    await expect(page.locator('#clinical-management-plan textarea')).toHaveValue('X-ray then review');

    const view = await expectViewShowsSavedObs(page, api, FORM, section.encounter.uuid, {});
    const shown = await view.valueTexts();
    expect(shown).toContain('X-ray then review');
    expect(shown.filter((t) => /^\[X\]/.test(t) && /chest/i.test(t))).toHaveLength(1);
    await expect(view.root.locator('#radiology-orders input')).toHaveCount(0);
  });
});

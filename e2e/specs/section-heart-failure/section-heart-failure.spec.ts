import { type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { test, expect, type SectionEncounter } from '../../core';
import { NCD_FOLLOWUP_ENCOUNTER_TYPE_UUID, NCD_INITIAL_ENCOUNTER_TYPE_UUID } from '../../core/constants';
import { getEncounterObs } from '../../commands';
import { SectionFormPage, ViewFormPage, expectViewShowsSavedObs } from '../../pages';

// section-heart-failure.xml ("Heart Failure"): NCD Initial only: CHF diagnoses (each a "Visit Diagnoses" group), a complications
// textarea and the treatment date; then signs and symptoms (yes/no/unknown radios, one PIH:14733 group each), body edema,
// volume status, NYHA class and risk assessment (yes/no/unknown radios in one PIH:14724 group). On the visit page it is the
// `pihcore-heart-failure` section of NCD Initial and NCD Followup 2.0 (documentation/_availability.e2e.md); the specs open its
// edit URL directly on an NCD Initial or NCD Followup encounter. First written without a server (locators from the XML), then run and fixed against a local Liberia server: see README.md.
//
// Conditions in the form, from documentation inventory (section-heart-failure.inv.md):
//   ifMode VIEW include=false :43, :206   heading + script, and #buttonsTopRow + #buttons in ENTER/EDIT only
//   includeIf encounterType == NCD Initial (ae06d311)  :63   diagnoses, complications text, treatment date (Initial vs Followup, tested)
// Scripts: :48 setUpNextAndSubmitButtons() (see _shared.e2e.md); `setUpPlanButton()` is commented out. No validation, default
// or derived value. No required field.
// Side effects on save: postSubmissionAction CleanDiagnosisConstructAction (:19): each "Visit Diagnoses" group with a coded
//   diagnosis gets a "Diagnosis order: Secondary" member (tested).
// VIEW (getAsHtml.action): showIfEmpty=false hides every group that was not saved; ticked boxes are `[X] <label>`, radios
//   `[X] yes|no|unknown` or their own labels; the heading and button rows are absent.
// Not covered here: the #pihcore-<section> jump buttons of #buttonsTopRow and #next (need the visit page; _shared.e2e.md :56
//   says no Liberia form has `.nextSection`, but the six NCD disease sections do).
//
// Findings:
//   V1 Medium :134  "Dry cough" is PIH:COUGH = "Cough" (Dry cough is PIH:12881 / CIEL:1488): the qualifier is lost -> saves
//                   "Symptom present: Cough". Fix: PIH:12881. (TESTED, test.fail)
//   V2 Low    :132  the label "Dyspea on exertion (DOE)" is misspelled.
//   V3 Low    :97   the treatment-date label reads "Date CHF treatment started (TBD)": a placeholder shown to users.
//   V4 Low    :58-59, :111-112  `chf-section` and `heart_failure` are used for both sections (duplicate ids).
//   V5 Low    :79-87  Hypertension, CKD and Diabetes are the same "Visit Diagnoses" groups the kidney, liver and diabetes forms
//                   write (see section-kidney V4; unconfirmed: not run).

const FORM = 'section-heart-failure.xml';

const saveForm = async (page: Page) => {
  const form = new SectionFormPage(page, FORM);
  await form.save();
  await form.expectSaved();
};

const obsDisplays = async (api: APIRequestContext, encounterUuid: string): Promise<string[]> => {
  return (await getEncounterObs(api, encounterUuid)).map((o) => o.display);
};

// A symptom row (`<p class="side-by-side">`) or a risk row (`<p class="list-inline-wide">`) starts with its question text.
const symptom = (page: Page, name: string) =>
  page.locator('p.side-by-side').filter({ hasText: new RegExp(`^\\s*${name}`) });
const risk = (page: Page, name: string) =>
  page.locator('p.list-inline-wide').filter({ hasText: new RegExp(`^\\s*${name}`) });
const answer = (r: Locator, label: 'yes' | 'no' | 'unknown') => r.getByLabel(new RegExp(`^${label}$`, 'i'));

// Date inputs are read-only datepickers: set the date as the picker does, then fire the hidden input's change.
const pickDate = async (input: Locator, isoDate: string) => {
  await input.evaluate((el, iso) => {
    const j = (window as unknown as { jq: (e: unknown) => { datepicker: (...a: unknown[]) => void; trigger: (n: string) => void } }).jq;
    j(el).datepicker('setDate', new Date(`${iso}T12:00:00`));
    j(el).trigger('change');
  }, isoDate);
  await input.locator('xpath=following-sibling::input[@type="hidden"]').evaluate((el) => {
    (window as unknown as { jq: (e: unknown) => { trigger: (n: string) => void } }).jq(el).trigger('change');
  });
};

// VIEW labels for obs the form shows differently from their concept names (obs display -> text shown).
const viewLabels = async (api: APIRequestContext, encounterUuid: string): Promise<Record<string, string>> => {
  const rules: Array<[RegExp, string]> = [
    [/^Diagnosis order:/i, ''], // added by the postSubmissionAction, not a form field
    [/^Diagnosis: Chronic kidney disease/i, '[X] CKD'],
    [/^Diagnosis: Dilated cardiomyopathy/i, '[X] Dilated'],
    [/^Symptom present:/i, '[X] yes'],
    [/^Symptom absent:/i, '[X] no'],
    [/^Symptom presence unknown:/i, '[X] unknown'],
    [/^Pitting edema: 2\+ pitting edema/i, '[X] 2+ pitting'],
    [/^NYHA Class: NYHA Class III/i, '[X] III (Marked limitation of activity)'],
    [/: Yes$/i, '[X] yes'],
    [/: No$/i, '[X] no'],
  ];
  const labels: Record<string, string> = {};
  for (const o of await getEncounterObs(api, encounterUuid)) {
    const rule = rules.find(([re]) => re.test(o.display));
    if (rule) {
      labels[o.display] = rule[1];
    }
  }
  return labels;
};

test.describe('section-heart-failure', () => {
  let section: SectionEncounter;

  test.beforeEach(async ({ page, createSectionEncounter }) => {
    section = await createSectionEncounter({
      encounterTypeUuid: NCD_INITIAL_ENCOUNTER_TYPE_UUID,
      patient: { givenName: 'AutoChf', familyName: 'Tester', gender: 'F' },
    });
    await SectionFormPage.openEdit(page, FORM, section);
  });

  test('NCD Initial shows the CHF diagnoses, the complications text and the treatment date', async ({ page }) => {
    // includeIf :63, state "NCD Initial"
    const labels = ['Dilated', 'Valvular', 'Rheumatic heart disease', 'Restrictive', 'Congenital heart disease', 'Hypertension', 'CKD', 'Diabetes'];
    for (const label of labels) {
      await expect(page.locator('.checkbox-group').getByLabel(label, { exact: true })).toBeVisible();
    }
    await expect(page.locator('.checkbox-group textarea')).toBeVisible();
    await expect(page.locator('.form-row').filter({ hasText: 'Date CHF treatment started' })).toBeVisible();
    await expect(page.locator('h1:not(.name)')).toHaveCount(1);
  });

  test('NCD Followup shows neither the diagnoses nor the treatment date, but the symptoms, exam, NYHA class and risks', async ({
    page,
    createSectionEncounter,
  }) => {
    // includeIf :63, state "not NCD Initial"
    const followup = await createSectionEncounter({
      encounterTypeUuid: NCD_FOLLOWUP_ENCOUNTER_TYPE_UUID,
      patient: { givenName: 'AutoChf', familyName: 'Tester', gender: 'F' },
    });
    await SectionFormPage.openEdit(page, FORM, followup);
    await expect(page.locator('.checkbox-group')).toHaveCount(0);
    await expect(page.locator('.form-row')).toHaveCount(0);
    await expect(symptom(page, 'Orthopnea')).toBeVisible();
    await expect(page.getByLabel('2+ pitting', { exact: true })).toBeVisible();
    await expect(page.getByLabel('II (Slight limitation of activity)', { exact: true })).toBeVisible();
    await expect(risk(page, 'Alcohol use')).toBeVisible();
  });

  test('saves a blank form and records nothing', async ({ page, api }) => {
    await saveForm(page);
    expect(await obsDisplays(api, section.encounter.uuid)).toEqual([]);
  });

  test('the five symptom rows have yes, no and unknown; body edema, volume status and NYHA class take one answer', async ({ page }) => {
    for (const name of ['Paroxysmal nocturnal dyspnea', 'Dyspea on exertion', 'Orthopnea', 'Dry cough', 'Fatigue']) {
      await expect(symptom(page, name).getByRole('radio')).toHaveCount(3);
    }
    await page.getByLabel('trace', { exact: true }).check();
    await page.getByLabel('none', { exact: true }).check();
    await expect(page.getByLabel('trace', { exact: true })).not.toBeChecked();
    await page.getByLabel('Euvolemic', { exact: true }).check();
    await page.getByLabel('Hypervolemic', { exact: true }).check();
    await expect(page.getByLabel('Euvolemic', { exact: true })).not.toBeChecked();
    await page.getByLabel('I (No limitations)', { exact: true }).check();
    await page.getByLabel('IV (Unable to carry out any physical activity)', { exact: true }).check();
    await expect(page.getByLabel('I (No limitations)', { exact: true })).not.toBeChecked();
  });

  test('saves diagnoses, symptoms, exam, NYHA class and risks, and EDIT shows them again', async ({ page, api }) => {
    const checkboxes = page.locator('.checkbox-group');
    await checkboxes.getByLabel('Dilated', { exact: true }).check();
    await checkboxes.getByLabel('CKD', { exact: true }).check();
    await checkboxes.locator('textarea').fill('Peripartum history');
    await pickDate(page.locator('.form-row').filter({ hasText: 'Date CHF treatment started' }).locator('input[type=text]').first(), '2024-03-15');
    await answer(symptom(page, 'Orthopnea'), 'yes').check();
    await answer(symptom(page, 'Fatigue'), 'no').check();
    await answer(symptom(page, 'Paroxysmal nocturnal dyspnea'), 'unknown').check();
    await page.getByLabel('2+ pitting', { exact: true }).check();
    await page.getByLabel('Euvolemic', { exact: true }).check();
    await page.getByLabel('III (Marked limitation of activity)', { exact: true }).check();
    await answer(risk(page, 'Alcohol use'), 'yes').check();
    await answer(risk(page, 'Took meds today'), 'no').check();
    await saveForm(page);

    const displays = await obsDisplays(api, section.encounter.uuid);
    expect(displays.some((d) => /^Diagnosis: Dilated cardiomyopathy/i.test(d))).toBeTruthy();
    expect(displays.some((d) => /^Diagnosis: Chronic kidney disease/i.test(d))).toBeTruthy();
    // postSubmissionAction :19
    expect(displays.filter((d) => /^Diagnosis order:/i.test(d))).toHaveLength(2);
    expect(displays.some((d) => /Peripartum history/.test(d))).toBeTruthy();
    expect(displays.some((d) => /^Symptom present: Orthopnea/i.test(d))).toBeTruthy();
    expect(displays.some((d) => /^Symptom absent: Fatigue/i.test(d))).toBeTruthy();
    expect(displays.some((d) => /^Symptom presence unknown: Paroxysmal nocturnal dyspnea/i.test(d))).toBeTruthy();
    expect(displays.some((d) => /^Pitting edema: 2\+ pitting edema/i.test(d))).toBeTruthy();
    expect(displays.some((d) => /^Volume Status: Euvolemic/i.test(d))).toBeTruthy();
    expect(displays.some((d) => /^NYHA Class: NYHA Class III/i.test(d))).toBeTruthy();
    expect(displays.some((d) => /^History of alcohol use: Yes/i.test(d))).toBeTruthy();
    expect(displays.some((d) => /^Currently taking medication: No/i.test(d))).toBeTruthy();
    const start = (await getEncounterObs(api, section.encounter.uuid)).find(
      (o) => o.concept.display === 'Treatment start date for heart failure',
    );
    expect(String(start?.value)).toMatch(/^2024-03-15/);

    await SectionFormPage.openEdit(page, FORM, section);
    await expect(checkboxes.getByLabel('Dilated', { exact: true })).toBeChecked();
    await expect(checkboxes.getByLabel('Valvular', { exact: true })).not.toBeChecked();
    await expect(answer(symptom(page, 'Orthopnea'), 'yes')).toBeChecked();
    await expect(answer(symptom(page, 'Dry cough'), 'yes')).not.toBeChecked();
    await expect(page.getByLabel('2+ pitting', { exact: true })).toBeChecked();
    await expect(page.getByLabel('III (Marked limitation of activity)', { exact: true })).toBeChecked();
    await expect(answer(risk(page, 'Alcohol use'), 'yes')).toBeChecked();

    // VIEW: radios show the form's own words; unsaved symptom groups are not rendered at all (showIfEmpty=false)
    const view = await expectViewShowsSavedObs(page, api, FORM, section.encounter.uuid, await viewLabels(api, section.encounter.uuid));
    expect(await view.valueTexts()).toEqual(
      expect.arrayContaining([
        '[X] Dilated', '[X] CKD', 'Peripartum history', '[X] yes', '[X] no', '[X] unknown', '[X] 2+ pitting', '[X] Euvolemic',
        '[X] III (Marked limitation of activity)',
      ]),
    );
    expect(await view.valueTexts()).not.toContain('[X] Valvular');
    await expect(view.page.locator('body')).not.toContainText('Dry cough');
    await expect(view.page.locator('.form-row').filter({ hasText: 'Date CHF treatment started' })).toContainText(/15 Mar(ch)? 2024|15\/03\/2024/);
    // ifMode VIEW include=false (:43, :206): no heading, no button rows
    await expect(view.page.locator('h1, #buttonsTopRow, #buttons, #submit, #next, #cancel')).toHaveCount(0);
  });

  test('VIEW: an encounter nothing was saved on shows no value', async ({ page }) => {
    const view = await ViewFormPage.open(page, FORM, section.encounter.uuid);
    await expect(view.values).toHaveCount(0);
  });

  // V1: the Dry cough row must record Dry cough (unconfirmed: not run). PIH:COUGH is "Cough".
  test('V1: the "Dry cough" symptom is saved as Dry cough, not Cough', async ({ page, api }) => {
    test.fail();
    await answer(symptom(page, 'Dry cough'), 'yes').check();
    await saveForm(page);
    const displays = await obsDisplays(api, section.encounter.uuid);
    expect(displays.some((d) => /^Symptom present: /i.test(d))).toBeTruthy();
    expect(displays.some((d) => /^Symptom present: Dry cough/i.test(d))).toBeTruthy();
  });
});

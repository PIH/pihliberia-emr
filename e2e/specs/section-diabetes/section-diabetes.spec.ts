import { type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { test, expect, type SectionEncounter } from '../../core';
import { NCD_FOLLOWUP_ENCOUNTER_TYPE_UUID, NCD_INITIAL_ENCOUNTER_TYPE_UUID } from '../../core/constants';
import { getEncounterObs } from '../../commands';
import { SectionFormPage, ViewFormPage, expectViewShowsSavedObs } from '../../pages';

// section-diabetes.xml ("Diabetes"): NCD Initial only: diagnoses (each a "Visit Diagnoses" group), "Other", treatment date;
// then complications and the follow-up indicators (yes/no radios in one PIH:14469 group). On the visit page it is the
// `pihcore-diabetes` section of NCD Initial and NCD Followup 2.0 (documentation/_availability.e2e.md); the specs open its
// edit URL directly on an NCD Initial or NCD Followup encounter.
// First written without a server (locators from the XML), then run and fixed against a local Liberia server: see README.md.
//
// Conditions in the form, from documentation inventory (section-diabetes.inv.md):
//   ifMode VIEW include=false :46, :188   heading + script, and #buttonsTopRow + #buttons in ENTER/EDIT only
//   includeIf encounterType == NCD Initial (ae06d311)  :67   diagnoses, "Other" and the treatment date (Initial vs Followup, tested)
//   toggle PIH:2889 "Other"  :89-90   target "other" exists nowhere (V2): nothing hides, the comment input is always shown
// Scripts: :51 setUpNextAndSubmitButtons() (see _shared.e2e.md). No validation, default or derived value. No required field.
// Side effects on save: postSubmissionAction CleanDiagnosisConstructAction (:19): each "Visit Diagnoses" group with a coded
//   diagnosis gets a "Diagnosis order: Secondary" member (tested).
// VIEW (getAsHtml.action): showIfEmpty=false hides every group that was not saved; ticked boxes are `[X] <label>`, radios
//   `[X] yes|no`; the heading and button rows are absent.
// Not covered here: the #pihcore-<section> jump buttons of #buttonsTopRow and #next (need the visit page; _shared.e2e.md :56
//   says no Liberia form has `.nextSection`, but the six NCD disease sections do).
//
// Findings:
//   V1 High   :88-90   the "Other" DM diagnosis is obs PIH:2889 = "Chronic lung disease" (answer Other), copied from the lung form
//                      -> saves "Chronic lung disease: Other" + the typed text. Fix: a diabetes text concept, or a non-coded
//                      diagnosis in the Visit Diagnoses group. (TESTED below with test.fail)
//   V2 Low    :90      toggle="other" matches no id or class (dead toggle).
//   V3 Low    :116, :158  `id="complications-dm"` on all ten complications; `dm-{q}-top` ids contain spaces ("dm-disease control-top").
//   V4 Low    :124     the label "Catarata" (Spanish) for Cataract (CIEL:120860).

const FORM = 'section-diabetes.xml';

const saveForm = async (page: Page) => {
  const form = new SectionFormPage(page, FORM);
  await form.save();
  await form.expectSaved();
};

const obsDisplays = async (api: APIRequestContext, encounterUuid: string): Promise<string[]> => {
  return (await getEncounterObs(api, encounterUuid)).map((o) => o.display);
};

// A yes/no row of the follow-up indicators: `<p class="list-inline-wide">` starting with the question text.
const row = (page: Page, question: string) =>
  page.locator('p.list-inline-wide').filter({ hasText: new RegExp(`^\\s*${question}`) });
const answer = (r: Locator, label: 'yes' | 'no') => r.getByLabel(new RegExp(`^${label}$`, 'i'));

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

// VIEW labels for obs the form shows differently from their concept names (obs display -> text shown). The keys are the
// displays of the saved obs, found by pattern (concept names from the PIH 1.8.46 dictionary).
const viewLabels = async (api: APIRequestContext, encounterUuid: string): Promise<Record<string, string>> => {
  const rules: Array<[RegExp, string]> = [
    [/^Diagnosis order:/i, ''], // added by the postSubmissionAction, not a form field
    [/^Diagnosis: Type 2 diabetes/i, '[X] Type 2 DM'],
    [/^Diagnosis: Diabetes$/i, '[X] DM not yet specified'],
    [/^Complications related to diabetes: Cerebrovascular accident/i, '[X] Stroke'],
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

test.describe('section-diabetes', () => {
  let section: SectionEncounter;

  test.beforeEach(async ({ page, createSectionEncounter }) => {
    section = await createSectionEncounter({
      encounterTypeUuid: NCD_INITIAL_ENCOUNTER_TYPE_UUID,
      patient: { givenName: 'AutoDm', familyName: 'Tester', gender: 'F' },
    });
    await SectionFormPage.openEdit(page, FORM, section);
  });

  test('NCD Initial shows the diagnoses, "Other" and the treatment date', async ({ page }) => {
    // includeIf :67, state "NCD Initial"
    for (const label of ['Type 1 DM', 'Type 2 DM', 'Gestational DM', 'DM not yet specified']) {
      await expect(page.getByLabel(label, { exact: true })).toBeVisible();
    }
    await expect(page.locator('.checkbox-group').getByLabel('Other', { exact: true })).toBeVisible();
    await expect(page.locator('.form-row').filter({ hasText: 'Date Diabetes treatment started' })).toBeVisible();
    // :90 the toggle target does not exist, so the "specify" input is shown with the box unticked (V2)
    await expect(page.locator('.checkbox-group input[type=text]')).toBeVisible();
    await expect(page.getByLabel('Diabetic foot', { exact: true })).toBeVisible();
    await expect(row(page, 'On insulin')).toBeVisible();
  });

  test('NCD Followup shows neither the diagnoses nor the treatment date, but the rest', async ({ page, createSectionEncounter }) => {
    // includeIf :67, state "not NCD Initial"
    const followup = await createSectionEncounter({
      encounterTypeUuid: NCD_FOLLOWUP_ENCOUNTER_TYPE_UUID,
      patient: { givenName: 'AutoDm', familyName: 'Tester', gender: 'F' },
    });
    await SectionFormPage.openEdit(page, FORM, followup);
    await expect(page.getByLabel('Type 2 DM', { exact: true })).toHaveCount(0);
    await expect(page.locator('.checkbox-group')).toHaveCount(0);
    await expect(page.locator('.form-row')).toHaveCount(0);
    await expect(page.getByLabel('Diabetic foot', { exact: true })).toBeVisible();
    await expect(row(page, 'On insulin')).toBeVisible();
  });

  test('saves a blank form and records nothing', async ({ page, api }) => {
    await saveForm(page);
    expect(await obsDisplays(api, section.encounter.uuid)).toEqual([]);
  });

  test('a yes/no indicator has two answers and takes one at a time', async ({ page }) => {
    const insulin = row(page, 'On insulin');
    await expect(insulin.getByRole('radio')).toHaveCount(2);
    await answer(insulin, 'yes').check();
    await answer(insulin, 'no').check();
    await expect(answer(insulin, 'yes')).not.toBeChecked();
    await expect(answer(insulin, 'no')).toBeChecked();
  });

  test('saves diagnoses, complications, the treatment date and the indicators, and EDIT shows them again', async ({ page, api }) => {
    await page.getByLabel('Type 2 DM', { exact: true }).check();
    await page.getByLabel('DM not yet specified', { exact: true }).check();
    await pickDate(page.locator('.form-row').filter({ hasText: 'Date Diabetes treatment started' }).locator('input[type=text]').first(), '2024-03-15');
    await page.getByLabel('Diabetic foot', { exact: true }).check();
    await page.getByLabel('Neuropathy', { exact: true }).check();
    await page.locator('#other-complications-dm input[type=text]').fill('Charcot joint');
    await answer(row(page, 'On insulin'), 'yes').check();
    await answer(row(page, 'Disease controlled'), 'no').check();
    await answer(row(page, 'Missed doses in past week'), 'yes').check();
    await page.locator('#diabetes input[onblur*="checkNumber"]').fill('2');
    await saveForm(page);

    const displays = await obsDisplays(api, section.encounter.uuid);
    expect(displays.some((d) => /^Diagnosis: Type 2 diabetes/i.test(d))).toBeTruthy();
    expect(displays.some((d) => /^Diagnosis: Diabetes$/i.test(d))).toBeTruthy();
    expect(displays.some((d) => /^Diagnosis: Type 1 diabetes/i.test(d))).toBeFalsy();
    // postSubmissionAction :19
    expect(displays.filter((d) => /^Diagnosis order:/i.test(d))).toHaveLength(2);
    expect(displays.some((d) => /^Complications related to diabetes: Diabetic foot/i.test(d))).toBeTruthy();
    expect(displays.some((d) => /^Complications related to diabetes: Neuropathy/i.test(d))).toBeTruthy();
    expect(displays.some((d) => /Charcot joint/.test(d))).toBeTruthy();
    expect(displays.some((d) => /^On insulin therapy: Yes/i.test(d))).toBeTruthy();
    expect(displays.some((d) => /^Patient condition\/problem\/disease controlled: No/i.test(d))).toBeTruthy();
    expect(displays.some((d) => /^Number of missed medication doses in past 7 days: 2/i.test(d))).toBeTruthy();
    const start = (await getEncounterObs(api, section.encounter.uuid)).find((o) => o.concept.display === 'Treatment start date');
    expect(String(start?.value)).toMatch(/^2024-03-15/);

    await SectionFormPage.openEdit(page, FORM, section);
    await expect(page.getByLabel('Type 2 DM', { exact: true })).toBeChecked();
    await expect(page.getByLabel('Type 1 DM', { exact: true })).not.toBeChecked();
    await expect(page.getByLabel('Neuropathy', { exact: true })).toBeChecked();
    await expect(page.locator('#other-complications-dm input[type=text]')).toHaveValue('Charcot joint');
    await expect(answer(row(page, 'On insulin'), 'yes')).toBeChecked();
    await expect(answer(row(page, 'Disease controlled'), 'no')).toBeChecked();
    await expect(page.locator('#diabetes input[onblur*="checkNumber"]')).toHaveValue('2');

    // VIEW: boxes and radios are labelled by the form's own texts; unsaved groups and boxes are not shown at all
    const view = await expectViewShowsSavedObs(page, api, FORM, section.encounter.uuid, await viewLabels(api, section.encounter.uuid));
    expect(await view.valueTexts()).toEqual(
      expect.arrayContaining(['[X] Type 2 DM', '[X] DM not yet specified', '[X] Diabetic foot', '[X] Neuropathy', 'Charcot joint', '[X] yes', '[X] no']),
    );
    expect((await view.valueTexts()).some((t) => /^2(\.0)?$/.test(t))).toBeTruthy(); // missed doses
    expect(await view.valueTexts()).not.toContain('[X] Type 1 DM');
    await expect(view.page.locator('body')).not.toContainText('Type 1 DM');
    await expect(view.page.locator('.form-row').filter({ hasText: 'Date Diabetes treatment started' })).toContainText(/15 Mar(ch)? 2024|15\/03\/2024/);
    // ifMode VIEW include=false (:46, :188): no heading, no button rows
    await expect(view.page.locator('h1, #buttonsTopRow, #buttons, #submit, #next, #cancel')).toHaveCount(0);
  });

  // VIEW: only a complication is saved: the diagnoses group, the Other box and the indicators show no value.
  test('VIEW: shows only what was saved', async ({ page, api }) => {
    await page.getByLabel('Stroke', { exact: true }).check();
    await saveForm(page);

    const view = await expectViewShowsSavedObs(page, api, FORM, section.encounter.uuid, await viewLabels(api, section.encounter.uuid));
    expect(await view.valueTexts()).toEqual(['[X] Stroke']);
    await expect(view.page.locator('#diabetes .value')).toHaveCount(1); // the saved complication lives inside #diabetes
    await expect(view.page.locator('.checkbox-group .value')).toHaveCount(0);
  });

  test('VIEW: an encounter nothing was saved on shows no value', async ({ page }) => {
    const view = await ViewFormPage.open(page, FORM, section.encounter.uuid);
    await expect(view.values).toHaveCount(0);
  });

  // V1: the "Other" box must not record a lung disease (unconfirmed: not run). PIH:2889 is "Chronic lung disease".
  test('V1: the "Other" DM diagnosis is not saved under Chronic lung disease', async ({ page, api }) => {
    test.fail();
    await page.locator('.checkbox-group').getByLabel('Other', { exact: true }).check();
    await page.locator('.checkbox-group input[type=text]').fill('MODY');
    await saveForm(page);
    const displays = await obsDisplays(api, section.encounter.uuid);
    expect(displays.length).toBeGreaterThan(0);
    expect(displays.some((d) => /Chronic lung disease/i.test(d))).toBeFalsy();
  });
});

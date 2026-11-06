import { type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { test, expect, type SectionEncounter } from '../../core';
import { NCD_FOLLOWUP_ENCOUNTER_TYPE_UUID, NCD_INITIAL_ENCOUNTER_TYPE_UUID } from '../../core/constants';
import { getEncounterObs } from '../../commands';
import { SectionFormPage, ViewFormPage, expectViewShowsSavedObs } from '../../pages';

// section-kidney.xml ("Chronic Kidney Disease"): NCD Initial only: CKD diagnoses (each a "Visit Diagnoses" group), a
// complications textarea and the treatment date; then signs and symptoms (yes/no/unknown radios, one PIH:14732 group each),
// CKD stage and risk assessment (yes/no/unknown radios in one PIH:14717 group). On the visit page it is the `pihcore-kidney`
// section of NCD Initial and NCD Followup 2.0 (documentation/_availability.e2e.md); the specs open its edit URL directly on an
// NCD Initial or NCD Followup encounter. First written without a server (locators from the XML), then run and fixed against a local Liberia server: see README.md.
//
// Conditions in the form, from documentation inventory (section-kidney.inv.md):
//   ifMode VIEW include=false :42, :194   heading + script, and #buttonsTopRow + #buttons in ENTER/EDIT only
//   includeIf encounterType == NCD Initial (ae06d311)  :62   diagnoses, complications text, treatment date (Initial vs Followup, tested)
// Scripts: :47 setUpNextAndSubmitButtons() (see _shared.e2e.md). No validation, default or derived value. No required field.
// Side effects on save: postSubmissionAction CleanDiagnosisConstructAction (:19): each "Visit Diagnoses" group with a coded
//   diagnosis gets a "Diagnosis order: Secondary" member (tested).
// VIEW (getAsHtml.action): showIfEmpty=false hides every group that was not saved; ticked boxes are `[X] <label>`, radios
//   `[X] yes|no|unknown`; the heading and button rows are absent.
// Not covered here: the #pihcore-<section> jump buttons of #buttonsTopRow and #next (need the visit page; _shared.e2e.md :56
//   says no Liberia form has `.nextSection`, but the six NCD disease sections do).
//
// Findings:
//   V1 High   :127  the "Confusion" symptom is CIEL:119866, which is "Contusion" in the PIH 1.8.46 dictionary (Confusion is
//                   CIEL:120345, as the liver form uses) -> saves "Symptom present: Contusion". Fix: CIEL:120345. (TESTED, test.fail)
//   V2 Low    :147-161  five stage options (I, II, III, IV, V) but the legend lists a Stage 3B (GFR 30-44) that cannot be chosen.
//   V3 Low    :57-58, :107-108  `kidney_failure-section` and `kidney_failure` are used for both sections (duplicate ids).
//   V4 Low    :72-82  Hypertension, Diabetes (and CKD) are the same "Visit Diagnoses" groups the heart-failure, liver and diabetes
//                   forms write: with two of these sections in one encounter, unticking one in either removes the diagnosis
//                   from both (unconfirmed: not run).
//   V5 Info   :134-136  "Other exam findings or comments" (PIH:21786) is commented out with a ToDo: no free-text exam findings.

const FORM = 'section-kidney.xml';

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
    [/^Symptom present:/i, '[X] yes'],
    [/^Symptom absent:/i, '[X] no'],
    [/^Symptom presence unknown:/i, '[X] unknown'],
    [/^Chronic kidney disease stage:/i, '[X] Stage 3'],
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

test.describe('section-kidney', () => {
  let section: SectionEncounter;

  test.beforeEach(async ({ page, createSectionEncounter }) => {
    section = await createSectionEncounter({
      encounterTypeUuid: NCD_INITIAL_ENCOUNTER_TYPE_UUID,
      patient: { givenName: 'AutoCkd', familyName: 'Tester', gender: 'F' },
    });
    await SectionFormPage.openEdit(page, FORM, section);
  });

  test('NCD Initial shows the CKD diagnoses, the complications text and the treatment date', async ({ page }) => {
    // includeIf :62, state "NCD Initial"
    for (const label of ['CKD', 'Hypertension', 'Diabetes', 'Heart attack', 'Ischemic heart disease']) {
      await expect(page.locator('.checkbox-group').getByLabel(label, { exact: true })).toBeVisible();
    }
    await expect(page.locator('.checkbox-group textarea')).toBeVisible();
    await expect(page.locator('.form-row').filter({ hasText: 'Date CKD treatment started' })).toBeVisible();
    await expect(page.locator('h1:not(.name)')).toHaveCount(1);
  });

  test('NCD Followup shows neither the diagnoses nor the treatment date, but the symptoms, stage and risks', async ({
    page,
    createSectionEncounter,
  }) => {
    // includeIf :62, state "not NCD Initial"
    const followup = await createSectionEncounter({
      encounterTypeUuid: NCD_FOLLOWUP_ENCOUNTER_TYPE_UUID,
      patient: { givenName: 'AutoCkd', familyName: 'Tester', gender: 'F' },
    });
    await SectionFormPage.openEdit(page, FORM, followup);
    await expect(page.locator('.checkbox-group')).toHaveCount(0);
    await expect(page.locator('.form-row')).toHaveCount(0);
    await expect(symptom(page, 'Fatigue')).toBeVisible();
    await expect(page.getByLabel('Stage 3', { exact: true })).toBeVisible();
    await expect(risk(page, 'NSAID use')).toBeVisible();
  });

  test('saves a blank form and records nothing', async ({ page, api }) => {
    await saveForm(page);
    expect(await obsDisplays(api, section.encounter.uuid)).toEqual([]);
  });

  test('a symptom has yes, no and unknown and takes one at a time; the stage has five options', async ({ page }) => {
    const fatigue = symptom(page, 'Fatigue');
    await expect(fatigue.getByRole('radio')).toHaveCount(3);
    await answer(fatigue, 'yes').check();
    await answer(fatigue, 'unknown').check();
    await expect(answer(fatigue, 'yes')).not.toBeChecked();
    await expect(answer(fatigue, 'unknown')).toBeChecked();
    await expect(page.getByLabel(/^Stage \d/)).toHaveCount(5);
  });

  test('saves diagnoses, text, treatment date, symptoms, stage and risks, and EDIT shows them again', async ({ page, api }) => {
    const checkboxes = page.locator('.checkbox-group');
    await checkboxes.getByLabel('CKD', { exact: true }).check();
    await checkboxes.getByLabel('Hypertension', { exact: true }).check();
    await checkboxes.locator('textarea').fill('Gout nephropathy');
    await pickDate(page.locator('.form-row').filter({ hasText: 'Date CKD treatment started' }).locator('input[type=text]').first(), '2024-03-15');
    await answer(symptom(page, 'Fatigue'), 'yes').check();
    await answer(symptom(page, 'Nausea'), 'no').check();
    await answer(symptom(page, 'Anorexia'), 'unknown').check();
    await page.getByLabel('Stage 3', { exact: true }).check();
    await answer(risk(page, 'NSAID use'), 'yes').check();
    await answer(risk(page, 'Taking meds'), 'no').check();
    await saveForm(page);

    const displays = await obsDisplays(api, section.encounter.uuid);
    expect(displays.some((d) => /^Diagnosis: Chronic kidney disease/i.test(d))).toBeTruthy();
    expect(displays.some((d) => /^Diagnosis: Hypertension/i.test(d))).toBeTruthy();
    // postSubmissionAction :19
    expect(displays.filter((d) => /^Diagnosis order:/i.test(d))).toHaveLength(2);
    expect(displays.some((d) => /Gout nephropathy/.test(d))).toBeTruthy();
    expect(displays.some((d) => /^Symptom present: Fatigue/i.test(d))).toBeTruthy();
    expect(displays.some((d) => /^Symptom absent: Nausea/i.test(d))).toBeTruthy();
    expect(displays.some((d) => /^Symptom presence unknown: Anorexia/i.test(d))).toBeTruthy();
    expect(displays.some((d) => /^Chronic kidney disease stage: .*Stage III/i.test(d))).toBeTruthy();
    expect(displays.some((d) => /^On NSAIDs: Yes/i.test(d))).toBeTruthy();
    expect(displays.some((d) => /^Currently taking medication: No/i.test(d))).toBeTruthy();
    const start = (await getEncounterObs(api, section.encounter.uuid)).find(
      (o) => o.concept.display === 'Treatment start date for kidney disease',
    );
    expect(String(start?.value)).toMatch(/^2024-03-15/);

    await SectionFormPage.openEdit(page, FORM, section);
    await expect(checkboxes.getByLabel('CKD', { exact: true })).toBeChecked();
    await expect(checkboxes.getByLabel('Diabetes', { exact: true })).not.toBeChecked();
    await expect(checkboxes.locator('textarea')).toHaveValue('Gout nephropathy');
    await expect(answer(symptom(page, 'Fatigue'), 'yes')).toBeChecked();
    await expect(answer(symptom(page, 'Anorexia'), 'unknown')).toBeChecked();
    await expect(answer(symptom(page, 'Pruritis'), 'yes')).not.toBeChecked();
    await expect(page.getByLabel('Stage 3', { exact: true })).toBeChecked();
    await expect(answer(risk(page, 'NSAID use'), 'yes')).toBeChecked();

    // VIEW: radios show the form's own words; unsaved symptom groups are not rendered at all (showIfEmpty=false)
    const view = await expectViewShowsSavedObs(page, api, FORM, section.encounter.uuid, await viewLabels(api, section.encounter.uuid));
    expect(await view.valueTexts()).toEqual(
      expect.arrayContaining(['[X] CKD', '[X] Hypertension', 'Gout nephropathy', '[X] yes', '[X] no', '[X] unknown', '[X] Stage 3']),
    );
    expect(await view.valueTexts()).not.toContain('[X] Diabetes');
    await expect(view.page.locator('body')).not.toContainText('Pruritis');
    await expect(view.page.locator('.form-row').filter({ hasText: 'Date CKD treatment started' })).toContainText(/15 Mar(ch)? 2024|15\/03\/2024/);
    // ifMode VIEW include=false (:42, :194): no heading, no button rows
    await expect(view.page.locator('h1, #buttonsTopRow, #buttons, #submit, #next, #cancel')).toHaveCount(0);
  });

  test('VIEW: an encounter nothing was saved on shows no value', async ({ page }) => {
    const view = await ViewFormPage.open(page, FORM, section.encounter.uuid);
    await expect(view.values).toHaveCount(0);
  });

  // V1: the Confusion row must record Confusion (unconfirmed: not run). CIEL:119866 is "Contusion".
  test('V1: the "Confusion" symptom is saved as Confusion, not Contusion', async ({ page, api }) => {
    test.fail();
    await answer(symptom(page, 'Confusion'), 'yes').check();
    await saveForm(page);
    const displays = await obsDisplays(api, section.encounter.uuid);
    expect(displays.some((d) => /^Symptom present: /i.test(d))).toBeTruthy();
    expect(displays.some((d) => /^Symptom present: Confusion/i.test(d))).toBeTruthy();
  });
});

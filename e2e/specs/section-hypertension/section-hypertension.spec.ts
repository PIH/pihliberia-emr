import { type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { test, expect, type SectionEncounter } from '../../core';
import { NCD_FOLLOWUP_ENCOUNTER_TYPE_UUID, NCD_INITIAL_ENCOUNTER_TYPE_UUID } from '../../core/constants';
import { getEncounterObs } from '../../commands';
import { SectionFormPage, ViewFormPage, expectViewShowsSavedObs } from '../../pages';

// section-hypertension.xml ("Hypertension"): nine complications (checkbox in a PIH:21731 group each, with an onset date on NCD
// Initial), a complications textarea, a family history (NCD Initial) and eight follow-up risk indicators (checkbox + yes/no/unknown
// radios in a PIH:14462 group each). On the visit page it is the `pihcore-hypertension` section of NCD Initial and NCD Followup
// 2.0 (documentation/_availability.e2e.md); the specs open its edit URL directly on an NCD Initial or NCD Followup encounter.
// First written without a server (locators from the XML), then run and fixed against a local Liberia server: see README.md.
//
// Conditions in the form, from documentation inventory (section-hypertension.inv.md):
//   ifMode VIEW include=false :159, :273   heading + script, and #buttonsTopRow + #buttons in ENTER/EDIT only
//   toggle PIH:14456 checkboxes :191       tick shows #<nick>-onset-date (hide style: untick hides it and clears it); the target
//                                          exists only on NCD Initial (V1)
//   includeIf encounterType == NCD Initial (ae06d311)  :195, :220   the onset dates and the family-history checkboxes
//   toggle CIEL:1728 checkboxes :244       tick shows #<name>-htn-dx-ynu (the yes/no/unknown radios); untick hides and clears them
// Scripts: :164 setUpNextAndSubmitButtons() (see _shared.e2e.md). No validation, default or derived value. No required field.
// Side effects on save: postSubmissionAction CleanDiagnosisConstructAction (:19, no Visit Diagnoses group here, so none);
//   <familyHistoryRelativeCheckboxes> (pihcore tag) stores, per ticked relative, a family-history group (disease, relative, present).
// VIEW (getAsHtml.action): showIfEmpty=false hides every group that was not saved; a ticked complication is `[X] <label>`, a ticked
//   indicator is a bare `[X]` (its answerLabel is empty, the text is the labelText); the heading and button rows are absent.
// Not covered here: the #pihcore-<section> jump buttons of #buttonsTopRow and #next (need the visit page; _shared.e2e.md :56
//   says no Liberia form has `.nextSection`, but the six NCD disease sections do); family history in VIEW (tag rendering unknown).
//
// Findings:
//   V1 Low :191, :196  `toggle="{nickname}-onset-date"` targets exist only inside the NCD Initial includeIf: nine dead toggles on
//                      NCD Followup (harmless; tested: ticking works there).
//   V2 Low :240        `class="{expression}"` renders `class="true"` on eight spans (leftover template variable).
//   V3 Low :174-176, :232-234  `htn-section` and `htn-form` are used for both sections (duplicate ids).
//   V4 Low :258        "Drink alcohol" is CIEL:70468 = "Alcohols", a Drug-class concept used as a sign/symptom name (unconfirmed).

const FORM = 'section-hypertension.xml';

const saveForm = async (page: Page) => {
  const form = new SectionFormPage(page, FORM);
  await form.save();
  await form.expectSaved();
};

const obsDisplays = async (api: APIRequestContext, encounterUuid: string): Promise<string[]> => {
  return (await getEncounterObs(api, encounterUuid)).map((o) => o.display);
};

// Complication checkbox / onset date of a complication, by the repeat's nickname (:204-212): htn, heartattack, ischemicheart,
// retinopathy, renalfailure, stroke, pvd, neuropathy, erectile. The id is on a wrapper span.
const complication = (page: Page, nickname: string) => page.locator(`#${nickname}-onset-q input[type=checkbox]`);
const onsetDate = (page: Page, nickname: string) => page.locator(`#${nickname}-onset-date input[type=text]`).first();

// A follow-up indicator (`<div class="column-item">`): the text is the labelText before the checkbox; the radios are in
// #<name>-htn-dx-ynu (:246, names from the repeat :257-266).
const indicator = (page: Page, text: string) => page.locator('.column-item').filter({ hasText: new RegExp(`^\\s*${text}`) });
const ynu = (page: Page, name: string) => page.locator(`#${name}-htn-dx-ynu`);
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
    [/^Complications related to hypertension: Cerebrovascular accident/i, '[X] Stroke'],
    [/^Sign\/Symptom name:/i, '[X]'], // answerLabel="" (:243): the checkbox has no text of its own
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

test.describe('section-hypertension', () => {
  let section: SectionEncounter;

  test.beforeEach(async ({ page, createSectionEncounter }) => {
    section = await createSectionEncounter({
      encounterTypeUuid: NCD_INITIAL_ENCOUNTER_TYPE_UUID,
      patient: { givenName: 'AutoHtn', familyName: 'Tester', gender: 'F' },
    });
    await SectionFormPage.openEdit(page, FORM, section);
  });

  test('NCD Initial: ticking a complication shows its onset date, unticking hides it', async ({ page }) => {
    // toggle :191 + includeIf :195, state "NCD Initial"
    const date = page.locator('#stroke-onset-date');
    await expect(date).toBeHidden();
    await complication(page, 'stroke').check();
    await expect(date).toBeVisible();
    await complication(page, 'stroke').uncheck();
    await expect(date).toBeHidden();
    await expect(page.locator('#pvd-onset-date')).toBeHidden(); // the others are not affected
  });

  test('NCD Followup: the complications have no onset date, and ticking one does not break the page', async ({ page, createSectionEncounter }) => {
    // includeIf :195, state "not NCD Initial"; V1 (dead toggle targets). A JS error would fail the test (failOnJsError).
    const followup = await createSectionEncounter({
      encounterTypeUuid: NCD_FOLLOWUP_ENCOUNTER_TYPE_UUID,
      patient: { givenName: 'AutoHtn', familyName: 'Tester', gender: 'F' },
    });
    await SectionFormPage.openEdit(page, FORM, followup);
    await expect(page.locator('#htn-onset-date')).toHaveCount(0);
    await expect(complication(page, 'htn')).toBeVisible();
    await complication(page, 'htn').check();
    await expect(complication(page, 'htn')).toBeChecked();
  });

  test('the family history is offered on NCD Initial only', async ({ page, createSectionEncounter }) => {
    // includeIf :220
    const family = page.locator('.family-history-item');
    await expect(family).toHaveCount(1);
    for (const relative of ['Father', 'Mother', 'Sibling', 'Other']) {
      await expect(family.getByLabel(relative, { exact: true })).toBeVisible();
    }
    const followup = await createSectionEncounter({
      encounterTypeUuid: NCD_FOLLOWUP_ENCOUNTER_TYPE_UUID,
      patient: { givenName: 'AutoHtn', familyName: 'Tester', gender: 'F' },
    });
    await SectionFormPage.openEdit(page, FORM, followup);
    await expect(page.locator('.family-history-item')).toHaveCount(0);
  });

  test('a follow-up indicator shows its yes/no/unknown only while ticked, and unticking clears the answer', async ({ page }) => {
    // toggle :244 (style hide)
    const radios = ynu(page, 'tobacco');
    await expect(radios).toBeHidden();
    await indicator(page, 'Smoke tobacco').locator('input[type=checkbox]').check();
    await expect(radios).toBeVisible();
    await answer(radios, 'yes').check();
    await indicator(page, 'Smoke tobacco').locator('input[type=checkbox]').uncheck();
    await expect(radios).toBeHidden();
    await indicator(page, 'Smoke tobacco').locator('input[type=checkbox]').check();
    await expect(answer(radios, 'yes')).not.toBeChecked(); // htmlForm.js clears the hidden inputs
    await expect(ynu(page, 'alcohol')).toBeHidden(); // the other rows are not affected
  });

  test('saves a blank form and records nothing', async ({ page, api }) => {
    await saveForm(page);
    expect(await obsDisplays(api, section.encounter.uuid)).toEqual([]);
  });

  test('saves a family history for a ticked relative', async ({ page, api }) => {
    // <familyHistoryRelativeCheckboxes concept="PIH:903" ...> :224
    await page.locator('.family-history-item').getByLabel('Father', { exact: true }).check();
    await saveForm(page);
    const displays = await obsDisplays(api, section.encounter.uuid);
    expect(displays.some((d) => /Father/i.test(d))).toBeTruthy();
    expect(displays.some((d) => /Hypertension/i.test(d))).toBeTruthy();

    await SectionFormPage.openEdit(page, FORM, section);
    await expect(page.locator('.family-history-item').getByLabel('Father', { exact: true })).toBeChecked();
    await expect(page.locator('.family-history-item').getByLabel('Mother', { exact: true })).not.toBeChecked();
  });

  test('saves complications with an onset date, the text and two indicators, and EDIT shows them again', async ({ page, api }) => {
    await complication(page, 'stroke').check();
    await pickDate(onsetDate(page, 'stroke'), '2024-03-15');
    await complication(page, 'htn').check();
    await page.locator('textarea').fill('Hypertensive crisis in 2023');
    await indicator(page, 'Smoke tobacco').locator('input[type=checkbox]').check();
    await answer(ynu(page, 'tobacco'), 'yes').check();
    await indicator(page, 'Drink alcohol').locator('input[type=checkbox]').check();
    await answer(ynu(page, 'alcohol'), 'no').check();
    await saveForm(page);

    const displays = await obsDisplays(api, section.encounter.uuid);
    expect(displays.some((d) => /^Complications related to hypertension: Cerebrovascular accident/i.test(d))).toBeTruthy();
    expect(displays.some((d) => /^Complications related to hypertension: Hypertension/i.test(d))).toBeTruthy();
    expect(displays.some((d) => /Hypertensive crisis in 2023/.test(d))).toBeTruthy();
    expect(displays.filter((d) => /^Sign\/Symptom name:/i.test(d))).toHaveLength(2);
    expect(displays.some((d) => /^Sign\/symptom present: Yes/i.test(d))).toBeTruthy();
    expect(displays.some((d) => /^Sign\/symptom present: No/i.test(d))).toBeTruthy();
    const date = (await getEncounterObs(api, section.encounter.uuid)).find((o) => o.concept.display === 'Diagnosis date');
    expect(String(date?.value)).toMatch(/^2024-03-15/);

    // toggles in EDIT start from the saved values
    await SectionFormPage.openEdit(page, FORM, section);
    await expect(complication(page, 'stroke')).toBeChecked();
    await expect(page.locator('#stroke-onset-date')).toBeVisible();
    await expect(page.locator('#pvd-onset-date')).toBeHidden();
    await expect(ynu(page, 'tobacco')).toBeVisible();
    await expect(answer(ynu(page, 'tobacco'), 'yes')).toBeChecked();
    await expect(ynu(page, 'ulcers')).toBeHidden();
    await expect(page.locator('textarea')).toHaveValue('Hypertensive crisis in 2023');

    // VIEW: the saved complications and indicators; groups that were not saved are not rendered (showIfEmpty=false)
    const view = await expectViewShowsSavedObs(page, api, FORM, section.encounter.uuid, await viewLabels(api, section.encounter.uuid));
    expect(await view.valueTexts()).toEqual(
      expect.arrayContaining(['[X] Stroke', '[X] Hypertension', 'Hypertensive crisis in 2023', '[X]', '[X] yes', '[X] no']),
    );
    await expect(view.page.locator('#stroke-onset-date')).toContainText(/15 Mar(ch)? 2024|15\/03\/2024/);
    await expect(view.page.locator('#tobacco-htn-dx-ynu .value')).toHaveText('[X] yes');
    await expect(view.page.locator('#ulcers-htn-dx-ynu .value')).toHaveCount(0);
    await expect(view.page.locator('body')).not.toContainText('PVD');
    // ifMode VIEW include=false (:159, :273): no heading, no button rows
    await expect(view.page.locator('h1, #buttonsTopRow, #buttons, #submit, #next, #cancel')).toHaveCount(0);
  });

  test('VIEW: an encounter nothing was saved on shows no value', async ({ page }) => {
    const view = await ViewFormPage.open(page, FORM, section.encounter.uuid);
    await expect(view.values).toHaveCount(0);
  });
});

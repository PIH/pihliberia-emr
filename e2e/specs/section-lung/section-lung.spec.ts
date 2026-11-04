import { type Page } from '@playwright/test';
import { test, expect, type SectionEncounter } from '../../core';
import { NCD_FOLLOWUP_ENCOUNTER_TYPE_UUID, NCD_INITIAL_ENCOUNTER_TYPE_UUID } from '../../core/constants';
import { getEncounterObs } from '../../commands';
import { SectionFormPage, ViewFormPage, expectViewShowsSavedObs } from '../../pages';

// section-lung.xml: the "Chronic Lung Disease" section of an NCD encounter: (NCD Initial only) CLD diagnoses, treatment start date and
// family history; then exposures (TB contact, cooking fire, smoking), symptom frequency, inhaler use, exacerbation and disease severity.
// On the visit page it is the `pihcore-lung` section of NCD Initial and NCD Followup encounters (_availability.e2e.md "Sections"); the
// specs create an NCD Followup encounter (and an NCD Initial one where the form branches on it) and open the edit URL directly.
// First written without a server (locators from the XML), then run and fixed against a local Liberia server: see README.md.
//
// Conditions in the form, from documentation inventory (section-lung.inv.md):
//   ifMode VIEW include=false  :200, :207, :406   a <style> for #family-history, the heading + next/submit script, the top-row section
//                                                 buttons + Next/Save/Cancel
//   includeIf encounterType == NCD Initial (ae06d311)  :226  CLD diagnoses (checkboxes), treatment start date, family history of
//                                                 asthma / COPD / other chronic lung disease (familyHistoryRelativeCheckboxes, pihcore tag)
// No `when` / `toggle`. Scripts: :211 setUpNextAndSubmitButtons() only (see _shared.e2e.md). No validation, default or derived value.
// Side effects on save: postSubmissionAction CleanDiagnosisConstructAction (:19, pihcore): a diagnosis group without a Diagnosis order
//   gets "Secondary" (tested with the NCD Initial diagnosis).
// Not covered here: the Next / section buttons (need the visit page), the treatment-start date picker, the ENTER-only parts.
// VIEW is covered by the save tests: a generic check on the Yes/No, exposure and number obs, and targeted checks for the exacerbation
//   and severity rows (their label is text outside the value, so the generic check cannot be used) and the NCD Initial diagnosis.
//
// Findings (V1.. High -> Low):
//   V1 Low :222, :280, :325  three <section id="cld-section"> and three id="asthma-copd" (:223, :281, :327): duplicate ids (nothing
//                            in the form or its scripts selects them). Fix: distinct ids.
//   V2 Low :355-360          "Steroid inhaler daily?" saves PIH:14589 "Inhaler more than twice per week": label and concept differ
//                            (unconfirmed which is intended). Fix: align the label with the concept or use a "daily" concept.
//   V3 Low :49-51            `padding: 0px 3px 0px 0px font-weight: bold;` (missing semicolon) is invalid CSS: the whole declaration is
//                            ignored, so labels get neither the padding nor the bold.

const FORM = 'section-lung.xml';
const PATIENT = { givenName: 'AutoLung', familyName: 'Tester', gender: 'F' as const };
const yes = /^yes$/i;
const no = /^no$/i;
const numberOf = (n: number) => new RegExp(`^${n}(\\.0)?$`);

// The numeric symptom rows are the first three <span class="first-label-inline"> of the grid (:330, :337, :345); the labels are message codes.
const symptomInput = (page: Page, index: number) =>
  page.locator('.cld-history-grid > span.first-label-inline').nth(index).locator('input[type=text]');
const exacerbation = (page: Page) => page.locator('p.list-inline', { hasText: 'Exacerbation today?' });
// The five disease-severity checkboxes (:389): Intermittent, Mild, Moderate, Severe persistent, Uncontrolled; the labels are labelText.
const severity = (page: Page) => page.locator('span[style*="display: block"] input[type="checkbox"]');

test.describe('section-lung (NCD Followup encounter)', () => {
  let section: SectionEncounter;

  test.beforeEach(async ({ page, createSectionEncounter }) => {
    section = await createSectionEncounter({ encounterTypeUuid: NCD_FOLLOWUP_ENCOUNTER_TYPE_UUID, patient: PATIENT });
    await SectionFormPage.openEdit(page, FORM, section);
  });

  test('does not offer the diagnoses and the family history for an NCD Followup encounter', async ({ page }) => {
    // includeIf :226, state "not NCD Initial"
    await expect(page.getByLabel('COPD', { exact: true })).toHaveCount(0);
    await expect(page.locator('.family-history-item')).toHaveCount(0);
    await expect(page.locator('#tb-contact')).toBeVisible(); // exposures and followup rows are always there
    await expect(severity(page)).toHaveCount(5);
  });

  test('offers the top-row section buttons and Next / Save / Cancel in EDIT mode, and the heading', async ({ page }) => {
    // ifMode :207, :406
    await expect(page.locator('h1:not(.name)')).toBeVisible();
    await expect(page.locator('#buttonsTopRow button.nextSection')).toHaveCount(10);
    await expect(page.locator('#buttonsTopRow #pihcore-lung')).toBeVisible();
    await expect(page.locator('#buttons #next')).toBeVisible();
    await expect(page.locator('#buttons #submit')).toBeVisible();
    await expect(page.locator('#buttons #cancel')).toBeVisible();
  });

  test('saves the exposures, symptom counts and inhaler use, and EDIT and VIEW show them again', async ({ page, api }) => {
    await page.locator('#tb-contact').getByLabel(yes).check();
    await page.locator('#cooking-method').getByLabel(/outdoor/i).check();
    await page.locator('#smoke-since-last-visit').getByLabel(yes).check();
    await page.locator('#secondhand-smoke').getByLabel(/^never$/i).check();
    await symptomInput(page, 0).fill('3');
    await symptomInput(page, 1).fill('2');
    await symptomInput(page, 2).fill('5');
    await page.locator('#steroid-inhaler').getByLabel(no).check();
    await new SectionFormPage(page, FORM).save();
    await new SectionFormPage(page, FORM).expectSaved();

    const obs = await getEncounterObs(api, section.encounter.uuid);
    const numbers = obs.map((o) => o.value).filter((v) => typeof v === 'number');
    expect(numbers).toEqual(expect.arrayContaining([3, 2, 5]));
    const displays = obs.map((o) => `${o.concept.display}: ${o.display}`.toLowerCase());
    expect(displays.some((d) => d.includes('outdoor fire'))).toBeTruthy();

    // EDIT starts from the saved values
    await SectionFormPage.openEdit(page, FORM, section);
    await expect(page.locator('#tb-contact').getByLabel(yes)).toBeChecked();
    await expect(page.locator('#cooking-method').getByLabel(/outdoor/i)).toBeChecked();
    await expect(page.locator('#secondhand-smoke').getByLabel(/^never$/i)).toBeChecked();
    await expect(symptomInput(page, 0)).toHaveValue(/^3(\.0)?$/);
    await expect(symptomInput(page, 2)).toHaveValue(/^5(\.0)?$/);
    await expect(page.locator('#steroid-inhaler').getByLabel(no)).toBeChecked();

    // VIEW: every saved text / number / coded obs, and no heading and no buttons (ifMode :207, :406); the unanswered rows show no value
    const view = await expectViewShowsSavedObs(page, api, FORM, section.encounter.uuid);
    const shown = await view.valueTexts();
    expect(shown.some((t) => numberOf(3).test(t))).toBeTruthy();
    expect(shown.some((t) => numberOf(2).test(t))).toBeTruthy();
    expect(shown.some((t) => numberOf(5).test(t))).toBeTruthy();
    await expect(view.page.locator('#tb-contact .value')).toHaveText(/\[X\]\s*yes/i);
    await expect(view.page.locator('#cooking-method .value')).toHaveText(/\[X\]\s*outdoor fire/i);
    await expect(view.page.locator('#smoke-since-last-visit .value')).toHaveText(/\[X\]\s*yes/i);
    await expect(view.page.locator('h1')).toHaveCount(0);
    await expect(view.page.locator('#buttonsTopRow, #buttons, #next, #submit')).toHaveCount(0);
  });

  test('saves the exacerbation question and the disease severity; VIEW shows them', async ({ page, api }) => {
    await exacerbation(page).getByLabel(yes).check();
    await severity(page).nth(1).check(); // Mild Persistent
    await new SectionFormPage(page, FORM).save();
    await new SectionFormPage(page, FORM).expectSaved();

    const obs = await getEncounterObs(api, section.encounter.uuid);
    const displays = obs.map((o) => `${o.concept.display}: ${o.display}`.toLowerCase());
    expect(displays.some((d) => d.includes('mild persistent'))).toBeTruthy();
    expect(displays.some((d) => d.includes('exacerbation'))).toBeTruthy();

    await SectionFormPage.openEdit(page, FORM, section);
    await expect(exacerbation(page).getByLabel(yes)).toBeChecked();
    await expect(severity(page).nth(1)).toBeChecked();
    await expect(severity(page).nth(0)).not.toBeChecked();

    // VIEW (targeted): the generic check cannot be used, the labels are text outside the value
    const view = await ViewFormPage.open(page, FORM, section.encounter.uuid);
    await expect(view.page.locator('p.list-inline', { hasText: 'Exacerbation today?' }).locator('.value')).toHaveText(/\[X\]\s*yes/i);
    expect((await view.valueTexts()).filter((t) => t.startsWith('[X]')).length).toBeGreaterThanOrEqual(2);
    await expect(view.page.locator('#steroid-inhaler .value')).toHaveCount(0);
  });
});

test.describe('section-lung (NCD Initial encounter)', () => {
  let section: SectionEncounter;

  test.beforeEach(async ({ page, createSectionEncounter }) => {
    section = await createSectionEncounter({ encounterTypeUuid: NCD_INITIAL_ENCOUNTER_TYPE_UUID, patient: PATIENT });
    await SectionFormPage.openEdit(page, FORM, section);
  });

  test('offers the CLD diagnoses and the family history of asthma, COPD and other chronic lung disease', async ({ page }) => {
    // includeIf :226, state "NCD Initial"
    for (const label of ['Asthma', 'COPD', 'Other chronic lung disease']) {
      await expect(page.getByLabel(label, { exact: true }).first()).toBeVisible();
    }
    await expect(page.locator('.family-history-item')).toHaveCount(3);
  });

  test('saves a diagnosis and a family history; the diagnosis gets a "Secondary" order; EDIT and VIEW show them', async ({ page, api }) => {
    await page.getByLabel('COPD', { exact: true }).first().check();
    await page.locator('.family-history-item').first().getByLabel('Father').check(); // asthma in the father
    await new SectionFormPage(page, FORM).save();
    await new SectionFormPage(page, FORM).expectSaved();

    const obs = await getEncounterObs(api, section.encounter.uuid);
    const displays = obs.map((o) => `${o.concept.display}: ${o.display}`.toLowerCase());
    expect(displays.some((d) => d.includes('copd'))).toBeTruthy();
    expect(displays.some((d) => d.includes('father'))).toBeTruthy();
    // postSubmissionAction CleanDiagnosisConstructAction :19
    expect(displays.some((d) => d.includes('secondary'))).toBeTruthy();

    await SectionFormPage.openEdit(page, FORM, section);
    await expect(page.getByLabel('COPD', { exact: true }).first()).toBeChecked();
    await expect(page.locator('.family-history-item').first().getByLabel('Father')).toBeChecked();
    await expect(page.locator('.family-history-item').nth(1).getByLabel('Father')).not.toBeChecked();

    // VIEW (targeted: the "Secondary" order is not a field of the form, so the generic check does not apply)
    const view = await ViewFormPage.open(page, FORM, section.encounter.uuid);
    const shown = await view.valueTexts();
    expect(shown).toContain('[X] COPD');
    expect(shown).toContain('[X] Father');
  });
});

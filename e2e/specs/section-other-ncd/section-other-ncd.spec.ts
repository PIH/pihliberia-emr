import { type APIRequestContext, type Page } from '@playwright/test';
import { test, expect, type SectionEncounter } from '../../core';
import { NCD_INITIAL_ENCOUNTER_TYPE_UUID } from '../../core/constants';
import { getEncounterObs } from '../../commands';
import { SectionFormPage, expectViewShowsSavedObs } from '../../pages';

// section-other-ncd.xml ("Other NCDs"): six coded diagnoses as checkboxes (each its own "Visit Diagnoses" group) and a
// free-text "Other NCD diagnosis". UNREFERENCED in Liberia (documentation/_availability.e2e.md: the liberia NCD configs in
// encounterTypeConfig.js omit it): no visit-page section opens it, so the specs open the edit URL directly on an NCD Initial
// encounter (the NCD parent chosen for them). First written without a server (locators from the XML), then run and fixed against a local Liberia server: see README.md.
//
// Conditions in the form, from documentation inventory (section-other-ncd.inv.md):
//   ifMode VIEW include=false  :136, :173   script, and the #buttons row in ENTER/EDIT only
// Scripts: :137 setUpNextAndSubmitButtons() only (see _shared.e2e.md). No validation, default or derived value.
// Required fields: none (a blank form saves). The checkbox labels are the concept names (no answerCode).
// Side effects on save: postSubmissionAction CleanDiagnosisConstructAction (:19): every "Visit Diagnoses" group that has a
//   coded diagnosis gets a "Diagnosis order: Secondary" member; a group with no diagnosis is voided as dangling.
// VIEW (getAsHtml.action): showIfEmpty=false hides the groups that were not saved, so only the ticked diagnoses and the
//   text show; the button row is absent.
// Not covered here: #next (needs the visit page); the Diagnosis order of a re-saved group in EDIT.
//
// Findings:
//   V1 Low :167  "Other NCD diagnosis" is PIH:7416 (the non-coded diagnosis concept) saved as a loose top-level obs, not as a
//                member of a "Visit Diagnoses" group, so it is not a diagnosis of the visit (unconfirmed: not run). Fix: wrap it
//                in an obsgroup PIH:Visit Diagnoses, as the checkboxes are.
//   V2 Info (form) the section is not offered anywhere in Liberia (see _availability), so these checkboxes cannot be reached.

const FORM = 'section-other-ncd.xml';

// The six diagnosis checkboxes, in the order of the repeat (:151-156); the labels are the concept names.
const DIAGNOSES = [
  'Deep vein thrombosis',
  'Pulmonary embolism',
  'Atrial fibrillation',
  'Mechanical heart valve',
  'Hyperlipidemia',
  'Obesity',
];

const checkboxes = (page: Page) => page.locator('#other-ncd input[type=checkbox]');
const otherText = (page: Page) => page.locator('#other-ncd input[type=text]');

const saveForm = async (page: Page) => {
  const form = new SectionFormPage(page, FORM);
  await form.save();
  await form.expectSaved();
};

const obsDisplays = async (api: APIRequestContext, encounterUuid: string): Promise<string[]> => {
  return (await getEncounterObs(api, encounterUuid)).map((o) => o.display);
};

test.describe('section-other-ncd', () => {
  let section: SectionEncounter;

  test.beforeEach(async ({ page, createSectionEncounter }) => {
    section = await createSectionEncounter({
      encounterTypeUuid: NCD_INITIAL_ENCOUNTER_TYPE_UUID,
      patient: { givenName: 'AutoOther', familyName: 'Tester', gender: 'F' },
    });
    await SectionFormPage.openEdit(page, FORM, section);
  });

  test('renders six unticked diagnosis checkboxes and one text field', async ({ page }) => {
    await expect(checkboxes(page)).toHaveCount(6);
    await expect(page.locator('#other-ncd input[type=checkbox]:checked')).toHaveCount(0);
    for (let i = 0; i < DIAGNOSES.length; i++) {
      await expect(page.locator('#other-ncd label').filter({ hasText: DIAGNOSES[i] }).first()).toBeVisible();
    }
    await expect(otherText(page)).toHaveCount(1);
    await expect(otherText(page)).toHaveValue('');
  });

  test('saves a blank form and records nothing', async ({ page, api }) => {
    await saveForm(page);
    expect(await obsDisplays(api, section.encounter.uuid)).toEqual([]);
  });

  test('saves diagnoses and the other-diagnosis text, adds a Diagnosis order to each, and EDIT shows them again', async ({
    page,
    api,
  }) => {
    await checkboxes(page).nth(0).check(); // Deep vein thrombosis
    await checkboxes(page).nth(5).check(); // Obesity
    await otherText(page).fill('Gout');
    await saveForm(page);

    const displays = await obsDisplays(api, section.encounter.uuid);
    expect(displays.some((d) => /^Diagnosis: Deep vein thrombosis/i.test(d))).toBeTruthy();
    expect(displays.some((d) => /^Diagnosis: Obesity/i.test(d))).toBeTruthy();
    expect(displays.some((d) => /Gout/.test(d))).toBeTruthy();
    // postSubmissionAction :19: one Secondary order per diagnosis group
    expect(displays.filter((d) => /^Diagnosis order:/i.test(d))).toHaveLength(2);
    expect(displays.some((d) => /Pulmonary embolism/i.test(d))).toBeFalsy();

    await SectionFormPage.openEdit(page, FORM, section);
    await expect(checkboxes(page).nth(0)).toBeChecked();
    await expect(checkboxes(page).nth(1)).not.toBeChecked();
    await expect(checkboxes(page).nth(5)).toBeChecked();
    await expect(otherText(page)).toHaveValue('Gout');
  });

  test('unticking a saved diagnosis and saving removes it', async ({ page, api }) => {
    await checkboxes(page).nth(2).check(); // Atrial fibrillation
    await saveForm(page);
    await SectionFormPage.openEdit(page, FORM, section);
    await expect(checkboxes(page).nth(2)).toBeChecked();
    await checkboxes(page).nth(2).uncheck();
    await saveForm(page);
    const displays = await obsDisplays(api, section.encounter.uuid);
    expect(displays.some((d) => /Atrial fibrillation/i.test(d))).toBeFalsy();
  });

  // VIEW: only the saved diagnoses and the text are values; the groups that were not saved are not rendered (showIfEmpty=false).
  test('VIEW: shows the ticked diagnoses and the text, not the others, and no buttons', async ({ page, api }) => {
    await checkboxes(page).nth(1).check(); // Pulmonary embolism
    await checkboxes(page).nth(4).check(); // Hyperlipidemia
    await otherText(page).fill('Gout');
    await saveForm(page);

    // the Diagnosis order the action adds is not a form field, so the VIEW has no value for it
    const labels: Record<string, string> = {};
    for (const o of await getEncounterObs(api, section.encounter.uuid)) {
      if (/^Diagnosis order:/i.test(o.display)) {
        labels[o.display] = '';
      }
    }
    const view = await expectViewShowsSavedObs(page, api, FORM, section.encounter.uuid, labels);
    const shown = await view.valueTexts();
    expect(shown).toEqual(expect.arrayContaining(['[X] Pulmonary embolism', '[X] Hyperlipidemia', 'Gout']));
    expect(shown.filter((t) => t.startsWith('[X]'))).toHaveLength(2);
    await expect(view.page.locator('#other-ncd')).not.toContainText('Deep vein thrombosis');
    await expect(view.page.locator('#other-ncd')).not.toContainText('Obesity');
    // ifMode VIEW include=false (:173)
    await expect(view.page.locator('#buttons, #submit, #next, #cancel')).toHaveCount(0);
  });
});

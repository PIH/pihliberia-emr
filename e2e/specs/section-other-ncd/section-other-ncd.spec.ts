import { type APIRequestContext, type Page } from '@playwright/test';
import { test, expect, type SectionEncounter } from '../../core';
import { NCD_INITIAL_ENCOUNTER_TYPE_UUID } from '../../core/constants';
import { getEncounterObs } from '../../commands';
import { SectionFormPage, VisitPage } from '../../pages';

// section-other-ncd.xml ("Other NCDs"): six coded diagnoses as checkboxes (each its own "Visit Diagnoses" group) and a
// free-text "Other NCD diagnosis". The specs open the edit URL directly on an NCD Initial encounter (the NCD parent chosen for them).
// First written without a server (locators from the XML), then run and fixed against a local Liberia server: see README.md.
//
// UNREACHABLE: no profile of this repo offers this form (the `liberia` NCD entries of encounterTypeConfig.js omit it, and no type that lists it
// is created by a Liberia entry point; _availability.e2e.md "Not reachable"). Tests open it by direct URL.
// Visit-page display: the visit page has no VIEW of this form for any encounter a Liberia user can have: the NCD Initial and NCD Followup entries
// (`liberia` key) list sections without `pihcore-other-ncds`, and the NCD part-2 types resolve to an entry with no sections. So the form's own VIEW
// (showIfEmpty=false groups, ifMode VIEW :136, :173) is not tested; the VIEW test below asserts that the NCD Initial entry does not list the section.
//
// Conditions in the form, from documentation inventory (section-other-ncd.inv.md):
//   ifMode VIEW include=false  :136, :173   script, and the #buttons row in ENTER/EDIT only
// Scripts: :137 setUpNextAndSubmitButtons() only (see _shared.e2e.md). No validation, default or derived value.
// Required fields: none (a blank form saves). The checkbox labels are the concept names (no answerCode).
// Side effects on save: postSubmissionAction CleanDiagnosisConstructAction (:19): every "Visit Diagnoses" group that has a
//   coded diagnosis gets a "Diagnosis order: Secondary" member; a group with no diagnosis is voided as dangling.
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

test.describe('section-other-ncd @unreachable', () => {
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

  // Visit-page display (header): the entry of the parent encounter lists no section that could show this form
  test('the visit page does not list this section for an NCD Initial encounter that holds its obs', async ({ page }) => {
    await checkboxes(page).nth(1).check(); // Pulmonary embolism
    await otherText(page).fill('Gout');
    await saveForm(page);

    const visit = await VisitPage.openOfEncounter(page, section.encounter.uuid);
    const entry = visit.encounterOfType(NCD_INITIAL_ENCOUNTER_TYPE_UUID);
    await expect(entry).toHaveCount(1);
    await visit.expand(entry);
    await expect(visit.section('pihcore-ncd-history')).toBeVisible(); // the entry lists its sections ...
    await expect(visit.section('pihcore-other-ncds')).toHaveCount(0); // ... but not this one, so there is no VIEW to test
  });
});

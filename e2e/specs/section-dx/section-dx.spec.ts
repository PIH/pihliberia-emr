import { type APIRequestContext } from '@playwright/test';
import { test, expect, type SectionEncounter } from '../../core';
import { FAMILY_MEDICINE_INTAKE_ENCOUNTER_TYPE_UUID } from '../../core/constants';
import { getEncounterObs } from '../../commands';
import { SectionFormPage, ViewFormPage, expectViewShowsSavedObs } from '../../pages';

// section-dx.xml ("Diagnostic"): the encounterDiagnosesByObs widget plus a "Clinical impression comments" textarea. On
// the visit page it is the `pihcore-diagnosis` section of Family Medicine Intake/Followup and NCD Initial/Followup
// (documentation/_availability.e2e.md); the specs open its edit URL directly on a Family Medicine Intake encounter.
// First written without a server (locators from the XML), then run and fixed against a local Liberia server: see README.md.
//
// Differs from the ZL/SL section-dx: no non-coded checkbox, no delivery includeIf, so there is no #nonCodedDiagnosis.
// Conditions in the form, from documentation inventory (section-dx.inv.md):
//   ifMode VIEW include=false  :4, :28, :50   CSS, heading + script, and the #buttons row in ENTER/EDIT only
// Scripts: :31 setUpNextAndSubmitButtons() only (see _shared.e2e.md, nextAndSubmitButtons.js). No validation, default or
// derived value. Required fields: none (a blank form saves).
// Side effects on save: none from the form itself (no postSubmissionAction); the diagnosis widget writes its own obs.
// VIEW (getAsHtml.action): the comment shows as a value, the Next/Save/Cancel row and the heading (ifMode :28, :50) are absent.
// Not covered here: picking a coded diagnosis in the widget (Angular autocomplete backed by concept search, shared with
// every consult form), #next (needs the visit page).
//
// Findings: none confirmed by reading (the widget and the message keys are outside this file).

const FORM = 'section-dx.xml';

// Local helper: display (and comment) of each obs on the synthetic encounter.
const obsDisplays = async (api: APIRequestContext, encounterUuid: string): Promise<string[]> => {
  return (await getEncounterObs(api, encounterUuid)).map((o) => o.display);
};

test.describe('section-dx', () => {
  let section: SectionEncounter;

  test.beforeEach(async ({ page, createSectionEncounter }) => {
    section = await createSectionEncounter({
      encounterTypeUuid: FAMILY_MEDICINE_INTAKE_ENCOUNTER_TYPE_UUID,
      patient: { givenName: 'AutoDx', familyName: 'Tester', gender: 'F' },
    });
    await SectionFormPage.openEdit(page, FORM, section);
  });

  test('renders the diagnosis target, one comments textarea and the Next, Save and Cancel buttons', async ({ page }) => {
    // ifMode :4/:28/:50 in EDIT: heading and buttons exist
    await expect(page.locator('#encounter-diagnoses-target')).toHaveCount(1);
    await expect(page.locator('#data-collection textarea:not([name="encounterDiagnoses"])')).toHaveCount(1);
    await expect(page.locator('#data-collection textarea:not([name="encounterDiagnoses"])')).toHaveValue('');
    await expect(page.locator('h3', { hasText: 'Clinical impressions' })).toHaveCount(1);
    await expect(page.locator('#next')).toBeVisible();
    await expect(page.locator('#submit')).toBeVisible();
    await expect(page.locator('#cancel')).toBeVisible();
  });

  test('saves a blank form and records nothing', async ({ page, api }) => {
    const form = new SectionFormPage(page, FORM);
    await form.save();
    await form.expectSaved();
    expect(await obsDisplays(api, section.encounter.uuid)).toEqual([]);
  });

  test('saves the comments and EDIT shows them again', async ({ page, api }) => {
    await page.locator('#data-collection textarea:not([name="encounterDiagnoses"])').fill('Chronic cough, review in two weeks');
    const form = new SectionFormPage(page, FORM);
    await form.save();
    await form.expectSaved();

    const displays = await obsDisplays(api, section.encounter.uuid);
    expect(displays.some((d) => d.includes('Chronic cough, review in two weeks'))).toBeTruthy();

    await SectionFormPage.openEdit(page, FORM, section);
    await expect(page.locator('#data-collection textarea:not([name="encounterDiagnoses"])')).toHaveValue('Chronic cough, review in two weeks');
  });

  // VIEW: the comment is a value; the heading and the button row (ifMode VIEW include=false) are not rendered.
  test('VIEW: shows the comments as a value, and no heading or buttons', async ({ page, api }) => {
    await page.locator('#data-collection textarea:not([name="encounterDiagnoses"])').fill('Chronic cough, review in two weeks');
    const form = new SectionFormPage(page, FORM);
    await form.save();
    await form.expectSaved();

    const view = await expectViewShowsSavedObs(page, api, FORM, section.encounter.uuid);
    expect(await view.valueTexts()).toContain('Chronic cough, review in two weeks');
    await expect(view.page.locator('#data-collection .value')).toHaveText('Chronic cough, review in two weeks');
    await expect(view.page.locator('#buttons, #submit, #next, #cancel')).toHaveCount(0);
    await expect(view.page.locator('h3', { hasText: 'Clinical impressions' })).toHaveCount(0);
  });

  // VIEW: nothing saved, so the comments field shows no value.
  test('VIEW: an unfilled comments field is not shown as a value', async ({ page, api }) => {
    const form = new SectionFormPage(page, FORM);
    await form.save();
    await form.expectSaved();

    const view = await ViewFormPage.open(page, FORM, section.encounter.uuid);
    await expect(view.page.locator('#data-collection .value')).toHaveCount(0);
    expect(await getEncounterObs(api, section.encounter.uuid)).toEqual([]);
  });
});

import { type Page } from '@playwright/test';
import { test, expect, type SectionEncounter } from '../../core';
import { FAMILY_MEDICINE_FOLLOWUP_ENCOUNTER_TYPE_UUID, FAMILY_MEDICINE_INTAKE_ENCOUNTER_TYPE_UUID } from '../../core/constants';
import { getEncounterObs } from '../../commands';
import { SectionFormPage, ViewFormPage, VisitPage, expectViewShowsSavedObs } from '../../pages';

// section-chief-complaint.xml (pihemr): "Chief Complaint" section, one free-text obs (CIEL:160531, `#chief-complaint`). On the visit page it is the
// `pihcore-chief-complaint` section, the first one, of Family Medicine FOLLOWUP encounters only (_availability.e2e.md "Sections"; Family Medicine Intake
// has `pihcore-history` instead); the specs create the parent encounter over REST (so it has no `form`) and open the section's edit URL directly (skips the
// gating of _availability.e2e.md). Runs on the local Liberia server (Harper stack).
//
// Conditions in the form, from documentation inventory (section-chief-complaint.inv.md):
//   ifMode VIEW include=false :16, :37   heading + script, and the #buttons row (Next, Save, Cancel); absent in VIEW
// Scripts: :21 setUpNextAndSubmitButtons() only (see _shared.e2e.md). No validation, default or derived value; nothing is required.
// Side effects on save: none (no postSubmissionAction, program, order).
// VIEW is tested on the visit page, which shows the section's own VIEW (`pihcore-chief-complaint` has an active templateModelUrl and
//   `viewSectionWithHtmlFormLong.page` in encounterTypeConfig.js :20-26): expectViewShowsSavedObs.
// Findings: see pihemr _findings.e2e.md#section-chief-complaint.xml, section-peds.xml (none).
// Not covered here: #next (moves to the next section of the parent entry form; needs the entry form, see _shared.e2e.md).

const FORM = 'section-chief-complaint.xml';
const COMPLAINT = 'Fever and headache for three days';

const complaint = (page: Page) => page.locator('#chief-complaint textarea');

test.describe('section-chief-complaint under Family Medicine Followup', () => {
  let section: SectionEncounter;

  test.beforeEach(async ({ page, createSectionEncounter }) => {
    section = await createSectionEncounter({
      encounterTypeUuid: FAMILY_MEDICINE_FOLLOWUP_ENCOUNTER_TYPE_UUID,
      patient: { givenName: 'AutoChiefComplaint', familyName: 'Tester', gender: 'F' },
    });
    await SectionFormPage.openEdit(page, FORM, section);
  });

  test('ENTER/EDIT shows the textarea and the Next, Save and Cancel buttons', async ({ page }) => {
    // ifMode VIEW include=false :16, :37
    await expect(complaint(page)).toBeVisible();
    await expect(page.locator('#next')).toBeVisible();
    await expect(page.locator('#submit')).toBeVisible();
    await expect(page.locator('#cancel')).toBeVisible();
  });

  test('saves with the complaint blank (nothing is required) and records no obs', async ({ page, api }) => {
    await new SectionFormPage(page, FORM).save();
    await new SectionFormPage(page, FORM).expectSaved();
    expect(await getEncounterObs(api, section.encounter.uuid)).toEqual([]);
  });

  test('saves the complaint, EDIT shows it again, VIEW shows it on the visit page', async ({ page, api }) => {
    await complaint(page).fill(COMPLAINT);
    await new SectionFormPage(page, FORM).save();
    await new SectionFormPage(page, FORM).expectSaved();

    const obs = await getEncounterObs(api, section.encounter.uuid);
    expect(obs).toHaveLength(1);
    expect(obs[0].concept.display).toBe('Chief complaint (text)');
    expect(obs[0].value).toBe(COMPLAINT);

    // EDIT starts from the saved value
    await SectionFormPage.openEdit(page, FORM, section);
    await expect(complaint(page)).toHaveValue(COMPLAINT);

    // VIEW (ifMode VIEW include=false :16, :37: no heading script, no buttons)
    const view = await expectViewShowsSavedObs(page, api, FORM, section.encounter.uuid);
    expect(await view.valueTexts()).toContain(COMPLAINT);
    await expect(view.page.locator('#buttons, #submit, #next, #cancel')).toHaveCount(0);
  });

  test('blanking the complaint in EDIT voids the obs, and VIEW then shows no value', async ({ page, api }) => {
    await complaint(page).fill(COMPLAINT);
    await new SectionFormPage(page, FORM).save();
    await new SectionFormPage(page, FORM).expectSaved();
    await SectionFormPage.openEdit(page, FORM, section);
    await complaint(page).fill('');
    await new SectionFormPage(page, FORM).save();
    await new SectionFormPage(page, FORM).expectSaved();
    expect(await getEncounterObs(api, section.encounter.uuid)).toEqual([]);

    const view = await ViewFormPage.open(page, FORM, section.encounter.uuid);
    await expect(view.values).toHaveCount(0);
    await expect(view.root.locator('#chief-complaint .emptyValue')).toHaveCount(1);
  });

  // The section is offered by the Followup encounter's visit-page configuration (encounterTypeConfig.js :1139 ff.), first of the list.
  test('the visit page lists pihcore-chief-complaint as the first section of the Followup encounter', async ({ page }) => {
    const visit = await VisitPage.openOfEncounter(page, section.encounter.uuid);
    await visit.expand(visit.encounterOfType(FAMILY_MEDICINE_FOLLOWUP_ENCOUNTER_TYPE_UUID));
    const ids = await visit.shownSectionIds();
    expect(ids[0]).toBe('pihcore-chief-complaint');
  });
});

test.describe('section-chief-complaint under Family Medicine Intake', () => {
  // Family Medicine Intake lists pihcore-history instead of the chief complaint; the form itself has no encounter-type condition.
  test('the visit page of an Intake encounter does not list pihcore-chief-complaint', async ({ page, createSectionEncounter }) => {
    const section = await createSectionEncounter({
      encounterTypeUuid: FAMILY_MEDICINE_INTAKE_ENCOUNTER_TYPE_UUID,
      patient: { givenName: 'AutoChiefComplaint', familyName: 'Tester', gender: 'F' },
    });
    const visit = await VisitPage.openOfEncounter(page, section.encounter.uuid);
    await visit.expand(visit.encounterOfType(FAMILY_MEDICINE_INTAKE_ENCOUNTER_TYPE_UUID));
    const ids = await visit.shownSectionIds();
    expect(ids).toContain('pihcore-history');
    expect(ids).not.toContain('pihcore-chief-complaint');
  });
});

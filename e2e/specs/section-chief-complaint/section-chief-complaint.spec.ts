import { test, expect } from '../../core';
import { FAMILY_MEDICINE_FOLLOWUP_ENCOUNTER_TYPE_UUID, FAMILY_MEDICINE_INTAKE_ENCOUNTER_TYPE_UUID } from '../../core/constants';
import { VisitPage } from '../../pages';

// section-chief-complaint.xml (pihemr): the form's own tests (ENTER/EDIT, save, blank save, VIEW) are shared by every site: pihemr e2e/src/specs/section-chief-complaint.spec.ts,
// run here under Family Medicine Followup (core/site.ts). What stays here is what only this site has: which sections the visit page lists. The `pihcore-chief-complaint` section is
// the first one of Family Medicine FOLLOWUP encounters only (_availability.e2e.md "Sections"); Family Medicine Intake has `pihcore-history` instead.
// Findings: see pihemr _findings.e2e.md#section-chief-complaint.xml, section-peds.xml (none).

test.describe('section-chief-complaint on the visit page', () => {
  test('the visit page lists pihcore-chief-complaint as the first section of the Followup encounter', async ({ page, createSectionEncounter }) => {
    const section = await createSectionEncounter({
      encounterTypeUuid: FAMILY_MEDICINE_FOLLOWUP_ENCOUNTER_TYPE_UUID,
      patient: { givenName: 'AutoChiefComplaint', familyName: 'Tester', gender: 'F' },
    });
    const visit = await VisitPage.openOfEncounter(page, section.encounter.uuid);
    await visit.expand(visit.encounterOfType(FAMILY_MEDICINE_FOLLOWUP_ENCOUNTER_TYPE_UUID));
    const ids = await visit.shownSectionIds();
    expect(ids[0]).toBe('pihcore-chief-complaint');
  });

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

// peds.xml: "Pediatrics form" (the "PEDS Form" encounter): two tables, Supplements History (5 supplements: checkbox + age) and Feeding History (4 methods:
// Yes / No checkboxes + age) with a comment box. No who/when/where block, no required field, no subform. The <htmlform> has NO formEncounterType: the encounter type
// uuid pihcore uses for it (LiberiaConfigConstants.ENCOUNTERTYPE_LIBERIAPEDSFORM_UUID, local const below) equals the form's own formUuid (see _availability.e2e.md, "peds").
// ENTER: EntryFormPage opens enterHtmlFormWithStandardUi in a visit the spec creates, so the gating (female patient, "Maternal and Child Location" tag, Task: emr.enterMCH;
// no dup check) is skipped; the patient is a 2-year-old girl. EDIT: SectionFormPage.openEdit on the saved encounter. The visit page has no edit/delete button for
// this type (no encounterTypeConfig.js entry), so only the direct URL reaches EDIT.
// First written without a server (locators from the XML), then run and fixed against a local Liberia server: see README.md.
//
// Conditions in the form, from documentation inventory (peds.inv.md):
//   ifMode VIEW include=false :150, :235 (the two h2) and :322 (#buttons: Next, Save, Cancel). No when / toggle / includeIf.
// Scripts (both jq(function), run also in EDIT):
//   :56-113  feeding rows: ticking Yes (.yes-feeding) enables the row's .ageReceived input, focuses it and unticks No; unticking Yes clears and disables it;
//            ticking No (.no-feeding) clears and disables the age and unticks Yes. On load every age is disabled unless its Yes is ticked (EDIT).
//   :115-148 supplement rows: ticking .supplement enables the row's age input, unticking clears and disables it; on load disabled unless ticked.
// Side effects on save: none (no enrollInProgram, no postSubmissionAction). A disabled input is not posted, so a cleared age is never saved.
// Not covered here: Cancel, the Next button (V2), Pleebo / Harper differences (none).
// Visit-page display: the visit page does NOT show this form's VIEW. The PEDS Form encounter type (fac9d9a2-..., resolved for `liberia`) has an entry in
//   encounterTypeConfig.js with `longTemplate: defaultHtmlFormEncounterLong.page` and `templateModelUrl: /module/htmlformentry/encounter.json?...` (HFE's field
//   list, not getAsHtml.action) and no `editUrl` (so no edit or delete button): the encounter is a card that expands to one label + .obs-value row per saved
//   field. The VIEW tests assert that card and those rows; the form's own VIEW (ifMode VIEW :150, :235, :322) is therefore not tested. The earlier VIEW
//   assertions (#vitamin-a .value, ... under getAsHtml.action) were removed for that reason.
//
// Findings (V1.. Medium -> Low):
//   V1 Medium :1-2   no formEncounterType. Confirmed by reading: htmlformentryui HtmlFormUtil sets an encounter type on the Form only from that attribute, HFE gives the
//                    encounter the Form's type only if it has one (FormEntrySession :682), and openmrs-core EncounterValidator rejects an encounter without a type
//                    (Encounter.error.encounterType.required): Save fails on any database where the Form row is created from this XML. Not confirmed: that no Form row
//                    already has a type. pihcore and dataexports/sql/diagnoses.sql expect the PEDS Form type fac9d9a2-... Fix: formEncounterType="fac9d9a2-d0bc-11ea-9995-3c6aa7c392cc"
//                    as a new formVersion. CONFIRMED on a server (first run): the submit answered {"general-form-error":"Encounter type is Required"}; the save test below is test.fail() until the attribute is added
//                    (its EDIT / VIEW parts then run for the first time: remove test.fail() when fixed).
//   V2 Low    :324   `#next` is a type="button" with no handler: peds.xml does not call setUpNextAndSubmitButtons() (the shared script only defines it), so Next does
//                    nothing. Fix: call it, or drop the button. (unconfirmed: not run)
//   V3 Low    :255, :258  answerCode="" on the checkbox obs gives them no label of their own (the row label is a table cell): not clickable by label, not announced.

import { type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { test, expect, birthdateYearsAgo } from '../../core';
import { getPatientEncounters } from '../../commands';
import { EntryFormPage, SectionFormPage, VisitPage, VISIT_PAGE_URL } from '../../pages';

const FORM = 'peds.xml';
// encounter type "PEDS Form" (encountertypes/liberiaEncounterTypes.csv); not in e2e/core/constants.ts
const PEDS_ENCOUNTER_TYPE_UUID = 'fac9d9a2-d0bc-11ea-9995-3c6aa7c392cc';
const PATIENT = { givenName: 'AutoPeds', familyName: 'Tester', gender: 'F' as const, birthdate: birthdateYearsAgo(2) };

const supplementRow = (page: Page, i: number) => page.locator('#supplements tbody tr').nth(i);
const feedingRow = (page: Page, i: number) => page.locator('#feeding tbody tr').nth(i);
const supplementBox = (row: Locator) => row.locator('input[type="checkbox"]');
const yesBox = (row: Locator) => row.locator('.yes-feeding input[type="checkbox"]');
const noBox = (row: Locator) => row.locator('.no-feeding input[type="checkbox"]');
const ageInput = (row: Locator) => row.locator('.ageReceived input[type="text"]');

// Every obs of the encounter, group members included.
const allObs = async (api: APIRequestContext, encounterUuid: string) => {
  const res = await api.get(`encounter/${encounterUuid}?v=custom:(obs:(display,concept:(display),value,groupMembers:(display,concept:(display),value)))`);
  expect(res.ok(), `get encounter obs: ${res.status()}`).toBeTruthy();
  type Raw = { display: string; concept: { display: string }; value: unknown; groupMembers?: Raw[] | null };
  const flat = ((await res.json()).obs as Raw[]).flatMap((o) => [o, ...(o.groupMembers ?? [])]);
  return flat.map((o) => ({
    concept: o.concept.display,
    display: o.display,
    value: o.value && typeof o.value === 'object' ? String((o.value as { display?: string }).display ?? '') : String(o.value ?? ''),
  }));
};

test.describe('peds', () => {
  test.describe('ENTER', () => {
    test.beforeEach(async ({ page, createEntryContext }) => {
      const context = await createEntryContext(PATIENT);
      await EntryFormPage.open(page, FORM, context);
      await expect(page.locator('#supplements')).toBeVisible();
    });

    test('shows both sections and the buttons, with no who/when/where block and every age input disabled', async ({ page }) => {
      // ifMode VIEW include=false :150, :235, :322; scripts :56-148 disable the ages on load
      await expect(page.locator('#htmlform h2')).toHaveCount(2);
      await expect(page.locator('#feeding')).toBeVisible();
      await expect(page.locator('#next')).toBeVisible();
      await expect(page.locator('#submit')).toBeVisible();
      await expect(page.locator('#cancel')).toBeVisible();
      await expect(page.locator('#who-when-where')).toHaveCount(0);
      await expect(page.locator('#supplements tbody tr')).toHaveCount(5);
      await expect(page.locator('#feeding tbody tr')).toHaveCount(5); // 4 methods + the comment row
      for (let i = 0; i < 5; i++) {
        await expect(ageInput(supplementRow(page, i)), `supplement ${i} age`).toBeDisabled();
      }
      for (let i = 0; i < 4; i++) {
        await expect(ageInput(feedingRow(page, i)), `feeding ${i} age`).toBeDisabled();
      }
    });

    // script :115-148
    test('ticking a supplement enables its age and unticking clears and disables it', async ({ page }) => {
      const row = supplementRow(page, 0); // Vitamin A (#vitamin-a)
      await expect(page.locator('#vitamin-a input[type="checkbox"]')).toBeVisible();
      await supplementBox(row).check();
      await expect(ageInput(row)).toBeEnabled();
      await expect(ageInput(supplementRow(page, 1))).toBeDisabled(); // the other rows are unaffected
      await ageInput(row).fill('6 months');
      await supplementBox(row).uncheck();
      await expect(ageInput(row)).toBeDisabled();
      await expect(ageInput(row)).toHaveValue('');
    });

    // script :56-113
    test('feeding Yes enables the age and unticks No; No clears and disables the age and unticks Yes', async ({ page }) => {
      const row = feedingRow(page, 0); // breastfeed exclusively (#breastfeeding-yes, #breastfeedAge)
      await expect(page.locator('#breastfeeding-yes input[type="checkbox"]')).toBeVisible();
      await expect(page.locator('#breastfeedAge input')).toBeDisabled();

      await noBox(row).check();
      await yesBox(row).check();
      await expect(ageInput(row)).toBeEnabled();
      await expect(noBox(row)).not.toBeChecked(); // :67
      await ageInput(row).fill('4 months');

      await noBox(row).check();
      await expect(yesBox(row)).not.toBeChecked(); // :90
      await expect(ageInput(row)).toBeDisabled(); // :86
      await expect(ageInput(row)).toHaveValue('');

      await yesBox(row).check();
      await expect(ageInput(row)).toBeEnabled();
      await yesBox(row).uncheck();
      await expect(ageInput(row)).toBeDisabled(); // :73
    });
  });

  test('saves supplements and feeding answers as a PEDS Form encounter; EDIT restores the ages; the visit page shows them', async ({ page, api, createEntryContext }) => {
    test.fail(); // V1: the form has no formEncounterType, so the save is refused (remove when fixed)
    const context = await createEntryContext(PATIENT);
    await EntryFormPage.open(page, FORM, context);
    await expect(page.locator('#supplements')).toBeVisible();

    await supplementBox(supplementRow(page, 0)).check();
    await ageInput(supplementRow(page, 0)).fill('6 months');
    await yesBox(feedingRow(page, 0)).check();
    await ageInput(feedingRow(page, 0)).fill('4 months');
    await noBox(feedingRow(page, 1)).check(); // infant formula: No
    await feedingRow(page, 4).locator('textarea').fill('Weaned slowly');
    await page.locator('#submit').click();
    await expect(page).toHaveURL(VISIT_PAGE_URL); // fails here if V1 is real (the page stays on the form with an error)

    await expect
      .poll(async () => (await getPatientEncounters(api, context.patient.uuid)).map((e) => e.encounterType.uuid))
      .toEqual([PEDS_ENCOUNTER_TYPE_UUID]);
    const [encounter] = await getPatientEncounters(api, context.patient.uuid);
    const obs = await allObs(api, encounter.uuid);
    const values = obs.map((o) => o.value);
    expect(values).toContain('6 months');
    expect(values).toContain('4 months');
    expect(values).toContain('Weaned slowly');
    expect(obs.some((o) => /supplement/i.test(o.concept) && /vitamin a/i.test(o.value))).toBeTruthy();
    expect(obs.some((o) => /feeding method absent/i.test(o.concept))).toBeTruthy(); // the No of infant formula

    // EDIT: the scripts run on load, so only ticked rows have an enabled age
    const section = { patient: context.patient, encounter: { uuid: encounter.uuid, visitUuid: context.visitUuid } };
    await SectionFormPage.openEdit(page, FORM, section);
    await expect(supplementBox(supplementRow(page, 0))).toBeChecked();
    await expect(ageInput(supplementRow(page, 0))).toBeEnabled();
    await expect(ageInput(supplementRow(page, 0))).toHaveValue('6 months');
    await expect(ageInput(supplementRow(page, 1))).toBeDisabled();
    await expect(yesBox(feedingRow(page, 0))).toBeChecked();
    await expect(ageInput(feedingRow(page, 0))).toBeEnabled();
    await expect(ageInput(feedingRow(page, 0))).toHaveValue('4 months');
    await expect(noBox(feedingRow(page, 1))).toBeChecked();
    await expect(ageInput(feedingRow(page, 1))).toBeDisabled();
    await expect(feedingRow(page, 4).locator('textarea')).toHaveValue('Weaned slowly');

    // Visit-page display (header): one .obs-value row per saved field (never reached while V1 holds: the save is refused)
    const visit = await VisitPage.open(page, context.visitUuid);
    const long = await visit.expand(visit.encounterOfType(PEDS_ENCOUNTER_TYPE_UUID));
    const rows = (await long.locator('.obs-value').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim());
    expect(rows.join(' | ')).toMatch(/Vitamin A/i);
    expect(rows).toContain('6 months');
    expect(rows).toContain('4 months');
    expect(rows).toContain('Weaned slowly');
    await expect(long.locator('h2, #buttons, input, textarea')).toHaveCount(0); // none of the form's own HTML
  });

  // Visit-page display (header): an encounter created over REST (the form cannot save one, V1) with no obs
  test('the visit page lists an empty PEDS Form encounter with no rows, no form and no edit or delete button', async ({ page, createSectionEncounter }) => {
    const section = await createSectionEncounter({ encounterTypeUuid: PEDS_ENCOUNTER_TYPE_UUID, patient: PATIENT });
    const visit = await VisitPage.openOfEncounter(page, section.encounter.uuid);
    const entry = visit.encounterOfType(PEDS_ENCOUNTER_TYPE_UUID);
    await expect(entry).toHaveCount(1);
    const long = await visit.expand(entry);
    await expect(long.locator('.obs-value')).toHaveCount(0);
    await expect(long.locator('#supplements, #feeding, h2, #buttons, input, textarea')).toHaveCount(0); // none of the form's own HTML
    await expect(entry.locator('a.edit-encounter:visible, a.delete-encounter:visible')).toHaveCount(0); // no editUrl: visit.js :287, :297
  });
});

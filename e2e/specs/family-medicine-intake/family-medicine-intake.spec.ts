// family-medicine-intake.xml: header form of "Family Medicine Intake": only who/when/where (shared EPLD) and
// Next/Save/Cancel; the content is in the section-* forms of the visit page. ENTER: EntryFormPage opens enterHtmlFormWithStandardUi inside a visit the spec creates, so the
// availability gating of _availability.e2e.md (Consult Note Location, no Family Medicine encounter in the visit, harper only)
// is skipped. EDIT: a REST-created encounter is opened with SectionFormPage (the form has no sections of its own).
// First written without a server (locators from the XML), then run and fixed against a local Liberia server: see README.md.
//
// Conditions in the form, from documentation inventory (family-medicine-intake.inv.md):
//   ifMode ENTER :10-16  script: submitHtmlForm() on load, with no check at all (unlike ncd-*, which test the location first). The
//                        harness logs in at NCD Clinic ("Consult Note Location"), so provider/location/date are preselected and ENTER
//                        saves by itself (needs a Provider account for the API user).
//   ifMode EDIT  :18-27  script: show .htmlform, setUpNextAndSubmitButtons() (see _shared nextAndSubmitButtons.js, V4)
//   ifMode VIEW include=false :30 (h2), :45 (#buttons); the EPLD block is VIEW-excluded too (see _shared EPLD)
// Scripts: only the two above. Side effects on save: none (no obs); the encounter type is Family Medicine Intake.
// Not covered here: the visit page returnUrl of the app-loader link (see _availability layer 8), the retro-privilege disabled
//   date/provider (see _shared EPLD), ENTER with a session location that lacks the tag.
//
// Findings:
//   V1 Low :10-16  ENTER submits unconditionally and .htmlform is display:none. With no provider (API user without a Provider
//                  account), no location (session at a location without the tag) or a blank date the submit fails validation
//                  inside the hidden form: an empty page, no error shown. Fix: show .htmlform when the submit fails, or test the
//                  location like ncd-initial does. (unconfirmed: not run)

import { type APIRequestContext } from '@playwright/test';
import { test, expect } from '../../core';
import { NCD_CLINIC_LOCATION_UUID, FAMILY_MEDICINE_INTAKE_ENCOUNTER_TYPE_UUID } from '../../core/constants';
import { getEncounterObs, getPatientEncounters } from '../../commands';
import { EntryFormPage, SectionFormPage, ViewFormPage, VISIT_PAGE_URL, selectDefaultProvider } from '../../pages';

const FORM = 'family-medicine-intake.xml';
const HEADING = 'Family Medicine Intake'; // ui.i18n.EncounterType.name.<uuid> in messages_en.properties
const PATIENT = { givenName: 'AutoFmIntake', familyName: 'Tester' };
const LOCATION_OPTIONS = '#where select option';

// A location option's text, without the blank "choose" entry.
const locationNames = async (page: import('@playwright/test').Page): Promise<string[]> =>
  (await page.locator(LOCATION_OPTIONS).allTextContents()).map((t) => t.trim()).filter((t) => t !== '');

const encounterDetails = async (api: APIRequestContext, encounterUuid: string) => {
  const res = await api.get(`encounter/${encounterUuid}?v=custom:(location:(uuid),encounterProviders:(uuid))`);
  expect(res.ok(), `get encounter: ${res.status()}`).toBeTruthy();
  return (await res.json()) as { location: { uuid: string } | null; encounterProviders: Array<{ uuid: string }> };
};

test.describe('family-medicine-intake', () => {
  // ifMode ENTER :10-16 (submitHtmlForm() with no check)
  test('ENTER submits itself on load: one Family Medicine Intake encounter at the session location, back on the visit page', async ({
    page,
    api,
    createEntryContext,
  }) => {
    const context = await createEntryContext(PATIENT);

    // htmlformentryui submits on DOM-ready and then redirects, which can interrupt a goto that waits for `load`
    await page.goto(EntryFormPage.enterUrl(FORM, context), { waitUntil: 'commit' });
    const form = new EntryFormPage(page, FORM);
    await form.expectSaved();

    await expect
      .poll(async () => (await getPatientEncounters(api, context.patient.uuid)).map((e) => e.encounterType.uuid))
      .toEqual([FAMILY_MEDICINE_INTAKE_ENCOUNTER_TYPE_UUID]);
    const [encounter] = await getPatientEncounters(api, context.patient.uuid);
    expect(await getEncounterObs(api, encounter.uuid)).toHaveLength(0);
    const details = await encounterDetails(api, encounter.uuid);
    expect(details.location?.uuid).toBe(NCD_CLINIC_LOCATION_UUID); // the session location, preselected in #where
    expect(details.encounterProviders).toHaveLength(1); // the current user, preselected in #who
  });

  test.describe('EDIT', () => {
    // ifMode EDIT :18-27
    test('shows the heading, who/when/where and the Next, Save and Cancel buttons', async ({ page, createSectionEncounter }) => {
      const section = await createSectionEncounter({ encounterTypeUuid: FAMILY_MEDICINE_INTAKE_ENCOUNTER_TYPE_UUID, patient: PATIENT });
      await SectionFormPage.openEdit(page, FORM, section);

      await expect(page.locator('.htmlform')).toBeVisible();
      await expect(page.locator('h2')).toHaveText(HEADING);
      for (const id of ['#who select', '#where select', '#when']) {
        await expect(page.locator(id).first(), `${id} is shown`).toBeVisible();
      }
      for (const id of ['#next', '#submit', '#cancel']) {
        await expect(page.locator(id), `${id} is shown`).toBeVisible();
      }
    });

    // encounterLocation tags="Consult Note Location" (:36)
    test('the location select offers only locations tagged "Consult Note Location"', async ({ page, createSectionEncounter }) => {
      const section = await createSectionEncounter({ encounterTypeUuid: FAMILY_MEDICINE_INTAKE_ENCOUNTER_TYPE_UUID, patient: PATIENT });
      await SectionFormPage.openEdit(page, FORM, section);

      const names = await locationNames(page);
      // 11 clinics carry "Consult Note Location"; Pharmacy, Records Room and the Health Facility do not (see _shared EPLD table)
      expect(names).toEqual(expect.arrayContaining(['NCD Clinic', 'MCH Clinic', 'Family Medicine', 'Outpatient Clinic']));
      for (const excluded of ['Pharmacy', 'Records Room', 'Health Facility']) {
        expect(names, `${excluded} is not offered`).not.toContain(excluded);
      }
      // the encounter was saved at NCD Clinic, which is in the list and selected
      await expect(page.locator('#where select option:checked')).toHaveText('NCD Clinic');
    });

    // required="true" on encounterProviderAndRole (:38-41): a REST-created encounter has no provider
    test('Save without a provider reports Required and saves nothing', async ({ page, api, createSectionEncounter }) => {
      const section = await createSectionEncounter({ encounterTypeUuid: FAMILY_MEDICINE_INTAKE_ENCOUNTER_TYPE_UUID, patient: PATIENT });
      const form = await SectionFormPage.openEdit(page, FORM, section);

      // the default (current user) may already be selected in EDIT: pick "Choose a Provider" to make it blank
      await page.locator('#who select').first().selectOption({ index: 0 });
      await form.save();
      await expect(page.locator('span.field-error', { hasText: 'Required' }).first()).toBeVisible();
      await expect(page).not.toHaveURL(VISIT_PAGE_URL);
      expect((await encounterDetails(api, section.encounter.uuid)).encounterProviders).toHaveLength(0);
    });

    test('Save with a provider stores it and returns to the visit page', async ({ page, api, createSectionEncounter }) => {
      const section = await createSectionEncounter({ encounterTypeUuid: FAMILY_MEDICINE_INTAKE_ENCOUNTER_TYPE_UUID, patient: PATIENT });
      const form = await SectionFormPage.openEdit(page, FORM, section);

      await selectDefaultProvider(page);
      await form.save();
      await form.expectSaved();

      expect((await encounterDetails(api, section.encounter.uuid)).encounterProviders).toHaveLength(1);
      expect(await getEncounterObs(api, section.encounter.uuid)).toHaveLength(0);
    });

    // setUpNextAndSubmitButtons() (:24), see _shared "navigation" and V4
    test('Next saves and returns to the visit page with goToNext=true', async ({ page, api, createSectionEncounter }) => {
      const section = await createSectionEncounter({ encounterTypeUuid: FAMILY_MEDICINE_INTAKE_ENCOUNTER_TYPE_UUID, patient: PATIENT });
      await SectionFormPage.openEdit(page, FORM, section);

      await selectDefaultProvider(page);
      await page.locator('#next').click();

      await expect(page).toHaveURL(/pihcore\/visit\/visit\.page.*goToNext=true/);
      expect((await encounterDetails(api, section.encounter.uuid)).encounterProviders).toHaveLength(1);
    });
  });

  // VIEW (shell rule of the skill): the form has no obs of its own; the who/when/where block, h2 and #buttons are
  // ifMode VIEW include=false, and .htmlform stays display:none because only the ENTER/EDIT scripts show it.
  test('VIEW: renders no values, no fields and no buttons', async ({ page, createSectionEncounter }) => {
    const section = await createSectionEncounter({ encounterTypeUuid: FAMILY_MEDICINE_INTAKE_ENCOUNTER_TYPE_UUID, patient: PATIENT });

    const view = await ViewFormPage.open(page, FORM, section.encounter.uuid);

    expect(await view.valueTexts()).toEqual([]);
    await expect(page.locator('span.emptyValue')).toHaveCount(0);
    await expect(page.locator('#who-when-where, #buttons, select, input, button, h2')).toHaveCount(0);
    await expect(page.locator('.htmlform')).toBeHidden();
  });
});

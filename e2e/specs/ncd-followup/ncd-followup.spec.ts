// ncd-followup.xml: header form of "NCD Followup": only who/when/where (shared EPLD) and Next/Save/Cancel; the content is in the
// section-* forms. ENTER: EntryFormPage opens enterHtmlFormWithStandardUi inside a visit the spec creates, so the availability
// gating of _availability.e2e.md (retro privilege, NCD Consult Location, no NCD encounter in the visit) is skipped. EDIT: a
// REST-created NCD Followup Consult encounter is opened with SectionFormPage (the form has no sections of its own).
// First written without a server (locators from the XML), then run and fixed against a local Liberia server: see README.md.
//
// Conditions in the form, from documentation inventory (ncd-followup.inv.md):
//   ifMode ENTER :30-44  script: no encounterLocation value -> hide #next, show .htmlform; otherwise submitHtmlForm() (inline copy of
//                        encounter-with-sections.xml, see _shared "Leads"). The harness logs in at NCD Clinic, which carries the
//                        tag, so the location is preselected and ENTER saves by itself (needs a Provider account for the API user).
//   ifMode EDIT  :46-57  script: show .htmlform, setUpNextAndSubmitButtons() (see _shared nextAndSubmitButtons.js, V4)
//   ifMode VIEW include=false :17 (style #data-collection), :60 (h2), :75 (#buttons); the EPLD block is VIEW-excluded too
// Scripts: only the two above. Side effects on save: none (no obs); the encounter type is NCD Followup Consult.
// Not covered here: ENTER with a session location that lacks "NCD Consult Location" (the form is shown and Next hidden: needs a
//   session at another location, the browser session is shared), the retro-privilege disabled date/provider (see _shared EPLD).
//
// Findings:
//   V1 Low  :30-44  the ENTER auto-submit only guards the location. With no provider (API user without a Provider account) or a
//                   blank date the submit fails validation inside the display:none .htmlform: an empty page, no error shown (the
//                   XML comment :26-28 admits it). Fix: show .htmlform when the submit fails. (unconfirmed: not run)
//   V2 Info :17-23  the VIEW-excluded #data-collection rule in <style> matches no element of this form (copied from a section form).

import { type APIRequestContext } from '@playwright/test';
import { test, expect } from '../../core';
import { NCD_CLINIC_LOCATION_UUID, NCD_FOLLOWUP_ENCOUNTER_TYPE_UUID } from '../../core/constants';
import { getEncounterObs, getPatientEncounters } from '../../commands';
import { EntryFormPage, SectionFormPage, ViewFormPage, VISIT_PAGE_URL, selectDefaultProvider } from '../../pages';

const FORM = 'ncd-followup.xml';
const HEADING = 'NCD Followup'; // ui.i18n.EncounterType.name.<uuid> in messages_en.properties
const PATIENT = { givenName: 'AutoNcdFollowup', familyName: 'Tester' };
const LOCATION_OPTIONS = '#where select option';

// A location option's text, without the blank "choose" entry.
const locationNames = async (page: import('@playwright/test').Page): Promise<string[]> =>
  (await page.locator(LOCATION_OPTIONS).allTextContents()).map((t) => t.trim()).filter((t) => t !== '' && !/^Choose/.test(t));

const encounterDetails = async (api: APIRequestContext, encounterUuid: string) => {
  const res = await api.get(`encounter/${encounterUuid}?v=custom:(location:(uuid),encounterProviders:(uuid))`);
  expect(res.ok(), `get encounter: ${res.status()}`).toBeTruthy();
  return (await res.json()) as { location: { uuid: string } | null; encounterProviders: Array<{ uuid: string }> };
};

test.describe('ncd-followup', () => {
  // ifMode ENTER :30-44 (auto-submit if encounterLocation has a value)
  test('ENTER submits itself on load: one NCD Followup Consult encounter at the session location, back on the visit page', async ({
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
      .toEqual([NCD_FOLLOWUP_ENCOUNTER_TYPE_UUID]);
    const [encounter] = await getPatientEncounters(api, context.patient.uuid);
    expect(await getEncounterObs(api, encounter.uuid)).toHaveLength(0);
    const details = await encounterDetails(api, encounter.uuid);
    expect(details.location?.uuid).toBe(NCD_CLINIC_LOCATION_UUID); // the session location, preselected in #where
    expect(details.encounterProviders).toHaveLength(1); // the current user, preselected in #who
  });

  test.describe('EDIT', () => {
    // ifMode EDIT :46-57
    test('shows the heading, who/when/where and the Next, Save and Cancel buttons', async ({ page, createSectionEncounter }) => {
      const section = await createSectionEncounter({ encounterTypeUuid: NCD_FOLLOWUP_ENCOUNTER_TYPE_UUID, patient: PATIENT });
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

    // encounterLocation tags="NCD Consult Location" (:66)
    test('the location select offers only locations tagged "NCD Consult Location"', async ({ page, createSectionEncounter }) => {
      const section = await createSectionEncounter({ encounterTypeUuid: NCD_FOLLOWUP_ENCOUNTER_TYPE_UUID, patient: PATIENT });
      await SectionFormPage.openEdit(page, FORM, section);

      const names = await locationNames(page);
      // only the NCD Clinic carries "NCD Consult Location" (see _shared EPLD table)
      expect(names).toEqual(['NCD Clinic']);
      // the encounter was saved at NCD Clinic, which is in the list and selected
      await expect(page.locator('#where select option:checked')).toHaveText('NCD Clinic');
    });

    // required="true" on encounterProviderAndRole (:68-71): a REST-created encounter has no provider
    test('Save without a provider reports Required and saves nothing', async ({ page, api, createSectionEncounter }) => {
      const section = await createSectionEncounter({ encounterTypeUuid: NCD_FOLLOWUP_ENCOUNTER_TYPE_UUID, patient: PATIENT });
      const form = await SectionFormPage.openEdit(page, FORM, section);

      // the default (current user) may already be selected in EDIT: pick "Choose a Provider" to make it blank
      await page.locator('#who select').first().selectOption({ index: 0 });
      await form.save();
      await expect(page.locator('span.field-error', { hasText: 'Required' }).first()).toBeVisible();
      await expect(page).not.toHaveURL(VISIT_PAGE_URL);
      expect((await encounterDetails(api, section.encounter.uuid)).encounterProviders).toHaveLength(0);
    });

    test('Save with a provider stores it and returns to the visit page', async ({ page, api, createSectionEncounter }) => {
      const section = await createSectionEncounter({ encounterTypeUuid: NCD_FOLLOWUP_ENCOUNTER_TYPE_UUID, patient: PATIENT });
      const form = await SectionFormPage.openEdit(page, FORM, section);

      await selectDefaultProvider(page);
      await form.save();
      await form.expectSaved();

      expect((await encounterDetails(api, section.encounter.uuid)).encounterProviders).toHaveLength(1);
      expect(await getEncounterObs(api, section.encounter.uuid)).toHaveLength(0);
    });

    // setUpNextAndSubmitButtons() (:53), see _shared "navigation" and V4
    test('Next saves and returns to the visit page with goToNext=true', async ({ page, api, createSectionEncounter }) => {
      const section = await createSectionEncounter({ encounterTypeUuid: NCD_FOLLOWUP_ENCOUNTER_TYPE_UUID, patient: PATIENT });
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
    const section = await createSectionEncounter({ encounterTypeUuid: NCD_FOLLOWUP_ENCOUNTER_TYPE_UUID, patient: PATIENT });

    const view = await ViewFormPage.open(page, FORM, section.encounter.uuid);

    expect(await view.valueTexts()).toEqual([]);
    await expect(page.locator('span.emptyValue')).toHaveCount(0);
    await expect(page.locator('#who-when-where, #buttons, select, input, button, h2')).toHaveCount(0);
    await expect(page.locator('.htmlform')).toBeHidden();
  });
});

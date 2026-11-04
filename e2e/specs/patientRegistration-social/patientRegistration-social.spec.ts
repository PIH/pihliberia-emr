// patientRegistration-social.xml: "Social Indicators" of the patient: birthplace (one free-text obs) and occupation ("Main
// activity", one coded dropdown of 14 answers). Not a wizard fragment (see _availability.e2e.md): the registration summary page
// shows it as the editable "most recent encounter" widget, so the specs create an empty Patient Registration encounter over REST
// (createSectionEncounter) and open the edit URL directly, which skips that gating. No address hierarchy (unlike the ZL form).
// First written without a server (locators from the XML), then run and fixed against a local Liberia server: see README.md.
//
// Conditions in the form, from documentation inventory (patientRegistration-social.inv.md):
//   ifMode VIEW include=false :6, :20, :57   script, h2 "Social Indicators", #buttons (Save, Cancel): ENTER/EDIT only
//   No <when>, toggle, includeIf or required field: both obs are optional.
// Scripts (:7-17): removes the first `#social span.title` that HFE generates (headerCode="" leaves an empty title span).
// Save: the form's own button `#buttons button.submitButton` (onclick submitHtmlForm()), no `#submit`: buttonsSubmit().
// Side effects on save: none. Encounter type Patient Registration. The hidden `input#displayEncounterDate` (:26) is outside any
//   ifMode, so it is also in the VIEW.
// VIEW (getAsHtml.action with this form, see expectViewShowsSavedObs): the saved birthplace and occupation under #placeOfBirth and
//   #occupation (`.value`), an unanswered one is not shown as a value, the h2 and #buttons are absent.
// Not covered here: the summary-page widget, Cancel, the occupation answers one by one (only the label list and two samples).
//
// Findings:
//   V1 Low :48-49 occupation answers 8 and 9 are `CIEL:163714` ("Child with age <5 years", a Boolean concept) and `CIEL:165494`
//                  (a coded question "Any school-aged child is not attending school ..."), not answers of "Main activity"; the
//                  matching answer concept is PIH 12624 "Child greater than 5 years not attending school" (read in the PIH OCL
//                  export of ~/openmrs/liberia, not on a server). Fix: use the answer concepts. (unconfirmed: not run)
//   V2 Low :48-49  "Plantation Worker" (zl...plantationWorker.label) is bound to `PIH:HOUSEWORK/FIELDWORK`, whose concept is
//                  "Housework/Fieldwork" (tested below: VIEW shows the label, the saved value is the concept). Intent unconfirmed.
//   V3 Low :50     `size="dropdown"` is not an attribute of <obs> (the default dropdown renders anyway). Fix: delete it.

import { type APIRequestContext, type Page } from '@playwright/test';
import { test, expect, type SectionEncounter } from '../../core';
import { PATIENT_REGISTRATION_ENCOUNTER_TYPE_UUID } from '../../core/constants';
import { getEncounterObs } from '../../commands';
import { SectionFormPage, buttonsSubmit, expectViewShowsSavedObs, openEditWithButtonsSubmit } from '../../pages';

const FORM = 'patientRegistration-social.xml';

// The 14 answers in the order of answerConceptIds (:48), labelled by the answerCodes (messages_en.properties).
const OCCUPATION_LABELS = [
  'Student',
  'Retired',
  'Fisherman',
  'Farmer',
  'Driver',
  'Housework',
  'Professional',
  'Small Child (<5 yr)',
  'Child >5 yr not in school',
  'Self-employed',
  'Cleaner',
  'Plantation Worker',
  'Shop owner',
  'Other',
];

const birthplace = (page: Page) => page.locator('#placeOfBirth input');
const occupation = (page: Page) => page.locator('#occupation select');

const openForm = (page: Page, section: SectionEncounter) =>
  openEditWithButtonsSubmit(page, FORM, section);

const saveAndWait = async (page: Page) => {
  await buttonsSubmit(page).click();
  await new SectionFormPage(page, FORM).expectSaved();
  await page.waitForLoadState('load');
};

// The encounter's obs as "<question>: <answer>" displays.
const savedDisplays = async (api: APIRequestContext, encounterUuid: string) =>
  (await getEncounterObs(api, encounterUuid)).map((o) => o.display);

test.describe('patientRegistration-social', () => {
  let section: SectionEncounter;

  test.beforeEach(async ({ page, createSectionEncounter }) => {
    section = await createSectionEncounter({
      encounterTypeUuid: PATIENT_REGISTRATION_ENCOUNTER_TYPE_UUID,
      patient: { givenName: 'AutoSocial', familyName: 'Tester', gender: 'F' },
    });
    await openForm(page, section);
  });

  // ifMode VIEW include=false :6, :20, :57 (ENTER/EDIT) and the script :7-17
  test('renders the heading, the birthplace input, the occupation dropdown and the buttons, with the empty title span removed', async ({
    page,
  }) => {
    await expect(page.locator('h2')).toHaveText('Social Indicators');
    await expect(page.locator('h3', { hasNotText: 'Edit Patient Identifier' }).nth(0)).toHaveText('Place of Birth');
    await expect(page.locator('h3', { hasNotText: 'Edit Patient Identifier' }).nth(1)).toHaveText('Occupation');
    await expect(birthplace(page)).toBeVisible();
    await expect(birthplace(page)).toHaveValue('');
    await expect(occupation(page)).toHaveValue('');
    await expect(buttonsSubmit(page)).toBeVisible();
    await expect(page.locator('#buttons button.cancel')).toBeVisible();
    await expect(page.locator('#social span.title')).toHaveCount(0); // script :7-17
  });

  test('the occupation dropdown has a blank option and the 14 answers, with their translated labels', async ({ page }) => {
    await expect(occupation(page).locator('option')).toHaveCount(15);
    const labels = (await occupation(page).locator('option').allTextContents()).map((t) => t.trim()).filter((t) => t !== '');
    expect(labels).toEqual(OCCUPATION_LABELS);
  });

  test('Save with both questions blank succeeds (nothing is required) and stores no obs', async ({ page, api }) => {
    await saveAndWait(page);
    expect(await getEncounterObs(api, section.encounter.uuid)).toHaveLength(0);
  });

  test('saves the birthplace text and the occupation, and EDIT starts from them; VIEW shows both', async ({ page, api }) => {
    await birthplace(page).fill('Gbarnga');
    await occupation(page).selectOption({ label: 'Farmer' });
    await saveAndWait(page);

    const displays = (await savedDisplays(api, section.encounter.uuid)).map((d) => d.toLowerCase());
    expect(displays.some((d) => d.includes('birthplace') && d.includes('gbarnga'))).toBeTruthy();
    expect(displays.some((d) => d.includes('main activity') && d.includes('farmer'))).toBeTruthy();
    expect(displays).toHaveLength(2);

    // EDIT starts from the saved values
    await openForm(page, section);
    await expect(birthplace(page)).toHaveValue('Gbarnga');
    await expect(occupation(page).locator('option:checked')).toHaveText('Farmer');

    // VIEW: both values under their ids; the ENTER/EDIT-only parts are absent
    const view = await expectViewShowsSavedObs(page, api, FORM, section.encounter.uuid);
    await expect(view.page.locator('#placeOfBirth .value')).toHaveText('Gbarnga');
    await expect(view.page.locator('#occupation .value')).toHaveText('Farmer');
    for (const gone of ['h2', '#buttons', 'button.submitButton', '#placeOfBirth input', '#occupation select']) {
      await expect(view.page.locator(gone), `${gone} is ENTER/EDIT only`).toHaveCount(0);
    }
    await expect(view.page.locator('#displayEncounterDate')).toHaveCount(1); // the hidden input is outside any ifMode
  });

  test('EDIT: changing the occupation and clearing the birthplace replaces what was saved', async ({ page, api }) => {
    await birthplace(page).fill('Gbarnga');
    await occupation(page).selectOption({ label: 'Student' });
    await saveAndWait(page);

    await openForm(page, section);
    await birthplace(page).fill('');
    await occupation(page).selectOption({ label: 'Retired' });
    await saveAndWait(page);

    const displays = (await savedDisplays(api, section.encounter.uuid)).map((d) => d.toLowerCase());
    expect(displays).toHaveLength(1);
    expect(displays[0]).toContain('retired');

    // VIEW of the second save: the new occupation, no birthplace value
    const view = await expectViewShowsSavedObs(page, api, FORM, section.encounter.uuid);
    await expect(view.page.locator('#occupation .value')).toHaveText('Retired');
    await expect(view.page.locator('#placeOfBirth .value')).toHaveCount(0);
  });

  // answerCodes :49 vs answerConceptIds :48 (V2): the option labelled "Plantation Worker" is PIH:HOUSEWORK/FIELDWORK
  test('"Plantation Worker" saves the concept "Housework/Fieldwork" and the VIEW shows the label', async ({ page, api }) => {
    await occupation(page).selectOption({ label: 'Plantation Worker' });
    await saveAndWait(page);

    const displays = (await savedDisplays(api, section.encounter.uuid)).map((d) => d.toLowerCase());
    expect(displays.some((d) => d.includes('housework/fieldwork'))).toBeTruthy();

    // a coded answer the form labels differently from the concept name goes in `labels` (obs display -> text shown)
    const view = await expectViewShowsSavedObs(page, api, FORM, section.encounter.uuid, {
      'Main activity: Housework/Fieldwork': 'Plantation Worker',
    });
    await expect(view.page.locator('#occupation .value')).toHaveText('Plantation Worker');
  });
});

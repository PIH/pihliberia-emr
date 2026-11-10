import { type Page, type APIRequestContext } from '@playwright/test';
import { test, expect, type CustomTestFixtures, type EntryContext } from '../../core';
import { CHECKIN_ENCOUNTER_TYPE_UUID } from '../../core/constants';
import { getEncounterObs, getPatientEncounters } from '../../commands';
import { EntryFormPage, VisitPage, selectDefaultProvider, VISIT_PAGE_URL, visitPagePath } from '../../pages';

// checkin.xml v2.0: "Check-In": who/when/where (shared EPLD, role Administrative Clerk, tag "Check-In Location"), the type of visit
// (dropdown of 21 reasons for visit) and the optional Patient Support group (referred / escorted, who, name, phone). Production opens it
// in the Simple UI (visit action, registration action, edit: _availability.e2e.md), so the specs do too: direct URL in a visit the
// fixture creates (local helper openSimple); availability (Check-In Location tag, privilege) is not exercised. The harness session is at
// NCD Clinic, which carries the tag, so location and provider are preselected. First written without a server (locators from the XML), then run and fixed against a local Liberia server: see README.md.
//
// Conditions in the form, from documentation inventory (checkin.inv.md):
//   ifMode VIEW include=false :29-128  the whole entry form (EPLD "Details" question, type of visit, patient support, <submit/>)
//   ifMode VIEW               :132-181 read-only copy: typeOfVisit, patient support group with its own ids (patientSupportRole/-Location)
//   fieldset class="required" :58  "Type of visit": enforced by the Simple UI navigator only (V2)
// Scripts: none of its own (the EPLD script and the shared Navigator behaviour only, see _shared.e2e.md).
// Side effects on save: one Check-In encounter (55a0d3ea-...) with Reason for visit and, when answered, a Community supporter construct
//   group; no program, order or disposition.
// Not covered here: provider/location/date behaviour beyond the location list (_shared.e2e.md), the redirect after registration.
// Visit-page display: the visit page does NOT show this form's VIEW (ifMode VIEW :132-181 is therefore not tested). The Check-In entry of
//   encounterTypeConfig.js (// checkIn, 55a0d3ea-..., :818) has `shortTemplate: checkInShort.page`, `longTemplate: defaultHtmlFormEncounterLong.page`,
//   `templateModelUrl: /module/htmlformentry/encounter.json?...` (HFE's field list, not getAsHtml.action) and `showOnVisitList: false`: the
//   encounter is a collapsed card with the encounter type, date, "by <provider>" and the type-of-visit obs, and expanding it lists one
//   label + .obs-value row per saved field. The VIEW tests assert that card and those rows. EDIT is covered by the re-save test.
//
// Findings:
//   V1 Low  :87, :99   two obs share id="patientSupportType" in the ENTER/EDIT form (the referred/escorted radios and the "who" dropdown,
//                      the latter should be patientSupportRole as in VIEW :166). Duplicate ids break #id locators and CSS. Fix: rename :99.
//                      (the specs use .first() / .nth(1))
//   V2 Info :58        "Type of visit" is class="required", which only the Simple UI enforces: the Standard UI saves a Check-In with no
//                      reason for visit.
//   V3 Info :68-69     the ENTER labels differ from the concept names the VIEW prints ("Outpatient" / "Outpatient consultation", "Peds" /
//                      "Pediatric ward", "Medical ward" / "General medicine department", "EPI" / "Immunization visit").

const FORM = 'checkin.xml';
const PATIENT = { givenName: 'AutoCheckin', familyName: 'Tester', gender: 'F' as const };

// Local helpers.
const openSimple = async (page: Page, context: EntryContext) => {
  await page.goto(EntryFormPage.enterUrl(FORM, context).replace('enterHtmlFormWithStandardUi', 'enterHtmlFormWithSimpleUi'));
  await page.waitForLoadState('networkidle');
  await expect(page.locator('li.question-legend').first()).toBeVisible();
};
const editSimple = async (page: Page, context: EntryContext, encounterUuid: string) => {
  const params = new URLSearchParams({
    patientId: context.patient.uuid,
    encounterId: encounterUuid,
    definitionUiResource: `file:configuration/pih/htmlforms/${FORM}`,
    returnUrl: visitPagePath(context.visitUuid),
  });
  await page.goto(`htmlformentryui/htmlform/editHtmlFormWithSimpleUi.page?${params.toString()}`);
  await page.waitForLoadState('networkidle');
  await expect(page.locator('li.question-legend').first()).toBeVisible();
};
// The breadcrumb nests the questions in their section (<li><span>Patient Support</span><ul><li class="question-legend">...), and a
// section's questions are hidden until the section is open: click the question if it is visible, else open its section first.
const goTo = async (page: Page, label: string) => {
  const text = new RegExp(`^\\s*${label}\\s*$`);
  const question = page.locator('#formBreadcrumb li.question-legend', { hasText: text }).first();
  if (await question.isVisible()) {
    await question.click();
    return;
  }
  if ((await question.count()) === 0) {
    // a section without questions ("Confirm"): its own heading
    await page.locator('#formBreadcrumb li > span', { hasText: text }).first().click();
    return;
  }
  const section = page.locator('#formBreadcrumb li:not(.question-legend)').filter({ has: page.locator('li.question-legend', { hasText: text }) }).first();
  await section.locator(':scope > span').click();
  await question.click(); // opening the section focuses its first question, which may be another one
};
const saveSimple = async (page: Page) => {
  await goTo(page, 'Confirm');
  await page.locator('#confirmationQuestion button.submitButton').click();
  await expect(page).toHaveURL(VISIT_PAGE_URL);
};
const typeOfVisit = (page: Page) => page.locator('#typeOfVisit select');
// the two obs with id patientSupportType (V1): 0 = referred / escorted radios, 1 = who referred or escorted (dropdown)
const supportRadios = (page: Page) => page.locator('#patientSupportType').nth(0);
const supportWho = (page: Page) => page.locator('#patientSupportType').nth(1).locator('select');
const newPatient = (createEntryContext: CustomTestFixtures['createEntryContext']) => createEntryContext(PATIENT);
const savedCheckin = async (api: APIRequestContext, patientUuid: string) => {
  const encounters = await getPatientEncounters(api, patientUuid);
  expect(encounters.map((e) => e.encounterType.uuid)).toEqual([CHECKIN_ENCOUNTER_TYPE_UUID]);
  return { encounterUuid: encounters[0].uuid, obs: await getEncounterObs(api, encounters[0].uuid) };
};
const fillSupport = async (page: Page) => {
  await goTo(page, 'Patient Support');
  await supportRadios(page).getByLabel('Referred', { exact: true }).check();
  await supportWho(page).selectOption({ label: 'Community health assistant' });
  await page.locator('#patientSupportName input').fill('Test Escort');
  await page.locator('#patientSupportPhone input').fill('0770000000');
};

test.describe('checkin', () => {
  // EPLD (see _shared): tag "Check-In Location" on the location widget (:36-52), role Administrative Clerk
  test('the Details question offers the Check-In Location locations and preselects the session location', async ({ page, createEntryContext }) => {
    await openSimple(page, await newPatient(createEntryContext));
    const names = (await page.locator('#where select option').allTextContents()).map((t) => t.trim()).filter((t) => t !== '');
    // 12 locations carry the tag (_availability.e2e.md): everything but Pharmacy and the Health Facility
    expect(names).toEqual(expect.arrayContaining(['NCD Clinic', 'Records Room', 'Emergency', 'MCH Clinic']));
    expect(names).not.toContain('Pharmacy');
    expect(names).not.toContain('Health Facility');
    await expect(page.locator('#where select option:checked')).toHaveText('NCD Clinic');
  });

  test('the type of visit offers the 21 reasons for visit under the form labels', async ({ page, createEntryContext }) => {
    // answerLabels :68-69 (21 concepts, 21 labels)
    await openSimple(page, await newPatient(createEntryContext));
    await goTo(page, 'Type of visit');
    const labels = (await typeOfVisit(page).locator('option').allTextContents()).map((t) => t.trim()).filter((t) => t !== '');
    expect(labels).toHaveLength(21);
    expect(labels).toEqual(expect.arrayContaining(['Outpatient', 'Family Medicine', 'NCD Clinic', 'Eye Clinic', 'MDR-TB Clinic', 'Peds', 'Other']));
  });

  test('Confirm is refused while the required type of visit is blank', async ({ page, api, createEntryContext }) => {
    // fieldset class="required" :58
    const context = await newPatient(createEntryContext);
    await openSimple(page, context);
    await selectDefaultProvider(page);
    await goTo(page, 'Confirm');
    await expect(page.locator('span.field-error:visible', { hasText: 'Required' }).first()).toBeVisible();
    await expect(page.locator('#confirmationQuestion button.submitButton')).toBeHidden();
    expect(await getPatientEncounters(api, context.patient.uuid)).toHaveLength(0);
  });

  test('saves the type of visit alone as one Check-In encounter with no patient support group', async ({ page, api, createEntryContext }) => {
    const context = await newPatient(createEntryContext);
    await openSimple(page, context);
    await selectDefaultProvider(page);
    await goTo(page, 'Type of visit');
    await typeOfVisit(page).selectOption({ label: 'Outpatient' }); // PIH:OUTPATIENT CONSULTATION
    await saveSimple(page);

    const { obs } = await savedCheckin(api, context.patient.uuid);
    expect(obs.map((o) => o.display)).toEqual(['Reason for visit: Outpatient consultation']);
  });

  test('saves the patient support group (referred, who, name, phone) with the type of visit; EDIT starts from it and a re-save replaces the type', async ({
    page,
    api,
    createEntryContext,
  }) => {
    const context = await newPatient(createEntryContext);
    await openSimple(page, context);
    await selectDefaultProvider(page);
    await goTo(page, 'Type of visit');
    await typeOfVisit(page).selectOption({ label: 'Family Medicine' }); // PIH:21420
    await fillSupport(page);
    await saveSimple(page);

    const { encounterUuid, obs } = await savedCheckin(api, context.patient.uuid);
    const displays = obs.map((o) => o.display);
    expect(displays.some((d) => /^Reason for visit: Family medicine/i.test(d))).toBe(true);
    expect(displays.some((d) => /^Patient referred or escorted: Referral/i.test(d))).toBe(true); // PIH:11521
    expect(displays.some((d) => /^Role of community supporter: CHA/i.test(d))).toBe(true); // PIH:14496
    expect(displays.some((d) => /^Name of community health worker: Test Escort/i.test(d))).toBe(true); // CIEL:164141
    expect(displays.some((d) => /^Mobile phone number: 0770000000/.test(d))).toBe(true); // PIH:2614
    expect(obs.filter((o) => o.concept.display === 'Community supporter construct')).toHaveLength(1); // PIH:14493

    // EDIT (Simple UI, as the registration summary's edit link opens it): the saved answers are preselected
    await editSimple(page, context, encounterUuid);
    await goTo(page, 'Type of visit');
    await expect(typeOfVisit(page).locator('option:checked')).toHaveText('Family Medicine');
    await goTo(page, 'Patient Support');
    await expect(supportRadios(page).getByLabel('Referred', { exact: true })).toBeChecked();
    await expect(supportWho(page).locator('option:checked')).toHaveText('Community health assistant');
    await expect(page.locator('#patientSupportName input')).toHaveValue('Test Escort');
    await goTo(page, 'Type of visit');
    await typeOfVisit(page).selectOption({ label: 'Emergency' }); // PIH:EMERGENCY VISIT
    await saveSimple(page);
    await expect
      .poll(async () => (await getEncounterObs(api, encounterUuid)).map((o) => o.display))
      .toEqual(expect.arrayContaining([expect.stringMatching(/^Reason for visit: Emergency/i)]));
    const after = (await getEncounterObs(api, encounterUuid)).map((o) => o.display);
    expect(after.filter((d) => /^Reason for visit/.test(d))).toHaveLength(1);
    expect(after.some((d) => /Test Escort/.test(d))).toBe(true); // the group is kept
  });

  // Visit-page display (header): the card and the rows of defaultHtmlFormEncounterLong, one .obs-value per saved field
  test('the visit page shows the saved type of visit and support group as rows of the check-in entry, and none of the form', async ({ page, api, createEntryContext }) => {
    const context = await newPatient(createEntryContext);
    await openSimple(page, context);
    await selectDefaultProvider(page);
    await goTo(page, 'Type of visit');
    await typeOfVisit(page).selectOption({ label: 'Outpatient' });
    await fillSupport(page);
    await saveSimple(page);
    await savedCheckin(api, context.patient.uuid);

    const visit = await VisitPage.open(page, context.visitUuid);
    const entry = visit.encounterOfType(CHECKIN_ENCOUNTER_TYPE_UUID);
    await expect(entry).toHaveCount(1);
    await expect(entry.locator('.encounter-name').first()).toContainText('Check-in');
    const long = await visit.expand(entry);
    // the rows are filled when HFE's encounter.json has come back
    const rows = async () => (await long.locator('.obs-value').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim());
    await expect.poll(async () => (await rows()).join(' | ')).toMatch(/Outpatient/i); // the type of visit
    const shown = (await rows()).join(' | ');
    expect(shown).toMatch(/Referral/i); // PIH:11521
    expect(shown).toMatch(/CHA|Community health assistant/i); // PIH:14496
    expect(await rows()).toContain('Test Escort'); // CIEL:164141
    expect(await rows()).toContain('0770000000'); // PIH:2614
    await expect(long.locator('#most-recent-encounter-title, select, input[type=text], #save-form, input.submitButton, #who, #where')).toHaveCount(0); // none of the form's own HTML
  });

  test('the visit page shows no support rows for a check-in without a patient support group', async ({ page, api, createEntryContext }) => {
    const context = await newPatient(createEntryContext);
    await openSimple(page, context);
    await selectDefaultProvider(page);
    await goTo(page, 'Type of visit');
    await typeOfVisit(page).selectOption({ label: 'Emergency' });
    await saveSimple(page);
    await savedCheckin(api, context.patient.uuid);

    const visit = await VisitPage.open(page, context.visitUuid);
    const long = await visit.expand(visit.encounterOfType(CHECKIN_ENCOUNTER_TYPE_UUID));
    const rows = async () => (await long.locator('.obs-value').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim());
    await expect.poll(async () => (await rows()).join(' | ')).toMatch(/Emergency/i);
    expect((await rows()).join(' | ')).not.toMatch(/Referral|Escort|0770000000/i);
  });
});

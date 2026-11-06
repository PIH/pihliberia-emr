// epilepsy.xml: "Epilepsy Followup": seizures since the last visit, exam findings, care and triggers, hospitalization, medication, notes, support
// types and disposition. EntryFormPage opens enterHtmlFormWithStandardUi inside a visit the spec creates, which skips the availability gating of
// _availability.e2e.md (Mental Health Location tag and Task: emr.enterMentalHealthNote, not an epilepsy privilege or tag; no intake needed).
// The session is NCD Clinic, so every save picks "Mental Health Clinic" in the form's own location select.
// First written without a server (locators from the XML), then run and fixed against a local Liberia server: see README.md.
//
// Conditions in the form, from documentation inventory (epilepsy.inv.md):
//   includeIf F :241 (pregnancy status, yes_no) and :250 (on family planning)
//   toggle :344 medication checkbox -> {name}-rx-details (hide, clears inputs; 11 drugs)
//   ifMode VIEW include=false :79 (script) :142 (h2) :300 (css) :454 (#buttons)   ifMode VIEW :63 (css only)
// Scripts (:80-127): return visit minDate = encounter date with an alert when it resets (as the mental health forms, intact here); dead
//   medication-checkbox JS (V2); score placeholders for ids this form does not have. No validation of its own.
// Side effects on save: enrollInProgram Mental Health (:162); NO postSubmissionAction, although <encounterDisposition/> is there (V1).
//   Everything is inside <div id="intake-only"> (:166-462), which nothing hides.
// Not covered here: V1 (the missing action only matters for a Transfer disposition, which has real effects on the visit; dischargeIfAdmitted only for an admitted patient),
//   a Transfer disposition, the encounter-date change that resets the return date (the date is disabled without
//   Task: emr.retroConsultNote), a saved pregnancy answer, the other drugs. EDIT is the round trip of the save test; VIEW follows it.
//
// Findings (V1.. High -> Low):
//   V1 Medium :443 / :23 the form has <encounterDisposition/> but no `postSubmissionAction ApplyDispositionAction` (mentalHealthIntake.xml :23 has it): choosing
//                    Transfer out of / within hospital saves the disposition obs but never runs dischargeIfAdmittedDispositionAction or
//                    transferToSpecificLocationDispositionAction (pih-dispositions-liberia.json). Same in epilepsyIntake.xml. Fix: add the postSubmissionAction.
//   V2 Low    :101-119 dead medication-checkbox JS (the checkbox's td is alone in its row; `jq(it).not(':checked')` is always truthy); rows are hidden by toggle :344.
//   V3 Low    :203 :210 :217 Development (CIEL:160277), Mood (PIH:14131 = CIEL:167099) and Behavior/Appearance (CIEL:167092) are Normal/Abnormal here, but
//                    mentalHealthIntake.xml uses the same concepts with other answer sets (Normal/Slowly/Other, Sad/Elevated/..., Appropriate/Disheveled/...).
//   V4 Info   :166 the wrapper id "intake-only" and the unused ids in the script (#whodasScore, #cageScore, #gadScore) are leftovers of a combined form.

import { type APIRequestContext, type Page } from '@playwright/test';
import { test, expect, birthdateYearsAgo, type EntryContext } from '../../core';
import { EPILEPSY_FOLLOWUP_ENCOUNTER_TYPE_UUID, MENTAL_HEALTH_CLINIC_LOCATION_UUID } from '../../core/constants';
import { getEncounterObs, getPatientEncounters, type EncounterObs } from '../../commands';
import { EntryFormPage, SectionFormPage, ViewFormPage, viewMismatches, VISIT_PAGE_URL, selectDefaultProvider } from '../../pages';

const FORM = 'epilepsy.xml';
const PATIENT = { givenName: 'AutoEpiFollowup', familyName: 'Tester', gender: 'F' as const };
const SAVE = '#buttons input.submitButton'; // the form ends with the HFE <submit> tag: there is no #submit
const DRUG = 'Carbamazepine200mgt'; // one of the 11 medication rows (:382-392)

const pad = (n: number) => String(n).padStart(2, '0');
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const RETURN_DATE = new Date(Date.now() + 7 * 86400000);

// Read-only jQuery UI datepicker; setDate also updates the hidden field that is submitted.
const setDate = (page: Page, wrapper: string, date: Date) =>
  page.evaluate(
    ([w, ms]) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).jq(`${w} input.hasDatepicker`).datepicker('setDate', new Date(ms as number));
    },
    [wrapper, date.getTime()],
  );

const valueText = (o: EncounterObs): string => {
  const v = o.value;
  if (v !== null && typeof v === 'object') {
    return String((v as { display?: string }).display ?? '');
  }
  return String(v);
};

const fillWhoWhere = async (page: Page) => {
  await selectDefaultProvider(page);
  await page.locator('#where select').selectOption({ label: 'Mental Health Clinic' });
};

const openEnter = async (page: Page, context: EntryContext) => {
  await EntryFormPage.open(page, FORM, context);
  await expect(page.locator(SAVE)).toBeVisible();
};

const save = async (page: Page) => {
  await page.locator(SAVE).click();
  await expect(page).toHaveURL(VISIT_PAGE_URL);
};

const encounterDetails = async (api: APIRequestContext, encounterUuid: string) => {
  const res = await api.get(`encounter/${encounterUuid}?v=custom:(location:(uuid),encounterType:(uuid),encounterProviders:(uuid))`);
  expect(res.ok(), `get encounter: ${res.status()}`).toBeTruthy();
  return (await res.json()) as { location: { uuid: string } | null; encounterType: { uuid: string }; encounterProviders: Array<{ uuid: string }> };
};

const programNames = async (api: APIRequestContext, patientUuid: string): Promise<string[]> => {
  const res = await api.get(`programenrollment?patient=${patientUuid}&v=custom:(program:(name))`);
  expect(res.ok(), `get enrollments: ${res.status()}`).toBeTruthy();
  return ((await res.json()).results as Array<{ program: { name: string } }>).map((e) => e.program.name);
};

// The obs matched here are written but not rendered under their concept name: the relabelled dose unit / frequency answers (mg, BID) and the
// disposition group (asserted by hand below). Anchored on the "<question>: <answer> (looked for" strings of viewMismatches; the concept names
// are from the concept-mappings CSV, not from a server.
// "Disposition categories: Active status" is the category obs the disposition widget saves next to "Disposition"; VIEW prints only the disposition
const IGNORED_IN_VIEW = /^Disposition( categories)?: |: (Milligram|BID \(twice daily\)) \(looked for/i;
const openView = async (page: Page, api: APIRequestContext, encounterUuid: string): Promise<ViewFormPage> => {
  const view = await ViewFormPage.open(page, FORM, encounterUuid);
  expect(await view.values.count(), 'the VIEW shows at least one saved value').toBeGreaterThan(0);
  const missing = await viewMismatches(api, view, encounterUuid);
  expect(
    missing.filter((m) => !IGNORED_IN_VIEW.test(m)),
    'saved obs missing from the VIEW',
  ).toEqual([]);
  return view;
};

test.describe('epilepsy', () => {
  // encounterLocation tags="Consult Note Location" (:152)
  test('the location select offers Mental Health Clinic', async ({ page, createEntryContext }) => {
    await openEnter(page, await createEntryContext(PATIENT));
    const names = (await page.locator('#where select option').allTextContents()).map((t) => t.trim());
    expect(names).toContain('Mental Health Clinic');
  });

  // required="true" on encounterProviderAndRole (:157) and on #return-visit-date (:291)
  test('Save without a return visit date reports Required and saves nothing', async ({ page, api, createEntryContext }) => {
    const context = await createEntryContext(PATIENT);
    await openEnter(page, context);
    await fillWhoWhere(page);

    await page.locator(SAVE).click();
    await expect(page.locator('#return-visit-date span.field-error', { hasText: 'Required' })).toBeVisible();
    await expect(page).not.toHaveURL(VISIT_PAGE_URL);
    expect(await getPatientEncounters(api, context.patient.uuid)).toHaveLength(0);
  });

  // toggle :344 (style hidden)
  test('a medication checkbox shows its dose row, and unticking clears what was typed', async ({ page, createEntryContext }) => {
    await openEnter(page, await createEntryContext(PATIENT));
    const box = page.locator(`#${DRUG}-rx input[type=checkbox]`);
    const details = page.locator(`#${DRUG}-rx-details`);
    await expect(details).toBeHidden();
    await box.check();
    await expect(details).toBeVisible();
    await expect(page.locator(`#dose-${DRUG} input`)).toBeEnabled(); // the dead JS of V2 would have disabled it
    await page.locator(`#dose-${DRUG} input`).fill('200');
    await box.uncheck();
    await expect(details).toBeHidden();
    await box.check();
    await expect(page.locator(`#dose-${DRUG} input`)).toHaveValue('');
  });

  // includeIf :241 and :250: female only
  test('the family planning question is shown for a woman and not for a man', async ({ page, createEntryContext }) => {
    await openEnter(page, await createEntryContext(PATIENT));
    await expect(page.getByText('On family planning')).toHaveCount(1);
    const woman = await page.locator('#ep-visit input[type=radio]').count();

    await openEnter(page, await createEntryContext({ ...PATIENT, gender: 'M', birthdate: birthdateYearsAgo(30) }));
    await expect(page.getByText('On family planning')).toHaveCount(0);
    expect(await page.locator('#ep-visit input[type=radio]').count()).toBeLessThan(woman); // no pregnancy and family planning radios
  });

  // encounterDisposition (:443): this encounter type is in the "active" disposition of pih-dispositions-liberia.json, not in "enroll" (V1: no action runs)
  test('the disposition list offers Active, ED Observation and the transfers', async ({ page, createEntryContext }) => {
    await openEnter(page, await createEntryContext(PATIENT));
    const options = (await page.locator('#disposition select').first().locator('option').allTextContents()).map((t) => t.trim()).filter((t) => t !== '');
    expect(options).toEqual(expect.arrayContaining(['Active', 'ED Observation', 'Transfer out of hospital', 'Transfer within hospital']));
    expect(options).not.toContain('Enroll in program');
  });

  test('saves the followup, enrolls the patient in Mental Health, reopens in EDIT with the values and renders them in VIEW', async ({
    page,
    api,
    createEntryContext,
  }) => {
    test.setTimeout(180_000);
    const context = await createEntryContext(PATIENT);
    await openEnter(page, context);
    await fillWhoWhere(page);

    await page.locator('#ep-visit').getByLabel('Yes', { exact: true }).first().check(); // seizures since the last visit
    await page.locator('#number-of-seizures input').fill('3');
    await page.locator('#ep-visit').getByLabel('Abnormal', { exact: true }).first().check(); // neuro exam
    await page.locator('#med-side-effects').getByLabel('No', { exact: true }).check();
    await page.locator(`#${DRUG}-rx input[type=checkbox]`).check(); // toggle :344
    await page.locator(`#dose-${DRUG} input`).fill('200');
    await page.locator(`#doseUnit-${DRUG} select`).selectOption({ label: 'mg' });
    await page.locator(`#frequencyCoded-${DRUG} select`).selectOption({ label: 'BID' });
    await page.locator(`#duration-${DRUG} input`).fill('30');
    await page.locator(`#durationUnit-${DRUG} select`).selectOption({ label: 'Days' });
    await page.locator('#ep-notes textarea').fill('Seizure diary reviewed');
    await page.locator('#support-type').getByLabel('Psychoeducation', { exact: true }).check();
    await page.locator('#mh-plan .inline > input[type=text]').fill('Stable'); // disposition comments (not the transfer fields inside #disposition)
    await page.locator('#disposition select').first().selectOption({ label: 'Active' });
    await setDate(page, '#return-visit-date', RETURN_DATE);
    await save(page);

    const [encounter] = await getPatientEncounters(api, context.patient.uuid);
    expect(encounter.encounterType.uuid).toBe(EPILEPSY_FOLLOWUP_ENCOUNTER_TYPE_UUID);
    const details = await encounterDetails(api, encounter.uuid);
    expect(details.location?.uuid).toBe(MENTAL_HEALTH_CLINIC_LOCATION_UUID);
    expect(details.encounterProviders).toHaveLength(1);
    expect(await programNames(api, context.patient.uuid)).toContain('Mental Health'); // enrollInProgram :162

    const obs = await getEncounterObs(api, encounter.uuid);
    const values = obs.map(valueText);
    const displays = obs.map((o) => o.display);
    for (const text of ['Seizure diary reviewed', 'Stable']) {
      expect(values, text).toContain(text);
    }
    expect(values).toEqual(expect.arrayContaining(['3', '200', '30']));
    expect(displays.some((d) => /Seizures since last visit/i.test(d))).toBeTruthy();
    expect(displays.some((d) => /Neurologic exam findings:\s*Abnormal/i.test(d))).toBeTruthy();
    expect(displays.some((d) => /Mental health medication/i.test(d))).toBeTruthy();
    expect(displays.some((d) => /Active/i.test(d)), 'disposition').toBeTruthy();

    // EDIT starts from the saved values (the medication row is open)
    const editUrl = SectionFormPage.editUrl(FORM, { patient: context.patient, encounter: { uuid: encounter.uuid, visitUuid: context.visitUuid } });
    await page.goto(editUrl);
    await expect(page.locator(SAVE)).toBeVisible();
    await expect(page.locator('#number-of-seizures input')).toHaveValue('3');
    await expect(page.locator('#support-type').getByLabel('Psychoeducation', { exact: true })).toBeChecked();
    await expect(page.locator(`#${DRUG}-rx-details`)).toBeVisible();
    await expect(page.locator(`#dose-${DRUG} input`)).toHaveValue('200');
    await page.locator('#ep-notes textarea').fill('Seizure diary reviewed again');
    await save(page);
    const edited = (await getEncounterObs(api, encounter.uuid)).map(valueText);
    expect(edited).toContain('Seizure diary reviewed again');
    expect(edited).not.toContain('Seizure diary reviewed'); // the old obs is voided
    expect(edited).toEqual(expect.arrayContaining(['3', '200', '30'])); // saving in EDIT keeps the medication row

    // VIEW: saved values and the date; unselected medication rows are not rendered (obsgroup showIfEmpty=false); no heading, no buttons
    const view = await openView(page, api, encounter.uuid);
    const shown = await view.valueTexts();
    expect(shown).toContain('Seizure diary reviewed again');
    expect(shown).toContain('Stable');
    expect(shown).toContain('[X] Psychoeducation');
    expect(shown).toContain('[X] Abnormal');
    const apptText = `${pad(RETURN_DATE.getDate())} ${MONTHS[RETURN_DATE.getMonth()]} ${RETURN_DATE.getFullYear()}`;
    await expect(view.page.locator('#return-visit-date .value')).toHaveText(apptText);
    await expect(view.page.locator(`#${DRUG}-rx .value`)).toHaveCount(1);
    await expect(view.page.locator('#Diazepam5mgt-rx')).toHaveCount(0);
    await expect(view.page.locator('#buttons, h2, input.submitButton')).toHaveCount(0);
  });
});

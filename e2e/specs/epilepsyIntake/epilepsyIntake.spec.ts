// epilepsyIntake.xml: "Epilepsy Intake": onset, seizure types, complications, medical history, triggers, post-ictal features, medication, notes and
// disposition. EntryFormPage opens enterHtmlFormWithStandardUi inside a visit the spec creates, which skips the availability gating of
// _availability.e2e.md (Mental Health Location tag and Task: emr.enterMentalHealthNote, not an epilepsy privilege or tag). The session is NCD Clinic, so
// every save picks "Mental Health Clinic" in the form's own location select.
// First written without a server (locators from the XML), then run and fixed against a local Liberia server: see README.md.
//
// Conditions in the form, from documentation inventory (epilepsyIntake.inv.md):
//   toggle (dim) :259 :312 :353 :388  the "present" Yes/No/Unknown radios of each complication / history / trigger / post-ictal row are disabled and greyed
//                until the row's checkbox is ticked; unticking clears them (htmlForm.js setupObsToggleHandlers, 8 + 4 + 8 + 5 rows)
//   when :265  #ep-complications-{name} Yes -> #ep-complications-{name}-date-span (date of the complication)
//   toggle :454 medication checkbox -> {name}-rx-details (hide, clears inputs; 11 drugs)   ifMode VIEW include=false :80 :165 :410 :554, ifMode VIEW :64 (css)
// A `when` that hides its section also clears it (htmlForm.js onObsChangedCheck), so no hidden answer is saved.
// Scripts (:81-150): return visit minDate (as the mental health forms); beforeValidation validateSeizureType: at least one General seizure type
//   checkbox, else #seizure-type-error is shown and the save is blocked (tested); dead medication-checkbox JS (V4); score placeholders.
// Side effects on save: enrollInProgram Mental Health (:185); NO postSubmissionAction, although <encounterDisposition/> is there (V1).
// Not covered here: V1 (the missing action only matters for a Transfer disposition, which has real effects on the visit; dischargeIfAdmitted only for an admitted
//   patient), a Transfer disposition (real effects), the encounter-date change that resets the return date (the date is disabled without
//   Task: emr.retroConsultNote), the other drugs and rows. EDIT is the round trip of the save test; VIEW follows it.
//
// Findings (V1.. High -> Low):
//   V1 Medium :543 / :23-24 the form has <encounterDisposition/> but no `postSubmissionAction ApplyDispositionAction` (mentalHealthIntake.xml :23 has it): choosing
//                    Transfer out of / within hospital saves the disposition obs but never runs dischargeIfAdmittedDispositionAction or
//                    transferToSpecificLocationDispositionAction (pih-dispositions-liberia.json). Same in epilepsy.xml. Fix: add the postSubmissionAction.
//   V2 Low    :187,:212 two <section id="overview"> (duplicate id; #overview matches the first only). Fix: id="onset" on :187.
//   V3 (not reproduced) :240 the "Required" span has `hidden` and class field-error with display:block from the form css (:25-29); predicted to show from the
//                    start, but the first run showed it hidden (the test below passes), so it is not a finding. Kept as a regression test.
//   V4 Low    :124-142 dead medication-checkbox JS (the checkbox's td is alone in its row; `jq(it).not(':checked')` is always truthy); rows are hidden by toggle :454.
//   V5 Low    :115 `$("#seizure-type-div")` instead of jq(...): throws if `$` is not jQuery on the page, only when no seizure type is ticked.
//   V6 Info   :237 "Complex Partial" is commented out of the seizure types; the labelText/answerLabel="" checkboxes show a bare [X] in VIEW (label outside span.value).

import { type APIRequestContext, type Page } from '@playwright/test';
import { test, expect, type EntryContext } from '../../core';
import { EPILEPSY_INTAKE_ENCOUNTER_TYPE_UUID, MENTAL_HEALTH_CLINIC_LOCATION_UUID } from '../../core/constants';
import { getEncounterObs, getPatientEncounters, type EncounterObs } from '../../commands';
import { EntryFormPage, SectionFormPage, ViewFormPage, viewMismatches, VISIT_PAGE_URL, selectDefaultProvider } from '../../pages';

const FORM = 'epilepsyIntake.xml';
const PATIENT = { givenName: 'AutoEpiIntake', familyName: 'Tester', gender: 'F' as const };
const SAVE = '#buttons input.submitButton'; // the form ends with the HFE <submit> tag: there is no #submit
const DRUG = 'Carbamazepine200mgt'; // one of the 11 medication rows (:492-502)
const SEIZURE_TYPES = '#seizure-type-div > input[type=checkbox]'; // Absence, Tonic, Atonic, Myoclonic, Clonic, Unclassified (no ids, in this order)

const pad = (n: number) => String(n).padStart(2, '0');
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const inDays = (days: number) => new Date(Date.now() + days * 86400000);
const RETURN_DATE = inDays(7);

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

// The checkboxes with labelText and answerLabel="" show their label outside span.value ("[X]" only), so the answers of the seizure type,
// complication, history, trigger and post-ictal questions cannot be found by concept name; the focal-seizure radios and the relabelled
// dose unit / frequency / disposition are ignored too (their displays are not known without a server). Asserted by hand below.
// "Disposition categories: Active status" is the category obs the disposition widget saves next to "Disposition"; VIEW prints only the disposition
const IGNORED_IN_VIEW =
  /^(Seizure type|Sign\/Symptom name|Past medical history finding|Trigger for seizure|Symptom (present|absent|presence unknown)|Disposition|Disposition categories): |: (Milligram|BID \(twice daily\)) \(looked for/i;
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

// onset date (required) and return visit date (required), plus one seizure type
const fillRequired = async (page: Page) => {
  await fillWhoWhere(page);
  await setDate(page, '#onset-epilepsy-date', inDays(-700));
  await setDate(page, '#return-visit-date', RETURN_DATE);
  await page.locator(SEIZURE_TYPES).first().check();
};

test.describe('epilepsyIntake', () => {
  // encounterLocation tags="Consult Note Location" (:175)
  test('the location select offers Mental Health Clinic', async ({ page, createEntryContext }) => {
    await openEnter(page, await createEntryContext(PATIENT));
    const names = (await page.locator('#where select option').allTextContents()).map((t) => t.trim());
    expect(names).toContain('Mental Health Clinic');
  });

  test.describe('required fields and validation', () => {
    // required="true" :199 (onset date) and :531 (return visit date)
    test('Save without the onset date and the return visit date reports Required and saves nothing', async ({ page, api, createEntryContext }) => {
      const context = await createEntryContext(PATIENT);
      await openEnter(page, context);
      await fillWhoWhere(page);
      await page.locator(SEIZURE_TYPES).first().check(); // validateSeizureType passes

      await page.locator(SAVE).click();
      await expect(page.locator('#onset-epilepsy-date span.field-error', { hasText: 'Required' })).toBeVisible();
      await expect(page.locator('#return-visit-date span.field-error', { hasText: 'Required' })).toBeVisible();
      await expect(page).not.toHaveURL(VISIT_PAGE_URL);
      expect(await getPatientEncounters(api, context.patient.uuid)).toHaveLength(0);
    });

    // beforeValidation :119-121 / validateSeizureType :102-118
    test('Save without a general seizure type shows the Required message and saves nothing', async ({ page, api, createEntryContext }) => {
      const context = await createEntryContext(PATIENT);
      await openEnter(page, context);
      await fillWhoWhere(page);
      await setDate(page, '#onset-epilepsy-date', inDays(-700));
      await setDate(page, '#return-visit-date', RETURN_DATE);

      await page.locator(SAVE).click();
      await expect(page.locator('#seizure-type-error')).toBeVisible();
      await expect(page).not.toHaveURL(VISIT_PAGE_URL);
      expect(await getPatientEncounters(api, context.patient.uuid)).toHaveLength(0);

      await page.locator(SEIZURE_TYPES).nth(1).check(); // Tonic
      await save(page);
      expect(await getPatientEncounters(api, context.patient.uuid)).toHaveLength(1);
    });

    // :240 hidden="hidden" next to class field-error: the message must stay hidden until the first failed save
    test('the seizure type "Required" message is not shown before the first save', async ({ page, createEntryContext }) => {
      await openEnter(page, await createEntryContext(PATIENT));
      await expect(page.locator('#seizure-type-error')).toBeHidden();
    });
  });

  test.describe('conditions (toggle dim / when)', () => {
    // toggle dim :259 :312 :353 :388: one row of each of the four groups (ids {prefix}-{name}-id checkbox, {prefix}-{name} radios)
    const rows = [
      { prefix: 'ep-complications', name: 'injuries' },
      { prefix: 'ep-pmh', name: 'head-injury' },
      { prefix: 'ep-trigger', name: 'alcohol' },
      { prefix: 'ep-pif', name: 'headache' },
    ];
    for (const r of rows) {
      test(`${r.prefix}-${r.name}: the Yes/No/Unknown radios are disabled until the checkbox is ticked, and cleared when it is unticked`, async ({
        page,
        createEntryContext,
      }) => {
        await openEnter(page, await createEntryContext(PATIENT));
        const box = page.locator(`#${r.prefix}-${r.name}-id input[type=checkbox]`);
        const radios = page.locator(`#${r.prefix}-${r.name} input[type=radio]`);
        await expect(radios.first()).toBeDisabled();
        await box.check();
        await expect(radios.first()).toBeEnabled();
        await page.locator(`#${r.prefix}-${r.name}`).getByLabel('Unknown', { exact: true }).check();
        await box.uncheck();
        await expect(radios.first()).toBeDisabled();
        await expect(page.locator(`#${r.prefix}-${r.name}`).getByLabel('Unknown', { exact: true })).not.toBeChecked();
      });
    }

    // when :265: the date of the complication only for Yes
    test('a complication answered Yes shows its date, No and Unknown hide it', async ({ page, createEntryContext }) => {
      await openEnter(page, await createEntryContext(PATIENT));
      const date = page.locator('#ep-complications-burns-date-span');
      await page.locator('#ep-complications-burns-id input[type=checkbox]').check();
      await expect(date).toBeHidden();
      await page.locator('#ep-complications-burns').getByLabel('Yes', { exact: true }).check();
      await expect(date).toBeVisible();
      await page.locator('#ep-complications-burns').getByLabel('No', { exact: true }).check();
      await expect(date).toBeHidden();
      await page.locator('#ep-complications-burns').getByLabel('Yes', { exact: true }).check();
      await page.locator('#ep-complications-burns').getByLabel('Unknown', { exact: true }).check();
      await expect(date).toBeHidden();
    });

    // toggle :454 (style hidden)
    test('a medication checkbox shows its dose row, and unticking clears what was typed', async ({ page, createEntryContext }) => {
      await openEnter(page, await createEntryContext(PATIENT));
      const box = page.locator(`#${DRUG}-rx input[type=checkbox]`);
      const details = page.locator(`#${DRUG}-rx-details`);
      await expect(details).toBeHidden();
      await box.check();
      await expect(details).toBeVisible();
      await expect(page.locator(`#dose-${DRUG} input`)).toBeEnabled(); // the dead JS of V4 would have disabled it
      await page.locator(`#dose-${DRUG} input`).fill('200');
      await box.uncheck();
      await expect(details).toBeHidden();
      await box.check();
      await expect(page.locator(`#dose-${DRUG} input`)).toHaveValue('');
    });
  });

  // encounterDisposition (:543): this encounter type is in the "active" disposition of pih-dispositions-liberia.json, not in "enroll" (V1: no action runs)
  test('the disposition list offers Active, ED Observation and the transfers', async ({ page, createEntryContext }) => {
    await openEnter(page, await createEntryContext(PATIENT));
    const options = (await page.locator('#disposition select').first().locator('option').allTextContents()).map((t) => t.trim()).filter((t) => t !== '');
    expect(options).toEqual(expect.arrayContaining(['Active', 'ED Observation', 'Transfer out of hospital', 'Transfer within hospital']));
    expect(options).not.toContain('Enroll in program');
  });

  test('saves the intake, enrolls the patient in Mental Health, reopens in EDIT with the values and renders them in VIEW', async ({
    page,
    api,
    createEntryContext,
  }) => {
    test.setTimeout(180_000);
    const context = await createEntryContext(PATIENT);
    await openEnter(page, context);
    await fillRequired(page); // location, provider, onset date, return date, seizure type Absence
    await page.locator(SEIZURE_TYPES).nth(1).check(); // Tonic
    await page.locator('fieldset#overview').first().locator('.two-columns > div').nth(1).locator('input[type=text]').fill('14'); // age of onset

    await page.locator('#ep-focal').getByLabel('no', { exact: true }).check(); // focal seizure: yes / no / unknown radio set of three concepts
    await page.locator('#ep-complications-injuries-id input[type=checkbox]').check();
    await page.locator('#ep-complications-injuries').getByLabel('Yes', { exact: true }).check(); // when :265
    await setDate(page, '#ep-complications-injuries-date', inDays(-30));
    await page.locator('#ep-pmh-head-injury-id input[type=checkbox]').check();
    await page.locator('#ep-pmh-head-injury').getByLabel('Unknown', { exact: true }).check();
    await page.locator('#ep-trigger-alcohol-id input[type=checkbox]').check();
    await page.locator('#ep-trigger-alcohol').getByLabel('Yes', { exact: true }).check();
    await page.locator('#ep-pif-headache-id input[type=checkbox]').check();
    await page.locator('#ep-pif-headache').getByLabel('No', { exact: true }).check();
    await page.locator('#ep-other-complication input').fill('Tongue bite');

    await page.locator(`#${DRUG}-rx input[type=checkbox]`).check(); // toggle :454
    await page.locator(`#dose-${DRUG} input`).fill('200');
    await page.locator(`#doseUnit-${DRUG} select`).selectOption({ label: 'mg' });
    await page.locator(`#frequencyCoded-${DRUG} select`).selectOption({ label: 'BID' });
    await page.locator(`#duration-${DRUG} input`).fill('30');
    await page.locator(`#durationUnit-${DRUG} select`).selectOption({ label: 'Days' });
    await page.locator('#ep-notes textarea').fill('Seizure diary given');
    await page.locator('#disposition select').first().selectOption({ label: 'Active' });
    await save(page);

    const [encounter] = await getPatientEncounters(api, context.patient.uuid);
    expect(encounter.encounterType.uuid).toBe(EPILEPSY_INTAKE_ENCOUNTER_TYPE_UUID);
    const details = await encounterDetails(api, encounter.uuid);
    expect(details.location?.uuid).toBe(MENTAL_HEALTH_CLINIC_LOCATION_UUID);
    expect(details.encounterProviders).toHaveLength(1);
    expect(await programNames(api, context.patient.uuid)).toContain('Mental Health'); // enrollInProgram :185

    const obs = await getEncounterObs(api, encounter.uuid);
    const values = obs.map(valueText);
    const displays = obs.map((o) => o.display);
    for (const text of ['Tongue bite', 'Seizure diary given']) {
      expect(values, text).toContain(text);
    }
    expect(values).toEqual(expect.arrayContaining(['14', '200', '30']));
    expect(displays.filter((d) => /^Seizure type:/i.test(d))).toHaveLength(2); // Absence and Tonic
    expect(displays.some((d) => /Symptom absent/i.test(d)), 'focal seizure "no" is the concept Symptom absent').toBeTruthy();
    expect(displays.filter((d) => /^Sign\/Symptom name:/i.test(d)).length).toBeGreaterThanOrEqual(2); // complication + post-ictal feature
    expect(displays.some((d) => /Trigger for seizure/i.test(d))).toBeTruthy();
    expect(displays.some((d) => /Past medical history finding/i.test(d))).toBeTruthy();
    expect(displays.some((d) => /Mental health medication/i.test(d))).toBeTruthy();
    expect(displays.some((d) => /Active/i.test(d)), 'disposition').toBeTruthy();

    // EDIT starts from the saved state: ticked rows enabled, the date of the complication shown, the other rows still dimmed
    const editUrl = SectionFormPage.editUrl(FORM, { patient: context.patient, encounter: { uuid: encounter.uuid, visitUuid: context.visitUuid } });
    await page.goto(editUrl);
    await expect(page.locator(SAVE)).toBeVisible();
    await expect(page.locator(SEIZURE_TYPES).first()).toBeChecked();
    await expect(page.locator(SEIZURE_TYPES).nth(2)).not.toBeChecked();
    await expect(page.locator('#ep-complications-injuries-id input[type=checkbox]')).toBeChecked();
    await expect(page.locator('#ep-complications-injuries input[type=radio]').first()).toBeEnabled();
    await expect(page.locator('#ep-complications-injuries-date-span')).toBeVisible();
    await expect(page.locator('#ep-complications-burns input[type=radio]').first()).toBeDisabled();
    await expect(page.locator(`#${DRUG}-rx-details`)).toBeVisible();
    await expect(page.locator(`#dose-${DRUG} input`)).toHaveValue('200');
    await page.locator('#ep-notes textarea').fill('Seizure diary reviewed');
    await save(page);
    const edited = (await getEncounterObs(api, encounter.uuid)).map(valueText);
    expect(edited).toContain('Seizure diary reviewed');
    expect(edited).not.toContain('Seizure diary given'); // the old obs is voided
    expect(edited).toEqual(expect.arrayContaining(['200', '30', 'Tongue bite'])); // saving in EDIT keeps the rows

    // VIEW: the seizure types and answered rows show "[X]" (their label is outside span.value), untouched rows show no value; no heading, no buttons
    const view = await openView(page, api, encounter.uuid);
    const shown = await view.valueTexts();
    expect(shown).toContain('Seizure diary reviewed');
    expect(shown).toContain('Tongue bite');
    await expect(view.page.locator('#ep-complications-injuries-id .value')).toHaveText('[X]');
    await expect(view.page.locator('#ep-complications-injuries .value')).toHaveText('[X] Yes');
    await expect(view.page.locator('#ep-complications-injuries-date .value')).toHaveCount(1);
    await expect(view.page.locator('#ep-trigger-alcohol .value')).toHaveText('[X] Yes');
    await expect(view.page.locator('#ep-complications-burns .value, #ep-pmh-history-seizure .value, #ep-trigger-fever .value')).toHaveCount(0);
    await expect(view.page.locator(`#${DRUG}-rx .value`)).toHaveCount(1);
    await expect(view.page.locator('#Diazepam5mgt-rx')).toHaveCount(0); // obsgroup showIfEmpty=false
    await expect(view.page.locator('#buttons, h2, input.submitButton')).toHaveCount(0);
    const apptText = `${pad(RETURN_DATE.getDate())} ${MONTHS[RETURN_DATE.getMonth()]} ${RETURN_DATE.getFullYear()}`;
    await expect(view.page.locator('#return-visit-date .value')).toHaveText(apptText);
  });
});

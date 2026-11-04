// mentalHealthFollowup.xml: "Mental Health Followup" (encounter type Mental Health Consult, formName in the XML is "Mental Health Followup"): hospitalization,
// screening scores, habits, diagnoses, medications, interventions, social support and plan. EntryFormPage opens enterHtmlFormWithStandardUi inside a
// visit the spec creates, which skips the availability gating of _availability.e2e.md (Mental Health Location tag, enterMentalHealthNote; no intake needed).
// The session is NCD Clinic, so every save picks "Mental Health Clinic" in the form's own location select.
// First written without a server (locators from the XML), then run and fixed against a local Liberia server: see README.md.
//
// Conditions in the form, from documentation inventory (mentalHealthFollowup.inv.md):
//   when :419  #med-side-effects Yes -> #side-effect-section   :455 #intervene (checkbox) -> #show-interventions   :499 #supported Yes -> #support-q
//   toggle :344 medication checkbox -> {name}-rx-details (hide, clears inputs; 17 drugs, same table as the intake)
//   includeIf F :436 the "Pregnant" radio   ifMode VIEW include=false :61 (script) :127 (h2) :302 (css) :570 (#buttons)
// A `when` that hides its section also clears it (htmlForm.js onObsChangedCheck), so no hidden answer is saved.
// Scripts (:62-111): min date of the return visit = encounter date, with an alert when it resets (V1); medication-checkbox disabling (dead, V2);
//   score placeholders. No validation of its own.
// Side effects on save: enrollInProgram Mental Health (:147); postSubmissionActions ApplyDispositionAction (no disposition widget here) and
//   CleanDiagnosisConstructAction (adds a "secondary" order to each diagnosis group).
// Not covered here: V1 and the encounter-date change that resets the return date (needs a changeable date: disabled without Task: emr.retroConsultNote), a
//   saved Pregnant answer, the 16 other drugs. EDIT is the round trip of the save test; VIEW follows it.
//
// Findings (V1.. High -> Low):
//   V1 Medium :75-77 the comment "// reset ... makes it" wraps onto :76 `invalid`, which is now a statement: when a change of the encounter date
//                    invalidates the return visit date the value is cleared, then ReferenceError `invalid is not defined` is thrown and the
//                    warning alert (:77) never shows. mentalHealthIntake.xml :108-111 and epilepsy*.xml have the line intact. Fix: join the comment.
//                    (the reference error is certain from reading; whether datepicker('option','minDate') changes the value to reach it is unconfirmed: not run)
//   V2 Low    :85-103 medication-checkbox JS is dead (the checkbox's td is alone in its row, so .siblings() is empty; `jq(it).not(':checked')` is always truthy);
//                    the rows are hidden by toggle (:344). Same as mentalHealthIntake V3.
//   V3 Low    :233-244 habits are Yes/No on CIEL:159449 / CIEL:162556 ("History of alcohol use", "Illicit substance use"), which the intake codes as
//                    Never / In the past / Currently: one concept, two answer sets, so reports see both.
//   V4 Low    :504-534 #support-q closes at :517, before "Type of support" and its checkboxes: when "Receiving social support" is No or blank the
//                    types stay visible and can be saved (only the start and end dates are conditional).
//   V5 Info   :23-24 ApplyDispositionAction without a disposition widget; :425 `<obs id="">`; the heading is "Mental Health Patient Card" (pihcore.mentalhealth.liberia.title).

import { type APIRequestContext, type Page } from '@playwright/test';
import { test, expect, birthdateYearsAgo, type EntryContext } from '../../core';
import { MENTAL_HEALTH_CLINIC_LOCATION_UUID, MENTAL_HEALTH_CONSULT_ENCOUNTER_TYPE_UUID } from '../../core/constants';
import { getEncounterObs, getPatientEncounters, type EncounterObs } from '../../commands';
import { EntryFormPage, SectionFormPage, ViewFormPage, viewMismatches, VISIT_PAGE_URL, selectDefaultProvider } from '../../pages';

const FORM = 'mentalHealthFollowup.xml';
const PATIENT = { givenName: 'AutoMhFollowup', familyName: 'Tester', gender: 'F' as const };
const SAVE = '#buttons input.submitButton'; // the form ends with the HFE <submit> tag: there is no #submit
const DRUG = 'Fluoxetine20mgt';

const pad = (n: number) => String(n).padStart(2, '0');
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

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

// The obs matched here are written but not rendered under their concept name: the diagnosis order that CleanDiagnosisConstructAction adds, the
// relabelled dose unit / frequency answers (mg, BID) and the support types labelled Transportation (the "comment" obs is NOT ignored). Anchored on the
// "<question>: <answer> (looked for" strings of viewMismatches; the concept names are from the concept-mappings CSV, not from a server.
const IGNORED_IN_VIEW = /^(Diagnosis order|Socio-economic assistance received): |: (Milligram|BID \(twice daily\)) \(looked for/i;
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

test.describe('mentalHealthFollowup', () => {
  // encounterLocation tags="Consult Note Location" (:137)
  test('the location select offers Mental Health Clinic', async ({ page, createEntryContext }) => {
    await openEnter(page, await createEntryContext(PATIENT));
    const names = (await page.locator('#where select option').allTextContents()).map((t) => t.trim());
    expect(names).toContain('Mental Health Clinic');
  });

  // required="true" on encounterProviderAndRole (:142) and on #return-visit-date (:564)
  test('Save without a return visit date reports Required and saves nothing', async ({ page, api, createEntryContext }) => {
    const context = await createEntryContext(PATIENT);
    await openEnter(page, context);
    await fillWhoWhere(page);

    await page.locator(SAVE).click();
    await expect(page.locator('#return-visit-date span.field-error', { hasText: 'Required' })).toBeVisible();
    await expect(page).not.toHaveURL(VISIT_PAGE_URL);
    expect(await getPatientEncounters(api, context.patient.uuid)).toHaveLength(0);
  });

  test.describe('conditions (when / toggle)', () => {
    // when :419 and :499 (radios; a hidden section is not submitted, HFE tracks hfeHiddenFields)
    const whens = [
      { radio: '#med-side-effects', answer: 'Yes', other: 'No', target: '#side-effect-section' },
      { radio: '#supported', answer: 'Yes', other: 'No', target: '#support-q' },
    ];
    for (const w of whens) {
      test(`${w.radio}: ${w.answer} shows ${w.target}, ${w.other} hides it`, async ({ page, createEntryContext }) => {
        await openEnter(page, await createEntryContext(PATIENT));
        await expect(page.locator(w.target)).toBeHidden();
        await page.locator(w.radio).getByLabel(w.answer, { exact: true }).check();
        await expect(page.locator(w.target)).toBeVisible();
        await page.locator(w.radio).getByLabel(w.other, { exact: true }).check();
        await expect(page.locator(w.target)).toBeHidden();
      });
    }

    // when :455 on a one-answer checkbox (htmlForm.js onObsChangedCheck has a checkbox branch: value when checked, else null)
    test('the Interventions checkbox shows the list of interventions and hides it again', async ({ page, createEntryContext }) => {
      await openEnter(page, await createEntryContext(PATIENT));
      const box = page.locator('#intervene input[type=checkbox]');
      await expect(page.locator('#show-interventions')).toBeHidden();
      await box.check();
      await expect(page.locator('#show-interventions')).toBeVisible();
      await box.uncheck();
      await expect(page.locator('#show-interventions')).toBeHidden();
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
      await page.locator(`#dose-${DRUG} input`).fill('20');
      await box.uncheck();
      await expect(details).toBeHidden();
      await box.check();
      await expect(page.locator(`#dose-${DRUG} input`)).toHaveValue('');
    });
  });

  // includeIf :436: the Pregnant radio is rendered for female patients only. #medications has the side-effects, the missed-dose
  // and (female) the pregnant question, each in a p.list-inline.
  test('the Pregnant question is shown for a woman and not for a man', async ({ page, createEntryContext }) => {
    await openEnter(page, await createEntryContext(PATIENT));
    await expect(page.locator('#medications p.list-inline')).toHaveCount(3);
    await openEnter(page, await createEntryContext({ ...PATIENT, gender: 'M', birthdate: birthdateYearsAgo(30) }));
    await expect(page.locator('#medications p.list-inline')).toHaveCount(2);
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

    await page.locator('#hospital').getByLabel('Yes', { exact: true }).check();
    await page.locator('#phq9Score input').fill('12');
    await page.locator('#cageScore input').fill('2');
    await page.locator('#whodasScore input').fill('40');
    await page.locator('#cgiEScore16 input').fill('5');
    await page.locator('#mh_habits').getByLabel('Yes', { exact: true }).first().check();
    await page.locator('#diagnosis-area').getByLabel('Depression', { exact: true }).check();
    await page.locator('#diagnosis-area input[type=text]').fill('Adjustment problems'); // "Other diagnoses" (the only text input there)
    await page.locator(`#${DRUG}-rx input[type=checkbox]`).check(); // toggle :344
    await page.locator(`#dose-${DRUG} input`).fill('20');
    await page.locator(`#doseUnit-${DRUG} select`).selectOption({ label: 'mg' });
    await page.locator(`#frequencyCoded-${DRUG} select`).selectOption({ label: 'BID' });
    await page.locator(`#duration-${DRUG} input`).fill('14');
    await page.locator(`#durationUnit-${DRUG} select`).selectOption({ label: 'Days' });
    await page.locator('#medications textarea').first().fill('Takes it at night'); // medication comments (the side-effect text is the second textarea)
    await page.locator('#med-side-effects').getByLabel('Yes', { exact: true }).check(); // when :419
    await page.locator('#side-effect-section textarea').fill('Dry mouth');
    await page.locator('#intervene input[type=checkbox]').check(); // when :455
    await page.locator('#show-interventions').getByLabel('Psychotherapy', { exact: true }).check();
    await page.locator('#show-interventions').getByLabel('Relaxation', { exact: true }).check();
    await page.locator('#supported').getByLabel('Yes', { exact: true }).check(); // when :499
    await page.locator('#socioeconomic-assistance').getByLabel('Transportation', { exact: true }).check(); // outside #support-q, see V4
    await page.locator('#socioeconomic-assistance textarea').fill('Bus fare paid');
    await page.locator('#mh-plan textarea').fill('Review in two weeks');
    const returnDate = new Date(Date.now() + 7 * 86400000);
    await setDate(page, '#return-visit-date', returnDate);
    await save(page);

    const [encounter] = await getPatientEncounters(api, context.patient.uuid);
    expect(encounter.encounterType.uuid).toBe(MENTAL_HEALTH_CONSULT_ENCOUNTER_TYPE_UUID);
    const details = await encounterDetails(api, encounter.uuid);
    expect(details.location?.uuid).toBe(MENTAL_HEALTH_CLINIC_LOCATION_UUID);
    expect(details.encounterProviders).toHaveLength(1);
    expect(await programNames(api, context.patient.uuid)).toContain('Mental Health'); // enrollInProgram :147

    const obs = await getEncounterObs(api, encounter.uuid);
    const values = obs.map(valueText);
    const displays = obs.map((o) => o.display);
    for (const text of ['Adjustment problems', 'Dry mouth', 'Bus fare paid', 'Review in two weeks', 'Takes it at night']) {
      expect(values, text).toContain(text);
    }
    expect(values).toEqual(expect.arrayContaining(['12', '2', '40', '5', '20', '14']));
    expect(displays.some((d) => /^Diagnosis:\s*Depression/i.test(d)), 'diagnosis checkbox (Visit Diagnoses group)').toBeTruthy();
    expect(displays.some((d) => /secondary/i.test(d)), 'CleanDiagnosisConstructAction adds a secondary order').toBeTruthy();
    expect(displays.some((d) => /Mental health intervention:\s*Psychotherapy/i.test(d))).toBeTruthy();
    expect(displays.some((d) => /Mental health intervention:\s*Relaxation/i.test(d))).toBeTruthy();
    expect(displays.some((d) => /Mental health medication/i.test(d))).toBeTruthy();
    expect(displays.some((d) => /Hospitalized since last visit:\s*Yes/i.test(d))).toBeTruthy();

    // EDIT starts from the saved values (conditional parts open, the medication row open)
    const editUrl = SectionFormPage.editUrl(FORM, { patient: context.patient, encounter: { uuid: encounter.uuid, visitUuid: context.visitUuid } });
    await page.goto(editUrl);
    await expect(page.locator(SAVE)).toBeVisible();
    await expect(page.locator('#show-interventions')).toBeVisible();
    await expect(page.locator('#show-interventions').getByLabel('Psychotherapy', { exact: true })).toBeChecked();
    await expect(page.locator('#side-effect-section textarea')).toHaveValue('Dry mouth');
    await expect(page.locator('#support-q')).toBeVisible();
    await expect(page.locator(`#${DRUG}-rx-details`)).toBeVisible();
    await expect(page.locator(`#dose-${DRUG} input`)).toHaveValue('20');
    await page.locator('#mh-plan textarea').fill('Review in one week');
    await save(page);
    const edited = (await getEncounterObs(api, encounter.uuid)).map(valueText);
    expect(edited).toContain('Review in one week');
    expect(edited).not.toContain('Review in two weeks'); // the old obs is voided
    expect(edited).toEqual(expect.arrayContaining(['20', '14'])); // saving in EDIT keeps the medication row

    // VIEW: saved values and the date; unselected medication rows are not rendered (obsgroup showIfEmpty=false); no heading, no buttons
    const view = await openView(page, api, encounter.uuid);
    const shown = await view.valueTexts();
    expect(shown).toContain('Review in one week');
    expect(shown).toContain('[X] Depression');
    expect(shown).toContain('[X] Psychotherapy');
    expect(shown).toContain('Dry mouth');
    const apptText = `${pad(returnDate.getDate())} ${MONTHS[returnDate.getMonth()]} ${returnDate.getFullYear()}`;
    await expect(view.page.locator('#return-visit-date .value')).toHaveText(apptText);
    await expect(view.page.locator(`#${DRUG}-rx .value`)).toHaveCount(1);
    await expect(view.page.locator('#Amitryptiline25mgt-rx')).toHaveCount(0);
    await expect(view.page.locator('#buttons, h2, input.submitButton')).toHaveCount(0);
  });
});

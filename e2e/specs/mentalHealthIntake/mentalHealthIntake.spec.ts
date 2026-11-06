// mentalHealthIntake.xml: "Mental Health Intake", one long single page (referral, histories, substance use, mental state exam, suicide
// evaluation, screening scores, diagnoses, medications, family involvement, plan). The specs open enterHtmlFormWithStandardUi inside a
// visit they create (EntryFormPage), which skips the availability gating of _availability.e2e.md (Mental Health Location tag, enterMentalHealthNote,
// no earlier intake of the patient). The session is NCD Clinic, so every save picks "Mental Health Clinic" in the form's own location select.
// First written without a server (locators from the XML), then run and fixed against a local Liberia server: see README.md.
//
// Conditions in the form, from documentation inventory (mentalHealthIntake.inv.md):
//   includeIf F :371 (3 female-only history boxes), F and 12<age<55 :389 (pregnancy, birth), age>12 :456 :477 :499 :506 :524, F and age>12 :619
//   when :425 #dev-q other -> #other-dev   :444 #child-violence Yes -> #child-violence-comment   :464 / :485 adult / current violence Yes -> comment
//   when :692-693 #substance-{alcohol,drugs,tobacco} Not now|Currently using -> -span   :747 stop attempt Yes -> #why-stop-{name}-abuse
//   when :1119 #med-side-effects Yes -> #side-effect-section   :1429 #fam-support Yes -> #free-text-support
//   toggle :1035 Suicidal evaluation checkbox -> #suicideScreening (hide)   :1350 medication checkbox -> {name}-rx-details (hide, clears inputs)
//   ifMode VIEW include=false :97 :170 :228 :1308 :1537 (scripts, h2, #buttons)   ifMode VIEW :60 (css only)
// A `when` that hides its section also clears it (htmlForm.js onObsChangedCheck), so no hidden answer is saved.
// Scripts: :76-94 PihServices/HtmlFormFunctions look for a PIH:14650 condition to show #mh-diagnoses, a section that is commented out (:1288) (V4).
//   :98-146 min date of the return visit = encounter date (alert when it resets); medication-checkbox disabling (dead, V3); score placeholders.
//   :171-225 beforeSubmit: a checked "specify" box with no comment, or a comment with no box/relative, blocks the save (tested).
// Side effects on save: enrollInProgram Mental Health (:248), postSubmissionActions ApplyDispositionAction and CleanDiagnosisConstructAction
//   (adds a "secondary" order to each diagnosis group); encounterDisposition list: Active, Enroll in program, ED Observation, Transfers.
// Not covered here: a Transfer disposition (real effects on the visit), the encounter-date change that resets the return date (the date is disabled
//   without Task: emr.retroConsultNote), the 17 other drugs, the PHQ/GAD scores of other forms. EDIT is the round trip of the save test; VIEW follows it.
//
// Findings (V1.. High -> Low):
//   V1 Medium :659-661 PIH:Religion answers are labelled Christian / Muslim / other but saved as Catholic / Islam / Other -> every Christian is
//                      recorded Catholic. Fix: a Christian concept, or label it Catholic. (TESTED below with test.fail)
//   V2 Low    :260-274 referral labels differ from the saved concept: Counselor -> Social Worker, Community members -> Community leader,
//                      Relatives -> Other relative, Service provider -> Clinical consultation, Maternity/ANC/PNC -> Obstetrics/Gynecology
//                      (looks like deliberate approximations, unlike V1 where the saved concept is a specific denomination).
//   V3 Low    :118-136 medication-checkbox JS is dead: the checkbox's td is alone in its row (colspan 6), so .siblings() finds nothing; `if (jq(it).not(':checked'))`
//                      is always true. The rows are really hidden by toggle (:1350). Would disable saved rows in EDIT if the markup changed.
//   V4 Low    :76-94   toggleConditionSections() (2 REST calls, also in VIEW) targets #mh-diagnoses, which does not exist (:1288-1294 is commented out).
//   V5 Low    :311,:347 "Epilepsy" is listed under psychiatric (CIEL:155) and medical history (PIH:EPILEPSY): the same concept, so after EDIT a saved
//                      box can come back on the other row (PastMedicalHistoryCheckboxTagHandler hands the group to the first widget).
//   V6 Low    :518 "Concentual" (typo) for CIEL:167171 "Consent given for sex" Yes; :807 :888 :907 :927 :950 :966 conceptId has a trailing TAB (works only because HFE trims).
//   V7 Info   :1113-1128 "Medication allergies" is CIEL:121764 "Adverse drug effect"; its text is PIH:1729 "Adverse effect, non-coded", also used for "Problems due to use" (:736); `<obs id="">`.

import { type APIRequestContext, type Page } from '@playwright/test';
import { test, expect, birthdateYearsAgo, type EntryContext } from '../../core';
import { MENTAL_HEALTH_CLINIC_LOCATION_UUID, MENTAL_HEALTH_INTAKE_ENCOUNTER_TYPE_UUID } from '../../core/constants';
import { getEncounterObs, getPatientEncounters, type EncounterObs } from '../../commands';
import { EntryFormPage, SectionFormPage, ViewFormPage, viewMismatches, VISIT_PAGE_URL, selectDefaultProvider } from '../../pages';

const FORM = 'mentalHealthIntake.xml';
const PATIENT = { givenName: 'AutoMhIntake', familyName: 'Tester', gender: 'F' as const };
const SAVE = '#buttons input.submitButton'; // the form ends with the HFE <submit> tag: there is no #submit
const DRUG = 'Fluoxetine20mgt'; // one of the 17 medication rows (:1389-1405), ids are {name}-rx, {name}-rx-details, dose-{name}, ...

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

// Provider and the Mental Health Clinic (the session location is NCD Clinic, which the form also offers).
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

// Opens the VIEW and compares every saved text/number/coded obs with the span.value texts. The obs matched by IGNORED_IN_VIEW are written but not
// rendered under their concept name: the "present" and "diagnosis order" members that the tag handlers and CleanDiagnosisConstructAction add, the
// relabelled dose unit / frequency answers (mg, BID) and the disposition group (asserted by hand below). The regexes are anchored on the
// "<question>: <answer> (looked for" strings of viewMismatches; the concept names are from the concept-mappings CSV, not from a server.
// "Disposition categories: Active status" is the category obs the disposition widget saves next to "Disposition"; VIEW prints only the disposition
const IGNORED_IN_VIEW = /^(Sign\/symptom present|Diagnosis order|Disposition|Disposition categories): |: (Milligram|BID \(twice daily\)) \(looked for/i;
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

test.describe('mentalHealthIntake', () => {
  test.describe('ENTER: who, where and required fields', () => {
    // encounterLocation tags="Consult Note Location" (:238); Mental Health Clinic carries it (see _shared EPLD)
    test('the location select offers Mental Health Clinic', async ({ page, createEntryContext }) => {
      await openEnter(page, await createEntryContext(PATIENT));
      const names = (await page.locator('#where select option').allTextContents()).map((t) => t.trim());
      expect(names).toContain('Mental Health Clinic');
    });

    // required="true" on encounterProviderAndRole (:243) and on #return-visit-date (:1530)
    test('Save without a return visit date reports Required and saves nothing', async ({ page, api, createEntryContext }) => {
      const context = await createEntryContext(PATIENT);
      await openEnter(page, context);
      await fillWhoWhere(page);

      await page.locator(SAVE).click();
      await expect(page.locator('#return-visit-date span.field-error', { hasText: 'Required' })).toBeVisible();
      await expect(page).not.toHaveURL(VISIT_PAGE_URL);
      expect(await getPatientEncounters(api, context.patient.uuid)).toHaveLength(0);
    });
  });

  test.describe('conditions (when / toggle)', () => {
    // when :425, :444, :464, :485: the comment div is hidden until the radio holds the matching answer
    const whens = [
      { radio: '#dev-q', answer: 'other', other: 'normal', target: '#other-dev' },
      { radio: '#child-violence', answer: 'Yes', other: 'No', target: '#child-violence-comment' },
      { radio: '#adult-violence', answer: 'Yes', other: 'No', target: '#adult-violence-comment' },
      { radio: '#current-violence', answer: 'Yes', other: 'No', target: '#current-violence-comment' },
      { radio: '#med-side-effects', answer: 'Yes', other: 'No', target: '#side-effect-section' }, // :1119
      { radio: '#fam-support', answer: 'Yes', other: 'Not needed', target: '#free-text-support' }, // :1429
    ];
    for (const w of whens) {
      test(`${w.radio}: ${w.answer} shows ${w.target}, ${w.other} hides it`, async ({ page, createEntryContext }) => {
        await openEnter(page, await createEntryContext(PATIENT)); // female, 36: every includeIf block is rendered
        await expect(page.locator(w.target)).toBeHidden();
        await page.locator(w.radio).getByLabel(w.answer, { exact: true }).check();
        await expect(page.locator(w.target)).toBeVisible();
        await page.locator(w.radio).getByLabel(w.other, { exact: true }).check();
        await expect(page.locator(w.target)).toBeHidden();
      });
    }

    // when :692-693 and :747, repeated for alcohol, drugs and tobacco (repeat :679-779)
    for (const name of ['alcohol', 'drugs', 'tobacco']) {
      test(`substance ${name}: Not now / Currently using show the details, Never hides them; the stop attempt shows its reason`, async ({
        page,
        createEntryContext,
      }) => {
        await openEnter(page, await createEntryContext(PATIENT));
        const details = page.locator(`#substance-${name}-span`);
        const radios = page.locator(`#substance-${name}`);
        await expect(details).toBeHidden();
        await radios.getByLabel('Currently using', { exact: true }).check();
        await expect(details).toBeVisible();
        await radios.getByLabel('Never', { exact: true }).check();
        await expect(details).toBeHidden();
        await radios.getByLabel('Not now', { exact: true }).check();
        await expect(details).toBeVisible();

        await expect(page.locator(`#why-stop-${name}-abuse`)).toBeHidden();
        await page.locator(`#substance-${name}-stop-attempt`).getByLabel('Yes', { exact: true }).check();
        await expect(page.locator(`#why-stop-${name}-abuse`)).toBeVisible();
        await page.locator(`#substance-${name}-stop-attempt`).getByLabel('No', { exact: true }).check();
        await expect(page.locator(`#why-stop-${name}-abuse`)).toBeHidden();
      });
    }

    // toggle :1035 (default style: hide)
    test('the suicidality screening checkbox shows the result and interventions, and hides them again', async ({ page, createEntryContext }) => {
      await openEnter(page, await createEntryContext(PATIENT));
      const toggle = page.locator('#mh-suicide input[type=checkbox]').first(); // the only checkbox before #suicideScreening
      await expect(page.locator('#suicideScreening')).toBeHidden();
      await toggle.check();
      await expect(page.locator('#suicideScreening')).toBeVisible();
      await toggle.uncheck();
      await expect(page.locator('#suicideScreening')).toBeHidden();
    });

    // toggle :1350 (style hidden): the row shows when the drug is ticked, and clears when it is unticked
    test('a medication checkbox shows its dose row, and unticking clears what was typed', async ({ page, createEntryContext }) => {
      await openEnter(page, await createEntryContext(PATIENT));
      const box = page.locator(`#${DRUG}-rx input[type=checkbox]`);
      const details = page.locator(`#${DRUG}-rx-details`);
      await expect(details).toBeHidden();
      await box.check();
      await expect(details).toBeVisible();
      await expect(page.locator(`#dose-${DRUG} input`)).toBeEnabled(); // the dead JS of V3 would have disabled it
      await page.locator(`#dose-${DRUG} input`).fill('20');
      await box.uncheck();
      await expect(details).toBeHidden();
      await box.check();
      await expect(page.locator(`#dose-${DRUG} input`)).toHaveValue('');
    });
  });

  test.describe('includeIf fixtures (patient sex and age)', () => {
    // includeIf :371 (female), :389 (female, 12 < age < 55), :456 :477 :499 :506 :524 (age > 12), :619 (female, age > 12)
    test('a woman of 36 gets every block', async ({ page, createEntryContext }) => {
      await openEnter(page, await createEntryContext(PATIENT));
      await expect(page.locator('#adult-violence')).toHaveCount(1);
      await expect(page.locator('#current-violence')).toHaveCount(1);
      await expect(page.locator('#personal-history').getByLabel('unwanted', { exact: true })).toHaveCount(1); // :389 pregnancy
      await expect(page.locator('#personal-history').getByLabel('NVD', { exact: true })).toHaveCount(1);
      await expect(page.locator('#patient-history').getByLabel('Eclampsia', { exact: true })).toHaveCount(1); // :371
      await expect(page.locator('#child-info input').first()).toBeAttached(); // :619 number of children
    });

    test('a man of 30 gets the adult blocks but none of the female-only ones', async ({ page, createEntryContext }) => {
      await openEnter(page, await createEntryContext({ ...PATIENT, gender: 'M', birthdate: birthdateYearsAgo(30) }));
      await expect(page.locator('#adult-violence')).toHaveCount(1);
      await expect(page.locator('#personal-history').getByLabel('unwanted', { exact: true })).toHaveCount(0);
      await expect(page.locator('#personal-history').getByLabel('NVD', { exact: true })).toHaveCount(0);
      await expect(page.locator('#patient-history').getByLabel('Eclampsia', { exact: true })).toHaveCount(0);
      await expect(page.locator('#child-info input')).toHaveCount(0);
    });

    test('a girl of 8 gets neither the adult relationship questions nor the pregnancy and children blocks', async ({ page, createEntryContext }) => {
      await openEnter(page, await createEntryContext({ ...PATIENT, birthdate: birthdateYearsAgo(8) }));
      await expect(page.locator('#child-violence')).toHaveCount(1); // not conditional
      await expect(page.locator('#adult-violence')).toHaveCount(0);
      await expect(page.locator('#current-violence')).toHaveCount(0);
      await expect(page.locator('#personal-history').getByLabel('unwanted', { exact: true })).toHaveCount(0);
      await expect(page.locator('#child-info input')).toHaveCount(0);
      await expect(page.locator('#patient-history').getByLabel('Eclampsia', { exact: true })).toHaveCount(1); // :371 depends on sex only
    });
  });

  test.describe('beforeSubmit: history comments (:171-225)', () => {
    // a comment typed for "Other psychiatric disorder" without ticking it
    test('a past-history comment without its box shows "Select checkbox with comment" and blocks the save', async ({
      page,
      api,
      createEntryContext,
    }) => {
      const context = await createEntryContext(PATIENT);
      await openEnter(page, context);
      await fillWhoWhere(page);
      await setDate(page, '#return-visit-date', new Date(Date.now() + 7 * 86400000));
      const item = page.locator('#patient-history .past-medical-history-item', { hasText: 'Other psychiatric disorder' });
      await item.locator('input[type=text]').fill('Burnout');
      await item.locator('input[type=text]').press('Tab');
      await expect(item.locator('.field-error')).toHaveText('Select checkbox with comment');

      await page.locator(SAVE).click();
      await expect(page).not.toHaveURL(VISIT_PAGE_URL);
      expect(await getPatientEncounters(api, context.patient.uuid)).toHaveLength(0);

      await item.locator('input[type=checkbox]').check(); // the checkbox change re-validates
      await expect(item.locator('.field-error')).toBeHidden();
    });

    // a relative ticked in the family history without a comment
    test('a family-history relative without a comment shows "Please specify" and blocks the save', async ({ page, api, createEntryContext }) => {
      const context = await createEntryContext(PATIENT);
      await openEnter(page, context);
      await fillWhoWhere(page);
      await setDate(page, '#return-visit-date', new Date(Date.now() + 7 * 86400000));
      const item = page.locator('#familyOther');
      await item.getByLabel('Father', { exact: true }).check();

      await page.locator(SAVE).click();
      await expect(item.locator('.field-error')).toHaveText('Please specify');
      await expect(page).not.toHaveURL(VISIT_PAGE_URL);
      expect(await getPatientEncounters(api, context.patient.uuid)).toHaveLength(0);

      await item.locator('input[type=text]').fill('Late onset');
      await page.locator(SAVE).click();
      await expect(page).toHaveURL(VISIT_PAGE_URL);
      expect(await getPatientEncounters(api, context.patient.uuid)).toHaveLength(1);
    });
  });

  // encounterDisposition (:1521); the Liberia list is pih-dispositions-liberia.json: this encounter type gets Active and Enroll in program,
  // and no Admit (excludedEncounterTypes)
  test('the disposition list offers Active, Enroll in program, ED Observation and the transfers, but no admission', async ({
    page,
    createEntryContext,
  }) => {
    await openEnter(page, await createEntryContext(PATIENT));
    const options = (await page.locator('#disposition select').first().locator('option').allTextContents()).map((t) => t.trim()).filter((t) => t !== '');
    expect(options).toEqual(
      expect.arrayContaining(['Active', 'Enroll in program', 'ED Observation', 'Transfer out of hospital', 'Transfer within hospital']),
    );
    expect(options.filter((t) => /admi/i.test(t))).toEqual([]);
  });

  // V1 :659-661
  test.fail('V1 a patient whose religion is ticked "Christian" is not recorded as Catholic', async ({ page, api, createEntryContext }) => {
    // remove test.fail() when fixed
    const context = await createEntryContext(PATIENT);
    await openEnter(page, context);
    await fillWhoWhere(page);
    await setDate(page, '#return-visit-date', new Date(Date.now() + 7 * 86400000));
    await page.locator('#religion').getByLabel('Christian', { exact: true }).check();
    await save(page);

    const [encounter] = await getPatientEncounters(api, context.patient.uuid);
    expect((await getEncounterObs(api, encounter.uuid)).map(valueText)).not.toContain('Catholic');
  });

  test('saves the intake, enrolls the patient in Mental Health, reopens in EDIT with the values and renders them in VIEW', async ({
    page,
    api,
    createEntryContext,
  }) => {
    test.setTimeout(180_000);
    const context = await createEntryContext(PATIENT);
    await openEnter(page, context);
    await fillWhoWhere(page);

    await page.locator('#complaint textarea').fill('Poor sleep and low mood');
    await page.locator('#patient-history textarea').first().fill('Three months of low mood');
    await page.locator('#patient-history').getByLabel('Depression', { exact: true }).check(); // pastMedicalHistoryCheckbox
    await page.locator('#dev-q').getByLabel('other', { exact: true }).check(); // when :425
    await page.locator('#other-dev input').fill('Late walking');
    await page.locator('#child-violence').getByLabel('Yes', { exact: true }).check(); // when :444
    await page.locator('#child-violence-comment input').fill('Beaten by an uncle');
    const alcohol = page.locator('#substance-alcohol');
    await alcohol.getByLabel('Currently using', { exact: true }).check(); // when :692
    await page.locator('#substance-alcohol-age input').fill('18');
    await page.locator('#substance-alcohol-stop-attempt').getByLabel('Yes', { exact: true }).check(); // when :747
    await page.locator('#mh_mentalStateExam').getByLabel('Cooperative', { exact: true }).check();
    await page.locator('#mh_mentalStateExam textarea').fill('Tearful, oriented');
    await page.locator('#mh-suicide input[type=checkbox]').first().check(); // toggle :1035
    await page.locator('#suicideScreening').getByLabel('Low', { exact: true }).check();
    await page.locator('#phq9Score input').fill('12');
    await page.locator('#cgiEScore16 input').fill('5');
    await page.locator('#diagnosis-area').getByLabel('Depression', { exact: true }).check();
    await page.locator('#diagnosis-area input[type=text]').fill('Adjustment problems'); // "Other diagnoses" (the only text input there)
    await page.locator('#mh-counseling textarea').fill('Weekly counselling');
    await page.locator(`#${DRUG}-rx input[type=checkbox]`).check(); // toggle :1350
    await page.locator(`#dose-${DRUG} input`).fill('20');
    await page.locator(`#doseUnit-${DRUG} select`).selectOption({ label: 'mg' });
    await page.locator(`#frequencyCoded-${DRUG} select`).selectOption({ label: 'BID' });
    await page.locator(`#duration-${DRUG} input`).fill('14');
    await page.locator(`#durationUnit-${DRUG} select`).selectOption({ label: 'Days' });
    await page.locator('#disposition select').first().selectOption({ label: 'Active' });
    const returnDate = new Date(Date.now() + 7 * 86400000);
    await setDate(page, '#return-visit-date', returnDate);
    await save(page);

    // the encounter: type, location chosen in the form, one provider
    const [encounter] = await getPatientEncounters(api, context.patient.uuid);
    expect(encounter.encounterType.uuid).toBe(MENTAL_HEALTH_INTAKE_ENCOUNTER_TYPE_UUID);
    const details = await encounterDetails(api, encounter.uuid);
    expect(details.location?.uuid).toBe(MENTAL_HEALTH_CLINIC_LOCATION_UUID);
    expect(details.encounterProviders).toHaveLength(1);
    expect(await programNames(api, context.patient.uuid)).toContain('Mental Health'); // enrollInProgram :248

    const obs = await getEncounterObs(api, encounter.uuid);
    const values = obs.map(valueText);
    const displays = obs.map((o) => o.display);
    for (const text of ['Poor sleep and low mood', 'Three months of low mood', 'Late walking', 'Beaten by an uncle', 'Tearful, oriented', 'Weekly counselling', 'Adjustment problems']) {
      expect(values, text).toContain(text);
    }
    expect(values).toEqual(expect.arrayContaining(['12', '5', '20', '14']));
    expect(displays.some((d) => /^Diagnosis:\s*Depression/i.test(d)), 'diagnosis checkbox (Visit Diagnoses group)').toBeTruthy();
    expect(displays.some((d) => /secondary/i.test(d)), 'CleanDiagnosisConstructAction adds a secondary order').toBeTruthy();
    expect(displays.some((d) => /Past medical history finding:\s*Depression/i.test(d))).toBeTruthy();
    expect(displays.some((d) => /Cooperative/i.test(d))).toBeTruthy();
    expect(displays.some((d) => /Mental health medication/i.test(d))).toBeTruthy();
    expect(displays.some((d) => /Active/i.test(d)), 'disposition').toBeTruthy();
    expect(displays.some((d) => /Never|Currently/i.test(d))).toBeTruthy();

    // EDIT starts from the saved values (the medication row is open, the conditional comments are shown)
    const editUrl = SectionFormPage.editUrl(FORM, { patient: context.patient, encounter: { uuid: encounter.uuid, visitUuid: context.visitUuid } });
    await page.goto(editUrl);
    await expect(page.locator(SAVE)).toBeVisible();
    await expect(page.locator('#complaint textarea')).toHaveValue('Poor sleep and low mood');
    await expect(page.locator('#patient-history').getByLabel('Depression', { exact: true })).toBeChecked();
    await expect(page.locator('#other-dev')).toBeVisible();
    await expect(page.locator('#substance-alcohol-span')).toBeVisible();
    await expect(page.locator(`#${DRUG}-rx-details`)).toBeVisible();
    await expect(page.locator(`#dose-${DRUG} input`)).toHaveValue('20');
    await expect(page.locator('#suicideScreening')).toBeVisible();
    await page.locator('#complaint textarea').fill('Poor sleep, low mood and weight loss');
    await save(page);
    const edited = (await getEncounterObs(api, encounter.uuid)).map(valueText);
    expect(edited).toContain('Poor sleep, low mood and weight loss');
    expect(edited).not.toContain('Poor sleep and low mood'); // the old obs is voided
    expect(edited).toEqual(expect.arrayContaining(['20', '14'])); // saving in EDIT keeps the medication row

    // VIEW: saved values, the date, the open medication row only; no heading, no buttons (ifMode VIEW include=false :228 :1537)
    const view = await openView(page, api, encounter.uuid);
    const shown = await view.valueTexts();
    expect(shown).toContain('Poor sleep, low mood and weight loss');
    expect(shown).toContain('[X] Depression'); // past history box and diagnosis box
    expect(shown).toContain('[X] Cooperative');
    const apptText = `${pad(returnDate.getDate())} ${MONTHS[returnDate.getMonth()]} ${returnDate.getFullYear()}`;
    await expect(view.page.locator('#return-visit-date .value')).toHaveText(apptText);
    await expect(view.page.locator(`#${DRUG}-rx .value`)).toHaveCount(1);
    await expect(view.page.locator('#Amitryptiline25mgt-rx')).toHaveCount(0); // obsgroup showIfEmpty=false
    await expect(view.page.locator('#substance-tobacco-present')).toHaveCount(0);
    await expect(view.page.locator('#mh-family-involved .value, #mh_impression .value')).toHaveCount(0); // not filled
    await expect(view.page.locator('#buttons, h2, input.submitButton')).toHaveCount(0);
  });
});

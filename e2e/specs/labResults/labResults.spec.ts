import { type APIRequestContext, type Page } from '@playwright/test';
import { test, expect, type CustomTestFixtures, type EntryContext } from '../../core';
import { LAB_RESULTS_ENCOUNTER_TYPE_UUID } from '../../core/constants';
import { getEncounterObs, getPatientEncounters } from '../../commands';
import { expectViewShowsSavedObs, VISIT_PAGE_URL, visitPagePath } from '../../pages';

// labResults.xml v1.0: "Lab results" as it is in this repo (a stale copy of pihemr's v1.0 that shadows pihemr's v2.0: see _shared V3; this
// spec tests the Liberia file). 11 groups of lab results (hematology, biochemistry, parasitology, microbiology, serology, i-STAT, urinalysis,
// glucose, lipids, other) with a "specimen collection date" that IS the encounter date, an "estimated" checkbox and a date of test results.
// Production opens it in the Simple UI with no visitId (patient dashboard action, home app: _availability.e2e.md). The form has no required
// field, navigator-only rule or exit handler, so the specs use the Standard UI (every field in one page, plain locators) and the same
// no-visit URL, built here because EntryFormPage.enterUrl always adds the fixture's visitId and a past specimen date would then fail
// "cannot be before the visit start". Provider and location are hidden defaults (current user, session location). No lab order is saved.
// First written without a server (locators from the XML), then run and fixed against a local Liberia server: see README.md.
//
// Conditions in the form, from documentation inventory (labResults.inv.md):
//   ifMode VIEW include=false :29-38  the script below (ENTER and EDIT only)
// Scripts: :30-37 on load, getField('specimen-collection-date-hematology.value') and getField('test-date-hematology.value') get the datepicker
//   option maxDate = today (no future specimen or test date).
// Side effects on save: postSubmissionAction SetObsDatesToSpecimenCollectionDateAction (:4): sets the obsDatetime of every non-date obs to
//   the value of a PIH:3038 "Specimen collection date" obs; this form has none (V3), so it does nothing.
//   The encounter date (the specimen date) is what gives every obs its date, tested below. One Lab results encounter (4d77916a-...).
// Not covered here: lab orders, the Simple UI launch, the other ~50 results (same obs markup as the ones tested), the ua-blood answer labels (:568-571).
//
// Findings:
//   V1 Low  :299, :305  id="malaria-rdt" on both Malaria RDT (CIEL:1643) and Malaria blood smear (CIEL:32): duplicate id, and the smear label's
//                       for="malaria-smear" targets nothing. Fix: id="malaria-smear" on :305. (the specs use [id="malaria-rdt"] .nth(1))
//   V2 Low  :485        `<obs for="co2">` should be id="co2": the label :480 `for="co2"` has no target.
//   V3 Info :4          SetObsDatesToSpecimenCollectionDateAction finds no PIH:3038 obs here (the specimen date is the encounter date), so it is dead
//                       for this form; the obs dates come from the encounter date. see _shared V3 for the uuid shadowing of labResults_v1.0.xml.
//   V5 Medium :2 (see _shared V3)  the Form row is shared with labResults_v1.0.xml (same formUuid), and EDIT and VIEW of a saved encounter render the stored
//                       definition (v1.0's layout: no #hiv-test, 193 ids vs 99 in ENTER), not labResults.xml. Seen on the first run: the saved HIV result is not
//                       selected in EDIT and not shown in VIEW. TESTED (test.fail on the EDIT and VIEW tests below; they fail at the HIV field).
//   V4 Medium :81       the date of test results is a date obs, and HFE refuses a date obs after the encounter date ("Cannot be after encounter date")
//                       unless allowFutureDates="true"; the encounter date is the specimen collection date, and results come after the collection,
//                       so the date of results can only be the specimen day. Fix: allowFutureDates="true" on the obs (the script :34 already stops
//                       it at today). Seen when the specs were first run: the submit answered {"w5":"Cannot be after encounter date"}. TESTED (test.fail)

const FORM = 'labResults.xml';
const DAY = 24 * 60 * 60 * 1000;
const isoDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const newPatient = (createEntryContext: CustomTestFixtures['createEntryContext']) =>
  createEntryContext({ givenName: 'AutoLab', familyName: 'Tester', gender: 'F' });
// Local URLs without a visit, like the production launch (returnUrl lands on the fixture visit's page).
const urlParams = (context: EntryContext, extra: Record<string, string> = {}) =>
  new URLSearchParams({
    patientId: context.patient.uuid,
    definitionUiResource: `file:configuration/pih/htmlforms/${FORM}`,
    returnUrl: visitPagePath(context.visitUuid),
    ...extra,
  }).toString();
const openEnter = async (page: Page, context: EntryContext) => {
  await page.goto(`htmlformentryui/htmlform/enterHtmlFormWithStandardUi.page?${urlParams(context)}`);
  await expect(page.locator('#hemoglobin input')).toBeVisible();
};
const openEdit = async (page: Page, context: EntryContext, encounterUuid: string) => {
  await page.goto(`htmlformentryui/htmlform/editHtmlFormWithStandardUi.page?${urlParams(context, { encounterId: encounterUuid })}`);
  await expect(page.locator('#hemoglobin input')).toBeVisible();
};
// The form has <submit/> only: a bare input.submitButton, no #buttons wrapper.
const save = async (page: Page) => {
  await page.locator('input.submitButton').click();
  await expect(page).toHaveURL(VISIT_PAGE_URL);
};
// The datepickers are read-only jQuery UI inputs (0 = specimen collection date, 1 = date of test results); setDate also fills the submitted field.
const setDate = (page: Page, index: number, date: Date) =>
  page.evaluate(
    ([i, ms]) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).jq('input.hasDatepicker').eq(i).datepicker('setDate', new Date(ms as number));
    },
    [index, date.getTime()],
  );
const obsDates = async (api: APIRequestContext, encounterUuid: string) => {
  const res = await api.get(`obs?encounter=${encounterUuid}&v=custom:(concept:(display),obsDatetime)&limit=200`);
  expect(res.ok(), `get obs: ${res.status()}`).toBeTruthy();
  return (await res.json()).results as Array<{ concept: { display: string }; obsDatetime: string }>;
};

// Specimen collected three days ago; hematology, biochemistry, parasitology and "other" results; the date of the test results the same day
// (a later date is refused by the form, V4).
const saveResults = async (page: Page, api: APIRequestContext, createEntryContext: CustomTestFixtures['createEntryContext']) => {
  const context = await newPatient(createEntryContext);
  const specimen = new Date(Date.now() - 3 * DAY);
  await openEnter(page, context);
  await setDate(page, 0, specimen);
  await page.getByLabel('estimated', { exact: true }).check(); // PIH:11781 answered Yes
  await setDate(page, 1, specimen);
  await page.locator('#hemoglobin input').fill('12.5');
  await page.locator('#hemoglobin-a1c input').fill('6.5');
  await page.locator('#sodium input').fill('140');
  await page.locator('#glucose-fasting input').fill('95');
  await page.locator('#hiv-test select').selectOption({ label: 'Negative' });
  await page.locator('[id="malaria-rdt"]').nth(0).locator('select').selectOption({ index: 1 }); // CIEL:1643
  await page.locator('[id="malaria-rdt"]').nth(1).locator('select').selectOption({ index: 1 }); // CIEL:32, V1
  await save(page);

  const encounters = await getPatientEncounters(api, context.patient.uuid);
  expect(encounters.map((e) => e.encounterType.uuid)).toEqual([LAB_RESULTS_ENCOUNTER_TYPE_UUID]);
  return { context, specimen, encounterUuid: encounters[0].uuid, obs: await getEncounterObs(api, encounters[0].uuid) };
};

test.describe('labResults', () => {
  // V4: the date of test results after the specimen date is refused by the form (remove test.fail() when allowFutureDates is added)
  test('V4 a date of test results after the specimen collection date is accepted', async ({ page, api, createEntryContext }) => {
    test.fail();
    const context = await newPatient(createEntryContext);
    await openEnter(page, context);
    await setDate(page, 0, new Date(Date.now() - 3 * DAY));
    await setDate(page, 1, new Date(Date.now() - DAY));
    await page.locator('#hemoglobin input').fill('12.5');
    await save(page);
    expect(await getPatientEncounters(api, context.patient.uuid)).toHaveLength(1);
  });

  test('renders the 11 groups of results and no required field', async ({ page, createEntryContext }) => {
    await openEnter(page, await newPatient(createEntryContext));
    await expect(page.locator('fieldset.multi-line-confirmation')).toHaveCount(11);
    for (const id of ['#hemoglobin', '#sodium', '#hiv-test', '#total-chol', '#ua-blood', '#zika-igm']) {
      await expect(page.locator(id), `${id} is rendered`).toHaveCount(1);
    }
    await expect(page.locator('input.submitButton')).toBeVisible();
  });

  // script :30-37
  test('the specimen collection date and the date of test results cannot be in the future', async ({ page, createEntryContext }) => {
    await openEnter(page, await newPatient(createEntryContext));
    const maxDates = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const jq = (window as any).jq;
      return jq('input.hasDatepicker')
        .map((_: number, el: HTMLElement) => {
          const max = jq(el).datepicker('option', 'maxDate');
          return max ? new Date(max).toDateString() : null;
        })
        .get() as Array<string | null>;
    });
    expect(maxDates.slice(0, 2)).toEqual([new Date().toDateString(), new Date().toDateString()]);
    // setDate clamps to maxDate: a future specimen date becomes today
    await setDate(page, 0, new Date(Date.now() + 5 * DAY));
    const chosen = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const date = (window as any).jq('input.hasDatepicker').eq(0).datepicker('getDate');
      return date ? new Date(date).toDateString() : null;
    });
    expect(chosen).toBe(new Date().toDateString());
  });

  test('saves the results under the specimen collection date: encounter and obs dates are the specimen date', async ({ page, api, createEntryContext }) => {
    // encounterDate :64 is the specimen date; V3: the post-submission action does nothing, the dates come from the encounter
    const { specimen, encounterUuid, obs } = await saveResults(page, api, createEntryContext);
    const displays = obs.map((o) => o.display);

    expect(displays.some((d) => /^Hemoglobin: 12\.5/i.test(d))).toBe(true); // PIH:HEMOGLOBIN
    expect(displays.some((d) => /^HbA1c: 6\.5/i.test(d))).toBe(true); // PIH:HbA1c
    expect(displays.some((d) => /^Serum sodium: 140/i.test(d))).toBe(true);
    expect(displays.some((d) => /^Fasting blood glucose: 95/i.test(d))).toBe(true); // CIEL:160912
    expect(displays.some((d) => /^HIV test result: Negative/i.test(d))).toBe(true);
    expect(displays.some((d) => /^Malaria RDT: /.test(d))).toBe(true); // V1: both malaria obs saved under their own concepts
    expect(displays.some((d) => /^Malaria smear: /.test(d))).toBe(true);
    expect(displays.some((d) => /^Estimated collection date: Yes/i.test(d))).toBe(true); // PIH:11781
    expect(obs.some((o) => o.concept.display === 'Date of test results')).toBe(true);
    expect(obs.some((o) => /potassium/i.test(o.display))).toBe(false); // not filled in

    const encounter = await (await api.get(`encounter/${encounterUuid}?v=custom:(encounterDatetime)`)).json();
    expect(String(encounter.encounterDatetime).startsWith(isoDate(specimen))).toBe(true);
    const dates = (await obsDates(api, encounterUuid)).filter((o) => o.concept.display !== 'Date of test results');
    expect(dates.length).toBeGreaterThan(0);
    for (const o of dates) {
      expect(o.obsDatetime.startsWith(isoDate(specimen)), `${o.concept.display} is dated ${o.obsDatetime}`).toBe(true);
    }
  });

  test('EDIT starts from the saved results and a changed value replaces the saved one', async ({ page, api, createEntryContext }) => {
    test.fail(); // V5: EDIT/VIEW render labResults_v1.0.xml's layout (remove when the shared formUuid is fixed)
    const { context, encounterUuid } = await saveResults(page, api, createEntryContext);

    await openEdit(page, context, encounterUuid);
    await expect(page.locator('#hemoglobin input')).toHaveValue('12.5');
    await expect(page.locator('#sodium input')).toHaveValue('140');
    await expect(page.locator('#hiv-test select option:checked')).toHaveText('Negative');
    await expect(page.getByLabel('estimated', { exact: true })).toBeChecked();
    await page.locator('#hemoglobin input').fill('13');
    await save(page);
    await expect
      .poll(async () => (await getEncounterObs(api, encounterUuid)).map((o) => o.display))
      .toEqual(expect.arrayContaining([expect.stringMatching(/^Hemoglobin: 13/i)]));
    const after = (await getEncounterObs(api, encounterUuid)).map((o) => o.display);
    expect(after.some((d) => /^Hemoglobin: 12\.5/i.test(d))).toBe(false);
    expect(after.some((d) => /^Serum sodium: 140/i.test(d))).toBe(true);
  });

  // VIEW :29-38 (the script is ENTER/EDIT only, so VIEW has no script)
  test('VIEW: shows the saved results under their ids, nothing for the others and no Save button', async ({ page, api, createEntryContext }) => {
    test.fail(); // V5: EDIT/VIEW render labResults_v1.0.xml's layout (remove when the shared formUuid is fixed)
    const { encounterUuid, obs } = await saveResults(page, api, createEntryContext);
    const estimated = obs.find((o) => /^Estimated collection date/i.test(o.display))?.display ?? '';
    // the checkbox shows its own label (answerCode pihcore.date_estimated), not the concept name
    const view = (await expectViewShowsSavedObs(page, api, FORM, encounterUuid, { [estimated]: '[X] estimated' })).page;

    await expect(view.locator('#hemoglobin .value')).toContainText('12.5');
    await expect(view.locator('#hemoglobin-a1c .value')).toContainText('6.5');
    await expect(view.locator('#sodium .value')).toContainText('140');
    await expect(view.locator('#glucose-fasting .value')).toContainText('95');
    await expect(view.locator('#hiv-test .value')).toContainText('Negative');
    await expect(view.locator('[id="malaria-rdt"] .value')).toHaveCount(2); // V1: both malaria obs carry the id
    await expect(view.locator('#potassium .value, #creatinine-i-stat .value, #total-chol .value')).toHaveCount(0);
    await expect(view.locator('input.submitButton, input[type=text], select')).toHaveCount(0);
  });
});

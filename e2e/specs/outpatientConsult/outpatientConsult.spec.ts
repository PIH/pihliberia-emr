import { type APIRequestContext, type Page } from '@playwright/test';
import { test, expect, type CustomTestFixtures } from '../../core';
import { CONSULT_ENCOUNTER_TYPE_UUID, NCD_CLINIC_LOCATION_UUID } from '../../core/constants';
import { getEncounterObs, getPatientEncounters } from '../../commands';
import { EntryFormPage, VisitPage, buttonsSubmit, selectDefaultProvider, VISIT_PAGE_URL, visitPagePath } from '../../pages';

// outpatientConsult.xml v1.0: "Clinic Consult" (coded diagnoses, procedure, disposition, return visit date, comments) with the shared
// who/when/where block (EPLD, tag "Consult Note Location"). Reached with a synthetic adult patient who has an active visit and no encounter,
// through enterHtmlFormWithStandardUi (EntryFormPage), as the CONSULT_NOTE_VISIT_ACTION opens it (_availability.e2e.md); availability
// (privilege, retro rules, Consult Note Location tag) is not exercised. The session location (NCD Clinic) carries the tag, so the
// location is preselected. First written without a server (locators from the XML), then run and fixed against a local Liberia server: see README.md.
//
// Conditions in the form, from documentation inventory (outpatientConsult.inv.md):
//   ifMode VIEW include=false :16-32, :81-83, :128-133  layout CSS, the h2 heading and the Save / Cancel buttons (ENTER and EDIT only)
//   ifMode EDIT               :34-43  CSS for #disposition (EDIT only, V1)
//   encounterDisposition :110 (pih-dispositions-liberia.json, this encounter type): Admission (no extra field), ED Observation,
//     Transfer out of hospital (#transferExternalLocation), Transfer within hospital (#transferInternalLocation); no Discharge or Death
// Scripts: :46-79 validateForm(), run on load and on every document click/change: Save (#buttons .submitButton, starts with class
//   "disabled") is disabled unless a diagnosis chip (.diagnosis) exists AND no visible select/input inside #disposition is empty
//   (needsDisposition is hard-coded true, so a disposition is always required); it calls htmlForm.enable/disableSubmitButton.
// Side effects on save: ApplyDispositionAction (:3) runs the actions of the chosen disposition (pih-dispositions-liberia.json): the tests
//   use "ED Observation" (no actions, keeps the visit open) and assert the visit stays open and the patient is not dead. The coded
//   diagnosis is saved as a Visit Diagnoses group. Nothing creates an order.
// Visit-page display: the visit page does NOT show this form's VIEW. The Consultation entry of encounterTypeConfig.js (encounter type
//   92fd09b4-..., resolved for `liberia`) has no templateModelUrl: it renders the encounter's obs with templates/encounters/clinicConsultLong.page
//   (rows Diagnoses, Non-Coded Diagnoses, Disposition, Procedure performed, Return visit date, Clinical Note), so the VIEW test asserts those
//   rows. The form's own VIEW (ifMode VIEW :16-32, :81-83, :128-133) is therefore not tested, and HAI-1278 (validateForm :46-79 calls
//   htmlForm.disableSubmitButton, undefined on the visit page) does not apply to this encounter type: the earlier V1 test.fail() for it was removed.
// Not covered here: the Procedure autocomplete (:105, needs concept set members), saving Admission / Transfer (they change visit or
//   location), provider/date behaviour (_shared.e2e.md).
//
// Findings:
//   V1 Low    :34-43   the #disposition CSS sits in ifMode EDIT, so it is not applied on first entry (ENTER). Fix: ifMode VIEW include="false".
//   V2 Low    :50-56   hasDisposition is computed and unused; needsDisposition is always true (dead code).

const FORM = 'outpatientConsult.xml';

const save = (page: Page) => buttonsSubmit(page);
const disposition = (page: Page) => page.locator('#disposition select').first();
const newPatient = (createEntryContext: CustomTestFixtures['createEntryContext']) =>
  createEntryContext({ givenName: 'AutoConsult', familyName: 'Tester', gender: 'F' });
const pickDiagnosis = async (page: Page) => {
  await page.locator('#diagnosis-search').fill('malaria');
  await page.locator('ul.ui-autocomplete li').first().click();
  await expect(page.locator('.diagnosis')).toHaveCount(1);
};
// Read-only jQuery UI datepicker: setDate also updates the hidden field that is submitted.
const setDate = (page: Page, wrapper: string, date: Date) =>
  page.evaluate(
    ([w, ms]) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).jq(`${w} input.hasDatepicker`).datepicker('setDate', new Date(ms as number));
    },
    [wrapper, date.getTime()],
  );

test.describe('outpatientConsult', () => {
  test('the location select offers only the Consult Note Location locations, with the session location preselected', async ({ page, createEntryContext }) => {
    // EPLD tag (:87): 11 locations carry it (_shared.e2e.md); not Pharmacy or Records Room
    await EntryFormPage.open(page, FORM, await newPatient(createEntryContext));
    const names = (await page.locator('#where select option').allTextContents()).map((t) => t.trim()).filter((t) => t !== '');
    expect(names).toEqual(expect.arrayContaining(['NCD Clinic', 'Outpatient Clinic', 'Family Medicine', 'MCH Clinic']));
    expect(names).not.toContain('Pharmacy');
    expect(names).not.toContain('Records Room');
    await expect(page.locator('#where select option:checked')).toHaveText('NCD Clinic');
  });

  test('Save stays disabled until a diagnosis and a disposition are given', async ({ page, createEntryContext }) => {
    // validateForm :46-79
    await EntryFormPage.open(page, FORM, await newPatient(createEntryContext));
    await expect(save(page)).toBeDisabled();
    await pickDiagnosis(page);
    await expect(save(page)).toBeDisabled(); // disposition still empty
    await disposition(page).selectOption({ label: 'ED Observation' });
    await expect(save(page)).toBeEnabled();
    await disposition(page).selectOption({ index: 0 });
    await expect(save(page)).toBeDisabled();
  });

  test('the disposition list is the Liberia one: Admission, ED Observation and the two transfers, no Discharge or Death', async ({ page, createEntryContext }) => {
    // pih-dispositions-liberia.json: admitToHospital, edObservation, transferOutOfHospital, transferWithinHospital
    await EntryFormPage.open(page, FORM, await newPatient(createEntryContext));
    const labels = (await disposition(page).locator('option').allTextContents()).map((t) => t.trim());
    expect(labels).toEqual(expect.arrayContaining(['Admission', 'ED Observation', 'Transfer out of hospital', 'Transfer within hospital']));
    expect(labels).not.toContain('Death');
    expect(labels).not.toContain('Discharge');
  });

  test('the transfer dispositions show their extra field only for the matching choice and keep Save disabled until it is filled', async ({
    page,
    createEntryContext,
  }) => {
    // encounterDisposition :110 additionalObs; validateForm: a visible empty select/input in #disposition keeps Save disabled
    await EntryFormPage.open(page, FORM, await newPatient(createEntryContext));
    await pickDiagnosis(page);
    const fields = [
      { label: 'Transfer within hospital', field: '#transferInternalLocation' },
      { label: 'Transfer out of hospital', field: '#transferExternalLocation' },
    ];
    for (const f of fields) {
      await expect(page.locator(f.field), `${f.field} starts hidden`).toBeHidden();
    }
    for (const f of fields) {
      await disposition(page).selectOption({ label: f.label });
      for (const other of fields) {
        if (other === f) {
          await expect(page.locator(other.field), `${f.label} shows ${other.field}`).toBeVisible();
        } else {
          await expect(page.locator(other.field), `${f.label} hides ${other.field}`).toBeHidden();
        }
      }
      await expect(save(page), `${f.label}: the extra field is empty`).toBeDisabled();
    }
    await disposition(page).selectOption({ label: 'ED Observation' });
    for (const f of fields) {
      await expect(page.locator(f.field)).toBeHidden();
    }
    await expect(save(page)).toBeEnabled();
  });

  // ApplyDispositionAction :3 with a disposition that has no actions; returns what the VIEW and EDIT tests need
  const saveConsult = async (page: Page, api: APIRequestContext, createEntryContext: CustomTestFixtures['createEntryContext']) => {
    const context = await newPatient(createEntryContext);
    const form = await EntryFormPage.open(page, FORM, context);
    await selectDefaultProvider(page);
    await pickDiagnosis(page);
    await disposition(page).selectOption({ label: 'ED Observation' });
    const nextYear = new Date();
    nextYear.setFullYear(nextYear.getFullYear() + 1);
    await setDate(page, '#apptDate', nextYear);
    await page.locator('#data-collection textarea').last().fill('seen in clinic'); // comments
    await save(page).click();
    await form.expectSaved();

    const encounters = await getPatientEncounters(api, context.patient.uuid);
    expect(encounters.map((e) => e.encounterType.uuid)).toEqual([CONSULT_ENCOUNTER_TYPE_UUID]);
    const obs = await getEncounterObs(api, encounters[0].uuid);
    const displays = obs.map((o) => o.display);
    expect(displays).toEqual(
      expect.arrayContaining([
        'Clinical impression comments: seen in clinic',
        'Disposition categories: Emergency Department observation',
        'Diagnosis order: Primary',
      ]),
    );
    expect(displays.some((d) => d.startsWith('Diagnosis: '))).toBe(true);
    expect(obs.some((o) => o.concept.display === 'Return visit date' && String(o.value).startsWith(String(nextYear.getFullYear())))).toBe(true);

    const encounter = await (await api.get(`encounter/${encounters[0].uuid}?v=custom:(location:(uuid))`)).json();
    expect(encounter.location.uuid).toBe(NCD_CLINIC_LOCATION_UUID);
    const visit = await (await api.get(`visit/${context.visitUuid}?v=custom:(stopDatetime)`)).json();
    expect(visit.stopDatetime).toBeNull(); // ED Observation keeps the visit open
    const patient = await (await api.get(`patient/${context.patient.uuid}?v=custom:(person:(dead))`)).json();
    expect(patient.person.dead).toBe(false);
    return { context, encounters, displays };
  };

  test('saves a consult with a diagnosis, ED Observation, a return visit date and comments; the visit stays open', async ({ page, api, createEntryContext }) => {
    await saveConsult(page, api, createEntryContext);
  });

  test('EDIT starts from the saved diagnosis, disposition and comments', async ({ page, api, createEntryContext }) => {
    // validateForm runs on load, so Save is enabled when the saved values satisfy the rule
    const { context, encounters } = await saveConsult(page, api, createEntryContext);

    const params = new URLSearchParams({
      patientId: context.patient.uuid,
      encounterId: encounters[0].uuid,
      definitionUiResource: `file:configuration/pih/htmlforms/${FORM}`,
      returnUrl: visitPagePath(context.visitUuid),
    });
    await page.goto(`htmlformentryui/htmlform/editHtmlFormWithStandardUi.page?${params.toString()}`);
    await expect(page.locator('.diagnosis')).toHaveCount(1);
    await expect(disposition(page)).toHaveValue(/.+/);
    await expect(page.locator('#data-collection textarea').last()).toHaveValue('seen in clinic');
    await expect(save(page)).toBeEnabled();
    await page.locator('#data-collection textarea').last().fill('seen again');
    await save(page).click();
    await expect(page).toHaveURL(VISIT_PAGE_URL);
    await expect
      .poll(async () => (await getEncounterObs(api, encounters[0].uuid)).map((o) => o.display))
      .toEqual(expect.arrayContaining(['Clinical impression comments: seen again']));
  });

  test('the visit page shows the saved consult in its own rows: diagnosis, disposition, return visit date and comments (clinicConsultLong)', async ({ page, api, createEntryContext }) => {
    const { context, displays } = await saveConsult(page, api, createEntryContext);
    const visit = await VisitPage.open(page, context.visitUuid);
    const long = await visit.expand(visit.encounterOfType(CONSULT_ENCOUNTER_TYPE_UUID));
    // each row is a div with a left-column heading and a right-column value
    const row = (heading: string) => long.locator(`div:has(> .left-column > h3:text-is("${heading}")) > .right-column`);
    const diagnosis = (displays.find((d) => d.startsWith('Diagnosis: ')) ?? '').replace('Diagnosis: ', '');
    await expect(row('Diagnoses').locator('p.diagnosis')).toHaveCount(1);
    await expect(row('Diagnoses')).toContainText(diagnosis);
    await expect(row('Diagnoses')).toContainText('Primary');
    await expect(row('Disposition')).toContainText('Emergency Department observation');
    await expect(row('Return visit date')).not.toHaveText('');
    await expect(row('Clinical Note')).toHaveText('seen in clinic');
    // not filled in: the non-coded diagnosis and the procedure
    for (const heading of ['Non-Coded Diagnoses', 'Procedure performed']) {
      await expect(row(heading), `${heading} is empty`).toHaveText('');
    }
  });
});

// anc-followup.xml: "ANC Followup" (ANC Followup encounter): who/when/where, MCH enrolment, danger signs (13 checkboxes, each saved as a "Visit
// Diagnoses" group), mental health and high-risk checkboxes, a read-only EDD / gestational-age block, the EDD and the return visit date.
// ENTER: EntryFormPage opens enterHtmlFormWithStandardUi in a visit the spec creates, so the gating of _availability.e2e.md (female, "Maternal and
// Child Location" tag, Task: emr.enterMCH, no ANC encounter in the visit, no earlier intake needed) is skipped; the session is NCD Clinic, which carries
// Consult Note Location (the who/where/when tag, see _shared EPLD). EDIT: SectionFormPage.openEdit on the saved encounter (the form has #submit).
// First written without a server (locators from the XML), then run and fixed against a local Liberia server: see README.md.
//
// Conditions in the form, from documentation inventory (anc-followup.inv.md):
//   ifMode VIEW include=false :105 (LMP script), :157 (h2), :334 (#buttons); ifMode VIEW :53: CSS only. No when / toggle / includeIf.
// Scripts: :108-152 (not in VIEW) hides #calculated-edd-and-gestational, then shows it with the gestational age (weeks between LMP and the encounter date)
//   and EDD (LMP + 9 months + 7 days) only when the LMP widget (#lastPeriodDate, inside that block, in a span.hidden :290) has a value; <lookup> :288 prints
//   the latest LMP of the patient in #calculated-edd, but nothing copies it into the widget (V1).
// Side effects on save: <enrollInProgram programId="MCH"> :175 (tested). No postSubmissionAction (anc-delivery has one: V2). Required: the return visit date :326.
// Not covered here: the EDD field (:313), the "Other" risk factor comment, the shared who/when/where behaviours (_shared EPLD).
// VIEW: the save test (generic check + the [X] danger signs, risk factor and mental health answer; absent h2 / buttons).
//
// Findings (V1.. Medium -> Low):
//   V1 Medium :281-305, :108-152  the calculated EDD and gestational age never appear: the block is hidden on load and shown only when the LMP widget has a
//                       value, but that widget is itself inside the block (class hidden) and is never prefilled from the earlier LMP (<lookup> :288). A followup
//                       cannot show or enter an LMP, so the block stays hidden. Fix: show the block from the looked-up LMP (script or <lookup>-initialised
//                       widget). (TESTED, test.fail; confirmed on a server)
//   V2 Low    :186-206  each danger sign is a "Visit Diagnoses" group holding only PIH:DIAGNOSIS: no Diagnosis order member and no CleanDiagnosisConstructAction
//                       (anc-delivery.xml:6 has it); emrapi DiagnosisMetadata.toDiagnosis would hit a null order (getDiagnosisOrderFrom(null)) if some code reads
//                       these groups as diagnoses (which code does is unconfirmed). Fix: add the postSubmissionAction. (TESTED, test.fail; confirmed on a server)

import { type APIRequestContext, type Page } from '@playwright/test';
import { test, expect, birthdateYearsAgo, type EntryContext } from '../../core';
import { ANC_FOLLOWUP_ENCOUNTER_TYPE_UUID, ANC_INTAKE_ENCOUNTER_TYPE_UUID, NCD_CLINIC_LOCATION_UUID } from '../../core/constants';
import { getPatientEncounters } from '../../commands';
import { EntryFormPage, SectionFormPage, VISIT_PAGE_URL, expectViewShowsSavedObs, selectDefaultProvider } from '../../pages';

const FORM = 'anc-followup.xml';
const PATIENT = { givenName: 'AutoAncFu', familyName: 'Tester', gender: 'F' as const, birthdate: birthdateYearsAgo(25) };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n: number) => String(n).padStart(2, '0');
const shown = (d: Date) => `${pad(d.getDate())} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;

// The date widgets are read-only jQuery UI datepickers; setDate also updates the hidden field that is submitted.
const setDate = (page: Page, wrapper: string, date: Date) =>
  page.evaluate(
    ([w, ms]) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).jq(`${w} input.hasDatepicker`).datepicker('setDate', new Date(ms as number));
    },
    [wrapper, date.getTime()],
  );

interface SavedObs {
  concept: string;
  display: string;
  value: string;
}
// Every obs of the encounter, group members included.
const allObs = async (api: APIRequestContext, encounterUuid: string): Promise<SavedObs[]> => {
  const res = await api.get(`encounter/${encounterUuid}?v=custom:(obs:(display,concept:(display),value,groupMembers:(display,concept:(display),value)))`);
  expect(res.ok(), `get encounter obs: ${res.status()}`).toBeTruthy();
  type Raw = { display: string; concept: { display: string }; value: unknown; groupMembers?: Raw[] | null };
  const flat = ((await res.json()).obs as Raw[]).flatMap((o) => [o, ...(o.groupMembers ?? [])]);
  return flat.map((o) => ({
    concept: o.concept.display,
    display: o.display,
    value: o.value && typeof o.value === 'object' ? String((o.value as { display?: string }).display ?? '') : String(o.value ?? ''),
  }));
};

const openForm = async (page: Page, context: EntryContext) => {
  await EntryFormPage.open(page, FORM, context);
  await expect(page.locator('#apptDate input.hasDatepicker')).toBeVisible();
};

const returnVisit = () => {
  const d = new Date();
  d.setMonth(d.getMonth() + 1);
  return d;
};

const save = async (page: Page) => {
  await selectDefaultProvider(page);
  await page.locator('#submit').click();
  await expect(page).toHaveURL(VISIT_PAGE_URL);
};

// The REST concept lookup by mapping (the specs only know CIEL codes).
const conceptUuid = async (api: APIRequestContext, source: string, code: string): Promise<string> => {
  // the lookup pihServices.js uses (see _shared)
  const res = await api.get(`concept?references=${source}:${code}&v=custom:(uuid)`);
  expect(res.ok(), `concept ${source}:${code}: ${res.status()}`).toBeTruthy();
  const results = (await res.json()).results as Array<{ uuid: string }>;
  expect(results, `concept ${source}:${code} exists`).toHaveLength(1);
  return results[0].uuid;
};

test.describe('anc-followup', () => {
  let context: EntryContext;

  test.beforeEach(async ({ page, createEntryContext }) => {
    context = await createEntryContext(PATIENT);
    await openForm(page, context);
  });

  test('ENTER shows who/when/where at the session location, the sections and no calculated EDD', async ({ page }) => {
    // EPLD (see _shared), ifMode VIEW include=false :157 (h2) and :334 (buttons); script :145 hides the calculated block
    await expect(page.locator('#who select').first()).toBeVisible();
    await expect(page.locator('#where select option:checked')).toHaveText('NCD Clinic');
    await expect(page.locator('#when')).toBeVisible();
    await expect(page.locator('h2').first()).toBeVisible();
    await expect(page.locator('#anc-followup')).toBeVisible();
    await expect(page.locator('#anc-followup input[type="checkbox"]')).toHaveCount(30); // 13 danger signs, 3 mental health, 14 risk factors
    await expect(page.locator('#calculated-edd-and-gestational')).toBeHidden();
    await expect(page.locator('#submit')).toBeVisible();
  });

  // required="true" :326
  test('Save without the return visit date reports Required and saves nothing', async ({ page, api }) => {
    await selectDefaultProvider(page);
    await page.locator('#submit').click();
    await expect(page.locator('span.field-error', { hasText: 'Required' }).first()).toBeVisible();
    await expect(page).not.toHaveURL(VISIT_PAGE_URL);
    expect(await getPatientEncounters(api, context.patient.uuid)).toHaveLength(0);
  });

  test('saves with only the return visit date and enrolls in MCH', async ({ page, api }) => {
    await setDate(page, '#apptDate', returnVisit());
    await save(page);

    await expect
      .poll(async () => (await getPatientEncounters(api, context.patient.uuid)).map((e) => e.encounterType.uuid))
      .toEqual([ANC_FOLLOWUP_ENCOUNTER_TYPE_UUID]);
    const res = await api.get(`programenrollment?patient=${context.patient.uuid}&v=custom:(program:(name))`);
    expect(res.ok()).toBeTruthy();
    const enrollments = (await res.json()).results as Array<{ program: { name: string } }>;
    expect(enrollments.some((e) => /mch|maternal/i.test(e.program.name))).toBeTruthy(); // enrollInProgram :175
  });

  test('saves danger signs, a mental health answer and a risk factor; EDIT and VIEW show them', async ({ page, api }) => {
    const appt = returnVisit();
    const form = page.locator('#anc-followup');
    await form.getByLabel('Fever', { exact: true }).check();
    await form.getByLabel('Severe headache', { exact: true }).check();
    await form.locator('input[type="checkbox"]').nth(13).check(); // first mental health answer (Depression)
    await form.getByLabel('Hypertension', { exact: true }).check();
    await setDate(page, '#apptDate', appt);
    await save(page);

    const [encounter] = await getPatientEncounters(api, context.patient.uuid);
    const obs = await allObs(api, encounter.uuid);
    const displays = obs.map((o) => o.display.toLowerCase());
    expect(displays.some((d) => d.includes('fever'))).toBeTruthy();
    expect(displays.some((d) => d.includes('severe headache'))).toBeTruthy();
    expect(displays.some((d) => d.includes('hypertension'))).toBeTruthy();
    expect(obs.filter((o) => /^visit diagnoses$/i.test(o.concept))).toHaveLength(2); // one Visit Diagnoses group per danger sign (:188)

    // EDIT starts from the saved values
    const section = { patient: context.patient, encounter: { uuid: encounter.uuid, visitUuid: context.visitUuid } };
    await SectionFormPage.openEdit(page, FORM, section);
    await expect(page.locator('#anc-followup').getByLabel('Fever', { exact: true })).toBeChecked();
    await expect(page.locator('#anc-followup').getByLabel('Severe headache', { exact: true })).toBeChecked();
    await expect(page.locator('#anc-followup input[type="checkbox"]').nth(0)).not.toBeChecked();
    await expect(page.locator('#anc-followup').getByLabel('Hypertension', { exact: true })).toBeChecked();

    // VIEW: the four ticked boxes and the return visit date; no h2 / buttons / who-when-where (ifMode VIEW include=false :157, :334)
    const view = await expectViewShowsSavedObs(page, api, FORM, encounter.uuid);
    const texts = await view.valueTexts();
    expect(texts).toContain('[X] Fever');
    expect(texts).toContain('[X] Severe headache');
    expect(texts).toContain('[X] Hypertension');
    expect(texts.filter((t) => t.startsWith('[X]'))).toHaveLength(4);
    await expect(view.page.locator('#apptDate .value')).toHaveText(shown(new Date(appt.getFullYear(), appt.getMonth(), appt.getDate())));
    await expect(view.page.locator('#buttons, h2, #who-when-where')).toHaveCount(0);
  });

  // :108-152, :281-305: the patient has an earlier LMP (an ANC Intake encounter over REST), so the followup should show the EDD and GA
  test.fail('V1 the calculated EDD and gestational age are shown when the patient has an LMP', async ({ page, api }) => {
    // remove test.fail() when fixed
    const lmp = new Date();
    lmp.setDate(lmp.getDate() - 140);
    const res = await api.post('encounter', {
      data: {
        patient: context.patient.uuid,
        encounterType: ANC_INTAKE_ENCOUNTER_TYPE_UUID,
        location: NCD_CLINIC_LOCATION_UUID,
        encounterDatetime: new Date().toISOString(),
        visit: context.visitUuid,
        obs: [{ concept: await conceptUuid(api, 'CIEL', '1427'), value: lmp.toISOString() }],
      },
    });
    expect(res.ok(), `create ANC intake with an LMP: ${res.status()}`).toBeTruthy();

    await openForm(page, context);
    await expect(page.locator('#calculated-edd-and-gestational')).toBeVisible();
    await expect(page.locator('#calculated-gestational-age-value')).toHaveText(/^\d+ weeks$/);
  });

  // :186-206 vs anc-delivery.xml:6 (CleanDiagnosisConstructAction adds the missing Diagnosis order)
  test.fail('V2 a saved danger sign is a complete diagnosis with a Diagnosis order', async ({ page, api }) => {
    // remove test.fail() when fixed
    await page.locator('#anc-followup').getByLabel('Fever', { exact: true }).check();
    await setDate(page, '#apptDate', returnVisit());
    await save(page);

    const [encounter] = await getPatientEncounters(api, context.patient.uuid);
    const obs = await allObs(api, encounter.uuid);
    expect(obs.some((o) => /diagnosis order/i.test(o.concept))).toBeTruthy();
  });
});

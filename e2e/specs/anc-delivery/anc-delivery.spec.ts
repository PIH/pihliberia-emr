// anc-delivery.xml: "MCH Delivery" (MCH Delivery encounter): who/when/where, MCH enrolment, then the delivery section: date (datetime, default today), counselling,
// dystocia, cord, vaginal haemorrhage (+ Visit Diagnoses checkboxes), transfusion, type of delivery (+ c-section reasons), placenta, blood loss, the birth outcome
// (alive: weight and Apgar; dead: macerated), resuscitation, procedures, mental health, baby / mother findings, referral, number of prenatal visits and return visit.
// ENTER: EntryFormPage opens enterHtmlFormWithStandardUi in a visit the spec creates, so the gating of _availability.e2e.md (female, "Maternal and Child Location"
// tag, Task: emr.enterMCH, no MCH Delivery in the visit; code comment "TODO: working on this") is skipped; the session is NCD Clinic, which carries Consult Note
// Location (the who/where/when tag, see _shared EPLD). EDIT: SectionFormPage.openEdit on the saved encounter (the form has #submit).
// First written without a server (locators from the XML), then run and fixed against a local Liberia server: see README.md.
//
// Conditions in the form, from documentation inventory (anc-delivery.inv.md):
//   when #hemLine Yes :213 -> #bleeding-diagnosis      toggle #toggle-csection (c-section) :258 -> #c-section-reason
//   when #baby-live-or-death Livebirth :379 -> #baby-alive (weight, Apgar), Fetal death :380 -> #baby-death (macerated?)
//   ifMode VIEW include=false :60 (CSS), :127 (h2), :572 (#buttons); ifMode VIEW :74 (CSS only). No script of its own, no required field.
// Defaults: the delivery date (CIEL:5599, allowTime, defaultDatetime="today") :157.
// Side effects on save: <enrollInProgram programId="MCH"> :145 (tested); postSubmissionAction CleanDiagnosisConstructAction :6 (pihcore): a Visit Diagnoses group
//   without a Diagnosis order member gets "Secondary" added (tested); a group whose PIH:DIAGNOSIS is not the emrapi Coded Diagnosis concept would be voided.
// Not covered here: the rarely used answers (dystocia, placenta, referral, procedures), the shared who/when/where behaviours (_shared EPLD).
// VIEW: the rich save test (generic check; the Visit Diagnoses checkboxes by their [X] text; absent h2 / buttons / who-when-where).
//
// Findings (V1.. Medium -> Low):
//   V1 Low    :459  the XML comment says "currently debugging: submit with any of the baby / mother findings selected throws an indexOutOfBound / nullPointer
//                   exception"; the layout hack `margin-top:-100px` :475 is part of the same work. The test below saves a finding to confirm it works now.
//                   (unconfirmed: not run)
//   V2 Low    :300-302  placenta delivery method: answerCodes natural / artificial are saved as CIEL:1115 Normal / CIEL:1116 Abnormal, so "artificial" reads as
//                   "Abnormal" in any report. Fix: concepts for natural / artificial delivery of the placenta.

import { type APIRequestContext, type Page } from '@playwright/test';
import { test, expect, birthdateYearsAgo, type EntryContext } from '../../core';
import { MCH_DELIVERY_ENCOUNTER_TYPE_UUID } from '../../core/constants';
import { getPatientEncounters } from '../../commands';
import { EntryFormPage, SectionFormPage, VISIT_PAGE_URL, expectViewShowsSavedObs, selectDefaultProvider } from '../../pages';

const FORM = 'anc-delivery.xml';
const PATIENT = { givenName: 'AutoDelivery', familyName: 'Tester', gender: 'F' as const, birthdate: birthdateYearsAgo(25) };
const YES = /^yes$/i;
const NO = /^no$/i;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n: number) => String(n).padStart(2, '0');
const shown = (d: Date) => `${pad(d.getDate())} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;

const pick = (page: Page, wrapper: string, label: RegExp) => page.locator(wrapper).getByLabel(label).check();

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

const save = async (page: Page) => {
  await selectDefaultProvider(page);
  await page.locator('#submit').click();
  await expect(page).toHaveURL(VISIT_PAGE_URL);
};

test.describe('anc-delivery', () => {
  let context: EntryContext;

  test.beforeEach(async ({ page, createEntryContext }) => {
    context = await createEntryContext(PATIENT);
    await EntryFormPage.open(page, FORM, context);
    await expect(page.locator('#labor-delivery')).toBeVisible();
  });

  test('ENTER shows who/when/where at the session location and a delivery date that defaults to today', async ({ page }) => {
    // EPLD (see _shared), ifMode VIEW include=false :127 (h2) and :572 (buttons); defaultDatetime="today" :157
    await expect(page.locator('#who select').first()).toBeVisible();
    await expect(page.locator('#where select option:checked')).toHaveText('NCD Clinic');
    await expect(page.locator('h2').first()).toBeVisible();
    await expect(page.locator('#submit')).toBeVisible();
    await expect(page.locator('p.date-one-line input.hasDatepicker')).not.toHaveValue('');
    await expect(page.locator('p.date-one-line input.hasDatepicker')).toHaveValue(shown(new Date()));
  });

  // when :213 (the radios are inside the wrapper span #hemLine)
  test('the vaginal haemorrhage diagnoses show only for the answer Yes', async ({ page }) => {
    await expect(page.locator('#bleeding-diagnosis')).toBeHidden();
    await pick(page, '#hemLine', YES);
    await expect(page.locator('#bleeding-diagnosis')).toBeVisible();
    await pick(page, '#hemLine', NO);
    await expect(page.locator('#bleeding-diagnosis')).toBeHidden();
  });

  // toggle :258
  test('ticking c-section shows the reasons for the c-section', async ({ page }) => {
    const box = page.locator('#toggle-csection input[type="checkbox"]');
    await expect(page.locator('#c-section-reason')).toBeHidden();
    await box.check();
    await expect(page.locator('#c-section-reason')).toBeVisible();
    await box.uncheck();
    await expect(page.locator('#c-section-reason')).toBeHidden();
  });

  // when :379, :380 (answers in the order of answerConceptIds: Livebirth, Fetal death)
  test('the birth outcome shows weight and Apgar for a livebirth and the maceration question for a fetal death', async ({ page }) => {
    const outcome = page.locator('#baby-live-or-death input[type="radio"]');
    await expect(page.locator('#baby-alive')).toBeHidden();
    await expect(page.locator('#baby-death')).toBeHidden();
    await outcome.nth(0).check();
    await expect(page.locator('#baby-alive')).toBeVisible();
    await expect(page.locator('#baby-death')).toBeHidden();
    await outcome.nth(1).check();
    await expect(page.locator('#baby-death')).toBeVisible();
    await expect(page.locator('#baby-alive')).toBeHidden();
  });

  test('saves with only the defaults: one MCH Delivery encounter with the delivery date, enrolled in MCH', async ({ page, api }) => {
    // no required field of its own (the provider is the only one)
    await save(page);

    await expect
      .poll(async () => (await getPatientEncounters(api, context.patient.uuid)).map((e) => e.encounterType.uuid))
      .toEqual([MCH_DELIVERY_ENCOUNTER_TYPE_UUID]);
    const [encounter] = await getPatientEncounters(api, context.patient.uuid);
    // the date obs is read as raw REST obs: a datetime value comes back as an ISO string
    const raw = await api.get(`obs?encounter=${encounter.uuid}&v=custom:(concept:(display),value)&limit=50`);
    expect(raw.ok()).toBeTruthy();
    const dates = ((await raw.json()).results as Array<{ concept: { display: string }; value: unknown }>).filter(
      (o) => typeof o.value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(o.value),
    );
    expect(dates).toHaveLength(1); // CIEL:5599 "Date of delivery", defaulted to today (defaultDatetime :157)
    expect(Math.abs(new Date(dates[0].value as string).getTime() - Date.now())).toBeLessThan(36 * 60 * 60 * 1000);

    const res = await api.get(`programenrollment?patient=${context.patient.uuid}&v=custom:(program:(name))`);
    expect(res.ok()).toBeTruthy();
    const enrollments = (await res.json()).results as Array<{ program: { name: string } }>;
    expect(enrollments.some((e) => /mch|maternal/i.test(e.program.name))).toBeTruthy(); // enrollInProgram :145
  });

  // postSubmissionAction CleanDiagnosisConstructAction :6; the XML comment :459 reports an exception when a finding is selected (V1)
  test('a baby finding and a mother finding are saved as diagnoses with a Secondary Diagnosis order', async ({ page, api }) => {
    await page.getByLabel('Respiratory distress', { exact: true }).check(); // for baby
    await page.getByLabel('Premature rupture of membranes', { exact: true }).check(); // for mama
    await save(page);

    const [encounter] = await getPatientEncounters(api, context.patient.uuid);
    const obs = await allObs(api, encounter.uuid);
    const displays = obs.map((o) => o.display.toLowerCase());
    expect(displays.some((d) => d.includes('respiratory distress'))).toBeTruthy();
    expect(displays.some((d) => d.includes('premature rupture of membranes'))).toBeTruthy();
    expect(obs.filter((o) => /diagnosis order/i.test(o.concept) && /secondary/i.test(o.value))).toHaveLength(2);
  });

  test('saves a livebirth by c-section with its answers; EDIT starts from them and VIEW shows them', async ({ page, api }) => {
    const appt = new Date();
    appt.setMonth(appt.getMonth() + 1);

    await page.locator('#labor-delivery .two-columns input[type="radio"]').first().check(); // newborn nutrition counselling: Yes
    await pick(page, '#hemLine', YES);
    await page.locator('#bleeding-diagnosis input[type="checkbox"]').first().check(); // placental abruption
    await page.locator('#toggle-csection input[type="checkbox"]').check();
    await page.locator('#c-section-reason input[type="checkbox"]').first().check(); // prolapsed cord
    await page.locator('#baby-live-or-death input[type="radio"]').nth(0).check();
    await page.locator('#baby-alive input[type="text"]').first().fill('3.2'); // birth weight (kg)
    await page.locator('#baby-alive input[type="radio"]').first().check(); // Apgar: less than 4
    await page.getByLabel('Respiratory distress', { exact: true }).check();
    await setDate(page, '#apptDate', appt);
    await save(page);

    const [encounter] = await getPatientEncounters(api, context.patient.uuid);
    const obs = await allObs(api, encounter.uuid);
    expect(obs.some((o) => /birth weight/i.test(o.concept) && Number(o.value) === 3.2)).toBeTruthy();
    expect(obs.some((o) => /caesarean|cesarean/i.test(o.display))).toBeTruthy();
    expect(obs.some((o) => /prolapse/i.test(o.display))).toBeTruthy();
    expect(obs.some((o) => /abruption|separation of placenta/i.test(o.display))).toBeTruthy();

    // EDIT: the when / toggle targets start from the saved answers
    const section = { patient: context.patient, encounter: { uuid: encounter.uuid, visitUuid: context.visitUuid } };
    await SectionFormPage.openEdit(page, FORM, section);
    await expect(page.locator('#bleeding-diagnosis')).toBeVisible();
    await expect(page.locator('#c-section-reason')).toBeVisible();
    await expect(page.locator('#baby-alive')).toBeVisible();
    await expect(page.locator('#baby-death')).toBeHidden();
    await expect(page.locator('#baby-alive input[type="text"]').first()).toHaveValue('3.2');
    await expect(page.getByLabel('Respiratory distress', { exact: true })).toBeChecked();
    await expect(page.locator('#where select option:checked')).toHaveText('NCD Clinic');

    // VIEW: generic check (the Visit Diagnoses obs are skipped by the helper: asserted by their [X] text); not the unanswered fetal death block
    // the "Diagnosis order: Secondary" members added by the action have no widget in the form: not looked for in VIEW
    const labels: Record<string, string> = {};
    for (const o of obs.filter((x) => /diagnosis order/i.test(x.concept))) {
      labels[o.display] = '';
    }
    const view = await expectViewShowsSavedObs(page, api, FORM, encounter.uuid, labels);
    await expect(view.page.locator('#hemLine .value')).toHaveText(/\[X\]\s*yes/i); // answerCodes emr.yes
    const texts = await view.valueTexts();
    expect(texts).toContain('[X] Respiratory distress');
    expect(texts.some((t) => /^\[X\]\s*.*(abruption|separation of placenta)/i.test(t))).toBeTruthy();
    await expect(view.page.locator('#baby-alive .value').first()).toHaveText(/^3\.2/);
    await expect(view.page.locator('#baby-death .value')).toHaveCount(0);
    await expect(view.page.locator('#apptDate .value')).toHaveText(shown(new Date(appt.getFullYear(), appt.getMonth(), appt.getDate())));
    // ifMode VIEW include=false :127, :572 and the who/when/where block
    await expect(view.page.locator('#buttons, h2, #who-when-where')).toHaveCount(0);
  });
});

// anc-initial.xml: "ANC Initial" (ANC Intake encounter): who/when/where, MCH enrolment, then referral, past medical history (with menstrual,
// contraceptive and surgical history), previous pregnancy history, social history and the intake block (risk factors, G/P/A/L, LMP, EDD, exam,
// return visit date). ENTER: EntryFormPage opens enterHtmlFormWithStandardUi in a visit the spec creates, so the gating of
// _availability.e2e.md (female, "Maternal and Child Location" tag, Task: emr.enterMCH, no ANC encounter in the visit) is skipped; the session is
// NCD Clinic, which carries Consult Note Location (the who/where/when tag, see _shared EPLD), so the MCH Clinic is not needed. EDIT: the saved
// encounter is reopened with SectionFormPage.openEdit (the form has #submit).
// First written without a server (locators from the XML), then run and fixed against a local Liberia server: see README.md.
//
// Conditions in the form, from documentation inventory (anc-initial.inv.md):
//   when yes :347 :402 :435 :450 :528 :566 :685 :743 :817  -> #past-illness-list, #hospitalization-details, #patient-recently-taken-medication,
//        #patient-medications, #medication-side-effect, #church-or-traditional-healer-comment, #contraceptive-use, #surgical-history, #mch-concept-set
//   when :501/:502  medication row n (1-5): still taking Yes -> #n-drug-start-date, No -> #n-drug-stop-date     toggle :1424  tenderness -> #tenderness-quadrant
//   includeIf :988/:989  "she"/"he" in one label only (patient gender): not tested.
//   ifMode VIEW include=false :142 (LMP script), :195 (h2), :1526 (#buttons); ifMode VIEW :73, :126: CSS that forces .collapsible open and hides the arrows
// Scripts: :145-190 (not in VIEW) LMP (#lastPeriodDate) change -> shows #calculated-edd-and-gestational: gestational age = ceil(weeks between LMP and
//   the encounter date, or today in ENTER), EDD = LMP + 9 months + 7 days (display only: the EDD field :1299 is typed by hand). liberia.js arrows (the 4
//   `i.icon-arrow-down`: click toggles the section's div) and mch.js collapsibles: see _shared. Past Medical History and Social History start collapsed.
// Side effects on save: <enrollInProgram programId="MCH"> :213 (tested). Required: G, P, A, L (:1260-1278) and the return visit date (:1519).
// Not covered here: the "she/he" label, the rarely used inputs (referral, transportation, financial aid), the other pregnancy-table columns.
// VIEW: the save test (generic check on text, number and coded obs, targeted assertions, absent h2 / buttons / who-when-where).
//
// Findings (V1.. High -> Low; see _shared V10 and its "Leads" for the arrows and the collapsed sections in EDIT):
//   V1 High   :493-495  medication frequency: answerConceptIds ...PRN,STAT,OTHER but answerCodes ...STAT,PRN,...: the option labelled "STAT" saves PRN
//                       and "PRN" saves STAT (same defect as section-ncd-history V1). Fix: swap the two codes. (TESTED, test.fail; confirmed on a server)
//   V2 Medium :669,:724,:780,:1478  four free-text widgets on PIH:1336 ("Exam"), :537/:726 two on CIEL:164377, :832-860 / :1260-1278 G, P, A, L twice
//                       (CIEL:5624, 1053, 1823, 1825), :950/:953 two questions on CIEL:161033 in every previous-pregnancy row, :366/:667 CIEL:1628 with
//                       answer CIEL:5622 twice. No widget has a controlId, so HTML Form Entry (FormEntryContext.removeExistingObs) gives a saved obs to the
//                       first widget of that concept in form order: on EDIT an answer reappears under another question (SL-1461 class). Not tested: the
//                       order is not stable enough for a test. Fix: distinct question concepts.
//   V5 Medium :159-176 (and anc-followup.xml :134 the same script)  the calculated EDD is shown as today's date: the script sets the EDD on the LMP picker
//                       (datepicker('setDate', newDate).val()) but the LMP obs has allowFutureDates="false", so the picker's maxDate is today and the future
//                       EDD is clamped to today. Seen on the first run (EDD "04 Nov 2026" for an LMP 20 weeks ago); probe: maxDate = today. Fix: compute the
//                       EDD without the picker (jq.datepicker.formatDate on newDate). TESTED (test.fail). (numbered after the Lows it was found with)
//   V3 Low    :475/:919, :477/:921, :675/:683, :963  duplicate ids: medication-n and n-rx in both repeats, `contraceptive-history` on a div and an obs,
//                       `puerperium` on all 7 rows (not templated). Breaks per-row locators and script selectors. Fix: unique ids.
//   V4 Low    :323, :807  placeholder "lorum ipsum" on the referral date; <h2><uimessage code=""/></h2> empty heading in Previous Pregnancy History.

import { type APIRequestContext, type Page } from '@playwright/test';
import { test, expect, birthdateYearsAgo, type EntryContext } from '../../core';
import { ANC_INTAKE_ENCOUNTER_TYPE_UUID } from '../../core/constants';
import { getPatientEncounters } from '../../commands';
import { EntryFormPage, SectionFormPage, VISIT_PAGE_URL, expectViewShowsSavedObs, selectDefaultProvider } from '../../pages';

const FORM = 'anc-initial.xml';
const PATIENT = { givenName: 'AutoAncInit', familyName: 'Tester', gender: 'F' as const, birthdate: birthdateYearsAgo(25) };
const YES = /^yes$/i;
const NO = /^no$/i;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n: number) => String(n).padStart(2, '0');
// The date widgets show "15 Mar 2024" (the format of the other Liberia specs).
const shown = (d: Date) => `${pad(d.getDate())} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;

// Radios and dropdown answers inside a wrapper span that has an id (labels are the concept names: Yes / No / Unknown).
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
// A programmatic setDate does not fire the widget's onSelect, which is what the LMP script listens to (the hidden field's change).
const setLmp = async (page: Page, date: Date) => {
  await setDate(page, '#lastPeriodDate', date);
  await page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).jq("#lastPeriodDate input[type='hidden']").change();
  });
};
const daysAgo = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
};

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
  await expect(page.locator('#gravidaInput input')).toBeVisible();
};

// Opens a collapsed section (liberia.js: click on the arrow shows the section's div).
const expandSection = async (page: Page, id: string) => {
  const content = page.locator(`#${id} .section-container`).first();
  if (!(await content.isVisible())) {
    await page.locator(`#${id} i`).first().dispatchEvent('click');
  }
  await expect(content).toBeVisible();
};

// G, P, A, L and the return visit date are required.
const fillRequired = async (page: Page) => {
  const gpal = page.locator('.four-columns p');
  for (const [i, v] of ['2', '1', '0', '1'].entries()) {
    await gpal.nth(i).locator('input[type="text"]').fill(v);
  }
  const nextMonth = new Date();
  nextMonth.setMonth(nextMonth.getMonth() + 1);
  await setDate(page, '#apptDate', nextMonth);
};

const save = async (page: Page) => {
  await selectDefaultProvider(page);
  await page.locator('#submit').click();
  await expect(page).toHaveURL(VISIT_PAGE_URL);
};

// "Has the patient ever received medication" + "recently taken" = yes shows the five medication rows (when :435, :450).
const revealMedications = async (page: Page) => {
  await expandSection(page, 'past-medical-history');
  await pick(page, '#patient-ever-received-medication', YES);
  await pick(page, '#obs-patient-recently-taken-medication', YES);
  await expect(page.locator('#patient-medications')).toBeVisible();
};

test.describe('anc-initial', () => {
  test.describe('ENTER', () => {
    let context: EntryContext;

    test.beforeEach(async ({ page, createEntryContext }) => {
      context = await createEntryContext(PATIENT);
      await openForm(page, context);
    });

    test('shows who/when/where at the session location, Referral and Previous Pregnancy open, Past Medical and Social History collapsed', async ({ page }) => {
      // EPLD (see _shared), ifMode VIEW include=false :195 (h2) and :1526 (buttons); collapsed sections :336, :979
      await expect(page.locator('#who select').first()).toBeVisible();
      await expect(page.locator('#where select option:checked')).toHaveText('NCD Clinic');
      await expect(page.locator('#when')).toBeVisible();
      await expect(page.locator('h2').first()).toBeVisible();
      await expect(page.locator('#submit')).toBeVisible();
      await expect(page.locator('#anc_refer .section-container')).toBeVisible();
      await expect(page.locator('#previous-pregnancy .section-container')).toBeVisible();
      await expect(page.locator('#past-medical-history .section-container')).toBeHidden();
      await expect(page.locator('#social-history .section-container')).toBeHidden();
      await expect(page.locator('#anc-intake')).toBeVisible();
    });

    // liberia.js (see _shared): click on `i.icon-arrow-down` toggles the section's div
    test('the arrow opens and closes the Past Medical History and Social History sections', async ({ page }) => {
      for (const id of ['past-medical-history', 'social-history']) {
        const content = page.locator(`#${id} .section-container`).first();
        await expect(content, `${id} starts collapsed`).toBeHidden();
        await page.locator(`#${id} i`).first().dispatchEvent('click');
        await expect(content, `${id} opened`).toBeVisible();
        await page.locator(`#${id} i`).first().dispatchEvent('click');
        await expect(content, `${id} closed again`).toBeHidden();
      }
    });

    // when :347, :402, :435, :566, :685, :743, :817
    const whens = [
      { name: 'past illness list', section: 'past-medical-history', wrapper: '#past-illness-history', target: '#past-illness-list' },
      { name: 'hospitalization details', section: 'past-medical-history', wrapper: '#has-patient-been-hospitalized', target: '#hospitalization-details' },
      { name: 'recent medication question', section: 'past-medical-history', wrapper: '#patient-ever-received-medication', target: '#patient-recently-taken-medication' },
      { name: 'church yard / traditional healer comment', section: 'past-medical-history', wrapper: '#visit-to-church-yard-or-traditional-healer', target: '#church-or-traditional-healer-comment' },
      // `contraceptive-history` is also the id of a div (V3): the obs wrapper is the span
      { name: 'contraceptive use', section: 'past-medical-history', wrapper: 'span#contraceptive-history', target: '#contraceptive-use' },
      { name: 'surgical history', section: 'past-medical-history', wrapper: '#personal-surgical-history', target: '#surgical-history' },
      { name: 'previous pregnancy details', section: 'previous-pregnancy', wrapper: '#delivery-within-past-5-years', target: '#mch-concept-set' },
    ];
    for (const w of whens) {
      test(`${w.name} (${w.target}) shows only for the answer Yes`, async ({ page }) => {
        await expandSection(page, w.section);
        await expect(page.locator(w.target)).toBeHidden();
        await pick(page, w.wrapper, YES);
        await expect(page.locator(w.target)).toBeVisible();
        await pick(page, w.wrapper, NO);
        await expect(page.locator(w.target)).toBeHidden();
      });
    }

    // when :450 (inside :435), :528 (inside :450)
    test('the medication table needs both medication questions; the reaction explanation needs a reaction', async ({ page }) => {
      await expandSection(page, 'past-medical-history');
      await expect(page.locator('#patient-medications')).toBeHidden();
      await pick(page, '#patient-ever-received-medication', YES);
      await expect(page.locator('#patient-medications')).toBeHidden();
      await pick(page, '#obs-patient-recently-taken-medication', YES);
      await expect(page.locator('#patient-medications')).toBeVisible();
      await expect(page.locator('#medication-side-effect')).toBeHidden();
      await pick(page, '#medication-reaction', YES);
      await expect(page.locator('#medication-side-effect')).toBeVisible();
      await pick(page, '#medication-reaction', NO);
      await expect(page.locator('#medication-side-effect')).toBeHidden();
      await pick(page, '#obs-patient-recently-taken-medication', NO);
      await expect(page.locator('#patient-medications')).toBeHidden();
    });

    // when :501, :502 (templated per row; the ids start with a digit, so [id="..."])
    test('a medication row shows its start date for Yes and its finish date for No (still taking)', async ({ page }) => {
      await revealMedications(page);
      const stillTaking = page.locator('[id="1-still-taking"] select');
      await expect(page.locator('[id="1-drug-start-date"]')).toBeHidden();
      await expect(page.locator('[id="1-drug-stop-date"]')).toBeHidden();
      await stillTaking.selectOption({ label: 'Yes' });
      await expect(page.locator('[id="1-drug-start-date"]')).toBeVisible();
      await expect(page.locator('[id="1-drug-stop-date"]')).toBeHidden();
      await stillTaking.selectOption({ label: 'No' });
      await expect(page.locator('[id="1-drug-stop-date"]')).toBeVisible();
      await expect(page.locator('[id="1-drug-start-date"]')).toBeHidden();
    });

    // toggle :1424 (the checkbox is the first one of the span.inline that also holds #tenderness-quadrant)
    test('ticking Abdominal tenderness shows the quadrants', async ({ page }) => {
      const box = page.locator('span.inline', { has: page.locator('#tenderness-quadrant') }).first().locator('input[type="checkbox"]').first();
      await expect(page.locator('#tenderness-quadrant')).toBeHidden();
      await box.check();
      await expect(page.locator('#tenderness-quadrant')).toBeVisible();
      await box.uncheck();
      await expect(page.locator('#tenderness-quadrant')).toBeHidden();
    });

    // script :145-190 (not in VIEW)
    test('an LMP shows the gestational age', async ({ page }) => {
      const lmp = daysAgo(140); // 20 weeks and a few hours: ceil() gives 21 (20 only at exactly midnight)
      await expect(page.locator('#calculated-edd-and-gestational')).toBeHidden();
      await setLmp(page, lmp);
      await expect(page.locator('#calculated-edd-and-gestational')).toBeVisible();
      await expect(page.locator('#calculated-gestational-age-value')).toHaveText(/^2[01] weeks$/);
    });

    // V5: the EDD is clamped to today by the LMP picker's maxDate (remove test.fail() when fixed)
    test('V5 the calculated EDD is (LMP - 3 months) + 12 months + 7 days', async ({ page }) => {
      test.fail();
      const lmp = daysAgo(140);
      await setLmp(page, lmp);
      // EDD = (LMP - 3 months) + 12 months + 7 days, computed from the local midnight of the LMP like the script does
      const edd = new Date(lmp.getFullYear(), lmp.getMonth(), lmp.getDate());
      edd.setMonth(edd.getMonth() - 3);
      edd.setFullYear(edd.getFullYear() + 1);
      edd.setDate(edd.getDate() + 7);
      await expect(page.locator('#calculated-edd')).toHaveText(shown(edd));
    });

    // required="true" :1260-1278, :1519, and the provider (EPLD)
    test('Save with G, P, A, L and the return visit date blank reports Required and saves nothing', async ({ page, api }) => {
      await selectDefaultProvider(page);
      await page.locator('#submit').click();
      await expect(page.locator('span.field-error', { hasText: 'Required' }).first()).toBeVisible();
      expect(await page.locator('span.field-error', { hasText: 'Required' }).count()).toBeGreaterThanOrEqual(5);
      await expect(page).not.toHaveURL(VISIT_PAGE_URL);
      expect(await getPatientEncounters(api, context.patient.uuid)).toHaveLength(0);
    });

    // :493-495: answerConceptIds PIH:OD,BID,TID,QID,PRN,STAT,OTHER vs answerCodes OD,BID,TID,QID,STAT,PRN,other
    test.fail('V1 the medication frequency option "STAT" saves STAT', async ({ page, api }) => {
      // remove test.fail() when fixed
      await fillRequired(page);
      await revealMedications(page);
      await page.locator('[id="1-frequencyCoded"] select').selectOption({ label: 'STAT' });
      await save(page);
      const [encounter] = await getPatientEncounters(api, context.patient.uuid);
      const frequency = (await allObs(api, encounter.uuid)).filter((o) => /frequency/i.test(o.concept));
      expect(frequency).toHaveLength(1);
      expect(frequency[0].value).toMatch(/stat/i); // saves PRN today
    });

    test('saves the intake, enrolls in MCH, EDIT starts from the saved values and VIEW shows them', async ({ page, api }) => {
      const lmp = daysAgo(140);
      const nextMonth = new Date();
      nextMonth.setMonth(nextMonth.getMonth() + 1);

      // intake block: mothers group (the first text input), trimester (the first radio), Hypertension (6th checkbox: HIV test, 3 mental health,
      // HIV, Hypertension), G/P/A/L, LMP, breast exam (last textarea), return visit date
      await page.locator('#anc-intake input[type="text"]').first().fill('A01');
      await page.locator('#anc-intake input[type="radio"]').first().check();
      await page.locator('#anc-intake input[type="checkbox"]').nth(5).check();
      await fillRequired(page);
      await setLmp(page, lmp);
      await page.locator('#anc-intake textarea').last().fill('Breasts normal');
      // past medical history: a past illness and the contraceptive use
      await expandSection(page, 'past-medical-history');
      await pick(page, '#past-illness-history', YES);
      await page.locator('#past-illness-list input[type="checkbox"]').first().check();
      await pick(page, 'span#contraceptive-history', YES);
      await page.locator('#contraceptive-use input[type="checkbox"]').first().check();
      // previous pregnancy: order and year of the first row
      await pick(page, '#delivery-within-past-5-years', YES);
      const row = page.locator('#mch-concept-set .previous-pregnancy-tbl tbody tr').first().locator('input[type="text"]');
      await row.nth(0).fill('1');
      await row.nth(1).fill('2019');
      // social history
      await expandSection(page, 'social-history');
      await pick(page, '#money-source-while-sick', YES);
      await page.locator('#transportation-cost input').fill('5');
      await save(page);

      await expect
        .poll(async () => (await getPatientEncounters(api, context.patient.uuid)).map((e) => e.encounterType.uuid))
        .toEqual([ANC_INTAKE_ENCOUNTER_TYPE_UUID]);
      const [encounter] = await getPatientEncounters(api, context.patient.uuid);
      const obs = await allObs(api, encounter.uuid);
      const values = obs.map((o) => o.value);
      const displays = obs.map((o) => o.display.toLowerCase());
      expect(values).toContain('A01');
      expect(values).toContain('Breasts normal');
      expect(displays.some((d) => d.includes('hypertension'))).toBeTruthy();
      expect(obs.some((o) => /^gravida$/i.test(o.concept) && o.value === '2')).toBeTruthy(); // G: CIEL:5624 is displayed as "Gravida" on this server
      expect(obs.some((o) => /last menstrual|lmp/i.test(o.concept))).toBeTruthy();

      // <enrollInProgram programId="MCH"> :213
      const res = await api.get(`programenrollment?patient=${context.patient.uuid}&v=custom:(program:(name))`);
      expect(res.ok()).toBeTruthy();
      const enrollments = (await res.json()).results as Array<{ program: { name: string } }>;
      expect(enrollments.some((e) => /mch|maternal/i.test(e.program.name))).toBeTruthy();

      // EDIT starts from the saved values: when targets follow the saved answers, the LMP script runs on load
      const section = { patient: context.patient, encounter: { uuid: encounter.uuid, visitUuid: context.visitUuid } };
      await SectionFormPage.openEdit(page, FORM, section);
      await expect(page.locator('#anc-intake input[type="text"]').first()).toHaveValue('A01');
      await expect(page.locator('#calculated-edd-and-gestational')).toBeVisible();
      await expect(page.locator('#calculated-gestational-age-value')).toHaveText(/^2[01] weeks$/);
      await expandSection(page, 'past-medical-history');
      await expect(page.locator('#past-illness-list')).toBeVisible();
      await expect(page.locator('#contraceptive-use')).toBeVisible();
      await expect(page.locator('#church-or-traditional-healer-comment')).toBeHidden(); // not answered
      await expect(page.locator('#where select option:checked')).toHaveText('NCD Clinic');

      // VIEW: the saved text, numbers and coded answers; the dates by their widgets; not the unanswered blocks
      const view = await expectViewShowsSavedObs(page, api, FORM, encounter.uuid);
      await expect(view.page.locator('#lastPeriodDate .value')).toHaveText(shown(new Date(lmp.getFullYear(), lmp.getMonth(), lmp.getDate())));
      await expect(view.page.locator('#apptDate .value')).toHaveText(shown(new Date(nextMonth.getFullYear(), nextMonth.getMonth(), nextMonth.getDate())));
      await expect(view.page.locator('#past-illness-history .value')).toHaveText(/\[X\]\s*yes/i);
      expect(await view.valueTexts()).toContain('A01');
      await expect(view.page.locator('#hospitalization-details .value')).toHaveCount(0); // not answered
      await expect(view.page.locator('#anc_refer .value')).toHaveCount(0);
      // ifMode VIEW include=false :195 (the title h2, a direct child of .htmlform; the 6 others are section headings), :1526 and the who/when/where block
      await expect(view.page.locator('#buttons, .htmlform > h2, #who-when-where')).toHaveCount(0);
    });
  });
});

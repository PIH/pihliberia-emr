// section-ncd-history.xml: "NCD Patient Intake Card" of the NCD Initial encounter (patient details, TB screening, lifestyle, past
// medications, past medical history, family planning, social history, physical exam, NCD categories, reason for visit, notes).
// A standalone EDIT form on the parent encounter (visit-page pencil, _availability.e2e.md "Sections"): the specs create an NCD
// Initial Consult encounter over REST and open the edit URL directly, which skips the visit-page gating.
// First written without a server (locators from the XML), then run and fixed against a local Liberia server: see README.md.
//
// Conditions in the form, from documentation inventory (section-ncd-history.inv.md):
//   when #patient-ever-received-medication yes :225 -> #patient-recently-taken-medication; #obs-patient-recently-taken-medication
//     yes :241 -> #patient-medications (the whole "Patient Medications" fieldset); #visit-to-church-yard-or-traditional-healer yes
//     :257 -> #church-or-traditional-healer-comment; #delivery-within-past-5-years yes :283 -> #mch-concept-set
//   when #tb-persistent-cough / #tb-persistent-wtLoss3kg "yes" :360, :397 -> their -type checkbox divs
//   when #patient-currently-smokes Currently :440 -> #type-of-tobacco-product; #patient-currently-drinks Currently :473 ->
//     #num-type-of-alcohol-product; #type-of-alcohol-product Traditional :485 / Modern :486 -> litres / bottles inputs
//   when #medication-reaction yes :597 -> #medication-side-effect; per medication row {0}-still-taking Yes :565 / No :566 ->
//     {0}-drug-start-date / -stop-date (ids start with a digit: use [id="1-..."])
//   includeIf female 12-49 at the encounter date :272 (delivery questions); female 14-49 :626 (#family-planning)
//   toggle cardiac-murmur-{index} :966, tenderness-quadrant :1034, {nickname}-onset-date :1165 (11 NCD categories);
//     includeIf NCD Initial :1169 renders the onset-date divs only for that type; toggle="other" :1194 has no target (V3)
//   ifMode VIEW include=false :92, :103, :1217  the nextAndSubmitButtons script, the h1 and #buttons
// Scripts: only setUpNextAndSubmitButtons() (see _shared). Not covered: Next, Cancel, the autocomplete drug name, the date widgets
//   other than the NCD onset date, the unit/frequency dropdowns beyond V1. No field is required, so there is no Required test.
// Side effects on save: <enrollInProgram programId="NCD"> :1152 (tested). VIEW: last test (EDIT: the saves reopened in it).
//
// Findings:
//   V1 High :557-559 medication frequency: answerConceptIds ...,PRN,STAT,OTHER but answerCodes ...,STAT,PRN,...: the option
//                    labelled "STAT" saves PRN and "PRN" saves STAT. Fix: swap the two codes. (TESTED, test.fail; confirmed on a server)
//   V2 Low  :405   answerLabels="Clothing is looser" next to the singular answerConceptId is ignored: the checkbox shows the concept name.
//   V3 Low  :1194  toggle="other" matches no id or class; the "Other" NCD category (with its comment field) has no toggled target.
//   V4 Low  :511, :615  duplicate id="other-relevant-history"; :506-514 puts a <tr><td> inside the #num-type-of-alcohol-product span,
//                    so the browser lifts that textarea out of the alcohol block (its visibility is not asserted here).
//   V5 Low  :451-452  label "Shisha" for CIEL:159380, whose concept is "Pipe Tobacco" (PIH OCL export, not a server); :458
//                    style="radio" on the numeric CIEL:1546 is ignored (a number box renders).
//   V6 Low  :35, :74-89  CSS: a missing ";" after `padding` swallows `width`, and the @media block is never closed.
//   Info: the inventory's :1084 "singular list" is a false positive (the concept name contains a comma).

import { type APIRequestContext, type Page } from '@playwright/test';
import { test, expect, birthdateYearsAgo, type SectionEncounter } from '../../core';
import { NCD_FOLLOWUP_ENCOUNTER_TYPE_UUID, NCD_INITIAL_ENCOUNTER_TYPE_UUID } from '../../core/constants';
import { SectionFormPage, expectViewShowsSavedObs } from '../../pages';

const FORM = 'section-ncd-history.xml';
const NCD_CATEGORIES = [
  'htn',
  'type_1_diabetes',
  'type_2_diabetes',
  'heart_failure',
  'sickle',
  'liver_disease',
  'kidney_failure',
  'asthma',
  'copd',
  'chd',
  'rhd',
];

// Radios and dropdown answers inside a wrapper span that has an id. The labels come from answerCodes (pihcore.yes = "yes"), from
// conceptLabels ("yes") or from concept names ("Currently"), so they are matched ignoring case.
const pick = (page: Page, wrapper: string, label: RegExp) => page.locator(wrapper).getByLabel(label).check();
const YES = /^yes$/i;
const NO = /^no$/i;

// The date widgets are read-only jQuery UI datepickers; setDate also updates the hidden field that is submitted.
const setDate = (page: Page, wrapper: string, year: number, monthIndex: number, day: number) =>
  page.evaluate(
    ([w, y, m, d]) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).jq(`${w} input.hasDatepicker`).datepicker('setDate', new Date(y as number, m as number, d as number));
    },
    [wrapper, year, monthIndex, day],
  );

// Answers the two questions that show the "Patient Medications" fieldset (when :225, :241).
const revealMedications = async (page: Page) => {
  await pick(page, '#patient-ever-received-medication', YES);
  await pick(page, '#obs-patient-recently-taken-medication', YES);
  await expect(page.locator('#patient-medications')).toBeVisible();
};

// Every obs display of the encounter, group members included.
const allObsDisplays = async (api: APIRequestContext, encounterUuid: string): Promise<string[]> => {
  const res = await api.get(`encounter/${encounterUuid}?v=custom:(obs:(display,groupMembers:(display)))`);
  expect(res.ok(), `get encounter obs: ${res.status()}`).toBeTruthy();
  const obs = (await res.json()).obs as Array<{ display: string; groupMembers: Array<{ display: string }> | null }>;
  return obs.flatMap((o) => [o.display, ...(o.groupMembers ?? []).map((m) => m.display)]);
};

// The checkbox of "Murmur #<n>" (its label has no id to target: it is the first checkbox of the span around #cardiac-murmur-<n>).
const murmurBox = (page: Page, n: number) =>
  page.locator('span.inline', { has: page.locator(`#cardiac-murmur-${n}`) }).last().locator('input[type="checkbox"]').first();
const tendernessBox = (page: Page) =>
  page.locator('span.inline', { has: page.locator('#tenderness-quadrant') }).first().locator('input[type="checkbox"]').first();

test.describe('section-ncd-history', () => {
  let section: SectionEncounter;

  test.beforeEach(async ({ page, createSectionEncounter }) => {
    section = await createSectionEncounter({
      encounterTypeUuid: NCD_INITIAL_ENCOUNTER_TYPE_UUID,
      patient: { givenName: 'AutoNcdHist', familyName: 'Tester', gender: 'F' }, // F, born 1990: inside both includeIf age ranges
    });
    await SectionFormPage.openEdit(page, FORM, section);
  });

  // when :225, :241, :257, :283, :360, :397, :440, :473, :597
  const whens = [
    { name: 'recent medication question', wrapper: '#patient-ever-received-medication', on: YES, off: NO, target: '#patient-recently-taken-medication' },
    { name: 'church-yard / traditional healer comment', wrapper: '#visit-to-church-yard-or-traditional-healer', on: YES, off: NO, target: '#church-or-traditional-healer-comment' },
    { name: 'delivery details', wrapper: '#delivery-within-past-5-years', on: YES, off: NO, target: '#mch-concept-set' },
    { name: 'cough type', wrapper: '#tb-persistent-cough', on: YES, off: NO, target: '#tb-persistent-cough-type' },
    { name: 'weight-loss type', wrapper: '#tb-persistent-wtLoss3kg', on: YES, off: NO, target: '#tb-persistent-wtLoss3kg-type' },
    { name: 'tobacco product', wrapper: '#patient-currently-smokes', on: /^currently$/i, off: /^never$/i, target: '#type-of-tobacco-product' },
    { name: 'alcohol product', wrapper: '#patient-currently-drinks', on: /^currently$/i, off: /^never$/i, target: '#num-type-of-alcohol-product' },
    { name: 'medication reaction explanation', wrapper: '#medication-reaction', on: YES, off: NO, target: '#medication-side-effect' },
  ];
  for (const w of whens) {
    test(`${w.name} (${w.target}) shows only for the trigger answer`, async ({ page }) => {
      await expect(page.locator(w.target)).toBeHidden();
      await pick(page, w.wrapper, w.on);
      await expect(page.locator(w.target)).toBeVisible();
      await pick(page, w.wrapper, w.off);
      await expect(page.locator(w.target)).toBeHidden();
    });
  }

  test('#patient-medications (the whole fieldset) shows only when "recently taken medication" is yes (:241)', async ({ page }) => {
    await expect(page.locator('#patient-medications')).toBeHidden();
    await pick(page, '#patient-ever-received-medication', YES);
    await expect(page.locator('#patient-medications')).toBeHidden();
    await pick(page, '#obs-patient-recently-taken-medication', YES);
    await expect(page.locator('#patient-medications')).toBeVisible();
    await pick(page, '#obs-patient-recently-taken-medication', NO);
    await expect(page.locator('#patient-medications')).toBeHidden();
  });

  test('the alcohol type shows litres for traditional and bottles for modern alcohol (:485, :486)', async ({ page }) => {
    await pick(page, '#patient-currently-drinks', /^currently$/i);
    await expect(page.locator('#num-of-traditional-litres-per-day')).toBeHidden();
    await expect(page.locator('#num-of-modern-bottles-per-day')).toBeHidden();
    await pick(page, '#type-of-alcohol-product', /traditional/i);
    await expect(page.locator('#num-of-traditional-litres-per-day')).toBeVisible();
    await expect(page.locator('#num-of-modern-bottles-per-day')).toBeHidden();
    await pick(page, '#type-of-alcohol-product', /modern/i);
    await expect(page.locator('#num-of-modern-bottles-per-day')).toBeVisible();
    await expect(page.locator('#num-of-traditional-litres-per-day')).toBeHidden();
  });

  test('a medication row shows its start date for "Yes" and its finish date for "No" still taking (:565, :566)', async ({ page }) => {
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

  // toggle :966, :1034, :1165
  test('the murmur details, the tenderness quadrants and each NCD category onset date show only while ticked', async ({ page }) => {
    for (const n of [1, 2]) {
      await expect(page.locator(`#cardiac-murmur-${n}`), `murmur ${n} starts hidden`).toBeHidden();
      await murmurBox(page, n).check();
      await expect(page.locator(`#cardiac-murmur-${n}`), `murmur ${n} shown`).toBeVisible();
      await murmurBox(page, n).uncheck();
      await expect(page.locator(`#cardiac-murmur-${n}`), `murmur ${n} hidden again`).toBeHidden();
    }
    await expect(page.locator('#tenderness-quadrant')).toBeHidden();
    await tendernessBox(page).check();
    await expect(page.locator('#tenderness-quadrant')).toBeVisible();
    await tendernessBox(page).uncheck();
    await expect(page.locator('#tenderness-quadrant')).toBeHidden();

    for (const nick of NCD_CATEGORIES) {
      const box = page.locator(`#${nick}-onset-q input[type="checkbox"]`);
      await expect(page.locator(`#${nick}-onset-date`), `${nick} starts hidden`).toBeHidden();
      await box.check();
      await expect(page.locator(`#${nick}-onset-date`), `${nick} shown`).toBeVisible();
      await box.uncheck();
      await expect(page.locator(`#${nick}-onset-date`), `${nick} hidden again`).toBeHidden();
    }
  });

  // includeIf :1169: the onset-date divs are rendered only for the NCD Initial type
  test('on an NCD Followup encounter the NCD categories have no onset date', async ({ page, createSectionEncounter }) => {
    const followup = await createSectionEncounter({
      encounterTypeUuid: NCD_FOLLOWUP_ENCOUNTER_TYPE_UUID,
      patient: { givenName: 'AutoNcdHist', familyName: 'Tester', gender: 'F' },
    });
    await SectionFormPage.openEdit(page, FORM, followup);
    await expect(page.locator('#htn-onset-q')).toHaveCount(1);
    await expect(page.locator('#htn-onset-date')).toHaveCount(0);
  });

  // includeIf :272 (female, 12-49 at the encounter date) and :626 (female, 14-49)
  const byPatient = [
    { who: 'a 13-year-old girl', gender: 'F' as const, age: 13, delivery: 1, planning: 0 },
    { who: 'a 14-year-old girl', gender: 'F' as const, age: 14, delivery: 1, planning: 1 },
    { who: 'an 11-year-old girl', gender: 'F' as const, age: 11, delivery: 0, planning: 0 },
    { who: 'a 50-year-old woman', gender: 'F' as const, age: 50, delivery: 0, planning: 0 },
    { who: 'a 40-year-old man', gender: 'M' as const, age: 40, delivery: 0, planning: 0 },
  ];
  for (const p of byPatient) {
    test(`for ${p.who}: delivery questions ${p.delivery ? 'render' : 'do not render'}, family planning ${p.planning ? 'renders' : 'does not render'}`, async ({
      page,
      createSectionEncounter,
    }) => {
      const other = await createSectionEncounter({
        encounterTypeUuid: NCD_INITIAL_ENCOUNTER_TYPE_UUID,
        patient: { givenName: 'AutoNcdHist', familyName: 'Tester', gender: p.gender, birthdate: birthdateYearsAgo(p.age) },
      });
      await SectionFormPage.openEdit(page, FORM, other);
      await expect(page.locator('#delivery-within-past-5-years')).toHaveCount(p.delivery);
      await expect(page.locator('#family-planning')).toHaveCount(p.planning);
    });
  }

  // V1: answerConceptIds ...PRN,STAT... vs answerCodes ...STAT,PRN...
  test.fail('V1: the medication frequency option "STAT" saves STAT', async ({ page, api }) => {
    await revealMedications(page);
    await page.locator('[id="1-frequencyCoded"] select').selectOption({ label: 'STAT' });
    await new SectionFormPage(page, FORM).save();
    await new SectionFormPage(page, FORM).expectSaved();

    const frequency = (await allObsDisplays(api, section.encounter.uuid)).filter((d) => /medication frequency/i.test(d));
    expect(frequency).toHaveLength(1);
    expect(frequency[0]).toMatch(/stat/i); // saves "PRN (as required)" today
  });

  test('saves answers from several blocks, enrolls in the NCD program, and EDIT starts from them', async ({ page, api }) => {
    await page.getByLabel('Scheduled', { exact: true }).check(); // type of visit (answerCodes are plain text here)
    await page.locator('#referral-reason textarea').fill('Chest pain on exertion');
    await revealMedications(page);
    await page.locator('[id="dose-1"] input').fill('500');
    await page.locator('[id="1-still-taking"] select').selectOption({ label: 'Yes' });
    await pick(page, '#tb-persistent-cough', YES);
    await page.locator('#tb-persistent-cough-type input[type="checkbox"]').first().check();
    await pick(page, '#patient-currently-smokes', /^currently$/i);
    await pick(page, '#patient-currently-drinks', /^currently$/i);
    await pick(page, '#type-of-alcohol-product', /modern/i);
    await page.locator('#num-of-modern-bottles-per-day input').fill('2');
    await pick(page, '#money-source-while-sick', YES);
    await page.locator('#transportation-cost input').fill('5');
    await page.locator('#other-social-history textarea').fill('Lives with two relatives');
    await page.locator('#htn-onset-q input[type="checkbox"]').check();
    await setDate(page, '#htn-onset-date', 2024, 2, 15);
    await page.locator('#reason-for-visit textarea').fill('Raised BP at a screening');
    await page.locator('textarea').last().fill('Counselled on diet');

    const form = new SectionFormPage(page, FORM);
    await form.save();
    await form.expectSaved();

    const displays = (await allObsDisplays(api, section.encounter.uuid)).map((d) => d.toLowerCase());
    for (const expected of ['scheduled', 'chest pain on exertion', '500', 'hypertension', '2024', 'raised bp at a screening', 'counselled on diet']) {
      expect(
        displays.some((d) => d.includes(expected)),
        `an obs shows "${expected}"`,
      ).toBeTruthy();
    }

    // <enrollInProgram programId="NCD"> at :1152
    const res = await api.get(`programenrollment?patient=${section.patient.uuid}&v=custom:(program:(name))`);
    expect(res.ok()).toBeTruthy();
    const enrollments = (await res.json()).results as Array<{ program: { name: string } }>;
    expect(enrollments.some((e) => /ncd/i.test(e.program.name))).toBeTruthy();

    // EDIT: the when/toggle targets start from the saved values, the unanswered ones stay hidden
    await SectionFormPage.openEdit(page, FORM, section);
    await expect(page.locator('#patient-recently-taken-medication')).toBeVisible();
    await expect(page.locator('#patient-medications')).toBeVisible();
    await expect(page.locator('#tb-persistent-cough-type')).toBeVisible();
    await expect(page.locator('#num-of-modern-bottles-per-day')).toBeVisible();
    await expect(page.locator('#num-of-traditional-litres-per-day')).toBeHidden();
    await expect(page.locator('#htn-onset-date')).toBeVisible();
    await expect(page.locator('#church-or-traditional-healer-comment')).toBeHidden();
    await expect(page.locator('#type_2_diabetes-onset-date')).toBeHidden();
  });

  test('an answer typed under a trigger and then hidden by changing the trigger is not saved (when :257)', async ({ page, api }) => {
    await pick(page, '#visit-to-church-yard-or-traditional-healer', YES);
    await page.locator('#church-or-traditional-healer-comment textarea').fill('Herbal bath');
    await pick(page, '#visit-to-church-yard-or-traditional-healer', NO);
    await expect(page.locator('#church-or-traditional-healer-comment')).toBeHidden();
    await page.locator('textarea').last().fill('Only note'); // something to save

    const form = new SectionFormPage(page, FORM);
    await form.save();
    await form.expectSaved();

    const displays = (await allObsDisplays(api, section.encounter.uuid)).map((d) => d.toLowerCase());
    expect(displays.some((d) => d.includes('herbal bath'))).toBeFalsy();
    expect(displays.some((d) => d.includes('only note'))).toBeTruthy();
  });

  // VIEW: ifMode VIEW include=false :103 (h1) and :1217 (#buttons) are absent; the saved values are shown; what was not answered is not
  test('VIEW: shows the saved answers, the onset date and the exam finding, and nothing for what was not answered', async ({ page, api }) => {
    await page.getByLabel('Scheduled', { exact: true }).check();
    await page.locator('#referral-reason textarea').fill('Chest pain on exertion');
    await revealMedications(page);
    await page.locator('[id="dose-1"] input').fill('500');
    await page.locator('[id="1-still-taking"] select').selectOption({ label: 'Yes' });
    await pick(page, '#patient-currently-smokes', /^currently$/i);
    await pick(page, '#money-source-while-sick', YES);
    await page.locator('#transportation-cost input').fill('5');
    await page.locator('#physical-exams tbody tr').first().locator('input[type="checkbox"]').first().check(); // General, first "normal" finding
    await page.locator('#htn-onset-q input[type="checkbox"]').check();
    await setDate(page, '#htn-onset-date', 2024, 2, 15);
    await page.locator('#reason-for-visit textarea').fill('Raised BP at a screening');
    await page.locator('textarea').last().fill('Counselled on diet');

    const form = new SectionFormPage(page, FORM);
    await form.save();
    await form.expectSaved();

    const view = await expectViewShowsSavedObs(page, api, FORM, section.encounter.uuid, {
      'Reason for visit: Scheduled visit': '[X] Scheduled', // answerCodes label
    });
    const v = view.page;
    await expect(v.locator('#referral-reason .value')).toHaveText('Chest pain on exertion');
    await expect(v.locator('#patient-currently-smokes .value')).toHaveText(/\[X\]\s*currently/i);
    await expect(v.locator('#htn-onset-q .value')).toHaveText(/\[X\]\s*hypertension/i);
    await expect(v.locator('#htn-onset-date .value')).toHaveText('15 Mar 2024');
    await expect(v.locator('[id$="-onset-q"] .value')).toHaveCount(1); // only hypertension was ticked
    await expect(v.locator('#reason-for-visit .value')).toHaveText('Raised BP at a screening');
    await expect(v.locator('#tb-persistent-cough-type .value')).toHaveCount(0); // not answered
    await expect(v.locator('#church-or-traditional-healer-comment .value')).toHaveCount(0);
    await expect(v.locator('#buttons')).toHaveCount(0); // ifMode VIEW include=false :1217
    await expect(v.locator('h1')).toHaveCount(0); // :103
  });
});

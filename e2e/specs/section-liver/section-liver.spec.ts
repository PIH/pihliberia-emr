import { type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { test, expect, type SectionEncounter } from '../../core';
import { NCD_FOLLOWUP_ENCOUNTER_TYPE_UUID, NCD_INITIAL_ENCOUNTER_TYPE_UUID } from '../../core/constants';
import { getEncounterObs } from '../../commands';
import { SectionFormPage, ViewFormPage, expectViewShowsSavedObs } from '../../pages';

// section-liver.xml ("Liver Disease"): NCD Initial only: liver diagnoses ("Visit Diagnoses" groups), complications text and
// treatment date; always: Hepatitis B treatment (Yes shows two dates); then signs and symptoms and exam (yes/no/unknown radios,
// one PIH:14875 group each), pain scale, other findings and risk assessment (PIH:14827 group). On the visit page it is the
// `pihcore-liver` section of NCD Initial and NCD Followup 2.0 (documentation/_availability.e2e.md); the specs open its edit URL
// directly on an NCD Initial or NCD Followup encounter. First written without a server (locators from the XML), then run and fixed against a local Liberia server: see README.md.
//
// Conditions in the form, from documentation inventory (section-liver.inv.md):
//   ifMode VIEW include=false :82, :299   heading + script, and #buttonsTopRow + #buttons in ENTER/EDIT only
//   includeIf encounterType == NCD Initial (ae06d311)  :102   diagnoses, complications text, treatment date (Initial vs Followup, tested)
//   when PIH:14889 = PIH:1065 (Yes)  :160   shows #hepbtreatment-section (start and finish date); hiding clears them (tested)
// Scripts: :87 setUpNextAndSubmitButtons() (see _shared.e2e.md). No validation, default or derived value. No required field.
// Side effects on save: postSubmissionAction CleanDiagnosisConstructAction (:19): each "Visit Diagnoses" group with a coded
//   diagnosis gets a "Diagnosis order: Secondary" member (tested).
// VIEW (the visit page, which fetches getAsHtml.action for this section): showIfEmpty=false hides every group that was not saved; the heading and button rows are absent.
//   HFE emits no `when` script in VIEW, so :164 `style="display:none"` stays (VW1).
// Not covered here: the #pihcore-<section> jump buttons of #buttonsTopRow and #next (need the visit page; _shared.e2e.md :56
//   says no Liberia form has `.nextSection`, but the six NCD disease sections do).
//
// Findings:
//   V1 High   :240  "Ascites" is CIEL:460, which is Edema/Oedema (Ascites is CIEL:148346 / PIH:581) -> saves "Symptom present: Edema".
//                   Fix: CIEL:148346. (TESTED, test.fail)
//   V2 Medium :211  "Dyspnea" is CIEL:141599 = Dyspnea on exertion (Dyspnea is CIEL:122496, as the palliative form uses). Fix:
//                   CIEL:122496. (TESTED, test.fail)
//   V3 Medium :212  "Nausea/Anorexia" is PIH:NAUSEA = Nausea: anorexia cannot be recorded (Anorexia is PIH:868). Fix: a row each.
//   VW1 Medium :164 #hepbtreatment-section is `display:none` inline and only the `when` script (not run in VIEW) shows it: the
//                   saved Hepatitis B start and finish dates are invisible in VIEW. Fix: drop the inline style (the script
//                   hides it on load). (TESTED, test.fail)
//   V4 Low    :278-291  a repeat with a template and no render: dead markup. :165, :171 `class="block;"`.
//   V5 Low    :97-98, :190-191  `cld-section` and `cirrhosis` are used for both sections (duplicate ids).
//   V6 Low    :118-120  Hypertension and Diabetes are the same "Visit Diagnoses" groups the kidney, heart-failure and diabetes
//                   forms write (see section-kidney V4; unconfirmed: not run).

const FORM = 'section-liver.xml';

const saveForm = async (page: Page) => {
  const form = new SectionFormPage(page, FORM);
  await form.save();
  await form.expectSaved();
};

const obsDisplays = async (api: APIRequestContext, encounterUuid: string): Promise<string[]> => {
  return (await getEncounterObs(api, encounterUuid)).map((o) => o.display);
};

// A symptom/exam row (`<p class="list-inline">`) or a risk row (`<p class="list-inline-wide">`) starts with its question text.
const symptom = (page: Page, name: string) =>
  page.locator('p.list-inline').filter({ hasText: new RegExp(`^\\s*${name}`) });
const risk = (page: Page, name: string) =>
  page.locator('p.list-inline-wide').filter({ hasText: new RegExp(`^\\s*${name}`) });
const answer = (r: Locator, label: 'yes' | 'no' | 'unknown') => r.getByLabel(new RegExp(`^${label}$`, 'i'));

const hepB = (page: Page, label: 'Yes' | 'No') => page.locator('#hepbtreatment-radio').getByLabel(label, { exact: true });
const hepBDates = (page: Page) => page.locator('#hepbtreatment-section input[type=text]');

// Date inputs are read-only datepickers: set the date as the picker does, then fire the hidden input's change.
const pickDate = async (input: Locator, isoDate: string) => {
  await input.evaluate((el, iso) => {
    const j = (window as unknown as { jq: (e: unknown) => { datepicker: (...a: unknown[]) => void; trigger: (n: string) => void } }).jq;
    j(el).datepicker('setDate', new Date(`${iso}T12:00:00`));
    j(el).trigger('change');
  }, isoDate);
  await input.locator('xpath=following-sibling::input[@type="hidden"]').evaluate((el) => {
    (window as unknown as { jq: (e: unknown) => { trigger: (n: string) => void } }).jq(el).trigger('change');
  });
};

// VIEW labels for obs the form shows differently from their concept names (obs display -> text shown).
const viewLabels = async (api: APIRequestContext, encounterUuid: string): Promise<Record<string, string>> => {
  const rules: Array<[RegExp, string]> = [
    [/^Diagnosis order:/i, ''], // added by the postSubmissionAction, not a form field
    [/^Diagnosis: Cirrhosis of liver/i, '[X] Cirrhosis'],
    [/^Symptom present:/i, '[X] yes'],
    [/^Symptom absent:/i, '[X] no'],
    [/^Symptom presence unknown:/i, '[X] unknown'],
    [/: Yes$/i, '[X] yes'],
    [/: No$/i, '[X] no'],
  ];
  const labels: Record<string, string> = {};
  for (const o of await getEncounterObs(api, encounterUuid)) {
    const rule = rules.find(([re]) => re.test(o.display));
    if (rule) {
      labels[o.display] = rule[1];
    }
  }
  return labels;
};

test.describe('section-liver', () => {
  let section: SectionEncounter;

  test.beforeEach(async ({ page, createSectionEncounter }) => {
    section = await createSectionEncounter({
      encounterTypeUuid: NCD_INITIAL_ENCOUNTER_TYPE_UUID,
      patient: { givenName: 'AutoLiv', familyName: 'Tester', gender: 'F' },
    });
    await SectionFormPage.openEdit(page, FORM, section);
  });

  test('NCD Initial shows the liver diagnoses, the complications text and the treatment date', async ({ page }) => {
    // includeIf :102, state "NCD Initial"
    for (const label of ['Cirrhosis', 'Hypertension', 'Diabetes']) {
      await expect(page.locator('.checkbox-group').getByLabel(label, { exact: true })).toBeVisible();
    }
    await expect(page.locator('.checkbox-group textarea')).toBeVisible();
    await expect(page.locator('.form-row').filter({ hasText: 'Date Liver treatment started' })).toBeVisible();
    await expect(hepB(page, 'Yes')).toBeVisible();
  });

  test('NCD Followup shows neither the diagnoses nor the treatment date, but Hepatitis B, symptoms and risks', async ({
    page,
    createSectionEncounter,
  }) => {
    // includeIf :102, state "not NCD Initial"
    const followup = await createSectionEncounter({
      encounterTypeUuid: NCD_FOLLOWUP_ENCOUNTER_TYPE_UUID,
      patient: { givenName: 'AutoLiv', familyName: 'Tester', gender: 'F' },
    });
    await SectionFormPage.openEdit(page, FORM, followup);
    await expect(page.locator('.checkbox-group')).toHaveCount(0);
    await expect(page.locator('.form-row')).toHaveCount(0);
    await expect(hepB(page, 'Yes')).toBeVisible();
    await expect(symptom(page, 'Jaundice')).toBeVisible();
    await expect(risk(page, 'NSAID use')).toBeVisible();
  });

  test('the Hepatitis B dates show only for Yes, and hiding them clears what was typed', async ({ page }) => {
    // when :160
    const datesSection = page.locator('#hepbtreatment-section');
    await expect(datesSection).toBeHidden();
    await hepB(page, 'Yes').check();
    await expect(datesSection).toBeVisible();
    await expect(hepBDates(page)).toHaveCount(2); // Date Started, Date Finished
    await pickDate(hepBDates(page).nth(0), '2024-03-15');
    await expect(hepBDates(page).nth(0)).not.toHaveValue('');
    await hepB(page, 'No').check();
    await expect(datesSection).toBeHidden();
    await hepB(page, 'Yes').check();
    await expect(datesSection).toBeVisible();
    await expect(hepBDates(page).nth(0)).toHaveValue(''); // the `when` script cleared it when it hid the section
  });

  test('saves a blank form and records nothing', async ({ page, api }) => {
    await saveForm(page);
    expect(await obsDisplays(api, section.encounter.uuid)).toEqual([]);
  });

  test('a symptom has yes, no and unknown and takes one at a time', async ({ page }) => {
    const jaundice = symptom(page, 'Jaundice');
    await expect(jaundice.getByRole('radio')).toHaveCount(3);
    await answer(jaundice, 'yes').check();
    await answer(jaundice, 'no').check();
    await expect(answer(jaundice, 'yes')).not.toBeChecked();
    await expect(answer(jaundice, 'no')).toBeChecked();
  });

  test('saves diagnoses, Hepatitis B treatment, symptoms, pain, findings and risks, and EDIT shows them again', async ({ page, api }) => {
    const checkboxes = page.locator('.checkbox-group');
    await checkboxes.getByLabel('Cirrhosis', { exact: true }).check();
    await checkboxes.getByLabel('Diabetes', { exact: true }).check();
    await checkboxes.locator('textarea').fill('Autoimmune hepatitis');
    await pickDate(page.locator('.form-row').filter({ hasText: 'Date Liver treatment started' }).locator('input[type=text]').first(), '2024-03-15');
    await hepB(page, 'Yes').check();
    await pickDate(hepBDates(page).nth(0), '2024-03-20');
    await pickDate(hepBDates(page).nth(1), '2024-04-20');
    await answer(symptom(page, 'Confusion'), 'yes').check();
    await answer(symptom(page, 'Pruritus'), 'no').check();
    await answer(symptom(page, 'Jaundice'), 'yes').check();
    await page.locator('.first-label-inline input[type=text]').fill('4');
    await page.locator('.two-columns-new textarea').fill('Mild jaundice');
    await answer(risk(page, 'US screening'), 'yes').check();
    await answer(risk(page, 'Alcohol use'), 'no').check();
    await saveForm(page);

    const displays = await obsDisplays(api, section.encounter.uuid);
    expect(displays.some((d) => /^Diagnosis: Cirrhosis of liver/i.test(d))).toBeTruthy();
    expect(displays.some((d) => /^Diagnosis: Diabetes/i.test(d))).toBeTruthy();
    // postSubmissionAction :19
    expect(displays.filter((d) => /^Diagnosis order:/i.test(d))).toHaveLength(2);
    expect(displays.some((d) => /Autoimmune hepatitis/.test(d))).toBeTruthy();
    expect(displays.some((d) => /^Treatment for Hepatitis B \(coded\): Yes/i.test(d))).toBeTruthy();
    expect(displays.some((d) => /^Symptom present: Confusion/i.test(d))).toBeTruthy();
    expect(displays.some((d) => /^Symptom absent: Pruritus/i.test(d))).toBeTruthy();
    expect(displays.some((d) => /^Symptom present: Jaundice/i.test(d))).toBeTruthy();
    expect(displays.some((d) => /^Pain scale: 4/i.test(d))).toBeTruthy();
    expect(displays.some((d) => /Mild jaundice/.test(d))).toBeTruthy();
    expect(displays.some((d) => /^Ultrasound, hepatic: Yes/i.test(d))).toBeTruthy();
    expect(displays.some((d) => /^History of alcohol use: No/i.test(d))).toBeTruthy();
    const obs = await getEncounterObs(api, section.encounter.uuid);
    expect(String(obs.find((o) => o.concept.display === 'Treatment start date')?.value)).toMatch(/^2024-03-20/);
    expect(String(obs.find((o) => o.concept.display === 'Treatment end date')?.value)).toMatch(/^2024-04-20/);

    // when :160 in EDIT starts from the saved answer: the dates are shown again
    await SectionFormPage.openEdit(page, FORM, section);
    await expect(hepB(page, 'Yes')).toBeChecked();
    await expect(page.locator('#hepbtreatment-section')).toBeVisible();
    await expect(answer(symptom(page, 'Jaundice'), 'yes')).toBeChecked();
    await expect(page.locator('.first-label-inline input[type=text]')).toHaveValue('4');
    await expect(page.locator('.two-columns-new textarea')).toHaveValue('Mild jaundice');

    // VIEW: radios show the form's own words; unsaved symptom groups are not rendered at all (showIfEmpty=false)
    const view = await expectViewShowsSavedObs(page, api, FORM, section.encounter.uuid, await viewLabels(api, section.encounter.uuid));
    expect(await view.valueTexts()).toEqual(
      expect.arrayContaining(['[X] Cirrhosis', '[X] Diabetes', 'Autoimmune hepatitis', '[X] yes', '[X] no', 'Mild jaundice']),
    );
    expect((await view.valueTexts()).some((t) => /^4(\.0)?$/.test(t))).toBeTruthy(); // pain scale
    expect(await view.valueTexts()).not.toContain('[X] Hypertension');
    await expect(view.root).not.toContainText('Asterixis');
    // ifMode VIEW include=false (:82, :299): no heading, no button rows
    await expect(view.root.locator('h1, #buttonsTopRow, #buttons, #submit, #next, #cancel')).toHaveCount(0);
  });

  test('VIEW: an encounter nothing was saved on shows no value', async ({ page }) => {
    const view = await ViewFormPage.open(page, FORM, section.encounter.uuid);
    await expect(view.values).toHaveCount(0);
  });

  // VW1: the saved Hepatitis B dates are visible in VIEW (confirmed on the visit page, see below). :164 hides the section inline and the `when`
  // script that would show it is not emitted in VIEW (ObsTagHandler.doEndTag).
  // Confirmed with test.fail on the visit page: #hepbtreatment-section stays hidden (toBeVisible, received hidden); remove test.fixme() when fixed.
  test.fixme('VW1: VIEW shows the saved Hepatitis B start and finish dates', async ({ page, api }) => {
    await hepB(page, 'Yes').check();
    await pickDate(hepBDates(page).nth(0), '2024-03-20');
    await pickDate(hepBDates(page).nth(1), '2024-04-20');
    await saveForm(page);
    const view = await ViewFormPage.open(page, FORM, section.encounter.uuid);
    await expect(view.root.locator('#hepbtreatment-section')).toBeVisible();
    await expect(view.root.locator('#hepbtreatment-section')).toContainText(/20 Mar(ch)? 2024|20\/03\/2024/);
    expect(await getEncounterObs(api, section.encounter.uuid)).not.toEqual([]);
  });

  // V1: the Ascites row must record Ascites (unconfirmed: not run). CIEL:460 is Edema.
  test('V1: the "Ascites" finding is saved as Ascites, not Edema', async ({ page, api }) => {
    test.fail();
    await answer(symptom(page, 'Ascites'), 'yes').check();
    await saveForm(page);
    const displays = await obsDisplays(api, section.encounter.uuid);
    expect(displays.some((d) => /^Symptom present: /i.test(d))).toBeTruthy();
    expect(displays.some((d) => /^Symptom present: Ascites/i.test(d))).toBeTruthy();
  });

  // V2: the Dyspnea row must record Dyspnea (unconfirmed: not run). CIEL:141599 is Dyspnea on exertion.
  test('V2: the "Dyspnea" symptom is saved as Dyspnea, not Dyspnea on exertion', async ({ page, api }) => {
    test.fail();
    await answer(symptom(page, 'Dyspnea'), 'yes').check();
    await saveForm(page);
    const displays = await obsDisplays(api, section.encounter.uuid);
    expect(displays.some((d) => /^Symptom present: /i.test(d))).toBeTruthy();
    expect(displays.some((d) => /^Symptom present: Dyspnea$/i.test(d))).toBeTruthy();
  });
});

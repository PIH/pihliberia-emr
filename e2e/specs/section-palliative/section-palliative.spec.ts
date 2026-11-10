import { type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { test, expect, type SectionEncounter } from '../../core';
import { NCD_FOLLOWUP_ENCOUNTER_TYPE_UUID, NCD_INITIAL_ENCOUNTER_TYPE_UUID } from '../../core/constants';
import { getEncounterObs } from '../../commands';
import { SectionFormPage, ViewFormPage, expectViewShowsSavedObs } from '../../pages';

// section-palliative.xml ("Palliative Care"): NCD Initial only: the diseases that need palliative care (non-tumoral, tumoral, Other);
// then follow-up indicators (counselling, awareness and treatment, disease control: yes/no/unknown radios in one PIH:14817 group),
// seven symptoms with progression and management (a PIH:14859 group each), ECOG performance status, hospitalization with reasons
// (PIH:21744 group) and comments. On the visit page it is the `pihcore-palliative` section of NCD Initial and NCD Followup 2.0
// (documentation/_availability.e2e.md); the specs open its edit URL directly on an NCD Initial or NCD Followup encounter.
// First written without a server (locators from the XML), then run and fixed against a local Liberia server: see README.md.
//
// Conditions in the form, from documentation inventory (section-palliative.inv.md):
//   ifMode VIEW include=false :48, :239, :315  script, the ECOG legend table, and #buttonsTopRow + #buttons in ENTER/EDIT only
//   includeIf encounterType == NCD Initial (ae06d311)  :63   the disease checkboxes (Initial vs Followup, tested)
//   when #pall-fui-<tog> = Yes  :141, :178   shows #pall-fui-<tog>-details: only #pall-fui-missed-details (:154) exists (V1); the
//                                            "# of missed doses" input shows for Yes and is cleared when hidden (tested)
//   toggle CIEL:1728 checkboxes :196         tick shows the progression/management row #<symptom>-details; untick clears it
//   when #palliative-hosp = Yes  :281        shows #hosp-pall-reason (reasons + Other)
// Scripts: :49 setUpNextAndSubmitButtons() (see _shared.e2e.md). No validation, default or derived value. No required field.
// Side effects on save: postSubmissionAction CleanDiagnosisConstructAction (:19): no Visit Diagnoses group here, so none.
// VIEW (the visit page, which fetches getAsHtml.action for this section): showIfEmpty=false hides every group that was not saved (the unticked symptoms), checkboxes are
//   `[X] <label>`, radios `[X] yes|no|...`; heading-less; the ECOG table and the button rows are absent.
// Not covered here: the #pihcore-<section> jump buttons of #buttonsTopRow and #next (need the visit page; _shared.e2e.md :56
//   says no Liberia form has `.nextSection`, but the six NCD disease sections do); the tumoral "Other" comment.
//
// Findings:
//   V1 Low :141, :178  five of the six `when`s (understand, titrate, adher, aware, improved) point at `#pall-fui-<tog>-details`
//                      ids that exist nowhere: Yes shows nothing. Fix: drop them.
//   V2 Low :293-296    `symptName` is not used in the hospitalization reasons: they are labelled by concept name, so PIH:7103 reads
//                      "Chronic intractable pain", not "Uncontrolled pain".
//   V3 Low :98         "Hematology cancer" is PIH:14771, retired in the PIH 1.8.46 dictionary (unconfirmed: not run).
//   V4 Low :132-145, :169-182  a `<p>` inside a `<p>` (invalid HTML: the browser closes the outer one).

const FORM = 'section-palliative.xml';

const saveForm = async (page: Page) => {
  const form = new SectionFormPage(page, FORM);
  await form.save();
  await form.expectSaved();
};

const obsDisplays = async (api: APIRequestContext, encounterUuid: string): Promise<string[]> => {
  return (await getEncounterObs(api, encounterUuid)).map((o) => o.display);
};

// A follow-up row (`<p class="list-inline">` / `list-inline-wide`) starts with its question text.
const row = (page: Page, question: string) =>
  page.locator('p.list-inline, p.list-inline-wide').filter({ hasText: new RegExp(`^\\s*${question}`) });
const yes = (r: Locator) => r.getByLabel(/^yes$/i);
const no = (r: Locator) => r.getByLabel(/^no$/i);
// A symptom (Pain, Nausea, Constipation, Insomnia, Weakness, Jaundice, Dyspnea): its checkbox td and its details row.
const symptomBox = (page: Page, name: string) => page.locator(`#${name}-symp input[type=checkbox]`);
const symptomDetails = (page: Page, name: string) => page.locator(`#${name}-details`);

const reasons = (page: Page) => page.locator('#hosp-pall-reason');

test.describe('section-palliative', () => {
  let section: SectionEncounter;

  test.beforeEach(async ({ page, createSectionEncounter }) => {
    section = await createSectionEncounter({
      encounterTypeUuid: NCD_INITIAL_ENCOUNTER_TYPE_UUID,
      patient: { givenName: 'AutoPal', familyName: 'Tester', gender: 'F' },
    });
    await SectionFormPage.openEdit(page, FORM, section);
  });

  test('NCD Initial shows the diseases that need palliative care', async ({ page }) => {
    // includeIf :63, state "NCD Initial"
    for (const label of ['Chronic kidney disease', 'Hepatocarcinoma', 'Prostate cancer', 'Breast cancer', 'Lung cancer', 'Hematology cancer']) {
      await expect(page.getByLabel(label, { exact: true })).toBeVisible();
    }
    await expect(row(page, 'Understands treatment')).toBeVisible();
  });

  test('NCD Followup shows no disease checkboxes, but the indicators, symptoms and ECOG', async ({ page, createSectionEncounter }) => {
    // includeIf :63, state "not NCD Initial"
    const followup = await createSectionEncounter({
      encounterTypeUuid: NCD_FOLLOWUP_ENCOUNTER_TYPE_UUID,
      patient: { givenName: 'AutoPal', familyName: 'Tester', gender: 'F' },
    });
    await SectionFormPage.openEdit(page, FORM, followup);
    await expect(page.getByLabel('Breast cancer', { exact: true })).toHaveCount(0);
    await expect(page.getByLabel('Chronic kidney disease', { exact: true })).toHaveCount(0);
    await expect(row(page, 'Understands treatment')).toBeVisible();
    await expect(symptomBox(page, 'Pain')).toBeVisible();
    await expect(page.getByLabel('2', { exact: true })).toBeVisible();
  });

  test('"# of missed doses" shows for Yes only and is cleared when hidden', async ({ page }) => {
    // when :141 (the one that has a target)
    const details = page.locator('#pall-fui-missed-details');
    const missed = page.locator('#pall-fui-missed');
    await expect(details).toBeHidden();
    await yes(missed).check();
    await expect(details).toBeVisible();
    await details.locator('input[type=text]').fill('3');
    await no(missed).check();
    await expect(details).toBeHidden();
    await yes(missed).check();
    await expect(details.locator('input[type=text]')).toHaveValue('');
  });

  test('a symptom shows its progression and management only while ticked, and unticking clears them', async ({ page }) => {
    // toggle :196 (hide style), state per symptom
    await expect(symptomDetails(page, 'Pain')).toBeHidden();
    await symptomBox(page, 'Pain').check();
    await expect(symptomDetails(page, 'Pain')).toBeVisible();
    await page.locator('#Pain-details').getByLabel('worse', { exact: true }).check();
    await page.locator('#Pain-details').getByLabel('controlled', { exact: true }).check();
    await symptomBox(page, 'Pain').uncheck();
    await expect(symptomDetails(page, 'Pain')).toBeHidden();
    await symptomBox(page, 'Pain').check();
    await expect(page.locator('#Pain-details').getByLabel('worse', { exact: true })).not.toBeChecked();
    await expect(symptomDetails(page, 'Nausea')).toBeHidden(); // the others are not affected
  });

  test('the hospitalization reasons show for Yes only', async ({ page }) => {
    // when :281
    const hosp = page.locator('#palliative-hosp');
    await expect(reasons(page)).toBeHidden();
    await hosp.getByLabel(/^yes$/i).check();
    await expect(reasons(page)).toBeVisible();
    await expect(reasons(page).getByLabel('Diarrhea', { exact: true })).toBeVisible();
    await expect(reasons(page).getByLabel('Vomiting', { exact: true })).toBeVisible();
    await expect(reasons(page).locator('input[type=text]')).toHaveCount(1); // the "if other, specify" comment of Other
    await hosp.getByLabel(/^no$/i).check();
    await expect(reasons(page)).toBeHidden();
  });

  test('ECOG offers 0 to 5, takes one, and the legend table is shown in EDIT', async ({ page }) => {
    // ifMode :239 in EDIT
    for (const score of ['0', '1', '2', '3', '4', '5']) {
      await expect(page.getByLabel(score, { exact: true })).toHaveCount(1);
    }
    await page.getByLabel('1', { exact: true }).check();
    await page.getByLabel('4', { exact: true }).check();
    await expect(page.getByLabel('1', { exact: true })).not.toBeChecked();
    await expect(page.locator('table[align=left]')).toHaveCount(1);
  });

  test('saves a blank form and records nothing', async ({ page, api }) => {
    await saveForm(page);
    expect(await obsDisplays(api, section.encounter.uuid)).toEqual([]);
  });

  test('saves diseases, indicators, a symptom, ECOG and a hospitalization, and EDIT shows them again', async ({ page, api }) => {
    await page.getByLabel('Chronic kidney disease', { exact: true }).check();
    await page.getByLabel('Breast cancer', { exact: true }).check();
    await yes(row(page, 'Counselling done')).check();
    await yes(row(page, 'Understands treatment')).check();
    await yes(page.locator('#pall-fui-missed')).check();
    await page.locator('#pall-fui-missed-details input[type=text]').fill('3');
    await symptomBox(page, 'Pain').check();
    await page.locator('#Pain-details').getByLabel('worse', { exact: true }).check();
    await page.locator('#Pain-details').getByLabel('controlled', { exact: true }).check();
    await page.getByLabel('2', { exact: true }).check(); // ECOG
    await page.locator('#palliative-hosp').getByLabel(/^yes$/i).check();
    await reasons(page).getByLabel('Diarrhea', { exact: true }).check();
    await page.locator('textarea').fill('Needs admission');
    await saveForm(page);

    const displays = await obsDisplays(api, section.encounter.uuid);
    expect(displays.some((d) => /^Disease requiring palliative care treatment: Chronic kidney disease/i.test(d))).toBeTruthy();
    expect(displays.some((d) => /^Disease requiring palliative care treatment: Malignant neoplasm of breast/i.test(d))).toBeTruthy();
    expect(displays.some((d) => /^Counseling status: Completed/i.test(d))).toBeTruthy();
    expect(displays.some((d) => /^Patient understands their treatment: Yes/i.test(d))).toBeTruthy();
    expect(displays.some((d) => /^Missed medication doses in past seven days: Yes/i.test(d))).toBeTruthy();
    expect(displays.some((d) => /^Number of missed medication doses in past 7 days: 3/i.test(d))).toBeTruthy();
    expect(displays.some((d) => /^Sign\/Symptom name: Pain/i.test(d))).toBeTruthy();
    expect(displays.some((d) => /^Symptom progression: Worse/i.test(d))).toBeTruthy();
    expect(displays.some((d) => /^Symptom management: Controlled/i.test(d))).toBeTruthy();
    expect(displays.some((d) => /^ECOG Performance Status: 2/i.test(d))).toBeTruthy();
    expect(displays.some((d) => /^Patient referred to hospital: Yes/i.test(d))).toBeTruthy();
    expect(displays.some((d) => /^Reasons for referral \(coded\): Diarrhea/i.test(d))).toBeTruthy();
    expect(displays.some((d) => /Needs admission/.test(d))).toBeTruthy();

    // when / toggle in EDIT start from the saved values
    await SectionFormPage.openEdit(page, FORM, section);
    await expect(page.getByLabel('Breast cancer', { exact: true })).toBeChecked();
    await expect(page.getByLabel('Lung cancer', { exact: true })).not.toBeChecked();
    await expect(page.locator('#pall-fui-missed-details')).toBeVisible();
    await expect(page.locator('#pall-fui-missed-details input[type=text]')).toHaveValue('3');
    await expect(symptomBox(page, 'Pain')).toBeChecked();
    await expect(symptomDetails(page, 'Pain')).toBeVisible();
    await expect(page.locator('#Pain-details').getByLabel('worse', { exact: true })).toBeChecked();
    await expect(symptomDetails(page, 'Nausea')).toBeHidden();
    await expect(reasons(page)).toBeVisible();
    await expect(reasons(page).getByLabel('Diarrhea', { exact: true })).toBeChecked();
    await expect(page.locator('textarea')).toHaveValue('Needs admission');

    // VIEW: radios show the form's own words; the unticked symptoms are not rendered at all (showIfEmpty=false)
    const labels: Record<string, string> = {};
    const rules: Array<[RegExp, string]> = [
      [/^Disease requiring palliative care treatment: Malignant neoplasm of breast/i, '[X] Breast cancer'],
      [/^Counseling status:/i, '[X] yes'],
      [/^Symptom progression: Worse/i, '[X] worse'],
      [/^Symptom management: Controlled/i, '[X] controlled'],
      [/^ECOG Performance Status:/i, '2'],
      [/: Yes$/i, '[X] yes'],
      [/: No$/i, '[X] no'],
    ];
    for (const o of await getEncounterObs(api, section.encounter.uuid)) {
      const rule = rules.find(([re]) => re.test(o.display));
      if (rule) {
        labels[o.display] = rule[1];
      }
    }
    const view = await expectViewShowsSavedObs(page, api, FORM, section.encounter.uuid, labels);
    expect(await view.valueTexts()).toEqual(
      expect.arrayContaining([
        '[X] Chronic kidney disease', '[X] Breast cancer', '[X] yes', '[X] Pain', '[X] worse', '[X] controlled', '[X] Diarrhea', 'Needs admission',
      ]),
    );
    expect(await view.valueTexts()).not.toContain('[X] Lung cancer');
    await expect(view.root.locator('#Pain-symp .value')).toHaveText('[X] Pain');
    await expect(view.root.locator('#Nausea-symp')).toHaveCount(0);
    await expect(view.root.locator('#hosp-pall-reason .value')).toHaveText(['[X] Diarrhea']);
    // ifMode VIEW include=false (:239, :315): no ECOG legend, no button rows
    await expect(view.root.locator('table[align=left]')).toHaveCount(0);
    await expect(view.root.locator('#buttonsTopRow, #buttons, #submit, #next, #cancel')).toHaveCount(0);
  });

  test('VIEW: an encounter nothing was saved on shows no value', async ({ page }) => {
    const view = await ViewFormPage.open(page, FORM, section.encounter.uuid);
    await expect(view.values).toHaveCount(0);
  });
});

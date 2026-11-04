import { type Page } from '@playwright/test';
import { test, expect, type SectionEncounter } from '../../core';
import { NCD_FOLLOWUP_ENCOUNTER_TYPE_UUID, NCD_INITIAL_ENCOUNTER_TYPE_UUID } from '../../core/constants';
import { getEncounterObs } from '../../commands';
import { SectionFormPage, expectViewShowsSavedObs } from '../../pages';

// section-hospital.xml ("NCD hospitalization"): hospitalizations since the last visit (NCD Followup) or in the previous 12 months (NCD
// Initial): counts, the NCD diagnoses that caused them, diagnosis and treatment at discharge per NCD, and the outcome. On the visit page
// it is the `pihcore-hospital` section of NCD Initial and NCD Followup encounters (_availability.e2e.md "Sections"); the specs create an
// NCD Followup encounter (and an NCD Initial one for the other branch) and open the edit URL directly, which skips that gating.
// First written without a server (locators from the XML), then run and fixed against a local Liberia server: see README.md.
//
// Conditions in the form, from documentation inventory (section-hospital.inv.md):
//   ifMode VIEW include=false :40, :542   next/submit script; top-row section buttons + Next/Save/Cancel
//   includeIf encounterType == NCD Initial (ae06d311)   :57, :90, :172  #hospital-stay-12, count in previous 12 months (CIEL:5704),
//                                                       "other diagnoses during hospitalization" textarea (PIH:6899)
//   includeIf encounterType == NCD Followup (5cbfd6a2)  :72, :100       #hospital-stay, count since last visit (CIEL:1773)
//   when hospitalized = yes   :65, :80   shows #hospital-details (everything below the question)
//   when diagnosis checkbox   :135-144   8 diagnoses x 8 values -> #{dm,htn,hf,respire,liver,sickle,palliative,ckd}-plus: no such ids (V1)
//   when outcome = death      :526       shows #death-suggest
// Hiding a `when` target clears its inputs (htmlForm.js onObsChangedCheck), so a count typed before answering "no" is not saved (tested).
// Scripts: :41 setUpNextAndSubmitButtons() only (see _shared.e2e.md). No validation, default or derived value.
// Side effects on save: none (no postSubmissionAction, no enrollInProgram).
// Not covered here: the Next / section buttons (need the visit page), the discharge date picker, every discharge diagnosis / treatment box.
// EDIT is covered by the save test; VIEW by the save test (generic check) and a buttons test.
//
// Findings (V1.. High -> Low):
//   V1 Medium :135-144, :193-515  every `when` targets #{nickname}-plus, but the discharge rows are tr#dm-plus-t, #htn-plus-t, #hf-plus-t,
//                                 #respire-plus-t, #ckd-plus-t, #liver-plus-t, #palliative-plus-t (the Sickle row has no id): 64 dead
//                                 `when` rows, so all discharge tables are always shown, whatever diagnosis was ticked. Fix: target
//                                 #{nickname}-plus-t, give the Sickle row id="sickle-plus-t", and hide the rows by default. (TESTED, test.fail)
//   V2 Low    :246/:250, :447/:455 the HTN table ("Cerebrovascular accident", default label) and the Sickle table ("Stroke") both have
//                                 PIH:14921 = CIEL:111103: one obs, two checkboxes; EDIT can show it in only one (unconfirmed which).
//   V3 Low    :212-499            `diagName` / `treatName` are passed to 11 templates that never use them: where no answerCode is given the
//                                 label is the concept name (e.g. "Hypertensive crisis" for the intended "Hypertensive urgency/emergency").
//                                 Fix: answerCode="{diagName}" / "{treatName}".
//   V4 Low    :178 vs :510        "Other diagnoses during hospitalization" saves PIH:6899 "Hospitalization comment"; the next field
//                                 "Other diagnoses at discharge" uses PIH:14922. Labels and concepts differ (unconfirmed which is intended).
//   V5 Low    :476, :504          the Sickle row has no id and the "Other" row is id="other-htn-t" (misleading).

const FORM = 'section-hospital.xml';
const PATIENT = { givenName: 'AutoHosp', familyName: 'Tester', gender: 'F' as const };
const yes = /^yes$/i;
const no = /^no$/i;
const numberOf = (n: number) => new RegExp(`^${n}(\\.0)?$`);

// Text inputs of #hospital-details in order: the count (CIEL:1773 / CIEL:5704), hospitalizations for NCDs (PIH:15160), days (PIH:2872), ...
const detailInput = (page: Page, index: number) =>
  page.locator('#hospital-details input[type=text]').nth(index);

test.describe('section-hospital (NCD Followup encounter)', () => {
  let section: SectionEncounter;

  test.beforeEach(async ({ page, createSectionEncounter }) => {
    section = await createSectionEncounter({ encounterTypeUuid: NCD_FOLLOWUP_ENCOUNTER_TYPE_UUID, patient: PATIENT });
    await SectionFormPage.openEdit(page, FORM, section);
  });

  test('offers "since last visit" for an NCD Followup encounter, not the previous-12-months question', async ({ page }) => {
    // includeIf :72, :100 (state "NCD Followup") and :57, :90, :172 (state "not NCD Initial")
    await expect(page.locator('#hospital-stay')).toBeVisible();
    await expect(page.locator('#hospital-stay-12')).toHaveCount(0);
    await expect(page.locator('textarea')).toHaveCount(0);
  });

  test('"hospitalized: yes" shows the details; "no" hides them and clears what was typed', async ({ page }) => {
    // when :80
    await expect(page.locator('#hospital-details')).toBeHidden();
    await page.locator('#hospital-stay').getByLabel(yes).check();
    await expect(page.locator('#hospital-details')).toBeVisible();
    await detailInput(page, 0).fill('4');
    await page.locator('#hospital-stay').getByLabel(no).check();
    await expect(page.locator('#hospital-details')).toBeHidden();
    await page.locator('#hospital-stay').getByLabel(yes).check();
    await expect(detailInput(page, 0)).toHaveValue('');
  });

  test('the outcome "death" shows the hint to record the death in the plan section', async ({ page }) => {
    // when :526
    await page.locator('#hospital-stay').getByLabel(yes).check();
    await expect(page.locator('#death-suggest')).toBeHidden();
    await page.locator('#hosp-outcome').getByLabel(/death/i).check();
    await expect(page.locator('#death-suggest')).toBeVisible();
    await page.locator('#hosp-outcome').getByLabel(/^discharge$/i).check();
    await expect(page.locator('#death-suggest')).toBeHidden();
  });

  test.fail('V1 a discharge table is shown only for the ticked NCD diagnosis', async ({ page }) => {
    // when :135-144 target ids do not exist; remove test.fail() when fixed
    await page.locator('#hospital-stay').getByLabel(yes).check();
    await expect(page.locator('#hospital-details')).toBeVisible();
    await expect(page.locator('#dm-plus-t')).toBeHidden();
    await page.locator('#dm-q input[type=checkbox]').check();
    await expect(page.locator('#dm-plus-t')).toBeVisible();
    await expect(page.locator('#htn-plus-t')).toBeHidden();
    await page.locator('#dm-q input[type=checkbox]').uncheck();
    await expect(page.locator('#dm-plus-t')).toBeHidden();
  });

  test('offers the top-row section buttons and Next / Save / Cancel in EDIT mode', async ({ page }) => {
    // ifMode :542
    await expect(page.locator('#buttonsTopRow button.nextSection')).toHaveCount(10);
    await expect(page.locator('#buttons #next')).toBeVisible();
    await expect(page.locator('#buttons #submit')).toBeVisible();
    await expect(page.locator('#buttons #cancel')).toBeVisible();
  });

  test('saves a hospitalization, and EDIT and VIEW show it again', async ({ page, api }) => {
    await page.locator('#hospital-stay').getByLabel(yes).check();
    await detailInput(page, 0).fill('2'); // since the last visit (CIEL:1773)
    await detailInput(page, 1).fill('1'); // for NCDs (PIH:15160)
    await detailInput(page, 2).fill('5'); // days (PIH:2872)
    await page.locator('#dm-q input[type=checkbox]').check();
    await page.locator('#dm-plus-t').getByLabel('Hyperglycemia', { exact: true }).check();
    await page.locator('#dm-plus-t').getByLabel('Metformin hydrochloride', { exact: true }).check();
    await page.locator('#other-htn-t input[type=text]').first().fill('Anemia workup');
    await page.locator('#hosp-outcome').getByLabel(/^discharge$/i).check();
    await new SectionFormPage(page, FORM).save();
    await new SectionFormPage(page, FORM).expectSaved();

    const obs = await getEncounterObs(api, section.encounter.uuid);
    const numbers = obs.map((o) => o.value).filter((v) => typeof v === 'number');
    expect(numbers).toEqual(expect.arrayContaining([2, 1, 5]));
    expect(obs.map((o) => o.value)).toContain('Anemia workup');
    const displays = obs.map((o) => `${o.concept.display}: ${o.display}`.toLowerCase());
    expect(displays.some((d) => d.includes('hyperglycemia'))).toBeTruthy();
    expect(displays.some((d) => d.includes('metformin'))).toBeTruthy();

    // EDIT starts from the saved values (the `when` of :80 shows the details)
    await SectionFormPage.openEdit(page, FORM, section);
    await expect(page.locator('#hospital-details')).toBeVisible();
    await expect(page.locator('#hospital-stay').getByLabel(yes)).toBeChecked();
    await expect(detailInput(page, 0)).toHaveValue(/^2(\.0)?$/);
    await expect(detailInput(page, 2)).toHaveValue(/^5(\.0)?$/);
    await expect(page.locator('#dm-q input[type=checkbox]')).toBeChecked();
    await expect(page.locator('#dm-plus-t').getByLabel('Metformin hydrochloride', { exact: true })).toBeChecked();
    await expect(page.locator('#hosp-outcome').getByLabel(/^discharge$/i)).toBeChecked();

    // VIEW: the saved Yes/No, numbers, checkboxes and text; no buttons (ifMode :40, :542)
    const view = await expectViewShowsSavedObs(page, api, FORM, section.encounter.uuid);
    const shown = await view.valueTexts();
    expect(shown).toContain('Anemia workup');
    expect(shown).toContain('[X] Metformin hydrochloride');
    expect(shown).toContain('[X] Hyperglycemia');
    expect(shown.some((t) => numberOf(2).test(t))).toBeTruthy();
    expect(shown.some((t) => numberOf(5).test(t))).toBeTruthy();
    await expect(view.page.locator('#hospital-stay .value')).toHaveText(/\[X\]\s*yes/i);
    await expect(view.page.locator('#hosp-outcome .value')).toHaveText(/\[X\]\s*discharge/i);
    await expect(view.page.locator('#htn-plus-t .value')).toHaveCount(0); // nothing saved in the other tables
    await expect(view.page.locator('#buttonsTopRow, #buttons, #next, #submit')).toHaveCount(0);
  });
});

test.describe('section-hospital (NCD Initial encounter)', () => {
  let section: SectionEncounter;

  test.beforeEach(async ({ page, createSectionEncounter }) => {
    section = await createSectionEncounter({ encounterTypeUuid: NCD_INITIAL_ENCOUNTER_TYPE_UUID, patient: PATIENT });
    await SectionFormPage.openEdit(page, FORM, section);
  });

  test('offers "previous 12 months" and the other-diagnoses text for an NCD Initial encounter', async ({ page }) => {
    // includeIf :57, :90, :172 (state "NCD Initial") and :72, :100 (state "not NCD Followup")
    await expect(page.locator('#hospital-stay-12')).toBeVisible();
    await expect(page.locator('#hospital-stay')).toHaveCount(0);
    await page.locator('#hospital-stay-12').getByLabel(yes).check(); // when :65
    await expect(page.locator('#hospital-details')).toBeVisible();
    await expect(page.locator('#hospital-details textarea')).toHaveCount(1);
  });

  test('saves the previous-12-months count and the other diagnoses; EDIT shows them', async ({ page, api }) => {
    await page.locator('#hospital-stay-12').getByLabel(yes).check();
    await detailInput(page, 0).fill('3'); // CIEL:5704
    await page.locator('#hospital-details textarea').fill('Anemia of chronic disease');
    await new SectionFormPage(page, FORM).save();
    await new SectionFormPage(page, FORM).expectSaved();

    const obs = await getEncounterObs(api, section.encounter.uuid);
    expect(obs.map((o) => o.value)).toEqual(expect.arrayContaining([3, 'Anemia of chronic disease']));

    await SectionFormPage.openEdit(page, FORM, section);
    await expect(page.locator('#hospital-details')).toBeVisible();
    await expect(detailInput(page, 0)).toHaveValue(/^3(\.0)?$/);
    await expect(page.locator('#hospital-details textarea')).toHaveValue('Anemia of chronic disease');
  });
});

import { type APIRequestContext } from '@playwright/test';
import { test, expect, type SectionEncounter } from '../../core';
import { NCD_FOLLOWUP_ENCOUNTER_TYPE_UUID, NCD_INITIAL_ENCOUNTER_TYPE_UUID } from '../../core/constants';
import { getEncounterObs } from '../../commands';
import { SectionFormPage, ViewFormPage, expectViewShowsSavedObs } from '../../pages';

// section-sickle-cell.xml: the "Sickle cell" section of an NCD encounter: (NCD Initial only) diagnosis + confirmation test, then the
// followup indicators: symptoms, complications, transfusions, treatment, awareness, disease control and hydroxyurea. On the visit page it
// is the `pihcore-sickle-cell` section of NCD Initial and NCD Followup encounters (_availability.e2e.md "Sections"); the specs create an
// NCD Followup encounter (and an NCD Initial one where the form branches on it) and open the edit URL directly, skipping that gating.
// First written without a server (locators from the XML), then run and fixed against a local Liberia server: see README.md.
//
// Conditions in the form, from documentation inventory (section-sickle-cell.inv.md):
//   ifMode VIEW include=false :42, :389   next/submit script; top-row section buttons + Next/Save/Cancel
//   includeIf encounterType == NCD Initial (ae06d311)  :56   diagnosis radios, "other" text, confirmation test (#scd-test-method)
//   when "Asymptomatic" = no   :103  shows #sc-not-asymptom (9 symptom yes/no/unknown rows)
//   when complications = yes   :143  shows #scd-comp-text      when transfusion = yes :187  shows #transfusion-details
//   when {tog} = yes           :232  #scd-fui-{tog}-details: only #scd-fui-miss-details exists (V1)   when :270 #scd-fui-improved-details (V1)
//   when control = uncontrolled :286 shows #sc-fui-uncontrolled   when hydroxyurea indicated = yes :314 shows #scd-hydroxy-details
//   when on hydroxyurea = no   :328  shows #reason-no-hydroxy    when hydroxyurea complications = yes :361 shows #side-effect-hydroxy-compl-details
// Hiding a `when` target clears its inputs (htmlForm.js onObsChangedCheck), so stale answers are not saved (tested for two targets).
// Scripts: :43 setUpNextAndSubmitButtons() only (see _shared.e2e.md). No validation, default or derived value.
// Side effects on save: postSubmissionAction CleanDiagnosisConstructAction (:19, pihcore): a Visit Diagnoses group without a Diagnosis order
//   member gets "Secondary" added (tested with the NCD Initial diagnosis).
// Not covered here: the Next / section buttons (need the visit page), the treatment-date pickers.
// VIEW is covered by the save tests (generic check on the Yes/No, checkbox and number obs) and targeted tests for the symptom / control
//   radios (their labels differ from the concept names, so the generic check cannot be used) and the NCD Initial diagnosis.
//
// Findings (V1.. High -> Low):
//   V1 Low :232, :270  seven `when` rows target ids that do not exist (#scd-fui-malaria-/under-/tite-/adher-/aware-/family-/improved-details):
//                      answering yes shows nothing. Fix: drop those <when>, or add the detail blocks they were meant for.

const FORM = 'section-sickle-cell.xml';
const PATIENT = { givenName: 'AutoSickle', familyName: 'Tester', gender: 'F' as const };
const yes = /^yes$/i;
const no = /^no$/i;

// Display text of the value of every saved obs of the encounter.
const savedValues = async (api: APIRequestContext, encounterUuid: string) => {
  const obs = await getEncounterObs(api, encounterUuid);
  return obs.map((o) => (o.value && typeof o.value === 'object' ? String((o.value as { display: string }).display) : String(o.value)));
};

test.describe('section-sickle-cell (NCD Followup encounter)', () => {
  let section: SectionEncounter;

  test.beforeEach(async ({ page, createSectionEncounter }) => {
    section = await createSectionEncounter({ encounterTypeUuid: NCD_FOLLOWUP_ENCOUNTER_TYPE_UUID, patient: PATIENT });
    await SectionFormPage.openEdit(page, FORM, section);
  });

  test('"asymptomatic: no" shows the symptom rows; "yes" hides them and clears the answers', async ({ page }) => {
    // when :103
    const asymptomatic = page.locator('#sickle-asymptom');
    const symptoms = page.locator('#sc-not-asymptom');
    await expect(symptoms).toBeHidden();
    await asymptomatic.getByLabel(no).check();
    await expect(symptoms).toBeVisible();
    const spleen = symptoms.locator('p', { hasText: 'Spleen palpable' });
    await spleen.getByLabel(yes).check();
    await asymptomatic.getByLabel(yes).check();
    await expect(symptoms).toBeHidden();
    await asymptomatic.getByLabel(no).check();
    await expect(spleen.getByLabel(yes)).not.toBeChecked();
  });

  test('complications "yes" shows the complication checkboxes; "no" hides and clears them', async ({ page }) => {
    // when :143
    const target = page.locator('#scd-comp-text');
    await expect(target).toBeHidden();
    await page.locator('#scd-comp-q').getByLabel(yes).check();
    await expect(target).toBeVisible();
    await target.getByLabel('Anemia', { exact: true }).check();
    await page.locator('#scd-comp-q').getByLabel(no).check();
    await expect(target).toBeHidden();
    await page.locator('#scd-comp-q').getByLabel(yes).check();
    await expect(target.getByLabel('Anemia', { exact: true })).not.toBeChecked();
  });

  test('transfusion in the past 12 months "yes" shows the transfusion details', async ({ page }) => {
    // when :187
    await expect(page.locator('#transfusion-details')).toBeHidden();
    await page.locator('#transfusion-status').getByLabel(yes).check();
    await expect(page.locator('#transfusion-details')).toBeVisible();
    await page.locator('#transfusion-status').getByLabel(no).check();
    await expect(page.locator('#transfusion-details')).toBeHidden();
  });

  test('missed doses "yes" shows the number of missed doses; the other "yes" answers show nothing (V1)', async ({ page }) => {
    // when :232 (tog = miss), and the 6 + 1 dead targets
    await expect(page.locator('#scd-fui-miss-details')).toBeHidden();
    await page.locator('#miss').getByLabel(yes).check();
    await expect(page.locator('#scd-fui-miss-details')).toBeVisible();
    await page.locator('#malaria').getByLabel(yes).check();
    await expect(page.locator('#scd-fui-malaria-details')).toHaveCount(0);
    await page.locator('#miss').getByLabel(no).check();
    await expect(page.locator('#scd-fui-miss-details')).toBeHidden();
  });

  test('"uncontrolled" disease control shows the send-for-admission question', async ({ page }) => {
    // when :286
    const target = page.locator('#sc-fui-uncontrolled');
    await expect(target).toBeHidden();
    await page.locator('#sickle-control').getByLabel(/^uncontrolled$/i).check();
    await expect(target).toBeVisible();
    await page.locator('#sickle-control').getByLabel(/^controlled$/i).check();
    await expect(target).toBeHidden();
  });

  test('hydroxyurea: indicated shows the details; not on treatment shows the reasons; complications shows the list', async ({ page }) => {
    // when :314, :328, :361
    const details = page.locator('#scd-hydroxy-details');
    await expect(details).toBeHidden();
    await page.locator('#scd-hydroxy-q').getByLabel(yes).check();
    await expect(details).toBeVisible();
    await expect(page.locator('#reason-no-hydroxy')).toBeHidden();
    await expect(page.locator('#side-effect-hydroxy-compl-details')).toBeHidden();
    await page.locator('#hydroxy-treatment').getByLabel(no).check();
    await expect(page.locator('#reason-no-hydroxy')).toBeVisible();
    await page.locator('#hydroxy-treatment').getByLabel(yes).check();
    await expect(page.locator('#reason-no-hydroxy')).toBeHidden();
    await page.locator('#side-effect-hydroxy').getByLabel(yes).check();
    await expect(page.locator('#side-effect-hydroxy-compl-details')).toBeVisible();
    await page.locator('#scd-hydroxy-q').getByLabel(no).check();
    await expect(details).toBeHidden();
  });

  test('the diagnosis and the confirmation test are not offered for an NCD Followup encounter', async ({ page }) => {
    // includeIf :56, state "not NCD Initial"
    await expect(page.locator('#scd-test-method')).toHaveCount(0);
    await expect(page.getByLabel(/Sickle-cell trait/)).toHaveCount(0);
    await expect(page.locator('#sickle-asymptom')).toBeVisible(); // the followup indicators are always there
  });

  test('offers the top-row section buttons and Next / Save / Cancel in EDIT mode', async ({ page }) => {
    // ifMode :389
    await expect(page.locator('#buttonsTopRow button.nextSection')).toHaveCount(10);
    await expect(page.locator('#buttonsTopRow #pihcore-sickle-cell')).toBeVisible();
    await expect(page.locator('#buttons #next')).toBeVisible();
    await expect(page.locator('#buttons #submit')).toBeVisible();
    await expect(page.locator('#buttons #cancel')).toBeVisible();
  });

  test('saves the indicators, and EDIT and VIEW show them again', async ({ page, api }) => {
    await page.locator('#scd-comp-q').getByLabel(yes).check();
    await page.locator('#scd-comp-text').getByLabel('Anemia', { exact: true }).check();
    await page.locator('#transfusion-status').getByLabel(yes).check();
    await page.locator('#transfusion-details input[type=text]').first().fill('2');
    await page.getByLabel('Folic acid', { exact: true }).check();
    await page.locator('#miss').getByLabel(yes).check();
    await page.locator('#scd-fui-miss-details input[type=text]').first().fill('3');
    await page.locator('#scd-hydroxy-q').getByLabel(yes).check();
    await new SectionFormPage(page, FORM).save();
    await new SectionFormPage(page, FORM).expectSaved();

    const obs = await getEncounterObs(api, section.encounter.uuid);
    const numbers = obs.map((o) => o.value).filter((v) => typeof v === 'number');
    expect(numbers).toEqual(expect.arrayContaining([2, 3]));
    const values = await savedValues(api, section.encounter.uuid);
    expect(values.some((v) => /^anemia$/i.test(v))).toBeTruthy();
    expect(values.some((v) => /folic acid/i.test(v))).toBeTruthy();

    // EDIT: the `when` targets start from the saved values
    await SectionFormPage.openEdit(page, FORM, section);
    await expect(page.locator('#scd-comp-text')).toBeVisible();
    await expect(page.locator('#scd-comp-text').getByLabel('Anemia', { exact: true })).toBeChecked();
    await expect(page.locator('#transfusion-details')).toBeVisible();
    await expect(page.locator('#transfusion-details input[type=text]').first()).toHaveValue('2');
    await expect(page.locator('#scd-fui-miss-details input[type=text]').first()).toHaveValue('3');
    await expect(page.locator('#scd-hydroxy-details')).toBeVisible();

    // VIEW: the Yes/No, checkbox and number values; the top row and the buttons (ifMode :389) are absent
    const view = await expectViewShowsSavedObs(page, api, FORM, section.encounter.uuid);
    const shown = await view.valueTexts();
    expect(shown).toContain('[X] Anemia');
    expect(shown).toContain('[X] Folic acid');
    expect(shown.some((t) => /^2(\.0)?$/.test(t))).toBeTruthy();
    expect(shown.some((t) => /^3(\.0)?$/.test(t))).toBeTruthy();
    await expect(view.root.locator('#scd-hydroxy-q .value')).toHaveText(/\[X\]\s*yes/i);
    await expect(view.root.locator('#sickle-control .value')).toHaveCount(0); // not answered
    await expect(view.root.locator('#buttonsTopRow, #buttons, #next, #submit')).toHaveCount(0);
  });

  test('a stale answer typed and then hidden by changing its question is not saved', async ({ page, api }) => {
    // htmlForm.js clears a hidden `when` target: transfusion count typed, then the question set to "no"
    await page.locator('#transfusion-status').getByLabel(yes).check();
    await page.locator('#transfusion-details input[type=text]').first().fill('7');
    await page.locator('#transfusion-status').getByLabel(no).check();
    await page.locator('#scd-comp-q').getByLabel(yes).check();
    await page.locator('#scd-comp-text').getByLabel('Anemia', { exact: true }).check();
    await new SectionFormPage(page, FORM).save();
    await new SectionFormPage(page, FORM).expectSaved();
    const obs = await getEncounterObs(api, section.encounter.uuid);
    expect(obs.map((o) => o.value)).not.toContain(7);
  });

  test('VIEW: the symptom, disease control and unanswered questions', async ({ page, api }) => {
    await page.locator('#sickle-asymptom').getByLabel(no).check();
    await page.locator('#sc-not-asymptom p', { hasText: 'Spleen palpable' }).getByLabel(yes).check();
    await page.locator('#sickle-control').getByLabel(/^uncontrolled$/i).check();
    await new SectionFormPage(page, FORM).save();
    await new SectionFormPage(page, FORM).expectSaved();

    // EDIT shows the symptom rows because "asymptomatic" is saved as "no" (when :103 on load)
    await SectionFormPage.openEdit(page, FORM, section);
    await expect(page.locator('#sc-not-asymptom')).toBeVisible();
    await expect(page.locator('#sc-not-asymptom p', { hasText: 'Spleen palpable' }).getByLabel(yes)).toBeChecked();
    await expect(page.locator('#sc-fui-uncontrolled')).toBeVisible();

    // The generic check is not used: the label "uncontrolled" differs from the concept "Not controlled" and the symptom rows show
    // the symptom as text outside the value.
    const view = await ViewFormPage.open(page, FORM, section.encounter.uuid);
    await expect(view.root.locator('#sickle-asymptom .value')).toHaveText(/\[X\]\s*no/i);
    await expect(view.root.locator('#sc-not-asymptom p', { hasText: 'Spleen palpable' }).locator('.value')).toHaveText(/\[X\]\s*yes/i);
    await expect(view.root.locator('#sickle-control .value')).toHaveText(/\[X\]\s*uncontrolled/i);
    await expect(view.root.locator('#transfusion-status .value')).toHaveCount(0);
  });
});

test.describe('section-sickle-cell (NCD Initial encounter)', () => {
  let section: SectionEncounter;

  test.beforeEach(async ({ page, createSectionEncounter }) => {
    section = await createSectionEncounter({ encounterTypeUuid: NCD_INITIAL_ENCOUNTER_TYPE_UUID, patient: PATIENT });
    await SectionFormPage.openEdit(page, FORM, section);
  });

  test('offers the diagnosis, the other-disease text and the confirmation test', async ({ page }) => {
    // includeIf :56, state "NCD Initial"
    await expect(page.getByLabel(/Sickle-cell trait/)).toBeVisible();
    await expect(page.locator('#scd-test-method')).toBeVisible();
    await expect(page.locator('#sickle-asymptom')).toBeVisible();
  });

  test('saves the diagnosis and the confirmation test; the diagnosis gets a "Secondary" order', async ({ page, api }) => {
    await page.getByLabel(/Sickle-cell trait/).check();
    await page.locator('#scd-test-method').getByLabel(/^HPLC$/).check();
    await new SectionFormPage(page, FORM).save();
    await new SectionFormPage(page, FORM).expectSaved();

    const obs = await getEncounterObs(api, section.encounter.uuid);
    const displays = obs.map((o) => `${o.concept.display}: ${o.display}`.toLowerCase());
    expect(displays.some((d) => d.includes('trait'))).toBeTruthy();
    expect(displays.some((d) => d.includes('hplc'))).toBeTruthy();
    // postSubmissionAction CleanDiagnosisConstructAction :19
    expect(displays.some((d) => d.includes('secondary'))).toBeTruthy();

    // EDIT starts from the saved values
    await SectionFormPage.openEdit(page, FORM, section);
    await expect(page.getByLabel(/Sickle-cell trait/)).toBeChecked();
    await expect(page.locator('#scd-test-method').getByLabel(/^HPLC$/)).toBeChecked();

    // VIEW (targeted: the diagnosis label differs from the concept name and the "Secondary" order is not on the form)
    const view = await ViewFormPage.open(page, FORM, section.encounter.uuid);
    const shown = await view.valueTexts();
    expect(shown.some((t) => /^\[X\]\s*Sickle-cell trait/.test(t))).toBeTruthy();
    expect(shown).toContain('[X] HPLC');
    await expect(view.root.locator('#scd-test-method .value')).toHaveCount(1);
  });
});

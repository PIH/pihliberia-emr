import { type Page } from '@playwright/test';
import { test, expect, type SectionEncounter } from '../../core';
import { FAMILY_MEDICINE_INTAKE_ENCOUNTER_TYPE_UUID, NCD_INITIAL_ENCOUNTER_TYPE_UUID } from '../../core/constants';
import { getEncounterObs } from '../../commands';
import { SectionFormPage, ViewFormPage, expectViewShowsSavedObs, VISIT_PAGE_URL } from '../../pages';

// section-history.xml ("History"): referral, chief complaint and presenting history (not for NCD Initial), past medical history, surgical
// history, OB/GYN history (female), family history, lifestyle (tobacco, alcohol), social history and previous hospitalizations. On the
// visit page it is the `pihcore-history` section of Family Medicine Intake encounters (_availability.e2e.md "Sections"); the specs create a
// Family Medicine Intake encounter (an NCD Initial one for the branch on it) and open the edit URL directly, skipping that gating.
// First written without a server (locators from the XML), then run and fixed against a local Liberia server: see README.md.
//
// Conditions in the form, from documentation inventory (section-history.inv.md):
//   ifMode VIEW include=true/false :24, :33, :95, :1177   a <style>; the validation script; the heading; Next/Save/Cancel
//   includeIf encounterType != NCD Initial (ae06d311)  :186  chief complaint (#chief-complaint) and presenting history (#presenting-history)
//   includeIf $patient.gender == 'F'  :248, :350   3 more past-history boxes; the whole OB/GYN block (#meno-toggle, #lmp-section, .gp-fields, ...)
//   when surgery = yes :272 -> #surgery-block (inline display:none); toggle :292 -> #{msg}-surgery-detail per procedure (11)
//   when menopause = yes :372 -> #meno-date, #age-meno; = no :373 -> #lmp-section (all inline display:none)   [`<control>` for `<controls>`, V4]
//   when smokes = currently :677 -> #type-of-tobacco-product;  drinks = currently :710 -> #num-type-of-alcohol-product;
//   when alcohol type = traditional :722 -> #num-of-traditional-litres-per-day; modern :723 -> #num-of-modern-bottles-per-day
// Scripts (:34-92, ENTER/EDIT only): validateFamHistoryText on `.medicalHistoryText` rows (the `specify` rows of past and family history):
//   a ticked box with no comment shows the field-error (family: "specify comments"), a comment with no box shows "indicate parent / check";
//   beforeSubmit blocks the save while a row is invalid; then setUpNextAndSubmitButtons() (see _shared.e2e.md). The server only rejects a
//   comment without its box (PastMedicalHistoryCheckboxTagHandler). Required: Abortus and Living (:431, :436), females only.
// Side effects on save: none from the form itself (the pihcore tags store CIEL:1633 / CIEL:160593 groups).
// Not covered here: Next, the date pickers (referral, procedure, LMP), the 11 procedure detail rows, family history of each disease.
// EDIT is covered by the save tests; VIEW by the generic check (safe fields only) and targeted tests.
//
// Findings (V1.. High -> Low; VW = VIEW):
//   V1 High    :323  the "Nephrectomy" checkbox is PIH:20149, whose concept is Myomectomy (nephrectomy is PIH:9815 / 9818). (TESTED, test.fail)
//   VW1 Medium :278, :381, :395, :405  VIEW never emits the `when` script, so the blocks that start with inline display:none stay hidden:
//                     saved procedures, dates, "problems after the operation" and surgery comments (#surgery-block), the LMP and the
//                     menopause date and age are not shown in the read-only view. Fix: no inline display:none (the `when` hides it in EDIT).
//                     (TESTED, test.fail)
//   V2 Medium  :431, :436  `required="true"` on Abortus and Living for every female patient, whatever her age: a girl cannot save the
//                     section without entering obstetric numbers. Fix: require them only from a reproductive age (includeIf on age).
//   V4 Low     :271, :371  `<control>` instead of `<controls>`: an unknown tag that HFE prints as is; the `<when>` inside still works
//                     because WhenTagHandler does not check its parent. Fix: `<controls>`.
//   V5 Low     :743-751  a `<tr>` inside a `<span>` inside a `<td>`: the browser closes the cell at the `<tr>`, so "Document any other
//                     relevant history" ends up in its own row, outside #num-type-of-alcohol-product (always visible; unconfirmed).
//   V6 Low     :695  `style="radio"` on the numeric CIEL:1546 is ignored (a number box is rendered).
//   V7 Low     :688  CIEL:159380 ("Pipe Tobacco") is labelled "Shisha" (unconfirmed which is intended).

const FORM = 'section-history.xml';
const MALE = { givenName: 'AutoHistory', familyName: 'Tester', gender: 'M' as const };
const FEMALE = { givenName: 'AutoHistory', familyName: 'Tester', gender: 'F' as const };
const yes = /^yes$/i;
const no = /^no$/i;
const numberOf = (n: number) => new RegExp(`^${n}(\\.0)?$`);

// The first checkbox after the label text (the plain yes/no radios of :344, :1033 have no id).
const firstRadioAfter = (page: Page, labelText: string) =>
  page.locator('label', { hasText: labelText }).locator('xpath=following::input[@type="radio"][1]');
// A GPAL box (:417-437): Gravida, Parity, Abortus (A), Living (L)
const gpField = (page: Page, text: string) => page.locator('.gp-fields .field', { hasText: text });

const openFor = async (
  page: Page,
  create: (o: { encounterTypeUuid: string; patient: typeof MALE | typeof FEMALE }) => Promise<SectionEncounter>,
  patient: typeof MALE | typeof FEMALE,
  encounterTypeUuid = FAMILY_MEDICINE_INTAKE_ENCOUNTER_TYPE_UUID,
) => {
  const section = await create({ encounterTypeUuid, patient });
  await SectionFormPage.openEdit(page, FORM, section);
  return section;
};

test.describe('section-history (male patient, Family Medicine Intake)', () => {
  let section: SectionEncounter;

  test.beforeEach(async ({ page, createSectionEncounter }) => {
    section = await openFor(page, createSectionEncounter, MALE);
  });

  test('offers the chief complaint and presenting history, the heading and Next / Save / Cancel; no OB/GYN block', async ({ page }) => {
    // includeIf :186 (state "not NCD Initial"), :248 and :350 (state "male"), ifMode :95, :1177
    await expect(page.locator('#chief-complaint textarea')).toBeVisible();
    await expect(page.locator('#presenting-history textarea')).toBeVisible();
    await expect(page.locator('h1:not(.name)')).toBeVisible();
    await expect(page.locator('#buttons #next')).toBeVisible();
    await expect(page.locator('#buttons #submit')).toBeVisible();
    await expect(page.locator('#buttons #cancel')).toBeVisible();
    await expect(page.locator('.past-medical-history-item')).toHaveCount(19);
    await expect(page.locator('.gp-fields')).toHaveCount(0);
    await expect(page.locator('#meno-toggle')).toHaveCount(0);
  });

  test('surgery "yes" shows the procedures; ticking a procedure shows its details', async ({ page }) => {
    // when :272 and toggle :292
    await expect(page.locator('#surgery-block')).toBeHidden();
    await page.locator('#surgery-toggle').getByLabel(yes).check();
    await expect(page.locator('#surgery-block')).toBeVisible();
    await expect(page.locator('#appy-surgery-detail')).toBeHidden();
    await page.getByLabel('Appendectomy', { exact: true }).check();
    await expect(page.locator('#appy-surgery-detail')).toBeVisible();
    await page.getByLabel('Appendectomy', { exact: true }).uncheck();
    await expect(page.locator('#appy-surgery-detail')).toBeHidden();
    await page.locator('#surgery-toggle').getByLabel(no).check();
    await expect(page.locator('#surgery-block')).toBeHidden();
  });

  test.fail('V1 the "Nephrectomy" checkbox is not saved as another procedure', async ({ page, api }) => {
    // :323 PIH:20149 is Myomectomy; remove test.fail() when fixed
    await page.locator('#surgery-toggle').getByLabel(yes).check();
    await page.getByLabel('Nephrectomy', { exact: true }).check();
    await new SectionFormPage(page, FORM).save();
    await new SectionFormPage(page, FORM).expectSaved();
    const obs = await getEncounterObs(api, section.encounter.uuid);
    const displays = obs.map((o) => `${o.concept.display}: ${o.display}`);
    expect(displays.length).toBeGreaterThan(0);
    expect(displays.filter((d) => /myomectomy/i.test(d))).toEqual([]);
  });

  test.fail('VW1 VIEW shows the saved surgical history', async ({ page }) => {
    // :278 inline display:none, no `when` script in VIEW; remove test.fail() when fixed
    await page.locator('#surgery-toggle').getByLabel(yes).check();
    await page.getByLabel('Appendectomy', { exact: true }).check();
    await new SectionFormPage(page, FORM).save();
    await new SectionFormPage(page, FORM).expectSaved();
    const view = await ViewFormPage.open(page, FORM, section.encounter.uuid);
    await expect(view.page.locator('#surgery-toggle .value')).toHaveText(/\[X\]\s*yes/i);
    await expect(view.page.locator('#surgery-block')).toBeVisible();
  });

  test('tobacco and alcohol "currently" show their follow-up questions; the alcohol type picks the quantity', async ({ page }) => {
    // when :677, :710, :722, :723
    await expect(page.locator('#type-of-tobacco-product')).toBeHidden();
    await page.locator('#patient-currently-smokes').getByLabel(/currently/i).check();
    await expect(page.locator('#type-of-tobacco-product')).toBeVisible();
    await page.locator('#patient-currently-smokes').getByLabel(/^never$/i).check();
    await expect(page.locator('#type-of-tobacco-product')).toBeHidden();

    await expect(page.locator('#num-type-of-alcohol-product')).toBeHidden();
    await page.locator('#patient-currently-drinks').getByLabel(/currently/i).check();
    await expect(page.locator('#num-type-of-alcohol-product')).toBeVisible();
    await expect(page.locator('#num-of-traditional-litres-per-day')).toBeHidden();
    await expect(page.locator('#num-of-modern-bottles-per-day')).toBeHidden();
    await page.locator('#type-of-alcohol-product').getByLabel(/traditional/i).check();
    await expect(page.locator('#num-of-traditional-litres-per-day')).toBeVisible();
    await expect(page.locator('#num-of-modern-bottles-per-day')).toBeHidden();
    await page.locator('#type-of-alcohol-product').getByLabel(/modern/i).check();
    await expect(page.locator('#num-of-modern-bottles-per-day')).toBeVisible();
    await expect(page.locator('#num-of-traditional-litres-per-day')).toBeHidden();
  });

  test('"any other relevant history" is visible without answering the alcohol question (V5)', async ({ page }) => {
    // :743-751: the <tr> is lifted out of #num-type-of-alcohol-product by the browser (unconfirmed: not run)
    await expect(page.locator('#num-type-of-alcohol-product')).toBeHidden();
    await expect(page.locator('#other-life-style-relevant-history textarea')).toBeVisible();
  });

  test('a ticked past-history box that asks to "specify" needs a comment (client validation)', async ({ page, api }) => {
    // script :34-92, rows of :219 (class medicalHistoryText patientHistory)
    const heart = page.locator('.past-medical-history-item.patientHistory').first();
    await expect(heart.locator('.field-error')).toBeHidden();
    await heart.locator('input[type=checkbox]').check();
    await expect(heart.locator('.field-error')).toBeVisible(); // ticked, no comment
    await heart.locator('input[type=text]').fill('Rheumatic heart disease');
    await heart.locator('input[type=text]').blur();
    await expect(heart.locator('.field-error')).toBeHidden();
    await heart.locator('input[type=text]').fill('');
    await heart.locator('input[type=text]').blur();
    await expect(heart.locator('.field-error')).toBeVisible();

    // beforeSubmit blocks the save while the row is invalid
    await page.locator('#submit').click();
    await page.waitForTimeout(1000);
    expect(page.url()).not.toMatch(VISIT_PAGE_URL);
    await expect(heart.locator('.field-error')).toBeVisible();
    expect(await getEncounterObs(api, section.encounter.uuid)).toEqual([]);
  });

  test('a comment on a family-history row needs a relative (client validation)', async ({ page }) => {
    // script :34-92, row #familyCancer (:539)
    const cancer = page.locator('#familyCancer');
    await cancer.locator('input[type=text]').fill('Breast');
    await cancer.locator('input[type=text]').blur();
    await expect(cancer.locator('.field-error')).toBeVisible(); // comment, no relative
    await cancer.locator('input[type=checkbox]').first().check(); // Father
    await expect(cancer.locator('.field-error')).toBeHidden();
  });

  test('saves the history, and EDIT and VIEW show it again', async ({ page, api }) => {
    await page.locator('#chief-complaint textarea').fill('Cough for two weeks');
    await page.locator('#presenting-history textarea').fill('Started after the rains');
    await page.locator('#surgery-toggle').getByLabel(yes).check();
    await firstRadioAfter(page, 'Have you ever received blood before?').check(); // yes
    await page.locator('#patient-currently-smokes').getByLabel(/currently/i).check();
    await page.locator('#type-of-tobacco-product input[type=text]').first().fill('5');
    await page.locator('#transportation-cost input').fill('10');
    await page.locator('#social-history textarea').fill('Lives with family');
    await page.locator('#previous-hospital input[type=text]').nth(2).fill('County Hospital'); // row 1: facility
    await page.locator('#previous-hospital input[type=text]').nth(3).fill('Appendicitis'); // row 1: reason
    await new SectionFormPage(page, FORM).save();
    await new SectionFormPage(page, FORM).expectSaved();

    const obs = await getEncounterObs(api, section.encounter.uuid);
    const values = obs.map((o) => o.value);
    expect(values).toEqual(
      expect.arrayContaining(['Cough for two weeks', 'Started after the rains', 'Lives with family', 'County Hospital', 'Appendicitis', 5, 10]),
    );

    // EDIT starts from the saved values (the `when` of :272 and :677 show their targets)
    await SectionFormPage.openEdit(page, FORM, section);
    await expect(page.locator('#chief-complaint textarea')).toHaveValue('Cough for two weeks');
    await expect(page.locator('#surgery-toggle').getByLabel(yes)).toBeChecked();
    await expect(page.locator('#surgery-block')).toBeVisible();
    await expect(page.locator('#type-of-tobacco-product')).toBeVisible();
    await expect(page.locator('#type-of-tobacco-product input[type=text]').first()).toHaveValue(/^5(\.0)?$/);
    await expect(page.locator('#previous-hospital input[type=text]').nth(2)).toHaveValue('County Hospital');

    // VIEW: every saved text / number / coded obs; no heading, no buttons (ifMode :95, :1177); unfilled blocks show no value
    const view = await expectViewShowsSavedObs(page, api, FORM, section.encounter.uuid);
    const shown = await view.valueTexts();
    expect(shown).toContain('Cough for two weeks');
    expect(shown).toContain('Started after the rains');
    expect(shown).toContain('Lives with family');
    expect(shown.some((t) => numberOf(5).test(t))).toBeTruthy();
    expect(shown.some((t) => numberOf(10).test(t))).toBeTruthy();
    await expect(view.page.locator('#chief-complaint .value')).toHaveText('Cough for two weeks');
    await expect(view.page.locator('#patient-currently-smokes .value')).toHaveText(/\[X\]\s*currently/i);
    await expect(view.page.locator('#patient-currently-drinks .value')).toHaveCount(0);
    await expect(view.page.locator('#referralIn .value')).toHaveCount(0);
    await expect(view.page.locator('h1')).toHaveCount(0);
    await expect(view.page.locator('#buttons, #next, #submit')).toHaveCount(0);
  });

  test('saves a past-history item with its comment and the self-referral; VIEW shows them', async ({ page, api }) => {
    const heart = page.locator('.past-medical-history-item.patientHistory').first();
    await heart.locator('input[type=checkbox]').check();
    await heart.locator('input[type=text]').fill('Rheumatic heart disease');
    await heart.locator('input[type=text]').blur();
    await page.getByLabel('Has patient walked in or came willingly', { exact: true }).check();
    await new SectionFormPage(page, FORM).save();
    await new SectionFormPage(page, FORM).expectSaved();

    const obs = await getEncounterObs(api, section.encounter.uuid);
    expect(obs.map((o) => o.value)).toContain('Rheumatic heart disease');

    await SectionFormPage.openEdit(page, FORM, section);
    await expect(page.locator('.past-medical-history-item.patientHistory').first().locator('input[type=checkbox]')).toBeChecked();
    await expect(page.locator('.past-medical-history-item.patientHistory').first().locator('input[type=text]')).toHaveValue(
      'Rheumatic heart disease',
    );

    // VIEW (targeted: the checkbox and referral labels differ from the concept names, and the construct obs are groups)
    const view = await ViewFormPage.open(page, FORM, section.encounter.uuid);
    const shown = await view.valueTexts();
    expect(shown).toContain('Rheumatic heart disease');
    expect(shown).toContain('[X] Has patient walked in or came willingly');
  });
});

test.describe('section-history (female patient, Family Medicine Intake)', () => {
  let section: SectionEncounter;

  test.beforeEach(async ({ page, createSectionEncounter }) => {
    section = await openFor(page, createSectionEncounter, FEMALE);
  });

  test('offers the OB/GYN block and the three extra past-history boxes', async ({ page }) => {
    // includeIf :248 and :350, state "female"
    await expect(page.locator('.past-medical-history-item')).toHaveCount(22);
    await expect(page.locator('.gp-fields')).toBeVisible();
    await expect(page.locator('#meno-toggle')).toBeVisible();
  });

  test('menopause "yes" shows the date and the age; "no" shows the last menstrual period', async ({ page }) => {
    // when :372, :373
    for (const hidden of ['#meno-date', '#age-meno', '#lmp-section']) {
      await expect(page.locator(hidden)).toBeHidden();
    }
    await page.locator('#meno-toggle').getByLabel(yes).check();
    await expect(page.locator('#meno-date')).toBeVisible();
    await expect(page.locator('#age-meno')).toBeVisible();
    await expect(page.locator('#lmp-section')).toBeHidden();
    await page.locator('#meno-toggle').getByLabel(no).check();
    await expect(page.locator('#lmp-section')).toBeVisible();
    await expect(page.locator('#meno-date')).toBeHidden();
    await expect(page.locator('#age-meno')).toBeHidden();
  });

  test('Abortus and Living are required; Gravida and Parity are not', async ({ page }) => {
    // required :431, :436
    await page.locator('#submit').click();
    await expect(gpField(page, 'Abortus').locator('.field-error')).toBeVisible();
    await expect(gpField(page, 'Abortus').locator('.field-error')).toContainText(/required/i);
    await expect(gpField(page, 'Living').locator('.field-error')).toBeVisible();
    await expect(gpField(page, 'Gravida').locator('.field-error')).toBeHidden();
    await expect(gpField(page, 'Parity').locator('.field-error')).toBeHidden();
    expect(page.url()).not.toMatch(VISIT_PAGE_URL);
  });

  test('saves the pregnancy history and an OB/GYN complication, and EDIT and VIEW show them', async ({ page, api }) => {
    await gpField(page, 'Gravida').locator('input[type=text]').fill('3');
    await gpField(page, 'Parity').locator('input[type=text]').fill('2');
    await gpField(page, 'Abortus').locator('input[type=text]').fill('0');
    await gpField(page, 'Living').locator('input[type=text]').fill('2');
    await page.locator('.obgyn-complications').getByLabel('Malaria', { exact: true }).check();
    await new SectionFormPage(page, FORM).save();
    await new SectionFormPage(page, FORM).expectSaved();

    const obs = await getEncounterObs(api, section.encounter.uuid);
    const numbers = obs.map((o) => o.value).filter((v) => typeof v === 'number');
    expect(numbers).toEqual(expect.arrayContaining([3, 2, 0, 2]));
    expect(obs.map((o) => `${o.concept.display}: ${o.display}`.toLowerCase()).some((d) => d.includes('malaria'))).toBeTruthy();

    await SectionFormPage.openEdit(page, FORM, section);
    await expect(gpField(page, 'Gravida').locator('input[type=text]')).toHaveValue(/^3(\.0)?$/);
    await expect(page.locator('.obgyn-complications').getByLabel('Malaria', { exact: true })).toBeChecked();

    const view = await expectViewShowsSavedObs(page, api, FORM, section.encounter.uuid);
    const shown = await view.valueTexts();
    expect(shown).toContain('[X] Malaria');
    expect(shown.some((t) => numberOf(3).test(t))).toBeTruthy();
    await expect(gpField(page, 'Gravida').locator('.value')).toHaveText(numberOf(3));
  });
});

test.describe('section-history (NCD Initial encounter)', () => {
  test('does not offer the chief complaint and the presenting history for an NCD Initial encounter', async ({ page, createSectionEncounter }) => {
    // includeIf :186, state "NCD Initial"
    await openFor(page, createSectionEncounter, MALE, NCD_INITIAL_ENCOUNTER_TYPE_UUID);
    await expect(page.locator('#chief-complaint')).toHaveCount(0);
    await expect(page.locator('#presenting-history')).toHaveCount(0);
    await expect(page.locator('#patient-history')).toBeVisible();
  });
});

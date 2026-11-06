import { type APIRequestContext, type Page } from '@playwright/test';
import { test, expect, type SectionEncounter } from '../../core';
import { FAMILY_MEDICINE_INTAKE_ENCOUNTER_TYPE_UUID } from '../../core/constants';
import { getEncounterObs } from '../../commands';
import { SectionFormPage, ViewFormPage, expectViewShowsSavedObs } from '../../pages';

// section-review-of-systems.xml: heading + Next/Save/Cancel around subforms/review-of-systems.xml (Liberia-owned, see
// _shared.e2e.md): nine collapsible blocks of checkbox symptoms, each on its own "*exam findings" question concept, plus an
// "Other ... (comment)" checkbox with a comment input per block. On the visit page it is the `pihcore-review-of-systems`
// section of Family Medicine Intake and Followup (documentation/_availability.e2e.md); the specs open its edit URL directly
// on a Family Medicine Intake encounter. First written without a server (locators from the XML), then run and fixed against a local Liberia server: see README.md.
//
// Conditions, from documentation inventory (section-review-of-systems.inv.md) and _shared.e2e.md:
//   ifMode VIEW include=false  :3, :23           heading + script, and the #buttons row in ENTER/EDIT only
//   includeIf patient.gender == 'F'  (subform :189)   shows the "Gynecologic" block (female vs male patient, tested)
//   ifMode VIEW (subform :5-24)  VIEW forces .collapsible-content open (max-height none)
// Scripts: :9 setUpNextAndSubmitButtons(); mch.js (global): click on `.toggle-div` toggles `.open` on the next
//   `.collapsible-content`; in EDIT a block with a ticked box is opened at load (see _shared V7, V15).
// Side effects on save: none. Required fields: none.
// VIEW (getAsHtml.action): ticked symptoms are `[X] <label>` values, unticked ones are not values, the button row is absent.
// Not covered here: #next (needs the visit page), the comment input in VIEW (rendering unknown).
//
// Findings (the subform's own findings are recorded once in _shared.e2e.md):
//   see _shared V1 (Focal weakness = "Weakness"), V8 (women-only Perineal pain, "Genital ulcers"), V9 (raw-English message
//   codes, typos "Palpatations", "vertigo"), V14 (ROS answers share the exam-findings questions), V15 (blocks start closed)
//   V1 Low :3-6, :17-18  the heading "Review of Systems" is rendered twice in ENTER/EDIT (an h3 and the fieldset legend).
//                        Fix: drop the h3.

const FORM = 'section-review-of-systems.xml';

const BLOCKS = [
  'Cardiovascular',
  'Constitutional',
  'Endocrine',
  'Gastrointestinal',
  'Genitourinary',
  'Gynecologic',
  'Musculoskeletal',
  'Neurologic',
  'Respiratory',
];

// A block is a `.section-container` with a `.toggle-div` header and a `.collapsible-content` (subform).
const block = (page: Page, title: string) =>
  page.locator('.review-of-systems-subform .section-container').filter({ has: page.locator('.toggle-div', { hasText: title }) });

// Opens a block (they start closed, _shared V15) and returns it. A click only toggles, so do it only when closed.
const openBlock = async (page: Page, title: string) => {
  const b = block(page, title);
  await expect(b).toHaveCount(1);
  const content = b.locator('.collapsible-content');
  if (!(await content.evaluate((el) => el.classList.contains('open')))) {
    await b.locator('.toggle-div').click();
  }
  await expect(content).toHaveClass(/open/);
  return b;
};

// The checkbox labels are the answerCode / answerLabel texts (raw English, _shared V9); several appear in two blocks.
const box = (b: ReturnType<typeof block>, label: string) => b.getByLabel(label, { exact: true });

const saveForm = async (page: Page) => {
  const form = new SectionFormPage(page, FORM);
  await form.save();
  await form.expectSaved();
};

// Obs of the encounter with their comment (the "Other ... (comment)" boxes keep the typed text there).
const obsWithComment = async (api: APIRequestContext, encounterUuid: string) => {
  const res = await api.get(`obs?encounter=${encounterUuid}&v=custom:(display,comment)&limit=200`);
  expect(res.ok()).toBeTruthy();
  return (await res.json()).results as Array<{ display: string; comment: string | null }>;
};

test.describe('section-review-of-systems', () => {
  let section: SectionEncounter;

  test.beforeEach(async ({ page, createSectionEncounter }) => {
    section = await createSectionEncounter({
      encounterTypeUuid: FAMILY_MEDICINE_INTAKE_ENCOUNTER_TYPE_UUID,
      patient: { givenName: 'AutoRos', familyName: 'Tester', gender: 'F' },
    });
    await SectionFormPage.openEdit(page, FORM, section);
  });

  test('a female patient gets nine blocks, all closed', async ({ page }) => {
    // includeIf subform :189 (female) + mch.js: blocks without a saved symptom start closed
    await expect(page.locator('.review-of-systems-subform .section-container')).toHaveCount(9);
    for (const title of BLOCKS) {
      await expect(block(page, title)).toHaveCount(1);
      await expect(block(page, title).locator('.collapsible-content')).not.toHaveClass(/open/);
    }
  });

  test('a male patient gets eight blocks, without Gynecologic', async ({ page, createSectionEncounter }) => {
    // includeIf subform :189 (male)
    const male = await createSectionEncounter({
      encounterTypeUuid: FAMILY_MEDICINE_INTAKE_ENCOUNTER_TYPE_UUID,
      patient: { givenName: 'AutoRos', familyName: 'Tester', gender: 'M' },
    });
    await SectionFormPage.openEdit(page, FORM, male);
    await expect(page.locator('.review-of-systems-subform .section-container')).toHaveCount(8);
    await expect(block(page, 'Gynecologic')).toHaveCount(0);
    await expect(block(page, 'Genitourinary')).toHaveCount(1);
  });

  test('clicking a block header opens it and clicking again closes it', async ({ page }) => {
    // mch.js click handler on .toggle-div
    const content = block(page, 'Endocrine').locator('.collapsible-content');
    await block(page, 'Endocrine').locator('.toggle-div').click();
    await expect(content).toHaveClass(/open/);
    await block(page, 'Endocrine').locator('.toggle-div').click();
    await expect(content).not.toHaveClass(/open/);
  });

  test('saves a blank form and records nothing', async ({ page, api }) => {
    await saveForm(page);
    expect(await getEncounterObs(api, section.encounter.uuid)).toEqual([]);
  });

  test('the same answer in two blocks is a separate question: Weight loss and Syncope', async ({ page, api }) => {
    // Weight loss is in Constitutional (:76) and Endocrine (:105); Syncope in Cardiovascular (:48) and Neurologic (:271)
    const constitutional = await openBlock(page, 'Constitutional');
    const endocrine = await openBlock(page, 'Endocrine');
    await box(constitutional, 'Weight loss').check();
    await expect(box(endocrine, 'Weight loss')).not.toBeChecked();
    const neurologic = await openBlock(page, 'Neurologic');
    const cardiovascular = await openBlock(page, 'Cardiovascular');
    await box(neurologic, 'Syncope').check();
    await expect(box(cardiovascular, 'Syncope')).not.toBeChecked();
    await saveForm(page);

    const displays = (await getEncounterObs(api, section.encounter.uuid)).map((o) => o.display);
    expect(displays.filter((d) => /^General exam findings: Weight loss/i.test(d))).toHaveLength(1);
    expect(displays.filter((d) => /^Endocrine exam findings:/i.test(d))).toHaveLength(0);
    expect(displays.filter((d) => /^Neurologic exam findings: Syncope/i.test(d))).toHaveLength(1);
    expect(displays.filter((d) => /^Cardiac exam findings:/i.test(d))).toHaveLength(0);
  });

  test('saves symptoms and an "Other" comment, and EDIT shows them again with their blocks open', async ({ page, api }) => {
    await box(await openBlock(page, 'Cardiovascular'), 'Chest pain').check();
    await box(await openBlock(page, 'Constitutional'), 'Fever').check();
    const respiratory = await openBlock(page, 'Respiratory');
    await box(respiratory, 'Cough').check();
    await box(respiratory, 'Other respiratory (comment)').check();
    await respiratory.locator('input[type=text]').fill('Night wheeze');
    await box(await openBlock(page, 'Musculoskeletal'), 'Joint pain').check();
    await box(await openBlock(page, 'Neurologic'), 'Headache').check();
    await saveForm(page);

    const obs = await obsWithComment(api, section.encounter.uuid);
    const displays = obs.map((o) => o.display.toLowerCase());
    for (const symptom of ['chest pain', 'fever', 'cough', 'joint pain', 'headache']) {
      expect(displays.some((d) => d.includes(symptom)), symptom).toBeTruthy();
    }
    expect(obs.some((o) => /respiratory/i.test(o.display) && o.comment === 'Night wheeze')).toBeTruthy();

    // mch.js: in EDIT a block with a ticked box is open at load, one without stays closed
    await SectionFormPage.openEdit(page, FORM, section);
    for (const title of ['Cardiovascular', 'Constitutional', 'Respiratory', 'Musculoskeletal', 'Neurologic']) {
      await expect(block(page, title).locator('.collapsible-content')).toHaveClass(/open/);
    }
    await expect(block(page, 'Endocrine').locator('.collapsible-content')).not.toHaveClass(/open/);
    await expect(box(block(page, 'Cardiovascular'), 'Chest pain')).toBeChecked();
    await expect(box(block(page, 'Cardiovascular'), 'Syncope')).not.toBeChecked();
    await expect(box(block(page, 'Respiratory'), 'Other respiratory (comment)')).toBeChecked();
    await expect(block(page, 'Respiratory').locator('input[type=text]')).toHaveValue('Night wheeze');

    // VIEW: the "Other" answer is labelled by answerLabel, not by its concept name (obs display -> text shown)
    const labels: Record<string, string> = {};
    for (const o of obs) {
      if (/Review of systems, respiratory \(comment\)/i.test(o.display)) {
        labels[o.display] = '[X] Other respiratory (comment)';
      }
    }
    const view = await expectViewShowsSavedObs(page, api, FORM, section.encounter.uuid, labels);
    expect(await view.valueTexts()).toEqual(
      expect.arrayContaining(['[X] Chest pain', '[X] Fever', '[X] Cough', '[X] Joint pain', '[X] Headache']),
    );
    await expect(block(view.page, 'Cardiovascular').locator('.value')).toHaveText(['[X] Chest pain']);
    await expect(block(view.page, 'Endocrine').locator('.value')).toHaveCount(0);
    await expect(block(view.page, 'Gynecologic').locator('.value')).toHaveCount(0);
    // ifMode VIEW (subform :5-24): every block is forced open
    await expect(block(view.page, 'Endocrine').locator('.collapsible-content')).toHaveCSS('max-height', 'none');
    // ifMode VIEW include=false (:3, :23): no heading and no buttons
    await expect(view.page.locator('#buttons, #submit, #next, #cancel')).toHaveCount(0);
    await expect(view.page.locator('h3', { hasText: 'Review of Systems' })).toHaveCount(0);
  });

  test('VIEW: a form with nothing saved shows no value', async ({ page }) => {
    await saveForm(page);
    const view = await ViewFormPage.open(page, FORM, section.encounter.uuid);
    await expect(view.values).toHaveCount(0);
    await expect(view.page.locator('.review-of-systems-subform .section-container')).toHaveCount(9);
  });
});

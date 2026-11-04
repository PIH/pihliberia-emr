import { type Page } from '@playwright/test';
import { test, expect, type SectionEncounter } from '../../core';
import { NCD_FOLLOWUP_ENCOUNTER_TYPE_UUID } from '../../core/constants';
import { getEncounterObs } from '../../commands';
import { SectionFormPage, expectViewShowsSavedObs, VISIT_PAGE_URL } from '../../pages';

// section-ncd-plan.xml: the "Plan" section of an NCD encounter: treatment plan, lab test orders, radiology / EKG / echo findings,
// medication orders, new clinical impressions (NCD categories) and next appointment + disposition. On the visit page it is the
// `pihcore-ncd-plan` section of NCD Initial and NCD Followup encounters (_availability.e2e.md "Sections"); the specs create an NCD
// Followup encounter over REST and open the edit URL directly, which skips that gating.
// First written without a server (locators from the XML), then run and fixed against a local Liberia server: see README.md.
//
// Conditions in the form, from documentation inventory (section-ncd-plan.inv.md):
//   ifMode VIEW include=false  :29, :381   heading; Save / Cancel (<submit> tag: input.submitButton, there is no #submit)
//   toggle PIH:NCD category    :307        9 categories, target {nickname}-onset-date exists nowhere in this form (V3)
//   ifMode EDIT                :337        disposition CSS only (inside <style>)
// Scripts: none of its own. onLoadFunction="renderOrderWidgetAsCheckboxes" (:70, see _shared) renders the 30 lab tests as checkboxes.
//   encounterDisposition (:367): extra field per choice; the Liberia list (pih-dispositions-liberia.json) offers Admission, ED
//   Observation, Transfer out of hospital and Transfer within hospital (no Discharge, no Death).
// Side effects on save: postSubmissionAction ApplyDispositionAction (:3) and SetOrderAutoExpireDateAction (:4). No enrollInProgram.
// Not covered here: saving a lab order (an encounter with an order cannot be purged over REST), medication orders (drug-order widget, see
//   _shared), saving a disposition (Admission / Transfer have real effects on the visit), order revise/discontinue.
// EDIT is covered by the save test (saved values reopened); VIEW by the same test plus a heading/buttons test.
//
// Findings (V1.. High -> Low):
//   V1 High   :162-183  the Bone X-ray group stores its findings under conceptId CIEL:12 "Chest (X-ray)" (copy of the chest group); only the
//                       hidden "Radiology procedure performed" = Other bone (XRay) (PIH:12556) tells them apart -> any report or view
//                       reading Chest (X-ray) also gets bone findings. Fix: a coded bone X-ray question concept (PIH:12556 is datatype N/A).
//                       (TESTED below with test.fail)
//   V2 Low    :35, :281 two <section id="drug-orders">: the Treatment plan and the medications. Fix: id="treatment-plan-section" on :35.
//   V3 Low    :307      the category template is copied from the history section: toggle="{nickname}-onset-date" has no target here (9 dead
//                       toggles, same as section-ncd-followup outside NCD Initial). Fix: drop toggle.
//   V4 Low    :49       `padding-top padding-bottom: 0px;` (missing colon) is invalid CSS and is ignored.

const FORM = 'section-ncd-plan.xml';

// This form ends with <submit>: it renders input.submitButton and no #submit, so SectionFormPage.openEdit()/save() cannot be used.
const openPlan = async (page: Page, section: SectionEncounter) => {
  await page.goto(SectionFormPage.editUrl(FORM, section));
  await expect(page.locator('#treatment-plan textarea')).toBeVisible();
  await expect(page.locator('#buttons input.submitButton')).toBeVisible();
};
const savePlan = async (page: Page) => {
  await page.locator('#buttons input.submitButton').click();
  await expect(page).toHaveURL(VISIT_PAGE_URL);
};

// Read-only jQuery UI datepicker; setDate also updates the hidden field that is submitted.
const setDate = (page: Page, wrapper: string, date: Date) =>
  page.evaluate(
    ([w, ms]) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).jq(`${w} input.hasDatepicker`).datepicker('setDate', new Date(ms as number));
    },
    [wrapper, date.getTime()],
  );

const pad = (n: number) => String(n).padStart(2, '0');

test.describe('section-ncd-plan', () => {
  let section: SectionEncounter;

  test.beforeEach(async ({ page, createSectionEncounter }) => {
    section = await createSectionEncounter({
      encounterTypeUuid: NCD_FOLLOWUP_ENCOUNTER_TYPE_UUID,
      patient: { givenName: 'AutoPlan', familyName: 'Tester', gender: 'F' },
    });
    await openPlan(page, section);
  });

  test('renders the lab tests as checkboxes and the Save and Cancel buttons in EDIT mode', async ({ page }) => {
    // onLoadFunction :70, ifMode :381
    await expect(page.locator('#test-orders input[type=checkbox]')).toHaveCount(30);
    await expect(page.locator('#buttons input.submitButton')).toBeVisible();
    await expect(page.locator('#buttons button.cancel')).toBeVisible();
    await expect(page.locator('h1:not(.name)')).toBeVisible(); // ifMode :29, heading in ENTER/EDIT only
  });

  // encounterDisposition :367: the extra field per disposition (nothing is saved here)
  const dispositions = [
    { label: 'Transfer within hospital', field: '#transferInternalLocation' },
    { label: 'Transfer out of hospital', field: '#transferExternalLocation' },
  ];
  test('the disposition shows the transfer location only for the matching choice', async ({ page }) => {
    const select = page.locator('#disposition select').first();
    for (const d of dispositions) {
      await expect(page.locator(d.field), `${d.field} starts hidden`).toBeHidden();
    }
    for (const d of dispositions) {
      await select.selectOption({ label: d.label });
      for (const other of dispositions) {
        if (other === d) {
          await expect(page.locator(other.field), `${d.label} shows ${other.field}`).toBeVisible();
        } else {
          await expect(page.locator(other.field), `${d.label} hides ${other.field}`).toBeHidden();
        }
      }
    }
    await select.selectOption({ label: 'ED Observation' });
    for (const d of dispositions) {
      await expect(page.locator(d.field)).toBeHidden();
    }
  });

  test('ticking an NCD category in the new clinical impressions shows no onset date (V3)', async ({ page }) => {
    // toggle :307 has no target here
    await page.locator('#diabetes-onset-q input[type=checkbox]').check();
    await expect(page.locator('#diabetes-onset-date')).toHaveCount(0);
  });

  test.fail('V1 a Bone X-ray finding is not stored under the Chest (X-ray) question', async ({ page, api }) => {
    // :175 conceptId="CIEL:12" inside the bone group; remove test.fail() when fixed
    await page.getByLabel('Avascular necrosis of hip', { exact: true }).check();
    await savePlan(page);
    const obs = await getEncounterObs(api, section.encounter.uuid);
    expect(obs.length).toBeGreaterThan(0);
    expect(obs.filter((o) => /chest/i.test(o.concept.display))).toEqual([]);
  });

  test('saves the plan, a chest X-ray, the new clinical impression and the next appointment', async ({ page, api }) => {
    const nextYear = new Date();
    nextYear.setFullYear(nextYear.getFullYear() + 1);

    await page.locator('#treatment-plan textarea').fill('Start amlodipine and review in a month');
    await page.getByLabel('Normal', { exact: true }).first().check(); // chest X-ray findings (first group)
    await page.locator('#diabetes-onset-q input[type=checkbox]').check();
    await page.locator('#clinical-impress textarea').fill('Poorly controlled diabetes');
    await setDate(page, '#apptDate', nextYear);
    await savePlan(page);

    const obs = await getEncounterObs(api, section.encounter.uuid);
    const displays = obs.map((o) => `${o.concept.display}: ${o.display}`.toLowerCase());
    const values = obs.map((o) => String(o.value));
    expect(values).toContain('Start amlodipine and review in a month');
    expect(values).toContain('Poorly controlled diabetes');
    expect(displays.some((d) => d.includes('diabetes'))).toBeTruthy();
    expect(displays.some((d) => d.includes('chest') && d.includes('normal'))).toBeTruthy();
    expect(displays.some((d) => d.includes(String(nextYear.getFullYear())))).toBeTruthy(); // return visit date

    // EDIT starts from the saved values
    await openPlan(page, section);
    await expect(page.locator('#treatment-plan textarea')).toHaveValue('Start amlodipine and review in a month');
    await expect(page.locator('#diabetes-onset-q input[type=checkbox]')).toBeChecked();
    await expect(page.locator('#clinical-impress textarea')).toHaveValue('Poorly controlled diabetes');

    // VIEW: the plan, the chest X-ray finding, the clinical impression and the return visit date; the lab tests and the
    // disposition were not touched, so they show no value. The hidden "Radiology procedure performed" obs of the X-ray group is
    // set by the form, not shown.
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const apptText = `${pad(nextYear.getDate())} ${months[nextYear.getMonth()]} ${nextYear.getFullYear()}`;
    const apptIso = `${nextYear.getFullYear()}-${pad(nextYear.getMonth() + 1)}-${pad(nextYear.getDate())}`;
    const view = await expectViewShowsSavedObs(page, api, FORM, section.encounter.uuid, {
      'Radiology procedure performed: Chest (X-ray)': '',
      [`Return visit date: ${apptIso}`]: apptText, // a date-only value: the helper compares only text, number and coded values
    });
    const shown = await view.valueTexts();
    expect(shown).toContain('Start amlodipine and review in a month');
    expect(shown).toContain('[X] Normal');
    expect(shown).toContain('[X] Diabetes');
    expect(shown).toContain('Poorly controlled diabetes');
    await expect(view.page.locator('#apptDate .value')).toHaveText(apptText);
    await expect(view.page.locator('#test-orders .value, #disposition .value')).toHaveCount(0);
  });

  // VIEW: ifMode VIEW include=false (:29 heading, :381 buttons) must be absent.
  test('VIEW: shows no heading, no Save / Cancel and no value for an untouched form', async ({ page, api }) => {
    await page.locator('#treatment-plan textarea').fill('Only a plan');
    await savePlan(page);

    const view = await expectViewShowsSavedObs(page, api, FORM, section.encounter.uuid);
    expect(await view.valueTexts()).toContain('Only a plan');
    await expect(view.page.locator('h1')).toHaveCount(0);
    await expect(view.page.locator('#buttons, input.submitButton, button.cancel')).toHaveCount(0);
    await expect(view.page.locator('#clinical-impress .value, #radiology-orders .value')).toHaveCount(0);
  });
});

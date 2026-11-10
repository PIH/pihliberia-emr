// med-order.xml (formName "OB-GYN Plan"): the "Medication" section (section id `section-obgyn-plan`, `medOrder` in encounterTypeConfig.js) of the ANC Intake, ANC Followup and
// MCH Delivery encounters: a "Plan" heading, the drug-order widget (shared drug-order-widget.xml, see _shared: "Add Medication" opens a new-order row) and Save / Cancel. It has no
// formEncounterType and no obs of its own. Tested as a section on one parent, an ANC Intake encounter created over REST for a female patient, opened with its edit URL (SectionFormPage.editUrl);
// ANC Followup and MCH Delivery parents (_availability.e2e.md "Sections") use the same URL and the form does not branch on the encounter type, so they are not repeated.
// The section pencil and the vaccinations widget that follows it are not exercised. VIEW: the visit page's `section-obgyn-plan` entry of the ANC Intake
// shows the form's VIEW (templateModelUrl active, viewSectionWithHtmlFormLong), and the VIEW test opens it there.
// First written without a server (locators from the XML), then run and fixed against a local Liberia server: see README.md.
//
// Conditions in the form, from documentation inventory (med-order.inv.md):
//   ifMode VIEW include=false :56 (script), :157 (h1 "Plan"), :170 (#buttons). No when / toggle / includeIf.
// Scripts: :59-114 htmlForm.getBeforeValidation rule on `fieldset.medication` (medication without drug, dose without units, duration without units and the reverse; messages
//   pihcore.visitNote.plan.medications.error.*), :116-152 "show more / less medications" for #medication-2..8. None of those elements exists in this form (the drug-order widget
//   replaced the medication fieldsets): the script is dead (V1).
// Side effects on save: postSubmissionAction ApplyDispositionAction :4 (nothing to apply: no disposition field here). The drug order itself: action NEW, saved with the encounter.
// Not covered here: revising, renewing or discontinuing an order and the quantity calculator (they need an active order from an earlier encounter), a lab order (not saved by these specs).
// VIEW: no obs of its own; the visit page runs the form's scripts, so the VIEW test after the save checks that the order is drawn and that the
//   ifMode VIEW include=false parts (h1, buttons) are absent from the section's long view.
//
// Findings (V1.. Low; V2 is in _shared):
//   V1 Low    :56-155  dead script, see above: the validation never runs, so a dose without units etc. is not caught by this form (the order widget has its own checks).
//                      Fix: delete the script, or port the rules to the order widget fields.
//   V2 Low    :2  formUuid 3616e6be-... is also the formUuid of pihemr's section-obgyn-plan_v1.0.xml: see _shared V2.

import { test, expect, type SectionEncounter } from '../../core';
import { ANC_INTAKE_ENCOUNTER_TYPE_UUID } from '../../core/constants';
import { getEncounterObs } from '../../commands';
import { SectionFormPage, ViewFormPage } from '../../pages';

const FORM = 'med-order.xml';

// The form ends with <submit>: it renders input.submitButton and no #submit, so SectionFormPage.openEdit()/save() cannot be used.
const SUBMIT = '#buttons input.submitButton';

test.describe('med-order', () => {
  let section: SectionEncounter;

  test.beforeEach(async ({ page, createSectionEncounter }) => {
    section = await createSectionEncounter({
      encounterTypeUuid: ANC_INTAKE_ENCOUNTER_TYPE_UUID,
      patient: { givenName: 'AutoMedOrder', familyName: 'Tester', gender: 'F' },
    });
    await page.goto(SectionFormPage.editUrl(FORM, section));
    // ifMode VIEW include=false :170 renders the buttons in EDIT mode
    await expect(page.locator(SUBMIT)).toBeVisible();
  });

  test('renders the Plan heading, the "Add Medication" button of the order widget and Save / Cancel', async ({ page }) => {
    // ifMode VIEW include=false :157 (h1), :170 (buttons); drug-order-widget.xml (see _shared)
    await expect(page.locator('#htmlform h1')).toHaveText('Plan');
    await expect(page.locator('#drug-orders')).toBeVisible();
    await expect(page.locator('#order-action-button-NEW')).toBeVisible();
    await expect(page.locator('#buttons button.cancel')).toBeVisible();
    await expect(page.locator('#submit')).toHaveCount(0); // <submit> renders input.submitButton instead
  });

  test('saves with no order: back on the visit page, no order and no obs', async ({ page, api }) => {
    await page.locator(SUBMIT).click();
    await new SectionFormPage(page, FORM).expectSaved();

    const res = await api.get(`order?patient=${section.patient.uuid}&v=custom:(uuid)`);
    expect(res.ok()).toBeTruthy();
    expect((await res.json()).results).toHaveLength(0);
    expect(await getEncounterObs(api, section.encounter.uuid)).toHaveLength(0);
  });

  test('saves a new medication order; VIEW renders without the heading and buttons', async ({ page, api }) => {
    // "Add Medication" (shared drug-order-widget) opens a new-order row
    await page.locator('#order-action-button-NEW').click();
    const row = page.locator('#drug-orders .orderwidget-order-form:visible');
    await row.locator('.order-drug input.orderwidget-autocomplete-textbox').fill('Acetylsalicylic');
    await page.locator('.ui-autocomplete .ui-menu-item').first().click();
    await row.locator('.order-dose input').fill('1');
    await row.locator('.order-doseUnits select').selectOption({ index: 1 });
    await row.locator('.order-frequency select').selectOption({ index: 1 });
    await row.locator('.order-duration input').fill('5'); // days (default unit)
    await row.locator('.order-quantity input').fill('10');
    await row.locator('.order-quantityUnits select').selectOption({ index: 1 }); // required with a quantity (w50_1 "Required" otherwise)
    await page.locator(SUBMIT).click();
    await new SectionFormPage(page, FORM).expectSaved();

    const res = await api.get(`order?patient=${section.patient.uuid}&v=custom:(uuid,action,drug:(display))`);
    expect(res.ok()).toBeTruthy();
    const orders = (await res.json()).results as Array<{ uuid: string; action: string; drug: { display: string } | null }>;
    expect(orders.map((o) => o.action)).toEqual(['NEW']);
    expect(orders[0].drug?.display).toMatch(/acetylsalicylic/i);

    // VIEW: nothing of the form is a saved value (the order is drawn by the widget); ifMode VIEW include=false :157, :170
    const view = await ViewFormPage.open(page, FORM, section.encounter.uuid);
    await expect(view.root.locator('#drug-orders')).toContainText(/acetylsalicylic/i); // drawn by orderWidget.js from the saved order
    await expect(view.root.locator('h1')).toHaveCount(0);
    await expect(view.root.locator('#buttons, input.submitButton')).toHaveCount(0);
  });
});

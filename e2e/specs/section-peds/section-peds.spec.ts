import { type APIRequestContext, type Page } from '@playwright/test';
import { test, expect, birthdateYearsAgo, type SectionEncounter } from '../../core';
import { FAMILY_MEDICINE_FOLLOWUP_ENCOUNTER_TYPE_UUID, FAMILY_MEDICINE_INTAKE_ENCOUNTER_TYPE_UUID } from '../../core/constants';
import { SectionFormPage, ViewFormPage, VisitPage, expectViewShowsSavedObs } from '../../pages';

// section-peds.xml (pihemr): "Pediatrics feeding and supplements": a supplements table (six checkbox + free-text age rows) and a
// feeding-history table (four Yes / No checkbox pairs + free-text age) with a comment. On the visit page it is the `pihcore-peds` section of Family
// Medicine Intake and Followup (after the vaccinations widget), shown only when the patient is under 15 years at visit start
// (`require: fullMonthsBetweenDates(visit.patient.person.birthdate, visit.startDatetime) < 15*12`, encounterTypeConfig.js :105-114;
// _availability.e2e.md "Sections"). The specs create the parent encounter over REST for a 3-year-old and open the section's edit URL directly (skips
// that gating; the form itself has no age or encounter-type condition, so each parent is only smoke-tested); the visit-page tests check the
// `require` on both sides of the age limit. Runs on the local Liberia server (Harper stack).
//
// Conditions in the form, from documentation inventory (section-peds.inv.md):
//   ifMode VIEW include=false :115, :162, :249   the two <h2> headings and the #buttons row (Next, Save, Cancel); absent in VIEW
// Scripts (both on page load and, for the handlers, on change of the checkbox; they run in EDIT too):
//   :17-79 feeding rows: ticking a `.yes-feeding` box enables the row's `.ageReceived` input (focus) and unticks the row's
//          `.no-feeding` box; ticking `.no-feeding` clears and disables the age and unticks Yes; unticking Yes clears and disables
//          the age. A row whose Yes is unticked starts disabled (also in EDIT, from the saved state). Last line :75 is
//          setUpNextAndSubmitButtons() (_shared.e2e.md).
//   :80-114 supplement rows: ticking a `.supplement` box enables the row's age input; unticking clears and disables it.
//   A disabled input is not submitted, so an age without its tick is never saved.
// Side effects on save: none (no postSubmissionAction, program, order). Nothing is required.
// VIEW is tested on the visit page, which shows the section's own VIEW (`pihcore-peds` has an active templateModelUrl and
//   `viewSectionWithHtmlFormLong.page`): expectViewShowsSavedObs. The feeding Yes/No boxes have answerCode="" (the row label is the first cell), so a
//   ticked box is a bare `[X]`: their obs are listed with an empty label in VIEW_LABELS.
// Findings: see pihemr _findings.e2e.md#section-chief-complaint.xml, section-peds.xml (none).
// Not covered here: #next (moves to the next section of the parent entry form, needs the entry form).

const FORM = 'section-peds.xml';

// Feeding Yes/No boxes render as a bare "[X]": no label to look for (obs display -> '' = do not look for it).
const VIEW_LABELS: Record<string, string> = {
  'Infant feeding method: Breastfed exclusively': '',
  'Feeding method absent: Infant formula': '',
};

const PARENTS = [
  { name: 'Family Medicine Intake', uuid: FAMILY_MEDICINE_INTAKE_ENCOUNTER_TYPE_UUID },
  { name: 'Family Medicine Followup', uuid: FAMILY_MEDICINE_FOLLOWUP_ENCOUNTER_TYPE_UUID },
];

// Locators. Supplement rows are found by the id of their checkbox's span; feeding rows by their label cell.
const supplement = (page: Page, id: string) => ({
  box: page.locator(`#${id} input[type=checkbox]`),
  age: page.locator(`tr:has(#${id}) .ageReceived input[type=text]`),
});
const feeding = (page: Page, label: string) => {
  const row = page.locator('#feeding tr', { has: page.locator(`td:text-is("${label}")`) });
  return {
    yes: row.locator('.yes-feeding input[type=checkbox]'),
    no: row.locator('.no-feeding input[type=checkbox]'),
    age: row.locator('.ageReceived input[type=text]'),
  };
};

// Saved obs groups of the test encounter: each group as its sorted member displays, the groups sorted (HFE's order is not stable).
const groupsOf = async (api: APIRequestContext, encounterUuid: string): Promise<string[][]> => {
  const res = await api.get(`obs?encounter=${encounterUuid}&v=custom:(groupMembers:(display))&limit=200`);
  expect(res.ok(), `get obs: ${res.status()}`).toBeTruthy();
  return ((await res.json()).results as Array<{ groupMembers: Array<{ display: string }> | null }>)
    .filter((o) => o.groupMembers && o.groupMembers.length > 0)
    .map((o) => o.groupMembers!.map((m) => m.display).sort())
    .sort((a, b) => a.join('|').localeCompare(b.join('|')));
};
const commentOf = async (api: APIRequestContext, encounterUuid: string): Promise<string[]> => {
  const res = await api.get(`obs?encounter=${encounterUuid}&v=custom:(display,value)&limit=200`);
  return ((await res.json()).results as Array<{ display: string }>).map((o) => o.display).filter((d) => d.startsWith('Feeding method comment'));
};

const save = async (page: Page) => {
  await new SectionFormPage(page, FORM).save();
  await new SectionFormPage(page, FORM).expectSaved();
};

test.describe('section-peds', () => {
  let section: SectionEncounter;

  test.beforeEach(async ({ page, createSectionEncounter }) => {
    section = await createSectionEncounter({
      encounterTypeUuid: FAMILY_MEDICINE_INTAKE_ENCOUNTER_TYPE_UUID,
      patient: { givenName: 'AutoPeds', familyName: 'Tester', gender: 'F', birthdate: birthdateYearsAgo(3) },
    });
    await SectionFormPage.openEdit(page, FORM, section);
  });

  test('ENTER/EDIT shows both tables, the headings and the Next, Save and Cancel buttons', async ({ page }) => {
    // ifMode VIEW include=false :115, :162, :249
    await expect(page.locator('h2')).toHaveCount(2);
    await expect(page.locator('#supplements tbody tr')).toHaveCount(6);
    await expect(page.locator('#feeding tbody tr')).toHaveCount(5); // four feeding rows + the comment row
    await expect(page.locator('#next')).toBeVisible();
    await expect(page.locator('#submit')).toBeVisible();
    await expect(page.locator('#cancel')).toBeVisible();
  });

  test('a supplement age is disabled until its box is ticked and is cleared when it is unticked', async ({ page }) => {
    // script :80-114 (supplement rows)
    const vitaminA = supplement(page, 'vitamin-a');
    await expect(vitaminA.age).toBeDisabled();
    await vitaminA.box.check();
    await expect(vitaminA.age).toBeEnabled();
    await vitaminA.age.fill('6');
    await vitaminA.box.uncheck();
    await expect(vitaminA.age).toBeDisabled();
    await expect(vitaminA.age).toHaveValue('');
    // another row is not affected
    await expect(supplement(page, 'zinc').age).toBeDisabled();
  });

  test('feeding: Yes enables the age and unticks No; No clears the age, disables it and unticks Yes', async ({ page }) => {
    // script :17-79 (feeding rows)
    const row = feeding(page, 'Infant Formula');
    await expect(row.age).toBeDisabled();
    await row.no.check();
    await row.yes.check();
    await expect(row.no).not.toBeChecked();
    await expect(row.age).toBeEnabled();
    await row.age.fill('3 months');
    await row.no.check();
    await expect(row.yes).not.toBeChecked();
    await expect(row.age).toBeDisabled();
    await expect(row.age).toHaveValue('');
    // unticking Yes clears and disables the age too
    await row.yes.check();
    await row.age.fill('2');
    await row.yes.uncheck();
    await expect(row.age).toBeDisabled();
    await expect(row.age).toHaveValue('');
    // the other rows are not affected
    await expect(feeding(page, 'Mixed Feeding').age).toBeDisabled();
  });

  test('saves with nothing filled (nothing is required) and records no obs', async ({ page, api }) => {
    await save(page);
    expect(await groupsOf(api, section.encounter.uuid)).toEqual([]);
  });

  test('saves the supplements, the feeding history and the comment; EDIT starts from the saved state; VIEW shows them', async ({ page, api }) => {
    await supplement(page, 'vitamin-a').box.check();
    await supplement(page, 'vitamin-a').age.fill('6');
    await supplement(page, 'zinc').box.check(); // ticked without an age
    await feeding(page, 'Breastfeed exclusively').yes.check();
    await feeding(page, 'Breastfeed exclusively').age.fill('4');
    await feeding(page, 'Infant Formula').no.check();
    await page.locator('#feeding textarea').fill('Weaned early');
    await save(page);

    expect(await groupsOf(api, section.encounter.uuid)).toEqual([
      ['Age supplement received: 6', 'Supplement received: Vitamin A'],
      ['Feeding method absent: Infant formula'],
      ['Feeding method age: 4', 'Infant feeding method: Breastfed exclusively'],
      ['Supplement received: Zinc'],
    ]);
    expect(await commentOf(api, section.encounter.uuid)).toEqual(['Feeding method comment (text): Weaned early']);

    // EDIT: script :17-114 re-applies the state of each row from the saved values
    await SectionFormPage.openEdit(page, FORM, section);
    await expect(supplement(page, 'vitamin-a').box).toBeChecked();
    await expect(supplement(page, 'vitamin-a').age).toBeEnabled();
    await expect(supplement(page, 'vitamin-a').age).toHaveValue('6');
    await expect(supplement(page, 'zinc').age).toBeEnabled();
    await expect(supplement(page, 'vitamin-k').age).toBeDisabled();
    await expect(feeding(page, 'Breastfeed exclusively').yes).toBeChecked();
    await expect(feeding(page, 'Breastfeed exclusively').age).toHaveValue('4');
    await expect(feeding(page, 'Infant Formula').no).toBeChecked();
    await expect(feeding(page, 'Infant Formula').age).toBeDisabled();
    await expect(page.locator('#feeding textarea')).toHaveValue('Weaned early');

    // VIEW on the visit page (ifMode VIEW include=false: no headings, no buttons)
    const view = await expectViewShowsSavedObs(page, api, FORM, section.encounter.uuid, VIEW_LABELS);
    const shown = await view.valueTexts();
    expect(shown).toEqual(expect.arrayContaining(['[X] Vitamin A', '6', '[X] Zinc', '4', 'Weaned early']));
    await expect(view.root.locator('#vitamin-a .value')).toHaveText('[X] Vitamin A');
    await expect(view.root.locator('#vitamin-k .value')).toHaveCount(0);
    await expect(view.root.locator('#vitamin-k .emptyValue')).toHaveCount(1);
    await expect(view.root.locator('#breastfeeding-yes .value')).toHaveCount(1);
    await expect(view.root.locator('#breastfeedAge .value')).toHaveText('4');
    // Infant Formula row: Yes empty, No ticked, age empty; Mixed Feeding row: nothing
    const formula = view.root.locator('#feeding tr', { has: view.page.locator('td:text-is("Infant Formula")') });
    await expect(formula.locator('.yes-feeding .value')).toHaveCount(0);
    await expect(formula.locator('.no-feeding .value')).toHaveCount(1);
    await expect(formula.locator('.ageReceived .value')).toHaveCount(0);
    const mixed = view.root.locator('#feeding tr', { has: view.page.locator('td:text-is("Mixed Feeding")') });
    await expect(mixed.locator('.value')).toHaveCount(0);
    await expect(view.root.locator('h2')).toHaveCount(0);
    await expect(view.page.locator('#buttons, #submit, #next, #cancel')).toHaveCount(0);
  });

  test('EDIT: unticking a saved supplement and a saved feeding answer removes their obs', async ({ page, api }) => {
    await supplement(page, 'iodine').box.check();
    await supplement(page, 'iodine').age.fill('1');
    await feeding(page, 'Mixed Feeding').yes.check();
    await feeding(page, 'Mixed Feeding').age.fill('5');
    await save(page);
    expect(await groupsOf(api, section.encounter.uuid)).toHaveLength(2);

    await SectionFormPage.openEdit(page, FORM, section);
    await supplement(page, 'iodine').box.uncheck(); // script clears the age as well
    await feeding(page, 'Mixed Feeding').yes.uncheck();
    await save(page);
    expect(await groupsOf(api, section.encounter.uuid)).toEqual([]);

    const view = await ViewFormPage.open(page, FORM, section.encounter.uuid);
    await expect(view.values).toHaveCount(0);
  });

  test('an age typed and then hidden by unticking its box is not saved', async ({ page, api }) => {
    // scripts :17-114 disable (and clear) the age, and a disabled input is not submitted
    await supplement(page, 'deworming').box.check();
    await supplement(page, 'deworming').age.fill('9');
    await supplement(page, 'deworming').box.uncheck();
    await save(page);
    expect(await groupsOf(api, section.encounter.uuid)).toEqual([]);
  });
});

test.describe('section-peds under each Family Medicine parent', () => {
  for (const parent of PARENTS) {
    test(`opens and saves under ${parent.name}`, async ({ page, api, createSectionEncounter }) => {
      // The form has no encounter-type branch: the same fields and save under every parent.
      const section = await createSectionEncounter({
        encounterTypeUuid: parent.uuid,
        patient: { givenName: 'AutoPeds', familyName: 'Tester', gender: 'M', birthdate: birthdateYearsAgo(3) },
      });
      await SectionFormPage.openEdit(page, FORM, section);
      await feeding(page, 'Stopped breastfeeding').yes.check();
      await feeding(page, 'Stopped breastfeeding').age.fill('12');
      await save(page);
      expect(await groupsOf(api, section.encounter.uuid)).toEqual([['Feeding method age: 12', 'Infant feeding method: Weaned']]);
    });
  }
});

// The `require` of the `pihcore-peds` section (encounterTypeConfig.js :113): the patient is under 15 years (full months < 180) at the start of the visit.
// The fixture's visit starts a minute ago; birthdateYearsAgo(n) is n years and two days ago.
test.describe('section-peds on the visit page (require: under 15 at visit start)', () => {
  const cases = [
    { parent: 'Family Medicine Intake', uuid: FAMILY_MEDICINE_INTAKE_ENCOUNTER_TYPE_UUID, years: 3, shown: true },
    { parent: 'Family Medicine Followup', uuid: FAMILY_MEDICINE_FOLLOWUP_ENCOUNTER_TYPE_UUID, years: 3, shown: true },
    { parent: 'Family Medicine Followup', uuid: FAMILY_MEDICINE_FOLLOWUP_ENCOUNTER_TYPE_UUID, years: 14, shown: true },
    { parent: 'Family Medicine Followup', uuid: FAMILY_MEDICINE_FOLLOWUP_ENCOUNTER_TYPE_UUID, years: 15, shown: false },
    { parent: 'Family Medicine Intake', uuid: FAMILY_MEDICINE_INTAKE_ENCOUNTER_TYPE_UUID, years: 30, shown: false },
  ];
  for (const c of cases) {
    test(`${c.parent}, patient aged ${c.years}: the peds section is ${c.shown ? 'listed' : 'not listed'}`, async ({ page, createSectionEncounter }) => {
      const s = await createSectionEncounter({
        encounterTypeUuid: c.uuid,
        patient: { givenName: 'AutoPeds', familyName: 'Tester', gender: 'F', birthdate: birthdateYearsAgo(c.years) },
      });
      const visit = await VisitPage.openOfEncounter(page, s.encounter.uuid);
      await visit.expand(visit.encounterOfType(c.uuid));
      const ids = await visit.shownSectionIds();
      if (c.shown) {
        expect(ids).toContain('pihcore-peds');
        // order of the sections: the vaccinations widget, then peds, then the diagnosis and the plan
        expect(ids.indexOf('pihcore-peds')).toBeGreaterThan(ids.indexOf('vaccinations'));
        expect(ids.indexOf('pihcore-peds')).toBeLessThan(ids.indexOf('pihcore-diagnosis'));
        expect(ids.indexOf('pihcore-diagnosis')).toBeLessThan(ids.indexOf('pihcore-plan'));
      } else {
        expect(ids).not.toContain('pihcore-peds');
        expect(ids).toContain('pihcore-plan'); // the other sections are not affected
      }
    });
  }
});

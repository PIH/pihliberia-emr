// section-exam.xml: "Examen physique" (physical exam: a normal/abnormal checkbox block per body system, women's, postpartum and
// paediatric blocks). UNREFERENCED in Liberia (_availability.e2e.md "Sections": no Liberia encounter type shows it), so the specs
// create an NCD Initial Consult encounter over REST (SectionEncounter) and open the edit URL directly.
// First written without a server (locators from the XML), then run and fixed against a local Liberia server: see README.md.
//
// Conditions in the form, from documentation inventory (section-exam.inv.md):
//   includeIf type is OB/GYN, PMTCT Intake or PMTCT Followup :258, :277, :649, :921  #urology, #gynecology, #postpartum + their
//     shortcut links; the complement :249, :607 renders #uro instead (NCD Initial: #uro). The three types exist in encounterTypes.csv
//   includeIf female :269, :808  #women (obstetric exam) and its shortcut; includeIf age < 15 :293, :1208  #peds (+ #gross, #fine,
//     #lang, #social); age < 6 :1214  the Denver test radio
//   when #involution Abnormal :995 -> #abnormal-involution (only inside #postpartum, so OB/GYN/PMTCT encounters)
//   ifMode VIEW include=false :168, :217, :1409  heading + script, the .shortcuts links, #buttons; ifMode VIEW :92, :209  CSS and hideIfEmpty
// Scripts: :173-205 .normalObs / .abnormalObs change handlers: checking a normal box unchecks the .abnormalObs boxes of the same
//   .exam container and vice versa; :811-844 (female) fetus rows: #fetus-2..4 hidden on load, #show-more/less-fetus-button toggle
//   them; :212 hideIfEmpty(".section-container-color") in VIEW (_shared). Navigation: setUpNextAndSubmitButtons() (_shared).
// Side effects on save: none. VIEW: last test (partial exam: blocks without a value are hidden by hideIfEmpty).
// Not covered here: the OB/GYN blocks' own obs (only the includeIf and the involution when), "Other" comment fields, Next.
//
// Findings:
//   V1 Medium :811-844  hasValue() reads `.fetus-name input`, a class no element has, so on load #fetus-2..4 are always hidden:
//                  a saved second fetus is not visible when the form is reopened (EDIT) until "show more" is clicked.
//                  Fix: test the real inputs (`#fetus-hr-N input` ...). (TESTED, test.fail; confirmed on a server)
//   V2 Low :494, :661, :700-784  OB/GYN-only repeats: the STI block (:779) uses class="{switch}" but its renders (:784-790) have no
//                  `switch`, so the literal class "{switch}" is rendered (harmless: neither normalObs nor abnormalObs).
//   V3 Low :29, :41  `#primary-care-exam` matches nothing (the root id is primary-care-exam-form) and the rule `- .section` has a
//                  stray "-": both CSS rules never apply. :346-347 etc. nest a <p> in <p class="comment-field"> (invalid HTML).
//   V4 Low :1355-1360  the "Pitting" radios carry class abnormalObs, but the script only reads checkboxes: choosing a grade
//                  does not uncheck "Normal", and "Normal" does not clear it. (unconfirmed: not run)
//   Info: section unreferenced in Liberia; the postpartum and OB/GYN blocks need an OB/GYN or PMTCT parent (never offered here).

import { type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { test, expect, birthdateYearsAgo, type SectionEncounter } from '../../core';
import { NCD_INITIAL_ENCOUNTER_TYPE_UUID } from '../../core/constants';
import { SectionFormPage, expectViewShowsSavedObs } from '../../pages';

const FORM = 'section-exam.xml';
// Encounter types of includeIf :249 etc. (not in core/constants.ts; names from the merged encounterTypes.csv)
const OBGYN_ENCOUNTER_TYPE_UUID = 'd83e98fd-dc7b-420f-aa3f-36f648b4483d';
const PMTCT_INTAKE_ENCOUNTER_TYPE_UUID = '584124b9-1f10-4757-ba09-91fc9075af92';
const PMTCT_FOLLOWUP_ENCOUNTER_TYPE_UUID = '95e03e7d-9aeb-4a99-bd7a-94e8591ec2c5';

// Sticky headings can intercept a real click on a checkbox: click through the DOM (the change event still fires).
const tick = (box: Locator) => box.evaluate((el) => (el as HTMLElement).click());
const normalBox = (page: Page, block: string) => page.locator(`${block} .normalObs input[type="checkbox"]`).first();
const abnormalBox = (page: Page, block: string) => page.locator(`${block} .abnormalObs input[type="checkbox"]`).first();

// Every obs display of the encounter, group members included.
const allObsDisplays = async (api: APIRequestContext, encounterUuid: string): Promise<string[]> => {
  const res = await api.get(`encounter/${encounterUuid}?v=custom:(obs:(display,groupMembers:(display)))`);
  expect(res.ok(), `get encounter obs: ${res.status()}`).toBeTruthy();
  const obs = (await res.json()).obs as Array<{ display: string; groupMembers: Array<{ display: string }> | null }>;
  return obs.flatMap((o) => [o.display, ...(o.groupMembers ?? []).map((m) => m.display)]);
};

const EXAM_BLOCKS = ['#general', '#skin', '#heent', '#lymph', '#cardio', '#chest', '#abs', '#uro', '#mental', '#neuro', '#reflex', '#musculo'];
const PEDS_BLOCKS = ['#gross', '#fine', '#lang', '#social'];

test.describe('section-exam', () => {
  let section: SectionEncounter;

  test.beforeEach(async ({ page, createSectionEncounter }) => {
    section = await createSectionEncounter({
      encounterTypeUuid: NCD_INITIAL_ENCOUNTER_TYPE_UUID,
      patient: { givenName: 'AutoExam', familyName: 'Tester', gender: 'F' }, // adult woman
    });
    await SectionFormPage.openEdit(page, FORM, section);
  });

  // includeIf :249 / :607 (not OB/GYN or PMTCT) and :258, :277, :649, :921 (OB/GYN or PMTCT)
  test('on an NCD Initial encounter the blocks are the general ones plus #uro, and the shortcuts match', async ({ page }) => {
    for (const block of [...EXAM_BLOCKS, '#women']) {
      await expect(page.locator(block), `${block} is rendered`).toHaveCount(1);
      await expect(page.locator(`.shortcuts a[href="${block}"]`), `${block} has a shortcut`).toHaveCount(block === '#reflex' ? 0 : 1);
    }
    for (const block of ['#urology', '#gynecology', '#postpartum', '#peds']) {
      await expect(page.locator(block), `${block} is not rendered`).toHaveCount(0);
      await expect(page.locator(`.shortcuts a[href="${block}"]`)).toHaveCount(0);
    }
  });

  const obgynTypes = [
    ['OB/GYN', OBGYN_ENCOUNTER_TYPE_UUID],
    ['PMTCT Intake', PMTCT_INTAKE_ENCOUNTER_TYPE_UUID],
    ['PMTCT Followup', PMTCT_FOLLOWUP_ENCOUNTER_TYPE_UUID],
  ];
  for (const [name, uuid] of obgynTypes) {
    test(`on an ${name} encounter #uro is replaced by #urology, #gynecology and #postpartum`, async ({ page, createSectionEncounter }) => {
      const other = await createSectionEncounter({
        encounterTypeUuid: uuid,
        patient: { givenName: 'AutoExam', familyName: 'Tester', gender: 'F' },
      });
      await SectionFormPage.openEdit(page, FORM, other);
      await expect(page.locator('#uro')).toHaveCount(0);
      await expect(page.locator('.shortcuts a[href="#uro"]')).toHaveCount(0);
      for (const block of ['#urology', '#gynecology', '#postpartum']) {
        await expect(page.locator(block), `${block} is rendered`).toHaveCount(1);
        await expect(page.locator(`.shortcuts a[href="${block}"]`), `${block} has a shortcut`).toHaveCount(1);
      }
    });
  }

  // when :995 (inside #postpartum, so an OB/GYN encounter)
  test('on an OB/GYN encounter the abnormal uterus involution shows its measurement (:995)', async ({ page, createSectionEncounter }) => {
    const other = await createSectionEncounter({
      encounterTypeUuid: OBGYN_ENCOUNTER_TYPE_UUID,
      patient: { givenName: 'AutoExam', familyName: 'Tester', gender: 'F' },
    });
    await SectionFormPage.openEdit(page, FORM, other);
    await expect(page.locator('#abnormal-involution')).toBeHidden();
    await page.locator('#involution').getByLabel(/^abnormal$/i).check();
    await expect(page.locator('#abnormal-involution')).toBeVisible();
    await page.locator('#involution').getByLabel(/^normal$/i).check();
    await expect(page.locator('#abnormal-involution')).toBeHidden();
  });

  // includeIf :269, :808 (female) and :293, :1208, :1214 (age at the encounter date)
  const byPatient = [
    { who: 'an adult woman', gender: 'F' as const, age: 30, women: 1, peds: 0, denver: 0 },
    { who: 'an adult man', gender: 'M' as const, age: 30, women: 0, peds: 0, denver: 0 },
    { who: 'a 14-year-old boy', gender: 'M' as const, age: 14, women: 0, peds: 1, denver: 0 },
    { who: 'a 15-year-old boy', gender: 'M' as const, age: 15, women: 0, peds: 0, denver: 0 },
    { who: 'a 5-year-old girl', gender: 'F' as const, age: 5, women: 1, peds: 1, denver: 1 },
  ];
  for (const p of byPatient) {
    test(`for ${p.who}: #women ${p.women ? 'renders' : 'is absent'}, #peds ${p.peds ? 'renders' : 'is absent'}, Denver test ${p.denver ? 'renders' : 'is absent'}`, async ({
      page,
      createSectionEncounter,
    }) => {
      const other = await createSectionEncounter({
        encounterTypeUuid: NCD_INITIAL_ENCOUNTER_TYPE_UUID,
        patient: { givenName: 'AutoExam', familyName: 'Tester', gender: p.gender, birthdate: birthdateYearsAgo(p.age) },
      });
      await SectionFormPage.openEdit(page, FORM, other);
      await expect(page.locator('#women')).toHaveCount(p.women);
      await expect(page.locator('.shortcuts a[href="#women"]')).toHaveCount(p.women);
      await expect(page.locator('#peds')).toHaveCount(p.peds);
      await expect(page.locator('.shortcuts a[href="#peds"]')).toHaveCount(p.peds);
      await expect(page.locator('#peds input[type="radio"]')).toHaveCount(p.denver * 2); // the Denver test is the only radio of #peds (yes/no)
    });
  }

  // script :173-205
  test('normal and abnormal findings of a block exclude each other, and blocks do not affect each other', async ({ page }) => {
    for (const block of EXAM_BLOCKS) {
      await tick(abnormalBox(page, block));
      await expect(abnormalBox(page, block), `${block}: abnormal ticked`).toBeChecked();
      await tick(normalBox(page, block));
      await expect(normalBox(page, block), `${block}: normal ticked`).toBeChecked();
      await expect(abnormalBox(page, block), `${block}: abnormal cleared by normal`).not.toBeChecked();
      await tick(abnormalBox(page, block));
      await expect(abnormalBox(page, block), `${block}: abnormal ticked again`).toBeChecked();
      await expect(normalBox(page, block), `${block}: normal cleared by abnormal`).not.toBeChecked();
    }
    for (const block of EXAM_BLOCKS) {
      await expect(abnormalBox(page, block), `${block} untouched by the later blocks`).toBeChecked();
    }
  });

  test('the paediatric blocks have the same normal/abnormal exclusion', async ({ page, createSectionEncounter }) => {
    const child = await createSectionEncounter({
      encounterTypeUuid: NCD_INITIAL_ENCOUNTER_TYPE_UUID,
      patient: { givenName: 'AutoExam', familyName: 'Tester', gender: 'M', birthdate: birthdateYearsAgo(4) },
    });
    await SectionFormPage.openEdit(page, FORM, child);
    for (const block of PEDS_BLOCKS) {
      await tick(abnormalBox(page, `#peds ${block}`));
      await tick(normalBox(page, `#peds ${block}`));
      await expect(normalBox(page, `#peds ${block}`), `${block}: normal ticked`).toBeChecked();
      await expect(abnormalBox(page, `#peds ${block}`), `${block}: abnormal cleared`).not.toBeChecked();
    }
  });

  // script :811-844 (female only)
  test('the women block starts with one fetus row; show more / show less toggle the other three', async ({ page }) => {
    await expect(page.locator('#fetus-1')).toBeVisible();
    for (const n of [2, 3, 4]) {
      await expect(page.locator(`#fetus-${n}`)).toBeHidden();
    }
    await expect(page.locator('#show-more-fetus-button')).toBeVisible();
    await expect(page.locator('#show-less-fetus-button')).toBeHidden();

    await page.locator('#show-more-fetus-button').click();
    for (const n of [2, 3, 4]) {
      await expect(page.locator(`#fetus-${n}`)).toBeVisible();
    }
    await expect(page.locator('#show-more-fetus-button')).toBeHidden();
    await expect(page.locator('#show-less-fetus-button')).toBeVisible();

    await page.locator('#show-less-fetus-button').click();
    for (const n of [2, 3, 4]) {
      await expect(page.locator(`#fetus-${n}`)).toBeHidden();
    }
    await expect(page.locator('#show-more-fetus-button')).toBeVisible();
  });

  // V1: hasValue() looks for `.fetus-name input`, which does not exist
  test.fail('V1: a saved second fetus row is visible when the form is reopened', async ({ page }) => {
    await page.locator('#show-more-fetus-button').click();
    await page.locator('#fetus-hr-1 input').first().fill('140');
    await page.locator('#fetus-hr-2 input').first().fill('150');
    const form = new SectionFormPage(page, FORM);
    await form.save();
    await form.expectSaved();

    await SectionFormPage.openEdit(page, FORM, section);
    await expect(page.locator('#fetus-2')).toBeVisible(); // hidden today
  });

  test('saves findings of several blocks, EDIT starts from them, and the VIEW shows them and hides the empty blocks', async ({ page, api }) => {
    await tick(normalBox(page, '#general'));
    await tick(abnormalBox(page, '#skin')); // first abnormal finding of the skin block (rash)
    await page.locator('#skin textarea').fill('Itchy rash on arms');
    await tick(normalBox(page, '#cardio'));
    await tick(abnormalBox(page, '#neuro')); // weakness
    await page.locator('#neuro textarea').fill('Left leg weakness');
    await page.locator('#fetus-hr-1 input').first().fill('140');

    const form = new SectionFormPage(page, FORM);
    await form.save();
    await form.expectSaved();

    const displays = (await allObsDisplays(api, section.encounter.uuid)).map((d) => d.toLowerCase());
    for (const expected of ['general exam findings: normal', 'rash', 'itchy rash on arms', 'cardiac exam findings: normal', 'weakness', 'left leg weakness', '140']) {
      expect(
        displays.some((d) => d.includes(expected)),
        `an obs shows "${expected}"`,
      ).toBeTruthy();
    }

    // EDIT starts from the saved values
    await SectionFormPage.openEdit(page, FORM, section);
    await expect(normalBox(page, '#general')).toBeChecked();
    await expect(abnormalBox(page, '#general')).not.toBeChecked();
    await expect(abnormalBox(page, '#skin')).toBeChecked();
    await expect(normalBox(page, '#skin')).not.toBeChecked();
    await expect(page.locator('#skin textarea')).toHaveValue('Itchy rash on arms');
    await expect(abnormalBox(page, '#heent')).not.toBeChecked();

    // VIEW: the saved findings are values; hideIfEmpty (:212) hides the blocks with none; the shortcuts and buttons are ENTER/EDIT only
    const view = await expectViewShowsSavedObs(page, api, FORM, section.encounter.uuid);
    const v = view.page;
    await expect(v.locator('#general .value').first()).toContainText(/normal/i);
    await expect(v.locator('#skin .value').filter({ hasText: 'Itchy rash on arms' })).toHaveCount(1);
    await expect(v.locator('#neuro .value').filter({ hasText: 'Left leg weakness' })).toHaveCount(1);
    for (const shown of ['#general', '#skin', '#cardio', '#neuro', '#women']) {
      await expect(v.locator(shown), `${shown} has a value`).toBeVisible();
    }
    for (const hidden of ['#heent', '#lymph', '#chest', '#abs', '#mental', '#reflex', '#musculo', '#other']) {
      await expect(v.locator(hidden), `${hidden} has no value`).toBeHidden();
    }
    await expect(v.locator('.shortcuts')).toHaveCount(0); // ifMode VIEW include=false :217
    await expect(v.locator('#buttons')).toHaveCount(0); // :1409
  });
});

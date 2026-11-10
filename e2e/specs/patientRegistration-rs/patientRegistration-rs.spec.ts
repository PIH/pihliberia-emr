import { type APIRequestContext, type Page } from '@playwright/test';
import { test, expect, type SectionEncounter } from '../../core';
import { NCD_CLINIC_LOCATION_UUID, PATIENT_REGISTRATION_ENCOUNTER_TYPE_UUID } from '../../core/constants';
import { getEncounterObs, getPatientEncounters } from '../../commands';
import { EntryFormPage, SectionFormPage, VISIT_PAGE_URL, buttonsSubmit, openEditWithButtonsSubmit } from '../../pages';

// patientRegistration-rs.xml (pihemr's file; Liberia has no copy): "Patient Registration" metadata of the registration encounter: when, who and where
// (encounter date, provider with the Registration clerk role cbfe0b9d, location). It has no obs. The registration summary page shows it as a "most
// recent encounter" widget (editable and creatable; `MOST_RECENT_REGISTRATION_SUMMARY`, unconditional in `enablePatientRegistration`) and opens it for
// editing, so the specs create an empty Patient Registration encounter over REST (createSectionEncounter) and open the edit URL directly. That skips the
// summary-page widget gating (_availability.e2e.md). Same encounter type as patientRegistration-social.xml: each test creates its own encounter and asserts
// nothing about the other form's obs. Runs on the local Liberia server (Harper stack).
//
// Conditions in the form, from documentation inventory (patientRegistration-rs.inv.md):
//   ifMode VIEW include=false  :9, :27, :64   script, h2, Save/Cancel (ENTER/EDIT only)
// Required (HFE): provider (`required="true"` :47) and, as always, the encounter date and location. In EDIT the date and the location are prefilled
//   (from the encounter), so a blank save reports only the provider; in ENTER (the widget's "create") all three are reported.
// Location: the select lists the locations tagged "Registration Location" (13 at Harper) plus the encounter's current location when it does not carry that tag.
// Scripts (:10-18): removes the first generated title span of #patientRegistration (tested). :24 `#most-recent-encounter-title` is a hidden
//   placeholder that the registration summary page's widget fills (not covered).
// Side effects on save: none. Encounter type Patient Registration (873f968a).
// Visit-page display: none. The Patient Registration entry of encounterTypeConfig.js has showOnVisitList false and no templateModelUrl, so
//   the visit page has no VIEW of this form: no VIEW test here (the ifMode VIEW blocks stay untested). The registration summary page renders the form in
//   VIEW through its "most recent encounter" widget; that page is not covered.
// Not covered here: the summary-page widget, Cancel, changing the encounter date (HFE's own rule: not before the visit start; the fixture's visit
//   starts a minute before the test).
// Findings: see pihemr _findings.e2e.md#patientRegistration-rs.xml (V1 Info: stale file comment and location heading message code).

const FORM = 'patientRegistration-rs.xml';
const REGISTRATION_CLERK_ROLE_UUID = 'cbfe0b9d-9923-404c-941b-f048adc8cdc0';

const openForm = (page: Page, section: SectionEncounter) => openEditWithButtonsSubmit(page, FORM, section);
const save = async (page: Page) => {
  await buttonsSubmit(page).click();
};

const provider = (page: Page) => page.locator('#patientRegistration select').first();
const location = (page: Page) => page.locator('#encounterLocationField select');

// The display names of the locations tagged "Registration Location" on the server (metadata, not patient data).
const registrationLocations = async (api: APIRequestContext): Promise<string[]> => {
  const res = await api.get('location?tag=Registration%20Location&v=custom:(display)&limit=100');
  expect(res.ok(), `get locations: ${res.status()}`).toBeTruthy();
  return ((await res.json()).results as Array<{ display: string }>).map((l) => l.display);
};
const locationDisplay = async (api: APIRequestContext, uuid: string): Promise<string> => {
  const res = await api.get(`location/${uuid}?v=custom:(display)`);
  expect(res.ok(), `get location: ${res.status()}`).toBeTruthy();
  return (await res.json()).display;
};

// Selects the harness user's provider; falls back to the first provider of the list when that name is not offered. Returns the label chosen; callers compare it
// without printing it (a provider name is staff data, so no assertion message here carries one).
const chooseProvider = async (page: Page): Promise<string> => {
  const name = process.env.E2E_DEFAULT_PROVIDER_NAME;
  const labels = (await provider(page).locator('option').allTextContents()).map((t) => t.trim());
  const label = name && labels.includes(name) ? name : labels[1];
  await provider(page).selectOption({ label });
  return label;
};

test.describe('patientRegistration-rs', () => {
  let section: SectionEncounter;

  test.beforeEach(async ({ page, createSectionEncounter }) => {
    section = await createSectionEncounter({
      encounterTypeUuid: PATIENT_REGISTRATION_ENCOUNTER_TYPE_UUID,
      patient: { givenName: 'AutoRegRs', familyName: 'Tester', gender: 'F' },
    });
    await openForm(page, section);
  });

  test('renders the heading, date, provider, location and Save/Cancel, with the generated title span removed', async ({ page }) => {
    // when :9, :27, :64 (ENTER/EDIT)
    await expect(page.locator('h2')).toHaveCount(1);
    await expect(page.locator('input.hasDatepicker')).toBeVisible();
    await expect(provider(page)).toBeVisible();
    await expect(location(page)).toBeVisible();
    await expect(page.locator('#buttons button.cancel')).toBeVisible();
    await expect(page.locator('#patientRegistration span.title')).toHaveCount(0); // script :10-18
    await expect(page.locator('#most-recent-encounter-title')).toBeHidden(); // :24, the summary widget's placeholder
  });

  test("the location select lists the Registration Location locations and the encounter's own location", async ({ page, api }) => {
    const tagged = await registrationLocations(api);
    expect(tagged.length).toBeGreaterThan(0);
    const own = await locationDisplay(api, NCD_CLINIC_LOCATION_UUID);
    const options = (await location(page).locator('option').allTextContents()).map((t) => t.trim()).filter((t) => t && !/^Choose/.test(t));
    // Liberia has one site, so the tagged locations are the whole list: the select offers exactly them, and the encounter's own location (NCD Clinic, tagged) is one of them
    // and the selected option.
    expect([...options].sort()).toEqual([...tagged].sort());
    expect(options).toContain(own);
    expect((await location(page).locator('option:checked').textContent())?.trim()).toBe(own);
  });

  test('the date is prefilled with the encounter date', async ({ page, api }) => {
    const res = await api.get(`encounter/${section.encounter.uuid}?v=custom:(encounterDatetime)`);
    const date = new Date((await res.json()).encounterDatetime);
    await expect(page.locator('input.hasDatepicker')).toHaveValue(new RegExp(`${date.getFullYear()}`));
  });

  test('saving without a provider shows Required on the provider and does not save', async ({ page }) => {
    // required="true" :47
    await save(page);
    await expect(page.locator('span.field-error:visible')).toHaveText('Required');
    expect(new URL(page.url()).pathname).toMatch(/editHtmlFormWithStandardUi/); // the returnUrl in the query string also contains visit.page
  });

  test('saves the provider with the Registration clerk role and the chosen location, as an encounter without obs', async ({ page, api }) => {
    const [target] = await registrationLocations(api);
    const providerName = await chooseProvider(page);
    await location(page).selectOption({ label: target });
    await save(page);
    await new SectionFormPage(page, FORM).expectSaved();

    const res = await api.get(
      `encounter/${section.encounter.uuid}?v=custom:(location:(display),obs:(uuid),encounterProviders:(provider:(person:(display)),encounterRole:(uuid)))`,
    );
    expect(res.ok()).toBeTruthy();
    const encounter = await res.json();
    expect(encounter.location.display).toBe(target);
    expect(encounter.obs).toHaveLength(0);
    expect(encounter.encounterProviders).toHaveLength(1);
    expect(encounter.encounterProviders[0].provider.person.display === providerName, 'the saved provider is the chosen one').toBe(true);
    // :47 encounterRole="cbfe0b9d-..."
    expect(encounter.encounterProviders[0].encounterRole.uuid).toBe(REGISTRATION_CLERK_ROLE_UUID);
  });

  test('EDIT: the saved provider and location are selected, and the location can be changed', async ({ page, api }) => {
    const tagged = await registrationLocations(api);
    test.skip(tagged.length < 2, 'needs two Registration Location locations');
    const own = await locationDisplay(api, NCD_CLINIC_LOCATION_UUID);
    const providerName = await chooseProvider(page);
    await location(page).selectOption({ label: tagged[0] });
    await save(page);
    await new SectionFormPage(page, FORM).expectSaved();

    await openForm(page, section);
    expect((await provider(page).locator('option:checked').textContent())?.trim() === providerName, 'the saved provider is selected').toBe(true);
    await expect(location(page).locator('option:checked')).toHaveText(tagged[0]);
    if (!tagged.includes(own)) {
      // the old location was listed only as the encounter's own: it is gone once another one is saved
      await expect(location(page).locator('option').filter({ hasText: new RegExp(`^\\s*${own}\\s*$`) })).toHaveCount(0);
    }
    await location(page).selectOption({ label: tagged[1] });
    await save(page);
    await new SectionFormPage(page, FORM).expectSaved();

    const res = await api.get(`encounter/${section.encounter.uuid}?v=custom:(location:(display))`);
    expect((await res.json()).location.display).toBe(tagged[1]);
  });
});

// ENTER is the path of the summary widget's "create" (encounter in the current visit): the date, the provider and the location are then required
// (the date is only prefilled in EDIT).
test.describe('patientRegistration-rs ENTER', () => {
  test('a blank save shows Required on the date, provider and location; with all three chosen one encounter without obs is created', async ({
    page,
    api,
    createEntryContext,
  }) => {
    const context = await createEntryContext({ givenName: 'AutoRegRs', familyName: 'Tester', gender: 'F' });
    await EntryFormPage.open(page, FORM, context);
    await expect(buttonsSubmit(page)).toBeVisible();
    await save(page);
    await expect(page.locator('#patientRegistration span.field-error:visible')).toHaveCount(3); // date (blank in ENTER), provider, location
    expect(await getPatientEncounters(api, context.patient.uuid)).toHaveLength(0);

    await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).jq('input.hasDatepicker').first().datepicker('setDate', new Date());
    });
    await chooseProvider(page);
    await location(page).selectOption({ label: (await registrationLocations(api))[0] });
    await save(page);
    await expect(page).toHaveURL(VISIT_PAGE_URL);
    const encounters = await getPatientEncounters(api, context.patient.uuid);
    expect(encounters.map((e) => e.encounterType.uuid)).toEqual([PATIENT_REGISTRATION_ENCOUNTER_TYPE_UUID]);
    expect(await getEncounterObs(api, encounters[0].uuid)).toHaveLength(0);
  });
});

import { type Page } from '@playwright/test';

// <encounterProviderAndRole> renders a select inside #who. It defaults to the logged-in user only when that
// user has a Provider account, so with any other user it starts blank and the form refuses to save.
// E2E_DEFAULT_PROVIDER_NAME (.env) is the provider's display name as listed in the select, e.g. "Ho, Chi Bong".
// Each form lists the providers allowed by its own providerRoles, so when that name is not in this form's list
// the first provider is chosen instead (selectOption would wait for the missing option until the test times out).
export const selectDefaultProvider = async (page: Page): Promise<void> => {
  const providerName = process.env.E2E_DEFAULT_PROVIDER_NAME;
  if (!providerName) {
    throw new Error('E2E_DEFAULT_PROVIDER_NAME is not set (see .env.example): the form needs a provider to save');
  }
  const select = page.locator('#who select').first();
  // encounter-provider-location-date.xml disables the select for a user without "Task: emr.retroConsultNote": the
  // provider is then fixed to that user, and selectOption would wait on it until the test times out.
  if (await select.isDisabled()) {
    return;
  }
  const labels = await select.locator('option').allTextContents();
  if (labels.includes(providerName)) {
    await select.selectOption({ label: providerName });
  } else {
    console.warn(`Provider "${providerName}" is not listed on this form: choosing "${labels[1]}" instead`);
    await select.selectOption({ index: 1 }); // index 0 is "Choose a Provider"
  }
};

// The encounter-with-sections shell (ancFollowup, ancIntake, delivery, postnatalFollowup, ...) submits itself on load
// only when the provider already has a value. With a user that has no Provider account it stays open, so pick the
// provider and save it.
export const submitShellForm = async (page: Page): Promise<void> => {
  if (await page.locator('#who select').isVisible()) {
    await selectDefaultProvider(page);
    await page.locator('#submit').click();
  }
};

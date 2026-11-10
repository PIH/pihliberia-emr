import { type APIRequestContext, expect, test as base } from '@playwright/test';
import { api } from '../fixtures';
import {
  birthdateYearsAgo,
  createPatient,
  createVisit,
  createVisitWithEncounter,
  cleanupPatient,
  type CreatePatientOptions,
  type TestEncounter,
  type TestPatient,
} from '../commands';

export interface SectionEncounterOptions {
  encounterTypeUuid: string;
  patient?: CreatePatientOptions;
}

export interface SectionEncounter {
  patient: TestPatient;
  encounter: TestEncounter;
}

export interface EntryContext {
  patient: TestPatient;
  visitUuid: string;
}

export interface CustomTestFixtures {
  // Auto fixture: when the test fails, attaches what the server answered (see its definition).
  attachDiagnostics: void;
  // Auto fixture: fails the test on any uncaught JavaScript error in its pages.
  failOnJsError: void;
  // Creates a synthetic patient with a visit and an empty encounter of the given type. Everything it
  // creates is voided after the test (see cleanupPatient).
  createSectionEncounter: (opts: SectionEncounterOptions) => Promise<SectionEncounter>;
  // Creates a synthetic patient with an active visit and no encounter, for the entry forms that create
  // the encounter themselves. Everything it creates is voided after the test.
  createEntryContext: (patient?: CreatePatientOptions) => Promise<EntryContext>;
}

export interface CustomWorkerFixtures {
  api: APIRequestContext;
}

export { birthdateYearsAgo };

export const test = base.extend<CustomTestFixtures, CustomWorkerFixtures>({
  api: [api, { scope: 'worker' }],

  // When a test fails, attaches what the browser saw of the server: every failed /openmrs request (such as the
  // `create visit: 400`), the form submit request and its response (the `errors` name the widget the server rejected),
  // the console errors and warnings, and the uuids of the API user's providers (a form without a provider cannot be saved). Declared
  // before failOnJsError so that it is torn down after it, when the test's status is final.
  attachDiagnostics: [
    async ({ context, api }, use, testInfo) => {
      const requests: Promise<string>[] = [];
      const consoleMessages: string[] = [];
      context.on('response', (response) => {
        const request = response.request();
        const isSubmit = request.method() === 'POST' && request.url().includes('/submit.action');
        if (response.status() < 400 && !isSubmit) {
          return;
        }
        requests.push(
          response
            .text()
            .catch(() => '(no body)')
            .then((body) => {
              const posted = isSubmit ? `\n  request: ${request.postData() ?? ''}` : '';
              return `${response.status()} ${request.method()} ${request.url()}${posted}\n  response: ${body.slice(0, 2000)}`;
            }),
        );
      });
      context.on('console', (message) => {
        if (message.type() === 'error' || message.type() === 'warning') {
          consoleMessages.push(`${message.type()} ${message.page()?.url() ?? ''}: ${message.text()}`);
        }
      });

      await use();

      if (testInfo.status === testInfo.expectedStatus) {
        return;
      }
      let user = '(not read)';
      try {
        const session = await (await api.get('session')).json();
        const providers = await (await api.get(`provider?user=${session.user.uuid}&v=custom:(uuid)`)).json();
        // uuids only: names are staff data and must not end up in logs or CI output
        user = `user ${session.user.uuid}, provider uuids: ${JSON.stringify(providers.results.map((p: { uuid: string }) => p.uuid))}`;
      } catch (e) {
        user = `(failed: ${e})`;
      }
      const body = [
        '== requests with an error status, and the form submit ==',
        ...(await Promise.all(requests)),
        '== console errors and warnings ==',
        ...consoleMessages,
        '== API user and its providers ==',
        user,
      ].join('\n');
      await testInfo.attach('server-diagnostics', { body, contentType: 'text/plain' });
    },
    { auto: true },
  ],

  // Fails every test on an uncaught JavaScript exception in any of its pages (including popups). Listening on the
  // context means a page that fails during navigation is covered too. console.error is not counted: a failed
  // request logs one too, and the forms log harmless ones.
  failOnJsError: [
    async ({ context }, use) => {
      const errors: string[] = [];
      context.on('weberror', (webError) => {
        const error = webError.error();
        errors.push(`${webError.page()?.url() ?? '(no page)'}\n${error.stack || `${error.name}: ${error.message}`}`);
      });

      await use();

      expect(errors, 'uncaught JavaScript errors in the page').toEqual([]);
    },
    { auto: true },
  ],

  createSectionEncounter: [
    async ({ api }, use) => {
      const created: string[] = [];

      await use(async (opts) => {
        const patient = await createPatient(api, opts.patient);
        created.push(patient.uuid);
        const encounter = await createVisitWithEncounter(api, patient.uuid, opts.encounterTypeUuid);
        return { patient, encounter };
      });

      for (const uuid of created) {
        await cleanupPatient(api, uuid);
      }
    },
    { scope: 'test' },
  ],

  createEntryContext: [
    async ({ api }, use) => {
      const created: string[] = [];

      await use(async (patientOpts) => {
        const patient = await createPatient(api, patientOpts);
        created.push(patient.uuid);
        const visitUuid = await createVisit(api, patient.uuid);
        return { patient, visitUuid };
      });

      for (const uuid of created) {
        await cleanupPatient(api, uuid);
      }
    },
    { scope: 'test' },
  ],
});

export { expect } from '@playwright/test';

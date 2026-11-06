# Skill: OpenMRS HFE forms → E2E specs (Playwright)

Companion to `hfe-csv-docs.skill.md` (which generates the per-form CSVs; read it for the CSV schema, the concept-mappings file and how the site's forms are fetched).

The CSV describes *what fields exist*. To write E2E tests you also need to know *when each field is visible*, *what JavaScript does to the form*, and *when the form is offered for a patient at all*. This skill produces that knowledge directly as **Playwright specs** in `e2e/specs/<form>/<form>.spec.ts` (the structure follows `pihmalawi-emr/e2e`; see `e2e/README.md`). There are no per-form notes: what a note would say is written as comments in the spec, next to the assertion that checks it, and running the spec verifies it. Do **not** add columns to the CSV (its schema is a stable contract, see README.md) and do not restate in a spec what is in the XML or the CSV (form uuid, encounter type, version, field lists).

## Output files and how they fit together

| File | One per | Contains |
|---|---|---|
| `documentation/_availability.e2e.md` | site (written **once**) | when each form is offered: shared layers + one table row per form, plus the visit-page sections per encounter type (see "Form availability"). Tells a spec which fixture to build |
| `documentation/_shared.e2e.md` | site (written **once**) | shared subforms and scripts the forms call (`encounter-with-sections.xml`, `encounter-provider-location-date.xml`, `nextAndSubmitButtons.js`, vital-signs widgets, ...): conditions, JS, and Verify findings for them. Findings in shared code live **only** here |
| `e2e/specs/<form>/<form>.spec.ts` | form (top-level or `section-*`) | the tests, with the form's documentation as comments (see "Spec skeleton") |
| `e2e/README.md`, section "Forms tested" | form | one table row: XML file name, form name, form version, form uuid, encounter name, encounter uuid (see "Forms-tested table") |

Note: in the Sierra Leone config `section-*.xml` are standalone view/edit forms wired into the visit page (`encounterTypeConfig.js`), **not** subforms of the entry forms. A section spec creates the parent encounter over REST and opens the section's edit URL directly (`SectionFormPage`), which skips the visit-page gating that `_availability.e2e.md` describes.

Versioned copies (`*_v1.0.xml`, `*_Version3.xml`, ...) are skipped unless the user asks for them.

### Forms-tested table (`e2e/README.md`)

`e2e/README.md` has a "Forms tested" section with two tables, one row per spec: **top-level (entry) forms** and **section forms**, each sorted by XML file name. Add the row when you add a spec, change it when a form is renamed or its encounter type changes, and delete it with the spec. Columns:

| Column | Where it comes from |
|---|---|
| XML file | the file the spec opens (`<form>.xml`, the same as the `specs/<form>/` folder name). A print or view variant tested in its own spec (`maternalDischarge-print.xml`) is its own row |
| Form name | the `formName` attribute of the form's `<htmlform>` element, copied as it is (even when it looks wrong, e.g. `familyPlanningFollowup.xml` is named "Family Planning Initial": that is a finding, not a typo to fix in the table) |
| Form version | the `formVersion` attribute of the same element |
| Form uuid | the `formUuid` attribute of the same element, in backticks. A print or view variant has its own. No two rows may share one (see "A" in Verify mode: a shared uuid is a finding) |
| Encounter | the **name** of the encounter type in the form's `formEncounterType`. The attribute holds a uuid; resolve it in the encounter type metadata of a running config (`~/openmrs/<server>/configuration/encountertypes/*.csv`; the repo's `backend_configuration/encountertypes/*.csv` only has `${encounterType.<key>.uuid}` placeholders) |
| Encounter uuid | the `formEncounterType` attribute itself (the uuid the Encounter name was resolved from), in backticks. |

A `section-*` form has no `formEncounterType`: it edits an encounter another form created. For those, the Encounter column lists the encounter type(s) the spec creates for it with `createEntryContext` / `createSectionEncounter` (the `*_ENCOUNTER_TYPE_UUID` constants of `e2e/core/constants.ts`, resolved to names the same way); a section used by several parents lists them all, in the same order in both columns (separated by `<br>`).

The table is the one place that repeats these XML values; **do not** copy them into the spec (see "Spec skeleton"), and refresh the row when the form's version or uuid changes. Take every value from the XML and the metadata with a script rather than by hand, and check that none comes out empty. Notes for that script:

- Read the attributes with a regex on the `<htmlform ...>` tag: it needs no `lxml`, and uuids keep the case they have in the XML (some forms have upper-case ones; copy them as they are).
- For a section form, scan the whole spec for `*_ENCOUNTER_TYPE_UUID` names, in order of first use: a spec can define its own constant (e.g. `DELIVERY_ENCOUNTER_TYPE_UUID` in `section-dx`) that is not in `e2e/core/constants.ts`.
- A spec that tests a flow rather than a form (the registration wizard) has no XML file: it gets no row. Say so in one sentence under the heading.

### Running it (cost control)

The job is large (about 75 current forms in Sierra Leone). Keep it cheap:

1. **Run `inventory.py` first** (in this directory; needs `lxml`, e.g. `python3 -m venv /tmp/v && /tmp/v/bin/pip install lxml && /tmp/v/bin/python -I inventory.py --out /tmp/inv`). For every current form it writes `<form>.inv.md` containing header facts, includes (`[section]` / `[sub-form]`), mechanical Verify-A findings (**leads, not verdicts**: confirm or discard each), and the **Conditional display** and **JavaScript** tables with rows already filled (kind, `file:line`, trigger → effect). Options: `--only-changed`, `--specs-dir`, `--forms-dir`, `--merged-dir`, `--concepts`. It prints how many forms are trivial, and which unresolved concepts are probably just newer than the mappings CSV (the form was committed after the CSV date, so regenerate the CSV) versus ones to check by hand.
2. **Trivial forms** (nothing conditional or scripted in their own file, no mechanical findings, no `<drugOrder>`/`<postSubmissionAction>`) need only a save test; do not spend an agent reading them.
3. **Do the shared files first, once:** `_availability.e2e.md` (uses pihcore and `encounterTypeConfig.js`) and `_shared.e2e.md`. **Spec-writing agents never open `CustomAppLoaderFactory.java` or the shared subforms**: they read `_availability.e2e.md` (row = form file name) and `_shared.e2e.md`. Record the pihcore/pihemr commit in `_availability.e2e.md`; redo that pass only when pihcore changes.
4. **Read as little XML as possible.** The inventory gives `file:line`; read with `offset`/`limit` around those lines, and a whole `<script>` body only to describe it. For locators, probe the rendered form once with a throwaway spec (list the inputs with their ids and row text) instead of guessing; HFE puts `class`/`id` on a wrapper `<span>`, so target the inner input.
5. **Fresh agents only. Never `fork`.** A fork copies the whole conversation into every agent. Brief = goal, the list of forms, paths (inventory dir, an exemplar spec, `e2e/README.md`, the concept-mappings CSV `full concept mappings_<date>.csv`), the rules of this skill by reference, and an explicit "no servers started by you, no logins other than the harness's, do not read or print records other than the test patient's" — about 15 lines. Replies are one line per finding.
6. **Order:** shared files → `section-*` specs → top-level forms. About 3–5 forms per agent. Tell the user the plan and rough cost before launching more than 2 agents. Get one spec passing end to end before writing the others of the same kind.
7. **Re-runs:** `inventory.py --only-changed` skips forms whose XML has not changed since their spec was last committed (git; for an uncommitted spec, XML not newer than it). A change in a shared subform or in pihcore needs a manual pass over `_shared.e2e.md` / `_availability.e2e.md`.
8. **Every run includes the mechanical scan and the shared-subform findings.** Do not write that into the spec ("scan clean"): a form with no findings has no Findings block.
9. Agents write only their own spec (plus helpers in `e2e/` when told to), never edit XML/CSV/README/skill. The main session adds the rows of the "Forms tested" table in `e2e/README.md` once the agents are done (parallel agents editing one file overwrite each other).
10. **Running the specs** needs a server with **test data only** that the user has confirmed; the harness creates and voids its own synthetic patients. Never list patients or encounters without a filter, and never print REST responses.

11. **Harness gotchas** (found writing the `section-*` specs):
    - Playwright's default test timeout is 3 minutes with no action timeout, so one bad locator hangs; iterate with `--timeout=60000`.
    - Parallel agents each pass their own `--output <dir>` (Playwright clears the output dir at start).
    - A form using the HFE `<submit>` tag (`section-plan`, `section-plan-medication`, `section-ncd-plan`) has no `#submit`; click `#buttons input.submitButton` instead of `SectionFormPage.save()`.
    - VIEW mode: `viewEncounterWithHtmlForm.page` throws for an encounter created over REST (no `form`), so VIEW is tested through `getAsHtml.action` with an explicit `definitionUiResource` (see "VIEW mode" below).
    - Sticky headings can intercept clicks (`section-exam`): click through the DOM.
    - The cleanup (`voidClinicalDataForPatient`) voids the encounters and visits, and their obs and orders (also the ones a re-save voided) go with them; nothing is purged, so the login needs no Purge privileges.
    - Probe specs and throwaway cleanup helpers go in `e2e/specs/_probe-*` and are deleted afterwards. Name probe patients `Auto<Something> Tester` so a name-filtered cleanup finds them.

### Spec skeleton (`e2e/specs/<form>/<form>.spec.ts`)

```ts
// <form>.xml: what it is, in one line. How the specs reach it (fixture, URL) and what that skips.
//
// Conditions in the form, from documentation inventory (<form>.inv.md):
//   <kind> <trigger>   :<line>   <effect>          // one line each: when/toggle/ifMode/includeIf, with file:line
// Scripts: <what each script does: rule, message text, formula, default, REST calls>   (script-driven show/hide too)
// Side effects on save: <enrollInProgram, postSubmissionAction, disposition/diagnosis actions, orders>
// Not covered here: <what a test would need and why it is skipped>
//
// Findings (V1.. numbered per file, High -> Low -> Info; see "Verify mode"):
//   V1 Medium :46-49  problem -> user-visible consequence. Fix: ...   (TESTED below with test.fixme)
//   V2 Info   ...
```
then `test.describe` blocks. Each test carries a comment citing the condition it exercises (`// when :182`).

- **Conditions** get a test that exercises both states (show/hide: select the answer, assert visible; select another, assert hidden; EDIT starts from the saved value). `ifMode` rows that only gate headings or buttons need at most one test per form. `includeIf` rows need a fixture that satisfies the condition (patient age/gender, encounter type): say which.
- **Required fields**: one test that saves with them blank and expects the `span.field-error` "Required", and one that fills them and saves.
- **Save test**: fill a few fields, save, then read the obs of the test encounter over REST and assert them; also assert side effects (program enrollment, ...).
- **VIEW mode**: every spec that saves also checks the read-only rendering of what it saved. Use `expectViewShowsSavedObs(page, api, FORM, encounterUuid)` from `e2e/pages/view-form-page.ts` at the end of the richest save test (and after an EDIT round-trip), then add 2-5 targeted assertions per form.
    - The helper loads `viewEncounterWithHtmlForm/getAsHtml.action?encounterId=...&definitionUiResource=file:configuration/pih/htmlforms/<form>.xml` (what the visit page calls; htmlformentryui has no standalone VIEW page) into the test page. A saved value renders as `span.value`, an unanswered field as `span.emptyValue`, a selected radio/checkbox as `[X] <label>` and an unselected one as `[  ] <label>`.
    - The generic check: every saved text, number and coded obs of the encounter appears (case-insensitive) in some `span.value`. A coded answer that the form labels differently from the concept name (`answerCodes`, `answerLabels`) goes in the `labels` argument (obs display -> text shown). Dates and groups are not compared by the helper: assert them with a targeted locator.
    - Targeted assertions: the specific values worth checking (obs groups, conditional sections, custom answer labels, dates, lookups and computed text such as `$fn`/`<lookup>`), and that what the test did **not** fill is not shown as a value (`toHaveCount(0)` on `.value` inside that block).
    - Select fields by their ids (`controlId`, `id=`), not by structure: inserting the HTML re-parses it, so a `<tr>` wrapped in a `<span>` is lifted out of its table and `#wrapper .value` finds nothing.
    - `ifMode mode="VIEW" include="false"` blocks (Save/Cancel buttons, ENTER-only widgets) must be absent here; assert that for one of them per form.
    - A value that was saved but is missing, mislabelled or blank in VIEW is a finding (`VW1`..): write the test for the intended rendering and mark it `test.fixme()` like any known bug. Intentional design (a field hidden in VIEW by `ifMode`) is not a finding.
    - The helper skips dates and datetimes and the diagnosis obs (`Diagnosis*`, `Visit Diagnoses`: the widget prints them as plain text, assert that text yourself), maps `Disposition categories: Discharged` to "Discharge", matches a short expected text (3 characters or fewer, or a number: "3" matches "3.0") against a whole value only, and treats an empty label (`labels[display] = ''`) as "do not look for this obs" (use it for hidden marker obs and row numbers).
    - `ViewFormPage.open` goes to a blank page of the server's origin, loads the scripts the **visit page** loads (jQuery, `jq`, the PIH global scripts: `VIEW_SCRIPTS` in `pages/view-form-page.ts`) and inserts the HTML with jQuery, so the form's own scripts (vitals colouring, BMI, totals, `when`/`toggle`) run as they do on the visit page. The visit page does not load `htmlFormEntry.js` or `htmlForm.js`, so `getField`, `getValue`, `htmlForm` and `beforeSubmit` are undefined in VIEW: a script that uses them unguarded throws there, and the VIEW test fails with it (a finding; do not add those scripts to the harness). The vitals colouring takes the `value` class off what it colours: `ViewFormPage.values` matches those by their `.vitals-values` parent.
    - Entry forms that only hold a shell (`ncd-*`, `ancIntake`, `delivery`, `outpatient-*`) render nothing in VIEW (the content is in the section forms): one test asserting no values and a hidden `.htmlform` wrapper is enough.
    - Two questions on one concept (the same defect as SL-1461) show up here as a lone answer under the wrong question, or two texts swapped; HFE's obs-to-field order is not stable, so such a test can be random: compare sorted or leave it out of `test.fixme()`.
    - Add "VIEW" to the header's covered/"Not covered here" sentence.
- **Known bugs** (a Medium/High finding whose behaviour a test can assert): write the test for the **intended** behaviour and mark it `test.fixme()` with the V-id in the title and a comment ("remove test.fixme() when fixed"). The test is skipped, so the suite stays green and the bug stays listed; confirm by running once with `test.fail()` in place of the marker that it fails for the intended reason.
- **Findings with no test** (Low/Info, or too costly to reach) stay in the header block only. Findings in shared code are `see _shared V3`, never repeated.
- Keep the header comment ≤ ~40 lines. Do not write a "Findings" block with nothing in it.

All paths below are relative to the site's config repo; sites differ in directory layout (`configuration/pih/htmlforms/`, `content/configuration/backend_configuration/htmlforms/`, ...), so locate the htmlforms dir first.

## Conditional display of elements

There are four distinct mechanisms. Which one applies determines how a test must exercise it, so classify each conditional element. This section is reference for reading the inventory's table and for writing the tests' comments; the conditions go into the spec header and its tests.

### 1. `<when>` tags — client-side, driven by an answer

```xml
<obs conceptId="CIEL:1601" style="radio" answerConceptIds="..." >
  <controls>
    <when value="CIEL:5622" thenDisplay="#delivery-location-other"/>
  </controls>
</obs>
```

- Valid only inside `<controls>` inside an `<obs>`. `value` is a concept reference (`CIEL:`, `PIH:`, uuid, or macro) or `true`/`false`. It should be one of that obs's `answerConceptIds`.
- Attributes: `thenDisplay` (must be a `#id` or `.class`), `thenJavaScript`, `elseJavaScript`. At least one is required (HFE throws otherwise).
- The target element is hidden until the obs holds the matching value. Test: select the answer, assert target visible; select another answer, assert hidden. In EDIT mode the initial state follows the saved value.
- Inside `<repeat><template>` the target id is usually templated (`#{nickname}-plus-{0}`) — expand it per `<render>` when documenting.
- Record in the CSV's `skip logic?` column and, in the spec, say which trigger answer shows which target id.

### 1b. `toggle=` attribute — client-side, driven by a checkbox/radio

`<obs ... style="checkbox" toggle="someDivId"/>` or `toggle="{id: 'x', style: 'dim'}"` shows (or, with `style: 'dim'`, un-dims) the target when the box is checked. Same test approach as `<when>`. The target is matched as `#target, .target` (id **or** class; `htmlForm.js` `setupObsToggleHandlers`). Also supported on some non-obs tags (e.g. `encounterLocation`, `enrollInProgram`).

### 2. JavaScript-driven show/hide — client-side, bespoke

Found in `<script>` blocks: `.show()`, `.hide()`, `.toggle()`, `.css('display'...)`, `.prop('disabled'...)`, `.prop('checked', false)`, `.val('')`, `getField('...').change(...)`. For each, document: the event that triggers it (`change` on which field/class, page load, submit), the selector(s) affected, and the condition. Typical example: *normal/abnormal exam checkboxes are mutually exclusive* — checking `.normalObs` unchecks `.abnormalObs` in the same `.exam` container. Tests should assert the resulting state, not just the click.

### 3. `<ifMode>` — server-side, by form mode

```xml
<ifMode mode="VIEW" include="false"> ... </ifMode>   <!-- ENTER and EDIT only -->
<ifMode mode="ENTER" include="true"> ... </ifMode>   <!-- ENTER only -->
```

- Modes are `ENTER`, `EDIT`, `VIEW`. `mode` is required; `include` **defaults to `true`** (verified in `IfModeTagHandler`). `include="false"` means "every mode except this one".
- Evaluated when the form is rendered, so it cannot be toggled by clicking. A test must open the form in the right mode (enter new / edit existing / view; VIEW is covered by `expectViewShowsSavedObs`, see Spec skeleton).
- Important consequence: an obs wrapped in `<ifMode mode="ENTER">` is **recorded only on first entry** and is absent (or read-only elsewhere) when editing; an obs wrapped in `<ifMode mode="VIEW" include="false">` is not shown on the read-only view. E2E assertions after save → view/edit must account for this. Flag every `<obs>` (and every `<script>`) under an `ifMode` and state the modes in which it exists.

### 4. `<includeIf>` / `<excludeIf>` — server-side, by data

```xml
<includeIf velocityTest="$patient.gender == 'F' "> ... </includeIf>
<includeIf velocityTest="$encounter.encounterType.uuid == '...' || ..."> ... </includeIf>
<includeIf velocityTest="(13 > $patient.getAge($encounter.getEncounterDatetime()))"> ... </includeIf>
```

- Velocity expression evaluated at render time against the patient/encounter/macros. Also `logicTest` variants. Cannot be toggled by clicking: the test must **arrange fixture data** (patient gender, age at encounter date, which encounter type the form is rendered under — `section-*` subforms are commonly embedded in several parent forms and branch on `$encounter.encounterType.uuid`, variables such as `$deliveryDate`/`$priorCordCare` set via `<lookup>`/macros from prior data). Document the exact condition and the concrete fixture value that satisfies it (e.g. "age < 13 at encounter date").
- Expression compare of `$encounter...` is only meaningful on a saved encounter / in the right parent form.

Recommended grep to inventory a form: `grep -nE '<(when|ifMode|includeIf|excludeIf)\b|toggle=|thenDisplay|<script' form.xml`. Don't forget `<subform>` / macro includes: repeat the inventory on each referenced subform, since conditions there apply to the parent.

## Other uses of JavaScript in the form (summary)

For each `<script>` block (and `<script src>`/included `.js`), give a one-line summary in the spec header. Inventory with: `<script`, `beforeSubmit`, `htmlForm.getBeforeValidation`, `htmlForm.getValueIfLegal`, `htmlForm.enableSubmitButton/disableSubmitButton`, `getField(`, `setValue(`/`.val(`, `ws/rest`, `$.ajax`/`fetch(`, `<lookup expression=` embedded in JS. Common categories to name:

- **Validation** — rejects or blocks submit (`getBeforeValidation`, `beforeSubmit`, `disableSubmitButton`): note the rule, the error message text, and which inputs make it fire. These are test cases (negative paths).
- **Defaults / prefill** — e.g. retrospective entry sets time to 00:00; pre-populating from a previous obs via REST (`ws/rest/v1/obs?...`) or `<lookup expression="fn.latestObs(...)">`. Tests need prior data in the fixture.
- **Derived values** — computed fields (BMI, gestational age, scores, "next appointment" bounds). Note the formula and the input fields.
- **Mutual exclusion / clearing** — see above.
- **Navigation scaffolding** — shared helpers such as `setUpNextAndSubmitButtons()` (multi-section Next/Submit buttons). Check the site's shared script dir (e.g. `pih/scripts/`, `global/`) for definitions the form calls but doesn't define; summarise once in `_shared.e2e.md`, reference elsewhere.
- **Server data into JS** — `'<lookup expression="..."/>'` inside a script is substituted at render time (so the value is fixed when the page loads; it's not live).

## Form availability (when is the form offered for a patient?)

**Do this once for the whole site, not per form**, and write the result to `_availability.e2e.md`. Specs just cite the form's row. Most forms share the same layers (component flag, `enableXxx()` method, privilege, location tag, country branch), so state each shared layer once at the top and give each form a single table row with only what differs:

```markdown
# Form availability — <site>
Source: pihcore commit <hash> (date); pih-config files: <list>. Component flags per site: KGH = [...], Wellbody = [...].
## Shared layers   (country branch, helpers resolved from RequireUtil, launch URL shapes)
## Forms
| Form file | Offered by (method, entry point) | Component | Privilege | Session location tag | Patient / visit / program requirement | KGH | Wellbody | Notes |
```
Add a short fixture recipe only for forms whose requirement is unusual. Forms with no app-loader entry (legacy, `section-*`, subforms) get one row saying who includes them or "unreferenced".

The XML says nothing about this. It lives in the site's app/menu configuration and differs by site. Availability usually has several layers; an E2E fixture must satisfy **all** of them. Record each in `_availability.e2e.md` (shared layers once, per-form differences in the form's row), and call out the concrete fixture value (age, gender, location, program, privilege) that satisfies it.

### Procedure (PIH core sites: Haiti/ZL, Sierra Leone, Liberia, Rwanda, ...)

The logic is in `openmrs-module-pihcore` — `api/src/main/java/org/openmrs/module/pihcore/apploader/CustomAppLoaderFactory.java` (helpers in `RequireUtil.java` and `CustomAppLoaderUtil.java`; encounter type constants in `api/.../PihEmrConfigConstants.java`). Locate the module repo locally, or sparse-clone it when running in the cloud (`git clone --depth=1 --filter=blob:none --sparse https://github.com/PIH/openmrs-module-pihcore.git && git sparse-checkout set api/src/main/java/org/openmrs/module/pihcore`).

**The form's own `formUuid` is NOT referenced there** — the app loader links forms by **file name** (`PihCoreUtil.getFormResource("ancIntake.xml")`). So:

1. `grep -n '"<formFileName>.xml"' CustomAppLoaderFactory.java` — finds the `visitAction(...)`/`registerTemplateForEncounterType(...)` that offers the form. Unversioned file names only: `_v1.0`-style copies and `section-*` files usually have no entry (legacy / embedded in a parent form — say so, and name the parent).
2. Take `formEncounterType` from the `<htmlform>` root, find its constant in `PihEmrConfigConstants.java` (`ENCOUNTERTYPE_..._UUID`), and grep that constant in `CustomAppLoaderFactory.java`. This finds the *other* entry points: `visitDoesNotHaveEncounterOfType(...)`, `patientDoesNotHaveEncounterOfTypeDuringProgramEnrollment(...)`, and edit/view wiring via `registerTemplateForEncounterType`. Also grep the form uuid itself as a fallback (some forms are referenced by uuid elsewhere, e.g. REST/config JSON).
3. Read the enclosing `enableXxx()` method (e.g. `enableMCHForms()`), then collect each layer:
   - **Component flag** — the `if (config.isComponentEnabled(Components.X))` that calls it. `Components.X` maps to a string in the site's `pih-config-*.json` `"components": [...]` (e.g. `"mchForms"`). Check that the specific deployment/config file the test targets lists it (different sites within one country can differ, e.g. kgh vs wellbody).
   - **Country branch** — `config.isCountry(Country.HAITI/LIBERIA/...)`; pick the branch for the site under test (the final `else` is typically the default/Sierra Leone branch). The same form file may have different `require`s per country.
   - **Privilege** — e.g. `PihEmrConfigConstants.PRIVILEGE_TASK_EMR_ENTER_MCH`; the test user needs it.
   - **Session location tag** — `sessionLocationHasTag("Maternal and Child Location")`: the test must log in at a location with that tag.
   - **Patient/visit `require` expression** — resolve each `RequireUtil` helper to its actual expression (read `RequireUtil.java`; do not guess). Examples: `patientIsFemale()` → `patient.person.gender == 'F'`; `patientIsReproductiveAge()` → `patient.person.age >= 10`; `patientIsChild()` → `age < 15`; `visitDoesNotHaveEncounterOfType(x)` → no such encounter in the *current visit*; `patientDoesNotHaveEncounterOfTypeDuringProgramEnrollment(x, program)` → needs an active enrollment in that program with no such encounter yet. Note `patientHasActiveVisit()`-style requirements — the visit must be active/started for visit actions.
   - **Extra entry points** — clones such as `cloneAsPregnancyVisitAction(...)` / `cloneAsMchVisitAction(...)` also surface the form on a program dashboard; document the page where the test should click.
   - **Forms opened without the app loader** — `enterSimpleHtmlFormLink`/`...WithoutVisit` and `&createVisit=true` / `&returnUrl=` params change how the form is launched; record the launch URL shape.
4. Output a fixture recipe: *"Female patient age ≥ 10, active visit at a location tagged X, enrolled in program P, no ANC intake yet in the visit, user with privilege Y."*

### Other sites (Malawi, and any non-pihcore-app-loader deployment)

Do not assume the pihcore app loader. Malawi (`pihmalawi-emr`) gates its forms through the mastercard framework instead: `omod/.../web/taglibs/EMastercardAccessTag.java` and the JSPs/program-dashboard config under `omod/src/main/webapp` (header/visit forms keyed by form name and encounter type name, plus program-state conditions), and the e2e page objects list the `file:configuration/htmlforms/*.xml` forms reachable from each program's gate page. Same approach: find the code that names the form file (grep the file name, then the encounter-type constant), enumerate its conditions, and write the fixture recipe. If the site's mechanism is not described here, grep the file name across the whole site repo and its backend module repos, say what you found, and mark the section "unverified" rather than guessing.

## Verify mode (optional)

Invoked when the user asks to "verify"/"review" a form (or passes `verify`). In addition to the documentation above, review the XML and **report findings with a proposed fix — do not edit forms unless asked**. Put findings in the spec's `Findings` header block (and as `test.fixme()` tests where they can be asserted) and summarize in chat. Say plainly when nothing was found.

**Format — identical in every file.** Every finding has the fields below, sorted High → Low → Info, IDs numbered per file (`V1`, `V2`, ...). In the spec header they are one comment line each (`V1 Medium :46-49 problem -> consequence. Fix: ...`); in `_shared.e2e.md` and chat use this table:

```markdown
## Verify findings
| ID | Severity | Location | Problem | User-visible consequence | Fix |
|---|---|---|---|---|---|
| V1 | High | form.xml:210 | `answerConceptIds` order differs from `answerLabels` | "No" saves Yes | reorder to `$noAnswer,$yesAnswer` |
```
Findings that live in a shared subform/script are recorded once in `_shared.e2e.md` and referenced as `see _shared V3`, never repeated.

**Severity scale** (use exactly these four; pick the highest that applies):
- **High** — wrong data is saved or shown (swapped answer/label, wrong concept, wrong program/workflow state from a hardcoded id), or a user cannot save/open the form or a required path.
- **Medium** — a feature does not work in some paths (show/hide target missing or duplicated, validation bypassed or wrongly firing, stale hidden data saved, handler not re-run in EDIT mode), or a hardcoded database id that is wrong only on other databases.
- **Low** — cosmetic or robustness: misleading id, unused/duplicate macro, untranslatable text, unescaped-but-tolerated markup, edge case that needs unusual input.
- **Info** — observation that is not a defect (e.g. header-only form, behaviour that surprises a test author). Max 2 per file.

Do not pad: if something is not confirmed by reading the code, either drop it or mark the problem cell `(unconfirmed)` and give it at most Low.

### A. HTML Form Entry elements are passed correct parameters

Mechanical checks (script them where possible: parse the XML, resolve macros/`<repeat>` substitutions first):

- `answerConceptIds` vs `answerLabels`/`answerCodes`: same count **and same order**. (Real bug: `ncd-other-visit.xml` Hospitalized/Medications-changed rows listed `answerConceptIds="$yesAnswer,$noAnswer"` with `answerLabels="No, Yes"`, so the "No" label saved Yes and vice versa; fixed by reordering to `$noAnswer,$yesAnswer`.)
- Singular vs plural attribute: `answerLabel` goes with `answerConceptId`; `answerLabels` with `answerConceptIds`. Using `answerLabel=` next to `answerConceptIds=` is silently ignored, so default labels render. (Real bug: `mhReferral` obs.)
- `answerConceptId` (singular) containing a list; `style` valid for the datatype (`radio/checkbox/dropdown/autocomplete` for coded, `date/datetime/number/textarea` otherwise); `required`, `allowFutureDates`, `allowPastDates`, `showTime` used on tags that support them; boolean attributes spelled `true`/`false`.
- **`formUuid` is unique across the site's form files.** HFE and the apps find a form by its uuid, so two XML files sharing one `formUuid` are one Form to the server: a saved encounter of the one is opened, edited and re-saved as the other, and the definition it loads can be the wrong file's (real bug: `familyPlanningIntake.xml` and `familyPlanningFollowup.xml` share `dffa9543-…`, SL-1503; saving the followup fails intermittently with "Illegal value"). Check it for every form you document, comparing case-insensitively, over **all** the XML files of the site (versioned copies and print/view variants included, even though they get no spec). Compare the whole directory rather than reading the forms-tested table, which only lists the forms with a spec:
  ```
  grep -rhoi 'formUuid="[^"]*"' <site>/content/configuration/backend_configuration/pih/htmlforms --include=*.xml | tr 'A-Z' 'a-z' | sort | uniq -d
  ```
  Any output is a finding; `grep -rli` for the printed uuid lists the files. Record it in the Findings header of **each** colliding form's spec (same text, naming the other file), Fix: give one of them a new `formUuid`, as a new form version (our convention: a changed `formUuid` comes with a new `formVersion`, not an in-place edit of the old version). Do not apply the fix unless asked. A spec for such a form cannot rely on the form's uuid either: if the symptom is random, say so in the header and keep the affected tests `test.fixme()`.
- Every concept reference resolves: `CIEL:`/`PIH:` mappings exist in the concept-mappings CSV (`full_concept_mappings.csv`), macros referenced as `$name` are defined in `<macros>`, and `$name` is not defined twice with different values (clashing macros across a form and its subforms).
- **No hardcoded database primary keys**: concept/program/workflow/location ids as bare numbers, e.g. `fn.latestObs(5096)`, `fn.currentProgramWorkflowStatus(16)`, `<encounterLocation default="1"/>`, `conceptId="1065"`. They differ between databases; use mappings/uuids. (Real bug: workflow id `16` copy-pasted across different programs' mastercards, so the wrong program's state was displayed.) Grep: `fn\.\w+\(\d+`, `default="\d+"`, `Id="\d+"`.
- Provider/location/encounter widgets: `encounterRole`, `providerRoles`, `tags=` and `default=` reference real metadata (uuid/tag exists).
- Element ids: **no duplicate `id=` in the rendered form** (including after `<repeat>` expansion and subform inclusion), and templated ids use the placeholder inside `<repeat>`. (Real bugs: `dose-asp`/`medication-asp` copy-pasted onto non-aspirin rows; `{0}` ids used *outside* any `<repeat>`, so never substituted and every row shared one literal `diab_{0}_med`.) Duplicate ids break `<when>`/`toggle` targets, JS selectors and E2E locators.
- Ids that mislead: an id naming a different field than its concept (real bug: diagnosis-date obs had `id="appointmentDate"`). E2E selectors rely on ids.
- Every `thenDisplay="#x"` / `toggle="x"` target exists exactly once; every `<when value>` is in that obs's answer list; no target is unreachable (shown only when a never-offered answer).
- `<ifMode>`/`<includeIf>` condition syntax valid; `include` spelled right; velocity variables (`$deliveryDate`, ...) are defined before use.
- `<repeat>`/`<template>`: every `{var}` used in the template has a value in every `<render>`; Pattern A/B (see above) intended.
- `<subform path=...>` and `subform-parameter` names exist; referenced files exist.

### B. Custom JavaScript does what it intends

Read each script (validation, show/hide, defaults, derived values) and check by reasoning, and by running the form when a local server is available (see `~/.claude/openmrs.md`):

- Selectors reference ids/classes that exist (and exist once). `getField('<id>.value')` names real widgets; field names after `<repeat>` expansion are as assumed.
- Event wiring: handler attached to the right event on the right element, and also re-evaluated on page load for EDIT mode (saved values should produce the correct initial visibility).
- Validation: correct comparison direction/units (days vs months, `>` vs `>=`), dates parsed consistently (timezone, `getMonth()` is 0-based), empty/NaN handled, error message shown and **submit actually blocked** (returns false / `beforeSubmit` result honoured), and valid input is not rejected. Edge cases: boundary values, blank optional fields, retrospective encounter dates.
- Show/hide: hidden fields are cleared or ignored on submit (otherwise stale data saves); required fields inside hidden sections don't block submit; show and hide conditions are complements.
- `<lookup>` inside JS: quoting is valid after substitution (nested `'` inside a single-quoted JS string, as in `'<lookup expression="fn.latestObs('X').getValueDatetime()"/>'`, must still render to valid JS; empty result handled), `&amp;&amp;` used for `&&` in XML, `<`/`>` in comparisons escaped where the XML parser requires it.
- Shared helper functions the script calls exist in an included script (and are loaded before use).
- Duplicate `jq(document).ready` handlers don't double-fire the same effect.

### Prior art for calibrating "what to catch"

In `pihmalawi-emr`, `git log content/configuration/backend_configuration/htmlforms` — commits by Michael Seaton (e.g. `637abb47` swapped answerConceptIds, `cda49a5d` content bugs found during e2e pilot, `0718a44b` primary keys → uuids and clashing macros, `cb0b56c8` duplicate/misnamed ids found building SCD e2e tests). Those fixes are the template for A above. Malawi also has `HtmlFormMetadataReferencesTest.java` (checks metadata references in forms) — a unit-test equivalent of the metadata checks in A.


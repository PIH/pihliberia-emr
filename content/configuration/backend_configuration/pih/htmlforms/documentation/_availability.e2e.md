# Form availability — Liberia (Harper / JJ Dossen, Pleebo)

When is each form of the merged Liberia htmlforms directory (95 forms: `pihliberia-emr`'s own plus those inherited from `pihemr`) offered to a user, and on which profile? Written once for all forms; specs cite the form's row. Rebuilt on 2026-11-09 against pihcore **master** (the 2026-11-04 version read `d6d434cd`, branch `duplicate-patient`, and covered only the forms that had a spec). Everything is read from code and config; what the local server confirmed is in `## Confirmed by the e2e specs`, and "unverified" marks what could not be confirmed.

**Result:** 39 reachable (34 with a spec, 5 to spec: see `## To spec`) + 56 not reachable = 95 forms. Two of the 56 not-reachable forms have a spec (`section-exam.xml`, `section-other-ncd.xml`); both carry the `// UNREACHABLE` header and the `@unreachable` tag.

**Stack of the local test server (`http://localhost:7072/openmrs`, the one the e2e suite runs on): `liberia,liberia-harper,liberia-harper-demo`** (= `harper-demo.env`; Harper site, **harper** column below). Evidence, all read on 2026-11-09:
- `~/openmrs/liberia/openmrs-runtime.properties` has `pih.config=liberia,liberia-harper,liberia-harper-demo` (written by the SDK on 2026-11-04 09:53).
- The process listening on :7072 is `mvn org.openmrs.maven.plugins:openmrs-sdk-server-2x:6.9.0:run-container -D port=7072 -D serverId=liberia` (server dir `~/openmrs/liberia`, database `liberia` on :3308). `pih.config` is not exposed as a system setting over REST (`systemsetting?q=pih.config` is empty), so the properties file is the evidence.
- `openmrs-server.properties` / `openmrs-distro.properties` of that server: `content.pihemr-content=3.6.0-SNAPSHOT`, `content.pihliberia-content=1.24.0-SNAPSHOT` (the pins of `pihliberia-emr/distro/pom.xml`), SPA `openmrs-frontend-pihemr-1.48.0-SNAPSHOT`, `modules/pihcore-2.2.0-SNAPSHOT.omod` (its `pihcore-api` jar, dated 2026-11-03 21:48, has no `deathCertificate` in `CustomAppLoaderFactory.class` or `Components.class`, so it already includes `442f2592` (UHM-9646, 2026-11-03 14:46), the last commit that changed the app loader: the line numbers below are those of master).
- `liberia-harper-demo.json` sets only the identifier prefixes (`YY`) and **no `components`**, so the 33 components of `liberia-harper.json` stay in force: the server offers exactly what the **harper** column says (jjd-ci, demo, jjdossen and the older remote jjd-ci stack `liberia,liberia-harper,liberia-harper-jjd-ci` are identical for forms). It is **not** a Pleebo stack, so `familyMedicine` is on and the **pleebo** column cannot be run here.
- The merged config of the server (`~/openmrs/liberia/configuration/pih`) equals `pihliberia-emr/distro/target/distro/web/openmrs_config/pih` (built 2026-11-04 09:47): `diff -rq` of `htmlforms/`, `subforms/` and `scripts/` shows no difference (apart from `documentation/`), and its `scripts/visit/encounterTypeConfig.js` is byte-identical with `pihemr` `0e852f67`'s. So the earlier note that the merged `encounterTypeConfig.js` differed from the local pihemr checkout (no `reviewOfSystems` section, `templateModelUrl` of `section-dx` commented out) is obsolete: both are master now.
- Live REST checks (admin login of `e2e/.env`; no patient, user or provider was listed): the session authenticates; the location uuids of `e2e/core/constants.ts` exist and carry the tags the specs rely on (NCD Clinic: NCD Consult, Consult Note, Check-In, Lab Results, Vitals; MCH Clinic: Maternal and Child, Consult Note, Check-In, Vitals, Dispensing; Mental Health Clinic: Mental Health, Consult Note, Check-In, Vitals, Dispensing; Pharmacy: Dispensing; Health Facility: Visit Location); the server holds 92 encounter types and 117 published forms.

**Sources (local checkouts, read 2026-11-09):**
- `openmrs-module-pihcore` **master** `d2f3370a3f71c92babe329934086e205aefd7a15` (2026-11-06 11:40 -0500, "UHM-9527: bump up htmlformentryui version"; scratch checkout `.../scratchpad/pihcore-master`): `api/.../apploader/{CustomAppLoaderFactory,RequireUtil,CustomAppLoaderUtil}.java`, `config/{Config,ConfigLoader,Components}.java`, `PihEmrConfigConstants.java`, `LiberiaConfigConstants.java`, plus `omod/.../AfterRegistrationPageController.java`, `VitalsListPageController.java`, `vitals/vitalsList.gsp`, `rest/PihFormRestController.java`. Line numbers below are `CustomAppLoaderFactory.java` of this commit unless stated. Since `d6d434cd` (the commit the first version of this file read) the app loader changed only by `442f2592` (UHM-9646, removal of the `deathCertificate` component: -4 lines at old :283 and -18 at old :1014), so every number of the first version was shifted by -4 (old :287-:1013) or -22 (old :1032 on) and nothing else changed. The server's pihcore is a SNAPSHOT, so a deployed server may still differ.
- `pihemr` `0e852f67b7e574922b0f3bf2aa2baf3e9420d6cb` (2026-11-06, "Update PIH OCL export to 1.8.51 (#777)"; local branch `UHM-9592-e2e-skill`, no commits of its own on top of `origin/master`): `scripts/visit/encounterTypeConfig.js`, `htmlforms/`.
- `pihliberia-emr` HEAD `23cbe4b` (2026-11-04) plus uncommitted changes under `e2e/` and `documentation/`: `pih-config-liberia*.json`, `locations/locations.csv`, `distro/openmrs-distro.properties`, `*.env` (`jjd-ci.env`, `harper-demo.env`, `jjdossen.env`, `pleebo.env`: the `OPENMRS_PIH_CONFIG` of each stack).
- Visit-page wiring and the merged forms: `~/openmrs/liberia/configuration/pih/{scripts/visit/encounterTypeConfig.js,htmlforms,subforms}` (the local server's merged config, 2736 lines; `EncounterTypeConfig.get(...)` evaluated with a throwaway node script for country `liberia`, site `harper`; no patient data). Encounter type names: `~/openmrs/liberia/configuration/encountertypes/*.csv`.
**Not covered by this file:** O3 / SPA (the Liberia repo has no frontend config naming a form), `*_v1.0.xml` copies (19) and `retired/` (5), which the guard counts but does not list, `labs` (lab orders), every non-Liberia country branch. Form XML bodies were not read for this file (only the `<htmlform>` attributes), so `<subform>` includes between Liberia forms are in `_shared.e2e.md`.

## Which config offers what

Distro property `pih.config` (`distro/openmrs-distro.properties`): `liberia,liberia-harper,liberia-harper-jjd-ci` (default) | `liberia,liberia-harper,liberia-harper-demo` | `liberia,liberia-harper,liberia-harper-jjdossen` | `liberia,liberia-pleebo`. `liberia-harper-dev` is not in the prompt list; I assume `liberia,liberia-harper,liberia-harper-dev` (unverified). **The local test server on :7072 runs `liberia,liberia-harper,liberia-harper-demo`** (see the top of this file); the remote server this file's first version was written for ran `...-jjd-ci`; both have the same components.

Files merge left to right (`ConfigLoader.merge`): objects are merged key by key, **arrays and scalars are replaced**. So a later file that has a `"components"` array replaces the whole list; one without it keeps the previous list.

| File | Sets |
|---|---|
| `pih-config-liberia.json` | `country: LIBERIA`, no `components`, `registrationConfig`, `dispositionConfig` |
| `-harper.json` | `site: HARPER`, the 33 components below, prefixes `HP` |
| `-harper-jjd-ci.json` | its own `components` array (identical set to `-harper`), prefixes `YY` |
| `-harper-demo.json` / `-harper-jjdossen.json` | no `components` (so `-harper`'s list stays); prefixes `YY` / `JJD` |
| `-harper-dev.json` | its own array = `-harper` plus `spaPreview` |
| `-pleebo.json` | `site: PLEEBO`, 32 components, prefixes `PL` (no `familyMedicine`) |

Components that matter for forms (y = listed). Every other component of the lists (`activeVisits`, `allergies`, `clinicianDashboard`, `dataExports`, `idcardPrinting`, `labs`, `waitingForConsult`, ...) offers none of the forms in this table (checked by grepping pihcore for each form's file name; `labs` is otherwise not covered):

| Component string | `Components.X` | harper | jjd-ci | demo | jjdossen | dev | pleebo | Gates |
|---|---|---|---|---|---|---|---|---|
| `checkIn` | `CHECK_IN` | y | y | y | y | y | y | `enableCheckIn` (:627) |
| `checkInHomepageApp` | `CHECK_IN_HOMEPAGE_APP` | y | y | y | y | y | y | circular "Check-In" home app (:640) |
| `vitals` | `VITALS` | y | y | y | y | y | y | `enableVitals` (:703) |
| `vitalsHomepageApp` | `VITALS_HOMEPAGE_APP` | y | y | y | y | y | y | vitals home app (`/pihcore/vitals/vitalsList.page`, :716) |
| `consult` | `CONSULT` | y | y | y | y | y | y | `enableConsult` (:852) |
| `programs` | `PROGRAMS` | y | y | y | y | y | y | `enablePrograms` (:4131): **wraps `mch`, `mentalHealth`, `epilepsy`, `ncd`** (all four are inside it) |
| `mch` | `MCH` | y | y | y | y | y | y | inside `enablePrograms` :4273 -> `enableMCHForms` (:2266) + MCH program dashboard. (`mchForms`, `Components.MCH_FORMS`, is not listed anywhere; `mch` alone is enough) |
| `mentalHealth` | `MENTAL_HEALTH` | y | y | y | y | y | y | inside `enablePrograms` :4224 -> `enableMentalHealthForm` (:2695) + program dashboard |
| `epilepsy` | `EPILEPSY` | y | y | y | y | y | y | inside `enablePrograms` :4234 -> `enableEpilepsyForm` (:2765) |
| `ncd` | `NCD` | y | y | y | y | y | y | inside `enablePrograms` :4248 -> `enableNCDs` (:2116) |
| `familyMedicine` | `FAMILY_MEDICINE` | y | y | y | y | y | **n** | `enableFamilyMedicine` (:3014) |
| `primaryCare` | `PRIMARY_CARE` | y | y | y | y | y | y | `enablePrimaryCare` (:2907) has Haiti, Mexico and Sierra Leone branches and **no Liberia branch: it adds nothing here** |
| `dispensing` | `DISPENSING` | y | y | y | y | y | y | `enableDispensing` (:1096), legacy `dispensing.xml` |
| `labResults` | `LAB_RESULTS` | y | y | y | y | y | y | `enableLabResults` (:2089) |
| `patientRegistration` | `PATIENT_REGISTRATION` | y | y | y | y | y | y | `enablePatientRegistration` (:1655) |
| `visitNote` | `VISIT_NOTE` | y | y | y | y | y | y | visit page = `/pihcore/visit/visit.page` (not the legacy dashboard); selects the 30-day expression of `patientVisitWithinPastThirtyDays` |
| `spaPreview` | `SPA_PREVIEW` | n | n | n | n | y | n | only a system-admin SPA link, no form |

Not listed by any Liberia site, so those entry points do not exist here: `medicationOrder` (would offer `drugOrder.xml`, not `med-order.xml`), `medicationDispensing` (SPA dispensing), `mchForms`, `consultInitial`, `mchTriage`, `vct`, every HIV flag.

## Shared layers (apply to every row below)

1. **Country branch**: `config.isCountry(LIBERIA)` (`country: LIBERIA` in `pih-config-liberia.json`). Branches that apply to our forms: `enableMCHForms` :2268 (own Liberia block: ANC initial, ANC followup, delivery, peds), `enableMentalHealthForm` :2723 (own Liberia block: intake + followup), `enableEpilepsyForm` :2766 (Liberia only), `enableFamilyMedicine` :3015 (Liberia only), `enableNCDs` :2121/:2146 (Liberia **omits the `&returnUrl=` suffix** the other countries append), `enableMentalHealthForm` :2698 (same omission), `enablePatientRegistration` :1760 (the `patientRegistration-contact` widget is skipped in Liberia). `enableVitals` has no Liberia branch: Liberia falls into the final `else` of the three-way `HAITI / SIERRA_LEONE / else` splits (:726 and :816), see the `vitals` row. Other Liberia branches (:1377 registration/check-in-by-age reports, :3914 and :3945 PHQ-9 and seizure-frequency graphs on the mental health dashboard) offer no form.
2. **Entry point = visit action** (`visitAction(...)`, extension point `patientDashboard.visitActions`) on the visit page, unless the row says otherwise. The require is evaluated with the visit in context; nearly every `visitDoesNotHaveEncounterOfType` starts with `visit &&`, so a visit must be selected. Whether the page also offers the actions on an already-closed visit is unverified. `PihFormRestController` (`GET /ws/rest/v1/pihcore/patientforms?patientUuid=<uuid>&visitUuid=<uuid>[&extensionPoint=...]`) evaluates the same extensions for the current user and returns the `Form` of every offered link extension, so a spec could assert availability through it (not run here).
3. **Component flag**: see the table above.
4. **Privilege**: the extension's `requiredPrivilege` (checked by the app framework) and any `userHasPrivilege(...)` in the `require`. Checked by name against `user.privileges`, so a role alone is not enough. All the names below exist in `~/openmrs/liberia/configuration/privileges/privileges.csv`; which Liberia role grants each was not traced (`roles_liberia.csv` mentions `enterConsultNote`, `retroConsultNote*`, `enterVitalsNote`, `enterMCH`, `enterMentalHealthNote`, `enterNCDConsultNote`, `enterLabResults`, `App: dispensing.app.dispense`; **`Task: mirebalais.checkinForm`, `Task: mirebalais.dispensing` and `App: mirebalais.checkin` appear only in `roles.csv`**).
5. **Session location tag**: `sessionLocationHasTag("<tag>")` against the location the user logged in at. Tags come from `content/configuration/backend_configuration/locations/locations.csv` (identical to the merged copy). The XML's own `<encounterLocation tags=...>` is a second, separate check (not read here).
6. **`require` helpers**, resolved from `RequireUtil.java` (all these expressions are JavaScript evaluated in the visit-page context):

| Helper | Expression |
|---|---|
| `sessionLocationHasTag(t)` | `typeof sessionLocation !== 'undefined' && hasMemberWithProperty(sessionLocation.tags, 'display','t')` |
| `userHasPrivilege(p)` | `typeof user !== 'undefined' && hasMemberWithProperty(user.privileges, 'display', 'p')` |
| `patientHasActiveVisit()` | `typeof visit !== 'undefined' && visit != null && (visit.stopDatetime == null)` |
| `patientVisitWithinPastThirtyDays(config)` | with `visitNote` (Liberia): `typeof visit !== 'undefined' && visit != null && ((((new Date()).getTime() - new Date(visit.stopDatetime).getTime()) / (1000*60*60*24)) < 30 )`. Always false for a still-open visit (`new Date(null)` = 1970) |
| `visitDoesNotHaveEncounterOfType(t)` | `visit && (!visit.encounters || !some(visit.encounters, (function(encounter) {  return encounter.encounterType.uuid === 't' } )))`: the *current visit* only |
| `patientHasPreviousEncounter(t)` | `encounters && some(encounters, function(e) { return e.encounterTypeUuid === 't'; })`: **any visit** (`encounters` is built by the app framework / coreapps, not in pihcore; "all the patient's encounters" is unverified here). Always used as `not(...)` = `!(...)`, i.e. "the patient has never had one" |
| `patientIsFemale()` | `patient.person.gender == 'F'` (`and(patientIsFemale())` just wraps it in parentheses). **No age floor in Liberia** (`patientIsReproductiveAge()`, `age >= 10`, is not used in the Liberia block) |
| `not(x)`, `and(...)`, `or(...)` | `!(x)`, `(a && b ...)`, `(a || b ...)` |
| `retro(<enter-note priv>)` (my shorthand) | `or(and(userHasPrivilege(<enter-note priv>), patientHasActiveVisit()), userHasPrivilege("Task: emr.retroConsultNote"), and(userHasPrivilege("Task: emr.retroConsultNoteThisProviderOnly"), patientVisitWithinPastThirtyDays))`. `<enter-note priv>` is `Task: emr.enterVitalsNote` (vitals), `Task: emr.enterConsultNote` (consult), `Task: emr.enterNCDConsultNote` (NCD) |

7. **Extra entry points**: `cloneAsMchVisitAction` re-registers check-in and vitals (same privilege and require) on the MCH program dashboard (extension point `<MCH program uuid>.visitActions`; `mch` configures that dashboard, whether reaching it needs an MCH enrolment is unverified). Liberia has no `pregnancyProgram` / `infantProgram`, so those clones (also added for vitals) go nowhere. The Liberia ANC/delivery/peds actions have **no clones**.
8. **Launch URL shapes** (forms opened without the app loader go through the same pages):
   - Standard UI entry: `htmlformentryui/htmlform/enterHtmlFormWithStandardUi.page?patientId=<patient uuid>&visitId=<visit numeric id>&definitionUiResource=file:configuration/pih/htmlforms/<form>.xml` (`enterStandardHtmlFormLink`). Simple UI (check-in, vitals, lab results): `enterHtmlFormWithSimpleUi.page` with the same query (`enterSimpleHtmlFormLink`). `...WithoutVisit` variants carry no `visitId` (lab results).
   - Family Medicine appends the literal `"&returnUrl=/" + CONTEXT_PATH + "/" + patientVisitsPageWithSpecificVisitUrl`, which renders as `&returnUrl=/openmrs//pihcore/visit/visit.page?patient=<patient uuid>&visit=<visit uuid>#/overview` (double slash, not URL-encoded, so the parser may treat `&visit=` as another parameter of the entry URL and `#/overview` as its fragment; where the post-save redirect really lands is unverified). The ANC, delivery, peds, NCD, mental health, epilepsy, consult and vitals links have no `returnUrl` in Liberia.
   - Registration action adds `&createVisit=true` (check-in).
   - Edit (the pencil on the visit page, `encounterTypeConfig.js`): `editHtmlFormWithStandardUi.page?patientId=<uuid>&encounterId=<uuid>&returnUrl=...` (`hfeStandardEditUrl`; no `definitionUiResource`, so the form the encounter was saved with reopens), or `editHtmlFormWithSimpleUi.page?...` for check-in, vitals and lab results (`hfeSimpleEditUrl`). Section forms: `editHtmlFormWithStandardUi.page?patientId=<uuid>&visitId=<visit uuid>&encounterId=<uuid>&definitionUiResource=file:configuration/pih/htmlforms/<section>.xml&returnUrl=...`. View: `viewEncounterWithHtmlForm/getAsHtml.action?encounterId=<uuid>&definitionUiResource=...`.
   - After registration (`AfterRegistrationPageController`, Liberia branch): redirect to `enterHtmlFormWithSimpleUi.page?patientId=<uuid>&definitionUiResource=file:configuration/pih/htmlforms/checkin.xml[&createVisit=true]&returnUrl=<registrationapp findPatient page>`; `&createVisit=true` only when the patient's Liberia EMR ID (identifier type `0bc545e0-f401-11e4-b939-0800200c9a66`) starts with the site's `primaryIdentifierPrefix` (HP / YY / JJD / PL), i.e. a newly registered patient, not a paper-record patient.

### Locations that carry each tag (`locations.csv`)

The file has 14 rows: `Health Facility` (tags Program Location + Visit Location only; visits live there) and 13 clinics below it. Tags the code asks for, with every location that satisfies them:

| Tag | Locations |
|---|---|
| Check-In Location | Emergency, MCH Clinic, Mental Health Clinic, NCD Clinic, Outpatient Clinic, Family Medicine, Records Room, Medical Ward, Eye Clinic, Peds Ward, ART Clinic, TB Clinic (all but Pharmacy) |
| Consult Note Location | Emergency, MCH Clinic, Mental Health Clinic, NCD Clinic, Outpatient Clinic, Family Medicine, Medical Ward, Eye Clinic, Peds Ward, ART Clinic, TB Clinic (not Pharmacy, Records Room) |
| Vitals Location | same as Check-In Location |
| Lab Results Location | Emergency, MCH Clinic, NCD Clinic, Outpatient Clinic, Family Medicine, Medical Ward, Eye Clinic, Peds Ward, ART Clinic, TB Clinic (not Mental Health Clinic, Pharmacy, Records Room) |
| Dispensing Location | MCH Clinic, Mental Health Clinic, Pharmacy |
| Maternal and Child Location | **MCH Clinic only** |
| Mental Health Location | **Mental Health Clinic only** |
| NCD Consult Location | **NCD Clinic only** (`b7cfea60-5179-11ea-a500-645d86728797`, also Consult Note) |
| Login Location (not required by any form, but a user can only log in at these) | Emergency, MCH Clinic, Mental Health Clinic, NCD Clinic, Outpatient Clinic, Family Medicine, Pharmacy, Records Room. Medical Ward, Eye Clinic, Peds Ward, ART Clinic, TB Clinic lack it (login is by the tag in standard OpenMRS; here `LOGIN_SHOW_LOCATIONS=false`, so how the session location is chosen is unverified) |
| `Vitals Inpatient Location`, `Check-In Maternal Location`, `Drug Order Location` | **no location has them** (the tags exist in `locationtags.csv`) |

Test location recipe: **MCH Clinic** satisfies the tag layer of every row except NCD (needs NCD Clinic) and mental health/epilepsy (need Mental Health Clinic). Outpatient Clinic or Family Medicine is enough for check-in, vitals, outpatient consult, family medicine and lab results.

## Forms

"dup" = `visitDoesNotHaveEncounterOfType(own type)`. `H` = Harper in every combo (harper, jjd-ci, demo, jjdossen, dev); `P` = Pleebo. Encounter type names are resolved from `encountertypes/*.csv`. Every row needs the `visit` in context unless the row says "no visit".

| Form file | Offered by (entry point) | Component | Privilege | Session location tag | Patient / visit requirement | H | P | Notes |
|---|---|---|---|---|---|---|---|---|
| `checkin.xml` v2.0, Check-In (`55a0d3ea`) | `enableCheckIn` :652 `CHECK_IN_VISIT_ACTION` (Simple UI) + MCH dashboard clone; :663 registration action `CHECK_IN_REGISTRATION_ACTION` (Simple UI + `&createVisit=true`); circular home app `mirebalais.liveCheckin` :641 (`/pihcore/checkin/checkin.page`, `App: mirebalais.checkin`); after-registration redirect (see shared layer 8); registration-summary "most recent check-in" widget :1802-1838 (editable, Simple UI edit) | `checkIn` (+ `checkInHomepageApp` for the app) | `Task: mirebalais.checkinForm` (actions) | Check-In Location (actions; the home app also accepts Check-In Maternal Location, which no Liberia location has) | none (no dup check: several check-ins per visit are offered) | y | y | Registers in `registerTemplateForEncounterType` :700 for the old dashboard. The visit page hides Check-In encounters from the visit list (`showOnVisitList: false`); edit is Simple UI |
| `vitals.xml` v2.2, Vital Signs (`4fb47712`) | `enableVitals` Liberia `else` branch :739 `VITALS_CAPTURE_VISIT_ACTION` (**Simple UI**, + MCH dashboard clone). Home app `pih.app.vitals` :716 (`vitalsHomepageApp`, `/pihcore/vitals/vitalsList.page`, `App: mirebalais.outpatientVitals`, Vitals Location): lists patients with a Check-In encounter **today** and no Vitals encounter today (not filtered by location, TODO in code), link `enterHtmlFormWithSimpleUi.page?patientId=<id>&visitId=<visit of the earliest check-in>&definitionUiResource=...&returnUrl=...vitalsList`. Also the "most recent vitals" clinician-dashboard widget :829 (editable, Simple UI edit, `App: mirebalais.outpatientVitals`) | `vitals` | none on the action; `retro(Task: emr.enterVitalsNote)` | Vitals Location **and** `sessionLocationDoesNotHaveTag("Vitals Inpatient Location")` (no Liberia location has that tag, so the second clause always passes) | `retro` | y | y | No dup check. Edit is Simple UI (`encounterTypeConfig.js`) |
| `outpatientConsult.xml` v1.0, Consultation (`92fd09b4`) | `enableConsult` :853 `CONSULT_NOTE_VISIT_ACTION` (Standard UI) | `consult` | none on the action; `retro(Task: emr.enterConsultNote)` | Consult Note Location | `retro` only | y | y | No dup check, no sections. Same tag as Family Medicine, so both are offered at the same locations at Harper |
| `anc-initial.xml` v1.1, ANC Intake (`00e5e810`) | `enableMCHForms` Liberia block :2270 `MCH_ANC_INTAKE_VISIT_ACTION` | `programs` + `mch` | `Task: emr.enterMCH` | Maternal and Child Location | female (**any age**); no ANC Intake **and** no ANC Followup in the visit | y | y | Not checked against earlier visits or an enrolment (unlike Sierra Leone). Sections on the visit page: vaccinations (female) then med-order, see "Sections" |
| `anc-followup.xml` v1.1, ANC Followup (`00e5e946`) | same, :2281 `MCH_ANC_FOLLOWUP_VISIT_ACTION` | `programs` + `mch` | `Task: emr.enterMCH` | Maternal and Child Location | female; no ANC Intake and no ANC Followup in the visit | y | y | Offered without any earlier ANC Intake |
| `anc-delivery.xml` v1.1, MCH Delivery (`00e5ebb2`) | same, :2292 `MCH_DELIVERY_VISIT_ACTION` (code comment "TODO: working on this") | `programs` + `mch` | `Task: emr.enterMCH` | Maternal and Child Location | female; dup | y | y | Sections: med-order only |
| `peds.xml` v1.0, "PEDS Form" (`fac9d9a2`) | same, :2302 `MCH_PEDS_ACTION` (`pih.form.peds`) | `programs` + `mch` | `Task: emr.enterMCH` | Maternal and Child Location | **female patient** (the paediatric form is hidden for male patients); **no dup check** | y | y | `<htmlform>` has no `formEncounterType`; the encounter type uuid pihcore uses (`LiberiaConfigConstants.ENCOUNTERTYPE_LIBERIAPEDSFORM_UUID`) equals the form's own `formUuid` (`fac9d9a2-d0bc-11ea-9995-3c6aa7c392cc`). How the form is bound to that type at save is unverified. `encounterTypeConfig.js` has **no entry** for the type, so it uses `encounterTypes.DEFAULT` (`encounter.json` template, no `editUrl`): the visit page shows the edit and delete buttons only when `config.editUrl` is set (`visit.js` :287, :297, :1209), so **no edit or delete on the visit page** |
| `ncd-initial.xml` v2.0, NCD Initial Consult (`ae06d311`) | `enableNCDs` :2125 `NCD_INITIAL_VISIT_ACTION` (Standard UI) | `programs` + `ncd` | extension `requiredPrivilege` `Task: emr.enterNCDConsultNote` (always needed, so `retroConsultNote` alone never surfaces it), and the same in `retro` | NCD Consult Location | `retro(Task: emr.enterNCDConsultNote)` (only the 4 rows vitals, outpatientConsult, ncd-initial and ncd-followup have a `retro` clause); **patient has never had** NCD Initial, Initial part 1 or Initial part 2 (`not(patientHasPreviousEncounter)` x3, any visit); the visit has none of the six NCD initial/followup types (`48c413c4` part 1, `43423212` part 2, `e02a8c32`/`6a3afa6f` followup parts, `ae06d311`, `5cbfd6a2`) | y | y | Shell form: content is in the section forms (see "Sections") |
| `ncd-followup.xml` v2.0, NCD Followup Consult (`5cbfd6a2`) | `enableNCDs` :2150 `NCD_FOLLOWUP_VISIT_ACTION` | `programs` + `ncd` | `Task: emr.enterNCDConsultNote` (+ in `retro`) | NCD Consult Location | `retro`; the visit has none of the six NCD types. **No requirement of an earlier initial** | y | y | Shell form (sections) |
| `mentalHealthIntake.xml` v1.0, Mental Health Intake (`fccd53c2`) | `enableMentalHealthForm` Liberia block :2726 `MENTAL_HEALTH_INTAKE_VISIT_ACTION` | `programs` + `mentalHealth` | `Task: emr.enterMentalHealthNote` | Mental Health Location | patient never had a Mental Health Intake (any visit); none in this visit | y | y | Once per patient. No `retro`, no active-visit clause |
| `mentalHealthFollowup.xml` v1.0, Mental Health Consult (`a8584ab8`) | same, :2737 `MENTAL_HEALTH_VISIT_ACTION` | `programs` + `mentalHealth` | `Task: emr.enterMentalHealthNote` | Mental Health Location | no Mental Health Intake and no Mental Health Consult (own type, `ENCOUNTERTYPE_MENTAL_HEALTH_ASSESSMENT_UUID`) in the visit | y | y | No prior-intake requirement. (The `ENCOUNTERTYPE_MENTAL_HEALTH_FOLLOWUP_UUID` constant, `9d701a81`, is not used here) |
| `epilepsyIntake.xml` v1.0, Epilepsy Intake (`7336a05e`) | `enableEpilepsyForm` :2768 `EPILEPSY_INTAKE_VISIT_ACTION` | `programs` + `epilepsy` | `Task: emr.enterMentalHealthNote` | **Mental Health Location** | no Epilepsy Followup and no Epilepsy Intake in the visit | y | y | Gated by the mental health tag and privilege, not an epilepsy one. Offered in every visit (no once-per-patient check) |
| `epilepsy.xml` v1.0, Epilepsy Followup (`74e06462`) | same, :2778 `EPILEPSY_VISIT_ACTION` | `programs` + `epilepsy` | `Task: emr.enterMentalHealthNote` | Mental Health Location | no Epilepsy Intake and no Epilepsy Followup in the visit | y | y | |
| `family-medicine-intake.xml` v2.0, Family Medicine Intake (`1d1faf4f`) | `enableFamilyMedicine` :3017 `LIBERIA_FAMILY_MED_INITIAL_VISIT_ACTION` (Standard UI, `&returnUrl=` the visit page) | `familyMedicine` | **none** (privilege `null`) | Consult Note Location | no Family Medicine Intake and no Family Medicine Followup in the visit. **No `retro` and no active-visit clause** | y | **n** | Shell form: content in section forms (see "Sections") |
| `family-medicine-followup.xml` v2.0, Family Medicine Followup (`84d5e978`) | same, :3028 `LIBERIA_FAMILY_MED_FOLLOWUP_VISIT_ACTION` | `familyMedicine` | none | Consult Note Location | same two checks | y | **n** | Shell form (sections). Offered without any earlier intake |
| `dispensing.xml` v1.0, Medication Dispensing (`8ff50dea`) | `enableDispensing` :1099 home app `dispensing.app` (`dispensing/findPatient.page`, config `definitionUiResource`, `App: dispensing.app.dispense`); :1107 `DISPENSE_MEDICATION_VISIT_ACTION` (Standard UI) | `dispensing` | home app `App: dispensing.app.dispense`; action `Task: mirebalais.dispensing` | Dispensing Location (both) | none besides the visit for the action | y | y | Home-app path leads through the dispensing module's find-patient and patient pages (not read; the exact launch URL is unverified). Also adds the dashboard "dispensing summary" widget. Edit is the default Standard edit |
| `labResults.xml` v1.0, Laboratory Results (`4d77916a`) | `enableLabResults` :2091 `LAB_RESULTS_OVERALL_ACTION` (overall action on the patient dashboard, Simple UI **without visit**: `enterHtmlFormWithSimpleUi.page?patientId=<uuid>&definitionUiResource=...`); :2100 circular home app `pih.app.addLabResults` (find patient, then `...enterHtmlFormWithSimpleUi.page?patientId=<id>&definitionUiResource=...&returnUrl=/openmrs/coreapps/findpatient/findPatient.page?app=pih.app.addLabResults`) | `labResults` | `Task: emr.enterLabResults` | Lab Results Location | **no visit** needed; no patient requirement | y | y | Not offered at Mental Health Clinic or Pharmacy. Edit is Simple UI |
| `patientRegistration-social.xml` v1.0, Patient Registration (`873f968a`) | `enablePatientRegistration` :1747 `MOST_RECENT_REGISTRATION_SOCIAL`: editable "most recent encounter" widget (`coreapps` `encounter/mostRecentEncounter`) on the **registration summary page** | `patientRegistration` | `App: registrationapp.registerPatient` | none | patient with a Patient Registration encounter (made by the registration wizard); no visit | y | y | Not a wizard fragment. The encounter type has no visit-list entry (`showOnVisitList: false`) |
| `patientRegistration-rs.xml` v1.0, Patient Registration (`873f968a`, same type as `-social`) | `enablePatientRegistration` :1677 `MOST_RECENT_REGISTRATION_SUMMARY`: editable **and creatable** "most recent registration" widget (`coreapps` `encounter/mostRecentEncounter`) on the registration summary page; **unconditional** (the Mexico/Haiti-HIV block above it, :1663-:1675, only adds the additional-identifiers widget) | `patientRegistration` | `App: registrationapp.registerPatient` | none | no visit | y | y | Defined in `pihemr`, not overridden here. The first version of this file listed it as not covered: it is offered. spec: `e2e/specs/patientRegistration-rs` |
| `med-order.xml` v1.0, **formName "OB-GYN Plan"** | **not an entry form**: it is the "Medication" section (id `section-obgyn-plan`) of ANC Intake, ANC Followup and MCH Delivery encounters in `encounterTypeConfig.js` (`medOrder`) | – | – | – | – | y | y | No `formEncounterType` attribute. Referenced by no pihcore code. Edit through the visit-page section pencil, see "Sections" |
| `section-*.xml` (17 files) | sections of the encounter types above | – | – | – | – | – | – | see "Sections" |

### Sections (`section-*.xml`, `med-order.xml`)

None is an entry form and none has an app-loader entry. Each is the **view template and edit link of an `encounter-section`** on the visit page, wired in `encounterTypeConfig.js`. Resolution (`EncounterTypeConfig.get(encounter, country='liberia', site='harper'|'pleebo')`, end of the file): `encounterTypes[<type uuid>]` -> key `liberia` (then `[site]`, else `DEFAULT`) when the type has one, else `DEFAULT`; then `versions[encounter.form.version]`, else `versions.DEFAULT`. No type has a `harper`/`pleebo` key, so both sites resolve identically. A section form is meaningful only in EDIT on the parent encounter and has no encounter type of its own.

| Section file | Section id (label key) | Shown under (encounter type; form version) | `require` / notes |
|---|---|---|---|
| `section-history.xml` | `pihcore-history` | Family Medicine Intake (`1d1faf4f`, any version) | none |
| `section-review-of-systems.xml` | `pihcore-review-of-systems` | Family Medicine Intake and Followup (`84d5e978`) | none. Uses `subforms/review-of-systems.xml` of this repo (unverified). **Absent from the local `pihemr` checkout's copy of `encounterTypeConfig.js`** (only the merged config has it) |
| `section-dx.xml` | `pihcore-diagnosis` | Family Medicine Intake and Followup; NCD Initial and NCD Followup (`liberia` -> `DEFAULT` version) | none |
| `section-ncd-history.xml` | `pihcore-ncd-history` | NCD Initial (`ae06d311`, form version 2.0 = `liberia.versions.DEFAULT`) | NCD Initial 1.0 resolves to `ncd-initial_v1.0.xml` as the whole view and has no sections |
| `section-ncd-followup.xml` ("NCD Visit Information") | `pihcore-ncd-followup` | NCD Followup (`5cbfd6a2`, 2.0) | NCD Followup 1.0 resolves to `ncd-followup_v1.0.xml`, no sections |
| `section-hospital.xml`, `section-diabetes.xml`, `section-hypertension.xml`, `section-heart-failure.xml`, `section-lung.xml`, `section-kidney.xml`, `section-liver.xml`, `section-palliative.xml`, `section-sickle-cell.xml` | `pihcore-hospital`, `-diabetes`, `-hypertension`, `-heart-failure`, `-lung`, `-kidney`, `-liver`, `-palliative`, `-sickle-cell` | NCD Initial and NCD Followup (2.0), in that order after the history/visit-info section | none |
| `section-ncd-plan.xml` | `pihcore-ncd-plan` (after `section-dx` and the vaccinations widget) | NCD Initial and NCD Followup (2.0) | none |
| `med-order.xml` | `section-obgyn-plan` ("Medication") | ANC Intake and ANC Followup (1.1; no `versions`) and MCH Delivery (`00e5ebb2`) | none. Also the vaccinations widget (`include-section`, not a form) after the ANC sections, `require: patient.person.gender == 'F'` |
| `section-exam.xml` | – | **not reachable** (has a spec, tagged `@unreachable`): no `liberia` entry of `encounterTypeConfig.js` lists it. The merged file uses it (`primaryCareExam`, :92-:100) only under the primary care, HIV, PMTCT, OB/GYN and oncology encounter types and in the `DEFAULT`/Haiti NCD configs, none of which a Liberia entry point creates | Reachable only by direct edit URL, or for such encounters if they exist. Liberia overrides `pihemr`'s copy. See `## Not reachable` |
| `section-other-ncd.xml` | `pihcore-other-ncds` | **not reachable** (has a spec, tagged `@unreachable`): `otherNCDs` is listed by the `DEFAULT`/Haiti configs of NCD Initial and Followup (:1263, :1374) and by the NCD part-2 types; the `liberia` NCD key omits it | direct edit URL only. See `## Not reachable` |

| `section-chief-complaint.xml` (pihemr) | `pihcore-chief-complaint` (short `chiefComplaintSectionShort.page`, long `viewSectionWithHtmlFormLong.page`, `templateModelUrl` active: the visit page shows the form's VIEW) | Family Medicine Followup (`84d5e978`, any version), first section | none. spec: `e2e/specs/section-chief-complaint`. Finding record: pihemr `_findings.e2e.md#section-chief-complaint.xml, section-peds.xml` |
| `section-peds.xml` (pihemr) | `pihcore-peds` (short `pedsSectionShort.page`, long `viewSectionWithHtmlFormLong.page`, `templateModelUrl` active) | Family Medicine Intake and Followup, after the vaccinations widget | `require: fullMonthsBetweenDates(visit.patient.person.birthdate, visit.startDatetime) < 15*12`, i.e. the patient is under 15 at the start of the visit. spec: `e2e/specs/section-peds` |
| `section-plan.xml` (pihemr) | `pihcore-plan` (short `primaryCarePlanSectionShort.page`, long `viewPlanSectionWithHtmlFormLong.page`, `templateModelUrl` active, print template `printPrescriptionsWithHtmlFormLong.page`) | Family Medicine Intake and Followup, last section | none. spec: `e2e/specs/section-plan`. `section-plan-medication.xml`, named by the `pihcore-plan-medication` section (:162), does not exist in the merged directory (and is on no Liberia type) |
| `section-prescriptions-print.xml` (pihemr) | – (the `printTemplateUrl` of `pihcore-plan`, :145) | the print action of the Plan section of the Family Medicine encounters (`defaultPlanSectionActions.gsp`: `printPrescriptions()`) | the form's `<htmlform>` has no encounter type of its own; it renders the Plan encounter's drug orders for printing. spec: `e2e/specs/section-prescriptions-print` |

Order on the visit page: FM Intake = history, review of systems, vaccinations, peds, dx, plan; FM Followup = chief complaint, review of systems, vaccinations, peds, dx, plan. The vaccinations widget (`include-section`, `templates/vaccination/vaccinations.page`) is not a form.

## Visit-page configuration (`encounterTypeConfig.js`)

What the visit page shows for the encounter types Liberia entry points create, resolved with `EncounterTypeConfig.get(encounter, 'liberia', 'harper')` (throwaway node script over the merged file; neither site has its own key, and the form version 1.0 of the NCD types resolves to `ncd-*_v1.0.xml` as a whole view without sections). **Form VIEW** = the long template binds the HTML of a `getAsHtml.action` `templateModelUrl` that names the form (the spec tests it with `expectViewShowsSavedObs`). Otherwise the spec says `// Visit-page display:` and tests what the page shows.

| Form | Entry (long template / `templateModelUrl`) | Edit pencil | Visit page shows | Spec tests |
|---|---|---|---|---|
| `checkin.xml` | `checkInShort.page` / `defaultHtmlFormEncounterLong.page`, `encounter.json` (HFE field list); `showOnVisitList: false` | Simple UI | a card (type, date, "by", type-of-visit obs); expands to one label + `.obs-value` row per saved field | the rows |
| `vitals.xml` | `vitalsShort.page` / `viewEncounterWithHtmlFormLong.page`, `getAsHtml.action` **without** `definitionUiResource` | Simple UI | form VIEW (the encounter's own form; needs an encounter saved through the form) | VIEW |
| `outpatientConsult.xml` | `defaultEncounterShort.page` / `clinicConsultLong.page`, **no** `templateModelUrl` | Standard UI | rows Diagnoses, Non-Coded Diagnoses, Disposition, Procedure performed, Return visit date, Clinical Note | the rows |
| `anc-initial.xml`, `anc-followup.xml`, `anc-delivery.xml` | `viewEncounterWithHtmlFormLong.page`, `getAsHtml.action` + the form | Standard UI | form VIEW, then the `section-obgyn-plan` (`med-order.xml`) section (and the vaccinations widget, `(req)` female, on ANC) | VIEW; `med-order` VIEW |
| `peds.xml` | `defaultEncounterShort.page` / `defaultHtmlFormEncounterLong.page`, `encounter.json` | **none** | a card that expands to `.obs-value` rows; no edit or delete | the rows (empty encounter) |
| `ncd-initial.xml`, `ncd-followup.xml` | `defaultEncounterShort.page` / `defaultEncounterShort.page`, **no** `templateModelUrl` (2.0) | Standard UI | the sections: NCD Initial = history, hospital, diabetes, hypertension, heart failure, lung, kidney, liver, palliative, sickle cell, diagnosis, vaccinations, plan; NCD Followup = `pihcore-ncd-followup` in place of history | the section list |
| `mentalHealthIntake.xml`, `mentalHealthFollowup.xml`, `epilepsyIntake.xml`, `epilepsy.xml` | `viewEncounterWithHtmlFormLong.page`, `getAsHtml.action` + the form | Standard UI | form VIEW | VIEW |
| `family-medicine-intake.xml`, `family-medicine-followup.xml` | as the NCD shells | Standard UI | the sections listed under "Sections" (history / chief complaint, review of systems, vaccinations, peds (under 15), diagnosis, plan) | the section list |
| `labResults.xml`, `dispensing.xml` | `viewEncounterWithHtmlFormLong.page`, `getAsHtml.action` without `definitionUiResource` | Simple UI / Standard UI | form VIEW | VIEW |
| `patientRegistration-social.xml` | `defaultEncounterShort.page` / `defaultEncounterLong.page`, no `templateModelUrl`; `showOnVisitList: false` | none | a card with the obs as label + value rows (still drawn on the real page) | the rows |
| `section-*.xml` | each section's `viewSectionWithHtmlFormLong.page` + `templateModelUrl` = the form | section pencil | form VIEW, **except `section-dx.xml`**: `pihcore-diagnosis` has an active `templateModelUrl` but `longTemplate: dxLong.page` never binds it, so the page shows its own rows (Diagnoses, Non-Coded Diagnoses, Clinical Note) | VIEW; `section-dx`: the rows |

## Fixture recipes

- **Any visit-action form** (check-in, vitals, outpatientConsult, ANC, delivery, peds, NCD, mental health, epilepsy, family medicine, dispensing): a patient with a visit (create it over REST at the `Health Facility` visit location) and a session at a location carrying the row's tag, as a user holding the row's privilege. Only **vitals, outpatientConsult, ncd-initial and ncd-followup** have a `retro` clause: for them an active visit plus the enter-note privilege is enough, and a closed visit needs `Task: emr.retroConsultNote` (or `...ThisProviderOnly` with the visit ended less than 30 days ago); for NCD the extension's own `requiredPrivilege` `enterNCDConsultNote` is needed in addition. Every other visit action (check-in, ANC, delivery, peds, mental health, epilepsy, family medicine, dispensing) has no active-visit or retro clause at all.
- **ANC initial/followup, delivery, peds**: patient `gender = F` (any age), session at **MCH Clinic**, user with `Task: emr.enterMCH`. Peds is the odd one: a male patient never sees it. For ANC initial/followup the visit must hold no ANC Intake/Followup encounter; for delivery no MCH Delivery.
- **ncd-initial**: session at **NCD Clinic**, `Task: emr.enterNCDConsultNote`, a patient with **no earlier NCD Initial / part 1 / part 2 in any visit** and a visit with no NCD encounter. **ncd-followup**: same visit condition only.
- **mentalHealthIntake**: session at **Mental Health Clinic**, `Task: emr.enterMentalHealthNote`, a patient with no earlier Mental Health Intake. **mentalHealthFollowup**, **epilepsy***: same location and privilege; visit holds none of the form's two/three blocking types.
- **family-medicine-***: harper only (not Pleebo); any Consult Note Location (e.g. Family Medicine, Outpatient Clinic); no privilege needed.
- **labResults**: no visit; session at a Lab Results Location (e.g. NCD Clinic, not Mental Health Clinic); `Task: emr.enterLabResults`. Open from the patient dashboard overall actions, or by the Simple UI URL without `visitId`.
- **dispensing**: session at Pharmacy (or MCH / Mental Health Clinic); `App: dispensing.app.dispense` for the home app, `Task: mirebalais.dispensing` for the visit action.
- **patientRegistration-social**: create the patient through the registration wizard, then open the registration summary (`registrationapp/registrationSummary.page?patientId=<uuid>&appId=registrationapp.registerPatient`, unverified), or open `editHtmlFormWithStandardUi.page?patientId=<uuid>&encounterId=<registration encounter uuid>&definitionUiResource=file:configuration/pih/htmlforms/patientRegistration-social.xml` directly.
- **Sections**: create the parent encounter over REST (type uuid and form version from the tables), open the section's edit URL directly (`SectionFormPage`); this skips every gating layer above. For NCD use form version 2.0 (a 1.0 encounter has no sections), for ANC/delivery the `med-order.xml` edit URL on an ANC Intake, ANC Followup or MCH Delivery encounter.
- **Direct entry/edit URLs** skip the component, privilege, tag and `require` layers (same as the other sites; not run here for Liberia).
- **Unreachable but specced**: `section-exam.xml` and `section-other-ncd.xml` have no Liberia path (direct edit URL only); their specs say so (`// UNREACHABLE`, `@unreachable`). `med-order.xml` is a section, never an entry form.

## Things to know before writing specs

- `primaryCare` is listed by every Liberia site but offers nothing (no Liberia branch in `enablePrimaryCare`); Liberia's general consult forms are `outpatientConsult` (`consult`) and the two Family Medicine forms (`familyMedicine`), both at Consult Note Location, so at Harper they appear side by side.
- `mch`, `mentalHealth`, `epilepsy`, `ncd` work only because `programs` is also listed; dropping `programs` from a site silently removes all four.
- `peds.xml` is hidden for male patients, has no dup check and no visit-page edit or delete button (no `encounterTypeConfig.js` entry for its type, and `visit.js` needs `editUrl` for both); its encounter type uuid equals its own formUuid.
- Epilepsy forms are offered by the Mental Health Location tag and `enterMentalHealthNote`; NCD followup does not need an NCD initial; ANC followup does not need an ANC intake; the mental health followup does not need an intake; only vitals, outpatientConsult and the two NCD forms have a retro clause; Family Medicine, Dispensing, check-in, ANC, delivery, peds, mental health and epilepsy have none (no active-visit requirement).
- `Task: mirebalais.checkinForm`, `Task: mirebalais.dispensing` and `App: mirebalais.checkin` are not in `roles_liberia.csv`: a test user needs them granted some other way (which role, unverified).
- The specs run on the Harper stack of the local server; the `pleebo` column and the `harper-dev` extras are not exercised (see `## Confirmed by the e2e specs`).

## Confirmed by the e2e specs (local server on :7072, stack `liberia,liberia-harper,liberia-harper-demo`, 2026-11-09)

What the specs showed about reaching the forms; the harness logs in with the admin user at the session location **NCD Clinic**. The full suite ran in 13.7 minutes with `--workers=3` (333 tests: 331 passed, 2 `test.fixme` skipped, none failed); `dispensing` was then changed (V2 to `test.fixme`, one VIEW test added) and re-run on its own, so the suite is now 334 tests: 331 passed, 3 skipped.

- **Direct URLs skip the gating.** `enterHtmlFormWithStandardUi.page` (top-level forms, in a visit created over REST) and `editHtmlFormWithStandardUi.page` (sections, on an encounter created over REST) open without the component, privilege, tag or visit-page requirements of the rows above. The gating itself is not tested.
- **Session location vs the form's location tag.** NCD Clinic carries Consult Note, NCD Consult, Check-In, Vitals and Lab Results (REST-verified), so the consult, NCD, check-in and vitals forms preselect it. Forms with another tag pick their location in the form: dispensing (MCH Clinic, Mental Health Clinic or Pharmacy), the mental health and epilepsy forms (Mental Health Clinic).
- **Simple UI.** `checkin.xml`, `vitals.xml` and `labResults.xml` are opened with `enterHtmlFormWithSimpleUi.page` as production does; only that UI defines `NavigatorController`, which their scripts use (the same finding as in the SL file).
- **NCD and family medicine shells** (`ncd-initial`, `ncd-followup`, `family-medicine-*`) submit themselves on load in ENTER when the location has a value (NCD: only then; family medicine: always).
- **What the visit page shows** is in `## Visit-page configuration`. Confirmed by running: the shells list their sections and show no value; `outpatientConsult.xml` shows the `clinicConsultLong.page` rows; `checkin.xml` and `peds.xml` show `.obs-value` rows from HFE's `encounter.json`; the Patient Registration card shows the obs as label + value rows but cannot be edited; `section-dx.xml` shows its own rows although `templateModelUrl` is active.
- **VIEW findings confirmed on the visit page:** `dispensing.xml` V2 (`htmlForm is not defined` thrown on load by the script outside `ifMode`; Angular's exception handler logs it as a console error, so it is **not** an uncaught page error and the `failOnJsError` fixture does not catch it: the V2 test reads the console); `section-history.xml` VW1 (`#surgery-block` stays hidden) and `section-liver.xml` VW1 (`#hepbtreatment-section` stays hidden), both `test.fixme`. `labResults.xml` V5 (shared `formUuid` with `labResults_v1.0.xml`) breaks EDIT only: the VIEW on the visit page shows the HIV result.
- **`peds.xml` V1** (no `formEncounterType`): the save is refused with "Encounter type is Required" (README, first run), so the only PEDS Form encounters on the visit page are ones created over REST.
- **Programs.** Saving the mental health and epilepsy forms enrols the patient in Mental Health; `section-ncd-followup` enrols in NCD; ANC intake enrols in MCH (asserted in the specs).
- **Flake seen once.** In the first full run (3 workers) `anc-delivery` "ENTER shows who/when/where ..." failed with `SyntaxError: Unexpected end of input` and `ReferenceError: moment is not defined` (from `htmlForm.js`) in the page, and its VIEW test timed out; both passed in every later run (also with 3 workers). Not reproduced, so not recorded as a form finding.

## Not reachable

39 reachable + 56 not reachable = 95 forms in the merged directory (versioned `_v*` copies: 19, `retired/` directory: 5, counted by the guard and not listed). Reasons use the skill's vocabulary. `non-production profile only` is not used: Liberia has no profile that adds forms (`harper-dev` adds only `spaPreview`). Sections are `section or subform` with the parent's status in Detail, because they have no entry of their own. `section-exam.xml` and `section-other-ncd.xml` have a spec. **Scope of the `unreferenced` searches:** the file name in `CustomAppLoaderFactory.java` and the other Java, GSP, JSON, XML and JS files of pihcore master (api and omod, tests excluded), in the merged config of the local server (`htmlforms/`, `subforms/`, `scripts/`) and in `pihemr`/`pihliberia-emr` `content/`. **Not searched:** coreapps, registrationapp, htmlformentryui, `openmrs-module-mirebalais` and the ADT/O2 modules, and the app definitions installed in the server's database.

| Form file | Defined in | Reason | Detail |
|---|---|---|---|
| `admissionNote.xml` | pihemr | component off | `adt`: `enableADT` :919 (awaiting-admission link :940, visit action :956), dispatcher :271; no Liberia profile lists `adt` |
| `cancelAdmission.xml` | pihemr | component off | `adt` (`enableADT`, link :948) |
| `chemotherapyTreatment.xml` | pihemr | component off | `oncology`: `enableOncology` :1985 (action :2031), called from `enablePrograms` :4268; not listed |
| `comment.xml` | pihemr | component off | `commentForm`: `enableCommentForm` :4572 (action :4577), dispatcher :494; not listed |
| `covid19Discharge.xml` | pihemr | component off | `covid19`: `enableCovid19` :3530 (action :3548), dispatcher :474; not listed |
| `covid19Followup.xml` | pihemr | component off | `covid19` (`enableCovid19`, action :3539) |
| `covid19Intake.xml` | pihemr | component off | `covid19IntakeForm`: `enableCovid19IntakeForm` :3555 (action :3560), dispatcher :478; not listed |
| `drugOrder.xml` | pihemr | component off | `medicationOrder`: `enableMedicationOrder` :1189 (action :1194), dispatcher :299; not listed (the Liberia `med-order` is a different form, a section) |
| `drugRehab.xml` | pihemr | component off | `drugRehab`: `enableDrugRehab` :3625 (action :3630), dispatcher :506; not listed |
| `echocardiogram.xml` | pihemr | component off | `echocardiogram`, nested inside `ncd` (`enablePrograms` :4252 -> `enableEcho` :2249, action :2251); Liberia lists `ncd` but not `echocardiogram` |
| `edNote.xml` | pihemr | component off | `edConsult`: `enableEDConsult` :905 (action :911), dispatcher :267; not listed |
| `obGyn.xml` | pihemr | component off | `obgyn`, a flag inside `enableMCHForms` :2471 (action :2476); Liberia lists `mch` but not `obgyn` |
| `obGyn_1.0.xml` | pihemr | component off | older copy of `obGyn.xml`, named `_1.0` so the guard does not skip it as a `_v*` copy; no entry of its own |
| `oncologyIntakeConsult.xml` | pihemr | component off | `oncology` (`enableOncology`, action :2042) |
| `oncologyTreatment.xml` | pihemr | component off | `oncology` (`enableOncology`, action :2013) |
| `ovcFollowup.xml` | pihemr | component off | `ovc`: `enableOvc` :3576 (action :3593), inside `enablePrograms` :4257; not listed |
| `ovcIntake.xml` | pihemr | component off | `ovc` (`enableOvc`, action :3583) |
| `socio-econ.xml` | pihemr | component off | `socioEconomics`: `enableSocioEconomics` :2828 (action :2833), dispatcher :438; not listed |
| `surgicalPostOpNote.xml` | pihemr | component off | `surgery`: `enableSurgery` :1240 (action :1246), dispatcher :307; not listed |
| `vaccination-only.xml` | pihemr | component off | `vaccination`: `enableVaccinationOnly` :2680 (action :2685), inside `enablePrograms` :4262; not listed |
| `ancFollowup.xml` | pihemr | other country | `enableMCHForms`, final `else` branch (:2323, action :2343); Liberia has its own block (:2268) with `anc-followup` |
| `ancIntake.xml` | pihemr | other country | same final `else` branch (action :2329); Liberia offers `anc-initial` |
| `delivery.xml` | pihemr | other country | `enableMCHForms`: Haiti branch (:2310, action :2316) and the Sierra Leone `mchBasicDeliveryForm` block (:2456, action :2461); Liberia offers `anc-delivery` |
| `mentalHealth.xml` | pihemr | other country | `enableMentalHealthForm` :2695: the Sierra Leone branch (:2703) and the final `else` (:2749); Liberia has its own branch (:2723) with `mentalHealthIntake` and `mentalHealthFollowup`. The visit page has a view entry for its type (`encounterTypeConfig.js` :1789) that no Liberia entry point creates |
| `patientRegistration-contact.xml` | pihemr | other country | `enablePatientRegistration`: `if (!config.isCountry(LIBERIA))` :1760 (action :1768) skips the contact widget in Liberia |
| `primary-care-adult-followup.xml` | pihemr | other country | `enablePrimaryCare` :2907, Haiti branch :2909 (action :2959); no Liberia branch (the others are Mexico :2969 and Sierra Leone :2987), although `primaryCare` is on at every Liberia site |
| `primary-care-adult-initial.xml` | pihemr | other country | same Haiti branch (action :2944) |
| `primary-care-peds-followup.xml` | pihemr | other country | same Haiti branch (action :2930) |
| `primary-care-peds-initial.xml` | pihemr | other country | same Haiti branch (action :2915) |
| `section-c-section.xml` | pihemr | other country | `cSection` section (`encounterTypeConfig.js` :521) of MCH Delivery in the `DEFAULT` config; the `liberia` key lists only `med-order` |
| `section-delivery.xml` | pihemr | other country | `delivery` section (:509) of MCH Delivery in the `DEFAULT` config only |
| `section-ncd.xml` | pihemr | other country | `ncd` section (:174, :186, :196) of NCD Initial/Followup in the `DEFAULT` and Haiti configs; the `liberia` NCD key lists its own sections |
| `section-other-ncd.xml` | pihliberia-emr | other country | `otherNCDs` (:356) is listed by the `DEFAULT`/Haiti configs of NCD Initial and Followup (:1263, :1374) and by the NCD part-2 types (:1419, :1484); the `liberia` NCD key omits it. **Has a spec** (direct edit URL; `@unreachable`). Only in this repo, not in `pihemr` |
| `oncologyConsult.xml` | pihemr | retired | its visit action is commented out in `enableOncology` (:1989-:2002, "Removed Feb 2023 per Lormil. This form is no longer used"); `oncology` is off anyway |
| `section-comments.xml` | pihemr | section or subform | section of the home-assessment encounter types (`encounterTypeConfig.js` :628); no Liberia entry point creates them |
| `section-dx-obgyn.xml` | pihemr | section or subform | `pihcore-diagnosis-obgyn` section (:133) of the OB/GYN encounter type; parent `obGyn.xml` is `component off` |
| `section-education-subjects.xml` | pihemr | section or subform | home-assessment types (:598) |
| `section-exam.xml` | pihliberia-emr (shadows pihemr) | section or subform | `primaryCareExam` (:92-:100) is listed only by primary care, HIV, PMTCT, OB/GYN and oncology encounter types and by the `DEFAULT`/Haiti NCD configs; no Liberia entry point creates those and the `liberia` NCD key omits it. **Has a spec** (direct edit URL; `@unreachable`) |
| `section-family-planning-simple.xml` | pihemr | section or subform | `maternal-family-planning` section (:618) of the home-assessment types |
| `section-maternal-danger-signs.xml` | pihemr | section or subform | home-assessment types (:577) |
| `section-maternal-vital-signs.xml` | pihemr | section or subform | home-assessment types (:588) |
| `section-mch-referral.xml` | pihemr | section or subform | home-assessment types (:566) |
| `section-obgyn-initial.xml` | pihemr | section or subform | OB/GYN encounter type (:532); parent `obGyn.xml` is `component off` |
| `section-obgyn-plan.xml` | pihemr | section or subform | OB/GYN encounter type (:544); not the Liberia `med-order`, which is the "Medication" section of the ANC and delivery encounters |
| `section-oncology-history.xml` | pihemr | section or subform | Oncology Initial Consult (:648); parent `oncologyIntakeConsult.xml` is `component off` |
| `section-oncology-plan.xml` | pihemr | section or subform | same (:659) |
| `section-postpartum-counsel.xml` | pihemr | section or subform | home-assessment types (:608) |
| `section-return-visit-date.xml` | pihemr | section or subform | home-assessment types (:638) |
| `dischargeNote.xml` | pihemr | unreferenced | no `getFormResource` and no `encounterTypeConfig.js` form entry; the only hit in `pihliberia-emr` is the message code `mirebalais.dischargeNote.dischargeDate.label` in `section-hospital`. Its encounter type has a visit-page entry; a launch from the O2 ADT module is unverified |
| `infantDocumentation.xml` | pihemr | unreferenced | no hit; its encounter type ("HIV Infant Documentation") is not offered by any Liberia entry point |
| `patientRegistration.xml` | pihemr | unreferenced | no reference (only the text of `patientRegistration-rs`); same encounter type as the widget forms `patientRegistration-rs` and `-social` |
| `section-family-planning.xml` | pihemr | unreferenced | `encounterTypeConfig.js` defines the section (`familyPlanningHistory` :413) but no encounter type lists it |
| `section-lab-order.xml` | pihemr | unreferenced | defined as `labRadOrder` (:390) and listed by no encounter type; a comment in `section-plan_v1.0.xml` calls it a duplicate |
| `section-peds-feeding.xml` | pihemr | unreferenced | no reference anywhere |
| `section-peds-supplements.xml` | pihemr | unreferenced | no reference anywhere |
| `transferNote.xml` | pihemr | unreferenced | same searches as `dischargeNote.xml`; its encounter type has a visit-page entry, a launch from the O2 ADT module is unverified |

## Not covered

Reachable forms with no spec, **each by name**. All five are inherited from `pihemr` and offered on the Harper stack the local server runs (so they need no other server); they are the whole of `## To spec` and the reason is the same: not written yet.

| Form file | Reason |
|---|---|
| `patientRegistration-rs.xml` | deferred: in `## To spec` (batch 1) |
| `section-chief-complaint.xml` | deferred: in `## To spec` (batch 1) |
| `section-peds.xml` | deferred: in `## To spec` (batch 1) |
| `section-plan.xml` | deferred: in `## To spec` (batch 1) |
| `section-prescriptions-print.xml` | deferred: in `## To spec` (batch 1) |

## To spec

Nothing: every reachable form has a spec. (Batch 1, `section-chief-complaint`, `section-peds`, `section-plan`, `section-prescriptions-print` and `patientRegistration-rs`, was written last; the table is empty now.)



## Findings

Where the Verify findings of each group of forms are recorded (see the skill, "Findings with no test"):

- Forms **defined in this repo** (the 38 files of `content/.../pih/htmlforms/`, which includes the overrides `checkin`, `vitals`, `outpatientConsult`, `dispensing`, `labResults`, `ncd-*`, `patientRegistration-social`, `section-dx`, `section-exam`, `section-history`): in the header of the spec of each form, numbered per file (`V1`..) or as `VW1`.. for visit-page display findings.
- Forms **inherited from pihemr without an override** (the five of `## To spec`): `pihemr` `documentation/_findings.e2e.md`, one section per form; a Liberia spec only points there.
- **Shared subforms and scripts** (`encounter-provider-location-date.xml`, `nextAndSubmitButtons.js`, the drug-order widget, ...): `_shared.e2e.md`, referenced as `see _shared V<n>`.
- The finding ids that the local run confirmed or disproved are in `## Confirmed by the e2e specs`.


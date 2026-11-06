# PIH OpenMRS HTML Form documentation

The contents of this /documentation folder are .csv files with the form configuration files in the parent directory.

These CSVs should always be serialized as valid CSV (consistent column counts per row, and proper quoting/escaping for commas, quotes, and multiline values) so they render and remain searchable in GitHub.

To regenerate documenting HFE files as .CSVs, follow these steps:

 - Start a new Claude session
 - Upload these 3 files:
    - parse_hfe.py
    - full_concept_mappings.csv (the latest one)
    - hfe-csv-docs.skill.md
 - Say something like *"I need to generate documentation CSVs for another set of OpenMRS HFE XML forms — I've uploaded the parser, concept mappings, and skill doc from last time"*

These files are in this directory. 

**NOTE:**  full_concept_mappings.csv is generated from this SQL statement against OpenMRS:

 ```
 select concept_name(concept_id,'en') "name", r.* 
   from report_mapping  r ;
 ```

Regenerate that file to ensure the latest mappings are used.

## E2E notes and verify mode

Beyond the CSVs, the separate `hfe-e2e-specs.skill.md` (which cross-references `hfe-csv-docs.skill.md`) describes how to write Playwright E2E specs for the forms (in `e2e/specs/`, see `e2e/README.md`). The documentation for a form (conditional display, scripts, side effects, verify findings) is written as comments in its spec, so there are no per-form notes. Two site-wide files remain: `_availability.e2e.md` (when each form is offered, written once per site from `openmrs-module-pihcore`'s `CustomAppLoaderFactory.java`, which references forms by file name rather than form uuid) and `_shared.e2e.md` (shared subforms and scripts, and the findings in them). Versioned `_v*` copies are skipped. The work runs on fresh agents (not forks) to keep token use down. `inventory.py` (needs `lxml`) does the mechanical part first: per-form inventories (`<form>.inv.md`) with the conditional-display and JavaScript tables pre-filled, the mechanical verify checks, a flag for forms with nothing conditional, a note on which unresolved concepts are probably just newer than the mappings CSV, and git-based skipping of forms whose spec is up to date (`--only-changed`).

The E2E skill also has an optional **verify mode**. Ask for it with something like *"generate the docs for these forms and verify them"*. It reviews the form XML for incorrectly passed HFE parameters and for custom JavaScript that doesn't do what it intends. It reports findings with a severity (High / Medium / Low / Info) and proposed fixes, and does not edit the forms unless asked.

The E2E specs and the two `_*.e2e.md` files are written by the model rather than by `parse_hfe.py`, and the CSV format is unchanged.
 

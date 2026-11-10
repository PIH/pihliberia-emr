# PIH OpenMRS HTML Form documentation

The .csv files in this /documentation folder document the form configuration files in the parent directory, together with `_availability.e2e.md` and `_shared.e2e.md` (written by the E2E skill) and the concept mappings CSV.

The tooling (`hfe-csv-docs.skill.md`, `hfe-e2e-specs.skill.md`, `parse_hfe.txt`, `inventory.py`) lives **once, in `pihemr`**, under `content/configuration/backend_configuration/pih/htmlforms/documentation/`; see the README there for how to run it against this repo (`inventory.py --site-repo <this repo>`).

These CSVs should always be serialized as valid CSV (consistent column counts per row, and proper quoting/escaping for commas, quotes, and multiline values) so they render and remain searchable in GitHub.

`full concept mappings_<date>.csv` is generated from this SQL statement against OpenMRS (regenerate it to use the latest mappings):

 ```
 select concept_name(concept_id,'en') "name", r.*
   from report_mapping  r ;
 ```

The E2E specs (`e2e/specs/`, see `e2e/README.md`) carry each form's documentation as comments; `_availability.e2e.md` says when each form is offered and which forms are not reachable or not covered; `_shared.e2e.md` covers shared subforms and scripts.

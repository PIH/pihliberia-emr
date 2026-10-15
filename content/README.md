# PIH Liberia Content Package

This module defines the Liberia-specific [OpenMRS Initializer](https://github.com/mekomsolutions/openmrs-module-initializer) configuration. At build time, the contents of `configuration/` are assembled into a zip artifact published as `org.pih.openmrs:pihliberia-content`.

This content package is merged with the shared [PIH EMR content](https://github.com/PIH/pihemr) (`org.pih.openmrs:pihemr-content`) when the distribution is built.

## Configuration Structure

Configuration files live under `configuration/backend_configuration/` and are loaded by the OpenMRS Initializer module at startup.

| Directory | Purpose |
|---|---|
| `addresshierarchy/` | Address hierarchy entries for Liberia |
| `drugs/` | Drug definitions |
| `encountertypes/` | Encounter type definitions |
| `globalproperties/` | OpenMRS global property overrides |
| `locations/` | Facility and location definitions |
| `messageproperties/` | Localized message overrides (`en`) |
| `patientidentifiertypes/` | Patient identifier type definitions |
| `pih/` | PIH-specific configuration (site `pih-config-*.json` profiles, HTML forms, liquibase, styles, logo) |
| `programs/` | Program definitions |
| `programworkflows/` | Program workflow definitions |
| `programworkflowstates/` | Program workflow state definitions |
| `reports/` | Report descriptors |
| `roles/` | Role definitions |

## content.properties

`content.properties` provides the content package name and version (interpolated from the Maven project at build time), and defines key UUID/name constants used across the configuration:

| Property | Description |
|---|---|
| `var.patientIdentifierType.liberiaEmrId.uuid` | UUID of the Liberia EMR ID patient identifier type |
| `var.patientIdentifierType.sampleDossierNumber.uuid` | UUID of the sample dossier number identifier type |
| `var.patientIdentifierType.biometricsReferenceCode.uuid` | UUID of the biometrics reference code identifier type |
| `var.patientIdentifierType.mentalHealthMrn.uuid` | UUID of the mental health MRN identifier type |
| `var.patientIdentifierType.ncdMrn.uuid` | UUID of the NCD MRN identifier type |
| `var.encounterType.*` | UUIDs/names of Liberia-specific encounter types |
| `var.program.*` | Program UUIDs — defined in the parent `pihemr-content`, duplicated here because constants aren't shared across content packages and this repo's configuration references them |
| `var.programWorkflow.*` | Program workflow/state UUIDs — same reason as above |

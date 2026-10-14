# PIH Liberia EMR Distribution

This repository defines the OpenMRS distribution for PIH Liberia. It packages together the [PIH EMR](https://github.com/PIH/openmrs-distro-pihemr) parent distribution,
Liberia-specific content, and the PIH EMR frontend into a single deployable artifact.
For more background on OpenMRS distributions, see the [OpenMRS wiki](https://wiki.openmrs.org/display/docs/OpenMRS+Distributions).

## Repository Structure

| Directory | Description                                                                                |
|---|--------------------------------------------------------------------------------------------|
| [`content/`](content/README.md) | Liberia-specific OpenMRS content package (Initializer and O3 configuration files)          |
| [`distro/`](distro/README.md) | Distribution definition — resolves all component versions into `openmrs-distro.properties` |

## Components

| Component | Artifact |
|---|---|
| PIH EMR parent distro | `org.openmrs.distro:pihemr` |
| PIH EMR shared content | `org.pih.openmrs:pihemr-content` |
| Liberia content | `org.pih.openmrs:pihliberia-content` |
| PIH EMR frontend | `org.pih.openmrs:openmrs-frontend-pihemr` |

Component versions are defined in `distro/pom.xml` and resolved into `distro/openmrs-distro.properties` at build time.

## Supported Configuration Profiles

| Site | PIH Config |
|---|---|
| `jjd-ci` | `liberia,liberia-harper,liberia-harper-jjd-ci` |
| `harper-demo` | `liberia,liberia-harper,liberia-harper-demo` |
| `jjdossen` | `liberia,liberia-harper,liberia-harper-jjdossen` |
| `pleebo` | `liberia,liberia-pleebo` |

## Using the OpenMRS SDK

Developers can use the OpenMRS SDK to set up, update, and run local OpenMRS instances.
All normal [OpenMRS SDK](https://wiki.openmrs.org/display/docs/OpenMRS+SDK) commands are supported.

One can also use the `openmrs-sdk` command supplied by the [`openmrs-contrib-distro-tools`](https://github.com/PIH/openmrs-contrib-distro-tools) CLI if that is more convenient.
Follow the installation instructions in that repo first if you wish to use this command.
Consult the [`openmrs-contrib-distro-tools` README](https://github.com/PIH/openmrs-contrib-distro-tools/README.md) 
for more information on each supported command and configuration option.

#### Setting up a new SDK server

Whenever one creates a new SDK server, there are several options one has to configure it.  One must specify the
distribution to install, the PIH Config to use, the Tomcat port, the Debug port, the Java version, and whether to 
connect to an existing database or to create a new one, and whether to do so in the default SDK Docker container, 
one's own Docker container, or in a native MySQL server.  The `openmrs-sdk` documentation provides a full list of 
these options, which can be set via environment variables.

The least configuration required to get up and running is to specify the PIH Config only, which will use all 
other defaults including the database, which will use the built-in SDK Docker container.:

```
PIH_CONFIG=liberia,liberia-harper,liberia-harper-demo \
openmrs-sdk create <server-id>
```

Many developers maintain their own MySQL Docker container into which they maintain their various SDK servers.  For example, 
one might have an existing MySQL Docker container named `mysq56` exposing port 3308, and with a root password of `password`.
To use this container instead, simply add the appropriate additional environment variables as documented in the README:

```
PIH_CONFIG=liberia,liberia-harper,liberia-harper-demo \
DB_CONTAINER=mysql56 \
DB_PORT=3308 \
DB_PASSWORD=password \
openmrs-sdk create <server-id>
```

#### Running an SDK server

This is just a thin wrapper around the native OpenMRS SDK maven command:

```bash
openmrs-sdk run <server-id>
```

#### Updating a server with the latest distribution (war, modules, owas, config, frontend)

> [!NOTE]
> For those who are familiar with previously running `./pihemrDeploy.sh` from `openmrs-distro-pihemr`,
> this is the equivalent of that, with the addition that this will also update the configuration and frontend.

```bash
openmrs-sdk update <server-id>
```

#### Updating only the configuration of a server

Unlike a full update, this only updates the configuration files and is intended to be faster, suitable for 
more rapid iteration of content changes for testing.

> [!NOTE]
> For those who are familiar with previously running `./install.sh` from `openmrs-config-pihliberia`, this is the 
> equivalent of that, with the exception that this will not automatically build in local changes to `openmrs-config-pihemr`.
> One will first need to run a `mvn clean install` in `openmrs-config-pihemr` to incorporate local changes from it.

```bash
openmrs-sdk update-config <server-id>
```

### Using Docker

For each supported configuration profile, an example environment file is provided in the repo root to get started quickly.
Because this file is found in the distribution repository, it is assumed that this is checked out on your machine, and
that `openmrs-docker` commands are running from the root of the distribution repository — it sets `DISTRO_SOURCE_DIR`
to this location. If you're using it as an example for running elsewhere, you may need to change or remove that.

To use the example environment file for `harper-demo` to get up and running with a new instance:

```bash
source harper-demo.env
openmrs-docker create harper-demo
openmrs-docker harper-demo initialize # Optional, but speeds up initial startup
openmrs-docker harper-demo start
openmrs-docker harper-demo wait  # Tails logs until OpenMRS is ready, then exits
```

Once created, day-to-day commands only need the instance name:

```bash
openmrs-docker harper-demo stop
openmrs-docker harper-demo logs
openmrs-docker harper-demo destroy
```

The same pattern applies to `jjd-ci.env`, `jjdossen.env`, and `pleebo.env` — substitute the instance name accordingly.

## CI and Publishing

CI is handled by GitHub Actions. On every push to `master`, the [Build and deploy](.github/workflows/build-and-deploy.yml) workflow:

1. Builds and publishes the Maven artifact to [Maven Central](https://central.sonatype.com/artifact/org.pih.openmrs/pihliberia-distro) as `org.pih.openmrs:pihliberia-distro`.
2. Builds and pushes a multi-platform Docker image (amd64 + arm64) to Docker Hub at [`partnersinhealth/pihliberia-emr`](https://hub.docker.com/r/partnersinhealth/pihliberia-emr), tagged with both `latest` and the Maven project version.
3. Deploys to the legacy `kouka` server (on its own runner) and to the `jjd-ci` instance on `appclstr-01` (`deploy-via-runner`).

A separate [Build seeded images](.github/workflows/build-seeded-images.yml) workflow runs nightly and publishes a single pre-initialized generic Liberia seed image to Docker Hub (`partnersinhealth/pihliberia-emr-seed-liberia`), which each site-specific dev instance layers its own `OPENMRS_PIH_CONFIG` on top of.

A separate [Update Versions](.github/workflows/update-versions.yml) workflow runs hourly and automatically commits any available snapshot dependency updates to `master`.

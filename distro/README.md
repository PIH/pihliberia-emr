# PIH Liberia Distribution

This module pulls together all component artifacts into a single deployable distribution using the [OpenMRS SDK Maven plugin](https://wiki.openmrs.org/display/docs/OpenMRS+SDK).

## How it works

Component versions are defined as Maven properties in `pom.xml`. During the Maven build (`mvn clean install`), these properties are interpolated into `openmrs-distro.properties`, which is packaged into the artifact jar and written to `target/classes/openmrs-distro.properties`. This resolved file is what `openmrs-sdk` and `openmrs-docker` pass to the SDK and Docker build steps.

## Updating component versions

To update a component version, change the corresponding property in `pom.xml` and rebuild:

```bash
mvn clean install
```

Then use `openmrs-sdk update` or `openmrs-docker <name> start --build` to redeploy with the new versions.

## Release

Releases follow semantic versioning. To publish a release, run:

```bash
mvn clean deploy -U -DdeployRelease -Dgpg.passphrase=*** -Dgpg.keyname=<email>
```

This signs the artifacts with GPG and publishes to Maven Central via Sonatype. See the `release` profile in `pom.xml` for configuration details.

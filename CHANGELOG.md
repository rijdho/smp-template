# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-10-30

First release, and the first one archived on Zenodo.

### Added

- The page, https://rijdho.github.io/smp-template/: writes a plan as `smp.json` at one of the
  guide's three management levels, in English or Spanish, and checks a public GitHub repository
  against its plan.
- The command-line checker, `bin/smp-check.mjs`, and the GitHub Action, which fail the build when
  a commitment the plan marks as in place is not visible in the repository.
- The JSON Schema, `schema/smp.schema.json`, generated from `src/requirements.js`.

[0.1.0]: https://github.com/rijdho/smp-template/releases/tag/v0.1.0

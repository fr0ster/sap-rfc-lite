# Changelog

All notable changes to `@mcp-abap-adt/sap-rfc-lite` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.2] - 2026-10-06

### Fixed

- **macOS builds with a current Xcode.** `binding.gyp` targeted macOS 10.15;
  the libc++ of current Command Line Tools rejects any target below 11.0, and
  `-Werror` turned its `#warning` into a failed install
  ("The selected platform is no longer supported by libc++"). The minimum is now
  11.0, which Node 22, the oldest Node we build for, requires anyway.
- **Builds under `FORCE_COLOR`.** `binding.gyp` read its values with `node -p`,
  which colours a number when `FORCE_COLOR` is set (npm scripts and many CI
  shells set it), so `NAPI_VERSION` became an ANSI sequence and the compiler
  stopped at "token is not valid in preprocessor expressions". The values are
  now written with `process.stdout.write(String(...))`, which never colours.

## [0.2.1] - 2026-09-27

### Fixed

- **0.2.0 shipped without `client.resetServerContext()` in its JavaScript.**
  The tarball carried an older `lib/` (`lib/client.js` without the method),
  while the native addon built from `src/` on install had it. A caller testing
  for the method found none. `@mcp-abap-adt/connection` 9.4.0 is such a caller:
  it quietly fell back to a new connection per stateless call.
- **Packing builds `lib/` from `src/` first** (`prepack: npm run build:ts`),
  for both `npm pack` and `npm publish`. `lib/` is not in git, so before this
  change a package carried whatever `lib/` happened to be on disk.
- **`build:ts` starts from an empty `lib/`** (`prebuild:ts`), so a file whose
  source is gone cannot linger in the package.

## [0.2.0] - 2026-09-27

### Added

- **`client.resetServerContext(): Promise<void>`** wraps the SDK's
  `RfcResetServerContext`. It ends the ABAP session context the connection
  holds and keeps the connection open, so the next call runs in a fresh
  context without a new logon.

  What the context held is gone after the reset, including enqueue locks and
  program buffers. That is how a stateless call gets a clean session on a
  connection that stays open.

  Measured on E19 (SAP_BASIS 816) through ADT's `SADT_REST_RFC_ENDPOINT`:
  - Without a reset, a package created or written on a kept connection could
    not be written there again (400 PAK/058, `CL_PACKAGE`'s session buffer).
  - With a reset after each call, create, read, two writes and a delete all
    passed on one connection.
  - A reset costs about 0.1 s. Opening a new connection for each call costs
    about 0.5 s.

## [0.1.2] - 2026-09-24

### Fixed

- `bindingVersions` reports the package version.
- The binding version is passed to C++ unquoted and turned into a string
  there.
- `NOTICE` is included in the published package.

### Changed

- `node-addon-api` upgraded to v8.
- `jest` and `@types/jest` upgraded to v30.
- `npm audit` vulnerabilities resolved and in-range dev dependencies bumped.

### Documentation

- README: how the SDK's runtime libraries are loaded, and the package name
  corrected.
- README: Stand With Ukraine badge.

## [0.1.1] - 2026-04-01

Tagged, never published to npm.

### Changed

- The package is renamed `@mcp-abap-adt/sap-rfc-lite`; the `v0.1.0` tag still
  names it `sap-rfc-lite`.

### Added

- README with the motivation, and CLAUDE.md with project guidance.

## [0.1.0] - 2026-04-01

### Added

- First release: a stripped-down binding for the SAP NW RFC SDK with a
  Promise-only `Client` — `open()`, `call()`, `close()`, `id`, `alive`.
- The `nwrfcsdk` data marshalling layer, without its logging.
- A native binding loader, `binding.gyp`, and minimal type definitions.
- Tests of the Client API surface.
- Biome linter, CI and release workflows, and a husky pre-commit hook running
  Biome.

The `v0.1.0` tag still names the package `sap-rfc-lite`. The 0.1.0 on npm was
published as `@mcp-abap-adt/sap-rfc-lite`, from the rename commit (`0703285`,
after the tag); the
unscoped `sap-rfc-lite` was unpublished the same day.

[0.2.1]: https://github.com/fr0ster/sap-rfc-lite/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/fr0ster/sap-rfc-lite/compare/v0.1.2...v0.2.0
[0.1.2]: https://github.com/fr0ster/sap-rfc-lite/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/fr0ster/sap-rfc-lite/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/fr0ster/sap-rfc-lite/releases/tag/v0.1.0

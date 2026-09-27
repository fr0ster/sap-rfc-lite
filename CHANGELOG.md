# Changelog

All notable changes to `@mcp-abap-adt/sap-rfc-lite` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Releases before 0.2.0 were not recorded here.

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

[0.2.0]: https://github.com/fr0ster/sap-rfc-lite/releases/tag/v0.2.0

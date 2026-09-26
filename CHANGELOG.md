# Changelog

All notable changes to `@mcp-abap-adt/sap-rfc-lite` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Releases before 0.2.0 were not recorded here.

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

# Changelog

All notable changes to `@mcp-abap-adt/sap-rfc-lite` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.3.1] - 2026-10-22

### Documentation

- **Windows with SAP GUI's 64-bit RFC library needs no SDK.** SAP GUI, when its RFC libraries
  are installed, puts its own `sapnwrfc.dll` into `System32`, which Windows searches before `PATH`, and the addon works with it: measured with
  0.3.0's prebuilt `win32-x64` binding and SAP GUI's library 7.53 patch 1533 (logon,
  `STFC_CONNECTION`, close), with no SDK on the machine's `PATH`. README, "Prerequisites" and
  "Runtime library loading", say when the SDK is needed: on Windows with no 64-bit `sapnwrfc.dll` in
  `System32` (`where.exe sapnwrfc.dll`), on Linux and macOS, and in Docker images.

## [0.3.0] - 2026-10-22

### Added

- **`.gitattributes`**: text files are checked out with LF on every OS (`* text=auto eol=lf`), and
  `.node`, `.dll`, `.lib`, `.pdb`, `.dylib`, `.so` files are binary. On Windows, Git's default
  `core.autocrlf=true` checked the sources out with CRLF, and the pre-commit hook's
  `npm run lint:check` failed on every file.
- **README, "Runtime library loading"**: on Windows, SAP GUI's `sapnwrfc.dll` in `System32` is
  found before the SDK's on `PATH`; how to tell which one was loaded (`bindingVersions`) and how
  to load the SDK's (its DLLs next to the binding). The maintainers' section says how to record a
  Windows prebuild's SDK version on a machine with SAP GUI.

### Removed

- **Node.js 18 is no longer supported** (`engines: node >= 20`; CI runs Node.js 20 and 22). The
  prebuilt bindings are N-API 8, so one binding per platform loads on every supported Node.js.

- **The package has no install script.** `scripts/install.js` and the `install` hook are gone,
  and `"gypfile": false` stops npm from adding its implicit `node-gyp rebuild` in their place.
  Newer npm releases run a dependency's install script only when the consumer allows it
  (`allowScripts`), and an install script is the path supply-chain worms such as Shai-Hulud
  spread through, so the package must work without one. It does: on a platform with a prebuilt
  binding (`linux-x64` glibc, `win32-x64`, `darwin-arm64`), `node-gyp-build` loads it at run time,
  as before; the hook only ever decided whether to compile. **On any other platform, and on Linux
  with musl, installing no longer compiles the binding:** build it explicitly, in the installed
  package (`npm run build:cpp`) or as a package of your own from the repository
  (`npm run prebuild:native`, `npm pack`). README, "Installation", says how.

### Security

- **Dev dependencies: 21 advisories to 0** (`npm audit`, 1 critical `handlebars`, 20 moderate
  through `sprintf-js`). Both came through Jest (`ts-jest` → `handlebars`;
  `babel-plugin-istanbul` → `js-yaml` 3 → `argparse` → `sprintf-js`, which has no fixed release).
  Jest, `ts-jest`, `ts-node` and `@types/jest` are replaced by Node.js's own test runner
  (`node:test`; `npm test` compiles the tests with `tsc` and runs them), which also removes the
  two install scripts Jest brought (`@parcel/watcher`, `unrs-resolver`) and the deprecated
  `glob@10`: the lockfile holds 86 packages instead of 408. `@biomejs/biome` 2.5.15,
  `typescript` 7 (the emitted `lib/` is byte-identical to TypeScript 5.9's).
- **No dependency runs an install script.** `allowScripts` in `package.json` denies `esbuild`'s
  `postinstall` (its binary comes from its platform package), and `.npmrc` sets
  `strict-allow-scripts=true`, so a new dependency with an unreviewed install script fails the
  install; it also sets `min-release-age=7`, matching Dependabot's cooldown.
- **CI and the release workflow run `npm audit --audit-level=moderate`**, and call Biome and
  `tsc` through npm scripts instead of `npx` (also in the husky pre-commit hook).

### Fixed

- **`bindingVersions.version` works inside a bundle.** `lib/binding.js` read `package.json`
  through a path computed at run time (`path.resolve(__dirname, '..', 'package.json')`). A
  bundler cannot inline that, and inside a bundle or a Node.js single-executable application,
  where no `package.json` lies next to the code, loading the package threw, so no RFC call
  worked. The read is now a literal `require('../package.json')`, which bundlers inline. The
  reported version is still the package's, not the release a prebuilt binding was built for.
  `test/bundle.test.ts` bundles the compiled binding with esbuild (new dev dependency) and runs
  it where no `package.json` exists.
- **Prebuilt bindings carry no path of the machine they were built on.** The Linux prebuild had
  a `RUNPATH` to the builder's SDK directory under the builder's home, the macOS one an
  `LC_RPATH` likewise, and the Windows one the builder's absolute PDB path. Those paths exist
  nowhere else, so they found nothing for any user, and they leaked a home directory.
  `npm run prebuild:native` (now `scripts/prebuild-native.js`) builds with
  `SAP_RFC_LITE_PREBUILD=1`, for which `binding.gyp` adds no rpath (Linux, macOS) and links with
  `/PDBALTPATH:%_PDB%` (Windows). `scripts/prebuild-record.js` refuses to record a binding that
  holds the build machine's home directory or SDK path. A binding compiled on the user's machine
  keeps its rpath to the user's SDK, as before. Finding the SDK is unchanged for every user: the
  library search path (`LD_LIBRARY_PATH` or the system's on Linux, `DYLD_LIBRARY_PATH` on macOS,
  `PATH` on Windows); README, "Runtime library loading", now says which applies to which binding.
  All three prebuilds (`linux-x64`, `darwin-arm64`, `win32-x64`) are rebuilt this way, against
  the NW RFC SDK 7.50 PL 18.

## [0.2.4] - 2026-10-16

### Fixed

- **RFC calls returning BYTE or XSTRING fields no longer hang inside Electron (VS Code extension host).**
  This also fixes failures with "External buffers are not allowed". `NewOrCopy` keeps
  zero-copy buffers where allowed (plain Node: unchanged) and copies where external buffers are
  forbidden, preserving the existing finalizers. The prebuilt bindings for `linux-x64`,
  `win32-x64` and `darwin-arm64` are rebuilt from these sources.

## [0.2.3] - 2026-10-16

### Added

- **Prebuilt bindings: no compile on install** for the platforms in `prebuildTargets`
  (`linux-x64`, `win32-x64`, `darwin-arm64`).
  - The package carries an N-API binding per platform under `prebuilds/`, built with
    `prebuildify`.
  - There `npm install` needs neither a C++ toolchain nor `SAPNWRFC_HOME`. The SDK libraries
    must still be loadable at run time.
  - Other platforms, and `--build-from-source`, compile as before.

### Fixed

- **Builds with current clang on macOS.** `RFC_LOG("…")` called with no arguments after the
  format left the macro's `...` empty. Current clang treats that as a C++20 extension
  (`-Wvariadic-macro-arguments-omitted`), and `-Werror` turned it into a failed install. The
  macro now takes the format as the first of `__VA_ARGS__`.

### Changed

- **README: macOS needs `DYLD_LIBRARY_PATH`.** The SDK libraries carry `@loader_path` install names,
  so an rpath does not find them, and the old text said it did. Also added: a note that SNC on
  Apple Silicon may need x86_64 under Rosetta (unverified).
- **The install step decides by the prebuild's presence, not by loading it.**
  `node-gyp-build`'s own step loads the prebuild to decide. Without the SDK libraries on the
  library path at install time, that load fails and it falls back to compiling. Where there is
  no toolchain the compile fails, and npm drops the optional dependency silently.
  `scripts/install.js` uses the prebuild when one exists for the platform. Whether it loads is
  reported at run time, as before.
- **Linux prebuilds are tagged `glibc`** (`prebuildify --tag-libc`). On musl (Alpine) the install
  step compiles instead, and `node-gyp-build` does not pick the glibc binding at run time.
- **`--build-from-source` with any accepted value** (`1`, `true`, `TRUE`) is passed on to
  `node-gyp-build` as `"true"`, the only value it recognises.
- **`bindingVersions.version` is read from `package.json`.** The addon compiles the version in,
  so a prebuilt binding reused across releases would otherwise report the release it was built
  for.
- `prepublishOnly` refuses to publish while a target in `prebuildTargets` has no prebuilt
  binding, or has one whose `BUILD.json` records other C++ sources (a hash of `src/cpp/`,
  `binding.gyp` and the `node-addon-api` version).
- The prebuilt bindings are committed to the repository, each with its `BUILD.json`, and reused
  until those sources change.

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

[0.3.1]: https://github.com/fr0ster/sap-rfc-lite/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/fr0ster/sap-rfc-lite/compare/v0.2.4...v0.3.0
[0.2.4]: https://github.com/fr0ster/sap-rfc-lite/compare/v0.2.3...v0.2.4
[0.2.3]: https://github.com/fr0ster/sap-rfc-lite/compare/v0.2.2...v0.2.3
[0.2.2]: https://github.com/fr0ster/sap-rfc-lite/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/fr0ster/sap-rfc-lite/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/fr0ster/sap-rfc-lite/compare/v0.1.2...v0.2.0
[0.1.2]: https://github.com/fr0ster/sap-rfc-lite/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/fr0ster/sap-rfc-lite/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/fr0ster/sap-rfc-lite/releases/tag/v0.1.0

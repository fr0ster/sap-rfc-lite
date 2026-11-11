# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Lightweight Node.js native addon (C++ / N-API) providing Promise-based bindings for SAP NetWeaver RFC SDK. Focused solely on the Client API — no Pool, Server, or Throughput.

## Build & Test Commands

```bash
npm ci                   # Install deps; compiles nothing (no install script, "gypfile": false)
npm run build            # Full build: TypeScript then C++ rebuild
npm run build:ts         # TypeScript only: src/ts/ → lib/
npm run build:cpp        # C++ only: node-gyp rebuild → build/Release/sapnwrfc.node
npm run prebuild:native  # This platform's prebuilt binding → prebuilds/<platform>-<arch>/ + BUILD.json
npm run check:prebuilds  # Every target's binding present, one per target, built from these C++ sources
npm run lint:check       # Biome, read-only
npm run typecheck        # tsc --noEmit
npm test                 # tsc -p tsconfig.test.json, then node:test (scripts/run-tests.js)
```

Use npm scripts only, never `npx`.

`npm run build:test-native` builds the test addon (SDK required). Native tests skip without `test/native/build`, live tests without `SAP_RFC_LITE_LIVE_ENV`, each naming its reason; live tests need `npm run build` and assert that the local `build/Release` is loaded.

The `SAPNWRFC_HOME` env var must point to the NW RFC SDK root (containing `lib/` and `include/`).
If the addon fails to load with `ERR_DLOPEN_FAILED`, see "Runtime library loading" in `README.md` (`LD_LIBRARY_PATH`).

## Architecture

Three layers with a clear data flow:

```
TypeScript (Promise API)  →  C++ N-API (callback + AsyncWorker)  →  SAP NW RFC SDK
src/ts/                      src/cpp/                               libsapnwrfc
```

### TypeScript layer (`src/ts/`)

- **`client.ts`** — Public `Client` class. Wraps C++ callbacks into Promises. Validates inputs before calling native code.
- **`binding.ts`** — Loads the `.node` module via `node-gyp-build`: a local `build/Release` build first, else the prebuilt binding in `prebuilds/<platform>-<arch>/`. Provides detailed error context (platform, arch, SAPNWRFC_HOME) on load failure.
- **`types.ts`** — RFC data types (`RfcVariable`, `RfcStructure`, `RfcTable`, `RfcObject`), error types (`RfcLibError`, `AbapError`, `NodeRfcError`), connection params, version info.
- **`index.ts`** — Re-exports `Client`, `binding`, and all types.

### C++ layer (`src/cpp/`)

- **`addon.cc`** — Module registration. Exports `Client` constructor and `bindingVersions`.
- **`Client.cc`** — `Napi::ObjectWrap<Client>` with four `AsyncWorker` subclasses:
  - `OpenAsync` → `RfcOpenConnection()`
  - `CloseAsync` → `RfcCloseConnection()`
  - `PrepareAsync` → gets function descriptor, sets parameters, then chains to:
  - `InvokeAsync` → `RfcInvoke()`, extracts results
- **Passport manager** — installed once at module registration (`RfcInstallPassportManager`); its install result is kept, and a call given a passport is refused with it when the install failed. A call's passport (`call(name, params, { passport })`) is copied into that call's workers and handed to the SDK through `thread_local`s set immediately around `RfcInvoke`; the start callback places it only for its own call and handle, and only when it fits the buffer the SDK offers, and sets the length to 0 for every other request; the end callback sets it to 0, so the passport the system returns is never carried to a later call. A call whose passport did not fit has run without it and rejects saying so. `call` refuses, before sending, a passport that is empty, lacks `*TH*` at its start or end, or declares a length (bytes 5–6, u16 BE) other than its own.
- **No reconnect** — the library never opens a connection the caller did not open. On an error for which `endsConnection` is true (codes `RFC_COMMUNICATION_FAILURE`, `RFC_ABAP_RUNTIME_FAILURE`, `RFC_ABAP_MESSAGE`, `RFC_EXTERNAL_FAILURE`, `RFC_CLOSED`; groups `ABAP_RUNTIME_FAILURE`, `LOGON_FAILURE`, `COMMUNICATION_FAILURE`, `EXTERNAL_RUNTIME_FAILURE`) the handle is closed once and released, `alive` is `false`, and the operation's own error is returned.
- **`nwrfcsdk.cc`** — Data type conversion (JS ↔ SAP Unicode) and error formatting.
- **`nwrfcsdk.h`** — Core structs: `ConnectionParamsStruct` (owns RFC_CONNECTION_PARAMETER array), `ClientOptionsStruct` (BCD/date/time transformers), `RfmErrorPath` (breadcrumb trail for nested error locations).

### Async call flow

```
client.call(name, params)          // TypeScript Promise
  → C++ invoke()                   // queues PrepareAsync
    → PrepareAsync.Execute()       // worker thread: get function descriptor
    → PrepareAsync.OnOK()          // main thread: set params, queue InvokeAsync
      → InvokeAsync.Execute()      // worker thread: RfcInvoke()
      → InvokeAsync.OnOK()         // main thread: extract results, invoke callback
  → Promise resolves               // TypeScript
```

Each Client instance has its own `std::mutex` — multiple clients run in parallel, but operations within one client are serialized.

### Build system (`binding.gyp`)

- C++17, N-API v8, `NAPI_CPP_EXCEPTIONS` enabled
- SDK location: `SAPNWRFC_HOME` or `SAPNWRFC_HOME_CLOUD` env var
- Platform conditions for Windows (MSVC/LTCG), Linux (GCC, rpath), macOS (Clang, libc++); with `SAP_RFC_LITE_PREBUILD=1` (set by `prebuild:native`) no rpath (Linux/macOS) and `/PDBALTPATH:%_PDB%` (Windows), so a prebuilt binding carries no path of the build machine
- Required defines: `SAPwithUNICODE`, `SAPwithTHREADS`
- Links: `sapnwrfc.lib` + `libsapucum.lib` (Windows), `-lsapnwrfc -lsapucum` (Unix)

### Prebuilt bindings and install scripts

- Consumers install with no install script: the package has none, and loads the prebuilt binding for `linux-x64` (glibc), `win32-x64` and `darwin-arm64` from `prebuilds/` at run time. On any other platform (and Linux with musl) the consumer builds it explicitly (README, "Installation").
- Each prebuild is built on its own OS with the SDK (`npm run prebuild:native`); `scripts/prebuild-record.js` refuses a binding holding the home directory or the SDK path, and writes `BUILD.json` (target, binary, `sourceHash` of the C++ sources, SDK version). `prepublishOnly` runs `check:prebuilds`, so a stale or missing prebuild blocks a publish.
- Dependencies' install scripts: `allowScripts` in `package.json` lists each one (all denied today), `.npmrc` sets `strict-allow-scripts=true`. No `min-release-age`: it blocked installing a security fix while the gating audit failed CI. CI and the release workflow run `npm audit --audit-level=moderate`.

## Language Requirements

- All repository artifacts (source code, documentation, comments, commit messages) must be in **English**
- Direct communication with the user must be in the **user's language**

## Conventions

- Output dir for TypeScript: `lib/` (ES2020, CommonJS, declarations enabled)
- Output dir for C++: `build/Release/sapnwrfc.node`
- Integration tests require a live SAP system with connection env files (`.env`)
- Node.js >= 20 (`engines`); CI runs Node.js 20 and 22
- Version in `package.json` — do not change without explicit request
- Conventional Commits for git messages (`feat:`, `fix:`, `test:`, `chore:`)

## Releasing

npm publishing is manual only, confirmed with a hardware security key (2FA). CI must never publish to npm: no trusted publishing (OIDC), no `NPM_TOKEN`. This keeps a human in every publish (npm supply-chain worms such as Shai-Hulud spread through stolen publish credentials).

1. Bump the version: `npm version patch|minor|major` (commits `X.Y.Z` and creates tag `vX.Y.Z`).
2. Push the commit and the tag: `git push origin master vX.Y.Z`.
3. `.github/workflows/release.yml` runs on the tag:
   - `check`: tag must equal `package.json` version, then lint, typecheck, tests;
   - `github-release`: GitHub Release with generated notes.
4. After the workflow succeeds, build and publish locally:
   `npm run build:ts && npm pack --dry-run` (review the file list), then `npm publish --access public` and confirm with the security key; `prepublishOnly` refuses unless every prebuild is current (`check:prebuilds`).

Dependency updates come from Dependabot (`.github/dependabot.yml`): weekly, with Dependabot's own 7-day cooldown for version updates (it applies to Dependabot's pull requests only, not to npm installs). Security updates are opened immediately.

## Plans and Specs

Plans under `docs/superpowers/plans/` and specs under `docs/superpowers/specs/` are kept in the tree only while active — i.e. not yet implemented and not cancelled. Once a plan/spec has been fully implemented OR cancelled, delete the file. History lives in git; these directories hold only work in progress.

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Lightweight Node.js native addon (C++ / N-API) providing Promise-based bindings for SAP NetWeaver RFC SDK. Focused solely on the Client API — no Pool, Server, or Throughput.

## Build & Test Commands

```bash
npm install              # Install deps + compile C++ addon (node-gyp-build)
npm run build            # Full build: TypeScript then C++ rebuild
npm run build:ts         # TypeScript only: src/ts/ → lib/
npm run build:cpp        # C++ only: node-gyp rebuild → build/Release/sapnwrfc.node
npm test                 # Jest with 60s timeout
```

The `SAPNWRFC_HOME` env var must point to the NW RFC SDK root (containing `lib/` and `include/`).

## Architecture

Three layers with a clear data flow:

```
TypeScript (Promise API)  →  C++ N-API (callback + AsyncWorker)  →  SAP NW RFC SDK
src/ts/                      src/cpp/                               libsapnwrfc
```

### TypeScript layer (`src/ts/`)

- **`client.ts`** — Public `Client` class. Wraps C++ callbacks into Promises. Validates inputs before calling native code.
- **`binding.ts`** — Loads the compiled `.node` module via `node-gyp-build`. Provides detailed error context (platform, arch, SAPNWRFC_HOME) on load failure.
- **`types.ts`** — RFC data types (`RfcVariable`, `RfcStructure`, `RfcTable`, `RfcObject`), error types (`RfcLibError`, `AbapError`, `NodeRfcError`), connection params, version info.
- **`index.ts`** — Re-exports `Client`, `binding`, and all types.

### C++ layer (`src/cpp/`)

- **`addon.cc`** — Module registration. Exports `Client` constructor and `bindingVersions`.
- **`Client.cc`** — `Napi::ObjectWrap<Client>` with four `AsyncWorker` subclasses:
  - `OpenAsync` → `RfcOpenConnection()`
  - `CloseAsync` → `RfcCloseConnection()`
  - `PrepareAsync` → gets function descriptor, sets parameters, then chains to:
  - `InvokeAsync` → `RfcInvoke()`, extracts results
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
- Platform conditions for Windows (MSVC/LTCG), Linux (GCC, rpath), macOS (Clang, libc++)
- Required defines: `SAPwithUNICODE`, `SAPwithTHREADS`
- Links: `sapnwrfc.lib` + `libsapucum.lib` (Windows), `-lsapnwrfc -lsapucum` (Unix)

## Language Requirements

- All repository artifacts (source code, documentation, comments, commit messages) must be in **English**
- Direct communication with the user must be in the **user's language**

## Conventions

- Output dir for TypeScript: `lib/` (ES2020, CommonJS, declarations enabled)
- Output dir for C++: `build/Release/sapnwrfc.node`
- Integration tests require a live SAP system with connection env files (`.env`)
- Version in `package.json` — do not change without explicit request
- Conventional Commits for git messages (`feat:`, `fix:`, `test:`, `chore:`)

## Plans and Specs

After a plan under `docs/superpowers/plans/` or spec under `docs/superpowers/specs/` has been fully implemented, delete the file. Keep only active (not yet implemented) plans and specs in the tree — implementation history lives in git, not in these directories.

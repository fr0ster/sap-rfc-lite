# sap-rfc-lite
[![Stand With Ukraine](https://raw.githubusercontent.com/vshymanskyy/StandWithUkraine/main/badges/StandWithUkraine.svg)](https://stand-with-ukraine.pp.ua)

Lightweight Node.js bindings for SAP NetWeaver RFC SDK.

## Motivation

The only existing open-source Node.js binding for SAP NW RFC SDK is [node-rfc](https://github.com/SAP/node-rfc) by SAP. While it served the community well, it has accumulated significant technical debt:

- **24 known vulnerabilities** (5 low, 7 moderate, 12 high) in its dependency tree
- **18 outdated packages**, including runtime dependencies like `bluebird` (a Promise library unnecessary since Node.js 8+) and `decimal.js`
- **Repository archived** — the source has moved to [SAP-archive/node-rfc](https://github.com/SAP-archive/node-rfc), signaling deprecation
- **Last published 2+ years ago** with no signs of active maintenance
- **~14,000 lines of source code** for what is fundamentally an RFC client binding

SAP has since created a proprietary replacement (`@sap-rfc/node-rfc-library`), but it is only available through a private npm registry and requires an S-user with a SAP Build Code license — making it inaccessible to the broader community.

No other lightweight alternative exists in the Node.js ecosystem. The only other package, [sapnwrfc](https://www.npmjs.com/package/sapnwrfc), was last published over 10 years ago.

### Comparison

| | sap-rfc-lite | node-rfc |
|---|---|---|
| Source code | ~2,200 lines | ~14,200 lines |
| Runtime dependencies | 2 | 4 (includes bluebird, decimal.js) |
| Vulnerabilities (npm audit) | **0** | **24** |
| Outdated packages | 1 (dev only: `@types/node`, kept on an older Node.js line on purpose) | 18 (including runtime) |
| API | Promise-based Client (`open`, `call`, `resetServerContext`, `close`) | Client, Pool, Server, Throughput |
| Node.js requirement | >= 20 | >= 18 |
| N-API version | 8 | 8 |

This project focuses on what most users actually need — a clean, modern, Promise-based RFC client — without the baggage of unused features and vulnerable dependencies.

## Prerequisites

- Node.js >= 20
- The SAP NetWeaver RFC library, which SAP does not allow redistributing, so it is never part of this package:
  - **Windows where SAP GUI installed its 64-bit RFC library:** nothing to install. The RFC libraries are a component of the SAP GUI installer; when installed, the 64-bit `sapnwrfc.dll` (and the DLLs it loads) lies in `C:\Windows\System32` — `where.exe sapnwrfc.dll` lists it — and the addon loads it (see [Runtime library loading](#runtime-library-loading)).
  - **Anywhere else** — Windows with no 64-bit `sapnwrfc.dll` in `System32` (no SAP GUI, or its RFC libraries not installed, or only 32-bit ones, which lie in `SysWOW64` and a 64-bit Node.js does not load), Linux, macOS, Docker images: the SAP NetWeaver RFC SDK installed.

## Installation

```bash
npm install @mcp-abap-adt/sap-rfc-lite
```

**The package has no install script.** Nothing runs when it is installed: no compile, no download, no `node-gyp`. It works the same with `--ignore-scripts` and under an npm that runs no install script it has not been told to allow (`allowScripts`).

**On a platform with a prebuilt binding, that is all.** The package carries a prebuilt N-API binding for each platform listed in `prebuildTargets` in `package.json`: currently `linux-x64` (glibc), `win32-x64` and `darwin-arm64`. `node-gyp-build` picks it when the package is loaded. No C++ toolchain and no `SAPNWRFC_HOME` are needed; the SDK libraries only have to be loadable at run time (see [Runtime library loading](#runtime-library-loading)).

**Elsewhere, build the binding from source yourself.** That covers any other platform or architecture, and Linux with musl (Alpine and the like), where the glibc binding cannot load. Loading the package there fails with `No native build was found` (or, on a musl distribution other than Alpine, a load error of the glibc binding) until a binding is built. A source build needs:

- C++ build tools (Visual Studio Build Tools on Windows, GCC/Clang on Linux/macOS);
- the `SAPNWRFC_HOME` environment variable set to the SDK root directory (the folder containing `lib/` and `include/`).

Build a package for your platform from the repository, and install that. The published package carries neither `binding.gyp` nor the C++ sources: npm adds an implicit `node-gyp rebuild` install script to any package that holds a `binding.gyp`, and `npm ci` does so even with `"gypfile": false`, so shipping one would make installs compile.

```bash
git clone https://github.com/fr0ster/sap-rfc-lite.git && cd sap-rfc-lite
git checkout v<version>      # the release you depend on
npm ci
npm run prebuild:native      # -> prebuilds/<platform>-<arch>/ (needs the SDK libraries loadable, see below)
npm pack                     # -> mcp-abap-adt-sap-rfc-lite-<version>.tgz, to install in your project
```

A binding compiled on Linux embeds an rpath to `$SAPNWRFC_HOME/lib` (unless built by `prebuild:native`); see the next section.

## Runtime library loading

The addon is linked against the SDK shared libraries (`libsapnwrfc`, `libsapucum`) and, on Linux, the system `libuuid`. The dynamic loader must find all of them when the addon is loaded. The package does not load the SDK itself: it has no code that looks for the SDK or preloads it by path, and `SAPNWRFC_HOME` is read only when the binding is compiled. What finds the SDK at run time is the operating system's loader:

| | Prebuilt binding | Binding compiled on your machine |
|---|---|---|
| Linux | the library search path: `LD_LIBRARY_PATH`, or the system's (`/etc/ld.so.conf.d`, then `ldconfig`) | an rpath to `$SAPNWRFC_HOME/lib` as it was at build time, then the library search path |
| macOS | `DYLD_LIBRARY_PATH` | `DYLD_LIBRARY_PATH` |
| Windows | the DLL search order: the binding's own directory, then `System32` and the Windows directory, then `PATH` (`%SAPNWRFC_HOME%\lib` where SAP GUI is not installed) | the same |

**A prebuilt binding carries no path of the machine it was built on**: no rpath (Linux, macOS), no absolute PDB path (Windows). So on Linux it always needs the SDK's `lib` directory on the library search path, wherever the SDK is installed:

```bash
export LD_LIBRARY_PATH="$SAPNWRFC_HOME/lib:$LD_LIBRARY_PATH"
# or, system-wide:
echo "$SAPNWRFC_HOME/lib" | sudo tee /etc/ld.so.conf.d/nwrfcsdk.conf && sudo ldconfig
```

**macOS: always set `DYLD_LIBRARY_PATH`.** The macOS SDK's own libraries carry `@loader_path/…` install names, so the addon looks for `libsapnwrfc.dylib` and `libsapucum.dylib` next to itself, not on the rpath. Point `DYLD_LIBRARY_PATH` at `$SAPNWRFC_HOME/lib`, or the addon does not load. This holds for a prebuilt binding and a locally compiled one alike.

**Windows: SAP GUI's `sapnwrfc.dll` is enough.** SAP GUI for Windows, when its RFC libraries are installed, puts a 64-bit `sapnwrfc.dll` into `C:\Windows\System32`, and Windows searches `System32` before `PATH`. On such a machine the addon loads SAP GUI's library, with no SDK and nothing on `PATH`; with an SDK on `PATH` too, it still loads SAP GUI's. Measured with 0.3.0's prebuilt binding and SAP GUI's library 7.53 patch 1533: logon, `STFC_CONNECTION` and close work. `where.exe sapnwrfc.dll` lists every copy, and `binding.bindingVersions.nwrfcsdk` shows which one was loaded: the NW RFC SDK 7.50 reports `major: 7500`, SAP GUI's library its kernel release (for example `major: 7, minor: 53`). To load the SDK's library instead, copy the DLLs of `%SAPNWRFC_HOME%\lib` (`sapnwrfc.dll`, `libsapucum.dll`, `icudt*.dll`, `icuin*.dll`, `icuuc*.dll`) next to the binding, into the directory `node-gyp-build` loads it from (`node_modules\@mcp-abap-adt\sap-rfc-lite\prebuilds\win32-x64\`, or `build\Release\` for a local build): Windows searches the binding's own directory first.

**A binding compiled on Linux** (`npm run build:cpp` in a clone of the repository) embeds an rpath to `$SAPNWRFC_HOME/lib`, so it finds the SDK libraries without extra settings as long as the SDK stays where it was at build time. Set the library search path when:

- the SDK was moved, or the built addon is deployed to a machine where the SDK lives elsewhere;
- Node.js ships its own glibc and does not search the system library directories (see below).

**Node.js with its own glibc** (for example, Node.js installed via Homebrew on Linux) does not search the system library directories, whichever binding is used. Loading then fails with `ERR_DLOPEN_FAILED` and `libuuid.so.1: cannot open shared object file`.

For a Node.js with its own glibc, do **not** add the whole system library directory (`/lib/x86_64-linux-gnu`): the loader would then take the system glibc, which may be older than the one Node.js was built against (`GLIBC_2.38 not found`). Expose only the missing library instead:

```bash
mkdir -p ~/.local/lib/sap-rfc-lite
ln -sf /lib/x86_64-linux-gnu/libuuid.so.1 ~/.local/lib/sap-rfc-lite/
export LD_LIBRARY_PATH="$HOME/.local/lib/sap-rfc-lite:$SAPNWRFC_HOME/lib:$LD_LIBRARY_PATH"
```

`binding.bindingVersions` reports the package version and the loaded SDK version, which is a quick check that the addon loads. The package version is read from `package.json` through a literal path, so a bundler (esbuild, webpack, rollup) inlines it and a bundle or a Node.js single-executable application reports it too:

```bash
node -e "console.log(require('@mcp-abap-adt/sap-rfc-lite').binding.bindingVersions)"
```

## Prebuilt bindings (maintainers)

The prebuilt bindings are **committed** under `prebuilds/<platform>-<arch>/`. Each is built once, on its own platform, against the SDK installed there, and reused until what it is built from changes:

```bash
# on the target platform: SAPNWRFC_HOME set, and its lib directory on the library path
# (so the build can record the SDK version it was built against)
npm ci
npm run prebuild:native        # -> prebuilds/<platform>-<arch>/*.node + BUILD.json
git add prebuilds/<platform>-<arch>
```

On Windows with SAP GUI installed, the record step loads SAP GUI's `sapnwrfc.dll` from `System32` (see [Runtime library loading](#runtime-library-loading)) and records its version. Copy the SDK's DLLs into `prebuilds\win32-x64\`, run `node scripts\prebuild-record.js` again, and delete them before committing: `BUILD.json` must name SDK `7500`.

`BUILD.json` records what the binding was built from:

- a hash of `src/cpp/` and `binding.gyp`;
- the `node-addon-api` version;
- the SDK version.

`prepublishOnly` (`npm run check:prebuilds`) refuses to publish while a target in `prebuildTargets` has no binding, or has one built from other C++ sources. A change to the C++ sources, `binding.gyp` or `node-addon-api` therefore means rebuilding every target. A new SDK release is a reason to rebuild by hand.

A binding is N-API, so one build per platform and architecture serves every supported Node.js version. It links to the SDK libraries dynamically and contains no SAP code.

`npm run prebuild:native` sets `SAP_RFC_LITE_PREBUILD=1` for `binding.gyp`, which then leaves out what would tie the binding to the build machine: the rpath to its SDK directory (Linux, macOS) and the absolute PDB path (Windows, `/PDBALTPATH:%_PDB%`). The record step refuses a binding that still holds the build machine's home directory or SDK path. Users find the SDK as described in [Runtime library loading](#runtime-library-loading). Check a Linux build with `readelf -d prebuilds/linux-x64/*.node`: no `RUNPATH` or `RPATH` line.

**SNC on Apple Silicon (unverified).** A community report says the macOS Secure Login Client is still built for x86_64 only, and runs on Apple Silicon through Rosetta 2. If so, its SNC library cannot be loaded into an arm64 Node.js process, and SNC with the `darwin-arm64` binding will not work: it would need an x86_64 Node.js under Rosetta and a `darwin-x64` binding. Check with `lipo -archs` on the Secure Login Client's `libsapcrypto.dylib`.

## Install scripts and dependencies (contributors)

npm worms such as Shai-Hulud spread through dependency install scripts (`preinstall`, `install`, `postinstall`) that steal npm and GitHub tokens. The repository keeps that surface small and closed:

- **No dependency runs an install script.** `allowScripts` in `package.json` lists every dependency that has one, and allows none: `esbuild` (`false`) gets its binary from its platform package (`@esbuild/<platform>-<arch>`, an optional dependency), so its `postinstall` is not needed. The repository's `.npmrc` sets `strict-allow-scripts=true`, so with an npm that knows `allowScripts` (11.x), a new dependency with an install script fails `npm install` until it is reviewed and added there (`npm install-scripts approve <pkg>` or `npm install-scripts deny <pkg>`). An older npm ignores both settings; CI installs with `--ignore-scripts`.
- **The repository's own `prepare` still runs** on `npm ci` / `npm install` (it installs the husky pre-commit hook). `ignore-scripts=true` is not set in `.npmrc`: it would also skip the `pre`/`post` scripts of `npm run`, among them `prepublishOnly` (the prebuild check) and `prepack`.
- **Few dependencies.** Tests run on Node.js's own runner (`node:test`, compiled by `tsc`), with no test framework installed.
- **CI fails on a known advisory.** `npm audit --audit-level=moderate` runs in CI and in the release workflow, dev dependencies included.
- **Tools run through npm scripts** (`npm run lint:check`, `npm run typecheck`), never `npx`, which fetches a package from the registry when it is not installed.

## Usage

```typescript
import { Client } from '@mcp-abap-adt/sap-rfc-lite';

const client = new Client({
  ashost: '10.0.0.1',
  sysnr: '00',
  client: '100',
  user: 'USER',
  passwd: 'PASSWORD',
  lang: 'EN',
});

await client.open();

const result = await client.call('STFC_CONNECTION', {
  REQUTEXT: 'Hello from sap-rfc-lite',
});

console.log(result.ECHOTEXT);

await client.close();
```

## API

### `new Client(connectionParameters)`

Creates a new RFC client instance.

- `connectionParameters` — an object with SAP connection parameters (`ashost`, `sysnr`, `client`, `user`, `passwd`, `lang`, etc.)

### `client.open(): Promise<Client>`

Opens the RFC connection.

### `client.call(rfmName, rfmParams?): Promise<RfcObject>`

Invokes a remote function module.

- `rfmName` — name of the function module
- `rfmParams` — optional input parameters

### `client.resetServerContext(): Promise<void>`

Resets the ABAP session context the connection holds and keeps the connection
open (`RfcResetServerContext`). The next call runs in a fresh context, without
a new logon.

Everything the context held goes with it, including enqueue locks and program
buffers. This is how a stateless call gets a clean session on a connection
that is kept open.

### `client.close(): Promise<void>`

Closes the RFC connection.

### `client.id: number`

Unique client instance identifier.

### `client.alive: boolean`

Whether the connection is currently open.

## Changelog

See [CHANGELOG.md](CHANGELOG.md).

## License

[Apache-2.0](LICENSE)

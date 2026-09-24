# sap-rfc-lite

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
| Outdated packages | 4 (dev only) | 18 (including runtime) |
| API | Promise-based Client | Client, Pool, Server, Throughput |
| Node.js requirement | >= 18 | >= 18 |
| N-API version | 8 | 8 |

This project focuses on what most users actually need — a clean, modern, Promise-based RFC client — without the baggage of unused features and vulnerable dependencies.

## Prerequisites

- Node.js >= 18
- SAP NetWeaver RFC SDK installed
- C++ build tools (Visual Studio Build Tools on Windows, GCC/Clang on Linux/macOS)

Set the `SAPNWRFC_HOME` environment variable to the SDK root directory (the folder containing `lib/` and `include/`).

## Installation

```bash
npm install @mcp-abap-adt/sap-rfc-lite
```

## Runtime library loading

The addon is linked against the SDK shared libraries (`libsapnwrfc`, `libsapucum`) and, on Linux, the system `libuuid`. The dynamic loader must find all of them when the addon is loaded.

On Linux and macOS the build embeds an rpath to `$SAPNWRFC_HOME/lib`, so the SDK libraries are found without extra settings as long as the SDK stays where it was at build time. Set the library search path when:

- the SDK was moved, or the built addon is deployed to a machine where the SDK lives elsewhere;
- Node.js ships its own glibc and does not search the system library directories (for example, Node.js installed via Homebrew on Linux). Loading then fails with `ERR_DLOPEN_FAILED` and `libuuid.so.1: cannot open shared object file`.

| OS | Variable |
|---|---|
| Linux | `LD_LIBRARY_PATH` |
| macOS | `DYLD_LIBRARY_PATH` |
| Windows | `PATH` (must include `%SAPNWRFC_HOME%\lib`) |

```bash
# SDK moved or deployed elsewhere
export LD_LIBRARY_PATH="$SAPNWRFC_HOME/lib:$LD_LIBRARY_PATH"
```

For a Node.js with its own glibc, do **not** add the whole system library directory (`/lib/x86_64-linux-gnu`): the loader would then take the system glibc, which may be older than the one Node.js was built against (`GLIBC_2.38 not found`). Expose only the missing library instead:

```bash
mkdir -p ~/.local/lib/sap-rfc-lite
ln -sf /lib/x86_64-linux-gnu/libuuid.so.1 ~/.local/lib/sap-rfc-lite/
export LD_LIBRARY_PATH="$HOME/.local/lib/sap-rfc-lite:$SAPNWRFC_HOME/lib:$LD_LIBRARY_PATH"
```

`binding.bindingVersions` reports the package version and the loaded SDK version, which is a quick check that the addon loads:

```bash
node -e "console.log(require('@mcp-abap-adt/sap-rfc-lite').binding.bindingVersions)"
```

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

### `client.close(): Promise<void>`

Closes the RFC connection.

### `client.id: number`

Unique client instance identifier.

### `client.alive: boolean`

Whether the connection is currently open.

## License

[Apache-2.0](LICENSE)

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
| Outdated packages | 5 (dev only) | 18 (including runtime) |
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
npm install sap-rfc-lite
```

## Usage

```typescript
import { Client } from 'sap-rfc-lite';

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

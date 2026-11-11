// SPDX-FileCopyrightText: 2026 sap-rfc-lite contributors
// SPDX-License-Identifier: Apache-2.0

// Compiled by `npm test` (tsc -p tsconfig.test.json), never run: the type of
// `Client.call`'s options is the compiler's to check. A line marked
// `@ts-expect-error` that compiles fails the build.

import type { Client, RfcCallOptions } from '../src/ts/index';

export function callOptionTypes(client: Client): void {
  const options: RfcCallOptions = { passport: Buffer.alloc(288) };
  void client.call('STFC_CONNECTION', {}, options);
  void client.call('STFC_CONNECTION', {}, {});
  void client.call('STFC_CONNECTION', {}, { passport: undefined });

  // @ts-expect-error a passport is a Buffer, not a string
  void client.call('STFC_CONNECTION', {}, { passport: '2A54482A' });
  // @ts-expect-error a passport is a Buffer, not a number
  void client.call('STFC_CONNECTION', {}, { passport: 42 });
  // @ts-expect-error the options name the passport only
  void client.call('STFC_CONNECTION', {}, { notRequested: [] });
}

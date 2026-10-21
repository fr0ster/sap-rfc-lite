// SPDX-FileCopyrightText: 2026 sap-rfc-lite contributors
// SPDX-License-Identifier: Apache-2.0

import path from 'node:path';
import type {
  RfcConnectionParameters,
  RfcObject,
  RfcSdkVersions,
} from './types';

export interface RfcClientBinding {
  // biome-ignore lint/suspicious/noMisleadingInstantiator: mirrors native C++ addon constructor
  new (connectionParameters: RfcConnectionParameters): RfcClientBinding;
  _id: number;
  _alive: boolean;
  open(callback: (err?: unknown) => void): void;
  close(callback: (err?: unknown) => void): void;
  resetServerContext(callback: (err?: unknown) => void): void;
  invoke(
    rfmName: string,
    rfmParams: RfcObject,
    callback: (err: unknown, res: RfcObject) => void,
    callOptions?: object,
  ): void;
}

export interface NativeBinding {
  Client: RfcClientBinding;
  bindingVersions: RfcSdkVersions;
}

let binding: NativeBinding;

try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  binding = require('node-gyp-build')(
    path.resolve(__dirname, '..'),
  ) as NativeBinding;
} catch (ex) {
  const err = ex as Error;
  const env = {
    SAPNWRFC_HOME: process.env.SAPNWRFC_HOME || '(not set)',
    platform: process.platform,
    arch: process.arch,
    node: process.version,
  };
  err.message += `\nEnvironment: ${JSON.stringify(env, null, 2)}`;
  throw err;
}

// The addon compiles the package version in, so a prebuilt binding reused
// across releases would report the release it was built for. The version is
// the package's, read here.
// The path is a literal, relative to the compiled lib/binding.js, so a bundler
// (esbuild, webpack, rollup) inlines package.json; a path computed at run time
// cannot be inlined and fails inside a bundle or a single-executable
// application, where no package.json lies next to the code
// (test/bundle.test.ts).
// A new object rather than a write: the addon's own may be frozen or absent.
binding = {
  ...binding,
  bindingVersions: {
    ...binding.bindingVersions,
    version: (require('../package.json') as { version: string }).version,
  },
};

export { binding };

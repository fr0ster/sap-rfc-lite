// SPDX-FileCopyrightText: 2026 sap-rfc-lite contributors
// SPDX-License-Identifier: Apache-2.0

// The TS layer without the native addon: the compiled binding module is
// replaced in Node's module cache by a recording fake before the client module
// is loaded. The fake records every `invoke` argument and answers through the
// callback it was given, with what the test set in `answer`.

import Module from 'node:module';
import type * as ClientModule from '../../src/ts/client';

/** Every `invoke` call, its arguments as the TS layer passed them. */
export const invokes: unknown[][] = [];

/** What the next `invoke` answers through its callback. */
export const answer: { err: unknown; res: unknown } = {
  err: undefined,
  res: {},
};

class FakeClient {
  _id = 1;
  _alive = true;
  open(callback: (err?: unknown) => void): void {
    callback();
  }
  close(callback: (err?: unknown) => void): void {
    callback();
  }
  resetServerContext(callback: (err?: unknown) => void): void {
    callback();
  }
  invoke(...args: unknown[]): void {
    invokes.push(args);
    const callback = args[2];
    if (typeof callback === 'function') callback(answer.err, answer.res);
  }
}

const bindingPath = require.resolve('../../src/ts/binding');
const fake = new Module(bindingPath);
fake.filename = bindingPath;
fake.loaded = true;
fake.exports = {
  binding: {
    Client: FakeClient,
    bindingVersions: {
      version: '0.0.0',
      nwrfcsdk: { major: 0, minor: 0, patchLevel: 0 },
    },
  },
};
require.cache[bindingPath] = fake;

const clientModule: typeof ClientModule = require('../../src/ts/client');

export const { Client } = clientModule;

/** Forget the recorded calls and answer with success again. */
export function reset(): void {
  invokes.length = 0;
  answer.err = undefined;
  answer.res = {};
}

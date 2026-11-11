// SPDX-FileCopyrightText: 2026 sap-rfc-lite contributors
// SPDX-License-Identifier: Apache-2.0

// The addon's pure native decisions, through the test-only addon
// (test/native/, `npm run build:test-native`, needs the SAP NW RFC SDK). CI
// builds no C++: without the test addon this suite skips, its reason in the
// title.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

/** What the shim (test/native/shim.cc) exposes. */
interface TestAddon {
  codes: Record<string, number>;
  groups: Record<string, number>;
  endsConnection?: (code: number, group: number) => boolean;
}

// Compiled to .test-build/test/; the repository root is two up.
const addonPath = path.join(
  __dirname,
  '..',
  '..',
  'test',
  'native',
  'build',
  'Release',
  'rfc_lite_test.node',
);
const built = fs.existsSync(addonPath);
const addon: TestAddon | undefined = built ? require(addonPath) : undefined;

const title = built
  ? 'native decisions (test addon)'
  : 'native decisions — skipped: the test addon is not built (npm run build:test-native, needs the SDK)';

function code(name: string): number {
  const value = addon?.codes[name];
  assert.equal(typeof value, 'number', `code ${name}`);
  return value ?? -1;
}

function group(name: string): number {
  const value = addon?.groups[name];
  assert.equal(typeof value, 'number', `group ${name}`);
  return value ?? -1;
}

function endsConnection(codeName: string, groupName: string): boolean {
  const decide = addon?.endsConnection;
  assert.equal(typeof decide, 'function', 'the test addon has endsConnection');
  return decide ? decide(code(codeName), group(groupName)) : false;
}

describe(title, { skip: !built }, () => {
  describe('endsConnection: the errors that end the connection', () => {
    for (const name of [
      'RFC_COMMUNICATION_FAILURE',
      'RFC_ABAP_RUNTIME_FAILURE',
      'RFC_ABAP_MESSAGE',
      'RFC_EXTERNAL_FAILURE',
      'RFC_CLOSED',
    ]) {
      it(`code ${name} ends it, whatever the group`, () => {
        assert.equal(endsConnection(name, 'ABAP_APPLICATION_FAILURE'), true);
      });
    }
    for (const name of [
      'ABAP_RUNTIME_FAILURE',
      'LOGON_FAILURE',
      'COMMUNICATION_FAILURE',
      'EXTERNAL_RUNTIME_FAILURE',
    ]) {
      it(`group ${name} ends it, whatever the code`, () => {
        assert.equal(endsConnection('RFC_ABAP_EXCEPTION', name), true);
      });
    }
    it('RFC_OK does not end it', () => {
      assert.equal(endsConnection('RFC_OK', 'OK'), false);
    });
    it('RFC_ABAP_EXCEPTION in ABAP_APPLICATION_FAILURE does not end it', () => {
      assert.equal(
        endsConnection('RFC_ABAP_EXCEPTION', 'ABAP_APPLICATION_FAILURE'),
        false,
      );
    });
  });
});

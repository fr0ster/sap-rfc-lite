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
import {
  debuggeePassport,
  selfConsistentPassport,
} from './helpers/passport';

/** What the shim (test/native/shim.cc) exposes. */
interface TestAddon {
  codes: Record<string, number>;
  groups: Record<string, number>;
  endsConnection?: (code: number, group: number) => boolean;
  /** The answer to a call given the passport manager's install result. */
  passportCallAnswer?: (
    hasPassport: boolean,
    installCode: number,
    installGroup: number,
  ) => unknown;
  /**
   * The placement of `passport` into a buffer the SDK offers of `offered`
   * bytes, its length `length` as given: the buffer handed to the decision is
   * `offered + 16` bytes of 0xEE, so a write past `offered` is visible.
   */
  placePassport?: (
    passport: Buffer,
    offered: number,
    length: number,
  ) => { placed: boolean; length: number; buffer: Buffer };
  /** What a passport manager callback leaves (test/native/shim.cc). */
  callbackView?: (
    which: 'start' | 'end',
    passport: Buffer | null,
    sameHandle: boolean,
    offered: number,
    lengthIn: number,
  ) => { length: number; notPlaced: boolean; buffer: Buffer };
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

function field(value: unknown, name: string): unknown {
  return typeof value === 'object' && value !== null
    ? Reflect.get(value, name)
    : undefined;
}

describe(title, { skip: !built }, () => {
  describe('the passport manager: a passport call when the install failed', () => {
    function answer(hasPassport: boolean, codeName: string, groupName: string) {
      const decide = addon?.passportCallAnswer;
      assert.equal(typeof decide, 'function', 'the test addon has it');
      return decide
        ? decide(hasPassport, code(codeName), group(groupName))
        : undefined;
    }

    it('a call with a passport is refused with the install error, as every SDK error is built', () => {
      const refusal = answer(
        true,
        'RFC_EXTERNAL_FAILURE',
        'EXTERNAL_RUNTIME_FAILURE',
      );
      assert.equal(field(refusal, 'name'), 'RfcLibError');
      assert.equal(field(refusal, 'code'), code('RFC_EXTERNAL_FAILURE'));
      assert.equal(field(refusal, 'codeString'), 'RFC_EXTERNAL_FAILURE');
      assert.equal(field(refusal, 'group'), group('EXTERNAL_RUNTIME_FAILURE'));
    });

    it('a call with a passport is not refused when the install succeeded', () => {
      assert.equal(answer(true, 'RFC_OK', 'OK'), undefined);
    });

    it('a call without a passport is never refused for it', () => {
      assert.equal(
        answer(false, 'RFC_EXTERNAL_FAILURE', 'EXTERNAL_RUNTIME_FAILURE'),
        undefined,
      );
    });
  });

  describe('the passport manager callbacks: no passport but the call\'s own', () => {
    function view(
      which: 'start' | 'end',
      passport: Buffer | null,
      sameHandle: boolean,
      lengthIn: number,
    ) {
      const decide = addon?.callbackView;
      assert.equal(typeof decide, 'function', 'the test addon has it');
      if (!decide) throw new Error('no callbackView');
      return decide(which, passport, sameHandle, 512, lengthIn);
    }
    const untouched = (buffer: Buffer) => buffer.every((b) => b === 0xee);

    it('a call given no passport sends none, whatever the SDK offers (288 → 0)', () => {
      const result = view('start', null, true, 288);
      assert.equal(result.length, 0);
      assert.ok(untouched(result.buffer));
    });

    it("a call's own passport is placed on its own handle", () => {
      const passport = debuggeePassport();
      const result = view('start', passport, true, 288);
      assert.equal(result.length, 288);
      assert.ok(result.buffer.subarray(0, 288).equals(passport));
      assert.equal(result.notPlaced, false);
    });

    it('a request on another handle gets no passport (288 → 0)', () => {
      const result = view('start', debuggeePassport(), false, 288);
      assert.equal(result.length, 0);
      assert.ok(untouched(result.buffer));
    });

    it('a passport that does not fit is not placed, and nothing is sent in its place (288 → 0)', () => {
      const result = view('start', selfConsistentPassport(513), true, 288);
      assert.equal(result.notPlaced, true);
      assert.equal(result.length, 0);
      assert.ok(untouched(result.buffer));
    });

    it('the end callback clears the returned passport (288 → 0)', () => {
      const result = view('end', null, true, 288);
      assert.equal(result.length, 0);
      assert.ok(untouched(result.buffer));
    });
  });

  describe('the placement of a passport into the buffer the SDK offers', () => {
    function place(passport: Buffer, offered: number) {
      const decide = addon?.placePassport;
      assert.equal(typeof decide, 'function', 'the test addon has it');
      if (!decide) throw new Error('no placePassport');
      return decide(passport, offered, 0);
    }

    it('a passport shorter than the buffer is copied and its length set', () => {
      const passport = debuggeePassport();
      const result = place(passport, 512);
      assert.equal(result.placed, true);
      assert.equal(result.length, 288);
      assert.ok(result.buffer.subarray(0, 288).equals(passport));
      assert.ok(result.buffer.subarray(288).every((b) => b === 0xee));
    });

    it('a passport exactly the size of the buffer is placed', () => {
      const passport = selfConsistentPassport(512);
      const result = place(passport, 512);
      assert.equal(result.placed, true);
      assert.equal(result.length, 512);
      assert.ok(result.buffer.subarray(0, 512).equals(passport));
      assert.ok(result.buffer.subarray(512).every((b) => b === 0xee));
    });

    it('a passport larger than the buffer is not placed: nothing written, the length as given', () => {
      const result = place(selfConsistentPassport(513), 512);
      assert.equal(result.placed, false);
      assert.equal(result.length, 0);
      assert.ok(result.buffer.every((b) => b === 0xee));
    });
  });

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

// The shipped addon, built locally (`npm run build`), with no system: a client
// that was never opened answers the closed-connection error before anything
// is sent, with and without a passport.
const shippedBuilt =
  fs.existsSync(
    path.join(__dirname, '..', '..', 'build', 'Release', 'sapnwrfc.node'),
  ) && fs.existsSync(path.join(__dirname, '..', '..', 'lib', 'index.js'));
const shippedTitle = shippedBuilt
  ? 'the shipped addon without a system'
  : 'the shipped addon without a system — skipped: not built (npm run build, needs the SDK)';

describe(shippedTitle, { skip: !shippedBuilt }, () => {
  function closedConnection(thrown: unknown): boolean {
    const message =
      typeof thrown === 'object' && thrown !== null
        ? Reflect.get(thrown, 'message')
        : undefined;
    return (
      typeof message === 'string' &&
      message.startsWith(
        'RFM client request over closed connection: invoke() STFC_CONNECTION',
      )
    );
  }

  it('a client never opened answers the closed-connection error, with and without a passport', async () => {
    const lib: typeof import('../src/ts/index') = require(
      path.join(__dirname, '..', '..', 'lib', 'index.js'),
    );
    const client = new lib.Client({ ashost: '127.0.0.1', sysnr: '00' });
    assert.equal(client.alive, false);
    await assert.rejects(client.call('STFC_CONNECTION'), closedConnection);
    await assert.rejects(
      client.call('STFC_CONNECTION', {}, { passport: debuggeePassport() }),
      closedConnection,
    );
  });
});

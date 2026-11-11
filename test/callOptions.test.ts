// SPDX-FileCopyrightText: 2026 sap-rfc-lite contributors
// SPDX-License-Identifier: Apache-2.0

// `Client.call`'s third parameter: a passport reaches the native `invoke` as
// its fourth argument, `{ passport }`, only when the caller gave one; a call
// without it passes three arguments, the native path of 0.3.x.

import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { answer, Client, invokes, reset } from './helpers/fakeBinding';
import { debuggeePassport } from './helpers/passport';

const client = new Client({});

describe('Client.call options', () => {
  beforeEach(reset);

  it('a call without options hands invoke exactly three arguments', async () => {
    await client.call('STFC_CONNECTION', { REQUTEXT: 'x' });
    assert.equal(invokes.length, 1);
    assert.equal(invokes[0]?.length, 3);
    assert.equal(invokes[0]?.[0], 'STFC_CONNECTION');
    assert.deepEqual(invokes[0]?.[1], { REQUTEXT: 'x' });
  });

  it('options without a passport hand invoke exactly three arguments', async () => {
    await client.call('STFC_CONNECTION', {}, {});
    assert.equal(invokes[0]?.length, 3);
  });

  it('a passport is handed to invoke as { passport }, the same Buffer', async () => {
    const passport = debuggeePassport();
    await client.call('STFC_CONNECTION', {}, { passport });
    assert.equal(invokes[0]?.length, 4);
    assert.deepEqual(invokes[0]?.[3], { passport });
    const options = invokes[0]?.[3];
    assert.ok(typeof options === 'object' && options !== null);
    assert.equal(Reflect.get(options, 'passport'), passport);
  });

  it("the native callback's error is call's rejection, unchanged", async () => {
    const error = { name: 'ABAPError', code: 4, message: 'from the SDK' };
    answer.err = error;
    const rejected = assert.rejects(
      client.call('X', {}, { passport: debuggeePassport() }),
      (thrown) => thrown === error,
    );
    await rejected;
  });

  it("the native callback's result is call's answer", async () => {
    const result = { ECHOTEXT: 'y' };
    answer.res = result;
    assert.equal(await client.call('X'), result);
  });
});

// SPDX-FileCopyrightText: 2026 sap-rfc-lite contributors
// SPDX-License-Identifier: Apache-2.0

// The passport's value rules, checked before anything is sent: not empty,
// `*TH*` at its start, its own length declared at bytes 5-6 (unsigned 16-bit,
// big-endian), `*TH*` in its last 4 bytes. The system ignores a passport whose
// declared length is wrong in silence (measured), so only this check makes it
// visible. Each case breaks one rule and keeps the others.

import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { Client, invokes, reset } from './helpers/fakeBinding';
import {
  debuggeePassport,
  selfConsistentPassport,
} from './helpers/passport';

const client = new Client({});

async function refused(passport: Buffer, words: string): Promise<void> {
  const rejected = assert.rejects(
    client.call('STFC_CONNECTION', {}, { passport }),
    (thrown) => thrown instanceof TypeError && thrown.message.includes(words),
  );
  await rejected;
  assert.equal(invokes.length, 0, 'nothing is handed to invoke');
}

describe('the passport value rules', () => {
  beforeEach(reset);

  it("the ADT client's 288-byte debuggee passport reaches invoke unchanged", async () => {
    const passport = debuggeePassport();
    const copy = Buffer.from(passport);
    assert.equal(passport.length, 288);
    await client.call('STFC_CONNECTION', {}, { passport });
    const options = invokes[0]?.[3];
    assert.ok(typeof options === 'object' && options !== null);
    const sent = Reflect.get(options, 'passport');
    assert.equal(sent, passport);
    assert.ok(copy.equals(passport));
  });

  it('an empty Buffer is refused', async () => {
    await refused(Buffer.alloc(0), 'passport is empty');
  });

  it('6 bytes are refused: too short to declare a length', async () => {
    await refused(Buffer.from('*TH*\x03\x00', 'latin1'), 'shorter than 7');
  });

  it('a passport without the leading *TH* is refused', async () => {
    const passport = debuggeePassport();
    passport.write('*TX*', 0, 'latin1');
    await refused(passport, 'does not start with');
  });

  it('a passport without the trailing *TH* is refused', async () => {
    const passport = debuggeePassport();
    passport.write('*TX*', passport.length - 4, 'latin1');
    await refused(passport, 'does not end with');
  });

  it('a declared length one more than the length is refused', async () => {
    const passport = debuggeePassport();
    passport.writeUInt16BE(289, 5);
    await refused(passport, 'declares 289 bytes');
  });

  it('a declared length one less than the length is refused', async () => {
    const passport = debuggeePassport();
    passport.writeUInt16BE(287, 5);
    await refused(passport, 'declares 287 bytes');
  });

  it('a self-consistent passport of 11 bytes, the shortest, passes', async () => {
    await client.call('X', {}, { passport: selfConsistentPassport(11) });
    assert.equal(invokes.length, 1);
  });
});

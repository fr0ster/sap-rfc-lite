// SPDX-FileCopyrightText: 2026 sap-rfc-lite contributors
// SPDX-License-Identifier: Apache-2.0

// The live suite's reading of a terminal-mode listener's answer (test/helpers/
// live.ts), on answers made up here: a negative live test is only as good as
// this reading, since "nothing caught" must not be any failed answer.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readListenerAnswer } from './helpers/live';

const CAUGHT_BODY =
  '<?xml version="1.0" encoding="utf-8"?><asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0"><asx:values><DEBUGGEES_LIST><STPDA_ADT_DEBUGGEE><DEBUGGEE_ID>DEBUGGEE-1</DEBUGGEE_ID></STPDA_ADT_DEBUGGEE></DEBUGGEES_LIST></asx:values></asx:abap>';

/** The error names `status` and is not "nothing caught". */
function refusedNaming(status: number): (thrown: unknown) => boolean {
  return (thrown) =>
    thrown instanceof Error &&
    thrown.message.includes('neither "nothing caught"') &&
    thrown.message.includes(`status ${status},`);
}

describe('the listener answer, as the live suite reads it', () => {
  it('200 with an empty body is nothing caught', () => {
    assert.deepEqual(readListenerAnswer({ status: 200, body: '' }), {
      caught: false,
    });
  });

  it('200 naming a DEBUGGEE_ID is the debuggee caught', () => {
    assert.deepEqual(readListenerAnswer({ status: 200, body: CAUGHT_BODY }), {
      caught: true,
      debuggeeId: 'DEBUGGEE-1',
    });
  });

  it('an error status with an empty body is not nothing caught', () => {
    assert.throws(
      () => readListenerAnswer({ status: 500, body: '' }),
      refusedNaming(500),
    );
  });

  it('an error status with a body is not nothing caught', () => {
    assert.throws(
      () =>
        readListenerAnswer({
          status: 409,
          body: '<exc:exception><type id="conflictDetected"/></exc:exception>',
        }),
      refusedNaming(409),
    );
  });

  it('an error status naming a DEBUGGEE_ID is not a catch', () => {
    assert.throws(
      () => readListenerAnswer({ status: 500, body: CAUGHT_BODY }),
      refusedNaming(500),
    );
  });

  it('200 with a body that names no debuggee is not nothing caught', () => {
    assert.throws(
      () => readListenerAnswer({ status: 200, body: '<asx:abap/>' }),
      refusedNaming(200),
    );
  });

  it('200 with an empty DEBUGGEE_ID is not a catch', () => {
    assert.throws(
      () =>
        readListenerAnswer({
          status: 200,
          body: '<DEBUGGEE_ID></DEBUGGEE_ID>',
        }),
      refusedNaming(200),
    );
  });

  it('a status the transport could not read (0) is not nothing caught', () => {
    assert.throws(
      () => readListenerAnswer({ status: 0, body: '' }),
      refusedNaming(0),
    );
  });
});

// SPDX-FileCopyrightText: 2026 sap-rfc-lite contributors
// SPDX-License-Identifier: Apache-2.0

// Live, against an on-premise system over RFC; never in CI. Reads the
// connection from the session file named by SAP_RFC_LITE_LIVE_ENV (by plain
// code, never sourced) and needs the package built (`npm run build`); skips,
// its reason in the title, otherwise.
//
// It creates its own runnable class in $TMP (no transport) and deletes it at
// the end, removes every external breakpoint it set, and closes every
// connection in a `finally`. It prints no value of the session file, no lock
// handle, no id and no passport. RFC_RAISE_ERROR with METHOD '3' is a runtime
// error: each run of this suite leaves one short dump of it in the system.

import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import type * as Lib from '../src/ts/index';
import type { Client, RfcConnectionParameters } from '../src/ts/index';
import {
  activateClass,
  adt,
  armBreakpoint,
  attachAndDetach,
  checkListener,
  classUri,
  clearBreakpoints,
  createClass,
  deleteClass,
  type ListenerAnswer,
  listen,
  loadLib,
  lockClass,
  RUN_OUTPUT,
  readSession,
  runClass,
  type Terminal,
  stopListener,
  unlockClass,
  writeSource,
} from './helpers/live';
import {
  debuggeePassport,
  randomIds,
  selfConsistentPassport,
} from './helpers/passport';

// Compiled to .test-build/test/; the repository root is two up.
const root = path.join(__dirname, '..', '..');
const envFile = process.env.SAP_RFC_LITE_LIVE_ENV;
const built = fs.existsSync(path.join(root, 'lib', 'index.js'));
const ready = envFile !== undefined && envFile !== '' && built;
const title = ready
  ? 'live over RFC'
  : envFile === undefined || envFile === ''
    ? 'live over RFC — skipped: SAP_RFC_LITE_LIVE_ENV names no session file'
    : 'live over RFC — skipped: the package is not built (npm run build)';

/** How long the server holds a listener that is expected to catch a run. */
const HOLD_CAUGHT = 30;
/** How long the server holds a listener that is expected to catch nothing. */
const HOLD_EMPTY = 10;
function read(value: unknown, name: string): unknown {
  return typeof value === 'object' && value !== null
    ? Reflect.get(value, name)
    : undefined;
}

/** The thrown value is the SDK error of `codeString`. */
function sdkError(codeString: string): (thrown: unknown) => boolean {
  return (thrown) => read(thrown, 'codeString') === codeString;
}

/** The thrown value is the closed-connection error. */
function closedConnection(thrown: unknown): boolean {
  const message = read(thrown, 'message');
  return (
    read(thrown, 'name') === 'nodeRfcError' &&
    typeof message === 'string' &&
    message.startsWith('RFM client request over closed connection')
  );
}

describe(title, { skip: !ready }, () => {
  let lib: typeof Lib;
  let parameters: RfcConnectionParameters;
  let className: string;
  const opened: Client[] = [];

  async function openClient(): Promise<Client> {
    const client = new lib.Client(parameters);
    opened.push(client);
    await client.open();
    return client;
  }

  async function closeAll(): Promise<void> {
    for (const client of opened.splice(0)) {
      if (client.alive) {
        try {
          await client.close();
        } catch {
          // closed by the system already; nothing left to release
        }
      }
    }
  }

  before(async () => {
    lib = loadLib(root);
    parameters = readSession(envFile ?? '');
    className = `ZCL_SRL_PP_${randomBytes(4).toString('hex').toUpperCase()}`;
    const admin = await openClient();
    await createClass(admin, className);
    const lock = await lockClass(admin, className);
    assert.ok(lock.handle, `locking the new class answered ${lock.status}`);
    assert.equal(await writeSource(admin, className, lock.handle), 200);
    assert.equal(await unlockClass(admin, className, lock.handle), 200);
    await activateClass(admin, className);
  });

  after(async () => {
    // Every session the tests opened ends first, and with it any lock a failed
    // test left behind; then the class is deleted on a session of its own.
    await closeAll();
    try {
      const admin = await openClient();
      const deleted = await deleteClass(admin, className);
      assert.ok(deleted < 300, `deleting the test class answered ${deleted}`);
      // The deletion answers 200 also when it deleted nothing (a lock held
      // elsewhere): the class is gone only when reading it answers 404.
      const gone = await adt(admin, 'GET', classUri(className));
      assert.equal(gone.status, 404, 'the test class is gone');
    } finally {
      await closeAll();
    }
  });

  /**
   * A debugger for `ids`: a listener's connection, a run's, and a checker's,
   * which asks under an IDE id of its own whether the listener stands.
   */
  async function debuggerFor(ids: Terminal) {
    const listener = await openClient();
    const runner = await openClient();
    const checker = await openClient();
    await armBreakpoint(listener, ids, className);
    return { listener, runner, checker };
  }

  /**
   * Resolve once the listener whose poll is `heard` stands at the system.
   *
   * Owner-approved test-only exception (2026-11-11) to "no polling": ADT
   * offers no readiness event for a terminal-mode listener. Measured on
   * premise: a run sent before the listener stands is not held and is not
   * caught; a listener is registered only while its poll is held, so an
   * answered first poll proves nothing; a second listener of the same user
   * answers 409 only when it arrives after the first, and otherwise stands its
   * whole hold without a word. The one thing that says "a listener stands" is
   * the check's 409, so the check is repeated - with no pause beyond its own
   * round trip - until it answers 409. The listener's own hold bounds the
   * loop: if its poll settles before a 409 is seen, this fails saying so.
   */
  async function listening(
    checker: Client,
    heard: Promise<ListenerAnswer>,
  ): Promise<void> {
    let settled = false;
    heard.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    const asker = randomIds();
    for (;;) {
      if (settled) {
        throw new Error(
          "the listener's poll settled before the check answered 409 (a listener stands)",
        );
      }
      if ((await checkListener(checker, asker)) === 'standing') return;
    }
  }

  async function release(listener: Client, ids: Terminal): Promise<void> {
    assert.equal(await stopListener(listener, ids), 200);
    assert.equal(await clearBreakpoints(listener, ids), 200);
  }

  /**
   * Listen, run with `passport` once the listener stands, and answer what it
   * caught.
   */
  async function listenAndRun(
    listener: Client,
    runner: Client,
    checker: Client,
    ids: Terminal,
    hold: number,
    passport?: Buffer,
  ) {
    const heard = listen(listener, ids, hold);
    await listening(checker, heard);
    const run = runClass(runner, className, passport);
    const caught = await heard;
    return { caught, run };
  }

  /** A run the listener caught: attach and detach, then its output. */
  async function finishCaught(debuggeeId: string, run: Promise<unknown>) {
    const attacher = await openClient();
    const { attached } = await attachAndDetach(attacher, debuggeeId);
    assert.equal(attached, 200, 'attached');
    const output = await run;
    assert.equal(read(output, 'status'), 200);
    const body = read(output, 'body');
    assert.ok(typeof body === 'string' && body.includes(RUN_OUTPUT));
  }

  /**
   * A run nobody caught: the listener's hold ended in the one form that means
   * "nothing caught" (any other answer has already failed the reading), and
   * the run answered its output.
   */
  async function uncaught(caught: ListenerAnswer, run: Promise<unknown>) {
    assert.deepEqual(caught, { caught: false }, 'the listener caught nothing');
    const output = await run;
    assert.equal(read(output, 'status'), 200);
    const body = read(output, 'body');
    assert.ok(typeof body === 'string' && body.includes(RUN_OUTPUT));
  }

  it('a run carrying the debuggee passport is caught by the listener for its ids', async () => {
    const ids = randomIds();
    const { listener, runner, checker } = await debuggerFor(ids);
    try {
      const { caught, run } = await listenAndRun(
        listener,
        runner,
        checker,
        ids,
        HOLD_CAUGHT,
        debuggeePassport(ids),
      );
      assert.ok(caught.caught, 'the listener caught the run');
      await finishCaught(caught.debuggeeId, run);
    } finally {
      await release(listener, ids);
    }
  });

  it('a run without a passport is not caught', async () => {
    const ids = randomIds();
    const { listener, runner, checker } = await debuggerFor(ids);
    try {
      const { caught, run } = await listenAndRun(
        listener,
        runner,
        checker,
        ids,
        HOLD_EMPTY,
      );
      await uncaught(caught, run);
    } finally {
      await release(listener, ids);
    }
  });

  it('a run carrying a passport for other ids is not caught', async () => {
    const ids = randomIds();
    const { listener, runner, checker } = await debuggerFor(ids);
    try {
      const { caught, run } = await listenAndRun(
        listener,
        runner,
        checker,
        ids,
        HOLD_EMPTY,
        debuggeePassport(randomIds()),
      );
      await uncaught(caught, run);
    } finally {
      await release(listener, ids);
    }
  });

  // The system keeps a caught session's debugging state until the session is
  // reset (spec 3.2, measured): the next call is made after the caller's
  // reset. That the library sends no passport without one is proved on the
  // callbacks themselves (test/native.test.ts).
  it('the passport reaches only its own call: after a reset the next call is not caught', async () => {
    const ids = randomIds();
    const { listener, runner, checker } = await debuggerFor(ids);
    try {
      const first = await listenAndRun(
        listener,
        runner,
        checker,
        ids,
        HOLD_CAUGHT,
        debuggeePassport(ids),
      );
      assert.ok(first.caught.caught, 'the listener caught the first run');
      await finishCaught(first.caught.debuggeeId, first.run);
      await runner.resetServerContext();
      const next = await listenAndRun(
        listener,
        runner,
        checker,
        ids,
        HOLD_EMPTY,
      );
      await uncaught(next.caught, next.run);
    } finally {
      await release(listener, ids);
    }
  });

  it('a passport declaring 289 of its 288 bytes is refused before anything is sent', async () => {
    const ids = randomIds();
    const { listener, runner, checker } = await debuggerFor(ids);
    try {
      const passport = debuggeePassport(ids);
      passport.writeUInt16BE(289, 5);
      const heard = listen(listener, ids, HOLD_EMPTY);
      await listening(checker, heard);
      const refused = assert.rejects(
        runClass(runner, className, passport),
        (thrown) =>
          thrown instanceof TypeError &&
          thrown.message.includes('declares 289 bytes'),
      );
      await refused;
      assert.deepEqual(await heard, { caught: false }, 'nothing was caught');
      assert.equal(runner.alive, true);
    } finally {
      await release(listener, ids);
    }
  });

  it('a passport larger than the buffer the SDK offers: the call ran without it and rejects saying so', async () => {
    const holder = await openClient();
    const other = await openClient();
    const passport = selfConsistentPassport(65535);
    try {
      const refused = assert.rejects(
        adt(
          holder,
          'POST',
          `${classUri(className)}?_action=LOCK&accessMode=MODIFY`,
          { passport },
        ),
        (thrown) => {
          const message = read(thrown, 'message');
          return (
            read(thrown, 'name') === 'nodeRfcError' &&
            typeof message === 'string' &&
            message.includes('ran without the passport') &&
            message.includes('65535 bytes')
          );
        },
      );
      await refused;
      assert.equal(holder.alive, true, 'the connection stays open');
      // The call ran: the lock it took is held, so another session's is
      // refused.
      const blocked = await lockClass(other, className);
      assert.equal(blocked.handle, undefined, 'the lock is held by the call');
    } finally {
      // Release whatever the call holds with the session that holds it.
      await holder.resetServerContext();
    }
    const free = await lockClass(other, className);
    assert.ok(free.handle, `the lock is free again (${free.status})`);
    assert.equal(await unlockClass(other, className, free.handle), 200);
  });

  async function errorEndsConnection(
    raise: Record<string, string>,
    codeString: string,
  ): Promise<void> {
    const client = await openClient();
    const lock = await lockClass(client, className);
    assert.ok(lock.handle, `locked (${lock.status})`);
    const failed = assert.rejects(
      client.call('RFC_RAISE_ERROR', raise),
      sdkError(codeString),
    );
    await failed;
    assert.equal(client.alive, false, 'alive is false after the error');
    await assert.rejects(client.call('STFC_CONNECTION'), closedConnection);
    await assert.rejects(client.resetServerContext(), closedConnection);
    await assert.rejects(client.close(), closedConnection);
    // The session ends only when the caller opens a new one: the old lock
    // handle is then refused, and the lock itself is gone with the old session.
    await client.open();
    assert.equal(client.alive, true);
    assert.equal(await writeSource(client, className, lock.handle), 423);
    const again = await lockClass(client, className);
    assert.ok(again.handle, `the old session's lock is gone (${again.status})`);
    assert.equal(await unlockClass(client, className, again.handle), 200);
  }

  it('an ABAP message is returned as it came, and the connection is closed', async () => {
    await errorEndsConnection(
      { METHOD: '0', MESSAGETYPE: 'E' },
      'RFC_ABAP_MESSAGE',
    );
  });

  it('an ABAP runtime error is returned as it came, and the connection is closed', async () => {
    await errorEndsConnection({ METHOD: '3' }, 'RFC_ABAP_RUNTIME_FAILURE');
  });

  it('an ABAP exception leaves the connection open, on the same session', async () => {
    const client = await openClient();
    const lock = await lockClass(client, className);
    assert.ok(lock.handle, `locked (${lock.status})`);
    const failed = assert.rejects(
      client.call('RFC_RAISE_ERROR', { METHOD: '2' }),
      sdkError('RFC_ABAP_EXCEPTION'),
    );
    await failed;
    assert.equal(client.alive, true);
    assert.equal(await writeSource(client, className, lock.handle), 200);
    assert.equal(await unlockClass(client, className, lock.handle), 200);
  });
});

// SPDX-FileCopyrightText: 2026 sap-rfc-lite contributors
// SPDX-License-Identifier: Apache-2.0

// What the live suite (test/live.test.ts) needs besides the client: the
// connection read from a session file, ADT requests over RFC
// (SADT_REST_RFC_ENDPOINT, as Eclipse ADT sends them on premise), and the
// requests of a test class and of the external debugger. Nothing here prints a
// value of the session file, a lock handle, an id or a passport.

import fs from 'node:fs';
import type * as Lib from '../../src/ts/index';
import type { Client, RfcConnectionParameters } from '../../src/ts/index';

/** The package as built (`npm run build`): lib/ next to the repository root. */
export function loadLib(root: string): typeof Lib {
  const lib: typeof Lib = require(`${root}/lib/index.js`);
  return lib;
}

const SESSION_KEYS: Record<string, string> = {
  SAP_ASHOST: 'ashost',
  SAP_SYSNR: 'sysnr',
  SAP_CLIENT: 'client',
  SAP_USERNAME: 'user',
  SAP_PASSWORD: 'passwd',
  SAP_LANGUAGE: 'lang',
};

/**
 * The RFC logon parameters of a session file (`KEY=value` lines), read by
 * plain code and never sourced. Only the keys above are taken.
 */
export function readSession(file: string): RfcConnectionParameters {
  const parameters: RfcConnectionParameters = {};
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const at = line.indexOf('=');
    if (at <= 0) continue;
    const key = line.slice(0, at).trim();
    const name = SESSION_KEYS[key];
    if (name === undefined) continue;
    let value = line.slice(at + 1).trim();
    const first = value[0];
    if (
      value.length >= 2 &&
      (first === '"' || first === "'") &&
      value[value.length - 1] === first
    ) {
      value = value.slice(1, -1);
    }
    if (value.length > 0) parameters[name] = value;
  }
  for (const [key, name] of Object.entries(SESSION_KEYS)) {
    if (parameters[name] === undefined) {
      throw new Error(`the session file has no ${key}`);
    }
  }
  return parameters;
}

/** An ADT answer over RFC: its status and its body as text. */
export interface AdtAnswer {
  status: number;
  body: string;
}

function field(value: unknown, name: string): unknown {
  return typeof value === 'object' && value !== null
    ? Reflect.get(value, name)
    : undefined;
}

/** One ADT request over RFC, optionally carrying a passport on the RFC call. */
export async function adt(
  client: Client,
  method: string,
  uri: string,
  options: {
    headers?: Record<string, string>;
    body?: string;
    passport?: Buffer;
  } = {},
): Promise<AdtAnswer> {
  const headers = { Accept: '*/*', ...options.headers };
  const HEADER_FIELDS = Object.entries(headers).map(([NAME, VALUE]) => ({
    NAME,
    VALUE,
  }));
  const request = {
    REQUEST: {
      REQUEST_LINE: { METHOD: method, URI: uri, VERSION: 'HTTP/1.1' },
      HEADER_FIELDS,
      MESSAGE_BODY: Buffer.from(options.body ?? '', 'utf8'),
    },
  };
  const raw =
    options.passport === undefined
      ? await client.call('SADT_REST_RFC_ENDPOINT', request)
      : await client.call('SADT_REST_RFC_ENDPOINT', request, {
          passport: options.passport,
        });
  const response = field(raw, 'RESPONSE');
  const code = field(field(response, 'STATUS_LINE'), 'STATUS_CODE');
  const status =
    typeof code === 'string'
      ? Number.parseInt(code, 10)
      : typeof code === 'number'
        ? code
        : 0;
  const body = field(response, 'MESSAGE_BODY');
  return {
    status,
    body: Buffer.isBuffer(body)
      ? body.toString('utf8')
      : typeof body === 'string'
        ? body
        : '',
  };
}

/** The text between `<NAME>` and `</NAME>` (plain search), or undefined. */
export function tag(document: string, name: string): string | undefined {
  const open = `<${name}>`;
  const start = document.indexOf(open);
  if (start < 0) return undefined;
  const end = document.indexOf(`</${name}>`, start + open.length);
  if (end < 0) return undefined;
  return document.slice(start + open.length, end);
}

/** The value of `attribute="…"` in a document (plain search), or undefined. */
export function attribute(document: string, name: string): string | undefined {
  const key = `${name}="`;
  const start = document.indexOf(key);
  if (start < 0) return undefined;
  const end = document.indexOf('"', start + key.length);
  if (end < 0) return undefined;
  return document.slice(start + key.length, end);
}

// --- the test class ------------------------------------------------------------

const CLASSES = '/sap/bc/adt/oo/classes';
const ACCEPT_LOCK =
  'application/vnd.sap.as+xml;charset=UTF-8;dataname=com.sap.adt.lock.result;q=0.8, application/vnd.sap.as+xml;charset=UTF-8;dataname=com.sap.adt.lock.result2;q=0.9';

export function classUri(name: string): string {
  return `${CLASSES}/${name.toLowerCase()}`;
}

/** A runnable class whose `main` writes one line; that line is `BREAK_LINE`. */
export function classSource(name: string): string {
  const lower = name.toLowerCase();
  return [
    `CLASS ${lower} DEFINITION PUBLIC FINAL CREATE PUBLIC.`,
    '  PUBLIC SECTION.',
    '    INTERFACES if_oo_adt_classrun.',
    'ENDCLASS.',
    `CLASS ${lower} IMPLEMENTATION.`,
    '  METHOD if_oo_adt_classrun~main.',
    "    out->write( 'sap-rfc-lite passport run' ).",
    '  ENDMETHOD.',
    'ENDCLASS.',
    '',
  ].join('\n');
}

/** The source line `classSource` writes its output on. */
export const BREAK_LINE = 7;

/** What the class run answers. */
export const RUN_OUTPUT = 'sap-rfc-lite passport run';

export async function createClass(client: Client, name: string): Promise<void> {
  const body = `<?xml version="1.0" encoding="UTF-8"?><class:abapClass xmlns:class="http://www.sap.com/adt/oo/classes" xmlns:adtcore="http://www.sap.com/adt/core" adtcore:description="sap-rfc-lite live test" adtcore:name="${name}" adtcore:type="CLAS/OC" class:final="true" class:visibility="public"><adtcore:packageRef adtcore:name="$TMP"/><class:superClassRef/></class:abapClass>`;
  const created = await adt(client, 'POST', CLASSES, {
    headers: {
      'Content-Type': 'application/vnd.sap.adt.oo.classes.v4+xml',
      Accept: 'application/vnd.sap.adt.oo.classes.v4+xml',
    },
    body,
  });
  if (created.status >= 300) {
    throw new Error(`creating the test class answered ${created.status}`);
  }
}

/** Lock the class; the handle, or the status when the lock was refused. */
export async function lockClass(
  client: Client,
  name: string,
): Promise<{ status: number; handle?: string }> {
  const answer = await adt(
    client,
    'POST',
    `${classUri(name)}?_action=LOCK&accessMode=MODIFY`,
    { headers: { Accept: ACCEPT_LOCK } },
  );
  const handle = tag(answer.body, 'LOCK_HANDLE');
  return handle === undefined
    ? { status: answer.status }
    : { status: answer.status, handle };
}

export async function unlockClass(
  client: Client,
  name: string,
  handle: string,
): Promise<number> {
  const answer = await adt(
    client,
    'POST',
    `${classUri(name)}?_action=UNLOCK&lockHandle=${encodeURIComponent(handle)}`,
  );
  return answer.status;
}

/** Write the class's source under a lock handle; the status. */
export async function writeSource(
  client: Client,
  name: string,
  handle: string,
): Promise<number> {
  const answer = await adt(
    client,
    'PUT',
    `${classUri(name)}/source/main?lockHandle=${encodeURIComponent(handle)}`,
    {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        Accept: 'text/plain',
      },
      body: classSource(name),
    },
  );
  return answer.status;
}

export async function activateClass(client: Client, name: string): Promise<void> {
  const body = `<?xml version="1.0" encoding="UTF-8"?><adtcore:objectReferences xmlns:adtcore="http://www.sap.com/adt/core"><adtcore:objectReference adtcore:uri="${classUri(name)}" adtcore:type="CLAS/OC" adtcore:name="${name}"/></adtcore:objectReferences>`;
  const answer = await adt(
    client,
    'POST',
    '/sap/bc/adt/activation?method=activate&preauditRequested=true',
    {
      headers: { 'Content-Type': 'application/xml', Accept: 'application/xml' },
      body,
    },
  );
  if (answer.status >= 300 || answer.body.includes('type="E"')) {
    throw new Error(`activating the test class answered ${answer.status}`);
  }
}

export async function deleteClass(client: Client, name: string): Promise<number> {
  const body = `<?xml version="1.0" encoding="UTF-8"?><del:deletionRequest xmlns:del="http://www.sap.com/adt/deletion" xmlns:adtcore="http://www.sap.com/adt/core"><del:object adtcore:uri="${classUri(name)}"><del:transportNumber/></del:object></del:deletionRequest>`;
  const answer = await adt(client, 'POST', '/sap/bc/adt/deletion/delete', {
    headers: {
      'Content-Type': 'application/vnd.sap.adt.deletion.request.v1+xml',
      Accept: 'application/vnd.sap.adt.deletion.response.v1+xml',
    },
    body,
  });
  return answer.status;
}

/** Run the class (`if_oo_adt_classrun`), optionally carrying a passport. */
export function runClass(
  client: Client,
  name: string,
  passport?: Buffer,
): Promise<AdtAnswer> {
  return adt(client, 'POST', `/sap/bc/adt/oo/classrun/${name}`, {
    headers: { Accept: 'text/plain' },
    ...(passport === undefined ? {} : { passport }),
  });
}

// --- the external debugger, terminal mode ---------------------------------------

const DEBUGGER = '/sap/bc/adt/debugger';

export interface Terminal {
  terminalId: string;
  ideId: string;
}

function terminalQuery(ids: Terminal, extra: Record<string, string> = {}) {
  return new URLSearchParams({
    debuggingMode: 'terminal',
    terminalId: ids.terminalId,
    ideId: ids.ideId,
    ...extra,
  }).toString();
}

function breakpointsBody(ids: Terminal, rows: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?><dbg:breakpoints xmlns:dbg="http://www.sap.com/adt/debugger" xmlns:adtcore="http://www.sap.com/adt/core" debuggingMode="terminal" scope="external" terminalId="${ids.terminalId}" ideId="${ids.ideId}">${rows}</dbg:breakpoints>`;
}

/** Arm one external line breakpoint at `BREAK_LINE` of the class. */
export async function armBreakpoint(
  client: Client,
  ids: Terminal,
  name: string,
): Promise<void> {
  const row = `<breakpoint kind="line" adtcore:uri="${classUri(name)}/source/main#start=${BREAK_LINE}"/>`;
  const answer = await adt(client, 'POST', `${DEBUGGER}/breakpoints`, {
    headers: { 'Content-Type': 'application/xml', Accept: 'application/xml' },
    body: breakpointsBody(ids, row),
  });
  if (answer.status !== 200 || attribute(answer.body, 'id') === undefined) {
    throw new Error(`arming the breakpoint answered ${answer.status}`);
  }
}

/** Remove every external breakpoint under the terminal's key. */
export async function clearBreakpoints(
  client: Client,
  ids: Terminal,
): Promise<number> {
  const answer = await adt(client, 'POST', `${DEBUGGER}/breakpoints`, {
    headers: { 'Content-Type': 'application/xml', Accept: 'application/xml' },
    body: breakpointsBody(ids, '<syncScope mode="full"/>'),
  });
  return answer.status;
}

/**
 * The listener's long poll: the server holds it `holdSeconds` and answers an
 * empty body, or a `DebuggeesList` naming the debuggee it caught.
 */
export async function listen(
  client: Client,
  ids: Terminal,
  holdSeconds: number,
): Promise<{ debuggeeId?: string; status: number }> {
  const answer = await adt(
    client,
    'POST',
    `${DEBUGGER}/listeners?${terminalQuery(ids, { timeout: String(holdSeconds) })}`,
    { headers: { Accept: 'application/vnd.sap.as+xml' } },
  );
  const debuggeeId = tag(answer.body, 'DEBUGGEE_ID');
  return debuggeeId === undefined
    ? { status: answer.status }
    : { status: answer.status, debuggeeId };
}

/** Release the listener (it also deletes the key's breakpoints). */
export async function stopListener(
  client: Client,
  ids: Terminal,
): Promise<number> {
  const answer = await adt(
    client,
    'DELETE',
    `${DEBUGGER}/listeners?${terminalQuery(ids)}`,
  );
  return answer.status;
}

/** Attach to a caught debuggee, then detach: the run goes on to its end. */
export async function attachAndDetach(
  client: Client,
  debuggeeId: string,
): Promise<{ attached: number; detached: number }> {
  const attached = await adt(
    client,
    'POST',
    `${DEBUGGER}?${new URLSearchParams({ method: 'attach', debuggeeId, debuggingMode: 'terminal', dynproDebugging: 'true' }).toString()}`,
    { headers: { Accept: 'application/xml' } },
  );
  const detached = await adt(
    client,
    'POST',
    `${DEBUGGER}?method=detachDebugger`,
    { headers: { Accept: 'application/xml' } },
  );
  return { attached: attached.status, detached: detached.status };
}

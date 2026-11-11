// SPDX-FileCopyrightText: 2026 sap-rfc-lite contributors
// SPDX-License-Identifier: Apache-2.0

// The ADT client's debuggee passport (adt-clients
// `runtime/debugger/passport.ts`): 288 bytes, version 3, the eye catcher `*TH*`
// at both ends, its own length (0x0120) at bytes 5-6, and the terminal and IDE
// ids as the two system variable items a terminal-mode listener matches.

import { randomBytes } from 'node:crypto';

/** 288 bytes: the passport with every per-request field zero. */
const TEMPLATE = [
  '2A54482A03012000000000000000000000000000000000000000000000000000',
  '0000000000000000000000000000000000000000000000000000000000000000',
  '0000000000000000000000000000000000000000000000000000000000000000',
  '0000000000000000000000000000000000000000000000000000000000000000',
  '0000000000000000000000000000000000000000000000000000000000000000',
  '000000000000000000000000000000000000000000000000000A000000000000',
  '0000000000000000000000000000000000000000000000000000000000000001',
  '00E22A54482A01003A0100010002000200010300170000000000000000000000',
  '000000000000020002030017000000000000000000000000000000002A54482A',
].join('');

const TRANS_ID = 149; // 32 ASCII hex characters
const ROOT_CONTEXT_ID = 186; // 16 bytes
const TERMINAL_ID = 245; // 16 bytes, system variable item (2, 1)
const IDE_ID = 268; // 16 bytes, system variable item (2, 2)

/** A terminal id and an IDE id: 32 upper-case hex characters each. */
export interface DebuggeeIds {
  terminalId: string;
  ideId: string;
}

/** Fresh random ids, as an IDE would mint them. */
export function randomIds(): DebuggeeIds {
  return {
    terminalId: randomBytes(16).toString('hex').toUpperCase(),
    ideId: randomBytes(16).toString('hex').toUpperCase(),
  };
}

/** The debuggee passport for `ids` (random ids when none are given). */
export function debuggeePassport(ids: DebuggeeIds = randomIds()): Buffer {
  const passport = Buffer.from(TEMPLATE, 'hex');
  const hex = () => randomBytes(16).toString('hex').toUpperCase();
  Buffer.from(hex(), 'ascii').copy(passport, TRANS_ID);
  Buffer.from(hex(), 'hex').copy(passport, ROOT_CONTEXT_ID);
  Buffer.from(ids.terminalId, 'hex').copy(passport, TERMINAL_ID);
  Buffer.from(ids.ideId, 'hex').copy(passport, IDE_ID);
  return passport;
}

/**
 * A self-consistent passport of `length` bytes: `*TH*` at both ends and its
 * length declared at bytes 5-6. Nothing else in it means anything.
 */
export function selfConsistentPassport(length: number): Buffer {
  const passport = Buffer.alloc(length);
  passport.write('*TH*', 0, 'latin1');
  passport.writeUInt8(3, 4);
  passport.writeUInt16BE(length, 5);
  passport.write('*TH*', length - 4, 'latin1');
  return passport;
}

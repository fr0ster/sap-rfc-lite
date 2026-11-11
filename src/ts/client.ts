// SPDX-FileCopyrightText: 2026 sap-rfc-lite contributors
// SPDX-License-Identifier: Apache-2.0

import { binding, type RfcClientBinding } from './binding';
import type {
  RfcCallOptions,
  RfcConnectionParameters,
  RfcObject,
} from './types';

/** `*TH*`: the eye catcher a passport starts and ends with. */
const EYE_CATCHER = [0x2a, 0x54, 0x48, 0x2a];

function hasEyeCatcherAt(passport: Buffer, offset: number): boolean {
  for (let i = 0; i < EYE_CATCHER.length; i++) {
    if (passport[offset + i] !== EYE_CATCHER[i]) return false;
  }
  return true;
}

/**
 * Why a passport is refused before anything is sent, or `undefined` when it
 * describes itself correctly: `*TH*` at its start, its own length declared at
 * bytes 5-6 (unsigned 16-bit, big-endian), `*TH*` in its last 4 bytes. The
 * system ignores a passport whose declared length is wrong without a word, so
 * the check is made here. Nothing else of the passport is read.
 */
function passportFault(passport: Buffer): string | undefined {
  if (passport.length === 0) return 'The passport is empty';
  if (passport.length < 7) {
    return `The passport is ${passport.length} bytes, shorter than 7: it cannot hold the eye catcher *TH* and its declared length`;
  }
  if (!hasEyeCatcherAt(passport, 0)) {
    return 'The passport does not start with the eye catcher *TH*';
  }
  const declared = passport.readUInt16BE(5);
  if (declared !== passport.length) {
    return `The passport declares ${declared} bytes at bytes 5-6 but is ${passport.length} bytes long`;
  }
  if (!hasEyeCatcherAt(passport, passport.length - 4)) {
    return 'The passport does not end with the eye catcher *TH*';
  }
  return undefined;
}

export class Client {
  private __client: RfcClientBinding;

  constructor(connectionParameters: RfcConnectionParameters) {
    if (!connectionParameters || typeof connectionParameters !== 'object') {
      throw new TypeError(
        'Client constructor requires connection parameters object',
      );
    }
    this.__client = new binding.Client(connectionParameters);
  }

  get id(): number {
    return this.__client._id;
  }

  get alive(): boolean {
    return this.__client._alive;
  }

  open(): Promise<this> {
    return new Promise((resolve, reject) => {
      try {
        this.__client.open((err: unknown) => {
          if (err !== undefined) {
            reject(err);
          } else {
            resolve(this);
          }
        });
      } catch (ex) {
        reject(ex);
      }
    });
  }

  close(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.__client.close((err: unknown) => {
          if (err === undefined) {
            resolve();
          } else {
            reject(err);
          }
        });
      } catch (ex) {
        reject(ex);
      }
    });
  }

  /**
   * Resets the ABAP session context this connection holds and keeps the
   * connection open (`RfcResetServerContext`). The next call runs in a fresh
   * context without a new logon. Whatever the context held is gone, including
   * enqueue locks and program buffers.
   */
  resetServerContext(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.__client.resetServerContext((err: unknown) => {
          if (err === undefined) resolve();
          else reject(err);
        });
      } catch (ex) {
        reject(ex);
      }
    });
  }

  /**
   * Invokes a remote function module. `options.passport`, when given, is sent
   * with this call only; without it no passport is sent. A passport that does
   * not describe itself correctly (see `passportFault`) is refused with a
   * `TypeError` before anything is sent.
   */
  call(
    rfmName: string,
    rfmParams: RfcObject = {},
    options: RfcCallOptions = {},
  ): Promise<RfcObject> {
    return new Promise((resolve, reject) => {
      if (typeof rfmName !== 'string' || rfmName.length === 0) {
        reject(
          new TypeError('Function module name must be a non-empty string'),
        );
        return;
      }
      const callback = (err: unknown, res: RfcObject) => {
        if (err !== undefined && err !== null) {
          reject(err);
        } else {
          resolve(res);
        }
      };
      const { passport } = options;
      if (passport !== undefined) {
        const fault = passportFault(passport);
        if (fault !== undefined) {
          reject(new TypeError(fault));
          return;
        }
      }
      try {
        if (passport === undefined) {
          this.__client.invoke(rfmName, rfmParams, callback);
        } else {
          this.__client.invoke(rfmName, rfmParams, callback, { passport });
        }
      } catch (ex) {
        reject(ex);
      }
    });
  }
}

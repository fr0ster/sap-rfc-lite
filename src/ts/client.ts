// SPDX-FileCopyrightText: 2026 sap-rfc-lite contributors
// SPDX-License-Identifier: Apache-2.0

import { binding, type RfcClientBinding } from './binding';
import type { RfcConnectionParameters, RfcObject } from './types';

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

  call(rfmName: string, rfmParams: RfcObject = {}): Promise<RfcObject> {
    return new Promise((resolve, reject) => {
      if (typeof rfmName !== 'string' || rfmName.length === 0) {
        reject(
          new TypeError('Function module name must be a non-empty string'),
        );
        return;
      }
      try {
        this.__client.invoke(
          rfmName,
          rfmParams,
          (err: unknown, res: RfcObject) => {
            if (err !== undefined && err !== null) {
              reject(err);
            } else {
              resolve(res);
            }
          },
        );
      } catch (ex) {
        reject(ex);
      }
    });
  }
}

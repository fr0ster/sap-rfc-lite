// SPDX-FileCopyrightText: 2026 sap-rfc-lite contributors
// SPDX-License-Identifier: Apache-2.0

import path from 'path';
import { RfcConnectionParameters, RfcObject, RfcSdkVersions } from './types';

export interface RfcClientBinding {
  new (connectionParameters: RfcConnectionParameters): RfcClientBinding;
  _id: number;
  _alive: boolean;
  open(callback: Function): void;
  close(callback: Function): void;
  invoke(
    rfmName: string,
    rfmParams: RfcObject,
    callback: Function,
    callOptions?: object
  ): void;
}

export interface NativeBinding {
  Client: RfcClientBinding;
  bindingVersions: RfcSdkVersions;
}

let binding: NativeBinding;

try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  binding = require('node-gyp-build')(
    path.resolve(__dirname, '..')
  ) as NativeBinding;
} catch (ex) {
  const err = ex as Error;
  const env = {
    SAPNWRFC_HOME: process.env.SAPNWRFC_HOME || '(not set)',
    platform: process.platform,
    arch: process.arch,
    node: process.version,
  };
  err.message += `\nEnvironment: ${JSON.stringify(env, null, 2)}`;
  throw err;
}

export { binding };

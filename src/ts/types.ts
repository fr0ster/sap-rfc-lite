// SPDX-FileCopyrightText: 2026 sap-rfc-lite contributors
// SPDX-License-Identifier: Apache-2.0

// Connection parameters — same keys as SAP NW RFC SDK
export type RfcConnectionParameters = Record<string, string>;

// RFC data types
export type RfcVariable = string | number | Buffer;
export type RfcStructure = { [key: string]: RfcVariable | RfcStructure | RfcTable };
export type RfcTable = Array<RfcVariable | RfcStructure>;
export type RfcParameterValue = RfcVariable | RfcStructure | RfcTable;
export type RfcObject = { [key: string]: RfcParameterValue };

// Binding versions
export interface RfcSdkVersions {
  version: string;
  nwrfcsdk: { major: number; minor: number; patchLevel: number };
}

// Error types
export interface RfcLibError {
  name: 'RfcLibError';
  group: number;
  code: number;
  codeString: string;
  key: string;
  message: string;
}

export interface AbapError {
  name: 'ABAPError';
  group: number;
  code: number;
  codeString: string;
  key: string;
  message: string;
  abapMsgClass: string;
  abapMsgType: string;
  abapMsgNumber: string;
  abapMsgV1: string;
  abapMsgV2: string;
  abapMsgV3: string;
  abapMsgV4: string;
}

export interface NodeRfcError {
  name: 'nodeRfcError';
  message: string;
}

export type RfcError = RfcLibError | AbapError | NodeRfcError;

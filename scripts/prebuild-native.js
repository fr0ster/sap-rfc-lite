// SPDX-FileCopyrightText: 2026 sap-rfc-lite contributors
// SPDX-License-Identifier: Apache-2.0
'use strict';
/*
 * `npm run prebuild:native`: build the prebuilt binding for this platform and
 * architecture with prebuildify, then record it (prebuild-record.js).
 *
 * SAP_RFC_LITE_PREBUILD=1 tells binding.gyp the binding is to be shipped, so
 * it carries no path of this machine: no rpath to this machine's SDK
 * directory, no absolute PDB path. A build on the user's own machine (install,
 * `node-gyp rebuild`) keeps its rpath to the user's SDK, as before.
 * prebuild-record.js refuses a binding that still holds this machine's home
 * directory or SDK path.
 */
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const env = { ...process.env, SAP_RFC_LITE_PREBUILD: '1' };

function run(args) {
  const result = spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit', env });
  if (result.status !== 0) process.exit(result.status === null ? 1 : result.status);
}

run([require.resolve('prebuildify/bin.js'), '--napi', '--strip', '--tag-libc']);
run([path.join(__dirname, 'prebuild-record.js')]);

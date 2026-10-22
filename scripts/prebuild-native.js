// SPDX-FileCopyrightText: 2026 sap-rfc-lite contributors
// SPDX-License-Identifier: Apache-2.0
'use strict';
/*
 * `npm run prebuild:native`: build the prebuilt binding for this platform and
 * architecture with prebuildify, then record it (prebuild-record.js).
 *
 * SAP_RFC_LITE_PREBUILD=1 tells binding.gyp the binding is to be shipped, so
 * it carries no path of this machine: no rpath to this machine's SDK
 * directory, no absolute PDB path. A build on the user's own machine (`npm run
 * build:cpp`, i.e. `node-gyp rebuild`) keeps its rpath to the user's SDK, as before.
 * prebuild-record.js refuses a binding that still holds this machine's home
 * directory or SDK path.
 */
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const env = { ...process.env, SAP_RFC_LITE_PREBUILD: '1' };
// macOS strips DYLD_* from anything started through a protected program
// (`npm run` goes through /bin/sh), so an exported DYLD_LIBRARY_PATH never
// reaches the record step, and the SDK's libraries (install name
// @loader_path/…) cannot be loaded to read their version. The children here
// are started from node directly, so the variable set here reaches them.
const sdkHome = process.env.SAPNWRFC_HOME || process.env.SAPNWRFC_HOME_CLOUD;
if (process.platform === 'darwin' && sdkHome) {
  const lib = path.join(sdkHome, 'lib');
  env.DYLD_LIBRARY_PATH = env.DYLD_LIBRARY_PATH ? `${lib}:${env.DYLD_LIBRARY_PATH}` : lib;
}

function run(args) {
  const result = spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit', env });
  if (result.status !== 0) process.exit(result.status === null ? 1 : result.status);
}

// The libc tag only means something on Linux: prebuildify 6 tags `glibc` on any
// OS when asked, and a darwin or win32 binding must keep its plain name.
const tags = process.platform === 'linux' ? ['--tag-libc'] : [];
run([require.resolve('prebuildify/bin.js'), '--napi', '--strip', ...tags]);
run([path.join(__dirname, 'prebuild-record.js')]);

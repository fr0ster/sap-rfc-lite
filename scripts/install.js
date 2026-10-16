// SPDX-FileCopyrightText: 2026 sap-rfc-lite contributors
// SPDX-License-Identifier: Apache-2.0
'use strict';
/*
 * Install: use the prebuilt binding when the package carries one for this
 * platform and architecture, and compile only when it does not.
 *
 * `node-gyp-build`'s own install step decides by LOADING the prebuild. Loading
 * needs the SAP NW RFC SDK's libraries on the library path, which is a runtime
 * requirement, not an install-time one. Without them at `npm install`, the load
 * fails, the step falls back to compiling, the compile fails where there is no
 * C++ toolchain, and npm then drops this optional dependency silently. So the
 * decision here is made by the file's presence. Whether it loads is answered at
 * run time, where `binding.ts` names the SDK in its error.
 *
 * `npm_config_build_from_source=true` (`npm install --build-from-source`)
 * still forces a compile.
 */
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const dir = path.join(root, 'prebuilds', `${process.platform}-${process.arch}`);
// The Linux prebuilds link against glibc (tagged `.glibc.` by prebuildify
// --tag-libc, which node-gyp-build honours at run time). On musl (Alpine) none
// of them can load, so compile there.
const glibc =
  process.platform !== 'linux' ||
  Boolean(process.report?.getReport?.().header?.glibcVersionRuntime);
const usable = (f) =>
  f.endsWith('.node') && (process.platform !== 'linux' || f.includes('.glibc.'));
const prebuilt =
  glibc && fs.existsSync(dir) && fs.readdirSync(dir).some(usable);
const fromSource = /^(1|true)$/i.test(
  process.env.npm_config_build_from_source || '',
);

if (prebuilt && !fromSource) {
  process.stdout.write(
    `sap-rfc-lite: using the prebuilt binding for ${process.platform}-${process.arch}; ` +
      'the SAP NW RFC SDK libraries must be on the library path at run time.\n',
  );
  process.exit(0);
}

// node-gyp-build itself recognises only the exact value "true".
const env = fromSource
  ? { ...process.env, npm_config_build_from_source: 'true' }
  : process.env;
const result = spawnSync(
  process.execPath,
  [require.resolve('node-gyp-build/bin.js')],
  { cwd: root, stdio: 'inherit', env },
);
process.exit(result.status === null ? 1 : result.status);

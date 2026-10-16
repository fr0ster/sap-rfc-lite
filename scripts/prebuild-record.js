// SPDX-FileCopyrightText: 2026 sap-rfc-lite contributors
// SPDX-License-Identifier: Apache-2.0
'use strict';
/*
 * After `prebuildify`: write prebuilds/<platform>-<arch>/BUILD.json with what
 * the binding was built from (see prebuild-source.js) and the SDK it was built
 * against, read from the binding itself when it loads on this machine.
 */
const fs = require('node:fs');
const path = require('node:path');
const { sourceHash } = require('./prebuild-source');

const root = path.join(__dirname, '..');
const target = `${process.platform}-${process.arch}`;
const dir = path.join(root, 'prebuilds', target);
const binary = fs.existsSync(dir) && fs.readdirSync(dir).find((f) => f.endsWith('.node'));
if (!binary) {
  process.stderr.write(`sap-rfc-lite: no prebuilt binding in prebuilds/${target}; run prebuildify first.\n`);
  process.exit(1);
}
let sdk = null;
try {
  const versions = require(path.join(dir, binary)).bindingVersions;
  sdk = versions && versions.nwrfcsdk ? versions.nwrfcsdk : null;
} catch (error) {
  process.stderr.write(
    `sap-rfc-lite: the binding was built but does not load here (${error.message.split('\n')[0]}); ` +
      'the SDK version is not recorded. Put the SDK lib directory on the library path to record it.\n',
  );
}
const info = { target, binary, ...sourceHash(), sdk, builtAt: new Date().toISOString().slice(0, 10) };
fs.writeFileSync(path.join(dir, 'BUILD.json'), `${JSON.stringify(info, null, 2)}\n`);
process.stdout.write(`sap-rfc-lite: recorded prebuilds/${target}/BUILD.json\n`);

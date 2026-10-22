// SPDX-FileCopyrightText: 2026 sap-rfc-lite contributors
// SPDX-License-Identifier: Apache-2.0
'use strict';
/*
 * After `prebuildify`: write prebuilds/<platform>-<arch>/BUILD.json with what
 * the binding was built from (see prebuild-source.js) and the SDK it was built
 * against, read from the binding itself when it loads on this machine.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { sourceHash } = require('./prebuild-source');

const root = path.join(__dirname, '..');
const target = `${process.platform}-${process.arch}`;
const dir = path.join(root, 'prebuilds', target);
const bindings = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.node')) : [];
if (bindings.length === 0) {
  process.stderr.write(`sap-rfc-lite: no prebuilt binding in prebuilds/${target}; run prebuildify first.\n`);
  process.exit(1);
}
// One binding per target: a second file (an old one left beside a new build
// under another name) would ship unchecked.
if (bindings.length > 1) {
  process.stderr.write(
    `sap-rfc-lite: prebuilds/${target} holds ${bindings.length} bindings (${bindings.join(', ')}); keep only the new one.\n`,
  );
  process.exit(1);
}
const binary = bindings[0];
// A binding to ship holds no path of the machine it was built on (binding.gyp,
// `prebuild`): neither the home directory (an rpath, a PDB path) nor the SDK
// directory it was linked against.
const bytes = fs.readFileSync(path.join(dir, binary));
const sdkHome = process.env.SAPNWRFC_HOME || process.env.SAPNWRFC_HOME_CLOUD;
const local = [os.homedir(), sdkHome && path.resolve(sdkHome)].filter(Boolean);
const leaked = local.filter((p) =>
  [p, p.split(path.sep).join('/')].some(
    (form) => bytes.includes(Buffer.from(form, 'utf8')) || bytes.includes(Buffer.from(form, 'utf16le')),
  ),
);
if (leaked.length) {
  process.stderr.write(
    `sap-rfc-lite: prebuilds/${target}/${binary} holds a path of this machine (${leaked.join(', ')}); ` +
      'it was not built by `npm run prebuild:native`, or binding.gyp embeds the path again. Not recorded.\n',
  );
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

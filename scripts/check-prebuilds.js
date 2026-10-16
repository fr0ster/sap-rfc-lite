// SPDX-FileCopyrightText: 2026 sap-rfc-lite contributors
// SPDX-License-Identifier: Apache-2.0
'use strict';
/*
 * Before publishing: every target in package.json `prebuildTargets` must have
 * its prebuilt binding under prebuilds/<platform>-<arch>/. A package published
 * without one would quietly compile on that platform again, which is the
 * situation the prebuilds exist to remove.
 */
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const targets = require(path.join(root, 'package.json')).prebuildTargets || [];
const missing = targets.filter((target) => {
  const dir = path.join(root, 'prebuilds', target);
  return !(
    fs.existsSync(dir) && fs.readdirSync(dir).some((f) => f.endsWith('.node'))
  );
});
if (missing.length) {
  process.stderr.write(
    `sap-rfc-lite: no prebuilt binding for ${missing.join(', ')}. Build each one on its own ` +
      'platform with the SAP NW RFC SDK (`npm run prebuild:native`) and copy its ' +
      'prebuilds/<platform>-<arch>/ folder here before publishing.\n',
  );
  process.exit(1);
}
process.stdout.write(`sap-rfc-lite: prebuilt bindings present for ${targets.join(', ')}.\n`);

// SPDX-FileCopyrightText: 2026 sap-rfc-lite contributors
// SPDX-License-Identifier: Apache-2.0
'use strict';
/*
 * Before publishing: every target in package.json `prebuildTargets` must have
 * its prebuilt binding under prebuilds/<platform>-<arch>/, built from the
 * current C++ sources (BUILD.json's sourceHash, see prebuild-source.js). A
 * package published without one would compile on that platform again; one
 * built from older sources would ship a binding that is not this code.
 */
const fs = require('node:fs');
const path = require('node:path');
const { sourceHash } = require('./prebuild-source');

const root = path.join(__dirname, '..');
const targets = require(path.join(root, 'package.json')).prebuildTargets || [];
const current = sourceHash().sourceHash;
const problems = [];
for (const target of targets) {
  const dir = path.join(root, 'prebuilds', target);
  const bindings = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.node')) : [];
  if (bindings.length === 0) { problems.push(`${target}: no prebuilt binding`); continue; }
  if (bindings.length > 1) { problems.push(`${target}: ${bindings.length} bindings (${bindings.join(', ')}), one expected`); continue; }
  let info = null;
  try { info = JSON.parse(fs.readFileSync(path.join(dir, 'BUILD.json'), 'utf8')); } catch (_) { /* reported below */ }
  if (!info) { problems.push(`${target}: no BUILD.json`); continue; }
  if (info.sourceHash !== current) problems.push(`${target}: built from other C++ sources than these (rebuild it)`);
}
if (problems.length) {
  process.stderr.write(
    `sap-rfc-lite: prebuilt bindings are not ready:\n  ${problems.join('\n  ')}\n` +
      'Build each one on its own platform with the SAP NW RFC SDK (`npm run prebuild:native`) and commit prebuilds/<platform>-<arch>/.\n',
  );
  process.exit(1);
}
process.stdout.write(`sap-rfc-lite: prebuilt bindings present and current for ${targets.join(', ')}.\n`);

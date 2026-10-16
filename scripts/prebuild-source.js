// SPDX-FileCopyrightText: 2026 sap-rfc-lite contributors
// SPDX-License-Identifier: Apache-2.0
'use strict';
/*
 * What a prebuilt binding is built from: the C++ sources, binding.gyp and the
 * node-addon-api version. A change in any of them means every prebuild must be
 * built again; check-prebuilds.js compares this hash with each BUILD.json.
 */
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

function files(dir) {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((e) =>
      e.isDirectory() ? files(path.join(dir, e.name)) : [path.join(dir, e.name)],
    );
}

function sourceHash() {
  const hash = crypto.createHash('sha256');
  const inputs = [
    ...files(path.join(root, 'src', 'cpp')),
    path.join(root, 'binding.gyp'),
  ].sort();
  for (const file of inputs) {
    hash.update(path.relative(root, file).split(path.sep).join('/'));
    hash.update('\0');
    hash.update(fs.readFileSync(file).toString('utf8').replace(/\r\n/g, '\n'));
    hash.update('\0');
  }
  const addonApi = require(path.join(root, 'node_modules', 'node-addon-api', 'package.json')).version;
  hash.update(`node-addon-api@${addonApi}`);
  return { sourceHash: hash.digest('hex'), nodeAddonApi: addonApi };
}

module.exports = { sourceHash };

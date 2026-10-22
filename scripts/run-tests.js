// SPDX-FileCopyrightText: 2026 sap-rfc-lite contributors
// SPDX-License-Identifier: Apache-2.0
'use strict';
/*
 * `npm test`: compile src/ts and test/ with tsc (tsconfig.test.json) into
 * .test-build/, then run every compiled test/*.test.js with Node's own test
 * runner (node:test). No test framework is installed: fewer dependencies,
 * fewer install scripts.
 *
 * The files are listed here, not passed as a directory or glob: `node --test`
 * reads its arguments differently across the supported Node.js lines.
 */
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const out = path.join(root, '.test-build');

function run(args) {
  const result = spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status === null ? 1 : result.status);
}

fs.rmSync(out, { recursive: true, force: true });
// typescript's `exports` do not expose its bin, so it is found through its
// package.json (the same file `npm run` would link as `tsc`).
const tsDir = path.dirname(require.resolve('typescript/package.json'));
const tsBin = require('typescript/package.json').bin.tsc;
run([path.join(tsDir, tsBin), '-p', 'tsconfig.test.json']);

const dir = path.join(out, 'test');
const files = fs
  .readdirSync(dir)
  .filter((f) => f.endsWith('.test.js'))
  .sort()
  .map((f) => path.join(dir, f));
if (files.length === 0) {
  process.stderr.write('sap-rfc-lite: no compiled tests found in .test-build/test\n');
  process.exit(1);
}
run(['--test', ...files]);

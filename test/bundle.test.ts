// SPDX-FileCopyrightText: 2026 sap-rfc-lite contributors
// SPDX-License-Identifier: Apache-2.0

// The package version must survive bundling. A consumer that bundles the
// package (esbuild, then a Node single-executable application) has no
// package.json next to the code at run time; a version read through a path
// computed at run time throws there, and with it every RFC call.
//
// This runs what such a consumer runs: binding.ts compiled to lib/binding.js
// in the package's own layout, bundled by esbuild, then executed from a
// directory holding no package.json, with node-gyp-build replaced by a stub
// (no native addon, no SDK needed).

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, it } from 'node:test';
import { buildSync } from 'esbuild';

// Compiled by `npm test` (tsc -p tsconfig.test.json, the package's own
// compiler options) to .test-build/test/; the repository root is two up.
const root = path.join(__dirname, '..', '..');
const compiled = path.join(__dirname, '..', 'src', 'ts', 'binding.js');
const pkg = JSON.parse(
  fs.readFileSync(path.join(root, 'package.json'), 'utf8'),
) as { version: string };

let work: string;

beforeEach(() => {
  work = fs.mkdtempSync(path.join(os.tmpdir(), 'sap-rfc-lite-bundle-'));
});

afterEach(() => {
  fs.rmSync(work, { recursive: true, force: true });
});

function compileBinding(packageDir: string): string {
  // The package's layout: <package>/lib/binding.js beside <package>/package.json,
  // lib/binding.js being what tsc emits for src/ts/binding.ts.
  fs.mkdirSync(path.join(packageDir, 'lib'), { recursive: true });
  fs.copyFileSync(
    path.join(root, 'package.json'),
    path.join(packageDir, 'package.json'),
  );
  const entry = path.join(packageDir, 'lib', 'binding.js');
  fs.copyFileSync(compiled, entry);
  return entry;
}

it('bundles lib/binding.js with the package version inlined', () => {
  const entry = compileBinding(path.join(work, 'package'));

  const result = buildSync({
    entryPoints: [entry],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    external: ['node-gyp-build'],
    write: false,
    logLevel: 'silent',
  });
  const text = result.outputFiles[0]?.text ?? '';

  // Run the bundle where no package.json exists, as a single-executable
  // application does. node-gyp-build is a stub answering a fake addon.
  const run = path.join(work, 'run');
  const stub = path.join(run, 'node_modules', 'node-gyp-build');
  fs.mkdirSync(stub, { recursive: true });
  fs.writeFileSync(
    path.join(stub, 'index.js'),
    "module.exports = () => ({ Client: function Client() {}, bindingVersions: Object.freeze({ version: 'built-for-another-release', nwrfcsdk: { major: 7500, minor: 0, patchLevel: 0 } }) });\n",
  );
  fs.writeFileSync(path.join(run, 'bundle.js'), text);
  fs.rmSync(path.join(work, 'package'), { recursive: true, force: true });

  const child = spawnSync(
    process.execPath,
    [
      '-e',
      "const { binding } = require('./bundle.js'); process.stdout.write(JSON.stringify(binding.bindingVersions));",
    ],
    { cwd: run, encoding: 'utf8' },
  );
  assert.equal(child.stderr, '');
  assert.equal(child.status, 0);
  assert.deepEqual(JSON.parse(child.stdout), {
    version: pkg.version,
    nwrfcsdk: { major: 7500, minor: 0, patchLevel: 0 },
  });
});

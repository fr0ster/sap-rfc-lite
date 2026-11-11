// SPDX-FileCopyrightText: 2026 sap-rfc-lite contributors
// SPDX-License-Identifier: Apache-2.0

// The published package must carry no binding.gyp. npm adds an implicit
// `node-gyp rebuild` install script to any package that holds one, and
// `npm ci` does so even with `"gypfile": false` in package.json (measured
// with npm 11.19.0 on 0.3.1): the consumer then compiles, or, without the
// SDK, fails the install. The C++ sources are left out with it: a source
// build runs from a clone of the repository (README, "Installation").

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { it } from 'node:test';

const root = path.join(__dirname, '..', '..');

interface PackResult {
  files: { path: string }[];
}

function packedFiles(): string[] {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const result = spawnSync(
    npm,
    ['pack', '--dry-run', '--json', '--ignore-scripts'],
    { cwd: root, encoding: 'utf8', shell: process.platform === 'win32' },
  );
  assert.equal(result.status, 0, result.stderr);
  const [packed]: PackResult[] = JSON.parse(result.stdout);
  assert.ok(packed);
  return packed.files.map((f) => f.path);
}

it('the packed file list holds no binding.gyp and no C++ sources', () => {
  const files = packedFiles();
  assert.ok(files.length > 0);
  assert.deepEqual(
    files.filter(
      (f) => f === 'binding.gyp' || f.endsWith('.gyp') || f.startsWith('src/'),
    ),
    [],
  );
  assert.ok(files.some((f) => f.startsWith('prebuilds/')));
});

// The test-only addon (test/native/: its binding.gyp, its shim, its build) is
// never shipped.
it('the packed file list holds nothing under test/', () => {
  assert.deepEqual(
    packedFiles().filter((f) => f.startsWith('test/')),
    [],
  );
});

it('prebuilds/ holds one binding per target', () => {
  const pkg: { prebuildTargets: string[] } = JSON.parse(
    fs.readFileSync(path.join(root, 'package.json'), 'utf8'),
  );
  const packed = packedFiles();
  for (const target of pkg.prebuildTargets) {
    const bindings = packed.filter(
      (f) => f.startsWith(`prebuilds/${target}/`) && f.endsWith('.node'),
    );
    assert.equal(bindings.length, 1, target);
  }
});

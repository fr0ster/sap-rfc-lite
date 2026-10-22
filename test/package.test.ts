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
import path from 'node:path';
import { it } from 'node:test';

const root = path.join(__dirname, '..', '..');

it('the packed file list holds no binding.gyp and no C++ sources', () => {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const result = spawnSync(
    npm,
    ['pack', '--dry-run', '--json', '--ignore-scripts'],
    { cwd: root, encoding: 'utf8', shell: process.platform === 'win32' },
  );
  assert.equal(result.status, 0, result.stderr);
  const [packed] = JSON.parse(result.stdout) as [{ files: { path: string }[] }];
  const files = packed.files.map((f) => f.path);
  assert.ok(files.length > 0);
  assert.deepEqual(
    files.filter(
      (f) => f === 'binding.gyp' || f.endsWith('.gyp') || f.startsWith('src/'),
    ),
    [],
  );
  assert.ok(files.some((f) => f.startsWith('prebuilds/')));
});

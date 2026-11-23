// SPDX-FileCopyrightText: 2026 sap-rfc-lite contributors
// SPDX-License-Identifier: Apache-2.0

// The shipped Client (src/cpp/Client.cc) over the test addon's fake connection
// (test/native/shim.cc, Linux and macOS): one operation at a time per client,
// the hold released on every completion path, the function handle destroyed on
// every path, and the client kept alive while its operations run. Every case
// that would hang if the hold were not released is bounded by node:test's own
// per-test timeout; the product has none. This file also runs itself once more
// with UV_THREADPOOL_SIZE=1. CI builds no C++: without the test addon this
// suite skips, its reason in the title.

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import v8 from 'node:v8';
import vm from 'node:vm';

/** The native client, as the shim exports it. */
interface NativeClient {
  open(callback: (error: unknown) => void): void;
  invoke(
    name: string,
    params: object,
    callback: (error: unknown, result?: unknown) => void,
  ): void;
}

interface FakeStats {
  invokesMax: number;
  invokesEntered: number;
  functionsCreated: number;
  functionsDestroyed: number;
}

interface TestAddon {
  Client?: new (params: object, options?: object) => NativeClient;
  fake?: {
    reset(): void;
    openGate(): void;
    stats(): FakeStats;
    waiting(client: NativeClient): number;
  };
}

// Compiled to .test-build/test/; the repository root is two up.
const addonPath = path.join(
  __dirname,
  '..',
  '..',
  'test',
  'native',
  'build',
  'Release',
  'rfc_lite_test.node',
);
const addon: TestAddon | undefined = fs.existsSync(addonPath)
  ? require(addonPath)
  : undefined;
const NativeClientClass = addon?.Client;
const fake = addon?.fake;
const ready = NativeClientClass !== undefined && fake !== undefined;

const poolSize = Number(process.env.UV_THREADPOOL_SIZE ?? '4');
const title = ready
  ? `the client's invocation hold over a fake connection (thread pool ${poolSize})`
  : "the client's invocation hold — skipped: the test addon is not built or has no fake connection (npm run build:test-native, needs the SDK; Linux and macOS)";

// ES2021, beyond the ES2020 library this repository compiles against.
declare const FinalizationRegistry: new <T>(
  cleanup: (held: T) => void,
) => { register(target: object, held: T): void };

// The runner's bound for a case that would otherwise hang.
const bounded = { timeout: 10_000 };

function gc(): void {
  v8.setFlagsFromString('--expose-gc');
  const collect: () => void = vm.runInNewContext('gc');
  collect();
}

function turn(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

/**
 * A callback and the promise it settles, made in a scope that holds no client:
 * the worker keeps the callback, and must be what keeps the client alive.
 */
function answer(): {
  callback: (error: unknown, result?: unknown) => void;
  promise: Promise<unknown>;
} {
  let settle: (error: unknown, result?: unknown) => void = () => {};
  const promise = new Promise<unknown>((resolve, reject) => {
    settle = (error, result) => {
      if (error !== undefined && error !== null) reject(error);
      else resolve(result);
    };
  });
  return { callback: (error, result) => settle(error, result), promise };
}

function open(client: NativeClient): Promise<unknown> {
  const { callback, promise } = answer();
  client.open(callback);
  return promise;
}

function invoke(
  client: NativeClient,
  name: string,
  params: object = {},
): Promise<unknown> {
  const { callback, promise } = answer();
  client.invoke(name, params, callback);
  return promise;
}

function stats(): FakeStats {
  if (!fake) throw new Error('no fake connection');
  return fake.stats();
}

async function openClient(options?: object): Promise<NativeClient> {
  if (!NativeClientClass) throw new Error('no test Client');
  const client = new NativeClientClass({ dest: 'FAKE' }, options);
  await open(client);
  return client;
}

describe(title, { skip: !ready }, () => {
  it(
    'a second call on one client waits in its hold while the first is in RfcInvoke, and both complete',
    { ...bounded, skip: poolSize < 2 && 'needs two pool threads' },
    async () => {
      fake?.reset();
      const client = await openClient();
      const first = invoke(client, 'Z_GATE');
      const second = invoke(client, 'Z_GATE');
      try {
        // Until one call is in RfcInvoke and the other waits for the hold, or
        // (were there no hold) is in RfcInvoke too.
        while (
          stats().invokesEntered < 1 ||
          ((fake?.waiting(client) ?? 0) < 1 && stats().invokesEntered < 2)
        ) {
          await turn();
        }
        assert.equal(
          stats().invokesMax,
          1,
          'never two calls in RfcInvoke at once',
        );
      } finally {
        fake?.openGate();
      }
      await Promise.all([first, second]);
      assert.equal(stats().invokesEntered, 2);
      assert.equal(stats().invokesMax, 1, 'never two calls in RfcInvoke at once');
    },
  );

  it('eight overlapping calls on one client all answer', bounded, async () => {
    fake?.reset();
    const client = await openClient();
    const before = stats();
    await Promise.all(
      Array.from({ length: 8 }, () => invoke(client, 'Z_OK')),
    );
    const after = stats();
    assert.equal(after.invokesEntered, 8);
    assert.equal(after.invokesMax, 1);
    assert.equal(
      after.functionsCreated - before.functionsCreated,
      after.functionsDestroyed - before.functionsDestroyed,
      'every function handle destroyed',
    );
  });

  it("a call whose worker's Execute throws rejects, and the next call on the client proceeds", bounded, async () => {
    fake?.reset();
    const client = await openClient();
    await assert.rejects(invoke(client, 'Z_THROW'), {
      message: 'the fake RfcInvoke threw',
    });
    await invoke(client, 'Z_OK');
  });

  it('a throw while the result is converted rejects the call, destroys its function handle and releases the hold', bounded, async () => {
    fake?.reset();
    const client = await openClient({
      bcd: () => {
        throw new Error('the transformer refused');
      },
    });
    const before = stats();
    await assert.rejects(invoke(client, 'Z_BCD'), {
      message: 'the transformer refused',
    });
    const after = stats();
    assert.equal(after.functionsCreated - before.functionsCreated, 1);
    assert.equal(after.functionsDestroyed - before.functionsDestroyed, 1);
    await invoke(client, 'Z_OK');
  });

  it('a call refused while its parameters are set destroys its function handle', bounded, async () => {
    fake?.reset();
    const client = await openClient();
    const before = stats();
    await assert.rejects(invoke(client, 'Z_OK', { NO_SUCH_PARAMETER: 1 }));
    const after = stats();
    assert.equal(after.functionsCreated - before.functionsCreated, 1);
    assert.equal(after.functionsDestroyed - before.functionsDestroyed, 1);
    await invoke(client, 'Z_OK');
  });

  it('a client dropped while its call runs is not collected before the call has answered', bounded, async () => {
    fake?.reset();
    const collected: string[] = [];
    const registry = new FinalizationRegistry<string>((tag) => {
      collected.push(tag);
    });
    // The client is reachable only from inside this function.
    async function dropped(): Promise<{ pending: Promise<unknown> }> {
      const client = await openClient();
      registry.register(client, 'client');
      return { pending: invoke(client, 'Z_GATE') };
    }
    const { pending } = await dropped();
    try {
      for (let i = 0; i < 20; i++) {
        gc();
        await turn();
      }
      assert.deepEqual(
        collected,
        [],
        'the client was collected while its call ran',
      );
    } finally {
      fake?.openGate();
    }
    await pending;
  });

  it(
    'the same cases with one pool thread (UV_THREADPOOL_SIZE=1)',
    { timeout: 60_000, skip: poolSize === 1 && 'this is that run' },
    async (t) => {
      const env: NodeJS.ProcessEnv = { ...process.env, UV_THREADPOOL_SIZE: '1' };
      delete env.NODE_TEST_CONTEXT;
      // The runner's timeout aborts t.signal, which ends the child.
      const child = spawn(process.execPath, [__filename], {
        env,
        signal: t.signal,
      });
      let output = '';
      child.stdout.on('data', (chunk) => {
        output += chunk;
      });
      child.stderr.on('data', (chunk) => {
        output += chunk;
      });
      child.on('error', () => {});
      const code = await new Promise<number | null>((resolve) =>
        child.on('close', resolve),
      );
      assert.equal(code, 0, output);
      assert.match(output, /thread pool 1/);
    },
  );
});

// SPDX-FileCopyrightText: 2026 sap-rfc-lite contributors
// SPDX-License-Identifier: Apache-2.0

// The per-client invocation hold. These cases hang if the hold is not
// released, so they never run in the runner's own process. This file runs
// itself as a child process, once with the default thread pool (4) and once
// with UV_THREADPOOL_SIZE=1. Each child is bounded by its parent test's
// node:test timeout, whose abort kills the child, so a worker blocked for good
// cannot keep a process alive. Inside the child every case has its own
// node:test timeout too. The product has no timeout.
//
// Cases:
// - The hold itself, through the shim's workers (test/native/shim.cc).
// - The shipped Client (src/cpp/Client.cc) over the test addon's fake
//   connection (Linux and macOS): the hold released on every completion path,
//   the function handle destroyed on every path, a throw never answered as
//   success, the client kept alive while its operations run.
// - The shipped addon, unopened.
//
// CI builds no C++: without the test addon these cases skip, the reason in the
// title.

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

/** An opaque handle to one hold made by the shim. */
type HoldState = { readonly hold: unique symbol };

/** What the shim's workers on one hold saw. */
interface HoldSeen {
  /** The most workers that held it at once. */
  maxHolders: number;
  /** Whether a worker found another waiting for the hold while it held it. */
  sawWaiter: boolean;
}

interface TestAddon {
  Client?: new (params: object, options?: object) => NativeClient;
  fake?: {
    reset(): void;
    openGate(): void;
    stats(): FakeStats;
    waiting(client: NativeClient): number;
  };
  holdState?: () => HoldState;
  heldWork?: (
    state: HoldState,
    kind: 'overlap' | 'plain' | 'throws',
    callback: (error: unknown, seen?: HoldSeen) => void,
  ) => void;
}

// Compiled to .test-build/test/; the repository root is two up.
const root = path.join(__dirname, '..', '..');
const addonPath = path.join(
  root,
  'test',
  'native',
  'build',
  'Release',
  'rfc_lite_test.node',
);
const addonBuilt = fs.existsSync(addonPath);
const shippedBuilt =
  fs.existsSync(path.join(root, 'build', 'Release', 'sapnwrfc.node')) &&
  fs.existsSync(path.join(root, 'lib', 'index.js'));

// Set in the child only: the pool size it runs with.
const CHILD = 'SAP_RFC_LITE_HOLD_POOL';
const childPool = process.env[CHILD];

if (childPool === undefined) {
  describe(
    addonBuilt
      ? "the per-client invocation hold, in child processes"
      : 'the per-client invocation hold — skipped: the test addon is not built (npm run build:test-native, needs the SDK)',
    { skip: !addonBuilt },
    () => {
      for (const pool of ['4', '1']) {
        it(
          `with UV_THREADPOOL_SIZE=${pool}`,
          { timeout: 60_000 },
          async (t) => {
            const env: NodeJS.ProcessEnv = {
              ...process.env,
              UV_THREADPOOL_SIZE: pool,
              [CHILD]: pool,
            };
            delete env.NODE_TEST_CONTEXT;
            // The runner's timeout aborts t.signal, which kills the child.
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
            assert.match(output, new RegExp(`thread pool ${pool}\\b`));
          },
        );
      }
    },
  );
} else {
  childCases(Number(childPool));
}

function childCases(poolSize: number): void {
  const addon: TestAddon | undefined = addonBuilt
    ? require(addonPath)
    : undefined;
  const NativeClientClass = addon?.Client;
  const fake = addon?.fake;

  // The runner's bound for a case that would otherwise hang.
  const bounded = { timeout: 10_000 };
  const twoThreads = poolSize < 2 && 'needs two pool threads';

  function turn(): Promise<void> {
    return new Promise((resolve) => setImmediate(resolve));
  }

  function gc(): void {
    v8.setFlagsFromString('--expose-gc');
    const collect: () => void = vm.runInNewContext('gc');
    collect();
  }

  /**
   * A callback and the promise it settles, made in a scope that holds no
   * client: the worker keeps the callback, and must be what keeps the client
   * alive. A null or undefined error is success, as `Client.call` reads it.
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

  describe(`the hold itself, through the shim's workers (thread pool ${poolSize})`, { skip: !addon?.holdState }, () => {
    function hold(): HoldState {
      const make = addon?.holdState;
      if (!make) throw new Error('no holdState');
      return make();
    }
    function work(
      state: HoldState,
      kind: 'overlap' | 'plain' | 'throws',
    ): Promise<HoldSeen> {
      const queue = addon?.heldWork;
      if (!queue) throw new Error('no heldWork');
      return new Promise((resolve, reject) => {
        queue(state, kind, (error, seen) => {
          if (error) reject(error);
          else if (seen) resolve(seen);
          else reject(new Error('the worker answered nothing'));
        });
      });
    }

    it('a second operation on the same hold waits for the first, and both complete', { ...bounded, skip: twoThreads }, async () => {
      const state = hold();
      const [first, second] = await Promise.all([
        work(state, 'overlap'),
        work(state, 'overlap'),
      ]);
      assert.equal(first.maxHolders, 1, 'never two holders at once');
      assert.equal(second.maxHolders, 1, 'never two holders at once');
      assert.equal(second.sawWaiter, true, 'the second one waited');
    });

    it('an operation whose Execute fails releases the hold: the next one proceeds', bounded, async () => {
      const state = hold();
      await assert.rejects(work(state, 'throws'), {
        message: "the test worker's own failure",
      });
      const next = await work(state, 'plain');
      assert.equal(next.maxHolders, 1);
    });
  });

  describe(
    NativeClientClass && fake
      ? `the client over a fake connection (thread pool ${poolSize})`
      : 'the client over a fake connection — skipped: the test addon has no fake connection (Linux and macOS only)',
    { skip: !(NativeClientClass && fake) },
    () => {
      it(
        'a second call on one client waits in its hold while the first is in RfcInvoke, and both complete',
        { ...bounded, skip: twoThreads },
        async (t) => {
          fake?.reset();
          const client = await openClient();
          const first = invoke(client, 'Z_GATE');
          const second = invoke(client, 'Z_GATE');
          try {
            // Until one call is in RfcInvoke and the other waits for the hold,
            // or (were there no hold) is in RfcInvoke too; or the runner's
            // timeout aborts the case.
            while (
              stats().invokesEntered < 1 ||
              ((fake?.waiting(client) ?? 0) < 1 && stats().invokesEntered < 2)
            ) {
              t.signal.throwIfAborted();
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
          assert.equal(
            stats().invokesMax,
            1,
            'never two calls in RfcInvoke at once',
          );
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

      it('a transformer that throws undefined rejects the call; it is never answered as success', bounded, async () => {
        fake?.reset();
        const client = await openClient({
          bcd: () => {
            throw undefined;
          },
        });
        await assert.rejects(invoke(client, 'Z_BCD'), {
          name: 'nodeRfcError',
          message: 'invoke() Z_BCD: a value that is not an Error was thrown',
        });
        await invoke(client, 'Z_OK');
      });

      it('a parameter getter that throws null rejects the call; it is never answered as success', bounded, async () => {
        fake?.reset();
        const client = await openClient();
        const params = {
          get IMPORTING() {
            throw null;
          },
        };
        await assert.rejects(invoke(client, 'Z_OK', params), {
          name: 'nodeRfcError',
          message: 'invoke() Z_OK: a value that is not an Error was thrown',
        });
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

      it('a client dropped while its call runs is not collected before the call has answered', bounded, async (t) => {
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
            t.signal.throwIfAborted();
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
    },
  );

  describe(
    shippedBuilt
      ? `the shipped addon, unopened (thread pool ${poolSize})`
      : 'the shipped addon, unopened — skipped: not built (npm run build, needs the SDK)',
    { skip: !shippedBuilt },
    () => {
      it('overlapping calls on one client all answer, one after another', bounded, async () => {
        const lib: typeof import('../src/ts/index') = require(
          path.join(root, 'lib', 'index.js'),
        );
        const client = new lib.Client({ ashost: '127.0.0.1', sysnr: '00' });
        const closed = (thrown: unknown) => {
          const message =
            typeof thrown === 'object' && thrown !== null
              ? Reflect.get(thrown, 'message')
              : undefined;
          return (
            typeof message === 'string' &&
            message.startsWith(
              'RFM client request over closed connection: invoke() STFC_CONNECTION',
            )
          );
        };
        await Promise.all(
          Array.from({ length: 8 }, () =>
            assert.rejects(client.call('STFC_CONNECTION'), closed),
          ),
        );
      });
    },
  );
}

// ES2021, beyond the ES2020 library this repository compiles against.
declare const FinalizationRegistry: new <T>(
  cleanup: (held: T) => void,
) => { register(target: object, held: T): void };

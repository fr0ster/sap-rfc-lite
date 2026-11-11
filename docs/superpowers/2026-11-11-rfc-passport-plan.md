# Plan: a call that carries the caller's passport, and no silent reconnect

Bound by `2026-11-11-rfc-passport-goal.md` and `2026-11-11-rfc-passport-spec.md` (section
numbers below are the spec's). Branch `feat/rfc-passport`, worktree
`.worktrees/rfc-passport`, one PR for the whole task. Release 0.4.0.

Every step is test first: the test that states the step's rule is written and seen red
for the right reason, then the change makes it green, then each named mutation is applied
by hand, the test watched going red, and the mutation reverted. A step is done when
`npm run lint:check`, `npm run typecheck` and `npm test` are green and its mutations were
watched red. Commits are made by path, one or more per step, Conventional Commits, with
the session's trailers; nothing is pushed until the controller says so.

## Decisions this plan takes (left to the plan by the spec)

- **How native code is tested without widening the shipped surface.** The pure decisions
  live in their own C++ files under `src/cpp/` — the set that ends a connection
  (`endsConnection`), the placement of a passport into the SDK's buffer, and the answer to
  a passport call when the passport manager could not be installed. A test-only addon in
  `test/native/` (its own `binding.gyp`, built by its own npm script into a gitignored
  `test/native/build/`) compiles those files with a small test shim. The root
  `binding.gyp`, `prebuildify` and the packed file list never see it; `test/package.test.ts`
  proves it stays out of the package. Native tests skip, with the reason in the title, when
  the test addon is not built (CI builds no C++).
- **How the live tests see "no new session".** By the ADT lock handle, as the probe did: a
  lock taken before the error; after the error the next call answers the closed-connection
  error with nothing sent; after the caller's own `open()` a write with the old handle
  answers `423`. No test-only member on the shipped binding, no CPI-C id read.
- **How unit tests reach the TS layer without the native addon.** The compiled
  `binding` module is replaced in Node's module cache by a recording fake before the
  client module is loaded; the fake records every `invoke` argument and answers through the
  callback it was given.
- **The live tests' connection.** A session file named by the environment variable
  `SAP_RFC_LITE_LIVE_ENV`, read by plain code (never sourced); without it the live suite
  skips with the reason in its title. The run itself is preceded by the operator's realm
  check (step 9).

## Steps

### 1. Baseline

1. In the worktree: `npm ci`; with `SAPNWRFC_HOME` and the library path set (README,
   "Runtime library loading"), `npm run build`, then `npm run lint:check`, `npm run
   typecheck`, `npm test` — all green on the unchanged sources. Record the binding's
   `bindingVersions`.
2. Add `test/native/build/` to `.gitignore`.

### 2. TS: the call option (spec 2.1, 2.2)

1. Unit test (fake binding): `call` without options hands `invoke` exactly three
   arguments; with `{ passport }` it hands `{ passport }` as the fourth, the same `Buffer`;
   the native callback's error is `call`'s rejection unchanged; its result is `call`'s
   answer.
2. Type test `test/callOptions.typecheck.ts` (compiled by `npm test`'s `tsc`, not run):
   `passport` takes a `Buffer`; a string, a number and an unknown key are
   `@ts-expect-error`.
3. Change: `RfcCallOptions` in `types.ts`, exported from `index.ts`; `call(rfmName,
   rfmParams?, options?)`; the binding's `invoke` type names the options object it takes.
4. Mutations: pass the options object always (the three-argument case red); drop the
   options parameter from the type (type test red).

### 3. TS: the passport's value rules (spec 2.4, check 1)

1. Unit cases, each rejecting with a `TypeError` and no `invoke` recorded: an empty
   `Buffer`; 6 bytes; no leading `*TH*`; no trailing `*TH*`; declared length one more and
   one less than the length. Positive case: the ADT client's 288-byte debuggee passport
   (built in the test from the same template, its ids random) reaches `invoke` unchanged.
2. Change: the check in `Client.call` before `invoke`, plain byte reads only (eye catcher
   at 0–3, u16 big-endian at 5–6, eye catcher in the last 4 bytes).
3. Mutations, each alone, each red only in its own case: drop the empty-buffer rule; drop
   the leading eye-catcher comparison; drop the declared-length comparison; drop the
   trailing eye-catcher comparison.

### 4. Native test addon (decision above)

1. `test/native/binding.gyp`, its shim, and an npm script that builds it with node-gyp
   (needs `SAPNWRFC_HOME`); a native test file that loads it and skips when it is absent.
2. Extend `test/package.test.ts`: the packed file list holds nothing under `test/`, and
   `prebuilds/` holds one `.node` per target.
3. First native case, red until step 5: the test addon exposes `endsConnection` and it is
   missing.

### 5. Native: the set that ends a connection (spec 3.3)

1. Native cases: `endsConnection` is true for each code `RFC_COMMUNICATION_FAILURE`,
   `RFC_ABAP_RUNTIME_FAILURE`, `RFC_ABAP_MESSAGE`, `RFC_EXTERNAL_FAILURE`, `RFC_CLOSED` and
   for each group `ABAP_RUNTIME_FAILURE`, `LOGON_FAILURE`, `COMMUNICATION_FAILURE`,
   `EXTERNAL_RUNTIME_FAILURE`; false for `RFC_OK` and for `RFC_ABAP_EXCEPTION` in group
   `ABAP_APPLICATION_FAILURE`.
2. Change: `endsConnection` in its own file, the set exactly as the spec names it.
3. Mutations: drop `RFC_CLOSED`; drop `RFC_ABAP_MESSAGE`; drop one group — each its own
   case red.

### 6. Native: no reconnect, close on the set (spec 2.3, 3.3, 4)

1. Live cases written first (they run in step 9; against today's code they are red, as
   measured): `RFC_RAISE_ERROR` `METHOD '0'`/`MESSAGETYPE 'E'` rejects with
   `RFC_ABAP_MESSAGE`, and `METHOD '3'` with `RFC_ABAP_RUNTIME_FAILURE`; after each `alive`
   is `false`, the next `call` and `resetServerContext` answer the closed-connection error,
   `close()` rejects with it; the lock handle taken before the error answers `423` only
   after the caller's own `open()`; `METHOD '2'` (`RFC_ABAP_EXCEPTION`) leaves `alive`
   `true` and the lock handle valid.
2. Change in `Client.cc`: remove `connectionCheck`, `connectionCheckError` and the
   reopen branches of `getOperationError`; in `PrepareAsync::Execute`
   (`RfcGetFunctionDesc`), `InvokeAsync::Execute` (`RfcInvoke`) and
   `ResetServerContextAsync::Execute` (`RfcResetServerContext`), on an error for which
   `endsConnection` is true, under the mutex: `RfcCloseConnection` once with its own error
   info, then the handle `nullptr`; the operation's own error info is what is answered.
3. Native case (test addon, no system): a client never opened answers the
   closed-connection error for `call` with and without a passport.
4. Mutations (watched in step 9): restore the reopen (the `423`-before-`open()` case red);
   answer the close's error instead of the call's (error-as-it-came red); leave the handle
   set (`alive` red); skip the rule in `PrepareAsync` (no live case can provoke it there —
   recorded as covered by code reading only, Inference-level, in the PR).

### 7. Native: the passport manager (spec 3.1)

1. Native cases (test addon): the answer to a passport call given a failed install result
   is that SDK error, built as every SDK error is; given `RFC_OK` there is no refusal; a
   call without a passport is never refused for it. That the shipped addon's own install
   succeeds is shown live: a caught run (step 8) is impossible without it.
2. Change: install at module registration under a `std::once_flag`, keeping the installer's
   `RFC_ERROR_INFO`; start callback as in step 8, end and server callbacks return `RFC_OK`
   and touch nothing; `Client::Invoke` refuses a passport call with the kept error before
   queueing anything.
3. Mutations: refuse calls without a passport too (its case red); ignore the kept error
   (refusal case red).

### 8. Native: the passport reaches its own call (spec 3.2)

1. Native cases (test addon) for the placement decision: a passport shorter than the offered
   size is copied and the length set; one exactly the size is placed; one larger is not
   placed — nothing written into the buffer, the length left as given, "not placed"
   reported.
2. Live cases written first (run in step 9): caught with the debuggee passport; not caught
   without it; not caught with a passport for other ids; after the caught run and the
   caller's `resetServerContext()`, the next call on the same client without a passport not
   caught by a second listener for the same ids (spec 3.2, "What the system keeps"); the
   289-declared
   passport rejected with the `TypeError` and no run; a self-consistent 65,535-byte passport
   on a call taking the ADT lock of the test's class rejects with the library error naming
   both lengths, a second connection's lock is refused (the call ran, its effect remains),
   and the lock is released.
3. Change: `Client::Invoke` copies the passport's bytes into the workers (none on the
   `Client`); `InvokeAsync::Execute` sets the three thread-locals (passport, handle,
   not-placed) immediately before `RfcInvoke` and clears them immediately after, on every
   path; the start callback places the passport only for its own thread's call and handle,
   through the placement decision; after `RfcInvoke`, when it answered `RFC_OK` and the
   passport was not placed, the call rejects with the library error of spec 3.2 and no
   result; when `RfcInvoke` failed, its own error as it came.
4. Mutations: set the thread-local after `RfcInvoke` (caught red); place a passport larger
   than the size (placement case red); return the result instead of the library error when
   not placed (oversized live case red).

### 8a. Native: the carried passport is cleared (spec 3.1, 3.2 amended)

1. Native cases (test addon, on the callbacks themselves, exposed by name from
   `passport.h`): the start callback with no call passport set and 288 offered sets the
   length to 0 and writes nothing; with the call's passport set and the same handle it
   places it; with another handle it sets 0; with a passport that does not fit it writes
   nothing and sets 0; the end callback with 288 sets 0.
2. Change: the end callback sets `*eppLength` to 0; the start callback sets it to 0 for
   every call it does not place a passport for.
3. Mutations, each alone: drop the end callback's clearing (end case red); drop the start
   callback's clearing (no-passport case red); drop the handle comparison (other-handle
   case red); drop the clearing on a passport that did not fit (not-fit case red).
4. The live only-its-own-call case as amended in step 8.2.

### 9. Live run on the on-premise system over RFC

1. Operator's checks first: unauthenticated `GET /sap/bc/adt/discovery` on the tunnel
   answers `401` with the expected realm, else stop; the session file is the RFC one, read
   by key names only; any credential refusal stops everything.
2. Build the addon for the running Node and the test addon; run the live suite with
   `SAP_RFC_LITE_LIVE_ENV` set. The live suite first asserts that the binding it loads is
   the local build (`build/Release`), not a prebuilt one: a failed `npm run build` removes
   the local build, and `node-gyp-build` then loads the committed prebuild of an earlier
   release without a word (observed 2026-11-11). It creates its own class in `$TMP`, removes its external
   breakpoints (listener stop), closes every connection in a `finally`, deletes its class,
   and prints no secret, no ids and no passport bytes.
3. Every live case green; then the mutations of steps 6 and 8 that are watched live, each
   built, run, seen red, reverted, rebuilt; the final green run recorded (case names and
   outcomes only) for the PR.

### 10. Documentation (spec 5)

1. README: `call`'s third parameter and `RfcCallOptions`; the passport's rules (only its
   call, none without it, empty, eye catchers and declared length refused before sending,
   larger than the SDK's buffer → not placed, the call runs, its effects remain, `call`
   rejects saying so; refused when the passport manager could not be installed); the new
   section "When a call ends the connection" with the spec's table, the set (`RFC_CLOSED`
   included), `alive`, `close()` after it.
2. CHANGELOG `[0.4.0]` with the release date set at release: Added (the per-call passport),
   Changed — breaking (no reconnect; the connection closed on the set; the call's own error
   always), Fixed (the handle dropped without close), and "Migration from 0.3.x" (check
   `alive` or the closed-connection error, call `open()` yourself, a new connection is a
   new ABAP session: locks and context gone).
3. The CLAUDE.md text is not edited here: a proposal for the controller (below) goes into
   the step's report; the controller applies it with the owner's approval.

### 11. Prebuilt bindings

1. Merge-ready sources on the feature branch; `prebuilds/` untouched there.
2. Each permanent branch `prebuild/linux-x64`, `prebuild/win32-x64`,
   `prebuild/darwin-arm64` brought up to the feature branch's sources at the point agreed
   with the controller (or to `master` after the merge, as the owner runs it); on its own
   OS, with the SDK, `npm run prebuild:native` (on Windows the SDK's DLLs copied next to
   the binding for the record step, then removed); only `prebuilds/<target>` committed;
   `BUILD.json` names SDK 7500; merged. Linux is built here; Windows and macOS on the
   owner's machines.
3. `npm run check:prebuilds` green on `master` before the tag.

### 12. Before the release commit

1. Delete `docs/superpowers/2026-11-11-rfc-passport-goal.md`, `…-spec.md` and `…-plan.md`
   (repository rule: only active work stays); what they still owe the future goes into the
   PR description first.
2. The full suite, live included, green once more on the final sources; the CHANGELOG
   date checked against the release day.
3. Version 0.4.0 bumped only when the owner asks; tag and publish are the owner's.

### 13. The PR

One PR for the whole task — goal, spec, plan, code, tests, docs — opened by the controller
from `feat/rfc-passport`, carrying every later review round as new commits. Its
description lists: the measurements behind the design (the probe's results), the live
run's case list, the mutations and which were watched live, and what stays for the
consumers (connection, ADT strategies, the server).

## CLAUDE.md text proposal (for the controller; not applied here)

Under "Architecture", "C++ layer", after the `Client.cc` bullet:

> - **Passport manager** — installed once at module registration (`RfcInstallPassportManager`);
>   its install result is kept, and a call given a passport is refused with it when the
>   install failed. A call's passport (`call(name, params, { passport })`) is copied into
>   that call's workers and handed to the SDK through `thread_local`s set immediately
>   around `RfcInvoke`; the start callback places it only for its own call and handle, and
>   only when it fits the buffer the SDK offers; a call whose passport did not fit has run
>   without it and rejects saying so. `call` refuses, before sending, a passport that is
>   empty, lacks `*TH*` at its start or end, or declares a length (bytes 5–6, u16 BE) other
>   than its own.
> - **No reconnect** — the library never opens a connection the caller did not open. On an
>   error for which `endsConnection` is true (codes `RFC_COMMUNICATION_FAILURE`,
>   `RFC_ABAP_RUNTIME_FAILURE`, `RFC_ABAP_MESSAGE`, `RFC_EXTERNAL_FAILURE`, `RFC_CLOSED`;
>   groups `ABAP_RUNTIME_FAILURE`, `LOGON_FAILURE`, `COMMUNICATION_FAILURE`,
>   `EXTERNAL_RUNTIME_FAILURE`) the handle is closed once and released, `alive` is `false`,
>   and the operation's own error is returned.

Under "Build & Test Commands": the test addon's npm script, and that native and live tests
skip with their reason when the test addon or `SAP_RFC_LITE_LIVE_ENV` is absent.

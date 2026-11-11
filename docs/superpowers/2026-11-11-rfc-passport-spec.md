# Spec: a call that carries the caller's passport, and no silent reconnect

Bound by `2026-11-11-rfc-passport-goal.md`. Release: 0.4.0.

Every claim is tagged: **Measured** (run against a real on-premise system over RFC, or on
this machine), **Code** (read in this repository at the commit the branch starts from),
**SAP** (the NW RFC SDK header `sapnwrfc.h`), **Inference** (reasoned, not checked).
Points still to be decided are marked **Open** and decided by the owner, not here.

## 1. What exists today

- `Client.call(rfmName, rfmParams)` takes no options; the native `invoke` reads an optional
  fourth argument and knows `notRequested` and `timeout` (ignored); any other key throws a
  `TypeError` (Code: `Client.cc` `Client::Invoke`, `src/ts/binding.ts`).
- The call runs in two `AsyncWorker`s: `PrepareAsync` (`RfcGetFunctionDesc` on a worker
  thread, parameters set on the main thread) and `InvokeAsync` (`RfcInvoke` on a worker
  thread). The client's mutex is held from `PrepareAsync::Execute` until
  `InvokeAsync::OnOK` (Code).
- After an `RfcInvoke` error whose code is `RFC_COMMUNICATION_FAILURE`,
  `RFC_ABAP_RUNTIME_FAILURE`, `RFC_ABAP_MESSAGE` or `RFC_EXTERNAL_FAILURE`, or whose group is
  `ABAP_RUNTIME_FAILURE`, `LOGON_FAILURE`, `COMMUNICATION_FAILURE` or
  `EXTERNAL_RUNTIME_FAILURE`, `Client::connectionCheck` sets the handle to `nullptr` and
  opens a new connection with the stored logon parameters, without closing the old handle;
  if the reopen fails, `getOperationError` answers the reopen's error instead of the call's
  (Code: `Client.cc` `connectionCheck`, `getOperationError`).
- Its effect: after `RFC_ABAP_MESSAGE` and after `RFC_ABAP_RUNTIME_FAILURE`, the call's
  error is returned, `alive` stays `true`, the CPI-C conversation id is a different one and
  an ADT lock handle taken before the error answers `423` — the next call ran on a new
  session (Measured). After `RFC_ABAP_EXCEPTION` the conversation is the same and the lock
  handle valid (Measured).
- With the reconnect switched off, after `RFC_ABAP_MESSAGE` `RfcIsConnectionHandleValid`
  answers 0 and the next call answers `RFC_INVALID_HANDLE`; after `RFC_ABAP_RUNTIME_FAILURE`
  it still answers 1, but the next call answers `RFC_COMMUNICATION_FAILURE` ("no conversation
  found"); `RfcCloseConnection` afterwards answers `RFC_INVALID_HANDLE` in both (Measured).
  So the handle's validity does not tell whether the connection is gone; the error's code
  and group do.
- There is no passport code (Code).

## 2. TypeScript surface

### 2.1 Types (`src/ts/types.ts`)

```ts
/** What one call may carry besides its parameters. */
export interface RfcCallOptions {
  /** The binary SAP passport sent with this call, as given; absent: no passport. */
  passport?: Buffer | undefined;
}
```

`RfcCallOptions` is exported from `index.ts`. It names `passport` only: `notRequested` and
`timeout` stay native-only and are not part of the public type (Code: neither is reachable
through `Client.call` today).

### 2.2 `Client.call`

```ts
call(rfmName: string, rfmParams?: RfcObject, options?: RfcCallOptions): Promise<RfcObject>;
```

- The option may appear only on `call`. `open`, `close`, `resetServerContext` and the
  constructor take no passport; a passport is never stored on the client.
- `options` is passed to the native `invoke` as its fourth argument (`{ passport }`), and
  only when `options.passport` is given; a call without it passes no fourth argument, so the
  native path is the one it is today.
- The passport's type is the compiler's: no `Buffer.isBuffer` check in TS. A value rule
  that the type cannot state is checked before anything is sent (see 2.4).
- The bytes are copied when `call` is invoked (native, on the main thread): a caller that
  changes its `Buffer` afterwards changes nothing that is sent.

### 2.3 What a client answers once the connection is gone

- The failing call rejects with the error of that call, as today's error objects carry it
  (`RfcLibError` or `AbapError`: `code`, `codeString`, `group`, `key`, `message`, the ABAP
  message fields). Nothing is added to it and nothing replaces it.
- From then on `alive` is `false`.
- A later `call` or `resetServerContext` rejects with today's closed-connection error,
  `nodeRfcError` "RFM client request over closed connection: …" (Code:
  `connectionClosedError`), before anything is sent.
- `open()` opens a new connection on the same client, as it does after `close()` (Code:
  `OpenAsync` writes the handle it gets).
- `close()` on a client whose connection the library released: **Open** — today `close()`
  on a closed client rejects with the closed-connection error (Code: `CloseAsync`).

### 2.4 Value rules of the passport — Open

- A passport longer than the buffer the SDK offers in the start callback cannot be sent.
  The size is given only inside the callback (`eppBufferSize`), 512 bytes in every call
  measured (Measured, SDK 7500 PL18, Linux); the SDK does not document it (SAP) and does
  not document what a non-`RFC_OK` answer of the start callback does (SAP). How the library
  treats an oversized passport is **Open**.
- An empty `Buffer`: sent as no passport, or refused: **Open**.

The ADT client's debuggee passport is 288 bytes (Code: adt-clients
`runtime/debugger/passport.js`; Measured: sent and caught).

## 3. Native design

### 3.1 The passport manager, installed once

- `RfcInstallPassportManager(onClientCallStart, onClientCallEnd, nullptr-or-noop server
  callbacks, &errorInfo)` is called once per process when the addon registers, guarded by
  a `std::once_flag` so a second registration (worker threads load the addon per
  environment — Inference) does not install again. The installation is process-global
  (SAP: the installer takes no handle).
- Measured: installing it returns `RFC_OK`; with it installed and no passport given, every
  client call's start callback receives a 512-byte buffer with `*eppLength == 0` — the SDK
  sends no passport of its own — and a call behaves as with no manager installed (a
  terminal-mode listener does not catch the run; the run's output and duration are the same).
  The end callback is called only for a call that sent a passport.
- The server callbacks: this package has no RFC server (CLAUDE.md, Project Overview);
  whether `nullptr` is accepted for them is not documented (SAP) — the implementation
  passes functions that return `RFC_OK` and touch nothing, as the probe did (Measured with
  such functions).
- `onClientCallEnd` reads nothing and returns `RFC_OK` (out of scope: the returned
  passport).
- If the installation fails: SAP documents only that `errorInfo` is filled "in case the
  handlers could not be installed"; no failure was observed (Measured: `RFC_OK`). What the
  addon does then is **Open**: (a) the module loads, the failure is kept, and a call given a
  passport rejects with that SDK error before anything is sent while calls without one are
  unaffected; or (b) loading the module fails with that error.

### 3.2 The passport reaches its own call only

- `Client::Invoke` reads `passport` from the options object, copies its bytes into a
  `std::vector<unsigned char>` handed to `PrepareAsync` and from it to `InvokeAsync`. The
  `Client` holds no passport.
- `InvokeAsync::Execute`, immediately before `RfcInvoke`, sets two `thread_local` values:
  a pointer to its passport (or `nullptr` when none was given) and the connection handle;
  immediately after `RfcInvoke` returns — on every path — it sets both back to `nullptr`.
- `onClientCallStart(handle, …, buffer, size, length)`: when the thread-local pointer is set
  and `handle` equals the thread-local handle, it copies the passport into `buffer` and sets
  `*length` to its size; otherwise it leaves `buffer` and `*length` as given (length 0, as
  measured) and returns `RFC_OK`.
- The callback runs synchronously on the thread that called `RfcInvoke`, with that call's
  handle (Measured: the handle matched on every call). The metadata calls the SDK makes
  inside `RfcGetFunctionDesc` (`RFC_GET_FUNCTION_INTERFACE`, `DDIF_FIELDINFO_GET`) also
  reach the start callback (Measured), on `PrepareAsync`'s thread with no thread-local set,
  and so carry no passport.
- Two clients calling in parallel run on two worker threads; each sees only its own
  thread-local (Inference from `thread_local` semantics and libuv's thread pool; covered by
  the live test in 6.3).

### 3.3 No reconnect: close on the errors that end the connection

- `Client::connectionCheck` and `ErrorPair connectionCheckError` are removed, and with them
  the branches of `getOperationError` that answer the reopen's error. Nothing in the addon
  calls `RfcOpenConnection` except `OpenAsync`.
- The set that ends the connection is the one that triggers the reconnect today (owner's
  decision; Code: `Client.cc` lines 399–407 at the branch's start): codes
  `RFC_COMMUNICATION_FAILURE`, `RFC_ABAP_RUNTIME_FAILURE`, `RFC_ABAP_MESSAGE`,
  `RFC_EXTERNAL_FAILURE`; groups `ABAP_RUNTIME_FAILURE`, `LOGON_FAILURE`,
  `COMMUNICATION_FAILURE`, `EXTERNAL_RUNTIME_FAILURE`. One function,
  `endsConnection(const RFC_ERROR_INFO&)`, holds it.
- It applies to every operation that uses an open handle on a worker thread:
  `RfcGetFunctionDesc` in `PrepareAsync::Execute`, `RfcInvoke` in `InvokeAsync::Execute`,
  `RfcResetServerContext` in `ResetServerContextAsync::Execute` — the goal's invariant (after
  any error that leaves the connection unusable, `alive` is `false`) is not limited to
  `RfcInvoke`.
- On such an error, still under the client's mutex: `RfcCloseConnection(handle, &ignored)`
  once — its answer ignored, since after these errors it answers `RFC_INVALID_HANDLE`
  (Measured) and SAP says it "can usually be ignored" — then `connectionHandle = nullptr`.
  The handle is released exactly once: no other path holds it, and the destructor closes
  only a non-null handle (Code).
- The error answered is the operation's own `errorInfo`, converted as today
  (`rfcSdkError`). No later SDK call writes into it: the close uses its own
  `RFC_ERROR_INFO`.
- This closes the leak of 1.: the old handle is no longer dropped without
  `RfcCloseConnection` (Code; that the SDK keeps memory for a dropped handle is Inference).
- `RFC_CLOSED` ("Connection closed by the other side", SAP) is not in the set by code; its
  group decides. Whether its group is `COMMUNICATION_FAILURE` is Inference, not measured —
  closing a connection from the backend side (SM04, SMGW) is not done in these runs.

### 3.4 What stays

Open, close, reset, parameter conversion, the per-client mutex, the destructor, the error
objects' shape: unchanged (Code). No timeout, retry or polling is added.

## 4. Errors and `alive` — the contract in one table

| After | Error answered | `alive` | Next `call` |
|---|---|---|---|
| success | — | `true` | runs on the same connection |
| an error outside the set (e.g. `RFC_ABAP_EXCEPTION`) | that error | `true` | runs on the same connection (Measured: same conversation) |
| an error in the set | that error, as the SDK gave it | `false` | closed-connection error, nothing sent |
| `open()` after that | — | `true` | runs on a new connection the caller opened |

## 5. Documentation

- **README**, "API": `client.call(rfmName, rfmParams?, options?)` with `options.passport`
  (what it is for, that it is sent with that call only, that none is sent without it, the
  size limit once decided); a new section "When a call ends the connection" with the table
  of 4 and the set of codes and groups; `alive` described as false after such an error.
- **CHANGELOG** `[0.4.0]`: Added — the per-call passport; Changed (breaking) — no reconnect,
  the connection is closed on the errors of the set, the call's own error is always
  returned; Fixed — the handle dropped without close on reconnect; a "Migration from 0.3.x"
  paragraph.
- **Migration note** (README and CHANGELOG): a consumer that relied on the next call
  working after an ABAP message, a runtime error or a communication failure checks `alive`
  after a failed call, or the closed-connection error of the next one, and calls `open()`
  itself — knowing that the new connection is a new ABAP session: locks, buffers and
  context of the old one are gone (Measured: lock handle `423` on the replaced session).
- **CLAUDE.md** describes `connectionCheck` nowhere today (Code); the architecture section
  gets the passport manager and the close-on-error path — through the owner, since this
  repository's CLAUDE.md is changed only with the owner's approval of the text.

## 6. Tests

`npm test` runs on CI without the SDK (Code: `.github/workflows`, Node 20 and 22). Tests that
load the native binding or reach a system run only where they can, and skip with the reason
in their title elsewhere.

### 6.1 Unit (no SDK, in CI)

- The TS layer with a fake native binding (the `Client` module given a stand-in for
  `binding.Client`): `call` without options passes three arguments to `invoke`; with
  `{ passport }` it passes `{ passport }` with the same `Buffer`; a rejection from the
  native callback is the rejection of `call`, unchanged.
- A type test (`*.typecheck.ts`, compiled by `npm run typecheck`, not run): `passport`
  accepts a `Buffer`; a string, a number or an unknown key is a compile error
  (`@ts-expect-error`).

### 6.2 Native (SDK present, no system; local, skipped in CI)

- The addon loads with the passport manager installed (the binding's load succeeds; with
  3.1 (a), the kept install result is `RFC_OK`).
- A call on a client that was never opened, with and without a passport, answers the
  closed-connection error and sends nothing (Code path; no system needed).
- Whether the close-on-error path can be driven without a system (a logon to a closed
  local port gives `RFC_COMMUNICATION_FAILURE` at `open`, not on a call — Inference) is
  checked when writing the plan; the path is proved live (6.3) in any case.

### 6.3 Live (an on-premise system over RFC; never in CI)

Reads the connection from a session file named by an environment variable; skips with the
reason when it is not set. Creates its own runnable class in `$TMP`, no transport, and
deletes it at the end; removes every external breakpoint it set (the listener stop does);
closes every connection in a `finally`.

- **Caught with the passport**: external line breakpoint and a terminal-mode listener with
  random terminal and IDE ids on one connection; a class run over `SADT_REST_RFC_ENDPOINT`
  on another carrying the ADT client's debuggee passport for those ids → the listener
  answers a `DebuggeesList`; attach and detach on a third; the run returns its output.
  (Measured by the probe: caught twice of twice.)
- **Not caught without it**: the same with no passport → the listener's hold ends empty
  and the run returns at once. (Measured.)
- **Not caught with another passport**: a passport for other ids → not caught; shows the
  match is the ids'. (Measured.)
- **Only its own call**: the call after the caught run, on the same client with no
  passport, sends none (the start callback's length stays 0 — read through the run not
  being caught by a second listener for the same ids).
- **The error as it came, then closed**: `RFC_RAISE_ERROR` with `METHOD = '0'`,
  `MESSAGETYPE = 'E'` → rejects with `RFC_ABAP_MESSAGE`; `METHOD = '3'` → rejects with
  `RFC_ABAP_RUNTIME_FAILURE` (Measured codes); after each `alive` is `false` and the next
  call answers the closed-connection error.
- **No new session**: the CPI-C conversation id read before the error and after the
  caller's own `open()` differ, and no call between them succeeded — the session changes
  only when the caller opens it. Reading the id needs `RfcGetConnectionAttributes`, which
  the public API does not expose: how the test reads it (a test-only path, or the lock
  handle's `423` as the probe also did) is decided in the plan, without adding a public
  member.
- **Outside the set nothing closes**: `METHOD = '2'` → `RFC_ABAP_EXCEPTION`, `alive` stays
  `true`, the next call runs on the same conversation. (Measured.)

### 6.4 Load-bearing

Each rule is broken once on purpose and its test watched going red, then restored:
setting the thread-local after `RfcInvoke` instead of before (caught test red); not
clearing it (only-its-own-call red); dropping the handle comparison in the callback (the
parallel-clients case red, if the plan includes one); restoring the reopen (no-new-session
red); returning success instead of the call's error (error-as-it-came red); leaving the
handle set on an error of the set (`alive` red); TS passing options always (unit red).

## 7. Prebuilt bindings and release

- The feature branch changes sources only (C++, TS, tests, docs); it does not touch
  `prebuilds/`. `check:prebuilds` gates the publish, not the merge (Code:
  `prepublishOnly`).
- Before the release each permanent branch — `prebuild/linux-x64`, `prebuild/win32-x64`,
  `prebuild/darwin-arm64` (Code: remote branches) — is brought up to `master`, built on its
  own OS with the SDK (`npm run prebuild:native`; on Windows the SDK's DLLs copied next to
  the binding for the record step, README), commits only its own `prebuilds/<target>`, and
  is merged to `master`. No new branch per change; the feature branch and its worktree are
  deleted after the merge.
- `BUILD.json`'s `sourceHash` changes with the C++ (Code: `scripts/prebuild-record.js`), so
  every target must be rebuilt; `check:prebuilds` refuses otherwise.
- Version 0.4.0, bumped with `npm version minor` only when the owner asks; published by the
  owner from `master` at the tag.

# Goal: a call that carries the caller's passport, and no silent reconnect

## Goal

A caller of `Client.call()` can hand one call a passport (the binary SAP passport, the
same bytes an HTTP request carries as `SAP-PASSPORT`), and the library sends it with that
RFC call through the SDK's passport manager. This is what lets an ABAP program started
over RFC be caught by an external debugger listening in terminal mode.

A call that fails is answered with the error the SDK gave for that call, and the library
never opens a new connection on its own: when the error left the connection unusable, the
client is closed, says so, and stays closed until the caller opens it again.

## Invariants

- **The passport is the caller's.** A call carries a passport only when the caller gave one
  for that call. The library invents none, derives none from earlier calls, and keeps none
  for later calls.
- **No passport given, today's behaviour exactly.** A call without a passport sends what a
  call sends today: no passport (the passport manager's start callback receives an empty
  passport and leaves it empty), and nothing else about the call changes.
- **The passport reaches only its own call.** The SDK's passport callback runs on the worker
  thread inside the RFC call, where no JavaScript can run: the passport is native memory
  set for exactly that call on that connection before the call is sent, and gone after it.
  Calls on other clients, running in parallel, never see it.
- **No silent reconnect.** No error makes the library open a connection. The error a call
  returns is the error of that call, as the SDK reported it, never the error of something
  the library did afterwards.
- **The caller learns that the connection is gone.** After an error that leaves the
  connection unusable, `alive` is `false`, the native handle is released, and every later
  call answers that the connection is closed, until the caller opens it again. A session
  is never replaced behind the caller's back.
- **Static types first.** The TypeScript surface states the passport's type and where it
  may appear; what the compiler can prove is not checked again at run time. Only what
  comes from outside the type system is checked at run time.
- **No timeouts, no retries, no polling.** Nothing waits on a clock, nothing is sent twice.
- **Prebuilt bindings for the three platforms.** The changed C++ ships as prebuilt bindings
  for `linux-x64`, `win32-x64` and `darwin-arm64`, built on the permanent per-platform
  prebuild branches, and `check:prebuilds` passes before the publish.
- **Proved live over RFC.** Against a real on-premise system, over RFC: a class run carrying
  the debuggee's passport is caught by a terminal-mode listener with those ids, and is not
  caught without it; an error that closes the connection is returned as it came, `alive`
  turns `false`, and no call after it runs on a new session.
- **Tests are load-bearing.** Every unit and native test that protects one of these
  invariants goes red when the rule it protects is broken on purpose.

## Out of scope

- Building the passport: its layout and ids are the caller's (the ADT client builds it).
- Reading or returning the passport the system sends back at the end of a call.
- The passport manager's server-side callbacks (this package has no RFC server).
- Reopening a connection, or deciding when to: that is the caller's.
- The consumers' changes (connection, ADT strategies, the server) that pass the passport
  down and react to a closed connection.

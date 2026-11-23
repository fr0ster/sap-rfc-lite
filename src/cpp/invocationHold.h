// SPDX-FileCopyrightText: 2026 sap-rfc-lite contributors
//
// SPDX-License-Identifier: Apache-2.0

#ifndef NodeRfc_InvocationHold_H
#define NodeRfc_InvocationHold_H

#include <napi.h>

#include <condition_variable>
#include <cstddef>
#include <mutex>

namespace node_rfc {

// One operation at a time per client: a binary semaphore. An operation takes
// it on a worker thread (Execute) and may give it back on another thread (the
// main thread, after its result has been read), which a std::mutex does not
// allow: unlocking a mutex from a thread that does not own it is undefined
// behaviour. The inner mutex is locked and unlocked within one function, on
// one thread.
class InvocationHold {
 public:
  // Waits until no operation holds it, then holds it.
  void acquire();
  // Gives it back and wakes one waiter. Any thread.
  void release();
  // How many acquire() calls are waiting for it now.
  size_t waiting();

 private:
  std::mutex mutex;
  std::condition_variable freed;
  bool busy = false;
  size_t waiters = 0;
};

// An AsyncWorker that holds its client's InvocationHold. Hold() is called on
// the worker thread; Release() gives it back once, if this worker holds it,
// on whichever thread its operation ends. An Execute that throws ends in
// OnError, which releases: the client is never left held.
class HeldWorker : public Napi::AsyncWorker {
 protected:
  HeldWorker(Napi::Function& callback, InvocationHold& hold)
      : Napi::AsyncWorker(callback), hold(hold) {}

  void Hold();
  void Release();

  void OnError(const Napi::Error& e) override;

 private:
  InvocationHold& hold;
  bool held = false;
};

}  // namespace node_rfc

#endif

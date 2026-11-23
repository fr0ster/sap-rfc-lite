// SPDX-FileCopyrightText: 2026 sap-rfc-lite contributors
//
// SPDX-License-Identifier: Apache-2.0

#include "invocationHold.h"

namespace node_rfc {

void InvocationHold::acquire() {
  std::unique_lock<std::mutex> lock(mutex);
  while (busy) {
    ++waiters;
    freed.wait(lock);
    --waiters;
  }
  busy = true;
}

void InvocationHold::release() {
  {
    std::lock_guard<std::mutex> lock(mutex);
    busy = false;
  }
  freed.notify_one();
}

size_t InvocationHold::waiting() {
  std::lock_guard<std::mutex> lock(mutex);
  return waiters;
}

void HeldWorker::Hold() {
  hold.acquire();
  held = true;
}

void HeldWorker::Release() {
  if (held) {
    held = false;
    hold.release();
  }
}

void HeldWorker::OnError(const Napi::Error& e) {
  Release();
  Napi::AsyncWorker::OnError(e);
}

}  // namespace node_rfc

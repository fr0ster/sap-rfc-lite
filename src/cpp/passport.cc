// SPDX-FileCopyrightText: 2026 sap-rfc-lite contributors
//
// SPDX-License-Identifier: Apache-2.0

#include "passport.h"
#include <cstring>
#include <mutex>

namespace node_rfc {

namespace {

// The current call on this thread: set and cleared around RfcInvoke only.
thread_local const std::vector<unsigned char>* callPassport = nullptr;
thread_local RFC_CONNECTION_HANDLE callHandle = nullptr;
thread_local PassportOutcome callOutcome;

std::once_flag installOnce;
RFC_ERROR_INFO installErrorInfo;

}  // namespace

// Before the SDK sends a client request: the passport of this thread's call,
// for this call's handle only. Every other request (the SDK's metadata calls
// inside RfcGetFunctionDesc, a call given no passport, a request on another
// handle, a passport that does not fit) sends none: the length is set to 0
// whatever the SDK offered, since after a call that sent a passport the SDK
// offers the one the system returned to every later call on the connection
// (measured). The return code is ignored by the SDK (measured), so the
// callback always answers RFC_OK.
RFC_RC SAP_API passportOnClientCallStart(RFC_CONNECTION_HANDLE handle,
                                         SAP_UC const* functionName,
                                         SAP_RAW* buffer,
                                         size_t bufferSize,
                                         size_t* length) {
  UNUSED(functionName);
  if (callPassport != nullptr && handle == callHandle) {
    if (placePassport(callPassport->data(),
                      callPassport->size(),
                      buffer,
                      bufferSize,
                      length)) {
      return RFC_OK;
    }
    callOutcome.notPlaced = true;
    callOutcome.offered = bufferSize;
  }
  *length = 0;
  return RFC_OK;
}

// After the response: the passport the system returned is not read (out of
// scope) and not kept. Left as given, the SDK keeps it and offers it to every
// later call on the connection; with the length 0 it offers 0 (measured).
RFC_RC SAP_API passportOnClientCallEnd(RFC_CONNECTION_HANDLE handle,
                                       SAP_UC const* functionName,
                                       SAP_RAW* buffer,
                                       size_t bufferSize,
                                       size_t* length) {
  UNUSED(handle);
  UNUSED(functionName);
  UNUSED(buffer);
  UNUSED(bufferSize);
  *length = 0;
  return RFC_OK;
}

namespace {

// The server-side callbacks: read nothing, change nothing (this package has
// no RFC server).
RFC_RC SAP_API untouched(RFC_CONNECTION_HANDLE handle,
                         SAP_UC const* functionName,
                         SAP_RAW* buffer,
                         size_t bufferSize,
                         size_t* length) {
  UNUSED(handle);
  UNUSED(functionName);
  UNUSED(buffer);
  UNUSED(bufferSize);
  UNUSED(length);
  return RFC_OK;
}

}  // namespace

void installPassportManager() {
  std::call_once(installOnce, []() {
    std::memset(&installErrorInfo, 0, sizeof(installErrorInfo));
    RfcInstallPassportManager(
        passportOnClientCallStart,
        passportOnClientCallEnd,
        untouched,
        untouched,
        &installErrorInfo);
  });
}

const RFC_ERROR_INFO& passportManagerInstall() {
  return installErrorInfo;
}

Napi::Value passportCallRefusal(bool hasPassport, const RFC_ERROR_INFO& install) {
  if (!hasPassport || install.code == RFC_OK) {
    return node_rfc::__env.Undefined();
  }
  RFC_ERROR_INFO errorInfo = install;
  return rfcSdkError(&errorInfo);
}

bool placePassport(const unsigned char* passport,
                   size_t size,
                   SAP_RAW* buffer,
                   size_t bufferSize,
                   size_t* length) {
  if (size > bufferSize) {
    return false;
  }
  std::memcpy(buffer, passport, size);
  *length = size;
  return true;
}

void beginCallPassport(const std::vector<unsigned char>* passport,
                       RFC_CONNECTION_HANDLE handle) {
  callPassport = passport;
  callHandle = handle;
  callOutcome = PassportOutcome();
}

PassportOutcome endCallPassport() {
  PassportOutcome outcome = callOutcome;
  callPassport = nullptr;
  callHandle = nullptr;
  callOutcome = PassportOutcome();
  return outcome;
}

}  // namespace node_rfc

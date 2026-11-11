// SPDX-FileCopyrightText: 2026 sap-rfc-lite contributors
//
// SPDX-License-Identifier: Apache-2.0

#ifndef NodeRfc_Passport_H
#define NodeRfc_Passport_H

#include <cstddef>
#include <vector>
#include "nwrfcsdk.h"

namespace node_rfc {

// The passport manager (RfcInstallPassportManager) is installed once per
// process, when the addon registers; its install result is kept. A call's
// passport is copied into that call's workers and handed to the SDK through
// thread-locals set immediately around RfcInvoke on the worker thread: the
// start callback places it only for that thread's call and handle, and only
// when it fits the buffer the SDK offers.

// Installs the passport manager; a second call does nothing.
void installPassportManager();

// What the installer answered (RFC_OK, or why the handlers were not installed).
const RFC_ERROR_INFO& passportManagerInstall();

// The answer to a call given the install result: undefined when the call may
// go, or the install's SDK error, built as every SDK error is (rfcSdkError),
// for a call given a passport while the manager could not be installed.
Napi::Value passportCallRefusal(bool hasPassport, const RFC_ERROR_INFO& install);

// Places `size` bytes of `passport` into the SDK's buffer of `bufferSize`
// bytes and sets `*length`, when it fits. When it does not, writes nothing,
// leaves `*length` as given and answers false.
bool placePassport(const unsigned char* passport,
                   size_t size,
                   SAP_RAW* buffer,
                   size_t bufferSize,
                   size_t* length);

// What became of a call's passport.
struct PassportOutcome {
  bool notPlaced = false;  // given, and longer than the buffer offered
  size_t offered = 0;      // the buffer's size the SDK offered, when not placed
};

// Set on the worker thread immediately before RfcInvoke: the call's passport
// (nullptr when none was given) and its connection handle.
void beginCallPassport(const std::vector<unsigned char>* passport,
                       RFC_CONNECTION_HANDLE handle);

// Cleared on the worker thread immediately after RfcInvoke, on every path;
// answers what became of the passport.
PassportOutcome endCallPassport();

}  // namespace node_rfc

#endif

// SPDX-FileCopyrightText: 2026 sap-rfc-lite contributors
//
// SPDX-License-Identifier: Apache-2.0

#ifndef NodeRfc_ConnectionEnd_H
#define NodeRfc_ConnectionEnd_H

#include <sapnwrfc.h>

namespace node_rfc {

// Whether an error of an operation on an open connection leaves the connection
// unusable. On such an error the client closes the handle once and releases it;
// the library never opens a new one (README, "When a call ends the
// connection").
bool endsConnection(const RFC_ERROR_INFO& errorInfo);

}  // namespace node_rfc

#endif

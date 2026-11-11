// SPDX-FileCopyrightText: 2026 sap-rfc-lite contributors
//
// SPDX-License-Identifier: Apache-2.0

#include "connectionEnd.h"

namespace node_rfc {

bool endsConnection(const RFC_ERROR_INFO& errorInfo) {
  switch (errorInfo.code) {
    case RFC_COMMUNICATION_FAILURE:
    case RFC_ABAP_RUNTIME_FAILURE:
    case RFC_ABAP_MESSAGE:
    case RFC_EXTERNAL_FAILURE:
    case RFC_CLOSED:  // "Connection closed by the other side"
      return true;
    default:
      break;
  }
  switch (errorInfo.group) {
    case ABAP_RUNTIME_FAILURE:
    case LOGON_FAILURE:
    case COMMUNICATION_FAILURE:
    case EXTERNAL_RUNTIME_FAILURE:
      return true;
    default:
      return false;
  }
}

}  // namespace node_rfc

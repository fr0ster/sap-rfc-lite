// SPDX-FileCopyrightText: 2026 sap-rfc-lite contributors
// SPDX-License-Identifier: Apache-2.0

// The test-only addon's shim: exposes the shipped addon's pure decisions
// (compiled from src/cpp/) to test/native.test.ts, and the SDK's code and group
// numbers by name. Nothing here is shipped.

#include "connectionEnd.h"
#include "nwrfcsdk.h"

namespace node_rfc {
Napi::Env __env = nullptr;
}  // namespace node_rfc

namespace {

Napi::Object Codes(Napi::Env env) {
  Napi::Object codes = Napi::Object::New(env);
  codes.Set("RFC_OK", static_cast<double>(RFC_OK));
  codes.Set("RFC_COMMUNICATION_FAILURE",
            static_cast<double>(RFC_COMMUNICATION_FAILURE));
  codes.Set("RFC_LOGON_FAILURE", static_cast<double>(RFC_LOGON_FAILURE));
  codes.Set("RFC_ABAP_RUNTIME_FAILURE",
            static_cast<double>(RFC_ABAP_RUNTIME_FAILURE));
  codes.Set("RFC_ABAP_MESSAGE", static_cast<double>(RFC_ABAP_MESSAGE));
  codes.Set("RFC_ABAP_EXCEPTION", static_cast<double>(RFC_ABAP_EXCEPTION));
  codes.Set("RFC_CLOSED", static_cast<double>(RFC_CLOSED));
  codes.Set("RFC_EXTERNAL_FAILURE", static_cast<double>(RFC_EXTERNAL_FAILURE));
  codes.Set("RFC_INVALID_HANDLE", static_cast<double>(RFC_INVALID_HANDLE));
  return codes;
}

Napi::Object Groups(Napi::Env env) {
  Napi::Object groups = Napi::Object::New(env);
  groups.Set("OK", static_cast<double>(OK));
  groups.Set("ABAP_APPLICATION_FAILURE",
             static_cast<double>(ABAP_APPLICATION_FAILURE));
  groups.Set("ABAP_RUNTIME_FAILURE", static_cast<double>(ABAP_RUNTIME_FAILURE));
  groups.Set("LOGON_FAILURE", static_cast<double>(LOGON_FAILURE));
  groups.Set("COMMUNICATION_FAILURE",
             static_cast<double>(COMMUNICATION_FAILURE));
  groups.Set("EXTERNAL_RUNTIME_FAILURE",
             static_cast<double>(EXTERNAL_RUNTIME_FAILURE));
  groups.Set("EXTERNAL_APPLICATION_FAILURE",
             static_cast<double>(EXTERNAL_APPLICATION_FAILURE));
  return groups;
}

// endsConnection(code, group): the decision for an error of that code and group.
Napi::Value EndsConnection(const Napi::CallbackInfo& info) {
  RFC_ERROR_INFO errorInfo = {};
  errorInfo.code = static_cast<RFC_RC>(info[0].As<Napi::Number>().Int32Value());
  errorInfo.group =
      static_cast<RFC_ERROR_GROUP>(info[1].As<Napi::Number>().Int32Value());
  return Napi::Boolean::New(info.Env(), node_rfc::endsConnection(errorInfo));
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  node_rfc::__env = env;
  exports.Set("codes", Codes(env));
  exports.Set("groups", Groups(env));
  exports.Set("endsConnection", Napi::Function::New(env, EndsConnection));
  return exports;
}

}  // namespace

NODE_API_MODULE(rfc_lite_test, Init)

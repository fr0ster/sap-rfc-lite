// SPDX-FileCopyrightText: 2014 SAP SE Srdjan Boskovic <srdjan.boskovic@sap.com>
// SPDX-FileCopyrightText: 2026 sap-rfc-lite contributors
//
// SPDX-License-Identifier: Apache-2.0

#include "Client.h"

namespace node_rfc {

Napi::Env __env = nullptr;

Napi::Value BindingVersions(Napi::Env env) {
  uint_t major, minor, patchLevel;
  Napi::EscapableHandleScope scope(env);

  RfcGetVersion(&major, &minor, &patchLevel);

  Napi::Object nwrfcsdk = Napi::Object::New(env);
  nwrfcsdk.Set("major", major);
  nwrfcsdk.Set("minor", minor);
  nwrfcsdk.Set("patchLevel", patchLevel);

  Napi::Object version = Napi::Object::New(env);
  version.Set("version", "0.1.0");
  version.Set("nwrfcsdk", nwrfcsdk);

  return scope.Escape(version);
}

Napi::Object RegisterModule(Napi::Env env, Napi::Object exports) {
  if (node_rfc::__env == nullptr) {
    node_rfc::__env = env;
  }

  exports.Set("bindingVersions", BindingVersions(env));
  Client::Init(env, exports);

  return exports;
}

NODE_API_MODULE(NODE_GYP_MODULE_NAME, RegisterModule)

}  // namespace node_rfc

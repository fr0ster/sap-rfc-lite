// SPDX-FileCopyrightText: 2014 SAP SE Srdjan Boskovic <srdjan.boskovic@sap.com>
// SPDX-FileCopyrightText: 2026 sap-rfc-lite contributors
//
// SPDX-License-Identifier: Apache-2.0

#ifndef NodeRfc_Client_H
#define NodeRfc_Client_H

#include "nwrfcsdk.h"

namespace node_rfc {

extern Napi::Env __env;

class Client : public Napi::ObjectWrap<Client> {
 public:
  friend class OpenAsync;
  friend class CloseAsync;
  friend class PrepareAsync;
  friend class InvokeAsync;
  static Napi::Object Init(Napi::Env env, Napi::Object exports);
  // cppcheck-suppress noExplicitConstructor
  Client(const Napi::CallbackInfo& info);
  ~Client(void);

 private:
  Napi::Value IdGetter(const Napi::CallbackInfo& info);
  Napi::Value AliveGetter(const Napi::CallbackInfo& info);
  Napi::ObjectReference clientParamsRef;
  Napi::ObjectReference clientOptionsRef;

  Napi::Value connectionClosedError(const char* suffix);
  ErrorPair connectionCheck(RFC_ERROR_INFO* errorInfo);
  Napi::Value getOperationError(bool conn_closed,
                                const char* operation,
                                ErrorPair connectionCheckError,
                                RFC_ERROR_INFO* errorInfo,
                                Napi::Env env);

  Napi::Value Open(const Napi::CallbackInfo& info);
  Napi::Value Close(const Napi::CallbackInfo& info);
  Napi::Value Invoke(const Napi::CallbackInfo& info);

  RfmErrorPath errorPath;

  void init() {
    id = Client::_id++;
    connectionHandle = nullptr;
  };

  static uint_t _id;
  std::mutex invocationMutex;

  uint_t id;
  RFC_CONNECTION_HANDLE connectionHandle;

  ConnectionParamsStruct client_params = ConnectionParamsStruct(0, nullptr);
  ClientOptionsStruct client_options;

  void LockMutex();
  void UnlockMutex();
};

}  // namespace node_rfc

#endif

// SPDX-FileCopyrightText: 2014 SAP SE Srdjan Boskovic <srdjan.boskovic@sap.com>
// SPDX-FileCopyrightText: 2026 sap-rfc-lite contributors
//
// SPDX-License-Identifier: Apache-2.0

#include "Client.h"
#include <mutex>
#include <thread>
#include <tuple>

namespace node_rfc {

uint_t Client::_id = 1;

ErrorPair connectionCheckErrorInit() {
  RFC_ERROR_INFO errorInfo;
  errorInfo.code = RFC_OK;
  return ErrorPair(errorInfo, "");
}

Napi::Value Client::getOperationError(bool conn_closed,
                                      const char* operation,
                                      ErrorPair connectionCheckError,
                                      RFC_ERROR_INFO* errorInfo,
                                      Napi::Env env) {
  Napi::EscapableHandleScope scope(env);
  Napi::Value error = Env().Undefined();
  if (conn_closed) {
    error = connectionClosedError(operation);
  } else if (connectionCheckError.first.code != RFC_OK) {
    error = rfcSdkError(&connectionCheckError.first);
  } else if (connectionCheckError.second.length() > 0) {
    error = nodeRfcError(connectionCheckError.second);
  } else if (errorInfo->code != RFC_OK) {
    error = rfcSdkError(errorInfo);
  }
  return scope.Escape(error);
}

Napi::Object Client::Init(Napi::Env env, Napi::Object exports) {
  Napi::HandleScope scope(env);

  Napi::Function func = DefineClass(
      env,
      "Client",
      {
          InstanceAccessor("_id", &Client::IdGetter, nullptr),
          InstanceAccessor("_alive", &Client::AliveGetter, nullptr),
          InstanceMethod("open", &Client::Open),
          InstanceMethod("close", &Client::Close),
          InstanceMethod("invoke", &Client::Invoke),
      });

  Napi::FunctionReference* constructor = new Napi::FunctionReference();
  *constructor = Napi::Persistent(func);
  constructor->SuppressDestruct();
  env.SetInstanceData(constructor);

  // NOLINTNEXTLINE(clang-analyzer-cplusplus.NewDeleteLeaks)
  exports.Set("Client", func);
  return exports;
}

Napi::Value Client::IdGetter(const Napi::CallbackInfo& info) {
  return Napi::Number::New(info.Env(), id);
}

Napi::Value Client::AliveGetter(const Napi::CallbackInfo& info) {
  return Napi::Boolean::New(info.Env(), connectionHandle != nullptr);
}

Client::Client(const Napi::CallbackInfo& info)
    : Napi::ObjectWrap<Client>(info) {
  init();

  if (!info[0].IsUndefined() && (info[0].IsFunction() || !info[0].IsObject())) {
    Napi::TypeError::New(Env(), "Client connection parameters missing")
        .ThrowAsJavaScriptException();
    return;
  }

  if (info.Length() > 0) {
    clientParamsRef = Napi::Persistent(info[0].As<Napi::Object>());
    getConnectionParams(clientParamsRef.Value(), &client_params);
  }

  if (!info[1].IsUndefined()) {
    clientOptionsRef = Napi::Persistent(info[1].As<Napi::Object>());
    checkClientOptions(clientOptionsRef.Value(), &client_options);
  }

  if (info.Length() > 2) {
    char errmsg[ERRMSG_LENGTH];
    snprintf(errmsg,
             ERRMSG_LENGTH - 1,
             "Client constructor requires max. two arguments, received %zu",
             info.Length());
    Napi::TypeError::New(node_rfc::__env, errmsg).ThrowAsJavaScriptException();
  }
};

Client::~Client(void) {
  if (connectionHandle != nullptr) {
    RFC_ERROR_INFO errorInfo;
    RfcCloseConnection(connectionHandle, &errorInfo);
  }
  if (!clientParamsRef.IsEmpty()) {
    clientParamsRef.Reset();
  }
  if (!clientOptionsRef.IsEmpty()) {
    clientOptionsRef.Reset();
  }
}

Napi::Value Client::connectionClosedError(const char* suffix) {
  return nodeRfcError("RFM client request over closed connection: " +
                      std::string(suffix));
}

class OpenAsync : public Napi::AsyncWorker {
 public:
  OpenAsync(Napi::Function& callback, Client* client)
      : Napi::AsyncWorker(callback), client(client) {}
  ~OpenAsync() {}

  // cppcheck-suppress unusedFunction
  void Execute() {
    client->LockMutex();
    client->connectionHandle =
        RfcOpenConnection(client->client_params.connectionParams,
                          client->client_params.paramSize,
                          &errorInfo);
    if (errorInfo.code != RFC_OK) {
      client->connectionHandle = nullptr;
    }
    client->UnlockMutex();
  }

  // cppcheck-suppress unusedFunction
  void OnOK() {
    if (errorInfo.code != RFC_OK) {
      Callback().Call({rfcSdkError(&errorInfo)});
    } else {
      Callback().Call({});
    }
    Callback().Reset();
  }

 private:
  Client* client;
  RFC_ERROR_INFO errorInfo;
};

class CloseAsync : public Napi::AsyncWorker {
 public:
  CloseAsync(Napi::Function& callback, Client* client)
      : Napi::AsyncWorker(callback), client(client) {}
  ~CloseAsync() {}

  void Execute() {
    client->LockMutex();
    conn_closed = (client->connectionHandle == nullptr);
    if (!conn_closed) {
      RfcCloseConnection(client->connectionHandle, &errorInfo);
      client->connectionHandle = nullptr;
    }
    client->UnlockMutex();
  }

  void OnOK() {
    Napi::HandleScope scope(Env());

    if (conn_closed) {
      Callback().Call({client->connectionClosedError("close()")});
    } else if (errorInfo.code != RFC_OK) {
      Callback().Call({rfcSdkError(&errorInfo)});
    } else {
      Callback().Call({});
    }
    Callback().Reset();
  }

 private:
  Client* client;
  RFC_ERROR_INFO errorInfo;
  bool conn_closed = false;
};

class InvokeAsync : public Napi::AsyncWorker {
 public:
  InvokeAsync(Napi::Function& callback,
              Client* client,
              RFC_FUNCTION_HANDLE functionHandle,
              RFC_FUNCTION_DESC_HANDLE functionDescHandle)
      : Napi::AsyncWorker(callback),
        client(client),
        functionHandle(functionHandle),
        functionDescHandle(functionDescHandle) {}
  ~InvokeAsync() {}

  void Execute() {
    client->LockMutex();
    conn_closed = (client->connectionHandle == nullptr);
    if (!conn_closed) {
      RfcInvoke(client->connectionHandle, functionHandle, &errorInfo);
      if (errorInfo.code != RFC_OK) {
        connectionCheckError = client->connectionCheck(&errorInfo);
      }
    }
  }

  void OnOK() {
    Napi::HandleScope scope(Env());

    std::string closed_errmsg =
        "invoke() " + wrapString(client->errorPath.functionName)
                          .As<Napi::String>()
                          .Utf8Value();
    ValuePair result =
        ValuePair(client->getOperationError(conn_closed,
                                            closed_errmsg.c_str(),
                                            connectionCheckError,
                                            &errorInfo,
                                            Env()),
                  Env().Undefined());

    if (result.first.IsUndefined()) {
      result = getRfmParameters(functionDescHandle,
                                functionHandle,
                                &client->errorPath,
                                &client->client_options);
    }

    RfcDestroyFunction(functionHandle, nullptr);
    client->UnlockMutex();

    Callback().Call({result.first, result.second});
    Callback().Reset();
  }

 private:
  Client* client;
  RFC_FUNCTION_HANDLE functionHandle;
  RFC_FUNCTION_DESC_HANDLE functionDescHandle;
  RFC_ERROR_INFO errorInfo;
  bool conn_closed = false;
  ErrorPair connectionCheckError = connectionCheckErrorInit();
};

class PrepareAsync : public Napi::AsyncWorker {
 public:
  PrepareAsync(Napi::Function& callback,
               Client* client,
               Napi::String rfmName,
               Napi::Array& notRequestedParameters,
               Napi::Object& rfmParams)
      : Napi::AsyncWorker(callback),
        client(client),
        notRequested(Napi::Persistent(notRequestedParameters)),
        rfmParams(Napi::Persistent(rfmParams)) {
    funcName = setString(rfmName);
    client->errorPath.setFunctionName(funcName);
  }
  ~PrepareAsync() { delete[] funcName; }

  void Execute() {
    client->LockMutex();
    conn_closed = (client->connectionHandle == nullptr);
    if (!conn_closed) {
      functionDescHandle =
          RfcGetFunctionDesc(client->connectionHandle, funcName, &errorInfo);
    }
  }

  void OnOK() {
    client->UnlockMutex();
    RFC_FUNCTION_HANDLE functionHandle = nullptr;
    Napi::Value argv[2] = {Env().Undefined(), Env().Undefined()};

    if (conn_closed) {
      std::string errmsg =
          "invoke() " + wrapString(client->errorPath.functionName)
                            .As<Napi::String>()
                            .Utf8Value();
      argv[0] = client->connectionClosedError(errmsg.c_str());
    } else if (functionDescHandle == nullptr || errorInfo.code != RFC_OK) {
      argv[0] = rfcSdkError(&errorInfo);
    } else {
      // function descriptor handle created, proceed with function handle
      functionHandle = RfcCreateFunction(functionDescHandle, &errorInfo);

      if (errorInfo.code != RFC_OK) {
        argv[0] = rfcSdkError(&errorInfo);
      } else {
        for (uint_t i = 0; i < notRequested.Value().Length(); i++) {
          Napi::String name = notRequested.Value().Get(i).ToString();
          SAP_UC* paramName = setString(name);
          RFC_RC rc =
              RfcSetParameterActive(functionHandle, paramName, 0, &errorInfo);
          delete[] paramName;
          if (rc != RFC_OK) {
            argv[0] = rfcSdkError(&errorInfo);
            break;
          }
        }
      }
    }

    notRequested.Reset();

    if (argv[0].IsUndefined()) {
      Napi::Object params = rfmParams.Value();
      Napi::Array paramNames = params.GetPropertyNames();
      uint_t paramSize = paramNames.Length();

      for (uint_t i = 0; i < paramSize; i++) {
        Napi::String name = paramNames.Get(i).ToString();
        Napi::Value value = params.Get(name);
        argv[0] = setRfmParameter(functionDescHandle,
                                  functionHandle,
                                  name,
                                  value,
                                  &client->errorPath,
                                  &client->client_options);

        if (!argv[0].IsUndefined()) {
          break;
        }
      }
    }

    rfmParams.Reset();

    if (argv[0].IsUndefined()) {
      Napi::Function callbackFunction = Callback().Value().As<Napi::Function>();
      (new InvokeAsync(
           callbackFunction, client, functionHandle, functionDescHandle))
          ->Queue();
    } else {
      Callback().Call({argv[0], argv[1]});
      Callback().Reset();
    }
  }

 private:
  Client* client;
  SAP_UC* funcName;

  Napi::Reference<Napi::Array> notRequested;
  Napi::Reference<Napi::Object> rfmParams;

  RFC_FUNCTION_DESC_HANDLE functionDescHandle;
  RFC_ERROR_INFO errorInfo;
  bool conn_closed = false;
};

ErrorPair Client::connectionCheck(RFC_ERROR_INFO* errorInfo) {
  RFC_ERROR_INFO errorInfoOpen;

  errorInfoOpen.code = RFC_OK;

  if (
      errorInfo->code == RFC_COMMUNICATION_FAILURE ||
      errorInfo->code == RFC_ABAP_RUNTIME_FAILURE ||
      errorInfo->code == RFC_ABAP_MESSAGE ||
      errorInfo->code == RFC_EXTERNAL_FAILURE ||
      errorInfo->group == ABAP_RUNTIME_FAILURE ||
      errorInfo->group == LOGON_FAILURE ||
      errorInfo->group == COMMUNICATION_FAILURE ||
      errorInfo->group == EXTERNAL_RUNTIME_FAILURE)
  {
    RFC_CONNECTION_HANDLE new_handle;
    this->connectionHandle = nullptr;
    new_handle = RfcOpenConnection(client_params.connectionParams,
                                   client_params.paramSize,
                                   &errorInfoOpen);
    if (errorInfoOpen.code == RFC_OK) {
      this->connectionHandle = new_handle;
    }
  }

  return ErrorPair(errorInfoOpen, "");
}

Napi::Value Client::Open(const Napi::CallbackInfo& info) {
  if (!info[0].IsFunction()) {
    Napi::TypeError::New(info.Env(),
                         "Client open() requires a callback function")
        .ThrowAsJavaScriptException();
    return info.Env().Undefined();
  }

  Napi::Function callback = info[0].As<Napi::Function>();

  (new OpenAsync(callback, this))->Queue();

  return info.Env().Undefined();
}

Napi::Value Client::Close(const Napi::CallbackInfo& info) {
  if (!info[0].IsFunction()) {
    Napi::TypeError::New(info.Env(),
                         "Client close() requires a callback function")
        .ThrowAsJavaScriptException();
    return info.Env().Undefined();
  }

  Napi::Function callback = info[0].As<Napi::Function>();

  (new CloseAsync(callback, this))->Queue();

  return info.Env().Undefined();
}

Napi::Value Client::Invoke(const Napi::CallbackInfo& info) {
  Napi::Array notRequested = Napi::Array::New(info.Env());
  Napi::Value bcd;

  if (!info[2].IsFunction()) {
    Napi::TypeError::New(info.Env(),
                         "Client invoke() requires a callback function")
        .ThrowAsJavaScriptException();
    return info.Env().Undefined();
  }

  Napi::Function callback = info[2].As<Napi::Function>();

  if (info[3].IsObject()) {
    Napi::Object options = info[3].ToObject();
    Napi::Array props = options.GetPropertyNames();
    for (uint_t i = 0; i < props.Length(); i++) {
      Napi::String key = props.Get(i).ToString();
      if (key.Utf8Value().compare(std::string(CALL_OPTION_KEY_NOTREQUESTED)) ==
          (int)0) {
        notRequested = options.Get(key).As<Napi::Array>();
      } else if (key.Utf8Value().compare(
                     std::string(CALL_OPTION_KEY_TIMEOUT)) == (int)0) {
        // timeout = options.Get(key).As<Napi::Array>();
      } else {
        char err[ERRMSG_LENGTH];
        std::string optionName = key.Utf8Value();
        snprintf(err, ERRMSG_LENGTH - 1, "Unknown option: %s", &optionName[0]);
        Napi::TypeError::New(node_rfc::__env, err).ThrowAsJavaScriptException();
      }
    }
  }

  Napi::String rfmName = info[0].As<Napi::String>();
  Napi::Object rfmParams = info[1].As<Napi::Object>();

  (new PrepareAsync(callback, this, rfmName, notRequested, rfmParams))->Queue();

  return info.Env().Undefined();
}

void Client::LockMutex() {
  invocationMutex.lock();
}

void Client::UnlockMutex() {
  invocationMutex.unlock();
}

}  // namespace node_rfc

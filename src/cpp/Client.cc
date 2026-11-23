// SPDX-FileCopyrightText: 2014 SAP SE Srdjan Boskovic <srdjan.boskovic@sap.com>
// SPDX-FileCopyrightText: 2026 sap-rfc-lite contributors
//
// SPDX-License-Identifier: Apache-2.0

#include "Client.h"
#include "connectionEnd.h"
#include "passport.h"
#include <memory>
#include <thread>
#include <tuple>

namespace node_rfc {

uint_t Client::_id = 1;

Napi::Value Client::getOperationError(bool conn_closed,
                                      const char* operation,
                                      RFC_ERROR_INFO* errorInfo,
                                      Napi::Env env) {
  Napi::EscapableHandleScope scope(env);
  Napi::Value error = Env().Undefined();
  if (conn_closed) {
    error = connectionClosedError(operation);
  } else if (errorInfo->code != RFC_OK) {
    error = rfcSdkError(errorInfo);
  }
  return scope.Escape(error);
}

// Called under the client's invocation hold, on the worker thread, right after an
// operation on the open handle failed. On an error that leaves the connection
// unusable (endsConnection) the handle is closed once and released: `alive`
// turns false and every later operation answers the closed-connection error
// until the caller opens the connection again. The library never opens one
// itself. The close has its own error info, so the operation's error is what
// is answered; its answer is ignored (after these errors the SDK answers
// RFC_INVALID_HANDLE, measured, and SAP says it "can usually be ignored").
void Client::releaseIfEnded(const RFC_ERROR_INFO& errorInfo) {
  if (connectionHandle == nullptr || !endsConnection(errorInfo)) {
    return;
  }
  RFC_ERROR_INFO closeErrorInfo;
  RfcCloseConnection(connectionHandle, &closeErrorInfo);
  connectionHandle = nullptr;
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
          InstanceMethod("resetServerContext", &Client::ResetServerContext),
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

// Owns an RFC function handle: RfcDestroyFunction runs exactly once, on every
// path, when the owner is reset or destroyed. Moved from PrepareAsync into
// InvokeAsync.
class OwnedFunction {
 public:
  OwnedFunction() = default;
  explicit OwnedFunction(RFC_FUNCTION_HANDLE handle) : handle(handle) {}
  OwnedFunction(OwnedFunction&& other) noexcept : handle(other.handle) {
    other.handle = nullptr;
  }
  OwnedFunction& operator=(OwnedFunction&& other) noexcept {
    if (this != &other) {
      reset();
      handle = other.handle;
      other.handle = nullptr;
    }
    return *this;
  }
  OwnedFunction(const OwnedFunction&) = delete;
  OwnedFunction& operator=(const OwnedFunction&) = delete;
  ~OwnedFunction() { reset(); }

  RFC_FUNCTION_HANDLE get() const { return handle; }
  void reset() {
    if (handle != nullptr) {
      RfcDestroyFunction(handle, nullptr);
      handle = nullptr;
    }
  }

 private:
  RFC_FUNCTION_HANDLE handle = nullptr;
};

// What a throw while an answer was being built is answered with.
Napi::Value thrownError(const Napi::Error& e) {
  return e.Value();
}
Napi::Value thrownError(const std::exception& e) {
  return nodeRfcError(e.what());
}

// Queues a worker; the caller keeps ownership until Queue() has succeeded, so
// a Queue() that throws leaks nothing.
template <typename Worker>
void queueOwned(std::unique_ptr<Worker> worker) {
  worker->Queue();
  worker.release();
}

class OpenAsync : public HeldWorker {
 public:
  OpenAsync(Napi::Function& callback, Client* client)
      : HeldWorker(callback, client->invocationHold, client->Value()), client(client) {}
  ~OpenAsync() {}

  // cppcheck-suppress unusedFunction
  void Execute() {
    Hold();
    client->connectionHandle =
        RfcOpenConnection(client->client_params.connectionParams,
                          client->client_params.paramSize,
                          &errorInfo);
    if (errorInfo.code != RFC_OK) {
      client->connectionHandle = nullptr;
    }
    Release();
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

class CloseAsync : public HeldWorker {
 public:
  CloseAsync(Napi::Function& callback, Client* client)
      : HeldWorker(callback, client->invocationHold, client->Value()), client(client) {}
  ~CloseAsync() {}

  void Execute() {
    Hold();
    conn_closed = (client->connectionHandle == nullptr);
    if (!conn_closed) {
      RfcCloseConnection(client->connectionHandle, &errorInfo);
      client->connectionHandle = nullptr;
    }
    Release();
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

// RfcResetServerContext: ends the ABAP session context ("user context") the
// connection holds and keeps the connection open, so the next call runs in a
// fresh context without a new logon.
class ResetServerContextAsync : public HeldWorker {
 public:
  ResetServerContextAsync(Napi::Function& callback, Client* client)
      : HeldWorker(callback, client->invocationHold, client->Value()), client(client) {}
  ~ResetServerContextAsync() {}

  void Execute() {
    Hold();
    conn_closed = (client->connectionHandle == nullptr);
    if (!conn_closed) {
      RfcResetServerContext(client->connectionHandle, &errorInfo);
      if (errorInfo.code != RFC_OK) {
        client->releaseIfEnded(errorInfo);
      }
    }
    Release();
  }

  void OnOK() {
    Napi::HandleScope scope(Env());
    if (conn_closed) {
      Callback().Call({client->connectionClosedError("resetServerContext()")});
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

class InvokeAsync : public HeldWorker {
 public:
  InvokeAsync(Napi::Function& callback,
              Client* client,
              OwnedFunction functionHandle,
              RFC_FUNCTION_DESC_HANDLE functionDescHandle,
              bool hasPassport,
              std::vector<unsigned char> passport)
      : HeldWorker(callback, client->invocationHold, client->Value()),
        client(client),
        functionHandle(std::move(functionHandle)),
        functionDescHandle(functionDescHandle),
        hasPassport(hasPassport),
        passport(std::move(passport)) {}
  ~InvokeAsync() {}

  void Execute() {
    Hold();
    conn_closed = (client->connectionHandle == nullptr);
    if (!conn_closed) {
      // The passport reaches this call only: set for this thread and handle
      // immediately before RfcInvoke, cleared immediately after it.
      beginCallPassport(hasPassport ? &passport : nullptr,
                        client->connectionHandle);
      RfcInvoke(client->connectionHandle, functionHandle.get(), &errorInfo);
      passportOutcome = endCallPassport();
      if (errorInfo.code != RFC_OK) {
        client->releaseIfEnded(errorInfo);
      }
    }
  }

  void OnOK() {
    // Gives the hold back if anything below throws; installed before any
    // completion work, the HandleScope included.
    struct ReleaseOnThrow {
      InvokeAsync* worker;
      ~ReleaseOnThrow() { worker->Release(); }
    } releaseOnThrow{this};
    Napi::HandleScope scope(Env());

    ValuePair result(Env().Undefined(), Env().Undefined());
    {
      OwnedFunction function = std::move(functionHandle);
      try {
        result = answer(function.get());
      } catch (const Napi::Error& e) {
        result = ValuePair(thrownError(e), Env().Undefined());
      } catch (const std::exception& e) {
        result = ValuePair(thrownError(e), Env().Undefined());
      }
      function.reset();
    }
    // After the result has been read and the function handle destroyed.
    Release();

    Callback().Call({result.first, result.second});
    Callback().Reset();
  }

 private:
  // The call's answer: its error, or its parameters read from the function.
  ValuePair answer(RFC_FUNCTION_HANDLE function) {
    std::string closed_errmsg =
        "invoke() " + wrapString(client->errorPath.functionName)
                          .As<Napi::String>()
                          .Utf8Value();
    ValuePair result =
        ValuePair(client->getOperationError(conn_closed,
                                            closed_errmsg.c_str(),
                                            &errorInfo,
                                            Env()),
                  Env().Undefined());

    if (result.first.IsUndefined() && passportOutcome.notPlaced) {
      // The call ran on the system without its passport, which did not fit
      // the buffer the SDK offered; what the call did there remains. Its
      // result is not returned.
      result.first = nodeRfcError(
          "invoke() " +
          wrapString(client->errorPath.functionName)
              .As<Napi::String>()
              .Utf8Value() +
          ": the call ran without the passport, which is " +
          std::to_string(passport.size()) + " bytes, longer than the " +
          std::to_string(passportOutcome.offered) +
          " bytes the SDK offered for it; what the call did in the system "
          "remains");
    } else if (result.first.IsUndefined()) {
      result = getRfmParameters(functionDescHandle,
                                function,
                                &client->errorPath,
                                &client->client_options);
    }
    return result;
  }

  Client* client;
  OwnedFunction functionHandle;
  RFC_FUNCTION_DESC_HANDLE functionDescHandle;
  RFC_ERROR_INFO errorInfo;
  bool conn_closed = false;
  bool hasPassport;
  std::vector<unsigned char> passport;
  PassportOutcome passportOutcome;
};

class PrepareAsync : public HeldWorker {
 public:
  PrepareAsync(Napi::Function& callback,
               Client* client,
               Napi::String rfmName,
               Napi::Array& notRequestedParameters,
               Napi::Object& rfmParams,
               bool hasPassport,
               std::vector<unsigned char> passport)
      : HeldWorker(callback, client->invocationHold, client->Value()),
        client(client),
        notRequested(Napi::Persistent(notRequestedParameters)),
        rfmParams(Napi::Persistent(rfmParams)),
        hasPassport(hasPassport),
        passport(std::move(passport)) {
    funcName = setString(rfmName);
    client->errorPath.setFunctionName(funcName);
  }
  ~PrepareAsync() { delete[] funcName; }

  void Execute() {
    Hold();
    conn_closed = (client->connectionHandle == nullptr);
    if (!conn_closed) {
      functionDescHandle =
          RfcGetFunctionDesc(client->connectionHandle, funcName, &errorInfo);
      if (errorInfo.code != RFC_OK) {
        client->releaseIfEnded(errorInfo);
      }
    }
  }

  void OnOK() {
    Release();
    Napi::HandleScope scope(Env());
    Napi::Value error = Env().Undefined();
    try {
      OwnedFunction function;
      error = prepare(function);
      if (error.IsUndefined()) {
        Napi::Function callbackFunction = Callback().Value();
        queueOwned(std::make_unique<InvokeAsync>(callbackFunction,
                                                 client,
                                                 std::move(function),
                                                 functionDescHandle,
                                                 hasPassport,
                                                 std::move(passport)));
        return;
      }
    } catch (const Napi::Error& e) {
      error = thrownError(e);
    } catch (const std::exception& e) {
      error = thrownError(e);
    }
    // The function handle, if one was created, is destroyed by now.
    Callback().Call({error, Env().Undefined()});
    Callback().Reset();
  }

 private:
  // Creates the call's function handle into `function` and sets its
  // parameters; answers the error, or undefined when the call can be sent.
  Napi::Value prepare(OwnedFunction& function) {
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
      function = OwnedFunction(RfcCreateFunction(functionDescHandle, &errorInfo));

      if (errorInfo.code != RFC_OK) {
        argv[0] = rfcSdkError(&errorInfo);
      } else {
        for (uint_t i = 0; i < notRequested.Value().Length(); i++) {
          Napi::String name = notRequested.Value().Get(i).ToString();
          SAP_UC* paramName = setString(name);
          RFC_RC rc =
              RfcSetParameterActive(function.get(), paramName, 0, &errorInfo);
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
                                  function.get(),
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
    return argv[0];
  }

  Client* client;
  SAP_UC* funcName;

  Napi::Reference<Napi::Array> notRequested;
  Napi::Reference<Napi::Object> rfmParams;

  RFC_FUNCTION_DESC_HANDLE functionDescHandle;
  RFC_ERROR_INFO errorInfo;
  bool conn_closed = false;
  bool hasPassport;
  std::vector<unsigned char> passport;
};

Napi::Value Client::Open(const Napi::CallbackInfo& info) {
  if (!info[0].IsFunction()) {
    Napi::TypeError::New(info.Env(),
                         "Client open() requires a callback function")
        .ThrowAsJavaScriptException();
    return info.Env().Undefined();
  }

  Napi::Function callback = info[0].As<Napi::Function>();

  queueOwned(std::make_unique<OpenAsync>(callback, this));

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

  queueOwned(std::make_unique<CloseAsync>(callback, this));

  return info.Env().Undefined();
}

Napi::Value Client::ResetServerContext(const Napi::CallbackInfo& info) {
  if (!info[0].IsFunction()) {
    Napi::TypeError::New(
        info.Env(), "Client resetServerContext() requires a callback function")
        .ThrowAsJavaScriptException();
    return info.Env().Undefined();
  }
  Napi::Function callback = info[0].As<Napi::Function>();
  queueOwned(std::make_unique<ResetServerContextAsync>(callback, this));
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

  // The call's passport, copied now: a caller that changes its Buffer later
  // changes nothing that is sent. The Client holds no passport.
  bool hasPassport = false;
  std::vector<unsigned char> passport;

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
      } else if (key.Utf8Value().compare(
                     std::string(CALL_OPTION_KEY_PASSPORT)) == (int)0) {
        Napi::Value value = options.Get(key);
        if (!value.IsBuffer()) {
          Napi::TypeError::New(info.Env(), "The passport must be a Buffer")
              .ThrowAsJavaScriptException();
          return info.Env().Undefined();
        }
        Napi::Buffer<unsigned char> bytes = value.As<Napi::Buffer<unsigned char>>();
        passport.assign(bytes.Data(), bytes.Data() + bytes.Length());
        hasPassport = true;
      } else {
        char err[ERRMSG_LENGTH];
        std::string optionName = key.Utf8Value();
        snprintf(err, ERRMSG_LENGTH - 1, "Unknown option: %s", &optionName[0]);
        Napi::TypeError::New(node_rfc::__env, err).ThrowAsJavaScriptException();
      }
    }
  }

  // A call given a passport while the passport manager could not be installed
  // is refused with the installer's error, before anything is queued or sent.
  Napi::Value refusal =
      passportCallRefusal(hasPassport, passportManagerInstall());
  if (!refusal.IsUndefined()) {
    callback.Call({refusal});
    return info.Env().Undefined();
  }

  Napi::String rfmName = info[0].As<Napi::String>();
  Napi::Object rfmParams = info[1].As<Napi::Object>();

  queueOwned(std::make_unique<PrepareAsync>(callback,
                                            this,
                                            rfmName,
                                            notRequested,
                                            rfmParams,
                                            hasPassport,
                                            std::move(passport)));

  return info.Env().Undefined();
}

}  // namespace node_rfc

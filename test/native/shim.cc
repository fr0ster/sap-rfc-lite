// SPDX-FileCopyrightText: 2026 sap-rfc-lite contributors
// SPDX-License-Identifier: Apache-2.0

// The test-only addon's shim: exposes the shipped addon's pure decisions
// (compiled from src/cpp/) to test/native.test.ts, and the SDK's code and group
// numbers by name. It also exports the shipped Client (src/cpp/Client.cc) over
// a fake connection: the SDK calls that need a system (open, close, reset,
// function lookup, invoke) are defined here, so the test addon's own
// definitions are found before the SDK's; everything else is the real SDK.
// Nothing here is shipped.

#include "Client.h"
#include "connectionEnd.h"
#include "invocationHold.h"
#include "nwrfcsdk.h"
#include "passport.h"

#ifndef SAPonNT
#include <dlfcn.h>
#endif

#include <atomic>
#include <map>
#include <mutex>
#include <stdexcept>
#include <string>
#include <thread>
#include <vector>

namespace node_rfc {
Napi::Env __env = nullptr;

struct ClientProbe {
  static size_t waiting(Client* client) {
    return client->invocationHold.waiting();
  }
};
}  // namespace node_rfc

#ifndef SAPonNT
// The fake connection (Linux and macOS: the test addon's own definitions are
// found before the SDK's, and RTLD_NEXT reaches the SDK's). A function's behaviour in RfcInvoke is named by its
// name: Z_GATE waits (yielding, never sleeping) until the test opens the gate;
// Z_THROW throws, so the worker's Execute throws; Z_BCD has one BCD export
// parameter, so reading its result calls the client's bcd transformer; any
// other name returns at once. RfcCreateFunction and RfcDestroyFunction are the
// SDK's, counted.
namespace {

struct Fake {
  std::mutex mutex;
  std::map<std::string, RFC_FUNCTION_DESC_HANDLE> descs;
  std::map<RFC_FUNCTION_DESC_HANDLE, std::string> names;
};
Fake& fake() {
  static Fake state;
  return state;
}
std::atomic<int> invokesNow{0};
std::atomic<int> invokesMax{0};
std::atomic<int> invokesEntered{0};
std::atomic<bool> gateOpen{false};
std::atomic<int> functionsCreated{0};
std::atomic<int> functionsDestroyed{0};
int fakeConnection = 0;

void ok(RFC_ERROR_INFO* errorInfo) {
  if (errorInfo != nullptr) {
    *errorInfo = RFC_ERROR_INFO{};
    errorInfo->code = RFC_OK;
  }
}

std::string narrow(const SAP_UC* text) {
  std::string out;
  for (; *text != 0; ++text) {
    out.push_back(static_cast<char>(*text));
  }
  return out;
}

void copyName(const char* from, SAP_UC* to) {
  for (; *from != 0; ++from, ++to) {
    *to = static_cast<SAP_UC>(*from);
  }
  *to = 0;
}

template <typename F>
F next(const char* name) {
  return reinterpret_cast<F>(dlsym(RTLD_NEXT, name));
}

}  // namespace

extern "C" {

RFC_CONNECTION_HANDLE SAP_API RfcOpenConnection(RFC_CONNECTION_PARAMETER const*,
                                                unsigned,
                                                RFC_ERROR_INFO* errorInfo) {
  ok(errorInfo);
  return reinterpret_cast<RFC_CONNECTION_HANDLE>(&fakeConnection);
}

RFC_RC SAP_API RfcCloseConnection(RFC_CONNECTION_HANDLE,
                                  RFC_ERROR_INFO* errorInfo) {
  ok(errorInfo);
  return RFC_OK;
}

RFC_RC SAP_API RfcResetServerContext(RFC_CONNECTION_HANDLE,
                                     RFC_ERROR_INFO* errorInfo) {
  ok(errorInfo);
  return RFC_OK;
}

RFC_FUNCTION_DESC_HANDLE SAP_API RfcGetFunctionDesc(RFC_CONNECTION_HANDLE,
                                                    SAP_UC const* funcName,
                                                    RFC_ERROR_INFO* errorInfo) {
  std::string name = narrow(funcName);
  std::lock_guard<std::mutex> lock(fake().mutex);
  auto found = fake().descs.find(name);
  if (found != fake().descs.end()) {
    ok(errorInfo);
    return found->second;
  }
  RFC_FUNCTION_DESC_HANDLE desc = RfcCreateFunctionDesc(funcName, errorInfo);
  if (desc != nullptr && name == "Z_BCD") {
    RFC_PARAMETER_DESC param = {};
    copyName("RESULT", param.name);
    param.type = RFCTYPE_BCD;
    param.direction = RFC_EXPORT;
    param.nucLength = 8;
    param.ucLength = 8;
    param.decimals = 2;
    RfcAddParameter(desc, &param, errorInfo);
  }
  if (desc != nullptr) {
    fake().descs[name] = desc;
    fake().names[desc] = name;
  }
  return desc;
}

RFC_RC SAP_API RfcInvoke(RFC_CONNECTION_HANDLE,
                         RFC_FUNCTION_HANDLE funcHandle,
                         RFC_ERROR_INFO* errorInfo) {
  RFC_FUNCTION_DESC_HANDLE desc = RfcDescribeFunction(funcHandle, nullptr);
  std::string name;
  {
    std::lock_guard<std::mutex> lock(fake().mutex);
    name = fake().names[desc];
  }
  ok(errorInfo);
  if (name == "Z_THROW") {
    throw std::runtime_error("the fake RfcInvoke threw");
  }
  int now = ++invokesNow;
  int seen = invokesMax.load();
  while (now > seen && !invokesMax.compare_exchange_weak(seen, now)) {
  }
  ++invokesEntered;
  if (name == "Z_GATE") {
    while (!gateOpen.load()) {
      std::this_thread::yield();
    }
  }
  --invokesNow;
  return RFC_OK;
}

RFC_FUNCTION_HANDLE SAP_API RfcCreateFunction(RFC_FUNCTION_DESC_HANDLE funcDesc,
                                              RFC_ERROR_INFO* errorInfo) {
  using Create = RFC_FUNCTION_HANDLE(SAP_API*)(RFC_FUNCTION_DESC_HANDLE,
                                               RFC_ERROR_INFO*);
  static Create create = next<Create>("RfcCreateFunction");
  RFC_FUNCTION_HANDLE handle = create(funcDesc, errorInfo);
  if (handle != nullptr) {
    ++functionsCreated;
  }
  return handle;
}

RFC_RC SAP_API RfcDestroyFunction(RFC_FUNCTION_HANDLE funcHandle,
                                  RFC_ERROR_INFO* errorInfo) {
  using Destroy = RFC_RC(SAP_API*)(RFC_FUNCTION_HANDLE, RFC_ERROR_INFO*);
  static Destroy destroy = next<Destroy>("RfcDestroyFunction");
  ++functionsDestroyed;
  return destroy(funcHandle, errorInfo);
}

}  // extern "C"
#endif  // SAPonNT

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

// passportCallAnswer(hasPassport, installCode, installGroup): the answer to a
// call given that install result.
Napi::Value PassportCallAnswer(const Napi::CallbackInfo& info) {
  RFC_ERROR_INFO install = {};
  install.code = static_cast<RFC_RC>(info[1].As<Napi::Number>().Int32Value());
  install.group =
      static_cast<RFC_ERROR_GROUP>(info[2].As<Napi::Number>().Int32Value());
  return node_rfc::passportCallRefusal(info[0].As<Napi::Boolean>().Value(),
                                       install);
}

// placePassport(passport, offered, length): the decision over a buffer of
// offered + 16 bytes of 0xEE, so that a write past `offered` shows.
Napi::Value PlacePassport(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  Napi::Buffer<unsigned char> passport =
      info[0].As<Napi::Buffer<unsigned char>>();
  size_t offered = info[1].As<Napi::Number>().Uint32Value();
  size_t length = info[2].As<Napi::Number>().Uint32Value();
  std::vector<SAP_RAW> buffer(offered + 16, 0xEE);
  bool placed = node_rfc::placePassport(
      passport.Data(), passport.Length(), buffer.data(), offered, &length);
  Napi::Object result = Napi::Object::New(env);
  result.Set("placed", placed);
  result.Set("length", static_cast<double>(length));
  result.Set("buffer",
             Napi::Buffer<unsigned char>::Copy(env, buffer.data(), buffer.size()));
  return result;
}

// Two distinct stand-ins for connection handles; never dereferenced.
int ownConnection = 0;
int otherConnection = 0;

// callbackView(which, passport, sameHandle, offered, lengthIn): what the
// passport manager's callback `which` ('start' or 'end') leaves in a buffer of
// `offered` + 16 bytes of 0xEE whose length the SDK offers as `lengthIn`. For
// 'start', `passport` (a Buffer, or null for a call given none) is set as the
// call's passport on the own handle, and the callback is called on the own
// handle or on another one.
Napi::Value CallbackView(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  std::string which = info[0].As<Napi::String>().Utf8Value();
  bool given = info[1].IsBuffer();
  std::vector<unsigned char> passport;
  if (given) {
    Napi::Buffer<unsigned char> bytes = info[1].As<Napi::Buffer<unsigned char>>();
    passport.assign(bytes.Data(), bytes.Data() + bytes.Length());
  }
  bool sameHandle = info[2].As<Napi::Boolean>().Value();
  size_t offered = info[3].As<Napi::Number>().Uint32Value();
  size_t length = info[4].As<Napi::Number>().Uint32Value();
  std::vector<SAP_RAW> buffer(offered + 16, 0xEE);
  RFC_CONNECTION_HANDLE own = reinterpret_cast<RFC_CONNECTION_HANDLE>(&ownConnection);
  RFC_CONNECTION_HANDLE other =
      reinterpret_cast<RFC_CONNECTION_HANDLE>(&otherConnection);
  node_rfc::PassportOutcome outcome;
  if (which == "end") {
    node_rfc::passportOnClientCallEnd(own, nullptr, buffer.data(), offered, &length);
  } else {
    node_rfc::beginCallPassport(given ? &passport : nullptr, own);
    node_rfc::passportOnClientCallStart(
        sameHandle ? own : other, nullptr, buffer.data(), offered, &length);
    outcome = node_rfc::endCallPassport();
  }
  Napi::Object result = Napi::Object::New(env);
  result.Set("length", static_cast<double>(length));
  result.Set("notPlaced", outcome.notPlaced);
  result.Set("buffer",
             Napi::Buffer<unsigned char>::Copy(env, buffer.data(), buffer.size()));
  return result;
}

// One client's hold, and what the workers on it saw.
struct HoldState {
  node_rfc::InvocationHold hold;
  std::atomic<int> holders{0};
  std::atomic<int> maxHolders{0};
  std::atomic<int> entered{0};
  std::atomic<bool> sawWaiter{false};
};

// holdState(): a fresh hold, as one client has.
Napi::Value NewHoldState(const Napi::CallbackInfo& info) {
  return Napi::External<HoldState>::New(
      info.Env(), new HoldState(), [](Napi::Env, HoldState* state) {
        delete state;
      });
}

// A worker that holds the hold as the client's workers do: Hold() in
// Execute, Release() in OnOK (after its result), and HeldWorker's OnError.
//   'overlap': once held, waits until another worker is waiting for the hold
//     (it did wait) or has entered too (it did not: an overlap); yields, never
//     sleeps. Two of them must be queued at once (the default thread pool).
//   'plain': holds and gives back.
//   'throws': holds, then Execute throws, so the worker ends in OnError.
class HoldWorker : public node_rfc::HeldWorker {
 public:
  HoldWorker(Napi::Function& callback,
             HoldState* state,
             std::string kind,
             Napi::External<HoldState> stateRef)
      : node_rfc::HeldWorker(callback, state->hold),
        state(state),
        kind(std::move(kind)),
        stateRef(Napi::Persistent(stateRef)) {}

  void Execute() override {
    Hold();
    int now = ++state->holders;
    int seen = state->maxHolders.load();
    while (now > seen && !state->maxHolders.compare_exchange_weak(seen, now)) {
    }
    ++state->entered;
    if (kind == "throws") {
      throw std::runtime_error("the test worker's own failure");
    }
    if (kind == "overlap") {
      while (true) {
        if (state->hold.waiting() > 0) {
          state->sawWaiter = true;
          break;
        }
        if (state->entered.load() >= 2) {
          break;
        }
        std::this_thread::yield();
      }
    }
  }

  void OnOK() override {
    --state->holders;
    Release();
    Napi::Env env = Env();
    Napi::Object result = Napi::Object::New(env);
    result.Set("maxHolders", static_cast<double>(state->maxHolders.load()));
    result.Set("sawWaiter", state->sawWaiter.load());
    Callback().Call({env.Null(), result});
  }

  void OnError(const Napi::Error& e) override {
    --state->holders;
    node_rfc::HeldWorker::OnError(e);
  }

 private:
  HoldState* state;
  std::string kind;
  // Keeps the hold alive while the worker is queued.
  Napi::Reference<Napi::External<HoldState>> stateRef;
};

// heldWork(state, kind, callback(error, { maxHolders, sawWaiter })).
Napi::Value HeldWork(const Napi::CallbackInfo& info) {
  Napi::External<HoldState> stateObject = info[0].As<Napi::External<HoldState>>();
  HoldState* state = stateObject.Data();
  std::string kind = info[1].As<Napi::String>().Utf8Value();
  Napi::Function callback = info[2].As<Napi::Function>();
  (new HoldWorker(callback, state, kind, stateObject))->Queue();
  return info.Env().Undefined();
}

#ifndef SAPonNT
// fake: what the fake connection saw, and its gate.
Napi::Value FakeReset(const Napi::CallbackInfo& info) {
  invokesNow = 0;
  invokesMax = 0;
  invokesEntered = 0;
  gateOpen = false;
  return info.Env().Undefined();
}

Napi::Value FakeOpenGate(const Napi::CallbackInfo& info) {
  gateOpen = true;
  return info.Env().Undefined();
}

Napi::Value FakeStats(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  Napi::Object stats = Napi::Object::New(env);
  stats.Set("invokesMax", static_cast<double>(invokesMax.load()));
  stats.Set("invokesEntered", static_cast<double>(invokesEntered.load()));
  stats.Set("functionsCreated", static_cast<double>(functionsCreated.load()));
  stats.Set("functionsDestroyed",
            static_cast<double>(functionsDestroyed.load()));
  return stats;
}

// waiting(client): how many operations wait for that client's hold now.
Napi::Value FakeWaiting(const Napi::CallbackInfo& info) {
  node_rfc::Client* client =
      Napi::ObjectWrap<node_rfc::Client>::Unwrap(info[0].As<Napi::Object>());
  return Napi::Number::New(
      info.Env(), static_cast<double>(node_rfc::ClientProbe::waiting(client)));
}
#endif  // SAPonNT

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  node_rfc::__env = env;
#ifndef SAPonNT
  node_rfc::Client::Init(env, exports);
  Napi::Object fakeConnectionApi = Napi::Object::New(env);
  fakeConnectionApi.Set("reset", Napi::Function::New(env, FakeReset));
  fakeConnectionApi.Set("openGate", Napi::Function::New(env, FakeOpenGate));
  fakeConnectionApi.Set("stats", Napi::Function::New(env, FakeStats));
  fakeConnectionApi.Set("waiting", Napi::Function::New(env, FakeWaiting));
  exports.Set("fake", fakeConnectionApi);
#endif
  exports.Set("codes", Codes(env));
  exports.Set("groups", Groups(env));
  exports.Set("endsConnection", Napi::Function::New(env, EndsConnection));
  exports.Set("passportCallAnswer",
              Napi::Function::New(env, PassportCallAnswer));
  exports.Set("placePassport", Napi::Function::New(env, PlacePassport));
  exports.Set("callbackView", Napi::Function::New(env, CallbackView));
  exports.Set("holdState", Napi::Function::New(env, NewHoldState));
  exports.Set("heldWork", Napi::Function::New(env, HeldWork));
  return exports;
}

}  // namespace

NODE_API_MODULE(rfc_lite_test, Init)

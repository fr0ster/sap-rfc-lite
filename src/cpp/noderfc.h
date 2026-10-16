// SPDX-FileCopyrightText: 2014 SAP SE Srdjan Boskovic <srdjan.boskovic@sap.com>
// SPDX-FileCopyrightText: 2026 sap-rfc-lite contributors
//
// SPDX-License-Identifier: Apache-2.0

#ifndef NodeRfc_Common_H
#define NodeRfc_Common_H

#include <napi.h>
#include <sapnwrfc.h>

// Error messages
#define ERRMSG_LENGTH 255
#define ERROR_PATH_NAME_LEN 48

// Unsigned and pointer types
#define uint_t uint32_t
#define pointer_t uintptr_t

// client binding version, injected unquoted by binding.gyp from package.json
// (stringified here to avoid platform-specific quoting of compiler defines)
#define NODERFC_STRINGIFY_(x) #x
#define NODERFC_STRINGIFY(x) NODERFC_STRINGIFY_(x)
#ifdef NODERFC_VERSION
#define NODERFC_VERSION_STRING NODERFC_STRINGIFY(NODERFC_VERSION)
#else
#define NODERFC_VERSION_STRING "unknown"
#endif

// surpress unused parameter warnings
#define UNUSED(x) (void)(x)

//
// Client options constants
//
#define CLIENT_OPTION_BCD "bcd"
#define CLIENT_OPTION_DATE "date"
#define CLIENT_OPTION_TIME "time"
#define CLIENT_OPTION_FILTER "filter"
#define CLIENT_OPTION_STATELESS "stateless"
#define CLIENT_OPTION_TIMEOUT "timeout"

#define CALL_OPTION_KEY_NOTREQUESTED "notRequested"
#define CALL_OPTION_KEY_TIMEOUT CLIENT_OPTION_TIMEOUT

#define CLIENT_OPTION_BCD_STRING 0
#define CLIENT_OPTION_BCD_NUMBER 1
#define CLIENT_OPTION_BCD_FUNCTION 2

#define ENV_UNDEFINED node_rfc::__env.Undefined()

// Minimal logging — no-op by default, stderr in debug builds.
// The format is the first of __VA_ARGS__ rather than a named parameter: a call
// with no arguments after the format would otherwise leave `...` empty, which
// current clang (macOS) rejects under -Werror as a C++20 extension
// (-Wvariadic-macro-arguments-omitted), and `##__VA_ARGS__` is a GNU extension.
#ifdef SAP_RFC_LITE_DEBUG
  #include <cstdio>
  #define RFC_LOG(...) (fprintf(stderr, "[sap-rfc-lite] " __VA_ARGS__), fputc('\n', stderr))
#else
  #define RFC_LOG(...) ((void)0)
#endif

#endif

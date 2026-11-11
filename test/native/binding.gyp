# The test-only addon (npm run build:test-native). It compiles the addon's pure
# decisions from src/cpp/ with a small shim (shim.cc) that exposes them to
# test/native.test.ts. It is never shipped: the root binding.gyp, prebuildify and
# the packed file list do not see it (test/package.test.ts).
{
    'variables': {
        'nwrfcsdk_dir': "<!(node -e \"process.stdout.write(String(process.env.SAPNWRFC_HOME || process.env.SAPNWRFC_HOME_CLOUD))\")",
        'napi_include_dir': "<!(node -e \"process.stdout.write(String(require('node-addon-api').include_dir))\")",
        'cpp_standard': 'c++17',
    },
    'targets': [
        {
            'target_name': 'rfc_lite_test',
            'type': 'loadable_module',
            'product_prefix': '',
            'sources': [
                'shim.cc',
                '../../src/cpp/nwrfcsdk.cc',
                '../../src/cpp/connectionEnd.cc',
                '../../src/cpp/passport.cc',
            ],
            'include_dirs': ['<(napi_include_dir)', '<(nwrfcsdk_dir)/include', '../../src/cpp'],
            'cflags!': ['-fno-exceptions'],
            'cflags_cc!': ['-fno-exceptions'],
            'defines': [
                'SAPwithUNICODE', 'UNICODE', '_UNICODE',
                'SAPwithTHREADS',
                'NAPI_CPP_EXCEPTIONS',
                'NAPI_VERSION=8',
            ],
            'conditions': [
                ['OS=="linux"', {
                    'cflags_cc': ['-std=<(cpp_standard)', '-Wall', '-Wextra', '-Werror', '-fPIC'],
                    'defines': ['SAPonLIN', 'SAPonUNIX'],
                    'link_settings': {
                        'library_dirs': ['<(nwrfcsdk_dir)/lib'],
                        'libraries': ['-lsapnwrfc', '-lsapucum', '-Wl,-rpath,<(nwrfcsdk_dir)/lib'],
                    },
                }],
                ['OS=="mac"', {
                    'defines': ['SAPonDARW', '_DARWIN_USE_64_BIT_INODE=1', '__NO_MATH_INLINES'],
                    'xcode_settings': {
                        'CLANG_CXX_LANGUAGE_STANDARD': '<(cpp_standard)',
                        'CLANG_CXX_LIBRARY': 'libc++',
                        'GCC_ENABLE_CPP_EXCEPTIONS': 'YES',
                        'MACOSX_DEPLOYMENT_TARGET': '11.0',
                    },
                    'link_settings': {
                        'library_dirs': ['<(nwrfcsdk_dir)/lib'],
                        'libraries': ['-lsapnwrfc', '-lsapucum', '-Wl,-rpath,<(nwrfcsdk_dir)/lib'],
                    },
                }],
                ['OS=="win"', {
                    'defines': ['SAPonNT', 'WIN32', '_CRT_SECURE_NO_DEPRECATE', '_HAS_EXCEPTIONS=1'],
                    'msvs_settings': {
                        'VCCLCompilerTool': {
                            'ExceptionHandling': 1,
                            'AdditionalOptions': ['/std:<(cpp_standard)'],
                        },
                        'VCLinkerTool': {
                            'AdditionalLibraryDirectories': ['<(nwrfcsdk_dir)/lib'],
                            'AdditionalDependencies': ['sapnwrfc.lib', 'libsapucum.lib'],
                        },
                    },
                }],
            ],
        }
    ]
}

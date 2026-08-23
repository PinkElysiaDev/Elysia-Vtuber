cmake_minimum_required(VERSION 3.20)
project(vtuber_executor CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

if(MSVC)
  add_compile_options(/utf-8 /MP /wd4100 /wd4458)
endif()

set(CUBISM_SDK_PATH "D:/DevTools/SDK/CubismSdkForNative-5-r.5/CubismSdkForNative-5-r.5" CACHE PATH "Official Cubism Native SDK root")
set(VTUBER_THIRD_PARTY_DIR "${CMAKE_CURRENT_SOURCE_DIR}/../../../.tools/third_party" CACHE PATH "Vendored third-party headers")
set(CORE_CRL_MD ON CACHE BOOL "Link Cubism Core MD runtime")

set(CORE_PATH ${CUBISM_SDK_PATH}/Core)
set(FRAMEWORK_PATH ${CUBISM_SDK_PATH}/Framework)
set(FRAMEWORK_SHADER_PATH ${FRAMEWORK_PATH}/src/Rendering/D3D11/Shaders)
set(HARU_PATH ${CUBISM_SDK_PATH}/Samples/Resources/Haru)
set(CORE_DLL ${CORE_PATH}/dll/windows/x86_64/Live2DCubismCore.dll)

if(NOT EXISTS "${CUBISM_SDK_PATH}/Core/include/Live2DCubismCore.h")
  message(FATAL_ERROR "Cubism SDK not found at ${CUBISM_SDK_PATH}")
endif()

if(CMAKE_SIZEOF_VOID_P EQUAL 8)
  set(ARCH x86_64)
else()
  set(ARCH x86)
endif()

if(MSVC_VERSION GREATER_EQUAL 1930)
  set(COMPILER 143)
elseif(MSVC_VERSION GREATER_EQUAL 1920)
  set(COMPILER 142)
elseif(MSVC_VERSION GREATER_EQUAL 1910)
  set(COMPILER 141)
else()
  set(COMPILER 143)
endif()

if(NOT EXISTS "${CORE_PATH}/lib/windows/${ARCH}/${COMPILER}")
  set(COMPILER 143)
endif()

if(CORE_CRL_MD)
  set(CRT MD)
else()
  set(CRT MT)
endif()

add_library(Live2DCubismCore STATIC IMPORTED)
set(CORE_LIB_SUFFIX ${CORE_PATH}/lib/windows/${ARCH}/${COMPILER})
set_target_properties(Live2DCubismCore PROPERTIES
  IMPORTED_LOCATION_DEBUG ${CORE_LIB_SUFFIX}/Live2DCubismCore_${CRT}d.lib
  IMPORTED_LOCATION_RELEASE ${CORE_LIB_SUFFIX}/Live2DCubismCore_${CRT}.lib
  IMPORTED_LOCATION_RELWITHDEBINFO ${CORE_LIB_SUFFIX}/Live2DCubismCore_${CRT}.lib
  IMPORTED_LOCATION_MINSIZEREL ${CORE_LIB_SUFFIX}/Live2DCubismCore_${CRT}.lib
  INTERFACE_INCLUDE_DIRECTORIES ${CORE_PATH}/include
)

set(FRAMEWORK_SOURCE D3D11)
add_subdirectory(${FRAMEWORK_PATH} ${CMAKE_CURRENT_BINARY_DIR}/Framework)
target_link_libraries(Framework
  Live2DCubismCore
  d3d11.lib
  d3dcompiler.lib
)

# ============================================================
# 公共静态库（platform 工具 + IPC 服务器，两个执行器共用）
# ============================================================
add_library(vtuber_common STATIC
  src/platform.cpp
  src/ipc_server.cpp
)

target_include_directories(vtuber_common PUBLIC
  ${CMAKE_CURRENT_SOURCE_DIR}/src
  ${VTUBER_THIRD_PARTY_DIR}/json-3.11.3/single_include
  ${VTUBER_THIRD_PARTY_DIR}/websocketpp-0.8.2
  ${VTUBER_THIRD_PARTY_DIR}/asio-asio-1-30-2/asio/include
)

target_compile_definitions(vtuber_common PUBLIC
  ASIO_STANDALONE
  _WEBSOCKETPP_CPP11_STL_
  _WEBSOCKETPP_CPP11_THREAD_
  UNICODE
  _UNICODE
  NOMINMAX
  WIN32_LEAN_AND_MEAN
)

target_link_libraries(vtuber_common PUBLIC ws2_32)

# ============================================================
# 音频执行器（无窗口，纯 XAudio2 播放）
# ============================================================
add_executable(audio_executor WIN32
  src/audio_main.cpp
  src/audio_player.cpp
)

target_link_libraries(audio_executor PRIVATE vtuber_common)

# ============================================================
# Live2D 执行器（D3D11 渲染 + 窗口交互）
# ============================================================
add_executable(vtuber_executor WIN32
  src/main.cpp
  src/app.cpp
  src/live2d_model.cpp
  src/wic_texture.cpp
)

target_include_directories(vtuber_executor PRIVATE
  ${CORE_PATH}/include
)

target_link_libraries(vtuber_executor PRIVATE
  vtuber_common
  Framework
  Live2DCubismCore
  d3d11
  dxgi
  d3dcompiler
  windowscodecs
  ws2_32
  ole32
)

set_target_properties(vtuber_executor PROPERTIES
  VS_DEBUGGER_WORKING_DIRECTORY $<TARGET_FILE_DIR:vtuber_executor>
)
set_target_properties(audio_executor PROPERTIES
  VS_DEBUGGER_WORKING_DIRECTORY $<TARGET_FILE_DIR:audio_executor>
)

add_custom_command(TARGET audio_executor POST_BUILD
  COMMAND ${CMAKE_COMMAND} -E copy_if_different
    ${CMAKE_CURRENT_SOURCE_DIR}/config/audio-executor.json
    $<TARGET_FILE_DIR:audio_executor>/audio-executor.json
)

add_custom_command(TARGET vtuber_executor POST_BUILD
  COMMAND ${CMAKE_COMMAND} -E copy_if_different
    ${CORE_DLL} $<TARGET_FILE_DIR:vtuber_executor>/Live2DCubismCore.dll
  COMMAND ${CMAKE_COMMAND} -E copy_directory
    ${FRAMEWORK_SHADER_PATH} $<TARGET_FILE_DIR:vtuber_executor>/FrameworkShaders
  COMMAND ${CMAKE_COMMAND} -E copy_directory
    ${HARU_PATH} $<TARGET_FILE_DIR:vtuber_executor>/Resources/Haru
  COMMAND ${CMAKE_COMMAND} -E copy_if_different
    ${CMAKE_CURRENT_SOURCE_DIR}/config/executor.json
    $<TARGET_FILE_DIR:vtuber_executor>/executor.json
)

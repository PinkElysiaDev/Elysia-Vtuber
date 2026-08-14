cmake_minimum_required(VERSION 3.20)
project(vtuber_backend CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

if(MSVC)
  add_compile_options(/utf-8)
endif()

find_package(Threads REQUIRED)

set(VTUBER_THIRD_PARTY_DIR "" CACHE PATH "Path to vendored third-party headers")

if(VTUBER_THIRD_PARTY_DIR)
  set(VTUBER_JSON_INCLUDE "${VTUBER_THIRD_PARTY_DIR}/json-3.11.3/single_include")
  set(VTUBER_HTTPLIB_INCLUDE "${VTUBER_THIRD_PARTY_DIR}/cpp-httplib-0.15.3")
  set(VTUBER_WEBSOCKETPP_INCLUDE "${VTUBER_THIRD_PARTY_DIR}/websocketpp-0.8.2")
  set(VTUBER_ASIO_INCLUDE "${VTUBER_THIRD_PARTY_DIR}/asio-asio-1-30-2/asio/include")
else()
  include(FetchContent)
  find_package(Boost REQUIRED COMPONENTS system)
  find_package(OpenSSL REQUIRED)

  FetchContent_Declare(
    nlohmann_json
    GIT_REPOSITORY https://github.com/nlohmann/json.git
    GIT_TAG v3.11.3
  )

  FetchContent_Declare(
    cpp_httplib
    GIT_REPOSITORY https://github.com/yhirose/cpp-httplib.git
    GIT_TAG v0.15.3
  )

  FetchContent_Declare(
    websocketpp
    GIT_REPOSITORY https://github.com/zaphoyd/websocketpp.git
    GIT_TAG 0.8.2
  )

  FetchContent_MakeAvailable(nlohmann_json cpp_httplib websocketpp)
endif()

add_executable(vtuber_backend
  src/main.cpp
  src/backend_context.cpp
  src/config.cpp
  src/display_controller.cpp
  src/event_state.cpp
  src/jsonrpc_handler.cpp
  src/live2d_controller.cpp
  src/llm_client.cpp
  src/music_controller.cpp
  src/output_router.cpp
  src/server.cpp
  src/audio_player.cpp
  src/tool_registry.cpp
  src/trigger_engine.cpp
  src/tts_client.cpp
)

enable_testing()
add_executable(music_controller_test tests/music_controller_test.cpp src/music_controller.cpp)
target_include_directories(music_controller_test PRIVATE
  ${CMAKE_CURRENT_SOURCE_DIR}/src
)
if(VTUBER_THIRD_PARTY_DIR)
  target_include_directories(music_controller_test PRIVATE ${VTUBER_JSON_INCLUDE})
else()
  target_link_libraries(music_controller_test PRIVATE nlohmann_json::nlohmann_json)
endif()
add_test(NAME music_controller_test COMMAND music_controller_test)

add_executable(event_state_test tests/event_state_test.cpp src/event_state.cpp)
target_include_directories(event_state_test PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/src)
if(VTUBER_THIRD_PARTY_DIR)
  target_include_directories(event_state_test PRIVATE ${VTUBER_JSON_INCLUDE})
else()
  target_link_libraries(event_state_test PRIVATE nlohmann_json::nlohmann_json)
endif()
add_test(NAME event_state_test COMMAND event_state_test)

add_executable(trigger_engine_test tests/trigger_engine_test.cpp src/trigger_engine.cpp src/event_state.cpp)
target_include_directories(trigger_engine_test PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/src)
target_link_libraries(trigger_engine_test PRIVATE Threads::Threads)
if(VTUBER_THIRD_PARTY_DIR)
  target_include_directories(trigger_engine_test PRIVATE ${VTUBER_JSON_INCLUDE})
else()
  target_link_libraries(trigger_engine_test PRIVATE nlohmann_json::nlohmann_json)
endif()
add_test(NAME trigger_engine_test COMMAND trigger_engine_test)

target_include_directories(vtuber_backend PRIVATE
  ${CMAKE_CURRENT_SOURCE_DIR}/src
)

if(VTUBER_THIRD_PARTY_DIR)
  target_include_directories(vtuber_backend PRIVATE
    ${VTUBER_JSON_INCLUDE}
    ${VTUBER_HTTPLIB_INCLUDE}
    ${VTUBER_WEBSOCKETPP_INCLUDE}
    ${VTUBER_ASIO_INCLUDE}
  )
  target_compile_definitions(vtuber_backend PRIVATE
    ASIO_STANDALONE
    _WEBSOCKETPP_CPP11_STL_
    _WEBSOCKETPP_CPP11_THREAD_
  )
  target_link_libraries(vtuber_backend PRIVATE Threads::Threads)
else()
  target_include_directories(vtuber_backend PRIVATE ${Boost_INCLUDE_DIRS})
  target_compile_definitions(vtuber_backend PRIVATE CPPHTTPLIB_OPENSSL_SUPPORT)
  target_link_libraries(vtuber_backend PRIVATE
    nlohmann_json::nlohmann_json
    httplib::httplib
    websocketpp::websocketpp
    Boost::system
    OpenSSL::SSL
    OpenSSL::Crypto
    Threads::Threads
  )
endif()

if(WIN32)
  target_link_libraries(vtuber_backend PRIVATE ws2_32)
endif()

install(TARGETS vtuber_backend RUNTIME DESTINATION bin)
install(DIRECTORY config DESTINATION .)

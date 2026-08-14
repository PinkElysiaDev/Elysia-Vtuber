#pragma once

#include <atomic>
#include <memory>
#include <set>
#include <string>
#include <thread>

#include <nlohmann/json.hpp>
#include <websocketpp/config/asio_no_tls.hpp>
#include <websocketpp/server.hpp>

#include "backend_context.h"
#include "jsonrpc_handler.h"

namespace httplib {
class Server;
}

namespace vtuber {

class BackendServer {
 public:
  explicit BackendServer(BackendContext& context);
  ~BackendServer();

  void start();
  void stop();
  void broadcast(const std::string& method, const nlohmann::json& params);

 private:
  void run_http();
  void run_ws();

  using WebSocketServer = websocketpp::server<websocketpp::config::asio>;
  using ConnectionHdl = websocketpp::connection_hdl;

  BackendContext& context_;
  JsonRpcHandler rpc_handler_;
  WebSocketServer ws_server_;
  std::unique_ptr<httplib::Server> http_server_;
  std::set<ConnectionHdl, std::owner_less<ConnectionHdl>> connections_;
  std::thread http_thread_;
  std::thread ws_thread_;
  std::atomic<bool> running_{false};
};

}  // namespace vtuber

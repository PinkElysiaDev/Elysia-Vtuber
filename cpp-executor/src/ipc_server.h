#pragma once

#include <atomic>
#include <functional>
#include <mutex>
#include <set>
#include <string>
#include <thread>

#include <nlohmann/json.hpp>
#include <websocketpp/config/asio_no_tls.hpp>
#include <websocketpp/server.hpp>

namespace vtuber {

class App;

class IpcServer {
 public:
  using Handler = std::function<nlohmann::json(const nlohmann::json&)>;

  explicit IpcServer(App& app);
  ~IpcServer();

  void start(uint16_t port);
  void stop();
  void broadcast(const std::string& method, const nlohmann::json& params);

 private:
  using WsServer = websocketpp::server<websocketpp::config::asio>;
  using ConnectionHdl = websocketpp::connection_hdl;

  nlohmann::json dispatch(const std::string& method, const nlohmann::json& params);
  std::string handlePayload(const std::string& raw);

  App& app_;
  WsServer server_;
  std::thread thread_;
  std::mutex mutex_;
  std::set<ConnectionHdl, std::owner_less<ConnectionHdl>> connections_;
  std::atomic<bool> running_{false};
};

}  // namespace vtuber

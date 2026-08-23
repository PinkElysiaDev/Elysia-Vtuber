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

class IpcServer {
 public:
  /** RPC 分发器：接收 method + params，返回结果 JSON（异常由内部映射为 -32000） */
  using Dispatcher = std::function<nlohmann::json(const std::string&, const nlohmann::json&)>;

  explicit IpcServer(Dispatcher dispatch);
  ~IpcServer();

  void start(uint16_t port);
  void stop();
  void broadcast(const std::string& method, const nlohmann::json& params);

 private:
  using WsServer = websocketpp::server<websocketpp::config::asio>;
  using ConnectionHdl = websocketpp::connection_hdl;

  std::string handlePayload(const std::string& raw);
  void sendImpl(ConnectionHdl hdl, const std::string& payload);

  Dispatcher dispatch_;
  WsServer server_;
  std::thread thread_;
  // 串行化所有 server_.send 调用：asio IO 线程与 XAudio2 回调线程都会发送，
  // websocketpp 的 send 非线程安全，同一连接并发写会损坏堆
  std::mutex sendMutex_;
  std::mutex mutex_;
  std::set<ConnectionHdl, std::owner_less<ConnectionHdl>> connections_;
  std::atomic<bool> running_{false};
};

}  // namespace vtuber

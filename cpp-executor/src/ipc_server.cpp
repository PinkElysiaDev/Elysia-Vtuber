#include "ipc_server.h"

#include "platform.h"

#include <vector>

namespace vtuber {

IpcServer::IpcServer(Dispatcher dispatch) : dispatch_(std::move(dispatch)) {}

IpcServer::~IpcServer() {
  stop();
}

void IpcServer::start(uint16_t port) {
  if (running_.exchange(true)) return;

  thread_ = std::thread([this, port]() {
    try {
      server_.clear_access_channels(websocketpp::log::alevel::all);
      server_.clear_error_channels(websocketpp::log::elevel::all);
      server_.init_asio();
      server_.set_reuse_addr(true);

      server_.set_open_handler([this](ConnectionHdl hdl) {
        std::lock_guard lock(mutex_);
        connections_.insert(hdl);
      });
      server_.set_close_handler([this](ConnectionHdl hdl) {
        std::lock_guard lock(mutex_);
        connections_.erase(hdl);
      });
      server_.set_message_handler([this](ConnectionHdl hdl, WsServer::message_ptr msg) {
        const std::string reply = handlePayload(msg->get_payload());
        if (reply.empty()) return;
        sendImpl(hdl, reply);
      });

      server_.listen(port);
      server_.start_accept();
      LogLine(std::string("[ipc] listening on ws://127.0.0.1:") + std::to_string(port));
      server_.run();
    } catch (const std::exception& ex) {
      LogLine(std::string("[ipc] failed: ") + ex.what());
    }
    running_ = false;
  });
}

void IpcServer::stop() {
  if (!running_.exchange(false) && !thread_.joinable()) return;
  try {
    // websocketpp endpoint 非线程安全：stop 必须在 asio io 线程执行，
    // 从主线程直接调用会与 run() 并发破坏内部状态导致崩溃（退出码 2816 的根因）
    server_.get_io_service().post([this]() {
      try {
        server_.stop_listening();
        server_.stop();
      } catch (...) {
      }
    });
  } catch (...) {
    // io_service 不可用（未 init_asio 等），跳过优雅停止
  }
  if (thread_.joinable()) thread_.join();
}

void IpcServer::broadcast(const std::string& method, const nlohmann::json& params) {
  const std::string payload = nlohmann::json{
      {"jsonrpc", "2.0"},
      {"method", method},
      {"params", params},
  }.dump();
  // 拷贝连接列表后释放 mutex_，避免 send 时长时间持锁；send 仍由 sendMutex_ 串行化
  std::vector<ConnectionHdl> targets;
  {
    std::lock_guard lock(mutex_);
    for (const auto& hdl : connections_) targets.push_back(hdl);
  }
  for (const auto& hdl : targets) sendImpl(hdl, payload);
}

void IpcServer::sendImpl(ConnectionHdl hdl, const std::string& payload) {
  std::lock_guard lock(sendMutex_);
  try {
    server_.send(hdl, payload, websocketpp::frame::opcode::text);
  } catch (...) {
    // 连接已断开等异常静默处理
  }
}

std::string IpcServer::handlePayload(const std::string& raw) {
  nlohmann::json message;
  try {
    message = nlohmann::json::parse(raw);
  } catch (...) {
    return nlohmann::json{{"jsonrpc", "2.0"}, {"id", nullptr}, {"error", {{"code", -32700}, {"message", "parse error"}}}}.dump();
  }

  if (!message.is_object() || !message.contains("method")) {
    if (!message.contains("id")) return {};
    return nlohmann::json{{"jsonrpc", "2.0"}, {"id", message.value("id", nullptr)}, {"error", {{"code", -32600}, {"message", "invalid request"}}}}.dump();
  }

  const std::string method = message["method"].get<std::string>();
  const nlohmann::json params = message.value("params", nlohmann::json::object());
  const bool notify = !message.contains("id") || message["id"].is_null();

  if (method == "peer.declare") return {};

  try {
    const nlohmann::json result = dispatch_ ? dispatch_(method, params) : nlohmann::json{{"ok", false}, {"error", "no dispatcher"}};
    if (notify) return {};
    return nlohmann::json{{"jsonrpc", "2.0"}, {"id", message["id"]}, {"result", result}}.dump();
  } catch (const std::exception& ex) {
    if (notify) return {};
    return nlohmann::json{{"jsonrpc", "2.0"}, {"id", message["id"]}, {"error", {{"code", -32000}, {"message", ex.what()}}}}.dump();
  }
}

}  // namespace vtuber

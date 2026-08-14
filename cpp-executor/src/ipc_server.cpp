#include "ipc_server.h"

#include "app.h"
#include "platform.h"

namespace vtuber {

IpcServer::IpcServer(App& app) : app_(app) {}

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
        try {
          server_.send(hdl, reply, websocketpp::frame::opcode::text);
        } catch (...) {
        }
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
    server_.stop_listening();
    server_.stop();
  } catch (...) {
  }
  if (thread_.joinable()) thread_.join();
}

void IpcServer::broadcast(const std::string& method, const nlohmann::json& params) {
  const std::string payload = nlohmann::json{
      {"jsonrpc", "2.0"},
      {"method", method},
      {"params", params},
  }.dump();
  std::lock_guard lock(mutex_);
  for (const auto& hdl : connections_) {
    try {
      server_.send(hdl, payload, websocketpp::frame::opcode::text);
    } catch (...) {
    }
  }
}

nlohmann::json IpcServer::dispatch(const std::string& method, const nlohmann::json& params) {
  return app_.handleRpc(method, params);
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
    const nlohmann::json result = dispatch(method, params);
    if (notify) return {};
    return nlohmann::json{{"jsonrpc", "2.0"}, {"id", message["id"]}, {"result", result}}.dump();
  } catch (const std::exception& ex) {
    if (notify) return {};
    return nlohmann::json{{"jsonrpc", "2.0"}, {"id", message["id"]}, {"error", {{"code", -32000}, {"message", ex.what()}}}}.dump();
  }
}

}  // namespace vtuber

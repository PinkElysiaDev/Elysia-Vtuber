#include "server.h"

#include <httplib.h>

#include <iostream>
#include <mutex>

#include "webui_resources.h"

namespace vtuber {

namespace {

void set_html(httplib::Response& res, const std::string& html) {
  res.set_content(html, "text/html; charset=utf-8");
}

}  // namespace

BackendServer::BackendServer(BackendContext& context)
    : context_(context), rpc_handler_(context) {
  context_.music.set_notify_callback([this](const std::string& method, const nlohmann::json& params) {
    broadcast(method, params);
  });
  context_.display.set_notify([this](const std::string& method, const nlohmann::json& params) {
    broadcast(method, params);
  });
  context_.live2d.set_notify([this](const std::string& method, const nlohmann::json& params) {
    broadcast(method, params);
  });
  context_.audio.set_notify([this](const std::string& method, const nlohmann::json& params) {
    broadcast(method, params);
  });
}

BackendServer::~BackendServer() {
  stop();
}

void BackendServer::start() {
  if (running_.exchange(true)) {
    return;
  }

  ws_thread_ = std::thread(&BackendServer::run_ws, this);
  http_thread_ = std::thread(&BackendServer::run_http, this);
}

void BackendServer::stop() {
  if (!running_.exchange(false)) {
    return;
  }

  if (http_server_) {
    http_server_->stop();
  }
  ws_server_.stop();

  if (ws_thread_.joinable()) ws_thread_.join();
  if (http_thread_.joinable()) http_thread_.join();
}

void BackendServer::run_http() {
  http_server_ = std::make_unique<httplib::Server>();
  httplib::Server& http = *http_server_;

  http.Get("/", [](const httplib::Request&, httplib::Response& res) {
    set_html(res, webui::index_html());
  });
  http.Get("/live2d", [](const httplib::Request&, httplib::Response& res) {
    set_html(res, webui::live2d_html());
  });
  http.Get("/display", [](const httplib::Request&, httplib::Response& res) {
    set_html(res, webui::display_html());
  });
  http.Get("/music", [](const httplib::Request&, httplib::Response& res) {
    set_html(res, webui::music_html());
  });
  http.Get("/jukebox", [](const httplib::Request&, httplib::Response& res) {
    set_html(res, webui::music_html());
  });
  http.Get("/danmaku", [](const httplib::Request&, httplib::Response& res) {
    set_html(res, webui::danmaku_html());
  });
  http.Get("/logs", [](const httplib::Request&, httplib::Response& res) {
    set_html(res, webui::logs_html());
  });
  http.Get("/settings", [](const httplib::Request&, httplib::Response& res) {
    set_html(res, webui::settings_html());
  });

  if (!http.listen(context_.config.server.host, context_.config.server.http_port)) {
    std::cerr << "HTTP server failed to listen on " << context_.config.server.host << ":"
              << context_.config.server.http_port << "\n";
  }
}

void BackendServer::run_ws() {
  ws_server_.clear_access_channels(websocketpp::log::alevel::all);
  ws_server_.clear_error_channels(websocketpp::log::elevel::all);

  ws_server_.init_asio();
  ws_server_.set_open_handler([this](ConnectionHdl hdl) {
    connections_.insert(hdl);
    nlohmann::json state = context_.music.get_state();
    try {
      ws_server_.send(hdl, nlohmann::json{
          {"jsonrpc", "2.0"},
          {"method", "jukebox.state"},
          {"params", state},
      }.dump(), websocketpp::frame::opcode::text);
    } catch (...) {
    }
  });

  ws_server_.set_close_handler([this](ConnectionHdl hdl) {
    connections_.erase(hdl);
  });

  ws_server_.set_message_handler([this](ConnectionHdl hdl, WebSocketServer::message_ptr msg) {
    const std::string response = rpc_handler_.handle(msg->get_payload());
    if (response.empty()) return;
    try {
      ws_server_.send(hdl, response, websocketpp::frame::opcode::text);
    } catch (const std::exception& ex) {
      std::cerr << "send failed: " << ex.what() << "\n";
    }
  });

  try {
    ws_server_.listen(context_.config.server.ws_port);
    ws_server_.start_accept();
    ws_server_.run();
  } catch (const std::exception& ex) {
    std::cerr << "WebSocket server failed: " << ex.what() << "\n";
  }
}

void BackendServer::broadcast(const std::string& method, const nlohmann::json& params) {
  const std::string payload = nlohmann::json{
      {"jsonrpc", "2.0"},
      {"method", method},
      {"params", params},
  }.dump();

  for (const auto& hdl : connections_) {
    try {
      ws_server_.send(hdl, payload, websocketpp::frame::opcode::text);
    } catch (...) {
    }
  }
}

}  // namespace vtuber

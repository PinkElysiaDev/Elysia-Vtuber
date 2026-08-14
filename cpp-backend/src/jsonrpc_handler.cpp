#include "jsonrpc_handler.h"

#include <stdexcept>

namespace vtuber {

JsonRpcHandler::JsonRpcHandler(BackendContext& context)
    : context_(context) {}

std::string JsonRpcHandler::response(const nlohmann::json& id, const nlohmann::json& result) const {
  return nlohmann::json{
      {"jsonrpc", "2.0"},
      {"id", id},
      {"result", result},
  }.dump();
}

std::string JsonRpcHandler::error(const nlohmann::json& id, int code,
                                  const std::string& message) const {
  return nlohmann::json{
      {"jsonrpc", "2.0"},
      {"id", id},
      {"error", {{"code", code}, {"message", message}}},
  }.dump();
}

nlohmann::json JsonRpcHandler::dispatch(const std::string& method,
                                        const nlohmann::json& params) {
  if (method == "koishi.ready") {
    return {
        {"success", true},
        {"roomId", params.value("roomId", "")},
        {"message", "ready"},
    };
  }

  if (method == "event.ingest") {
    ++event_count_;
    const auto event = event_from_json(params.value("event", nlohmann::json::object()));
    context_.event_state.add_event(event);
    context_.triggers.handle_event(event);
    return {
        {"success", true},
        {"eventCount", event_count_.load()},
        {"eventType", params.value("event", nlohmann::json::object()).value("type", "unknown")},
    };
  }

  if (method == "event.batch") {
    const auto events = params.value("events", nlohmann::json::array());
    event_count_ += static_cast<int>(events.size());
    for (const auto& item : events) {
      const auto event = event_from_json(item);
      context_.event_state.add_event(event);
      context_.triggers.handle_event(event);
    }
    return {
        {"success", true},
        {"eventCount", event_count_.load()},
        {"batchSize", events.size()},
    };
  }

  if (method == "system.status") {
    return {
        {"version", "0.1.0"},
        {"eventCount", event_count_.load()},
        {"roomId", context_.config.room_id},
        {"jukebox", context_.music.get_state()},
        {"live2d", context_.live2d.get_state()},
        {"display", context_.display.get_state()},
        {"audio", context_.audio.get_state()},
    };
  }

  if (method == "system.info") {
    return {
        {"version", "0.1.0"},
        {"platform", "cpp-backend"},
        {"roomId", context_.config.room_id},
        {"configPath", context_.config_path},
        {"configFile", !context_.config_path.empty() ? config_to_json(context_.config) : nlohmann::json(nullptr)},
        {"llmConfigured",
         context_.llm ? true : false},
        {"ttsConfigured",
         context_.tts ? true : false},
        {"modules",
         {
             {"music", "ok"},
             {"live2d", "ok"},
             {"display", "ok"},
             {"audio", "ok"},
             {"triggers", context_.triggers.rules_count()},
         }},
    };
  }

  if (method == "system.shutdown") {
    return {{"success", true}, {"message", "shutdown requested"}};
  }

  if (method == "config.get") {
    return config_to_json(context_.config);
  }

  if (method == "config.schema") {
    return config_schema();
  }

  if (method == "config.update") {
    auto current = config_to_json(context_.config);
    const auto patch = params.value("config", nlohmann::json::object());
    if (!patch.is_object()) {
      throw std::runtime_error("config.update requires an object");
    }
    for (auto it = patch.begin(); it != patch.end(); ++it) {
      current[it.key()] = it.value();
    }
    context_.config = backend_config_from_json(current);
    if (!context_.config_path.empty()) {
      save_config(context_.config, context_.config_path);
    }
    return config_to_json(context_.config);
  }

  if (method == "config.updateSection") {
    const std::string section = params.value<std::string>("section", "");
    const auto& value = params.value("value", nlohmann::json());
    if (section.empty()) {
      throw std::runtime_error("config.updateSection requires a section");
    }
    auto current = config_to_json(context_.config);
    current[section] = value;
    context_.config = backend_config_from_json(current);
    if (!context_.config_path.empty()) {
      save_config(context_.config, context_.config_path);
    }
    return {
        {"success", true},
        {"section", section},
        {"value", value},
    };
  }

  if (method == "config.resetSection") {
    const std::string section = params.value<std::string>("section", "");
    if (section.empty()) {
      throw std::runtime_error("config.resetSection requires a section");
    }
    auto current = config_to_json(context_.config);
    auto defaults = config_to_json(default_backend_config());
    current[section] = defaults.value(section, nlohmann::json());
    context_.config = backend_config_from_json(current);
    if (!context_.config_path.empty()) {
      save_config(context_.config, context_.config_path);
    }
    return {
        {"success", true},
        {"section", section},
        {"value", current[section]},
    };
  }

  if (method == "config.reload") {
    if (context_.config_path.empty()) {
      return config_to_json(context_.config);
    }
    context_.config = load_config(context_.config_path);
    context_.reload_all();
    return config_to_json(context_.config);
  }

  if (method == "config.reset") {
    context_.config = default_backend_config();
    if (!context_.config_path.empty()) {
      save_config(context_.config, context_.config_path);
    }
    context_.reload_all();
    return config_to_json(context_.config);
  }

  if (method == "config.testLLM") {
    return config_test_llm(params.value("llm", context_.config.llm));
  }

  if (method == "config.testTTS") {
    return config_test_tts(params.value("tts", context_.config.tts));
  }

  if (method == "config.apply") {
    const auto result = context_.reload_all();
    return {
        {"success", result["llm"].value("success", false) &&
                        result["tts"].value("success", false) &&
                        result["triggers"].value("success", false)},
        {"llm", result["llm"]},
        {"tts", result["tts"]},
        {"triggers", result["triggers"]},
    };
  }

  if (method == "tool.list") {
    return context_.tools.list_tools();
  }

  if (method == "tool.call") {
    return context_.tools.call(params.value("name", ""), params.value("args", nlohmann::json::object()));
  }

  if (method.rfind("jukebox.", 0) == 0) {
    const std::string sub = method.substr(8);
    if (sub == "search") return context_.music.search(params);
    if (sub == "add") return context_.music.add(params);
    if (sub == "play") return context_.music.play();
    if (sub == "pause") return context_.music.pause();
    if (sub == "skip") return context_.music.skip();
    if (sub == "seek") return context_.music.seek(params);
    if (sub == "remove") return context_.music.remove(params);
    if (sub == "clear") return context_.music.clear_queue();
    if (sub == "getQueue") return context_.music.get_queue();
    if (sub == "getNowPlaying") return context_.music.get_now_playing();
    if (sub == "setVolume") return context_.music.set_volume(params.value<int>("volume", 80));
    if (sub == "adjustVolume") return context_.music.adjust_volume(params.value<int>("delta", 0));
    if (sub == "mute") return context_.music.mute();
    if (sub == "unmute") return context_.music.unmute();
    if (sub == "getVolume") return context_.music.get_volume();
    if (sub == "getState") return context_.music.get_state();
    if (sub == "start") return context_.music.start();
    if (sub == "stop") return context_.music.stop();
    if (sub == "restart") return context_.music.restart(params.value<bool>("preserveQueue", true));
  }

  if (method.rfind("live2d.", 0) == 0) {
    const std::string sub = method.substr(7);
    if (sub == "load") return context_.live2d.load_model(params);
    if (sub == "setExpression") return context_.live2d.set_expression(params);
    if (sub == "playMotion") return context_.live2d.play_motion(params);
    if (sub == "setScale") return context_.live2d.set_scale(params);
    if (sub == "setPosition") return context_.live2d.set_position(params);
    if (sub == "getState") return context_.live2d.get_state();
  }

  if (method.rfind("display.", 0) == 0) {
    const std::string sub = method.substr(8);
    if (sub == "show") return context_.display.show_text(params);
    if (sub == "showHtml") return context_.display.show_html(params);
    if (sub == "clear") return context_.display.clear();
    if (sub == "getState") return context_.display.get_state();
  }

  if (method.rfind("audio.", 0) == 0) {
    const std::string sub = method.substr(6);
    if (sub == "play") return context_.audio.play(params.value<std::string>("url", ""), params.value<int>("volume", -1));
    if (sub == "stop") return context_.audio.stop();
    if (sub == "setVolume") return context_.audio.set_volume(params.value<int>("volume", 80));
    if (sub == "getState") return context_.audio.get_state();
    if (sub == "clear") return context_.audio.clear_queue();
  }

  if (method == "llm.chat") {
    if (!context_.llm) throw std::runtime_error("LLM is not configured");
    const auto messages = params.value("messages", nlohmann::json::array());
    const auto tools = params.value("tools", context_.tools.list_tools());
    const auto response = context_.llm->chat(messages, tools);
    nlohmann::json result = {
        {"content", response.content},
        {"finishReason", response.finish_reason},
    };
    if (!response.tool_calls.empty()) {
      result["toolCalls"] = nlohmann::json::array();
      for (const auto& call : response.tool_calls) {
        result["toolCalls"].push_back({
            {"id", call.id},
            {"name", call.name},
            {"arguments", call.arguments},
        });
      }
    }
    return result;
  }

  if (method == "tts.synthesize") {
    if (!context_.tts) throw std::runtime_error("TTS is not configured");
    const auto result = context_.tts->synthesize(params.value<std::string>("text", ""));
    return {
        {"audio", result.audio_base64},
        {"duration", result.duration_seconds},
    };
  }

  throw std::runtime_error("method not found: " + method);
}

std::string JsonRpcHandler::handle(const std::string& message) {
  nlohmann::json request;
  try {
    request = nlohmann::json::parse(message);
  } catch (...) {
    return error(nullptr, -32700, "parse error");
  }

  if (request.is_array()) {
    nlohmann::json results = nlohmann::json::array();
    for (const auto& item : request) {
      const bool notification = !item.contains("id") || item.value("id", nlohmann::json()).is_null();
      try {
        auto result = dispatch(item.value("method", ""), item.value("params", nlohmann::json::object()));
        if (!notification) {
          results.push_back({
              {"jsonrpc", "2.0"},
              {"id", item.value("id", nlohmann::json())},
              {"result", result},
          });
        }
      } catch (const std::exception& ex) {
        if (notification) continue;
        results.push_back({{"jsonrpc", "2.0"}, {"id", item.value("id", nlohmann::json())},
                           {"error", {{"code", -32601}, {"message", ex.what()}}}});
      }
    }
    return results.dump();
  }

  const bool is_notification = !request.contains("id") || request["id"].is_null();
  try {
    auto result = dispatch(request.value("method", ""), request.value("params", nlohmann::json::object()));
    if (is_notification) return "";
    return response(request["id"], result);
  } catch (const std::exception& ex) {
    return error(is_notification ? nlohmann::json(nullptr) : request.value("id", nlohmann::json()),
                 -32601, ex.what());
  }
}

}  // namespace vtuber

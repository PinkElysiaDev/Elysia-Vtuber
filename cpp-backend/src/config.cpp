#include "config.h"

#include <fstream>
#include <iostream>
#include <stdexcept>

#include <httplib.h>
#include <nlohmann/json.hpp>

#include "backend_context.h"  // llm_config_from_json / tts_config_from_json
#include "llm_client.h"
#include "tts_client.h"

namespace vtuber {

namespace {

BackendConfig from_json(const nlohmann::json& j) {
  BackendConfig config;

  config.room_id = j.value("roomId", "default");

  if (j.contains("server")) {
    const auto& s = j.at("server");
    if (s.contains("host")) config.server.host = s.at("host").get<std::string>();
    if (s.contains("httpPort")) config.server.http_port = s.at("httpPort").get<uint16_t>();
    if (s.contains("wsPort")) config.server.ws_port = s.at("wsPort").get<uint16_t>();
  }

  if (j.contains("music")) {
    const auto& m = j.at("music");
    if (m.contains("defaultVolume")) config.music.default_volume = m.at("defaultVolume").get<int>();
    if (m.contains("autoPlay")) config.music.auto_play = m.at("autoPlay").get<bool>();
    if (m.contains("preserveQueueOnRestart")) {
      config.music.preserve_queue_on_restart = m.at("preserveQueueOnRestart").get<bool>();
    }
  }

  config.llm = j.value("llm", nlohmann::json::object());
  config.tts = j.value("tts", nlohmann::json::object());
  config.triggers = j.value("triggers", nlohmann::json::array());
  config.live2d = j.value("live2d", nlohmann::json::object());
  config.display = j.value("display", nlohmann::json::object());
  config.audio = j.value("audio", nlohmann::json::object());
  config.output = j.value("output", nlohmann::json::object());
  config.system = j.value("system", nlohmann::json::object());

  return config;
}

nlohmann::json to_json(const BackendConfig& config) {
  return {
      {"roomId", config.room_id},
      {"server",
       {
           {"host", config.server.host},
           {"httpPort", config.server.http_port},
           {"wsPort", config.server.ws_port},
       }},
      {"music",
       {
           {"defaultVolume", config.music.default_volume},
           {"autoPlay", config.music.auto_play},
           {"preserveQueueOnRestart", config.music.preserve_queue_on_restart},
       }},
      {"llm", config.llm},
      {"tts", config.tts},
      {"triggers", config.triggers},
      {"live2d", config.live2d},
      {"display", config.display},
      {"audio", config.audio},
      {"output", config.output},
      {"system", config.system},
  };
}

std::string default_llm_json() {
  return R"json({
  "provider": "openai",
  "baseUrl": "https://api.openai.com/v1",
  "apiKey": "",
  "model": "gpt-4o-mini",
  "temperature": 0.7,
  "maxTokens": 2000,
  "topP": 1,
  "headers": {}
})json";
}

std::string default_tts_json() {
  return R"json({
  "provider": "volcengine",
  "baseUrl": "https://openspeech.bytedance.com",
  "apiKey": "",
  "appId": "",
  "token": "",
  "cluster": "volcano_tts",
  "voiceType": "zh_female_qingxin",
  "voiceId": "",
  "speed": 1,
  "volume": 1,
  "pitch": 1
})json";
}

std::string default_triggers_json() {
  return R"json([
  {
    "id": "danmaku-debounce",
    "name": "弹幕合并",
    "enabled": true,
    "mode": "debounce",
    "eventTypes": ["danmaku"],
    "delay": 5000,
    "maxBatch": 10
  },
  {
    "id": "gift-debounce",
    "name": "礼物合并",
    "enabled": true,
    "mode": "debounce",
    "eventTypes": ["gift"],
    "delay": 3000,
    "maxBatch": 5
  },
  {
    "id": "superchat-immediate",
    "name": "SC立即触发",
    "enabled": true,
    "mode": "immediate",
    "eventTypes": ["superchat", "guard"]
  }
])json";
}

}  // namespace

BackendConfig load_config(const std::string& path) {
  std::ifstream input(path);
  if (!input) {
    throw std::runtime_error("cannot open config file: " + path);
  }

  nlohmann::json j;
  input >> j;
  return from_json(j);
}

void save_config(const BackendConfig& config, const std::string& path) {
  std::ofstream output(path);
  if (!output) {
    throw std::runtime_error("cannot write config file: " + path);
  }
  output << to_json(config).dump(2) << "\n";
}

nlohmann::json config_to_json(const BackendConfig& config) {
  return to_json(config);
}

BackendConfig backend_config_from_json(const nlohmann::json& j) {
  return from_json(j);
}

BackendConfig default_backend_config() {
  nlohmann::json j = nlohmann::json::object();
  j["llm"] = nlohmann::json::parse(default_llm_json());
  j["tts"] = nlohmann::json::parse(default_tts_json());
  j["triggers"] = nlohmann::json::parse(default_triggers_json());
  return from_json(j);
}

nlohmann::json config_schema() {
  return {
      {"roomId",
       {{"type", "string"}, {"label", "直播间房间号"},
        {"description", "Bilibili 直播间房间号，用于事件归属与多房间隔离"}}},
      {"server",
       {{"type", "object"}, {"label", "网络服务"},
        {"description", "HTTP WebUI 与 WebSocket JSON-RPC 监听配置"},
        {"properties",
         {
             {"host",
              {{"type", "string"}, {"label", "监听地址"},
               {"description", "0.0.0.0 表示所有网卡可访问，127.0.0.1 仅本机"}}},
             {"httpPort",
              {{"type", "number"}, {"label", "HTTP 端口"},
               {"description", "WebUI 控制台访问端口"}}},
             {"wsPort",
              {{"type", "number"}, {"label", "WebSocket 端口"},
               {"description", "JSON-RPC 双向通信端口"}}},
         }}}},
      {"music",
       {{"type", "object"}, {"label", "点歌机"},
        {"description", "音乐播放与队列行为默认值"},
        {"properties",
         {
             {"defaultVolume",
              {{"type", "number"}, {"label", "默认音量"},
               {"description", "播放器初始音量 (0-100)"}}},
             {"autoPlay",
              {{"type", "boolean"}, {"label", "自动播放"},
               {"description", "队列非空时自动开始播放"}}},
             {"preserveQueueOnRestart",
              {{"type", "boolean"}, {"label", "重启保留队列"},
               {"description", "点歌机重启时保留当前播放队列"}}},
         }}}},
      {"llm",
       {{"type", "object"}, {"label", "LLM 大模型网关"},
        {"description", "OpenAI / Anthropic / Gemini 协议兼容的大模型服务"},
        {"properties",
         {
             {"provider",
              {{"type", "select"}, {"label", "提供商"}, {"options", {"openai", "anthropic", "gemini"}}}},
             {"baseUrl",
              {{"type", "string"}, {"label", "API 地址"},
               {"description", "兼容 OpenAI Chat Completions / Anthropic Messages / Gemini generateContent 的网关地址"}}},
             {"apiKey",
              {{"type", "password"}, {"label", "API Key"}, {"description", "服务商密钥，保存到本地配置文件"}}},
             {"model",
              {{"type", "string"}, {"label", "模型名称"},
               {"description", "如 gpt-4o-mini / claude-sonnet-5 / gemini-1.5-flash"}}},
             {"temperature",
              {{"type", "number"}, {"label", "温度"}, {"min", 0}, {"max", 2}, {"step", 0.1},
               {"description", "采样随机性，越高越有创意"}}},
             {"maxTokens",
              {{"type", "number"}, {"label", "最大 Token 数"}, {"min", 1}, {"max", 32000}}},
             {"topP",
              {{"type", "number"}, {"label", "Top-P"}, {"min", 0}, {"max", 1}, {"step", 0.05}}},
             {"headers",
              {{"type", "json"}, {"label", "自定义请求头"},
               {"description", "额外附加到每个 LLM 请求的 HTTP 头 (JSON 对象)"}}},
         }}}},
      {"tts",
       {{"type", "object"}, {"label", "TTS 语音合成"},
        {"description", "火山引擎 / 声音克隆语音合成配置"},
        {"properties",
         {
             {"provider",
              {{"type", "select"}, {"label", "提供商"}, {"options", {"volcengine", "clone"}}}},
             {"baseUrl", {{"type", "string"}, {"label", "API 地址"}}},
             {"apiKey", {{"type", "password"}, {"label", "API Key"}}},
             {"appId", {{"type", "string"}, {"label", "App ID"}}},
             {"token", {{"type", "password"}, {"label", "Access Token"}}},
             {"cluster",
              {{"type", "string"}, {"label", "集群标识"}, {"description", "如 volcano_tts"}}},
             {"voiceType",
              {{"type", "string"}, {"label", "音色 ID"}, {"description", "如 zh_female_qingxin"}}},
             {"voiceId", {{"type", "string"}, {"label", "克隆音色 ID"}}},
             {"speed", {{"type", "number"}, {"label", "语速"}, {"min", 0.5}, {"max", 2}, {"step", 0.1}}},
             {"volume", {{"type", "number"}, {"label", "音量"}, {"min", 0.1}, {"max", 3}, {"step", 0.1}}},
             {"pitch", {{"type", "number"}, {"label", "音调"}, {"min", 0.5}, {"max", 2}, {"step", 0.1}}},
         }}}},
      {"triggers",
       {{"type", "triggers"}, {"label", "事件触发器"},
        {"description", "决定何时触发 LLM 请求：立即 / 防抖合并 / 定时"},
        {"properties",
         {
             {"mode", {{"type", "select"}, {"label", "触发模式"}, {"options", {"immediate", "debounce", "scheduled"}}}},
             {"eventTypes", {{"type", "multiselect"}, {"label", "监听事件"}, {"options", {"danmaku", "gift", "superchat", "enter", "follow", "like", "guard", "liveStart", "liveEnd"}}}},
             {"delay", {{"type", "number"}, {"label", "防抖延迟 (ms)"}, {"min", 0}, {"max", 60000}}},
             {"maxBatch", {{"type", "number"}, {"label", "最大合并条数"}, {"min", 1}, {"max", 100}}},
             {"intervalMs", {{"type", "number"}, {"label", "定时间隔 (ms)"}, {"min", 1000}}},
         }}}},
      {"live2d",
       {{"type", "object"}, {"label", "Live2D 舞台"},
        {"description", "虚拟形象默认行为"},
        {"properties",
         {
             {"modelPath",
              {{"type", "string"}, {"label", "默认模型路径"},
               {"description", "model3.json 文件路径或 URL"}}},
             {"defaultExpression",
              {{"type", "string"}, {"label", "默认表情"},
               {"description", "如 normal / happy / sad"}}},
             {"scale", {{"type", "number"}, {"label", "默认缩放"}, {"min", 0.1}, {"max", 5}, {"step", 0.05}}},
         }}}},
      {"display",
       {{"type", "object"}, {"label", "字幕展示板"},
        {"properties",
         {
             {"fontSize", {{"type", "number"}, {"label", "字号"}, {"min", 12}, {"max", 96}}},
             {"fontFamily", {{"type", "string"}, {"label", "字体"}}},
             {"color", {{"type", "color"}, {"label", "文字颜色"}}},
             {"backgroundColor", {{"type", "color"}, {"label", "背景颜色"}}},
             {"maxDuration", {{"type", "number"}, {"label", "最长展示 (秒)"}}},
         }}}},
      {"audio",
       {{"type", "object"}, {"label", "音频播放"},
        {"properties",
         {
             {"outputDevice", {{"type", "string"}, {"label", "输出设备"}}},
             {"defaultVolume", {{"type", "number"}, {"label", "默认音量"}, {"min", 0}, {"max", 100}}},
         }}}},
      {"output",
       {{"type", "object"}, {"label", "输出策略"},
        {"description", "LLM 回复的分发方式"},
        {"properties",
         {
             {"defaultMethod",
              {{"type", "select"}, {"label", "默认输出方式"}, {"options", {"danmaku", "display", "tts"}}}},
             {"ttsEnabled", {{"type", "boolean"}, {"label", "启用 TTS 语音"}}},
             {"displayEnabled", {{"type", "boolean"}, {"label", "启用字幕展示"}}},
         }}}},
      {"system",
       {{"type", "object"}, {"label", "系统"},
        {"properties",
         {
             {"autoStart", {{"type", "boolean"}, {"label", "开机自启"}}},
             {"logLevel",
              {{"type", "select"}, {"label", "日志级别"}, {"options", {"debug", "info", "warn", "error"}}}},
         }}}},
  };
}

bool config_test_llm(const nlohmann::json& llm_config) {
  LLMConfig cfg = llm_config_from_json(llm_config);
  if (cfg.api_key.empty() && cfg.model.empty()) {
    throw std::runtime_error("LLM 未配置：请填写 API Key 与模型名称");
  }
  const auto messages = nlohmann::json::array({
      {{"role", "system"}, {"content", "You are a connectivity tester. Reply with exactly: ok"}},
      {{"role", "user"}, {"content", "ping"}},
  });
  const auto response = LLMClient(cfg).chat(messages, nlohmann::json::array());
  return !response.content.empty();
}

nlohmann::json config_test_tts(const nlohmann::json& tts_config) {
  TTSConfig cfg = tts_config_from_json(tts_config);
  if (cfg.provider == "volcengine" && cfg.app_id.empty()) {
    throw std::runtime_error("TTS 未配置：火山引擎需要 App ID / Token / 音色 ID");
  }
  const auto result = TTSClient(cfg).synthesize("你好，我是测试语音");
  return {
      {"success", !result.audio_base64.empty()},
      {"duration", result.duration_seconds},
      {"size", static_cast<int>(result.audio_base64.size())},
  };
}

}  // namespace vtuber

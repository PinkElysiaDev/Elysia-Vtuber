#pragma once

#include <cstdint>
#include <string>

#include <nlohmann/json.hpp>

namespace vtuber {

struct ServerConfig {
  std::string host = "0.0.0.0";
  uint16_t http_port = 19274;
  uint16_t ws_port = 19275;
};

struct MusicConfig {
  int default_volume = 80;
  bool auto_play = true;
  bool preserve_queue_on_restart = true;
};

struct BackendConfig {
  std::string room_id;
  ServerConfig server;
  MusicConfig music;
  nlohmann::json llm;
  nlohmann::json tts;
  nlohmann::json triggers;
  nlohmann::json live2d;
  nlohmann::json display;
  nlohmann::json audio;
  nlohmann::json output;
  nlohmann::json system;
};

BackendConfig load_config(const std::string& path);
void save_config(const BackendConfig& config, const std::string& path);
nlohmann::json config_to_json(const BackendConfig& config);
BackendConfig backend_config_from_json(const nlohmann::json& j);
BackendConfig default_backend_config();
nlohmann::json config_schema();

bool config_test_llm(const nlohmann::json& llm_config);
nlohmann::json config_test_tts(const nlohmann::json& tts_config);

}  // namespace vtuber

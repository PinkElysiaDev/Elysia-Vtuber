#pragma once

#include <memory>
#include <utility>
#include <vector>

#include "audio_player.h"
#include "config.h"
#include "display_controller.h"
#include "event_state.h"
#include "live2d_controller.h"
#include "llm_client.h"
#include "music_controller.h"
#include "tool_registry.h"
#include "trigger_engine.h"
#include "tts_client.h"

namespace vtuber {

struct BackendContext {
  BackendConfig config;
  std::string config_path;
  EventState event_state;
  TriggerEngine triggers;
  MusicController music;
  ToolRegistry tools;
  DisplayController display;
  Live2DController live2d;
  AudioPlayer audio;
  std::unique_ptr<LLMClient> llm;
  std::unique_ptr<TTSClient> tts;

  explicit BackendContext(BackendConfig cfg)
      : config(std::move(cfg)),
        event_state(config.room_id.empty() ? "default" : config.room_id),
        music(config.music.default_volume) {}

  // 热重载 LLM / TTS / 触发器，返回成功与失败信息
  nlohmann::json reload_llm();
  nlohmann::json reload_tts();
  nlohmann::json reload_triggers();
  nlohmann::json reload_all();
};

LLMConfig llm_config_from_json(const nlohmann::json& j);
TTSConfig tts_config_from_json(const nlohmann::json& j);
std::vector<TriggerRule> trigger_rules_from_json(const nlohmann::json& j);

}  // namespace vtuber

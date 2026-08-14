#include "backend_context.h"

#include <stdexcept>
#include <utility>

namespace vtuber {

LLMConfig llm_config_from_json(const nlohmann::json& j) {
  LLMConfig cfg;
  cfg.provider = j.value<std::string>("provider", "openai");
  cfg.base_url = j.value<std::string>("baseUrl", j.value<std::string>("baseURL", ""));
  cfg.api_key = j.value<std::string>("apiKey", "");
  cfg.model = j.value<std::string>("model", "");
  cfg.temperature = j.value<double>("temperature", 0.7);
  cfg.max_tokens = j.value<int>("maxTokens", 2000);
  cfg.top_p = j.value<double>("topP", 1.0);
  if (j.contains("headers") && j["headers"].is_object()) {
    for (const auto& [key, value] : j["headers"].items()) cfg.headers[key] = value.get<std::string>();
  }
  return cfg;
}

TTSConfig tts_config_from_json(const nlohmann::json& j) {
  TTSConfig cfg;
  cfg.provider = j.value<std::string>("provider", "volcengine");
  cfg.base_url = j.value<std::string>("baseUrl", j.value<std::string>("baseURL", ""));
  cfg.api_key = j.value<std::string>("apiKey", "");
  cfg.app_id = j.value<std::string>("appId", "");
  cfg.token = j.value<std::string>("token", "");
  cfg.cluster = j.value<std::string>("cluster", "volcano_tts");
  cfg.voice_type = j.value<std::string>("voiceType", "");
  cfg.voice_id = j.value<std::string>("voiceId", "");
  cfg.speed = j.value<double>("speed", 1.0);
  cfg.volume = j.value<double>("volume", 1.0);
  cfg.pitch = j.value<double>("pitch", 1.0);
  return cfg;
}

std::vector<TriggerRule> trigger_rules_from_json(const nlohmann::json& j) {
  std::vector<TriggerRule> rules;
  if (!j.is_array()) return rules;
  for (const auto& item : j) rules.push_back(trigger_rule_from_json(item));
  return rules;
}

nlohmann::json BackendContext::reload_llm() {
  try {
    const auto cfg = llm_config_from_json(config.llm);
    if (cfg.model.empty()) {
      return {{"success", false}, {"message", "LLM 模型名称未配置"}};
    }
    llm = std::make_unique<LLMClient>(cfg);
    return {{"success", true}, {"message", "LLM 已加载: " + cfg.provider + " / " + cfg.model}};
  } catch (const std::exception& ex) {
    return {{"success", false}, {"message", std::string("LLM 加载失败: ") + ex.what()}};
  }
}

nlohmann::json BackendContext::reload_tts() {
  try {
    const auto cfg = tts_config_from_json(config.tts);
    tts = std::make_unique<TTSClient>(cfg);
    return {{"success", true}, {"message", "TTS 已加载: " + cfg.provider + " / " + cfg.voice_type}};
  } catch (const std::exception& ex) {
    return {{"success", false}, {"message", std::string("TTS 加载失败: ") + ex.what()}};
  }
}

nlohmann::json BackendContext::reload_triggers() {
  try {
    const auto rules = trigger_rules_from_json(config.triggers);
    triggers.configure(rules);
    return {{"success", true}, {"message", "触发器已重载: " + std::to_string(rules.size()) + " 条规则"}};
  } catch (const std::exception& ex) {
    return {{"success", false}, {"message", std::string("触发器加载失败: ") + ex.what()}};
  }
}

nlohmann::json BackendContext::reload_all() {
  return {
      {"llm", reload_llm()},
      {"tts", reload_tts()},
      {"triggers", reload_triggers()},
  };
}

}  // namespace vtuber

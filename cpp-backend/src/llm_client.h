#pragma once

#include <map>
#include <string>
#include <vector>

#include <nlohmann/json.hpp>

namespace vtuber {

struct LLMConfig {
  std::string provider;  // openai | anthropic | gemini
  std::string base_url;
  std::string api_key;
  std::string model;
  double temperature = 0.7;
  int max_tokens = 2000;
  double top_p = 1.0;
  std::map<std::string, std::string> headers;
};

struct LLMToolCall {
  std::string id;
  std::string name;
  nlohmann::json arguments;
};

struct LLMResponse {
  std::string content;
  std::string finish_reason;
  std::vector<LLMToolCall> tool_calls;
};

class LLMClient {
 public:
  explicit LLMClient(LLMConfig config);

  LLMResponse chat(const nlohmann::json& messages,
                   const nlohmann::json& tools = nlohmann::json::array()) const;

 private:
  LLMResponse chat_openai(const nlohmann::json& messages, const nlohmann::json& tools) const;
  LLMResponse chat_anthropic(const nlohmann::json& messages, const nlohmann::json& tools) const;
  LLMResponse chat_gemini(const nlohmann::json& messages, const nlohmann::json& tools) const;

  std::pair<std::string, std::string> split_endpoint(const std::string& url) const;
  std::pair<std::string, std::string> request(const std::string& url,
                                               const std::string& path,
                                               const std::string& body,
                                               std::map<std::string, std::string> headers) const;

  LLMConfig config_;
};

}  // namespace vtuber

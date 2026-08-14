#include "llm_client.h"

#include <httplib.h>

#include <stdexcept>
#include <utility>

namespace vtuber {

LLMClient::LLMClient(LLMConfig config) : config_(std::move(config)) {}

std::pair<std::string, std::string> LLMClient::split_endpoint(const std::string& url) const {
  std::string cleaned = url;
  while (!cleaned.empty() && cleaned.back() == '/') cleaned.pop_back();

  const size_t scheme_pos = cleaned.find("://");
  if (scheme_pos == std::string::npos) {
    return {cleaned, ""};
  }

  const size_t path_pos = cleaned.find('/', scheme_pos + 3);
  if (path_pos == std::string::npos) {
    return {cleaned, ""};
  }

  return {cleaned.substr(0, path_pos), cleaned.substr(path_pos)};
}

std::pair<std::string, std::string> LLMClient::request(
    const std::string& url,
    const std::string& path,
    const std::string& body,
    std::map<std::string, std::string> headers) const {
  httplib::Client cli(url);
  cli.set_connection_timeout(30, 0);
  cli.set_read_timeout(60, 0);

  httplib::Headers httplib_headers;
  for (const auto& [key, value] : headers) {
    httplib_headers.emplace(key, value);
  }

  auto res = cli.Post(path, httplib_headers, body, "application/json");
  if (!res) {
    throw std::runtime_error("LLM request failed: " + std::to_string(static_cast<int>(res.error())));
  }
  if (res->status < 200 || res->status >= 300) {
    throw std::runtime_error("LLM HTTP " + std::to_string(res->status) + ": " + res->body);
  }
  return {res->body, std::to_string(res->status)};
}

LLMResponse LLMClient::chat(const nlohmann::json& messages, const nlohmann::json& tools) const {
  if (config_.provider == "anthropic") return chat_anthropic(messages, tools);
  if (config_.provider == "gemini") return chat_gemini(messages, tools);
  return chat_openai(messages, tools);
}

LLMResponse LLMClient::chat_openai(const nlohmann::json& messages, const nlohmann::json& tools) const {
  const auto [host, prefix] = split_endpoint(config_.base_url.empty()
                                                  ? "https://api.openai.com/v1"
                                                  : config_.base_url);
  nlohmann::json body = {
      {"model", config_.model},
      {"messages", messages},
      {"temperature", config_.temperature},
      {"max_tokens", config_.max_tokens},
      {"top_p", config_.top_p},
  };
  if (!tools.empty()) {
    nlohmann::json converted = nlohmann::json::array();
    for (const auto& tool : tools) {
      converted.push_back({
          {"type", "function"},
          {"function", {
              {"name", tool.value("name", "")},
              {"description", tool.value("description", "")},
              {"parameters", tool.value("parameters", nlohmann::json::object())},
          }},
      });
    }
    body["tools"] = converted;
  }

  auto headers = config_.headers;
  headers["Authorization"] = "Bearer " + config_.api_key;
  const auto [resp, status] = request(host, prefix + "/chat/completions", body.dump(), headers);
  (void)status;

  const auto data = nlohmann::json::parse(resp);
  const auto& choice = data.at("choices").at(0);
  LLMResponse response;
  response.content = choice.value("message", nlohmann::json::object()).value("content", "");
  response.finish_reason = choice.value("finish_reason", "");

  if (choice.value("message", nlohmann::json::object()).contains("tool_calls")) {
    for (const auto& call : choice["message"]["tool_calls"]) {
      LLMToolCall tc;
      tc.id = call.value("id", "");
      tc.name = call.value("function", nlohmann::json::object()).value("name", "");
      tc.arguments = nlohmann::json::parse(call.value("function", nlohmann::json::object()).value("arguments", "{}"));
      response.tool_calls.push_back(std::move(tc));
    }
  }
  return response;
}

LLMResponse LLMClient::chat_anthropic(const nlohmann::json& messages, const nlohmann::json& tools) const {
  const auto [host, prefix] = split_endpoint(config_.base_url.empty()
                                                  ? "https://api.anthropic.com/v1"
                                                  : config_.base_url);
  std::string system;
  nlohmann::json converted = nlohmann::json::array();
  for (const auto& msg : messages) {
    if (msg.value("role", "") == "system") {
      system = msg.value("content", "");
    } else {
      converted.push_back({
          {"role", msg.value("role", "user") == "assistant" ? "assistant" : "user"},
          {"content", msg.value("content", "")},
      });
    }
  }

  nlohmann::json body = {
      {"model", config_.model},
      {"max_tokens", config_.max_tokens},
      {"messages", converted},
      {"temperature", config_.temperature},
  };
  if (!system.empty()) body["system"] = system;
  if (!tools.empty()) {
    nlohmann::json converted = nlohmann::json::array();
    for (const auto& tool : tools) {
      converted.push_back({
          {"name", tool.value("name", "")},
          {"description", tool.value("description", "")},
          {"input_schema", tool.value("parameters", nlohmann::json::object())},
      });
    }
    body["tools"] = converted;
  }

  auto headers = config_.headers;
  headers["x-api-key"] = config_.api_key;
  headers["anthropic-version"] = "2023-06-01";
  const auto [resp, status] = request(host, prefix + "/messages", body.dump(), headers);
  (void)status;

  const auto data = nlohmann::json::parse(resp);
  LLMResponse response;
  response.finish_reason = data.value("stop_reason", "");
  for (const auto& block : data.value("content", nlohmann::json::array())) {
    if (block.value("type", "") == "text") {
      response.content += block.value("text", "");
    } else if (block.value("type", "") == "tool_use") {
      LLMToolCall tc;
      tc.id = block.value("id", "");
      tc.name = block.value("name", "");
      tc.arguments = block.value("input", nlohmann::json::object());
      response.tool_calls.push_back(std::move(tc));
    }
  }
  return response;
}

LLMResponse LLMClient::chat_gemini(const nlohmann::json& messages, const nlohmann::json& tools) const {
  const auto [host, prefix] = split_endpoint(config_.base_url.empty()
                                                  ? "https://generativelanguage.googleapis.com/v1beta"
                                                  : config_.base_url);
  nlohmann::json contents = nlohmann::json::array();
  std::string system;
  for (const auto& msg : messages) {
    if (msg.value("role", "") == "system") {
      system += msg.value("content", "") + "\n";
    } else {
      contents.push_back({
          {"role", msg.value("role", "user") == "assistant" ? "model" : "user"},
          {"parts", {{"text", msg.value("content", "")}}},
      });
    }
  }
  if (!system.empty() && !contents.empty()) {
    contents[0]["parts"].insert(contents[0]["parts"].begin(), {{"text", system}});
  }

  nlohmann::json body = {
      {"contents", contents},
      {"generationConfig",
       {
           {"temperature", config_.temperature},
           {"maxOutputTokens", config_.max_tokens},
           {"topP", config_.top_p},
       }},
  };
  if (!tools.empty()) {
    body["tools"] = {{{"functionDeclarations", tools}}};
  }

  auto headers = config_.headers;
  const std::string query = "?key=" + config_.api_key;
  const auto [resp, status] = request(host, prefix + "/models/" + config_.model + ":generateContent" + query,
                                     body.dump(), headers);
  (void)status;

  const auto data = nlohmann::json::parse(resp);
  LLMResponse response;
  const auto& candidate = data.at("candidates").at(0);
  response.finish_reason = candidate.value("finishReason", "");
  for (const auto& part : candidate.value("content", nlohmann::json::object()).value("parts", nlohmann::json::array())) {
    if (part.contains("text")) {
      response.content += part.value("text", "");
    }
    if (part.contains("functionCall")) {
      LLMToolCall tc;
      tc.id = "call_" + std::to_string(response.tool_calls.size());
      tc.name = part["functionCall"].value("name", "");
      tc.arguments = part["functionCall"].value("args", nlohmann::json::object());
      response.tool_calls.push_back(std::move(tc));
    }
  }
  return response;
}

}  // namespace vtuber

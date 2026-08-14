#include "tts_client.h"

#include <httplib.h>

#include <stdexcept>
#include <utility>

namespace vtuber {

TTSClient::TTSClient(TTSConfig config) : config_(std::move(config)) {}

std::pair<std::string, std::string> TTSClient::split_endpoint(const std::string& url) const {
  std::string cleaned = url;
  while (!cleaned.empty() && cleaned.back() == '/') cleaned.pop_back();
  const size_t scheme_pos = cleaned.find("://");
  if (scheme_pos == std::string::npos) return {cleaned, ""};
  const size_t path_pos = cleaned.find('/', scheme_pos + 3);
  if (path_pos == std::string::npos) return {cleaned, ""};
  return {cleaned.substr(0, path_pos), cleaned.substr(path_pos)};
}

std::string TTSClient::request(const std::string& url, const std::string& path,
                               const std::string& body,
                               const std::map<std::string, std::string>& headers) const {
  httplib::Client cli(url);
  cli.set_connection_timeout(30, 0);
  cli.set_read_timeout(60, 0);

  httplib::Headers converted;
  for (const auto& [key, value] : headers) converted.emplace(key, value);

  auto res = cli.Post(path, converted, body, "application/json");
  if (!res) {
    throw std::runtime_error("TTS request failed: " +
                             std::to_string(static_cast<int>(res.error())));
  }
  if (res->status < 200 || res->status >= 300) {
    throw std::runtime_error("TTS HTTP " + std::to_string(res->status) + ": " + res->body);
  }
  return res->body;
}

TTSResult TTSClient::synthesize(const std::string& text) const {
  if (config_.provider == "volcengine") {
    const auto [host, prefix] = split_endpoint(config_.base_url.empty()
                                                   ? "https://openspeech.bytedance.com"
                                                   : config_.base_url);
    nlohmann::json body = {
        {"app", {{"appid", config_.app_id}, {"token", config_.token}, {"cluster", config_.cluster.empty() ? "volcano_tts" : config_.cluster}}},
        {"user", {{"uid", "vtuber_backend"}}},
        {"audio", {
            {"voice_type", config_.voice_type},
            {"encoding", "mp3"},
            {"speed_ratio", config_.speed},
            {"volume_ratio", config_.volume},
            {"pitch_ratio", config_.pitch},
        }},
        {"request", {{"reqid", "vtuber_backend"}, {"text", text}, {"text_type", "plain"}, {"operation", "query"}}},
    };

    std::map<std::string, std::string> headers = {{"Authorization", "Bearer " + config_.token}};
    const auto resp = request(host, prefix + "/api/v1/tts", body.dump(), headers);
    const auto data = nlohmann::json::parse(resp);
    if (data.value("code", 0) != 0) {
      throw std::runtime_error("Volcengine TTS error: " + data.value("message", "unknown"));
    }
    return {data.value("data", ""), data.value("duration", 0.0)};
  }

  if (config_.provider == "clone") {
    const auto [host, prefix] = split_endpoint(config_.base_url.empty()
                                                   ? "https://api.example.com"
                                                   : config_.base_url);
    nlohmann::json body = {
        {"text", text},
        {"voice_id", config_.voice_id},
        {"speed", config_.speed},
        {"volume", config_.volume},
        {"pitch", config_.pitch},
    };
    std::map<std::string, std::string> headers = {{"Authorization", "Bearer " + config_.api_key}};
    const auto resp = request(host, prefix + "/api/v1/clone", body.dump(), headers);
    const auto data = nlohmann::json::parse(resp);
    if (!data.value("success", true)) {
      throw std::runtime_error("Clone TTS error: " + data.value("error", "unknown"));
    }
    return {data.value("audio", ""), data.value("duration", 0.0)};
  }

  throw std::runtime_error("unknown TTS provider: " + config_.provider);
}

std::vector<std::string> TTSClient::split_text(const std::string& text, size_t max_length) const {
  std::vector<std::string> segments;
  std::string current;
  for (size_t i = 0; i < text.size();) {
    const size_t next = text.find_first_of("。！？.!?", i);
    const size_t end = next == std::string::npos ? text.size() : next + 1;
    const std::string sentence = text.substr(i, end - i);
    if (current.size() + sentence.size() > max_length && !current.empty()) {
      segments.push_back(current);
      current.clear();
    }
    current += sentence;
    i = end;
  }
  if (!current.empty()) segments.push_back(current);
  return segments;
}

}  // namespace vtuber

#pragma once

#include <map>
#include <string>
#include <vector>

#include <nlohmann/json.hpp>

namespace vtuber {

struct TTSConfig {
  std::string provider;  // volcengine | clone
  std::string base_url;
  std::string api_key;
  std::string app_id;
  std::string token;
  std::string cluster;
  std::string voice_type;
  std::string voice_id;
  double speed = 1.0;
  double volume = 1.0;
  double pitch = 1.0;
};

struct TTSResult {
  std::string audio_base64;
  double duration_seconds = 0.0;
};

class TTSClient {
 public:
  explicit TTSClient(TTSConfig config);

  TTSResult synthesize(const std::string& text) const;
  std::vector<std::string> split_text(const std::string& text, size_t max_length = 200) const;

 private:
  std::pair<std::string, std::string> split_endpoint(const std::string& url) const;
  std::string request(const std::string& url, const std::string& path,
                      const std::string& body, const std::map<std::string, std::string>& headers) const;

  TTSConfig config_;
};

}  // namespace vtuber

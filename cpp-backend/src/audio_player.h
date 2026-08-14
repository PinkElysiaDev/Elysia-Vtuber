#pragma once

#include <deque>
#include <functional>
#include <string>

#include <nlohmann/json.hpp>

namespace vtuber {

class AudioPlayer {
 public:
  using Notify = std::function<void(const std::string& method, const nlohmann::json& params)>;

  void set_notify(Notify notify);
  nlohmann::json play(const std::string& url, int volume);
  nlohmann::json stop();
  nlohmann::json set_volume(int volume);
  nlohmann::json get_state() const;
  nlohmann::json clear_queue();

 private:
  Notify notify_;
  std::deque<std::string> queue_;
  std::string current_url_;
  bool playing_ = false;
  int volume_ = 80;
};

}  // namespace vtuber

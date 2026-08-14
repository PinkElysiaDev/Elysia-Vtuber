#include "audio_player.h"

#include <algorithm>
#include <utility>

namespace vtuber {

void AudioPlayer::set_notify(Notify notify) {
  notify_ = std::move(notify);
}

nlohmann::json AudioPlayer::play(const std::string& url, int volume) {
  if (url.empty()) return {{"success", false}, {"error", "url is required"}};
  if (volume >= 0) volume_ = std::clamp(volume, 0, 100);

  if (playing_) {
    queue_.push_back(url);
  } else {
    current_url_ = url;
    playing_ = true;
  }

  if (notify_) {
    notify_("audio.state", get_state());
  }
  return {{"success", true}, {"queued", playing_ && current_url_ != url}};
}

nlohmann::json AudioPlayer::stop() {
  playing_ = false;
  current_url_.clear();
  queue_.clear();
  if (notify_) notify_("audio.state", get_state());
  return {{"success", true}};
}

nlohmann::json AudioPlayer::set_volume(int volume) {
  volume_ = std::clamp(volume, 0, 100);
  if (notify_) notify_("audio.volumeChanged", {{"volume", volume_}});
  return {{"success", true}, {"volume", volume_}};
}

nlohmann::json AudioPlayer::clear_queue() {
  queue_.clear();
  if (notify_) notify_("audio.state", get_state());
  return {{"success", true}};
}

nlohmann::json AudioPlayer::get_state() const {
  return {
      {"playing", playing_},
      {"currentUrl", current_url_},
      {"volume", volume_},
      {"queue", queue_},
  };
}

}  // namespace vtuber

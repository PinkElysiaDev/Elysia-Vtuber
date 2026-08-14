#pragma once

#include <cstdint>
#include <functional>
#include <optional>
#include <string>
#include <vector>

#include <nlohmann/json.hpp>

namespace vtuber {

enum class JukeboxState {
  Stopped,
  Starting,
  Running,
  Stopping,
  Restarting,
  Error,
};

struct SongInfo {
  std::string id;
  std::string title;
  std::string artist;
  std::string album;
  int duration_seconds = 0;
  std::string source;
  std::string url;
  std::string cover_url;
  std::string requester;
};

struct PlaybackState {
  JukeboxState state = JukeboxState::Stopped;
  int volume = 80;
  bool muted = false;
  std::optional<SongInfo> current_song;
  std::vector<SongInfo> queue;
  std::string last_error;
};

class MusicController {
 public:
  using NotifyCallback = std::function<void(const std::string& method, const nlohmann::json& params)>;

  explicit MusicController(int default_volume = 80);

  void set_notify_callback(NotifyCallback callback);

  // Lifecycle
  nlohmann::json start();
  nlohmann::json stop();
  nlohmann::json restart(bool preserve_queue);

  // Playback and queue
  nlohmann::json search(const nlohmann::json& params);
  nlohmann::json add(const nlohmann::json& params);
  nlohmann::json play();
  nlohmann::json pause();
  nlohmann::json skip();
  nlohmann::json seek(const nlohmann::json& params);
  nlohmann::json remove(const nlohmann::json& params);
  nlohmann::json clear_queue();
  nlohmann::json get_queue() const;
  nlohmann::json get_now_playing() const;

  // Volume
  nlohmann::json set_volume(int volume);
  nlohmann::json adjust_volume(int delta);
  nlohmann::json mute();
  nlohmann::json unmute();
  nlohmann::json get_volume() const;

  // State
  nlohmann::json get_state() const;
  PlaybackState snapshot() const;

 private:
  void set_state(JukeboxState state);
  void notify_state();
  void notify_queue();
  void notify_volume();
  nlohmann::json song_to_json(const SongInfo& song) const;
  static std::string state_to_string(JukeboxState state);

  int default_volume_;
  int volume_;
  bool muted_ = false;
  JukeboxState state_ = JukeboxState::Stopped;
  std::string last_error_;

  std::vector<SongInfo> queue_;
  std::optional<SongInfo> current_song_;
  bool playing_ = false;
  double position_seconds_ = 0.0;

  NotifyCallback notify_callback_;
};

}  // namespace vtuber

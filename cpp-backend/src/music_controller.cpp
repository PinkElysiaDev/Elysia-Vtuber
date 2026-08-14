#include "music_controller.h"

#include <algorithm>
#include <chrono>
#include <sstream>

namespace vtuber {

namespace {

int clamp_volume(int value) {
  return std::clamp(value, 0, 100);
}

std::string now_iso() {
  const auto now = std::chrono::system_clock::now();
  const auto ms = std::chrono::duration_cast<std::chrono::milliseconds>(
      now.time_since_epoch());
  return std::to_string(ms.count());
}

}  // namespace

MusicController::MusicController(int default_volume)
    : default_volume_(clamp_volume(default_volume)), volume_(default_volume_) {}

void MusicController::set_notify_callback(NotifyCallback callback) {
  notify_callback_ = std::move(callback);
}

void MusicController::set_state(JukeboxState state) {
  state_ = state;
  if (state != JukeboxState::Error) {
    last_error_.clear();
  }
  notify_state();
}

void MusicController::notify_state() {
  if (notify_callback_) {
    notify_callback_("jukebox.state", get_state());
  }
}

void MusicController::notify_queue() {
  if (notify_callback_) {
    notify_callback_("jukebox.queueChanged", get_queue());
  }
}

void MusicController::notify_volume() {
  if (notify_callback_) {
    notify_callback_("jukebox.volumeChanged", get_volume());
  }
}

std::string MusicController::state_to_string(JukeboxState state) {
  switch (state) {
    case JukeboxState::Stopped:
      return "stopped";
    case JukeboxState::Starting:
      return "starting";
    case JukeboxState::Running:
      return "running";
    case JukeboxState::Stopping:
      return "stopping";
    case JukeboxState::Restarting:
      return "restarting";
    case JukeboxState::Error:
      return "error";
  }
  return "unknown";
}

nlohmann::json MusicController::song_to_json(const SongInfo& song) const {
  return {
      {"id", song.id},
      {"title", song.title},
      {"artist", song.artist},
      {"album", song.album},
      {"duration", song.duration_seconds},
      {"source", song.source},
      {"url", song.url},
      {"coverUrl", song.cover_url},
      {"requester", song.requester},
  };
}

nlohmann::json MusicController::start() {
  if (state_ == JukeboxState::Running) {
    return {{"success", true}, {"state", state_to_string(state_)}, {"message", "already running"}};
  }

  set_state(JukeboxState::Starting);

  if (!current_song_ && !queue_.empty()) {
    current_song_ = queue_.front();
    queue_.erase(queue_.begin());
    playing_ = true;
    position_seconds_ = 0.0;
    notify_queue();
  } else if (current_song_) {
    playing_ = true;
  }

  set_state(JukeboxState::Running);
  return {{"success", true}, {"state", state_to_string(state_)}};
}

nlohmann::json MusicController::stop() {
  if (state_ == JukeboxState::Stopped) {
    return {{"success", true}, {"state", state_to_string(state_)}, {"message", "already stopped"}};
  }

  set_state(JukeboxState::Stopping);
  playing_ = false;
  position_seconds_ = 0.0;
  current_song_.reset();
  set_state(JukeboxState::Stopped);
  return {{"success", true}, {"state", state_to_string(state_)}};
}

nlohmann::json MusicController::restart(bool preserve_queue) {
  set_state(JukeboxState::Restarting);
  playing_ = false;
  position_seconds_ = 0.0;
  current_song_.reset();

  if (!preserve_queue) {
    queue_.clear();
    notify_queue();
  }

  auto result = start();
  result["restarted"] = true;
  result["preserveQueue"] = preserve_queue;
  return result;
}

nlohmann::json MusicController::search(const nlohmann::json& params) {
  // Real music-source integration is intentionally not implemented here.
  // The controller contract is stable, so a provider can be added later.
  const std::string keyword = params.value<std::string>("keyword", "");
  return {
      {"keyword", keyword},
      {"source", params.value("source", "netease")},
      {"songs", nlohmann::json::array()},
      {"total", 0},
  };
}

nlohmann::json MusicController::add(const nlohmann::json& params) {
  if (!params.contains("songId")) {
    return {{"success", false}, {"error", "songId is required"}};
  }

  SongInfo song;
  song.id = params.at("songId").get<std::string>();
  song.title = params.value<std::string>("title", "Unknown");
  song.artist = params.value<std::string>("artist", "Unknown");
  song.album = params.value<std::string>("album", "");
  song.duration_seconds = params.value<int>("duration", 0);
  song.source = params.value<std::string>("source", "netease");
  song.url = params.value<std::string>("url", "");
  song.cover_url = params.value<std::string>("coverUrl", "");
  song.requester = params.value<std::string>("requester", "");

  queue_.push_back(song);
  notify_queue();

  if (playing_ == false && state_ == JukeboxState::Running && !current_song_) {
    current_song_ = queue_.front();
    queue_.erase(queue_.begin());
    playing_ = true;
    notify_queue();
    notify_state();
  }

  return {{"success", true}, {"song", song_to_json(song)}};
}

nlohmann::json MusicController::play() {
  if (state_ != JukeboxState::Running) {
    auto result = start();
    if (!result.value("success", false)) {
      return result;
    }
  }

  if (!current_song_ && !queue_.empty()) {
    current_song_ = queue_.front();
    queue_.erase(queue_.begin());
    notify_queue();
  }

  if (!current_song_) {
    return {{"success", false}, {"error", "no song to play"}};
  }

  playing_ = true;
  notify_state();
  return {{"success", true}, {"song", song_to_json(*current_song_)}};
}

nlohmann::json MusicController::pause() {
  if (!playing_) {
    return {{"success", true}, {"message", "not playing"}};
  }
  playing_ = false;
  notify_state();
  return {{"success", true}};
}

nlohmann::json MusicController::skip() {
  if (queue_.empty()) {
    current_song_.reset();
    playing_ = false;
    notify_state();
    return {{"success", true}, {"message", "queue empty"}};
  }

  current_song_ = queue_.front();
  queue_.erase(queue_.begin());
  position_seconds_ = 0.0;
  playing_ = true;
  notify_queue();
  notify_state();
  return {{"success", true}, {"song", song_to_json(*current_song_)}};
}

nlohmann::json MusicController::seek(const nlohmann::json& params) {
  const int seconds = params.value("seconds", 0);
  position_seconds_ = static_cast<double>(std::max(0, seconds));
  notify_state();
  return {{"success", true}, {"position", position_seconds_}};
}

nlohmann::json MusicController::remove(const nlohmann::json& params) {
  if (!params.contains("index")) {
    return {{"success", false}, {"error", "index is required"}};
  }

  const int index = params.at("index").get<int>();
  if (index < 0 || static_cast<size_t>(index) >= queue_.size()) {
    return {{"success", false}, {"error", "invalid queue index"}};
  }

  queue_.erase(queue_.begin() + index);
  notify_queue();
  return {{"success", true}};
}

nlohmann::json MusicController::clear_queue() {
  queue_.clear();
  notify_queue();
  return {{"success", true}};
}

nlohmann::json MusicController::get_queue() const {
  nlohmann::json arr = nlohmann::json::array();
  for (const auto& song : queue_) {
    arr.push_back(song_to_json(song));
  }
  return arr;
}

nlohmann::json MusicController::get_now_playing() const {
  if (!current_song_) {
    return nullptr;
  }

  return {
      {"song", song_to_json(*current_song_)},
      {"position", position_seconds_},
      {"playing", playing_},
  };
}

nlohmann::json MusicController::set_volume(int volume) {
  volume_ = clamp_volume(volume);
  muted_ = volume_ == 0;
  notify_volume();
  return get_volume();
}

nlohmann::json MusicController::adjust_volume(int delta) {
  return set_volume(volume_ + delta);
}

nlohmann::json MusicController::mute() {
  muted_ = true;
  notify_volume();
  return get_volume();
}

nlohmann::json MusicController::unmute() {
  muted_ = false;
  if (volume_ == 0) {
    volume_ = default_volume_;
  }
  notify_volume();
  return get_volume();
}

nlohmann::json MusicController::get_volume() const {
  return {
      {"volume", volume_},
      {"muted", muted_},
      {"percent", volume_},
  };
}

nlohmann::json MusicController::get_state() const {
  return {
      {"state", state_to_string(state_)},
      {"volume", volume_},
      {"muted", muted_},
      {"playing", playing_},
      {"position", position_seconds_},
      {"currentSong", current_song_ ? song_to_json(*current_song_) : nlohmann::json(nullptr)},
      {"queue", get_queue()},
      {"lastError", last_error_},
  };
}

PlaybackState MusicController::snapshot() const {
  PlaybackState state;
  state.state = state_;
  state.volume = volume_;
  state.muted = muted_;
  state.current_song = current_song_;
  state.queue = queue_;
  state.last_error = last_error_;
  return state;
}

}  // namespace vtuber

#pragma once

#include <cstdint>
#include <map>
#include <optional>
#include <string>
#include <vector>

#include <nlohmann/json.hpp>

namespace vtuber {

struct StandardEvent {
  std::string type;
  int64_t timestamp = 0;
  std::string room_id;
  nlohmann::json user;
  nlohmann::json data;
};

class EventState {
 public:
  explicit EventState(std::string room_id, size_t history_size = 50);

  void add_event(const StandardEvent& event);
  nlohmann::json get_state() const;
  nlohmann::json get_history(const std::string& type, size_t count = 0) const;
  nlohmann::json get_recent_events(int64_t window_ms) const;
  std::string get_variable(const std::string& path, const std::optional<StandardEvent>& current) const;

 private:
  std::string room_id_;
  size_t history_size_;
  bool is_live_ = false;
  int64_t live_started_at_ = 0;
  int64_t likes_ = 0;
  std::vector<StandardEvent> events_;
  std::vector<StandardEvent> danmaku_;
  std::vector<StandardEvent> gifts_;
  std::vector<StandardEvent> superchats_;

  void trim(std::vector<StandardEvent>& history);
  std::string format_events(const std::vector<StandardEvent>& events, const std::string& kind) const;
};

StandardEvent event_from_json(const nlohmann::json& j);
nlohmann::json event_to_json(const StandardEvent& event);

}  // namespace vtuber

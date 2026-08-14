#include "event_state.h"

#include <algorithm>
#include <chrono>
#include <utility>

namespace vtuber {

namespace {

int64_t now_ms() {
  return std::chrono::duration_cast<std::chrono::milliseconds>(
             std::chrono::system_clock::now().time_since_epoch())
      .count();
}

}  // namespace

StandardEvent event_from_json(const nlohmann::json& j) {
  StandardEvent event;
  event.type = j.value("type", "unknown");
  event.timestamp = j.value("timestamp", now_ms());
  event.room_id = j.value("roomId", "");
  event.user = j.value("user", nlohmann::json::object());
  event.data = j.value("data", nlohmann::json::object());
  return event;
}

nlohmann::json event_to_json(const StandardEvent& event) {
  return {
      {"type", event.type},
      {"timestamp", event.timestamp},
      {"roomId", event.room_id},
      {"user", event.user},
      {"data", event.data},
  };
}

EventState::EventState(std::string room_id, size_t history_size)
    : room_id_(std::move(room_id)), history_size_(std::max<size_t>(1, history_size)) {}

void EventState::trim(std::vector<StandardEvent>& history) {
  if (history.size() <= history_size_) return;
  history.erase(history.begin(), history.begin() + (history.size() - history_size_));
}

void EventState::add_event(const StandardEvent& event) {
  events_.push_back(event);
  if (events_.size() > history_size_ * 3) {
    events_.erase(events_.begin(), events_.end() - history_size_ * 3);
  }

  if (event.type == "danmaku") {
    danmaku_.push_back(event);
    trim(danmaku_);
  } else if (event.type == "gift") {
    gifts_.push_back(event);
    trim(gifts_);
  } else if (event.type == "superchat") {
    superchats_.push_back(event);
    trim(superchats_);
  } else if (event.type == "liveStart") {
    is_live_ = true;
    live_started_at_ = event.timestamp;
  } else if (event.type == "liveEnd") {
    is_live_ = false;
    live_started_at_ = 0;
  } else if (event.type == "like") {
    likes_ += event.data.value("count", 1);
  }
}

nlohmann::json EventState::get_state() const {
  return {
      {"roomId", room_id_},
      {"isLive", is_live_},
      {"liveStartedAt", live_started_at_},
      {"likes", likes_},
      {"danmakuCount", danmaku_.size()},
      {"giftCount", gifts_.size()},
      {"superchatCount", superchats_.size()},
      {"eventCount", events_.size()},
  };
}

nlohmann::json EventState::get_history(const std::string& type, size_t count) const {
  const std::vector<StandardEvent>* source = nullptr;
  if (type == "danmaku") source = &danmaku_;
  else if (type == "gift") source = &gifts_;
  else if (type == "superchat") source = &superchats_;
  else source = &events_;

  nlohmann::json arr = nlohmann::json::array();
  const size_t limit = count == 0 ? source->size() : std::min(count, source->size());
  for (size_t i = source->size() - limit; i < source->size(); ++i) {
    arr.push_back(event_to_json((*source)[i]));
  }
  return arr;
}

nlohmann::json EventState::get_recent_events(int64_t window_ms) const {
  const int64_t cutoff = now_ms() - window_ms;
  nlohmann::json arr = nlohmann::json::array();
  for (const auto& event : events_) {
    if (event.timestamp >= cutoff) arr.push_back(event_to_json(event));
  }
  return arr;
}

std::string EventState::format_events(const std::vector<StandardEvent>& events,
                                      const std::string& kind) const {
  if (events.empty()) return "暂无" + kind;

  std::string result;
  for (const auto& event : events) {
    const std::string user = event.user.value("name", "未知用户");
    if (kind == "弹幕") {
      result += user + ": " + event.data.value("content", "") + "\n";
    } else if (kind == "礼物") {
      result += user + " 赠送了 " + event.data.value("giftName", "礼物") + " x" +
                std::to_string(event.data.value<int>("num", 1)) + "\n";
    } else if (kind == "醒目留言") {
      result += user + "(¥" + std::to_string(event.data.value<int>("price", 0)) + "): " +
                event.data.value("message", "") + "\n";
    }
  }
  return result;
}

std::string EventState::get_variable(const std::string& path,
                                     const std::optional<StandardEvent>& current) const {
  if (path == "room_id") return room_id_;
  if (path == "state.isLive") return is_live_ ? "true" : "false";
  if (path == "state.likes") return std::to_string(likes_);
  if (path == "state.liveDuration") {
    if (!is_live_ || live_started_at_ == 0) return "0";
    return std::to_string((now_ms() - live_started_at_) / 1000);
  }
  if (path == "time.now") return std::to_string(now_ms());
  if (path == "history.danmaku") return format_events(danmaku_, "弹幕");
  if (path == "history.gift") return format_events(gifts_, "礼物");
  if (path == "history.superchat") return format_events(superchats_, "醒目留言");
  if (current) {
    if (path == "event.type") return current->type;
    if (path == "event.user.name") return current->user.value("name", "");
    if (path == "event.user.uid") return current->user.value("uid", "");
    if (path == "event.data") return current->data.dump();
  }
  return "";
}

}  // namespace vtuber

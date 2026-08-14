#include "trigger_engine.h"

#include <algorithm>
#include <chrono>
#include <iostream>

namespace vtuber {

namespace {

int64_t now_ms() {
  return std::chrono::duration_cast<std::chrono::milliseconds>(
             std::chrono::system_clock::now().time_since_epoch())
      .count();
}

}  // namespace

TriggerRule trigger_rule_from_json(const nlohmann::json& j) {
  TriggerRule rule;
  rule.id = j.value<std::string>("id", "trigger");
  rule.name = j.value<std::string>("name", rule.id);
  rule.enabled = j.value<bool>("enabled", true);
  rule.mode = j.value<std::string>("mode", "immediate");
  rule.delay_ms = j.value<int>("delay", j.value<int>("delayMs", 3000));
  rule.max_batch = j.value<int>("maxBatch", 10);
  rule.interval_ms = j.value<int>("intervalMs", 0);

  if (j.contains("eventTypes")) {
    for (const auto& type : j.at("eventTypes")) rule.event_types.push_back(type.get<std::string>());
  }
  return rule;
}

TriggerEngine::TriggerEngine() : worker_(&TriggerEngine::worker_loop, this) {}

TriggerEngine::~TriggerEngine() {
  stop();
}

void TriggerEngine::configure(const std::vector<TriggerRule>& rules) {
  std::lock_guard lock(mutex_);
  rules_ = rules;
  cv_.notify_all();
}

size_t TriggerEngine::rules_count() const {
  return rules_.size();
}

void TriggerEngine::set_callback(TriggerCallback callback) {
  std::lock_guard lock(mutex_);
  callback_ = std::move(callback);
}

void TriggerEngine::handle_event(const StandardEvent& event) {
  std::lock_guard lock(mutex_);

  for (const auto& rule : rules_) {
    if (!rule.enabled) continue;
    if (rule.mode == "immediate") {
      if (rule.event_types.empty() ||
          std::find(rule.event_types.begin(), rule.event_types.end(), event.type) != rule.event_types.end()) {
        fire(rule.id, {event});
      }
    } else if (rule.mode == "debounce") {
      if (!rule.event_types.empty() &&
          std::find(rule.event_types.begin(), rule.event_types.end(), event.type) == rule.event_types.end()) {
        continue;
      }
      auto& batch = debounce_batches_[rule.id];
      batch.push_back(event);
      deadlines_[rule.id] = now_ms() + rule.delay_ms;
      if (static_cast<int>(batch.size()) >= rule.max_batch) {
        fire(rule.id, std::move(batch));
        debounce_batches_.erase(rule.id);
        deadlines_.erase(rule.id);
      }
    }
  }
  cv_.notify_all();
}

void TriggerEngine::fire(const std::string& rule_id, std::vector<StandardEvent> events) {
  if (!callback_) return;
  callback_(rule_id, std::move(events));
}

void TriggerEngine::worker_loop() {
  while (running_) {
    std::unique_lock lock(mutex_);
    int64_t wait_ms = 1000;

    for (const auto& [id, deadline] : deadlines_) {
      const int64_t delta = deadline - now_ms();
      wait_ms = std::min<int64_t>(wait_ms, std::max<int64_t>(0, delta));
    }

    for (const auto& rule : rules_) {
      if (rule.mode == "scheduled" && rule.enabled && rule.interval_ms > 0) {
        const int64_t last = last_scheduled_[rule.id];
        wait_ms = std::min<int64_t>(wait_ms, std::max<int64_t>(0, last + rule.interval_ms - now_ms()));
      }
    }

    cv_.wait_for(lock, std::chrono::milliseconds(wait_ms));
    if (!running_) break;

    const int64_t now = now_ms();
    std::vector<std::string> fired;
    for (const auto& [id, deadline] : deadlines_) {
      if (now >= deadline) fired.push_back(id);
    }
    for (const auto& id : fired) {
      auto it = debounce_batches_.find(id);
      if (it != debounce_batches_.end() && !it->second.empty()) {
        fire(id, std::move(it->second));
      }
      debounce_batches_.erase(id);
      deadlines_.erase(id);
    }

    for (const auto& rule : rules_) {
      if (rule.mode == "scheduled" && rule.enabled && rule.interval_ms > 0) {
        const int64_t last = last_scheduled_[rule.id];
        if (now - last >= rule.interval_ms) {
          last_scheduled_[rule.id] = now;
          fire(rule.id, {});
        }
      }
    }
  }
}

void TriggerEngine::stop() {
  if (!running_.exchange(false)) return;
  cv_.notify_all();
  if (worker_.joinable()) worker_.join();
}

}  // namespace vtuber

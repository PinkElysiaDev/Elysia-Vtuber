#pragma once

#include <atomic>
#include <condition_variable>
#include <functional>
#include <map>
#include <mutex>
#include <optional>
#include <string>
#include <thread>
#include <utility>
#include <vector>

#include <nlohmann/json.hpp>

#include "event_state.h"

namespace vtuber {

struct TriggerRule {
  std::string id;
  std::string name;
  bool enabled = true;
  std::string mode;  // immediate | debounce | scheduled
  std::vector<std::string> event_types;
  int delay_ms = 3000;
  int max_batch = 10;
  int interval_ms = 0;
};

class TriggerEngine {
 public:
  using TriggerCallback = std::function<void(const std::string& rule_id,
                                             const std::vector<StandardEvent>& events)>;

  TriggerEngine();
  ~TriggerEngine();

  void configure(const std::vector<TriggerRule>& rules);
  void handle_event(const StandardEvent& event);
  void set_callback(TriggerCallback callback);
  void stop();
  size_t rules_count() const;

 private:
  void worker_loop();
  void fire(const std::string& rule_id, std::vector<StandardEvent> events);

  std::vector<TriggerRule> rules_;
  TriggerCallback callback_;

  std::mutex mutex_;
  std::condition_variable cv_;
  std::map<std::string, std::vector<StandardEvent>> debounce_batches_;
  std::map<std::string, int64_t> deadlines_;
  std::map<std::string, int64_t> last_scheduled_;
  std::atomic<bool> running_{true};
  std::thread worker_;
};

TriggerRule trigger_rule_from_json(const nlohmann::json& j);

}  // namespace vtuber

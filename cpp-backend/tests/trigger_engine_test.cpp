#include <cassert>
#include <iostream>
#include <mutex>
#include <vector>

#include "trigger_engine.h"

int main() {
  vtuber::TriggerEngine engine;
  std::mutex mutex;
  std::vector<std::string> fired;

  engine.configure({
      {
          "immediate",
          "immediate",
          true,
          "immediate",
          {"danmaku"},
          0,
          1,
          0,
      },
  });

  engine.set_callback([&](const std::string& id, const std::vector<vtuber::StandardEvent>& events) {
    std::lock_guard lock(mutex);
    fired.push_back(id);
    (void)events;
  });

  vtuber::StandardEvent event;
  event.type = "danmaku";
  event.timestamp = 1000;
  event.room_id = "room1";
  event.data = {{"content", "hello"}};
  engine.handle_event(event);
  engine.stop();

  assert(!fired.empty());
  assert(fired.front() == "immediate");

  std::cout << "trigger_engine_test passed\n";
  return 0;
}

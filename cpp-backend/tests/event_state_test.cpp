#include <cassert>
#include <iostream>

#include "event_state.h"

int main() {
  vtuber::EventState state("room1", 3);

  vtuber::StandardEvent event;
  event.type = "danmaku";
  event.timestamp = 1000;
  event.room_id = "room1";
  event.user = {{"name", "alice"}};
  event.data = {{"content", "hello"}};
  state.add_event(event);

  assert(state.get_state()["danmakuCount"] == 1);
  assert(state.get_variable("history.danmaku", std::nullopt).find("alice") != std::string::npos);

  vtuber::StandardEvent gift;
  gift.type = "gift";
  gift.timestamp = 2000;
  gift.room_id = "room1";
  gift.user = {{"name", "bob"}};
  gift.data = {{"giftName", "火箭"}, {"num", 2}};
  state.add_event(gift);

  assert(state.get_state()["giftCount"] == 1);
  assert(state.get_variable("history.gift", std::nullopt).find("火箭") != std::string::npos);

  std::cout << "event_state_test passed\n";
  return 0;
}

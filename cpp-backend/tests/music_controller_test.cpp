#include <cassert>
#include <iostream>

#include "music_controller.h"

int main() {
  vtuber::MusicController controller(80);

  assert(controller.get_state()["state"] == "stopped");
  assert(controller.set_volume(120)["volume"] == 100);
  assert(controller.set_volume(-1)["volume"] == 0);
  assert(controller.adjust_volume(10)["volume"] == 10);
  assert(controller.mute()["muted"] == true);
  assert(controller.unmute()["muted"] == false);

  auto started = controller.start();
  assert(started["success"] == true);
  assert(controller.get_state()["state"] == "running");

  auto restarted = controller.restart(true);
  assert(restarted["success"] == true);
  assert(controller.get_state()["state"] == "running");

  controller.stop();
  assert(controller.get_state()["state"] == "stopped");

  std::cout << "music_controller_test passed\n";
  return 0;
}

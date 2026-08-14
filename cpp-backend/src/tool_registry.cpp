#include "tool_registry.h"

#include <stdexcept>

namespace vtuber {

namespace {

nlohmann::json object_schema(nlohmann::json properties = nlohmann::json::object(),
                             nlohmann::json required = nlohmann::json::array()) {
  return {
      {"type", "object"},
      {"properties", std::move(properties)},
      {"required", std::move(required)},
  };
}

}  // namespace

void ToolRegistry::register_jukebox_tools(MusicController& controller) {
  auto add_tool = [this](ToolDefinition def) {
    tools_[def.name] = std::move(def);
  };

  add_tool({
      "jukebox_search_song",
      "Search songs from configured music sources",
      object_schema(
          {
              {"keyword", {{"type", "string"}}},
              {"source", {{"type", "string"}}},
          },
          {"keyword"}),
      [&controller](const nlohmann::json& args) { return controller.search(args); },
  });

  add_tool({
      "jukebox_add_song",
      "Add a song to the playback queue",
      object_schema(
          {
              {"songId", {{"type", "string"}}},
              {"source", {{"type", "string"}}},
              {"title", {{"type", "string"}}},
              {"artist", {{"type", "string"}}},
              {"requester", {{"type", "string"}}},
          },
          {"songId"}),
      [&controller](const nlohmann::json& args) { return controller.add(args); },
  });

  add_tool({
      "jukebox_skip_song",
      "Skip to the next queued song",
      object_schema(),
      [&controller](const nlohmann::json&) { return controller.skip(); },
  });

  add_tool({
      "jukebox_pause",
      "Pause jukebox playback",
      object_schema(),
      [&controller](const nlohmann::json&) { return controller.pause(); },
  });

  add_tool({
      "jukebox_resume",
      "Resume jukebox playback",
      object_schema(),
      [&controller](const nlohmann::json&) { return controller.play(); },
  });

  add_tool({
      "jukebox_seek",
      "Seek to a playback position in seconds",
      object_schema({{"seconds", {{"type", "integer", "minimum", 0}}}}, {"seconds"}),
      [&controller](const nlohmann::json& args) { return controller.seek(args); },
  });

  add_tool({
      "jukebox_set_volume",
      "Set jukebox volume to an absolute value from 0 to 100",
      object_schema({{"volume", {{"type", "integer", "minimum", 0, "maximum", 100}}}}, {"volume"}),
      [&controller](const nlohmann::json& args) {
        return controller.set_volume(args.at("volume").get<int>());
      },
  });

  add_tool({
      "jukebox_adjust_volume",
      "Adjust jukebox volume by a relative amount from -100 to 100",
      object_schema({{"delta", {{"type", "integer", "minimum", -100, "maximum", 100}}}}, {"delta"}),
      [&controller](const nlohmann::json& args) {
        return controller.adjust_volume(args.at("delta").get<int>());
      },
  });

  add_tool({
      "jukebox_mute",
      "Mute jukebox playback",
      object_schema(),
      [&controller](const nlohmann::json&) { return controller.mute(); },
  });

  add_tool({
      "jukebox_unmute",
      "Unmute jukebox playback",
      object_schema(),
      [&controller](const nlohmann::json&) { return controller.unmute(); },
  });

  add_tool({
      "jukebox_get_volume",
      "Get the current jukebox volume and mute state",
      object_schema(),
      [&controller](const nlohmann::json&) { return controller.get_volume(); },
  });

  add_tool({
      "jukebox_get_queue",
      "Get the current jukebox queue",
      object_schema(),
      [&controller](const nlohmann::json&) { return controller.get_queue(); },
  });

  add_tool({
      "jukebox_get_current_song",
      "Get the currently playing song",
      object_schema(),
      [&controller](const nlohmann::json&) { return controller.get_now_playing(); },
  });

  add_tool({
      "jukebox_remove_song",
      "Remove a song from the queue by index",
      object_schema({{"index", {{"type", "integer", "minimum", 0}}}}, {"index"}),
      [&controller](const nlohmann::json& args) { return controller.remove(args); },
  });

  add_tool({
      "jukebox_clear_queue",
      "Clear all queued songs",
      object_schema(),
      [&controller](const nlohmann::json&) { return controller.clear_queue(); },
  });

  add_tool({
      "jukebox_start",
      "Start the jukebox module",
      object_schema(),
      [&controller](const nlohmann::json&) { return controller.start(); },
  });

  add_tool({
      "jukebox_stop",
      "Stop the jukebox module",
      object_schema(),
      [&controller](const nlohmann::json&) { return controller.stop(); },
  });

  add_tool({
      "jukebox_restart",
      "Restart the jukebox module",
      object_schema({{"preserveQueue", {{"type", "boolean"}}}}),
      [&controller](const nlohmann::json& args) {
        return controller.restart(args.value("preserveQueue", true));
      },
  });

  add_tool({
      "jukebox_get_state",
      "Get the complete jukebox module state",
      object_schema(),
      [&controller](const nlohmann::json&) { return controller.get_state(); },
  });
}

nlohmann::json ToolRegistry::list_tools() const {
  nlohmann::json arr = nlohmann::json::array();
  for (const auto& [name, tool] : tools_) {
    arr.push_back({
        {"name", tool.name},
        {"description", tool.description},
        {"parameters", tool.parameters},
    });
  }
  return arr;
}

nlohmann::json ToolRegistry::call(const std::string& name, const nlohmann::json& args) const {
  const auto it = tools_.find(name);
  if (it == tools_.end()) {
    return {
        {"success", false},
        {"error", "tool not found: " + name},
    };
  }

  try {
    return it->second.handler(args);
  } catch (const std::exception& ex) {
    return {
        {"success", false},
        {"error", ex.what()},
    };
  }
}

}  // namespace vtuber

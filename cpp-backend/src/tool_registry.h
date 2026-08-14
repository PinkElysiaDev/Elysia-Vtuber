#pragma once

#include <functional>
#include <map>
#include <string>

#include <nlohmann/json.hpp>

#include "music_controller.h"

namespace vtuber {

struct ToolDefinition {
  std::string name;
  std::string description;
  nlohmann::json parameters;
  std::function<nlohmann::json(const nlohmann::json&)> handler;
};

class ToolRegistry {
 public:
  void register_jukebox_tools(MusicController& controller);

  nlohmann::json list_tools() const;
  nlohmann::json call(const std::string& name, const nlohmann::json& args) const;

 private:
  std::map<std::string, ToolDefinition> tools_;
};

}  // namespace vtuber

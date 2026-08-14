#pragma once

#include <functional>
#include <string>

#include <nlohmann/json.hpp>

namespace vtuber {

class DisplayController {
 public:
  using Notify = std::function<void(const std::string& method, const nlohmann::json& params)>;

  void set_notify(Notify notify);
  nlohmann::json show_text(const nlohmann::json& params);
  nlohmann::json show_html(const nlohmann::json& params);
  nlohmann::json clear();
  nlohmann::json get_state() const;

 private:
  Notify notify_;
  nlohmann::json state_ = {{"type", "text"}, {"content", ""}};
};

}  // namespace vtuber

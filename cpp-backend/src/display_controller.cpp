#include "display_controller.h"

#include <utility>

namespace vtuber {

void DisplayController::set_notify(Notify notify) {
  notify_ = std::move(notify);
}

nlohmann::json DisplayController::show_text(const nlohmann::json& params) {
  const std::string text = params.value<std::string>("text", "");
  const std::string style = params.value<std::string>("style", "normal");
  const std::string emotion = params.value<std::string>("emotion", "neutral");
  state_ = {
      {"type", "text"},
      {"content", text},
      {"style", style},
      {"emotion", emotion},
  };
  if (notify_) notify_("display.update", {{"text", text}, {"style", style}, {"emotion", emotion}});
  return {{"success", true}};
}

nlohmann::json DisplayController::show_html(const nlohmann::json& params) {
  const std::string html = params.value<std::string>("html", "");
  state_ = {{"type", "html"}, {"content", html}};
  if (notify_) notify_("display.update", {{"html", html}});
  return {{"success", true}};
}

nlohmann::json DisplayController::clear() {
  state_ = {{"type", "text"}, {"content", ""}};
  if (notify_) notify_("display.clear", nlohmann::json::object());
  return {{"success", true}};
}

nlohmann::json DisplayController::get_state() const {
  return state_;
}

}  // namespace vtuber

#include "live2d_controller.h"

#include <utility>

namespace vtuber {

void Live2DController::set_notify(Notify notify) {
  notify_ = std::move(notify);
}

nlohmann::json Live2DController::load_model(const nlohmann::json& params) {
  model_path_ = params.value<std::string>("modelPath", "");
  if (notify_) notify_("live2d.command", {{"command", "loadModel"}, {"modelPath", model_path_}});
  return {{"success", true}};
}

nlohmann::json Live2DController::set_expression(const nlohmann::json& params) {
  expression_ = params.value<std::string>("expression", "normal");
  if (notify_) notify_("live2d.command", {{"command", "setExpression"}, {"expression", expression_}});
  return {{"success", true}};
}

nlohmann::json Live2DController::play_motion(const nlohmann::json& params) {
  if (notify_) notify_("live2d.command", {
      {"command", "playMotion"},
      {"group", params.value("group", "Idle")},
      {"index", params.value("index", 0)},
  });
  return {{"success", true}};
}

nlohmann::json Live2DController::set_scale(const nlohmann::json& params) {
  scale_ = params.value<double>("scale", 1.0);
  if (notify_) notify_("live2d.command", {{"command", "setScale"}, {"scale", scale_}});
  return {{"success", true}};
}

nlohmann::json Live2DController::set_position(const nlohmann::json& params) {
  x_ = params.value<double>("x", 0.0);
  y_ = params.value<double>("y", 0.0);
  if (notify_) notify_("live2d.command", {{"command", "setPosition"}, {"x", x_}, {"y", y_}});
  return {{"success", true}};
}

nlohmann::json Live2DController::get_state() const {
  return {
      {"modelPath", model_path_},
      {"expression", expression_},
      {"scale", scale_},
      {"x", x_},
      {"y", y_},
  };
}

}  // namespace vtuber

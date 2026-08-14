#pragma once

#include <functional>
#include <string>

#include <nlohmann/json.hpp>

namespace vtuber {

class Live2DController {
 public:
  using Notify = std::function<void(const std::string& method, const nlohmann::json& params)>;

  void set_notify(Notify notify);
  nlohmann::json load_model(const nlohmann::json& params);
  nlohmann::json set_expression(const nlohmann::json& params);
  nlohmann::json play_motion(const nlohmann::json& params);
  nlohmann::json set_scale(const nlohmann::json& params);
  nlohmann::json set_position(const nlohmann::json& params);
  nlohmann::json get_state() const;

 private:
  Notify notify_;
  std::string model_path_;
  std::string expression_;
  double scale_ = 1.0;
  double x_ = 0.0;
  double y_ = 0.0;
};

}  // namespace vtuber

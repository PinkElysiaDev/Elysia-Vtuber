#pragma once

#include <atomic>
#include <string>

#include <nlohmann/json.hpp>

#include "backend_context.h"

namespace vtuber {

class JsonRpcHandler {
 public:
  explicit JsonRpcHandler(BackendContext& context);

  std::string handle(const std::string& message);

 private:
  nlohmann::json dispatch(const std::string& method, const nlohmann::json& params);
  std::string response(const nlohmann::json& id, const nlohmann::json& result) const;
  std::string error(const nlohmann::json& id, int code, const std::string& message) const;

  BackendContext& context_;
  std::atomic<int> event_count_{0};
};

}  // namespace vtuber

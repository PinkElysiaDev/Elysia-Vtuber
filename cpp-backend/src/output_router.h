#pragma once

#include <functional>
#include <string>

namespace vtuber {

class OutputRouter {
 public:
  using SendDanmaku = std::function<void(const std::string& text)>;
  using DisplayText = std::function<void(const std::string& text, const std::string& style, const std::string& emotion)>;
  using Speak = std::function<void(const std::string& text)>;

  OutputRouter(SendDanmaku danmaku, DisplayText display, Speak speak);

  void route(const std::string& content);

 private:
  SendDanmaku danmaku_;
  DisplayText display_;
  Speak speak_;
};

}  // namespace vtuber

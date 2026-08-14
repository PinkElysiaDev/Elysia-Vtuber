#include "output_router.h"

#include <nlohmann/json.hpp>
#include <utility>

namespace vtuber {

OutputRouter::OutputRouter(SendDanmaku danmaku, DisplayText display, Speak speak)
    : danmaku_(std::move(danmaku)), display_(std::move(display)), speak_(std::move(speak)) {}

void OutputRouter::route(const std::string& content) {
  try {
    const auto parsed = nlohmann::json::parse(content);
    if (parsed.contains("segments") && parsed["segments"].is_array()) {
      for (const auto& segment : parsed["segments"]) {
        const std::string text = segment.value("text", "");
        const std::string method = segment.value("method", "danmaku");
        if (text.empty()) continue;
        if (method == "danmaku") danmaku_(text);
        else if (method == "display") display_(text, segment.value("displayStyle", "normal"), segment.value("emotion", "neutral"));
        else if (method == "tts") speak_(text);
      }
      return;
    }
  } catch (...) {
  }

  if (!content.empty()) {
    danmaku_(content);
    display_(content, "normal", "neutral");
    speak_(content);
  }
}

}  // namespace vtuber

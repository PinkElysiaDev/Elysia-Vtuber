#include <csignal>
#include <chrono>
#include <iostream>
#include <string>
#include <thread>

#include "backend_context.h"
#include "output_router.h"
#include "server.h"

namespace {

volatile std::sig_atomic_t g_running = 1;

void handle_signal(int) {
  g_running = 0;
}

}  // namespace

int main(int argc, char* argv[]) {
  std::string config_path = "config/backend.example.json";
  for (int i = 1; i < argc; ++i) {
    const std::string arg = argv[i];
    if (arg == "--config" && i + 1 < argc) {
      config_path = argv[++i];
    }
  }

  try {
    const auto config = vtuber::load_config(config_path);
    vtuber::BackendContext context(config);
    context.config_path = config_path;

    context.tools.register_jukebox_tools(context.music);
    // 统一通过热重载入口初始化 LLM / TTS / 触发器，保证与配置完全一致
    context.reload_all();

    vtuber::BackendServer server(context);

    vtuber::OutputRouter output_router(
        [&server, &context](const std::string& text) {
          server.broadcast("danmaku.send", {
              {"roomId", context.config.room_id},
              {"text", text},
          });
        },
        [&context](const std::string& text, const std::string& style, const std::string& emotion) {
          context.display.show_text({{"text", text}, {"style", style}, {"emotion", emotion}});
        },
        [&context, &server](const std::string& text) {
          if (!context.tts) return;
          const auto segments = context.tts->split_text(text);
          for (const auto& segment : segments) {
            const auto result = context.tts->synthesize(segment);
            server.broadcast("tts.audio", {
                {"audio", result.audio_base64},
                {"duration", result.duration_seconds},
            });
          }
        });

    context.triggers.set_callback(
        [&context, &output_router](const std::string&, const std::vector<vtuber::StandardEvent>& events) {
          if (!context.llm || events.empty()) return;

          nlohmann::json messages = nlohmann::json::array();
          messages.push_back({
              {"role", "system"},
              {"content", "You are a Bilibili virtual streamer. Respond naturally and concisely to live room events."},
          });

          std::string user_prompt = "Recent events:\n";
          for (const auto& event : events) {
            user_prompt += "- " + event.type + ": " + event.data.dump() + "\n";
          }
          user_prompt += "\nPlease output the reply directly.";
          messages.push_back({{"role", "user"}, {"content", user_prompt}});

          try {
            const auto response = context.llm->chat(messages, context.tools.list_tools());
            if (!response.content.empty()) {
              output_router.route(response.content);
            }
            for (const auto& call : response.tool_calls) {
              context.tools.call(call.name, call.arguments);
            }
          } catch (const std::exception& ex) {
            std::cerr << "LLM trigger failed: " << ex.what() << "\n";
          }
        });

    std::signal(SIGINT, handle_signal);
    std::signal(SIGTERM, handle_signal);

    std::cout << "Vtuber backend starting" << "\n";
    std::cout << "WebUI: http://" << config.server.host << ":" << config.server.http_port << "\n";
    std::cout << "WebSocket: ws://" << config.server.host << ":" << config.server.ws_port << "\n";

    server.start();

    while (g_running) {
      std::this_thread::sleep_for(std::chrono::milliseconds(200));
    }

    std::cout << "Shutting down..." << "\n";
    server.stop();
    return 0;
  } catch (const std::exception& ex) {
    std::cerr << "Fatal error: " << ex.what() << "\n";
    return 1;
  }
}

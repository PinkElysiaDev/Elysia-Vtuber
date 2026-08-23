/**
 * 音频执行器：无窗口的 XAudio2 播放进程。
 * 职责：player / audio 系列 RPC 分发、player.levels / player.ended 事件推送。
 * 点歌机 / TTS / 试听全部依赖此进程，与 Live2D 窗口完全独立。
 */
#include "audio_player.h"
#include "ipc_server.h"
#include "platform.h"

#include <atomic>
#include <cstdlib>
#include <memory>
#include <windows.h>
#include <shellapi.h>

#pragma comment(lib, "shell32.lib")

using namespace vtuber;

namespace {

struct AudioConfig {
  uint16_t ipcPort = 19277;
};

AudioConfig loadConfig(const std::string& path) {
  AudioConfig config;
  const std::string resolved = ResolvePath(path);
  const FileBytes bytes = LoadFile(resolved);
  if (bytes.empty()) {
    LogLine(std::string("[audio-config] using defaults, missing ") + resolved);
    return config;
  }
  try {
    const auto json = nlohmann::json::parse(bytes.data);
    config.ipcPort = json.value("ipcPort", config.ipcPort);
  } catch (const std::exception& ex) {
    LogLine(std::string("[audio-config] parse failed: ") + ex.what());
  }
  return config;
}

std::atomic<bool> g_quit{false};

} // namespace

int WINAPI WinMain(HINSTANCE, HINSTANCE, LPSTR, int) {
  InitLog();
  LogLine("[audio] starting audio executor");

  // 解析 --config 参数
  std::string configPath = "audio-executor.json";
  int argc = 0;
  LPWSTR* argv = CommandLineToArgvW(GetCommandLineW(), &argc);
  if (argv) {
    for (int i = 1; i < argc; i++) {
      if (wcscmp(argv[i], L"--config") == 0 && i + 1 < argc) {
        std::wstring ws(argv[++i]);
        configPath = WideToUtf8(ws);
      }
    }
    LocalFree(argv);
  }
  LogLine(std::string("[audio] config=") + configPath);
  const AudioConfig config = loadConfig(configPath);

  // player 指针：IPC 分发器通过引用捕获读取（在 player 创建后赋值）
  AudioPlayer* playerPtr = nullptr;

  IpcServer ipc([&config, &playerPtr](
      const std::string& method, const nlohmann::json& params) -> nlohmann::json {
    if (method == "system.ping") return {{"ok", true}, {"role", "audio-executor"}};
    if (method == "system.shutdown") {
      g_quit.store(true);
      PostThreadMessageW(GetCurrentThreadId(), WM_QUIT, 0, 0);
      return {{"ok", true}};
    }
    if (!playerPtr) return {{"ok", false}, {"error", "player not ready"}};
    if (method == "player.play") return playerPtr->Play(params);
    if (method == "player.stop") return playerPtr->Stop(params);
    if (method == "player.pause") return playerPtr->Pause(params);
    if (method == "player.resume") return playerPtr->Resume(params);
    if (method == "player.volume" || method == "audio.volume") return playerPtr->SetVolume(params);
    if (method == "player.status" || method == "audio.status") return playerPtr->Status();
    if (method == "player.devices" || method == "audio.devices") return playerPtr->Devices();
    if (method == "system.status") {
      return {{"ok", true}, {"role", "audio-executor"}, {"ipcPort", config.ipcPort}, {"audio", playerPtr->Status()}};
    }
    throw std::runtime_error("method not found: " + method);
  });

  auto player = std::make_unique<AudioPlayer>(
      [&ipc](const std::string& method, const nlohmann::json& params) {
        ipc.broadcast(method, params);
      });
  playerPtr = player.get();

  ipc.start(config.ipcPort);
  LogLine("[audio] ready");

  // 消息循环等待退出
  MSG msg{};
  while (!g_quit.load() && GetMessageW(&msg, nullptr, 0, 0)) {
    TranslateMessage(&msg);
    DispatchMessageW(&msg);
  }

  ipc.stop();
  player.reset();
  playerPtr = nullptr;
  LogLine("[audio] exited");
  // 跳过静态析构，避免 websocketpp/asio 崩溃
  ExitProcess(0);
}

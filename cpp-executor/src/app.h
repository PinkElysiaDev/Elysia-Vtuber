#pragma once

#include "audio_player.h"
#include "ipc_server.h"
#include "live2d_model.h"
#include "platform.h"

#include <atomic>
#include <d3d11.h>
#include <dxgi.h>
#include <functional>
#include <future>
#include <memory>
#include <mutex>
#include <string>
#include <vector>
#include <windows.h>

#include <CubismFramework.hpp>
#include <nlohmann/json.hpp>

namespace vtuber {

struct ExecutorConfig {
  uint16_t ipcPort = 19276;
  int width = 800;
  int height = 1000;
  std::string title = "Vtuber Live2D";
  std::string modelPath = "Resources/Haru/Haru.model3.json";
};

class App {
 public:
  static App& instance();

  int run(int argc, wchar_t** argv);
  void requestQuit();

  nlohmann::json handleRpc(const std::string& method, const nlohmann::json& params);
  void enqueue(std::function<void()> fn);
  void notify(const std::string& method, const nlohmann::json& params);

 private:
  App() = default;

  nlohmann::json dispatchLive2d(const std::string& method, const nlohmann::json& params);
  nlohmann::json dispatchPlayer(const std::string& method, const nlohmann::json& params);
  template <typename Fn>
  nlohmann::json runOnRenderThread(Fn&& fn);

  bool loadConfig(const std::string& path);
  bool createWindow();
  bool createDevice();
  bool createTargets();
  void releaseTargets();
  void releaseDevice();
  bool startCubism();
  void stopCubism();
  bool loadDefaultModel();
  void pumpJobs();
  void frame();
  void resize(int width, int height);
  float deltaSeconds();
  static LRESULT CALLBACK WndProc(HWND hwnd, UINT msg, WPARAM wparam, LPARAM lparam);

  ExecutorConfig config_;
  Allocator allocator_;
  Csm::CubismFramework::Option cubismOption_{};
  IpcServer ipc_{*this};
  std::unique_ptr<Live2DModel> model_;
  std::unique_ptr<AudioPlayer> player_;

  HWND hwnd_ = nullptr;
  ID3D11Device* device_ = nullptr;
  ID3D11DeviceContext* context_ = nullptr;
  IDXGISwapChain* swapChain_ = nullptr;
  ID3D11RenderTargetView* rtv_ = nullptr;
  ID3D11Texture2D* depthTex_ = nullptr;
  ID3D11DepthStencilView* dsv_ = nullptr;
  ID3D11DepthStencilState* depthState_ = nullptr;
  DXGI_SWAP_CHAIN_DESC swapDesc_{};

  std::mutex jobsMutex_;
  std::vector<std::function<void()>> jobs_;
  std::atomic<bool> quit_{false};
  LARGE_INTEGER freq_{};
  LARGE_INTEGER last_{};
  int width_ = 800;
  int height_ = 1000;
};

}  // namespace vtuber

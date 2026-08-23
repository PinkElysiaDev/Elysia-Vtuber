#pragma once

#include "ipc_server.h"
#include "live2d_model.h"
#include "platform.h"

#include <CubismFramework.hpp>
#include <ICubismAllocator.hpp>

struct IDCompositionDevice;
struct IDCompositionTarget;
struct IDCompositionVisual;

namespace vtuber {

/** Cubism 内存分配器（仅 Live2D 执行器使用） */
class Allocator : public Csm::ICubismAllocator {
 public:
  void* Allocate(const Csm::csmSizeType size) override { return malloc(size); }
  void Deallocate(void* memory) override { free(memory); }

  void* AllocateAligned(const Csm::csmSizeType size, const Csm::csmUint32 alignment) override {
    const size_t offset = alignment - 1 + sizeof(void*);
    void* allocation = Allocate(size + static_cast<Csm::csmUint32>(offset));
    if (!allocation) return nullptr;
    size_t aligned = reinterpret_cast<size_t>(allocation) + sizeof(void*);
    const size_t shift = aligned % alignment;
    if (shift) aligned += (alignment - shift);
    reinterpret_cast<void**>(aligned)[-1] = allocation;
    return reinterpret_cast<void*>(aligned);
  }

  void DeallocateAligned(void* alignedMemory) override {
    if (!alignedMemory) return;
    Deallocate(reinterpret_cast<void**>(alignedMemory)[-1]);
  }
};

}

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
  bool transparent = false;
  bool alwaysOnTop = false;
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
  // dispatchPlayer 已拆分至 audio_executor 进程
  template <typename Fn>
  nlohmann::json runOnRenderThread(Fn&& fn);

  bool loadConfig(const std::string& path);
  bool createWindow();
  bool createD3DDevice();
  bool createSwapChain();
  bool createDevice();
  bool createTargets();
  /** 释放 DComp 树（target 绑定 hwnd，销毁窗口前必须先释放） */
  void releaseComposition();
  /** 透明模式选择性穿透：光标在模型包围盒内可交互，盒外整体穿透（每帧调用） */
  void UpdateCursorHitThrough();
  void EnsureHitThrough(bool through);
  /** 扁平自绘工具条（解锁态）+ 锁定迷你按钮（锁定态） */
  void ShowModelToolbar();
  void DestroyModelToolbar();
  void EnterLockMode();
  void ExitLockMode();
  void ToggleLock();
  void SyncToolbarPosition();
  /** 循环切换换装表情（从模型表情列表中取） */
  void CycleCostume();
  static LRESULT CALLBACK ToolbarProc(HWND hwnd, UINT msg, WPARAM wparam, LPARAM lparam);
  static LRESULT CALLBACK LockBtnProc(HWND hwnd, UINT msg, WPARAM wparam, LPARAM lparam);
  void DrawToolbarButtons(HDC hdc, RECT rc);
  void DrawLockButton(HDC hdc, RECT rc);
  void releaseTargets();
  void releaseDevice();
  /** 透明模式切换：销毁并按新样式重建窗口与交换链（device/模型保留） */
  bool recreateWindow();
  nlohmann::json applyWindow(const nlohmann::json& params);
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
  IpcServer ipc_{[this](const std::string& m, const nlohmann::json& p) { return handleRpc(m, p); }};
  std::unique_ptr<Live2DModel> model_;

  HWND hwnd_ = nullptr;
  /** 扁平自绘工具条窗口（解锁态可见） */
  HWND toolbar_ = nullptr;
  /** 锁定模式迷你按钮窗口（锁定态唯一可交互元素） */
  HWND lockButton_ = nullptr;
  /** 锁定状态：true=全穿透仅锁按钮可交互 */
  bool locked_ = false;
  /** 工具条悬停按钮索引（-1=无） */
  int hoverBtn_ = -1;
  /** 换装循环索引 */
  int costumeIdx_ = -1;
  /** 当前是否处于穿透态（避免每帧 SetWindowLong） */
  bool hitThrough_ = false;
  // DirectComposition：透明模式下 swapchain 经 DComp 视觉挂到窗口（CreateSwapChainForComposition）
  IDCompositionDevice* dcompDevice_ = nullptr;
  IDCompositionTarget* dcompTarget_ = nullptr;
  IDCompositionVisual* dcompVisual_ = nullptr;
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
  /** 窗口重建期间抑制 WM_DESTROY 的退出语义 */
  std::atomic<bool> recreating_{false};
  bool transparent_ = false;
  bool topmost_ = false;
  /** 当前加载的模型与变换（窗口重建后恢复现场） */
  std::string lastModelPath_;
  float lastTransformScale_ = 1.0f;
  float lastTransformX_ = 0.0f;
  float lastTransformY_ = 0.0f;
  LARGE_INTEGER freq_{};
  LARGE_INTEGER last_{};
  int width_ = 800;
  int height_ = 1000;
};

}  // namespace vtuber

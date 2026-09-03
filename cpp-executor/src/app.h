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

#include "ui_renderer.h"

namespace vtuber {

struct ExecutorConfig {
  uint16_t ipcPort = 19276;
  int width = 800;
  int height = 1000;
  int winX = -1;  // 记忆的窗口位置（-1 = 未记忆，创建时用系统默认）
  int winY = -1;
  std::string title = "Vtuber Live2D";
  std::string modelPath = "Resources/Haru/Haru.model3.json";
  bool transparent = false;
  bool alwaysOnTop = false;
};

/** 舞台状态：物理（风/重力/速率）、背景（模式/色/图）、FPS 角标。与后端 live2d.stage 配置一一对应 */
struct StageState {
  float windX = 0.0f;
  float windY = 0.0f;
  float gravityX = 0.0f;
  float gravityY = -1.0f;
  float physicsSpeed = 1.0f;
  std::string bgMode = "transparent";  // transparent | color | image
  std::string bgColor = "#0d1218";
  float bgAlpha = 1.0f;
  std::string bgImage;
  bool fpsOverlay = false;
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
  /** 用户拖动窗口结束后把位置写回 executor.json（下次启动恢复，不再跳回左上角） */
  void SaveWindowPosition();
  bool createWindow();
  bool createD3DDevice();
  bool createSwapChain();
  bool createDevice();
  bool createTargets();
  /** 释放 DComp 树（target 绑定 hwnd，销毁窗口前必须先释放） */
  void releaseComposition();
  /** 透明模式选择性穿透：光标在模型包围盒/面板内可交互，其余整体穿透（每帧调用） */
  void UpdateCursorHitThrough();
  void EnsureHitThrough(bool through);
  /** 锁定迷你按钮（锁定态唯一可交互元素，独立小窗） */
  void EnterLockMode();
  void ExitLockMode();
  void ToggleLock();
  void SyncLockPosition();
  /** 循环切换换装表情（从模型表情列表中取） */
  void CycleCostume();
  static LRESULT CALLBACK LockBtnProc(HWND hwnd, UINT msg, WPARAM wparam, LPARAM lparam);
  void DrawLockButton(HDC hdc, RECT rc);

  // ===== 窗口内 UI：FPS 角标（控制台已迁移至独立控制窗 compact.html，双击模型唤起） =====
  void drawFpsBadge();
  /** 双击模型呼出独立控制窗（Edge --app 模式打开 compact.html，失败回退默认浏览器） */
  void OpenControlWindow();
  /** 背景图 cover 适配铺满窗口（frame 内调用，ui_.Begin 之后） */
  void DrawBackgroundImage();
  /** 舞台：RPC 应用（backend→执行器，不回播） */
  void applyStage(const nlohmann::json& params);
  void applyStagePhysics();
  nlohmann::json stageJson() const;
  void loadBgTexture();
  /** 面板编辑 → 节流 100ms 广播 live2d.stageChanged（frame 内驱动） */
  void scheduleStageNotify();
  static void ParseHexColor(const std::string& hex, float& r, float& g, float& b);
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
  /** 本次加载的配置文件路径（窗口位置回写用） */
  std::string configPath_;
  Allocator allocator_;
  Csm::CubismFramework::Option cubismOption_{};
  IpcServer ipc_{[this](const std::string& m, const nlohmann::json& p) { return handleRpc(m, p); }};
  std::unique_ptr<Live2DModel> model_;

  HWND hwnd_ = nullptr;
  /** 锁定模式迷你按钮窗口（锁定态唯一可交互元素） */
  HWND lockButton_ = nullptr;
  /** 锁定状态：true=全穿透仅锁按钮可交互 */
  bool locked_ = false;
  /** 换装循环索引 */
  int costumeIdx_ = -1;
  /** 当前是否处于穿透态（避免每帧 SetWindowLong） */
  bool hitThrough_ = false;
  /** 舞台状态（物理/背景/FPS 角标） */
  StageState stage_;
  std::string webuiUrl_ = "http://127.0.0.1:19274/";
  ID3D11ShaderResourceView* bgTex_ = nullptr;
  std::string bgTexPath_;
  bool stageDirty_ = false;
  double stageLastNotify_ = 0.0;
  /** FPS 统计（500ms 窗口均值） */
  double fps_ = 0.0;
  double fpsAccum_ = 0.0;
  uint64_t fpsFrames_ = 0;
  double fpsClock_ = 0.0;
  /** 渲染循环迭代计数（与 ui_.quadCount 一起暴露于 system.status，用于诊断 UI 层是否在提交绘制） */
  uint64_t frameCount_ = 0;
  /** TODO(debug): UI 绘制后回读后备缓冲像素(面板区/模型区),区分绘制层丢失 vs 呈现层丢失 */
  int probePanel_[4] = {-1, -1, -1, -1};
  int probeModel_[4] = {-1, -1, -1, -1};
  /** UI 渲染器（quad + DirectWrite） */
  UiRenderer ui_;
  /** ui_.Init 成功标志：失败时禁用面板呼出与命中，杜绝"不可见但可点击" */
  bool uiReady_ = false;
  // DirectComposition：透明模式下 swapchain 经 DComp 视觉挂到窗口（CreateSwapChainForComposition）
  IDCompositionDevice* dcompDevice_ = nullptr;
  IDCompositionTarget* dcompTarget_ = nullptr;
  IDCompositionVisual* dcompVisual_ = nullptr;
  ID3D11Device* device_ = nullptr;
  ID3D11DeviceContext* context_ = nullptr;
  /** D3D 调试层消息队列（诊断绘制被丢弃的原因，随 system.status 暴露） */
  ID3D11InfoQueue* infoQueue_ = nullptr;
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

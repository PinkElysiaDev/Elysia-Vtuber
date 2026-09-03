#include "app.h"

#include <Rendering/D3D11/CubismDeviceInfo_D3D11.hpp>
#include <Rendering/D3D11/CubismRenderer_D3D11.hpp>

#include <chrono>
#include <cstdio>
#include <cstring>
#include <cmath>
#include <fstream>
#include <stdexcept>

#include <dxgi1_2.h>
#include <dcomp.h>
#include <windowsx.h>
#include <shellapi.h>
#include <shobjidl.h>

#include "wic_texture.h"

#pragma comment(lib, "dcomp.lib")
#pragma comment(lib, "shell32.lib")

namespace vtuber {

namespace {

void CubismLog(const Csm::csmChar* message) {
  if (message) LogLine(std::string("[cubism] ") + message);
}

}  // namespace

// 平台工具函数已移至 platform.cpp（音频/Live2D 两执行器共用）

App& App::instance() {
  static App app;
  return app;
}

bool App::loadConfig(const std::string& path) {
  configPath_ = path;
  const std::string resolved = ResolvePath(path);
  FileBytes bytes = LoadFile(resolved);
  if (bytes.empty()) {
    LogLine(std::string("[config] using defaults, missing ") + resolved);
    return false;
  }
  try {
    const auto json = nlohmann::json::parse(bytes.data.begin(), bytes.data.end());
    config_.ipcPort = json.value("ipcPort", config_.ipcPort);
    if (json.contains("window")) {
      config_.width = json["window"].value("width", config_.width);
      config_.height = json["window"].value("height", config_.height);
      config_.title = json["window"].value("title", config_.title);
      config_.transparent = json["window"].value("transparent", config_.transparent);
      config_.alwaysOnTop = json["window"].value("alwaysOnTop", config_.alwaysOnTop);
      config_.winX = json["window"].value("x", -1);
      config_.winY = json["window"].value("y", -1);
    }
    config_.modelPath = json.value("modelPath", config_.modelPath);
  } catch (const std::exception& ex) {
    LogLine(std::string("[config] parse failed: ") + ex.what());
    return false;
  }
  return true;
}

void App::SaveWindowPosition() {
  if (!hwnd_ || configPath_.empty()) return;
  RECT wr{};
  if (!GetWindowRect(hwnd_, &wr)) return;
  const std::string resolved = ResolvePath(configPath_);
  try {
    nlohmann::json json = nlohmann::json::object();
    FileBytes bytes = LoadFile(resolved);
    if (!bytes.empty()) {
      try {
        json = nlohmann::json::parse(bytes.data.begin(), bytes.data.end());
      } catch (...) {
        json = nlohmann::json::object();  // 原文件损坏则从空对象重建，不覆盖失败
      }
    }
    if (!json.contains("window") || !json["window"].is_object()) json["window"] = nlohmann::json::object();
    json["window"]["x"] = wr.left;
    json["window"]["y"] = wr.top;
    std::string out = json.dump(2);
    FILE* f = nullptr;
    if (_wfopen_s(&f, Utf8ToWide(resolved).c_str(), L"wb") == 0 && f) {
      fwrite(out.data(), 1, out.size(), f);
      fclose(f);
      LogLine(std::string("[window] position saved ") + std::to_string(wr.left) + "," + std::to_string(wr.top));
    }
  } catch (const std::exception& ex) {
    LogLine(std::string("[window] position save failed: ") + ex.what());
  }
}

bool App::createWindow() {
  WNDCLASSEXW wc{};
  wc.cbSize = sizeof(wc);
  // CS_DBLCLKS：模型内双击弹出工具条。
  // 不再用 CS_CLASSDC：D3D/DComp 渲染不需要类 DC，且它与 WS_EX_LAYERED（穿透所需）互斥
  wc.style = CS_DBLCLKS;
  wc.lpfnWndProc = WndProc;
  wc.hInstance = GetModuleHandleW(nullptr);
  wc.lpszClassName = L"VtuberExecutor";
  wc.hCursor = LoadCursor(nullptr, IDC_ARROW);
  UnregisterClassW(wc.lpszClassName, wc.hInstance);  // 让 recreate 周期里的新类样式生效
  RegisterClassExW(&wc);

  // 透明模式：无边框 + WS_EX_NOREDIRECTIONBITMAP（DWM 直接合成，配合预乘 alpha 交换链）
  transparent_ = config_.transparent;
  topmost_ = config_.alwaysOnTop;
  const DWORD style = transparent_ ? WS_POPUP : WS_OVERLAPPEDWINDOW;
  DWORD exstyle = 0;
  if (transparent_) exstyle |= WS_EX_NOREDIRECTIONBITMAP;
  if (topmost_) exstyle |= WS_EX_TOPMOST;

  RECT rect{0, 0, config_.width, config_.height};
  AdjustWindowRect(&rect, style, FALSE);
  // 记忆位置优先；负值/越界回退系统默认（CW_USEDEFAULT 对 WS_POPUP 实际落在 (0,0)）
  const int createX = (config_.winX >= 0 && config_.winX < 30000) ? config_.winX : CW_USEDEFAULT;
  const int createY = (config_.winY >= 0 && config_.winY < 30000) ? config_.winY : CW_USEDEFAULT;
  hwnd_ = CreateWindowExW(
      exstyle,
      wc.lpszClassName,
      Utf8ToWide(config_.title).c_str(),
      style,
      createX,
      createY,
      rect.right - rect.left,
      rect.bottom - rect.top,
      nullptr,
      nullptr,
      wc.hInstance,
      this);
  if (!hwnd_) return false;
  ShowWindow(hwnd_, SW_SHOWDEFAULT);
  UpdateWindow(hwnd_);
  RECT client{};
  GetClientRect(hwnd_, &client);
  width_ = client.right - client.left;
  height_ = client.bottom - client.top;
  return true;
}

bool App::createD3DDevice() {
  D3D_FEATURE_LEVEL level{};
  UINT flags = D3D11_CREATE_DEVICE_BGRA_SUPPORT;
#ifdef _DEBUG
  flags |= D3D11_CREATE_DEVICE_DEBUG;  // 调试层:绘制被丢弃时 GPU 会留下原因(随 system.status 暴露)
#endif
  HRESULT hr = D3D11CreateDevice(
      nullptr,
      D3D_DRIVER_TYPE_HARDWARE,
      nullptr,
      flags,
      nullptr,
      0,
      D3D11_SDK_VERSION,
      &device_,
      &level,
      &context_);
#ifdef _DEBUG
  if (FAILED(hr) && (flags & D3D11_CREATE_DEVICE_DEBUG)) {
    // 调试层未安装(DXGI_ERROR_SDK_COMPONENT_MISSING):去掉标志重试,保持可用
    flags &= ~D3D11_CREATE_DEVICE_DEBUG;
    hr = D3D11CreateDevice(nullptr, D3D_DRIVER_TYPE_HARDWARE, nullptr, flags, nullptr, 0,
                           D3D11_SDK_VERSION, &device_, &level, &context_);
    if (SUCCEEDED(hr)) LogLine("[d3d] debug layer unavailable, created without it");
  }
#endif
  if (FAILED(hr)) {
    char buf[64];
    std::snprintf(buf, sizeof(buf), "[d3d] create device failed: 0x%08lX", static_cast<unsigned long>(hr));
    LogLine(buf);
    return false;
  }
#ifdef _DEBUG
  device_->QueryInterface(IID_PPV_ARGS(&infoQueue_));
  if (infoQueue_) {
    infoQueue_->SetMuteDebugOutput(FALSE);
    // 只留错误及以上,避免刷屏
    D3D11_INFO_QUEUE_FILTER filter{};
    D3D11_MESSAGE_SEVERITY deny[] = {D3D11_MESSAGE_SEVERITY_INFO, D3D11_MESSAGE_SEVERITY_MESSAGE};
    filter.DenyList.NumSeverities = 2;
    filter.DenyList.pSeverityList = deny;
    infoQueue_->PushRetrievalFilter(&filter);
    infoQueue_->PushStorageFilter(&filter);
  }
#endif

  D3D11_DEPTH_STENCIL_DESC depthDesc{};
  depthDesc.DepthEnable = FALSE;
  depthDesc.DepthWriteMask = D3D11_DEPTH_WRITE_MASK_ALL;
  depthDesc.DepthFunc = D3D11_COMPARISON_LESS;
  if (FAILED(device_->CreateDepthStencilState(&depthDesc, &depthState_))) return false;
  return true;
}

bool App::createSwapChain() {
  if (!device_ || !hwnd_) return false;
  IDXGIDevice* dxgiDevice = nullptr;
  IDXGIAdapter* adapter = nullptr;
  IDXGIFactory* factory = nullptr;
  HRESULT hr = device_->QueryInterface(IID_PPV_ARGS(&dxgiDevice));
  if (FAILED(hr)) return false;
  hr = dxgiDevice->GetAdapter(&adapter);
  if (SUCCEEDED(hr)) hr = adapter->GetParent(IID_PPV_ARGS(&factory));
  if (FAILED(hr)) {
    if (adapter) adapter->Release();
    dxgiDevice->Release();
    return false;
  }

  if (transparent_) {
    // 逐像素透明唯一可行组合：CreateSwapChainForComposition（预乘 alpha + FLIP）+ DComp 视觉挂窗。
    // CreateSwapChainForHwnd 不接受 DXGI_SCALING_NONE/预乘组合（0x887A0001）
    IDXGIFactory2* factory2 = nullptr;
    hr = factory->QueryInterface(IID_PPV_ARGS(&factory2));
    if (SUCCEEDED(hr)) {
      DXGI_SWAP_CHAIN_DESC1 desc{};
      desc.Width = static_cast<UINT>(width_);
      desc.Height = static_cast<UINT>(height_);
      desc.Format = DXGI_FORMAT_R8G8B8A8_UNORM;
      desc.Stereo = FALSE;
      desc.SampleDesc.Count = 1;
      desc.BufferUsage = DXGI_USAGE_RENDER_TARGET_OUTPUT;
      desc.BufferCount = 2;
      // 本机实测可用组合：STRETCH + FLIP_SEQUENTIAL + PREMULTIPLIED（NONE 反而被拒）
      desc.Scaling = DXGI_SCALING_STRETCH;
      desc.SwapEffect = DXGI_SWAP_EFFECT_FLIP_SEQUENTIAL;
      desc.AlphaMode = DXGI_ALPHA_MODE_PREMULTIPLIED;
      IDXGISwapChain1* sc1 = nullptr;
      hr = factory2->CreateSwapChainForComposition(device_, &desc, nullptr, &sc1);
      if (FAILED(hr)) {
        char buf[64];
        std::snprintf(buf, sizeof(buf), "[d3d] composition swapchain failed: 0x%08lX", static_cast<unsigned long>(hr));
        LogLine(buf);
      }
      factory2->Release();
      if (SUCCEEDED(hr)) {
        swapChain_ = sc1;
        // 建立 DComp 树：visual 内容 = swapchain，挂到目标窗口
        IDCompositionDevice* dcomp = nullptr;
        if (SUCCEEDED(DCompositionCreateDevice(dxgiDevice, IID_PPV_ARGS(&dcomp))) && dcomp) {
          IDCompositionTarget* target = nullptr;
          IDCompositionVisual* visual = nullptr;
          if (SUCCEEDED(dcomp->CreateTargetForHwnd(hwnd_, TRUE, &target)) && target
              && SUCCEEDED(dcomp->CreateVisual(&visual)) && visual
              && SUCCEEDED(visual->SetContent(swapChain_))
              && SUCCEEDED(target->SetRoot(visual))
              && SUCCEEDED(dcomp->Commit())) {
            dcompDevice_ = dcomp;
            dcompTarget_ = target;
            dcompVisual_ = visual;
          } else {
            LogLine("[d3d] dcomp bind failed");
            if (visual) visual->Release();
            if (target) target->Release();
            dcomp->Release();
            hr = E_FAIL;
            if (swapChain_) {
              swapChain_->Release();
              swapChain_ = nullptr;
            }
          }
        }
      }
    }
  } else {
    ZeroMemory(&swapDesc_, sizeof(swapDesc_));
    swapDesc_.BufferCount = 2;
    swapDesc_.BufferDesc.Width = static_cast<UINT>(width_);
    swapDesc_.BufferDesc.Height = static_cast<UINT>(height_);
    swapDesc_.BufferDesc.Format = DXGI_FORMAT_R8G8B8A8_UNORM;
    swapDesc_.BufferDesc.RefreshRate.Numerator = 60;
    swapDesc_.BufferDesc.RefreshRate.Denominator = 1;
    swapDesc_.BufferUsage = DXGI_USAGE_RENDER_TARGET_OUTPUT;
    swapDesc_.OutputWindow = hwnd_;
    swapDesc_.SampleDesc.Count = 1;
    swapDesc_.Windowed = TRUE;
    swapDesc_.SwapEffect = DXGI_SWAP_EFFECT_DISCARD;
    hr = factory->CreateSwapChain(device_, &swapDesc_, &swapChain_);
  }
  factory->Release();
  adapter->Release();
  dxgiDevice->Release();
  if (FAILED(hr)) {
    char buf[64];
    std::snprintf(buf, sizeof(buf), "[d3d] create swapchain failed: 0x%08lX", static_cast<unsigned long>(hr));
    LogLine(buf);
    return false;
  }
  return createTargets();
}

bool App::createDevice() {
  if (!createD3DDevice() || !createSwapChain()) return false;
  uiReady_ = ui_.Init(device_, context_);
  if (!uiReady_) {
    // UI 渲染器初始化失败不致命：面板/FPS 角标缺失且禁用交互，模型照常渲染
    LogLine("[ui] init failed, panel disabled");
  }
  return true;
}

void App::releaseComposition() {
  if (dcompVisual_) {
    dcompVisual_->Release();
    dcompVisual_ = nullptr;
  }
  if (dcompTarget_) {
    dcompTarget_->Release();
    dcompTarget_ = nullptr;
  }
  if (dcompDevice_) {
    dcompDevice_->Release();
    dcompDevice_ = nullptr;
  }
}

bool App::recreateWindow() {
  // 保留原窗口位置，避免切换透明模式后窗口跳回默认位置
  int x = CW_USEDEFAULT;
  int y = CW_USEDEFAULT;
  if (hwnd_) {
    RECT wr{};
    if (GetWindowRect(hwnd_, &wr)) {
      x = wr.left;
      y = wr.top;
    }
  }

  recreating_ = true;
  if (model_) model_.reset();  // 释放渲染器对渲染目标的引用，重建后重新加载
  if (lockButton_) {
    DestroyWindow(lockButton_);
    lockButton_ = nullptr;
  }
  EnsureHitThrough(false);
  releaseTargets();
  releaseComposition();  // DComp target 绑定旧 hwnd，销毁窗口前必须释放
  if (swapChain_) {
    swapChain_->Release();
    swapChain_ = nullptr;
  }
  if (hwnd_) {
    DestroyWindow(hwnd_);
    hwnd_ = nullptr;
  }
  recreating_ = false;

  // device_/context_ 与 Cubism 常驻状态全部保留，仅窗口与交换链重建
  const bool oldTransparent = transparent_;
  if (!createWindow()) {
    LogLine("[window] recreate failed (createWindow)");
    return false;
  }
  if (x != CW_USEDEFAULT) SetWindowPos(hwnd_, nullptr, x, y, 0, 0, SWP_NOSIZE | SWP_NOZORDER);
  if (!createSwapChain()) {
    // 透明交换链创建失败：回退不透明模式重建，保证窗口可用
    LogLine("[window] transparent swapchain failed, fallback to opaque");
    config_.transparent = false;
    if (!createWindow() || !createSwapChain()) {
      config_.transparent = oldTransparent;
      return false;
    }
    config_.transparent = oldTransparent;  // 配置意图保留，下次重启再试
    transparent_ = false;
  }
  loadDefaultModel();
  if (model_) {
    model_->SetTransform(lastTransformScale_, lastTransformX_, lastTransformY_);
  }
  LogLine(transparent_ ? "[window] recreated (transparent)" : "[window] recreated (opaque)");
  return true;
}

bool App::createTargets() {
  releaseTargets();
  ID3D11Texture2D* back = nullptr;
  if (FAILED(swapChain_->GetBuffer(0, IID_PPV_ARGS(&back)))) return false;
  const HRESULT hr = device_->CreateRenderTargetView(back, nullptr, &rtv_);
  back->Release();
  if (FAILED(hr)) return false;

  D3D11_TEXTURE2D_DESC depthDesc{};
  depthDesc.Width = static_cast<UINT>(width_);
  depthDesc.Height = static_cast<UINT>(height_);
  depthDesc.MipLevels = 1;
  depthDesc.ArraySize = 1;
  depthDesc.Format = DXGI_FORMAT_D24_UNORM_S8_UINT;
  depthDesc.SampleDesc.Count = 1;
  depthDesc.Usage = D3D11_USAGE_DEFAULT;
  depthDesc.BindFlags = D3D11_BIND_DEPTH_STENCIL;
  if (FAILED(device_->CreateTexture2D(&depthDesc, nullptr, &depthTex_))) return false;
  if (FAILED(device_->CreateDepthStencilView(depthTex_, nullptr, &dsv_))) return false;
  return true;
}

void App::releaseTargets() {
  if (rtv_) { rtv_->Release(); rtv_ = nullptr; }
  if (dsv_) { dsv_->Release(); dsv_ = nullptr; }
  if (depthTex_) { depthTex_->Release(); depthTex_ = nullptr; }
}

void App::releaseDevice() {
  releaseTargets();
  releaseComposition();
  if (bgTex_) { bgTex_->Release(); bgTex_ = nullptr; }
  bgTexPath_.clear();
  ui_.ClearTextCache();
  if (depthState_) { depthState_->Release(); depthState_ = nullptr; }
  if (infoQueue_) { infoQueue_->Release(); infoQueue_ = nullptr; }
  if (swapChain_) { swapChain_->Release(); swapChain_ = nullptr; }
  if (context_) {
    context_->ClearState();
    context_->Flush();
    context_->Release();
    context_ = nullptr;
  }
  if (device_) {
    device_->Release();
    device_ = nullptr;
  }
}

bool App::startCubism() {
  cubismOption_.LogFunction = CubismLog;
  cubismOption_.LoggingLevel = Csm::CubismFramework::Option::LogLevel_Warning;
  cubismOption_.LoadFileFunction = [](const std::string filePath, Csm::csmSizeInt* outSize) -> Csm::csmByte* {
    const std::string resolved = ResolvePath(filePath);
    FileBytes bytes = LoadFile(resolved);
    if (bytes.empty()) {
      LogLine(std::string("[io] missing ") + resolved);
      if (outSize) *outSize = 0;
      return nullptr;
    }
    if (outSize) *outSize = bytes.size();
    auto* copy = new Csm::csmByte[bytes.size()];
    memcpy(copy, bytes.ptr(), bytes.size());
    return copy;
  };
  cubismOption_.ReleaseBytesFunction = [](Csm::csmByte* data) { delete[] data; };

  if (!Csm::CubismFramework::StartUp(&allocator_, &cubismOption_)) return false;
  Csm::CubismFramework::Initialize();
  Csm::Rendering::CubismRenderer_D3D11::SetConstantSettings(2, device_);
  return true;
}

void App::stopCubism() {
  model_.reset();
  // Cubism 官方销毁顺序：先删渲染器（model_.reset 已做），再释放 DeviceInfo，
  // 最后 Dispose framework——顺序颠倒会在 Dispose 后访问已清理状态导致崩溃
  if (device_) {
    Csm::Rendering::CubismDeviceInfo_D3D11::ReleaseDeviceInfo(device_);
  }
  if (Csm::CubismFramework::IsInitialized()) Csm::CubismFramework::Dispose();
  Csm::CubismFramework::CleanUp();
}

bool App::loadDefaultModel() {
  const std::string& target = lastModelPath_.empty() ? config_.modelPath : lastModelPath_;
  LogLine(std::string("[app] modelPath=") + target);
  model_ = std::make_unique<Live2DModel>();
  LogLine("[app] Live2DModel constructed");
  const bool ok = model_->Load(target, device_, width_, height_);
  if (ok) {
    lastModelPath_ = target;
    model_->SetTransform(lastTransformScale_, lastTransformX_, lastTransformY_);
    // 新模型实例：重放舞台物理与变换
    applyStagePhysics();
  }
  return ok;
}

void App::enqueue(std::function<void()> fn) {
  std::lock_guard lock(jobsMutex_);
  jobs_.push_back(std::move(fn));
}

void App::pumpJobs() {
  std::vector<std::function<void()>> pending;
  {
    std::lock_guard lock(jobsMutex_);
    pending.swap(jobs_);
  }
  for (auto& job : pending) job();
}

float App::deltaSeconds() {
  LARGE_INTEGER now{};
  QueryPerformanceCounter(&now);
  const float dt = static_cast<float>(now.QuadPart - last_.QuadPart) / static_cast<float>(freq_.QuadPart);
  last_ = now;
  return dt > 0.1f ? 0.1f : dt;
}

void App::resize(int width, int height) {
  if (width <= 0 || height <= 0 || !swapChain_) return;
  width_ = width;
  height_ = height;
  context_->OMSetRenderTargets(0, nullptr, nullptr);
  releaseTargets();
  swapChain_->ResizeBuffers(0, static_cast<UINT>(width_), static_cast<UINT>(height_), DXGI_FORMAT_UNKNOWN, 0);
  createTargets();
  if (model_) model_->Resize(width_, height_);
}

void App::UpdateCursorHitThrough() {
  // 锁定模式：全穿透（仅锁定按钮窗口不穿透）
  if (locked_) {
    EnsureHitThrough(true);
    SyncLockPosition();
    return;
  }
  if (!transparent_ || !hwnd_) {
    EnsureHitThrough(false);
    SyncLockPosition();
    return;
  }
  POINT p{};
  GetCursorPos(&p);
  POINT origin{0, 0};
  ClientToScreen(hwnd_, &origin);
  int mx = 0, my = 0, mw = 0, mh = 0;
  if (model_ && model_->GetPixelBounds(mx, my, mw, mh)) {
    const long sx = origin.x + mx;
    const long sy = origin.y + my;
    const bool inside =
        p.x >= sx && p.x < sx + mw &&
        p.y >= sy && p.y < sy + mh;
    EnsureHitThrough(!inside);
  } else {
    EnsureHitThrough(true);
  }
  SyncLockPosition();
}

void App::EnsureHitThrough(bool through) {
  if (through == hitThrough_ || !hwnd_) return;
  hitThrough_ = through;
  const LONG_PTR ex = GetWindowLongPtrW(hwnd_, GWL_EXSTYLE);
  if (through) {
    SetWindowLongPtrW(hwnd_, GWL_EXSTYLE, ex | WS_EX_LAYERED | WS_EX_TRANSPARENT);
    SetLayeredWindowAttributes(hwnd_, 0, 255, LWA_ALPHA);
  } else {
    SetWindowLongPtrW(hwnd_, GWL_EXSTYLE, ex & ~(WS_EX_LAYERED | WS_EX_TRANSPARENT));
  }
  SetWindowPos(hwnd_, nullptr, 0, 0, 0, 0,
               SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_FRAMECHANGED);
}

// ============================================================
// 窗口内 UI（FPS 角标）+ 锁定迷你按钮
// 控制台面板已迁移至独立控制窗（backend/renderer/compact.html，双击模型经 Edge --app 唤起）
// ============================================================

namespace {
// 战术配色（与 WebUI 主题一致：深底 + 青色强调）
constexpr COLORREF TB_BG = RGB(10, 15, 20);        // 深底（锁定按钮沿用）
constexpr COLORREF TB_ACTIVE = RGB(0, 227, 255);   // 青（锁定按钮沿用）

// FPS 角标配色（RGBA 直通，绘制时预乘）
constexpr float PAN_BG_R = 0.075f, PAN_BG_G = 0.10f, PAN_BG_B = 0.13f;   // #131a21
constexpr float CYAN_R = 0.0f, CYAN_G = 0.890f, CYAN_B = 1.0f;            // #00e5ff

float ClampF(float v, float lo, float hi) { return v < lo ? lo : (v > hi ? hi : v); }
}  // namespace

void App::ParseHexColor(const std::string& hex, float& r, float& g, float& b) {
  std::string h = hex;
  if (!h.empty() && h[0] == '#') h = h.substr(1);
  if (h.length() != 6) {
    r = g = b = 0;
    return;
  }
  auto nib = [](char c) -> int {
    if (c >= '0' && c <= '9') return c - '0';
    if (c >= 'a' && c <= 'f') return c - 'a' + 10;
    if (c >= 'A' && c <= 'F') return c - 'A' + 10;
    return 0;
  };
  const int ri = nib(h[0]) * 16 + nib(h[1]);
  const int gi = nib(h[2]) * 16 + nib(h[3]);
  const int bi = nib(h[4]) * 16 + nib(h[5]);
  r = ri / 255.0f;
  g = gi / 255.0f;
  b = bi / 255.0f;
}

void App::SyncLockPosition() {
  if (!lockButton_ || !locked_) return;
  int mx = 0, my = 0, mw = 0, mh = 0;
  POINT origin{0, 0};
  ClientToScreen(hwnd_, &origin);
  if (!model_ || !model_->GetPixelBounds(mx, my, mw, mh)) return;
  const int x = origin.x + mx + mw - 44;
  const int y = origin.y + my + 4;
  SetWindowPos(lockButton_, nullptr, x, y, 0, 0, SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE);
}

void App::scheduleStageNotify() {
  stageDirty_ = true;
}

void App::applyStagePhysics() {
  if (model_) {
    model_->SetPhysics(stage_.windX, stage_.windY, stage_.gravityX, stage_.gravityY, stage_.physicsSpeed);
  }
}

nlohmann::json App::stageJson() const {
  return {
      {"windX", stage_.windX},
      {"windY", stage_.windY},
      {"gravityX", stage_.gravityX},
      {"gravityY", stage_.gravityY},
      {"physicsSpeed", stage_.physicsSpeed},
      {"bgMode", stage_.bgMode},
      {"bgColor", stage_.bgColor},
      {"bgAlpha", stage_.bgAlpha},
      {"bgImage", stage_.bgImage},
      {"fpsOverlay", stage_.fpsOverlay},
  };
}

void App::applyStage(const nlohmann::json& params) {
  const std::string oldImage = stage_.bgImage;
  if (params.contains("windX")) stage_.windX = ClampF(params.value("windX", 0.0f), -3.0f, 3.0f);
  if (params.contains("windY")) stage_.windY = ClampF(params.value("windY", 0.0f), -3.0f, 3.0f);
  if (params.contains("gravityX")) stage_.gravityX = ClampF(params.value("gravityX", 0.0f), -3.0f, 3.0f);
  if (params.contains("gravityY")) stage_.gravityY = ClampF(params.value("gravityY", -1.0f), -3.0f, 3.0f);
  if (params.contains("physicsSpeed")) stage_.physicsSpeed = ClampF(params.value("physicsSpeed", 1.0f), 0.0f, 3.0f);
  if (params.contains("bgMode")) stage_.bgMode = params.value("bgMode", std::string("transparent"));
  if (params.contains("bgColor")) stage_.bgColor = params.value("bgColor", std::string("#0d1218"));
  if (params.contains("bgAlpha")) stage_.bgAlpha = ClampF(params.value("bgAlpha", 1.0f), 0.0f, 1.0f);
  if (params.contains("bgImage")) stage_.bgImage = params.value("bgImage", std::string(""));
  if (params.contains("fpsOverlay")) stage_.fpsOverlay = params.value("fpsOverlay", false);
  applyStagePhysics();
  if (stage_.bgImage != oldImage) loadBgTexture();
}

void App::loadBgTexture() {
  if (bgTexPath_ == stage_.bgImage) return;
  if (bgTex_) {
    bgTex_->Release();
    bgTex_ = nullptr;
  }
  bgTexPath_ = stage_.bgImage;
  if (bgTexPath_.empty()) return;
  const std::string resolved = ResolvePath(bgTexPath_);
  if (!LoadPngTexture(device_, resolved, &bgTex_)) {
    LogLine(std::string("[stage] background image load failed: ") + resolved);
    bgTex_ = nullptr;
  } else {
    LogLine(std::string("[stage] background image loaded: ") + resolved);
  }
}

void App::DrawBackgroundImage() {
  if (!bgTex_) return;
  ID3D11Resource* res = nullptr;
  bgTex_->GetResource(&res);
  ID3D11Texture2D* tex = nullptr;
  UINT iw = 0, ih = 0;
  if (res && SUCCEEDED(res->QueryInterface(IID_PPV_ARGS(&tex)))) {
    D3D11_TEXTURE2D_DESC desc{};
    tex->GetDesc(&desc);
    iw = desc.Width;
    ih = desc.Height;
    tex->Release();
  }
  if (res) res->Release();
  if (!iw || !ih) return;
  // cover 适配铺满
  const float scale = std::max(width_ / static_cast<float>(iw), height_ / static_cast<float>(ih));
  const float dw = iw * scale;
  const float dh = ih * scale;
  ui_.TextureRect((width_ - dw) / 2.0f, (height_ - dh) / 2.0f, dw, dh, bgTex_,
                  ClampF(stage_.bgAlpha, 0.0f, 1.0f));
}

void App::OpenControlWindow() {
  // 双击模型 = 直接打开 WebUI 控制台（完整配置界面）。
  // 优先 --app 模式（无地址栏独立小窗）：先 Edge 后 Chrome（均经 App Paths 解析），
  // 两者都不可用时回退系统默认浏览器打开普通标签页
  const std::string url = webuiUrl_;
  const std::wstring wurl = Utf8ToWide(url);
  const std::wstring arg = L"--app=" + wurl;
  const HINSTANCE h1 = ShellExecuteW(nullptr, L"open", L"msedge.exe", arg.c_str(), nullptr, SW_SHOWNORMAL);
  if (reinterpret_cast<INT_PTR>(h1) <= 32) {
    const HINSTANCE h2 = ShellExecuteW(nullptr, L"open", L"chrome.exe", arg.c_str(), nullptr, SW_SHOWNORMAL);
    if (reinterpret_cast<INT_PTR>(h2) <= 32) {
      ShellExecuteW(nullptr, L"open", wurl.c_str(), nullptr, nullptr, SW_SHOWNORMAL);
    }
  }
  LogLine(std::string("[control] compact window: ") + url);
}

void App::drawFpsBadge() {
  wchar_t buf[32];
  swprintf(buf, 32, L"%.0f FPS", fps_);
  const float w = ui_.MeasureText(buf, 17.0f, true, true) + 26.0f;
  ui_.Rect(10.0f, 10.0f, w, 34.0f, PAN_BG_R, PAN_BG_G, PAN_BG_B, 0.9f);
  ui_.FrameRect(10.0f, 10.0f, w, 34.0f, CYAN_R, CYAN_G, CYAN_B, 0.5f);
  ui_.Text(buf, 22.0f, 15.0f, 17.0f, CYAN_R, CYAN_G, CYAN_B, 1.0f, true, true);
}

void App::DrawLockButton(HDC hdc, RECT rc) {
  // 深底圆形 + 🔓 + 青色边框
  HBRUSH bg = CreateSolidBrush(TB_BG);
  FillRect(hdc, &rc, bg);
  DeleteObject(bg);

  HPEN border = CreatePen(PS_SOLID, 1, TB_ACTIVE);
  HGDIOBJ oldPen = SelectObject(hdc, border);
  HBRUSH hollow = (HBRUSH)GetStockObject(NULL_BRUSH);
  Ellipse(hdc, rc.left + 2, rc.top + 2, rc.right - 2, rc.bottom - 2);
  SelectObject(hdc, oldPen);
  DeleteObject(border);

  SetBkMode(hdc, TRANSPARENT);
  HFONT font = CreateFontW(16, 0, 0, 0, FW_NORMAL, 0, 0, 0, DEFAULT_CHARSET,
                           OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS, CLEARTYPE_QUALITY,
                           DEFAULT_PITCH | FF_DONTCARE, L"Segoe UI Emoji");
  HGDIOBJ oldFont = SelectObject(hdc, font);
  SetTextColor(hdc, TB_ACTIVE);
  DrawTextW(hdc, L"🔓", -1, &rc, DT_CENTER | DT_VCENTER | DT_SINGLELINE);
  SelectObject(hdc, oldFont);
  DeleteObject(font);
}

void App::EnterLockMode() {
  locked_ = true;
  // 主窗口全穿透（仅锁定按钮可交互）
  EnsureHitThrough(true);

  // 创建锁定按钮迷你窗
  WNDCLASSEXW wc{};
  wc.cbSize = sizeof(wc);
  wc.lpfnWndProc = LockBtnProc;
  wc.hInstance = GetModuleHandleW(nullptr);
  wc.lpszClassName = L"VtuberExecutorLock";
  wc.hCursor = LoadCursor(nullptr, IDC_HAND);
  RegisterClassExW(&wc);

  lockButton_ = CreateWindowExW(WS_EX_TOPMOST | WS_EX_TOOLWINDOW | WS_EX_LAYERED,
      wc.lpszClassName, nullptr, WS_POPUP,
      0, 0, 36, 36, hwnd_, nullptr, wc.hInstance, this);
  if (lockButton_) {
    SetLayeredWindowAttributes(lockButton_, 0, 220, LWA_ALPHA);
    SyncLockPosition();
    ShowWindow(lockButton_, SW_SHOWNOACTIVATE);
  }
}

void App::ExitLockMode() {
  locked_ = false;
  if (lockButton_) {
    DestroyWindow(lockButton_);
    lockButton_ = nullptr;
  }
  EnsureHitThrough(false);
}

void App::ToggleLock() {
  if (locked_) ExitLockMode();
  else EnterLockMode();
}

void App::CycleCostume() {
  if (!model_) return;
  auto expressions = model_->ExpressionNames();
  if (expressions.empty()) return;
  costumeIdx_ = (costumeIdx_ + 1) % static_cast<int>(expressions.size());
  model_->SetExpression(expressions[costumeIdx_]);
}

LRESULT CALLBACK App::LockBtnProc(HWND hwnd, UINT msg, WPARAM wparam, LPARAM lparam) {
  App* app = reinterpret_cast<App*>(GetWindowLongPtrW(hwnd, GWLP_USERDATA));
  switch (msg) {
    case WM_NCCREATE: {
      auto* cs = reinterpret_cast<CREATESTRUCTW*>(lparam);
      SetWindowLongPtrW(hwnd, GWLP_USERDATA, reinterpret_cast<LONG_PTR>(cs->lpCreateParams));
      break;
    }
    case WM_PAINT: {
      PAINTSTRUCT ps{};
      HDC hdc = BeginPaint(hwnd, &ps);
      if (app) app->DrawLockButton(hdc, ps.rcPaint);
      EndPaint(hwnd, &ps);
      return 0;
    }
    case WM_LBUTTONUP:
      if (app) app->ToggleLock();
      return 0;
    case WM_DESTROY:
      return 0;
    default:
      break;
  }
  return DefWindowProcW(hwnd, msg, wparam, lparam);
}

void App::frame() {
  if (!device_ || !context_) return;
  frameCount_++;
  pumpJobs();
  UpdateCursorHitThrough();

  const float dt = deltaSeconds();

  // FPS 统计：500ms 窗口均值
  fpsAccum_ += dt;
  fpsFrames_++;
  fpsClock_ += dt;
  if (fpsClock_ >= 0.5) {
    fps_ = fpsFrames_ / fpsAccum_;
    fpsClock_ = 0.0;
    fpsAccum_ = 0.0;
    fpsFrames_ = 0;
  }

  // 背景色：transparent 全 0；color 预乘半透明色底（透明窗下呈半透明色）；image 清 0 后铺图
  float clearR = 0.0f, clearG = 0.0f, clearB = 0.0f, clearA = transparent_ ? 0.0f : 1.0f;
  if (stage_.bgMode == "color") {
    ParseHexColor(stage_.bgColor, clearR, clearG, clearB);
    const float a = ClampF(stage_.bgAlpha, 0.0f, 1.0f);
    if (transparent_) {
      // 预乘 clear：alpha<1 时窗口呈半透明色底
      clearR *= a;
      clearG *= a;
      clearB *= a;
      clearA = a;
    } else {
      clearA = 1.0f;
    }
  }
  const float clear[4] = {clearR, clearG, clearB, clearA};
  context_->OMSetRenderTargets(1, &rtv_, dsv_);
  context_->ClearRenderTargetView(rtv_, clear);
  context_->ClearDepthStencilView(dsv_, D3D11_CLEAR_DEPTH | D3D11_CLEAR_STENCIL, 1.0f, 0);
  context_->OMSetDepthStencilState(depthState_, 0);

  D3D11_VIEWPORT viewport{};
  viewport.Width = static_cast<float>(width_);
  viewport.Height = static_cast<float>(height_);
  viewport.MaxDepth = 1.0f;
  context_->RSSetViewports(1, &viewport);

  // 背景图（模型之下，cover 适配，可乘不透明度）
  if (stage_.bgMode == "image") loadBgTexture();
  if (stage_.bgMode == "image" && bgTex_) {
    ui_.Begin(width_, height_);
    DrawBackgroundImage();
    ui_.End();
    context_->OMSetRenderTargets(1, &rtv_, dsv_);
  }

  auto* renderer = (model_ && model_->loaded()) ? model_->GetRenderer<Csm::Rendering::CubismRenderer_D3D11>() : nullptr;
  if (renderer) renderer->StartFrame(context_);
  if (model_) {
    model_->Update(dt);
    model_->Draw(width_, height_);
  }
  if (renderer) renderer->EndFrame();

  // UI 层前置：显式重绑后备缓冲。不信任 Cubism EndFrame 的状态归还——
  // SDK 在蒙版/换装/动作加载等离屏路径后可能留下非后备缓冲目标（或空绑定），
  // ui_.Begin() 会捕获到错误目标，导致面板/FPS 角标整体画到虚空（模型正常、UI 消失）
  context_->OMSetRenderTargets(1, &rtv_, dsv_);

  // 窗口内 UI：仅 FPS 角标（控制台已迁移至独立控制窗 compact.html，双击模型唤起）
  if (uiReady_ && stage_.fpsOverlay && !locked_) {
    ui_.Begin(width_, height_);
    drawFpsBadge();
    ui_.End();
  }

  // 面板编辑 → 节流广播 stageChanged
  if (stageDirty_) {
    LARGE_INTEGER qpc{};
    QueryPerformanceCounter(&qpc);
    const double wall = static_cast<double>(qpc.QuadPart) / freq_.QuadPart * 1000.0;
    if (wall - stageLastNotify_ >= 100.0) {
      stageDirty_ = false;
      stageLastNotify_ = wall;
      notify("live2d.stageChanged", stageJson());
    }
  }

  // 每 60 帧回读后备缓冲像素(角标区/模型区)：兼作 GPU 同步点,修复 FLIP+DComp 呈现队列丢帧
  if ((frameCount_ % 60) == 0 && rtv_) {
    ID3D11Resource* res = nullptr;
    rtv_->GetResource(&res);
    ID3D11Texture2D* back = nullptr;
    if (res && SUCCEEDED(res->QueryInterface(IID_PPV_ARGS(&back)))) {
      D3D11_TEXTURE2D_DESC desc{};
      back->GetDesc(&desc);
      D3D11_TEXTURE2D_DESC st = desc;
      st.Usage = D3D11_USAGE_STAGING;
      st.BindFlags = 0;
      st.CPUAccessFlags = D3D11_CPU_ACCESS_READ;
      st.MiscFlags = 0;
      ID3D11Texture2D* staging = nullptr;
      if (SUCCEEDED(device_->CreateTexture2D(&st, nullptr, &staging))) {
        context_->CopyResource(staging, back);
        D3D11_MAPPED_SUBRESOURCE mapped{};
        if (SUCCEEDED(context_->Map(staging, 0, D3D11_MAP_READ, 0, &mapped))) {
          auto readPx = [&](int x, int y, int out[4]) {
            if (x < 0 || y < 0 || x >= static_cast<int>(desc.Width) || y >= static_cast<int>(desc.Height)) return;
            const UINT bpp = 4;
            const BYTE* row = static_cast<const BYTE*>(mapped.pData) + static_cast<SIZE_T>(y) * mapped.RowPitch;
            const BYTE* px = row + static_cast<SIZE_T>(x) * bpp;
            out[0] = px[0]; out[1] = px[1]; out[2] = px[2]; out[3] = px[3];  // BGRA
          };
          readPx(40, 24, probePanel_);  // 角标区
          readPx(400, 700, probeModel_);
          context_->Unmap(staging, 0);
        }
        staging->Release();
      }
      back->Release();
    }
    if (res) res->Release();
  }

  swapChain_->Present(1, 0);
}

nlohmann::json App::handleRpc(const std::string& method, const nlohmann::json& params) {
  if (method.rfind("live2d.", 0) == 0) return dispatchLive2d(method, params);
  // player.*/audio.* 已拆分至 audio_executor 进程，此处不再分发

  if (method == "window.apply") {
    // 窗口参数在渲染线程串行应用（可能触发窗口/交换链重建）
    return runOnRenderThread([this, params]() { return applyWindow(params); });
  }
  if (method == "system.ping") {
    return {{"ok", true}, {"role", "cpp-executor"}};
  }
  if (method == "system.status") {
    // model_ 由渲染线程在 live2d.load 中替换，IPC 线程直接读会有 UAF 风险，
    // 状态查询统一投递到渲染线程执行（含面板/包围盒诊断字段）
    nlohmann::json live2d;
    nlohmann::json panel;
    nlohmann::json d3dMsgs = nlohmann::json::array();
    runOnRenderThread([this, &live2d, &panel, &d3dMsgs]() {
      live2d = model_ ? model_->Status() : nlohmann::json{{"loaded", false}};
      int bx = 0, by = 0, bw = 0, bh = 0;
      const bool hasBounds = model_ && model_->GetPixelBounds(bx, by, bw, bh);
      panel = {
          {"locked", locked_},
          {"hitThrough", hitThrough_},
          {"modelBounds",
           hasBounds ? nlohmann::json{{"x", bx}, {"y", by}, {"w", bw}, {"h", bh}}
                     : nlohmann::json(nullptr)},
      };
      // D3D 调试层消息:GPU 拒绝绘制的原因(取最近最多 8 条)
      if (infoQueue_) {
        UINT64 count = infoQueue_->GetNumStoredMessagesAllowedByRetrievalFilter();
        if (count > 8) count = 8;
        for (UINT64 i = 0; i < count; i++) {
          SIZE_T len = 0;
          if (FAILED(infoQueue_->GetMessage(0, nullptr, &len)) || len == 0) continue;
          std::vector<char> buf(len);
          auto* msg = reinterpret_cast<D3D11_MESSAGE*>(buf.data());
          if (SUCCEEDED(infoQueue_->GetMessage(0, msg, &len)) && msg->pDescription) {
            std::string text(msg->pDescription, msg->DescriptionByteLength);
            if (text.size() > 300) text.resize(300);
            d3dMsgs.push_back(text);
          }
        }
        infoQueue_->ClearStoredMessages();
      }
      return nlohmann::json{{"ok", true}};
    });
    return {
        {"ok", true},
        {"role", "cpp-executor"},
        {"ipcPort", config_.ipcPort},
        {"fps", fps_},
        {"stage", stageJson()},
        {"ui", {{"frames", frameCount_}, {"quads", ui_.quadCount}, {"beginRtv", ui_.lastBeginHadRtv},
                {"probePanelBGRA", {probePanel_[3], probePanel_[2], probePanel_[1], probePanel_[0]}},
                {"probeModelBGRA", {probeModel_[3], probeModel_[2], probeModel_[1], probeModel_[0]}}}},
        {"d3d", d3dMsgs},
        {"panel", panel},
        {"window",
         {{"width", width_}, {"height", height_}, {"transparent", transparent_}, {"alwaysOnTop", topmost_}}},
        {"live2d", live2d},
    };
  }
  if (method == "system.shutdown") {
    requestQuit();
    return {{"ok", true}};
  }
  throw std::runtime_error("method not found: " + method);
}

template <typename Fn>
nlohmann::json App::runOnRenderThread(Fn&& fn) {
  if (quit_) return {{"ok", false}, {"error", "shutting down"}};
  auto done = std::make_shared<std::promise<nlohmann::json>>();
  auto future = done->get_future();
  enqueue([done, fn = std::forward<Fn>(fn)]() mutable {
    try {
      done->set_value(fn());
    } catch (...) {
      done->set_value({{"ok", false}, {"error", "render thread exception"}});
    }
  });
  // 超时保护：渲染循环退出后 job 不再被消费，避免 IPC 线程永久阻塞卡死 stop()
  if (future.wait_for(std::chrono::seconds(5)) != std::future_status::ready) {
    return {{"ok", false}, {"error", "render thread timeout"}};
  }
  return future.get();
}

nlohmann::json App::dispatchLive2d(const std::string& method, const nlohmann::json& params) {
  if (method == "live2d.status" || method == "live2d.list") {
    // 与 system.status 同理：model_ 只能在渲染线程访问
    return runOnRenderThread([this]() {
      return model_ ? model_->Status() : nlohmann::json{{"loaded", false}};
    });
  }
  if (method == "live2d.load") {
    const std::string path = params.value("path", config_.modelPath);
    return runOnRenderThread([this, path]() {
      model_ = std::make_unique<Live2DModel>();
      const bool ok = model_->Load(path, device_, width_, height_);
      if (ok) {
        lastModelPath_ = path;
        model_->SetTransform(lastTransformScale_, lastTransformX_, lastTransformY_);
        applyStagePhysics();
      }
      return nlohmann::json{{"ok", ok}, {"live2d", model_->Status()}};
    });
  }
  if (method == "live2d.expression") {
    const std::string name = params.value("name", "");
    return runOnRenderThread([this, name]() {
      return nlohmann::json{{"ok", model_ && model_->SetExpression(name)}, {"name", name}};
    });
  }
  if (method == "live2d.resetExpression") {
    return runOnRenderThread([this]() {
      return nlohmann::json{{"ok", model_ && model_->ResetExpression()}};
    });
  }
  if (method == "live2d.loadExtra") {
    return runOnRenderThread([this, params]() {
      if (!model_ || !model_->loaded()) return nlohmann::json{{"ok", false}, {"error", "model not loaded"}};
      const bool ok = model_->LoadExtra(params);
      return nlohmann::json{{"ok", ok}, {"live2d", model_->Status()}};
    });
  }
  if (method == "live2d.motion") {
    // name（目录嗅探注入的命名动作）优先；否则 group+index
    const std::string name = params.value("name", "");
    const std::string group = params.value("group", "Idle");
    const int index = params.value("index", 0);
    return runOnRenderThread([this, name, group, index]() {
      if (!name.empty()) {
        const bool ok = model_ && model_->StartMotionByName(name);
        return nlohmann::json{{"ok", ok}, {"name", name}};
      }
      const bool ok = model_ && model_->StartMotion(group, index);
      return nlohmann::json{{"ok", ok}, {"group", group}, {"index", index}};
    });
  }
  if (method == "live2d.transform") {
    const float scale = params.value("scale", 1.0f);
    const float x = params.value("x", 0.0f);
    const float y = params.value("y", 0.0f);
    return runOnRenderThread([this, scale, x, y]() {
      if (model_) model_->SetTransform(scale, x, y);
      lastTransformScale_ = scale;
      lastTransformX_ = x;
      lastTransformY_ = y;
      return nlohmann::json{{"ok", static_cast<bool>(model_)}, {"scale", scale}, {"x", x}, {"y", y}};
    });
  }
  if (method == "live2d.stage") {
    return runOnRenderThread([this]() { return stageJson(); });
  }
  if (method == "live2d.setStage") {
    // 后端 → 执行器：应用舞台配置（不回播，防联动环）
    return runOnRenderThread([this, params]() {
      applyStage(params);
      return nlohmann::json{{"ok", true}, {"stage", stageJson()}};
    });
  }
  if (method == "live2d.lock") {
    // compact 控制窗「锁定」按钮：切换点击穿透锁定（与锁定迷你按钮共用状态）
    return runOnRenderThread([this, params]() {
      const bool want = params.value("locked", !locked_);
      if (want != locked_) ToggleLock();
      return nlohmann::json{{"ok", true}, {"locked", locked_}};
    });
  }
  if (method == "live2d.setEnv") {
    // 后端推送 WebUI 地址（实际 httpPort），面板 WebUI 按钮使用
    const std::string url = params.value("webuiUrl", "");
    if (!url.empty()) webuiUrl_ = url;
    return nlohmann::json{{"ok", true}, {"webuiUrl", webuiUrl_}};
  }
  throw std::runtime_error("method not found: " + method);
}

nlohmann::json App::applyWindow(const nlohmann::json& params) {
  const int newWidth = params.value("width", config_.width);
  const int newHeight = params.value("height", config_.height);
  const bool newTopmost = params.value("alwaysOnTop", config_.alwaysOnTop);
  const bool newTransparent = params.value("transparent", config_.transparent);

  // 透明切换需要按新样式重建窗口与交换链（device/模型现场保留）
  bool recreated = false;
  if (newTransparent != transparent_) {
    config_.transparent = newTransparent;
    if (!recreateWindow()) {
      return {{"ok", false}, {"error", "window recreate failed"}, {"transparent", transparent_}};
    }
    recreated = true;
  }

  if (newTopmost != topmost_) {
    topmost_ = newTopmost;
    config_.alwaysOnTop = newTopmost;
    if (hwnd_) {
      SetWindowPos(hwnd_, topmost_ ? HWND_TOPMOST : HWND_NOTOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE);
    }
  }

  const bool sizeChanged = newWidth != width_ || newHeight != height_;
  if (sizeChanged || recreated) {
    config_.width = newWidth;
    config_.height = newHeight;
    if (hwnd_ && sizeChanged) {
      const DWORD style = transparent_ ? WS_POPUP : WS_OVERLAPPEDWINDOW;
      RECT rect{0, 0, newWidth, newHeight};
      AdjustWindowRect(&rect, style, FALSE);
      SetWindowPos(hwnd_, nullptr, 0, 0, rect.right - rect.left, rect.bottom - rect.top,
                   SWP_NOMOVE | SWP_NOZORDER);
      // WM_SIZE 同步触发 → resize() 完成交换链与视口更新
    }
  }
  LogLine("[window] applied");
  return {
      {"ok", true},
      {"width", width_},
      {"height", height_},
      {"transparent", transparent_},
      {"alwaysOnTop", topmost_},
      {"recreated", recreated},
  };
}

void App::notify(const std::string& method, const nlohmann::json& params) {
  ipc_.broadcast(method, params);
}

void App::requestQuit() {
  quit_ = true;
  if (hwnd_) PostMessageW(hwnd_, WM_CLOSE, 0, 0);
}

LRESULT CALLBACK App::WndProc(HWND hwnd, UINT msg, WPARAM wparam, LPARAM lparam) {
  App* app = nullptr;
  if (msg == WM_NCCREATE) {
    auto* cs = reinterpret_cast<CREATESTRUCTW*>(lparam);
    app = static_cast<App*>(cs->lpCreateParams);
    SetWindowLongPtrW(hwnd, GWLP_USERDATA, reinterpret_cast<LONG_PTR>(app));
  } else {
    app = reinterpret_cast<App*>(GetWindowLongPtrW(hwnd, GWLP_USERDATA));
  }

  switch (msg) {
    case WM_SIZE:
      if (app && wparam != SIZE_MINIMIZED) {
        app->resize(LOWORD(lparam), HIWORD(lparam));
      }
      return 0;
    case WM_EXITSIZEMOVE:
      // 用户拖动/调整窗口结束：持久化位置（重建窗口期间除外）
      if (app && !app->recreating_.load()) app->SaveWindowPosition();
      return 0;
    case WM_NCHITTEST: {
      // 透明无边框窗口：仅在模型包围盒内可拖动/交互，盒外穿透（轮询兜底之外的第二道保险）
      if (app && app->transparent_) {
        const LRESULT hit = DefWindowProcW(hwnd, msg, wparam, lparam);
        if (hit == HTCLIENT) {
          POINT pt{GET_X_LPARAM(lparam), GET_Y_LPARAM(lparam)};
          POINT origin{0, 0};
          ClientToScreen(hwnd, &origin);
          int mx = 0, my = 0, mw = 0, mh = 0;
          if (app->model_ && app->model_->GetPixelBounds(mx, my, mw, mh)
              && pt.x >= origin.x + mx && pt.x < origin.x + mx + mw
              && pt.y >= origin.y + my && pt.y < origin.y + my + mh) {
            return HTCAPTION;
          }
          return HTTRANSPARENT;
        }
      }
      break;
    }
    // WM_NCHITTEST 返回 HTCAPTION 后双击到达的是非客户区消息（NCL）。
    // 双击模型 = 呼出独立控制窗口（LunaMate 模式：设置不画在桌宠窗口内）
    case WM_NCLBUTTONDBLCLK:
      if (app && !app->locked_) {
        app->OpenControlWindow();
      }
      return 0;
    case WM_DESTROY:
      // 窗口重建期间的 DestroyWindow 不代表退出
      if (app && !app->recreating_.load()) {
        app->quit_ = true;
        PostQuitMessage(0);
      }
      return 0;
    default:
      break;
  }
  return DefWindowProcW(hwnd, msg, wparam, lparam);
}

int App::run(int argc, wchar_t** argv) {
  std::string configPath = "executor.json";
  for (int i = 1; i < argc; ++i) {
    const std::wstring arg = argv[i];
    if (arg == L"--config" && i + 1 < argc) {
      configPath = WideToUtf8(argv[++i]);
    }
  }
  LogLine(std::string("[app] config=") + configPath);
  loadConfig(configPath);
  width_ = config_.width;
  height_ = config_.height;

  LogLine("[app] createWindow");
  if (!createWindow()) {
    LogLine("[app] createWindow failed");
    return 1;
  }
  LogLine("[app] createDevice");
  if (!createDevice()) {
    LogLine("[app] createDevice failed");
    return 1;
  }
  LogLine("[app] startCubism");
  if (!startCubism()) {
    LogLine("[app] startCubism failed");
    return 1;
  }
  // IPC 提前启动：让后端的端口探测尽快成功，避免等待模型加载导致"点击无响应"
  LogLine("[app] ipc.start");
  ipc_.start(config_.ipcPort);
  LogLine("[app] loadDefaultModel");
  loadDefaultModel();
  LogLine("[app] loop");

  QueryPerformanceFrequency(&freq_);
  QueryPerformanceCounter(&last_);

  MSG msg{};
  while (!quit_) {
    while (PeekMessageW(&msg, nullptr, 0, 0, PM_REMOVE)) {
      if (msg.message == WM_QUIT) {
        quit_ = true;
        break;
      }
      TranslateMessage(&msg);
      DispatchMessageW(&msg);
    }
    if (quit_) break;
    frame();
  }

  LogLine("[app] loop exit");
  ipc_.stop();
  LogLine("[app] ipc stopped");
  stopCubism();
  LogLine("[app] cubism stopped");
  releaseDevice();
  LogLine("[app] device released");
  if (hwnd_) {
    DestroyWindow(hwnd_);
    hwnd_ = nullptr;
  }
  LogLine("[app] exit");
  return 0;
}

}  // namespace vtuber

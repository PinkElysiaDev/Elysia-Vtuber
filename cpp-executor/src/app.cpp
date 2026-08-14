#include "app.h"

#include <Rendering/D3D11/CubismDeviceInfo_D3D11.hpp>
#include <Rendering/D3D11/CubismRenderer_D3D11.hpp>

#include <cstdio>
#include <cstring>
#include <fstream>
#include <stdexcept>

namespace vtuber {

namespace {

std::ofstream g_bootLog;
HANDLE g_stdout = INVALID_HANDLE_VALUE;

void WriteOs(HANDLE handle, const std::string& text) {
  if (!handle || handle == INVALID_HANDLE_VALUE) return;
  DWORD written = 0;
  WriteFile(handle, text.data(), static_cast<DWORD>(text.size()), &written, nullptr);
}

void CubismLog(const Csm::csmChar* message) {
  if (message) LogLine(std::string("[cubism] ") + message);
}

}  // namespace

void InitLog() {
  const std::string exeDir = ExeDir();
  SetCurrentDirectoryW(Utf8ToWide(exeDir).c_str());
  g_bootLog.open(JoinPath(exeDir, "executor.log"), std::ios::out | std::ios::trunc);
  HANDLE handle = GetStdHandle(STD_OUTPUT_HANDLE);
  if (handle && handle != INVALID_HANDLE_VALUE && GetFileType(handle) != FILE_TYPE_UNKNOWN) {
    g_stdout = handle;
  }
  LogLine(std::string("[app] cwd=") + exeDir);
}

void LogLine(const std::string& line) {
  const std::string withNl = line + "\n";
  if (g_bootLog.is_open()) {
    g_bootLog << withNl;
    g_bootLog.flush();
  }
  WriteOs(g_stdout, withNl);
}

FileBytes LoadFile(const std::string& path) {
  FileBytes out;
  const std::wstring wide = Utf8ToWide(path);
  std::ifstream file(wide, std::ios::binary);
  if (!file) return out;
  file.seekg(0, std::ios::end);
  const auto size = static_cast<size_t>(file.tellg());
  file.seekg(0, std::ios::beg);
  out.data.resize(size);
  if (size) file.read(reinterpret_cast<char*>(out.data.data()), static_cast<std::streamsize>(size));
  return out;
}

std::wstring Utf8ToWide(const std::string& utf8) {
  if (utf8.empty()) return {};
  const int len = MultiByteToWideChar(CP_UTF8, 0, utf8.c_str(), -1, nullptr, 0);
  std::wstring wide(static_cast<size_t>(len), L'\0');
  MultiByteToWideChar(CP_UTF8, 0, utf8.c_str(), -1, wide.data(), len);
  if (!wide.empty() && wide.back() == L'\0') wide.pop_back();
  return wide;
}

std::string WideToUtf8(const std::wstring& wide) {
  if (wide.empty()) return {};
  const int len = WideCharToMultiByte(CP_UTF8, 0, wide.c_str(), -1, nullptr, 0, nullptr, nullptr);
  std::string utf8(static_cast<size_t>(len), '\0');
  WideCharToMultiByte(CP_UTF8, 0, wide.c_str(), -1, utf8.data(), len, nullptr, nullptr);
  if (!utf8.empty() && utf8.back() == '\0') utf8.pop_back();
  return utf8;
}

std::string JoinPath(const std::string& dir, const std::string& name) {
  if (dir.empty()) return name;
  char last = dir.back();
  if (last == '/' || last == '\\') return dir + name;
  return dir + "/" + name;
}

std::string DirName(const std::string& path) {
  const auto pos = path.find_last_of("/\\");
  if (pos == std::string::npos) return ".";
  return path.substr(0, pos);
}

std::string FileName(const std::string& path) {
  const auto pos = path.find_last_of("/\\");
  if (pos == std::string::npos) return path;
  return path.substr(pos + 1);
}

std::string ExeDir() {
  wchar_t buf[MAX_PATH]{};
  GetModuleFileNameW(nullptr, buf, MAX_PATH);
  std::wstring path(buf);
  const auto pos = path.find_last_of(L"\\/");
  if (pos != std::wstring::npos) path.resize(pos);
  return WideToUtf8(path);
}

std::string ResolvePath(const std::string& path) {
  if (path.size() >= 2 && path[1] == ':') return path;
  return JoinPath(ExeDir(), path);
}

App& App::instance() {
  static App app;
  return app;
}

bool App::loadConfig(const std::string& path) {
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
    }
    config_.modelPath = json.value("modelPath", config_.modelPath);
  } catch (const std::exception& ex) {
    LogLine(std::string("[config] parse failed: ") + ex.what());
    return false;
  }
  return true;
}

bool App::createWindow() {
  WNDCLASSEXW wc{};
  wc.cbSize = sizeof(wc);
  wc.style = CS_CLASSDC;
  wc.lpfnWndProc = WndProc;
  wc.hInstance = GetModuleHandleW(nullptr);
  wc.lpszClassName = L"VtuberExecutor";
  wc.hCursor = LoadCursor(nullptr, IDC_ARROW);
  RegisterClassExW(&wc);

  RECT rect{0, 0, config_.width, config_.height};
  AdjustWindowRect(&rect, WS_OVERLAPPEDWINDOW, FALSE);
  hwnd_ = CreateWindowExW(
      0,
      wc.lpszClassName,
      Utf8ToWide(config_.title).c_str(),
      WS_OVERLAPPEDWINDOW,
      CW_USEDEFAULT,
      CW_USEDEFAULT,
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

bool App::createDevice() {
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

  D3D_FEATURE_LEVEL level{};
  const HRESULT hr = D3D11CreateDeviceAndSwapChain(
      nullptr,
      D3D_DRIVER_TYPE_HARDWARE,
      nullptr,
      0,
      nullptr,
      0,
      D3D11_SDK_VERSION,
      &swapDesc_,
      &swapChain_,
      &device_,
      &level,
      &context_);
  if (FAILED(hr)) {
    char buf[64];
    std::snprintf(buf, sizeof(buf), "[d3d] create device failed: 0x%08lX", static_cast<unsigned long>(hr));
    LogLine(buf);
    return false;
  }

  D3D11_DEPTH_STENCIL_DESC depthDesc{};
  depthDesc.DepthEnable = FALSE;
  depthDesc.DepthWriteMask = D3D11_DEPTH_WRITE_MASK_ALL;
  depthDesc.DepthFunc = D3D11_COMPARISON_LESS;
  if (FAILED(device_->CreateDepthStencilState(&depthDesc, &depthState_))) return false;
  return createTargets();
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
  if (depthState_) { depthState_->Release(); depthState_ = nullptr; }
  if (swapChain_) { swapChain_->Release(); swapChain_ = nullptr; }
  if (context_) { context_->Release(); context_ = nullptr; }
  if (device_) {
    Csm::Rendering::CubismDeviceInfo_D3D11::ReleaseDeviceInfo(device_);
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
  if (Csm::CubismFramework::IsInitialized()) Csm::CubismFramework::Dispose();
  Csm::CubismFramework::CleanUp();
}

bool App::loadDefaultModel() {
  LogLine(std::string("[app] modelPath=") + config_.modelPath);
  model_ = std::make_unique<Live2DModel>();
  LogLine("[app] Live2DModel constructed");
  return model_->Load(config_.modelPath, device_, width_, height_);
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

void App::frame() {
  if (!device_ || !context_) return;
  pumpJobs();

  const float clear[4] = {0.0f, 0.0f, 0.0f, 1.0f};
  context_->OMSetRenderTargets(1, &rtv_, dsv_);
  context_->ClearRenderTargetView(rtv_, clear);
  context_->ClearDepthStencilView(dsv_, D3D11_CLEAR_DEPTH | D3D11_CLEAR_STENCIL, 1.0f, 0);
  context_->OMSetDepthStencilState(depthState_, 0);

  D3D11_VIEWPORT viewport{};
  viewport.Width = static_cast<float>(width_);
  viewport.Height = static_cast<float>(height_);
  viewport.MaxDepth = 1.0f;
  context_->RSSetViewports(1, &viewport);

  auto* renderer = (model_ && model_->loaded()) ? model_->GetRenderer<Csm::Rendering::CubismRenderer_D3D11>() : nullptr;
  if (renderer) renderer->StartFrame(context_);
  if (model_) {
    model_->Update(deltaSeconds());
    model_->Draw(width_, height_);
  }
  if (renderer) renderer->EndFrame();

  swapChain_->Present(1, 0);
}

nlohmann::json App::handleRpc(const std::string& method, const nlohmann::json& params) {
  if (method == "system.ping") {
    return {{"ok", true}, {"role", "cpp-executor"}};
  }
  if (method == "system.status") {
    return {
        {"ok", true},
        {"role", "cpp-executor"},
        {"ipcPort", config_.ipcPort},
        {"window", {{"width", width_}, {"height", height_}}},
        {"live2d", model_ ? model_->Status() : nlohmann::json{{"loaded", false}}},
    };
  }
  if (method == "system.shutdown") {
    requestQuit();
    return {{"ok", true}};
  }
  if (method == "live2d.status" || method == "live2d.list") {
    return model_ ? model_->Status() : nlohmann::json{{"loaded", false}};
  }
  if (method == "live2d.load") {
    const std::string path = params.value("path", config_.modelPath);
    auto done = std::make_shared<std::promise<nlohmann::json>>();
    auto future = done->get_future();
    enqueue([this, path, done]() {
      model_ = std::make_unique<Live2DModel>();
      const bool ok = model_->Load(path, device_, width_, height_);
      done->set_value({{"ok", ok}, {"live2d", model_->Status()}});
    });
    return future.get();
  }
  if (method == "live2d.expression") {
    const std::string name = params.value("name", "");
    auto done = std::make_shared<std::promise<nlohmann::json>>();
    auto future = done->get_future();
    enqueue([this, name, done]() {
      done->set_value({{"ok", model_ && model_->SetExpression(name)}, {"name", name}});
    });
    return future.get();
  }
  if (method == "live2d.resetExpression") {
    auto done = std::make_shared<std::promise<nlohmann::json>>();
    auto future = done->get_future();
    enqueue([this, done]() {
      done->set_value({{"ok", model_ && model_->ResetExpression()}});
    });
    return future.get();
  }
  if (method == "live2d.motion") {
    const std::string group = params.value("group", "Idle");
    const int index = params.value("index", 0);
    auto done = std::make_shared<std::promise<nlohmann::json>>();
    auto future = done->get_future();
    enqueue([this, group, index, done]() {
      done->set_value({{"ok", model_ && model_->StartMotion(group, index)}, {"group", group}, {"index", index}});
    });
    return future.get();
  }
  if (method == "live2d.transform") {
    const float scale = params.value("scale", 1.0f);
    const float x = params.value("x", 0.0f);
    const float y = params.value("y", 0.0f);
    auto done = std::make_shared<std::promise<nlohmann::json>>();
    auto future = done->get_future();
    enqueue([this, scale, x, y, done]() {
      if (model_) model_->SetTransform(scale, x, y);
      done->set_value({{"ok", static_cast<bool>(model_)}, {"scale", scale}, {"x", x}, {"y", y}});
    });
    return future.get();
  }
  if (method == "player.play") {
    if (!player_) return {{"ok", false}, {"error", "player not ready"}};
    return player_->Play(params);
  }
  if (method == "player.stop") {
    if (!player_) return {{"ok", true}};
    return player_->Stop(params);
  }
  if (method == "player.pause") {
    if (!player_) return {{"ok", false}, {"error", "player not ready"}};
    return player_->Pause(params);
  }
  if (method == "player.resume") {
    if (!player_) return {{"ok", false}, {"error", "player not ready"}};
    return player_->Resume(params);
  }
  if (method == "player.volume") {
    if (!player_) return {{"ok", false}, {"error", "player not ready"}};
    return player_->SetVolume(params);
  }
  if (method == "player.status" || method == "audio.status") {
    if (!player_) return {{"ok", true}, {"playing", false}};
    return player_->Status();
  }
  if (method == "player.devices" || method == "audio.devices") {
    if (!player_) return {{"ok", false}, {"error", "player not ready"}, {"devices", nlohmann::json::array()}};
    return player_->Devices();
  }
  throw std::runtime_error("method not found: " + method);
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
    case WM_DESTROY:
      if (app) app->quit_ = true;
      PostQuitMessage(0);
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
  LogLine("[app] loadDefaultModel");
  loadDefaultModel();
  LogLine("[app] ipc.start");
  player_ = std::make_unique<AudioPlayer>(*this);
  ipc_.start(config_.ipcPort);
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

  ipc_.stop();
  stopCubism();
  releaseDevice();
  if (hwnd_) DestroyWindow(hwnd_);
  LogLine("[app] exit");
  return 0;
}

}  // namespace vtuber

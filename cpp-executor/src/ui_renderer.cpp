#include "ui_renderer.h"

#include "platform.h"

#include <d3dcompiler.h>
#include <dxgi.h>
#include <cmath>
#include <cstdint>

#pragma comment(lib, "d2d1.lib")
#pragma comment(lib, "dwrite.lib")
#pragma comment(lib, "d3dcompiler.lib")

namespace vtuber {

namespace {

// 顶点：像素坐标（UI 层），颜色直通 RGBA，UV
struct UiVertex {
  float x, y;
  float r, g, b, a;
  float u, v;
};

constexpr char kVs[] = R"(
struct VSIn { float2 pos : POSITION; float4 color : COLOR0; float2 uv : TEXCOORD0; };
struct PSIn { float4 pos : SV_POSITION; float4 color : COLOR0; float2 uv : TEXCOORD0; };
PSIn vsMain(VSIn i) {
  PSIn o;
  o.pos = float4(i.pos.x * 2.0 - 1.0, 1.0 - i.pos.y * 2.0, 0.0, 1.0);
  o.color = i.color;
  o.uv = i.uv;
  return o;
}
)";

constexpr char kPsSolid[] = R"(
struct PSIn { float4 pos : SV_POSITION; float4 color : COLOR0; float2 uv : TEXCOORD0; };
float4 psMain(PSIn i) : SV_Target { return i.color; }
)";

constexpr char kPsTexture[] = R"(
struct PSIn { float4 pos : SV_POSITION; float4 color : COLOR0; float2 uv : TEXCOORD0; };
Texture2D tex : register(t0);
SamplerState sam : register(s0);
// 内容为预乘（D2D 输出 / 预乘纹理）：整体透明度直接缩放
float4 psMain(PSIn i) : SV_Target { return tex.Sample(sam, i.uv) * i.color.a; }
)";

bool CompilePs(const char* src, ID3D11Device* device, ID3D11PixelShader** out) {
  ID3DBlob* blob = nullptr;
  ID3DBlob* err = nullptr;
  const HRESULT hr = D3DCompile(src, strlen(src), nullptr, nullptr, nullptr, "psMain", "ps_4_0",
                                D3DCOMPILE_ENABLE_STRICTNESS, 0, &blob, &err);
  if (FAILED(hr)) {
    if (err) {
      LogLine(std::string("[ui] ps compile: ") + static_cast<const char*>(err->GetBufferPointer()));
      err->Release();
    }
    return false;
  }
  const bool ok = SUCCEEDED(device->CreatePixelShader(blob->GetBufferPointer(), blob->GetBufferSize(), nullptr, out));
  blob->Release();
  return ok;
}

}  // namespace

size_t UiRenderer::TextKeyHash::operator()(const TextKey& k) const {
  size_t h = std::hash<std::wstring>()(k.text);
  h = h * 1000003u + static_cast<size_t>(k.size * 16.0f);
  h = h * 31u + (k.mono ? 2u : 0u) + (k.bold ? 1u : 0u);
  h = h * 131u + static_cast<size_t>(k.r * 255.0f) * 7u + static_cast<size_t>(k.g * 255.0f) * 13u +
      static_cast<size_t>(k.b * 255.0f) * 17u + static_cast<size_t>(k.a * 255.0f) * 19u;
  return h;
}

bool UiRenderer::Init(ID3D11Device* device, ID3D11DeviceContext* context) {
  device_ = device;
  context_ = context;

  ID3DBlob* vsBlob = nullptr;
  ID3DBlob* err = nullptr;
  if (FAILED(D3DCompile(kVs, strlen(kVs), nullptr, nullptr, nullptr, "vsMain", "vs_4_0",
                        D3DCOMPILE_ENABLE_STRICTNESS, 0, &vsBlob, &err))) {
    if (err) {
      LogLine(std::string("[ui] vs compile: ") + static_cast<const char*>(err->GetBufferPointer()));
      err->Release();
    }
    return false;
  }
  if (FAILED(device_->CreateVertexShader(vsBlob->GetBufferPointer(), vsBlob->GetBufferSize(), nullptr, &vs_))) {
    vsBlob->Release();
    return false;
  }

  const D3D11_INPUT_ELEMENT_DESC elems[] = {
      {"POSITION", 0, DXGI_FORMAT_R32G32_FLOAT, 0, offsetof(UiVertex, x), D3D11_INPUT_PER_VERTEX_DATA, 0},
      {"COLOR", 0, DXGI_FORMAT_R32G32B32A32_FLOAT, 0, offsetof(UiVertex, r), D3D11_INPUT_PER_VERTEX_DATA, 0},
      {"TEXCOORD", 0, DXGI_FORMAT_R32G32_FLOAT, 0, offsetof(UiVertex, u), D3D11_INPUT_PER_VERTEX_DATA, 0},
  };
  const bool layoutOk = SUCCEEDED(device_->CreateInputLayout(elems, 3, vsBlob->GetBufferPointer(),
                                                             vsBlob->GetBufferSize(), &layout_));
  vsBlob->Release();
  if (!layoutOk) return false;

  if (!CompilePs(kPsSolid, device_, &psSolid_)) return false;
  if (!CompilePs(kPsTexture, device_, &psTexture_)) return false;

  D3D11_BUFFER_DESC bd{};
  bd.Usage = D3D11_USAGE_DYNAMIC;
  bd.ByteWidth = sizeof(UiVertex) * 4;  // 单 quad 逐次绘制（UI 每帧几十个，足够）
  bd.BindFlags = D3D11_BIND_VERTEX_BUFFER;
  bd.CPUAccessFlags = D3D11_CPU_ACCESS_WRITE;
  if (FAILED(device_->CreateBuffer(&bd, nullptr, &vb_))) return false;

  D3D11_BLEND_DESC blend{};
  blend.RenderTarget[0].BlendEnable = TRUE;
  // 预乘直通：源颜色已预乘一阶参与，目标按源 alpha 剔除
  blend.RenderTarget[0].SrcBlend = D3D11_BLEND_ONE;
  blend.RenderTarget[0].DestBlend = D3D11_BLEND_INV_SRC_ALPHA;
  blend.RenderTarget[0].BlendOp = D3D11_BLEND_OP_ADD;
  blend.RenderTarget[0].SrcBlendAlpha = D3D11_BLEND_ONE;
  blend.RenderTarget[0].DestBlendAlpha = D3D11_BLEND_INV_SRC_ALPHA;
  blend.RenderTarget[0].BlendOpAlpha = D3D11_BLEND_OP_ADD;
  blend.RenderTarget[0].RenderTargetWriteMask = D3D11_COLOR_WRITE_ENABLE_ALL;
  if (FAILED(device_->CreateBlendState(&blend, &blend_))) return false;

  // UI 专属光栅化/深度状态：BindPipeline 每次整体重置。
  // Cubism EndFrame / D2D 文字烘焙可能遗留 Back 剔除、开启的深度测试或裁剪矩形，
  // 任何一种都会让本层四边形整体不可见（曾导致"面板呼出但看不见"）
  D3D11_RASTERIZER_DESC rd{};
  rd.FillMode = D3D11_FILL_SOLID;
  rd.CullMode = D3D11_CULL_NONE;
  rd.ScissorEnable = FALSE;
  rd.DepthClipEnable = TRUE;
  if (FAILED(device_->CreateRasterizerState(&rd, &rasterState_))) return false;

  D3D11_DEPTH_STENCIL_DESC dd{};
  dd.DepthEnable = FALSE;
  dd.StencilEnable = FALSE;
  if (FAILED(device_->CreateDepthStencilState(&dd, &depthState_))) return false;

  D3D11_SAMPLER_DESC sd{};
  sd.Filter = D3D11_FILTER_MIN_MAG_MIP_LINEAR;
  sd.AddressU = sd.AddressV = sd.AddressW = D3D11_TEXTURE_ADDRESS_CLAMP;
  if (FAILED(device_->CreateSamplerState(&sd, &sampler_))) return false;

  // D2D / DirectWrite：与 D3D11 同设备（wrap DXGI device），文字渲染到离屏纹理
  IDXGIDevice* dxgiDevice = nullptr;
  if (FAILED(device_->QueryInterface(IID_PPV_ARGS(&dxgiDevice)))) return false;
  const HRESULT hr = D2D1CreateDevice(
      dxgiDevice,
      D2D1::CreationProperties(D2D1_THREADING_MODE_SINGLE_THREADED, D2D1_DEBUG_LEVEL_NONE,
                               D2D1_DEVICE_CONTEXT_OPTIONS_NONE),
      &d2dDevice_);
  dxgiDevice->Release();
  if (FAILED(hr)) {
    LogLine("[ui] D2D1CreateDevice failed");
    return false;
  }
  if (FAILED(d2dDevice_->CreateDeviceContext(D2D1_DEVICE_CONTEXT_OPTIONS_NONE, &d2dContext_))) return false;
  if (FAILED(DWriteCreateFactory(DWRITE_FACTORY_TYPE_SHARED, __uuidof(IDWriteFactory),
                                 reinterpret_cast<IUnknown**>(&dwFactory_)))) {
    LogLine("[ui] DWriteCreateFactory failed");
    return false;
  }
  LogLine("[ui] renderer ready (quad + DirectWrite)");
  return true;
}

void UiRenderer::BindPipeline() {
  // D2D 与 D3D 共享立即上下文：文字烘焙会破坏全部绑定，此处整体恢复 UI 管线。
  // 光栅化/深度状态必须一并重置——继承外部遗留状态是 UI 层隐形的根源。
  // GS/HS/DS/CS 与谓词同理:D2D 内部管线若在共享上下文留下几何着色器或谓词,
  // 后续 Draw 会被无声吞掉(顶点经不兼容 GS 输出 0 顶点/谓词为假),且不产生任何错误
  ID3D11GeometryShader* nullGs = nullptr;
  ID3D11HullShader* nullHs = nullptr;
  ID3D11DomainShader* nullDs = nullptr;
  ID3D11ComputeShader* nullCs = nullptr;
  context_->GSSetShader(nullGs, nullptr, 0);
  context_->HSSetShader(nullHs, nullptr, 0);
  context_->DSSetShader(nullDs, nullptr, 0);
  context_->CSSetShader(nullCs, nullptr, 0);
  context_->SetPredication(nullptr, FALSE);
  context_->OMSetRenderTargets(1, &rtv_, nullptr);
  context_->RSSetState(rasterState_);
  context_->OMSetDepthStencilState(depthState_, 0);
  D3D11_VIEWPORT vp{};
  vp.Width = static_cast<float>(width_);
  vp.Height = static_cast<float>(height_);
  vp.MaxDepth = 1.0f;
  context_->RSSetViewports(1, &vp);
  UINT stride = sizeof(float) * 8;
  UINT offset = 0;
  context_->IASetInputLayout(layout_);
  context_->IASetVertexBuffers(0, 1, &vb_, &stride, &offset);
  context_->IASetPrimitiveTopology(D3D11_PRIMITIVE_TOPOLOGY_TRIANGLESTRIP);
  context_->VSSetShader(vs_, nullptr, 0);
  context_->PSSetSamplers(0, 1, &sampler_);
  context_->OMSetBlendState(blend_, nullptr, 0xffffffff);
}

void UiRenderer::Begin(int width, int height) {
  width_ = width;
  height_ = height;
  // 捕获当前 RTV 供文字烘焙后恢复
  ID3D11RenderTargetView* rtv = nullptr;
  context_->OMGetRenderTargets(1, &rtv, nullptr);
  lastBeginHadRtv = rtv != nullptr;
  if (rtv) {
    if (rtv_) rtv_->Release();
    rtv_ = rtv;
  } else if (rtv_ == nullptr) {
    // 调用方在 Begin 前未绑定任何渲染目标：UI 将画到虚空（仅告警一次）
    static bool warned = false;
    if (!warned) {
      warned = true;
      LogLine("[ui] Begin(): no render target bound, UI pass discarded");
    }
  }
  BindPipeline();
}

void UiRenderer::End() {
  ID3D11ShaderResourceView* nullSrv = nullptr;
  context_->PSSetShaderResources(0, 1, &nullSrv);
  if (rtv_) {
    rtv_->Release();
    rtv_ = nullptr;
  }
}

void UiRenderer::DrawQuad(float x, float y, float w, float h, float r, float g, float b, float a,
                          bool textured) {
  if (!vb_) return;
  // 直通颜色 → 预乘
  const float pr = r * a, pg = g * a, pb = b * a;
  const UiVertex verts[4] = {
      {x, y, pr, pg, pb, a, 0.0f, 0.0f},
      {x + w, y, pr, pg, pb, a, 1.0f, 0.0f},
      {x, y + h, pr, pg, pb, a, 0.0f, 1.0f},
      {x + w, y + h, pr, pg, pb, a, 1.0f, 1.0f},
  };
  D3D11_MAPPED_SUBRESOURCE mapped{};
  if (FAILED(context_->Map(vb_, 0, D3D11_MAP_WRITE_DISCARD, 0, &mapped))) return;
  memcpy(mapped.pData, verts, sizeof(verts));
  context_->Unmap(vb_, 0);
  if (textured) {
    context_->PSSetShader(psTexture_, nullptr, 0);
  } else {
    context_->PSSetShader(psSolid_, nullptr, 0);
  }
  context_->Draw(4, 0);
  quadCount++;
}

void UiRenderer::Rect(float x, float y, float w, float h, float r, float g, float b, float a) {
  DrawQuad(x, y, w, h, r, g, b, a, false);
}

void UiRenderer::FrameRect(float x, float y, float w, float h, float r, float g, float b, float a,
                           float thick) {
  Rect(x, y, w, thick, r, g, b, a);                       // top
  Rect(x, y + h - thick, w, thick, r, g, b, a);           // bottom
  Rect(x, y + thick, thick, h - thick * 2, r, g, b, a);   // left
  Rect(x + w - thick, y + thick, thick, h - thick * 2, r, g, b, a);  // right
}

void UiRenderer::TextureRect(float x, float y, float w, float h, ID3D11ShaderResourceView* srv,
                             float alpha) {
  if (!srv) return;
  context_->PSSetShaderResources(0, 1, &srv);
  DrawQuad(x, y, w, h, 1, 1, 1, alpha, true);
  ID3D11ShaderResourceView* nullSrv = nullptr;
  context_->PSSetShaderResources(0, 1, &nullSrv);
}

IDWriteTextFormat* UiRenderer::GetFormat(float size, bool mono, bool bold) {
  const uint64_t key = (static_cast<uint64_t>(size * 4.0f) << 2) | (mono ? 2u : 0u) | (bold ? 1u : 0u);
  auto it = formats_.find(key);
  if (it != formats_.end()) return it->second;
  IDWriteTextFormat* fmt = nullptr;
  const wchar_t* family = mono ? L"Consolas" : L"Segoe UI";
  if (FAILED(dwFactory_->CreateTextFormat(
          family, nullptr, bold ? DWRITE_FONT_WEIGHT_SEMI_BOLD : DWRITE_FONT_WEIGHT_NORMAL,
          DWRITE_FONT_STYLE_NORMAL, DWRITE_FONT_STRETCH_NORMAL, size, L"zh-CN", &fmt))) {
    return nullptr;
  }
  formats_.emplace(key, fmt);
  return fmt;
}

float UiRenderer::MeasureText(const std::wstring& text, float size, bool mono, bool bold) {
  IDWriteTextFormat* fmt = GetFormat(size, mono, bold);
  if (!fmt || text.empty()) return 0.0f;
  IDWriteTextLayout* layout = nullptr;
  if (FAILED(dwFactory_->CreateTextLayout(text.c_str(), static_cast<UINT32>(text.size()), fmt,
                                          1e6f, size * 2.0f, &layout))) {
    return size * static_cast<float>(text.size()) * 0.6f;
  }
  DWRITE_TEXT_METRICS m{};
  layout->GetMetrics(&m);
  layout->Release();
  return m.width;
}

bool UiRenderer::RenderTextTexture(const TextKey& key, const std::wstring& text, float size,
                                   bool mono, bool bold, float r, float g, float b, float a,
                                   TextEntry* out) {
  IDWriteTextFormat* fmt = GetFormat(size, mono, bold);
  if (!fmt) return false;
  IDWriteTextLayout* layout = nullptr;
  if (FAILED(dwFactory_->CreateTextLayout(text.c_str(), static_cast<UINT32>(text.size()), fmt,
                                          1e6f, size * 2.5f, &layout))) {
    return false;
  }
  DWRITE_TEXT_METRICS m{};
  layout->GetMetrics(&m);
  const UINT w = static_cast<UINT>(m.width) + 6;
  const UINT h = static_cast<UINT>(m.height) + 4;
  layout->Release();
  if (w <= 0 || h <= 0 || w > 4096) return false;

  D3D11_TEXTURE2D_DESC td{};
  td.Width = w;
  td.Height = h;
  td.MipLevels = 1;
  td.ArraySize = 1;
  td.Format = DXGI_FORMAT_B8G8R8A8_UNORM;
  td.SampleDesc.Count = 1;
  td.Usage = D3D11_USAGE_DEFAULT;
  td.BindFlags = D3D11_BIND_SHADER_RESOURCE | D3D11_BIND_RENDER_TARGET;
  ID3D11Texture2D* tex = nullptr;
  if (FAILED(device_->CreateTexture2D(&td, nullptr, &tex))) return false;

  IDXGISurface* surface = nullptr;
  ID2D1Bitmap1* bitmap = nullptr;
  bool ok = SUCCEEDED(tex->QueryInterface(IID_PPV_ARGS(&surface)));
  if (ok) {
    const D2D1_BITMAP_PROPERTIES1 bp = D2D1::BitmapProperties1(
        D2D1_BITMAP_OPTIONS_TARGET,
        D2D1::PixelFormat(DXGI_FORMAT_B8G8R8A8_UNORM, D2D1_ALPHA_MODE_PREMULTIPLIED));
    ok = SUCCEEDED(d2dContext_->CreateBitmapFromDxgiSurface(surface, bp, &bitmap));
  }

  if (ok) {
    d2dContext_->SetTarget(bitmap);
    d2dContext_->BeginDraw();
    d2dContext_->Clear(D2D1::ColorF(0.0f, 0.0f, 0.0f, 0.0f));
    ID2D1SolidColorBrush* brush = nullptr;
    if (SUCCEEDED(d2dContext_->CreateSolidColorBrush(D2D1::ColorF(r, g, b, a), &brush))) {
      // 重新排版一次带 origin 偏移（文字左上留 2px 边距）
      if (SUCCEEDED(dwFactory_->CreateTextLayout(text.c_str(), static_cast<UINT32>(text.size()),
                                                 fmt, 1e6f, static_cast<FLOAT>(h), &layout))) {
        d2dContext_->DrawTextLayout(D2D1::Point2F(2.0f, 1.0f), layout, brush);
        layout->Release();
      }
      brush->Release();
    }
    d2dContext_->EndDraw();
    d2dContext_->Flush();
    d2dContext_->SetTarget(nullptr);
  }

  if (surface) surface->Release();
  if (bitmap) bitmap->Release();

  ID3D11ShaderResourceView* srv = nullptr;
  if (ok) ok = SUCCEEDED(device_->CreateShaderResourceView(tex, nullptr, &srv));
  tex->Release();
  if (!ok) return false;

  out->srv = srv;
  out->width = static_cast<float>(w);
  out->height = static_cast<float>(h);
  // D2D 已把绑定状态打乱，恢复 UI 管线
  BindPipeline();
  return true;
}

float UiRenderer::Text(const std::wstring& text, float x, float y, float size, float r, float g,
                       float b, float a, bool mono, bool bold) {
  if (text.empty()) return 0.0f;
  const TextKey key{text, size, mono, bold, r, g, b, a};
  ++tick_;
  auto it = textCache_.find(key);
  if (it == textCache_.end()) {
    // 容量控制：超过 256 条按 lastUsed 淘汰
    if (textCache_.size() > 256) {
      auto oldest = textCache_.begin();
      for (auto itr = textCache_.begin(); itr != textCache_.end(); ++itr) {
        if (itr->second.lastUsed < oldest->second.lastUsed) oldest = itr;
      }
      if (oldest->second.srv) oldest->second.srv->Release();
      textCache_.erase(oldest);
    }
    TextEntry entry;
    if (!RenderTextTexture(key, text, size, mono, bold, r, g, b, a, &entry)) {
      return MeasureText(text, size, mono, bold);
    }
    it = textCache_.emplace(key, entry).first;
  }
  it->second.lastUsed = tick_;
  const TextEntry& e = it->second;
  TextureRect(x, y, e.width, e.height, e.srv, 1.0f);
  return e.width;
}

void UiRenderer::ClearTextCache() {
  for (auto& [key, entry] : textCache_) {
    if (entry.srv) entry.srv->Release();
  }
  textCache_.clear();
}

}  // namespace vtuber

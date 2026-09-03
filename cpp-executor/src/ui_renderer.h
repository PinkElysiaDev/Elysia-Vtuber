#pragma once

// 窗口内 UI 渲染：面板 / FPS 角标 / 背景图共用的 quad 管线 + DirectWrite 文字。
// 坐标一律为窗口客户区像素（左上原点），内部换算 NDC。

#include <d3d11.h>
#include <dwrite.h>
#include <d2d1.h>
#include <d2d1_1.h>  // ID2D1Device / ID2D1DeviceContext / D2D1CreateDevice
#include <string>
#include <unordered_map>

namespace vtuber {

class UiRenderer {
 public:
  bool Init(ID3D11Device* device, ID3D11DeviceContext* context);
  /** UI 绘制帧开始：绑定 UI 管线状态（视口由调用方已设） */
  void Begin(int width, int height);
  void End();

  /** 实心矩形（预乘直通混合；颜色为直通 RGBA，内部预乘） */
  void Rect(float x, float y, float w, float h, float r, float g, float b, float a);
  /** 1px 边框 */
  void FrameRect(float x, float y, float w, float h, float r, float g, float b, float a, float thick = 1.0f);
  /** 纹理矩形（预乘内容直通；可选水平翻转无效——仅正矩形） */
  void TextureRect(float x, float y, float w, float h, ID3D11ShaderResourceView* srv, float alpha = 1.0f);

  /**
   * 文字：DirectWrite 渲染到离屏纹理（按 内容+字号+样式 缓存）后按 quad 绘制。
   * 返回文字宽度（像素），供调用方排版。color 为直通 RGBA。
   */
  float Text(const std::wstring& text, float x, float y, float size,
             float r, float g, float b, float a, bool mono = false, bool bold = false);

  /** 估算/精确测量文本宽度（不渲染） */
  float MeasureText(const std::wstring& text, float size, bool mono = false, bool bold = false);

  /** 清空文字纹理缓存（device 重建 / 语言变化时） */
  void ClearTextCache();

 private:
  struct TextKey {
    std::wstring text;
    float size;
    bool mono;
    bool bold;
    float r, g, b, a;
    bool operator==(const TextKey& o) const {
      return text == o.text && size == o.size && mono == o.mono && bold == o.bold &&
             r == o.r && g == o.g && b == o.b && a == o.a;
    }
  };
  struct TextKeyHash {
    size_t operator()(const TextKey& k) const;
  };
  struct TextEntry {
    ID3D11ShaderResourceView* srv = nullptr;
    float width = 0;
    float height = 0;
    uint64_t lastUsed = 0;
  };

  IDWriteTextFormat* GetFormat(float size, bool mono, bool bold);
  bool RenderTextTexture(const TextKey& key, const std::wstring& text, float size,
                         bool mono, bool bold, float r, float g, float b, float a,
                         TextEntry* out);
  /** UI 管线整体绑定（Begin 与文字烘焙后恢复共用） */
  void BindPipeline();
  /** 单 quad 绘制（直通颜色 → 内部预乘） */
  void DrawQuad(float x, float y, float w, float h, float r, float g, float b, float a,
                bool textured);

  ID3D11Device* device_ = nullptr;
  ID3D11DeviceContext* context_ = nullptr;
  ID3D11RenderTargetView* rtv_ = nullptr;
  int width_ = 0;
  int height_ = 0;

  // quad 管线
  ID3D11VertexShader* vs_ = nullptr;
  ID3D11PixelShader* psSolid_ = nullptr;
  ID3D11PixelShader* psTexture_ = nullptr;
  ID3D11InputLayout* layout_ = nullptr;
  ID3D11Buffer* vb_ = nullptr;
  ID3D11BlendState* blend_ = nullptr;
  ID3D11SamplerState* sampler_ = nullptr;
  // UI 专属完整状态：不继承 Cubism/D2D 遗留的剔除/深度/裁剪(会让整个 UI 层隐形)
  ID3D11RasterizerState* rasterState_ = nullptr;
  ID3D11DepthStencilState* depthState_ = nullptr;

 public:
  /** 诊断:累计绘制的 quad 数 / 最近一次 Begin 是否捕获到渲染目标 */
  uint64_t quadCount = 0;
  bool lastBeginHadRtv = false;

  // D2D/DirectWrite（文字离屏渲染）
  ID2D1Device* d2dDevice_ = nullptr;
  ID2D1DeviceContext* d2dContext_ = nullptr;
  IDWriteFactory* dwFactory_ = nullptr;
  std::unordered_map<uint64_t, IDWriteTextFormat*> formats_;

  std::unordered_map<TextKey, TextEntry, TextKeyHash> textCache_;
  uint64_t tick_ = 0;
};

}  // namespace vtuber

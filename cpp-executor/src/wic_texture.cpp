#include "wic_texture.h"

#include "platform.h"

#include <vector>
#include <wincodec.h>
#include <wrl/client.h>

#pragma comment(lib, "windowscodecs.lib")
#pragma comment(lib, "ole32.lib")

using Microsoft::WRL::ComPtr;

namespace vtuber {

bool LoadPngTexture(ID3D11Device* device, const std::string& path, ID3D11ShaderResourceView** outView) {
  if (!device || !outView) return false;
  *outView = nullptr;
  LogLine(std::string("[tex] open ") + path);

  ComPtr<IWICImagingFactory> factory;
  HRESULT hr = CoCreateInstance(CLSID_WICImagingFactory, nullptr, CLSCTX_INPROC_SERVER, IID_PPV_ARGS(&factory));
  if (FAILED(hr) || !factory) {
    LogLine("[tex] CoCreateInstance WIC failed");
    return false;
  }

  const std::wstring wide = Utf8ToWide(path);
  ComPtr<IWICBitmapDecoder> decoder;
  hr = factory->CreateDecoderFromFilename(wide.c_str(), nullptr, GENERIC_READ, WICDecodeMetadataCacheOnDemand, &decoder);
  if (FAILED(hr) || !decoder) {
    LogLine(std::string("[tex] decode failed ") + path);
    return false;
  }

  ComPtr<IWICBitmapFrameDecode> frame;
  hr = decoder->GetFrame(0, &frame);
  if (FAILED(hr) || !frame) return false;

  ComPtr<IWICFormatConverter> converter;
  hr = factory->CreateFormatConverter(&converter);
  if (FAILED(hr) || !converter) return false;

  hr = converter->Initialize(frame.Get(), GUID_WICPixelFormat32bppRGBA, WICBitmapDitherTypeNone, nullptr, 0.0, WICBitmapPaletteTypeCustom);
  if (FAILED(hr)) return false;

  UINT width = 0;
  UINT height = 0;
  converter->GetSize(&width, &height);
  if (width == 0 || height == 0) return false;
  const UINT stride = width * 4;
  const UINT bufferSize = stride * height;
  std::vector<BYTE> pixels(bufferSize);
  hr = converter->CopyPixels(nullptr, stride, bufferSize, pixels.data());
  if (FAILED(hr)) return false;

  D3D11_TEXTURE2D_DESC desc{};
  desc.Width = width;
  desc.Height = height;
  desc.MipLevels = 1;
  desc.ArraySize = 1;
  desc.Format = DXGI_FORMAT_R8G8B8A8_UNORM;
  desc.SampleDesc.Count = 1;
  desc.Usage = D3D11_USAGE_DEFAULT;
  desc.BindFlags = D3D11_BIND_SHADER_RESOURCE;

  D3D11_SUBRESOURCE_DATA init{};
  init.pSysMem = pixels.data();
  init.SysMemPitch = stride;

  ComPtr<ID3D11Texture2D> texture;
  hr = device->CreateTexture2D(&desc, &init, &texture);
  if (FAILED(hr) || !texture) {
    LogLine("[tex] CreateTexture2D failed");
    return false;
  }

  D3D11_SHADER_RESOURCE_VIEW_DESC viewDesc{};
  viewDesc.Format = desc.Format;
  viewDesc.ViewDimension = D3D11_SRV_DIMENSION_TEXTURE2D;
  viewDesc.Texture2D.MipLevels = 1;
  hr = device->CreateShaderResourceView(texture.Get(), &viewDesc, outView);
  if (FAILED(hr) || !*outView) {
    LogLine("[tex] CreateSRV failed");
    return false;
  }
  LogLine(std::string("[tex] ok ") + path);
  return true;
}

}  // namespace vtuber

#pragma once

#include <d3d11.h>
#include <string>

namespace vtuber {

bool LoadPngTexture(
    ID3D11Device* device,
    const std::string& path,
    ID3D11ShaderResourceView** outView);

}  // namespace vtuber

# C++ 执行器

原生窗口渲染 Live2D（Cubism Native + D3D11），并用 Media Foundation 播两路音频：`music` 与 `tts`。

## 依赖

- CMake ≥ 3.20、MSVC、Windows SDK
- 官方 Cubism Native SDK（`CMakeLists.txt` 里的 `CUBISM_SDK_PATH`）
- 仓库内 `.tools/third_party`（nlohmann/json、websocketpp）

## 构建

```bash
cd external/vtuber/cpp-executor
cmake -S . -B build
cmake --build build --config Debug
```

运行 `build/Debug/vtuber_executor.exe`，或由逻辑服务 `cpp.start` 拉起。配置：`config/executor.json`。

```json
{
  "ipcPort": 19276,
  "window": { "title": "Vtuber Live2D", "width": 800, "height": 1000 },
  "modelPath": "Resources/Haru/Haru.model3.json"
}
```

IPC：`ws://127.0.0.1:19276`。方法见 [../API.md](../API.md) 的 C++ 一节。

点歌 `player.play { "channel": "music" }`，语音 `channel: "tts"`。停一路不会打断另一路。

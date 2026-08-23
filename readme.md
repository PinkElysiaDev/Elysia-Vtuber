# koishi-plugin-vtuber

B 站直播 AI VTuber：薄 Koishi 插件 + 独立 Node 逻辑服务 + C++ Live2D/音频执行器。

```
adapter-bililive ──事件──► Koishi 插件 ──WS 19275──► Node 逻辑服务
                                              │
                                              ├── HTTP 19274 WebUI
                                              ├── LLM / 触发器 / TTS / 点歌
                                              └── IPC 19276 ──► C++ 执行器
                                                     Live2D + 点歌/语音双通道
```

## 文档

| 文档 | 用途 |
|------|------|
| [QUICKSTART.md](QUICKSTART.md) | 启动与排障 |
| [API.md](API.md) | RPC / 工具 / 变量 |
| [DEVELOPMENT.md](DEVELOPMENT.md) | 目录与扩展点 |
| [backend/README.md](backend/README.md) | 逻辑服务 |
| [cpp-executor/README.md](cpp-executor/README.md) | C++ 执行器 |

逻辑配置走 `backend/backend-config.json` 和 WebUI，不要把 Key / 身份码 / TTS Token 写进仓库。

## 启动

```bash
# 逻辑服务
cd external/vtuber/backend
npm install
npx tsc
node dist/index.js

# C++ 执行器（Visual Studio BuildTools + Cubism Native SDK）
cd ../cpp-executor
cmake -S . -B build
cmake --build build --config Debug
# 运行 build/Debug/vtuber_executor.exe
```

- WebUI：http://127.0.0.1:19274（控制台与配置面板均在首页）
- 插件默认连 `ws://localhost:19275`

## 端口

| 端口 | 用途 |
|------|------|
| 19274 | WebUI HTTP |
| 19275 | Node JSON-RPC（插件 / WebUI） |
| 19276 | C++ 执行器 IPC |

旧文档里的 8765、9600、19264 已废弃。`cpp-backend/` 是上一版 C++ 后端，不要再编译运行。

## 配置

逻辑服务读 `backend/backend-config.json`。WebUI 按 `config.schema` 渲染，保存走 `config.updatePaths`。

分区：`server` `events` `triggers` `llm` `tts` `output` `music` `live2d` `audio` `cpp`。

- TTS：火山 `openspeech.bytedance.com`，或克隆 `baseURL`。朗读走 C++ `player.play { channel: "tts" }`，与点歌 `channel: "music"` 互不打断。
- 点歌：酷我 / 酷狗 / 咪咕 / B 站视频（WBI 搜索 + playurl + 字幕当歌词）。网易云 / QQ 仍需登录，暂为桩。
- 插件只转发 `adapter-bililive` 事件，并提供 `vtuber.*` / `vtuber.jukebox.*` 命令。

## Koishi 插件

启用 `adapter-bililive` 和 `vtuber`。插件配置只有房间、事件开关、逻辑服务地址，见 [config.example.yml](config.example.yml)。LLM / TTS / 点歌都在逻辑服务里改。

## 发布 Release

在本机（Windows，已配好 Cubism SDK 与 VS 构建环境）执行：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/release.ps1              # 用 package.json 版本
powershell -ExecutionPolicy Bypass -File scripts/release.ps1 -Version 0.3.0
```

脚本会构建三件套（插件 lib/ → tgz、后端 dist/、C++ 双执行器 Release），打包到 `release/` 并生成 RELEASE_NOTES.md；装了 `gh` CLI 会自动打 tag 并创建 GitHub Release（走 7890 代理），没装则打印手动上传指引。产物：`vtuber-executors-win64-<v>.zip`、`vtuber-backend-<v>.zip`、`koishi-plugin-vtuber-<v>.tgz`。

> CI（cpp-backend.yml）只做开源参考实现的编译检查；正式执行器因依赖 Cubism SDK 与 Windows API 走本地发布。


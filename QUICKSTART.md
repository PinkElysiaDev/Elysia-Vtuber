# 快速开始

1. 启动逻辑服务：

```bash
cd external/vtuber/backend
npm install
npx tsc
node dist/index.js
```

2. 打开 http://127.0.0.1:19274/ ，在配置面板填房间 ID、LLM、TTS。
3. （可选）启动 C++ 执行器，或在控制台点「启动执行器」。
4. Koishi 启用 `adapter-bililive` 和 `vtuber`，插件默认连 `ws://localhost:19275`。

端口：WebUI 19274 / RPC 19275 / C++ IPC 19276。

## 控制台

- `/` 控制台：点歌、执行器、TTS 试听、完整配置
- `/jukebox.html` 点歌叠加层
- `/nowplaying.html` 歌曲信息叠加层
- `/display.html` 展示板

## 排障

| 现象 | 先看 |
|------|------|
| WebUI 连不上 | `backend` 是否在跑，端口是否被占用 |
| TTS 不响 | 火山 App ID + Token，且执行器已连接 |
| 点歌不播 | 先 `jukebox.start`，默认音源是酷我 |
| 网易云 / QQ 报错 | 需要登录，当前是桩 |
| Live2D 黑窗 | Cubism SDK 路径、`live2d.modelPath` |
| 插件无事件 | 房间 ID 是否和 `adapter-bililive` 一致 |

不要把 `koishi.yml` 或 `backend-config.json` 里的密钥贴到聊天或仓库。

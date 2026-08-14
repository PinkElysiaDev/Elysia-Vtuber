# Vtuber 逻辑服务

独立 Node 进程：触发器、LLM、TTS、点歌、WebUI。通过本地 IPC 驱动 C++ 执行器。

## 启动

```bash
npm install
npx tsc
node dist/index.js
```

- WebUI http://127.0.0.1:19274
- RPC `ws://127.0.0.1:19275`
- 配置 `backend-config.json`（缺省时按 `defaultConfig()` 生成）

连接后先发 `peer.declare { kind: "webui" | "plugin" }`。方法列表见 [../API.md](../API.md)。

## 冒烟

```bash
node scripts/smoke-phase3.js   # 歌词 / 队列（不连服务）
node scripts/smoke-phase4.js   # WebUI / schema
node scripts/smoke-phase5.js   # TTS / WBI / 入队
```

后两个需要本服务在跑。

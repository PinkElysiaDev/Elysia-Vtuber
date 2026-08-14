# 开发

## 目录

```
external/vtuber/
├── src/                     # Koishi 插件：事件转发 + 拉起 Node
├── backend/src/             # 逻辑服务
│   ├── index.ts             # 装配
│   ├── config.ts / schema.ts
│   ├── modules/             # RPC：system config events jukebox tts cpp live2d tools
│   ├── tts/                 # 火山 / 克隆 + 队列
│   ├── music/               # 点歌机与音源
│   ├── llm/                 # 网关与会话
│   └── cpp/client.ts        # 连执行器
├── backend/renderer/        # WebUI
├── backend/scripts/         # smoke-phase*.js
└── cpp-executor/src/        # Live2D + 双通道音频
```

`backend/src/main.ts`、`window/`、`live2d/` 以及 `cpp-backend/` 是旧实现，不在当前编译路径里。

## 编译

```bash
# 插件
cd external/vtuber && npx tsc

# 逻辑服务
cd backend && npx tsc && node dist/index.js

# 冒烟（服务需在跑）
node scripts/smoke-phase5.js
```

C++ 构建见 [cpp-executor/README.md](cpp-executor/README.md)。Cubism SDK 路径在 `CMakeLists.txt` 的 `CUBISM_SDK_PATH`。

## 加 RPC

在 `backend/src/modules/` 写 handler，于 `index.ts` 的 `registerModules()` 里 `registerAll`。WebUI 用 `rpc.call('method', params)`。

## 加音源

实现 `MediaProvider`，在 `music/registry.ts` 注册。网易云 / QQ 走 `StubProvider`，不要假装能播。

## 加 LLM 工具

`modules/tools.ts` 的 `registerBuiltinTools`。回复出口统一 `send_reply`。

## 提示词变量

`core/variables.ts`。新增名字要同时改默认 `llm.systemPrompt` 和 WebUI 说明。

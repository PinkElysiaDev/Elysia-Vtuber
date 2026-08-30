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
│   ├── mcp/                 # MCP 客户端（stdio + Streamable HTTP）与管理
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

## 接入外部 MCP 服务

无需改代码：标准 MCP 服务器（stdio 命令型或 Streamable HTTP 型）经 WebUI「MCP CLIENT」面板 / RPC `mcp.server.add` / `backend-config.json` 的 `llm.mcpServers` 段接入，工具自动注册为 `mcp__<server>__<tool>`。协议版本协商与 `tools/list_changed` 自动刷新内置于 `src/mcp/`；改传输实现时保持 `McpClient` 接口不变，`manager.ts` 只依赖接口。

HTTP 型接入可在面板用「✨ AI 解析文档」：粘贴文本 / 上传截图 / 给文档 URL，后端 `mcp.config.suggest` 用当前 LLM 配置提取 url/headers 建议（密钥只给 `{{apiKey}}` 占位），预览确认后回填表单。

## LLM 多模型注册表

「LLM MODELS」面板 / `llm.models.*` RPC 维护 `llm.models` 朴素注册表：用户手填端点（协议/BaseURL/Key/模型名）、思考开关、生成参数（温度/最大输出/TopP/超时，留空回退内联默认）与上下文窗口保存即注册；`llm.activeModel` 指定当前使用（注册表为空时首个档案自动激活）。触发器如何消费多模型，待触发器重构时设计。

## request-kit 与 LLM 网关

`external/request-kit`（`@elysia-ai/request-kit`）是通用请求构造包：请求构造层（RequestProfile/模板/build/probe）→ LLM 层（`chatCanonical`，协议转换委托 @elysia-ai 五包、HTTP 经构造层发送，自举）→ 提取层（`extractFromDocs`，字段由消费方声明）。后端 `src/llm/gateway.ts` 是其薄适配（内部类型 ↔ canonical），`src/mcp/suggest.ts` 注入网关 `chatRaw` 做文档提取——改 LLM 协议行为优先改 request-kit，让全生态共享同一份实现。

## 提示词变量

`core/variables.ts`。新增名字要同时改默认 `llm.systemPrompt` 和 WebUI 说明。

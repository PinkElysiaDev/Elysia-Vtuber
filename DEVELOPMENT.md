# 开发

## 目录

```
external/vtuber/
├── src/                     # Koishi 插件：事件转发 + 拉起 Node
├── backend/src/             # 逻辑服务
│   ├── index.ts             # 装配（onEvent 分发链：指令 → 即时规则 → 合并器）
│   ├── config.ts / schema.ts
│   ├── core/                # 行为循环：event-catalog(事件目录) context(清单) batcher(密度合并)
│   │                        #   commands(指令) instant(即时规则) memory(自我记忆) viewers(活跃观众)
│   │                        #   trace(运行日志) + rpc/history/tools/variables/cron/retention
│   ├── modules/             # RPC：system config events jukebox tts cpp live2d tools behavior
│   ├── tts/                 # 火山 / 克隆 + 队列
│   ├── music/               # 点歌机与音源
│   ├── llm/                 # 网关 / 会话 / cognition(统一认知引擎)
│   ├── mcp/                 # MCP 客户端（stdio + Streamable HTTP）与管理
│   └── cpp/client.ts        # 连执行器
├── backend/renderer/        # WebUI
├── backend/scripts/         # smoke-phase*.js
└── cpp-executor/src/        # Live2D + 双通道音频
```

`backend/src/main.ts`、`window/`、`live2d/` 以及 `cpp-backend/` 是旧实现，不在当前编译路径里。

## 行为循环与触发器体系

多数事件交给模型，触发器只做两件事：**过滤上下文**（哪些事件出现在清单里）与**密度合并**（何时攒批唤醒大脑）；特定事件走**直达路径**省 token。旧触发器引擎（immediate/debounce/cross-merge/cron + 动作管线）已整体移除。

```
onEvent → ① 指令系统（弹幕别名命中 → 直接执行能力，不进模型）
          ② 即时应对（事件条件 → 模板直发 / 插队唤醒大脑 / 执行能力；系统事件也可触发）
          ③ 密度合并器 → 统一认知调用
                输入 = 主播视角事件清单(behavior.feed 勾选) + 活跃观众表 + 我最近说过的话
                模型可 send_reply 发言，也可 stay_silent 沉默（理由入运行日志）
```

- **能力注册表** `core/abilities.ts`：预置功能的唯一登记处，**可配置为弹幕指令 ⇔ 可暴露为 LLM 工具**（双向对齐，id 沿用原工具名）。send_reply/stay_silent 为元工具；MCP 外部工具仅扩展工具层。新增功能先登记能力。
- **指令匹配**（Koishi 风格）：无参能力=别名整条匹配；有参能力=别名开头、尾部为参数；全别名按长度优先（防"点歌"抢"点w歌"）。渠道别名=点歌能力+固定 source+别名。
- **即时应对** `core/instant.ts`：条件矩阵（按事件类型字段化：弹幕关键词/正则+捕获组、礼物金额、SC 金额、上舰等级、点歌成功条件…）+ 动作矩阵（llm/send-text/run-ability）+ 变量矩阵（`{{match.N}}` `{{gift.*}}` `{{sc.*}}` `{{song.*}}`…）。矩阵经 `instant.schema` RPC 下发，前端动态渲染同源。**多同类条件**：文本类字段支持数组（UI 按钮新增、同 key 多值任一命中 OR，不同 key 之间 AND）；正则多条时以命中那条的捕获组为准。触发器/指令面板均为自动保存（change/blur 后 500ms 落盘，无保存按钮）。
- **事件目录** `core/event-catalog.ts`：直播间 11 类 + 系统后台事件的注册表，驱动清单勾选、预览示例与格式化；新增事件先登记目录。
- **双层过滤**：`events.enabledEvents` 决定是否接收进系统；`behavior.feed.include` 决定是否呈现给模型。
- **上下文构成**：user 消息 = 事件清单（纯清单，无附加块）；自我记忆经系统提示词 `{{memory}}` 变量注入（不写进人设则不出现）；`feed.preview` 为纯样式示例预览（接受未保存配置 override，随勾选实时变化，不取真实事件）。
- **WebUI**：「触发器」页四张独立卡片（事件接收 / 事件清单·预览 / 合并策略 / 即时应对，即时应对与指令条目均为 cc-card 可折叠，风格对齐点歌机中台）；「指令」页（单卡 + 每条指令折叠 + sl-row 别名编辑 + 底部能力新增行）；「日志」页（系统日志与首页同口径 + 大脑运行日志双页签，首页实时流可跳转）。
- **可观测**：每次大脑调用落 `llm_trace` 表并广播 `llm.trace`；`trace.list` 回看完整 prompt/回复/决策/沉默理由。
- **迁移**：旧 `music.directOrder/skipCommand` → 指令（别名制）；第一轮的 keyword/match 指令格式与旧即时格式自动迁移；旧 `triggers` 配置读入后忽略；旧 `feed.blocks`/`rulesAppendix` 键清除。
- **记忆**：短期自我记忆经 `{{memory}}` 注入系统提示词；长期记忆接记忆类 MCP 服务器即可。

## 编译

```bash
# 插件
cd external/vtuber && npx tsc

# 逻辑服务
cd backend && npx tsc && node dist/index.js

# 冒烟（服务需在跑）
node scripts/smoke-phase5.js
node scripts/smoke-phase6.js   # 行为循环

# 行为循环 e2e（自带 mock LLM 与隔离端口，不需要真实 Key）
npx ts-node tests/e2e-behavior.ts
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

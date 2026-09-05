# API

连接 `ws://127.0.0.1:19275`，JSON-RPC 2.0。先声明身份：

```json
{ "jsonrpc": "2.0", "method": "peer.declare", "params": { "kind": "plugin" } }
```

`kind` 为 `plugin` 或 `webui`。无 `id` 的消息是通知。

## Node RPC

### 系统 / 配置

| 方法 | 参数 | 说明 |
|------|------|------|
| `system.status` | | 版本、房间、事件数、LLM/TTS/点歌/执行器 |
| `system.info` | | 进程信息 |
| `system.shutdown` | | 延迟退出 |
| `config.get` | | 完整配置 |
| `config.schema` | | WebUI 表单 schema |
| `config.update` | `{ config }` | 顶层合并 |
| `config.updateSection` | `{ section, value }` | 整段替换 |
| `config.updatePath` | `{ path, value }` | 点路径写入 |
| `config.updatePaths` | `{ entries: [{ path, value }] }` | 批量点路径 |
| `config.reload` | | 从磁盘重载 |

### 事件

| 方法 | 参数 |
|------|------|
| `event.ingest` | `{ event }` |
| `event.batch` | `{ events }` |

事件：

```ts
{
  type: 'danmaku' | 'gift' | 'superchat' | 'enter' | 'follow' | 'like' | 'guard' | 'liveStart' | 'liveEnd'
  timestamp: number
  roomId: string
  user?: { uid: string; name: string; face?: string; fansMedal?: { name: string; level: number }; guardLevel?: number }
  data: Record<string, unknown>
}
```

### 点歌 / TTS / 执行器

| 方法 | 说明 |
|------|------|
| `jukebox.getState` / `start` / `stop` / `restart` | 启停，`restart` 可 `{ preserveQueue }` |
| `jukebox.setVolume` / `adjustVolume` / `mute` / `unmute` | 音量 |
| `jukebox.search` | `{ keyword, source?, page?, size? }` |
| `jukebox.add` | `{ songId?, source?, keyword?, title?, userId?, userName? }` |
| `jukebox.skip` / `getQueue` / `getNowPlaying` / `lyric` / `sources` | 队列与歌词 |
| `jukebox.pause` / `jukebox.resume` | 暂停 / 恢复当前曲 |
| `jukebox.seek` | `{ sec }` 拖动进度（带偏移重放，需新版 audio_executor） |
| `jukebox.previous` | 上一首（从播放记录重播最近一曲） |
| `jukebox.playNow` | `{ songId \| keyword, source?, title? }` 立即播放（插队首并切歌） |
| `jukebox.history.list` | 播放记录（最新在前；开播广播 `jukebox.history`） |
| `tts.speak` | `{ text }` |
| `tts.stop` / `tts.status` | 停朗读 / 队列状态 |
| `audio.devices` | 需 C++ |
| `cpp.status` / `start` / `stop` / `restart` | 执行器进程 |
| `cpp.call` | `{ method, args }` 透传到 C++ |
| `live2d.status` / `list` / `load` / `expression` / `resetExpression` / `motion` / `transform` | Live2D |

### 运行时

| 方法 | 说明 |
|------|------|
| `abilities.list` | 预置能力注册表（弹幕指令与 LLM 工具同源对齐：分组/参数声明/动态选项） |
| `instant.schema` | 即时应对的条件矩阵与变量矩阵（前端动态渲染的单一来源） |
| `behavior.catalog` | 事件目录（直播间 + 系统后台事件，含标签/描述/默认入清单开关/示例） |
| `feed.preview` | `{ include?, maxEvents? }` → 清单**纯样式示例**预览（每个开启类型一条内置示例，不含真实事件；接受未保存配置实时预览，`sample: true` 标记） |
| `prompt.preview` | `{ directive? }` → 完整 Prompt 预演（system + user 全文，不调用模型） |
| `cognition.fire` | `{ directive?, events? }` 手动唤醒大脑；返回 `{ ok, result:{ decision, outputs, ... }, durationMs }` |
| `batcher.pending` | 合并器当前批 `{ count, quietInMs, maxWaitInMs }` |
| `behavior.status` | 行为观测：当前批/触发统计/活跃观众/在线真值/记忆条数/认知队列与计数 |
| `trace.list` | `{ limit?, offset?, source? }` → 运行日志（含两端 prompt、回复、工具调用、决策、耗时） |
| `trace.clear` | 清空运行日志 |
| `llm.chat` | `{ messages }` 或 `{ events, prompt? }` |
| `llm.tools` | 已注册工具 |
| `tool.call` | `{ name, args }` |
| `output.route` | `{ segments }` 或 `{ content }` |
| `output.font.upload` | `{ filename, dataBase64 }`（woff2/woff/ttf/otf）→ 存配置目录 fonts/ 并回填 `output.display.fontFile/fontFamily` |
| `output.font.status` | 当前字体 `{ fontFile, fontFamily }` |
| `output.font.clear` | 删除字体文件并复位 |
| `mcp.servers.list` | 已配置的 MCP 服务器（含 transport/url/状态/工具数） |
| `mcp.server.add` | `{ name, command?, args?, env?, url?, headers? }`，stdio 与 HTTP 二选一 |
| `mcp.server.update` | `{ name, enabled?, command?, url?, args?, env?, headers? }` |
| `mcp.server.remove` | `{ name }` |
| `mcp.refresh` | 按当前配置重连全部 |
| `mcp.config.suggest` | `{ mode:'url'\|'text'\|'images', url?, text?, images? }` → AI 解析文档返回 HTTP 接入建议 `{ok, suggestion:{url, headers, notes}, errors}`；仅建议不写配置，密钥以 `{{apiKey}}` 占位；截图模式需 vision 模型 |
| `llm.models.list` | 多模型注册表 + 当前使用键 |
| `llm.models.upsert` | `{ name, label?, provider, baseURL?, apiKey?, model, headers?, thinking?, temperature?, maxTokens?, topP?, timeoutMs?, contextWindow? }`；注册表为空时首个档案自动激活 |
| `llm.models.remove` | `{ name }` |
| `llm.models.activate` | `{ name }`（空串 = 切回内联配置） |

## 通知

Node → 插件：`danmaku.send` `{ roomId, text }`。插件回 `danmaku.sent`。

Node → WebUI：`jukebox.history` `event.received` `output.danmaku` `output.display` `output.tts` `tts.state` `tts.error` `jukebox.state` `jukebox.nowPlaying` `config.changed` `llm.trace`（大脑调用完成摘要：来源/决策/耗时/沉默理由）`ui.log`（后端统一日志：链路失败/跳过/过滤，前端实时流展示）`danmaku.failed`（弹幕发送失败详情）。

C++ → Node：`player.ended` `{ channel }`。

## LLM 工具与能力对齐

预置功能统一登记在能力注册表（`core/abilities.ts`），**可配置为弹幕指令 ⇔ 可暴露为 LLM 工具**（双向对齐）；send_reply / stay_silent 为认知循环元工具，MCP 外部工具在此基础上仅扩展工具层。

| 工具（=能力 id） | 作用 |
|------|------|
| `send_reply` | `segments.method` 只能是 `danmaku` / `display` / `tts` |
| `stay_silent` | 沉默权：`{ reason }` 判断无需回应时显式保持沉默，理由进运行日志 |
| `jukebox_add_song` / `jukebox_search_song` / `jukebox_skip_song` / `jukebox_get_queue` / `jukebox_get_current_song` / `jukebox_restart` | 点歌机（含新增的重启） |
| `live2d_expression` / `live2d_costume` / `live2d_motion` / `live2d_transform` / `live2d_status` / `live2d_reload` | 模型（含新增的重载） |

回复也可用标签：`[TTS]...[/TTS]`、`[DISPLAY]...[/DISPLAY]`，其余当弹幕。

## MCP 外部工具

外部 MCP 服务器的工具自动注册为 `mcp__<server>__<tool>`，出现在 `llm.tools` 与提示词工坊「工具加载管理」中（可用 `llm.tools` 配置按名禁用）。服务器本身无需任何修改，支持两种传输：

- **stdio**：本地命令型（`npx -y @some/mcp-server`），配置 `command` / `args` / `env`。
- **Streamable HTTP**（MCP 2025-03-26 规范）：远程服务，配置 `url` / `headers`（鉴权头）。旧版 HTTP+SSE 传输已废弃，不支持。

配置入口三选一：WebUI「MCP CLIENT」面板、RPC `mcp.server.add`、`backend-config.json` 的 `llm.mcpServers` 段：

```json
{
  "llm": {
    "mcpServers": {
      "weather": { "command": "npx", "args": ["-y", "mcp-weather"], "enabled": true },
      "search": { "url": "http://127.0.0.1:3000/mcp", "headers": { "Authorization": "Bearer xxx" }, "enabled": true }
    }
  }
}
```

协议版本协商支持 `2025-06-18` / `2025-03-26` / `2024-11-05`；服务器发出 `notifications/tools/list_changed` 时自动重拉工具列表重建注册。

LLM 网关（四协议请求/解码）与 AI 文档解析均构建在 `@elysia-ai/request-kit` 之上：该包分层自举（请求构造层 → 基于 @elysia-ai 协议包的 LLM 层 → 文档提取层），源码见 `external/request-kit`。

## 提示词变量与事件变量矩阵

**通用**：`{{roomId}}` `{{now:iso}}` `{{memory}}`（自我记忆：你最近说过的话，防重复感谢/玩梗）；`{{now}}` 支持设置（详细程度/时区/自定义模板 YYYY MM DD HH mm ss）；`{{history}}`（event history）支持设置（事件来源勾选 + 条目数量，`llm.variables.history`）。

**事件信息（最近一条事件）**：`{{user.uid}}` `{{user.name}}` `{{user.fansMedal.name}}` `{{user.fansMedal.level}}` `{{user.guardLevel}}` `{{type}}` `{{content}}` `{{gift.*}}` `{{sc.*}}` `{{song.*}}` 等（与即时应对变量矩阵同源）。

**事件清单（由触发器决定）**：`{{events}}`（本次合并触发的清单块）`{{eventCount}}`。

**后端状态**：`{{state.jukebox.playing}}` `{{state.jukebox.queue}}` `{{state.jukebox.running}}` `{{state.live2d.model}}` `{{state.live2d.connected}}`。

**点路径**：`{{event.user.name}}` / `{{extra.xxx}}` 按路径取字段；指令回执模板额外支持 `{{message}}` `{{ok}}`。

即时应对 send-text 模板变量：弹幕 `{{content}}` `{{match.N}}`（正则捕获组）；礼物/SC/点歌等同上事件信息族；条件/变量矩阵经 `instant.schema` RPC 获取（与前端同源）。变量设置存于 `llm.variables`（PROMPT STUDIO 变量参考 ⚙ 按钮维护）。

## C++ IPC（19276）

| 方法 | 说明 |
|------|------|
| `system.ping` / `system.status` / `system.shutdown` | 进程 |
| `live2d.status` / `list` / `load` / `expression` / `resetExpression` / `motion` / `transform` | 模型 |
| `player.play` | `{ channel: "music" \| "tts", url, title?, volume?, device?, headers? }` |
| `player.stop` / `pause` / `resume` / `volume` / `status` / `devices` | 双通道播放 |

`audio.status` / `audio.devices` 是别名。点歌用 `music`，TTS 用 `tts`。

## HTTP

`GET /api/health` → `{ ok, version, wsPort, httpPort }`。其余路径来自 `backend/renderer/`；`GET /fonts/<file>` 提供上传的展示板自定义字体。

## 插件命令

`vtuber.status` `start` `stop` `restart`  
`vtuber.jukebox status|start|stop|restart|volume|mute|unmute|queue|now|skip`

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
| `tts.speak` | `{ text }` |
| `tts.stop` / `tts.status` | 停朗读 / 队列状态 |
| `audio.devices` | 需 C++ |
| `cpp.status` / `start` / `stop` / `restart` | 执行器进程 |
| `cpp.call` | `{ method, args }` 透传到 C++ |
| `live2d.status` / `list` / `load` / `expression` / `resetExpression` / `motion` / `transform` | Live2D |

### 运行时

| 方法 | 说明 |
|------|------|
| `trigger.list` / `trigger.pending` / `trigger.fire` | 触发器 |
| `llm.chat` | `{ messages }` 或 `{ events, prompt? }` |
| `llm.tools` | 已注册工具 |
| `tool.call` | `{ name, args }` |
| `output.route` | `{ segments }` 或 `{ content }` |

## 通知

Node → 插件：`danmaku.send` `{ roomId, text }`。插件回 `danmaku.sent`。

Node → WebUI：`event.received` `trigger.fired` `output.danmaku` `output.display` `output.tts` `tts.state` `tts.error` `jukebox.state` `jukebox.nowPlaying` `config.changed`。

C++ → Node：`player.ended` `{ channel }`。

## LLM 工具

| 工具 | 作用 |
|------|------|
| `send_reply` | `segments.method` 只能是 `danmaku` / `display` / `tts` |
| `live2d_expression` / `live2d_motion` / `live2d_transform` / `live2d_status` | 模型 |
| `jukebox_search_song` / `jukebox_add_song` / `jukebox_skip_song` / `jukebox_get_queue` / `jukebox_get_current_song` | 点歌 |

回复也可用标签：`[TTS]...[/TTS]`、`[DISPLAY]...[/DISPLAY]`，其余当弹幕。

## 提示词变量

`{{roomId}}` `{{now}}` `{{now:iso}}` `{{events}}` `{{history}}` `{{type}}` `{{user}}` `{{content}}` `{{eventCount}}`，以及 `{{event.user.name}}` 这类点路径。

## C++ IPC（19276）

| 方法 | 说明 |
|------|------|
| `system.ping` / `system.status` / `system.shutdown` | 进程 |
| `live2d.status` / `list` / `load` / `expression` / `resetExpression` / `motion` / `transform` | 模型 |
| `player.play` | `{ channel: "music" \| "tts", url, title?, volume?, device?, headers? }` |
| `player.stop` / `pause` / `resume` / `volume` / `status` / `devices` | 双通道播放 |

`audio.status` / `audio.devices` 是别名。点歌用 `music`，TTS 用 `tts`。

## HTTP

`GET /api/health` → `{ ok, version, wsPort, httpPort }`。其余路径来自 `backend/renderer/`。

## 插件命令

`vtuber.status` `start` `stop` `restart`  
`vtuber.jukebox status|start|stop|restart|volume|mute|unmute|queue|now|skip`

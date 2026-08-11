# API 参考文档

本文档详细说明了 Vtuber 系统的所有 API 接口。

## Koishi 插件 API

### 事件接收器

#### `EventReceiver`

接收并标准化直播间事件。

**方法**

- `start(): void` - 启动事件接收
- `stop(): void` - 停止事件接收
- `on(eventType: string, handler: Function): void` - 订阅事件

**事件类型**

| 事件名 | 数据格式 | 说明 |
|--------|---------|------|
| `danmaku` | `DanmakuEvent` | 弹幕消息 |
| `gift` | `GiftEvent` | 礼物 |
| `superchat` | `SuperChatEvent` | 醒目留言 |
| `enter` | `EnterEvent` | 进入直播间 |
| `follow` | `FollowEvent` | 关注 |
| `like` | `LikeEvent` | 点赞 |
| `guard` | `GuardEvent` | 上舰 |
| `liveStart` | `LiveStartEvent` | 开播 |
| `liveEnd` | `LiveEndEvent` | 下播 |

**标准事件格式**

```typescript
interface StandardEvent {
  type: EventType
  timestamp: number
  roomId: string
  user?: UserInfo
  data: any
}

interface UserInfo {
  uid: string
  name: string
  face?: string
  fansMedal?: FansMedal
  guardLevel?: number
}

interface FansMedal {
  name: string
  level: number
}
```

### 触发器系统

#### `TriggerManager`

管理事件触发逻辑。

**方法**

- `addTrigger(config: TriggerConfig): void` - 添加触发器
- `removeTrigger(id: string): void` - 移除触发器
- `process(event: StandardEvent): Promise<void>` - 处理事件

**触发器配置**

```typescript
// 立即触发
interface ImmediateTrigger {
  mode: 'immediate'
  eventTypes: string[]
}

// 延迟合并触发
interface DebounceTrigger {
  mode: 'debounce'
  eventTypes: string[]
  delay: number
  maxBatch: number
}

// 跨类型合并触发
interface CrossTypeMergeTrigger {
  mode: 'cross-merge'
  primaryEvent: string
  mergeEvents: string[]
  window: number
}

// 定时任务触发
interface ScheduledTrigger {
  mode: 'scheduled'
  cron: string
  actions: TriggerAction[]
}
```

### LLM 管理器

#### `LLMManager`

管理 LLM 请求和响应。

**方法**

```typescript
class LLMManager {
  // 发送请求
  async sendRequest(context: LLMContext): Promise<LLMResponse>
  
  // 注册工具
  registerTools(tools: LLMTool[]): void
  
  // 设置系统提示词
  setSystemPrompt(prompt: string): void
}
```

**LLM 上下文**

```typescript
interface LLMContext {
  events: StandardEvent[]
  variables: Record<string, any>
  tools?: LLMTool[]
}
```

**LLM 响应**

```typescript
interface LLMResponse {
  content: string
  toolCalls?: ToolCall[]
}

interface ToolCall {
  id: string
  name: string
  arguments: Record<string, any>
}
```

**工具定义**

```typescript
interface LLMTool {
  name: string
  description: string
  parameters: {
    type: 'object'
    properties: Record<string, JSONSchemaProperty>
    required?: string[]
  }
  handler: (args: any) => Promise<any>
}
```

### 变量系统

#### 可用变量

| 变量名 | 类型 | 说明 |
|--------|------|------|
| `{{danmaku_history}}` | `string` | 弹幕历史（格式化） |
| `{{gift_history}}` | `string` | 礼物历史（格式化） |
| `{{user_name}}` | `string` | 当前用户名 |
| `{{user_uid}}` | `string` | 当前用户UID |
| `{{room_id}}` | `string` | 直播间ID |
| `{{event_type}}` | `string` | 事件类型 |
| `{{event_data}}` | `string` | 事件数据（JSON） |

#### 自定义变量

```typescript
variableEngine.register('custom_var', (context) => {
  return '自定义值'
})
```

### TTS 管理器

#### `TTSManager`

管理语音合成。

**方法**

```typescript
class TTSManager {
  // 合成语音
  async synthesize(text: string): Promise<Buffer>
  
  // 播放语音
  async play(audio: Buffer): Promise<void>
  
  // 设置语音参数
  setVoiceParams(params: VoiceParams): void
}

interface VoiceParams {
  voiceType: string
  speed: number
  volume: number
  pitch: number
}
```

### 输出处理器

#### `OutputHandler`

处理 LLM 输出。

**方法**

```typescript
class OutputHandler {
  // 处理输出
  async process(content: string): Promise<void>
}
```

**输出格式**

```typescript
// 默认：发送弹幕
"你好，欢迎！"

// TTS 播放
"[TTS]大家好[/TTS]"

// 展示板显示
"[DISPLAY]欢迎新观众[/DISPLAY]"

// 混合输出
"[TTS]感谢礼物[/TTS][DISPLAY]♥谢谢♥[/DISPLAY]真的很感谢！"
```

## 后端 JSON-RPC API

### 窗口管理

#### `window.create`

创建窗口。

**请求**

```json
{
  "jsonrpc": "2.0",
  "method": "window.create",
  "params": {
    "type": "live2d",
    "title": "Live2D",
    "width": 800,
    "height": 600,
    "url": "file://path/to/page.html"
  },
  "id": 1
}
```

**响应**

```json
{
  "jsonrpc": "2.0",
  "result": {
    "windowId": "window_123"
  },
  "id": 1
}
```

#### `window.close`

关闭窗口。

**请求**

```json
{
  "jsonrpc": "2.0",
  "method": "window.close",
  "params": {
    "windowId": "window_123"
  },
  "id": 2
}
```

#### `window.show` / `window.hide`

显示/隐藏窗口。

**请求**

```json
{
  "jsonrpc": "2.0",
  "method": "window.show",
  "params": {
    "windowId": "window_123"
  },
  "id": 3
}
```

### Live2D 控制

#### `live2d.load`

加载模型。

**请求**

```json
{
  "jsonrpc": "2.0",
  "method": "live2d.load",
  "params": {
    "modelPath": "D:/models/live2d/my_model"
  },
  "id": 4
}
```

#### `live2d.setExpression`

设置表情。

**请求**

```json
{
  "jsonrpc": "2.0",
  "method": "live2d.setExpression",
  "params": {
    "expression": "happy"
  },
  "id": 5
}
```

**可用表情**

根据模型定义，通常包括：
- `normal` - 普通
- `happy` - 开心
- `sad` - 悲伤
- `angry` - 生气
- `surprised` - 惊讶
- `shy` - 害羞

#### `live2d.playMotion`

播放动作。

**请求**

```json
{
  "jsonrpc": "2.0",
  "method": "live2d.playMotion",
  "params": {
    "group": "Idle",
    "index": 0
  },
  "id": 6
}
```

**动作组**

常见动作组：
- `Idle` - 待机动作
- `TapBody` - 点击身体
- `TapHead` - 点击头部
- `Shake` - 摇晃

#### `live2d.setScale`

设置缩放。

**请求**

```json
{
  "jsonrpc": "2.0",
  "method": "live2d.setScale",
  "params": {
    "scale": 1.2
  },
  "id": 7
}
```

**参数**

- `scale`: 缩放比例（0.5 - 2.0）

#### `live2d.setPosition`

设置位置。

**请求**

```json
{
  "jsonrpc": "2.0",
  "method": "live2d.setPosition",
  "params": {
    "x": 100,
    "y": 50
  },
  "id": 8
}
```

### 点歌机控制

#### `music.search`

搜索歌曲。

**请求**

```json
{
  "jsonrpc": "2.0",
  "method": "music.search",
  "params": {
    "keyword": "晴天",
    "source": "netease"
  },
  "id": 9
}
```

**响应**

```json
{
  "jsonrpc": "2.0",
  "result": [
    {
      "id": "123456",
      "title": "晴天",
      "artist": "周杰伦",
      "duration": 267,
      "cover": "https://..."
    }
  ],
  "id": 9
}
```

#### `music.add`

添加歌曲到队列。

**请求**

```json
{
  "jsonrpc": "2.0",
  "method": "music.add",
  "params": {
    "songId": "123456",
    "source": "netease"
  },
  "id": 10
}
```

#### `music.play` / `music.pause`

播放/暂停。

**请求**

```json
{
  "jsonrpc": "2.0",
  "method": "music.play",
  "params": {},
  "id": 11
}
```

#### `music.skip`

跳过当前歌曲。

**请求**

```json
{
  "jsonrpc": "2.0",
  "method": "music.skip",
  "params": {},
  "id": 12
}
```

#### `music.getQueue`

获取播放队列。

**请求**

```json
{
  "jsonrpc": "2.0",
  "method": "music.getQueue",
  "params": {},
  "id": 13
}
```

**响应**

```json
{
  "jsonrpc": "2.0",
  "result": {
    "queue": [
      {
        "id": "123456",
        "title": "晴天",
        "artist": "周杰伦",
        "duration": 267,
        "cover": "https://..."
      }
    ]
  },
  "id": 13
}
```

#### `music.getNowPlaying`

获取当前播放。

**请求**

```json
{
  "jsonrpc": "2.0",
  "method": "music.getNowPlaying",
  "params": {},
  "id": 14
}
```

**响应**

```json
{
  "jsonrpc": "2.0",
  "result": {
    "song": {
      "id": "123456",
      "title": "晴天",
      "artist": "周杰伦",
      "duration": 267,
      "cover": "https://..."
    },
    "position": 45,
    "playing": true
  },
  "id": 14
}
```

### 展示板控制

#### `display.show`

显示文本。

**请求**

```json
{
  "jsonrpc": "2.0",
  "method": "display.show",
  "params": {
    "text": "欢迎来到直播间！",
    "style": "normal",
    "emotion": "happy"
  },
  "id": 15
}
```

**样式**

- `normal` - 普通
- `large` - 大字
- `emphasis` - 强调
- `celebration` - 庆祝

**情感**

- `neutral` - 中性
- `happy` - 开心
- `excited` - 兴奋
- `grateful` - 感激

### TTS 播放

#### `tts.play`

播放 TTS 音频。

**请求**

```json
{
  "jsonrpc": "2.0",
  "method": "tts.play",
  "params": {
    "audio": "base64_encoded_audio_data",
    "duration": 3000
  },
  "id": 16
}
```

## LLM 工具 API

以下工具可在 LLM 的 tool calling 中使用。

### Live2D 工具

#### `live2d_set_expression`

设置 Live2D 表情。

**参数**

```json
{
  "expression": "happy"
}
```

#### `live2d_play_motion`

播放 Live2D 动作。

**参数**

```json
{
  "group": "Idle",
  "index": 0
}
```

#### `live2d_set_position`

设置 Live2D 位置。

**参数**

```json
{
  "x": 100,
  "y": 50
}
```

#### `live2d_set_scale`

设置 Live2D 缩放。

**参数**

```json
{
  "scale": 1.2
}
```

### 点歌机工具

#### `music_search`

搜索歌曲。

**参数**

```json
{
  "keyword": "晴天",
  "source": "netease"
}
```

**返回**

```json
{
  "results": [
    {
      "id": "123456",
      "title": "晴天",
      "artist": "周杰伦"
    }
  ]
}
```

#### `music_add_song`

添加歌曲。

**参数**

```json
{
  "songId": "123456",
  "source": "netease"
}
```

#### `music_skip`

切换下一首。

**参数**

```json
{}
```

#### `music_get_queue`

获取播放队列。

**参数**

```json
{}
```

**返回**

```json
{
  "queue": [...]
}
```

#### `music_get_current`

获取当前播放。

**参数**

```json
{}
```

**返回**

```json
{
  "song": {...},
  "position": 45,
  "playing": true
}
```

### 展示板工具

#### `display_show_text`

在展示板显示文本。

**参数**

```json
{
  "text": "欢迎新观众！",
  "duration": 5000,
  "style": "normal"
}
```

## WebSocket 通知

后端会通过 WebSocket 主动发送通知。

### `display.update`

展示板内容更新。

```json
{
  "jsonrpc": "2.0",
  "method": "display.update",
  "params": {
    "text": "欢迎！",
    "style": "normal",
    "emotion": "happy"
  }
}
```

### `tts.audio`

TTS 音频数据。

```json
{
  "jsonrpc": "2.0",
  "method": "tts.audio",
  "params": {
    "audio": "base64_data",
    "duration": 3000
  }
}
```

## 错误代码

### JSON-RPC 错误

| 代码 | 消息 | 说明 |
|------|------|------|
| -32700 | Parse error | JSON 解析错误 |
| -32600 | Invalid Request | 无效的请求 |
| -32601 | Method not found | 方法不存在 |
| -32602 | Invalid params | 无效的参数 |
| -32603 | Internal error | 内部错误 |

### 应用错误

| 代码 | 消息 | 说明 |
|------|------|------|
| 1001 | Window not found | 窗口不存在 |
| 1002 | Model not loaded | 模型未加载 |
| 1003 | Song not found | 歌曲不存在 |
| 1004 | Queue empty | 队列为空 |
| 1005 | Invalid source | 无效的音源 |

**错误响应示例**

```json
{
  "jsonrpc": "2.0",
  "error": {
    "code": 1001,
    "message": "Window not found",
    "data": {
      "windowId": "window_123"
    }
  },
  "id": 1
}
```

## 类型定义

完整的 TypeScript 类型定义可在以下文件中找到：

- Koishi 插件：`src/types.ts`
- 后端：`backend/src/types.ts`
- JSON-RPC：`backend/src/jsonrpc/types.ts`

# Koishi Vtuber 项目顶层设计文档

## 1. 项目概述

### 1.1 项目目标
基于 Koishi 框架开发一款 AI 虚拟主播系统，支持 Bilibili 直播间交互，提供智能对话、Live2D 展示、点歌系统等完整功能。

### 1.2 核心特性
- **直播间事件接收**：弹幕、礼物、进入/退出、点赞、关注、开播/下播等
- **智能事件处理**：触发器系统、延迟合并、定时任务、LLM 请求
- **多模型支持**：OpenAI、Anthropic、Gemini、国内模型网关
- **TTS 语音合成**：火山方舟 TTS、声音克隆
- **Live2D 展示**：模型加载、表情控制、动作控制
- **点歌系统**：多音源支持、队列管理、歌词展示
- **多种输出方式**：直播间弹幕、展示板窗口、语音播放

### 1.3 系统架构

```
┌─────────────────────────────────────────────────────────────────┐
│                        展示层 (独立后端)                          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │ Live2D窗口   │  │  展示板窗口  │  │  点歌机窗口  │          │
│  │ - 模型渲染   │  │  - 文本渲染  │  │  - 播放控制  │          │
│  │ - 表情动作   │  │  - HTML渲染  │  │  - 歌词显示  │          │
│  └──────────────┘  └──────────────┘  └──────────────┘          │
└───────────────────────────┬─────────────────────────────────────┘
                            │ WebSocket/IPC
┌───────────────────────────┴─────────────────────────────────────┐
│                   核心层 (Koishi 插件)                            │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │          模块1: 事件接收器 (Event Receiver)               │  │
│  │  - adapter-bililive 事件订阅                              │  │
│  │  - 事件类型过滤配置                                        │  │
│  │  - 事件数据标准化                                          │  │
│  └────────────────────┬─────────────────────────────────────┘  │
│                       │                                          │
│  ┌────────────────────┴─────────────────────────────────────┐  │
│  │          模块2: 事件处理器 (Event Processor)              │  │
│  │                                                            │  │
│  │  ┌──────────────────────────────────────────────────┐    │  │
│  │  │ 2.1 触发器系统 (Trigger System)                   │    │  │
│  │  │  - 立即触发                                        │    │  │
│  │  │  - 延迟合并触发 (时间窗口)                        │    │  │
│  │  │  - 跨类型合并触发                                  │    │  │
│  │  │  - 定时任务触发                                    │    │  │
│  │  └──────────────────────────────────────────────────┘    │  │
│  │                                                            │  │
│  │  ┌──────────────────────────────────────────────────┐    │  │
│  │  │ 2.2 LLM 请求系统 (LLM Request System)             │    │  │
│  │  │  - 提示词模板系统                                  │    │  │
│  │  │  - 变量替换引擎 (弹幕历史/礼物/用户信息)          │    │  │
│  │  │  - 模型网关 (多Provider支持)                      │    │  │
│  │  │  - 工具注册与调用                                  │    │  │
│  │  │  - 流式响应处理                                    │    │  │
│  │  └──────────────────────────────────────────────────┘    │  │
│  │                                                            │  │
│  │  ┌──────────────────────────────────────────────────┐    │  │
│  │  │ 2.3 TTS 系统 (TTS System)                         │    │  │
│  │  │  - 火山方舟 TTS API                                │    │  │
│  │  │  - 声音克隆 API                                    │    │  │
│  │  │  - 音频队列管理                                    │    │  │
│  │  └──────────────────────────────────────────────────┘    │  │
│  └────────────────────┬─────────────────────────────────────┘  │
│                       │                                          │
│  ┌────────────────────┴─────────────────────────────────────┐  │
│  │          模块3: 输出处理器 (Output Handler)               │  │
│  │  - 弹幕发送 (adapter-bililive)                            │  │
│  │  - 展示板渲染 (WebSocket → 后端)                         │  │
│  │  - 语音播放 (WebSocket → 后端)                           │  │
│  │  - Live2D 控制 (WebSocket → 后端)                        │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 2. 模块详细设计

### 2.1 模块1: 事件接收器 (Event Receiver)

#### 2.1.1 功能职责
- 订阅 adapter-bililive 的所有直播间事件
- 根据用户配置过滤事件类型
- 标准化事件数据格式
- 转发到事件处理器

#### 2.1.2 支持的事件类型
基于 adapter-bililive 的事件系统：

| 事件类型 | 事件名称 | 数据内容 |
|---------|---------|---------|
| 弹幕 | `bililive/danmaku` | 内容、用户、粉丝勋章、舰长等级 |
| 礼物 | `bililive/gift` | 礼物名称、数量、价格、连击 |
| 醒目留言 | `bililive/superchat` | 内容、金额、用户 |
| 进入直播间 | `bililive/enter` | 用户、粉丝勋章 |
| 关注 | `bililive/follow` | 用户信息 |
| 点赞 | `bililive/like` | 用户、点赞数 |
| 上舰 | `bililive/guard` | 用户、舰长类型、数量 |
| 开播 | `bililive/live-start` | 直播间信息 |
| 下播 | `bililive/live-end` | 直播时长统计 |

#### 2.1.3 配置设计

```typescript
interface EventReceiverConfig {
  // 事件开关
  enabledEvents: {
    danmaku: boolean        // 弹幕
    gift: boolean           // 礼物
    superchat: boolean      // SC
    enter: boolean          // 进入直播间
    follow: boolean         // 关注
    like: boolean           // 点赞
    guard: boolean          // 上舰
    liveStart: boolean      // 开播
    liveEnd: boolean        // 下播
  }
  
  // 事件过滤
  filters: {
    minGiftPrice?: number            // 最小礼物价格
    minSuperchatAmount?: number      // 最小SC金额
    minFansMedalLevel?: number       // 最小粉丝勋章等级
    guardLevelFilter?: number[]      // 舰长等级过滤 [1,2,3]
  }
}
```

#### 2.1.4 标准化事件格式

```typescript
interface StandardEvent {
  type: 'danmaku' | 'gift' | 'superchat' | 'enter' | 'follow' | 'like' | 'guard' | 'liveStart' | 'liveEnd'
  timestamp: number
  roomId: string
  user?: {
    uid: string
    name: string
    face?: string
    fansMedal?: {
      name: string
      level: number
    }
    guardLevel?: number  // 0无/1总督/2提督/3舰长
  }
  data: any  // 事件特定数据
}
```

---

### 2.2 模块2: 事件处理器 (Event Processor)

这是核心业务逻辑模块，包含三个子系统。

---

#### 2.2.1 触发器系统 (Trigger System)

##### 功能职责
- 决定何时触发 LLM 请求
- 合并多个事件
- 管理定时任务

##### 触发模式

**1. 立即触发 (Immediate)**
```typescript
interface ImmediateTrigger {
  mode: 'immediate'
  eventTypes: string[]  // 触发的事件类型
}
```
收到指定事件立即触发 LLM 请求。

**2. 延迟合并触发 (Debounce)**
```typescript
interface DebounceTrigger {
  mode: 'debounce'
  eventTypes: string[]
  delay: number         // 延迟时间(ms)
  maxBatch: number      // 最大合并数量
}
```
在时间窗口内合并相同类型的多个事件。例如：
- 3秒内收到10条弹幕，合并为一次请求
- 5秒内收到5个礼物，合并感谢

**3. 跨类型合并触发 (Cross-Type Merge)**
```typescript
interface CrossTypeMergeTrigger {
  mode: 'cross-merge'
  primaryEvent: string     // 主事件类型
  mergeEvents: string[]    // 要合并的事件类型
  window: number           // 时间窗口(ms)
}
```
将不同类型的事件合并到主事件中。例如：
- 弹幕触发时，带上最近1分钟的礼物信息
- SC触发时，带上用户最近的弹幕历史

**4. 定时任务触发 (Scheduled)**
```typescript
interface ScheduledTrigger {
  mode: 'scheduled'
  cron: string              // cron表达式
  actions: TriggerAction[]  // 执行的动作序列
}

interface TriggerAction {
  type: 'call-tool' | 'llm-request' | 'wait'
  config: any
}
```
按照时间表执行复杂的任务流。例如：
- 每10分钟报告直播间数据
- 每30分钟调用工具获取热度，然后触发感谢发言

##### 触发器配置

```typescript
interface TriggerConfig {
  triggers: Array<ImmediateTrigger | DebounceTrigger | CrossTypeMergeTrigger | ScheduledTrigger>
  
  // 全局限流
  rateLimit: {
    maxRequestsPerMinute: number
    cooldownAfterError: number  // 错误后冷却时间(ms)
  }
}
```

##### 核心流程

```
StandardEvent
  ↓
[事件缓冲区] ← 根据触发器配置缓存
  ↓
[触发条件判断] ← 时间窗口/数量/类型
  ↓ (满足条件)
[事件聚合] ← 合并多个事件
  ↓
[生成上下文] ← 构建 LLM 请求的上下文
  ↓
→ LLM 请求系统
```

---

#### 2.2.2 LLM 请求系统 (LLM Request System)

##### 功能职责
- 管理提示词模板
- 提供变量系统
- 支持多模型网关
- 处理工具调用
- 处理流式响应

##### 提示词模板系统

**变量系统**

支持的内置变量：

```typescript
interface BuiltinVariables {
  // 事件相关
  '{{event.type}}': string           // 当前事件类型
  '{{event.user.name}}': string      // 用户名
  '{{event.user.fansMedal}}': string // 粉丝勋章信息
  '{{event.data}}': any              // 事件数据
  
  // 历史记录
  '{{history.danmaku}}': string      // 最近N条弹幕
  '{{history.gifts}}': string        // 最近N个礼物
  '{{history.superchats}}': string   // 最近N个SC
  
  // 统计信息
  '{{stats.totalViewers}}': number   // 当前观看人数
  '{{stats.followers}}': number      // 关注数
  '{{stats.likes}}': number          // 点赞数
  
  // 时间
  '{{time.now}}': string             // 当前时间
  '{{time.liveStarted}}': string     // 开播时间
  '{{time.liveDuration}}': string    // 直播时长
  
  // 自定义
  '{{custom.*}}': any                // 用户自定义变量
}
```

**模板示例**：
```
你是一名B站虚拟主播，正在直播。
当前时间：{{time.now}}，已直播{{time.liveDuration}}。

最近的弹幕：
{{history.danmaku}}

刚刚发生的事件：{{event.type}}
用户 {{event.user.name}}（{{event.user.fansMedal}}）{{event.data.description}}

请根据以上信息，用自然、活泼的语气回应观众。
```

**变量提供者接口**（可扩展）：
```typescript
interface VariableProvider {
  name: string
  resolve(context: EventContext): Promise<string> | string
}
```
系统内置若干 Provider（历史记录、统计信息等），并允许其他 Koishi 插件通过 `ctx.vtuber.registerVariable()` 注册自定义变量提供者。

##### 模型网关 (Model Gateway)

**设计目标**：统一多种 LLM API 格式，允许用户自由配置任意兼容的模型服务。

**支持的 API 协议**：

```typescript
type ApiProtocol = 'chat-completions' | 'anthropic' | 'gemini' | 'responses'

interface ModelGatewayConfig {
  id: string                    // 网关唯一标识
  protocol: ApiProtocol         // API协议类型
  baseURL: string               // 请求地址
  apiKey: string                // 密钥
  model: string                 // 模型名称
  headers?: Record<string, string>  // 自定义请求头
  
  // 生成参数
  temperature?: number
  maxTokens?: number
  topP?: number
  
  // 高级配置
  timeout?: number
  retryCount?: number
}
```

**协议适配器架构**：

```typescript
interface ModelAdapter {
  protocol: ApiProtocol
  
  buildRequest(params: {
    messages: ChatMessage[]
    tools?: ToolDefinition[]
    stream: boolean
  }, config: ModelGatewayConfig): RequestInit & { url: string }
  
  parseResponse(response: Response): AsyncGenerator<ChatChunk>
  parseToolCalls(chunk: ChatChunk): ToolCall[] | null
}
```

四种协议分别实现 `ModelAdapter`：
- `ChatCompletionsAdapter`：OpenAI 兼容格式（含大多数国内模型服务商）
- `AnthropicAdapter`：Anthropic Messages API 格式
- `GeminiAdapter`：Google Gemini generateContent 格式
- `ResponsesAdapter`：OpenAI Responses API 格式

**统一的内部消息格式**：
```typescript
interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | ContentPart[]
  toolCallId?: string
  toolCalls?: ToolCall[]
}

interface ContentPart {
  type: 'text' | 'image'
  text?: string
  imageUrl?: string
}
```

四个适配器负责把统一格式转换为各自协议的请求体，并把各自的响应流转换回统一的 `ChatChunk` 流，上层业务逻辑完全不感知具体协议差异。

##### 工具系统 (Tool System)

**工具注册接口**：
```typescript
interface ToolDefinition {
  name: string
  description: string
  parameters: JSONSchema      // 参数的 JSON Schema
  execute(args: any, context: ToolContext): Promise<ToolResult>
}

interface ToolContext {
  event: StandardEvent         // 触发本次请求的事件
  session: ChatSession         // 当前会话
  ctx: Context                 // Koishi Context
}

interface ToolResult {
  success: boolean
  data?: any
  error?: string
}
```

**工具注册中心**：
```typescript
class ToolRegistry {
  register(tool: ToolDefinition): void
  unregister(name: string): void
  list(): ToolDefinition[]
  execute(name: string, args: any, context: ToolContext): Promise<ToolResult>
}
```

工具来源分两类：
1. **内置工具**：由 vtuber 插件自身提供（如获取直播间统计信息）
2. **外部注册工具**：独立后端通过通信协议动态注册的工具（Live2D控制、点歌机控制等），详见第3节

工具调用流程复用 4 种协议各自的 tool-calling 机制（OpenAI function calling / Anthropic tool_use / Gemini function calling / Responses tool），由对应的 `ModelAdapter` 负责序列化工具定义和解析工具调用请求。

##### TTS / 声音克隆网关

```typescript
interface TtsGatewayConfig {
  provider: 'volcano-tts' | 'volcano-voice-clone'
  appId: string
  accessToken: string
  voiceType: string           // 音色ID，声音克隆场景下为克隆声音ID
  
  // 音频参数
  encoding: 'mp3' | 'wav' | 'pcm'
  speedRatio?: number
  volumeRatio?: number
  pitchRatio?: number
}

interface TtsAdapter {
  synthesize(text: string, config: TtsGatewayConfig): Promise<AudioResult>
}

interface AudioResult {
  audioData: Buffer
  duration: number
  format: string
}
```

火山方舟 TTS 使用 WebSocket 双向流式协议；声音克隆 API 用于用户上传/管理克隆音色，配置时选择克隆得到的 `voiceType` 即可复用同一套合成调用。

##### 会话与上下文管理

```typescript
interface ChatSession {
  id: string
  messages: ChatMessage[]      // 有界历史（可配置最大长度/token数）
  createdAt: number
  lastActiveAt: number
}

interface SessionManager {
  getOrCreate(key: string): ChatSession
  appendMessage(sessionId: string, message: ChatMessage): void
  trim(sessionId: string): void   // 按配置裁剪历史
  clear(sessionId: string): void
}
```

参考 LunaMate 的有界上下文窗口设计，防止长时间直播导致上下文无限增长。

##### 请求执行流程

```
[触发器产出的上下文]
  ↓
[提示词模板渲染] ← 变量替换
  ↓
[会话历史拼接]
  ↓
[选择模型网关] → ModelAdapter.buildRequest()
  ↓
[发起流式请求]
  ↓
[解析响应流] → 文本增量 / 工具调用请求
  ↓ (若有工具调用)
[执行工具] → ToolRegistry.execute() → 结果回填 → 继续请求
  ↓ (无工具调用，纯文本完成)
→ 输出处理器
```

---

#### 2.2.3 输出处理器 (Output Handler) — 回复格式与分发

##### 回复格式约定

为了让 LLM 能够精细控制"怎么说"，约定一种结构化回复格式，要求模型输出 JSON（通过工具调用或结构化输出强制）：

```typescript
interface BotReply {
  segments: ReplySegment[]
}

interface ReplySegment {
  text: string                          // 该分段的文本内容
  method: 'danmaku' | 'display' | 'tts' // 输出方式
  
  // display 专用
  displayStyle?: 'normal' | 'emphasis' | 'thought'
  
  // tts 专用
  emotion?: string                      // 情绪标签，传给TTS/Live2D联动表情
}
```

**约定通过工具调用实现**：定义一个固定工具 `send_reply`，参数即为 `segments` 数组，要求模型每次回复必须调用该工具而非直接输出纯文本。这样可以复用已有的工具调用解析基础设施，避免额外写文本协议解析器，且对四种协议都是相同处理路径。

```typescript
const sendReplyTool: ToolDefinition = {
  name: 'send_reply',
  description: '将你的回复拆分为若干语句片段并发送。每个片段可独立选择输出方式。',
  parameters: {
    type: 'object',
    properties: {
      segments: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            text: { type: 'string', description: '该片段的文本内容' },
            method: { type: 'string', enum: ['danmaku', 'display', 'tts'] },
            emotion: { type: 'string', description: '可选，情绪标签，用于语音语调和Live2D表情联动' }
          },
          required: ['text', 'method']
        }
      }
    },
    required: ['segments']
  },
  execute: async (args, ctx) => { /* 转发到输出分发器，见下 */ }
}
```

##### 输出分发器

```typescript
interface OutputDispatcher {
  dispatch(segments: ReplySegment[], context: ToolContext): Promise<void>
}
```

三种输出方式的具体行为：

| 方式 | 行为 |
|------|------|
| `danmaku` | 通过 adapter-bililive 的 Bot.sendMessage 发送弹幕到直播间 |
| `display` | 通过通信协议推送到独立后端的展示板窗口渲染 |
| `tts` | 调用 TTS/声音克隆网关合成语音，再推送音频数据到独立后端播放，同时可联动 Live2D 表情/动作（依据 `emotion` 字段） |

分段之间默认按顺序串行处理（尤其是 TTS，需等待前一段播放完成再播放下一段，避免语音重叫），`danmaku` 和 `display` 可并行触发。此顺序策略可配置。

---

## 3. 独立后端设计

### 3.1 总体架构

独立后端是一个 Node.js（或后续可选 Rust/其他）服务，通过 WebSocket 与 Koishi 插件保持长连接，双向通信：
- Koishi → 后端：控制指令（渲染文本、播放音频、Live2D 动作、点歌）
- 后端 → Koishi：工具注册、点歌机直接点歌事件、状态回报

```
┌───────────────────────────────────────────────────────────┐
│                   独立后端 (Node.js/Electron)               │
│                                                             │
│  ┌────────────────────────────────────────────────────┐   │
│  │           通信层 (WebSocket Server/Client)          │   │
│  │  - 协议: JSON-RPC 2.0 风格                          │   │
│  │  - 工具注册/调用                                     │   │
│  │  - 事件推送                                          │   │
│  └────────────────────┬─────────────────────────────────┘   │
│                       │                                       │
│  ┌────────────────────┼─────────────────────────────────┐   │
│  │                    │      子模块                       │   │
│  │  ┌─────────────────┴────┐  ┌──────────────────────┐  │   │
│  │  │  Live2D 模块          │  │  点歌机模块           │  │   │
│  │  │  - 模型管理           │  │  - 音源适配           │  │   │
│  │  │  - 表情/动作控制      │  │  - 队列管理           │  │   │
│  │  │  - 缩放/位移          │  │  - 播放控制           │  │   │
│  │  └───────────────────────┘  └──────────────────────┘  │   │
│  │  ┌───────────────────────────────────────────────┐   │   │
│  │  │  窗口管理模块 (Window Manager)                  │   │   │
│  │  │  - Live2D窗口 / 展示板窗口 / 点歌机窗口         │   │   │
│  │  │  - 音频输出设备管理                              │   │   │
│  │  └───────────────────────────────────────────────┘   │   │
│  └───────────────────────────────────────────────────────┘   │
└───────────────────────────────────────────────────────────┘
```

### 3.2 技术选型

- **运行时/UI**：Electron（成熟的多窗口管理、可加载Web技术渲染Live2D、方便集成音频播放与设备选择）
- **Live2D 渲染**：pixi-live2d-display / Live2D Cubism Web SDK（Web技术栈，避免重复LunaMate的Rust+GPUI路线，与Electron天然契合）
- **通信协议**：WebSocket + JSON-RPC 2.0
- **音频播放**：Web Audio API（可枚举/选择输出设备）+ node 侧的 `naudiodon`/`speaker` 作为可选后备

> 说明：LunaMate 使用 Rust + GPUI + Mocari 技术栈渲染 Live2D，性能更优，但集成成本高、且需要额外维护跨语言通信。考虑到本项目需要与 Node.js 生态的 Koishi 紧密通信、需要多窗口（Live2D+展示板+点歌机）灵活管理，Electron + pixi-live2d-display 是更务实的选择，前端Web技术栈还能直接复用点歌机的歌词/封面等富文本展示需求。若后续对渲染性能有更高要求，可评估替换为原生方案。


### 3.3 通信协议设计

#### 3.3.1 协议格式

采用 JSON-RPC 2.0 风格的双向通信协议。

**请求格式**（Koishi → 后端 或 后端 → Koishi）：
```json
{
  "jsonrpc": "2.0",
  "id": "unique-request-id",
  "method": "methodName",
  "params": { }
}
```

**响应格式**：
```json
{
  "jsonrpc": "2.0",
  "id": "unique-request-id",
  "result": { }
}
```

**通知（无需响应）**：
```json
{
  "jsonrpc": "2.0",
  "method": "notificationName",
  "params": { }
}
```

#### 3.3.2 Koishi → 后端方法

| 方法名 | 参数 | 描述 |
|--------|------|------|
| display.show | text, style | 在展示板窗口渲染文本 |
| audio.play | data, format, device | 播放音频（base64编码） |
| live2d.loadModel | modelPath | 加载Live2D模型 |
| live2d.setExpression | expression | 设置表情 |
| music.search | keyword, source | 搜索歌曲 |
| music.add | songId, source | 添加到播放队列 |

#### 3.3.3 后端 → Koishi 方法

| 方法名 | 参数 | 描述 |
|--------|------|------|
| tool.register | name, description, parameters | 注册工具供LLM调用 |
| tool.unregister | name | 注销工具 |


#### 3.3.4 工具注册与调用流程

1. **后端启动时注册工具**
2. **Koishi 将工具添加到 ToolRegistry**
3. **LLM 返回工具调用请求**，Koishi 路由到后端
4. **后端执行并返回结果**
5. **Koishi 将结果回填到 LLM 上下文**

---

### 3.4 Live2D 模块

#### 3.4.1 技术实现

- 使用 pixi-live2d-display 库在 Electron 的 BrowserWindow 中渲染
- 支持 Cubism 2.1 和 Cubism SDK 4.0+ 的 .model3.json 格式

#### 3.4.2 功能清单

| 功能 | 实现方式 |
|------|---------|
| 加载模型 | PIXI.live2d.Live2DModel.from(modelPath) |
| 切换表情 | model.internalModel.motionManager.expressionManager |
| 播放动作 | model.motion(group, index) |
| 缩放 | model.scale.set(scale) |
| 位移 | model.position.set(x, y) |

#### 3.4.3 注册的LLM工具

- live2d_set_expression: 设置Live2D模型的表情
- live2d_play_motion: 播放Live2D模型的动作
- live2d_set_scale: 设置Live2D模型的缩放
- live2d_set_position: 设置Live2D模型的位置

---

### 3.5 点歌机模块

#### 3.5.1 复用 AynaLivePlayer 的架构

参考 AynaLivePlayer 的以下设计：
- 双队列系统：用户点歌队列（优先） + 空闲歌单（备用）
- 多音源支持：网易云、酷我、酷狗、QQ音乐、B站视频
- 播放控制：播放/暂停/切歌/进度控制/音量控制
- 歌曲信息获取：名称/歌手/时长/封面/歌词

#### 3.5.2 功能特性

| 功能 | 说明 |
|------|------|
| 搜索歌曲 | 支持关键词搜索，指定音源 |
| 点歌 | 添加歌曲到队列（检查时长限制、队列长度限制、用户点歌配额） |
| 切歌 | 跳过当前歌曲 |
| 播放控制 | 播放/暂停/音量调节/进度跳转 |
| 歌曲信息 | 实时获取当前播放歌曲的名称/歌手/时长/进度/歌词/封面 |
| 空闲歌单 | 用户队列空时自动播放配置的空闲歌单 |
| 输出设备选择 | 允许配置音频播放的输出设备 |

#### 3.5.3 直接点歌功能

**两种点歌入口**：

1. **通过 LLM 工具调用点歌**：
   - LLM 识别用户弹幕中的点歌意图
   - 调用 music_search 工具搜索
   - 调用 music_add 工具添加到队列

2. **直接点歌（绕过 LLM）**：
   - 后端监听弹幕事件
   - 匹配点歌命令（如"点歌 歌名"）
   - 直接搜索并添加到队列
   - 通过 music.songAdded 通知推送给 Koishi

#### 3.5.4 注册的LLM工具

- music_search: 搜索歌曲
- music_add: 添加歌曲到播放队列
- music_skip: 跳过当前歌曲
- music_get_queue: 获取当前播放队列
- music_get_now_playing: 获取当前播放的歌曲信息

#### 3.5.5 歌曲信息渲染

支持两种输出方式：

1. **新窗口渲染**：
   - 使用 Electron BrowserWindow 加载自定义 HTML 模板
   - 实时更新歌曲信息、封面、歌词、进度条
   - 支持 OBS 透明窗口捕获

2. **文本输出到本地**：
   - 按照用户配置的模板格式化歌曲信息
   - 写入到指定文件（如 nowplaying.txt）
   - 供 OBS 文本源读取

---

### 3.6 窗口管理模块

#### 3.6.1 窗口类型

| 窗口 | 用途 | 特性 |
|------|------|------|
| Live2D窗口 | 渲染Live2D模型 | 透明背景、置顶、可拖拽、可缩放 |
| 展示板窗口 | 显示LLM回复的文本 | 可配置样式、支持HTML/Markdown渲染 |
| 点歌机窗口 | 显示当前播放歌曲信息 | 歌词滚动、封面展示、进度条 |

#### 3.6.2 音频输出设备管理

使用 Web Audio API 的 setSinkId() 方法选择输出设备。

用户可在配置界面选择：
- 默认设备（播放到扬声器）
- 虚拟音频设备（如 VB-Cable，输出到直播软件）

---

## 4. 配置系统设计

### 4.1 Koishi 插件配置

使用 Koishi 的 Schema 系统定义配置项，包含：
- 事件接收器配置
- 触发器配置
- LLM网关配置
- TTS网关配置
- 输出处理器配置
- 后端通信配置

### 4.2 独立后端配置

使用 JSON 配置文件 + 可选的图形化配置界面。

---

## 5. 核心流程示例

### 5.1 弹幕触发 LLM 回复流程

```
1. adapter-bililive 收到弹幕事件
   ↓
2. EventReceiver 过滤并标准化事件
   ↓
3. TriggerSystem 根据配置判断触发条件
   ↓
4. LLM Request System 构建请求
   ↓
5. 发起流式请求
   ↓
6. 解析响应流（工具调用：send_reply）
   ↓
7. OutputDispatcher 分发输出
   ↓
8. 完成
```

### 5.2 用户直接点歌流程

```
1. 用户发送弹幕："点歌 告白气球"
   ↓
2. EventReceiver 转发弹幕事件到独立后端
   ↓
3. 独立后端 MusicModule 匹配直接点歌规则
   ↓
4. 搜索歌曲（调用音源API）
   ↓
5. 添加到播放队列
   ↓
6. 推送通知到 Koishi（music.songAdded）
   ↓
7. Koishi 根据配置决定是否触发 LLM 生成感谢语
   ↓
8. 歌曲开始播放，点歌机窗口更新歌曲信息
```

### 5.3 定时任务流程

```
配置：每10分钟执行一次"报告直播间数据"

1. ScheduledTrigger 到达触发时间
   ↓
2. 执行配置的动作序列
   ↓
3. LLM 生成播报内容并通过 send_reply 输出
   ↓
4. 完成，等待下一次触发
```

---

## 6. 技术风险与应对

| 风险 | 影响 | 应对方案 |
|------|------|---------|
| adapter-bililive 事件遗漏 | 关键事件未触发 | 增加心跳检测；备用事件源 |
| LLM 响应延迟/超时 | 用户体验差 | 设置超时重试；提供降级文案 |
| TTS 合成失败 | 无语音输出 | 降级为纯文本输出到展示板 |
| 音乐源API失效 | 点歌功能受限 | 多音源冗余；优雅降级提示 |
| 独立后端崩溃 | Live2D/点歌机不可用 | 自动重启机制；Koishi侧降级为纯弹幕模式 |
| WebSocket 断线 | 通信中断 | 自动重连+消息队列缓冲 |

---

## 7. 开发计划

### 7.1 第一阶段：核心框架（2周）

- Koishi 插件基础架构
  - EventReceiver 实现
  - TriggerSystem 基础（立即触发 + 延迟合并）
  - Schema 配置系统
- 独立后端基础架构
  - Electron 主进程 + WebSocket Server
  - 通信协议实现（JSON-RPC）
  - 窗口管理基础

### 7.2 第二阶段：LLM 集成（2周）

- LLM Request System
  - 提示词模板引擎
  - 变量系统
  - 四种协议适配器
  - 工具系统
- OutputDispatcher
  - send_reply 工具实现
  - 弹幕发送
  - 展示板窗口基础渲染

### 7.3 第三阶段：TTS 与 Live2D（1.5周）

- TTS 系统
  - 火山方舟 TTS 适配器
  - 声音克隆适配器
  - 音频队列管理
- Live2D 模块
  - pixi-live2d-display 集成
  - 模型加载
  - 表情/动作控制
  - 工具注册

### 7.4 第四阶段：点歌系统（1.5周）

- 点歌机模块
  - 多音源适配
  - 双队列系统
  - 播放控制
  - 直接点歌功能
  - 歌曲信息窗口渲染
  - 工具注册

### 7.5 第五阶段：完善与测试（1周）

- 定时任务触发器
- 跨类型合并触发器
- 错误处理与降级
- 配置界面优化
- 压力测试与性能优化
- 文档编写

**总计：8周**

---

## 8. 可扩展性设计

### 8.1 插件式工具系统

其他 Koishi 插件或独立后端可通过标准接口注册新工具。

### 8.2 自定义变量提供者

支持注册自定义变量提供者，从数据库/API获取数据。

### 8.3 自定义输出方式

支持注册自定义输出方法，实现特殊的输出逻辑。

---

## 9. 总结

本设计文档详细规划了 Koishi Vtuber 项目的完整架构，核心特点：

1. **模块化设计**：事件接收、触发器、LLM请求、输出处理四大模块清晰分离
2. **灵活的触发器系统**：支持立即触发、延迟合并、跨类型合并、定时任务四种模式
3. **统一的模型网关**：通过适配器模式支持四种主流 LLM API 协议
4. **完善的工具系统**：Live2D、点歌机等功能通过工具调用无缝集成到 LLM 工作流
5. **独立后端架构**：使用 Electron 提供多窗口渲染能力，通过 WebSocket 与 Koishi 通信
6. **高可扩展性**：支持插件注册工具、变量提供者、输出方式

下一步：
1. **审阅本设计文档**，确认架构方案
2. **开始第一阶段开发**，搭建核心框架


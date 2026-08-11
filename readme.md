# Koishi Vtuber 插件

基于 Koishi 框架的 AI 虚拟主播系统，支持 Bilibili 直播间交互。

## 功能特性

### 核心功能
- **直播间事件接收**：弹幕、礼物、进入/退出、点赞、关注、开播/下播等
- **智能事件处理**：触发器系统、延迟合并、定时任务
- **多模型支持**：OpenAI、Anthropic、Gemini 等主流 LLM
- **TTS 语音合成**：火山方舟 TTS、声音克隆
- **工具调用**：Live2D 控制、点歌机、展示板等

### 独立后端
- **Live2D 展示**：模型加载、表情控制、动作控制
- **点歌机系统**：多音源支持、队列管理、歌词展示
- **窗口管理**：展示板窗口、Live2D 窗口、点歌机窗口
- **JSON-RPC 通信**：与 Koishi 插件高效通信

## 安装

### 1. 安装 Koishi 插件

```bash
cd external/vtuber
npm install
npm run build
```

### 2. 安装独立后端

```bash
cd external/vtuber/backend
npm install
npm run build
```

## 配置

### Koishi 插件配置

在 Koishi 控制台中配置插件：

#### 1. 事件接收器配置

```yaml
eventReceiver:
  enabledEvents:
    danmaku: true        # 弹幕
    gift: true           # 礼物
    superchat: true      # SC
    enter: false         # 进入直播间
    follow: true         # 关注
    like: false          # 点赞
    guard: true          # 上舰
    liveStart: true      # 开播
    liveEnd: true        # 下播
  filters:
    minGiftPrice: 100    # 最小礼物价格（金瓜子）
```

#### 2. 触发器配置

```yaml
triggers:
  - mode: immediate      # 立即触发
    eventTypes: [superchat, guard]
  
  - mode: debounce       # 延迟合并触发
    eventTypes: [danmaku]
    delay: 5000          # 5秒
    maxBatch: 10         # 最多合并10条
  
  - mode: debounce
    eventTypes: [gift]
    delay: 3000
    maxBatch: 5
```

#### 3. LLM 配置

```yaml
llm:
  provider: anthropic    # openai / anthropic / gemini
  apiKey: sk-xxx
  model: claude-sonnet-4-20250514
  baseUrl: https://api.anthropic.com  # 可选
  
  # 提示词模板
  systemPrompt: |
    你是一个虚拟主播，名字叫小艾。
    你的性格：活泼、可爱、善于活跃气氛。
    
    可用变量：
    - {{danmaku_history}}: 最近的弹幕历史
    - {{gift_history}}: 最近的礼物记录
    - {{user_name}}: 当前用户名
```

#### 4. TTS 配置

```yaml
tts:
  provider: volcengine   # 火山方舟
  apiKey: xxx
  appId: xxx
  voiceType: zh_female_tianmeixiaoyuan
  speed: 1.0
  volume: 1.0
```

#### 5. 后端连接配置

```yaml
backend:
  enabled: true
  host: localhost
  port: 8765
  reconnectInterval: 5000
```

### 独立后端配置

创建 `backend/config.json`：

```json
{
  "server": {
    "host": "localhost",
    "port": 8765
  },
  "live2d": {
    "modelPath": "D:/models/live2d/my_model",
    "defaultExpression": "normal",
    "defaultScale": 1.0
  },
  "music": {
    "sources": ["netease", "qq"],
    "maxDuration": 300,
    "autoPlay": true,
    "idlePlaylist": []
  }
}
```

## 使用

### 1. 启动后端

```bash
cd external/vtuber/backend
npm start
```

或使用 Electron 启动：

```bash
npm run electron
```

### 2. 启动 Koishi

在 Koishi 控制台中启用 vtuber 插件。

### 3. 配置直播间

确保已安装并配置 `adapter-bililive` 插件，连接到你的 Bilibili 直播间。

## LLM 工具调用

插件为 LLM 注册了以下工具：

### Live2D 控制

- `live2d_set_expression`: 设置表情
  ```json
  { "expression": "happy" }
  ```

- `live2d_play_motion`: 播放动作
  ```json
  { "group": "Idle", "index": 0 }
  ```

- `live2d_set_position`: 设置位置
  ```json
  { "x": 100, "y": 50 }
  ```

- `live2d_set_scale`: 设置缩放
  ```json
  { "scale": 1.2 }
  ```

### 点歌机控制

- `music_search`: 搜索歌曲
  ```json
  { "keyword": "晴天", "source": "netease" }
  ```

- `music_add_song`: 添加歌曲
  ```json
  { "songId": "123456", "source": "netease" }
  ```

- `music_skip`: 切歌

- `music_get_queue`: 获取播放队列

- `music_get_current`: 获取当前播放

### 展示板控制

- `display_show_text`: 显示文本
  ```json
  {
    "text": "欢迎来到直播间！",
    "duration": 5000,
    "style": "normal"
  }
  ```

## 输出格式

LLM 回复支持多种输出方式，使用特殊标记：

### 1. 直接回复弹幕（默认）

```
你好，欢迎来到直播间！
```

### 2. 展示板渲染

```
[DISPLAY]欢迎新观众！[/DISPLAY]
```

### 3. 语音播放

```
[TTS]大家好，我是小艾[/TTS]
```

### 4. 混合输出

```
[TTS]感谢送的礼物[/TTS]
[DISPLAY]♥ 感谢 @用户名 送的火箭 ♥[/DISPLAY]
谢谢你的支持！
```

## 提示词变量

在 systemPrompt 或 userPrompt 中可使用以下变量：

- `{{danmaku_history}}`: 最近的弹幕历史
- `{{gift_history}}`: 最近的礼物记录
- `{{user_name}}`: 触发用户名
- `{{user_uid}}`: 触发用户UID
- `{{room_id}}`: 直播间ID
- `{{event_type}}`: 事件类型
- `{{event_data}}`: 事件数据（JSON）

## 开发

### 目录结构

```
external/vtuber/
├── src/                    # Koishi 插件源码
│   ├── index.ts           # 插件入口
│   ├── event/             # 事件处理
│   ├── trigger/           # 触发器系统
│   ├── llm/               # LLM 请求
│   ├── tts/               # TTS 系统
│   ├── output/            # 输出处理
│   └── backend-client/    # 后端客户端
├── backend/               # 独立后端
│   ├── src/
│   │   ├── main.ts       # Electron 主进程
│   │   ├── server.ts     # WebSocket 服务器
│   │   ├── jsonrpc/      # JSON-RPC 处理
│   │   ├── window/       # 窗口管理
│   │   ├── live2d/       # Live2D 管理
│   │   └── music/        # 点歌机管理
│   └── renderer/          # 前端渲染页面
│       ├── live2d.html
│       ├── jukebox.html
│       └── display.html
└── DESIGN.md              # 顶层设计文档
```

### 添加新的 LLM 工具

1. 在 `src/llm/tools.ts` 中定义工具：

```typescript
export function createCustomTools(backendClient: BackendClient): LLMTool[] {
  return [
    {
      name: 'my_custom_tool',
      description: '我的自定义工具',
      parameters: {
        type: 'object',
        properties: {
          param1: { type: 'string' }
        },
        required: ['param1']
      },
      handler: async (args) => {
        // 实现工具逻辑
        return { success: true }
      }
    }
  ]
}
```

2. 在 `src/index.ts` 中注册：

```typescript
const customTools = createCustomTools(backendClient)
llmManager.registerTools(customTools)
```

### 添加新的后端功能

1. 在 `backend/src/modules/` 中创建管理器
2. 在 `backend/src/server.ts` 中注册 RPC 方法
3. 在 Koishi 插件的工具中调用

## 故障排查

### 后端连接失败

检查：
1. 后端是否已启动
2. 端口是否被占用
3. 防火墙设置

### LLM 请求失败

检查：
1. API Key 是否正确
2. 模型名称是否正确
3. 网络连接

### TTS 播放失败

检查：
1. TTS 配置是否正确
2. 音频输出设备是否可用
3. 后端是否正常运行

## 许可证

MIT

## 贡献

欢迎提交 Issue 和 Pull Request！

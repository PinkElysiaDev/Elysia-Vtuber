# 开发指南

本文档面向希望扩展或修改 Vtuber 插件功能的开发者。

## 项目架构

### Koishi 插件部分

```
src/
├── index.ts                 # 插件入口
├── event/                   # 事件处理模块
│   ├── receiver.ts         # 事件接收器
│   ├── standardizer.ts     # 事件标准化
│   └── cache.ts            # 事件缓存
├── trigger/                 # 触发器模块
│   ├── manager.ts          # 触发器管理器
│   ├── immediate.ts        # 立即触发
│   ├── debounce.ts         # 延迟合并触发
│   ├── cross-merge.ts      # 跨类型合并
│   └── scheduled.ts        # 定时任务
├── llm/                     # LLM 请求模块
│   ├── manager.ts          # LLM 管理器
│   ├── template.ts         # 提示词模板
│   ├── variable.ts         # 变量替换引擎
│   ├── adapters/           # 模型适配器
│   │   ├── base.ts
│   │   ├── openai.ts
│   │   ├── anthropic.ts
│   │   └── gemini.ts
│   └── tools.ts            # 工具定义
├── tts/                     # TTS 模块
│   ├── manager.ts          # TTS 管理器
│   └── volcengine.ts       # 火山方舟 TTS
├── output/                  # 输出处理模块
│   └── handler.ts          # 输出处理器
└── backend-client/          # 后端客户端
    └── client.ts           # WebSocket 客户端
```

### 独立后端部分

```
backend/src/
├── main.ts                  # Electron 主进程入口
├── index.ts                 # 后端入口
├── backend.ts               # 后端主类
├── server.ts                # WebSocket 服务器
├── jsonrpc/                 # JSON-RPC 协议
│   ├── handler.ts          # RPC 处理器
│   └── types.ts            # 类型定义
├── window/                  # 窗口管理
│   ├── manager.ts          # 窗口管理器
│   └── types.ts
├── live2d/                  # Live2D 模块
│   ├── manager.ts          # Live2D 管理器
│   └── types.ts
├── music/                   # 点歌机模块
│   ├── manager.ts          # 点歌机管理器
│   ├── player.ts           # 播放器
│   └── sources/            # 音源适配器
│       ├── netease.ts
│       └── qq.ts
└── modules/                 # 其他模块
    ├── display/            # 展示板
    ├── audio/              # 音频播放
    └── jukebox/            # 点歌机窗口
```

## 添加新的 LLM Provider

### 1. 创建适配器

在 `src/llm/adapters/` 下创建新的适配器文件：

```typescript
// src/llm/adapters/custom.ts
import { LLMAdapter, LLMRequest, LLMResponse } from './base'

export class CustomAdapter implements LLMAdapter {
  constructor(
    private apiKey: string,
    private baseUrl: string
  ) {}

  async sendRequest(request: LLMRequest): Promise<LLMResponse> {
    // 实现请求逻辑
    const response = await fetch(`${this.baseUrl}/chat`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: request.model,
        messages: request.messages,
        temperature: request.temperature,
        max_tokens: request.maxTokens,
        tools: request.tools
      })
    })

    const data = await response.json()

    return {
      content: data.choices[0].message.content,
      toolCalls: data.choices[0].message.tool_calls?.map(tc => ({
        id: tc.id,
        name: tc.function.name,
        arguments: JSON.parse(tc.function.arguments)
      }))
    }
  }

  async *streamRequest(request: LLMRequest): AsyncGenerator<string> {
    // 实现流式请求（可选）
    // ...
  }
}
```

### 2. 注册适配器

在 `src/llm/manager.ts` 中注册：

```typescript
import { CustomAdapter } from './adapters/custom'

export class LLMManager {
  private createAdapter(): LLMAdapter {
    switch (this.config.provider) {
      case 'openai':
        return new OpenAIAdapter(this.config.apiKey, this.config.baseUrl)
      case 'anthropic':
        return new AnthropicAdapter(this.config.apiKey, this.config.baseUrl)
      case 'custom':
        return new CustomAdapter(this.config.apiKey, this.config.baseUrl)
      default:
        throw new Error(`未知的 provider: ${this.config.provider}`)
    }
  }
}
```

### 3. 更新配置类型

在 `src/index.ts` 中添加配置选项：

```typescript
export interface Config {
  llm: {
    provider: 'openai' | 'anthropic' | 'gemini' | 'custom'
    // ...
  }
}
```

## 添加新的 LLM 工具

### 1. 定义工具

在 `src/llm/tools.ts` 中添加：

```typescript
export function createCustomTool(backendClient: BackendClient): LLMTool {
  return {
    name: 'my_custom_action',
    description: '执行自定义操作',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description: '操作类型'
        },
        value: {
          type: 'number',
          description: '操作值'
        }
      },
      required: ['action']
    },
    handler: async (args: { action: string; value?: number }) => {
      // 调用后端方法
      const result = await backendClient.call('custom.doAction', {
        action: args.action,
        value: args.value || 0
      })

      return {
        success: true,
        result: result
      }
    }
  }
}
```

### 2. 注册工具

在 `src/index.ts` 中：

```typescript
const customTool = createCustomTool(backendClient)
llmManager.registerTools([customTool])
```

### 3. 实现后端方法

在后端 `src/server.ts` 中：

```typescript
this.rpcHandler.register('custom.doAction', async (params) => {
  const { action, value } = params
  // 实现具体逻辑
  return { result: 'done' }
})
```

## 添加新的触发模式

### 1. 创建触发器类

在 `src/trigger/` 下创建新文件：

```typescript
// src/trigger/custom-trigger.ts
import { Trigger, TriggerContext } from './types'

export class CustomTrigger implements Trigger {
  constructor(private config: CustomTriggerConfig) {}

  async shouldTrigger(event: StandardEvent, context: TriggerContext): Promise<boolean> {
    // 实现触发逻辑
    return true
  }

  async aggregate(events: StandardEvent[]): Promise<TriggerResult> {
    // 聚合事件
    return {
      context: {
        eventType: 'custom',
        events: events
      }
    }
  }
}
```

### 2. 注册触发器

在 `src/trigger/manager.ts` 中：

```typescript
export class TriggerManager {
  private createTrigger(config: TriggerConfig): Trigger {
    switch (config.mode) {
      case 'immediate':
        return new ImmediateTrigger(config)
      case 'debounce':
        return new DebounceTrigger(config)
      case 'custom':
        return new CustomTrigger(config)
      // ...
    }
  }
}
```

## 添加新的后端窗口类型

### 1. 创建渲染页面

在 `backend/renderer/` 下创建 HTML 文件：

```html
<!-- backend/renderer/custom-window.html -->
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Custom Window</title>
  <style>
    body {
      margin: 0;
      padding: 20px;
      background: #0A0D12;
      color: #FFFFFF;
      font-family: 'Microsoft YaHei', sans-serif;
    }
  </style>
</head>
<body>
  <div id="content"></div>

  <script>
    const { ipcRenderer } = require('electron')

    // 接收数据
    ipcRenderer.on('update-content', (event, data) => {
      document.getElementById('content').textContent = data.text
    })

    // 发送数据
    function sendData(data) {
      ipcRenderer.send('custom-data', data)
    }
  </script>
</body>
</html>
```

### 2. 创建窗口管理器

在 `backend/src/modules/` 下创建管理器：

```typescript
// backend/src/modules/custom/manager.ts
import { BrowserWindow } from 'electron'
import * as path from 'path'

export class CustomWindowManager {
  private window: BrowserWindow | null = null

  async createWindow(config: CustomConfig): Promise<void> {
    this.window = new BrowserWindow({
      width: config.width,
      height: config.height,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false
      }
    })

    const htmlPath = path.join(__dirname, '../../../renderer/custom-window.html')
    await this.window.loadFile(htmlPath)
  }

  updateContent(data: any): void {
    if (this.window) {
      this.window.webContents.send('update-content', data)
    }
  }
}
```

### 3. 注册 RPC 方法

在 `backend/src/server.ts` 中：

```typescript
this.rpcHandler.register('custom.create', async (params) => {
  await this.managers.customManager.createWindow(params)
  return { success: true }
})

this.rpcHandler.register('custom.update', async (params) => {
  this.managers.customManager.updateContent(params)
  return { success: true }
})
```

## 添加新的音源

### 1. 创建音源适配器

在 `backend/src/music/sources/` 下创建：

```typescript
// backend/src/music/sources/custom.ts
import { MusicSource, Song, SearchResult } from '../types'

export class CustomMusicSource implements MusicSource {
  name = 'custom'

  async search(keyword: string): Promise<SearchResult[]> {
    // 实现搜索逻辑
    const response = await fetch(`https://api.custom.com/search?q=${keyword}`)
    const data = await response.json()

    return data.results.map(item => ({
      id: item.id,
      title: item.title,
      artist: item.artist,
      duration: item.duration,
      cover: item.cover
    }))
  }

  async getSong(id: string): Promise<Song> {
    // 获取歌曲详情和播放链接
    const response = await fetch(`https://api.custom.com/song/${id}`)
    const data = await response.json()

    return {
      id: data.id,
      title: data.title,
      artist: data.artist,
      album: data.album,
      duration: data.duration,
      cover: data.cover,
      url: data.url,
      source: 'custom'
    }
  }

  async getLyrics(id: string): Promise<string> {
    // 获取歌词（可选）
    return ''
  }
}
```

### 2. 注册音源

在 `backend/src/music/manager.ts` 中：

```typescript
import { CustomMusicSource } from './sources/custom'

export class MusicPlayerManager {
  private sources: Map<string, MusicSource> = new Map()

  constructor() {
    this.sources.set('netease', new NeteaseMusicSource())
    this.sources.set('qq', new QQMusicSource())
    this.sources.set('custom', new CustomMusicSource())
  }
}
```

## 调试技巧

### 1. 启用详细日志

在 Koishi 配置中：

```yaml
logging:
  level: debug
  logEvents: true
  logLLMRequests: true
  logLLMResponses: true
```

### 2. 使用 VSCode 调试

创建 `.vscode/launch.json`：

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "type": "node",
      "request": "launch",
      "name": "Debug Koishi Plugin",
      "runtimeExecutable": "npm",
      "runtimeArgs": ["run", "dev"],
      "cwd": "${workspaceFolder}",
      "console": "integratedTerminal"
    },
    {
      "type": "node",
      "request": "launch",
      "name": "Debug Backend",
      "program": "${workspaceFolder}/backend/src/main.ts",
      "preLaunchTask": "npm: build",
      "outFiles": ["${workspaceFolder}/backend/dist/**/*.js"],
      "console": "integratedTerminal"
    }
  ]
}
```

### 3. 测试单个模块

创建测试文件：

```typescript
// test/trigger.spec.ts
import { DebounceTrigger } from '../src/trigger/debounce'

describe('DebounceTrigger', () => {
  it('should merge events', async () => {
    const trigger = new DebounceTrigger({
      mode: 'debounce',
      eventTypes: ['danmaku'],
      delay: 1000,
      maxBatch: 10
    })

    // 测试逻辑
  })
})
```

## 性能优化

### 1. 事件缓存

合理设置缓存大小，避免内存占用过大：

```typescript
cache:
  danmakuHistorySize: 50    # 根据实际需求调整
  eventHistoryDuration: 300000
```

### 2. LLM 请求限流

避免频繁请求导致费用过高：

```typescript
rateLimit:
  maxRequestsPerMinute: 10
  cooldownAfterError: 30000
```

### 3. 窗口优化

对于透明窗口，优化渲染性能：

```typescript
{
  transparent: true,
  frame: false,
  webPreferences: {
    offscreen: false,
    hardwareAcceleration: true
  }
}
```

## 代码规范

### 1. TypeScript 严格模式

确保类型安全：

```json
{
  "compilerOptions": {
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true
  }
}
```

### 2. 错误处理

始终处理异步操作的错误：

```typescript
try {
  await someAsyncOperation()
} catch (error) {
  logger.error('操作失败:', error)
  // 恢复策略
}
```

### 3. 日志记录

使用统一的日志接口：

```typescript
logger.debug('调试信息')
logger.info('普通信息')
logger.warn('警告信息')
logger.error('错误信息')
```

## 贡献指南

### 提交 Pull Request

1. Fork 项目
2. 创建功能分支：`git checkout -b feature/new-feature`
3. 提交更改：`git commit -m 'Add new feature'`
4. 推送分支：`git push origin feature/new-feature`
5. 创建 Pull Request

### 代码审查

确保代码：
- 通过 TypeScript 编译
- 遵循项目代码风格
- 包含必要的注释
- 不引入新的依赖（除非必要）

## 常见问题

### Q: 如何热重载插件？

**A:** 使用 Koishi 的热重载功能：

```bash
npm run dev
```

### Q: 如何调试 Electron 渲染进程？

**A:** 打开开发者工具：

```typescript
this.window.webContents.openDevTools()
```

### Q: 如何处理跨平台问题？

**A:** 使用 Node.js 的 path 模块：

```typescript
import * as path from 'path'
const filePath = path.join(__dirname, 'file.txt')
```

## 资源链接

- [Koishi 文档](https://koishi.chat)
- [Electron 文档](https://www.electronjs.org)
- [TypeScript 文档](https://www.typescriptlang.org)
- [WebSocket 文档](https://developer.mozilla.org/en-US/docs/Web/API/WebSocket)

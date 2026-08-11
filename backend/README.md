# Vtuber Backend Server

独立后端服务器，为 Koishi Vtuber 插件提供窗口管理、Live2D 渲染、点歌机等功能。

## 功能特性

### 已实现 ✅

- **WebSocket 服务器**：JSON-RPC 2.0 协议通信
- **通用窗口管理器**：支持动态模块组合
  - Live2D 模块：模型加载、表情、动作、缩放、位置
  - 文本展示模块：文本渲染、样式控制
  - 音乐播放器模块：播放控制、歌词显示
- **WebUI 管理界面**：实时查看系统状态和日志
- **健康检查 API**：`/health` 端点

### 开发中 🚧

- Live2D 实际渲染（当前仅框架）
- 点歌机集成
- TTS 音频播放
- Electron 窗口支持

## 快速开始

### 安装依赖

```bash
npm install
```

### 编译

```bash
npm run build
```

### 启动服务器

```bash
npm start
```

服务器将在以下地址启动：
- **WebSocket**: `ws://localhost:9600`
- **WebUI**: `http://localhost:9600`

### 开发模式

```bash
npm run dev
```

## API 文档

### JSON-RPC 方法

#### 1. `window.create` - 创建窗口

**参数**:
```json
{
  "config": {
    "id": "main-window",
    "title": "Vtuber Window",
    "width": 1280,
    "height": 720,
    "modules": ["live2d", "textDisplay"]
  }
}
```

**返回**:
```json
{
  "windowId": "main-window"
}
```

#### 2. `window.update` - 更新窗口模块

**参数**:
```json
{
  "windowId": "main-window",
  "module": "live2d",
  "action": "loadModel",
  "data": {
    "modelPath": "/path/to/model.json"
  }
}
```

**返回**:
```json
{
  "success": true
}
```

#### 3. `window.close` - 关闭窗口

**参数**:
```json
{
  "windowId": "main-window"
}
```

**返回**:
```json
{
  "success": true
}
```

#### 4. `window.list` - 列出所有窗口

**参数**: 无

**返回**:
```json
{
  "windows": [
    {
      "id": "main-window",
      "config": { ... }
    }
  ]
}
```

#### 5. `tts.play` - 播放 TTS 音频

**参数**:
```json
{
  "text": "你好，欢迎来到直播间",
  "voiceType": "zh_female_shuangkuaisisi_moon_bigtts",
  "speed": 1.0,
  "volume": 1.0
}
```

**返回**:
```json
{
  "success": true
}
```

#### 6. `system.info` - 获取系统信息

**参数**: 无

**返回**:
```json
{
  "version": "0.0.1",
  "uptime": 123.45,
  "memory": { ... },
  "clients": 1,
  "windows": 2
}
```

### 模块动作

#### Live2D 模块

| 动作 | 数据 | 说明 |
|------|------|------|
| `loadModel` | `{ modelPath: string }` | 加载模型 |
| `setExpression` | `{ expressionId: string }` | 设置表情 |
| `playMotion` | `{ motionGroup: string, motionIndex?: number }` | 播放动作 |
| `setScale` | `{ scale: number }` | 设置缩放 |
| `setPosition` | `{ x: number, y: number }` | 设置位置 |

#### 文本展示模块

| 动作 | 数据 | 说明 |
|------|------|------|
| `showText` | `{ content: string, duration?: number, style?: {...} }` | 显示文本 |
| `clear` | `{}` | 清空文本 |

#### 音乐播放器模块

| 动作 | 数据 | 说明 |
|------|------|------|
| `play` | `{ url: string, title?: string, artist?: string, cover?: string }` | 播放音乐 |
| `pause` | `{}` | 暂停 |
| `resume` | `{}` | 继续 |
| `stop` | `{}` | 停止 |
| `seek` | `{ position: number }` | 跳转位置 |
| `setVolume` | `{ volume: number }` | 设置音量 |

## 项目结构

```
backend/
├── src/
│   ├── index.ts           # 入口文件
│   ├── server.ts          # 主服务器
│   ├── rpc-processor.ts   # JSON-RPC 处理器
│   ├── window-manager.ts  # 窗口管理器
│   └── types.ts           # 类型定义
├── dist/                  # 编译输出
├── package.json
└── tsconfig.json
```

## 配置

修改 [src/index.ts](src/index.ts) 中的 `defaultConfig`：

```typescript
const defaultConfig: BackendConfig = {
  port: 9600,              // WebSocket 端口
  host: 'localhost',       // 监听地址
  webUIEnabled: true,      // 启用 WebUI
}
```

## 客户端连接示例

### Node.js (使用 ws)

```typescript
import WebSocket from 'ws'

const ws = new WebSocket('ws://localhost:9600')

ws.on('open', () => {
  // 创建窗口
  ws.send(JSON.stringify({
    jsonrpc: '2.0',
    method: 'window.create',
    params: {
      config: {
        id: 'test-window',
        title: 'Test',
        width: 800,
        height: 600,
        modules: ['textDisplay']
      }
    },
    id: 1
  }))
})

ws.on('message', (data) => {
  const response = JSON.parse(data.toString())
  console.log('Response:', response)
})
```

### 浏览器 (使用 WebSocket API)

```javascript
const ws = new WebSocket('ws://localhost:9600')

ws.onopen = () => {
  ws.send(JSON.stringify({
    jsonrpc: '2.0',
    method: 'system.info',
    id: 1
  }))
}

ws.onmessage = (event) => {
  const response = JSON.parse(event.data)
  console.log('Response:', response)
}
```

## 技术栈

- **Node.js** + **TypeScript**
- **Express** - HTTP 服务器
- **ws** - WebSocket 服务器
- **JSON-RPC 2.0** - 通信协议

## 许可证

MIT License

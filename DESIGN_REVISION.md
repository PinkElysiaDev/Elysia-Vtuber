# Koishi Vtuber 项目顶层设计文档 - 修订版

> 本文档基于初版设计，针对审阅反馈进行了重要调整

## 审阅问题与调整方案

### 问题1：变量系统的数据来源确认

**审阅意见**：提供的变量确认可以获得对应数据吗？

**调查结果**：

经过代码审查，adapter-bililive 提供的数据能力如下：

**✅ 可以直接获取的数据**：
- `{{event.type}}`, `{{event.user.name}}`, `{{event.user.fansMedal}}` - 来自事件数据
- `{{time.now}}` - 系统时间
- `{{history.danmaku}}`, `{{history.gifts}}`, `{{history.superchats}}` - 插件自行缓存的事件历史

**⚠️ 需要额外实现的数据**：
- `{{stats.totalViewers}}` - 需要监听 `bililive/online` 事件并缓存
- `{{stats.followers}}` - **无法实时获取**，B站API不提供直播间内实时关注数推送
- `{{stats.likes}}` - 需要累加 `bililive/like` 事件
- `{{time.liveStarted}}`, `{{time.liveDuration}}` - 需要记录 `bililive/live-start` 事件时间

**❌ 无法获取的数据**：
- 关注总数（只能通过 Web API 定期轮询主播个人空间，成本高且数据滞后）

**调整方案**：

1. **修正变量系统文档**，明确标注数据来源和获取方式
2. **实现事件数据缓存层**，收集可统计数据：
   ```typescript
   interface LiveSessionState {
     online: number                    // 当前在线人数（来自 bililive/online）
     likes: number                     // 本场直播累计点赞（累加 bililive/like）
     liveStartTime: number | null      // 开播时间戳
     danmakuHistory: DanmakuEvent[]    // 弹幕历史（有界队列）
     giftHistory: GiftEvent[]          // 礼物历史
     superChatHistory: SCEvent[]       // SC历史
   }
   ```
3. **移除无法实现的变量**（如 `{{stats.followers}}`），或改为"需用户通过定时任务+工具调用获取"

---

### 问题2：Node.js 渲染 Live2D 的性能问题

**审阅意见**：独立后端不是要加载live2d模型吗，node的性能够用吗？

**性能分析**：

Node.js + Electron + pixi-live2d-display 的性能取决于：
1. **GPU 渲染能力**：Live2D 模型通过 WebGL 渲染，利用 GPU 而非 CPU
2. **模型复杂度**：标准 Live2D Cubism 模型（2000-5000 多边形）在现代 GPU 上完全流畅（60fps+）
3. **参考案例**：
   - VTube Studio（Unity + C#）
   - nizima LIVE（Web 技术栈）
   - Live2DViewerEX（Electron + Web）

**测试数据**（参考 pixi-live2d-display 社区反馈）：
- 标准模型（如 Haru）：60fps @ 1080p，CPU 占用 5-10%
- 复杂模型（10000+ 多边形）：可能降至 30-45fps

**调整方案**：

**保持 Electron + pixi-live2d-display 方案**，理由：
1. **性能足够**：标准虚拟主播模型完全流畅
2. **开发效率**：与 Koishi（Node.js）生态无缝集成，窗口管理简单
3. **可扩展性**：Web 技术栈便于UI定制（展示板、点歌机）

**性能优化措施**：
- 限制 Live2D 窗口渲染帧率为 30fps（虚拟主播场景无需 60fps）
- 支持配置项降低模型渲染精度
- 提供性能监控工具

**备选方案**（性能极端需求场景）：
- 提供"外部 Live2D 进程"选项，允许用户自行运行 VTube Studio 等原生软件，vtuber 插件仅通过 API 控制（如 VTS WebSocket API）

---

### 问题3：调整点歌队列播放顺序的工具

**审阅意见**：给llm提供调整点歌队列中播放顺序的工具

**新增工具设计**：

```typescript
const musicQueueTools: ToolDefinition[] = [
  {
    name: 'music_reorder_queue',
    description: '调整播放队列中歌曲的顺序',
    parameters: {
      type: 'object',
      properties: {
        from: { type: 'number', description: '要移动的歌曲在队列中的索引（从0开始）' },
        to: { type: 'number', description: '目标位置索引' }
      },
      required: ['from', 'to']
    },
    execute: async (args, ctx) => {
      // 调用后端 music.reorder 方法
    }
  },
  {
    name: 'music_remove_from_queue',
    description: '从播放队列中移除指定歌曲',
    parameters: {
      type: 'object',
      properties: {
        index: { type: 'number', description: '要移除的歌曲索引（从0开始）' }
      },
      required: ['index']
    }
  },
  {
    name: 'music_move_to_top',
    description: '将队列中的某首歌移到下一首播放位置',
    parameters: {
      type: 'object',
      properties: {
        index: { type: 'number', description: '歌曲索引' }
      },
      required: ['index']
    }
  }
]
```

**使用场景**：
- 用户："能先播我点的歌吗" → LLM 调用 `music_get_queue` 找到该用户点的歌 → 调用 `music_move_to_top`
- 主播："把那首XXX挪到后面" → LLM 搜索队列 → 调用 `music_reorder_queue`
- 舰长："我想插队" → LLM 识别权限 → 调用 `music_move_to_top`

**通信协议新增方法**：

| 方法名 | 参数 | 描述 |
|--------|------|------|
| `music.reorder` | `{ from, to }` | 移动队列中歌曲位置 |
| `music.remove` | `{ index }` | 移除队列中某首歌 |

---

### 问题4：通用窗口设计

**审阅意见**：是否考虑设计一种通用窗口，只是给不同场景启用不同功能

**现有设计的冗余**：
- Live2D窗口、展示板窗口、点歌机窗口 → 三个独立的 BrowserWindow
- 代码重复：窗口创建、透明度、置顶、拖拽等逻辑

**重构为通用窗口系统**：

```typescript
interface UniversalWindowConfig {
  id: string                      // 窗口唯一标识
  type: 'live2d' | 'display' | 'music' | 'custom'
  
  // 窗口基础属性
  width: number
  height: number
  x?: number
  y?: number
  transparent: boolean
  alwaysOnTop: boolean
  frame: boolean                  // 是否显示边框
  
  // 启用的功能模块
  modules: {
    live2d?: Live2DModuleConfig
    textDisplay?: TextDisplayModuleConfig
    musicPlayer?: MusicPlayerModuleConfig
    customHtml?: string           // 自定义HTML路径
  }
}

interface Live2DModuleConfig {
  enabled: boolean
  modelPath: string
  scale: number
  position: { x: number; y: number }
}

interface TextDisplayModuleConfig {
  enabled: boolean
  style: 'bubble' | 'subtitle' | 'markdown'
  fontSize: number
  fontFamily: string
  backgroundColor: string
  padding: number
}

interface MusicPlayerModuleConfig {
  enabled: boolean
  layout: 'compact' | 'full' | 'lyrics-only'
  showCover: boolean
  showLyrics: boolean
  showProgress: boolean
}
```

**窗口管理器重构**：

```typescript
class UniversalWindowManager {
  private windows = new Map<string, BrowserWindow>()
  
  createWindow(config: UniversalWindowConfig): string {
    const win = new BrowserWindow({
      width: config.width,
      height: config.height,
      transparent: config.transparent,
      alwaysOnTop: config.alwaysOnTop,
      frame: config.frame,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false
      }
    })
    
    // 加载通用渲染器，根据 config.modules 动态启用功能
    win.loadFile('renderer/universal.html')
    win.webContents.send('init-modules', config.modules)
    
    this.windows.set(config.id, win)
    return config.id
  }
  
  updateModule(windowId: string, moduleName: string, data: any): void {
    const win = this.windows.get(windowId)
    win?.webContents.send(`update-${moduleName}`, data)
  }
}
```

**优势**：
1. **代码复用**：一套窗口管理逻辑
2. **灵活组合**：可在同一窗口同时显示 Live2D + 文本展示板
3. **易扩展**：新增功能只需添加模块，无需创建新窗口类型
4. **用户友好**：减少窗口数量，可配置"一窗多用"

**典型配置示例**：

```json
{
  "windows": [
    {
      "id": "main-vtuber",
      "width": 1000,
      "height": 800,
      "transparent": true,
      "modules": {
        "live2d": {
          "enabled": true,
          "modelPath": "./models/my_vtuber.model3.json"
        },
        "textDisplay": {
          "enabled": true,
          "style": "bubble",
          "fontSize": 24
        }
      }
    },
    {
      "id": "music-info",
      "width": 400,
      "height": 600,
      "transparent": false,
      "modules": {
        "musicPlayer": {
          "enabled": true,
          "layout": "full",
          "showCover": true,
          "showLyrics": true
        }
      }
    }
  ]
}
```

---

### 问题5：Node.js 采用 WebUI 而非 GUI

**审阅意见**：如果采用node，是否考虑webui而非gui

**WebUI vs Electron GUI 对比**：

| 维度 | WebUI（纯 Web 服务） | Electron GUI |
|------|---------------------|--------------|
| **部署** | 浏览器访问，无需安装 | 需要安装客户端 |
| **OBS集成** | 通过浏览器源，需手动刷新 | 窗口捕获，透明背景原生支持 |
| **性能** | WebGL 性能相同 | WebGL 性能相同 |
| **窗口管理** | 需手动调整浏览器窗口 | API 控制窗口位置/大小/置顶 |
| **音频输出** | 受浏览器限制，设备选择困难 | Node.js 可直接控制输出设备 |
| **跨平台** | 完全跨平台 | 需打包不同平台版本 |

**混合方案**（推荐）：

```
┌─────────────────────────────────────────────────┐
│          独立后端（Node.js + Express）           │
│                                                 │
│  ┌──────────────┐      ┌──────────────┐        │
│  │ WebSocket    │      │ HTTP Server  │        │
│  │ (Koishi通信) │      │ (WebUI服务)  │        │
│  └──────────────┘      └──────────────┘        │
│                              │                   │
│  ┌──────────────────────────┴────────────┐     │
│  │         业务逻辑层                     │     │
│  │  - Live2D 控制                         │     │
│  │  - 点歌机控制                          │     │
│  │  - 音频播放                            │     │
│  └────────────────────────────────────────┘     │
└─────────────────────────────────────────────────┘
         │                          │
         │                          ↓
         │                   ┌──────────────┐
         │                   │ Web UI       │
         │                   │ localhost:端口│
         │                   │ (配置界面)    │
         │                   └──────────────┘
         ↓
  ┌──────────────┐
  │ Electron     │
  │ (可选窗口层) │
  │ - Live2D窗口 │
  │ - 展示板窗口 │
  └──────────────┘
```

**最终方案**：

**采用"WebUI + 可选 Electron 窗口"混合架构**

1. **核心服务**：纯 Node.js + Express + WebSocket
   - 提供 HTTP API 和 WebSocket 接口
   - 业务逻辑完全独立于 UI 层

2. **配置界面**：WebUI（浏览器访问）
   - 地址：`http://localhost:9600`
   - 功能：配置模型路径、点歌机设置、窗口布局等

3. **展示窗口**：两种模式可选

   **模式A：Electron 窗口（默认，功能最完整）**
   - 透明窗口、窗口置顶
   - OBS 窗口捕获
   - 音频输出设备精确控制

   **模式B：纯 WebUI（轻量部署）**
   - 用户手动打开浏览器标签页
   - OBS 使用"浏览器源"捕获
   - 音频输出到默认设备

   通过配置切换：
   ```json
   {
     "displayMode": "electron",  // 或 "webui"
     "electronWindows": [...]    // 仅 electron 模式生效
   }
   ```

**优势**：
- 灵活部署：服务器环境可纯 WebUI，桌面环境可用 Electron 增强
- 开发简单：WebUI 调试方便，Electron 仅作为可选壳
- OBS 友好：Electron 窗口捕获最稳定

---

## 核心架构调整后的完整设计

### 系统架构图（修订版）

```
┌──────────────────────────────────────────────────────────────────┐
│                    独立后端 (Node.js 服务)                        │
│                                                                   │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │               通信与服务层                                   │ │
│  │  ┌──────────────┐    ┌──────────────┐   ┌──────────────┐  │ │
│  │  │ WebSocket    │    │ HTTP/WS      │   │ Electron壳   │  │ │
│  │  │ (与Koishi)   │    │ (WebUI服务)  │   │ (可选)       │  │ │
│  │  └──────┬───────┘    └──────┬───────┘   └──────┬───────┘  │ │
│  └─────────┼────────────────────┼──────────────────┼──────────┘ │
│            │                    │                  │            │
│  ┌─────────┴────────────────────┴──────────────────┴──────────┐ │
│  │                    业务逻辑层                                │ │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐    │ │
│  │  │ Live2D模块   │  │ 点歌机模块   │  │ 通用窗口模块  │    │ │
│  │  │ - 模型管理   │  │ - 多音源     │  │ - 模块组合   │    │ │
│  │  │ - 表情控制   │  │ - 队列管理   │  │ - 渲染控制   │    │ │
│  │  │ - 动作控制   │  │ - 顺序调整   │  │ - 布局管理   │    │ │
│  │  └──────────────┘  └──────────────┘  └──────────────┘    │ │
│  └──────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────┘
                            ↕ WebSocket
┌──────────────────────────────────────────────────────────────────┐
│                   Koishi 插件 (vtuber)                            │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │ 事件接收器   │→ │ 触发器系统   │→ │ LLM请求系统  │→ 输出   │
│  │ (adapter-    │  │ - 4种模式    │  │ - 4种协议    │          │
│  │  bililive)   │  │ - 事件缓存   │  │ - 工具系统   │          │
│  └──────────────┘  └──────────────┘  └──────────────┘          │
└──────────────────────────────────────────────────────────────────┘
```

### 新增/修改的设计要点

#### 1. 变量系统（修正版）

```typescript
interface BuiltinVariables {
  // ✅ 事件相关（直接可用）
  '{{event.type}}': string
  '{{event.user.name}}': string
  '{{event.user.fansMedal}}': string
  '{{event.data}}': any
  
  // ✅ 历史记录（插件缓存）
  '{{history.danmaku}}': string      // 最近N条弹幕（可配置数量）
  '{{history.gifts}}': string        // 最近N个礼物
  '{{history.superchats}}': string   // 最近N个SC
  
  // ✅ 统计信息（事件累加）
  '{{stats.online}}': number         // 当前在线人数
  '{{stats.likes}}': number          // 本场累计点赞
  
  // ✅ 时间（系统/事件记录）
  '{{time.now}}': string             // 当前时间
  '{{time.liveStarted}}': string     // 开播时间
  '{{time.liveDuration}}': string    // 直播时长
  
  // ⚠️ 需通过工具获取（不是变量）
  // {{stats.followers}} - 删除，改为工具 get_anchor_stats
}
```

**新增内置工具**：
```typescript
{
  name: 'get_anchor_stats',
  description: '获取主播的统计数据（需调用B站API，有延迟）',
  parameters: {
    type: 'object',
    properties: {
      fields: {
        type: 'array',
        items: { enum: ['followers', 'total_views', 'level'] }
      }
    }
  }
}
```

#### 2. 点歌队列管理工具（新增）

完整工具列表：

| 工具名 | 功能 | 参数 |
|-------|------|------|
| `music_search` | 搜索歌曲 | keyword, source |
| `music_add` | 添加歌曲到队列 | songId, source |
| `music_skip` | 跳过当前歌曲 | 无 |
| `music_get_queue` | 获取播放队列 | 无 |
| `music_get_now_playing` | 获取当前播放信息 | 无 |
| `music_reorder_queue` ⭐ | 调整队列顺序 | from, to |
| `music_remove_from_queue` ⭐ | 移除队列中的歌 | index |
| `music_move_to_top` ⭐ | 移到下一首位置 | index |

#### 3. 通用窗口系统（重构）

**窗口配置**：
```typescript
interface WindowConfig {
  id: string
  type: 'universal'  // 统一类型
  width: number
  height: number
  transparent: boolean
  alwaysOnTop: boolean
  
  // 动态模块组合
  modules: {
    live2d?: { modelPath: string; scale: number }
    textDisplay?: { style: 'bubble' | 'subtitle' }
    musicPlayer?: { layout: 'full' | 'compact' }
  }
}
```

**通信协议简化**：

原来的 12 个窗口相关方法 → 统一为 3 个：

| 方法名 | 参数 | 描述 |
|--------|------|------|
| `window.create` | `WindowConfig` | 创建窗口 |
| `window.updateModule` | `{ windowId, module, data }` | 更新窗口模块内容 |
| `window.close` | `{ windowId }` | 关闭窗口 |

示例：
```json
// 在 Live2D 窗口上同时显示文本
{
  "jsonrpc": "2.0",
  "method": "window.updateModule",
  "params": {
    "windowId": "main-vtuber",
    "module": "textDisplay",
    "data": { "text": "大家好！", "style": "bubble" }
  }
}
```

#### 4. 部署模式（灵活选择）

**模式A：完整模式（推荐桌面环境）**
```
Node.js 后端 + Electron 窗口 + WebUI 配置界面
- 最佳 OBS 集成体验
- 完整的音频设备控制
```

**模式B：轻量模式（适合服务器/Docker）**
```
Node.js 后端 + 纯 WebUI
- 无 GUI 依赖
- 浏览器访问所有功能
- OBS 使用浏览器源
```

配置切换：
```json
{
  "backend": {
    "mode": "full",  // 或 "headless"
    "webui": {
      "enabled": true,
      "port": 9600
    },
    "electron": {
      "enabled": true,  // headless 模式下为 false
      "windows": [...]
    }
  }
}
```

---

## 技术选型最终确认

| 组件 | 技术方案 | 理由 |
|------|---------|------|
| Koishi 插件 | TypeScript + Koishi SDK | 原生生态 |
| 独立后端核心 | Node.js + Express + WS | 与 Koishi 技术栈一致 |
| 配置界面 | Web UI (React/Vue) | 跨平台、易开发 |
| 展示窗口 | Electron (可选) + WebGL | 性能足够 + OBS 友好 |
| Live2D 渲染 | pixi-live2d-display | 成熟库 + GPU 加速 |
| 点歌机 | 复用 AynaLivePlayer 逻辑 | 避免重复造轮子 |
| 音频播放 | Web Audio API + node-speaker | 灵活设备控制 |

---

## 下一步行动

请确认以下调整：
1. ✅ 变量系统的数据来源已明确，无法获取的改为工具
2. ✅ Live2D 渲染保持 pixi-live2d-display，性能足够
3. ✅ 新增 3 个点歌队列管理工具
4. ✅ 重构为通用窗口系统，减少代码冗余
5. ✅ 采用 WebUI + 可选 Electron 混合架构

确认后，我将：
1. 更新完整设计文档（DESIGN.md）
2. 开始第一阶段开发：核心框架搭建


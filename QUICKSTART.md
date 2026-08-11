# 快速开始指南

## 5 分钟快速部署

### 第一步：安装依赖

```bash
# 安装 Koishi 插件依赖
cd external/vtuber
npm install

# 安装后端依赖
cd backend
npm install
cd ..
```

### 第二步：编译项目

```bash
# 编译 Koishi 插件
npm run build

# 编译后端
cd backend
npm run build
cd ..
```

### 第三步：配置最小化设置

创建 `backend/config.json`：

```json
{
  "server": {
    "host": "localhost",
    "port": 8765
  }
}
```

### 第四步：启动服务

```bash
# 启动后端（新终端）
cd backend
npm start

# 启动 Koishi（已有实例）
# 在 Koishi 控制台启用 vtuber 插件
```

### 第五步：最小化 Koishi 配置

在 Koishi 控制台中配置：

```yaml
# 必填项
llm:
  provider: anthropic
  apiKey: sk-ant-xxx
  model: claude-sonnet-4-20250514

backend:
  enabled: true
  host: localhost
  port: 8765

# 可选但推荐
eventReceiver:
  enabledEvents:
    danmaku: true
    gift: true
    superchat: true

triggers:
  - mode: debounce
    eventTypes: [danmaku]
    delay: 5000
    maxBatch: 10
```

## 测试配置

### 1. 测试后端连接

在 Koishi 控制台查看日志，应该看到：

```
[vtuber] 后端客户端已连接
```

### 2. 测试事件接收

发送一条弹幕到直播间，查看 Koishi 日志：

```
[vtuber] 收到事件: danmaku
```

### 3. 测试 LLM 响应

等待触发器时间窗口结束（默认5秒），LLM 应该生成回复并发送到直播间。

## 常见问题

### Q: 后端连接失败？

**A:** 检查：
1. 后端是否启动成功
2. 端口 8765 是否被占用
3. 配置文件中的 host 和 port 是否一致

### Q: 没有收到直播间事件？

**A:** 检查：
1. `adapter-bililive` 是否已安装并配置
2. 是否已成功连接到直播间
3. eventReceiver 配置中对应事件是否启用

### Q: LLM 不回复？

**A:** 检查：
1. API Key 是否正确
2. 模型名称是否正确
3. 触发器配置是否正确
4. 查看 Koishi 日志中的错误信息

### Q: TTS 不播放？

**A:** 检查：
1. TTS 配置是否完整
2. 后端是否正常运行
3. 音频输出设备是否可用

## 进阶配置

### 添加 TTS 支持

```yaml
tts:
  provider: volcengine
  apiKey: your-api-key
  appId: your-app-id
  voiceType: zh_female_tianmeixiaoyuan
```

### 配置 Live2D

```json
{
  "live2d": {
    "modelPath": "D:/models/live2d/my_model",
    "defaultExpression": "normal",
    "defaultScale": 1.0
  }
}
```

### 配置点歌机

```json
{
  "music": {
    "sources": ["netease", "qq"],
    "maxDuration": 300,
    "autoPlay": true
  }
}
```

## 下一步

- 阅读 [完整文档](README.md) 了解所有功能
- 查看 [设计文档](DESIGN.md) 了解架构细节
- 自定义提示词和触发器规则
- 添加自定义工具

## 获取帮助

- 查看日志文件排查问题
- 搜索 GitHub Issues
- 提交新的 Issue

祝使用愉快！🎉

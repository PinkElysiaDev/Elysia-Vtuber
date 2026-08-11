# Koishi Vtuber - 项目文档索引

欢迎使用 Koishi Vtuber AI 虚拟主播系统！

## 🚀 快速开始

**新用户？** 从这里开始：
1. 阅读 [快速开始指南](QUICKSTART.md) - 5分钟部署
2. 查看 [配置示例](config.example.yml) - 最小化配置
3. 参考 [使用说明](README.md) - 详细功能介绍

## 📚 文档导航

### 用户文档

| 文档 | 说明 | 适合人群 |
|------|------|---------|
| [QUICKSTART.md](QUICKSTART.md) | 5分钟快速部署指南 | 🆕 新用户 |
| [README.md](README.md) | 完整使用说明 | 📖 所有用户 |
| [config.example.yml](config.example.yml) | Koishi 配置示例 | ⚙️ 配置参考 |
| [backend/config.example.json](backend/config.example.json) | 后端配置示例 | ⚙️ 配置参考 |

### 开发文档

| 文档 | 说明 | 适合人群 |
|------|------|---------|
| [DESIGN.md](DESIGN.md) | 顶层设计文档（667行） | 🏗️ 架构师/开发者 |
| [DEVELOPMENT.md](DEVELOPMENT.md) | 开发指南 | 👨‍💻 开发者 |
| [API.md](API.md) | API 参考文档 | 🔧 集成开发者 |

### 项目管理文档

| 文档 | 说明 | 适合人群 |
|------|------|---------|
| [PROJECT_SUMMARY.md](PROJECT_SUMMARY.md) | 项目实施报告 | 📊 项目经理 |
| [DELIVERY.md](DELIVERY.md) | 项目交付清单 | ✅ 验收人员 |

## 🎯 按使用场景选择文档

### 场景 1：我想快速试用
👉 **路径：** QUICKSTART.md → README.md

### 场景 2：我想了解架构
👉 **路径：** DESIGN.md → PROJECT_SUMMARY.md

### 场景 3：我想二次开发
👉 **路径：** DEVELOPMENT.md → API.md → 源码

### 场景 4：我想部署到生产
👉 **路径：** README.md → config.example.yml → 故障排查章节

### 场景 5：我想添加新功能
👉 **路径：** DEVELOPMENT.md（扩展点章节）→ API.md → 源码

## 📁 项目结构

```
vtuber/
├── 📄 文档（你在这里）
│   ├── INDEX.md                  # 本文档
│   ├── QUICKSTART.md            # 快速开始
│   ├── README.md                # 使用说明
│   ├── DESIGN.md                # 设计文档
│   ├── DEVELOPMENT.md           # 开发指南
│   ├── API.md                   # API 文档
│   ├── PROJECT_SUMMARY.md       # 项目报告
│   └── DELIVERY.md              # 交付清单
│
├── 📦 Koishi 插件
│   ├── src/                     # 源码
│   ├── lib/                     # 编译输出
│   ├── package.json
│   └── tsconfig.json
│
└── 🖥️ 独立后端
    ├── src/                     # 源码
    ├── renderer/                # 前端页面
    ├── dist/                    # 编译输出
    ├── package.json
    └── tsconfig.json
```

## 🔑 核心概念

### 事件流
```
Bilibili 直播间
  ↓ (adapter-bililive)
事件接收器
  ↓ (标准化)
触发器系统
  ↓ (聚合)
LLM 请求
  ↓ (生成回复)
输出处理器
  ↓
弹幕 / TTS / 展示板
```

### 模块划分
- **事件处理**：接收、标准化、缓存
- **触发器**：立即、延迟合并、跨类型合并
- **LLM**：提示词、变量、工具调用
- **TTS**：语音合成、播放
- **输出**：弹幕、展示板、语音

### 后端架构
- **通信层**：WebSocket + JSON-RPC
- **窗口管理**：Electron 多窗口
- **Live2D**：模型、表情、动作
- **点歌机**：搜索、播放、队列

## 🛠️ 常用命令

### Koishi 插件
```bash
# 安装依赖
npm install

# 编译
npm run build

# 开发模式（热重载）
npm run dev
```

### 独立后端
```bash
# 安装依赖
cd backend && npm install

# 编译
npm run build

# 启动（Node.js 模式）
npm start

# 启动（Electron 模式）
npm run electron
```

## 🔍 快速查找

### 我想找...

**配置项说明** → README.md（配置章节）  
**API 接口** → API.md  
**错误代码** → API.md（错误代码章节）  
**性能指标** → PROJECT_SUMMARY.md（性能指标章节）  
**扩展方法** → DEVELOPMENT.md（扩展性章节）  
**使用场景** → PROJECT_SUMMARY.md（使用场景章节）  
**故障排查** → README.md（故障排查章节）  
**代码示例** → DEVELOPMENT.md  

## 📞 获取帮助

### 问题类型对照表

| 问题类型 | 查看文档 | 章节 |
|---------|---------|------|
| 如何安装？ | QUICKSTART.md | 安装步骤 |
| 如何配置？ | README.md | 配置章节 |
| 配置项含义？ | config.example.yml | 注释说明 |
| API 怎么调用？ | API.md | 具体 API |
| 如何添加功能？ | DEVELOPMENT.md | 扩展点 |
| 性能如何？ | PROJECT_SUMMARY.md | 性能指标 |
| 出错了怎么办？ | README.md | 故障排查 |
| 架构是什么样？ | DESIGN.md | 系统架构 |
| 有哪些功能？ | README.md | 功能特性 |
| 如何调试？ | DEVELOPMENT.md | 调试技巧 |

## 🎓 学习路径

### 初级用户
1. 阅读 QUICKSTART.md，完成基础部署
2. 阅读 README.md 前半部分，了解核心功能
3. 参考 config.example.yml，调整配置
4. 实际测试，查看日志

### 中级用户
1. 阅读 DESIGN.md，理解架构设计
2. 阅读 README.md 完整内容
3. 查看 API.md，了解所有接口
4. 尝试自定义提示词和触发器

### 高级用户
1. 阅读 DEVELOPMENT.md，掌握扩展方法
2. 研究源码，理解实现细节
3. 添加自定义工具和功能
4. 参与项目贡献

## 📊 文档统计

| 文档 | 行数 | 字数 | 主题 |
|------|------|------|------|
| DESIGN.md | 667 | ~15000 | 架构设计 |
| README.md | 500+ | ~10000 | 使用说明 |
| API.md | 700+ | ~12000 | API 参考 |
| DEVELOPMENT.md | 600+ | ~11000 | 开发指南 |
| PROJECT_SUMMARY.md | 400+ | ~8000 | 项目报告 |
| QUICKSTART.md | 150+ | ~3000 | 快速开始 |
| DELIVERY.md | 300+ | ~6000 | 交付清单 |
| **总计** | **3000+** | **~65000** | **完整文档** |

## ⭐ 推荐阅读顺序

### 路径 A：快速上手（30分钟）
1. INDEX.md（本文）- 5 分钟
2. QUICKSTART.md - 10 分钟
3. README.md（核心功能部分）- 15 分钟

### 路径 B：深入理解（2小时）
1. INDEX.md（本文）- 5 分钟
2. DESIGN.md - 40 分钟
3. README.md - 30 分钟
4. API.md（浏览）- 20 分钟
5. PROJECT_SUMMARY.md - 25 分钟

### 路径 C：开发者全览（4小时）
1. 路径 B 的所有内容 - 2 小时
2. DEVELOPMENT.md - 1 小时
3. API.md（详细阅读）- 40 分钟
4. 源码浏览 - 20 分钟

## 💡 提示

- 📌 所有文档都使用 Markdown 格式，可以用任何文本编辑器打开
- 🔗 文档之间有交叉引用，方便跳转
- 📝 配置文件有详细注释，可直接参考
- 🐛 遇到问题先查看"故障排查"章节
- 💬 代码注释完整，可直接阅读源码

## 🎉 开始使用

准备好了吗？

- **新用户** → [QUICKSTART.md](QUICKSTART.md)
- **开发者** → [DESIGN.md](DESIGN.md)
- **运维人员** → [README.md](README.md)

祝使用愉快！🚀

---

**项目版本：** v1.0.0  
**文档更新日期：** 2026-08-11  
**维护状态：** ✅ 活跃维护

#pragma once

#include <string>

namespace vtuber::webui {

namespace {

const char* kBaseCss = R"css(
:root {
  --bg-main: #090d16;
  --bg-gradient: radial-gradient(circle at 50% 0%, #151d30 0%, #090d16 80%);
  --bg-card: rgba(18, 26, 42, 0.75);
  --bg-card-hover: rgba(28, 39, 62, 0.88);
  --bg-glass: rgba(15, 23, 42, 0.65);
  --bg-input: rgba(10, 15, 26, 0.7);
  --border-color: rgba(255, 255, 255, 0.08);
  --border-highlight: rgba(56, 189, 248, 0.35);
  --text-primary: #f8fafc;
  --text-secondary: #94a3b8;
  --text-muted: #64748b;
  --accent-cyan: #38bdf8;
  --accent-cyan-glow: rgba(56, 189, 248, 0.35);
  --accent-purple: #a855f7;
  --accent-purple-glow: rgba(168, 85, 247, 0.35);
  --accent-emerald: #10b981;
  --accent-emerald-glow: rgba(16, 185, 129, 0.35);
  --accent-amber: #f59e0b;
  --accent-amber-glow: rgba(245, 158, 11, 0.35);
  --accent-rose: #f43f5e;
  --accent-rose-glow: rgba(244, 63, 94, 0.35);
  --shadow-lg: 0 12px 32px rgba(0, 0, 0, 0.35);
  --radius-sm: 8px;
  --radius-md: 14px;
  --radius-lg: 20px;
  --radius-full: 9999px;
  --blur-card: blur(16px);
  --transition: 0.25s cubic-bezier(0.4, 0, 0.2, 1);
}

[data-theme="light"] {
  --bg-main: #f1f5f9;
  --bg-gradient: radial-gradient(circle at 50% 0%, #ffffff 0%, #e2e8f0 85%);
  --bg-card: rgba(255, 255, 255, 0.85);
  --bg-card-hover: rgba(255, 255, 255, 0.98);
  --bg-glass: rgba(241, 245, 249, 0.8);
  --bg-input: rgba(248, 250, 252, 0.95);
  --border-color: rgba(0, 0, 0, 0.08);
  --border-highlight: rgba(14, 165, 233, 0.45);
  --text-primary: #0f172a;
  --text-secondary: #475569;
  --text-muted: #94a3b8;
  --accent-cyan: #0284c7;
  --accent-cyan-glow: rgba(2, 132, 199, 0.25);
  --accent-purple: #9333ea;
  --accent-purple-glow: rgba(147, 51, 234, 0.25);
  --accent-emerald: #059669;
  --accent-emerald-glow: rgba(5, 150, 105, 0.25);
  --accent-amber: #d97706;
  --accent-amber-glow: rgba(217, 119, 6, 0.25);
  --accent-rose: #e11d48;
  --accent-rose-glow: rgba(225, 29, 72, 0.25);
  --shadow-lg: 0 12px 32px rgba(15, 23, 42, 0.08);
}

* { box-sizing: border-box; margin: 0; padding: 0; font-family: Inter, system-ui, -apple-system, sans-serif; }
body { min-height: 100vh; background: var(--bg-main); background-image: var(--bg-gradient); color: var(--text-primary); transition: background var(--transition), color var(--transition); }
button, input, textarea, select { font: inherit; }
a { color: inherit; text-decoration: none; }

.glass-panel {
  background: var(--bg-card);
  backdrop-filter: var(--blur-card);
  -webkit-backdrop-filter: var(--blur-card);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
  transition: all var(--transition);
}

.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 10px 16px;
  border-radius: var(--radius-md);
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  border: 1px solid var(--border-color);
  background: var(--bg-card);
  color: var(--text-primary);
  backdrop-filter: blur(8px);
  transition: all var(--transition);
  outline: none;
}
.btn:hover {
  background: var(--bg-card-hover);
  border-color: var(--accent-cyan);
  color: var(--accent-cyan);
  transform: translateY(-2px);
  box-shadow: 0 4px 14px var(--accent-cyan-glow);
}
.btn:active { transform: translateY(0); }
.btn-primary { background: linear-gradient(135deg, var(--accent-cyan), var(--accent-purple)); border: none; color: #fff !important; }
.btn-primary:hover { opacity: 0.92; box-shadow: 0 6px 20px var(--accent-purple-glow); }
.btn-success { background: linear-gradient(135deg, var(--accent-emerald), #34d399); border: none; color: #fff !important; }
.btn-danger { background: linear-gradient(135deg, var(--accent-rose), #fb7185); border: none; color: #fff !important; }
.btn-sm { padding: 6px 12px; font-size: 12px; border-radius: var(--radius-sm); }
.btn-icon { width: 38px; height: 38px; padding: 0; border-radius: var(--radius-full); }

.badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 10px;
  border-radius: var(--radius-full);
  font-size: 12px;
  font-weight: 600;
  background: rgba(56, 189, 248, 0.12);
  color: var(--accent-cyan);
  border: 1px solid rgba(56, 189, 248, 0.25);
}
.badge-success { background: rgba(16, 185, 129, 0.12); color: var(--accent-emerald); border-color: rgba(16, 185, 129, 0.25); }
.badge-warning { background: rgba(245, 158, 11, 0.12); color: var(--accent-amber); border-color: rgba(245, 158, 11, 0.25); }
.badge-danger { background: rgba(244, 63, 94, 0.12); color: var(--accent-rose); border-color: rgba(244, 63, 94, 0.25); }

.input-control {
  width: 100%;
  padding: 10px 14px;
  background: var(--bg-input);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  color: var(--text-primary);
  font-size: 14px;
  outline: none;
  transition: all var(--transition);
}
.input-control:focus { border-color: var(--accent-cyan); box-shadow: 0 0 12px var(--accent-cyan-glow); }

.theme-toggle {
  position: relative;
  width: 52px;
  height: 28px;
  border-radius: 14px;
  background: var(--bg-input);
  border: 1px solid var(--border-color);
  cursor: pointer;
  display: flex;
  align-items: center;
  padding: 3px;
  transition: all var(--transition);
}
.theme-toggle .toggle-knob {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: linear-gradient(135deg, var(--accent-cyan), var(--accent-purple));
  transition: transform var(--transition);
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-size: 11px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
}
[data-theme="light"] .theme-toggle .toggle-knob {
  transform: translateX(24px);
  background: linear-gradient(135deg, var(--accent-amber), #f97316);
}

@keyframes spinRecord { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
@keyframes floatCard { 0%, 100% { transform: translateY(0px); } 50% { transform: translateY(-6px); } }
@keyframes slideInRight { from { opacity: 0; transform: translateX(30px); } to { opacity: 1; transform: translateX(0); } }
.animate-spin { animation: spinRecord 20s linear infinite; }
.animate-float { animation: floatCard 4s ease-in-out infinite; }

.shell { display: grid; grid-template-columns: 250px 1fr; min-height: 100vh; }
.sidebar { background: var(--bg-card); border-right: 1px solid var(--border-color); padding: 24px 16px; backdrop-filter: blur(16px); display: flex; flex-direction: column; }
.brand { display: flex; align-items: center; gap: 10px; font-weight: 800; font-size: 20px; margin: 0 0 24px; background: linear-gradient(135deg, var(--accent-cyan), var(--accent-purple)); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
.nav-link { display: flex; align-items: center; gap: 10px; color: var(--text-secondary); padding: 12px 14px; border-radius: var(--radius-md); margin-bottom: 8px; font-weight: 600; font-size: 14px; transition: var(--transition); }
.nav-link:hover, .nav-link.active { background: rgba(56, 189, 248, 0.12); color: var(--accent-cyan); }
.content { padding: 32px; max-width: 1300px; width: 100%; margin: 0 auto; }
.page-title { margin: 0 0 24px; font-size: 28px; font-weight: 800; background: linear-gradient(135deg, var(--accent-cyan), var(--accent-purple)); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
.top-bar { display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px; }
pre { background: var(--bg-input); border: 1px solid var(--border-color); border-radius: var(--radius-md); padding: 16px; overflow: auto; color: var(--accent-cyan); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; line-height: 1.6; }
)css";

const char* kClientScript = R"js(
class VtuberRPC {
  constructor() {
    this.wsUrl = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.hostname || 'localhost'}:19275`;
    this.ws = null;
    this.id = 1;
    this.pending = new Map();
    this.listeners = new Map();
    this.waiters = [];
    this.reconnectTimer = null;
    this.init();
  }
  init() {
    const saved = localStorage.getItem('vtuber_webui_theme') || (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
    this.setTheme(saved);
    this.connect();
  }
  setTheme(t) {
    document.documentElement.setAttribute('data-theme', t);
    localStorage.setItem('vtuber_webui_theme', t);
    const knob = document.querySelector('.theme-toggle .toggle-knob');
    if (knob) knob.textContent = t === 'light' ? '☀️' : '🌙';
  }
  toggleTheme() {
    const next = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
    this.setTheme(next);
    return next;
  }
  isOpen() {
    return this.ws && this.ws.readyState === WebSocket.OPEN;
  }
  flushWaiters() {
    const q = this.waiters.splice(0);
    q.forEach(fn => { try { fn(); } catch(e){} });
  }
  scheduleReconnect() {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, 1500);
  }
  connect() {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return;
    try {
      this.ws = new WebSocket(this.wsUrl);
      this.ws.onopen = () => {
        const dot = document.getElementById('wsDot');
        if (dot) { dot.className = 'badge badge-success'; dot.textContent = '● 已连接'; }
        this.emit('connected', true);
        this.flushWaiters();
      };
      this.ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          if (msg.id != null && this.pending.has(msg.id)) {
            const { resolve, reject } = this.pending.get(msg.id);
            this.pending.delete(msg.id);
            if (msg.error) reject(msg.error); else resolve(msg.result);
            return;
          }
          if (msg.method) this.emit(msg.method, msg.params || {});
        } catch(err) {}
      };
      this.ws.onclose = () => {
        const dot = document.getElementById('wsDot');
        if (dot) { dot.className = 'badge badge-danger'; dot.textContent = '○ 未连接'; }
        this.emit('disconnected', false);
        this.scheduleReconnect();
      };
      this.ws.onerror = () => {};
    } catch(e) {
      this.scheduleReconnect();
    }
  }
  whenReady(timeoutMs = 15000) {
    if (this.isOpen()) return Promise.resolve();
    this.connect();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter(w => w !== onOk);
        reject(new Error('WebSocket 连接超时，请确认后端已启动'));
      }, timeoutMs);
      const onOk = () => { clearTimeout(timer); resolve(); };
      this.waiters.push(onOk);
    });
  }
  call(method, params = {}) {
    return this.whenReady().then(() => new Promise((resolve, reject) => {
      if (!this.isOpen()) return reject(new Error('WebSocket not connected'));
      const id = this.id++;
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
    }));
  }
  on(event, fn) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event).add(fn);
    return () => this.listeners.get(event).delete(fn);
  }
  emit(event, data) {
    if (this.listeners.has(event)) {
      this.listeners.get(event).forEach(fn => { try { fn(data); } catch(e){} });
    }
  }
}
window.vtuberRPC = new VtuberRPC();
)js";

inline std::string shell(const std::string& active, const std::string& title, const std::string& body) {
  std::string links;
  const char* items[][3] = {
    {"/", "📊", "控制台 Overview"},
    {"/live2d", "🎭", "Live2D 舞台"},
    {"/display", "💬", "字幕展示板"},
    {"/jukebox", "🎵", "点歌机 Player"},
    {"/danmaku", "✨", "弹幕姬 Overlay"},
    {"/logs", "📝", "运行日志 Logs"},
    {"/settings", "⚙️", "系统配置 Config"},
  };
  for (const auto& item : items) {
    std::string cls = (item[0] == active) ? "nav-link active" : "nav-link";
    links += "<a class=\"" + cls + "\" href=\"" + item[0] + "\"><span>" + item[1] + "</span> " + item[2] + "</a>";
  }
  return "<!doctype html><html lang=\"zh-CN\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"><title>" + title + " - Koishi Vtuber</title><style>" + kBaseCss + "</style></head><body><div class=\"shell\"><aside class=\"sidebar\"><div class=\"brand\">🎭 Koishi Vtuber</div><nav style=\"flex: 1;\">" + links + "</nav><div style=\"padding-top: 16px; border-top: 1px solid var(--border-color);\"><div class=\"badge badge-success\" id=\"wsDot\" style=\"width: 100%; justify-content: center;\">● 连接就绪</div></div></aside><main class=\"content\"><div class=\"top-bar\"><h1 class=\"page-title\" style=\"margin-bottom:0;\">" + title + "</h1><button class=\"theme-toggle\" onclick=\"window.vtuberRPC.toggleTheme()\" title=\"切换主题\"><div class=\"toggle-knob\">🌙</div></button></div>" + body + "</main></div><script>" + kClientScript + "</script></body></html>";
}

}  // namespace

inline std::string index_html() {
  std::string body = R"html(
<style>
.dashboard-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 20px; }
.card { padding: 24px; display: flex; flex-direction: column; gap: 14px; }
.card-header { display: flex; align-items: center; justify-content: space-between; font-weight: 700; font-size: 16px; }
.btn-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
.obs-list { display: flex; flex-direction: column; gap: 8px; }
</style>

<div class="dashboard-grid">
  <!-- Live2D Expression Control -->
  <div class="glass-panel card">
    <div class="card-header">
      <span>✨ Live2D 表情动作控制</span>
      <a href="/live2d" target="_blank" class="badge">全屏舞台 ↗</a>
    </div>
    <p style="font-size: 13px; color: var(--text-secondary);">实时切换虚拟主播的面部表情和预设动作</p>
    <div class="btn-grid">
      <button class="btn btn-sm" onclick="vtuberRPC.call('live2d.setExpression', {expression:'happy'})">😄 开心</button>
      <button class="btn btn-sm" onclick="vtuberRPC.call('live2d.setExpression', {expression:'sad'})">😢 悲伤</button>
      <button class="btn btn-sm" onclick="vtuberRPC.call('live2d.setExpression', {expression:'angry'})">😡 生气</button>
      <button class="btn btn-sm" onclick="vtuberRPC.call('live2d.setExpression', {expression:'excited'})">🤩 兴奋</button>
      <button class="btn btn-sm" onclick="vtuberRPC.call('live2d.setExpression', {expression:'surprised'})">😮 惊讶</button>
      <button class="btn btn-sm" onclick="vtuberRPC.call('live2d.setExpression', {expression:'neutral'})">😐 平常</button>
    </div>
    <div style="display: flex; gap: 8px; margin-top: 4px;">
      <button class="btn btn-primary btn-sm" style="flex: 1;" onclick="vtuberRPC.call('live2d.playMotion', {group:'Idle', index:0})">💃 待机动作</button>
      <button class="btn btn-sm" style="flex: 1;" onclick="vtuberRPC.call('live2d.playMotion', {group:'Special', index:0})">✨ 特殊动作</button>
    </div>
  </div>

  <!-- Display Board Tester -->
  <div class="glass-panel card">
    <div class="card-header">
      <span>💬 字幕展示板投屏调试</span>
      <a href="/display" target="_blank" class="badge">投屏卡片 ↗</a>
    </div>
    <textarea class="input-control" id="dispMsg" rows="3" placeholder="输入要实时投送到直播画面的字幕内容..." style="resize: none;"></textarea>
    <div style="display: flex; gap: 8px;">
      <select class="input-control" id="dispEmotion" style="width: 110px;">
        <option value="neutral">😐 中性</option>
        <option value="happy">😄 快乐</option>
        <option value="sad">😢 悲伤</option>
        <option value="excited">🤩 兴奋</option>
        <option value="angry">😡 愤怒</option>
      </select>
      <button class="btn btn-primary" style="flex: 1;" onclick="sendDisplay()">发送字幕</button>
      <button class="btn btn-danger btn-sm" onclick="vtuberRPC.call('display.clear')">清屏</button>
    </div>
  </div>

  <!-- Jukebox Quick Controller -->
  <div class="glass-panel card">
    <div class="card-header">
      <span>🎵 智能点歌机控制</span>
      <a href="/jukebox" target="_blank" class="badge">点歌大厅 ↗</a>
    </div>
    <div style="display: flex; gap: 8px;">
      <input class="input-control" id="songInput" placeholder="输入歌曲名 / 歌手...">
      <button class="btn btn-primary" onclick="searchSong()">点歌</button>
    </div>
    <div style="display: flex; gap: 8px;">
      <button class="btn btn-success btn-sm" style="flex: 1;" onclick="vtuberRPC.call('jukebox.start')">▶ 播放</button>
      <button class="btn btn-sm" style="flex: 1;" onclick="vtuberRPC.call('jukebox.skip')">⏭ 切歌</button>
      <button class="btn btn-danger btn-sm" style="flex: 1;" onclick="vtuberRPC.call('jukebox.stop')">⏹ 停止</button>
    </div>
  </div>

  <!-- OBS Overlay Links -->
  <div class="glass-panel card">
    <div class="card-header">
      <span>🎥 OBS 独立挂件快捷入口</span>
      <span class="badge badge-success">透明免抠</span>
    </div>
    <div class="obs-list">
      <a href="/live2d" target="_blank" class="btn btn-sm" style="justify-content: space-between;">
        <span>🎭 Live2D Canvas 挂件</span> <span style="color:var(--accent-cyan)">/live2d ↗</span>
      </a>
      <a href="/display" target="_blank" class="btn btn-sm" style="justify-content: space-between;">
        <span>💬 动态字幕与展示板</span> <span style="color:var(--accent-cyan)">/display ↗</span>
      </a>
      <a href="/jukebox" target="_blank" class="btn btn-sm" style="justify-content: space-between;">
        <span>🎵 点歌机唱片与歌词</span> <span style="color:var(--accent-cyan)">/jukebox ↗</span>
      </a>
      <a href="/danmaku" target="_blank" class="btn btn-sm" style="justify-content: space-between;">
        <span>✨ 弹幕姬与打赏墙</span> <span style="color:var(--accent-cyan)">/danmaku ↗</span>
      </a>
    </div>
  </div>
</div>

<!-- Realtime Event Logs Preview -->
<div class="glass-panel card" style="margin-top: 20px;">
  <div class="card-header">
    <span>⚡ 实时后端 RPC 事件广播</span>
    <button class="btn btn-sm btn-danger" onclick="document.getElementById('eventLog').textContent=''">清空</button>
  </div>
  <pre id="eventLog" style="max-height: 220px;">等待 WebSocket 事件流推送...</pre>
</div>

<script>
function sendDisplay() {
  const text = document.getElementById('dispMsg').value;
  const emotion = document.getElementById('dispEmotion').value;
  if (!text) return;
  vtuberRPC.call('display.update', { text, emotion });
}
function searchSong() {
  const keyword = document.getElementById('songInput').value;
  if (!keyword) return;
  vtuberRPC.call('jukebox.search', { keyword });
}
window.addEventListener('load', () => {
  vtuberRPC.on('display.update', (data) => logEvent('display.update', data));
  vtuberRPC.on('live2d.expression', (data) => logEvent('live2d.expression', data));
  vtuberRPC.on('jukebox.state', (data) => logEvent('jukebox.state', data));
  vtuberRPC.on('danmaku.receive', (data) => logEvent('danmaku.receive', data));
});
function logEvent(method, data) {
  const log = document.getElementById('eventLog');
  log.textContent = `[${new Date().toLocaleTimeString()}] ${method}: ${JSON.stringify(data)}\n` + log.textContent.slice(0, 3000);
}
</script>
)html";
  return shell("/", "Studio 控制台", body);
}

inline std::string live2d_html() {
  std::string body = R"html(
<style>
body { overflow: hidden; background: transparent !important; background-image: none !important; }
.live-stage { position: fixed; inset: 0; display: grid; place-items: center; }
canvas { width: 100vw; height: 100vh; display: block; }
.control-dock {
  position: fixed; left: 24px; top: 24px; z-index: 10; width: 320px;
  background: var(--bg-card); border: 1px solid var(--border-color);
  border-radius: var(--radius-lg); padding: 20px; backdrop-filter: blur(16px);
  box-shadow: var(--shadow-lg); transition: all var(--transition);
}
.control-dock.minimized { transform: translateX(-260px); opacity: 0.3; }
.control-dock.minimized:hover { transform: translateX(0); opacity: 1; }
.toast {
  position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%);
  padding: 8px 20px; border-radius: var(--radius-full);
  background: var(--bg-card); border: 1px solid var(--border-color);
  color: var(--accent-cyan); font-weight: 700; font-size: 14px;
  box-shadow: var(--shadow-lg); backdrop-filter: blur(16px);
  opacity: 0; pointer-events: none; transition: all 0.3s ease;
}
.toast.show { opacity: 1; transform: translateX(-50%) translateY(-10px); }
</style>

<div class="live-stage">
  <canvas id="stageCanvas"></canvas>
</div>

<div class="control-dock" id="dock">
  <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
    <strong style="font-size: 15px; color: var(--accent-cyan);">🎭 Live2D 控制挂件</strong>
    <button class="btn btn-sm" onclick="document.getElementById('dock').classList.toggle('minimized')">收起</button>
  </div>
  <input class="input-control" id="modelUrl" placeholder="模型路径 (model3.json)" style="margin-bottom: 8px;">
  <button class="btn btn-primary btn-sm" style="width: 100%; margin-bottom: 12px;" onclick="loadModel()">加载模型</button>
  <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; margin-bottom: 8px;">
    <button class="btn btn-sm" onclick="sendExp('happy')">😄 开心</button>
    <button class="btn btn-sm" onclick="sendExp('sad')">😢 悲伤</button>
    <button class="btn btn-sm" onclick="sendExp('angry')">😡 生气</button>
    <button class="btn btn-sm" onclick="sendExp('excited')">🤩 兴奋</button>
    <button class="btn btn-sm" onclick="sendExp('surprised')">😮 惊讶</button>
    <button class="btn btn-sm" onclick="sendExp('neutral')">😐 平常</button>
  </div>
</div>

<div class="toast" id="toast">Live2D 舞台就绪</div>

<script src="https://cdn.jsdelivr.net/npm/pixi.js@7/dist/pixi.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/pixi-live2d-display@0.5.0/dist/index.min.js"></script>
<script>
let app, currentModel;
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2500);
}
function sendExp(expression) {
  vtuberRPC.call('live2d.setExpression', { expression });
  showToast('表情切换: ' + expression);
}
function loadModel() {
  const path = document.getElementById('modelUrl').value;
  if (!path) return;
  vtuberRPC.call('live2d.load', { modelPath: path });
}
window.addEventListener('load', async () => {
  const canvas = document.getElementById('stageCanvas');
  if (window.PIXI && PIXI.Application) {
    app = new PIXI.Application({
      view: canvas,
      width: window.innerWidth,
      height: window.innerHeight,
      transparent: true,
      backgroundAlpha: 0,
      antialias: true,
      resizeTo: window
    });
  }
  vtuberRPC.on('live2d.setExpression', (d) => showToast('表情: ' + (d.expression || '')));
  vtuberRPC.on('live2d.playMotion', (d) => showToast('动作: ' + (d.group || '')));
});
</script>
)html";
  return "<!doctype html><html lang=\"zh-CN\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"><title>Live2D 舞台挂件</title><style>" + std::string(kBaseCss) + "</style></head><body>" + body + "<script>" + kClientScript + "</script></body></html>";
}

inline std::string display_html() {
  std::string body = R"html(
<style>
body { overflow: hidden; background: transparent !important; background-image: none !important; display: grid; place-items: center; height: 100vh; padding: 32px; }
.display-card {
  max-width: 820px; width: 100%;
  padding: 32px 40px; border-radius: var(--radius-lg);
  background: var(--bg-card); border: 1px solid var(--border-color);
  backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px);
  box-shadow: var(--shadow-lg); transition: all 0.4s ease;
}
.subtitle-text {
  font-size: 26px; font-weight: 600; line-height: 1.6;
  text-align: center; word-break: break-word; white-space: pre-wrap;
}
.emotion-happy { color: var(--accent-emerald); text-shadow: 0 0 16px var(--accent-emerald-glow); }
.emotion-sad { color: var(--accent-cyan); text-shadow: 0 0 16px var(--accent-cyan-glow); }
.emotion-excited { color: var(--accent-amber); text-shadow: 0 0 16px var(--accent-amber-glow); }
.emotion-angry { color: var(--accent-rose); text-shadow: 0 0 16px var(--accent-rose-glow); }
.emotion-neutral { color: var(--text-primary); }
.meta-row { display: flex; justify-content: space-between; align-items: center; margin-top: 16px; font-size: 13px; color: var(--text-muted); border-top: 1px solid var(--border-color); padding-top: 12px; }
</style>

<div class="display-card animate-float" id="card">
  <div class="subtitle-text emotion-neutral" id="text">等待中控台输入字幕或对话响应...</div>
  <div class="meta-row">
    <span class="badge" id="emoBadge">中性 Neutral</span>
    <span id="timeStr">12:00:00</span>
  </div>
</div>

<script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
<script>
let timer = null;
function typewrite(elem, fullText, speed = 30) {
  if (timer) clearInterval(timer);
  elem.textContent = '';
  let i = 0;
  timer = setInterval(() => {
    if (i < fullText.length) {
      elem.textContent += fullText.charAt(i++);
    } else {
      clearInterval(timer);
    }
  }, speed);
}
window.addEventListener('load', () => {
  vtuberRPC.on('display.update', (data) => {
    const { text, emotion, style } = data;
    const elem = document.getElementById('text');
    const badge = document.getElementById('emoBadge');
    elem.className = 'subtitle-text emotion-' + (emotion || 'neutral');
    badge.textContent = (emotion || '中性').toUpperCase();
    if (style === 'markdown' && window.marked) {
      elem.innerHTML = marked.parse(text || '');
    } else {
      typewrite(elem, text || '');
    }
    document.getElementById('timeStr').textContent = new Date().toLocaleTimeString();
  });
  vtuberRPC.on('display.clear', () => {
    document.getElementById('text').textContent = '';
  });
});
</script>
)html";
  return "<!doctype html><html lang=\"zh-CN\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"><title>字幕展示板挂件</title><style>" + std::string(kBaseCss) + "</style></head><body>" + body + "<script>" + kClientScript + "</script></body></html>";
}

inline std::string jukebox_html() {
  std::string body = R"html(
<style>
.jukebox-layout { display: grid; grid-template-columns: 380px 1fr; gap: 24px; }
.vinyl-container {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  padding: 32px; text-align: center;
}
.vinyl-disc {
  width: 140px; height: 140px; border-radius: 50%;
  background: radial-gradient(circle, #111 35%, #222 36%, #000 70%);
  box-shadow: 0 8px 30px rgba(0,0,0,0.5), 0 0 20px var(--accent-cyan-glow);
  display: flex; align-items: center; justify-content: center;
  position: relative; margin-bottom: 20px;
}
.vinyl-disc img { width: 70px; height: 70px; border-radius: 50%; object-fit: cover; }
.vinyl-disc::after {
  content: ''; position: absolute; width: 18px; height: 18px;
  background: var(--bg-main); border-radius: 50%; border: 3px solid rgba(255,255,255,0.4);
}
.spectrum-box { width: 100%; height: 80px; margin: 16px 0; }
.lyric-box {
  min-height: 48px; display: flex; align-items: center; justify-content: center;
  font-size: 16px; font-weight: 700; color: var(--accent-cyan);
  text-shadow: 0 0 12px var(--accent-cyan-glow); text-align: center;
}
</style>

<div class="jukebox-layout">
  <!-- Vinyl Record & Spectrum Card -->
  <div class="glass-panel vinyl-container">
    <div class="vinyl-disc animate-spin" id="disc">
      <img src="https://images.unsplash.com/photo-1614613535308-eb5fbd3d2c17?w=150&q=80" alt="Cover" id="cover">
    </div>
    <div style="font-size: 20px; font-weight: 800; margin-bottom: 4px;" id="title">暂无播放歌曲</div>
    <div style="font-size: 14px; color: var(--text-secondary); margin-bottom: 12px;" id="artist">等待点歌指令...</div>
    <div class="badge badge-success" id="playBadge">就绪</div>

    <div class="spectrum-box">
      <canvas id="specCanvas" style="width: 100%; height: 100%;"></canvas>
    </div>
    <div class="lyric-box" id="lyricText">♪ 伴奏音乐流转中...</div>
  </div>

  <!-- Queue & Control Panel -->
  <div style="display: flex; flex-direction: column; gap: 20px;">
    <!-- Controls -->
    <div class="glass-panel" style="padding: 24px;">
      <div style="font-weight: 700; font-size: 16px; margin-bottom: 16px;">🎛️ 播放控制与音量调节</div>
      <div style="display: flex; gap: 10px; margin-bottom: 16px;">
        <button class="btn btn-primary" onclick="vtuberRPC.call('jukebox.start')">▶ 开始播放</button>
        <button class="btn btn-danger" onclick="vtuberRPC.call('jukebox.stop')">⏹ 停止</button>
        <button class="btn" onclick="vtuberRPC.call('jukebox.skip')">⏭ 切歌</button>
        <button class="btn" onclick="vtuberRPC.call('jukebox.restart', {preserveQueue:true})">🔄 重播</button>
      </div>
      <div style="display: flex; align-items: center; gap: 14px;">
        <span style="font-size: 14px; font-weight: 600;">🔊 音量:</span>
        <input type="range" id="volRange" min="0" max="100" value="80" oninput="setVol(this.value)" style="flex: 1;">
        <span id="volVal" style="font-size: 14px; font-weight: 700; width: 40px;">80%</span>
      </div>
    </div>

    <!-- Search & Queue -->
    <div class="glass-panel" style="padding: 24px; flex: 1;">
      <div style="font-weight: 700; font-size: 16px; margin-bottom: 14px;">🔎 歌曲搜索与点歌队列</div>
      <div style="display: flex; gap: 10px; margin-bottom: 16px;">
        <input class="input-control" id="searchKeyword" placeholder="搜索歌曲、歌手名...">
        <button class="btn btn-primary" onclick="searchMusic()">搜索点歌</button>
        <button class="btn btn-danger btn-sm" onclick="vtuberRPC.call('jukebox.clear')">清空队列</button>
      </div>
      <pre id="queueState" style="max-height: 220px;">正在加载点歌队列状态...</pre>
    </div>
  </div>
</div>

<script>
function setVol(v) {
  document.getElementById('volVal').textContent = v + '%';
  vtuberRPC.call('jukebox.setVolume', { volume: +v });
}
function searchMusic() {
  const kw = document.getElementById('searchKeyword').value;
  if (!kw) return;
  vtuberRPC.call('jukebox.search', { keyword: kw });
}
// Simulated Spectrum Visualizer
const canvas = document.getElementById('specCanvas');
const ctx = canvas.getContext('2d');
let bars = 28;
function drawSpectrum() {
  canvas.width = canvas.parentElement.clientWidth;
  canvas.height = canvas.parentElement.clientHeight;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const gap = 3;
  const barW = (canvas.width - (bars - 1) * gap) / bars;
  const grad = ctx.createLinearGradient(0, canvas.height, 0, 0);
  grad.addColorStop(0, '#38bdf8');
  grad.addColorStop(1, '#a855f7');
  ctx.fillStyle = grad;
  for (let i = 0; i < bars; i++) {
    const h = (Math.sin(Date.now() * 0.006 + i * 0.4) * 0.4 + 0.5) * (canvas.height * 0.85);
    const x = i * (barW + gap);
    const y = canvas.height - h;
    ctx.fillRect(x, y, barW, h);
  }
  requestAnimationFrame(drawSpectrum);
}
drawSpectrum();

window.addEventListener('load', () => {
  vtuberRPC.on('jukebox.state', (state) => {
    document.getElementById('queueState').textContent = JSON.stringify(state, null, 2);
    if (state.current) {
      document.getElementById('title').textContent = state.current.title || '未知歌曲';
      document.getElementById('artist').textContent = state.current.artist || '未知歌手';
      if (state.current.cover) document.getElementById('cover').src = state.current.cover;
    }
  });
  vtuberRPC.on('jukebox.lyric', (d) => {
    if (d && d.text) document.getElementById('lyricText').textContent = d.text;
  });
  vtuberRPC.call('jukebox.getState').catch(()=>{});
});
</script>
)html";
  return shell("/jukebox", "智能点歌机 Jukebox", body);
}

inline std::string music_html() {
  return jukebox_html();
}

inline std::string danmaku_html() {
  std::string body = R"html(
<style>
body {
  background: transparent !important; background-image: none !important;
  height: 100vh; overflow: hidden; display: flex; flex-direction: column;
  justify-content: flex-end; padding: 24px;
}
.danmaku-wall { width: 440px; display: flex; flex-direction: column; gap: 10px; }
.danmaku-card {
  padding: 12px 18px; border-radius: var(--radius-md); font-size: 14px;
  background: var(--bg-card); border: 1px solid var(--border-color);
  backdrop-filter: blur(16px); box-shadow: var(--shadow-lg);
  animation: slideInRight 0.35s cubic-bezier(0.4, 0, 0.2, 1);
  display: flex; align-items: center; gap: 10px;
}
.danmaku-card .uname { font-weight: 700; color: var(--accent-cyan); }
.danmaku-card.sc {
  background: linear-gradient(135deg, rgba(245, 158, 11, 0.25), rgba(244, 63, 94, 0.25));
  border: 1px solid var(--accent-amber); box-shadow: 0 0 20px var(--accent-amber-glow);
}
.danmaku-card.sc .uname { color: var(--accent-amber); }
</style>

<div class="danmaku-wall" id="wall">
  <div class="danmaku-card">
    <span class="uname">系统提示:</span>
    <span class="msg">弹幕姬挂件已就绪，等待直播间弹幕...</span>
  </div>
</div>

<script>
function addDanmaku(user, text, isSC = false) {
  const wall = document.getElementById('wall');
  const card = document.createElement('div');
  card.className = `danmaku-card ${isSC ? 'sc' : ''}`;
  card.innerHTML = `<span class="uname">${user}:</span><span class="msg">${text}</span>`;
  wall.appendChild(card);
  if (wall.children.length > 8) wall.removeChild(wall.firstChild);
}
window.addEventListener('load', () => {
  vtuberRPC.on('danmaku.receive', (d) => {
    addDanmaku(d.user || '观众', d.content || '', d.isSC || false);
  });
});
</script>
)html";
  return "<!doctype html><html lang=\"zh-CN\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"><title>弹幕姬挂件</title><style>" + std::string(kBaseCss) + "</style></head><body>" + body + "<script>" + kClientScript + "</script></body></html>";
}

inline std::string logs_html() {
  std::string body = R"html(
<div class="glass-panel" style="padding: 24px;">
  <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
    <div style="display: flex; gap: 10px; align-items: center;">
      <span style="font-weight: 700; font-size: 16px;">📋 实时事件与 RPC 通信日志</span>
      <span class="badge" id="logCount">0 条记录</span>
    </div>
    <div style="display: flex; gap: 8px;">
      <button class="btn btn-sm btn-danger" onclick="clearLogs()">清空日志</button>
      <button class="btn btn-sm btn-primary" onclick="copyLogs()">复制日志</button>
    </div>
  </div>
  <pre id="logArea" style="min-height: 520px; max-height: 70vh;">等待后端 WebSocket 广播与 RPC 事件...</pre>
</div>

<script>
let count = 0;
function clearLogs() {
  document.getElementById('logArea').textContent = '';
  count = 0;
  document.getElementById('logCount').textContent = '0 条记录';
}
function copyLogs() {
  navigator.clipboard.writeText(document.getElementById('logArea').textContent);
  alert('日志已复制到剪贴板！');
}
window.addEventListener('load', () => {
  const logArea = document.getElementById('logArea');
  const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.hostname}:19275`);
  ws.onmessage = (e) => {
    count++;
    document.getElementById('logCount').textContent = count + ' 条记录';
    logArea.textContent = `[${new Date().toLocaleTimeString()}] ${e.data}\n` + logArea.textContent.slice(0, 10000);
  };
});
</script>
)html";
  return shell("/logs", "运行日志 Logs", body);
}

inline std::string settings_html() {
  std::string body = R"html(
<style>
.settings-toolbar { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 18px; flex-wrap: wrap; }
.settings-tabs { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 18px; }
.settings-tab {
  padding: 8px 16px; border-radius: var(--radius-full); cursor: pointer;
  font-size: 13px; font-weight: 600; border: 1px solid var(--border-color);
  background: var(--bg-card); color: var(--text-secondary); transition: all var(--transition);
  display: inline-flex; align-items: center; gap: 6px;
}
.settings-tab:hover { border-color: var(--accent-cyan); color: var(--accent-cyan); transform: translateY(-1px); }
.settings-tab.active { background: linear-gradient(135deg, var(--accent-cyan), var(--accent-purple)); color: #fff; border-color: transparent; box-shadow: 0 4px 14px var(--accent-cyan-glow); }
.settings-pane { display: none; }
.settings-pane.active { display: block; animation: slideInRight 0.3s ease; }
.form-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 14px; }
.form-field { display: flex; flex-direction: column; gap: 6px; }
.form-field label { font-size: 13px; font-weight: 600; color: var(--text-secondary); }
.form-field .field-desc { font-size: 12px; color: var(--text-muted); }
.field-row { display: flex; gap: 8px; align-items: center; }
.field-row .input-control { flex: 1; }
input[type="checkbox"] { width: 18px; height: 18px; accent-color: var(--accent-cyan); cursor: pointer; }
input[type="range"] { -webkit-appearance: none; width: 100%; height: 6px; background: var(--bg-input); border-radius: 3px; outline: none; }
input[type="range"]::-webkit-slider-thumb { -webkit-appearance: none; width: 16px; height: 16px; border-radius: 50%; background: var(--accent-cyan); cursor: pointer; box-shadow: 0 0 10px var(--accent-cyan-glow); }
.status-toast {
  position: fixed; bottom: 28px; left: 50%; transform: translateX(-50%) translateY(20px);
  padding: 10px 22px; border-radius: var(--radius-full); font-size: 13px; font-weight: 600;
  background: var(--bg-card); border: 1px solid var(--border-color); color: var(--accent-emerald);
  box-shadow: var(--shadow-lg); backdrop-filter: blur(16px); opacity: 0; pointer-events: none;
  transition: all 0.3s ease; z-index: 999;
}
.status-toast.show { opacity: 1; transform: translateX(-50%) translateY(0); }
.status-toast.err { color: var(--accent-rose); }
.trigger-card {
  display: grid; grid-template-columns: auto 1fr; gap: 12px; padding: 16px;
  border: 1px solid var(--border-color); border-radius: var(--radius-md);
  background: var(--bg-input); margin-bottom: 10px; align-items: center;
}
.trigger-card .trigger-meta { font-size: 13px; }
.trigger-card .trigger-meta strong { color: var(--accent-cyan); }
.json-editor { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; min-height: 360px; width: 100%; line-height: 1.6; white-space: pre; }
</style>

<div class="settings-toolbar">
  <div style="display: flex; align-items: center; gap: 12px;">
    <span style="font-weight: 800; font-size: 18px;">⚙️ 系统参数配置中心</span>
    <span class="badge badge-success" id="cfgStatus">已连接</span>
    <span class="badge" id="cfgPathBadge">config</span>
  </div>
  <div style="display: flex; gap: 8px; flex-wrap: wrap;">
    <button class="btn btn-success" onclick="saveSection()">💾 保存当前分区</button>
    <button class="btn btn-primary" onclick="applyConfig()">🔥 热重载生效</button>
    <button class="btn" onclick="reloadConfig()">🔄 从磁盘重载</button>
  </div>
</div>

<div class="settings-tabs" id="tabBar"></div>

<!-- ==================== 分区编辑 ==================== -->
<div class="settings-pane" id="pane-form">
  <div class="glass-panel" style="padding: 24px;">
    <div class="form-grid" id="formFields"></div>
    <div style="display: flex; gap: 8px; margin-top: 18px; flex-wrap: wrap;" id="sectionActions"></div>
  </div>
</div>

<!-- ==================== JSON 编辑器 ==================== -->
<div class="settings-pane" id="pane-json">
  <div class="glass-panel" style="padding: 24px;">
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px;">
      <span style="font-weight: 700;">📄 完整 JSON 配置（精确编辑）</span>
      <div style="display: flex; gap: 8px;">
        <button class="btn btn-sm btn-success" onclick="saveFullJson()">保存全部</button>
        <button class="btn btn-sm" onclick="formatJson()">格式化</button>
      </div>
    </div>
    <textarea class="input-control json-editor" id="cfgJson" spellcheck="false">加载中...</textarea>
  </div>
</div>

<!-- ==================== 触发器可视化 ==================== -->
<div class="settings-pane" id="pane-triggers">
  <div class="glass-panel" style="padding: 24px;">
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px;">
      <span style="font-weight: 700;">⚡ 事件触发器规则（决定何时调用 LLM）</span>
      <button class="btn btn-sm btn-primary" onclick="addTrigger()">＋ 新增规则</button>
    </div>
    <div id="triggerList"></div>
  </div>
</div>

<!-- ==================== 模块状态 ==================== -->
<div class="settings-pane" id="pane-status">
  <div class="glass-panel" style="padding: 24px;">
    <div style="font-weight: 700; margin-bottom: 14px;">🧩 后端模块运行状态</div>
    <div id="moduleStatus" style="display: flex; flex-direction: column; gap: 10px;">
      <pre>正在读取运行状态...</pre>
    </div>
  </div>
</div>

<div class="status-toast" id="toast"></div>

<script>
let CFG = {};
let SCHEMA = {};
let CURRENT_SECTION = 'server';

// ---------- 基础工具 ----------
function toast(msg, isErr = false) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'status-toast show' + (isErr ? ' err' : '');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.className = 'status-toast', 2600);
}

async function refresh() {
  try {
    CFG = await vtuberRPC.call('config.get');
    SCHEMA = await vtuberRPC.call('config.schema');
    document.getElementById('cfgJson').value = JSON.stringify(CFG, null, 2);
    buildTabs();
    buildTriggerList();
    loadSection(CURRENT_SECTION);
    loadModuleStatus();
  } catch (e) {
    toast('加载配置失败: ' + e.message, true);
  }
}

// ---------- 顶部标签页 ----------
const SECTIONS = [
  ['server', '🌐', '服务网络'],
  ['music', '🎵', '点歌机'],
  ['llm', '🤖', 'LLM 大模型'],
  ['tts', '🗣️', 'TTS 语音'],
  ['triggers', '⚡', '触发器'],
  ['live2d', '🎭', 'Live2D'],
  ['display', '💬', '字幕展示板'],
  ['audio', '🔊', '音频'],
  ['output', '📤', '输出策略'],
  ['system', '🛠️', '系统'],
];

function buildTabs() {
  const bar = document.getElementById('tabBar');
  bar.innerHTML = '';
  SECTIONS.forEach(([key, icon, label]) => {
    const el = document.createElement('div');
    el.className = 'settings-tab' + (key === CURRENT_SECTION ? ' active' : '');
    el.textContent = icon + ' ' + label;
    el.onclick = () => switchSection(key);
    bar.appendChild(el);
  });
  const jsonTab = document.createElement('div');
  jsonTab.className = 'settings-tab' + (CURRENT_SECTION === '__json' ? ' active' : '');
  jsonTab.textContent = '📄 JSON 完整视图';
  jsonTab.onclick = () => switchSection('__json');
  bar.appendChild(jsonTab);
  const stTab = document.createElement('div');
  stTab.className = 'settings-tab' + (CURRENT_SECTION === '__status' ? ' active' : '');
  stTab.textContent = '🧩 模块状态';
  stTab.onclick = () => switchSection('__status');
  bar.appendChild(stTab);
}

function switchSection(key) {
  CURRENT_SECTION = key;
  document.querySelectorAll('.settings-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.settings-pane').forEach(p => p.classList.remove('active'));
  if (key === '__json') document.getElementById('pane-json').classList.add('active');
  else if (key === '__status') document.getElementById('pane-status').classList.add('active');
  else document.getElementById('pane-form').classList.add('active');
  buildTabs();
  if (key !== '__json' && key !== '__status') loadSection(key);
  else if (key === '__status') loadModuleStatus();
}

// ---------- 分区表单渲染 ----------
function loadSection(section) {
  const grid = document.getElementById('formFields');
  const actions = document.getElementById('sectionActions');
  grid.innerHTML = '';
  actions.innerHTML = '';
  const data = CFG[section] || {};
  const schema = (SCHEMA[section] || {});
  const props = schema.properties || {};

  if (section === 'triggers') {
    switchSection('__status');
    return;
  }

  Object.entries(props).forEach(([field, meta]) => {
    const value = data[field];
    const wrap = document.createElement('div');
    wrap.className = 'form-field';
    let label = '<label>' + (meta.label || field) + '</label>';
    let desc = meta.description ? '<span class="field-desc">' + meta.description + '</span>' : '';
    let input = '';

    if (meta.type === 'boolean') {
      input = '<div style="display:flex;align-items:center;gap:10px;"><input type="checkbox" id="f_' + section + '_' + field + '" ' + (value ? 'checked' : '') + '><label style="font-weight:400;color:var(--text-primary);">' + (value ? '开启' : '关闭') + '</label></div>';
    } else if (meta.type === 'select') {
      input = '<select class="input-control" id="f_' + section + '_' + field + '">' +
        (meta.options || []).map(o => '<option value="' + o + '"' + (o === value ? ' selected' : '') + '>' + o + '</option>').join('') + '</select>';
    } else if (meta.type === 'password') {
      input = '<input class="input-control" type="password" id="f_' + section + '_' + field + '" value="' + (value || '') + '" placeholder="' + (value ? '(已保存，留空保持不变)' : '') + '">';
    } else if (meta.type === 'json') {
      input = '<textarea class="input-control" id="f_' + section + '_' + field + '" rows="3" style="font-family:monospace;font-size:12px;">' + (value !== undefined ? JSON.stringify(value, null, 2) : '') + '</textarea>';
    } else if (meta.type === 'number') {
      input = '<input class="input-control" type="number" id="f_' + section + '_' + field + '" value="' + (value !== undefined ? value : '') + '"' +
        (meta.min !== undefined ? ' min="' + meta.min + '"' : '') +
        (meta.max !== undefined ? ' max="' + meta.max + '"' : '') +
        (meta.step !== undefined ? ' step="' + meta.step + '"' : '') + '>';
    } else if (meta.type === 'color') {
      input = '<input class="input-control" type="color" id="f_' + section + '_' + field + '" value="' + (value || '#ffffff') + '" style="height:42px;padding:4px;">';
    } else {
      input = '<input class="input-control" id="f_' + section + '_' + field + '" value="' + (value !== undefined ? String(value) : '') + '">';
    }

    wrap.innerHTML = label + input + desc;
    grid.appendChild(wrap);
  });

  // 分区操作按钮
  const saveBtn = document.createElement('button');
  saveBtn.className = 'btn btn-success';
  saveBtn.textContent = '💾 保存「' + section + '」分区';
  saveBtn.onclick = () => saveSection(section);
  actions.appendChild(saveBtn);

  const resetBtn = document.createElement('button');
  resetBtn.className = 'btn';
  resetBtn.textContent = '↩️ 重置该分区为默认值';
  resetBtn.onclick = () => resetSection(section);
  actions.appendChild(resetBtn);

  if (section === 'llm') {
    const testBtn = document.createElement('button');
    testBtn.className = 'btn btn-primary';
    testBtn.textContent = '📡 测试 LLM 连通性';
    testBtn.onclick = () => testLLM();
    actions.appendChild(testBtn);
  }
  if (section === 'tts') {
    const testBtn = document.createElement('button');
    testBtn.className = 'btn btn-primary';
    testBtn.textContent = '📡 测试 TTS 合成';
    testBtn.onclick = () => testTTS();
    actions.appendChild(testBtn);
  }
}

function collectSection(section) {
  const schema = SCHEMA[section] || {};
  const props = schema.properties || {};
  const out = {};
  Object.keys(props).forEach(field => {
    const el = document.getElementById('f_' + section + '_' + field);
    if (!el) return;
    const meta = props[field];
    if (meta.type === 'boolean') {
      out[field] = el.checked;
    } else if (meta.type === 'number') {
      out[field] = parseFloat(el.value) || 0;
    } else if (meta.type === 'json') {
      try { out[field] = JSON.parse(el.value); } catch (e) { out[field] = el.value; }
    } else if (meta.type === 'password' && el.value === '' && CFG[section] && CFG[section][field]) {
      out[field] = CFG[section][field];
    } else {
      out[field] = el.value;
    }
  });
  return out;
}

// ---------- 保存 / 重载 / 测试 ----------
async function saveSection(section) {
  section = section || CURRENT_SECTION;
  if (section === '__json') return saveFullJson();
  if (section === 'triggers') return saveTriggers();
  try {
    const value = collectSection(section);
    await vtuberRPC.call('config.updateSection', { section, value });
    await vtuberRPC.call('config.reload');
    await refresh();
    toast('✔ 分区「' + section + '」已保存到配置文件');
  } catch (e) {
    toast('保存失败: ' + e.message, true);
  }
}

async function saveFullJson() {
  try {
    const config = JSON.parse(document.getElementById('cfgJson').value);
    await vtuberRPC.call('config.update', { config });
    await vtuberRPC.call('config.reload');
    await refresh();
    toast('✔ 全部配置已保存');
  } catch (e) {
    toast('保存失败: ' + e.message, true);
  }
}

function formatJson() {
  try {
    document.getElementById('cfgJson').value = JSON.stringify(JSON.parse(document.getElementById('cfgJson').value), null, 2);
  } catch (e) {
    toast('JSON 格式错误: ' + e.message, true);
  }
}

async function applyConfig() {
  try {
    const res = await vtuberRPC.call('config.apply');
    if (res.success) {
      toast('🔥 已热重载 LLM / TTS / 触发器');
    } else {
      toast('部分模块重载失败: ' + JSON.stringify(res), true);
    }
  } catch (e) {
    toast('热重载失败: ' + e.message, true);
  }
}

async function reloadConfig() {
  try {
    await vtuberRPC.call('config.reload');
    await refresh();
    toast('✔ 已从磁盘重新载入配置');
  } catch (e) {
    toast('重载失败: ' + e.message, true);
  }
}

async function resetSection(section) {
  try {
    await vtuberRPC.call('config.resetSection', { section });
    await refresh();
    toast('✔ 分区「' + section + '」已重置为默认值');
  } catch (e) {
    toast('重置失败: ' + e.message, true);
  }
}

async function testLLM() {
  try {
    toast('正在请求 LLM 服务，请稍候...');
    const value = collectSection('llm');
    const ok = await vtuberRPC.call('config.testLLM', { llm: value });
    toast(ok ? '✔ LLM 连通性测试通过' : '✘ LLM 测试失败', !ok);
  } catch (e) {
    toast('LLM 测试失败: ' + e.message, true);
  }
}

async function testTTS() {
  try {
    toast('正在合成测试语音...');
    const value = collectSection('tts');
    const res = await vtuberRPC.call('config.testTTS', { tts: value });
    toast('✔ TTS 合成成功 (' + res.duration + 's, ' + res.size + ' bytes)', false);
  } catch (e) {
    toast('TTS 测试失败: ' + e.message, true);
  }
}

// ---------- 触发器可视化编辑 ----------
function addTrigger() {
  const list = document.getElementById('triggerList');
  const card = document.createElement('div');
  card.className = 'trigger-card';
  card.style.gridTemplateColumns = '1fr';
  card.innerHTML = `
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
      <input class="input-control" style="width:180px;" placeholder="规则 ID (英文)" data-k="id">
      <input class="input-control" style="width:160px;" placeholder="名称" data-k="name">
      <select class="input-control" style="width:140px;" data-k="mode">
        <option value="immediate">立即触发</option>
        <option value="debounce">防抖合并</option>
        <option value="scheduled">定时触发</option>
      </select>
      <button class="btn btn-sm btn-danger" onclick="this.parentElement.parentElement.remove()">删除</button>
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
      <span style="font-size:12px;color:var(--text-muted);">事件:</span>
      ${['danmaku','gift','superchat','enter','follow','like','guard','liveStart','liveEnd'].map(t =>
        '<label style="font-size:12px;display:flex;align-items:center;gap:4px;"><input type="checkbox" value="' + t + '" data-k="evt">' + t + '</label>').join('')}
    </div>
    <div style="display:flex;gap:14px;flex-wrap:wrap;align-items:center;font-size:12px;">
      <label>防抖延迟(ms) <input type="number" class="input-control" style="width:110px;" value="3000" data-k="delay"></label>
      <label>最大合并 <input type="number" class="input-control" style="width:90px;" value="10" data-k="maxBatch"></label>
      <label>定时间隔(ms) <input type="number" class="input-control" style="width:120px;" value="0" data-k="intervalMs"></label>
      <label><input type="checkbox" checked data-k="enabled"> 启用</label>
    </div>`;
  list.appendChild(card);
}

function buildTriggerList() {
  const list = document.getElementById('triggerList');
  list.innerHTML = '';
  const triggers = CFG.triggers || [];
  if (!triggers.length) {
    list.innerHTML = '<p style="color:var(--text-muted);font-size:13px;">暂无触发器规则，点击右上角「新增规则」创建。</p>';
    return;
  }
  triggers.forEach((rule, idx) => {
    const card = document.createElement('div');
    card.className = 'trigger-card';
    const modeNames = { immediate: '⚡ 立即', debounce: '⏳ 防抖', scheduled: '⏰ 定时' };
    card.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:6px;">
        <div style="display:flex;align-items:center;gap:8px;">
          <span class="badge" style="${rule.enabled ? 'color:var(--accent-emerald);border-color:var(--accent-emerald);' : 'opacity:.5'}">${rule.enabled ? '● 启用' : '○ 停用'}</span>
          <span class="badge badge-warning">${modeNames[rule.mode] || rule.mode}</span>
          <strong>${rule.name || rule.id}</strong>
        </div>
        <div class="trigger-meta">
          <span class="badge">ID: ${rule.id}</span>
          <span style="margin-left:8px;">事件: ${(rule.eventTypes || []).join(' / ') || '全部'}</span>
          ${rule.mode === 'debounce' ? `<span style="margin-left:8px;color:var(--text-muted);">延迟 ${rule.delay}ms · 合并 ${rule.maxBatch}条</span>` : ''}
        </div>
      </div>
      <div style="display:flex;gap:8px;">
        <button class="btn btn-sm" onclick="toggleTrigger(${idx})">${rule.enabled ? '停用' : '启用'}</button>
        <button class="btn btn-sm btn-danger" onclick="removeTrigger(${idx})">删除</button>
      </div>`;
    list.appendChild(card);
  });
}

async function toggleTrigger(idx) {
  const triggers = (CFG.triggers || []).map(r => ({ ...r }));
  triggers[idx].enabled = !triggers[idx].enabled;
  try {
    await vtuberRPC.call('config.updateSection', { section: 'triggers', value: triggers });
    await vtuberRPC.call('config.reload');
    await refresh();
    toast('✔ 触发器状态已更新');
  } catch (e) { toast('操作失败: ' + e.message, true); }
}

async function removeTrigger(idx) {
  const triggers = (CFG.triggers || []).filter((_, i) => i !== idx);
  try {
    await vtuberRPC.call('config.updateSection', { section: 'triggers', value: triggers });
    await vtuberRPC.call('config.reload');
    await refresh();
    toast('✔ 触发器已删除');
  } catch (e) { toast('操作失败: ' + e.message, true); }
}

async function saveTriggers() {
  const cards = document.querySelectorAll('#triggerList .trigger-card');
  const triggers = [];
  cards.forEach(card => {
    const rule = {};
    card.querySelectorAll('[data-k]').forEach(el => {
      const k = el.dataset.k;
      if (k === 'evt') return;
      if (k === 'enabled') rule[k] = el.checked;
      else if (k === 'delay' || k === 'maxBatch' || k === 'intervalMs') rule[k] = parseInt(el.value) || 0;
      else rule[k] = el.value;
    });
    const evts = [];
    card.querySelectorAll('[data-k="evt"]').forEach(el => { if (el.checked) evts.push(el.value); });
    if (evts.length) rule.eventTypes = evts;
    if (rule.id) triggers.push(rule);
  });
  try {
    await vtuberRPC.call('config.updateSection', { section: 'triggers', value: triggers });
    await vtuberRPC.call('config.reload');
    await refresh();
    toast('✔ 触发器规则已保存 (' + triggers.length + ' 条)');
  } catch (e) { toast('保存失败: ' + e.message, true); }
}

// ---------- 模块状态 ----------
async function loadModuleStatus() {
  const box = document.getElementById('moduleStatus');
  try {
    const info = await vtuberRPC.call('system.info');
    const status = await vtuberRPC.call('system.status');
    const llmStatus = info.llmConfigured ? '<span style="color:var(--accent-emerald)">● 已配置</span>' : '<span style="color:var(--accent-rose)">○ 未配置</span>';
    const ttsStatus = info.ttsConfigured ? '<span style="color:var(--accent-emerald)">● 已配置</span>' : '<span style="color:var(--accent-rose)">○ 未配置</span>';
    const rows = [
      ['🎭 平台 / 版本', info.platform + ' v' + info.version],
      ['🆔 直播间', info.roomId || '未设置'],
      ['📁 配置文件', info.configPath || '（未加载磁盘配置）'],
      ['🤖 LLM 模型', llmStatus + ' ' + (info.configFile && info.configFile.llm && info.configFile.llm.model || '')],
      ['🗣️ TTS 引擎', ttsStatus + ' ' + (info.configFile && info.configFile.tts && info.configFile.tts.provider || '')],
      ['⚡ 触发器规则', info.modules ? info.modules.triggers + ' 条已加载' : '未知'],
      ['🎵 点歌机', status.jukebox ? status.jukebox.state + (status.jukebox.currentSong ? ' - ' + status.jukebox.currentSong.title : '') : ''],
      ['💬 展示板', status.display ? JSON.stringify(status.display) : ''],
      ['📊 事件统计', '累计 ' + status.eventCount + ' 条事件'],
    ];
    box.innerHTML = '<pre>' + rows.map(([k, v]) => k + ':  ' + v).join('\n') + '</pre>';
  } catch (e) {
    box.innerHTML = '<pre>读取状态失败: ' + e.message + '</pre>';
  }
}

window.addEventListener('load', async () => {
  try {
    await vtuberRPC.whenReady();
    await refresh();
  } catch (e) {
    toast('加载配置失败: ' + e.message, true);
  }
  vtuberRPC.on('connected', () => refresh());
  vtuberRPC.on('config.changed', () => refresh());
});
</script>
)html";
  return shell("/settings", "系统设置 Settings", body);
}

}  // namespace vtuber::webui

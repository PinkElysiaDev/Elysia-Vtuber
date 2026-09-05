/**
 * 诊断脚本：连接生产 backend（19275）为 webui peer，监听通知流，
 * 模拟一次 enter 事件，观察欢迎弹幕链路的真实结果（ui.log / danmaku.failed / output.danmaku）。
 * 用法：node diagnose-welcome.js
 */
const WebSocket = require('ws')

const PORT = Number(process.env.WS_PORT || 19275)
const log = (m) => console.log(`[${new Date().toLocaleTimeString('zh-CN')}] ${m}`)

async function main() {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}`)
  const notifications = []
  ws.on('open', async () => {
    ws.send(JSON.stringify({ jsonrpc: '2.0', method: 'peer.declare', params: { kind: 'webui' } }))
    log('已连接 backend，等待 5s 观察 Koishi 插件是否重连...')
    // 先等插件重连（BackendClient reconnectInterval 默认 5s）
    setTimeout(async () => {
      log('--- 发送模拟 enter 事件 ---')
      ws.send(JSON.stringify({
        jsonrpc: '2.0', id: 2, method: 'event.simulate',
        params: { type: 'enter', userName: '诊断测试员', userUid: '999999' },
      }))
    }, 6000)
  })
  ws.on('message', (d) => {
    const msg = JSON.parse(String(d))
    if (msg.id !== undefined) {
      if (msg.id === 2) {
        log(`event.simulate 结果: ${JSON.stringify(msg.result ?? msg.error)}`)
        log('--- 等待 8s 观察链路通知 ---')
        setTimeout(() => {
          log('--- 通知汇总 ---')
          for (const n of notifications) log(`${n.method} ${JSON.stringify(n.params).slice(0, 200)}`)
          process.exit(0)
        }, 8000)
      }
      return
    }
    if (msg.method === 'event.received' || msg.method === 'ui.log' || msg.method === 'danmaku.failed'
      || msg.method === 'output.danmaku' || msg.method === 'danmaku.failed') {
      notifications.push({ method: msg.method, params: msg.params })
      log(`通知: ${msg.method} ${JSON.stringify(msg.params).slice(0, 200)}`)
    }
  })
  ws.on('error', (e) => { log('WS 错误: ' + e.message); process.exit(1) })
}

main()

/**
 * Koishi Vtuber JSON-RPC WebUI Client
 * Connects to Node logic service WS (default 19275) and declares peer: webui.
 */

class VtuberRPCClient {
  constructor(options = {}) {
    const loc = window.location || {}
    const host = options.host || loc.hostname || '127.0.0.1'
    const port = options.port
      || Number(new URLSearchParams(loc.search || '').get('wsPort'))
      || Number(loc.port === '19274' ? 19275 : 0)
      || 19275
    this.wsUrl = options.wsUrl || `ws://${host}:${port}`
    this.reconnectInterval = options.reconnectInterval || 3000
    this.ws = null
    this.requestId = 1
    this.pendingRequests = new Map()
    this.eventListeners = new Map()
    this.statusListeners = []
    this.waiters = []
    this.reconnectTimer = null
    this.connected = false
    this.declared = false

    this.init()
  }

  init() {
    this.connect()
    this.initThemeSystem()
  }

  initThemeSystem() {
    const savedTheme = localStorage.getItem('vtuber_webui_theme') ||
      (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
    this.setTheme(savedTheme)
  }

  setTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('vtuber_webui_theme', theme)
    this.emit('themeChange', theme)
  }

  toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme') || 'dark'
    const nextTheme = current === 'dark' ? 'light' : 'dark'
    this.setTheme(nextTheme)
    return nextTheme
  }

  getTheme() {
    return document.documentElement.getAttribute('data-theme') || 'dark'
  }

  isOpen() {
    return this.ws && this.ws.readyState === WebSocket.OPEN
  }

  flushWaiters() {
    const q = this.waiters.splice(0)
    q.forEach((fn) => { try { fn() } catch (e) {} })
  }

  scheduleReconnect() {
    if (this.reconnectTimer) return
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.connect()
    }, this.reconnectInterval)
  }

  whenReady(timeoutMs = 15000) {
    if (this.isOpen() && this.declared) return Promise.resolve()
    this.connect()
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((w) => w !== onOk)
        reject(new Error('WebSocket 连接超时，请确认逻辑服务已启动（默认 ws://127.0.0.1:19275）'))
      }, timeoutMs)
      const onOk = () => { clearTimeout(timer); resolve() }
      this.waiters.push(onOk)
    })
  }

  declarePeer() {
    if (!this.isOpen()) return
    const id = this.requestId++
    const payload = {
      jsonrpc: '2.0',
      id,
      method: 'peer.declare',
      params: { kind: 'webui' },
    }
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(), 800)
      this.pendingRequests.set(id, {
        resolve: () => { clearTimeout(timer); resolve() },
        reject: () => { clearTimeout(timer); resolve() },
      })
      this.ws.send(JSON.stringify(payload))
    })
  }

  connect() {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return

    try {
      this.ws = new WebSocket(this.wsUrl)

      this.ws.onopen = async () => {
        console.log('[RPCClient] WebSocket connected to', this.wsUrl)
        try {
          await this.declarePeer()
        } catch (e) {
          console.warn('[RPCClient] peer.declare failed', e)
        }
        this.declared = true
        this.connected = true
        this.notifyStatus(true)
        this.emit('connected', true)
        this.flushWaiters()
      }

      this.ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data)
          this.handleMessage(message)
        } catch (err) {
          console.error('[RPCClient] Failed to parse message:', err, event.data)
        }
      }

      this.ws.onclose = () => {
        console.warn('[RPCClient] WebSocket disconnected. Retrying in', this.reconnectInterval, 'ms...')
        this.connected = false
        this.declared = false
        // 断连时清空未决请求，避免调用方永久挂起
        for (const [, { reject, timer }] of this.pendingRequests) {
          if (timer) clearTimeout(timer)
          reject(new Error('WebSocket disconnected'))
        }
        this.pendingRequests.clear()
        this.notifyStatus(false)
        this.emit('disconnected', false)
        this.scheduleReconnect()
      }

      this.ws.onerror = (err) => {
        console.error('[RPCClient] WebSocket Error:', err)
      }
    } catch (e) {
      console.error('[RPCClient] WebSocket init error:', e)
      this.scheduleReconnect()
    }
  }

  handleMessage(data) {
    if (data.id !== undefined && this.pendingRequests.has(data.id)) {
      const { resolve, reject, timer } = this.pendingRequests.get(data.id)
      this.pendingRequests.delete(data.id)
      if (timer) clearTimeout(timer)
      if (data.error) reject(data.error)
      else resolve(data.result)
      return
    }
    if (data.method) this.emit(data.method, data.params)
  }

  async call(method, params = {}, timeoutMs = 10000) {
    await this.whenReady()
    return new Promise((resolve, reject) => {
      if (!this.isOpen()) {
        return reject(new Error('WebSocket is not connected'))
      }
      const id = this.requestId++
      // 默认 10s 超时（可按调用覆盖，如批量解析等长操作）
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id)
        reject(new Error('RPC timeout: ' + method))
      }, timeoutMs)
      this.pendingRequests.set(id, { resolve, reject, timer })
      this.ws.send(JSON.stringify({ jsonrpc: '2.0', method, params, id }))
    })
  }

  on(event, callback) {
    if (!this.eventListeners.has(event)) this.eventListeners.set(event, new Set())
    this.eventListeners.get(event).add(callback)
    return () => this.off(event, callback)
  }

  off(event, callback) {
    if (this.eventListeners.has(event)) this.eventListeners.get(event).delete(callback)
  }

  emit(event, data) {
    if (!this.eventListeners.has(event)) return
    this.eventListeners.get(event).forEach((cb) => {
      try { cb(data) } catch (e) {
        console.error(`[RPCClient] Error in listener for ${event}:`, e)
      }
    })
  }

  onStatusChange(callback) {
    this.statusListeners.push(callback)
    callback(this.connected)
  }

  notifyStatus(status) {
    this.statusListeners.forEach((cb) => cb(status))
  }
}

window.vtuberRPC = new VtuberRPCClient()

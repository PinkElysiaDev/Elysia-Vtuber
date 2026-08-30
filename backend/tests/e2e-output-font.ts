/**
 * E2E：展示板自定义字体 —— base64 上传 → 配置回填 → HTTP /fonts/ 取回字节一致 → 清除复位。
 * 运行：npx ts-node tests/e2e-output-font.ts
 */
import * as path from 'path'
import { WebSocket } from 'ws'
import { VtuberService } from '../src/index'

function fail(msg: string): never {
  console.error('--- FAIL ---', msg)
  process.exit(1)
}

function connectWs(port: number): Promise<{ call: (method: string, params?: unknown) => Promise<any>; close: () => void }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`)
    let nextId = 1
    const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>()
    ws.on('open', () => {
      resolve({
        call: (method, params = {}) => new Promise((res2, rej2) => {
          const id = nextId++
          pending.set(id, { resolve: res2, reject: rej2 })
          ws.send(JSON.stringify({ jsonrpc: '2.0', method, params, id }))
        }),
        close: () => ws.close(),
      })
    })
    ws.on('message', (d) => {
      const msg = JSON.parse(String(d))
      if (msg.id !== undefined && pending.has(msg.id)) {
        const entry = pending.get(msg.id)!
        pending.delete(msg.id)
        if (msg.error) entry.reject(new Error(msg.error.message))
        else entry.resolve(msg.result)
      }
    })
    ws.on('error', reject)
  })
}

async function main() {
  const configPath = path.join(__dirname, '..', 'data', 'test-instance', 'config.json')
  process.env.VTUBER_CONFIG = configPath
  const svc = new VtuberService()
  await svc.start()
  const wsPort = (svc.config as any).server?.wsPort ?? 19279
  const httpPort = (svc.config as any).server?.httpPort ?? 19278
  const rpc = await connectWs(wsPort)

  try {
    // 1. 上传伪字体（内容为任意字节，按扩展名校验）
    const payload = Buffer.from('FAKE-FONT-BYTES-0123456789', 'utf-8')
    const up = await rpc.call('output.font.upload', {
      filename: 'my-test font!.woff2',
      dataBase64: payload.toString('base64'),
    })
    if (!up.ok || up.fontFamily !== 'my-test_font_') fail('上传结果不对: ' + JSON.stringify(up))

    // 2. 配置回填
    const config = await rpc.call('config.get')
    const display = config.output.display
    if (display.fontFile !== up.fontFile || display.fontFamily !== 'my-test_font_') {
      fail('配置未回填: ' + JSON.stringify(display))
    }
    console.log('✓ 上传：文件名清洗 + 配置回填（fontFile/fontFamily）')

    // 3. HTTP /fonts/ 提供文件，字节一致 + 正确 MIME
    const res = await fetch(`http://127.0.0.1:${httpPort}/fonts/${encodeURIComponent(up.fontFile)}`)
    if (!res.ok) fail('HTTP 字体拉取失败: ' + res.status)
    if (res.headers.get('content-type') !== 'font/woff2') fail('MIME 不对: ' + res.headers.get('content-type'))
    const body = Buffer.from(await res.arrayBuffer())
    if (!body.equals(payload)) fail('字节不一致')
    console.log('✓ /fonts/ 路由：MIME 正确，字节一致')

    // 4. 非法扩展名被拒
    let rejected = false
    try {
      await rpc.call('output.font.upload', { filename: 'evil.exe', dataBase64: 'AAAA' })
    } catch { rejected = true }
    if (!rejected) fail('非法扩展名未被拒绝')
    console.log('✓ 校验：非字体扩展名被拒')

    // 5. 清除复位
    await rpc.call('output.font.clear')
    const status = await rpc.call('output.font.status')
    if (status.fontFile !== '' || status.fontFamily !== '') fail('清除后未复位: ' + JSON.stringify(status))
    const res2 = await fetch(`http://127.0.0.1:${httpPort}/fonts/${encodeURIComponent(up.fontFile)}`)
    if (res2.status !== 404) fail('清除后文件仍可访问: ' + res2.status)
    console.log('✓ 清除：配置复位，文件已删')

    console.log('--- PASS ---')
    rpc.close()
    await svc.stop()
    setTimeout(() => process.exit(0), 300).unref()
  } catch (e) {
    console.error('--- FAIL ---', e)
    try { await svc.stop() } catch { /* 忽略 */ }
    process.exit(1)
  }
}

void main()

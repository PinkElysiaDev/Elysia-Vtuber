/**
 * E2E：nowPlaying.outputs 多输出迁移与模板渲染
 * 运行：npx ts-node tests/e2e-nowplaying-outputs.ts
 */
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { loadConfig } from '../src/config'
import { Jukebox } from '../src/music/jukebox'

function fail(msg: string): never {
  console.error('--- FAIL ---', msg)
  process.exit(1)
}

async function main() {
  // 1. 旧配置迁移：单 template/filePath → outputs[0]，旧键清除
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'np-mig-'))
  const cfgFile = path.join(tmp, 'config.json')
  fs.writeFileSync(cfgFile, JSON.stringify({
    music: {
      nowPlaying: {
        template: '旧模板 {{title}}',
        filePath: 'data/old.txt',
        windowEnabled: false,
      },
    },
  }), 'utf8')
  const cfg = loadConfig(cfgFile)
  const np = cfg.music.nowPlaying as unknown as Record<string, unknown>
  if (np.template !== undefined || np.filePath !== undefined) fail('旧键 template/filePath 未清除: ' + JSON.stringify(np))
  const outputs = np.outputs as Array<{ file: string; template: string }>
  if (!outputs || outputs.length !== 1) fail('迁移后 outputs 应有一条: ' + JSON.stringify(outputs))
  if (outputs[0].file !== 'old.txt' || outputs[0].template !== '旧模板 {{title}}') fail('迁移内容不对: ' + JSON.stringify(outputs[0]))
  if (np.windowEnabled !== false) fail('windowEnabled 被迁移破坏')
  console.log('✓ 旧配置迁移: template/filePath → outputs[0]')

  // 2. 新配置直读：outputs 原样保留
  fs.writeFileSync(cfgFile, JSON.stringify({
    music: { nowPlaying: { outputs: [{ file: 'a.txt', template: 'A' }, { file: 'b.txt', template: 'B' }], windowEnabled: true } },
  }), 'utf8')
  const cfg2 = loadConfig(cfgFile)
  const outs2 = (cfg2.music.nowPlaying as unknown as { outputs: unknown[] }).outputs
  if (outs2.length !== 2) fail('新格式 outputs 应原样保留 2 条')
  console.log('✓ 新配置直读: outputs 数组原样保留')

  // 3. 模板渲染：全部变量 + 未知变量保留 + 时间格式化
  const render = (Jukebox as unknown as { renderTemplate: (t: string, c: Record<string, string>) => string }).renderTemplate
  const fmt = (Jukebox as unknown as { formatTime: (s: number) => string }).formatTime
  const ctx: Record<string, string> = {
    title: 'T', artist: 'A', duration: '3:05', user: 'U',
    elapsed: '1:02', remaining: '2:03', lyric: '词',
    unknownKept: '',
  }
  const out = render('🎵 {{title}} - {{artist}} {{duration}} [{{elapsed}}/{{remaining}}] {{lyric}} {{user}} {{nope}}', ctx)
  if (out !== '🎵 T - A 3:05 [1:02/2:03] 词 U {{nope}}') fail('模板渲染结果不对: ' + out)
  if (fmt(185) !== '3:05' || fmt(0) !== '0:00' || fmt(61) !== '1:01') fail('formatTime 不对: ' + fmt(185) + '/' + fmt(0) + '/' + fmt(61))
  console.log('✓ 模板渲染: 变量替换 / 未知变量原样保留 / m:ss 格式化')

  fs.rmSync(tmp, { recursive: true, force: true })
  console.log('--- PASS ---')
}

void main()

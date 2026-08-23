/**
 * E2E：歌单链接匹配 / 输出文件规范化迁移 / parseIdleRef 回归
 * 运行：npx ts-node tests/e2e-playlist-outputs.ts
 */
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { loadConfig } from '../src/config'
import { netease } from '../src/music/providers/netease'
import { qq } from '../src/music/providers/qq'
import { kugou } from '../src/music/providers/kugou'
import { ProviderRegistry } from '../src/music/registry'

function fail(msg: string): never {
  console.error('--- FAIL ---', msg)
  process.exit(1)
}

async function main() {
  // 1. 歌单引用匹配（纯函数，离线）
  const cases: Array<[string, string, string]> = [
    ['https://music.163.com/#/playlist?app=3&id=1234567', 'netease', '1234567'],
    ['https://music.163.com/playlist?id=987654321', 'netease', '987654321'],
    ['12345678', 'netease', '12345678'],
    ['https://y.qq.com/n/ryqq/playlist/7256912514', 'qq', '7256912514'],
    ['https://www.kugou.com/yy/special/single/861531.html', 'kugou', '861531'],
  ]
  const registry = new ProviderRegistry([kugou, netease, qq])
  for (const [ref, provider, id] of cases) {
    const cap = registry.get(provider) as unknown as { matchPlaylist(r: string): { id: string } | null }
    const hit = cap.matchPlaylist(ref)
    if (!hit || hit.id !== id) fail(`${ref} 应解析为 ${provider}:${id}，实际 ${JSON.stringify(hit)}`)
  }
  const noHit = netease.matchPlaylist('不是链接') ?? qq.matchPlaylist('https://example.com/x') ?? kugou.matchPlaylist('')
  if (noHit) fail('无效引用不应命中')
  console.log('✓ 歌单引用匹配: netease/qq/kugou 链接与纯 ID')

  // 2. playlistProviders 名单
  const caps = registry.playlistProviders().sort()
  if (JSON.stringify(caps) !== JSON.stringify(['kugou', 'netease', 'qq'])) fail('歌单能力名单不对: ' + caps)
  console.log('✓ 歌单能力名单:', caps.join('/'))

  // 3. 输出文件名规范化迁移：旧单模板 + 带路径的 outputs → 纯文件名
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'np-name-'))
  const cfgFile = path.join(tmp, 'config.json')
  fs.writeFileSync(cfgFile, JSON.stringify({
    music: {
      nowPlaying: { template: '旧模板', filePath: 'data/old-playing.txt', windowEnabled: true },
    },
  }), 'utf8')
  let cfg = loadConfig(cfgFile)
  let outputs = (cfg.music.nowPlaying as unknown as { outputs: Array<{ file: string }> }).outputs
  if (outputs.length !== 1 || outputs[0].file !== 'old-playing.txt') fail('旧 filePath 未迁移为纯文件名: ' + JSON.stringify(outputs))
  fs.writeFileSync(cfgFile, JSON.stringify({
    music: {
      nowPlaying: { outputs: [{ file: 'data/sub/obs.txt', template: 'A' }, { file: '..\\evil.txt', template: 'B' }], windowEnabled: true },
    },
  }), 'utf8')
  cfg = loadConfig(cfgFile)
  outputs = (cfg.music.nowPlaying as unknown as { outputs: Array<{ file: string }> }).outputs
  if (outputs[0].file !== 'obs.txt' || outputs[1].file !== 'evil.txt') fail('带路径/反斜杠的文件名未取 basename: ' + JSON.stringify(outputs))
  console.log('✓ 输出文件名规范化: 旧单模板迁移 + 目录穿越收敛为 basename')

  fs.rmSync(tmp, { recursive: true, force: true })
  console.log('--- PASS ---')
}

void main()

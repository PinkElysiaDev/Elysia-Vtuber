/**
 * E2E：全目录树嗅探 + 声明项拖拽移动（不改写 model3.json）+ 加固规则验证
 * 运行：npx ts-node tests/e2e-drag-organize.ts
 */
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { scanModelAssets, buildLive2dModule } from '../src/modules/live2d'

function fail(msg: string): never {
  console.error('--- FAIL ---', msg)
  process.exit(1)
}

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'l2d-drag-'))
  const modelDir = path.join(root, 'Haru')
  fs.mkdirSync(path.join(modelDir, 'expressions'), { recursive: true })
  fs.mkdirSync(path.join(modelDir, 'costumes'), { recursive: true })
  fs.mkdirSync(path.join(modelDir, 'motions'), { recursive: true })
  fs.mkdirSync(path.join(modelDir, 'deep', 'nested', 'dir'), { recursive: true })
  fs.writeFileSync(path.join(modelDir, 'expressions', 'F01.exp3.json'), '{}')   // 声明
  fs.writeFileSync(path.join(modelDir, 'expressions', 'blue.exp3.json'), '{}')
  fs.writeFileSync(path.join(modelDir, 'expressions', 'red.exp3.json'), '{}')
  fs.writeFileSync(path.join(modelDir, 'costumes', 'red.exp3.json'), '{}')
  fs.writeFileSync(path.join(modelDir, 'motions', 'dance.motion3.json'), '{}')
  fs.writeFileSync(path.join(modelDir, 'motions', 'idle_01.motion3.json'), '{}') // 声明
  fs.writeFileSync(path.join(modelDir, 'motions', 'wrong.exp3.json'), '{}')      // 约定目录放错类型
  fs.writeFileSync(path.join(modelDir, 'flat.exp3.json'), '{}')                  // 平铺
  fs.writeFileSync(path.join(modelDir, 'deep', 'nested', 'dir', 'deep.motion3.json'), '{}') // 深层
  fs.writeFileSync(path.join(modelDir, 'Haru.model3.json'), JSON.stringify({
    FileReferences: {
      Expressions: [{ Name: 'F01', File: 'expressions/F01.exp3.json' }],
      Motions: { Idle: [{ File: 'motions/idle_01.motion3.json' }] },
    },
  }))
  const modelPath = path.join(modelDir, 'Haru.model3.json')

  const fakeCpp = { isConnected: () => false, request: async () => ({ ok: true }) }
  const mod = buildLive2dModule({ cpp: fakeCpp as never, getConfig: () => ({ modelPath }) as never })
  const organize = mod['live2d.assets.organize'] as (p: unknown) => Promise<{ ok: boolean; moved: string[]; failed: Array<{ file: string; error: string }> }>

  // 1. 全目录树嗅探：平铺 / 深层 / 约定目录放错类型 全部进入未分类
  let scan = scanModelAssets(modelPath)
  const uncFiles = scan.uncategorized.map(u => u.file).sort()
  const expectUnc = ['deep/nested/dir/deep.motion3.json', 'flat.exp3.json', 'motions/wrong.exp3.json']
  if (JSON.stringify(uncFiles) !== JSON.stringify(expectUnc)) fail('未分类应为 ' + JSON.stringify(expectUnc) + '，实际 ' + JSON.stringify(uncFiles))
  const idle = scan.motions.find(m => m.name === 'Idle#0')
  if (!idle || idle.discovered !== false) fail('声明动作 Idle#0 未按声明名列出')
  console.log('✓ 全树嗅探: 未分类', uncFiles.join(', '), '| 声明动作 Idle#0 (discovered=false)')

  // 2. 拖动声明项 F01 → 换装：允许移动（不改写 model3.json），死引用隐藏
  let res = await organize({ modelPath, moves: [{ file: 'expressions/F01.exp3.json', category: 'costume' }] })
  if (!res.ok) fail('声明项 F01 → costume 被拒绝: ' + JSON.stringify(res.failed))
  if (!fs.existsSync(path.join(modelDir, 'costumes', 'F01.exp3.json'))) fail('F01 未移动到 costumes/')
  scan = scanModelAssets(modelPath)
  const f01costume = scan.costumes.find(c => c.name === 'F01')
  if (!f01costume || f01costume.discovered !== true) fail('重扫后 costumes 应含 discovered=true 的 F01')
  if (scan.expressions.some(e => e.name === 'F01')) fail('死引用（expressions/F01 声明）未被隐藏')
  const model3Raw = fs.readFileSync(modelPath, 'utf8')
  if (!model3Raw.includes('"expressions/F01.exp3.json"')) fail('model3.json 被意外改写')
  console.log('✓ 声明项拖拽: F01 → costumes/，死引用隐藏，model3.json 未改写')

  // 3. 未分类整理：平铺 flat → 表情
  res = await organize({ modelPath, moves: [{ file: 'flat.exp3.json', category: 'expression' }] })
  if (!res.ok) fail('flat → expression 失败: ' + JSON.stringify(res.failed))
  if (!fs.existsSync(path.join(modelDir, 'expressions', 'flat.exp3.json'))) fail('flat 未移动到 expressions/')
  console.log('✓ 未分类整理: flat.exp3.json → expressions/')

  // 4. 防覆盖：expressions/red → costume（costumes/red 已存在）必须拒绝
  res = await organize({ modelPath, moves: [{ file: 'expressions/red.exp3.json', category: 'costume' }] })
  if (res.ok) fail('目标已存在却移动成功（会静默覆盖）')
  if (!/已存在/.test(res.failed[0].error)) fail('错误信息不含"已存在": ' + res.failed[0].error)
  console.log('✓ 防覆盖: ' + res.failed[0].error)

  // 5. 扩展名校验：motion 文件 → expression 必须拒绝
  res = await organize({ modelPath, moves: [{ file: 'motions/dance.motion3.json', category: 'expression' }] })
  if (res.ok) fail('motion3 文件被移入 expressions/')
  console.log('✓ 扩展名校验: ' + res.failed[0].error)

  // 6. 表情↔换装 双向拖拽
  res = await organize({ modelPath, moves: [{ file: 'expressions/blue.exp3.json', category: 'costume' }] })
  if (!res.ok) fail('blue → costume 失败: ' + JSON.stringify(res.failed))
  res = await organize({ modelPath, moves: [{ file: 'costumes/blue.exp3.json', category: 'expression' }] })
  if (!res.ok) fail('blue → expression 反向失败: ' + JSON.stringify(res.failed))
  scan = scanModelAssets(modelPath)
  if (!scan.expressions.some(e => e.name === 'blue' && e.discovered)) fail('反向移动后 expressions 缺少 blue')
  console.log('✓ 表情↔换装 双向拖拽')

  fs.rmSync(root, { recursive: true, force: true })
  console.log('--- PASS ---')
}

void main()

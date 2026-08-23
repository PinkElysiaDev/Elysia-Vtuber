import * as fs from 'fs'
import * as path from 'path'
import type { RpcHandler } from '../core/rpc'
import type { CppClient } from '../cpp/client'
import type { Live2DConfig } from '../config'
import { resolveBackendPath, backendRoot } from '../config'

function resolveModelPath(modelPath: string): string {
  return resolveBackendPath(modelPath)
}

export interface ModelEntry {
  name: string
  path: string
  relative: string
  dir: string
  size?: number
}

// 扫描边界：防止 modelDir 指向大目录时同步递归长时间阻塞事件循环
const SCAN_SKIP_DIRS = new Set(['node_modules', '.git', '.tools', 'vcpkg_installed', 'build', 'dist'])
const SCAN_MAX_ENTRIES_PER_DIR = 500
const SCAN_MAX_MODELS = 50

function scanModelsInDir(baseDir: string, maxDepth = 4): ModelEntry[] {
  const models: ModelEntry[] = []
  if (!fs.existsSync(baseDir)) return models

  function walk(currentDir: string, depth: number) {
    if (depth > maxDepth || models.length >= SCAN_MAX_MODELS) return
    try {
      const entries = fs.readdirSync(currentDir, { withFileTypes: true })
      for (const entry of entries.slice(0, SCAN_MAX_ENTRIES_PER_DIR)) {
        if (models.length >= SCAN_MAX_MODELS) return
        const fullPath = path.join(currentDir, entry.name)
        if (entry.isDirectory()) {
          if (SCAN_SKIP_DIRS.has(entry.name)) continue
          walk(fullPath, depth + 1)
        } else if (entry.isFile() && entry.name.endsWith('.model3.json')) {
          const modelName = entry.name.replace(/\.model3\.json$/i, '')
          const relPath = path.relative(backendRoot(), fullPath).replace(/\\/g, '/')
          models.push({
            name: modelName,
            path: fullPath.replace(/\\/g, '/'),
            relative: relPath,
            dir: path.dirname(fullPath).replace(/\\/g, '/'),
          })
        }
      }
    } catch {
      // 忽略无法读取的目录
    }
  }

  walk(baseDir, 0)
  return models
}

export interface Live2DModuleDeps {
  cpp: CppClient
  getConfig: () => Live2DConfig
}

/** 嗅探到的单个资源（file 相对模型目录，posix 分隔） */
export interface DiscoveredAsset {
  name: string
  file: string
  /** true = 目录发现、model3.json 未声明（需 loadExtra 注入） */
  discovered: boolean
  /** 动作分组（子目录名，平铺为 Extra；声明动作为其原组） */
  group?: string
  /** 未分类项的建议分类 */
  suggestedCategory?: 'expression' | 'costume' | 'motion'
}

export interface ModelAssetScan {
  modelPath: string
  expressions: DiscoveredAsset[]
  costumes: DiscoveredAsset[]
  motions: DiscoveredAsset[]
  /** 不在正确目录的文件（模型目录平铺 / 未知子目录），需用户整理 */
  uncategorized: DiscoveredAsset[]
  /** model3.json 声明的原生动作组 [{group, count}] */
  nativeGroups: Array<{ group: string; count: number }>
}

const ASSET_SCAN_MAX = 200

/**
 * 嗅探模型目录树内全部 exp3/motion3 文件，按目录约定分类（目录即真相）：
 *   expressions/ 下的 .exp3.json → 表情
 *   costumes/     下的 .exp3.json → 换装
 *   motions/      下的 .motion3.json → 动作
 *   其他任何位置（模型目录平铺 / 任意深层子目录 / 约定目录中放错类型的文件）→ uncategorized
 * model3.json 声明且磁盘上确实存在的文件 discovered=false（沿用声明名）；
 * 声明指向的文件不存在（被移动/重命名后的死引用）直接隐藏，不列出。
 */
export function scanModelAssets(modelPath: string): ModelAssetScan {
  const resolved = resolveModelPath(modelPath)
  const dir = path.dirname(resolved)
  const result: ModelAssetScan = {
    modelPath: resolved,
    expressions: [],
    costumes: [],
    motions: [],
    uncategorized: [],
    nativeGroups: [],
  }

  // 1. model3.json 声明表：relPath（posix）→ 声明信息（仅用于给磁盘上真实存在的文件标注声明名）
  const declared = new Map<string, { name: string; group?: string }>()
  try {
    const json = JSON.parse(fs.readFileSync(resolved, 'utf8')) as {
      FileReferences?: {
        Expressions?: Array<{ Name?: string; File?: string }>
        Motions?: Record<string, Array<{ File?: string; Name?: string }>>
      }
    }
    const refs = json.FileReferences ?? {}
    for (const item of refs.Expressions ?? []) {
      if (!item?.File) continue
      declared.set(String(item.File).replace(/\\/g, '/'), {
        name: String(item.Name ?? path.basename(String(item.File), '.exp3.json')),
      })
    }
    for (const [group, list] of Object.entries(refs.Motions ?? {})) {
      if (!Array.isArray(list)) continue
      result.nativeGroups.push({ group, count: list.length })
      list.forEach((item, i) => {
        if (!item?.File) return
        declared.set(String(item.File).replace(/\\/g, '/'), { name: `${group}#${i}`, group })
      })
    }
  } catch {
    // model3.json 不可读时仅做目录嗅探
  }

  // 2. 全目录树遍历：所有 exp3/motion3 文件按所在顶层目录归类
  const walk = (absDir: string, relPrefix: string, depth: number) => {
    if (depth > 5) return
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(absDir, { withFileTypes: true }).slice(0, ASSET_SCAN_MAX)
    } catch { return }
    for (const entry of entries) {
      const rel = relPrefix + entry.name
      if (entry.isDirectory()) {
        walk(path.join(absDir, entry.name), rel + '/', depth + 1)
        continue
      }
      if (!entry.isFile()) continue
      const isExp = entry.name.endsWith('.exp3.json')
      const isMot = entry.name.endsWith('.motion3.json')
      if (!isExp && !isMot) continue
      const decl = declared.get(rel)
      const name = decl ? decl.name : path.basename(entry.name, isExp ? '.exp3.json' : '.motion3.json')
      const topDir = relPrefix.includes('/') ? relPrefix.split('/')[0] : ''
      if (isExp && topDir === 'expressions') {
        result.expressions.push({ name, file: rel, discovered: !decl })
      } else if (isExp && topDir === 'costumes') {
        result.costumes.push({ name, file: rel, discovered: !decl })
      } else if (isMot && topDir === 'motions') {
        result.motions.push({ name, file: rel, discovered: !decl, group: decl?.group ?? (relPrefix.split('/')[1] || 'Extra') })
      } else {
        result.uncategorized.push({
          name, file: rel, discovered: !decl,
          suggestedCategory: isExp ? 'expression' : 'motion',
        })
      }
    }
  }
  walk(dir, '', 0)

  return result
}

/** 把目录发现的未声明资源注入执行器（模型加载后调用） */
export async function pushDiscoveredAssets(cpp: CppClient, modelPath: string): Promise<void> {
  if (!cpp.isConnected()) return
  const assets = scanModelAssets(modelPath)
  // 表情与换装本质都是 Cubism 表情，注入同一列表
  const expressions = [
    ...assets.expressions.filter(e => e.discovered),
    ...assets.costumes.filter(c => c.discovered),
  ].map(e => ({ name: e.name, file: e.file }))
  const motions = assets.motions.filter(m => m.discovered).map(m => ({ name: m.name, file: m.file }))
  if (!expressions.length && !motions.length) return
  await cpp.request('live2d.loadExtra', { expressions, motions }).catch((err) => {
    console.warn('[live2d] loadExtra failed:', err instanceof Error ? err.message : String(err))
  })
}

export function buildLive2dModule(deps: Live2DModuleDeps): Record<string, RpcHandler> {
  const call = async (method: string, args: Record<string, unknown> = {}) => {
    if (!deps.cpp.isConnected()) {
      return { ok: false, error: 'C++ 执行器未连接' }
    }
    return deps.cpp.request(method, args)
  }

  return {
    'live2d.status': async () => {
      const remote = await call('live2d.status')
      return {
        connected: deps.cpp.isConnected(),
        config: deps.getConfig(),
        remote,
      }
    },
    'live2d.list': async () => call('live2d.list'),
    'live2d.models.scan': async (params) => {
      const rec = (params as { dir?: string }) ?? {}
      const cfg = deps.getConfig()
      const searchDirs: string[] = []

      if (rec.dir) {
        searchDirs.push(resolveBackendPath(rec.dir))
      }
      if (cfg.modelDir) {
        searchDirs.push(resolveBackendPath(cfg.modelDir))
      }
      // 默认搜索 C++ 执行器 Resources 目录和 backend/Resources
      searchDirs.push(resolveBackendPath('../cpp-executor/build/Debug/Resources'))
      searchDirs.push(resolveBackendPath('../cpp-executor/Resources'))
      searchDirs.push(resolveBackendPath('Resources'))
      searchDirs.push(resolveBackendPath('models'))

      const uniqueDirs = Array.from(new Set(searchDirs.filter(d => fs.existsSync(d))))
      const found: ModelEntry[] = []
      const seenPaths = new Set<string>()

      for (const d of uniqueDirs) {
        const results = scanModelsInDir(d)
        for (const m of results) {
          if (!seenPaths.has(m.path)) {
            seenPaths.add(m.path)
            found.push(m)
          }
        }
      }

      return {
        models: found,
        scannedDirs: uniqueDirs,
        currentModel: cfg.modelPath,
      }
    },
    /** 嗅探指定模型（默认当前模型）的表情/换装/动作/未分类，供 WebUI 资源注册面板使用 */
    'live2d.assets.scan': async (params) => {
      const rec = (params as { modelPath?: string }) ?? {}
      const modelPath = rec.modelPath || deps.getConfig().modelPath
      if (!modelPath) throw new Error('live2d.assets.scan requires { modelPath } or live2d.modelPath')
      return scanModelAssets(modelPath)
    },
    /**
     * 物理移动资源文件到约定目录（expressions/ costumes/ motions/）。
     * 声明项被移动后旧声明成死引用（嗅探隐藏），文件在新位置作为目录发现资源经 loadExtra 注入。
     */
    'live2d.assets.organize': async (params) => {
      const rec = (params as { modelPath?: string; moves?: Array<{ file: string; category: string }> }) ?? {}
      const modelPath = rec.modelPath || deps.getConfig().modelPath
      if (!modelPath) throw new Error('requires { modelPath }')
      const modelDir = path.dirname(resolveModelPath(modelPath))
      const dirMap: Record<string, string> = { expression: 'expressions', costume: 'costumes', motion: 'motions' }
      const moved: string[] = []
      const failed: Array<{ file: string; error: string }> = []
      for (const mv of rec.moves ?? []) {
        try {
          const targetDirName = dirMap[mv.category]
          if (!targetDirName) throw new Error(`unknown category: ${mv.category}`)
          // 扩展名与目标目录必须匹配（错误的目录会让文件从嗅探中消失）
          if (mv.category === 'motion' && !mv.file.endsWith('.motion3.json')) throw new Error('动作目录只接受 .motion3.json 文件')
          if (mv.category !== 'motion' && !mv.file.endsWith('.exp3.json')) throw new Error('表情/换装目录只接受 .exp3.json 文件')
          const fromAbs = path.resolve(modelDir, mv.file)
          // 路径安全：from/to 必须在模型目录内
          if (!fromAbs.startsWith(path.resolve(modelDir))) throw new Error('path outside model dir')
          const filename = path.basename(mv.file)
          const toAbs = path.join(modelDir, targetDirName, filename)
          // Windows 上 rename 会静默覆盖已存在的目标，必须显式拒绝
          if (fs.existsSync(toAbs)) throw new Error(`目标文件已存在: ${targetDirName}/${filename}`)
          fs.mkdirSync(path.dirname(toAbs), { recursive: true })
          fs.renameSync(fromAbs, toAbs)
          moved.push(`${mv.file} → ${targetDirName}/${filename}`)
        } catch (err) {
          failed.push({ file: mv.file, error: err instanceof Error ? err.message : String(err) })
        }
      }
      // 移动后重新注入执行器
      if (moved.length) await pushDiscoveredAssets(deps.cpp, modelPath)
      return { ok: failed.length === 0, moved, failed }
    },
    /** 重命名资源文件（文件名 = LLM 可见名称） */
    'live2d.assets.rename': async (params) => {
      const rec = (params as { modelPath?: string; file: string; newName: string }) ?? {}
      const modelPath = rec.modelPath || deps.getConfig().modelPath
      if (!modelPath || !rec.file || !rec.newName) throw new Error('requires { modelPath, file, newName }')
      const modelDir = path.dirname(resolveModelPath(modelPath))
      const fromAbs = path.resolve(modelDir, rec.file)
      if (!fromAbs.startsWith(path.resolve(modelDir))) throw new Error('path outside model dir')
      // Cubism 资源为多段扩展名（.exp3.json / .motion3.json），不能只取 path.extname
      const ext = rec.file.endsWith('.exp3.json') ? '.exp3.json'
        : rec.file.endsWith('.motion3.json') ? '.motion3.json'
        : path.extname(rec.file)
      const newFilename = rec.newName.replace(/[\\/:*?"<>|]/g, '_') + ext
      const toAbs = path.join(path.dirname(fromAbs), newFilename)
      if (fs.existsSync(toAbs)) throw new Error(`目标文件已存在: ${newFilename}`)
      fs.renameSync(fromAbs, toAbs)
      const newRel = path.relative(modelDir, toAbs).replace(/\\/g, '/')
      return { ok: true, oldName: path.basename(rec.file, ext), newName: rec.newName, newFile: newRel }
    },
    'live2d.load': async (params) => {
      const rec = (params as { path?: string }) ?? {}
      const modelPath = rec.path || deps.getConfig().modelPath
      if (!modelPath) throw new Error('live2d.load requires { path } or live2d.modelPath')
      const result = await call('live2d.load', { path: resolveModelPath(modelPath) })
      // 目录发现的未声明资源注入（表情+命名动作），声明资源模型加载时已就绪
      await pushDiscoveredAssets(deps.cpp, modelPath)
      return result
    },
    'live2d.expression': async (params) => {
      const name = String((params as { name?: string })?.name ?? '')
      return call('live2d.expression', { name })
    },
    'live2d.resetExpression': async () => call('live2d.resetExpression'),
    'live2d.motion': async (params) => {
      const rec = (params as { name?: string; group?: string; index?: number }) ?? {}
      // name（命名动作）优先；否则 group+index
      if (rec.name) return call('live2d.motion', { name: String(rec.name) })
      return call('live2d.motion', {
        group: rec.group || 'Idle',
        index: Number(rec.index ?? 0),
      })
    },
    'live2d.transform': async (params) => {
      const rec = (params as { scale?: number; x?: number; y?: number }) ?? {}
      const cfg = deps.getConfig()
      return call('live2d.transform', {
        scale: rec.scale ?? cfg.scale,
        x: rec.x ?? cfg.x,
        y: rec.y ?? cfg.y,
      })
    },
  }
}

export async function applyLive2dConfig(cpp: CppClient, config: Live2DConfig): Promise<void> {
  if (!cpp.isConnected()) return
  if (config.modelPath) {
    await cpp.request('live2d.load', { path: resolveModelPath(config.modelPath) }).catch((err) => {
      console.warn('[live2d] load from config failed:', err)
    })
    await pushDiscoveredAssets(cpp, config.modelPath)
  }
  await cpp.request('live2d.transform', {
    scale: config.scale,
    x: config.x,
    y: config.y,
  }).catch((err) => {
    console.warn('[live2d] transform from config failed:', err)
  })
  await applyWindowConfig(cpp, config.window)
}

/** 把窗口配置（宽/高/透明/置顶）推送给执行器，运行时生效 */
export async function applyWindowConfig(
  cpp: CppClient,
  win: { width: number; height: number; transparent: boolean; alwaysOnTop: boolean },
): Promise<void> {
  if (!cpp.isConnected()) return
  await cpp.request('window.apply', {
    width: win.width,
    height: win.height,
    transparent: Boolean(win.transparent),
    alwaysOnTop: Boolean(win.alwaysOnTop),
  }).catch((err) => {
    console.warn('[live2d] window apply failed:', err)
  })
}

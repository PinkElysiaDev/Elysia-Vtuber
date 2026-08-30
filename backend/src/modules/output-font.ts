/** 展示板自定义字体 RPC：上传（base64 → 配置目录 fonts/）与清除；文件经 HTTP /fonts/ 提供 */
import * as fs from 'fs'
import * as path from 'path'
import type { RpcHandler } from '../core/rpc'
import type { BackendConfig } from '../config'

const ALLOWED_EXTS = new Set(['.woff2', '.woff', '.ttf', '.otf'])
const MAX_FONT_BYTES = 20 * 1024 * 1024

export interface OutputFontModuleDeps {
  getConfig: () => BackendConfig
  configPath: string
  save: (mutate: (config: BackendConfig) => void) => void
}

/** 字体目录：与配置文件同目录下的 fonts/ */
export function fontsDir(configPath: string): string {
  return path.join(path.dirname(path.resolve(configPath)), 'fonts')
}

function sanitizeFilename(name: string | undefined): string {
  return path.basename(String(name ?? '')).replace(/[^\w.-]+/g, '_').slice(0, 120)
}

export function buildOutputFontModule(deps: OutputFontModuleDeps): Record<string, RpcHandler> {
  return {
    'output.font.upload': (params) => {
      const rec = (params as { filename?: string; dataBase64?: string }) ?? {}
      const filename = sanitizeFilename(rec.filename)
      const ext = path.extname(filename).toLowerCase()
      if (!filename || !ext || !ALLOWED_EXTS.has(ext)) {
        throw new Error(`字体文件仅支持 ${[...ALLOWED_EXTS].join(' / ')}`)
      }
      let buffer: Buffer
      try {
        buffer = Buffer.from(String(rec.dataBase64 ?? ''), 'base64')
      } catch {
        throw new Error('字体数据不是合法 base64')
      }
      if (!buffer.length || buffer.length > MAX_FONT_BYTES) {
        throw new Error(`字体文件大小需在 1B ~ ${Math.round(MAX_FONT_BYTES / 1024 / 1024)}MB 之间`)
      }
      const dir = fontsDir(deps.configPath)
      fs.mkdirSync(dir, { recursive: true })
      const target = path.join(dir, filename)
      if (!target.startsWith(dir)) throw new Error('非法文件名')
      // 换新文件时清掉旧字体文件，目录内只保留当前一个
      for (const old of fs.readdirSync(dir)) {
        if (ALLOWED_EXTS.has(path.extname(old).toLowerCase())) {
          try { fs.unlinkSync(path.join(dir, old)) } catch { /* 忽略 */ }
        }
      }
      fs.writeFileSync(target, buffer)
      const fontFamily = path.basename(filename, ext) || 'custom-font'
      deps.save((config) => {
        config.output.display.fontFile = filename
        config.output.display.fontFamily = fontFamily
      })
      return { ok: true, fontFile: filename, fontFamily }
    },
    'output.font.clear': () => {
      deps.save((config) => {
        config.output.display.fontFile = ''
        config.output.display.fontFamily = ''
      })
      try {
        const dir = fontsDir(deps.configPath)
        for (const old of fs.readdirSync(dir)) {
          if (ALLOWED_EXTS.has(path.extname(old).toLowerCase())) {
            try { fs.unlinkSync(path.join(dir, old)) } catch { /* 忽略 */ }
          }
        }
      } catch { /* 目录不存在则忽略 */ }
      return { ok: true }
    },
    'output.font.status': () => {
      const display = deps.getConfig().output.display
      return { fontFile: display.fontFile, fontFamily: display.fontFamily }
    },
  }
}

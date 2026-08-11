/**
 * 后端配置管理
 */

import * as fs from 'fs/promises'
import * as path from 'path'

export interface ServerConfig {
  host: string
  port: number
  corsOrigin?: string
}

export interface MusicConfig {
  enableNetease: boolean
  enableQQ: boolean
  enableBilibili: boolean
  defaultVolume: number
  maxDuration: number
  outputDevice?: string
  idlePlaylist: string[]
}

export interface BackendConfig {
  server: ServerConfig
  music: MusicConfig
}

const defaultConfig: BackendConfig = {
  server: {
    host: '0.0.0.0',
    port: 19264
  },
  music: {
    enableNetease: true,
    enableQQ: true,
    enableBilibili: false,
    defaultVolume: 0.8,
    maxDuration: 600,
    idlePlaylist: []
  }
}

/**
 * 加载配置文件
 */
export async function loadConfig(): Promise<BackendConfig> {
  const configPath = path.join(process.cwd(), 'backend-config.json')

  try {
    const content = await fs.readFile(configPath, 'utf-8')
    const userConfig = JSON.parse(content)
    return mergeConfig(defaultConfig, userConfig)
  } catch (error) {
    if ((error as any).code === 'ENOENT') {
      // 配置文件不存在，创建默认配置
      await saveConfig(defaultConfig)
      console.log(`已创建默认配置文件: ${configPath}`)
      return defaultConfig
    }
    throw error
  }
}

/**
 * 保存配置文件
 */
export async function saveConfig(config: BackendConfig): Promise<void> {
  const configPath = path.join(process.cwd(), 'backend-config.json')
  await fs.writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8')
}

/**
 * 合并配置
 */
function mergeConfig(defaults: BackendConfig, userConfig: any): BackendConfig {
  return {
    server: {
      ...defaults.server,
      ...userConfig.server
    },
    music: {
      ...defaults.music,
      ...userConfig.music
    }
  }
}

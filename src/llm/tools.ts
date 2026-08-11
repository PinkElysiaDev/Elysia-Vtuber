/**
 * LLM 工具定义和注册
 */

import { Context } from 'koishi'
import { BackendClient } from '../backend/client'
import type { ToolDefinition } from '../types'

/**
 * 注册所有工具
 */
export function registerAllTools(
  ctx: Context,
  backendClient?: BackendClient
): ToolDefinition[] {
  const tools: ToolDefinition[] = []

  // Live2D 工具（需要后端）
  if (backendClient) {
    tools.push(...createLive2DTools(backendClient))
    tools.push(...createJukeboxTools(backendClient))
    tools.push(...createDisplayTools(backendClient))
  }

  // 直播间信息工具（不需要后端）
  tools.push(...createLiveRoomTools(ctx))

  return tools
}

/**
 * Live2D 控制工具
 */
function createLive2DTools(backendClient: BackendClient): ToolDefinition[] {
  return [
    {
      name: 'live2d_load_model',
      description: '加载 Live2D 模型',
      parameters: {
        type: 'object',
        properties: {
          modelPath: {
            type: 'string',
            description: '模型文件路径（.model3.json）'
          }
        },
        required: ['modelPath']
      },
      handler: async (args) => {
        await backendClient.call('live2d.load', args)
        return { success: true, message: '模型加载成功' }
      }
    },
    {
      name: 'live2d_set_expression',
      description: '设置 Live2D 表情',
      parameters: {
        type: 'object',
        properties: {
          expression: {
            type: 'string',
            description: '表情名称（如 f01, f02 等）'
          }
        },
        required: ['expression']
      },
      handler: async (args) => {
        await backendClient.call('live2d.setExpression', args)
        return { success: true, message: `表情已设置为: ${args.expression}` }
      }
    },
    {
      name: 'live2d_play_motion',
      description: '播放 Live2D 动作',
      parameters: {
        type: 'object',
        properties: {
          group: {
            type: 'string',
            description: '动作组名称（如 Idle, TapBody 等）'
          },
          index: {
            type: 'number',
            description: '动作索引（可选，默认 0）'
          }
        },
        required: ['group']
      },
      handler: async (args) => {
        await backendClient.call('live2d.playMotion', args)
        return { success: true, message: `动作已播放: ${args.group}` }
      }
    },
    {
      name: 'live2d_set_position',
      description: '设置 Live2D 模型位置',
      parameters: {
        type: 'object',
        properties: {
          x: {
            type: 'number',
            description: 'X 坐标偏移（像素）'
          },
          y: {
            type: 'number',
            description: 'Y 坐标偏移（像素）'
          }
        },
        required: ['x', 'y']
      },
      handler: async (args) => {
        await backendClient.call('live2d.setPosition', args)
        return { success: true, message: `位置已设置: (${args.x}, ${args.y})` }
      }
    },
    {
      name: 'live2d_set_scale',
      description: '设置 Live2D 模型缩放',
      parameters: {
        type: 'object',
        properties: {
          scale: {
            type: 'number',
            description: '缩放比例（0.1 - 3.0）',
            minimum: 0.1,
            maximum: 3.0
          }
        },
        required: ['scale']
      },
      handler: async (args) => {
        await backendClient.call('live2d.setScale', args)
        return { success: true, message: `缩放已设置: ${args.scale}` }
      }
    },
    {
      name: 'live2d_get_expressions',
      description: '获取可用的 Live2D 表情列表',
      parameters: {
        type: 'object',
        properties: {}
      },
      handler: async () => {
        const result = await backendClient.call('live2d.getExpressions', {})
        return { expressions: result }
      }
    },
    {
      name: 'live2d_get_motion_groups',
      description: '获取可用的 Live2D 动作组列表',
      parameters: {
        type: 'object',
        properties: {}
      },
      handler: async () => {
        const result = await backendClient.call('live2d.getMotionGroups', {})
        return { motionGroups: result }
      }
    }
  ]
}

/**
 * 点歌机工具
 */
function createJukeboxTools(backendClient: BackendClient): ToolDefinition[] {
  return [
    {
      name: 'jukebox_search_song',
      description: '搜索歌曲',
      parameters: {
        type: 'object',
        properties: {
          keyword: {
            type: 'string',
            description: '搜索关键词（歌名或歌手）'
          },
          source: {
            type: 'string',
            description: '音源（可选：netease/qq/bilibili，默认 netease）',
            enum: ['netease', 'qq', 'bilibili']
          }
        },
        required: ['keyword']
      },
      handler: async (args) => {
        const result = await backendClient.call('music.search', args)
        return { results: result }
      }
    },
    {
      name: 'jukebox_add_song',
      description: '添加歌曲到播放列表',
      parameters: {
        type: 'object',
        properties: {
          songId: {
            type: 'string',
            description: '歌曲 ID'
          },
          source: {
            type: 'string',
            description: '音源',
            enum: ['netease', 'qq', 'bilibili']
          },
          requester: {
            type: 'string',
            description: '点歌人（可选）'
          }
        },
        required: ['songId', 'source']
      },
      handler: async (args) => {
        await backendClient.call('music.add', args)
        return { success: true, message: '歌曲已添加到播放列表' }
      }
    },
    {
      name: 'jukebox_skip_song',
      description: '切歌（跳过当前歌曲）',
      parameters: {
        type: 'object',
        properties: {}
      },
      handler: async () => {
        await backendClient.call('music.skip', {})
        return { success: true, message: '已切歌' }
      }
    },
    {
      name: 'jukebox_pause',
      description: '暂停播放',
      parameters: {
        type: 'object',
        properties: {}
      },
      handler: async () => {
        await backendClient.call('music.pause', {})
        return { success: true, message: '已暂停播放' }
      }
    },
    {
      name: 'jukebox_resume',
      description: '恢复播放',
      parameters: {
        type: 'object',
        properties: {}
      },
      handler: async () => {
        await backendClient.call('music.play', {})
        return { success: true, message: '已恢复播放' }
      }
    },
    {
      name: 'jukebox_get_queue',
      description: '获取播放队列',
      parameters: {
        type: 'object',
        properties: {}
      },
      handler: async () => {
        const result = await backendClient.call('music.getQueue', {})
        return { queue: result }
      }
    },
    {
      name: 'jukebox_get_current_song',
      description: '获取当前播放歌曲信息',
      parameters: {
        type: 'object',
        properties: {}
      },
      handler: async () => {
        const result = await backendClient.call('music.getNowPlaying', {})
        return { currentSong: result }
      }
    },
    {
      name: 'jukebox_set_volume',
      description: '设置音量',
      parameters: {
        type: 'object',
        properties: {
          volume: {
            type: 'number',
            description: '音量（0-100）',
            minimum: 0,
            maximum: 100
          }
        },
        required: ['volume']
      },
      handler: async (args) => {
        await backendClient.call('music.setVolume', args)
        return { success: true, message: `音量已设置为: ${args.volume}` }
      }
    }
  ]
}

/**
 * 展示板工具
 */
function createDisplayTools(backendClient: BackendClient): ToolDefinition[] {
  return [
    {
      name: 'display_show_text',
      description: '在展示板窗口显示文本',
      parameters: {
        type: 'object',
        properties: {
          text: {
            type: 'string',
            description: '要显示的文本内容'
          },
          style: {
            type: 'string',
            description: '显示样式（可选：plain/markdown/html，默认 plain）',
            enum: ['plain', 'markdown', 'html']
          },
          duration: {
            type: 'number',
            description: '显示时长（毫秒，0 表示持续显示）'
          }
        },
        required: ['text']
      },
      handler: async (args) => {
        await backendClient.call('display.show', {
          text: args.text,
          style: args.style || 'plain',
          emotion: 'neutral',
          duration: args.duration
        })
        return { success: true, message: '文本已显示' }
      }
    }
  ]
}

/**
 * 直播间信息工具
 */
function createLiveRoomTools(ctx: Context): ToolDefinition[] {
  return [
    {
      name: 'get_live_room_info',
      description: '获取直播间信息（在线人数、点赞数等）',
      parameters: {
        type: 'object',
        properties: {}
      },
      handler: async (_args, context) => {
        // 从事件缓存获取直播间信息
        // 这里需要访问 EventCache，暂时返回示例数据
        const logger = context.logger('vtuber')
        logger.debug('获取直播间信息')

        // TODO: 从 EventCache 获取实际数据
        return {
          online: 0,
          likes: 0,
          followers: 0,
          isLive: false
        }
      }
    }
  ]
}

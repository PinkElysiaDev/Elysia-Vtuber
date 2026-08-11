/**
 * LLM 适配器导出
 */

export { BaseLLMAdapter, type LLMAdapter } from './base'
export { OpenAIAdapter } from './openai'
export { AnthropicAdapter } from './anthropic'
export { GeminiAdapter } from './gemini'

import { LLMAdapter } from './base'
import { OpenAIAdapter } from './openai'
import { AnthropicAdapter } from './anthropic'
import { GeminiAdapter } from './gemini'
import type { ProviderConfig } from '../../types'

/**
 * 创建 LLM 适配器
 */
export function createLLMAdapter(config: ProviderConfig): LLMAdapter {
  const adapterConfig = {
    apiKey: config.apiKey,
    baseURL: config.baseURL,
    model: config.model,
    customHeaders: config.customHeaders
  }

  switch (config.provider) {
    case 'openai':
      return new OpenAIAdapter(adapterConfig)
    case 'anthropic':
      return new AnthropicAdapter(adapterConfig)
    case 'gemini':
      return new GeminiAdapter(adapterConfig)
    default:
      throw new Error(`Unknown provider: ${config.provider}`)
  }
}

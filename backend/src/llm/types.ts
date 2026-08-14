export interface ToolCall {
  id: string
  name: string
  arguments: Record<string, unknown>
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  toolCalls?: ToolCall[]
  toolCallId?: string
  name?: string
}

export interface ToolSpec {
  name: string
  description: string
  parameters: Record<string, unknown>
}

export interface ChatResult {
  content: string
  finishReason: string
  toolCalls: ToolCall[]
  raw?: unknown
}

export interface ChatRequest {
  messages: ChatMessage[]
  tools?: ToolSpec[]
}

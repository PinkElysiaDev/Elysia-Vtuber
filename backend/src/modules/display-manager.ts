/**
 * 展示内容
 */
export interface DisplayContent {
  type: 'text' | 'html'
  content: string
  timestamp: number
  duration?: number
}

/**
 * 展示板管理器
 *
 * 用于管理文本/HTML 展示窗口的内容
 */
export class DisplayManager {
  private currentContent: DisplayContent | null = null
  private history: DisplayContent[] = []
  private maxHistorySize = 50

  /**
   * 显示文本
   */
  async showText(params: {
    text: string
    duration?: number
    style?: {
      fontSize?: number
      color?: string
      backgroundColor?: string
    }
  }): Promise<void> {
    console.log(`Showing text: ${params.text.substring(0, 50)}...`)

    // 构建 HTML
    const fontSize = params.style?.fontSize || 24
    const color = params.style?.color || '#ffffff'
    const backgroundColor = params.style?.backgroundColor || 'rgba(0, 0, 0, 0.7)'

    const html = `
      <div style="
        font-size: ${fontSize}px;
        color: ${color};
        background-color: ${backgroundColor};
        padding: 20px;
        border-radius: 8px;
        text-align: center;
        word-wrap: break-word;
      ">
        ${this.escapeHtml(params.text)}
      </div>
    `

    await this.showHTML({ html, duration: params.duration })
  }

  /**
   * 显示 HTML
   */
  async showHTML(params: {
    html: string
    duration?: number
  }): Promise<void> {
    console.log('Showing HTML content')

    const content: DisplayContent = {
      type: 'html',
      content: params.html,
      timestamp: Date.now(),
      duration: params.duration,
    }

    this.currentContent = content
    this.addToHistory(content)

    // TODO: 向展示板窗口发送内容
    // 需要通过 IPC 或 WebSocket 通信

    // 如果设置了持续时间，自动清除
    if (params.duration) {
      setTimeout(() => {
        if (this.currentContent === content) {
          this.clear()
        }
      }, params.duration)
    }
  }

  /**
   * 清除内容
   */
  clear(): void {
    console.log('Clearing display')
    this.currentContent = null

    // TODO: 清除展示板窗口内容
  }

  /**
   * 获取当前内容
   */
  getCurrentContent(): DisplayContent | null {
    return this.currentContent ? { ...this.currentContent } : null
  }

  /**
   * 获取历史记录
   */
  getHistory(limit?: number): DisplayContent[] {
    const history = [...this.history].reverse()
    return limit ? history.slice(0, limit) : history
  }

  /**
   * 添加到历史记录
   */
  private addToHistory(content: DisplayContent): void {
    this.history.push(content)

    // 限制历史记录大小
    if (this.history.length > this.maxHistorySize) {
      this.history.shift()
    }
  }

  /**
   * 清除历史记录
   */
  clearHistory(): void {
    console.log('Clearing display history')
    this.history = []
  }

  /**
   * HTML 转义
   */
  private escapeHtml(text: string): string {
    const map: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;',
    }
    return text.replace(/[&<>"']/g, m => map[m])
  }
}

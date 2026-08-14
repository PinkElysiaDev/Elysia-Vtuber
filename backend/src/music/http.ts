export interface HttpResponse {
  status: number
  url: string
  text: string
  location: string
  headers: Record<string, string>
  json<T = any>(): T
}

export async function httpRequest(url: string, options: {
  method?: string
  headers?: Record<string, string>
  body?: string | Buffer
  timeoutMs?: number
  redirect?: 'follow' | 'manual'
} = {}): Promise<HttpResponse> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 8000)
  try {
    const res = await fetch(url, {
      method: options.method ?? 'GET',
      headers: options.headers,
      body: options.body,
      signal: controller.signal,
      redirect: options.redirect ?? 'follow',
    } as RequestInit)
    const text = await res.text()
    const headers: Record<string, string> = {}
    res.headers.forEach((value, key) => { headers[key.toLowerCase()] = value })
    return {
      status: res.status,
      url: res.url,
      text,
      location: headers.location ?? '',
      headers,
      json<T = any>() {
        try { return JSON.parse(text) as T } catch { return {} as T }
      },
    }
  } finally {
    clearTimeout(timer)
  }
}

export function httpGet(url: string, headers?: Record<string, string>, timeoutMs?: number): Promise<HttpResponse> {
  return httpRequest(url, { headers, timeoutMs })
}

export function firstNonEmpty(...values: Array<string | undefined | null>): string {
  for (const value of values) {
    const text = String(value ?? '').trim()
    if (text) return text
  }
  return ''
}

export function decodeHtml(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
}

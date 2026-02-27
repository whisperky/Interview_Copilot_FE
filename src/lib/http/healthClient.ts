export interface HealthSnapshot {
  live: boolean
  ready: boolean
  degraded: boolean
  error?: string
}

interface HealthResponse {
  status: string
}

async function fetchJsonWithTimeout<T>(url: string, timeoutMs = 4_000): Promise<T> {
  const controller = new AbortController()
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, { signal: controller.signal })
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }
    return (await response.json()) as T
  } finally {
    window.clearTimeout(timeoutId)
  }
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl
}

export async function getHealthSnapshot(baseUrl: string): Promise<HealthSnapshot> {
  const normalized = normalizeBaseUrl(baseUrl)
  try {
    const [live, ready] = await Promise.all([
      fetchJsonWithTimeout<HealthResponse>(`${normalized}/health`),
      fetchJsonWithTimeout<HealthResponse>(`${normalized}/health/ready`),
    ])

    const liveOk = live.status === 'ok'
    const readyOk = ready.status === 'ready'
    return {
      live: liveOk,
      ready: readyOk,
      degraded: !(liveOk && readyOk),
    }
  } catch (error) {
    return {
      live: false,
      ready: false,
      degraded: true,
      error: error instanceof Error ? error.message : 'Health check failed',
    }
  }
}


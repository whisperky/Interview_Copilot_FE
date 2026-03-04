/* eslint-disable no-console */

const API_BASE = process.env.API_BASE_URL ?? process.env.VITE_API_BASE_URL ?? 'http://localhost:8000'
const WS_BASE = process.env.WS_BASE_URL ?? process.env.VITE_WS_BASE_URL ?? 'ws://localhost:8000'
const WS_URL = `${WS_BASE.replace(/\/$/, '')}/ws/session`
const HTTP_TIMEOUT_MS = 6000
const WS_TIMEOUT_MS = 20000

function withTimeout(promise, timeoutMs, label) {
  return new Promise((resolve, reject) => {
    const id = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs)
    promise
      .then((value) => {
        clearTimeout(id)
        resolve(value)
      })
      .catch((error) => {
        clearTimeout(id)
        reject(error)
      })
  })
}

async function fetchHealth(path) {
  const url = `${API_BASE.replace(/\/$/, '')}${path}`
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS)
  try {
    const res = await fetch(url, { signal: controller.signal })
    if (!res.ok) {
      throw new Error(`${path} returned HTTP ${res.status}`)
    }
    return await res.json()
  } finally {
    clearTimeout(timeout)
  }
}

async function runHttpChecks() {
  console.log(`HTTP check: ${API_BASE}`)
  const [health, ready] = await Promise.all([fetchHealth('/health'), fetchHealth('/health/ready')])
  if (health.status !== 'ok') {
    throw new Error(`/health status expected "ok", got "${health.status}"`)
  }
  if (ready.status !== 'ready') {
    throw new Error(`/health/ready status expected "ready", got "${ready.status}"`)
  }
  console.log('HTTP checks passed.')
}

async function runWebSocketChecks() {
  if (typeof WebSocket !== 'function') {
    throw new Error('Global WebSocket unavailable. Use Node 20+ for smoke test.')
  }

  console.log(`WS check: ${WS_URL}`)
  const ws = new WebSocket(WS_URL)
  const events = []

  const wsPromise = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      try {
        ws.close()
      } catch {
        // no-op
      }
      reject(new Error('WebSocket flow timed out'))
    }, WS_TIMEOUT_MS)

    ws.addEventListener('open', () => {
      ws.send(
        JSON.stringify({
          type: 'preferences',
          tone: 'confident',
          max_seconds: 60,
          include_example: true,
          technical_mode: false,
          simplify_english: false,
        })
      )
      ws.send(
        JSON.stringify({
          type: 'resume_context',
          text: 'Smoke test context',
        })
      )
      ws.send(
        JSON.stringify({
          type: 'test_send_transcript',
          text: 'Tell me about your biggest strength.',
          is_final: true,
        })
      )
      ws.send(JSON.stringify({ type: 'answer_now' }))
    })

    ws.addEventListener('message', (event) => {
      try {
        const data = JSON.parse(String(event.data))
        const type = data?.type ?? 'unknown'
        events.push(type)

        if (type === 'answer_done' || type === 'error') {
          clearTimeout(timeout)
          ws.close()
          resolve({ events, terminalType: type, payload: data })
        }
      } catch (error) {
        clearTimeout(timeout)
        ws.close()
        reject(new Error(`Invalid JSON frame: ${String(error)}`))
      }
    })

    ws.addEventListener('error', () => {
      clearTimeout(timeout)
      reject(new Error('WebSocket transport error during smoke test'))
    })
  })

  const result = await withTimeout(wsPromise, WS_TIMEOUT_MS + 1000, 'ws smoke')
  const requiredAnyOf = ['answer_done', 'error']
  if (!requiredAnyOf.includes(result.terminalType)) {
    throw new Error(`Expected terminal frame answer_done/error, got ${result.terminalType}`)
  }

  if (!events.includes('transcript')) {
    throw new Error(`Expected transcript event, got: ${events.join(', ')}`)
  }

  console.log(`WS checks passed with terminal frame: ${result.terminalType}`)
  console.log(`WS events seen: ${events.join(', ')}`)
}

async function main() {
  console.log('Running frontend integration smoke test...')
  await runHttpChecks()
  await runWebSocketChecks()
  console.log('Smoke test completed successfully.')
}

main().catch((error) => {
  console.error(`Smoke test failed: ${error.message}`)
  process.exitCode = 1
})


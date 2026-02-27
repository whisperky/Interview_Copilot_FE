import { useEffect, useMemo, useRef, useState } from 'react'
import { getHealthSnapshot, type HealthSnapshot } from './lib/http/healthClient'
import {
  type ServerWsMessage,
  type SessionPreferences,
  WS_EVENT_TYPES,
} from './lib/contracts/protocol'
import { runProtocolSelfTest } from './lib/contracts/selfTest'
import { WsSessionClient, type SessionConnectionStatus } from './lib/ws/sessionClient'

function App() {
  const [alwaysOnTop, setAlwaysOnTop] = useState(true)
  const [opacity, setOpacity] = useState(1)
  const hasDesktopApi = typeof window !== 'undefined' && typeof window.desktop !== 'undefined'
  const testResults = useMemo(() => runProtocolSelfTest(), [])
  const passedCount = testResults.filter((test) => test.ok).length
  const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000'
  const wsBaseUrl = import.meta.env.VITE_WS_BASE_URL ?? 'ws://localhost:8000'

  const clientRef = useRef<WsSessionClient | null>(null)
  if (!clientRef.current) {
    clientRef.current = new WsSessionClient(wsBaseUrl)
  }

  const [health, setHealth] = useState<HealthSnapshot>({
    live: false,
    ready: false,
    degraded: true,
  })
  const [connectionStatus, setConnectionStatus] = useState<SessionConnectionStatus>('idle')
  const [retryCount, setRetryCount] = useState(0)
  const [lastError, setLastError] = useState<string | null>(null)
  const [lastServerEvent, setLastServerEvent] = useState<string>('none')
  const [resumeContext, setResumeContext] = useState('')
  const [testTranscript, setTestTranscript] = useState('What is your biggest strength?')
  const [audioMode, setAudioMode] = useState('idle')
  const [audioStreamActive, setAudioStreamActive] = useState(false)
  const [audioBytesSent, setAudioBytesSent] = useState(0)
  const [audioChunksSent, setAudioChunksSent] = useState(0)
  const [audioChunksDropped, setAudioChunksDropped] = useState(0)
  const [audioWarning, setAudioWarning] = useState<string | null>(null)

  const [preferences, setPreferences] = useState<SessionPreferences>({
    tone: 'confident',
    max_seconds: 60,
    include_example: true,
    technical_mode: false,
    simplify_english: false,
  })

  useEffect(() => {
    let isMounted = true
    const pollHealth = async () => {
      const snapshot = await getHealthSnapshot(apiBaseUrl)
      if (isMounted) setHealth(snapshot)
    }

    void pollHealth()
    const id = window.setInterval(() => {
      void pollHealth()
    }, 10_000)

    return () => {
      isMounted = false
      window.clearInterval(id)
    }
  }, [apiBaseUrl])

  useEffect(() => {
    if (!hasDesktopApi) return
    void window.desktop.getAudioStatus().then((status) => {
      setAudioMode(status.mode)
      setAudioStreamActive(status.mode !== 'idle')
    })
  }, [hasDesktopApi])

  useEffect(() => {
    const client = clientRef.current
    if (!client) return

    const unStatus = client.onStatus((event) => {
      setConnectionStatus(event.status)
      setRetryCount(event.attempt)
      if (event.error) setLastError(event.error)
    })
    const unError = client.onError((error) => setLastError(error))
    const unMessage = client.onMessage((message: ServerWsMessage) => {
      setLastServerEvent(formatServerEvent(message))
    })

    return () => {
      unStatus()
      unError()
      unMessage()
      client.disconnect()
    }
  }, [])

  useEffect(() => {
    if (!hasDesktopApi) return
    const unsubscribe = window.desktop.onAudioChunk((chunk) => {
      const sent = clientRef.current?.send({
        type: WS_EVENT_TYPES.audio,
        payload: chunk.payload,
      })
      if (sent) {
        setAudioBytesSent((prev) => prev + chunk.byteLength)
        setAudioChunksSent((prev) => prev + 1)
      } else {
        setAudioChunksDropped((prev) => prev + 1)
      }
    })
    return () => {
      unsubscribe()
    }
  }, [hasDesktopApi])

  const onToggleTop = async () => {
    if (!hasDesktopApi) return
    const next = !alwaysOnTop
    setAlwaysOnTop(next)
    await window.desktop.setAlwaysOnTop(next)
  }

  const onOpacity = async (value: number) => {
    if (!hasDesktopApi) return
    setOpacity(value)
    await window.desktop.setOpacity(value)
  }

  const connectSession = () => {
    clientRef.current?.connect()
  }

  const disconnectSession = () => {
    clientRef.current?.disconnect()
  }

  const sendPreferences = () => {
    const sent = clientRef.current?.send({
      type: WS_EVENT_TYPES.preferences,
      ...preferences,
    })
    if (!sent) {
      setLastError('Preferences queued until WebSocket reconnects')
    }
  }

  const sendResumeContext = () => {
    if (!resumeContext.trim()) return
    const sent = clientRef.current?.send({
      type: WS_EVENT_TYPES.resumeContext,
      text: resumeContext,
    })
    if (!sent) {
      setLastError('Resume context queued until WebSocket reconnects')
    }
  }

  const sendTranscriptTest = () => {
    if (!testTranscript.trim()) return
    clientRef.current?.send({
      type: WS_EVENT_TYPES.testSendTranscript,
      text: testTranscript,
      is_final: true,
    })
  }

  const sendAnswerNow = () => {
    clientRef.current?.send({ type: WS_EVENT_TYPES.answerNow })
  }

  const startAudioStream = async () => {
    if (!hasDesktopApi) return
    const status = await window.desktop.startAudioStream()
    setAudioMode(status.mode)
    setAudioStreamActive(status.mode !== 'idle')
    setAudioWarning(status.warning ?? null)
  }

  const stopAudioStream = async () => {
    if (!hasDesktopApi) return
    const status = await window.desktop.stopAudioStream()
    setAudioMode(status.mode)
    setAudioStreamActive(false)
  }

  return (
    <div className="h-screen bg-zinc-950 text-zinc-100">
      <header className="drag-region flex items-center justify-between border-b border-zinc-800 px-3 py-2">
        <div className="text-sm font-medium">Interview Copilot</div>
        <div className="no-drag flex gap-2">
          <button
            className="rounded bg-zinc-800 px-2 py-1 text-xs hover:bg-zinc-700"
            disabled={!hasDesktopApi}
            onClick={() => window.desktop.minimize()}
            type="button"
          >
            _
          </button>
          <button
            className="rounded bg-red-600 px-2 py-1 text-xs hover:bg-red-500"
            disabled={!hasDesktopApi}
            onClick={() => window.desktop.close()}
            type="button"
          >
            X
          </button>
        </div>
      </header>

      <main className="space-y-4 p-4">
        <section className="rounded-lg border border-zinc-800 p-3">
          <p className="mb-2 text-xs text-zinc-400">Window Controls</p>
          <label className="no-drag flex items-center justify-between text-sm">
            <span>Always on top</span>
            <input checked={alwaysOnTop} disabled={!hasDesktopApi} onChange={onToggleTop} type="checkbox" />
          </label>
          <label className="no-drag mt-3 block text-sm">
            <span className="mb-1 block">
              Opacity (
              {Math.round(opacity * 100)}
              %)
            </span>
            <input
              className="w-full"
              max={1}
              min={0.35}
              disabled={!hasDesktopApi}
              onChange={(e) => onOpacity(Number(e.target.value))}
              step={0.01}
              type="range"
              value={opacity}
            />
          </label>
          {!hasDesktopApi && (
            <p className="mt-2 text-xs text-amber-300">
              Electron preload API is unavailable. Run with `npm run dev` to use window controls.
            </p>
          )}
        </section>

        <section className="rounded-lg border border-zinc-800 p-3 text-xs text-zinc-300">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-zinc-400">Phase 2: Contract Self-Check</p>
            <p className="rounded bg-zinc-800 px-2 py-1">
              {passedCount}/{testResults.length} passed
            </p>
          </div>
          <ul className="space-y-1">
            {testResults.map((test) => (
              <li key={test.name}>
                <span className={test.ok ? 'text-emerald-300' : 'text-red-300'}>
                  {test.ok ? 'PASS' : 'FAIL'}
                </span>
                {' '}
                {test.name}
                <span className="text-zinc-500">
                  {' '}
                  - {test.details}
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section className="space-y-3 rounded-lg border border-zinc-800 p-3 text-xs text-zinc-300">
          <div className="flex items-center justify-between">
            <p className="text-zinc-400">Phase 3: Integration Core</p>
            <div className="flex gap-2">
              <span className={`rounded px-2 py-1 ${health.ready ? 'bg-emerald-900 text-emerald-200' : 'bg-amber-900 text-amber-200'}`}>
                health: {health.ready ? 'ready' : 'degraded'}
              </span>
              <span className={`rounded px-2 py-1 ${connectionStatus === 'connected' ? 'bg-emerald-900 text-emerald-200' : 'bg-zinc-800 text-zinc-200'}`}>
                ws: {connectionStatus}
              </span>
            </div>
          </div>

          <p className="text-zinc-500">
            retries: {retryCount} | last event: {lastServerEvent}
          </p>
          {health.error && <p className="text-amber-300">health error: {health.error}</p>}
          {lastError && <p className="text-red-300">ws error: {lastError}</p>}

          <div className="grid grid-cols-2 gap-2">
            <button
              className="rounded bg-emerald-700 px-2 py-1 hover:bg-emerald-600"
              onClick={connectSession}
              type="button"
            >
              Connect WS
            </button>
            <button
              className="rounded bg-zinc-700 px-2 py-1 hover:bg-zinc-600"
              onClick={disconnectSession}
              type="button"
            >
              Disconnect WS
            </button>
          </div>

          <div className="space-y-2 rounded border border-zinc-800 p-2">
            <p className="text-zinc-400">Session preferences</p>
            <select
              className="w-full rounded bg-zinc-900 px-2 py-1"
              onChange={(e) => setPreferences((prev) => ({ ...prev, tone: e.target.value as SessionPreferences['tone'] }))}
              value={preferences.tone}
            >
              <option value="confident">confident</option>
              <option value="casual">casual</option>
              <option value="professional">professional</option>
            </select>
            <input
              className="w-full"
              max={120}
              min={15}
              onChange={(e) => setPreferences((prev) => ({ ...prev, max_seconds: Number(e.target.value) }))}
              type="range"
              value={preferences.max_seconds}
            />
            <p className="text-zinc-500">max_seconds: {preferences.max_seconds}</p>
            <label className="flex items-center justify-between">
              include_example
              <input
                checked={preferences.include_example}
                onChange={(e) => setPreferences((prev) => ({ ...prev, include_example: e.target.checked }))}
                type="checkbox"
              />
            </label>
            <label className="flex items-center justify-between">
              technical_mode
              <input
                checked={preferences.technical_mode}
                onChange={(e) => setPreferences((prev) => ({ ...prev, technical_mode: e.target.checked }))}
                type="checkbox"
              />
            </label>
            <label className="flex items-center justify-between">
              simplify_english
              <input
                checked={preferences.simplify_english}
                onChange={(e) => setPreferences((prev) => ({ ...prev, simplify_english: e.target.checked }))}
                type="checkbox"
              />
            </label>
            <button className="w-full rounded bg-blue-700 px-2 py-1 hover:bg-blue-600" onClick={sendPreferences} type="button">
              Send Preferences
            </button>
          </div>

          <div className="space-y-2 rounded border border-zinc-800 p-2">
            <p className="text-zinc-400">Resume context</p>
            <textarea
              className="w-full rounded bg-zinc-900 p-2"
              onChange={(e) => setResumeContext(e.target.value)}
              placeholder="Paste short resume context..."
              rows={3}
              value={resumeContext}
            />
            <button className="w-full rounded bg-blue-700 px-2 py-1 hover:bg-blue-600" onClick={sendResumeContext} type="button">
              Send Resume Context
            </button>
          </div>

          <div className="space-y-2 rounded border border-zinc-800 p-2">
            <p className="text-zinc-400">Backend test messages</p>
            <input
              className="w-full rounded bg-zinc-900 px-2 py-1"
              onChange={(e) => setTestTranscript(e.target.value)}
              value={testTranscript}
            />
            <div className="grid grid-cols-2 gap-2">
              <button className="rounded bg-purple-700 px-2 py-1 hover:bg-purple-600" onClick={sendTranscriptTest} type="button">
                Send Test Transcript
              </button>
              <button className="rounded bg-purple-700 px-2 py-1 hover:bg-purple-600" onClick={sendAnswerNow} type="button">
                Answer Now
              </button>
            </div>
          </div>
        </section>

        <section className="space-y-3 rounded-lg border border-zinc-800 p-3 text-xs text-zinc-300">
          <div className="flex items-center justify-between">
            <p className="text-zinc-400">Phase 4: Audio Stream Pipeline</p>
            <span className={`rounded px-2 py-1 ${audioStreamActive ? 'bg-emerald-900 text-emerald-200' : 'bg-zinc-800 text-zinc-200'}`}>
              audio: {audioMode}
            </span>
          </div>

          <p className="text-zinc-500">
            bytes sent: {audioBytesSent} | chunks sent: {audioChunksSent} | chunks dropped: {audioChunksDropped}
          </p>
          {audioWarning && <p className="text-amber-300">{audioWarning}</p>}
          {connectionStatus !== 'connected' && (
            <p className="text-amber-300">
              WebSocket is not connected. Audio chunks will be dropped until WS reconnects.
            </p>
          )}

          <div className="grid grid-cols-2 gap-2">
            <button
              className="rounded bg-emerald-700 px-2 py-1 hover:bg-emerald-600 disabled:opacity-50"
              disabled={!hasDesktopApi || audioStreamActive}
              onClick={() => {
                void startAudioStream()
              }}
              type="button"
            >
              Start Audio
            </button>
            <button
              className="rounded bg-zinc-700 px-2 py-1 hover:bg-zinc-600 disabled:opacity-50"
              disabled={!hasDesktopApi || !audioStreamActive}
              onClick={() => {
                void stopAudioStream()
              }}
              type="button"
            >
              Stop Audio
            </button>
          </div>
        </section>
      </main>
    </div>
  )
}

function formatServerEvent(message: ServerWsMessage): string {
  switch (message.type) {
    case WS_EVENT_TYPES.transcript:
      return `transcript(${message.is_final ? 'final' : 'interim'}): ${message.text.slice(0, 30)}`
    case WS_EVENT_TYPES.questionDetected:
      return `question_detected(${message.category})`
    case WS_EVENT_TYPES.answerStart:
      return 'answer_start'
    case WS_EVENT_TYPES.answerDelta:
      return `answer_delta: ${message.delta.slice(0, 20)}`
    case WS_EVENT_TYPES.answerDone:
      return `answer_done: ${message.full.slice(0, 20)}`
    case WS_EVENT_TYPES.error:
      return `error: ${message.message}`
    case WS_EVENT_TYPES.testOk:
      return `test_ok: ${message.message}`
  }
  return 'unknown'
}

export default App

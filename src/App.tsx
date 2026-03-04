import { useEffect, useMemo, useRef, useState } from 'react'
import { getHealthSnapshot, type HealthSnapshot } from './lib/http/healthClient'
import {
  type ServerWsMessage,
  WS_EVENT_TYPES,
} from './lib/contracts/protocol'
import { runProtocolSelfTest } from './lib/contracts/selfTest'
import { WsSessionClient } from './lib/ws/sessionClient'
import { useSessionStore } from './store/sessionStore'

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
  const [testTranscript, setTestTranscript] = useState('What is your biggest strength?')
  const [nowMs, setNowMs] = useState(Date.now())
  const connection = useSessionStore((state) => state.connection)
  const session = useSessionStore((state) => state.session)
  const transcript = useSessionStore((state) => state.transcript)
  const answer = useSessionStore((state) => state.answer)
  const audio = useSessionStore((state) => state.audio)
  const diagnostics = useSessionStore((state) => state.diagnostics)
  const ui = useSessionStore((state) => state.ui)
  const lastServerEvent = useSessionStore((state) => state.lastServerEvent)
  const setConnectionStatus = useSessionStore((state) => state.setConnectionStatus)
  const setConnectionError = useSessionStore((state) => state.setConnectionError)
  const setPreferenceField = useSessionStore((state) => state.setPreferenceField)
  const setAudioStatus = useSessionStore((state) => state.setAudioStatus)
  const recordAudioChunkSent = useSessionStore((state) => state.recordAudioChunkSent)
  const recordAudioChunkDropped = useSessionStore((state) => state.recordAudioChunkDropped)
  const applyServerMessage = useSessionStore((state) => state.applyServerMessage)
  const setResumeContext = useSessionStore((state) => state.setResumeContext)
  const pushDiagnosticEvent = useSessionStore((state) => state.pushDiagnosticEvent)
  const clearDiagnosticEvents = useSessionStore((state) => state.clearDiagnosticEvents)
  const setUiMode = useSessionStore((state) => state.setUiMode)
  const hydrateUiMode = useSessionStore((state) => state.hydrateUiMode)
  const canSendWs = connection.status === 'connected'
  const isDevMode = ui.mode === 'dev'

  useEffect(() => {
    hydrateUiMode()
  }, [hydrateUiMode])

  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 1_000)
    return () => window.clearInterval(id)
  }, [])

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
    pushDiagnosticEvent('info', `health snapshot -> ${health.ready ? 'ready' : 'degraded'}`)
  }, [health.ready, pushDiagnosticEvent])

  useEffect(() => {
    if (!hasDesktopApi) return
    void window.desktop.getAudioStatus().then((status) => {
      setAudioStatus(status.mode, status.mode !== 'idle', status.warning ?? null)
    })
  }, [hasDesktopApi, setAudioStatus])

  useEffect(() => {
    const client = clientRef.current
    if (!client) return

    const unStatus = client.onStatus((event) => {
      setConnectionStatus(event.status, event.attempt, event.error)
    })
    const unError = client.onError((error) => setConnectionError(error))
    const unMessage = client.onMessage((message: ServerWsMessage) => {
      applyServerMessage(message, formatServerEvent(message))
    })

    return () => {
      unStatus()
      unError()
      unMessage()
      client.disconnect()
    }
  }, [applyServerMessage, setConnectionError, setConnectionStatus])

  useEffect(() => {
    if (!hasDesktopApi) return
    const unsubscribe = window.desktop.onAudioChunk((chunk) => {
      const sent = clientRef.current?.send({
        type: WS_EVENT_TYPES.audio,
        payload: chunk.payload,
      })
      if (sent) {
        recordAudioChunkSent(chunk.byteLength)
      } else {
        recordAudioChunkDropped()
      }
    })
    return () => {
      unsubscribe()
    }
  }, [hasDesktopApi, recordAudioChunkDropped, recordAudioChunkSent])

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
    pushDiagnosticEvent('info', 'manual action: connect ws')
    clientRef.current?.connect()
  }

  const disconnectSession = () => {
    pushDiagnosticEvent('warn', 'manual action: disconnect ws')
    clientRef.current?.disconnect()
  }

  const sendPreferences = () => {
    const sent = clientRef.current?.send({
      type: WS_EVENT_TYPES.preferences,
      ...session.preferences,
    })
    if (!sent) {
      setConnectionError('Preferences queued until WebSocket reconnects')
    }
  }

  const sendResumeContext = () => {
    if (!session.resumeContext.trim()) return
    const sent = clientRef.current?.send({
      type: WS_EVENT_TYPES.resumeContext,
      text: session.resumeContext,
    })
    if (!sent) {
      setConnectionError('Resume context queued until WebSocket reconnects')
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
    setAudioStatus(status.mode, status.mode !== 'idle', status.warning ?? null)
  }

  const stopAudioStream = async () => {
    if (!hasDesktopApi) return
    const status = await window.desktop.stopAudioStream()
    setAudioStatus(status.mode, false)
  }

  return (
    <div className="h-screen bg-zinc-950 text-zinc-100">
      <header className="drag-region flex items-center justify-between border-b border-zinc-800 px-3 py-2">
        <div className="text-sm font-medium">Interview Copilot</div>
        <div className="no-drag flex items-center gap-2">
          <div className="rounded bg-zinc-900 p-1">
            <button
              className={`rounded px-2 py-1 text-xs ${ui.mode === 'user' ? 'bg-zinc-700' : 'hover:bg-zinc-800'}`}
              onClick={() => setUiMode('user')}
              type="button"
            >
              User
            </button>
            <button
              className={`rounded px-2 py-1 text-xs ${ui.mode === 'dev' ? 'bg-zinc-700' : 'hover:bg-zinc-800'}`}
              onClick={() => setUiMode('dev')}
              type="button"
            >
              Dev
            </button>
          </div>
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
        {isDevMode && (
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
        )}

        {isDevMode && (
          <section className="rounded-lg border border-zinc-800 p-3 text-xs text-zinc-300">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-zinc-400">Contract Self-Check</p>
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
        )}

        <section className="space-y-3 rounded-lg border border-zinc-800 p-3 text-xs text-zinc-300">
          <div className="flex items-center justify-between">
            <p className="text-zinc-400">Session Controls</p>
            <div className="flex gap-2">
              <span className={`rounded px-2 py-1 ${health.ready ? 'bg-emerald-900 text-emerald-200' : 'bg-amber-900 text-amber-200'}`}>
                health: {health.ready ? 'ready' : 'degraded'}
              </span>
              <span className={`rounded px-2 py-1 ${connection.status === 'connected' ? 'bg-emerald-900 text-emerald-200' : 'bg-zinc-800 text-zinc-200'}`}>
                ws: {connection.status}
              </span>
            </div>
          </div>

          {isDevMode && (
            <p className="text-zinc-500">
              retries: {connection.retries} | last event: {lastServerEvent}
            </p>
          )}
          {health.error && <p className="text-amber-300">health error: {health.error}</p>}
          {connection.lastError && <p className="text-red-300">ws error: {connection.lastError}</p>}

          <div className="grid grid-cols-2 gap-2">
            <button
              className="rounded bg-emerald-700 px-2 py-1 hover:bg-emerald-600 disabled:opacity-50"
              disabled={connection.status === 'connected' || connection.status === 'connecting'}
              onClick={connectSession}
              type="button"
            >
              Connect WS
            </button>
            <button
              className="rounded bg-zinc-700 px-2 py-1 hover:bg-zinc-600 disabled:opacity-50"
              disabled={connection.status === 'closed' || connection.status === 'idle'}
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
              onChange={(e) => setPreferenceField('tone', e.target.value as typeof session.preferences.tone)}
              value={session.preferences.tone}
            >
              <option value="confident">confident</option>
              <option value="casual">casual</option>
              <option value="professional">professional</option>
            </select>
            <input
              className="w-full"
              max={120}
              min={15}
              onChange={(e) => setPreferenceField('max_seconds', Number(e.target.value))}
              type="range"
              value={session.preferences.max_seconds}
            />
            <p className="text-zinc-500">max_seconds: {session.preferences.max_seconds}</p>
            <label className="flex items-center justify-between">
              include_example
              <input
                checked={session.preferences.include_example}
                onChange={(e) => setPreferenceField('include_example', e.target.checked)}
                type="checkbox"
              />
            </label>
            <label className="flex items-center justify-between">
              technical_mode
              <input
                checked={session.preferences.technical_mode}
                onChange={(e) => setPreferenceField('technical_mode', e.target.checked)}
                type="checkbox"
              />
            </label>
            <label className="flex items-center justify-between">
              simplify_english
              <input
                checked={session.preferences.simplify_english}
                onChange={(e) => setPreferenceField('simplify_english', e.target.checked)}
                type="checkbox"
              />
            </label>
            <button
              className="w-full rounded bg-blue-700 px-2 py-1 hover:bg-blue-600 disabled:opacity-50"
              disabled={!canSendWs}
              onClick={sendPreferences}
              type="button"
            >
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
              value={session.resumeContext}
            />
            <button
              className="w-full rounded bg-blue-700 px-2 py-1 hover:bg-blue-600 disabled:opacity-50"
              disabled={!canSendWs}
              onClick={sendResumeContext}
              type="button"
            >
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
              <button
                className="rounded bg-purple-700 px-2 py-1 hover:bg-purple-600 disabled:opacity-50"
                disabled={!canSendWs}
                onClick={sendTranscriptTest}
                type="button"
              >
                Send Test Transcript
              </button>
              <button
                className="rounded bg-purple-700 px-2 py-1 hover:bg-purple-600 disabled:opacity-50"
                disabled={!canSendWs}
                onClick={sendAnswerNow}
                type="button"
              >
                Answer Now
              </button>
            </div>
          </div>
        </section>

        <section className="space-y-3 rounded-lg border border-zinc-800 p-3 text-xs text-zinc-300">
          <div className="flex items-center justify-between">
            <p className="text-zinc-400">Live Copilot</p>
            <span className="rounded bg-zinc-800 px-2 py-1">
              answer {answer.isStreaming ? 'streaming' : 'idle'}
            </span>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <article className="rounded border border-zinc-800 p-2">
              <p className="mb-2 text-zinc-400">Transcript</p>
              <p className="text-zinc-500">
                interim: {transcript.interimText || 'none'}
              </p>
              <div className="mt-2 max-h-24 space-y-1 overflow-auto">
                {transcript.finalSegments.length === 0 && (
                  <p className="text-zinc-500">No final transcript yet.</p>
                )}
                {transcript.finalSegments.slice(-5).map((segment, idx) => (
                  <p key={`${segment}-${idx}`} className="rounded bg-zinc-900 px-2 py-1">
                    {segment}
                  </p>
                ))}
              </div>
            </article>

            <article className="rounded border border-zinc-800 p-2">
              <p className="mb-2 text-zinc-400">Detected Question</p>
              <p className="rounded bg-zinc-900 px-2 py-1">
                {session.detectedQuestion ?? 'none'}
              </p>
              <p className="mt-2 text-zinc-500">
                category: {session.detectedCategory ?? 'none'}
              </p>
            </article>

            <article className="rounded border border-zinc-800 p-2">
              <p className="mb-2 text-zinc-400">Answer</p>
              <p className="max-h-24 overflow-auto rounded bg-zinc-900 px-2 py-1">
                {answer.current || 'No generated answer yet.'}
              </p>
              <p className="mt-2 text-zinc-500">history: {answer.history.length}</p>
            </article>
          </div>
        </section>

        <section className="space-y-3 rounded-lg border border-zinc-800 p-3 text-xs text-zinc-300">
          <div className="flex items-center justify-between">
            <p className="text-zinc-400">Audio Capture</p>
            <span className={`rounded px-2 py-1 ${audio.active ? 'bg-emerald-900 text-emerald-200' : 'bg-zinc-800 text-zinc-200'}`}>
              audio: {audio.mode}
            </span>
          </div>

          <p className="text-zinc-500">
            bytes sent: {audio.bytesSent} | chunks sent: {audio.chunksSent} | chunks dropped: {audio.chunksDropped}
          </p>
          {audio.warning && <p className="text-amber-300">{audio.warning}</p>}
          {connection.status !== 'connected' && (
            <p className="text-amber-300">
              WebSocket is not connected. Audio chunks will be dropped until WS reconnects.
            </p>
          )}

          <div className="grid grid-cols-2 gap-2">
            <button
              className="rounded bg-emerald-700 px-2 py-1 hover:bg-emerald-600 disabled:opacity-50"
              disabled={!hasDesktopApi || audio.active}
              onClick={() => {
                void startAudioStream()
              }}
              type="button"
            >
              Start Audio
            </button>
            <button
              className="rounded bg-zinc-700 px-2 py-1 hover:bg-zinc-600 disabled:opacity-50"
              disabled={!hasDesktopApi || !audio.active}
              onClick={() => {
                void stopAudioStream()
              }}
              type="button"
            >
              Stop Audio
            </button>
          </div>
        </section>

        {isDevMode && (
          <section className="space-y-1 rounded-lg border border-zinc-800 p-3 text-xs text-zinc-300">
            <p className="text-zinc-400">Store Snapshot</p>
            <p>detected question: {session.detectedQuestion ?? 'none'}</p>
            <p>question category: {session.detectedCategory ?? 'none'}</p>
            <p>interim transcript: {transcript.interimText || 'none'}</p>
            <p>final transcript segments: {transcript.finalSegments.length}</p>
            <p>answer streaming: {answer.isStreaming ? 'yes' : 'no'}</p>
            <p>answer history: {answer.history.length}</p>
          </section>
        )}

        {isDevMode && (
          <section className="space-y-2 rounded-lg border border-zinc-800 p-3 text-xs text-zinc-300">
            <div className="flex items-center justify-between">
              <p className="text-zinc-400">Reliability and Observability</p>
              <button
                className="rounded bg-zinc-800 px-2 py-1 hover:bg-zinc-700"
                onClick={clearDiagnosticEvents}
                type="button"
              >
                Clear Logs
              </button>
            </div>
            <p className="text-zinc-500">
              last status change: {formatIsoTime(diagnostics.lastStatusChangeAt)}
              {' '}| connected for:{' '}
              {formatDuration(diagnostics.connectedSince, nowMs)}
            </p>
            <div className="max-h-32 space-y-1 overflow-auto rounded border border-zinc-800 p-2">
              {diagnostics.events.length === 0 && (
                <p className="text-zinc-500">No events yet.</p>
              )}
              {diagnostics.events.slice(-25).map((event) => (
                <p key={event.id}>
                  <span className={event.level === 'error' ? 'text-red-300' : event.level === 'warn' ? 'text-amber-300' : 'text-emerald-300'}>
                    {event.level.toUpperCase()}
                  </span>
                  {' '}
                  <span className="text-zinc-500">[{formatIsoTime(event.timestamp)}]</span>
                  {' '}
                  {event.message}
                </p>
              ))}
            </div>
          </section>
        )}
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

function formatIsoTime(value: string | null): string {
  if (!value) return 'n/a'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleTimeString()
}

function formatDuration(connectedSince: string | null, nowEpochMs: number): string {
  if (!connectedSince) return '0s'
  const since = new Date(connectedSince).getTime()
  if (Number.isNaN(since) || nowEpochMs < since) return '0s'
  const elapsedSec = Math.floor((nowEpochMs - since) / 1000)
  const mins = Math.floor(elapsedSec / 60)
  const secs = elapsedSec % 60
  if (mins === 0) return `${secs}s`
  return `${mins}m ${secs}s`
}

export default App

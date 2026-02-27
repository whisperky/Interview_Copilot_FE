import {
  type ClientWsMessage,
  PROTOCOL_DEFAULTS,
  type ServerWsMessage,
  WS_EVENT_TYPES,
} from '../contracts/protocol'
import { parseClientWsMessage, parseServerWsTextFrame } from '../contracts/validators'

export type SessionConnectionStatus =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'failed'
  | 'closed'

export interface SessionStatusEvent {
  status: SessionConnectionStatus
  attempt: number
  error?: string
}

type StatusListener = (event: SessionStatusEvent) => void
type MessageListener = (message: ServerWsMessage) => void
type ErrorListener = (error: string) => void

function normalizeWsBaseUrl(wsBaseUrl: string): string {
  return wsBaseUrl.endsWith('/') ? wsBaseUrl.slice(0, -1) : wsBaseUrl
}

function toSessionWsUrl(wsBaseUrl: string): string {
  return `${normalizeWsBaseUrl(wsBaseUrl)}/ws/session`
}

export class WsSessionClient {
  private readonly wsBaseUrl: string
  private ws: WebSocket | null = null
  private status: SessionConnectionStatus = 'idle'
  private reconnectAttempt = 0
  private reconnectTimeout: number | null = null
  private manuallyClosed = false
  private readonly messageQueue: ClientWsMessage[] = []
  private latestPreferences: ClientWsMessage | null = null
  private latestResumeContext: ClientWsMessage | null = null

  private readonly statusListeners = new Set<StatusListener>()
  private readonly messageListeners = new Set<MessageListener>()
  private readonly errorListeners = new Set<ErrorListener>()

  constructor(wsBaseUrl: string) {
    this.wsBaseUrl = wsBaseUrl
  }

  onStatus(listener: StatusListener): () => void {
    this.statusListeners.add(listener)
    listener({ status: this.status, attempt: this.reconnectAttempt })
    return () => this.statusListeners.delete(listener)
  }

  onMessage(listener: MessageListener): () => void {
    this.messageListeners.add(listener)
    return () => this.messageListeners.delete(listener)
  }

  onError(listener: ErrorListener): () => void {
    this.errorListeners.add(listener)
    return () => this.errorListeners.delete(listener)
  }

  connect(): void {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return
    }
    this.manuallyClosed = false
    this.updateStatus(this.reconnectAttempt > 0 ? 'reconnecting' : 'connecting')
    this.openSocket()
  }

  disconnect(): void {
    this.manuallyClosed = true
    if (this.reconnectTimeout !== null) {
      window.clearTimeout(this.reconnectTimeout)
      this.reconnectTimeout = null
    }
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
    this.updateStatus('closed')
  }

  send(message: ClientWsMessage): boolean {
    const parsed = parseClientWsMessage(message)
    if (!parsed.ok) {
      this.emitError(`Outbound message rejected: ${parsed.error}`)
      return false
    }
    const safeMessage = parsed.value

    if (safeMessage.type === WS_EVENT_TYPES.preferences) {
      this.latestPreferences = safeMessage
    }
    if (safeMessage.type === WS_EVENT_TYPES.resumeContext) {
      this.latestResumeContext = safeMessage
    }

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(safeMessage))
      return true
    }

    // Audio should stay real-time and not be replayed after reconnect.
    if (safeMessage.type !== WS_EVENT_TYPES.audio) {
      this.messageQueue.push(safeMessage)
    }
    return false
  }

  getReconnectAttempt(): number {
    return this.reconnectAttempt
  }

  private openSocket(): void {
    const url = toSessionWsUrl(this.wsBaseUrl)
    this.ws = new WebSocket(url)

    this.ws.onopen = () => {
      this.reconnectAttempt = 0
      this.updateStatus('connected')
      this.flushQueue()
      this.rehydrateSession()
    }

    this.ws.onmessage = (event) => {
      const parsed = parseServerWsTextFrame(String(event.data))
      if (!parsed.ok) {
        this.emitError(`Inbound parse error: ${parsed.error}`)
        return
      }
      this.messageListeners.forEach((listener) => listener(parsed.value))
    }

    this.ws.onerror = () => {
      this.emitError('WebSocket transport error')
    }

    this.ws.onclose = () => {
      this.ws = null
      if (this.manuallyClosed) {
        this.updateStatus('closed')
        return
      }
      this.scheduleReconnect()
    }
  }

  private scheduleReconnect(): void {
    this.reconnectAttempt += 1
    if (this.reconnectAttempt > PROTOCOL_DEFAULTS.maxReconnectAttempts) {
      this.updateStatus('failed', 'Exceeded reconnect attempts')
      return
    }

    this.updateStatus('reconnecting')
    const expDelay = PROTOCOL_DEFAULTS.reconnectBaseDelayMs * 2 ** (this.reconnectAttempt - 1)
    const delay = Math.min(PROTOCOL_DEFAULTS.reconnectMaxDelayMs, expDelay) + Math.floor(Math.random() * 250)
    this.reconnectTimeout = window.setTimeout(() => {
      this.reconnectTimeout = null
      this.openSocket()
    }, delay)
  }

  private flushQueue(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return
    while (this.messageQueue.length > 0) {
      const message = this.messageQueue.shift()
      if (!message) break
      this.ws.send(JSON.stringify(message))
    }
  }

  private rehydrateSession(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return
    if (this.latestPreferences) {
      this.ws.send(JSON.stringify(this.latestPreferences))
    }
    if (this.latestResumeContext) {
      this.ws.send(JSON.stringify(this.latestResumeContext))
    }
  }

  private updateStatus(status: SessionConnectionStatus, error?: string): void {
    this.status = status
    const event: SessionStatusEvent = { status, attempt: this.reconnectAttempt, error }
    this.statusListeners.forEach((listener) => listener(event))
  }

  private emitError(error: string): void {
    this.errorListeners.forEach((listener) => listener(error))
  }
}


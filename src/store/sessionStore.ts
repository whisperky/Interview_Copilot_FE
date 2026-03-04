import { create } from 'zustand'
import {
  type QuestionCategory,
  type ServerWsMessage,
  type SessionPreferences,
  WS_EVENT_TYPES,
} from '../lib/contracts/protocol'
import type { SessionConnectionStatus } from '../lib/ws/sessionClient'

interface ConnectionSlice {
  status: SessionConnectionStatus
  retries: number
  lastError: string | null
}

interface SessionSlice {
  preferences: SessionPreferences
  resumeContext: string
  detectedQuestion: string | null
  detectedCategory: QuestionCategory | null
}

interface TranscriptSlice {
  interimText: string
  finalSegments: string[]
}

interface AnswerSlice {
  isStreaming: boolean
  current: string
  history: string[]
}

interface AudioSlice {
  mode: string
  active: boolean
  bytesSent: number
  chunksSent: number
  chunksDropped: number
  warning: string | null
}

export interface DiagnosticEvent {
  id: string
  timestamp: string
  level: 'info' | 'warn' | 'error'
  message: string
}

interface DiagnosticsSlice {
  events: DiagnosticEvent[]
  lastStatusChangeAt: string | null
  connectedSince: string | null
}

type UiMode = 'user' | 'dev'

interface UiSlice {
  mode: UiMode
}

interface SessionStore {
  connection: ConnectionSlice
  session: SessionSlice
  transcript: TranscriptSlice
  answer: AnswerSlice
  audio: AudioSlice
  diagnostics: DiagnosticsSlice
  ui: UiSlice
  lastServerEvent: string
  setConnectionStatus: (status: SessionConnectionStatus, retries: number, error?: string) => void
  setConnectionError: (error: string | null) => void
  setPreferences: (preferences: SessionPreferences) => void
  setPreferenceField: <K extends keyof SessionPreferences>(key: K, value: SessionPreferences[K]) => void
  setResumeContext: (value: string) => void
  setAudioStatus: (mode: string, active: boolean, warning?: string | null) => void
  recordAudioChunkSent: (bytes: number) => void
  recordAudioChunkDropped: () => void
  applyServerMessage: (message: ServerWsMessage, formattedEvent: string) => void
  pushDiagnosticEvent: (level: DiagnosticEvent['level'], message: string) => void
  clearDiagnosticEvents: () => void
  setUiMode: (mode: UiMode) => void
  hydrateUiMode: () => void
}

const initialPreferences: SessionPreferences = {
  tone: 'confident',
  max_seconds: 60,
  include_example: true,
  technical_mode: false,
  simplify_english: false,
}

const MAX_DIAGNOSTIC_EVENTS = 80
const UI_MODE_STORAGE_KEY = 'interview-copilot-ui-mode'

function createDiagnosticEvent(level: DiagnosticEvent['level'], message: string): DiagnosticEvent {
  const id = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`
  return {
    id,
    timestamp: new Date().toISOString(),
    level,
    message,
  }
}

export const useSessionStore = create<SessionStore>((set) => ({
  connection: {
    status: 'idle',
    retries: 0,
    lastError: null,
  },
  session: {
    preferences: initialPreferences,
    resumeContext: '',
    detectedQuestion: null,
    detectedCategory: null,
  },
  transcript: {
    interimText: '',
    finalSegments: [],
  },
  answer: {
    isStreaming: false,
    current: '',
    history: [],
  },
  audio: {
    mode: 'idle',
    active: false,
    bytesSent: 0,
    chunksSent: 0,
    chunksDropped: 0,
    warning: null,
  },
  diagnostics: {
    events: [],
    lastStatusChangeAt: null,
    connectedSince: null,
  },
  ui: {
    mode: 'user',
  },
  lastServerEvent: 'none',
  setConnectionStatus: (status, retries, error) =>
    set((state) => ({
      connection: {
        ...state.connection,
        status,
        retries,
        lastError: error ?? state.connection.lastError,
      },
      diagnostics: {
        ...state.diagnostics,
        lastStatusChangeAt: new Date().toISOString(),
        connectedSince: status === 'connected' ? new Date().toISOString() : null,
        events: [
          ...state.diagnostics.events,
          createDiagnosticEvent(
            error ? 'warn' : 'info',
            `connection status -> ${status}${error ? ` (${error})` : ''}`
          ),
        ].slice(-MAX_DIAGNOSTIC_EVENTS),
      },
    })),
  setConnectionError: (error) =>
    set((state) => ({
      connection: {
        ...state.connection,
        lastError: error,
      },
      diagnostics: error
        ? {
            ...state.diagnostics,
            events: [
              ...state.diagnostics.events,
              createDiagnosticEvent('error', error),
            ].slice(-MAX_DIAGNOSTIC_EVENTS),
          }
        : state.diagnostics,
    })),
  setPreferences: (preferences) =>
    set((state) => ({
      session: {
        ...state.session,
        preferences,
      },
    })),
  setPreferenceField: (key, value) =>
    set((state) => ({
      session: {
        ...state.session,
        preferences: {
          ...state.session.preferences,
          [key]: value,
        },
      },
    })),
  setResumeContext: (value) =>
    set((state) => ({
      session: {
        ...state.session,
        resumeContext: value,
      },
    })),
  setAudioStatus: (mode, active, warning) =>
    set((state) => ({
      audio: {
        ...state.audio,
        mode,
        active,
        warning: warning ?? state.audio.warning,
      },
      diagnostics: {
        ...state.diagnostics,
        events: [
          ...state.diagnostics.events,
          createDiagnosticEvent(
            warning ? 'warn' : 'info',
            `audio status -> ${mode}${warning ? ` (${warning})` : ''}`
          ),
        ].slice(-MAX_DIAGNOSTIC_EVENTS),
      },
    })),
  recordAudioChunkSent: (bytes) =>
    set((state) => ({
      audio: {
        ...state.audio,
        bytesSent: state.audio.bytesSent + bytes,
        chunksSent: state.audio.chunksSent + 1,
      },
    })),
  recordAudioChunkDropped: () =>
    set((state) => ({
      audio: {
        ...state.audio,
        chunksDropped: state.audio.chunksDropped + 1,
      },
    })),
  applyServerMessage: (message, formattedEvent) =>
    set((state) => {
      const next: Partial<SessionStore> = {
        lastServerEvent: formattedEvent,
      }

      if (message.type === WS_EVENT_TYPES.transcript) {
        if (message.is_final) {
          next.transcript = {
            interimText: '',
            finalSegments: [...state.transcript.finalSegments, message.text].slice(-20),
          }
        } else {
          next.transcript = {
            ...state.transcript,
            interimText: message.text,
          }
        }
      }

      if (message.type === WS_EVENT_TYPES.questionDetected) {
        next.session = {
          ...state.session,
          detectedQuestion: message.question,
          detectedCategory: message.category,
        }
      }

      // Deterministic answer state machine
      if (message.type === WS_EVENT_TYPES.answerStart) {
        next.answer = {
          ...state.answer,
          isStreaming: true,
          current: '',
        }
      }

      if (message.type === WS_EVENT_TYPES.answerDelta) {
        next.answer = {
          ...state.answer,
          isStreaming: true,
          current: `${state.answer.current}${message.delta}`,
        }
      }

      if (message.type === WS_EVENT_TYPES.answerDone) {
        const finalText = message.full.trim() ? message.full : state.answer.current
        next.answer = {
          ...state.answer,
          isStreaming: false,
          current: finalText,
          history: finalText ? [...state.answer.history, finalText].slice(-10) : state.answer.history,
        }
      }

      if (message.type === WS_EVENT_TYPES.error) {
        next.connection = {
          ...state.connection,
          lastError: message.message,
        }
      }

      if (
        message.type === WS_EVENT_TYPES.questionDetected ||
        message.type === WS_EVENT_TYPES.answerStart ||
        message.type === WS_EVENT_TYPES.answerDone ||
        message.type === WS_EVENT_TYPES.error
      ) {
        const level: DiagnosticEvent['level'] = message.type === WS_EVENT_TYPES.error ? 'error' : 'info'
        next.diagnostics = {
          ...state.diagnostics,
          events: [
            ...state.diagnostics.events,
            createDiagnosticEvent(level, `server event: ${formattedEvent}`),
          ].slice(-MAX_DIAGNOSTIC_EVENTS),
        }
      }

      return next
    }),
  pushDiagnosticEvent: (level, message) =>
    set((state) => ({
      diagnostics: {
        ...state.diagnostics,
        events: [
          ...state.diagnostics.events,
          createDiagnosticEvent(level, message),
        ].slice(-MAX_DIAGNOSTIC_EVENTS),
      },
    })),
  clearDiagnosticEvents: () =>
    set((state) => ({
      diagnostics: {
        ...state.diagnostics,
        events: [],
      },
    })),
  setUiMode: (mode) =>
    set((state) => {
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(UI_MODE_STORAGE_KEY, mode)
      }
      return {
        ui: {
          mode,
        },
        diagnostics: {
          ...state.diagnostics,
          events: [
            ...state.diagnostics.events,
            createDiagnosticEvent('info', `ui mode -> ${mode}`),
          ].slice(-MAX_DIAGNOSTIC_EVENTS),
        },
      }
    }),
  hydrateUiMode: () =>
    set((state) => {
      if (typeof window === 'undefined') return state
      const stored = window.localStorage.getItem(UI_MODE_STORAGE_KEY)
      const mode: UiMode = stored === 'dev' ? 'dev' : 'user'
      return {
        ui: {
          mode,
        },
      }
    }),
}))


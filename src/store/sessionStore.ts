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

interface SessionStore {
  connection: ConnectionSlice
  session: SessionSlice
  transcript: TranscriptSlice
  answer: AnswerSlice
  audio: AudioSlice
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
}

const initialPreferences: SessionPreferences = {
  tone: 'confident',
  max_seconds: 60,
  include_example: true,
  technical_mode: false,
  simplify_english: false,
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
  lastServerEvent: 'none',
  setConnectionStatus: (status, retries, error) =>
    set((state) => ({
      connection: {
        ...state.connection,
        status,
        retries,
        lastError: error ?? state.connection.lastError,
      },
    })),
  setConnectionError: (error) =>
    set((state) => ({
      connection: {
        ...state.connection,
        lastError: error,
      },
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

      return next
    }),
}))


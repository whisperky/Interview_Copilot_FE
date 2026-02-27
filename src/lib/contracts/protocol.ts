export const WS_EVENT_TYPES = {
  audio: 'audio',
  answerNow: 'answer_now',
  rewrite: 'rewrite',
  preferences: 'preferences',
  resumeContext: 'resume_context',
  testSetQuestion: 'test_set_question',
  testSendTranscript: 'test_send_transcript',
  transcript: 'transcript',
  questionDetected: 'question_detected',
  answerStart: 'answer_start',
  answerDelta: 'answer_delta',
  answerDone: 'answer_done',
  error: 'error',
  testOk: 'test_ok',
} as const

export const PROTOCOL_DEFAULTS = {
  maxReconnectAttempts: 8,
  reconnectBaseDelayMs: 300,
  reconnectMaxDelayMs: 8_000,
  audioSampleRateHz: 16_000,
  audioChannels: 1,
  audioEncoding: 'pcm16',
} as const

export type QuestionCategory =
  | 'behavioral'
  | 'technical'
  | 'system_design'
  | 'culture'
  | 'unknown'

export type SessionTone = 'confident' | 'casual' | 'professional'

export type RewriteInstruction =
  | 'shorter'
  | 'more_confident'
  | 'more_casual'
  | 'add_example'
  | 'simplify_english'

export interface SessionPreferences {
  tone: SessionTone
  max_seconds: number
  include_example: boolean
  technical_mode: boolean
  simplify_english: boolean
}

export interface TranscriptSegment {
  text: string
  is_final: boolean
  confidence?: number
}

export interface QuestionClassification {
  question_text: string
  category: QuestionCategory
  is_complete: boolean
}

export type ClientWsMessage =
  | {
      type: typeof WS_EVENT_TYPES.audio
      payload: string
    }
  | {
      type: typeof WS_EVENT_TYPES.answerNow
    }
  | {
      type: typeof WS_EVENT_TYPES.rewrite
      instruction: RewriteInstruction
      current_answer: string
    }
  | ({
      type: typeof WS_EVENT_TYPES.preferences
    } & SessionPreferences)
  | {
      type: typeof WS_EVENT_TYPES.resumeContext
      text: string
    }
  | {
      type: typeof WS_EVENT_TYPES.testSetQuestion
      question: string
    }
  | {
      type: typeof WS_EVENT_TYPES.testSendTranscript
      text: string
      is_final?: boolean
    }

export type ServerWsMessage =
  | {
      type: typeof WS_EVENT_TYPES.transcript
      text: string
      is_final: boolean
    }
  | {
      type: typeof WS_EVENT_TYPES.questionDetected
      question: string
      category: QuestionCategory
    }
  | {
      type: typeof WS_EVENT_TYPES.answerStart
    }
  | {
      type: typeof WS_EVENT_TYPES.answerDelta
      delta: string
    }
  | {
      type: typeof WS_EVENT_TYPES.answerDone
      full: string
    }
  | {
      type: typeof WS_EVENT_TYPES.error
      message: string
    }
  | {
      type: typeof WS_EVENT_TYPES.testOk
      message: string
    }


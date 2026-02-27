import {
  type ClientWsMessage,
  type QuestionCategory,
  type RewriteInstruction,
  type ServerWsMessage,
  type SessionTone,
  WS_EVENT_TYPES,
} from './protocol'

type ParseSuccess<T> = { ok: true; value: T }
type ParseFailure = { ok: false; error: string }
type ParseResult<T> = ParseSuccess<T> | ParseFailure

const QUESTION_CATEGORIES: QuestionCategory[] = [
  'behavioral',
  'technical',
  'system_design',
  'culture',
  'unknown',
]

const SESSION_TONES: SessionTone[] = ['confident', 'casual', 'professional']

const REWRITE_INSTRUCTIONS: RewriteInstruction[] = [
  'shorter',
  'more_confident',
  'more_casual',
  'add_example',
  'simplify_english',
]

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isString(value: unknown): value is string {
  return typeof value === 'string'
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean'
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function hasTypeField(value: unknown): value is Record<string, unknown> & { type: unknown } {
  return isObject(value) && 'type' in value
}

function isSessionTone(value: unknown): value is SessionTone {
  return isString(value) && SESSION_TONES.includes(value as SessionTone)
}

function isQuestionCategory(value: unknown): value is QuestionCategory {
  return isString(value) && QUESTION_CATEGORIES.includes(value as QuestionCategory)
}

function isRewriteInstruction(value: unknown): value is RewriteInstruction {
  return isString(value) && REWRITE_INSTRUCTIONS.includes(value as RewriteInstruction)
}

function fail(error: string): ParseFailure {
  return { ok: false, error }
}

function success<T>(value: T): ParseSuccess<T> {
  return { ok: true, value }
}

function validatePreferencesShape(raw: Record<string, unknown>): ParseFailure | null {
  if (!isSessionTone(raw.tone)) return fail('preferences.tone must be valid')
  if (!isNumber(raw.max_seconds)) return fail('preferences.max_seconds must be number')
  if (raw.max_seconds < 15 || raw.max_seconds > 120) {
    return fail('preferences.max_seconds must be between 15 and 120')
  }
  if (!isBoolean(raw.include_example)) return fail('preferences.include_example must be boolean')
  if (!isBoolean(raw.technical_mode)) return fail('preferences.technical_mode must be boolean')
  if (!isBoolean(raw.simplify_english)) return fail('preferences.simplify_english must be boolean')
  return null
}

export function parseClientWsMessage(input: unknown): ParseResult<ClientWsMessage> {
  if (!hasTypeField(input) || !isString(input.type)) {
    return fail('message.type is required')
  }
  const msg = input as Record<string, unknown> & { type: string }

  switch (msg.type) {
    case WS_EVENT_TYPES.audio:
      if (!isString(msg.payload)) return fail('audio.payload must be string')
      return success({ type: WS_EVENT_TYPES.audio, payload: msg.payload })
    case WS_EVENT_TYPES.answerNow:
      return success({ type: WS_EVENT_TYPES.answerNow })
    case WS_EVENT_TYPES.rewrite:
      if (!isRewriteInstruction(msg.instruction)) {
        return fail('rewrite.instruction must be valid')
      }
      if (!isString(msg.current_answer)) return fail('rewrite.current_answer must be string')
      return success({
        type: WS_EVENT_TYPES.rewrite,
        instruction: msg.instruction,
        current_answer: msg.current_answer,
      })
    case WS_EVENT_TYPES.preferences: {
      const prefError = validatePreferencesShape(msg)
      if (prefError) return prefError
      const tone = msg.tone as SessionTone
      const maxSeconds = msg.max_seconds as number
      const includeExample = msg.include_example as boolean
      const technicalMode = msg.technical_mode as boolean
      const simplifyEnglish = msg.simplify_english as boolean
      return success({
        type: WS_EVENT_TYPES.preferences,
        tone,
        max_seconds: maxSeconds,
        include_example: includeExample,
        technical_mode: technicalMode,
        simplify_english: simplifyEnglish,
      })
    }
    case WS_EVENT_TYPES.resumeContext:
      if (!isString(msg.text)) return fail('resume_context.text must be string')
      return success({ type: WS_EVENT_TYPES.resumeContext, text: msg.text })
    case WS_EVENT_TYPES.testSetQuestion:
      if (!isString(msg.question)) return fail('test_set_question.question must be string')
      return success({ type: WS_EVENT_TYPES.testSetQuestion, question: msg.question })
    case WS_EVENT_TYPES.testSendTranscript:
      if (!isString(msg.text)) return fail('test_send_transcript.text must be string')
      if (msg.is_final !== undefined && !isBoolean(msg.is_final)) {
        return fail('test_send_transcript.is_final must be boolean when provided')
      }
      return success({
        type: WS_EVENT_TYPES.testSendTranscript,
        text: msg.text,
        is_final: isBoolean(msg.is_final) ? msg.is_final : undefined,
      })
    default:
      return fail(`unsupported client message type: ${msg.type}`)
  }
}

export function parseServerWsMessage(input: unknown): ParseResult<ServerWsMessage> {
  if (!hasTypeField(input) || !isString(input.type)) {
    return fail('message.type is required')
  }
  const msg = input as Record<string, unknown> & { type: string }

  switch (msg.type) {
    case WS_EVENT_TYPES.transcript:
      if (!isString(msg.text)) return fail('transcript.text must be string')
      if (!isBoolean(msg.is_final)) return fail('transcript.is_final must be boolean')
      return success({
        type: WS_EVENT_TYPES.transcript,
        text: msg.text,
        is_final: msg.is_final,
      })
    case WS_EVENT_TYPES.questionDetected:
      if (!isString(msg.question)) return fail('question_detected.question must be string')
      if (!isQuestionCategory(msg.category)) {
        return fail('question_detected.category must be valid')
      }
      return success({
        type: WS_EVENT_TYPES.questionDetected,
        question: msg.question,
        category: msg.category,
      })
    case WS_EVENT_TYPES.answerStart:
      return success({ type: WS_EVENT_TYPES.answerStart })
    case WS_EVENT_TYPES.answerDelta:
      if (!isString(msg.delta)) return fail('answer_delta.delta must be string')
      return success({ type: WS_EVENT_TYPES.answerDelta, delta: msg.delta })
    case WS_EVENT_TYPES.answerDone:
      if (!isString(msg.full)) return fail('answer_done.full must be string')
      return success({ type: WS_EVENT_TYPES.answerDone, full: msg.full })
    case WS_EVENT_TYPES.error:
      if (!isString(msg.message)) return fail('error.message must be string')
      return success({ type: WS_EVENT_TYPES.error, message: msg.message })
    case WS_EVENT_TYPES.testOk:
      if (!isString(msg.message)) return fail('test_ok.message must be string')
      return success({ type: WS_EVENT_TYPES.testOk, message: msg.message })
    default:
      return fail(`unsupported server message type: ${msg.type}`)
  }
}

export function parseServerWsTextFrame(frame: string): ParseResult<ServerWsMessage> {
  try {
    const json: unknown = JSON.parse(frame)
    return parseServerWsMessage(json)
  } catch {
    return fail('invalid JSON text frame')
  }
}


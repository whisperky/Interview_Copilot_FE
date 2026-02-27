import { WS_EVENT_TYPES } from './protocol'
import { parseClientWsMessage, parseServerWsMessage, parseServerWsTextFrame } from './validators'

export interface ProtocolSelfTestResult {
  name: string
  ok: boolean
  details: string
}

export function runProtocolSelfTest(): ProtocolSelfTestResult[] {
  const tests: ProtocolSelfTestResult[] = []

  const validClient = parseClientWsMessage({
    type: WS_EVENT_TYPES.preferences,
    tone: 'confident',
    max_seconds: 60,
    include_example: true,
    technical_mode: false,
    simplify_english: false,
  })
  tests.push({
    name: 'client preferences validation',
    ok: validClient.ok,
    details: validClient.ok ? 'parsed as typed client message' : validClient.error,
  })

  const validServer = parseServerWsMessage({
    type: WS_EVENT_TYPES.questionDetected,
    question: 'Tell me about a challenge you solved?',
    category: 'behavioral',
  })
  tests.push({
    name: 'server question_detected validation',
    ok: validServer.ok,
    details: validServer.ok ? 'parsed as typed server message' : validServer.error,
  })

  const invalidFrame = parseServerWsTextFrame('{"type":"transcript","text":"hello","is_final":"yes"}')
  tests.push({
    name: 'invalid server frame rejection',
    ok: !invalidFrame.ok,
    details: invalidFrame.ok ? 'expected parse failure but parsed successfully' : invalidFrame.error,
  })

  return tests
}


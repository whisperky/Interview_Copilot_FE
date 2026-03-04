# Phase 8 Validation and Handoff

This document is the release-readiness checklist for the desktop frontend MVP.

## Automated smoke test

Run backend first, then from `frontend`:

```bash
npm run smoke
```

What it verifies:

- `GET /health` returns `{"status":"ok"}`
- `GET /health/ready` returns `{"status":"ready"}`
- WebSocket can connect to `/ws/session`
- Client can send: `preferences`, `resume_context`, `test_send_transcript`, `answer_now`
- Server responds with transcript and a terminal frame (`answer_done` or `error`)

## Manual QA checklist

### Core integration

- [ ] `health: ready` appears while backend is up.
- [ ] `Connect WS` reaches `ws: connected`.
- [ ] `Send Test Transcript` updates transcript panel.
- [ ] `Answer Now` updates answer panel and history count.
- [ ] Disconnect/reconnect cycle recovers without app restart.

### Reliability and observability

- [ ] Phase 7 diagnostic log records connection transitions.
- [ ] Error messages are shown in UI without crashing renderer.
- [ ] `Clear Logs` works.
- [ ] Connected duration updates while connected.

### Audio behavior

- [ ] `Start Audio` switches from `idle` to source mode (`mock` or `native`).
- [ ] `bytes sent` and `chunks sent` increase while streaming.
- [ ] `chunks dropped` increases when WS is disconnected.
- [ ] `Stop Audio` returns source mode to `idle`.

## Known limitations

- If no native addon is present, audio runs in `mock` mode.
- `answer.history` intentionally keeps the latest 10 entries.
- Session state is in-memory on both client and backend.

## Handoff notes for team demo

- Demo flow:
  1. Connect WS
  2. Send Preferences
  3. Send Resume Context
  4. Send Test Transcript
  5. Answer Now
  6. Show reconnect recovery and diagnostics log
- Mention audio source mode explicitly (`mock` vs `native`) before demo starts.

# Frontend Desktop App

Electron + React + Tailwind v4 desktop client for backend integration.

## Run

```bash
npm run dev
```

## Real Audio (Native Loopback)

The app supports two audio modes:

- `native` when a WASAPI loopback addon is available
- `mock` fallback when no addon is available

To enable native mode, provide a `.node` addon by either:

1. Setting environment variable `LOOPBACK_ADDON_PATH` to an absolute or relative `.node` file path
2. Placing addon at one of:
   - `frontend/native/loopback.node`
   - `frontend/native/loopback-addon.node`

### Supported addon APIs

The Electron main process accepts one of these exports:

1. `createLoopbackCapture({ sampleRate, channels, onChunk, onError })`
   - returns controller with `start()` and optional `stop()`, or returns a stop function
2. `startLoopback({ sampleRate, channels, onChunk, onError })`
   - returns controller with optional `stop()` or a stop function
3. `start({ sampleRate, channels, onChunk, onError })`
   - same return contract as above

`onChunk` must provide PCM16 mono audio bytes at 16kHz (Buffer or Uint8Array).

If addon load/start fails, the app automatically switches to `mock` and shows the reason in UI.

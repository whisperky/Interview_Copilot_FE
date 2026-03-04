const { app, BrowserWindow, ipcMain } = require('electron')
const fs = require('fs')
const path = require('path')

const isDev = !app.isPackaged
let mainWindow = null
let audioInterval = null
let audioMode = 'idle'
let audioSequence = 0
let nativeStop = null
let lastAudioWarning = null

const AUDIO_SAMPLE_RATE = 16000
const AUDIO_CHUNK_MS = 100

function sendAudioChunkToRenderer(payloadBase64, byteLength) {
  if (!mainWindow || mainWindow.isDestroyed()) return
  mainWindow.webContents.send('audio:chunk', {
    payload: payloadBase64,
    byteLength,
    sequence: audioSequence++,
    sampleRate: AUDIO_SAMPLE_RATE,
    mode: audioMode,
  })
}

function generateMockPcm16Chunk(sampleRate, chunkMs, sequence) {
  const samples = Math.floor((sampleRate * chunkMs) / 1000)
  const buffer = Buffer.alloc(samples * 2)
  const frequency = 180 + (sequence % 20)
  const amplitude = 0.18
  for (let i = 0; i < samples; i += 1) {
    const t = i / sampleRate
    const sine = Math.sin(2 * Math.PI * frequency * t)
    const value = Math.max(-1, Math.min(1, sine * amplitude))
    buffer.writeInt16LE(Math.round(value * 32767), i * 2)
  }
  return buffer
}

function stopAudioLoop() {
  if (audioInterval !== null) {
    clearInterval(audioInterval)
    audioInterval = null
  }
  if (typeof nativeStop === 'function') {
    try {
      nativeStop()
    } catch (error) {
      // Best effort cleanup for addon-owned resources.
    }
    nativeStop = null
  }
  audioMode = 'idle'
}

function startMockAudioLoop() {
  stopAudioLoop()
  audioMode = 'mock'
  audioInterval = setInterval(() => {
    const chunk = generateMockPcm16Chunk(AUDIO_SAMPLE_RATE, AUDIO_CHUNK_MS, audioSequence)
    sendAudioChunkToRenderer(chunk.toString('base64'), chunk.length)
  }, AUDIO_CHUNK_MS)
}

function getNativeAddonCandidates() {
  const envPath = process.env.LOOPBACK_ADDON_PATH
  const candidates = []
  if (envPath) candidates.push(path.resolve(envPath))
  candidates.push(path.resolve(process.cwd(), 'native', 'loopback.node'))
  candidates.push(path.resolve(process.cwd(), 'native', 'loopback-addon.node'))
  return candidates
}

function loadNativeAddon() {
  const candidates = getNativeAddonCandidates()
  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) continue
    try {
      return { addon: require(candidate), sourcePath: candidate }
    } catch (error) {
      return {
        addon: null,
        sourcePath: candidate,
        reason: `failed to load addon at ${candidate}: ${String(error)}`,
      }
    }
  }
  return {
    addon: null,
    sourcePath: null,
    reason: 'no .node addon found. Set LOOPBACK_ADDON_PATH or place addon in frontend/native/',
  }
}

function onNativeChunk(chunk) {
  if (!chunk) return
  const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
  sendAudioChunkToRenderer(buffer.toString('base64'), buffer.length)
}

function tryStartNativeLoopback() {
  const loaded = loadNativeAddon()
  if (!loaded.addon) {
    return { ok: false, reason: loaded.reason || 'native addon unavailable' }
  }

  const addon = loaded.addon
  stopAudioLoop()

  try {
    // Contract option A:
    // addon.createLoopbackCapture({ sampleRate, channels, onChunk, onError })
    if (typeof addon.createLoopbackCapture === 'function') {
      const capture = addon.createLoopbackCapture({
        sampleRate: AUDIO_SAMPLE_RATE,
        channels: 1,
        onChunk: onNativeChunk,
        onError: (err) => {
          lastAudioWarning = `native capture error: ${String(err)}`
        },
      })

      if (capture && typeof capture.start === 'function') {
        capture.start()
        nativeStop = typeof capture.stop === 'function' ? () => capture.stop() : null
      } else {
        nativeStop = typeof capture === 'function' ? capture : null
      }
      audioMode = 'native'
      return { ok: true, sourcePath: loaded.sourcePath }
    }

    // Contract option B:
    // addon.startLoopback({ sampleRate, channels, onChunk, onError }) -> stopFn|controller
    if (typeof addon.startLoopback === 'function') {
      const started = addon.startLoopback({
        sampleRate: AUDIO_SAMPLE_RATE,
        channels: 1,
        onChunk: onNativeChunk,
        onError: (err) => {
          lastAudioWarning = `native capture error: ${String(err)}`
        },
      })
      if (typeof started === 'function') {
        nativeStop = started
      } else if (started && typeof started.stop === 'function') {
        nativeStop = () => started.stop()
      } else {
        nativeStop = null
      }
      audioMode = 'native'
      return { ok: true, sourcePath: loaded.sourcePath }
    }

    // Contract option C:
    // addon.start({ ...same params... }) -> stopFn|controller
    if (typeof addon.start === 'function') {
      const started = addon.start({
        sampleRate: AUDIO_SAMPLE_RATE,
        channels: 1,
        onChunk: onNativeChunk,
        onError: (err) => {
          lastAudioWarning = `native capture error: ${String(err)}`
        },
      })
      if (typeof started === 'function') {
        nativeStop = started
      } else if (started && typeof started.stop === 'function') {
        nativeStop = () => started.stop()
      } else {
        nativeStop = null
      }
      audioMode = 'native'
      return { ok: true, sourcePath: loaded.sourcePath }
    }

    return {
      ok: false,
      reason: `addon loaded from ${loaded.sourcePath} but no supported API found`,
    }
  } catch (error) {
    stopAudioLoop()
    return {
      ok: false,
      reason: `native capture start failed: ${String(error)}`,
    }
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 420,
    height: 640,
    minWidth: 360,
    minHeight: 500,
    frame: false,
    alwaysOnTop: true,
    transparent: false,
    backgroundColor: '#09090b',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173')
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }
}

app.whenReady().then(() => {
  createWindow()

  ipcMain.handle('window:set-always-on-top', (_, value) => {
    if (!mainWindow) return false
    mainWindow.setAlwaysOnTop(Boolean(value))
    return true
  })

  ipcMain.handle('window:set-opacity', (_, value) => {
    if (!mainWindow) return false
    const clamped = Math.max(0.35, Math.min(1, Number(value)))
    mainWindow.setOpacity(clamped)
    return clamped
  })

  ipcMain.handle('window:minimize', () => {
    if (!mainWindow) return false
    mainWindow.minimize()
    return true
  })

  ipcMain.handle('window:close', () => {
    if (!mainWindow) return false
    mainWindow.close()
    return true
  })

  ipcMain.handle('audio:start-stream', () => {
    const nativeResult = tryStartNativeLoopback()
    if (nativeResult.ok) {
      lastAudioWarning = null
      return {
        ok: true,
        mode: audioMode,
        sampleRate: AUDIO_SAMPLE_RATE,
        chunkMs: AUDIO_CHUNK_MS,
        sourcePath: nativeResult.sourcePath,
      }
    }
    startMockAudioLoop()
    lastAudioWarning = nativeResult.reason || 'native loopback addon unavailable, using mock source'
    return {
      ok: true,
      mode: audioMode,
      sampleRate: AUDIO_SAMPLE_RATE,
      chunkMs: AUDIO_CHUNK_MS,
      warning: lastAudioWarning,
    }
  })

  ipcMain.handle('audio:stop-stream', () => {
    stopAudioLoop()
    return { ok: true, mode: audioMode }
  })

  ipcMain.handle('audio:get-status', () => ({
    mode: audioMode,
    sampleRate: AUDIO_SAMPLE_RATE,
    chunkMs: AUDIO_CHUNK_MS,
    warning: lastAudioWarning,
  }))

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  stopAudioLoop()
  if (process.platform !== 'darwin') app.quit()
})

const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('path')

const isDev = !app.isPackaged
let mainWindow = null
let audioInterval = null
let audioMode = 'idle'
let audioSequence = 0

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

function tryStartNativeLoopback() {
  // Placeholder for future native WASAPI integration.
  // If a native addon path is provided, it can be loaded and started here.
  return false
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
    const nativeStarted = tryStartNativeLoopback()
    if (nativeStarted) {
      return {
        ok: true,
        mode: audioMode,
        sampleRate: AUDIO_SAMPLE_RATE,
        chunkMs: AUDIO_CHUNK_MS,
      }
    }
    startMockAudioLoop()
    return {
      ok: true,
      mode: audioMode,
      sampleRate: AUDIO_SAMPLE_RATE,
      chunkMs: AUDIO_CHUNK_MS,
      warning: 'native loopback addon unavailable, using mock source',
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
  }))

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  stopAudioLoop()
  if (process.platform !== 'darwin') app.quit()
})

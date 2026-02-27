const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('path')

const isDev = !app.isPackaged
let mainWindow = null

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

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

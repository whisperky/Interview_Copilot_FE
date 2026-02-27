const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('desktop', {
  setAlwaysOnTop: (value) => ipcRenderer.invoke('window:set-always-on-top', value),
  setOpacity: (value) => ipcRenderer.invoke('window:set-opacity', value),
  minimize: () => ipcRenderer.invoke('window:minimize'),
  close: () => ipcRenderer.invoke('window:close'),
  startAudioStream: () => ipcRenderer.invoke('audio:start-stream'),
  stopAudioStream: () => ipcRenderer.invoke('audio:stop-stream'),
  getAudioStatus: () => ipcRenderer.invoke('audio:get-status'),
  onAudioChunk: (callback) => {
    const listener = (_, chunk) => callback(chunk)
    ipcRenderer.on('audio:chunk', listener)
    return () => ipcRenderer.removeListener('audio:chunk', listener)
  },
})

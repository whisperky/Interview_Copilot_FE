const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('desktop', {
  setAlwaysOnTop: (value) => ipcRenderer.invoke('window:set-always-on-top', value),
  setOpacity: (value) => ipcRenderer.invoke('window:set-opacity', value),
  minimize: () => ipcRenderer.invoke('window:minimize'),
  close: () => ipcRenderer.invoke('window:close'),
})

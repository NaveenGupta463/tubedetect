const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  invoke: (channel, data) => ipcRenderer.invoke(channel, data),
});

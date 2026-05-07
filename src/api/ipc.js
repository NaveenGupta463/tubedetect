export function isElectron() {
  return typeof window !== 'undefined' && !!window.electronAPI?.isElectron;
}

export function ipcFetch(channel, data) {
  if (!isElectron()) throw new Error('ipcFetch called outside Electron');
  return window.electronAPI.invoke(channel, data);
}

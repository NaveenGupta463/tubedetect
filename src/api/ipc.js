import { logger } from '../utils/logger';

export function isElectron() {
  return typeof window !== 'undefined' && !!window.electronAPI?.isElectron;
}

export async function ipcFetch(channel, data) {
  if (!isElectron()) throw new Error('ipcFetch called outside Electron');
  try {
    return await window.electronAPI.invoke(channel, data);
  } catch (err) {
    logger.error('IPC', `channel=${channel}`, err);
    throw err;
  }
}

export async function getElectronAppInfo() {
  if (!isElectron()) return null;
  try {
    return await window.electronAPI.invoke('app:info');
  } catch {
    return null;
  }
}

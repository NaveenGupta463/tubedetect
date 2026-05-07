const { app, BrowserWindow, ipcMain } = require('electron');
const path   = require('path');
const logger = require('./logger');

const isDev     = process.env.NODE_ENV === 'development';
const startedAt = Date.now();

// ── Crash guards ──────────────────────────────────────────────────────────────
process.on('uncaughtException', (err) => {
  logger.error(`[MAIN] Uncaught exception: ${err.message}\n${err.stack}`);
});

process.on('unhandledRejection', (reason) => {
  logger.error(`[MAIN] Unhandled rejection: ${String(reason)}`);
});

// ── IPC: renderer error relay ─────────────────────────────────────────────────
ipcMain.handle('log:renderer-error', (_event, entry) => {
  logger.error(`[RENDERER][${entry.category}] ${entry.msg}`);
});

// ── IPC: startup info query ───────────────────────────────────────────────────
ipcMain.handle('app:info', () => ({
  version:   app.getVersion(),
  logPath:   logger.getPath(),
  startedAt,
  uptime:    Date.now() - startedAt,
  isDev,
  platform:  process.platform,
  nodeVersion: process.versions.node,
  electronVersion: process.versions.electron,
  chromeVersion: process.versions.chrome,
}));

function createWindow() {
  const win = new BrowserWindow({
    width:  1400,
    height: 900,
    webPreferences: {
      preload:          path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration:  false,
    },
  });

  if (isDev) {
    win.loadURL('http://localhost:5173');
    logger.info('[MAIN] Loaded dev server at http://localhost:5173');
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'));
    logger.info('[MAIN] Loaded production build');
  }

  win.webContents.on('render-process-gone', (_e, details) => {
    logger.error(`[MAIN] Renderer process gone: ${details.reason}`);
  });

  win.webContents.on('unresponsive', () => {
    logger.warn('[MAIN] Renderer became unresponsive');
  });
}

app.whenReady().then(() => {
  logger.info(`[MAIN] App ready — startup: ${Date.now() - startedAt}ms`);
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  logger.info('[MAIN] All windows closed');
  if (process.platform !== 'darwin') app.quit();
});

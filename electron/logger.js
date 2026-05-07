const path = require('path');
const fs   = require('fs');

let _stream  = null;
let _logPath = null;

function getStream() {
  if (_stream) return _stream;
  try {
    const { app } = require('electron');
    const dir = app.isReady() ? app.getPath('logs') : path.join(__dirname, '../logs');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    _logPath  = path.join(dir, 'tubeintel-main.log');
    _stream   = fs.createWriteStream(_logPath, { flags: 'a' });
  } catch { /* stdout only */ }
  return _stream;
}

function write(level, ...args) {
  const line = `[${new Date().toISOString()}] [${level.padEnd(5)}] ${args.join(' ')}\n`;
  process.stdout.write(line);
  try { getStream()?.write(line); } catch {}
}

module.exports = {
  info:    (...a) => write('INFO',  ...a),
  warn:    (...a) => write('WARN',  ...a),
  error:   (...a) => write('ERROR', ...a),
  getPath: ()    => _logPath,
};

const MAX_EVENTS = 100;
const _log = [];

function record(level, category, msg) {
  const entry = { ts: Date.now(), level, category, msg };
  _log.push(entry);
  if (_log.length > MAX_EVENTS) _log.shift();
  return entry;
}

function emit(level, category, ...args) {
  const msg = args
    .map(a => (a instanceof Error ? `${a.message}\n${a.stack}` : String(a)))
    .join(' ');
  record(level, category, msg);

  const prefix = `[${category}]`;
  if (level === 'error') console.error(prefix, ...args);
  else if (level === 'warn') console.warn(prefix, ...args);
  else console.log(prefix, ...args);

  if (level === 'error' && typeof window !== 'undefined' && window.electronAPI?.invoke) {
    window.electronAPI.invoke('log:renderer-error', { ts: Date.now(), category, msg }).catch(() => {});
  }
}

export const logger = {
  debug: (cat, ...a) => emit('debug', cat, ...a),
  info:  (cat, ...a) => emit('info',  cat, ...a),
  warn:  (cat, ...a) => emit('warn',  cat, ...a),
  error: (cat, ...a) => emit('error', cat, ...a),
  getLog:    ()      => [..._log],
  getErrors: ()      => _log.filter(e => e.level === 'error'),
  clear:     ()      => _log.splice(0),
};

if (typeof window !== 'undefined') {
  window.addEventListener('error', e =>
    emit('error', 'UNCAUGHT', `${e.message} (${e.filename}:${e.lineno})`));
  window.addEventListener('unhandledrejection', e =>
    emit('error', 'PROMISE', String(e.reason)));
}

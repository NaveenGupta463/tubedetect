const RESET = '\x1b[0m';
const DIM   = '\x1b[2m';
const BOLD  = '\x1b[1m';

const COLORS = {
  debug: '\x1b[36m',
  info:  '\x1b[32m',
  warn:  '\x1b[33m',
  error: '\x1b[31m',
};

const LABELS = {
  debug: 'DEBUG',
  info:  'INFO ',
  warn:  'WARN ',
  error: 'ERROR',
};

function log(level, category, ...args) {
  const color = COLORS[level] ?? '';
  const ts    = new Date().toISOString();
  const label = `${color}${BOLD}[${LABELS[level]}]${RESET}`;
  const cat   = `${DIM}[${category}]${RESET}`;
  const parts = args.map(a => (a instanceof Error ? `${a.message}\n${a.stack}` : String(a)));
  const line  = `${label} ${ts} ${cat} ${parts.join(' ')}`;

  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

module.exports = {
  debug: (cat, ...a) => log('debug', cat, ...a),
  info:  (cat, ...a) => log('info',  cat, ...a),
  warn:  (cat, ...a) => log('warn',  cat, ...a),
  error: (cat, ...a) => log('error', cat, ...a),
};

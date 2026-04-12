'use strict';

// Load .env only in local dev — Cloud Run injects env vars directly
if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config({ path: require('path').join(__dirname, '.env'), override: true });
}

const express     = require('express');
const cors        = require('cors');
const requireAuth = require('./middleware/auth');

const authRoutes    = require('./routes/auth');
const youtubeRoutes = require('./routes/youtube');
const claudeRoutes  = require('./routes/claude');
const userRoutes    = require('./routes/user');

const app  = express();
const PORT = process.env.PORT || 8080;

// ── CORS ─────────────────────────────────────────────────────────────────────
// CORS_ORIGIN env var: comma-separated list of allowed origins.
// e.g. "https://tubeintel.web.app,http://localhost:5173"
// Falls back to localhost for local dev.
const allowedOrigins = (process.env.CORS_ORIGIN || 'http://localhost:5173')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean);

app.use(cors({
  origin: (origin, cb) => {
    // Allow requests with no origin (curl, Postman, server-to-server)
    if (!origin) return cb(null, true);
    // Allow Chrome extensions (TubeIntel extension proxies YouTube API through here)
    if (origin.startsWith('chrome-extension://')) return cb(null, true);
    if (allowedOrigins.includes(origin)) return cb(null, true);
    cb(new Error(`CORS: origin ${origin} not allowed`));
  },
  credentials: true,
}));

app.use(express.json());

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/api/auth',    authRoutes);
app.use('/api/youtube', youtubeRoutes);

app.use('/api/claude', claudeRoutes);
app.use('/api/user',   requireAuth, userRoutes);

// Health check — Cloud Run readiness/liveness probe hits this
app.get('/healthz', (_, res) => res.json({ ok: true, ts: new Date().toISOString() }));

// ── Start ─────────────────────────────────────────────────────────────────────
// Bind to 0.0.0.0 — required for Cloud Run to route traffic into the container
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`TubeIntel backend running on port ${PORT}`);
  console.log(`Allowed origins: ${allowedOrigins.join(', ')}`);
});

// ── Graceful shutdown ─────────────────────────────────────────────────────────
// Cloud Run sends SIGTERM and waits up to 10s before SIGKILL.
// Stop accepting new connections, let in-flight requests finish.
function shutdown(signal) {
  console.log(`${signal} received — shutting down gracefully`);
  server.close(() => {
    console.log('All connections closed. Exiting.');
    process.exit(0);
  });

  // Force-exit if shutdown takes longer than 9 seconds
  setTimeout(() => {
    console.error('Graceful shutdown timed out — forcing exit');
    process.exit(1);
  }, 9000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

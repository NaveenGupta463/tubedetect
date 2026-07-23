'use strict';

const crypto = require('crypto');

// Central security middleware for the scoring API. Every throttle/gate here EXEMPTS the admin (owner),
// so hardening the app against anonymous abuse never limits you. Today the admin is identified by a
// secret token header; once real user auth (C1) lands, an authenticated user with role=admin will set
// req.isAdmin the same way and inherit the same exemption — no other change needed.

function timingSafeEq(a, b) {
  const ba = Buffer.from(String(a || ''));
  const bb = Buffer.from(String(b || ''));
  if (ba.length !== bb.length) return false; // length leak is unavoidable + not sensitive here
  return crypto.timingSafeEqual(ba, bb);
}

// Sets req.isAdmin from the x-admin-token header (constant-time compare, header-only so it never leaks
// into access logs / referrers the way a query param would). Runs globally, before any limiter.
function attachAdmin(req, _res, next) {
  const token = process.env.ADMIN_TOKEN;
  const provided = req.headers['x-admin-token'];
  req.isAdmin = !!(token && provided && timingSafeEq(provided, token));
  next();
}

// Gate for admin-only routes. FAILS CLOSED: a missing/invalid token — including ADMIN_TOKEN being unset
// — denies. (The previous adminAuth returned next() when the token was unset, silently opening admin.)
function requireAdmin(req, res, next) {
  if (req.isAdmin) return next();
  if (!process.env.ADMIN_TOKEN) {
    console.warn('[security] ADMIN_TOKEN not set — admin routes DENIED until it is configured');
  }
  return res.status(403).json({ error: 'forbidden' });
}

function securityHeaders(_req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');            // clickjacking
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
  res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains'); // ignored on http
  }
  next();
}

// CORS: in production, lock to CORS_ORIGINS (comma-separated exact origins). In dev, allow all so the
// local Vite server (localhost:5173) isn't broken. Never reflects an arbitrary origin in prod.
function buildCorsOptions() {
  const allow = (process.env.CORS_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  const isProd = process.env.NODE_ENV === 'production';
  return {
    origin(origin, cb) {
      if (!origin) return cb(null, true);   // same-origin, curl, server-to-server
      if (!isProd) return cb(null, true);   // dev: allow all
      return cb(null, allow.includes(origin));
    },
    credentials: true,
  };
}

// Fixed-window in-memory rate limiter (single-node). Admin is always exempt; disable entirely with
// RATE_LIMIT_DISABLED=1. For a multi-node deploy, swap the Map for a shared store (Redis).
function makeRateLimiter({ windowMs = 60000, max = 600, name = 'global' } = {}) {
  const hits = new Map(); // key -> { count, resetAt }
  const iv = setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k);
  }, windowMs);
  if (iv.unref) iv.unref();

  return function rateLimit(req, res, next) {
    if (process.env.RATE_LIMIT_DISABLED === '1') return next();
    if (req.isAdmin) return next(); // the owner is never throttled
    const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim()
      || req.socket?.remoteAddress || 'unknown';
    const key = `${name}:${ip}`;
    const now = Date.now();
    let e = hits.get(key);
    if (!e || e.resetAt <= now) { e = { count: 0, resetAt: now + windowMs }; hits.set(key, e); }
    e.count++;
    res.setHeader('X-RateLimit-Limit', max);
    res.setHeader('X-RateLimit-Remaining', Math.max(0, max - e.count));
    if (e.count > max) {
      res.setHeader('Retry-After', Math.ceil((e.resetAt - now) / 1000));
      return res.status(429).json({ error: 'Too many requests — please slow down and retry shortly.' });
    }
    next();
  };
}

module.exports = { attachAdmin, requireAdmin, securityHeaders, buildCorsOptions, makeRateLimiter, timingSafeEq };

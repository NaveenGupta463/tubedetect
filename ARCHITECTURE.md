# TubeIntel — Architecture Audit
*Last updated: 2026-05-07 — post Stages 1–6 stabilization*

---

## 1. Architecture Map

```
┌─────────────────────────────────────────────────────┐
│  Renderer (React / Vite)                            │
│                                                     │
│  src/config.js        ← all URLs, env vars          │
│  src/utils/storage.js ← all localStorage access     │
│  src/utils/logger.js  ← renderer error ring buffer  │
│  src/utils/perf.js    ← performance timing marks    │
│  src/utils/constants.js ← NICHES, CACHE_KEYS        │
│                                                     │
│  src/api/youtube.js   ← YouTube Data API v3         │
│  src/api/claude.js    ← Anthropic API (via proxy)   │
│  src/api/auth.js      ← JWT / Google OAuth          │
│  src/api/analyticsApi.js ← YouTube Analytics API   │
│  src/api/scoringApi.js   ← scoring server client    │
│  src/api/ipc.js          ← Electron IPC guard       │
└────────────────────┬────────────────────────────────┘
                     │ HTTP fetch / (future) IPC
          ┌──────────┴───────────┐
          │                      │
┌─────────▼──────────┐  ┌───────▼────────────────────┐
│  Backend (3001)    │  │  Scoring Server (3002)      │
│  backend/server.js │  │  server/index.js            │
│  - /api/claude     │  │  - /api/analyze             │
│  - /api/youtube    │  │  - /api/lookup              │
│  - /api/auth/*     │  │  - /api/explain             │
│  - /api/user/*     │  │  - /api/metrics             │
└────────────────────┘  │  - /api/results/:id         │
                        │  - /api/workspaces (CRUD)   │
                        │  - /api/db/health|stats|    │
                        │         backup              │
                        └──────────┬─────────────────┘
                                   │ node-sqlite3-wasm
                        ┌──────────▼─────────────────┐
                        │  SQLite DB (scoring.db)     │
                        │  server/db/init.js          │
                        │  server/db/schema.js        │
                        │  server/db/queries.js ← ALL │
                        │    raw SQL lives here       │
                        └────────────────────────────┘
```

```
┌─────────────────────────────────────────────────────┐
│  Electron (optional wrapper)                        │
│  electron/main.js    ← BrowserWindow, IPC handlers  │
│  electron/preload.js ← contextBridge (secure)       │
│  electron/logger.js  ← file logger (logs dir)       │
└─────────────────────────────────────────────────────┘
```

---

## 2. Runtime Boundaries

| Boundary | Enforced by | Rule |
|---|---|---|
| localStorage | `src/utils/storage.js` | All reads/writes via this wrapper — never `localStorage.*` directly |
| API URLs | `src/config.js` | All URLs derive from `BACKEND_URL` / `SCORING_URL` — never hardcode `localhost:*` in fetch() |
| Env vars | `src/config.js` | Only `config.js` reads `import.meta.env.*` — components import named constants |
| Raw SQL | `server/db/queries.js` | All SQL lives here — routes call query functions, never `db.get('SELECT...')` inline |
| Electron detection | `src/api/ipc.js::isElectron()` | Use this guard before any `window.electronAPI` access |

Run `npm run lint:arch` to verify boundary compliance before any commit.

---

## 3. Electron Boundaries

### What works now
- `electron/main.js` creates a BrowserWindow loading `localhost:5173` (dev) or `dist/index.html` (prod)
- `electron/preload.js` exposes `window.electronAPI.isElectron` and `.invoke()` via `contextBridge`
- `electron/logger.js` writes to `app.getPath('logs')/tubeintel-main.log`
- Renderer errors are relayed to the main process log via `ipcMain.handle('log:renderer-error')`
- `app:info` IPC channel returns version, uptime, log path, Node/Chrome/Electron versions

### What does NOT work in Electron yet
| Blocker | Location | Fix needed |
|---|---|---|
| `sessionStorage` (PKCE verifier) | `src/hooks/useOAuth.js` | Replace with `ipcRenderer` ephemeral store or `electron-store` |
| `window.location.href` redirect (OAuth) | `src/hooks/useOAuth.js` | Replace with `shell.openExternal()` + deep-link handler |
| Baked `import.meta.env` at build time | all of `src/` | In Electron prod, env vars must be passed at package time or via IPC |
| `analyticsApi.js` direct Google OAuth calls | `src/api/analyticsApi.js` | Needs proxy through main process in Electron |
| `window.history.replaceState` | `src/hooks/useOAuth.js` | Use `ipcRenderer.send('url:clean')` in Electron |
| No SQLite in backend | `backend/` | Backend still uses JSON/memory stores; scoring server has SQLite |

---

## 4. IPC Boundaries

All Electron IPC channels are defined in `electron/main.js` and typed in `src/api/ipc.js`:

| Channel | Direction | Handler | Purpose |
|---|---|---|---|
| `log:renderer-error` | Renderer → Main | `ipcMain.handle` | Relay renderer errors to file log |
| `app:info` | Renderer → Main | `ipcMain.handle` | Return version/uptime/log path |

Future channels to add when resolving OAuth blocker:
- `oauth:start` — open system browser for OAuth flow
- `oauth:token` — return token from deep-link callback
- `url:clean` — remove OAuth params from address bar

---

## 5. Storage Boundaries

| Data | Store | TTL | Managed by |
|---|---|---|---|
| YouTube channel/video cache | `localStorage` via `storage.js` | 30 min | `src/api/youtube.js` |
| Analytics API cache | `localStorage` via `storage.js` | 30 min | `src/api/analyticsApi.js` |
| Saved workspaces | SQLite (`workspaces` table) | Permanent | `server/routes/workspaces.js` |
| AI call counter | `localStorage` via `storage.js` | Monthly reset | `src/hooks/useTier.js` |
| OAuth token | `localStorage` via `storage.js` | Expiry from Google | `src/hooks/useOAuth.js` |
| PKCE verifier | `sessionStorage` (raw) | Tab lifetime | `src/hooks/useOAuth.js` — Electron blocker |
| Video scoring cache | In-memory (Map) | 1 hour, resets on restart | `server/routes/analyze.js` |
| Tier/plan | `localStorage` via `storage.js` | Persistent | `src/hooks/useTier.js` |

---

## 6. Known Technical Debt

### High priority
| Issue | Location | Impact | Fix |
|---|---|---|---|
| `sessionStorage` for PKCE verifier | `useOAuth.js:VERIFIER_KEY` | Electron OAuth broken | Use `electron-store` or IPC ephemeral store |
| `window.location.href` OAuth redirect | `useOAuth.js:connect()` | Electron OAuth broken | `shell.openExternal()` + deep-link |
| `CACHE_KEYS.authToken` points to wrong key | `src/utils/constants.js` | Unused, misleading | Fix or remove (actual key is `'tubeintel_jwt'` in auth.js) |

### Medium priority
| Issue | Location | Impact | Fix |
|---|---|---|---|
| Scoring server in-memory cache lost on restart | `server/routes/analyze.js:scoreCache` | Cache misses after crash | Persist to Redis or SQLite |
| `analyticsApi.js` calls Google directly from renderer | `src/api/analyticsApi.js` | Electron CSP may block | Proxy through main process |
| ML model retrain not automated | `ml/retrain_model.py` | Stale model | Add cron job in scoring server |
| Workspace load performance | `server/routes/workspaces.js` | Large JSON blobs | Add index on `updated_at`, paginate |

### Low priority / accepted debt
| Issue | Location | Note |
|---|---|---|
| `youtube.js` uses its own TTL constant | `src/api/youtube.js` | Inconsistent with `YT_CACHE_TTL_MS` in config.js |
| `performance_score` uses log(views/channelSize) | `server/routes/analyze.js` | Oversimplification — improve with model output |
| `analyze.js` uses `upsertFeatures` for new rows | `server/routes/analyze.js` | Safe, but semantically over-powered for new inserts |
| `backfillNewFeatures` runs on every startup | `server/db/init.js` | Slow if DB is large; add a `backfill_done` flag |

---

## 7. Future Scalability Opportunities

### Toward local AI / background workers
- **IPC worker pattern**: `electron/main.js` can spawn `worker_threads` for ML inference, returning results via IPC. `src/api/ipc.js::ipcFetch` is already the right abstraction.
- **Scoring server as embedded process**: In Electron prod, spawn `server/index.js` as a child process instead of expecting a separate terminal. Use `child_process.fork()` in `electron/main.js`.
- **SQLite as single source of truth**: Both workspaces and YouTube cache can move to SQLite. `storage.js` already abstracts localStorage — swap the implementation behind the same interface.
- **Background scoring jobs**: Scoring server already has `server/jobs/` (feedbackCron, refreshCron, youtubeIngest). These can be triggered via IPC from the renderer instead of polling.
- **Offline mode**: With SQLite cache + local ML model, the app can score videos without internet. Only `fetchVideoFull` and `fetchChannelStatsBatch` need network.

### Toward multi-user / SaaS scaling
- Add user ID column to `workspaces`, `videos`, `predictions` tables
- Add auth middleware to scoring server (currently unauthenticated)
- Move `server/` to a proper cloud deployment (Fly.io, Railway) — it already uses environment variables for all secrets

---

## 8. Remaining Electron Risks

| Risk | Severity | Likelihood | Mitigation |
|---|---|---|---|
| OAuth completely broken in Electron | High | Certain | Known blocker — add `shell.openExternal()` flow |
| `import.meta.env` values baked at build time | High | Certain in prod | Use `electron-store` or pass via `app:info` IPC |
| CSP blocks direct Google API calls in Electron | Medium | Likely | Add CSP headers or proxy through main process |
| `sessionStorage` not shared across Electron windows | Medium | Possible | Move PKCE verifier to `ipcRenderer` ephemeral store |
| Renderer crash not recoverable | Low | Unlikely | `render-process-gone` event now logged; add auto-reload |
| Large workspace JSON blobs cause slow IPC | Low | Possible | Compress or chunk large payloads |

---

## Operational Runbook

### Start (browser mode)
```
npm run dev
```
Starts: Vite (5173) + backend (3001) + scoring server (3002)

### Start (Electron mode)
```
npm run electron:dev
```
Same as above but also launches Electron. Waits for Vite before opening the window (`wait-on`).

### Architecture boundary check
```
npm run lint:arch
```
Exits 0 if clean, exits 1 if any boundary violation is found. Run before every commit.

### DB health
```
curl http://localhost:3002/api/db/health
curl http://localhost:3002/api/db/stats
```

### Export workspace backup
```
curl http://localhost:3002/api/db/backup > backup.json
```

### Force quota reset (scoring server)
Restart the scoring server process — quota counters are in-memory and reset on restart.

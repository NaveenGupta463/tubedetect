# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**TubeIntel** — a YouTube analytics and AI-powered growth tool. It consists of two separate deployables:
- **Web App**: React/Vite SPA at `src/`
- **Chrome Extension**: MV3 extension at `extension/`

## Commands

```bash
npm run dev       # Dev server at http://localhost:5173
npm run build     # Production build → ./dist/
npm run preview   # Preview production build
```

No test runner or linter is configured.

## Architecture

### Web App (`src/`)

**Entry:** `main.jsx` → `App.jsx` (routing + global state)

**API Layer (`src/api/`)**
- `youtube.js` — YouTube Data API v3 (channels, videos, comments); responses cached in `localStorage` with 1-hour TTL
- `analyticsApi.js` — YouTube Analytics API v2; requires OAuth access token
- `claude.js` — Claude API calls routed through Vite proxy (see `vite.config.js`)
- `youtubeSearch.js` — YouTube search helpers

**State & Auth (`src/hooks/`)**
- `useTier.js` — subscription tier (Free/Starter/Pro/Agency) + AI call limits; persisted in `localStorage`
- `useOAuth.js` — Google OAuth implicit grant flow; token stored in `sessionStorage`

**Feature Gating**
- `src/utils/tierConfig.js` — tier definitions, per-tier limits, and feature flags
- `ProGate.jsx` — renders paywall overlay for locked features
- AI tools enforce call limits via `useTier`

**AI Tools** (all call Claude via `src/api/claude.js`): `ViralFormulaDecoder`, `TitleThumbnailScorer`, `CommentSentimentMiner`, `ScriptOutlineGenerator`, `NicheTrendScanner`

**OAuth-Gated Features**: `MyChannelAnalytics` (YouTube Analytics API), `PrePublishValidator`, `WeeklyPdfReport` (uses `src/utils/pdfBuilder.js` + jsPDF)

### Chrome Extension (`extension/`)

Separate codebase — not bundled with the web app.

- `background.js` — MV3 service worker; handles YouTube API calls and caching
- `content.js` — injected into YouTube pages; renders overlay panels
- `popup.html/js` — extension popup UI

**Extension ↔ Web App integration**: uses `sessionStorage` for deep-linking (extension passes channel/video data to the web app).

## Environment Variables

Requires a `.env` file with:
- `VITE_YOUTUBE_API_KEY` — YouTube Data API v3 key
- `VITE_ANTHROPIC_API_KEY` — Claude API key
- `VITE_GOOGLE_CLIENT_ID` — Google OAuth client ID

The Vite dev server proxies Claude API requests to avoid CORS (configured in `vite.config.js`).

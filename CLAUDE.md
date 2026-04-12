# TubeIntel — Project Context for Claude Code

## What this app is
TubeIntel is a YouTube analytics and content research web app. It lets users search YouTube channels and videos, analyze engagement metrics, decode viral patterns, and get AI-powered insights on why content performs well or poorly.

## Tech stack
- Framework: React (JSX) with Vite
- Dev server: localhost:5173 (`npm run dev`)
- YouTube data: YouTube Data API v3
- AI analysis: Anthropic Claude API (claude-sonnet) via Vite proxy
- Deployment: Vercel
- OS: Windows
- No test runner or linter configured

## Environment variables (`.env`)
- `VITE_YT_API_KEY` — YouTube Data API v3 key
- `VITE_ANTHROPIC_KEY` — Claude API key
- `VITE_GOOGLE_CLIENT_ID` — Google OAuth client ID

## Commands
```bash
npm run dev       # Dev server → localhost:5173
npm run build     # Production build → ./dist/
npm run preview   # Preview production build
```

## Architecture overview
- Entry: `src/main.jsx` → `src/App.jsx` (all routing + global state)
- App state lives in App.jsx: `activeView`, `channel`, `videos`, `selectedVideo`, `competitors`
- AI props bundle passed to every AI component: `{ tier, canUseAI, consumeAICall, remainingCalls, onUpgrade }`
- YouTube API responses cached in localStorage with 1-hour TTL
- Chrome Extension is a separate codebase; not bundled by Vite

## View routing (activeView → component)
| activeView  | Component               | Min tier |
|-------------|-------------------------|----------|
| search      | ChannelSearch           | free     |
| channel     | ChannelOverview         | free     |
| video       | VideoGrid/VideoAnalysis | free     |
| timing      | BestTimeToPost          | free     |
| cadence     | UploadCadenceTracker    | free     |
| seo         | SeoTagAnalyzer          | free     |
| workspaces  | SavedWorkspaces         | free     |
| pricing     | PricingPage             | free     |
| validator   | PrePublishValidator     | free     |
| myanalytics | MyChannelAnalytics      | free (OAuth required) |
| competitor  | CompetitorComparison    | starter  |
| viral       | ViralFormulaDecoder     | starter  |
| scorer      | TitleThumbnailScorer    | starter  |
| sentiment   | CommentSentimentMiner   | starter  |
| script      | ScriptOutlineGenerator  | starter  |
| trends      | NicheTrendScanner       | starter  |
| report      | WeeklyPdfReport         | starter  |

## Tier system
- Tiers (ascending): free → starter → pro → agency
- Defined in `src/utils/tierConfig.js` — TIERS, TIER_LIMITS, VIEW_TIER, meetsRequirement()
- AI call limits: free=5, starter=500, pro=2000, agency=unlimited
- `ProGate.jsx` — paywall overlay for locked features
- `src/hooks/useTier.js` — tier state + AI call counter, persisted in localStorage

## File map
**API**
- `src/api/youtube.js` — YouTube Data API v3; fetchChannel, fetchChannelVideos, fetchVideoById; localStorage cache
- `src/api/analyticsApi.js` — YouTube Analytics API v2; needs OAuth token
- `src/api/claude.js` — Claude API calls via Vite proxy
- `src/api/youtubeSearch.js` — YouTube search helpers
- `src/api/auth.js` — auth helpers

**Hooks / Utils**
- `src/hooks/useTier.js` — tier + AI call counter
- `src/hooks/useOAuth.js` — Google OAuth implicit grant; token in sessionStorage
- `src/utils/tierConfig.js` — tier definitions and feature flags
- `src/utils/pdfBuilder.js` — jsPDF report builder
- `src/utils/analysis.js` — shared analytics helpers

**Components**
- `Sidebar.jsx` — nav sidebar
- `Header.jsx` — top header bar
- `ProGate.jsx` — paywall overlay
- `Tooltip.jsx` — shared tooltip
- `VideoList.jsx` — list-style video display
- `VideoGrid.jsx` — grid-style; exports saveLastChannel, loadLastChannel
- `ChannelSearch.jsx` — search entry point
- `ChannelOverview.jsx` — channel stats
- `VideoAnalysis.jsx` — per-video deep analysis
- `ViralFormulaDecoder.jsx` — AI: viral pattern decoder
- `TitleThumbnailScorer.jsx` — AI: title/thumbnail scorer
- `CommentSentimentMiner.jsx` — AI: comment sentiment
- `ScriptOutlineGenerator.jsx` — AI: script outline
- `NicheTrendScanner.jsx` — AI: niche trends
- `PrePublishValidator.jsx` — AI: pre-publish checklist
- `CompetitorComparison.jsx` — competitor benchmarking
- `BestTimeToPost.jsx` — optimal upload timing
- `UploadCadenceTracker.jsx` — upload frequency
- `SeoTagAnalyzer.jsx` — tag/SEO analysis
- `MyChannelAnalytics.jsx` — OAuth-gated personal analytics
- `WeeklyPdfReport.jsx` — PDF report export
- `SavedWorkspaces.jsx` — workspace save/load
- `PricingPage.jsx` — tier upgrade UI

**Chrome Extension** (`extension/`)
- `background.js` — MV3 service worker; YouTube API + caching
- `content.js` — injected into YouTube pages; overlay panels
- `popup.html/js` — extension popup UI
- Deep-links into web app via URL params: `?action=video&id=XXX` or `?action=channel&q=@handle`

## Coding rules
- Single-file JSX components unless told otherwise
- Always use recharts for graphs/charts
- Dark theme UI (black/dark gray backgrounds)
- Keep all YouTube API calls using YT_BASE and YT_KEY constants
- Never break existing features when adding new ones

## Common issue fixes
- AI response shows raw JSON → fix JSON parsing in that component
- YouTube data not loading → check API quota and endpoint params
- UI looks broken → check recharts ResponsiveContainer wrapping
- OAuth not working → check VITE_GOOGLE_CLIENT_ID and token in sessionStorage

## Instructions for every task
- Only touch the file/component mentioned — do not rewrite the whole app
- Keep changes minimal and targeted
- Do not add comments, docstrings, or type annotations to unchanged code
- Do not add error handling for impossible/internal scenarios
- Do not create new abstractions or utilities for one-off tasks
- State exactly which file was changed and what changed

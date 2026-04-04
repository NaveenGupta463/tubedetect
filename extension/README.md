# TubeIntel Chrome Extension

Brings TubeIntel analytics directly into YouTube — no tab-switching required.

## Features

| Page | What you get |
|------|-------------|
| **Channel page** (`/@handle`) | Subscriber count, avg views, engagement rate, top videos, "Full Analysis" button |
| **Video watch page** (`/watch`) | Views, likes, engagement rate, TubeIntel score vs channel average, "Deep Analyze" button |
| **YouTube Studio** | Pre-Publish Validator button injected into the upload flow |
| **Popup** | Quick stats for whatever page you're on + one-click to open the full app |

## Setup

### 1. Generate icons

Open `icons/generate_icons.html` in a browser. Right-click each canvas and save:
- `icons/icon16.png`
- `icons/icon48.png`
- `icons/icon128.png`

### 2. Load in Chrome

1. Open `chrome://extensions`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked**
4. Select this `extension/` folder

### 3. Start TubeIntel app

The extension links back to `http://localhost:5173` (your dev server).
For production, update `APP_URL` in `popup.js` and `openApp()` in `content.js`.

## Files

```
extension/
├── manifest.json      Chrome MV3 manifest
├── background.js      Service worker — YouTube API calls, caching
├── content.js         Injected into YouTube pages — sidebar panel
├── popup.html         Extension popup UI
├── popup.js           Popup logic
├── styles.css         Dark theme (shared by content + popup)
└── icons/
    ├── generate_icons.html   Open in browser to generate icons
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

## How data flows

```
YouTube page
    └─ content.js (injected)
           └─ chrome.runtime.sendMessage(...)
                  └─ background.js (service worker)
                         └─ YouTube Data API v3
                                └─ response back to content.js
```

The popup (`popup.js`) also messages `background.js` directly for the same data.

## API key

The YouTube Data API key is baked into `background.js`. The key is the same one used
by the main TubeIntel app (`VITE_YT_API_KEY`).

## App integration

Buttons in the extension open the TubeIntel web app and pass data via `sessionStorage`:

| Key | Set by | Read by |
|-----|--------|---------|
| `ti_open_channel` | content.js / popup.js | Main app on load |
| `ti_deep_video`   | content.js / popup.js | VideoAnalysis on load |
| `ti_studio_validate` | content.js | PrePublishValidator on load |

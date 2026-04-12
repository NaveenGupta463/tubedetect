// ── TubeIntel Content Script ──────────────────────────────────────────────────
// Injected into youtube.com and studio.youtube.com

(function () {
  'use strict';

  // Prevent double-injection
  if (window.__tubeintelLoaded) return;
  window.__tubeintelLoaded = true;

  // ── Helpers ─────────────────────────────────────────────────────────────────
  function fmtNum(n) {
    n = parseInt(n || 0);
    if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B';
    if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
    return n.toString();
  }

  function engColor(rate) {
    if (rate >= 5)  return '#00c853';
    if (rate >= 2)  return '#ff9100';
    if (rate >= 0.5) return '#ff6d00';
    return '#ff1744';
  }

  function scoreColor(s) {
    if (s >= 75) return '#00c853';
    if (s >= 55) return '#ff9100';
    if (s >= 40) return '#ff6d00';
    return '#ff1744';
  }

  function calcEngagement(stats) {
    const views = parseInt(stats?.viewCount || 0);
    const likes = parseInt(stats?.likeCount || 0);
    const comments = parseInt(stats?.commentCount || 0);
    if (!views) return 0;
    return +((likes + comments) / views * 100).toFixed(2);
  }

  function likeRate(stats) {
    const views = parseInt(stats?.viewCount || 0);
    const likes = parseInt(stats?.likeCount || 0);
    if (!views) return 0;
    return +((likes / views) * 100).toFixed(2);
  }

  function viewsPerHour(stats, publishedAt) {
    const views = parseInt(stats?.viewCount || 0);
    if (!publishedAt || !views) return 0;
    const ageHours = (Date.now() - new Date(publishedAt).getTime()) / 3600000;
    if (ageHours < 0.5) return views;
    return Math.round(views / ageHours);
  }

  function videoAgeLabel(publishedAt) {
    if (!publishedAt) return '';
    const ms   = Date.now() - new Date(publishedAt).getTime();
    const mins = Math.floor(ms / 60000);
    const hrs  = Math.floor(ms / 3600000);
    const days = Math.floor(ms / 86400000);
    const yrs  = Math.floor(days / 365);
    if (yrs >= 1)  return yrs + 'y ago';
    if (days >= 1) return days + 'd ago';
    if (hrs >= 1)  return hrs + 'h ago';
    return mins + 'm ago';
  }

  function velocityColor(vph) {
    if (vph >= 100000) return '#00c853';
    if (vph >= 10000)  return '#69f0ae';
    if (vph >= 1000)   return '#ff9100';
    if (vph >= 100)    return '#ff6d00';
    return '#ff1744';
  }

  function velocityLabel(vph) {
    if (vph >= 100000) return 'Viral';
    if (vph >= 10000)  return 'Hot';
    if (vph >= 1000)   return 'Active';
    if (vph >= 100)    return 'Slow';
    return 'Low';
  }

  // ── Decision Engine ───────────────────────────────────────────────────────────
  function getViralSignal(eng, vph) {
    if (eng >= 6 && vph >= 1000) return 'STRONG';
    if (eng >= 3 || vph >= 500)  return 'MEDIUM';
    return 'WEAK';
  }

  function getInsightText(signal, eng) {
    if (signal === 'STRONG') return `High engagement (${eng}%) and strong velocity — this video is growing fast.`;
    if (signal === 'MEDIUM') return `Moderate engagement (${eng}%) — performing around the channel norm.`;
    return `Low engagement (${eng}%) and slow velocity — limited organic reach detected.`;
  }

  function getRedFlags(eng, commentRate, lr, vidScore) {
    const flags = [];
    if (commentRate < 0.05)            flags.push('Low comments vs views — weak community signal');
    if (lr < 0.5)                      flags.push('Low like rate — shallow viewer interest');
    if (eng < 1)                       flags.push('Poor engagement — content may lack emotional resonance');
    if (vidScore >= 60 && eng < 2)     flags.push('High views but low engagement — shallow interest');
    return flags.slice(0, 2);
  }


  // ── Speedometer dial SVG ──────────────────────────────────────────────────
  function buildSpeedoDial(vph, col, label) {
    const cx = 100, cy = 92, r = 70, sw = 11;

    // Log scale: 0 vph = 0%, 100 000 vph = 100%
    const pct = vph <= 0 ? 0 : Math.min(100, Math.log10(Math.max(1, vph)) / 5 * 100);

    // Background arc path (top semicircle — sweep=1 = clockwise in SVG = goes OVER the top)
    const bgPath = `M ${cx - r},${cy} A ${r},${r} 0 0,1 ${cx + r},${cy}`;

    // Angle: 0% → 180° (left), 100% → 0° (right)
    const angleRad = (1 - pct / 100) * Math.PI;
    const ex = (cx + r * Math.cos(angleRad)).toFixed(1);
    const ey = (cy - r * Math.sin(angleRad)).toFixed(1);
    const valPath = pct < 0.5 ? null
      : `M ${cx - r},${cy} A ${r},${r} 0 0,1 ${ex},${ey}`;

    // Needle tip
    const needleLen = r - 16;
    const nx = (cx + needleLen * Math.cos(angleRad)).toFixed(1);
    const ny = (cy - needleLen * Math.sin(angleRad)).toFixed(1);

    // Tick marks at 0 / 25 / 50 / 75 / 100%
    const ticks = [0, 25, 50, 75, 100].map(p => {
      const a = (1 - p / 100) * Math.PI;
      const x1 = (cx + (r + 7) * Math.cos(a)).toFixed(1);
      const y1 = (cy - (r + 7) * Math.sin(a)).toFixed(1);
      const x2 = (cx + (r + 1) * Math.cos(a)).toFixed(1);
      const y2 = (cy - (r + 1) * Math.sin(a)).toFixed(1);
      return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#2a2a2a" stroke-width="2" stroke-linecap="round"/>`;
    }).join('');

    return `
<div class="ti-speedo-wrap">
  <svg viewBox="0 0 200 112" xmlns="http://www.w3.org/2000/svg" style="width:100%;display:block;">
    <!-- Background arc -->
    <path d="${bgPath}" fill="none" stroke="#1e1e1e" stroke-width="${sw}" stroke-linecap="round"/>
    <!-- Value arc -->
    ${valPath ? `<path d="${valPath}" fill="none" stroke="${col}" stroke-width="${sw}" stroke-linecap="round"/>` : ''}
    <!-- Ticks -->
    ${ticks}
    <!-- Needle -->
    <line x1="${cx}" y1="${cy}" x2="${nx}" y2="${ny}" stroke="${col}" stroke-width="2.5" stroke-linecap="round"/>
    <!-- Pivot -->
    <circle cx="${cx}" cy="${cy}" r="5" fill="#141414" stroke="${col}" stroke-width="1.5"/>
    <!-- Value number -->
    <text x="${cx}" y="${cy - 26}" font-size="21" font-weight="900" fill="${col}" text-anchor="middle" font-family="Inter,-apple-system,sans-serif">${fmtNum(vph)}</text>
    <text x="${cx}" y="${cy - 11}" font-size="8.5" fill="#555" text-anchor="middle" font-family="Inter,-apple-system,sans-serif" letter-spacing="0.8">VIEWS / HR</text>
    <!-- Velocity label -->
    <text x="${cx}" y="${cy + 16}" font-size="11" font-weight="800" fill="${col}" text-anchor="middle" font-family="Inter,-apple-system,sans-serif" letter-spacing="1">${label.toUpperCase()}</text>
    <!-- Range labels -->
    <text x="${cx - r - 2}" y="${cy + 16}" font-size="8" fill="#2a2a2a" text-anchor="middle" font-family="Inter,sans-serif">0</text>
    <text x="${cx + r + 2}" y="${cy + 16}" font-size="8" fill="#2a2a2a" text-anchor="middle" font-family="Inter,sans-serif">100K</text>
  </svg>
</div>`;
  }

  function scoreVideo(stats, avgViews) {
    const views = parseInt(stats?.viewCount || 0);
    const eng   = calcEngagement(stats);
    const lr    = likeRate(stats);
    const ratio = avgViews > 0 ? views / avgViews : 1;

    let s = 50;
    if (ratio >= 3)   s += 25;
    else if (ratio >= 1.5) s += 15;
    else if (ratio >= 1)   s += 5;
    else if (ratio < 0.4)  s -= 15;

    if (eng >= 5) s += 20;
    else if (eng >= 3) s += 12;
    else if (eng >= 1) s += 5;
    else if (eng < 0.3) s -= 10;

    if (lr >= 3)  s += 5;
    if (lr < 0.3) s -= 5;

    return Math.max(5, Math.min(100, Math.round(s)));
  }

  // ── URL detection ────────────────────────────────────────────────────────────
  function getPageType() {
    const url  = window.location.href;
    const path = window.location.pathname;

    if (url.includes('studio.youtube.com')) return 'studio';
    if (path.startsWith('/watch'))          return 'video';
    if (path.startsWith('/@') || path.startsWith('/c/') || path.startsWith('/channel/') || path.startsWith('/user/'))
      return 'channel';
    return 'other';
  }

  function getVideoId() {
    const vid = new URLSearchParams(window.location.search).get('v');
    console.log('[TubeIntel] getVideoId() →', vid, '| URL:', window.location.href);
    return vid;
  }

  // Returns { channelId, handle } — one or both may be set
  function getChannelIdentifier() {
    const path = window.location.pathname;
    // youtube.com/@handle
    const mHandle = path.match(/^\/@([^/?]+)/);
    if (mHandle) {
      const handle = '@' + mHandle[1];
      console.log('[TubeIntel] getChannelIdentifier() → handle:', handle);
      return { channelId: null, handle };
    }
    // youtube.com/channel/UCxxxxxx
    const mId = path.match(/^\/channel\/(UC[^/?]+)/);
    if (mId) {
      const channelId = mId[1];
      console.log('[TubeIntel] getChannelIdentifier() → channelId:', channelId);
      return { channelId, handle: null };
    }
    // youtube.com/c/customname
    const mCustom = path.match(/^\/c\/([^/?]+)/);
    if (mCustom) {
      const handle = mCustom[1];
      console.log('[TubeIntel] getChannelIdentifier() → custom handle:', handle);
      return { channelId: null, handle };
    }
    // youtube.com/user/username
    const mUser = path.match(/^\/user\/([^/?]+)/);
    if (mUser) {
      const handle = mUser[1];
      console.log('[TubeIntel] getChannelIdentifier() → username:', handle);
      return { channelId: null, handle };
    }
    console.log('[TubeIntel] getChannelIdentifier() → nothing found for path:', path);
    return { channelId: null, handle: null };
  }

  // Legacy helper used by getPageType
  function getChannelHandle() {
    const { channelId, handle } = getChannelIdentifier();
    return channelId || handle;
  }

  // ── Message to background ────────────────────────────────────────────────────
  function isContextInvalidated(err) {
    return err?.message?.includes('Extension context invalidated') ||
           err?.message?.includes('context invalidated') ||
           err?.message?.includes('Cannot read properties of undefined');
  }

  function sendMsg(msg) {
    return new Promise((resolve, reject) => {
      try {
        chrome.runtime.sendMessage(msg, (resp) => {
          if (chrome.runtime.lastError) {
            return reject(new Error(chrome.runtime.lastError.message));
          }
          resolve(resp);
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  // ── SVG logo ─────────────────────────────────────────────────────────────────
  const LOGO_SVG = `<svg class="ti-logo-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect x="2" y="4" width="20" height="16" rx="3" stroke="#ff0000" stroke-width="2"/>
    <path d="M10 8l6 4-6 4V8z" fill="#ff0000"/>
  </svg>`;

  // ── Build Panel DOM ──────────────────────────────────────────────────────────
  function createPanel() {
    // Toggle tab
    const toggle = document.createElement('div');
    toggle.id = 'tubeintel-toggle';
    toggle.innerHTML = `
      ${LOGO_SVG}
      <span>TI</span>
    `;

    // Panel
    const panel = document.createElement('div');
    panel.id = 'tubeintel-panel';
    panel.innerHTML = `
      <div class="ti-header">
        <a class="ti-logo" href="#" id="ti-open-app">
          ${LOGO_SVG}
          TubeIntel
        </a>
        <div style="display:flex;align-items:center;gap:6px;">
          <button class="ti-refresh-btn" id="ti-refresh-btn" title="Refresh data">↻</button>
          <button class="ti-close" id="ti-close-btn" title="Close">✕</button>
        </div>
      </div>
      <div class="ti-body" id="ti-body">
        <div class="ti-loading"><div class="ti-spinner"></div>Loading…</div>
      </div>
    `;

    document.body.appendChild(toggle);
    document.body.appendChild(panel);

    // Toggle visibility
    toggle.addEventListener('click', () => {
      panel.classList.toggle('ti-hidden');
    });
    document.getElementById('ti-close-btn').addEventListener('click', () => {
      panel.classList.add('ti-hidden');
    });

    // Refresh button — force-bypasses all caches
    document.getElementById('ti-refresh-btn').addEventListener('click', () => {
      renderPanel(true);
    });

    // Open app button
    document.getElementById('ti-open-app').addEventListener('click', (e) => {
      e.preventDefault();
      openApp();
    });

    return panel;
  }

  const APP_BASE = 'http://localhost:5173';

  function openApp(path = '') {
    window.open(APP_BASE + path, '_blank');
  }

  function openAppWithVideo(videoId) {
    const url = `${APP_BASE}?action=video&id=${encodeURIComponent(videoId)}`;
    console.log('[TubeIntel] Opening video URL:', url);
    window.open(url, '_blank');
  }

  function openAppWithChannel(channelId, handle) {
    const q = (channelId && channelId.startsWith('UC')) ? channelId : (handle || channelId || '');
    if (!q) { console.warn('[TubeIntel] openAppWithChannel: no identifier'); openApp(); return; }
    const url = `${APP_BASE}?action=channel&q=${encodeURIComponent(q)}`;
    console.log('[TubeIntel] Opening channel URL:', url);
    window.open(url, '_blank');
  }

  // ── Render helpers ────────────────────────────────────────────────────────────
  function statGrid(items, cols = 2) {
    const cls = cols === 3 ? 'ti-stat-grid cols3' : 'ti-stat-grid';
    return `
      <div class="${cls}">
        ${items.map(s => `
          <div class="ti-stat">
            <div class="ti-stat-val" style="color:${s.color || '#fff'}">${s.value}</div>
            <div class="ti-stat-lbl">${s.label}</div>
          </div>
        `).join('')}
      </div>
    `;
  }

  function engBar(label, pct, value, color) {
    return `
      <div class="ti-eng-row">
        <div class="ti-eng-label">${label}</div>
        <div class="ti-eng-bar-wrap">
          <div class="ti-eng-bar" style="width:${Math.min(100, pct)}%;background:${color}"></div>
        </div>
        <div class="ti-eng-val" style="color:${color}">${value}</div>
      </div>
    `;
  }

  function scoreBar(label, score) {
    const col = scoreColor(score);
    return `
      <div class="ti-score-row">
        <div class="ti-score-label">${label}</div>
        <div class="ti-score-bar-wrap">
          <div class="ti-score-bar" style="width:${score}%;background:${col}"></div>
        </div>
        <div class="ti-score-val" style="color:${col}">${score}</div>
      </div>
    `;
  }

  // ── CHANNEL PAGE ──────────────────────────────────────────────────────────────
  async function renderChannel(body, force = false) {
    const { channelId, handle } = getChannelIdentifier();
    if (!channelId && !handle) {
      body.innerHTML = `<div class="ti-error">Could not detect channel from URL.</div>`;
      return;
    }

    let resp;
    try {
      const msgType = channelId ? 'GET_CHANNEL_BY_ID' : 'GET_CHANNEL_BY_HANDLE';
      const msgKey  = channelId ? 'channelId'         : 'handle';
      resp = await sendMsg({ type: msgType, [msgKey]: channelId || handle, force });
    } catch (e) {
      if (isContextInvalidated(e)) {
        body.innerHTML = `<div class="ti-error" style="text-align:center;padding:16px 12px;">
          <div style="font-size:20px;margin-bottom:8px;">🔄</div>
          <div style="font-weight:700;color:#ccc;margin-bottom:6px;">Extension reloaded</div>
          <div style="font-size:11px;color:#666;margin-bottom:12px;">Refresh this page to reconnect TubeIntel.</div>
          <button onclick="location.reload()" style="background:#7c4dff;border:none;border-radius:7px;padding:8px 16px;font-size:12px;font-weight:700;color:#fff;cursor:pointer;">Refresh Page</button>
        </div>`;
      } else {
        body.innerHTML = `<div class="ti-error">API error: ${e.message}</div>`;
      }
      return;
    }

    if (!resp.ok) {
      body.innerHTML = `<div class="ti-error">${resp.error || 'Failed to load channel data.'}</div>`;
      return;
    }

    const ch     = resp.channel;
    const stats  = ch.statistics || {};
    const snip   = ch.snippet    || {};
    const subs   = parseInt(stats.subscriberCount || 0);
    const videos = parseInt(stats.videoCount      || 0);
    const views  = parseInt(stats.viewCount       || 0);
    const avgV   = videos > 0 ? Math.round(views / videos) : 0;
    const thumb  = snip.thumbnails?.default?.url || snip.thumbnails?.medium?.url || '';

    // Top video stats for engagement estimate
    const topVids = resp.topVideos || [];
    const totalEng = topVids.reduce((s, v) => s + calcEngagement(v.statistics), 0);
    const avgEng   = topVids.length ? +(totalEng / topVids.length).toFixed(2) : 0;
    const engCol   = engColor(avgEng);

    // Best video by views
    const best = topVids[0];

    const html = `
      <div class="ti-channel-header">
        ${thumb ? `<img class="ti-channel-avatar" src="${thumb}" alt="">` : ''}
        <div>
          <div class="ti-channel-name">${snip.title || handle}</div>
          <div class="ti-channel-handle">${handle}</div>
        </div>
      </div>

      ${statGrid([
        { label: 'Subscribers', value: fmtNum(subs), color: '#fff' },
        { label: 'Total Views',  value: fmtNum(views), color: '#fff' },
        { label: 'Videos',       value: fmtNum(videos), color: '#fff' },
        { label: 'Avg Views',    value: fmtNum(avgV), color: '#ff9100' },
      ])}

      <div class="ti-section-label">Engagement (top 5 videos)</div>
      ${engBar('Avg Eng Rate', avgEng * 5, avgEng + '%', engCol)}
      ${engBar('Like Rate', topVids.length ? +(topVids.reduce((s, v) => s + likeRate(v.statistics), 0) / topVids.length).toFixed(2) * 20 : 0,
        topVids.length ? +(topVids.reduce((s, v) => s + likeRate(v.statistics), 0) / topVids.length).toFixed(2) + '%' : '—',
        engCol)}

      ${best ? `
        <div class="ti-section-label">Top Performing Video</div>
        <a class="ti-video-item" href="https://www.youtube.com/watch?v=${best.id}" target="_blank">
          <img class="ti-video-thumb" src="${best.snippet?.thumbnails?.default?.url || ''}" alt="">
          <div>
            <div class="ti-video-title">${best.snippet?.title || ''}</div>
            <div class="ti-video-meta">${fmtNum(best.statistics?.viewCount)} views · ${fmtNum(best.statistics?.likeCount)} likes</div>
          </div>
        </a>
      ` : ''}

      ${topVids.length > 1 ? `
        <div class="ti-section-label">Recent Top Videos</div>
        ${topVids.slice(1, 4).map(v => `
          <a class="ti-video-item" href="https://www.youtube.com/watch?v=${v.id}" target="_blank">
            <img class="ti-video-thumb" src="${v.snippet?.thumbnails?.default?.url || ''}" alt="">
            <div>
              <div class="ti-video-title">${v.snippet?.title || ''}</div>
              <div class="ti-video-meta">${fmtNum(v.statistics?.viewCount)} views</div>
            </div>
          </a>
        `).join('')}
      ` : ''}

      <div class="ti-divider"></div>
      <button class="ti-btn ti-btn-primary" id="ti-analyze-channel">
        🔍 Full Channel Analysis
      </button>
      <button class="ti-btn ti-btn-secondary" id="ti-open-competitor">
        ⚔️ Add as Competitor
      </button>
    `;

    body.innerHTML = html;

    document.getElementById('ti-analyze-channel')?.addEventListener('click', () => {
      openAppWithChannel(ch.id, handle || null);
    });

    document.getElementById('ti-open-competitor')?.addEventListener('click', () => {
      openAppWithChannel(ch.id, handle || null);
    });
  }

  // ── VIDEO WATCH PAGE ──────────────────────────────────────────────────────────
  async function renderVideo(body, force = false) {
    const videoId = getVideoId();
    if (!videoId) {
      body.innerHTML = `<div class="ti-error">No video ID found in URL.</div>`;
      return;
    }

    let resp;
    try {
      resp = await sendMsg({ type: 'GET_VIDEO', videoId, force });
    } catch (e) {
      if (isContextInvalidated(e)) {
        body.innerHTML = `<div class="ti-error" style="text-align:center;padding:16px 12px;">
          <div style="font-size:20px;margin-bottom:8px;">🔄</div>
          <div style="font-weight:700;color:#ccc;margin-bottom:6px;">Extension reloaded</div>
          <div style="font-size:11px;color:#666;margin-bottom:12px;">Refresh this page to reconnect TubeIntel.</div>
          <button onclick="location.reload()" style="background:#7c4dff;border:none;border-radius:7px;padding:8px 16px;font-size:12px;font-weight:700;color:#fff;cursor:pointer;">Refresh Page</button>
        </div>`;
      } else {
        body.innerHTML = `<div class="ti-error">API error: ${e.message}</div>`;
      }
      return;
    }

    if (!resp.ok) {
      body.innerHTML = `<div class="ti-error">${resp.error || 'Failed to load video data.'}</div>`;
      return;
    }

    const v      = resp.video;
    const ch     = resp.channel;
    const stats  = v.statistics  || {};
    const snip   = v.snippet     || {};
    const chStat = ch?.statistics || {};

    const views    = parseInt(stats.viewCount    || 0);
    const likes    = parseInt(stats.likeCount    || 0);
    const comments = parseInt(stats.commentCount || 0);
    const eng      = calcEngagement(stats);
    const lr       = likeRate(stats);
    const engCol   = engColor(eng);

    const vph      = viewsPerHour(stats, snip.publishedAt);
    const vphCol   = velocityColor(vph);
    const vphLabel = velocityLabel(vph);
    const ageLabel = videoAgeLabel(snip.publishedAt);

    // Channel avg for score
    const chVideos = parseInt(chStat.videoCount || 1);
    const chViews  = parseInt(chStat.viewCount  || 0);
    const chAvgV   = chVideos > 0 ? Math.round(chViews / chVideos) : views;
    const vidScore = scoreVideo(stats, chAvgV);
    const vidScoreCol = scoreColor(vidScore);

    const commentRate = +((comments / (views || 1)) * 100).toFixed(3);

    // Decision engine
    const signal     = getViralSignal(eng, vph);
    const insightTxt = getInsightText(signal, eng);
    const redFlags   = getRedFlags(eng, commentRate, lr, vidScore);
    const SC = {
      STRONG: { color: '#22c55e', bg: '#0a1f0f', border: '#1a4a22' },
      MEDIUM: { color: '#eab308', bg: '#1a1700', border: '#3a3200' },
      WEAK:   { color: '#f97316', bg: '#1a0e00', border: '#3d2200' },
    }[signal];

    const html = `
      <div style="background:${SC.bg};border:1px solid ${SC.border};border-radius:10px;padding:12px 14px;margin-bottom:12px;">
        <div style="font-size:9px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:${SC.color};margin-bottom:4px;">🔥 Viral Signal</div>
        <div style="font-size:24px;font-weight:900;color:${SC.color};line-height:1;margin-bottom:6px;letter-spacing:1px;">${signal}</div>
        <div style="font-size:11px;color:#888;line-height:1.5;">${insightTxt}</div>
      </div>

      <div class="ti-video-title-main">${snip.title || 'Video'}</div>
      ${ageLabel ? `<div style="font-size:11px;color:#555;margin-bottom:10px;">📅 ${ageLabel}</div>` : ''}

      <div class="ti-section-label">Core Metrics</div>
      ${statGrid([
        { label: 'Views',    value: fmtNum(views),    color: '#fff' },
        { label: 'Likes',    value: fmtNum(likes),    color: '#fff' },
        { label: 'Comments', value: fmtNum(comments), color: '#fff' },
        { label: 'Eng Rate', value: eng + '%',         color: engCol },
      ])}

      <div class="ti-section-label">Velocity</div>
      ${buildSpeedoDial(vph, vphCol, vphLabel)}

      <div class="ti-section-label">Engagement Breakdown</div>
      ${engBar('Like rate',    Math.min(100, lr * 20),            lr + '%',            engCol)}
      ${engBar('Comment rate', Math.min(100, commentRate * 500),  commentRate + '%',   engColor(commentRate * 20))}
      ${engBar('Eng rate',     Math.min(100, eng * 10),           eng + '%',           engCol)}

      ${redFlags.length ? `
        <div class="ti-section-label" style="color:#f97316;margin-top:14px;">⚠️ Risks</div>
        <div style="display:flex;flex-direction:column;gap:5px;margin-bottom:4px;">
          ${redFlags.map(f => `
            <div style="background:#160c00;border:1px solid #3d1a00;border-radius:7px;padding:7px 10px;font-size:11px;color:#fb923c;line-height:1.45;">
              ⚠ ${f}
            </div>
          `).join('')}
        </div>
      ` : ''}

      <div class="ti-section-label">TubeIntel Score</div>
      <div class="ti-score-hero">
        <div class="ti-score-big" style="color:${vidScoreCol}">${vidScore}</div>
        <div class="ti-score-meta">
          <div style="font-size:10px;color:#555;">/ 100</div>
          <div class="ti-score-verdict" style="color:${vidScoreCol}">
            ${vidScore >= 75 ? '● Top performer' : vidScore >= 55 ? '● Above avg' : vidScore >= 40 ? '● Average' : '● Below avg'}
          </div>
          ${ch ? `<div style="font-size:10px;color:#444;margin-top:2px;">vs ${ch.snippet?.title || 'channel'}</div>` : ''}
        </div>
      </div>
      ${scoreBar('Views vs avg', Math.min(100, Math.round((views / (chAvgV || 1)) * 50)))}
      ${scoreBar('Engagement',   Math.min(100, Math.round(eng * 10)))}
      ${scoreBar('Like rate',    Math.min(100, Math.round(lr * 15)))}

      <div class="ti-divider"></div>
      <div style="background:linear-gradient(135deg,#0d0d1a,#120a1f);border:1px solid #7c4dff44;border-radius:10px;padding:14px;">
        <div style="font-size:10px;font-weight:800;letter-spacing:1.2px;text-transform:uppercase;color:#7c4dff;margin-bottom:8px;">🔬 Unlock in TubeIntel</div>
        ${[
          '8-dimension AI score — Hook, SEO, Emotion, Algorithm & more',
          'Hook strength analysis with retention phase breakdown',
          '5 virality factor scores (Novelty, Shareability, Controversy…)',
          'AI title rewrites with projected score improvements',
          'Content DNA blueprint — replicate what made it viral',
        ].map(item => `
          <div style="display:flex;gap:8px;align-items:flex-start;margin-bottom:6px;">
            <span style="color:#7c4dff;font-size:12px;flex-shrink:0;">✦</span>
            <span style="font-size:11px;color:#888;line-height:1.5;">${item}</span>
          </div>
        `).join('')}
      </div>

      ${ch ? `
        <div class="ti-divider"></div>
        <div class="ti-channel-mini">
          ${ch.snippet?.thumbnails?.default?.url ? `<img class="ti-channel-mini-avatar" src="${ch.snippet.thumbnails.default.url}" alt="">` : ''}
          <div>
            <div style="font-size:12px;font-weight:700;color:#ccc;">${ch.snippet?.title || ''}</div>
            <div style="font-size:10px;color:#555;">${fmtNum(chStat.subscriberCount)} subs · ${fmtNum(chStat.videoCount)} videos</div>
          </div>
        </div>
      ` : ''}

      <div class="ti-divider"></div>
      <button class="ti-btn ti-btn-viral" id="ti-deep-analyze">
        🚀 Get Full Viral Breakdown
      </button>
      <button class="ti-btn ti-btn-secondary" id="ti-open-channel-from-video">
        📺 Analyze Channel
      </button>
    `;

    body.innerHTML = html;

    document.getElementById('ti-deep-analyze')?.addEventListener('click', () => {
      openAppWithVideo(videoId);
    });

    document.getElementById('ti-open-channel-from-video')?.addEventListener('click', () => {
      openAppWithChannel(snip.channelId, null);
    });
  }

  // ── YOUTUBE STUDIO ────────────────────────────────────────────────────────────
  function injectStudioBar() {
    if (document.getElementById('tubeintel-studio-bar')) return;

    const bar = document.createElement('div');
    bar.id = 'tubeintel-studio-bar';
    bar.innerHTML = `
      <div class="ti-studio-icon">🚀</div>
      <div class="ti-studio-text">
        <strong>TubeIntel Pre-Publish Validator</strong><br>
        Check your video before uploading — score title, tags &amp; thumbnail.
      </div>
      <button class="ti-btn ti-btn-green" id="ti-studio-validate" style="width:auto;margin:0;padding:7px 14px;font-size:11px;white-space:nowrap;">
        Validate Now
      </button>
    `;

    // Try to inject near the upload/details form
    const targets = [
      '#details',
      'ytcp-uploads-details',
      'ytcp-video-upload-form',
      '#upload-details',
      '.ytcp-video-metadata-editor',
    ];

    let injected = false;
    for (const sel of targets) {
      const el = document.querySelector(sel);
      if (el) {
        el.parentNode?.insertBefore(bar, el);
        injected = true;
        break;
      }
    }

    if (!injected) {
      // Fallback: insert at top of main content
      const main = document.querySelector('main, ytcp-app, #content');
      if (main) main.insertBefore(bar, main.firstChild);
    }

    document.getElementById('ti-studio-validate')?.addEventListener('click', () => {
      openApp('/validator');
    });
  }

  function renderStudio(body) {
    body.innerHTML = `
      <div class="ti-section-label">YouTube Studio</div>
      <div style="font-size:12px;color:#888;line-height:1.65;margin-bottom:12px;">
        Use TubeIntel tools while working in Studio — validate your video before publishing.
      </div>
      <button class="ti-btn ti-btn-green" id="ti-studio-panel-validate">
        🚀 Pre-Publish Validator
      </button>
      <button class="ti-btn ti-btn-secondary" id="ti-open-app-studio">
        📊 Open TubeIntel Dashboard
      </button>
      <div class="ti-divider"></div>
      <div class="ti-section-label">Quick Tips</div>
      <div style="font-size:11px;color:#555;line-height:1.8;">
        ✓ Title: 50–70 chars with keyword up front<br>
        ✓ Description: 250+ words, links in first 3 lines<br>
        ✓ Tags: 10–15 specific + broad tags<br>
        ✓ Thumbnail: High contrast, legible text
      </div>
    `;

    document.getElementById('ti-studio-panel-validate')?.addEventListener('click', () => openApp('/validator'));
    document.getElementById('ti-open-app-studio')?.addEventListener('click', () => openApp());

    // Also inject the bar into the upload flow
    injectStudioBar();
    // Re-check periodically for SPA navigation in Studio
    let attempts = 0;
    const studioInterval = setInterval(() => {
      if (attempts++ > 20) { clearInterval(studioInterval); return; }
      injectStudioBar();
    }, 1500);
  }

  // ── OTHER PAGE ────────────────────────────────────────────────────────────────
  function renderOther(body) {
    body.innerHTML = `
      <div class="ti-empty">
        <div style="font-size:28px;margin-bottom:8px;">📺</div>
        Navigate to a <strong style="color:#aaa">YouTube channel</strong> or
        <strong style="color:#aaa">video</strong> to see TubeIntel insights here.
      </div>
      <button class="ti-btn ti-btn-primary" id="ti-open-app-other">
        Open TubeIntel Dashboard
      </button>
    `;
    document.getElementById('ti-open-app-other')?.addEventListener('click', () => openApp());
  }

  // ── Main render dispatcher ───────────────────────────────────────────────────
  let currentUrl  = '';
  let currentPanel = null;

  async function renderPanel(force = false) {
    const url = window.location.href;
    // Skip dedup check when force-refreshing
    if (!force && url === currentUrl && currentPanel) return;
    currentUrl = url;

    if (!currentPanel) {
      currentPanel = createPanel();
    }

    const body = document.getElementById('ti-body');
    if (!body) return;

    const pageType = getPageType();

    // Auto-open panel whenever navigating to a video page
    if (pageType === 'video') {
      currentPanel.classList.remove('ti-hidden');
    }

    // Spin the refresh button while loading
    const refreshBtn = document.getElementById('ti-refresh-btn');
    if (refreshBtn) {
      refreshBtn.style.animation = 'ti-spin 0.8s linear infinite';
      refreshBtn.disabled = true;
    }

    body.innerHTML = `<div class="ti-loading"><div class="ti-spinner"></div>${force ? 'Refreshing…' : 'Loading…'}</div>`;

    switch (pageType) {
      case 'channel': await renderChannel(body, force); break;
      case 'video':   await renderVideo(body, force);   break;
      case 'studio':  renderStudio(body);               break;
      default:        renderOther(body);                break;
    }

    if (refreshBtn) {
      refreshBtn.style.animation = '';
      refreshBtn.disabled = false;
    }
  }

  // ── SPA navigation detection ─────────────────────────────────────────────────
  // YouTube is a SPA — intercept pushState/replaceState + popstate
  const _pushState    = history.pushState.bind(history);
  const _replaceState = history.replaceState.bind(history);

  history.pushState = function (...args) {
    _pushState(...args);
    setTimeout(renderPanel, 300);
  };
  history.replaceState = function (...args) {
    _replaceState(...args);
    setTimeout(renderPanel, 300);
  };
  window.addEventListener('popstate', () => setTimeout(renderPanel, 300));

  // Also watch DOM for yt-navigate-finish event (YouTube's internal nav event)
  document.addEventListener('yt-navigate-finish', () => setTimeout(renderPanel, 300));

  // ── Init ─────────────────────────────────────────────────────────────────────
  // Wait for body to be ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', renderPanel);
  } else {
    // Slight delay so YouTube's own layout loads first
    setTimeout(renderPanel, 800);
  }
})();

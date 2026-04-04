// ── TubeIntel Popup ───────────────────────────────────────────────────────────

const APP_URL = 'http://localhost:5173';

function fmtNum(n) {
  n = parseInt(n || 0);
  if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return n.toString();
}

function engColor(rate) {
  if (rate >= 5)   return '#00c853';
  if (rate >= 2)   return '#ff9100';
  if (rate >= 0.5) return '#ff6d00';
  return '#ff1744';
}

function calcEng(stats) {
  const v = parseInt(stats?.viewCount || 0);
  const l = parseInt(stats?.likeCount || 0);
  const c = parseInt(stats?.commentCount || 0);
  if (!v) return 0;
  return +((l + c) / v * 100).toFixed(2);
}

function statRow(items) {
  return `
    <div class="ti-popup-stat-row">
      ${items.map(s => `
        <div class="ti-popup-stat">
          <div class="ti-popup-stat-val" style="color:${s.color || '#fff'}">${s.value}</div>
          <div class="ti-popup-stat-lbl">${s.label}</div>
        </div>
      `).join('')}
    </div>
  `;
}

function sendMsg(msg) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(msg, (resp) => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      resolve(resp);
    });
  });
}

function openApp(path = '') {
  chrome.tabs.create({ url: APP_URL + path });
}

function openAppWithChannel(channelId, handle) {
  const q = (channelId && channelId.startsWith('UC')) ? channelId : (handle || channelId || '');
  if (!q) { openApp(); return; }
  chrome.tabs.create({ url: `${APP_URL}?action=channel&q=${encodeURIComponent(q)}` });
}

function openAppWithVideo(videoId) {
  chrome.tabs.create({ url: `${APP_URL}?action=video&id=${encodeURIComponent(videoId)}` });
}

function setBadge(text, color = '#ff0000') {
  const el = document.getElementById('popup-page-badge');
  if (!el) return;
  el.textContent = text;
  el.style.display = 'inline-flex';
  el.style.background = color + '22';
  el.style.borderColor = color + '44';
  el.style.color = color;
}

// ── Render: not on YouTube ────────────────────────────────────────────────────
function renderNotYT() {
  document.getElementById('popup-body').innerHTML = `
    <div class="ti-popup-not-yt">
      <span>📺</span>
      Navigate to <strong style="color:#aaa">YouTube</strong> to see TubeIntel insights.
    </div>
    <div style="padding:0 14px 14px;">
      <button class="ti-btn ti-btn-primary" id="pop-open-app">
        Open TubeIntel Dashboard
      </button>
    </div>
  `;
  document.getElementById('pop-open-app')?.addEventListener('click', () => openApp());
}

// ── Render: YouTube home / other ──────────────────────────────────────────────
function renderYTOther(url) {
  setBadge('YouTube', '#ff0000');
  document.getElementById('popup-body').innerHTML = `
    <div class="ti-popup-page-type">YouTube</div>
    <div class="ti-popup-title" style="color:#555;font-weight:400;">
      Browse to a channel or video to see stats here.
    </div>
    <button class="ti-btn ti-btn-primary" id="pop-open-app">
      Open TubeIntel Dashboard
    </button>
  `;
  document.getElementById('pop-open-app')?.addEventListener('click', () => openApp());
}

// ── Extract channel identifier from a YouTube tab URL ────────────────────────
function extractChannelIdentifier(tabUrl) {
  const path = new URL(tabUrl).pathname;
  // /@handle
  const mHandle = path.match(/^\/@([^/?]+)/);
  if (mHandle) return { channelId: null, handle: '@' + mHandle[1] };
  // /channel/UCxxxxxx
  const mId = path.match(/^\/channel\/(UC[^/?]+)/);
  if (mId) return { channelId: mId[1], handle: null };
  // /c/customname
  const mCustom = path.match(/^\/c\/([^/?]+)/);
  if (mCustom) return { channelId: null, handle: mCustom[1] };
  // /user/username
  const mUser = path.match(/^\/user\/([^/?]+)/);
  if (mUser) return { channelId: null, handle: mUser[1] };
  return { channelId: null, handle: null };
}

// ── Render: Channel page ──────────────────────────────────────────────────────
async function renderChannel(tab) {
  setBadge('Channel', '#7c4dff');

  const { channelId, handle } = extractChannelIdentifier(tab.url);
  if (!channelId && !handle) {
    renderYTOther(tab.url);
    return;
  }

  document.getElementById('popup-body').innerHTML = `
    <div class="ti-popup-page-type">Channel</div>
    <div class="ti-loading" style="padding:24px 0;"><div class="ti-spinner"></div></div>
  `;

  let resp;
  try {
    const msgType = channelId ? 'GET_CHANNEL_BY_ID' : 'GET_CHANNEL_BY_HANDLE';
    const msgKey  = channelId ? 'channelId' : 'handle';
    resp = await sendMsg({ type: msgType, [msgKey]: channelId || handle });
  } catch (e) {
    document.getElementById('popup-body').innerHTML = `<div class="ti-error" style="margin:12px 0;">${e.message}</div>`;
    return;
  }

  if (!resp.ok) {
    document.getElementById('popup-body').innerHTML = `<div class="ti-error" style="margin:12px 0;">${resp.error}</div>`;
    return;
  }

  const ch    = resp.channel;
  const stats = ch.statistics || {};
  const snip  = ch.snippet    || {};
  const subs  = parseInt(stats.subscriberCount || 0);
  const vids  = parseInt(stats.videoCount      || 0);
  const views = parseInt(stats.viewCount       || 0);
  const avgV  = vids > 0 ? Math.round(views / vids) : 0;

  const topVids  = resp.topVideos || [];
  const totalEng = topVids.reduce((s, v) => s + calcEng(v.statistics), 0);
  const avgEng   = topVids.length ? +(totalEng / topVids.length).toFixed(2) : 0;
  const engCol   = engColor(avgEng);
  const thumb    = snip.thumbnails?.default?.url || '';

  document.getElementById('popup-body').innerHTML = `
    <div class="ti-popup-page-type">Channel</div>
    <div style="display:flex;align-items:center;gap:9px;margin-bottom:10px;">
      ${thumb ? `<img style="width:34px;height:34px;border-radius:50%;border:1px solid #1e1e1e;object-fit:cover;" src="${thumb}" alt="">` : ''}
      <div class="ti-popup-title" style="margin:0;">${snip.title || handle}</div>
    </div>
    ${statRow([
      { label: 'Subscribers', value: fmtNum(subs) },
      { label: 'Avg Views',   value: fmtNum(avgV), color: '#ff9100' },
      { label: 'Eng Rate',    value: avgEng + '%',  color: engCol },
    ])}
    ${topVids[0] ? `
      <div style="font-size:10px;color:#444;text-transform:uppercase;letter-spacing:0.8px;margin-bottom:5px;margin-top:2px;">Top Video</div>
      <div style="display:flex;gap:7px;align-items:center;margin-bottom:10px;">
        <img style="width:50px;height:34px;border-radius:3px;object-fit:cover;border:1px solid #1a1a1a;flex-shrink:0;"
          src="${topVids[0].snippet?.thumbnails?.default?.url || ''}" alt="">
        <div>
          <div style="font-size:11px;font-weight:600;color:#ccc;line-height:1.3;margin-bottom:2px;
            display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;">
            ${topVids[0].snippet?.title || ''}
          </div>
          <div style="font-size:10px;color:#555;">${fmtNum(topVids[0].statistics?.viewCount)} views</div>
        </div>
      </div>
    ` : ''}
    <button class="ti-btn ti-btn-primary" id="pop-analyze-channel">
      🔍 Full Channel Analysis
    </button>
    <button class="ti-btn ti-btn-secondary" id="pop-open-app-ch">
      📊 TubeIntel Dashboard
    </button>
  `;

  document.getElementById('pop-analyze-channel')?.addEventListener('click', () => {
    openAppWithChannel(ch.id || channelId, handle);
  });
  document.getElementById('pop-open-app-ch')?.addEventListener('click', () => openApp());
}

// ── Render: Video page ────────────────────────────────────────────────────────
async function renderVideo(tab) {
  setBadge('Video', '#ff0000');

  const videoId = new URLSearchParams(new URL(tab.url).search).get('v');
  if (!videoId) { renderYTOther(tab.url); return; }

  document.getElementById('popup-body').innerHTML = `
    <div class="ti-popup-page-type">Video</div>
    <div class="ti-loading" style="padding:24px 0;"><div class="ti-spinner"></div></div>
  `;

  let resp;
  try {
    resp = await sendMsg({ type: 'GET_VIDEO', videoId });
  } catch (e) {
    document.getElementById('popup-body').innerHTML = `<div class="ti-error" style="margin:12px 0;">${e.message}</div>`;
    return;
  }

  if (!resp.ok) {
    document.getElementById('popup-body').innerHTML = `<div class="ti-error" style="margin:12px 0;">${resp.error}</div>`;
    return;
  }

  const v       = resp.video;
  const ch      = resp.channel;
  const stats   = v.statistics  || {};
  const snip    = v.snippet     || {};
  const chStats = ch?.statistics || {};

  const views    = parseInt(stats.viewCount    || 0);
  const likes    = parseInt(stats.likeCount    || 0);
  const comments = parseInt(stats.commentCount || 0);
  const eng      = calcEng(stats);
  const engCol   = engColor(eng);

  const thumb = snip.thumbnails?.medium?.url || snip.thumbnails?.default?.url || '';

  document.getElementById('popup-body').innerHTML = `
    <div class="ti-popup-page-type">Video</div>
    ${thumb ? `<img style="width:100%;height:auto;border-radius:7px;border:1px solid #1a1a1a;margin-bottom:9px;display:block;" src="${thumb}" alt="">` : ''}
    <div class="ti-popup-title" style="margin-bottom:10px;">${snip.title || 'Video'}</div>
    ${statRow([
      { label: 'Views',    value: fmtNum(views) },
      { label: 'Likes',    value: fmtNum(likes) },
      { label: 'Comments', value: fmtNum(comments) },
      { label: 'Eng Rate', value: eng + '%', color: engCol },
    ])}
    ${ch ? `
      <div style="font-size:10px;color:#444;margin-bottom:4px;margin-top:2px;">
        📺 ${ch.snippet?.title || ''} · ${fmtNum(chStats.subscriberCount)} subs
      </div>
    ` : ''}
    <button class="ti-btn ti-btn-primary" id="pop-deep-analyze">
      🧠 Deep Analyze This Video
    </button>
    <button class="ti-btn ti-btn-secondary" id="pop-open-app-vid">
      📊 TubeIntel Dashboard
    </button>
  `;

  document.getElementById('pop-deep-analyze')?.addEventListener('click', () => {
    openAppWithVideo(videoId);
  });
  document.getElementById('pop-open-app-vid')?.addEventListener('click', () => openApp());
}

// ── Render: Studio ────────────────────────────────────────────────────────────
function renderStudio() {
  setBadge('Studio', '#00c853');
  document.getElementById('popup-body').innerHTML = `
    <div class="ti-popup-page-type">YouTube Studio</div>
    <div class="ti-popup-title">Ready to validate your video?</div>
    <div style="font-size:11px;color:#555;line-height:1.7;margin-bottom:12px;">
      Run TubeIntel's Pre-Publish Validator before uploading to maximize your video's reach.
    </div>
    <button class="ti-btn ti-btn-green" id="pop-validate">
      🚀 Open Pre-Publish Validator
    </button>
    <button class="ti-btn ti-btn-secondary" id="pop-open-app-studio">
      📊 TubeIntel Dashboard
    </button>
  `;
  document.getElementById('pop-validate')?.addEventListener('click', () => openApp('/validator'));
  document.getElementById('pop-open-app-studio')?.addEventListener('click', () => openApp());
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function init() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url) { renderNotYT(); return; }

    const url = tab.url;

    if (url.includes('studio.youtube.com')) {
      renderStudio();
    } else if (url.includes('youtube.com/watch')) {
      await renderVideo(tab);
    } else if (url.match(/youtube\.com\/@|youtube\.com\/c\/|youtube\.com\/channel\/|youtube\.com\/user\//)) {
      await renderChannel(tab);
    } else if (url.includes('youtube.com')) {
      renderYTOther(url);
    } else {
      renderNotYT();
    }
  } catch (e) {
    document.getElementById('popup-body').innerHTML = `
      <div class="ti-error" style="margin:12px 0;">Error: ${e.message}</div>
    `;
  }
}

document.addEventListener('DOMContentLoaded', init);

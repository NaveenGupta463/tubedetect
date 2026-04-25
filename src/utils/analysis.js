export function parseDuration(iso) {
  if (!iso) return { total: 0, formatted: '0:00', minutes: 0 };
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  const h = parseInt(m?.[1] || 0);
  const min = parseInt(m?.[2] || 0);
  const s = parseInt(m?.[3] || 0);
  const total = h * 3600 + min * 60 + s;
  const totalMin = h * 60 + min;
  const formatted = h > 0
    ? `${h}:${String(min).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${min}:${String(s).padStart(2, '0')}`;
  return { total, formatted, hours: h, minutes: totalMin, seconds: s };
}

export function formatNum(n) {
  n = parseInt(n || 0);
  if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return n.toLocaleString();
}

export function calcEngagement(stats) {
  const views = parseInt(stats?.viewCount || 0);
  const likes = parseInt(stats?.likeCount || 0);
  const comments = parseInt(stats?.commentCount || 0);
  if (!views) return 0;
  return ((likes + comments) / views) * 100;
}

function formatSecs(s) {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

export function extractTimestamps(comments, videoDurationSecs) {
  const counts = {};
  const re = /\b(\d{1,2}):(\d{2})(?::(\d{2}))?\b/g;

  for (const comment of comments) {
    const text = comment.snippet?.topLevelComment?.snippet?.textDisplay || '';
    let match;
    const localRe = new RegExp(re.source, 'g');
    while ((match = localRe.exec(text)) !== null) {
      const secs = match[3]
        ? parseInt(match[1]) * 3600 + parseInt(match[2]) * 60 + parseInt(match[3])
        : parseInt(match[1]) * 60 + parseInt(match[2]);
      const limit = videoDurationSecs || 7200;
      if (secs > 0 && secs <= limit) {
        const bucket = Math.floor(secs / 20) * 20;
        counts[bucket] = (counts[bucket] || 0) + 1;
      }
    }
  }

  if (Object.keys(counts).length === 0) return [];

  const maxTime = videoDurationSecs || Math.max(...Object.keys(counts).map(Number));
  const buckets = [];
  for (let t = 0; t <= maxTime; t += 20) {
    buckets.push({ time: t, label: formatSecs(t), count: counts[t] || 0 });
  }
  return buckets;
}


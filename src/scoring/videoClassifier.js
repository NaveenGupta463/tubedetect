export function classifyVideo({ views, publishedAt, channelAvgViews, viewsPerHour, channelAvgViewsPerHour }) {
  const videoAgeDays = publishedAt
    ? (Date.now() - new Date(publishedAt).getTime()) / 86400000
    : 0;

  const safeChannelVPH = Math.max(channelAvgViewsPerHour, 1);
  const vphRatio       = viewsPerHour / safeChannelVPH;

  // 1. LEGACY_VIRAL — always wins; saturated asset regardless of current velocity
  if (videoAgeDays > 365 && views > 10_000_000) {
    return { type: 'LEGACY_VIRAL', videoAgeDays };
  }

  // 2. VIRAL_SPIKE — strong current velocity, any age
  if (viewsPerHour > 5000 || vphRatio > 3) {
    return { type: 'VIRAL_SPIKE', videoAgeDays };
  }

  // 3. EARLY — first week, not viral
  if (videoAgeDays <= 7) {
    return { type: 'EARLY', videoAgeDays };
  }

  // 4. ACTIVE_GROWTH — recent moderate momentum
  if (videoAgeDays <= 90 && (viewsPerHour > 500 || vphRatio > 1.5)) {
    return { type: 'ACTIVE_GROWTH', videoAgeDays };
  }

  // 5. DORMANT — past early phase, clearly stalled
  if (videoAgeDays > 30 && viewsPerHour < 50 && vphRatio < 0.5) {
    return { type: 'DORMANT', videoAgeDays };
  }

  // 6. STABLE — everything else
  return { type: 'STABLE', videoAgeDays };
}

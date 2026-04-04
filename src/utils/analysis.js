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

export function analyzeVideo(video, allVideos, channelStats) {
  const stats = video.statistics || {};
  const views = parseInt(stats.viewCount || 0);
  const likes = parseInt(stats.likeCount || 0);
  const comments = parseInt(stats.commentCount || 0);
  const subscribers = parseInt(channelStats?.subscriberCount || 1);
  const duration = parseDuration(video.contentDetails?.duration);
  const title = video.snippet?.title || '';
  const publishedAt = video.snippet?.publishedAt;

  const engagementRate = views > 0 ? ((likes + comments) / views) * 100 : 0;
  const likeRate = views > 0 ? (likes / views) * 100 : 0;
  const commentRate = views > 0 ? (comments / views) * 100 : 0;
  const viewsPerSub = subscribers > 0 ? views / subscribers : 0;

  const validVideos = allVideos.filter(v => parseInt(v.statistics?.viewCount || 0) > 0);
  const avgViews = validVideos.length
    ? validVideos.reduce((s, v) => s + parseInt(v.statistics?.viewCount || 0), 0) / validVideos.length
    : views;
  const avgEngagement = validVideos.length
    ? validVideos.reduce((s, v) => s + calcEngagement(v.statistics), 0) / validVideos.length
    : engagementRate;

  const viewsRatio = avgViews > 0 ? views / avgViews : 1;
  const engRatio = avgEngagement > 0 ? engagementRate / avgEngagement : 1;

  const positives = [];
  const negatives = [];

  // --- Views vs channel average ---
  if (viewsRatio >= 3) {
    positives.push({
      category: 'Reach',
      icon: '🚀',
      title: `Viral hit — ${Math.round(viewsRatio * 100)}% of your channel average`,
      detail: "YouTube's algorithm heavily amplified this video. Strong early signals (CTR, watch time in first 24-48h) triggered the recommendation engine to push it to non-subscribers.",
    });
  } else if (viewsRatio >= 1.5) {
    positives.push({
      category: 'Reach',
      icon: '📈',
      title: `Above-average performance (${Math.round(viewsRatio * 100)}% of channel norm)`,
      detail: 'The algorithm favored this content. High early watch time or CTR likely contributed to broader distribution.',
    });
  } else if (viewsRatio >= 0.7 && viewsRatio < 1.5) {
    // Neutral — no push, no note
  } else if (viewsRatio < 0.4) {
    negatives.push({
      category: 'Reach',
      icon: '📉',
      title: `Underperformed — only ${Math.round(viewsRatio * 100)}% of your channel average`,
      detail: "The algorithm didn't amplify this video. Possible causes: low CTR on the thumbnail/title, poor audience retention in the first 30 seconds, or content that doesn't match your audience's expectations.",
    });
  }

  // --- Like rate ---
  if (likeRate > 5) {
    positives.push({
      category: 'Engagement',
      icon: '❤️',
      title: `Exceptional like rate: ${likeRate.toFixed(2)}% (avg YouTube: 1–4%)`,
      detail: 'Viewers felt strongly compelled to show appreciation. The content likely delivered on its promise or exceeded expectations.',
    });
  } else if (likeRate > 2) {
    positives.push({
      category: 'Engagement',
      icon: '👍',
      title: `Healthy like rate: ${likeRate.toFixed(2)}%`,
      detail: 'Above-average viewer appreciation. The content resonated positively.',
    });
  } else if (views > 1000 && likeRate < 0.5) {
    negatives.push({
      category: 'Engagement',
      icon: '👎',
      title: `Low like rate: ${likeRate.toFixed(2)}%`,
      detail: 'Very few viewers liked the video despite watching it. Consider: was the content satisfying? Was there a clear like CTA? Did the title set accurate expectations?',
    });
  }

  // --- Comment rate ---
  if (commentRate > 0.3) {
    positives.push({
      category: 'Community',
      icon: '💬',
      title: `High comment rate: ${commentRate.toFixed(3)}%`,
      detail: 'This video sparked significant discussion — a strong signal to YouTube. Comments indicate deep engagement and help the algorithm rank content higher.',
    });
  } else if (commentRate > 0.08) {
    positives.push({
      category: 'Community',
      icon: '🗨️',
      title: `Good comment activity (${commentRate.toFixed(3)}%)`,
      detail: 'Healthy audience conversation. The content invited viewer participation.',
    });
  } else if (views > 5000 && commentRate < 0.02) {
    negatives.push({
      category: 'Community',
      icon: '🔇',
      title: `Very low comments (${commentRate.toFixed(3)}%)`,
      detail: 'Minimal audience discussion. Try ending videos with a specific question, controversy, or challenge to drive comments.',
    });
  }

  // --- Duration ---
  const totalMin = duration.minutes;
  if (totalMin >= 8 && totalMin <= 20) {
    positives.push({
      category: 'Format',
      icon: '⏱️',
      title: `Optimal video length: ${duration.formatted}`,
      detail: 'Videos 8–20 minutes hit the sweet spot for YouTube — sufficient for multiple mid-roll ads while being digestible for viewers.',
    });
  } else if (totalMin > 40) {
    negatives.push({
      category: 'Format',
      icon: '⏰',
      title: `Very long format: ${duration.formatted}`,
      detail: 'Long videos require near-perfect audience retention to succeed. Consider whether this content could be tightened or split into a series.',
    });
  } else if (totalMin < 3 && views > 1000) {
    negatives.push({
      category: 'Format',
      icon: '⚡',
      title: `Very short video: ${duration.formatted}`,
      detail: 'Short non-Shorts videos accumulate little total watch time, limiting algorithmic promotion. If this was meant as a Short, upload it to the Shorts feed.',
    });
  }

  // --- Views per subscriber ---
  if (viewsPerSub > 1.0) {
    positives.push({
      category: 'Discovery',
      icon: '🌍',
      title: `Reached beyond subscribers (${(viewsPerSub * 100).toFixed(0)}% of sub count in views)`,
      detail: 'Views exceeded your subscriber count — YouTube actively recommended this to non-subscribers. This is the primary driver of channel growth.',
    });
  } else if (subscribers > 1000 && viewsPerSub < 0.05) {
    negatives.push({
      category: 'Discovery',
      icon: '🏠',
      title: `Only reached ${(viewsPerSub * 100).toFixed(1)}% of subscribers`,
      detail: 'The video barely reached your existing audience. Review the thumbnail and title — they may need stronger visual hooks or clearer value propositions.',
    });
  }

  // --- Title analysis ---
  if (title.length >= 40 && title.length <= 70) {
    positives.push({
      category: 'Title',
      icon: '✍️',
      title: `Optimal title length: ${title.length} characters`,
      detail: '40–70 characters is the sweet spot — long enough for keyword coverage, short enough to display fully in search results and feed cards.',
    });
  } else if (title.length > 100) {
    negatives.push({
      category: 'Title',
      icon: '📝',
      title: `Title too long: ${title.length} characters`,
      detail: 'Titles over 100 characters are truncated in search results, hurting CTR.',
    });
  } else if (title.length < 25) {
    negatives.push({
      category: 'Title',
      icon: '📝',
      title: `Title too short: ${title.length} characters`,
      detail: 'Short titles miss keyword opportunities and fail to create enough context or curiosity.',
    });
  }

  if (/\?/.test(title)) {
    positives.push({
      category: 'Title',
      icon: '❓',
      title: 'Question format creates a curiosity gap',
      detail: "Question titles make viewers feel they're missing important information, directly driving clicks.",
    });
  }

  if (/\d/.test(title)) {
    positives.push({
      category: 'Title',
      icon: '🔢',
      title: 'Number in title improves click-through rate',
      detail: 'Specific numbers (e.g., "5 Tips to…", "$10,000 in 30 days") consistently outperform vague titles in CTR studies.',
    });
  }

  const upperWords = title.match(/\b[A-Z]{3,}\b/g) || [];
  if (upperWords.length > 0 && upperWords.length <= 3) {
    positives.push({
      category: 'Title',
      icon: '📢',
      title: `Strong emphasis words: ${upperWords.join(', ')}`,
      detail: 'Selective capitalization creates urgency and draws the eye in crowded feeds.',
    });
  }

  // --- Engagement vs channel average ---
  if (engRatio > 1.5) {
    positives.push({
      category: 'Engagement',
      icon: '🔥',
      title: `${Math.round(engRatio * 100 - 100)}% above your channel engagement average`,
      detail: "This video connected with your audience more deeply than usual. Analyze what made it compelling — topic, format, delivery, thumbnail — and repeat it.",
    });
  } else if (engRatio < 0.5) {
    negatives.push({
      category: 'Engagement',
      icon: '❄️',
      title: `${Math.round(100 - engRatio * 100)}% below your channel engagement average`,
      detail: "Despite getting views, the audience didn't engage. The content may have attracted the wrong audience via the thumbnail/title, or failed to meet expectations set by your other videos.",
    });
  }

  // --- Publishing day ---
  if (publishedAt) {
    const day = new Date(publishedAt).toLocaleDateString('en-US', { weekday: 'long' });
    const goodDays = ['Thursday', 'Friday', 'Saturday'];
    const badDays = ['Monday', 'Tuesday'];
    if (goodDays.includes(day)) {
      positives.push({
        category: 'Timing',
        icon: '📅',
        title: `Published on ${day} — strong upload day`,
        detail: 'Thursday–Saturday generally see higher YouTube traffic, giving new videos more initial momentum.',
      });
    } else if (badDays.includes(day)) {
      negatives.push({
        category: 'Timing',
        icon: '📅',
        title: `Published on ${day} — weaker upload day`,
        detail: 'Monday and Tuesday typically have lower YouTube traffic. Publishing Thursday–Saturday can improve first-day performance.',
      });
    }
  }

  // Calculate performance score (0–100)
  let score = 50;
  score += Math.min(25, Math.max(-25, (viewsRatio - 1) * 18));
  score += Math.min(12, Math.max(-12, (likeRate - 2) * 4));
  score += Math.min(8, Math.max(-5, commentRate * 15));
  score += Math.min(5, Math.max(-5, (engRatio - 1) * 5));
  score = Math.round(Math.max(0, Math.min(100, score)));

  const grade =
    score >= 85 ? 'A+' :
    score >= 75 ? 'A' :
    score >= 65 ? 'B' :
    score >= 55 ? 'C' :
    score >= 40 ? 'D' : 'F';

  return {
    score,
    grade,
    metrics: {
      views, likes, comments,
      engagementRate, likeRate, commentRate,
      viewsPerSub, viewsRatio, engRatio,
      duration,
    },
    analysis: { positives, negatives },
    channelAvg: { views: avgViews, engagement: avgEngagement },
  };
}

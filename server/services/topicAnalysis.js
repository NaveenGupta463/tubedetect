'use strict';
const { extractPhrases } = require('../lib/phrases');

// ── Region helpers ────────────────────────────────────────────────────────────

const EN_REGIONS = new Set(['EN', 'US', 'GB', 'AU', 'CA', 'NZ', 'IE']);

function getRegionClause(userRegion) {
  if (userRegion === 'IN') return "AND (region = 'IN' OR region IS NULL)";
  if (userRegion && EN_REGIONS.has(userRegion))
    return "AND (region IN ('EN','US','GB','AU','CA','NZ','IE') OR region IS NULL)";
  return '';
}

// Stricter variant — excludes NULL-region channels. Used for adjacent ideas where the
// batch has already run; undetected NULLs are mostly non-English Latin-script channels.
function getStrictRegionClause(userRegion) {
  if (userRegion === 'IN') return "AND (region = 'IN' OR region IS NULL)";
  if (userRegion && EN_REGIONS.has(userRegion))
    return "AND region IN ('EN','US','GB','AU','CA','NZ','IE')";
  return '';
}

function isIndianRegion(r)  { return r === 'IN'; }
function isEnglishRegion(r) { return r && EN_REGIONS.has(r); }

// ── Adjacent niche map + foreign signal config ────────────────────────────────

const ADJACENCY_MAP = {
  politics:      ['news', 'geopolitics', 'philosophy', 'education'],
  geopolitics:   ['politics', 'defence', 'news', 'history'],
  defence:       ['geopolitics', 'politics', 'science', 'technology'],
  news:          ['politics', 'geopolitics', 'business', 'sports'],
  finance:       ['business', 'education', 'news'],
  business:      ['finance', 'technology', 'education'],
  technology:    ['science', 'business', 'gaming'],
  science:       ['technology', 'education', 'health'],
  education:     ['science', 'philosophy', 'technology'],
  philosophy:    ['education', 'politics', 'science'],
  health:        ['fitness', 'science', 'food'],
  fitness:       ['health', 'sports', 'yoga'],
  sports:        ['fitness', 'news', 'gaming'],
  food:          ['health', 'travel', 'lifestyle'],
  travel:        ['lifestyle', 'food', 'entertainment'],
  lifestyle:     ['beauty', 'food', 'travel'],
  beauty:        ['lifestyle', 'health'],
  yoga:          ['fitness', 'health', 'meditation'],
  meditation:    ['yoga', 'health', 'philosophy'],
  gaming:        ['technology', 'sports'],
  // Ultra-broad / format niches: no meaningful "adjacent" niche — adjacency just surfaces
  // irrelevant peers (stand-up, nail-tech, ASMR) for stunt/variety channels like MrBeast.
  entertainment: [],
  comedy:        [],
  music:         [],
  other:         [],
};

// Niches where foreign (US/UK/AU) topic trends are genuinely relevant to non-English audiences.
// Geo-bound niches (news, politics, sports) are excluded — their topics don't travel.
const UNIVERSAL_NICHES = new Set([
  'technology', 'science', 'finance', 'business', 'education',
  'health', 'fitness', 'philosophy', 'gaming', 'yoga', 'meditation',
  'geopolitics', 'defence',
]);

const FOREIGN_REGIONS = ['US', 'GB', 'AU', 'CA'];

// ── Trend classifier ──────────────────────────────────────────────────────────
// Compares video density across four 90-day time windows to determine
// whether the community is accelerating into this topic or past it.

function classifyTrend(b) {
  const d0 = b.cnt_0_14  / 14;
  const d1 = b.cnt_15_30 / 16;
  const d2 = b.cnt_31_60 / 30;
  const d3 = b.cnt_61_90 / 30;

  // Require current activity to also exceed older coverage — prevents a tiny
  // revival of a months-old event (d1=0 gap, high d2) from appearing "rising".
  if (d0 > 0 && d0 >= d1 * 1.8 && d0 >= d2 * 0.7)       return 'rising';

  const vals = [d0, d1, d2, d3];
  const mean = vals.reduce((s, v) => s + v, 0) / 4;
  if (mean > 0.02 && Math.max(...vals.map(v => Math.abs(v - mean))) / (mean || 1) < 0.6)
    return 'evergreen';

  if (d0 > 0 && d0 >= d1 * 0.5)                          return 'peaking';
  if (d3 > 0 && d0 < d3 * 0.4) {
    // If existing videos on this topic still have fast view velocity (v30 >> v7),
    // the topic is still gaining traction even though fewer new videos appeared.
    if (b.vel_pairs && b.vel_pairs.length >= 2) {
      const avgRatio = b.vel_pairs.reduce((s, p) => s + p.v30 / Math.max(1, p.v7), 0) / b.vel_pairs.length;
      if (avgRatio >= 2) return 'peaking';
    }
    return 'fading';
  }
  return 'dormant';
}

const FORMAT_LABELS = { shorts: 'Shorts', quick: '1–5 min', mid: '8–15 min', long: '15+ min' };

function getFormatWinner(formats, totalVids) {
  if (totalVids < 3) return null;
  let best = null, bestAvg = 0;
  for (const [key, f] of Object.entries(formats)) {
    if (f.count > 0) {
      const avg = f.totalViews / f.count;
      if (avg > bestAvg) { bestAvg = avg; best = key; }
    }
  }
  if (!best) return null;
  return {
    key:       best,
    label:     FORMAT_LABELS[best],
    pct:       Math.round(formats[best].count / totalVids * 100),
    avg_views: Math.round(bestAvg),
  };
}

function getVelocity(pairs) {
  if (pairs.length < 2) return null;
  const avg = pairs.reduce((s, p) => s + p.v30 / p.v7, 0) / pairs.length;
  return {
    status: avg >= 3 ? 'fast' : avg >= 1.5 ? 'growing' : 'peaked',
    ratio:  parseFloat(avg.toFixed(1)),
  };
}

// ── Shared phrase analysis engine ─────────────────────────────────────────────
// Runs the same bigram/trigram extraction + scoring used by /what-to-post,
// but on any caller-supplied set of channel IDs. Callers supply userPhraseSet
// so already-covered topics are filtered out before scoring.

function analyzeTopics(db, channelIds, userPhraseSet, userSubs, communitySize, opts = {}) {
  const { maxResults = 10, minChannels = 2, minScore = 0 } = opts;
  if (!channelIds.length) return [];

  const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const ph    = channelIds.map(() => '?').join(',');

  const videos = db.all(
    `SELECT iv.youtube_video_id, iv.title, iv.views, iv.channel_id,
            iv.published_at, iv.duration_seconds, ic.channel_name
     FROM ingested_videos iv
     LEFT JOIN ingested_channels ic ON ic.channel_id = iv.channel_id
     WHERE iv.channel_id IN (${ph})
       AND iv.published_at >= ?
       AND iv.title IS NOT NULL
       AND iv.views > 0
     ORDER BY iv.views DESC LIMIT 400`,
    [...channelIds, since],
  );
  if (!videos.length) return [];

  const videoIds = videos.map(v => v.youtube_video_id);
  const snapMap  = new Map();
  if (videoIds.length > 0) {
    const vph = videoIds.map(() => '?').join(',');
    db.all(
      `SELECT video_id, bucket, views, subscriber_adjusted_velocity AS sav
       FROM video_growth_snapshots INDEXED BY idx_vgs_video_bucket
       WHERE video_id IN (${vph}) AND bucket IN ('7d', '30d')`,
      videoIds,
    ).forEach(s => {
      if (!snapMap.has(s.video_id)) snapMap.set(s.video_id, {});
      const e = snapMap.get(s.video_id);
      if (s.bucket === '7d')  e.v7  = s.views;
      if (s.bucket === '30d') { e.v30 = s.views; e.sav30 = s.sav; }
    });
  }

  const topicMap = new Map();
  const nowMs    = Date.now();

  for (const video of videos) {
    const phrases     = extractPhrases(video.title);
    const seenThisVid = new Set();
    const ageDays     = (nowMs - new Date(video.published_at).getTime()) / 86400000;
    const dur         = video.duration_seconds || 0;
    const fmtKey      = dur < 60 ? 'shorts' : dur < 300 ? 'quick' : dur < 900 ? 'mid' : 'long';
    const snap        = snapMap.get(video.youtube_video_id);

    for (const phrase of phrases) {
      if (seenThisVid.has(phrase)) continue;
      seenThisVid.add(phrase);
      if (!topicMap.has(phrase)) {
        topicMap.set(phrase, {
          videos: [], totalViews: 0, channels: new Set(),
          cnt_0_14: 0, cnt_15_30: 0, cnt_31_60: 0, cnt_61_90: 0,
          formats: {
            shorts: { count: 0, totalViews: 0 }, quick: { count: 0, totalViews: 0 },
            mid:    { count: 0, totalViews: 0 }, long:  { count: 0, totalViews: 0 },
          },
          vel_pairs: [], sav30_sum: 0, sav30_cnt: 0,
        });
      }
      const b = topicMap.get(phrase);
      if (b.videos.length < 5) b.videos.push(video);
      b.totalViews += (video.views || 0);
      b.channels.add(video.channel_id);
      if (ageDays <= 14)      b.cnt_0_14++;
      else if (ageDays <= 30) b.cnt_15_30++;
      else if (ageDays <= 60) b.cnt_31_60++;
      else                    b.cnt_61_90++;
      b.formats[fmtKey].count++;
      b.formats[fmtKey].totalViews += (video.views || 0);
      if (snap?.v7 && snap?.v30 && snap.v7 > 0) b.vel_pairs.push({ v7: snap.v7, v30: snap.v30 });
      if (snap?.sav30 != null) { b.sav30_sum += snap.sav30; b.sav30_cnt++; }
    }
  }

  const TREND_SCORE = { rising: 20, peaking: 10, evergreen: 8, fading: -15, dormant: -30 };
  const VEL_SCORE   = { fast: 12, growing: 5, peaked: -5 };
  const gaps = [];

  for (const [phrase, b] of topicMap.entries()) {
    if (b.channels.size < minChannels) continue;
    if (b.videos.length < 2)           continue;
    if (userPhraseSet.has(phrase))     continue;

    const avgViews        = b.totalViews / b.videos.length;
    const totalVidCount   = b.cnt_0_14 + b.cnt_15_30 + b.cnt_31_60 + b.cnt_61_90;
    const saturation_pct  = Math.round(b.channels.size / (communitySize || channelIds.length) * 100);
    const saturation_level= saturation_pct < 20 ? 'low' : saturation_pct < 60 ? 'medium' : 'high';
    const trend_status    = classifyTrend(b);
    const format_winner   = getFormatWinner(b.formats, totalVidCount);
    const velocity        = getVelocity(b.vel_pairs);

    let expected_low = null, expected_high = null;
    if (userSubs > 0 && b.sav30_cnt >= 2) {
      const avgSav  = b.sav30_sum / b.sav30_cnt;
      const baseExp = Math.round((userSubs / 1000) * avgSav * 720);
      expected_low  = Math.round(baseExp * 0.6);
      expected_high = Math.round(baseExp * 1.4);
    }

    const base_views  = Math.min(35, Math.log10(avgViews + 1) / 7 * 35);
    const spread      = Math.min(20, b.channels.size / 10 * 20);
    const trend_bonus = TREND_SCORE[trend_status] || 0;
    const vel_bonus   = velocity ? (VEL_SCORE[velocity.status] || 0) : 0;
    const sat_penalty = saturation_pct > 60 ? -(saturation_pct - 60) / 2 : 0;
    const gap_bonus   = saturation_pct < 20 && b.channels.size >= 2 ? 10 : 0;
    const score       = Math.max(1, Math.min(99, Math.round(base_views + spread + trend_bonus + vel_bonus + sat_penalty + gap_bonus)));
    if (score < minScore) continue;   // relevance floor — hide weak/irrelevant adjacent topics

    gaps.push({
      topic:             phrase.replace(/\b\w/g, c => c.toUpperCase()),
      score,
      channel_count:     b.channels.size,
      avg_views:         Math.round(avgViews),
      trend_status,
      saturation_pct,
      saturation_level,
      format_winner,
      velocity,
      act_now:           trend_status === 'rising' && saturation_pct < 30,
      expected_low,
      expected_high,
      examples:          b.videos.slice(0, 3).map(v => ({
        title: v.title, views: v.views, channel_name: v.channel_name || 'Unknown',
      })),
    });
  }

  gaps.sort((a, b) => b.score - a.score);

  const deduped   = [];
  const usedWords = new Set();
  for (const gap of gaps) {
    const words   = gap.topic.toLowerCase().split(' ');
    const overlap = words.filter(w => usedWords.has(w)).length;
    if (overlap >= words.length - 1) continue;
    words.forEach(w => usedWords.add(w));
    deduped.push(gap);
    if (deduped.length >= maxResults) break;
  }
  return deduped;
}

function buildUserPhraseSet(db, channel_id) {
  const set = new Set();
  if (!channel_id) return set;
  db.all(
    `SELECT title FROM ingested_videos WHERE channel_id = ? ORDER BY published_at DESC LIMIT 200`,
    [channel_id],
  ).forEach(v => extractPhrases(v.title).forEach(p => set.add(p)));
  return set;
}

module.exports = {
  EN_REGIONS,
  getRegionClause,
  getStrictRegionClause,
  isIndianRegion,
  isEnglishRegion,
  ADJACENCY_MAP,
  UNIVERSAL_NICHES,
  FOREIGN_REGIONS,
  classifyTrend,
  FORMAT_LABELS,
  getFormatWinner,
  getVelocity,
  analyzeTopics,
  buildUserPhraseSet,
};

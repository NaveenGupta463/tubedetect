'use strict';

const { computeTargetLanes, detectItemLane } = require('./podcastLanes');
const { extractGuestCandidates, isPersonLikeName, looksLikePersonName } = require('./podcastGuestExtract');
const { brandStrings, isCreatorEcho } = require('./podcastBrand');

// ── Podcast guest graph ───────────────────────────────────────────────────────
function computePodcastIntel(db, channelId, communityIds, nowMs, debugMode = false) {
  const RECENCY_MS = 365 * 24 * 60 * 60 * 1000;
  const cutoffDate = new Date(nowMs - RECENCY_MS).toISOString().split('T')[0];
  const peerIds    = communityIds.slice(0, 150);

  const ownTitles = db.all(
    `SELECT title FROM ingested_videos WHERE channel_id = ? AND title IS NOT NULL ORDER BY published_at DESC LIMIT 200`,
    [channelId],
  );
  const ownGuests = new Set();
  const _ownTitleStrings = ownTitles.map(r => r.title);
  for (const title of _ownTitleStrings) {
    const r = extractGuestCandidates(title);
    for (const g of [...r.marker, ...r.fullScan]) ownGuests.add(g.toLowerCase());
  }
  // Brand strings for skipping the creator's own episodes re-posted by clip channels (which sit in the
  // peer pool under different channel_ids) — otherwise the guest they just interviewed is re-surfaced.
  const _selfName = db.get('SELECT channel_name FROM ingested_channels WHERE channel_id = ?', [channelId])?.channel_name;
  const brands = brandStrings(_selfName);
  const targetLanes = computeTargetLanes(_ownTitleStrings);

  if (!peerIds.length) return { guests: [], target_lanes: targetLanes };

  const ph = peerIds.map(() => '?').join(',');
  const peerVideos = db.all(
    `SELECT channel_id, title, views, published_at FROM (
       SELECT channel_id, title, views, published_at,
              ROW_NUMBER() OVER (PARTITION BY channel_id ORDER BY published_at DESC) AS rn
       FROM ingested_videos
       WHERE channel_id IN (${ph}) AND published_at >= ? AND title IS NOT NULL
     ) WHERE rn <= 50`,
    [...peerIds, cutoffDate],
  );

  const debugInfo      = debugMode ? { wordRejected: [], phraseRejected: [], institutionRejected: [] } : null;
  let   totalExtracted = 0;
  let   prevWordRejLen = 0;
  let   prevPhRejLen   = 0;

  const markerMap   = new Map();
  const fullScanMap = new Map();

  const addToMap = (map, guest, channel_id, views, ts, title) => {
    const key = guest.toLowerCase();
    if (ownGuests.has(key)) return;
    if (!map.has(key)) map.set(key, { name: guest, channels: new Set(), total_views: 0, max_video_views: 0, latest_ts: 0, video_count: 0, evidence_titles: [] });
    const e = map.get(key);
    e.channels.add(channel_id);
    e.total_views += views || 0;
    if ((views || 0) > e.max_video_views) e.max_video_views = views || 0;
    if (ts > e.latest_ts) { e.latest_ts = ts; e.name = guest; }
    e.video_count++;
    if (title && e.evidence_titles.length < 5) e.evidence_titles.push(title);
  };

  for (const { channel_id, title, views, published_at } of peerVideos) {
    if (isCreatorEcho(title, brands)) continue; // clip/re-upload of the creator's own episode
    const ts     = published_at ? new Date(published_at).getTime() : 0;
    const result = extractGuestCandidates(title, debugInfo);
    if (debugMode) {
      const newWordRej = debugInfo.wordRejected.length   - prevWordRejLen;
      const newPhRej   = debugInfo.phraseRejected.length - prevPhRejLen;
      totalExtracted  += result.marker.length + result.fullScan.length + newWordRej + newPhRej;
      prevWordRejLen   = debugInfo.wordRejected.length;
      prevPhRejLen     = debugInfo.phraseRejected.length;
    }
    for (const g of result.marker)   addToMap(markerMap,   g, channel_id, views, ts, title);
    for (const g of result.fullScan) addToMap(fullScanMap, g, channel_id, views, ts, title);
  }

  // Median peer video views — baseline for single-peer admission thresholds.
  const sortedViews = peerVideos.map(v => v.views || 0).sort((a, b) => a - b);
  const mid = Math.floor(sortedViews.length / 2);
  const medianViews = sortedViews.length === 0 ? 0
    : sortedViews.length % 2 === 0
      ? (sortedViews[mid - 1] + sortedViews[mid]) / 2
      : sortedViews[mid];
  const singlePeerHighThreshold   = Math.max(25000, medianViews * 1.5);
  const singlePeerVeryHighThreshold = Math.max(100000, medianViews * 3);

  const scored = [];
  let fullScanPromoted          = 0;
  let markerSinglePeerCandidates = 0;
  let markerSinglePeerAdmitted   = 0;
  let markerSinglePeerRejected   = 0;

  const scoreEntry = (e, admissionReason, sourceType) => {
    const daysAgo    = (nowMs - e.latest_ts) / 86400000;
    const recency    = daysAgo < 30 ? 1.5 : daysAgo < 90 ? 1.0 : 0.6;
    const matchedLane = detectItemLane(e.evidence_titles || [], targetLanes);
    const laneBonus  = matchedLane ? 15 : 0;
    const viewsTier  = e.max_video_views > 500000 ? 3 : e.max_video_views > 100000 ? 2 : e.max_video_views > 25000 ? 1 : 0;
    scored.push({
      name:               e.name,
      peer_count:         e.channels.size,
      video_count:        e.video_count,
      total_views:        e.total_views,
      avg_views:          Math.round(e.total_views / Math.max(1, e.video_count)),
      max_video_views:    e.max_video_views,
      last_seen:          e.latest_ts ? new Date(e.latest_ts).toISOString().split('T')[0] : null,
      score:              Math.round(e.channels.size * 30 + Math.log(e.total_views + 1) * recency + laneBonus),
      admission_reason:   admissionReason,
      source_type:        sourceType,
      matched_lane:       matchedLane,
      actionability_score: Math.min(10, (matchedLane ? 4 : 0) + Math.min(3, e.channels.size) + viewsTier),
    });
  };

  for (const [, e] of markerMap) {
    // Non-person entities ("Better Daily Choices", "Real Life Story") slip in as marker
    // candidates — drop them here so widening single-peer admission doesn't readmit junk.
    if (!looksLikePersonName(e.name)) continue;
    if (e.channels.size >= 2) {
      scoreEntry(e, 'multi_peer_marker', 'marker');
    } else if (e.channels.size === 1) {
      markerSinglePeerCandidates++;
      const matchedLane = detectItemLane(e.evidence_titles || [], targetLanes);
      const laneOk = targetLanes.length === 0 || !!matchedLane;
      const veryHighWithoutLane = !matchedLane && e.max_video_views >= singlePeerVeryHighThreshold;
      // Admit a real single-peer person on high views when EITHER it matches a target lane
      // (topically relevant), OR they recur (≥2 videos), OR views are very high. The
      // looksLikePersonName guard above already excludes non-person/series labels.
      if (e.max_video_views >= singlePeerHighThreshold && (laneOk || e.video_count >= 2 || veryHighWithoutLane)) {
        markerSinglePeerAdmitted++;
        scoreEntry(
          e,
          matchedLane
            ? 'single_peer_lane_high_views'
            : veryHighWithoutLane
              ? 'single_peer_very_high_views'
              : 'single_peer_high_views',
          'marker',
        );
      } else {
        markerSinglePeerRejected++;
      }
    }
  }

  for (const [, e] of fullScanMap) {
    if (e.channels.size >= 3 && looksLikePersonName(e.name)) {
      fullScanPromoted++;
      scoreEntry(e, 'multi_peer_full_scan', 'full_scan');
    }
  }

  scored.sort((a, b) => b.score - a.score);

  // Dedup by name — a guest can be captured via BOTH the marker map and the full-scan map
  // (e.g. "Samay Raina" appearing twice). Keep the highest-scored occurrence.
  const _seenGuestNames = new Set();
  const dedupedScored = scored.filter(g => {
    const k = g.name.toLowerCase();
    if (_seenGuestNames.has(k)) return false;
    _seenGuestNames.add(k);
    return true;
  });

  const guestDebug = debugMode ? {
    extracted_count:               totalExtracted,
    rejected_count:                debugInfo.wordRejected.length + debugInfo.phraseRejected.length + debugInfo.institutionRejected.length,
    institution_guest_rejected:    debugInfo.institutionRejected.length,
    rejection_examples:            [...new Set(debugInfo.wordRejected)].slice(0, 5),
    institution_rejection_examples:[...new Set(debugInfo.institutionRejected)].slice(0, 5),
    rejected_by_pattern_examples:  [...new Set(debugInfo.phraseRejected)].slice(0, 5),
    accepted_examples:             scored.slice(0, 5).map(g => g.name),
    marker_accepted_count:         markerMap.size,
    full_scan_accepted_count:      fullScanMap.size,
    full_scan_promoted_count:      fullScanPromoted,
    marker_single_peer_candidates: markerSinglePeerCandidates,
    marker_single_peer_admitted:   markerSinglePeerAdmitted,
    marker_single_peer_rejected:   markerSinglePeerRejected,
    median_peer_video_views:       Math.round(medianViews),
    single_peer_very_high_threshold: Math.round(singlePeerVeryHighThreshold),
  } : undefined;

  return {
    guests:      dedupedScored.slice(0, 30),
    target_lanes: targetLanes,
    ...(guestDebug ? { guest_debug: guestDebug } : {}),
  };
}

// ── Mode-pure podcast peer pool ───────────────────────────────────────────────
// Builds a peer pool restricted to creator_mode='podcast' channels, scored by
// podcast_fingerprint phrase overlap. Used in shadow/opt-in mode only (Phase 3A0/1).
// Falls back to subscriber-count ordering when the target has no fingerprint yet.

// Tokens too generic to be useful similarity signals inside podcast fingerprints.
const PODCAST_TOKEN_STOP = new Set([
  'comment', 'agree', 'point', 'yes', 'valid', 'shorts', 'podcast', 'episode', 'out', 'now',
]);

// Specific-enough tokens that sameNiche + one shared token qualifies for inclusion.
const STRONG_TOPIC_TOKENS = new Set([
  'startup', 'founder', 'investor', 'funding', 'revenue', 'scale', 'pitch', 'venture', 'bootstrap',
  'crypto', 'wealth', 'trading', 'portfolio', 'bitcoin', 'stocks',
  'mindset', 'discipline', 'habit', 'meditation', 'gratitude', 'resilience', 'consistency',
  'nutrition', 'workout', 'fitness', 'muscle', 'yoga', 'marathon',
  'software', 'coding', 'blockchain', 'saas', 'cloud',
  'standup', 'comedy', 'acting', 'cinema',
  'cricket', 'football', 'tennis', 'chess', 'badminton',
  'geopolitics', 'election', 'policy', 'democracy',
]);

// Niche → cluster groupings for fallback relevance gating.
const NICHE_CLUSTER_MAP = new Map([
  ['business',         'business_finance'],
  ['entrepreneurship', 'business_finance'],
  ['finance',          'business_finance'],
  ['investing',        'business_finance'],
  ['investment',       'business_finance'],
  ['stocks',           'business_finance'],
  ['crypto',           'business_finance'],
  ['startups',         'business_finance'],
  ['selfimprovement',  'wellness_growth'],
  ['wellness',         'wellness_growth'],
  ['fitness',          'wellness_growth'],
  ['mental health',    'wellness_growth'],
  ['motivation',       'wellness_growth'],
  ['mindfulness',      'wellness_growth'],
  ['yoga',             'wellness_growth'],
  ['lifestyle',        'wellness_growth'],
  ['technology',       'tech_science'],
  ['tech',             'tech_science'],
  ['science',          'tech_science'],
  ['ai',               'tech_science'],
  ['software',         'tech_science'],
  ['coding',           'tech_science'],
  ['entertainment',    'entertainment_sports'],
  ['film',             'entertainment_sports'],
  ['cinema',           'entertainment_sports'],
  ['music',            'entertainment_sports'],
  ['comedy',           'entertainment_sports'],
  ['bollywood',        'entertainment_sports'],
  ['sports',           'entertainment_sports'],
  ['cricket',          'entertainment_sports'],
  ['football',         'entertainment_sports'],
  ['news',             'news_politics'],
  ['politics',         'news_politics'],
  ['current affairs',  'news_politics'],
  ['geopolitics',      'news_politics'],
  ['education',        'education'],
]);

// Tokens in channel_name or podcast_fingerprint that qualify a cross-niche candidate.
const CLUSTER_QUALIFY_TOKENS = {
  business_finance: new Set([
    'business', 'startup', 'founder', 'entrepreneur', 'investor', 'leadership',
    'funding', 'revenue', 'scale', 'pitch', 'venture', 'bootstrap', 'wealth',
    'trading', 'stocks', 'bitcoin', 'crypto', 'finance', 'investment', 'money',
  ]),
  wellness_growth: new Set([
    'mindset', 'discipline', 'habit', 'meditation', 'gratitude', 'resilience',
    'consistency', 'wellness', 'fitness', 'mental', 'health', 'motivation',
    'mindfulness', 'yoga', 'selfimprovement',
  ]),
  tech_science: new Set([
    'software', 'coding', 'tech', 'technology', 'ai', 'science', 'programming',
    'blockchain', 'saas', 'cloud', 'engineering', 'data', 'computer',
  ]),
};

// Niches treated as "far" from business_finance — excluded from fallback unless
// they carry explicit business-relevant tokens.
const ENTERTAINMENT_SPORTS_NICHES = new Set([
  'entertainment', 'film', 'cinema', 'music', 'comedy', 'bollywood', 'sports',
  'cricket', 'football', 'tennis', 'badminton', 'gaming', 'food', 'travel',
]);

function computePodcastModePeers(db, channelId, { userRegion, limit = 150 } = {}) {
  const ch = db.get(
    `SELECT channel_name, podcast_fingerprint, primary_niche, niche, primary_language FROM ingested_channels WHERE channel_id = ?`,
    [channelId],
  );
  // The creator's own satellite/clip channels have DIFFERENT channel_ids, so `channel_id != own` misses
  // them. Exclude any candidate whose name carries the creator's brand — it's their own mirror.
  const brands = brandStrings(ch?.channel_name);
  const fingerprint    = ch?.podcast_fingerprint || null;
  const targetNiche    = ch?.primary_niche || null;
  const targetRawNiche = ch?.niche || null;
  const targetLang     = ch?.primary_language || null;
  const regionSql      = userRegion ? `AND (region = ? OR region IS NULL)` : '';
  const regionArgs     = userRegion ? [userRegion] : [];

  if (!fingerprint) {
    const ids = db.all(
      `SELECT channel_id, channel_name FROM ingested_channels WHERE creator_mode = 'podcast' AND format_type IN ('podcast','interview') AND channel_id != ? ${regionSql} ORDER BY channel_subscribers DESC LIMIT ?`,
      [channelId, ...regionArgs, limit + 20],
    ).filter(r => !isCreatorEcho(r.channel_name, brands)).slice(0, limit).map(r => r.channel_id);
    return {
      ids,
      fingerprint_used: false,
      top_scored:       [],
      top_fallback:     ids.slice(0, 10),
      debug: { reason: 'no_fingerprint', candidate_count: 0, target_phrase_count: 0, matched_candidate_count: 0, scored_count: 0, fallback_count: ids.length, fallback_used: true, top_similarity: 0, top_matched_terms: [] },
    };
  }

  const targetPhrases  = new Set(fingerprint.split('|').filter(Boolean));
  const targetTokenSet = new Set();
  for (const p of targetPhrases) {
    for (const w of p.split(' ')) {
      if (w.length >= 4 && !PODCAST_TOKEN_STOP.has(w)) targetTokenSet.add(w);
    }
  }

  // Hard-filter: creator_mode=podcast AND format confirmed podcast/interview AND has fingerprint
  const candidates = db.all(
    `SELECT channel_id, channel_name, podcast_fingerprint, primary_niche, primary_language FROM ingested_channels WHERE creator_mode = 'podcast' AND format_type IN ('podcast','interview') AND channel_id != ? ${regionSql} AND podcast_fingerprint IS NOT NULL`,
    [channelId, ...regionArgs],
  );

  const scored = [];
  for (const c of candidates) {
    if (isCreatorEcho(c.channel_name, brands)) continue; // creator's own satellite/clip channel
    const cPhrases   = c.podcast_fingerprint.split('|').filter(Boolean);
    const cPhraseSet = new Set(cPhrases);

    let phraseScore      = 0;
    for (const p of cPhraseSet) if (targetPhrases.has(p)) phraseScore++;

    let tokenScore       = 0;
    let strongTokenCount = 0;
    for (const p of cPhrases) {
      for (const w of p.split(' ')) {
        if (w.length >= 4 && !PODCAST_TOKEN_STOP.has(w) && targetTokenSet.has(w)) {
          tokenScore++;
          if (STRONG_TOPIC_TOKENS.has(w)) strongTokenCount++;
        }
      }
    }

    const sameNiche  = !!(targetNiche && c.primary_niche === targetNiche);
    const nicheBonus = sameNiche ? 2 : 0;
    const langBonus  = (targetLang && c.primary_language === targetLang) ? 1 : 0;

    // sameNiche+1 token only qualifies if that token is strong (not just generic topic word)
    if (!(phraseScore >= 1 || tokenScore >= 2 || (sameNiche && strongTokenCount >= 1))) continue;

    const score = phraseScore * 5 + tokenScore + nicheBonus + langBonus;
    scored.push({ channel_id: c.channel_id, score, phraseScore, tokenScore });
  }
  scored.sort((a, b) => b.score - a.score);

  // Top matched terms: tokens/phrases shared between target and top-5 candidates
  const topCandMap = new Map(scored.slice(0, 5).map(s => [s.channel_id, s]));
  const termFreq   = {};
  for (const c of candidates) {
    if (!topCandMap.has(c.channel_id)) continue;
    for (const p of c.podcast_fingerprint.split('|').filter(Boolean)) {
      if (targetPhrases.has(p)) termFreq[p] = (termFreq[p] || 0) + 2;
      for (const w of p.split(' ')) {
        if (w.length >= 4 && !PODCAST_TOKEN_STOP.has(w) && targetTokenSet.has(w)) {
          termFreq[w] = (termFreq[w] || 0) + 1;
        }
      }
    }
  }
  const topMatchedTerms = Object.entries(termFreq).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([t]) => t);

  // Fallback expansion: relevance-gated — no longer a plain subscriber sort.
  let fallbackIds              = [];
  let fallbackCount            = 0;
  let excludedFallbackCount    = 0;
  const fallbackReasonCounts   = {};
  const excludedFallbackExamples = [];

  if (scored.length < 20) {
    const scoredSet     = new Set(scored.map(s => s.channel_id));
    const targetCluster = NICHE_CLUSTER_MAP.get((targetNiche || '').toLowerCase()) || null;
    const clusterTokens = (targetCluster && CLUSTER_QUALIFY_TOKENS[targetCluster]) || null;
    const isBusinessTarget = targetCluster === 'business_finance';

    const fallbackRows = db.all(
      `SELECT channel_id, channel_name, primary_niche, niche, primary_language, podcast_fingerprint
       FROM ingested_channels
       WHERE creator_mode = 'podcast' AND format_type IN ('podcast','interview')
         AND channel_id != ? ${regionSql}
       ORDER BY channel_subscribers DESC
       LIMIT 500`,
      [channelId, ...regionArgs],
    );

    const hasClusterToken = (channelName, fingerprint, tokens) => {
      if (channelName) {
        const nameWords = channelName.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/);
        if (nameWords.some(w => tokens.has(w))) return true;
      }
      if (fingerprint) {
        for (const phrase of fingerprint.split('|')) {
          for (const w of phrase.split(' ')) {
            if (w.length >= 4 && tokens.has(w.toLowerCase())) return true;
          }
        }
      }
      return false;
    };

    for (const r of fallbackRows) {
      if (scoredSet.has(r.channel_id)) continue;
      if (fallbackIds.length >= limit - scored.length) break;

      const rowNiche    = (r.primary_niche || '').toLowerCase();
      const rowRawNiche = (r.niche         || '').toLowerCase();
      const rowCluster  = NICHE_CLUSTER_MAP.get(rowNiche) || null;

      let reason = null;
      if (targetNiche    && r.primary_niche === targetNiche)    reason = 'same_primary_niche';
      else if (targetRawNiche && r.niche === targetRawNiche)    reason = 'same_raw_niche';
      else if (targetCluster  && rowCluster === targetCluster)  reason = 'same_cluster';
      else if (clusterTokens  && hasClusterToken(r.channel_name, r.podcast_fingerprint, clusterTokens)) reason = 'strong_token';

      if (!reason) {
        excludedFallbackCount++;
        if (excludedFallbackExamples.length < 5) {
          excludedFallbackExamples.push({ id: r.channel_id, name: r.channel_name, niche: r.primary_niche });
        }
        continue;
      }

      // Business creators: entertainment/sports pods must carry explicit business tokens.
      if (isBusinessTarget && ENTERTAINMENT_SPORTS_NICHES.has(rowNiche)) {
        if (!hasClusterToken(r.channel_name, r.podcast_fingerprint, CLUSTER_QUALIFY_TOKENS.business_finance)) {
          excludedFallbackCount++;
          if (excludedFallbackExamples.length < 5) {
            excludedFallbackExamples.push({ id: r.channel_id, name: r.channel_name, niche: r.primary_niche, reason: 'entertainment_no_business_tokens' });
          }
          continue;
        }
      }

      fallbackReasonCounts[reason] = (fallbackReasonCounts[reason] || 0) + 1;
      fallbackIds.push(r.channel_id);
    }

    fallbackCount = fallbackIds.length;
  }

  return {
    ids:              [...scored.slice(0, limit).map(r => r.channel_id), ...fallbackIds],
    fingerprint_used: true,
    top_scored:       scored.slice(0, 20),
    top_fallback:     fallbackIds.slice(0, 10),
    debug: {
      candidate_count:            candidates.length,
      target_phrase_count:        targetPhrases.size,
      matched_candidate_count:    scored.length,
      top_similarity:             scored[0] ? Math.round((scored[0].phraseScore / targetPhrases.size) * 100) / 100 : 0,
      top_matched_terms:          topMatchedTerms,
      scored_count:               scored.length,
      fallback_count:             fallbackCount,
      fallback_used:              fallbackCount > 0,
      fallback_reason_counts:     fallbackReasonCounts,
      excluded_fallback_count:    excludedFallbackCount,
      excluded_fallback_examples: excludedFallbackExamples,
    },
  };
}

module.exports = {
  computePodcastIntel,
  computePodcastModePeers,
  PODCAST_TOKEN_STOP,
  STRONG_TOPIC_TOKENS,
  NICHE_CLUSTER_MAP,
  CLUSTER_QUALIFY_TOKENS,
  ENTERTAINMENT_SPORTS_NICHES,
};

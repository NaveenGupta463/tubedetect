'use strict';

const { extractPhrases, DEVANAGARI_RE, SOUTH_SCRIPT_RE } = require('../lib/phrases');
const PEER_WEIGHTS = require('../config/peerScoreWeights');
const { rerankBySemanticSync, filterBySemanticSync } = require('./channelEmbeddings');
const { getChannelsByTopicOverlap } = require('../db/queries');
const { detectCreatorMode, CREATOR_MODE_VERSION, inferPodcastFormat } = require('../lib/creatorMode');
const { ROUTING_PROFILES, ROUTING_PROFILE_VERSION, computeRoutingProfile, computeRoutingProfileActivation } = require('../lib/routingProfiles');
const { FORMAT_PROFILE_VERSION, computeFormatProfile, computeGuestIntelActivation } = require('../lib/formatProfile');
const { classifyChannel: classifyContentStrategyProfile, upsertCSP, CSP_PROFILE_VERSION } = require('./contentStrategyProfile');
const { classifySubNiche, isKidsContent, SUB_NICHE_RULES } = require('./subNiche');

// ── Niche clusters ─────────────────────────────────────────────────────────────
// Groups of niches that are the same creative space and same audience.
// Peer resolution always combines the full cluster — not just when the pool is thin.
// Different from ADJACENCY_MAP (which is "related but distinct").
// Rule: a creator in any niche of the cluster would naturally make content in the others.
const NICHE_CLUSTERS = {
  // Self-improvement space — all same audience, same content intent
  'selfimprovement':    ['selfimprovement', 'motivation', 'personal development', 'personal growth', 'leadership lessons', 'motivational speaking', 'mindset'],
  'motivation':         ['selfimprovement', 'motivation', 'personal development', 'personal growth', 'leadership lessons', 'motivational speaking', 'mindset'],
  'personal development': ['selfimprovement', 'motivation', 'personal development', 'personal growth', 'leadership lessons', 'motivational speaking', 'mindset'],
  'personal growth':    ['selfimprovement', 'motivation', 'personal development', 'personal growth', 'leadership lessons', 'motivational speaking', 'mindset'],
  'leadership lessons': ['selfimprovement', 'motivation', 'personal development', 'personal growth', 'leadership lessons', 'motivational speaking', 'mindset'],
  'motivational speaking': ['selfimprovement', 'motivation', 'personal development', 'personal growth', 'leadership lessons', 'motivational speaking', 'mindset'],
  'mindset':            ['selfimprovement', 'motivation', 'personal development', 'personal growth', 'leadership lessons', 'motivational speaking', 'mindset'],

  // Finance space — personal finance and investing are the same audience as finance
  'finance':            ['finance', 'personal finance', 'investing', 'stock market', 'cryptocurrency'],
  'personal finance':   ['finance', 'personal finance', 'investing', 'stock market', 'cryptocurrency'],
  'investing':          ['finance', 'personal finance', 'investing', 'stock market', 'cryptocurrency'],
  'stock market':       ['finance', 'personal finance', 'investing', 'stock market', 'cryptocurrency'],
  'cryptocurrency':     ['finance', 'personal finance', 'investing', 'stock market', 'cryptocurrency'],

  // Gym/athletic fitness — strength, muscle, workout performance. Does NOT include
  // yoga or sleep-wellness; those serve different audiences and produce different topics.
  'fitness':            ['fitness', 'workout', 'bodybuilding', 'strength training', 'muscle building', 'calisthenics', 'powerlifting', 'weightlifting', 'home workouts', 'gym workouts', 'gym motivation', 'workout routines', 'bodybuilding workouts', 'bodybuilding tips'],
  'workout':            ['fitness', 'workout', 'bodybuilding', 'strength training', 'home workouts', 'gym workouts', 'workout routines'],
  'bodybuilding':       ['fitness', 'bodybuilding', 'workout', 'strength training', 'muscle building', 'powerlifting'],
  'strength training':  ['fitness', 'workout', 'bodybuilding', 'strength training', 'muscle building'],
  'muscle building':    ['fitness', 'workout', 'bodybuilding', 'strength training', 'muscle building'],

  // Yoga — distinct content space: flexibility, movement, asanas. Separate from gym fitness.
  'yoga':               ['yoga', 'somatic yoga', 'yin yoga', 'vinyasa yoga', 'yoga practice', 'yoga poses', 'yoga routines', 'yoga therapy', 'yoga for weight loss', 'yoga exercises', 'yoga challenges', 'somatic movement', 'somatic healing', 'partner yoga', 'power yoga', 'daily yoga practice', 'pranayama techniques', 'yoga asanas'],

  // Health/wellness — medical, nutrition, general wellbeing. Not gym performance.
  'health':             ['health', 'nutrition', 'wellness', 'holistic health', 'natural remedies', 'ayurvedic medicine', 'health tips', 'healthy habits', 'healthy eating', 'gut health', 'heart health', 'nutrition tips', 'healthy recipes', 'longevity', 'anti-aging', 'men\'s health'],

  // Meditation/mindfulness/sleep — restfulness, inner calm, sleep content.
  'meditation':         ['meditation', 'guided meditation', 'mindfulness', 'mindfulness meditation', 'sleep meditation', 'guided sleep meditation', 'somatic meditation', 'breathwork techniques', 'chakra healing', 'christian meditation', 'emdr music', 'deep sleep', 'insomnia relief'],

  // Business/entrepreneurship — same audience across these
  'business':           ['business', 'entrepreneurship', 'startup'],
  'entrepreneurship':   ['business', 'entrepreneurship', 'startup'],
  'startup':            ['business', 'entrepreneurship', 'startup'],

  // News/current affairs
  'news':               ['news', 'current affairs', 'breaking news'],
  'current affairs':    ['news', 'current affairs', 'breaking news'],

  // Vlog space — all "life content" for the same casual audience
  'lifestyle':          ['lifestyle', 'daily vlogs', 'daily life vlogs', 'personal vlogs', 'vlog'],
  'daily vlogs':        ['lifestyle', 'daily vlogs', 'daily life vlogs', 'personal vlogs', 'vlog'],
  'daily life vlogs':   ['lifestyle', 'daily vlogs', 'daily life vlogs', 'personal vlogs', 'vlog'],
  'personal vlogs':     ['lifestyle', 'daily vlogs', 'daily life vlogs', 'personal vlogs', 'vlog'],
  'vlog':               ['lifestyle', 'daily vlogs', 'daily life vlogs', 'personal vlogs', 'vlog'],

  // Family content
  'family vlogs':       ['family vlogs', 'family life'],
  'family life':        ['family vlogs', 'family life'],

  // Food content
  'food':               ['food', 'street food', 'cooking'],
  'street food':        ['food', 'street food', 'cooking'],
  'cooking':            ['food', 'street food', 'cooking'],

  // Travel
  'travel':             ['travel', 'travel vlogs'],
  'travel vlogs':       ['travel', 'travel vlogs'],

  // Comedy/entertainment
  'comedy':             ['comedy', 'entertainment', 'comedy sketches'],
  'comedy sketches':    ['comedy', 'entertainment', 'comedy sketches'],
  'entertainment':      ['comedy', 'entertainment', 'comedy sketches'],
};

function getNicheCluster(niche, secondaryNiche) {
  const set = new Set();
  const primary = (niche || '').toLowerCase();
  const secondary = (secondaryNiche || '').toLowerCase();
  const cluster = NICHE_CLUSTERS[primary] || [primary];
  cluster.forEach(n => set.add(n));
  if (secondary) {
    const secondCluster = NICHE_CLUSTERS[secondary] || [secondary];
    secondCluster.forEach(n => set.add(n));
  }
  return [...set];
}

// ── Content fingerprint ────────────────────────────────────────────────────────
// A phrase must appear in ≥2 distinct video titles to count — one-off title
// keywords (news of the day, guest names) are noise, not channel identity.
// Computed lazily on first What-to-Post request and stored in DB.

function computeFingerprint(db, channelId) {
  const rows = db.all(
    `SELECT DISTINCT title FROM ingested_videos
     WHERE channel_id = ? AND title IS NOT NULL
     ORDER BY published_at DESC LIMIT 100`,
    [channelId],
  );
  if (rows.length < 5) return null;

  const freq = {};
  for (const { title } of rows) {
    const seen = new Set();
    for (const phrase of extractPhrases(title)) {
      if (!seen.has(phrase)) { freq[phrase] = (freq[phrase] || 0) + 1; seen.add(phrase); }
    }
  }

  const topPhrases = Object.entries(freq)
    .filter(([p, n]) => n >= 2 && p.length >= 6)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 30)
    .map(([p]) => p);

  if (!topPhrases.length) return null;

  const fingerprint = topPhrases.join('|');
  try {
    db.run('UPDATE ingested_channels SET content_fingerprint = ? WHERE channel_id = ?', [fingerprint, channelId]);
  } catch (_) {}
  return fingerprint;
}

// ── Fingerprint confidence scoring ────────────────────────────────────────────
// Returns { score: 0-1, tier: 'exact'|'strong'|'moderate'|'community' }

function computeFingerprintConfidence(db, channelId, fingerprint) {
  const phrases = parseFingerprintPhrases(fingerprint);
  let score = 0;

  if (phrases.length >= 15) score += 0.3;
  else if (phrases.length >= 8) score += 0.15;

  if (phrases.length > 0) {
    const avgLen = phrases.reduce((s, p) => s + p.length, 0) / phrases.length;
    if (avgLen >= 8) score += 0.2;
    else if (avgLen >= 6) score += 0.1;
  }

  const vidCount = db.get(
    'SELECT COUNT(DISTINCT title) AS n FROM ingested_videos WHERE channel_id = ? AND title IS NOT NULL',
    [channelId],
  )?.n || 0;
  if (vidCount >= 50) score += 0.2;
  else if (vidCount >= 20) score += 0.1;

  const recentCount = db.get(
    `SELECT COUNT(*) AS n FROM ingested_videos WHERE channel_id = ? AND published_at > datetime('now', '-30 days')`,
    [channelId],
  )?.n || 0;
  if (recentCount >= 10) score += 0.2;
  else if (recentCount >= 3) score += 0.1;

  // Uniqueness proxy: long fingerprint with long phrases is likely niche-specific
  if (phrases.length >= 20 && phrases.reduce((s, p) => s + p.length, 0) / phrases.length >= 9) score += 0.1;

  const tier = score >= 0.8 ? 'exact' : score >= 0.6 ? 'strong' : score >= 0.4 ? 'moderate' : 'community';
  return { score: parseFloat(score.toFixed(2)), tier };
}

// ── Subscriber soft-weighting ─────────────────────────────────────────────────
// Asymmetric: peers 10-50× larger are still useful (aspirational signal) but
// count less. Peers 300× larger (MrBeast vs 10K creator) barely count.
// Peers <10% of user size are excluded — they don't produce comparable signals.

function computeSubWeight(userSubs, peerSubs) {
  if (!userSubs || userSubs === 0) return 1.0;
  const ratio = peerSubs / userSubs;
  if (ratio > 300) return 0.15;
  if (ratio > 50)  return 0.5;
  if (ratio > 10)  return 0.8;
  if (ratio < 0.1) return 0.0;
  if (ratio < 0.3) return 0.4;
  return 1.0;
}

// ── Multi-dimensional peer scoring helpers ────────────────────────────────────

// Parses either a JSON array (from channel_identity.content_phrases) or a
// pipe-separated string (from ingested_channels.content_fingerprint).
function parseFingerprintPhrases(raw) {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    if (Array.isArray(arr))
      return arr.map(e => (typeof e === 'object' ? (e.phrase || '') : String(e))).filter(Boolean);
  } catch (_) {}
  return raw.split('|').map(s => s.trim()).filter(Boolean);
}

// Computes a multi-dimensional peer score using configurable weights.
// Returns the explanation object — the caller multiplies by subWeight for the
// final sort key.
function computePeerScore(user, peer, userPhrases, peerPhrases, weights) {
  const topicMatch    = (user.niche && peer.niche && user.niche === peer.niche) ? 1 : 0;
  const formatMatch   = (user.format_type && peer.format_type &&
                         user.format_type !== 'other' && peer.format_type !== 'other' &&
                         user.format_type === peer.format_type) ? 1 : 0;
  const styleMatch    = (user.content_archetype && peer.content_archetype &&
                         user.content_archetype === peer.content_archetype) ? 1 : 0;
  const languageMatch = (user.primary_language && peer.primary_language &&
                         user.primary_language === peer.primary_language) ? 1 : 0;

  const setA = new Set(userPhrases);
  const setB = new Set(peerPhrases);
  let shared = 0;
  for (const p of setA) if (setB.has(p)) shared++;
  const union = setA.size + setB.size - shared;
  const phraseSim = union > 0 ? shared / union : 0;

  const score =
    weights.topic    * topicMatch    +
    weights.format   * formatMatch   +
    weights.style    * styleMatch    +
    weights.language * languageMatch +
    weights.phrase   * phraseSim;

  return {
    topic_match:       topicMatch,
    format_match:      formatMatch,
    style_match:       styleMatch,
    language_match:    languageMatch,
    phrase_similarity: parseFloat(phraseSim.toFixed(4)),
    score:             parseFloat(score.toFixed(4)),
  };
}

function buildPeersByContent(db, channelId, { limit = 300, userSubs = 0, debug = false } = {}) {
  const _empty = debug ? { channelIds: [], peerBreakdown: [], routing_mode: 'none' } : [];

  // Prefer IDF-weighted identity phrases when available; fall back to raw fingerprint
  let fingerprint = null;
  const ciRow = db.get(
    `SELECT content_phrases, confidence_tier FROM channel_identity WHERE channel_id = ?`,
    [channelId],
  );
  if (ciRow?.content_phrases && ciRow.confidence_tier !== 'none') {
    fingerprint = ciRow.content_phrases;
  } else {
    const fpRow = db.get('SELECT content_fingerprint FROM ingested_channels WHERE channel_id = ?', [channelId]);
    fingerprint = fpRow?.content_fingerprint || computeFingerprint(db, channelId);
  }
  if (!fingerprint) return _empty;

  const conf       = computeFingerprintConfidence(db, channelId, fingerprint);
  const minOverlap = conf.tier === 'exact' ? 5 : conf.tier === 'strong' ? 3 : 2;

  // Use parseFingerprintPhrases so JSON content_phrases (from channel_identity)
  // and pipe-separated content_fingerprint are both handled correctly.
  const userPhrases = parseFingerprintPhrases(fingerprint).slice(0, 15);
  if (!userPhrases.length) return _empty;

  // User's classification metadata — one query replaces the old userNicheRow fetch
  const userMeta = db.get(
    `SELECT COALESCE(primary_niche, niche) AS niche, format_type, content_archetype, primary_language
     FROM ingested_channels WHERE channel_id = ?`,
    [channelId],
  ) || {};

  // When the user has AI classification (format + archetype), use multi-dimensional
  // routing. Otherwise fall back to the legacy phrase-overlap + niche purity gate.
  const hasMultiDim = !!(userMeta.format_type && userMeta.content_archetype);

  const cond = userPhrases.map(() => `content_fingerprint LIKE ?`).join(' OR ');
  // Hard language gate: same-language + null only. Phrase-overlap alone admits
  // cross-language peers (romanized/generic tokens like "vlog"/"comedy" match across
  // languages), flooding e.g. Tamil channels with hi/en peers — language used to be only
  // a soft score signal here, not a filter. Region-free: language now ~83% populated.
  const mainLangClause = userMeta.primary_language ? `AND (primary_language = ? OR primary_language IS NULL)` : '';
  let rows = db.all(
    `SELECT channel_id, channel_name, content_fingerprint,
            COALESCE(primary_niche, niche) AS niche, channel_subscribers,
            format_type, content_archetype, primary_language
     FROM ingested_channels
     WHERE content_fingerprint IS NOT NULL AND (${cond}) ${mainLangClause} AND channel_id != ? AND ingest_enabled = 1`,
    [...userPhrases.map(p => `%${p}%`), ...(userMeta.primary_language ? [userMeta.primary_language] : []), channelId],
  );

  // Format fallback: when phrase pre-filter finds nothing and confidence is low/none,
  // route by format_type + content_archetype + language (no phrase requirement).
  let routingMode       = hasMultiDim ? 'multi_dim' : 'legacy';
  let peerFailureReason = null;

  if (!rows.length) {
    const confTier = ciRow?.confidence_tier || 'none';
    if ((confTier === 'low' || confTier === 'none') && userMeta.format_type && userMeta.content_archetype) {
      const langClause  = userMeta.primary_language ? `AND primary_language = ?` : '';
      const fallbackParams = [
        userMeta.format_type,
        userMeta.content_archetype,
        ...(userMeta.primary_language ? [userMeta.primary_language] : []),
        channelId,
        limit * 2,
      ];
      rows = db.all(
        `SELECT channel_id, channel_name, content_fingerprint,
                COALESCE(primary_niche, niche) AS niche, channel_subscribers,
                format_type, content_archetype, primary_language
         FROM ingested_channels
         WHERE format_type = ? AND content_archetype = ? ${langClause}
           AND channel_id != ? AND ingest_enabled = 1
         LIMIT ?`,
        fallbackParams,
      );
      routingMode       = 'format_fallback';
      peerFailureReason = ciRow?.brand_contamination_pct > 0.5
        ? 'brand_contamination'
        : 'zero_phrase_peers';
    } else {
      peerFailureReason = ciRow?.brand_contamination_pct > 0.5
        ? 'brand_contamination'
        : 'zero_phrase_peers';
      return _empty;
    }
    if (!rows.length) {
      if (debug) {
        return {
          channelIds: [], peerBreakdown: [], routing_mode: routingMode,
          peer_failure_reason: peerFailureReason,
          user_classification: {
            niche:             userMeta.niche             || null,
            format_type:       userMeta.format_type       || null,
            content_archetype: userMeta.content_archetype || null,
            primary_language:  userMeta.primary_language  || null,
          },
          weights: hasMultiDim ? PEER_WEIGHTS : null,
        };
      }
      return [];
    }
  }

  const isFormatFallback = routingMode === 'format_fallback';

  const scored = [];
  for (const r of rows) {
    const peerPhrases = parseFingerprintPhrases(r.content_fingerprint);

    // In format_fallback mode there is no phrase pre-filter, so skip the overlap gate.
    if (!isFormatFallback) {
      const overlap = userPhrases.filter(p => peerPhrases.includes(p)).length;
      if (overlap < minOverlap) continue;
    }

    const subWeight = computeSubWeight(userSubs, r.channel_subscribers || 0);
    if (subWeight === 0) continue;

    let finalScore, breakdown;

    if (hasMultiDim || isFormatFallback) {
      // Format fallback uses empty phrase arrays so phrase_similarity = 0;
      // score reflects format/style/language/topic dimensions only.
      const uPhrases = isFormatFallback ? [] : userPhrases;
      const pPhrases = isFormatFallback ? [] : peerPhrases;
      breakdown  = computePeerScore(userMeta, r, uPhrases, pPhrases, PEER_WEIGHTS);
      finalScore = breakdown.score * subWeight;
    } else {
      const overlap   = userPhrases.filter(p => peerPhrases.includes(p)).length;
      const pureScore = overlap / userPhrases.length;
      if (userMeta.niche && r.niche && r.niche !== userMeta.niche && pureScore < 0.4) continue;
      finalScore = overlap * subWeight;
      breakdown  = null;
    }

    scored.push({ channel_id: r.channel_id, channel_name: r.channel_name, score: finalScore, breakdown });
  }

  const sorted = scored.sort((a, b) => b.score - a.score).slice(0, limit);

  if (debug) {
    return {
      channelIds:    sorted.map(r => r.channel_id),
      routing_mode:  routingMode,
      peer_failure_reason: peerFailureReason,
      weights:       (hasMultiDim || isFormatFallback) ? PEER_WEIGHTS : null,
      user_classification: {
        niche:             userMeta.niche             || null,
        format_type:       userMeta.format_type       || null,
        content_archetype: userMeta.content_archetype || null,
        primary_language:  userMeta.primary_language  || null,
      },
      peerBreakdown: sorted.slice(0, 20).map(r => ({
        channel_id:   r.channel_id,
        channel_name: r.channel_name || null,
        final_score:  parseFloat(r.score.toFixed(4)),
        ...(r.breakdown || {
          topic_match: null, format_match: null, style_match: null,
          language_match: null, phrase_similarity: null, score: null,
        }),
      })),
    };
  }

  return sorted.map(r => r.channel_id);
}

// ── Niche → recommendation category ──────────────────────────────────────────
//   A = Topic Gap    — topic itself is safe to suggest (public knowledge)
//   B = Style Signal — creative IP; suggest format/emotion, not specific topics
//   C = Context Gap  — destination/occasion is generic; creator's angle is theirs

const NICHE_CATEGORY = {
  technology: 'A', business: 'A', education: 'A', science: 'A',
  finance: 'A',    news: 'A',     politics: 'A',  sports: 'A',
  health: 'A',     fitness: 'A',  philosophy: 'A', other: 'A',
  geopolitics: 'A', defence: 'A', selfimprovement: 'A',
  food: 'C',       travel: 'C',   lifestyle: 'C', beauty: 'C',
  yoga: 'C',       meditation: 'C', gaming: 'C',  entertainment: 'C',
  comedy: 'B',     music: 'B',
};

// Archetypes that override niche and force Category A regardless
const ARCHETYPE_FORCE_A = new Set([
  'authority_educator', 'analyst', 'commentator',
  'debater', 'investigative_creator', 'reviewer',
]);

// Behavior tags that hard-signal creative IP → Category B
const BEHAVIOR_FORCE_B = new Set([
  'music_video', 'audio_release', 'lyric_video',
  'performance', 'sketch', 'character_driven',
]);

// Behavior tags that hard-signal public knowledge → Category A
const BEHAVIOR_FORCE_A = new Set([
  'analytical', 'educational', 'comparison', 'review_based',
  'case_study', 'deep_dive', 'explainer', 'news_reaction', 'commentary',
]);

function getNicheCategory(niche, archetype, behaviorTags) {
  const tags = Array.isArray(behaviorTags) ? behaviorTags : [];
  if (ARCHETYPE_FORCE_A.has(archetype))           return 'A';
  if (archetype === 'entertainer')                return 'B';
  if (tags.some(t => BEHAVIOR_FORCE_B.has(t)))   return 'B';
  if (tags.some(t => BEHAVIOR_FORCE_A.has(t)))   return 'A';
  return NICHE_CATEGORY[niche] || 'A';
}

// ── Region-aware filtering ─────────────────────────────────────────────────────
// Channels with confirmed region='IN' are excluded from English/Western creator pools
// and vice-versa. Channels with NULL region are included in both pools (ambiguous).

const _EN_REGIONS = new Set(['EN', 'US', 'GB', 'AU', 'CA', 'NZ', 'IE']);

function getRegionClause(userRegion) {
  if (userRegion === 'IN') return "AND (region = 'IN' OR region IS NULL)";
  if (userRegion && _EN_REGIONS.has(userRegion))
    return "AND (region IN ('EN','US','GB','AU','CA','NZ','IE') OR region IS NULL)";
  return ''; // unknown region → no filter
}

// ── Peer resolution ladder ────────────────────────────────────────────────────
// Used by both /community-hot and /what-to-post.
// Three levels — topic, shared-topics, niche cluster. Archetype/format (style)
// is intentionally excluded: it matches content style, not content space, and
// pulls in vloggers/entertainers who share a format but not an audience.
function resolvePeers(db, channel, { exclude_channel_id, minSize = 20, limit = 200 } = {}) {
  const results = [];

  // Compute cluster using PRIMARY niche only — never secondary_niche.
  // secondary_niche is hobby content (BeerBiceps covers fitness) but his AUDIENCE
  // follows him for selfimprovement. Including secondary would merge the entire
  // fitness cluster into his peer pool, pulling in Chloe Ting, ATHLEAN-X, etc.
  const primaryNiche = channel.primary_niche || channel.niche;
  const clusterNiches = NICHE_CLUSTERS[primaryNiche] || [primaryNiche];

  // Level 1: same primary inferred topic — most precise signal
  let topics = [];
  try { topics = JSON.parse(channel.inferred_topics || '[]'); } catch (_) {}
  const primaryTopic = topics[0] || null;
  if (primaryTopic) {
    const rows = db.all(
      `SELECT channel_id FROM ingested_channels
       WHERE json_extract(inferred_topics, '$[0]') = ?
         AND channel_id != ? AND ingest_enabled = 1 LIMIT ?`,
      [primaryTopic, exclude_channel_id, limit],
    );
    for (const r of rows) if (!results.includes(r.channel_id)) results.push(r.channel_id);
  }
  if (results.length >= minSize) return results;

  // Level 2: shared inferred_topic, constrained to same niche cluster.
  // Without the niche constraint, a hobby topic like 'fitness' would pull pure
  // workout channels into a selfimprovement creator's peer pool.
  if (topics.length > 0 && clusterNiches.length > 0) {
    const phTopics  = topics.map(() => '?').join(',');
    const phNiches  = clusterNiches.map(() => '?').join(',');
    const rows = db.all(
      `SELECT DISTINCT ic.channel_id
       FROM ingested_channels ic, json_each(ic.inferred_topics) jt
       WHERE jt.value IN (${phTopics})
         AND (ic.primary_niche IN (${phNiches}) OR ic.niche IN (${phNiches}))
         AND ic.channel_id != ? AND ic.ingest_enabled = 1
       LIMIT ?`,
      [...topics, ...clusterNiches, ...clusterNiches, exclude_channel_id, limit],
    );
    for (const r of rows) if (!results.includes(r.channel_id)) results.push(r.channel_id);
  }

  // Level 3: full niche cluster — always runs regardless of pool size.
  // Uses NICHE_CLUSTERS so that 'selfimprovement' + 'motivation' + 'personal development'
  // are always one pool. Matches on both niche and primary_niche columns.
  if (clusterNiches.length > 0) {
    const ph = clusterNiches.map(() => '?').join(',');
    const rows = db.all(
      `SELECT channel_id FROM ingested_channels
       WHERE (niche IN (${ph}) OR primary_niche IN (${ph}))
         AND channel_id != ? AND ingest_enabled = 1 LIMIT ?`,
      [...clusterNiches, ...clusterNiches, exclude_channel_id, limit],
    );
    for (const r of rows) if (!results.includes(r.channel_id)) results.push(r.channel_id);
  }

  // If the target channel is IN, exclude channels explicitly tagged as Western/EN.
  const targetRegion = channel.region || null;
  if (targetRegion === 'IN' && results.length > 0) {
    const ph = results.map(() => '?').join(',');
    const excluded = new Set(
      db.all(
        `SELECT channel_id FROM ingested_channels WHERE channel_id IN (${ph}) AND region = 'EN'`,
        results,
      ).map(r => r.channel_id),
    );
    if (excluded.size > 0) results.splice(0, results.length, ...results.filter(id => !excluded.has(id)));
  }

  // For English creators: drop ALL non-English channels including Hindi.
  const targetLang = channel.primary_language || null;
  if (targetLang === 'en' && results.length > 0) {
    const ph = results.map(() => '?').join(',');
    const excluded = new Set(
      db.all(
        `SELECT channel_id FROM ingested_channels
         WHERE channel_id IN (${ph})
           AND primary_language IS NOT NULL AND primary_language != 'en'`,
        results,
      ).map(r => r.channel_id),
    );
    if (excluded.size > 0) results.splice(0, results.length, ...results.filter(id => !excluded.has(id)));
  }

  return results.slice(0, limit);
}

// ── Routing profile peer resolver ─────────────────────────────────────────────
// Queries the whole DB for channels whose titles match the target's routing
// profile. Returns {same, adjacent, broadFallback, debug}. Called before the
// broad niche-based fallback so the peer pool is shaped by content sub-niche,
// not by primary_niche taxonomy.

// Modes that must never use the routing_profile resolver (wrong content domain).
const RESOLVER_BLOCKED_MODES = new Set(['podcast', 'news', 'upsc', 'finance', 'tech']);

// Niches where routing_profile sub-classification is meaningful.
// Channels outside this set route via buildPeersByContent / community_id fallback.
const RESOLVER_ELIGIBLE_NICHES = new Set([
  'yoga', 'wellness', 'meditation', 'spirituality', 'mindfulness', 'fitness', 'health',
  'lifestyle', 'philosophy', 'healing', 'selfimprovement', 'personal development',
  'personal growth', 'motivation', 'manifestation',
]);

// Maps each routing profile to the DB niche values worth querying as candidates.
// New Phase-1A profiles (business_finance, tech_ai, etc.) are included here for
// future resolver activation. The resolver does NOT currently run for them —
// blocked by RESOLVER_BLOCKED_MODES / RESOLVER_ELIGIBLE_NICHES.
const PROFILE_NICHE_GROUPS = {
  // Wellness / Transformation
  physical_yoga:          ['yoga', 'fitness', 'wellness', 'health'],
  meditation_spirituality:['meditation', 'spirituality', 'mindfulness', 'philosophy',
                            'selfimprovement', 'wellness', 'yoga', 'healing',
                            'personal development', 'personal growth'],
  pain_relief_therapy:    ['yoga', 'health', 'wellness', 'fitness'],
  fitness_flexibility:    ['fitness', 'health', 'wellness', 'yoga', 'sports', 'nutrition'],
  fitness_transformation: ['fitness', 'health', 'wellness', 'nutrition', 'sports'],
  manifestation_healing:  ['selfimprovement', 'wellness', 'mindfulness', 'spirituality',
                            'meditation', 'philosophy', 'healing', 'yoga',
                            'personal development', 'personal growth', 'motivation'],
  relationship_selfwork:  ['selfimprovement', 'lifestyle', 'personal development',
                            'wellness', 'motivation', 'personal growth'],
  general_selfimprovement:['selfimprovement', 'motivation', 'mindset',
                            'personal development', 'personal growth',
                            'leadership lessons', 'wellness'],
  // Business / Entrepreneurship
  business_finance:       ['finance', 'business', 'economics', 'investment',
                            'personal finance', 'entrepreneur', 'money'],
  startup_founder:        ['startup', 'entrepreneur', 'business', 'tech', 'technology'],
  // Technology
  tech_ai:                ['technology', 'tech', 'programming', 'ai',
                            'software', 'computer science'],
  // News / Civic
  politics_news:          ['news', 'politics', 'current affairs', 'journalism'],
  upsc_exam:              ['education', 'upsc', 'exam', 'competitive exams'],
};

function resolvePeersByRoutingProfile(db, channelId, profileResult, {
  userRegion      = null,
  primaryLanguage = null,
  limit           = 250,
} = {}) {
  const { profile } = profileResult;
  const profileDef  = ROUTING_PROFILES[profile];
  const adjacentSet = new Set(profileDef.adjacent_profiles);

  // Collect all niches for this profile + adjacent profiles
  const myNiches  = PROFILE_NICHE_GROUPS[profile] || [];
  const adjNiches = [];
  for (const adjP of profileDef.adjacent_profiles) {
    for (const n of (PROFILE_NICHE_GROUPS[adjP] || [])) adjNiches.push(n);
  }
  const allNiches = [...new Set([...myNiches, ...adjNiches])];
  if (allNiches.length === 0) return { same: [], adjacent: [], broadFallback: [], debug: { candidates_queried: 0 } };

  const nichePh = allNiches.map(() => '?').join(',');
  let langFilter = '';
  const langParams = [];

  // Same-language pool (+ null = ambiguous slice). Filtering by the user's exact
  // language excludes OTHER known languages, so e.g. a Tamil channel is no longer
  // flooded with Hindi/English peers (which the old region filter admitted). Region
  // is used only when language is unknown. primary_language now ~83% populated.
  if (primaryLanguage) {
    langFilter = `AND (primary_language = ? OR primary_language IS NULL)`;
    langParams.push(primaryLanguage);
  } else if (userRegion) {
    langFilter = `AND (region = ? OR region IS NULL)`;
    langParams.push(userRegion);
  }

  const candidates = db.all(
    `SELECT channel_id FROM ingested_channels
     WHERE (niche IN (${nichePh}) OR primary_niche IN (${nichePh}))
       AND channel_id != ? AND ingest_enabled = 1
       ${langFilter}
     ORDER BY channel_subscribers DESC
     LIMIT ?`,
    [...allNiches, ...allNiches, channelId, ...langParams, 500],
  ).map(r => r.channel_id);

  if (candidates.length === 0) {
    return { same: [], adjacent: [], broadFallback: [], debug: { candidates_queried: 0 } };
  }

  // Fetch 15 titles per candidate to score their profile
  const cph = candidates.map(() => '?').join(',');
  const titleRows = db.all(
    `SELECT channel_id, title FROM (
       SELECT channel_id, title,
              ROW_NUMBER() OVER (PARTITION BY channel_id ORDER BY published_at DESC) AS rn
       FROM ingested_videos
       WHERE channel_id IN (${cph}) AND title IS NOT NULL
     ) WHERE rn <= 15`,
    candidates,
  );

  const titleMap = new Map();
  for (const { channel_id: cid, title } of titleRows) {
    if (!titleMap.has(cid)) titleMap.set(cid, []);
    titleMap.get(cid).push(title);
  }

  const same         = [];
  const adjacent     = [];
  const broadFallback = [];
  const admittedCounts = {};
  const rejectedCounts = {};

  for (const cid of candidates) {
    const pTitles = titleMap.get(cid) || [];
    if (pTitles.length < 3) {
      broadFallback.push(cid);
      continue;
    }
    const pResult = computeRoutingProfile(pTitles);
    const pName   = pResult.profile || '_unclassified';

    if (pName === profile) {
      same.push(cid);
      admittedCounts[pName] = (admittedCounts[pName] || 0) + 1;
    } else if (pResult.profile && adjacentSet.has(pResult.profile)) {
      adjacent.push(cid);
      admittedCounts[pName] = (admittedCounts[pName] || 0) + 1;
    } else {
      broadFallback.push(cid);
      rejectedCounts[pName] = (rejectedCounts[pName] || 0) + 1;
    }
  }

  const cappedAdjacent = adjacent.slice(0, Math.max(50, same.length * 5));

  return {
    same,
    adjacent: cappedAdjacent,
    broadFallback,
    debug: {
      candidates_queried:    candidates.length,
      same_count:            same.length,
      adjacent_count:        cappedAdjacent.length,
      adjacent_uncapped:     adjacent.length,
      broad_fallback_count:  broadFallback.length,
      admitted_counts:       admittedCounts,
      rejected_counts:       rejectedCounts,
    },
  };
}

// ── CSP peer quality gate ─────────────────────────────────────────────────────
// Channels whose niche is in this set are never admitted to finance/business/
// podcast CSP peer pools regardless of creator_mode or routing_profile.
// These niches produce content that does not overlap with finance/business/
// selfimprovement topic spaces even when the classifier assigned them there
// via podcast routing (e.g. food vlogger with creator_mode=podcast gets
// assigned to founder_economy_conversation via the business_finance routing block).
const _CSP_HARD_BLOCK_NICHES = new Set([
  'entertainment', 'comedy', 'comedy sketches', 'gaming', 'music', 'kids',
  'beauty', 'fashion', 'lifestyle', 'daily vlogs', 'daily life vlogs', 'vlog',
  'personal vlogs', 'family vlogs', 'family life', 'food', 'cooking',
  'street food', 'travel', 'travel vlogs', 'yoga', 'meditation', 'health',
  'wellness', 'fitness', 'workout', 'bodybuilding', 'strength training',
  'muscle building', 'sports',
]);

// Per-CSP admission rules. Only the 5 finance/business/podcast CSPs need these;
// other CSPs use the existing medium/high confidence gate unchanged.
// positive_niches: auto-admit regardless of other signals.
// positive_modes/rps/fmts: each match adds +1 to score; neutral-niche channels
//   need score >= 2 (base 1 + at least 1 positive signal) to be admitted.
const _CSP_COMPAT = {
  founder_economy_conversation: {
    positive_niches: new Set(['finance', 'personal finance', 'investing', 'investment',
      'stock market', 'cryptocurrency', 'economics', 'business', 'entrepreneurship',
      'startup', 'technology', 'tech']),
    positive_modes:  new Set(['finance']),
    positive_rps:    new Set(['business_finance', 'startup_founder']),
    positive_fmts:   new Set(['essay', 'documentary', 'podcast', 'interview']),
  },
  finance_investment_education: {
    positive_niches: new Set(['finance', 'personal finance', 'investing', 'investment',
      'stock market', 'cryptocurrency', 'economics']),
    positive_modes:  new Set(['finance']),
    positive_rps:    new Set(['business_finance']),
    positive_fmts:   new Set(['tutorial', 'essay', 'documentary']),
  },
  business_case_study: {
    positive_niches: new Set(['finance', 'business', 'economics', 'entrepreneurship',
      'startup', 'technology', 'tech', 'personal finance', 'investing', 'investment']),
    positive_modes:  new Set(['finance']),
    positive_rps:    new Set(['business_finance', 'startup_founder', 'tech_ai']),
    positive_fmts:   new Set(['essay', 'documentary']),
    positive_format_profiles: new Set(['essay', 'documentary']),
  },
  curiosity_explainer: {
    positive_niches: new Set(['business', 'finance', 'economics', 'technology',
      'tech', 'science', 'education', 'news', 'politics', 'geopolitics',
      'defence', 'defense', 'health', 'other', 'social issues', 'history',
      'environment']),
    positive_modes:  new Set(['general', 'finance', 'tech', 'news']),
    positive_rps:    new Set(['business_finance', 'startup_founder', 'tech_ai', 'politics_news']),
    positive_fmts:   new Set(['essay', 'documentary', 'unknown', 'other']),
    positive_format_profiles: new Set(['curiosity_explainer', 'essay', 'documentary']),
  },
  indian_business_selfimprovement_podcast: {
    positive_niches: new Set(['business', 'entrepreneurship', 'startup', 'finance',
      'selfimprovement', 'motivation', 'personal development', 'personal growth',
      'mindset', 'leadership lessons', 'motivational speaking', 'productivity']),
    positive_modes:  new Set(['finance', 'self_improvement']),
    positive_rps:    new Set(['general_selfimprovement', 'business_finance', 'startup_founder']),
    positive_fmts:   new Set(['podcast', 'interview', 'essay']),
    positive_format_profiles: new Set(['guest_interview', 'podcast_like_longform', 'essay']),
  },
  personal_finance_guest_show: {
    positive_niches: new Set(['finance', 'personal finance', 'investing', 'investment',
      'stock market', 'cryptocurrency', 'economics', 'business']),
    positive_modes:  new Set(['finance']),
    positive_rps:    new Set(['business_finance', 'startup_founder']),
    positive_fmts:   new Set(['podcast', 'interview']),
    positive_format_profiles: new Set(['guest_interview', 'podcast_like_longform']),
  },
};

const _CSP_EXPANSION = {
  founder_economy_conversation: [
    'business_case_study',
    'finance_investment_education',
    'indian_business_selfimprovement_podcast',
    'personal_finance_guest_show',
  ],
  business_case_study: [
    'founder_economy_conversation',
    'indian_business_selfimprovement_podcast',
  ],
};

const _CURIOSITY_MACRO_NICHES = new Set([
  'business', 'finance', 'economics', 'news', 'politics', 'geopolitics',
  'defence', 'defense', 'education', 'history', 'environment', 'other',
  'social issues',
]);

const _CURIOSITY_SCIENCE_NICHES = new Set(['science', 'health']);
const _CURIOSITY_TECH_NICHES = new Set(['technology', 'tech']);

function _curiosityPeerFamily(row = {}) {
  const niche = String(row.niche || row.primary_niche || '').toLowerCase();
  const detail = String(row.niche_detail || row.raw_niche || row.secondary_niche || '').toLowerCase();
  const routing = String(row.routing_profile || '').toLowerCase();
  const formatType = String(row.format_type || '').toLowerCase();

  if (
    _CURIOSITY_TECH_NICHES.has(niche) ||
    formatType === 'review' ||
    /\b(smartphone|gadget|consumer electronics|automotive reviews?|phone reviews?)\b/i.test(detail)
  ) {
    return 'tech_review';
  }
  if (_CURIOSITY_SCIENCE_NICHES.has(niche)) return 'science_health';
  if (_CURIOSITY_MACRO_NICHES.has(niche) || routing === 'politics_news') return 'macro_system';
  return 'general';
}

function _curiosityPeerAllowed(targetFamily, candidateFamily) {
  if (targetFamily === 'tech_review') return candidateFamily === 'tech_review';
  if (targetFamily === 'science_health') return candidateFamily === 'science_health';
  if (targetFamily === 'macro_system') return candidateFamily === 'macro_system';
  return candidateFamily === 'general' || candidateFamily === 'macro_system';
}

// ── CSP peer resolver ─────────────────────────────────────────────────────────
// Selects peers sharing the same Content Strategy Profile (primary_csp).
// Activates when the routing-profile resolver did not fire and the channel has a
// medium/high-confidence CSP. Effective for creator_mode=finance/podcast/news/tech
// channels where the routing-profile resolver is intentionally blocked.
function resolvePeersByCSP(db, channelId, cspRow, {
  userRegion      = null,
  primaryLanguage = null,
  limit           = 300,
  debug           = false,
  targetRow       = null,
} = {}) {
  const eligible =
    cspRow.confidence === 'high' ||
    cspRow.confidence === 'medium';
  if (!eligible) {
    return { peerIds: [], csp_peer_count: 0, csp_primary: cspRow.primary_csp, csp_confidence: cspRow.confidence };
  }

  let langFilter = '';
  const langParams = [];
  // Same-language pool (+ null). Exact-language filter excludes other known languages
  // (e.g. a Telugu channel no longer pulls the same region=IN hi/en pool a Hindi
  // channel does); region only when language is unknown. See resolvePeersByRoutingProfile.
  if (primaryLanguage) {
    langFilter = `AND (ic.primary_language = ? OR ic.primary_language IS NULL)`;
    langParams.push(primaryLanguage);
  } else if (userRegion) {
    langFilter = `AND (ic.region = ? OR ic.region IS NULL)`;
    langParams.push(userRegion);
  }

  const compat = _CSP_COMPAT[cspRow.primary_csp];
  const cspList = [cspRow.primary_csp, ...(_CSP_EXPANSION[cspRow.primary_csp] || [])];

  if (!compat) {
    // No specific rules for this CSP — use the existing medium/high gate unchanged.
    const rows = db.all(
      `SELECT ccsp.channel_id
       FROM channel_content_strategy_profiles ccsp
       JOIN ingested_channels ic ON ic.channel_id = ccsp.channel_id
       WHERE ccsp.primary_csp = ?
         AND ccsp.channel_id != ?
         AND ccsp.confidence IN ('medium', 'high')
         AND ic.ingest_enabled = 1
         ${langFilter}
       ORDER BY ic.channel_subscribers DESC
       LIMIT ?`,
      [cspRow.primary_csp, channelId, ...langParams, limit],
    );
    return {
      peerIds:        rows.map(r => r.channel_id),
      csp_peer_count: rows.length,
      csp_primary:    cspRow.primary_csp,
      csp_confidence: cspRow.confidence,
    };
  }

  // For CSPs with explicit rules: load candidates with full metadata so we can
  // apply the niche-block gate and score by compatibility.
  // Fetch 2× limit to leave headroom after filtering.
  const cspPh = cspList.map(() => '?').join(',');
  const candidates = db.all(
    `SELECT ccsp.channel_id,
            ccsp.primary_csp AS candidate_csp,
            ic.channel_subscribers,
            ic.channel_name,
            LOWER(COALESCE(ic.primary_niche, ic.niche, '')) AS niche,
            LOWER(COALESCE(ic.niche, ''))                   AS niche_detail,
            LOWER(COALESCE(ic.creator_mode, ''))            AS creator_mode,
            LOWER(COALESCE(ic.routing_profile, ''))         AS routing_profile,
            LOWER(COALESCE(ic.format_type, ''))             AS format_type,
            LOWER(COALESCE(ic.format_profile, ''))          AS format_profile
     FROM channel_content_strategy_profiles ccsp
     JOIN ingested_channels ic ON ic.channel_id = ccsp.channel_id
     WHERE ccsp.primary_csp IN (${cspPh})
       AND ccsp.channel_id != ?
       AND ccsp.confidence IN ('medium', 'high')
       AND ic.ingest_enabled = 1
       ${langFilter}
     ORDER BY CASE WHEN ccsp.primary_csp = ? THEN 0 ELSE 1 END,
              ic.channel_subscribers DESC
     LIMIT ?`,
    [...cspList, channelId, ...langParams, cspRow.primary_csp, Math.min(limit * 3, 900)],
  );

  let rejectedBlock  = 0;
  let rejectedWeak   = 0;
  let rejectedFamily = 0;
  const admitted = [];
  const targetFamily = cspRow.primary_csp === 'curiosity_explainer'
    ? _curiosityPeerFamily({
      niche: targetRow?.primary_niche || targetRow?.niche,
      niche_detail: targetRow?.niche,
      routing_profile: targetRow?.routing_profile,
      format_type: targetRow?.format_type,
    })
    : null;
  const targetNiche = String(targetRow?.primary_niche || targetRow?.niche || '').toLowerCase();

  for (const r of candidates) {
    const isBlocked  = _CSP_HARD_BLOCK_NICHES.has(r.niche);
    const isPositive = compat.positive_niches.has(r.niche);
    const sameCsp    = r.candidate_csp === cspRow.primary_csp;

    // Hard exclusion: blocked niche channels are never admitted.
    if (isBlocked) { rejectedBlock++; continue; }

    if (targetFamily) {
      const candidateFamily = _curiosityPeerFamily(r);
      if (!_curiosityPeerAllowed(targetFamily, candidateFamily)) {
        rejectedFamily++;
        continue;
      }
      r.curiosity_family = candidateFamily;
    }

    // Compute compatibility score (positive niche counts most; signals stack).
    let score = sameCsp ? 3 : 0; // expanded CSPs need stronger metadata support
    if (isPositive)                           score += 2;
    if (compat.positive_modes.has(r.creator_mode))   score += 2;
    if (compat.positive_rps.has(r.routing_profile))  score += 1;
    if (compat.positive_fmts.has(r.format_type))     score += 1;
    if (compat.positive_format_profiles?.has(r.format_profile)) score += 1;
    if (targetFamily && r.curiosity_family === targetFamily) score += 3;
    if (targetFamily && targetNiche && r.niche === targetNiche) score += 2;

    // Neutral niche (not positive, not blocked): require at least 1 extra signal.
    if (!isPositive && score < 2) { rejectedWeak++; continue; }
    // Related-CSP expansion is only for sparse clean pools; require stronger support
    // so a broad adjacent label cannot reintroduce the same polluted channels.
    if (!sameCsp && score < 3) { rejectedWeak++; continue; }

    admitted.push({ channel_id: r.channel_id, channel_name: r.channel_name, score,
                    candidate_csp: r.candidate_csp,
                    niche: r.niche, creator_mode: r.creator_mode,
                    routing_profile: r.routing_profile, format_type: r.format_type,
                    format_profile: r.format_profile,
                    curiosity_family: r.curiosity_family,
                    channel_subscribers: r.channel_subscribers });
  }

  // Sort: compatibility score DESC, then subscribers DESC.
  admitted.sort((a, b) =>
    b.score - a.score || (b.channel_subscribers || 0) - (a.channel_subscribers || 0),
  );

  const topN = admitted.slice(0, limit);

  return {
    peerIds:        topN.map(r => r.channel_id),
    csp_peer_count: topN.length,
    csp_primary:    cspRow.primary_csp,
    csp_confidence: cspRow.confidence,
    csp_candidates_total:      candidates.length,
    csp_candidates_admitted:   admitted.length,
    csp_rejected_incompatible: rejectedBlock,
    csp_rejected_weak:         rejectedWeak,
    csp_rejected_family:       rejectedFamily,
    ...(targetFamily ? { csp_target_family: targetFamily } : {}),
    ...(debug ? {
      csp_top_peer_sample: topN.slice(0, 10).map(r => ({
        channel_name:        r.channel_name,
        csp:                 r.candidate_csp,
        niche:               r.niche,
        creator_mode:        r.creator_mode,
        routing_profile:     r.routing_profile,
        format_type:         r.format_type,
        format_profile:      r.format_profile,
        curiosity_family:    r.curiosity_family,
        compatibility_score: r.score,
      })),
    } : {}),
  };
}

// ── Unified peer admission gate (Layer 1) ─────────────────────────────────────
// Lexical fingerprint matching admits "shares-words" channels that aren't real peers
// (music videos for a talk show; Indian channels for a US creator — both seen live). This
// gate post-filters the assembled pool by REGION + NICHE-CLUSTER compatibility, with a
// COVERAGE FLOOR so it never returns too few — the floor is exactly what an earlier hard
// niche gate lacked, which is why that one regressed coverage. One gate fixes every
// downstream WTP surface (generator, community-hot, adjacent) instead of per-feature patches.
const _WESTERN_REGIONS = new Set(['US', 'CA', 'GB', 'EN', 'AU', 'IE', 'NZ']);
const _NICHE_CLUSTER = {
  entertainment: 'show', comedy: 'show',
  music: 'music',
  // The old catch-all 'lifestyle' fused food + travel + beauty + general vlogs — different audiences
  // (a travel channel was pooling ~97% with food/beauty). Split like 'knowledge' was.
  food: 'food', cooking: 'food',
  beauty: 'style', fashion: 'style',
  travel: 'travel',
  lifestyle: 'lifestyle', vlog: 'lifestyle',
  gaming: 'gaming',
  // The old catch-all 'knowledge' fused education with finance/business/tech — different audiences.
  // Split so a UPSC channel is NOT "compatible" with Yahoo Finance / Bloomberg Tech.
  education: 'edu',
  finance: 'money', business: 'money', investing: 'money', 'stock market': 'money', cryptocurrency: 'money', 'personal finance': 'money',
  technology: 'techsci', science: 'techsci',
  selfimprovement: 'growth', motivation: 'growth',
  news: 'current', politics: 'current', geopolitics: 'current', defence: 'current',
  health: 'health', fitness: 'health', yoga: 'health',
  sports: 'sports',
  devotional: 'spiritual', meditation: 'spiritual',
};
const _CLUSTER_COMPAT = {
  show: new Set(['show']),
  music: new Set(['music']),
  food: new Set(['food']),
  style: new Set(['style']),
  travel: new Set(['travel']),
  lifestyle: new Set(['lifestyle']),
  edu: new Set(['edu']),
  money: new Set(['money']),
  techsci: new Set(['techsci']),
  growth: new Set(['growth']),
  current: new Set(['current']),
  health: new Set(['health', 'sports']),
  sports: new Set(['sports', 'health']),
  gaming: new Set(['gaming']),
  spiritual: new Set(['spiritual']),
};
function _nicheCompatiblePeer(a, b) {
  a = String(a || '').toLowerCase(); b = String(b || '').toLowerCase();
  if (!a || !b || a === 'other' || b === 'other') return true;   // unknown → don't block (coverage)
  if (a === b) return true;
  const ca = _NICHE_CLUSTER[a], cb = _NICHE_CLUSTER[b];
  if (!ca || !cb) return true;                                    // unmapped niche → don't block
  return ca === cb || _CLUSTER_COMPAT[ca]?.has(cb) || _CLUSTER_COMPAT[cb]?.has(ca) || false;
}
function _regionCompatiblePeer(creatorRegion, peerRegion) {
  if (!_WESTERN_REGIONS.has(creatorRegion)) return true;         // only constrain Western creators
  return !peerRegion || _WESTERN_REGIONS.has(peerRegion);        // peer must be Western (or unknown)
}

// ── Shared peer context resolver ──────────────────────────────────────────────
// Extracts the peer pool, creator mode, routing profile, and format profile for
// a given channel. Used by both computeWhatToPost and /community-hot so both
// views share the same peer pool logic.
const _NULL_CTX = {
  peerIds: [], peer_source: 'none', row: null, creator_mode: 'general',
  niche_category: 'A', resolved_niche: null, user_region: null,
  user_is_english: false, fp_result: null, rp_result: null,
  guest_intel_active: false,
  routing_profile_active: false, routing_profile_data: null,
  profile_resolver_used: false, broad_fallback_count: 0,
  peer_routing_debug: null,
  csp_routing_active: false, csp_primary: null, csp_confidence: null, csp_peer_count: 0,
};

function resolveCreatorPeerContext(db, channel_id, options = {}) {
  const { niche: nicheHint = null, userSubs = 0, debug = false } = options;

  const row = db.get(
    `SELECT community_id, niche, primary_niche, secondary_niche, content_archetype, format_type, behavior_tags, region, primary_language, inferred_topics, creator_mode, creator_mode_version, channel_name, podcast_fingerprint, routing_profile, routing_profile_version, format_profile, format_profile_version
     FROM ingested_channels WHERE channel_id = ?`,
    [channel_id],
  );
  if (!row) return _NULL_CTX;

  const userRegion = row.region || null;
  // Indian English creators (region=IN, language=en) belong to both Indian and global
  // English communities — use a wider region clause so Louvain peers from EN/US/GB
  // regions are included in the community pool alongside Indian peers.
  const rc = (userRegion === 'IN' && row.primary_language === 'en')
    ? "AND (region IN ('EN','US','GB','AU','CA','NZ','IE','IN') OR region IS NULL)"
    : getRegionClause(userRegion);

  // ── Resolve niche + creator mode before the routing profile resolver ────
  let resolved_niche = row.primary_niche || row.niche || nicheHint;
  let behaviorTags = [];
  try { behaviorTags = JSON.parse(row.behavior_tags || '[]'); } catch (_) {}
  const niche_category = getNicheCategory(row.niche, row.content_archetype, behaviorTags);
  let creator_mode = row.creator_mode || '';
  if (!creator_mode || (row.creator_mode_version || 0) < CREATOR_MODE_VERSION) {
    let _rtEffectiveFormat = row.format_type;
    if (row.format_type !== 'podcast' && row.format_type !== 'interview') {
      const _rtTitles = db.all(
        `SELECT title FROM ingested_videos WHERE channel_id = ? AND title IS NOT NULL ORDER BY published_at DESC LIMIT 60`,
        [channel_id],
      ).map(r => r.title);
      _rtEffectiveFormat = inferPodcastFormat(_rtTitles, row.format_type);
    }
    const { mode, confidence, reason } = detectCreatorMode(
      row.primary_niche || row.niche || resolved_niche,
      _rtEffectiveFormat,
      row.content_archetype,
      row.niche,
    );
    creator_mode = mode;
    try {
      db.run(
        `UPDATE ingested_channels SET creator_mode=?, creator_mode_confidence=?, creator_mode_reason=?, creator_mode_version=? WHERE channel_id=?`,
        [mode, confidence, reason, CREATOR_MODE_VERSION, channel_id],
      );
    } catch (_) {}
  }

  // ── Routing profile resolver (runs before broad peer pool building) ──────
  let peerIds              = [];
  let _rpResult            = null;
  let _fpResult            = null;
  let _guestIntelActive    = false;
  let _profileResolverUsed = false;
  let _profileResolverOut  = null;
  let _broadFallbackCount  = 0;
  let peer_routing_debug   = null;
  let _cspResolverUsed     = false;
  let _cspRow              = null;
  let _cspResult           = null;

  {
    const _rpTitles = db.all(
      `SELECT title FROM ingested_videos
       WHERE channel_id = ? AND title IS NOT NULL
       ORDER BY published_at DESC LIMIT 60`,
      [channel_id],
    ).map(r => r.title);
    _rpResult = computeRoutingProfile(_rpTitles);

    if ((row.routing_profile_version || 0) < ROUTING_PROFILE_VERSION) {
      try {
        db.run(
          `UPDATE ingested_channels
           SET routing_profile=?, routing_profile_confidence=?, routing_profile_version=?,
               routing_profile_debug=?
           WHERE channel_id=?`,
          [
            _rpResult.profile,
            _rpResult.confidence,
            ROUTING_PROFILE_VERSION,
            JSON.stringify({ positive_hits: _rpResult.positive_hits, negative_hits: _rpResult.negative_hits, titles_checked: _rpTitles.length }),
            channel_id,
          ],
        );
      } catch (_) {}
    }

    // ── Format profile (lazy, first request) ─────────────────────────
    _fpResult = computeFormatProfile(_rpTitles, row);
    if ((row.format_profile_version || 0) < FORMAT_PROFILE_VERSION) {
      try {
        db.run(
          `UPDATE ingested_channels
           SET format_profile=?, format_profile_confidence=?, format_profile_version=?,
               format_profile_debug=?
           WHERE channel_id=?`,
          [
            _fpResult.format_profile,
            _fpResult.confidence,
            FORMAT_PROFILE_VERSION,
            JSON.stringify(_fpResult.signals),
            channel_id,
          ],
        );
      } catch (_) {}
    }

    // Guest intel activation — computed here so resolveCreatorPeerContext can
    // return it and both computeWhatToPost and community-hot share the same decision.
    _guestIntelActive = computeGuestIntelActivation(_fpResult, creator_mode).active;

    const _channelNiche     = (row.primary_niche || row.niche || '').toLowerCase();
    const _resolverEligible = !RESOLVER_BLOCKED_MODES.has(creator_mode)
                              && RESOLVER_ELIGIBLE_NICHES.has(_channelNiche);

    if (_resolverEligible && _rpResult.profile && (_rpResult.confidence === 'medium' || _rpResult.confidence === 'high')) {
      _profileResolverOut = resolvePeersByRoutingProfile(db, channel_id, _rpResult, {
        userRegion, primaryLanguage: row.primary_language,
      });
      const _resolverPool = [..._profileResolverOut.same, ..._profileResolverOut.adjacent];
      if (_resolverPool.length >= 10) {
        peerIds              = _resolverPool.slice(0, 300);
        _profileResolverUsed = true;
      } else if (_resolverPool.length + _profileResolverOut.broadFallback.length >= 10) {
        _broadFallbackCount  = _profileResolverOut.broadFallback.length;
        peerIds              = [..._resolverPool, ..._profileResolverOut.broadFallback].slice(0, 300);
        _profileResolverUsed = true;
      }
    }
  }

  // ── CSP peer resolver (fires when routing-profile resolver did not) ──────────
  // Uses primary_csp from channel_content_strategy_profiles to narrow the peer
  // pool by content-strategy intent rather than raw niche. Effective for blocked
  // creator modes (finance, podcast, news, tech) where the routing-profile resolver
  // is intentionally skipped. Falls through to content fingerprint if pool < 15.
  if (!_profileResolverUsed) {
    _cspRow = db.get(
      `SELECT primary_csp, confidence, confidence_score, secondary_csp_1, secondary_csp_2, version
       FROM channel_content_strategy_profiles WHERE channel_id = ?`,
      [channel_id],
    );
    if (!_cspRow || (_cspRow.version || 0) < CSP_PROFILE_VERSION) {
      try {
        const cspData = classifyContentStrategyProfile(db, channel_id);
        upsertCSP(db, channel_id, cspData);
        _cspRow = db.get(
          `SELECT primary_csp, confidence, confidence_score, secondary_csp_1, secondary_csp_2, version
           FROM channel_content_strategy_profiles WHERE channel_id = ?`,
          [channel_id],
        );
      } catch (_) {}
    }
    if (_cspRow) {
      _cspResult = resolvePeersByCSP(db, channel_id, _cspRow, {
        userRegion, primaryLanguage: row.primary_language, debug, targetRow: row,
      });
      if (_cspResult.peerIds.length >= 15) {
        peerIds = _cspResult.peerIds;
        _cspResolverUsed = true;
      }
    }
  }

  // ── Content-first peer finding ────────────────────────────────────────
  // Primary source: channels whose video titles share recurring phrases with
  // this channel. Works for ALL channels regardless of niche classification.
  // Falls back to community_id + channel_topics when videos are unavailable
  // (new channels, non-Latin-script channels with no extractable phrases).
  if (!_profileResolverUsed && !_cspResolverUsed) {
    const contentResult = buildPeersByContent(db, channel_id, { userSubs, debug });
    const contentPeers  = debug ? contentResult.channelIds : contentResult;
    if (debug) peer_routing_debug = contentResult;
    if (contentPeers.length >= 10) {
      peerIds = contentPeers;
    } else {
      // Fallback: community_id pool + channel_topics overlap
      if (row.community_id && row.niche) {
        const communityRows = db.all(
          `SELECT channel_id, niche FROM ingested_channels WHERE community_id = ? AND channel_id != ? ${rc} LIMIT 300`,
          [row.community_id, channel_id],
        );
        const nicheCounts = {};
        for (const r of communityRows) nicheCounts[r.niche] = (nicheCounts[r.niche] || 0) + 1;
        const dominantNiche = Object.entries(nicheCounts).sort((a, b) => b[1] - a[1])[0]?.[0];
        if (!dominantNiche || dominantNiche === row.niche) {
          peerIds = communityRows.map(r => r.channel_id);
        }
      }
      const topicMatches = getChannelsByTopicOverlap(db, channel_id, { limit: 300, minOverlap: 2 });
      if (topicMatches.length > 0) {
        const topicScoreMap = new Map();
        for (const m of topicMatches) topicScoreMap.set(m.channel_id, m.topic_overlap);
        const communitySet = new Set(peerIds);
        const allIds = new Set([...peerIds, ...topicMatches.map(m => m.channel_id)]);
        allIds.delete(channel_id);
        peerIds = [...allIds].sort((a, b) => {
          const scoreB = (topicScoreMap.get(b) || 0) + (communitySet.has(b) ? 2 : 0);
          const scoreA = (topicScoreMap.get(a) || 0) + (communitySet.has(a) ? 2 : 0);
          return scoreB - scoreA;
        }).slice(0, 300);
      }
      // Prepend any content peers found (even a few help rank correctly)
      if (contentPeers.length > 0) {
        const existing = new Set(contentPeers);
        peerIds = [...contentPeers, ...peerIds.filter(id => !existing.has(id))].slice(0, 300);
      }
    }
  }

  // ── Title-similarity filter: keeps community pool on-topic ────────────
  // Only apply when pool is already large (≥30) — for small pools the niche
  // fallback already ran and we don't want to discard channels just because
  // they write titles in a different script (Hindi, Bengali, etc.).
  // Skip for CSP-routed pools: CSP already provides semantic scoping by
  // content-strategy intent; phrase overlap would incorrectly gut the pool.
  if (peerIds.length > 160) peerIds = peerIds.slice(0, 160);

  if (peerIds.length >= 30 && !_cspResolverUsed) {
    const targetTitles = db.all(
      `SELECT title FROM ingested_videos WHERE channel_id = ? AND title IS NOT NULL ORDER BY published_at DESC LIMIT 50`,
      [channel_id],
    );
    const targetPhraseSet = new Set();
    for (const { title } of targetTitles) {
      for (const p of extractPhrases(title)) targetPhraseSet.add(p);
    }

    if (targetPhraseSet.size > 0) {
      const cph2 = peerIds.map(() => '?').join(',');
      const poolTitleRows = db.all(
        `SELECT channel_id, title FROM (
           SELECT channel_id, title,
                  ROW_NUMBER() OVER (PARTITION BY channel_id ORDER BY published_at DESC) AS rn
           FROM ingested_videos
           WHERE channel_id IN (${cph2}) AND title IS NOT NULL
         ) WHERE rn <= 20`,
        peerIds,
      );

      const simScore = {};
      for (const { channel_id: cid, title } of poolTitleRows) {
        if (!simScore[cid]) simScore[cid] = 0;
        for (const p of extractPhrases(title)) {
          if (targetPhraseSet.has(p)) simScore[cid]++;
        }
      }

      const filtered = peerIds.filter(cid => (simScore[cid] || 0) > 0);
      if (filtered.length >= 5) peerIds = filtered;
    }
  }

  // ── Peer purity: drop exam/education channels from news/politics pools ────
  // Content-first routing can route UPSC/coaching channels into a news channel's
  // peer pool because they share current-affairs phrases (lok sabha, supreme court).
  // These channels produce exam-specific anchors (upsc prelims, paper analysis)
  // that are irrelevant to a news creator.
  if (debug) console.log('[DIAG][P2] peerIds before exam gate:', peerIds.length, '| resolved_niche:', resolved_niche);
  if (peerIds.length > 0 && new Set(['news', 'politics']).has(resolved_niche)) {
    const _pph     = peerIds.map(() => '?').join(',');
    const _pniches = db.all(
      `SELECT channel_id, COALESCE(primary_niche, niche) AS niche
       FROM ingested_channels WHERE channel_id IN (${_pph})`,
      peerIds,
    );
    const _examRe  = /upsc|exam|neet|ssc|jee|preparation|ias|coaching|education|entrance/;
    const _examSet = new Set(
      _pniches.filter(r => r.niche && _examRe.test(r.niche)).map(r => r.channel_id),
    );
    if (debug) console.log('[DIAG][P2] exam channels detected:', _examSet.size, [..._examSet]);
    if (debug) console.log('[DIAG][P2] all peer niches:', JSON.stringify(_pniches.map(r => ({ id: r.channel_id.slice(-6), niche: r.niche }))));
    if (_examSet.size > 0) peerIds = peerIds.filter(id => !_examSet.has(id));
    if (debug) console.log('[DIAG][P2] peerIds after exam gate:', peerIds.length);
  }

  // ── 3. Archetype/topic/niche ladder — runs after title-similarity filter ──
  // Adds format-matched peers that weren't in the original community pool.
  // These bypass the title filter because archetype+format is already a strong
  // signal — we don't need title overlap on top of it.
  if (peerIds.length < 30 && !_profileResolverUsed && !_cspResolverUsed) {
    const extra = resolvePeers(db, row, { exclude_channel_id: channel_id, minSize: 30, limit: 300 });
    const merged = [...peerIds];
    for (const id of extra) if (!merged.includes(id)) merged.push(id);
    peerIds = merged.slice(0, 300);
  }

  // ── 4. Thin-pool expansion (Levels 2 → 4) ────────────────────────────────
  // Fires only when the full ladder above still leaves < 20 peers.
  // Never applied to routing-profile or CSP pools — those are intentionally narrow.
  // Level 2: same niche + language + archetype (other communities).
  // Level 3: same niche + region (drop archetype constraint).
  // Level 4: same niche_category + region — B/C only, where creative engines
  //          extract format/mood signals that work across language boundaries.
  const _EXPAND_MIN = 20;
  if (!_profileResolverUsed && !_cspResolverUsed && peerIds.length < _EXPAND_MIN) {
    const _xSet    = new Set([...peerIds, channel_id]);
    const _xNiche  = row.niche             || null;
    const _xLang   = row.primary_language  || null;
    const _xArch   = row.content_archetype || null;
    const _xCommId = row.community_id      ?? null;

    function _addExpansion(rows) {
      for (const r of rows) {
        if (peerIds.length >= 300) break;
        const id = typeof r === 'string' ? r : r.channel_id;
        if (!_xSet.has(id)) { peerIds.push(id); _xSet.add(id); }
      }
    }

    // Level 2: same niche + primary_language + content_archetype, excluding current community
    if (peerIds.length < _EXPAND_MIN && _xNiche && _xLang && _xArch) {
      const _l2CommClause = _xCommId != null ? 'AND (community_id IS NULL OR community_id != ?)' : '';
      const _l2Params     = _xCommId != null
        ? [_xNiche, _xLang, _xArch, channel_id, _xCommId]
        : [_xNiche, _xLang, _xArch, channel_id];
      _addExpansion(db.all(
        `SELECT channel_id FROM ingested_channels
         WHERE niche = ? AND primary_language = ? AND content_archetype = ?
           AND ingest_enabled = 1 AND channel_id != ? ${_l2CommClause} ${rc}
         ORDER BY channel_subscribers DESC LIMIT 200`,
        _l2Params,
      ));
      if (debug) console.log(`[expansion] L2 (niche+lang+arch) pool=${peerIds.length}`);
    }

    // Level 3: same niche + region (archetype dropped — broader creative space)
    if (peerIds.length < _EXPAND_MIN && _xNiche) {
      _addExpansion(db.all(
        `SELECT channel_id FROM ingested_channels
         WHERE niche = ? AND ingest_enabled = 1 AND channel_id != ? ${rc}
         ORDER BY channel_subscribers DESC LIMIT 200`,
        [_xNiche, channel_id],
      ));
      if (debug) console.log(`[expansion] L3 (niche+region) pool=${peerIds.length}`);
    }

    // Level 4: same niche_category + region — B and C only.
    // Topic-based A-category engines don't benefit from cross-niche mixing.
    if (peerIds.length < _EXPAND_MIN && (niche_category === 'B' || niche_category === 'C')) {
      const _l4Niches = Object.entries(NICHE_CATEGORY)
        .filter(([, cat]) => cat === niche_category)
        .map(([n]) => n);
      const _l4Ph = _l4Niches.map(() => '?').join(',');
      _addExpansion(db.all(
        `SELECT channel_id FROM ingested_channels
         WHERE niche IN (${_l4Ph}) AND ingest_enabled = 1 AND channel_id != ? ${rc}
         ORDER BY channel_subscribers DESC LIMIT 200`,
        [..._l4Niches, channel_id],
      ));
      if (debug) console.log(`[expansion] L4 (niche_cat=${niche_category}+region) pool=${peerIds.length}`);
    }
  }

  // Language filter for English creators.
  // Triggers when primary_language='en' OR when all recent titles are Latin-script
  // (catches channels with null language that are clearly English, like Aevy TV).
  const user_is_english = row.primary_language === 'en' || (() => {
    if (row.primary_language) return false;
    const sample = db.all(
      `SELECT title FROM ingested_videos WHERE channel_id = ? AND title IS NOT NULL ORDER BY published_at DESC LIMIT 20`,
      [channel_id],
    );
    if (sample.length < 5) return false;
    // All titles must produce phrases (extractPhrases returns [] for Devanagari/non-Latin)
    return sample.every(({ title }) => extractPhrases(title).length > 0);
  })();

  if (peerIds.length > 0 && user_is_english) {
    // Store inferred language so the filter doesn't re-run every request
    if (!row.primary_language) {
      try { db.run(`UPDATE ingested_channels SET primary_language = 'en' WHERE channel_id = ?`, [channel_id]); } catch (_) {}
    }

    const langPh = peerIds.map(() => '?').join(',');
    const poolRows = db.all(
      `SELECT channel_id, primary_language, channel_name FROM ingested_channels WHERE channel_id IN (${langPh})`,
      peerIds,
    );

    // For null-language pool channels: check if they write in Devanagari/Hindi script
    const nullLangIds = poolRows.filter(r => !r.primary_language).map(r => r.channel_id);
    const hindiNullIds = new Set();
    if (nullLangIds.length > 0) {
      const tph = nullLangIds.map(() => '?').join(',');
      const titleRows = db.all(
        `SELECT channel_id, title FROM (
           SELECT channel_id, title, ROW_NUMBER() OVER (PARTITION BY channel_id ORDER BY published_at DESC) AS rn
           FROM ingested_videos WHERE channel_id IN (${tph}) AND title IS NOT NULL
         ) WHERE rn <= 10`,
        nullLangIds,
      );
      const titlesByChannel = {};
      for (const { channel_id: cid, title } of titleRows)
        (titlesByChannel[cid] = titlesByChannel[cid] || []).push(title);
      for (const [cid, titles] of Object.entries(titlesByChannel)) {
        // If any title has Indic script or no Latin phrases, treat as non-English.
        const hasIndicScript = titles.some(t => DEVANAGARI_RE.test(t) || SOUTH_SCRIPT_RE.test(t));
        const allLatinSilent = titles.length >= 3 && titles.every(t => extractPhrases(t).length === 0);
        if (hasIndicScript || allLatinSilent) hindiNullIds.add(cid);
      }
    }

    const badIds = new Set([
      ...poolRows.filter(r => r.primary_language && r.primary_language !== 'en').map(r => r.channel_id),
      ...poolRows.filter(r => DEVANAGARI_RE.test(r.channel_name || '') || SOUTH_SCRIPT_RE.test(r.channel_name || '')).map(r => r.channel_id),
      ...hindiNullIds,
    ]);
    if (badIds.size > 0) peerIds = peerIds.filter(id => !badIds.has(id));

    // For Indian English creators: sort Indian peers (region='IN') to the front.
    // When the pool hits the 300-channel cap, Indian channels are never dropped to
    // make room for global English ones. Global English channels still supplement
    // when the Indian pool is too small.
    if (userRegion === 'IN' && peerIds.length > 0) {
      const rph = peerIds.map(() => '?').join(',');
      const regionById = {};
      for (const { channel_id: cid, region } of db.all(
        `SELECT channel_id, region FROM ingested_channels WHERE channel_id IN (${rph})`,
        peerIds,
      )) regionById[cid] = region;

      peerIds.sort((a, b) => {
        const aIsIndian = regionById[a] === 'IN' ? 0 : 1;
        const bIsIndian = regionById[b] === 'IN' ? 0 : 1;
        return aIsIndian - bIsIndian;
      });
    }
  }

  // Symmetric language filter for NON-English creators. The English block above strips
  // wrong-language peers for en users; without this, non-English users got NOTHING — the
  // region-based expansion ladder (L2-L4) re-floods e.g. a Tamil channel with hi/en peers.
  // Strip peers whose KNOWN language differs; keep same-language + null (ambiguous slice).
  if (peerIds.length > 0 && !user_is_english && row.primary_language && row.primary_language !== 'en') {
    const _xlph = peerIds.map(() => '?').join(',');
    const _xlpool = db.all(
      `SELECT channel_id, primary_language FROM ingested_channels WHERE channel_id IN (${_xlph})`,
      peerIds,
    );
    const _xlbad = new Set(
      _xlpool.filter(r => r.primary_language && r.primary_language !== row.primary_language).map(r => r.channel_id),
    );
    if (_xlbad.size > 0) peerIds = peerIds.filter(id => !_xlbad.has(id));
  }

  // ── Second purity pass: re-runs after the archetype ladder has expanded the pool ─
  // The first pass (above) fires when peerIds ≈ 13 (initial similarity pool).
  // The archetype ladder can add UPSC / exam channels that share format signals with
  // news channels. This pass catches them before video fetch.
  if (peerIds.length > 0 && new Set(['news', 'politics']).has(resolved_niche)) {
    const _p2ph     = peerIds.map(() => '?').join(',');
    const _p2niches = db.all(
      `SELECT channel_id, COALESCE(primary_niche, niche) AS niche
       FROM ingested_channels WHERE channel_id IN (${_p2ph})`,
      peerIds,
    );
    const _p2examRe  = /upsc|exam|neet|ssc|jee|preparation|ias|coaching|education|entrance|competitive/;
    const _p2examSet = new Set(
      _p2niches.filter(r => r.niche && _p2examRe.test(r.niche)).map(r => r.channel_id),
    );
    if (debug) console.log('[DIAG][P2b] second purity — before:', peerIds.length, '| exam found:', _p2examSet.size, [..._p2examSet]);
    if (_p2examSet.size > 0) peerIds = peerIds.filter(id => !_p2examSet.has(id));
    if (debug) console.log('[DIAG][P2b] second purity — after:', peerIds.length);
  }

  // ── Non-exam peer gate ────────────────────────────────────────────────────
  // Prevents exam/student-motivation channels from leaking into non-UPSC creator
  // pools via adjacent general_selfimprovement routing (e.g. "NV Sir Motivation",
  // "FluteVerse MBBS", "Focus4Study" appearing in Dr Amiett's peer pool).
  // Checks creator_mode and routing_profile on pool channels — not just niche text —
  // so it catches channels that were rerouted via the adjacent bucket.
  if (peerIds.length > 0 && creator_mode !== 'upsc' && _rpResult?.profile !== 'upsc_exam') {
    const _xph   = peerIds.map(() => '?').join(',');
    const _xrows = db.all(
      `SELECT channel_id,
              COALESCE(creator_mode, '') AS creator_mode,
              COALESCE(routing_profile, '') AS routing_profile,
              COALESCE(primary_niche, niche, '') AS niche
       FROM ingested_channels WHERE channel_id IN (${_xph})`,
      peerIds,
    );
    const _examNicheRe = /\bupsc\b|\bneet\b|\bjee\b|\bssc\b|\bias\b|exam[\s_]prep|medical[\s_]entrance|student[\s_]motivat/;
    const _examPeerSet = new Set(
      _xrows.filter(r =>
        r.creator_mode === 'upsc' ||
        r.routing_profile === 'upsc_exam' ||
        _examNicheRe.test(r.niche.toLowerCase()),
      ).map(r => r.channel_id),
    );
    if (_examPeerSet.size > 0) peerIds = peerIds.filter(id => !_examPeerSet.has(id));
  }

  // ── Unified admission gate: region + niche-cluster, with a coverage floor ─────
  if (peerIds.length > 0) {
    const _gNiche = String(row?.primary_niche || row?.niche || resolved_niche || '').toLowerCase();
    const _gph = peerIds.map(() => '?').join(',');
    const _gmeta = {};
    try { for (const r of db.all(`SELECT channel_id, COALESCE(primary_niche, niche) AS niche, region FROM ingested_channels WHERE channel_id IN (${_gph})`, peerIds)) _gmeta[r.channel_id] = r; } catch (_) {}
    const _admitted = peerIds.filter(id => {
      const m = _gmeta[id]; if (!m) return true;
      return _regionCompatiblePeer(userRegion, m.region) && _nicheCompatiblePeer(_gNiche, m.niche);
    });
    // Apply if it leaves enough peers. If it leaves too few (a cross-domain CSP pool — e.g. a UPSC
    // channel whose "knowledge authority" pool is mostly finance/business/tech — has few same-niche
    // peers), BACKFILL same-niche + same-region channels (preferring the creator's sub-niche) up to
    // a floor, so we serve a CLEAN pool instead of the contaminated pre-gate one. Only override the
    // old behaviour when a clean pool of ≥10 can actually be built; otherwise keep the pre-gate pool
    // (unchanged) so genuinely thin niches never lose coverage.
    if (_admitted.length >= 10) {
      if (debug) console.log('[DIAG][admission] gate', peerIds.length, '→', _admitted.length, `(niche=${_gNiche}, region=${userRegion})`);
      peerIds = _admitted;
    } else {
      const _BF_TARGET = 15;
      const _bfMe = db.get(`SELECT inferred_topics, channel_name FROM ingested_channels WHERE channel_id = ?`, [channel_id]);
      const _bfSub = classifySubNiche(_gNiche, _bfMe?.inferred_topics, _bfMe?.channel_name);
      const _bfHave = new Set([channel_id, ..._admitted]);
      const _filled = [..._admitted];
      if (_gNiche && userRegion) {
        try {
          const _cand = db.all(
            `SELECT channel_id, inferred_topics, channel_name FROM ingested_channels
             WHERE LOWER(COALESCE(primary_niche, niche)) = ? AND region = ? AND ingest_enabled = 1 AND channel_id != ?
             ORDER BY channel_subscribers DESC LIMIT 400`,
            [_gNiche, userRegion, channel_id],
          );
          // Prefer same-sub-niche candidates first (stable within subscriber-desc order).
          _cand.sort((a, b) => {
            const sa = _bfSub && classifySubNiche(_gNiche, a.inferred_topics, a.channel_name) === _bfSub ? 0 : 1;
            const sb = _bfSub && classifySubNiche(_gNiche, b.inferred_topics, b.channel_name) === _bfSub ? 0 : 1;
            return sa - sb;
          });
          for (const r of _cand) { if (_filled.length >= _BF_TARGET) break; if (!_bfHave.has(r.channel_id)) { _filled.push(r.channel_id); _bfHave.add(r.channel_id); } }
        } catch (_) {}
      }
      if (_filled.length >= 10) {
        if (debug) console.log('[DIAG][admission] tightened+backfilled', peerIds.length, '→', _filled.length, `(niche=${_gNiche}, +${_filled.length - _admitted.length})`);
        peerIds = _filled;
      } else if (debug) {
        console.log('[DIAG][admission] gate skipped by floor:', peerIds.length, '→ would be', _admitted.length, `(backfill reached ${_filled.length})`);
      }
    }
  }

  // ── Sub-niche purity gate ─────────────────────────────────────────────────
  // Coarse parent niches (e.g. "education") bundle unrelated communities — kids, exam-prep,
  // language, science, math, coding. When THIS creator has a confident sub-niche, keep only
  // same-sub-niche peers FROM THE SAME parent niche (peers in other compatible niches are left
  // alone). Applied only above a coverage floor, so a thin pool never starves — exactly the
  // admission-gate pattern above. Removes the cross-community contamination that put CGP Grey /
  // Professor Dave in a kids pool and Al Jazeera in a language pool. "general" creators (no
  // confident sub-niche) are untouched and rely on the semantic rerank below.
  if (peerIds.length > 0) {
    const _snMe = db.get(`SELECT COALESCE(primary_niche, niche) AS niche, inferred_topics, channel_name FROM ingested_channels WHERE channel_id = ?`, [channel_id]);
    const _snParent = String(_snMe?.niche || '').toLowerCase();
    const _snHasRules = !!SUB_NICHE_RULES[_snParent];
    const _mySub = _snMe ? classifySubNiche(_snMe.niche, _snMe.inferred_topics, _snMe.channel_name) : null;
    const _SUBNICHE_FLOOR = 15;

    // ── Kids-content purity (mislabel-proof) ──
    // Genuine kids channels (nursery rhymes / toy reviews / children's songs) are frequently
    // MISLABELED into music/entertainment/food/beauty and poison those pools. Detect them by strict
    // topic phrases (NOT the niche label) and strip them from a NON-kids creator's pool; for a kids
    // creator keep only kids peers. Floor-protected so the pool is never starved.
    try {
      const _meKids = isKidsContent(_snMe?.inferred_topics);
      const _kPh = peerIds.map(() => '?').join(',');
      const _kidsPeers = new Set();
      for (const r of db.all(`SELECT channel_id, inferred_topics FROM ingested_channels WHERE channel_id IN (${_kPh})`, peerIds)) {
        if (isKidsContent(r.inferred_topics)) _kidsPeers.add(r.channel_id);
      }
      const _kKeep = peerIds.filter(id => (_meKids ? _kidsPeers.has(id) : !_kidsPeers.has(id)));
      if (_kKeep.length >= 12 && _kKeep.length < peerIds.length) {
        if (debug) console.log(`[DIAG][kids] ${_meKids ? 'kids-only' : 'strip-kids'}`, peerIds.length, '→', _kKeep.length);
        peerIds = _kKeep;
      }
    } catch (_) {}

    if (_mySub) {
      // (a) Keyword sub-niche: keep same-sub-niche peers from the same coarse bucket.
      const _snPh = peerIds.map(() => '?').join(',');
      const _snMeta = {};
      try { for (const r of db.all(`SELECT channel_id, COALESCE(primary_niche, niche) AS niche, inferred_topics, channel_name FROM ingested_channels WHERE channel_id IN (${_snPh})`, peerIds)) _snMeta[r.channel_id] = r; } catch (_) {}
      const _snKeep = peerIds.filter(id => {
        const r = _snMeta[id]; if (!r) return true;
        if (String(r.niche || '').toLowerCase() !== _snParent) return true; // leave cross-niche peers alone
        return classifySubNiche(r.niche, r.inferred_topics, r.channel_name) === _mySub;
      });
      if (_snKeep.length >= _SUBNICHE_FLOOR && _snKeep.length < peerIds.length) {
        if (debug) console.log(`[DIAG][subniche] ${_mySub} gate`, peerIds.length, '→', _snKeep.length);
        peerIds = _snKeep;
      } else if (debug) {
        console.log(`[DIAG][subniche] gate skipped (sub=${_mySub}, ${peerIds.length}→${_snKeep.length}, floor=${_SUBNICHE_FLOOR})`);
      }
    } else if (_snHasRules) {
      // (b) "general" creator inside a coarse bucket — no keyword sub-niche. Fall back to a
      // SEMANTIC filter on cached embeddings so it still gets a relevant (not niche-wide) pool.
      const _before = peerIds.length;
      peerIds = filterBySemanticSync(db, channel_id, peerIds, { minKeep: _SUBNICHE_FLOOR });
      if (debug) console.log(`[DIAG][subniche] general → semantic filter`, _before, '→', peerIds.length);
    }
  }

  // ── Layer 3: semantic rerank by cached channel embeddings (sync, no API; no-op until vectors
  // are populated via scripts/embedChannels.js --commit). Orders the gated pool best-similar-first.
  try { peerIds = rerankBySemanticSync(db, channel_id, peerIds); } catch (_) {}

  // ── Routing profile: build response object from early detection ────
  // Activation is strictly gated: the resolver must have fired (_profileResolverUsed)
  // AND the evidence must meet per-profile quality thresholds.
  const { active: routing_profile_active, reason: _rpActivationReason } =
    computeRoutingProfileActivation(_rpResult, { resolverEligible: _profileResolverUsed });

  let routing_profile_data = null;
  if (_rpResult) {
    routing_profile_data = {
      routing_profile:             _rpResult.profile,
      routing_profile_confidence:  _rpResult.confidence,
      routing_profile_active,
      routing_profile_activation_reason: _rpActivationReason,
      profile_positive_hits:       _rpResult.positive_hits,
      profile_negative_hits:       _rpResult.negative_hits,
      profile_strong_anchor_hits:  _rpResult.strong_anchor_hits  || 0,
      profile_distinct_title_hits: _rpResult.distinct_title_hits || 0,
      profile_density:             _rpResult.density             || 0,
      profile_blockers:            _rpResult.blockers            || [],
      profile_resolver_used:       _profileResolverUsed,
      same_profile_peer_count:     _profileResolverOut?.same.length     ?? 0,
      adjacent_profile_peer_count: _profileResolverOut?.adjacent.length ?? 0,
      broad_fallback_count:        _broadFallbackCount,
      admitted_peer_profile_counts: _profileResolverOut?.debug.admitted_counts ?? {},
      rejected_peer_profile_counts: _profileResolverOut?.debug.rejected_counts ?? {},
    };
  }

  return {
    peerIds,
    peer_source:           _profileResolverUsed ? 'routing_profile' : _cspResolverUsed ? 'csp' : 'content',
    row,
    creator_mode,
    niche_category,
    resolved_niche,
    user_region:           userRegion,
    user_is_english,
    fp_result:             _fpResult,
    rp_result:             _rpResult,
    guest_intel_active:    _guestIntelActive,
    routing_profile_active,
    routing_profile_data,
    profile_resolver_used: _profileResolverUsed,
    broad_fallback_count:  _broadFallbackCount,
    peer_routing_debug,
    csp_routing_active:           _cspResolverUsed,
    csp_primary:                  _cspResult?.csp_primary             ?? null,
    csp_confidence:               _cspResult?.csp_confidence          ?? null,
    csp_peer_count:               _cspResult?.csp_peer_count          ?? 0,
    csp_candidates_total:         _cspResult?.csp_candidates_total    ?? 0,
    csp_candidates_admitted:      _cspResult?.csp_candidates_admitted ?? 0,
    csp_rejected_incompatible:    _cspResult?.csp_rejected_incompatible ?? 0,
    csp_rejected_weak:            _cspResult?.csp_rejected_weak       ?? 0,
    csp_rejected_family:          _cspResult?.csp_rejected_family     ?? 0,
    csp_target_family:            _cspResult?.csp_target_family       ?? null,
    ...(debug && _cspResult?.csp_top_peer_sample ? { csp_top_peer_sample: _cspResult.csp_top_peer_sample } : {}),
  };
}

module.exports = { resolveCreatorPeerContext, buildPeersByContent };

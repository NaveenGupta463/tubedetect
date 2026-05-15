'use strict';

/**
 * Attention Ecology Engine — Phase XIV Observability Layer
 *
 * Infers a probabilistic attention ecology profile for each corpus channel.
 * Uses heuristic signal scoring (Option A) — purely rule-based, no external calls,
 * no scoring/validator/topology changes.
 *
 * Ecology dimensions (5, fixed for Phase XIV):
 *   spectacle      — high-arousal, urgency-driven, curiosity-gap content
 *   calm_trust     — calm authority, trust continuity, low-arousal engagement
 *   competence     — tutorial, skill-building, demonstrable expertise
 *   parasocial     — creator-audience relationship as primary product
 *   ritual_ambient — habit/routine consumption, ambient or repetitive attendance
 *
 * Output is a soft probabilistic vector, NOT a hard category.
 * Phase XIV: OBSERVABILITY ONLY. No scoring, validator, or topology changes.
 */

const crypto = require('crypto');

const ECOLOGY_VERSION        = 1;           // increment when heuristics change materially
const ECOLOGY_SOURCE         = 'heuristic_v1';
const ECOLOGY_DIMS           = ['spectacle', 'calm_trust', 'competence', 'parasocial', 'ritual_ambient'];
const CONFIDENT_THRESHOLD    = 0.65;        // ecology_confidence >= this → reliable
const PROVISIONAL_THRESHOLD  = 0.40;        // >= this → provisional; < this → uncertain
const DRIFT_ALERT_THRESHOLD  = 0.30;        // cosine distance that triggers a governance alert
const MAX_HISTORY_PER_CHANNEL = 12;         // prune history beyond this many entries per channel

// ── Title signal extraction ───────────────────────────────────────────────────

function analyzeTitle(title) {
  const t     = (title || '').trim();
  const lower = t.toLowerCase();

  const alphaChars = (t.match(/[A-Za-z]/g) || []).length;
  const capChars   = (t.match(/[A-Z]/g) || []).length;
  const wordCount  = t.split(/\s+/).filter(w => w.length > 0).length;

  return {
    caps_ratio:        alphaChars > 0 ? capChars / alphaChars : 0,
    has_exclamation:   /!/.test(t),
    has_question:      /\?/.test(t),
    has_all_caps_word: /\b[A-Z]{3,}\b/.test(t),
    has_countdown:     /^\d+\s+(ways?|reasons?|tips?|tricks?|secrets?|things?|steps?|mistakes?|hacks?|signs?|facts?)/i.test(t),
    has_urgency:       /\b(shocking|breaking|exposed|you won'?t believe|must see|urgent|alert|warning|dangerous|truth about|they don'?t want|finally|revealed|exclusive)\b/i.test(lower),
    has_calm_words:    /\b(calm|peace|relax|meditat|breath|gentle|slow|mindful|aware|tranquil|still|quiet|serene|soothing|healing|restor|soften)\b/i.test(lower),
    has_spiritual:     /\b(spirit|soul|sacred|divine|prayer|mantra|chakra|yoga|zen|enlighten|awaken|conscious|universe|gratitude|ego|dharma|sutra)\b/i.test(lower),
    has_tutorial:      /\b(how to|guide|tutorial|step.by.step|learn|understand|master|beginner|advanced|complete|explained|for dummies|from scratch|basics|fundamentals|crash course)\b/i.test(lower),
    has_review:        /\b(review|honest|vs\b|comparison|worth it|should you|is it worth|best|worst|ranked|tier list|unboxing|test)\b/i.test(lower),
    has_community:     /\b(together|join|community|family|with me|join me|our journey|let'?s|support|thank you for)\b/i.test(lower),
    has_personal:      /\b(my story|i am|i'?ve|i was|my life|my experience|real talk|honest|update|vlog|day in|week in|storytime|confess|open up|raw)\b/i.test(lower),
    has_ritual:        /\b(daily|morning|evening|night|routine|practice|habit|ritual|every day|everyday|weekly|workout|meditation|session|with me)\b/i.test(lower),
    has_ambient:       /\b(relax|study|sleep|focus|background|lofi|lo-fi|ambient|rain|nature|sounds|hours?\b|3 hour|1 hour|2 hour|long)\b/i.test(lower),
    word_count:        wordCount,
  };
}

function aggregateTitleSignals(titles) {
  if (!titles || titles.length === 0) return null;

  const analyzed = titles.map(t => analyzeTitle(t));
  const n        = analyzed.length;

  function rate(key) {
    return analyzed.reduce((s, a) => s + (a[key] ? 1 : 0), 0) / n;
  }

  return {
    n,
    avg_caps_ratio:     analyzed.reduce((s, a) => s + a.caps_ratio, 0) / n,
    exclamation_rate:   rate('has_exclamation'),
    all_caps_word_rate: rate('has_all_caps_word'),
    countdown_rate:     rate('has_countdown'),
    urgency_rate:       rate('has_urgency'),
    calm_rate:          rate('has_calm_words'),
    spiritual_rate:     rate('has_spiritual'),
    tutorial_rate:      rate('has_tutorial'),
    review_rate:        rate('has_review'),
    community_rate:     rate('has_community'),
    personal_rate:      rate('has_personal'),
    ritual_rate:        rate('has_ritual'),
    ambient_rate:       rate('has_ambient'),
    avg_word_count:     analyzed.reduce((s, a) => s + a.word_count, 0) / n,
  };
}

// ── Duration signals ──────────────────────────────────────────────────────────

function analyzeDuration(durations) {
  const valid = (durations || []).filter(d => d > 0);
  if (!valid.length) return null;

  const avg = valid.reduce((a, b) => a + b, 0) / valid.length;
  const n   = valid.length;

  return {
    avg_seconds:   avg,
    avg_minutes:   avg / 60,
    pct_short:     valid.filter(d => d < 180).length / n,               // < 3 min
    pct_medium:    valid.filter(d => d >= 300  && d < 900).length  / n, // 5–15 min
    pct_long:      valid.filter(d => d >= 900  && d < 3600).length / n, // 15–60 min
    pct_very_long: valid.filter(d => d >= 3600).length / n,             // 60+ min
  };
}

// ── Upload consistency ────────────────────────────────────────────────────────

function analyzeUploadConsistency(publishedDates) {
  const valid = (publishedDates || []).filter(Boolean);
  if (valid.length < 3) return null;

  const sorted = valid.map(d => new Date(d).getTime()).filter(t => !isNaN(t)).sort((a, b) => a - b);
  if (sorted.length < 3) return null;

  const gaps = [];
  for (let i = 1; i < sorted.length; i++) {
    gaps.push((sorted[i] - sorted[i - 1]) / 86_400_000); // days
  }

  const mean     = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  const variance = gaps.reduce((s, g) => s + (g - mean) ** 2, 0) / gaps.length;
  const stddev   = Math.sqrt(variance);
  const cv       = mean > 0 ? stddev / mean : 1; // coefficient of variation

  return {
    mean_gap_days: parseFloat(mean.toFixed(1)),
    stddev_days:   parseFloat(stddev.toFixed(1)),
    cv,
    is_consistent: cv < 0.5,               // very regular
    is_moderate:   cv >= 0.5 && cv < 1.2,
    is_irregular:  cv >= 1.2,
  };
}

// ── Engagement signals ────────────────────────────────────────────────────────

function analyzeEngagement(videos, channelSubscribers) {
  if (!videos || videos.length === 0) return null;

  const withViews    = videos.filter(v => (v.views || 0) > 0);
  const withComments = videos.filter(v => v.comments != null && (v.views || 0) > 0);
  if (!withViews.length) return null;

  const avgViews    = withViews.reduce((s, v) => s + v.views, 0) / withViews.length;
  const avgComments = withComments.length
    ? withComments.reduce((s, v) => s + (v.comments || 0), 0) / withComments.length
    : null;

  const commentViewRatio = (avgComments != null && avgViews > 0)
    ? avgComments / avgViews
    : null;

  // Subscriber loyalty proxy: ratio of subscribers to average views
  // High ratio → strong loyal base; low ratio → externally discovered / viral
  const subscriberLoyalty = (channelSubscribers > 0 && avgViews > 0)
    ? parseFloat(Math.min(1.0, channelSubscribers / (avgViews * 10)).toFixed(3))
    : null;

  return {
    avg_views:          Math.round(avgViews),
    avg_comments:       avgComments != null ? Math.round(avgComments) : null,
    comment_view_ratio: commentViewRatio != null ? parseFloat(commentViewRatio.toFixed(5)) : null,
    subscriber_loyalty: subscriberLoyalty,
  };
}

// ── Ecology dimension scoring ─────────────────────────────────────────────────

function scoreEcologyDimensions({ titles, duration, consistency, engagement }) {
  const raw     = Object.fromEntries(ECOLOGY_DIMS.map(d => [d, 0]));
  const weights = Object.fromEntries(ECOLOGY_DIMS.map(d => [d, 0]));

  function add(dim, value, weight) {
    raw[dim]     += Math.max(0, Math.min(1, value)) * weight;
    weights[dim] += weight;
  }

  // ── Title signals (weight: 3.0 — strongest available signal) ─────────────
  if (titles) {
    const w = 3.0;

    add('spectacle', (
      titles.urgency_rate       * 1.5 +
      titles.all_caps_word_rate * 1.0 +
      titles.exclamation_rate   * 0.8 +
      Math.min(1, titles.avg_caps_ratio * 3) * 0.5
    ) / 3.8, w);

    add('calm_trust', (
      titles.calm_rate     * 1.5 +
      titles.spiritual_rate * 1.0 +
      Math.max(0, 1 - titles.urgency_rate * 4)     * 0.5 +
      Math.max(0, 1 - titles.avg_caps_ratio * 6)   * 0.3
    ) / 3.3, w);

    add('competence', (
      titles.tutorial_rate  * 1.5 +
      titles.review_rate    * 0.8 +
      titles.countdown_rate * 0.5
    ) / 2.8, w);

    add('parasocial', (
      titles.personal_rate   * 1.5 +
      titles.community_rate  * 1.0
    ) / 2.5, w);

    add('ritual_ambient', (
      titles.ritual_rate  * 1.5 +
      titles.ambient_rate * 1.0
    ) / 2.5, w);
  }

  // ── Duration signals (weight: 1.5) ────────────────────────────────────────
  if (duration) {
    const w = 1.5;

    add('spectacle',
      duration.pct_short * 0.8 + duration.pct_medium * 0.2,
      w);

    add('calm_trust',
      duration.pct_long,
      w);

    add('competence',
      duration.pct_medium * 0.7 + duration.pct_long * 0.3,
      w);

    add('parasocial',
      duration.pct_long * 0.6 + duration.pct_very_long * 0.4,
      w);

    add('ritual_ambient',
      duration.pct_very_long * 0.7 + duration.pct_short * 0.3,
      w);
  }

  // ── Upload consistency signals (weight: 1.0) ──────────────────────────────
  if (consistency) {
    const w = 1.0;

    add('spectacle',      consistency.is_irregular  ? 0.7 : 0.15,  w);
    add('calm_trust',     consistency.is_consistent ? 0.6 : consistency.is_moderate ? 0.4 : 0.1, w);
    add('competence',     consistency.is_moderate   ? 0.7 : consistency.is_consistent ? 0.5 : 0.2, w);
    add('parasocial',     consistency.is_moderate   ? 0.6 : consistency.is_consistent ? 0.5 : 0.2, w);
    add('ritual_ambient', consistency.is_consistent ? 0.9 : consistency.is_moderate   ? 0.4 : 0.1, w);
  }

  // ── Engagement signals (weight: 1.2) ──────────────────────────────────────
  if (engagement) {
    const w = 1.2;

    if (engagement.comment_view_ratio != null) {
      // Spectacle: low comment engagement (passive, high-volume consumption)
      add('spectacle',  engagement.comment_view_ratio < 0.005 ? 0.6 : 0.15, w);
      // Parasocial: high comment engagement (active community)
      add('parasocial', Math.min(1, engagement.comment_view_ratio / 0.02), w);
    }

    if (engagement.subscriber_loyalty != null) {
      // Calm trust: high subscriber loyalty (return viewers drive the channel)
      add('calm_trust', engagement.subscriber_loyalty, w);
    }
  }

  // Normalize: weighted average → [0, 1] per dimension
  const profile = {};
  for (const dim of ECOLOGY_DIMS) {
    const score = weights[dim] > 0 ? raw[dim] / weights[dim] : 0;
    profile[dim] = parseFloat(Math.min(1.0, Math.max(0, score)).toFixed(4));
  }
  return profile;
}

// ── Entropy (Shannon, normalized to [0,1] over 5 dimensions) ─────────────────

function calculateEcologyEntropy(profile) {
  const vals = ECOLOGY_DIMS.map(d => profile[d] ?? 0);
  const sum  = vals.reduce((a, b) => a + b, 0);
  if (sum === 0) return 1.0; // no signal → maximum uncertainty

  const probs = vals.map(v => v / sum);
  let entropy = 0;
  for (const p of probs) {
    if (p > 0) entropy -= p * Math.log2(p);
  }
  const maxEntropy = Math.log2(ECOLOGY_DIMS.length); // log2(5) ≈ 2.322
  return parseFloat(Math.min(1.0, entropy / maxEntropy).toFixed(4));
}

// ── Confidence ────────────────────────────────────────────────────────────────

function calculateEcologyConfidence(profile, videoCount) {
  // Factor 1: data availability (saturates at ~30 videos)
  const dataFactor = Math.min(1.0, (videoCount || 0) / 30);

  // Factor 2: profile concentration (1 − normalized entropy)
  const entropy             = calculateEcologyEntropy(profile);
  const concentrationFactor = 1 - entropy;

  // Combined: concentration matters more when data is available
  const confidence = dataFactor * 0.45 + concentrationFactor * 0.55;
  return parseFloat(Math.min(1.0, Math.max(0, confidence)).toFixed(3));
}

// ── Ecology inference — from raw video array (used by probe endpoint) ─────────

function inferEcologyProfileFromData(videos, channelMeta = {}) {
  const videoCount  = (videos || []).length;
  const titles      = videoCount > 0 ? aggregateTitleSignals(videos.map(v => v.title)) : null;
  const duration    = videoCount > 0 ? analyzeDuration(videos.map(v => v.duration_seconds)) : null;
  const consistency = videoCount >= 3 ? analyzeUploadConsistency(videos.map(v => v.published_at)) : null;
  const engagement  = videoCount > 0 ? analyzeEngagement(videos, channelMeta.subscriber_count ?? 0) : null;

  const profile    = scoreEcologyDimensions({ titles, duration, consistency, engagement });
  const entropy    = calculateEcologyEntropy(profile);
  const confidence = calculateEcologyConfidence(profile, videoCount);
  const source     = videoCount === 0 ? 'insufficient_data' : ECOLOGY_SOURCE;

  return {
    profile,
    entropy,
    confidence,
    source,
    version: ECOLOGY_VERSION,
    signal_summary: {
      video_count:     videoCount,
      has_titles:      !!titles,
      has_duration:    !!duration,
      has_consistency: !!consistency,
      has_engagement:  !!engagement,
    },
  };
}

// ── Ecology inference — main entry point (DB-backed) ──────────────────────────

function inferEcologyProfile(db, channel) {
  const videos = db.all(
    `SELECT title, duration_seconds, published_at, views, comments
     FROM ingested_videos
     WHERE channel_id = ?
     ORDER BY published_at DESC
     LIMIT 100`,
    [channel.channel_id],
  );
  return inferEcologyProfileFromData(videos, { subscriber_count: channel.subscriber_count });
}

// ── Drift detection ───────────────────────────────────────────────────────────

function detectEcologyShift(prevProfile, currProfile) {
  if (!prevProfile || !currProfile) {
    return { cosine_distance: null, is_significant: false };
  }

  const a = ECOLOGY_DIMS.map(d => prevProfile[d] ?? 0);
  const b = ECOLOGY_DIMS.map(d => currProfile[d] ?? 0);

  const magA = Math.sqrt(a.reduce((s, v) => s + v * v, 0));
  const magB = Math.sqrt(b.reduce((s, v) => s + v * v, 0));

  if (magA === 0 || magB === 0) return { cosine_distance: null, is_significant: false };

  const dot             = a.reduce((sum, v, i) => sum + v * b[i], 0);
  const cosineDistance  = parseFloat((1 - dot / (magA * magB)).toFixed(4));

  const deltas = ECOLOGY_DIMS.map((d, i) => ({ dim: d, delta: b[i] - a[i] }));
  deltas.sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta));
  const top = deltas[0];

  return {
    cosine_distance: cosineDistance,
    is_significant:  cosineDistance > DRIFT_ALERT_THRESHOLD,
    dominant_dim:    top.dim,
    dominant_delta:  parseFloat(top.delta.toFixed(4)),
    direction:       top.delta > 0 ? `toward_${top.dim}` : `away_from_${top.dim}`,
  };
}

// ── Persist to DB ─────────────────────────────────────────────────────────────

function saveEcologyProfile(db, channelId, result) {
  const { profile, entropy, confidence, source, version } = result;

  // Load previous profile for drift comparison
  const existing  = db.get(
    `SELECT ecology_profile FROM corpus_channels WHERE channel_id = ?`,
    [channelId],
  );
  const prevProfile = existing?.ecology_profile ? (() => {
    try { return JSON.parse(existing.ecology_profile); } catch (_) { return null; }
  })() : null;

  const drift = detectEcologyShift(prevProfile, profile);

  // Update corpus_channels — skip if manual override is active
  db.run(
    `UPDATE corpus_channels
     SET ecology_profile         = ?,
         ecology_confidence      = ?,
         ecology_entropy         = ?,
         ecology_last_updated_at = datetime('now'),
         ecology_source          = ?,
         ecology_version         = ?
     WHERE channel_id = ?
       AND (ecology_manual_override IS NULL OR ecology_manual_override = 0)`,
    [JSON.stringify(profile), confidence, entropy, source, version, channelId],
  );

  // Insert into history regardless of override status
  db.run(
    `INSERT INTO corpus_ecology_history
       (id, channel_id, ecology_profile, ecology_confidence, ecology_entropy,
        ecology_source, ecology_version, drift_distance, drift_alert, recorded_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
    [
      crypto.randomUUID(), channelId,
      JSON.stringify(profile), confidence, entropy,
      source, version,
      drift.cosine_distance,
      drift.is_significant ? 1 : 0,
    ],
  );

  // Emit governance alert for significant drift (only when we have a previous profile)
  if (drift.is_significant && prevProfile) {
    try {
      db.run(
        `INSERT INTO governance_alerts
           (id, alert_type, severity, cluster, message, metadata_json, created_at)
         VALUES (?, 'ecology_drift', 'medium', ?, ?, ?, datetime('now'))`,
        [
          crypto.randomUUID(),
          channelId,
          `Ecology drift for ${channelId}: ${drift.direction} (distance ${drift.cosine_distance})`,
          JSON.stringify({ channel_id: channelId, drift }),
        ],
      );
    } catch (_) {}
  }

  // Prune history: keep only most recent MAX_HISTORY_PER_CHANNEL entries
  try {
    const old = db.all(
      `SELECT id FROM corpus_ecology_history
       WHERE channel_id = ?
       ORDER BY recorded_at DESC
       LIMIT -1 OFFSET ?`,
      [channelId, MAX_HISTORY_PER_CHANNEL],
    );
    for (const row of old) {
      db.run(`DELETE FROM corpus_ecology_history WHERE id = ?`, [row.id]);
    }
  } catch (_) {}

  return { drift };
}

// ── Batch inference pass (called by corpus scheduler Step 14) ─────────────────

function runEcologyInferencePass(db, { limit = 200, forceAll = false } = {}) {
  const channels = forceAll
    ? db.all(
        `SELECT * FROM corpus_channels
         WHERE ecology_manual_override = 0 OR ecology_manual_override IS NULL
         ORDER BY CASE WHEN ecology_last_updated_at IS NULL THEN 0 ELSE 1 END ASC,
                  ecology_last_updated_at ASC
         LIMIT ?`,
        [limit],
      )
    : db.all(
        `SELECT * FROM corpus_channels
         WHERE (ecology_manual_override = 0 OR ecology_manual_override IS NULL)
           AND (ecology_profile IS NULL
             OR ecology_last_updated_at IS NULL
             OR ecology_last_updated_at < datetime('now', '-14 days'))
         ORDER BY CASE WHEN ecology_last_updated_at IS NULL THEN 0 ELSE 1 END ASC,
                  ecology_last_updated_at ASC
         LIMIT ?`,
        [limit],
      );

  let processed = 0, drift_alerts = 0, insufficient_data = 0, errors = 0;

  for (const channel of channels) {
    try {
      const result = inferEcologyProfile(db, channel);
      const { drift } = saveEcologyProfile(db, channel.channel_id, result);
      if (result.source === 'insufficient_data') insufficient_data++;
      if (drift.is_significant) drift_alerts++;
      processed++;
    } catch (e) {
      errors++;
      console.warn(`[ecologyEngine] Failed for ${channel.channel_id}:`, e.message);
    }
  }

  const eligible_remaining = forceAll ? 0 : (db.get(
    `SELECT COUNT(*) AS n FROM corpus_channels
     WHERE (ecology_manual_override = 0 OR ecology_manual_override IS NULL)
       AND (ecology_profile IS NULL
         OR ecology_last_updated_at IS NULL
         OR ecology_last_updated_at < datetime('now', '-14 days'))`,
  )?.n ?? 0);

  return { processed, drift_alerts, insufficient_data, errors, eligible_remaining };
}

// ── Manual override (spot-check validation) ───────────────────────────────────

function setManualEcologyOverride(db, channelId, profile, notes) {
  const entropy    = calculateEcologyEntropy(profile);
  const confidence = 1.0; // manual override = maximum confidence by definition

  db.run(
    `UPDATE corpus_channels
     SET ecology_profile         = ?,
         ecology_confidence      = ?,
         ecology_entropy         = ?,
         ecology_last_updated_at = datetime('now'),
         ecology_source          = 'manual_override',
         ecology_version         = ?,
         ecology_manual_override = 1,
         ecology_override_notes  = ?
     WHERE channel_id = ?`,
    [JSON.stringify(profile), confidence, entropy, ECOLOGY_VERSION, notes ?? null, channelId],
  );

  db.run(
    `INSERT INTO corpus_ecology_history
       (id, channel_id, ecology_profile, ecology_confidence, ecology_entropy,
        ecology_source, ecology_version, drift_distance, drift_alert, recorded_at)
     VALUES (?, ?, ?, ?, ?, 'manual_override', ?, NULL, 0, datetime('now'))`,
    [crypto.randomUUID(), channelId, JSON.stringify(profile), confidence, entropy, ECOLOGY_VERSION],
  );
}

function releaseManualOverride(db, channelId) {
  db.run(
    `UPDATE corpus_channels
     SET ecology_manual_override = 0, ecology_override_notes = NULL
     WHERE channel_id = ?`,
    [channelId],
  );
}

// ── Corpus-level ecology analytics (used by overview endpoint) ────────────────

function getEcologyDistribution(db) {
  const channels = db.all(
    `SELECT ecology_profile, ecology_confidence, ecology_entropy, niche, creator_size_tier
     FROM corpus_channels
     WHERE ecology_profile IS NOT NULL AND ecology_confidence >= ?`,
    [PROVISIONAL_THRESHOLD],
  );

  if (!channels.length) {
    return {
      total: 0,
      dimensions: Object.fromEntries(ECOLOGY_DIMS.map(d => [d, { avg_weight: 0, total_weight: 0 }])),
      dominant_ecology: null,
      spectacle_dominance_risk: false,
      calm_trust_underrepresented: false,
    };
  }

  const sums = Object.fromEntries(ECOLOGY_DIMS.map(d => [d, 0]));

  for (const ch of channels) {
    try {
      const p = JSON.parse(ch.ecology_profile);
      for (const dim of ECOLOGY_DIMS) sums[dim] += p[dim] ?? 0;
    } catch (_) {}
  }

  const n = channels.length;
  const dimensions = {};
  for (const dim of ECOLOGY_DIMS) {
    dimensions[dim] = {
      avg_weight:   parseFloat((sums[dim] / n).toFixed(4)),
      total_weight: parseFloat(sums[dim].toFixed(2)),
    };
  }

  const dominant = ECOLOGY_DIMS.reduce((best, d) =>
    dimensions[d].avg_weight > dimensions[best].avg_weight ? d : best, ECOLOGY_DIMS[0]);

  return {
    total:                      n,
    dimensions,
    dominant_ecology:           dominant,
    spectacle_dominance_risk:   dimensions.spectacle.avg_weight > 0.45,
    calm_trust_underrepresented: dimensions.calm_trust.avg_weight < 0.15,
  };
}

module.exports = {
  inferEcologyProfile,
  inferEcologyProfileFromData,
  calculateEcologyEntropy,
  calculateEcologyConfidence,
  detectEcologyShift,
  runEcologyInferencePass,
  saveEcologyProfile,
  setManualEcologyOverride,
  releaseManualOverride,
  getEcologyDistribution,
  ECOLOGY_DIMS,
  ECOLOGY_VERSION,
  ECOLOGY_SOURCE,
  CONFIDENT_THRESHOLD,
  PROVISIONAL_THRESHOLD,
  DRIFT_ALERT_THRESHOLD,
};

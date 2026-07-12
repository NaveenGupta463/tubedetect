'use strict';

const { enqueueRefreshJob } = require('./refreshQueue');

/**
 * classificationRepair.js
 *
 * Identifies and applies niche classification repairs using internal consistency
 * signals. No AI API calls required.
 *
 * Repair types (priority order):
 *  1. hard_conflict      — niche+archetype pair that is semantically impossible
 *  2. raw_niche_mismatch — raw niche field keyword contradicts primary_niche
 *  3. behavior_tag_mismatch — behavior_tags signal a different niche domain
 *
 * Usage:
 *  const { buildRepairCandidates, repairClassificationCandidate, ensureRepairTable } =
 *    require('./classificationRepair');
 */

// ── Hard conflict pairs ───────────────────────────────────────────────────────
// These niche+archetype combos are semantically impossible and warrant auto-repair.
const HARD_CONFLICT_PAIRS = [
  { niche: 'finance',     archetype: 'entertainer',        suggests: 'entertainment' },
  { niche: 'news',        archetype: 'entertainer',        suggests: 'entertainment' },
  { niche: 'politics',    archetype: 'entertainer',        suggests: 'comedy' },
  { niche: 'geopolitics', archetype: 'entertainer',        suggests: 'comedy' },
  { niche: 'science',     archetype: 'entertainer',        suggests: 'entertainment' },
  { niche: 'defence',     archetype: 'entertainer',        suggests: 'entertainment' },
  { niche: 'comedy',      archetype: 'authority_educator', suggests: 'education' },
  { niche: 'comedy',      archetype: 'analyst',            suggests: 'education' },
];

// Build fast lookup set
const HARD_PAIR_MAP = new Map(
  HARD_CONFLICT_PAIRS.map(p => [`${p.niche}+${p.archetype}`, p.suggests]),
);

// ── Behavior tag → expected niche signals ─────────────────────────────────────
const BTAG_NICHE_SIGNALS = {
  sketch:           ['entertainment', 'comedy'],
  character_driven: ['entertainment', 'comedy'],
  gameplay:         ['gaming'],
  recipe_based:     ['food'],
  travelogue:       ['travel'],
  music_video:      ['music'],
  audio_release:    ['music'],
  performance:      ['entertainment', 'comedy', 'music'],
  news_reaction:    ['news', 'politics', 'geopolitics'],
};

// ── Niche vocabulary for text detection ──────────────────────────────────────
const NICHE_VOCAB = {
  entertainment:   ['entertainment', 'celebrity', 'bollywood', 'movie', 'series', 'web series', 'viral', 'trending', 'late night', 'talk show', 'variety', 'interview show', 'tv show'],
  comedy:          ['comedy', 'funny', 'humor', 'sketch', 'prank', 'standup', 'roast', 'parody', 'skit', 'ventriloquism'],
  gaming:          ['gaming', 'game', 'gameplay', 'minecraft', 'pubg', 'free fire', 'bgmi', 'roblox', 'valorant', 'esports', 'gamer', 'playthrough'],
  music:           ['music', 'song', 'singer', 'rap', 'hip hop', 'album', 'bhajans', 'bhojpuri', 'devotional', 'punjabi', 'melody', 'beats', 'musician'],
  food:            ['food', 'recipe', 'cook', 'kitchen', 'chef', 'biryani', 'cuisine', 'restaurant', 'street food', 'baking', 'khana'],
  travel:          ['travel', 'adventure', 'explore', 'destination', 'trip', 'journey', 'wanderlust', 'travelogue'],
  finance:         ['finance', 'stock market', 'mutual fund', 'invest', 'trading', 'crypto', 'wealth', 'portfolio', 'nifty', 'sensex'],
  technology:      ['tech', 'smartphone', 'gadget', 'software', 'coding', 'programming', 'developer', 'cybersecurity'],
  education:       ['education', 'learn', 'tutorial', 'study', 'school', 'exam', 'upsc', 'ias', 'lecture', 'course', 'university'],
  news:            ['news', 'breaking', 'current affairs', 'samachar', 'update', 'reporter', 'headline'],
  health:          ['health', 'medical', 'doctor', 'medicine', 'nutrition', 'diet', 'ayurveda', 'wellness'],
  fitness:         ['fitness', 'workout', 'gym', 'bodybuilding', 'exercise', 'training'],
  yoga:            ['yoga', 'asana', 'pranayama', 'yogi'],
  meditation:      ['meditation', 'mindfulness', 'mindful', 'guided meditation'],
  sports:          ['cricket', 'football', 'sports', 'ipl', 'match', 'athlete', 'tournament'],
  politics:        ['politics', 'political', 'election', 'parliament', 'government', 'policy', 'minister', 'party'],
  geopolitics:     ['geopolit', 'world affairs', 'international', 'diplomacy', 'foreign policy', 'nato'],
  selfimprovement: ['motivation', 'self help', 'productivity', 'mindset', 'growth', 'habits', 'self improvement', 'personal development'],
  science:         ['science', 'space', 'physics', 'chemistry', 'biology', 'research', 'experiment', 'nasa'],
  philosophy:      ['philosophy', 'stoicism', 'wisdom', 'consciousness', 'eastern philosophy'],
  business:        ['business', 'entrepreneur', 'startup', 'marketing', 'sales', 'brand'],
  beauty:          ['beauty', 'makeup', 'skincare', 'fashion', 'style', 'cosmetic', 'grooming'],
  defence:         ['army', 'military', 'defence', 'defense', 'navy', 'air force', 'weapon', 'soldier', 'missile'],
  lifestyle:       ['lifestyle', 'vlog', 'daily life', 'day in my life', 'family', 'routine', 'grwm'],
};

// Niche groups where cross-classification is semantically acceptable.
// Lifestyle vloggers regularly mention music, beauty, travel, food incidentally —
// these should not trigger raw_niche_mismatch. Audit (June 2026) confirmed 94% of
// lifestyle channels are correctly classified; the false migrations came from
// music (110 channels, -44.5pp) and beauty (46 channels, -44.6pp) not being
// in this list.
const CLOSE_NICHE_GROUPS = [
  new Set(['entertainment', 'comedy', 'lifestyle']),
  new Set(['health', 'fitness', 'yoga', 'meditation', 'selfimprovement']),
  new Set(['education', 'science', 'technology']),
  new Set(['politics', 'news', 'geopolitics']),
  new Set(['business', 'finance']),
  new Set(['sports', 'gaming']),
  new Set(['food', 'lifestyle']),
  new Set(['travel', 'lifestyle']),
  new Set(['beauty', 'lifestyle']),
  new Set(['music', 'entertainment', 'lifestyle']),
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function areNichesClose(a, b) {
  if (!a || !b || a === b) return true;
  return CLOSE_NICHE_GROUPS.some(g => g.has(a) && g.has(b));
}

// Returns { niche, score } where score = number of matching keywords.
function detectNicheFromText(text) {
  if (!text) return { niche: null, score: 0 };
  const t = text.toLowerCase();
  let best = null, bestScore = 0;
  for (const [niche, kws] of Object.entries(NICHE_VOCAB)) {
    const score = kws.filter(kw => t.includes(kw)).length;
    if (score > bestScore) { bestScore = score; best = niche; }
  }
  return { niche: bestScore >= 1 ? best : null, score: bestScore };
}

// Music-specific gate: raw_niche keywords like "punjabi", "bhajans", "devotional"
// fire on lifestyle vloggers. Require a music behavior tag AND ≥2 keyword matches
// to confirm the channel is genuinely in the music domain.
const MUSIC_BEHAVIOR_TAGS = new Set(['music_video', 'audio_release', 'performance']);
const MUSIC_SIGNAL_THRESHOLD = 2;

function musicSignalSufficient(rawText, btags) {
  if (!rawText) return false;
  const t = rawText.toLowerCase();
  const musicScore = NICHE_VOCAB.music.filter(kw => t.includes(kw)).length;
  const hasMusicBtag = btags.some(tag => MUSIC_BEHAVIOR_TAGS.has(tag));
  return hasMusicBtag && musicScore >= MUSIC_SIGNAL_THRESHOLD;
}

function parseJsonArray(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v;
  try { return JSON.parse(v); } catch { return []; }
}

// ── Candidate detection ───────────────────────────────────────────────────────

/**
 * Evaluates a single channel row and returns the highest-priority repair
 * candidate descriptor, or null if no significant conflict is found.
 *
 * @param {object} channel - Row from ingested_channels
 * @returns {{ type, repair_reason, repair_priority, suggested_niche,
 *             conflict_detail, conflict_flags, confidence } | null}
 */
function detectCandidate(channel) {
  const pn   = channel.primary_niche;
  const arch = channel.content_archetype;
  const rawN = channel.niche;
  const btags = parseJsonArray(channel.behavior_tags);

  // Priority 1 — HARD niche+archetype conflict
  const naKey = `${pn}+${arch}`;
  if (HARD_PAIR_MAP.has(naKey)) {
    const hardSuggested = HARD_PAIR_MAP.get(naKey);
    // Refine suggestion using raw niche if it gives a better answer
    const { niche: rawDetected } = detectNicheFromText(rawN);
    const suggested = (rawDetected && !areNichesClose(rawDetected, pn)) ? rawDetected : hardSuggested;
    return {
      repair_reason:   'hard_conflict',
      repair_priority: 1,
      suggested_niche: suggested,
      conflict_detail: naKey,
      conflict_flags:  JSON.stringify([`hard_na_conflict:${naKey}`]),
      confidence:      20,
    };
  }

  // Priority 2 — Raw niche field mismatch
  if (rawN && pn) {
    const { niche: rawDetected, score: rawScore } = detectNicheFromText(rawN);
    if (rawDetected && rawDetected !== pn && !areNichesClose(rawDetected, pn)) {
      // Music gate: incidental keywords like "punjabi", "bhajans", "devotional"
      // fire on lifestyle vloggers. Only flag music if behavior tags corroborate.
      if (rawDetected === 'music' && !musicSignalSufficient(rawN, btags)) {
        return null;
      }
      return {
        repair_reason:   'raw_niche_mismatch',
        repair_priority: 2,
        suggested_niche: rawDetected,
        conflict_detail: `raw:"${rawN.slice(0, 40)}" → ${rawDetected} != ${pn} (score=${rawScore})`,
        conflict_flags:  JSON.stringify([`raw_niche_mismatch:${rawDetected}!=${pn}`]),
        confidence:      55,
      };
    }
  }

  return null;
}

// ── Table management ──────────────────────────────────────────────────────────

function ensureRepairTable(db) {
  db.run(`CREATE TABLE IF NOT EXISTS classification_repair_candidates (
    channel_id        TEXT PRIMARY KEY,
    channel_name      TEXT NOT NULL,
    current_niche     TEXT,
    suggested_niche   TEXT,
    confidence        INTEGER,
    repair_reason     TEXT NOT NULL,
    repair_priority   INTEGER NOT NULL,
    conflict_detail   TEXT,
    conflict_flags    TEXT,
    content_archetype TEXT,
    format_type       TEXT,
    channel_subscribers INTEGER,
    impact_score      REAL,
    status            TEXT DEFAULT 'pending',
    suggested_at      TEXT DEFAULT (datetime('now')),
    repaired_at       TEXT,
    repair_applied    TEXT
  )`);

  db.run(`CREATE INDEX IF NOT EXISTS idx_crc_priority
    ON classification_repair_candidates(repair_priority, impact_score DESC)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_crc_status
    ON classification_repair_candidates(status)`);
}

// ── Repair application ────────────────────────────────────────────────────────

/**
 * Applies the repair for one candidate. Requires a WRITABLE db handle.
 *
 * hard_conflict      → sets niche_override + primary_niche + invalidates WTP cache
 * raw_niche_mismatch → degrades identity_confidence, marks queued
 * behavior_tag_mismatch → degrades identity_confidence, marks queued
 *
 * @param {object} db - Writable database handle
 * @param {object} candidate - Row from classification_repair_candidates
 * @returns {{ applied: boolean, action: string }}
 */
function repairClassificationCandidate(db, candidate) {
  const { channel_id, repair_reason, suggested_niche, current_niche, channel_name } = candidate;
  const now = new Date().toISOString();

  if (repair_reason === 'hard_conflict') {
    // Set niche_override so re-classification preserves this fix.
    // Mirror the pattern in db/queries.js setNicheOverride().
    db.run(
      `UPDATE ingested_channels SET
         niche            = ?,
         niche_override   = ?,
         primary_niche    = ?,
         identity_confidence = 0.45,
         identity_source  = 'auto_repair',
         identity_reasoning = ?
       WHERE channel_id = ?`,
      [
        suggested_niche,
        suggested_niche,
        suggested_niche,
        `Auto-repaired: hard niche+archetype conflict. Original AI niche: ${current_niche}. ` +
        `niche_override set to prevent re-classification from reverting this fix.`,
        channel_id,
      ],
    );

    // Invalidate WTP cache so next WTP request recomputes with new niche
    db.run(`DELETE FROM channel_wtp_cache WHERE channel_id = ?`, [channel_id]);
    enqueueRefreshJob(db, { job_type: 'wtp_cache', channel_id, priority: 50, reason: 'post_reclassification' });

    db.run(
      `UPDATE classification_repair_candidates SET
         status = 'auto_repaired',
         repaired_at = ?,
         repair_applied = ?
       WHERE channel_id = ?`,
      [now, `niche: ${current_niche} → ${suggested_niche} (niche_override set)`, channel_id],
    );

    return {
      applied: true,
      action:  `niche_override + primary_niche: ${current_niche} → ${suggested_niche}`,
    };
  }

  if (repair_reason === 'raw_niche_mismatch') {
    // Degrade AI confidence by 0.2 — this makes the next identity re-detection
    // run treat this channel as low-confidence and prioritise re-classification.
    db.run(
      `UPDATE ingested_channels SET
         identity_confidence = MAX(COALESCE(identity_confidence, 0.95) - 0.20, 0.15)
       WHERE channel_id = ?`,
      [channel_id],
    );
    db.run(
      `UPDATE classification_repair_candidates SET status = 'queued' WHERE channel_id = ?`,
      [channel_id],
    );
    return {
      applied: false,
      action:  'identity_confidence degraded −0.20, queued for AI reclassification',
    };
  }

  if (repair_reason === 'behavior_tag_mismatch') {
    // Degrade by 0.15 per conflicting tag signal (capped at one step down)
    db.run(
      `UPDATE ingested_channels SET
         identity_confidence = MAX(COALESCE(identity_confidence, 0.95) - 0.15, 0.15)
       WHERE channel_id = ?`,
      [channel_id],
    );
    db.run(
      `UPDATE classification_repair_candidates SET status = 'queued' WHERE channel_id = ?`,
      [channel_id],
    );
    return {
      applied: false,
      action:  'identity_confidence degraded −0.15, queued for AI reclassification',
    };
  }

  return { applied: false, action: `unknown repair_reason: ${repair_reason}` };
}

// ── Candidate scan ────────────────────────────────────────────────────────────

/**
 * Scans all enabled channels and returns repair candidates sorted by impact.
 *
 * @param {object} db - Read-only or writable database handle
 * @param {object} options
 * @param {number}  [options.minSubs=0]     - Minimum subscriber count
 * @param {number}  [options.limit=Infinity] - Max candidates to return
 * @returns {Array}
 */
function buildRepairCandidates(db, options = {}) {
  const { minSubs = 0, limit = Infinity } = options;

  const subsClause = minSubs > 0 ? `AND channel_subscribers >= ${minSubs}` : '';
  const channels = db.all(
    `SELECT channel_id, channel_name, primary_niche, secondary_niche, niche,
            content_archetype, format_type, identity_confidence, identity_strength,
            identity_source, niche_override, behavior_tags, channel_subscribers
     FROM ingested_channels
     WHERE ingest_enabled = 1 ${subsClause}`,
    [],
  );

  const candidates = [];

  for (const ch of channels) {
    // Skip channels already protected by an operator override
    if (ch.niche_override && ch.identity_source !== 'auto_repair') continue;

    const candidate = detectCandidate(ch);
    if (!candidate) continue;

    const subs       = ch.channel_subscribers || 0;
    const impact     = Math.log10(subs + 1) * (100 - candidate.confidence);

    candidates.push({
      channel_id:          ch.channel_id,
      channel_name:        ch.channel_name,
      current_niche:       ch.primary_niche,
      suggested_niche:     candidate.suggested_niche,
      confidence:          candidate.confidence,
      repair_reason:       candidate.repair_reason,
      repair_priority:     candidate.repair_priority,
      conflict_detail:     candidate.conflict_detail,
      conflict_flags:      candidate.conflict_flags,
      content_archetype:   ch.content_archetype,
      format_type:         ch.format_type,
      channel_subscribers: subs,
      impact_score:        Math.round(impact * 100) / 100,
    });
  }

  // Sort: priority ASC, then impact DESC within each priority
  candidates.sort((a, b) =>
    a.repair_priority !== b.repair_priority
      ? a.repair_priority - b.repair_priority
      : b.impact_score - a.impact_score,
  );

  return Number.isFinite(limit) ? candidates.slice(0, limit) : candidates;
}

module.exports = {
  HARD_CONFLICT_PAIRS,
  BTAG_NICHE_SIGNALS,
  CLOSE_NICHE_GROUPS,
  NICHE_VOCAB,
  areNichesClose,
  detectCandidate,
  ensureRepairTable,
  repairClassificationCandidate,
  buildRepairCandidates,
};

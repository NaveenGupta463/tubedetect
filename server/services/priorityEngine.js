'use strict';

/**
 * Priority Engine — Phase XI Quota Intelligence
 *
 * Scores channels for ingestion priority so daily API quota is spent
 * on the highest-value corpus additions first.
 *
 * QUOTA RULE: Never ingest a low-priority channel when high-priority
 * channels remain un-ingested. Protect budget for user-triggered actions.
 */

const { updateCorpusChannelPriority } = require('../db/corpusQueries');
const { calculateDiversityDiscount, calculateSemanticNovelty } = require('./diversityPressureEngine');

// ── Score components ──────────────────────────────────────────────────────────

// How much does this channel add to subscriber authority coverage? (0–20)
function scoreSubscriberAuthority(subscriberCount) {
  const subs = subscriberCount ?? 0;
  if (subs === 0) return 0;
  // Log-normalized: 1K subs → ~6, 100K → ~12, 1M → ~16, 10M → ~20
  return Math.min(20, Math.log10(subs + 1) / Math.log10(10_000_000) * 20);
}

// How underrepresented is this channel's niche in the corpus? (0–20)
function scoreNicheCoverageGap(db, niche) {
  if (!niche) return 5;
  const { getDb } = require('../db/init');
  const database = db || getDb();
  const count = database.get(
    'SELECT COUNT(*) AS n FROM corpus_channels WHERE niche = ? AND training_eligible = 1',
    [niche],
  )?.n ?? 0;
  // Fewer training channels in this niche → higher priority
  if (count === 0)  return 20;
  if (count < 5)    return 16;
  if (count < 15)   return 10;
  if (count < 50)   return 5;
  return 2;
}

// How unique is this channel semantically? (0–20)
function scoreSemanticUniqueness(channel) {
  const status = channel.semantic_status ?? 'pending';
  if (status === 'pending')   return 20; // not yet embedded → high value to process
  if (status === 'embedded')  return 12;
  if (status === 'clustered') return 5;
  if (status === 'mapped')    return 2;
  return 10;
}

// Was this channel recently active (fresh content)? (0–15)
function scoreRecency(lastIngestedAt) {
  if (!lastIngestedAt) return 15; // never ingested → definitely needs it
  const hoursAgo = (Date.now() - new Date(lastIngestedAt).getTime()) / 3_600_000;
  if (hoursAgo < 24)   return 0;  // just ingested
  if (hoursAgo < 168)  return 5;  // < 1 week
  if (hoursAgo < 720)  return 10; // < 1 month
  return 15;
}

// How often has a user searched for or opened this channel? (0–15)
// Derived from channel_cache hits and any user search signals.
function scoreUserDemand(db, channelId) {
  if (!db) return 5;
  const { getDb } = require('../db/init');
  const database = db || getDb();
  // Proxy: is this channel in channel_cache (means user opened it)?
  const inCache = database.get('SELECT 1 FROM channel_cache WHERE channel_id = ?', [channelId]);
  return inCache ? 12 : 5;
}

// Discovery source freshness bonus (0–10)
function scoreDiscoverySource(discoverySource) {
  const src = discoverySource ?? 'manual';
  if (src === 'user_search')       return 10;
  if (src === 'semantic_expansion') return 8;
  if (src === 'related_channel')   return 6;
  if (src === 'manual')            return 4;
  return 3;
}

// ── Main scoring function ─────────────────────────────────────────────────────

function calculatePriorityScore(db, channel) {
  const authority  = scoreSubscriberAuthority(channel.subscriber_count);
  const niche      = scoreNicheCoverageGap(db, channel.niche);
  const semantic   = scoreSemanticUniqueness(channel);
  const recency    = scoreRecency(channel.last_ingested_at);
  const demand     = scoreUserDemand(db, channel.channel_id);
  const source     = scoreDiscoverySource(channel.discovery_source);

  const rawTotal = Math.min(100, Math.round(authority + niche + semantic + recency + demand + source));

  // Apply diversity pressure: channels in oversaturated niches get a soft discount
  let diversity_discount = 1.0;
  try { diversity_discount = calculateDiversityDiscount(db, channel); } catch (_) {}

  // Novelty boost: blend in semantic novelty (0-100) as a small positive signal
  let noveltyBonus = 0;
  try {
    const novelty = channel.semantic_novelty_score ?? calculateSemanticNovelty(db, channel);
    noveltyBonus = Math.round((novelty / 100) * 5); // up to +5 pts
  } catch (_) {}

  const total = Math.min(100, Math.round(rawTotal * diversity_discount + noveltyBonus));
  return total;
}

function updateChannelPriority(db, channel) {
  const score = calculatePriorityScore(db, channel);
  updateCorpusChannelPriority(db, channel.channel_id, score);
  return score;
}

// ── Batch re-scoring ──────────────────────────────────────────────────────────

function rescoreAllChannels(db) {
  const { getDb } = require('../db/init');
  const database  = db || getDb();
  const channels  = database.all('SELECT * FROM corpus_channels LIMIT 5000');
  let updated = 0;
  database.run('BEGIN');
  try {
    for (const ch of channels) {
      const score = calculatePriorityScore(database, ch);
      updateCorpusChannelPriority(database, ch.channel_id, score);
      updated++;
    }
    database.run('COMMIT');
  } catch (e) {
    database.run('ROLLBACK');
    throw e;
  }
  return { updated };
}

// ── Quota allocation planner ──────────────────────────────────────────────────

function planQuotaAllocation(totalQuotaAvailable) {
  return {
    user_actions:          Math.floor(totalQuotaAvailable * 0.20),
    corpus_expansion:      Math.floor(totalQuotaAvailable * 0.50),
    refresh_update:        Math.floor(totalQuotaAvailable * 0.20),
    experimental_discovery: Math.floor(totalQuotaAvailable * 0.10),
  };
}

// How many channels can we fully light-ingest with a given quota?
// Light ingest: channels.list (1 unit/50) + playlistItems (1 unit/50) + videos.list (1 unit/50) ≈ 3 units/channel
function estimateChannelCapacity(quotaBudget) {
  return Math.floor(quotaBudget / 3);
}

module.exports = {
  calculatePriorityScore,
  updateChannelPriority,
  rescoreAllChannels,
  planQuotaAllocation,
  estimateChannelCapacity,
  scoreNicheCoverageGap,
  scoreSubscriberAuthority,
};

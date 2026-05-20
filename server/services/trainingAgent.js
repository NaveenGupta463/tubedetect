'use strict';

/**
 * Training Agent — Phase XI Behavioral Gate
 *
 * Controls which corpus channels are allowed to influence:
 *   - niche benchmarks
 *   - validator scoring
 *   - strategy recommendations
 *   - semantic cluster performance overlays
 *
 * ARCHITECTURAL RULE: Raw ingestion NEVER directly affects training.
 * All promotion/demotion decisions go through this agent.
 */

const {
  getAllCorpusChannels,
  promoteCorpusChannelTraining,
  demoteCorpusChannelTraining,
  getCorpusQualityState,
} = require('../db/corpusQueries');
const { evaluateChannelQuality, TRAINING_QUALITY_THRESHOLD, TRAINING_MIN_SAMPLE_SIZE } = require('./qualityAgent');

const DEMOTION_THRESHOLD = TRAINING_QUALITY_THRESHOLD - 10; // grace band before demotion

// ── Single channel operations ─────────────────────────────────────────────────

function promoteToTrainingCorpus(db, channelId) {
  const qs = getCorpusQualityState(db, channelId);
  if (!qs) return { promoted: false, reason: 'no_quality_state' };

  if (qs.is_spam)    return { promoted: false, reason: 'spam' };
  if (qs.is_ai_slop) return { promoted: false, reason: 'ai_slop' };
  if (qs.quality_score < TRAINING_QUALITY_THRESHOLD)
    return { promoted: false, reason: `quality_too_low:${qs.quality_score}` };
  if (qs.sample_size < TRAINING_MIN_SAMPLE_SIZE)
    return { promoted: false, reason: `insufficient_sample:${qs.sample_size}` };

  promoteCorpusChannelTraining(db, channelId);
  return { promoted: true, quality_score: qs.quality_score, sample_size: qs.sample_size };
}

function demoteTrainingCorpus(db, channelId, reason = 'manual') {
  demoteCorpusChannelTraining(db, channelId);
  return { demoted: true, channel_id: channelId, reason };
}

// ── Batch operations ──────────────────────────────────────────────────────────

function recalculateTrainingTrust(db) {
  const promoted = [];
  const demoted  = [];
  const skipped  = [];

  // Re-evaluate ALL corpus channels currently eligible
  const eligibleNow = getAllCorpusChannels(db, { training_eligible: true, limit: 5000 });
  for (const ch of eligibleNow) {
    const qs = getCorpusQualityState(db, ch.channel_id);
    if (!qs) { skipped.push(ch.channel_id); continue; }

    const shouldStay = (
      !qs.is_spam &&
      !qs.is_ai_slop &&
      qs.quality_score >= DEMOTION_THRESHOLD
    );
    if (!shouldStay) {
      demoteCorpusChannelTraining(db, ch.channel_id);
      demoted.push({ channel_id: ch.channel_id, quality_score: qs.quality_score });
    }
  }

  // Promote candidates that are now eligible but weren't before
  const candidates = getAllCorpusChannels(db, { training_eligible: false, min_quality: TRAINING_QUALITY_THRESHOLD, limit: 5000 });
  for (const ch of candidates) {
    const qs = getCorpusQualityState(db, ch.channel_id);
    if (!qs) { skipped.push(ch.channel_id); continue; }
    if (!qs.is_spam && !qs.is_ai_slop && qs.sample_size >= TRAINING_MIN_SAMPLE_SIZE) {
      promoteCorpusChannelTraining(db, ch.channel_id);
      promoted.push({ channel_id: ch.channel_id, quality_score: qs.quality_score });
    }
  }

  return { promoted: promoted.length, demoted: demoted.length, skipped: skipped.length, details: { promoted, demoted } };
}

function buildTrustedTrainingSet(db, { niche, limit = 1000 } = {}) {
  const channels = getAllCorpusChannels(db, { training_eligible: true, niche, limit });
  return channels.filter(ch => !ch.is_spam && !ch.is_low_quality);
}

function runFullEvaluationPass(db, channels) {
  const results = { promoted: 0, demoted: 0, unchanged: 0, errors: 0 };

  for (const ch of channels) {
    try {
      const qs     = evaluateChannelQuality(db, ch);
      const wasEligible = ch.training_eligible === 1;
      const nowEligible = qs.training_eligible;

      if (!wasEligible && nowEligible) {
        promoteCorpusChannelTraining(db, ch.channel_id);
        results.promoted++;
      } else if (wasEligible && !nowEligible) {
        demoteCorpusChannelTraining(db, ch.channel_id);
        results.demoted++;
      } else {
        results.unchanged++;
      }
    } catch (e) {
      console.warn(`[trainingAgent] Error evaluating ${ch.channel_id}:`, e.message);
      results.errors++;
    }
  }

  return results;
}

async function runFullEvaluationPassAsync(db, channels) {
  const results = { promoted: 0, demoted: 0, unchanged: 0, errors: 0 };

  for (let i = 0; i < channels.length; i++) {
    const ch = channels[i];
    try {
      const qs          = evaluateChannelQuality(db, ch);
      const wasEligible = ch.training_eligible === 1;
      const nowEligible = qs.training_eligible;

      if (!wasEligible && nowEligible) {
        promoteCorpusChannelTraining(db, ch.channel_id);
        results.promoted++;
      } else if (wasEligible && !nowEligible) {
        demoteCorpusChannelTraining(db, ch.channel_id);
        results.demoted++;
      } else {
        results.unchanged++;
      }
    } catch (e) {
      console.warn(`[trainingAgent] Error evaluating ${ch.channel_id}:`, e.message);
      results.errors++;
    }
    if (i % 20 === 0) await new Promise(r => setImmediate(r));
  }

  return results;
}

module.exports = {
  promoteToTrainingCorpus,
  demoteTrainingCorpus,
  recalculateTrainingTrust,
  buildTrustedTrainingSet,
  runFullEvaluationPass,
  runFullEvaluationPassAsync,
};

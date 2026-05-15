'use strict';

const { getCorpusQualityState, getCorpusVideosByChannel } = require('../db/corpusQueries');

const TRUST_PROMOTION_THRESHOLD = 55;
const MIN_PROBATION_DAYS = 14;

function calculateTrainingTrust(db, channel) {
  const channelId = channel.channel_id;
  const qs = getCorpusQualityState(db, channelId);
  const videos = getCorpusVideosByChannel(db, channelId, 50);

  const createdAt = channel.created_at ? new Date(channel.created_at) : new Date();
  const daysInCorpus = Math.max(0, Math.floor((Date.now() - createdAt.getTime()) / 86400000));

  const qualityScore = qs ? (qs.quality_score || 0) : 0;
  const clickbaitScore = qs ? (qs.clickbait_score || 0) : 0;
  const isSpam = qs ? (qs.is_spam || channel.is_spam || 0) : (channel.is_spam || 0);
  const isAiSlop = qs ? (qs.is_ai_slop || channel.is_ai_slop || 0) : (channel.is_ai_slop || 0);
  const isUnstable = qs ? (qs.is_unstable || 0) : 0;

  // Factor 1: Quality gate (0-25)
  const qualityFactor = Math.round((qualityScore / 100) * 25);

  // Factor 2: Temporal maturity (0-20)
  const temporalFactor = Math.round(Math.min(20, (daysInCorpus / 30) * 20));

  // Factor 3: Engagement stability (0-15)
  let stabilityFactor = 5;
  if (videos.length >= 3) {
    const vphs = videos.map(v => v.vph || 0).filter(v => v > 0);
    if (vphs.length >= 3) {
      const mean = vphs.reduce((a, b) => a + b, 0) / vphs.length;
      if (mean > 0) {
        const variance = vphs.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / vphs.length;
        const cv = Math.sqrt(variance) / mean;
        if (cv < 0.5) stabilityFactor = 15;
        else if (cv < 1.0) stabilityFactor = 11;
        else if (cv < 2.0) stabilityFactor = 7;
        else if (cv < 4.0) stabilityFactor = 4;
        else stabilityFactor = 2;
      }
    }
  }

  // Factor 4: Semantic cohesion (0-15)
  let semanticFactor = 0;
  if (channel.niche && channel.niche !== 'other') semanticFactor += 7;
  const semStatus = channel.semantic_status || '';
  if (semStatus === 'clustered' || semStatus === 'mapped') semanticFactor += 5;
  else if (semStatus === 'embedded') semanticFactor += 3;
  if (channel.handle) semanticFactor += 3;

  // Factor 5: Archetype consistency (0-10)
  let archetypeFactor = 10;
  if (isAiSlop) archetypeFactor -= 5;
  if (isUnstable) archetypeFactor -= 4;
  if (clickbaitScore > 6) archetypeFactor -= 3;
  archetypeFactor = Math.max(0, archetypeFactor);

  // Factor 6: Sample adequacy (0-10)
  const sampleFactor = Math.min(10, Math.round((videos.length / 20) * 10));

  // Factor 7: Low outrage (0-5)
  const outageFactor = Math.max(0, 5 - Math.round((clickbaitScore / 10) * 5));

  const trustScore = Math.min(100, qualityFactor + temporalFactor + stabilityFactor + semanticFactor + archetypeFactor + sampleFactor + outageFactor);

  const trustMaturityScore = Math.min(100, Math.round(
    (daysInCorpus / 60) * 40 +
    (Math.min(videos.length, 30) / 30) * 30 +
    (trustScore / 100) * 30
  ));

  const meetsMinimums = daysInCorpus >= 14 && videos.length >= 5 && !isSpam && !isAiSlop;
  const eligibleForPromotion = meetsMinimums && trustScore >= TRUST_PROMOTION_THRESHOLD;

  return {
    trust_score: trustScore,
    trust_maturity_score: trustMaturityScore,
    meets_minimums: meetsMinimums,
    eligible_for_promotion: eligibleForPromotion,
    days_in_corpus: daysInCorpus,
    video_sample_size: videos.length,
    factors: {
      quality_gate: qualityFactor,
      temporal_maturity: temporalFactor,
      engagement_stability: stabilityFactor,
      semantic_cohesion: semanticFactor,
      archetype_consistency: archetypeFactor,
      sample_adequacy: sampleFactor,
      low_outrage: outageFactor
    }
  };
}

function promoteToTrainingCorpus(db, channelId) {
  const channel = db.get('SELECT * FROM corpus_channels WHERE channel_id = ?', [channelId]);
  if (!channel) return { promoted: false, reason: 'channel_not_found', trust_score: 0 };

  const trust = calculateTrainingTrust(db, channel);

  if (!trust.eligible_for_promotion) {
    const reason = !trust.meets_minimums ? 'minimums_not_met' : 'trust_score_below_threshold';
    return { promoted: false, reason, trust_score: trust.trust_score };
  }

  db.run(
    'UPDATE corpus_channels SET training_eligible = 1, probation_state = 0 WHERE channel_id = ?',
    [channelId]
  );

  return { promoted: true, reason: 'eligible', trust_score: trust.trust_score };
}

function demoteTrainingCorpus(db, channelId, reason) {
  db.run(
    'UPDATE corpus_channels SET training_eligible = 0, probation_state = 1 WHERE channel_id = ?',
    [channelId]
  );
  return { demoted: true, reason };
}

function enterProbation(db, channelId) {
  db.run(
    'UPDATE corpus_channels SET probation_state = 1 WHERE channel_id = ?',
    [channelId]
  );
}

function initializeProbation(db) {
  db.run(
    'UPDATE corpus_channels SET probation_state = 1 WHERE probation_state IS NULL AND training_eligible = 0'
  );
  const row = db.get(
    'SELECT COUNT(*) as cnt FROM corpus_channels WHERE probation_state = 1 AND training_eligible = 0'
  );
  return row ? row.cnt : 0;
}

function runTrustEvaluationPass(db, channels) {
  const result = { promoted: 0, demoted: 0, entered_probation: 0, unchanged: 0, errors: 0 };

  for (const channel of channels) {
    try {
      const trust = calculateTrainingTrust(db, channel);
      const isCurrentlyEligible = channel.training_eligible === 1;
      const inProbation = channel.probation_state === 1;

      if (!isCurrentlyEligible && trust.eligible_for_promotion) {
        db.run(
          'UPDATE corpus_channels SET training_eligible = 1, probation_state = 0 WHERE channel_id = ?',
          [channel.channel_id]
        );
        result.promoted++;
      } else if (isCurrentlyEligible && trust.trust_score < TRUST_PROMOTION_THRESHOLD - 10) {
        db.run(
          'UPDATE corpus_channels SET training_eligible = 0, probation_state = 1 WHERE channel_id = ?',
          [channel.channel_id]
        );
        result.demoted++;
      } else if (!isCurrentlyEligible && !inProbation && !trust.meets_minimums) {
        enterProbation(db, channel.channel_id);
        result.entered_probation++;
      } else {
        result.unchanged++;
      }
    } catch (e) {
      result.errors++;
    }
  }

  return result;
}

module.exports = {
  TRUST_PROMOTION_THRESHOLD,
  MIN_PROBATION_DAYS,
  calculateTrainingTrust,
  promoteToTrainingCorpus,
  demoteTrainingCorpus,
  runTrustEvaluationPass,
  enterProbation,
  initializeProbation
};

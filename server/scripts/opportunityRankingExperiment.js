'use strict';

/**
 * Phase 5 — Opportunity Ranking Experiment
 *
 * A/B comparison of current ranking vs opportunity-boosted ranking.
 *
 * For each channel in wtp_generation_traces:
 *   Control:    rank by score (current)
 *   Treatment:  rank by score + opportunity_bonus
 *
 * opportunity_bonus only applies to VALIDATED opportunities (from Phase 3):
 *   diet_nutrition      → +8
 *   workout_challenge   → +8
 *   street_food_hunt    → +6
 *
 * Only applies to dna_original_bets and peer_video_signal sources.
 * angle_gap is EXCLUDED (Phase 3 showed 0% positive for all angle_gap opps).
 *
 * Measures:
 *   - Does A/B change which ideas surface in top-5?
 *   - Do boosted ideas have higher gold-label quality than displaced ideas?
 *   - What % of channels are affected?
 *
 * Does NOT ship any ranking changes — observational only.
 *
 * Usage:
 *   node opportunityRankingExperiment.js [--channels=N] [--verbose]
 */

const path = require('path');
const BetterSqlite3 = require('../node_modules/better-sqlite3');

function openDb() {
  return new BetterSqlite3(path.resolve(__dirname, '../data/scoring.db'), {
    readonly: true,
    timeout:  60000,
  });
}

function pct(n, d) { return d > 0 ? (n / d * 100).toFixed(1) : '0.0'; }
function mean(arr) { return arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0; }

// ── Validated opportunity bonuses (Phase 3 result) ────────────────────────────
const OPPORTUNITY_BONUS = {
  diet_nutrition:    8,
  workout_challenge: 8,
  street_food_hunt:  6,
};

// Sources eligible for opportunity bonus (angle_gap excluded)
const ELIGIBLE_SOURCES = new Set(['dna_original_bets', 'peer_video_signal']);

// Gold label scores for measuring quality impact
const LABEL_SCORE = { Excellent: 5, Good: 4, Average: 3, Poor: 2, Garbage: 1 };

function applyBonus(trace) {
  if (!ELIGIBLE_SOURCES.has(trace.rec_source)) return 0;
  if (!trace.opportunity_id) return 0;
  return OPPORTUNITY_BONUS[trace.opportunity_id] || 0;
}

function main() {
  const db      = openDb();
  const verbose = process.argv.includes('--verbose');
  const maxCh   = parseInt((process.argv.find(a => a.startsWith('--channels=')) || '--channels=200').split('=')[1], 10) || 200;

  // Load all recent traces with scores, grouped by channel
  const traces = db.prepare(`
    SELECT
      t.id, t.channel_id, t.rec_source, t.generated_title,
      t.opportunity_id, t.opportunity_label, t.opportunity_confidence,
      t.dna_affinity_score, t.concept_id,
      COALESCE(t.dna_affinity_score, 0) as base_score,
      r.human_label
    FROM wtp_generation_traces t
    LEFT JOIN wtp_human_quality_reviews r ON r.trace_id = t.id AND r.human_label IS NOT NULL
    WHERE t.channel_id IS NOT NULL
      AND t.generated_title IS NOT NULL
    ORDER BY t.channel_id, t.created_at DESC
  `).all();

  // Group by channel, keep only latest 25 per channel (what WTP returns)
  const byChannel = {};
  for (const trace of traces) {
    if (!byChannel[trace.channel_id]) byChannel[trace.channel_id] = [];
    if (byChannel[trace.channel_id].length < 25) {
      byChannel[trace.channel_id].push(trace);
    }
  }

  const channelIds = Object.keys(byChannel).slice(0, maxCh);

  console.log('\n══════════════════════════════════════════════════════════════');
  console.log('  Phase 5 — Opportunity Ranking Experiment (A/B)');
  console.log(`  Channels: ${channelIds.length}   Validated bonuses: ${Object.keys(OPPORTUNITY_BONUS).join(', ')}`);
  console.log('  Sources eligible for bonus: dna_original_bets, peer_video_signal');
  console.log('  angle_gap EXCLUDED (Phase 3: 0% positive rate for all angle_gap opps)');
  console.log('══════════════════════════════════════════════════════════════\n');

  // ── Run experiment ─────────────────────────────────────────────────────────
  let channelsAffected    = 0;
  let totalSwaps          = 0;
  let totalBoostedIdeas   = 0;
  let top5ControlLabels   = [];
  let top5TreatLabels     = [];
  const swapExamples      = [];

  for (const channelId of channelIds) {
    const pool = byChannel[channelId];
    if (pool.length < 3) continue;

    // Control: rank by base_score DESC
    const controlRanked = [...pool].sort((a, b) => (b.base_score || 0) - (a.base_score || 0));
    const controlTop5   = controlRanked.slice(0, 5);

    // Treatment: rank by base_score + opportunity_bonus DESC
    const treatmentRanked = [...pool].sort((a, b) => {
      const aScore = (a.base_score || 0) + applyBonus(a);
      const bScore = (b.base_score || 0) + applyBonus(b);
      return bScore - aScore;
    });
    const treatmentTop5 = treatmentRanked.slice(0, 5);

    // Detect swaps (ideas in control top-5 not in treatment top-5)
    const controlIds   = new Set(controlTop5.map(t => t.id));
    const treatmentIds = new Set(treatmentTop5.map(t => t.id));
    const swapped      = controlTop5.filter(t => !treatmentIds.has(t.id)).length;

    if (swapped > 0) {
      channelsAffected++;
      totalSwaps += swapped;

      if (verbose && swapExamples.length < 5) {
        const boosted = treatmentTop5.filter(t => !controlIds.has(t.id));
        for (const b of boosted) {
          swapExamples.push({
            channel_id:   channelId,
            boosted_title: b.generated_title,
            opportunity:   b.opportunity_id,
            bonus:         applyBonus(b),
          });
        }
      }
    }

    // Count boosted ideas (any idea that got a bonus)
    const boostedInTreatment = treatmentTop5.filter(t => applyBonus(t) > 0);
    totalBoostedIdeas += boostedInTreatment.length;

    // Collect quality scores for labelled rows in top-5
    for (const t of controlTop5)   if (t.human_label) top5ControlLabels.push(LABEL_SCORE[t.human_label] || 0);
    for (const t of treatmentTop5) if (t.human_label) top5TreatLabels.push(LABEL_SCORE[t.human_label] || 0);
  }

  // ── Results ────────────────────────────────────────────────────────────────
  const pctAffected  = pct(channelsAffected, channelIds.length);
  const avgSwapsPerCh = channelsAffected > 0 ? (totalSwaps / channelsAffected).toFixed(1) : '0';
  const avgBoostedPer = (totalBoostedIdeas / channelIds.length).toFixed(2);

  console.log('── 1. RANKING CHANGE IMPACT ──────────────────────────────────');
  console.log(`  Channels analysed:         ${channelIds.length}`);
  console.log(`  Channels affected (swaps): ${channelsAffected} (${pctAffected}%)`);
  console.log(`  Avg swaps per affected ch: ${avgSwapsPerCh}`);
  console.log(`  Avg boosted ideas in top5: ${avgBoostedPer}`);

  console.log('\n── 2. QUALITY IMPACT (labelled rows only) ─────────────────────');
  const controlQuality   = mean(top5ControlLabels);
  const treatmentQuality = mean(top5TreatLabels);
  const qualityDiff      = treatmentQuality - controlQuality;
  const labelCount       = Math.max(top5ControlLabels.length, top5TreatLabels.length);

  console.log(`  Labelled rows in top-5: ${labelCount}`);
  console.log(`  Control   avg quality:  ${controlQuality.toFixed(3)}`);
  console.log(`  Treatment avg quality:  ${treatmentQuality.toFixed(3)}`);
  console.log(`  Δ quality (treat-ctrl): ${qualityDiff > 0 ? '+' : ''}${qualityDiff.toFixed(3)}`);

  if (labelCount < 10) {
    console.log('\n  ⚠ Too few labelled rows in top-5 to measure quality impact reliably.');
    console.log('  (Only rows with trace_id in wtp_human_quality_reviews have labels)');
  } else if (qualityDiff > 0.1) {
    console.log('  ✓ Treatment improves quality — opportunity bonus is lifting better content.');
  } else if (qualityDiff < -0.1) {
    console.log('  ✗ Treatment hurts quality — opportunity bonus is displacing better content.');
  } else {
    console.log('  ~ No measurable quality change — bonus is rearranging equally-good content.');
  }

  // ── 3. Bonus distribution ─────────────────────────────────────────────────
  console.log('\n── 3. OPPORTUNITY BONUS DISTRIBUTION ──────────────────────────');
  const bonusByOpp = {};
  for (const ch of channelIds) {
    for (const t of byChannel[ch] || []) {
      const bonus = applyBonus(t);
      if (bonus > 0) {
        const k = t.opportunity_id;
        bonusByOpp[k] = (bonusByOpp[k] || 0) + 1;
      }
    }
  }
  for (const [opp, count] of Object.entries(bonusByOpp).sort((a, b) => b[1] - a[1])) {
    const bonus = OPPORTUNITY_BONUS[opp];
    console.log(`  ${opp.padEnd(24)} bonus=+${bonus}  traces_eligible=${count}`);
  }
  if (Object.keys(bonusByOpp).length === 0) {
    console.log('  No validated opportunities found in the sampled channel traces.');
    console.log('  The 3 validated opportunities (diet_nutrition, workout_challenge, street_food_hunt)');
    console.log('  may not appear in the first 200 channels by creation order.');
  }

  // ── 4. Sample swaps ───────────────────────────────────────────────────────
  if (verbose && swapExamples.length > 0) {
    console.log('\n── 4. SAMPLE SWAPS ──────────────────────────────────────────');
    for (const ex of swapExamples) {
      console.log(`  Channel: ${ex.channel_id}`);
      console.log(`    Boosted: "${ex.boosted_title.slice(0, 60)}" [${ex.opportunity} +${ex.bonus}]`);
    }
  }

  // ── Verdict ───────────────────────────────────────────────────────────────
  console.log('\n══════════════════════════════════════════════════════════════');
  console.log('  RANKING EXPERIMENT VERDICT');
  console.log(`  Channels affected: ${pctAffected}%`);
  console.log(`  Quality delta:     ${qualityDiff > 0 ? '+' : ''}${qualityDiff.toFixed(3)}`);
  console.log(`  Labelled data:     ${labelCount} rows`);
  console.log('');

  if (labelCount < 10) {
    console.log('  INCONCLUSIVE — insufficient labelled data in experiment window.');
    console.log('  Action: Complete human labelling of all 200 rows, then re-run.');
  } else if (qualityDiff > 0.1 && channelsAffected / channelIds.length > 0.05) {
    console.log('  SHIP CANDIDATE — improvement is measurable and meaningful.');
    console.log('  Validated bonuses: ' + Object.keys(OPPORTUNITY_BONUS).join(', '));
  } else {
    console.log('  DO NOT SHIP — improvement not yet measurable.');
    console.log('  Collect more gold labels, especially for fitness/food DNA channels.');
  }
  console.log('══════════════════════════════════════════════════════════════\n');

  db.close();
}

main();

'use strict';

/**
 * Narrative Affinity Monitor — Narrative Affinity Validation mode
 *
 * Tracks whether the Path A finding (Excellent peer recs have creator concept
 * affinity) remains stable as the label pool grows.
 *
 * Run periodically. Each run appends a snapshot to narrative_affinity_log.json.
 *
 * Statistical tracking added (June 14, 2026):
 *   - Wilson 95% CI  : correct proportion interval at small n (n=10 gives [72%, 100%])
 *   - Trend slope    : linear regression over all snapshots' excellent_affinity_rate
 *   - Rolling avg    : mean of last 5 snapshots (smooths run-to-run noise)
 *   - Stability verdict: STABLE / DEGRADING / INSUFFICIENT_DATA
 *
 * SUCCESS CONDITION: stability above 50%, not 100% at n=10.
 *
 * Gates:
 *   Gate 1  Excellent labels >= 100
 *   Gate 2  V2 DNA traces   >= 1000
 *   Gate 3  Excellent affinity_rate > 50% (stable, CI lower bound > 50%)
 *
 * Usage: node narrativeAffinityMonitor.js [--verbose]
 */

const path = require('path');
const fs   = require('fs');
const Database = require('../node_modules/better-sqlite3');
const { computeConceptAffinity } = require('../services/conceptNormalizer');

const DB_PATH  = path.resolve(__dirname, '../data/scoring.db');
const LOG_PATH = path.resolve(__dirname, 'narrative_affinity_log.json');

const V2_CUTOFF              = '2026-06-14';
const V2_MIN                 = 1000;
const GATE1_EXCELLENT_MIN    = 100;
const GATE3_RATE_MIN         = 0.50;
const ROLLING_WINDOW         = 5;
const VERBOSE                = process.argv.includes('--verbose');

// ── Statistics helpers ────────────────────────────────────────────────────────

function avg(arr) {
  return arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0;
}

/**
 * Wilson score 95% confidence interval for a proportion.
 * More accurate than Wald (p ± 1.96*SE) at small n or extreme p (0 or 1).
 * Returns [lower, upper] each in [0, 1].
 */
function wilsonCI(successes, n, z = 1.96) {
  if (n === 0) return [0, 0];
  const p   = successes / n;
  const z2  = z * z;
  const denom = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denom;
  const margin = (z / denom) * Math.sqrt(p * (1 - p) / n + z2 / (4 * n * n));
  return [
    +Math.max(0, center - margin).toFixed(4),
    +Math.min(1, center + margin).toFixed(4),
  ];
}

/**
 * Linear regression slope over (x=0..n-1, y=values[]).
 * Positive = improving, negative = degrading, ~0 = stable.
 * Returns null if fewer than 2 points.
 */
function trendSlope(values) {
  const n = values.length;
  if (n < 2) return null;
  const xs = values.map((_, i) => i);
  const xMean = avg(xs);
  const yMean = avg(values);
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - xMean) * (values[i] - yMean);
    den += (xs[i] - xMean) ** 2;
  }
  return den === 0 ? 0 : +(num / den).toFixed(5);
}

/**
 * Stability verdict from slope + CI lower bound.
 *   INSUFFICIENT_DATA : fewer than 3 snapshots
 *   DEGRADING         : slope < -0.03 (dropping >3pp per run)
 *   STABLE            : CI lower > 50% AND slope >= -0.03
 *   UNCERTAIN         : CI lower <= 50% (could go either way)
 */
function stabilityVerdict(slope, ciLower, logLen) {
  if (logLen < 3)             return { label: 'INSUFFICIENT_DATA', emoji: '⏳' };
  if (slope !== null && slope < -0.03) return { label: 'DEGRADING',         emoji: '⚠️' };
  if (ciLower > GATE3_RATE_MIN) return { label: 'STABLE',            emoji: '✅' };
  return                             { label: 'UNCERTAIN',          emoji: '🔶' };
}

function pct(n, d) { return d ? (n / d * 100).toFixed(1) + '%' : '—'; }

// ── Main ──────────────────────────────────────────────────────────────────────

function main() {
  const db = new Database(DB_PATH, { readonly: true, timeout: 60000 });

  // Load labeled peer traces
  const labeledTraces = db.prepare(`
    SELECT
      t.id, t.channel_id, t.generated_title,
      t.peer_concept_id, t.peer_concept_label, t.peer_concept_confidence,
      t.peer_narrative, t.created_at, r.human_label
    FROM wtp_generation_traces t
    JOIN wtp_human_quality_reviews r ON r.trace_id = t.id
    WHERE t.rec_source = 'peer_video_signal'
      AND r.human_label IS NOT NULL
    ORDER BY r.human_label
  `).all();

  const v2Count = db.prepare(`
    SELECT COUNT(*) as n FROM wtp_generation_traces
    WHERE rec_source = 'dna_original_bets' AND created_at >= ?
  `).get(V2_CUTOFF).n;

  // Load creator DNA
  const dnaStmt  = db.prepare('SELECT * FROM creator_idea_dna WHERE channel_id = ?');
  const dnaCache = new Map();
  function safeJson(s, fb) { try { return s ? JSON.parse(s) : fb; } catch (_) { return fb; } }
  function getDna(channelId) {
    if (!dnaCache.has(channelId)) {
      const row = dnaStmt.get(channelId);
      dnaCache.set(channelId, row ? {
        ...row,
        entities:        safeJson(row.entities_json, []),
        micro_topics:    safeJson(row.micro_topics_json, []),
        hook_templates:  safeJson(row.hook_templates_json, []),
        thesis_patterns: safeJson(row.thesis_patterns_json, []),
        domain_tags:     safeJson(row.domain_tags_json, []),
        stable_dna:      safeJson(row.stable_dna_json, null),
      } : null);
    }
    return dnaCache.get(channelId);
  }

  // Compute affinity per trace
  const results = labeledTraces.map(row => {
    const dna = getDna(row.channel_id);
    const { affinity_score, affinity_reason } = (dna && row.peer_concept_id)
      ? computeConceptAffinity(dna, row.peer_concept_id)
      : { affinity_score: 0, affinity_reason: dna ? 'no_concept' : 'no_dna' };
    return { ...row, affinity_score, affinity_reason, affinity_pos: affinity_score > 0 };
  });

  db.close();

  // Aggregate by tier
  const tiers = ['Excellent', 'Good', 'Average', 'Poor', 'Garbage'];
  const byTier = {};
  for (const t of tiers) byTier[t] = results.filter(r => r.human_label === t);

  function tierStats(rows) {
    const n            = rows.length;
    const with_concept = rows.filter(r => r.peer_concept_id).length;
    const affinity_pos = rows.filter(r => r.affinity_pos).length;
    const scores       = rows.map(r => r.affinity_score);
    return {
      n,
      with_concept,
      affinity_pos,
      affinity_rate:  n ? affinity_pos / n : 0,
      avg_affinity:   avg(scores),
      max_affinity:   scores.length ? Math.max(...scores) : 0,
    };
  }

  const stats = {};
  for (const t of tiers) stats[t] = tierStats(byTier[t]);
  const poorGar = tierStats([...byTier['Poor'], ...byTier['Garbage']]);
  const exc      = stats['Excellent'];

  // Wilson CI for current Excellent affinity rate
  const [ciLower, ciUpper] = wilsonCI(exc.affinity_pos, exc.n);

  // Load existing log, build snapshot, compute trend stats
  const log = fs.existsSync(LOG_PATH) ? JSON.parse(fs.readFileSync(LOG_PATH, 'utf8')) : [];

  // Trend uses all prior runs + this run together
  const allRates  = [...log.map(s => s.excellent_affinity_rate), exc.affinity_rate];
  const slope     = trendSlope(allRates);
  const rollingN  = Math.min(ROLLING_WINDOW, allRates.length);
  const rollingAvg = +avg(allRates.slice(-rollingN)).toFixed(4);

  const ratio     = poorGar.avg_affinity > 0
    ? +(exc.avg_affinity / poorGar.avg_affinity).toFixed(2)
    : null;

  const now = new Date().toISOString();

  // Gate checks
  const gate1Met = exc.n  >= GATE1_EXCELLENT_MIN;
  const gate2Met = v2Count >= V2_MIN;
  const gate3Met = exc.affinity_rate >= GATE3_RATE_MIN;
  const allGatesMet = gate1Met && gate2Met && gate3Met;

  const { label: stabilityLabel, emoji: stabilityEmoji } =
    stabilityVerdict(slope, ciLower, log.length + 1);

  // ── Console output ────────────────────────────────────────────────────────

  process.stdout.write('\n══════════════════════════════════════════════════════════════\n');
  process.stdout.write('  Narrative Affinity Monitor\n');
  process.stdout.write(`  Run #${log.length + 1}  ${now.slice(0, 19).replace('T', ' ')} UTC\n`);
  process.stdout.write('══════════════════════════════════════════════════════════════\n\n');

  // Affinity table
  process.stdout.write('── Affinity by gold tier ─────────────────────────────────────\n');
  process.stdout.write(`  ${'Tier'.padEnd(10)} ${'n'.padEnd(6)} ${'aff>0%'.padEnd(10)} ${'avg_aff'.padEnd(10)} max_aff\n`);
  for (const t of tiers) {
    const s = stats[t];
    if (!s.n) continue;
    process.stdout.write(
      `  ${t.padEnd(10)} ${String(s.n).padEnd(6)} ` +
      `${pct(s.affinity_pos, s.n).padEnd(10)} ` +
      `${s.avg_affinity.toFixed(3).padEnd(10)} ` +
      `${s.max_affinity.toFixed(3)}\n`,
    );
  }

  // Stability block
  process.stdout.write('\n── Excellent affinity trend ──────────────────────────────────\n');
  process.stdout.write(`  Current rate:    ${(exc.affinity_rate * 100).toFixed(1)}%  (${exc.affinity_pos}/${exc.n})\n`);
  process.stdout.write(`  95% Wilson CI:   [${(ciLower * 100).toFixed(1)}%, ${(ciUpper * 100).toFixed(1)}%]`);
  process.stdout.write(`  ← lower bound ${ciLower > GATE3_RATE_MIN ? '> 50% ✅' : '≤ 50% ⚠️'}\n`);
  process.stdout.write(`  Rolling avg (${rollingN}):  ${(rollingAvg * 100).toFixed(1)}%\n`);
  if (slope !== null) {
    const slopeDir = slope > 0.005 ? '↗ improving' : slope < -0.005 ? '↘ degrading' : '→ flat';
    process.stdout.write(`  Trend slope:     ${slope >= 0 ? '+' : ''}${(slope * 100).toFixed(2)}pp/run  ${slopeDir}\n`);
  } else {
    process.stdout.write(`  Trend slope:     — (need ≥2 runs)\n`);
  }
  process.stdout.write(`  Poor+Gar avg:    ${poorGar.avg_affinity.toFixed(3)}\n`);
  process.stdout.write(`  Exc/Poor ratio:  ${ratio !== null ? ratio + 'x' : '∞'}\n`);
  process.stdout.write(`\n  Signal stability: ${stabilityEmoji} ${stabilityLabel}\n`);

  // Gate status
  process.stdout.write('\n── Gate status ───────────────────────────────────────────────\n');
  process.stdout.write(`  Gate 1  Excellent labels ≥ ${GATE1_EXCELLENT_MIN}:\n`);
  process.stdout.write(`    ${exc.n} / ${GATE1_EXCELLENT_MIN}  ${gate1Met ? '✅' : `⏳ need ${GATE1_EXCELLENT_MIN - exc.n} more`}\n`);
  process.stdout.write(`  Gate 2  V2 traces ≥ ${V2_MIN}:\n`);
  process.stdout.write(`    ${v2Count} / ${V2_MIN}  ${gate2Met ? '✅' : `⏳ need ${V2_MIN - v2Count} more`}\n`);
  process.stdout.write(`  Gate 3  Affinity rate > ${GATE3_RATE_MIN * 100}%  (stable):\n`);
  process.stdout.write(`    rate=${(exc.affinity_rate * 100).toFixed(1)}%  stability=${stabilityLabel}  ${gate3Met ? '✅ rate met' : '❌'}\n`);

  if (allGatesMet) {
    process.stdout.write('\n  ══ ALL GATES MET — run the four audits ══\n');
    process.stdout.write('    node scripts/narrativeAffinityMonitor.js\n');
    process.stdout.write('    node scripts/excellentCreatorFitAudit.js\n');
    process.stdout.write('    node scripts/generatorV2ImpactAudit.js\n');
    process.stdout.write('    node scripts/peerCreatorMatchAudit.js\n');
  }

  // Trend table (last 5 snapshots + current)
  if (log.length >= 1) {
    process.stdout.write('\n── History (last 5 runs) ─────────────────────────────────────\n');
    process.stdout.write(`  ${'#'.padEnd(5)} ${'Date'.padEnd(12)} ${'Exc_n'.padEnd(7)} ${'Rate'.padEnd(9)} ${'CI_low'.padEnd(9)} ${'Avg_aff'.padEnd(10)} Slope\n`);
    const recent = log.slice(-4);  // last 4 prior + current = 5 total
    const combined = [...recent, {
      run_at:                  now,
      excellent_n:             exc.n,
      excellent_affinity_rate: exc.affinity_rate,
      ci_lower:                ciLower,
      excellent_avg_affinity:  exc.avg_affinity,
      trend_slope:             slope,
    }];
    const startIdx = log.length - recent.length + 1;
    combined.forEach((s, i) => {
      const isCurrent = i === combined.length - 1;
      const runNum = startIdx + i;
      const slopeStr = s.trend_slope != null ? (s.trend_slope >= 0 ? '+' : '') + (s.trend_slope * 100).toFixed(2) + 'pp' : '—';
      process.stdout.write(
        `  ${String(runNum).padEnd(5)} ${s.run_at.slice(0, 10).padEnd(12)} ` +
        `${String(s.excellent_n).padEnd(7)} ` +
        `${(s.excellent_affinity_rate * 100).toFixed(1).padStart(5)}%`.padEnd(9) +
        `${s.ci_lower != null ? (s.ci_lower * 100).toFixed(1) + '%' : '—'.padEnd(6)}`.padEnd(9) +
        `${s.excellent_avg_affinity.toFixed(3).padEnd(10)} ` +
        `${slopeStr}${isCurrent ? '  ← now' : ''}\n`,
      );
    });
  }

  // Verbose: per-row Excellent detail
  if (VERBOSE) {
    process.stdout.write('\n── Excellent traces (per-row) ────────────────────────────────\n');
    for (const r of byTier['Excellent']) {
      process.stdout.write(`  [${r.peer_concept_id || 'NO_CONCEPT'}] aff=${r.affinity_score.toFixed(3)} ch=...${r.channel_id.slice(-8)}\n`);
      process.stdout.write(`    "${r.generated_title?.slice(0, 70)}"\n`);
      process.stdout.write(`    ${r.affinity_reason}\n`);
    }
  }

  // Append snapshot
  const snapshot = {
    run_at:                   now,
    run_number:               log.length + 1,
    total_labeled_peer:       results.length,
    excellent_n:              exc.n,
    excellent_affinity_pos:   exc.affinity_pos,
    excellent_affinity_rate:  +exc.affinity_rate.toFixed(4),
    excellent_avg_affinity:   +exc.avg_affinity.toFixed(4),
    ci_lower:                 ciLower,
    ci_upper:                 ciUpper,
    rolling_avg:              rollingAvg,
    trend_slope:              slope,
    stability:                stabilityLabel,
    good_n:                   stats['Good'].n,
    good_affinity_rate:       +stats['Good'].affinity_rate.toFixed(4),
    good_avg_affinity:        +stats['Good'].avg_affinity.toFixed(4),
    poor_gar_n:               poorGar.n,
    poor_gar_affinity_rate:   +poorGar.affinity_rate.toFixed(4),
    poor_gar_avg_affinity:    +poorGar.avg_affinity.toFixed(4),
    excellent_poor_ratio:     ratio,
    v2_trace_count:           v2Count,
    gate1_met:                gate1Met,
    gate2_met:                gate2Met,
    gate3_met:                gate3Met,
  };

  log.push(snapshot);
  fs.writeFileSync(LOG_PATH, JSON.stringify(log, null, 2));

  process.stdout.write('\n══════════════════════════════════════════════════════════════\n');
  process.stdout.write(`  Snapshot #${log.length} written → narrative_affinity_log.json\n\n`);
}

main();

'use strict';
// Phase A verification script — runs against live DB without touching the server.

const { Database } = require('node-sqlite3-wasm');
const path = require('path');

// Monkey-patch getDb so confidenceEngine and queries can use it standalone
const db = new Database(path.resolve(__dirname, '../data/scoring.db'));
require('../db/init').getDb = () => db;

// Apply schema migrations (creates new tables if missing)
const SCHEMA = require('../db/schema');
db.exec(SCHEMA);

const {
  FEATURES,
  computeFeatureConfidence,
  computeAllConfidences,
  computeRoutingDistribution,
  getActiveNiches,
} = require('../services/confidenceEngine');

const { runConfidenceSnapshot } = require('../jobs/learningConfidenceCron');

console.log('\n══════════════════════════════════════════════');
console.log('PHASE A — CONFIDENCE SYSTEM VERIFICATION');
console.log('══════════════════════════════════════════════\n');

// ── 1. Active niches ──────────────────────────────────────────────────────────
const niches = getActiveNiches(db);
console.log(`Active niches (${niches.length}): ${niches.join(', ')}\n`);

// ── 2. Sample confidence per feature (system-wide, niche=null) ───────────────
console.log('── System-wide confidence (niche=null) ──────────────────');
for (const feature of FEATURES) {
  const r = computeFeatureConfidence(db, { feature, niche: null });
  console.log(`  ${feature.padEnd(25)} score=${String(r.confidence).padStart(5)}  → ${r.routing_decision}`);
  console.log(`    components: depth=${r.components.sample_depth_score.toFixed(0)} recency=${r.components.recency_score.toFixed(0)} coverage=${r.components.coverage_score.toFixed(0)} real_ratio=${r.components.real_ratio_score.toFixed(0)} stability=${r.components.stability_score.toFixed(0)}`);
  console.log(`    reasons: ${r.reasons.join('; ')}`);
  if (r.raw) console.log(`    raw: ${JSON.stringify(r.raw)}`);
  console.log();
}

// ── 3. Two sample niches ──────────────────────────────────────────────────────
const sampleNiches = niches.slice(0, 3);
console.log(`\n── Per-niche sample (${sampleNiches.join(', ')}) ──────────────────`);
for (const niche of sampleNiches) {
  console.log(`\n  Niche: ${niche}`);
  for (const feature of FEATURES) {
    const r = computeFeatureConfidence(db, { feature, niche });
    console.log(`    ${feature.padEnd(25)} score=${String(r.confidence).padStart(5)}  → ${r.routing_decision}`);
  }
}

// ── 4. Routing distribution (all niches) ─────────────────────────────────────
const allResults = computeAllConfidences(db, [null, ...niches]);
const dist = computeRoutingDistribution(allResults.filter(r => r.niche !== null));
console.log('\n── System routing distribution (all features × all niches) ──');
console.log(JSON.stringify(dist, null, 2));

// ── 5. Low-confidence edge cases ──────────────────────────────────────────────
console.log('\n── Low-confidence cases (score < 40) ────────────────────');
const lowConf = allResults.filter(r => r.confidence < 40);
console.log(`  ${lowConf.length} of ${allResults.length} combinations route to mandatory_claude`);
if (lowConf.length > 0) {
  for (const r of lowConf.slice(0, 5)) {
    console.log(`  → ${r.feature} / ${r.niche ?? 'system'}: ${r.confidence} — ${r.reasons[0]}`);
  }
}

// ── 6. Run the full daily cron snapshot ──────────────────────────────────────
console.log('\n── Running daily confidence snapshot cron ───────────────');
const snapResult = runConfidenceSnapshot();
console.log('Snapshot result:', JSON.stringify(snapResult, null, 2));

// ── 7. Verify tables were populated ──────────────────────────────────────────
console.log('\n── DB verification queries ──────────────────────────────');
const cmCount   = db.get('SELECT COUNT(*) n FROM confidence_metrics');
const lchCount  = db.get('SELECT COUNT(*) n FROM learning_confidence_history');
const lchSample = db.all('SELECT snapshot_date, feature, niche, avg_confidence, fallback_rate FROM learning_confidence_history LIMIT 10');
console.log(`confidence_metrics rows:          ${cmCount.n}`);
console.log(`learning_confidence_history rows: ${lchCount.n}`);
console.log('Sample history rows:');
for (const r of lchSample) console.log('  ', JSON.stringify(r));

// ── 8. SQL verification queries for operator ──────────────────────────────────
console.log('\n── SQL verification queries (run these manually anytime) ──');
console.log(`  SELECT feature, niche, confidence_score, routing_decision, created_at
  FROM confidence_metrics ORDER BY created_at DESC LIMIT 20;`);
console.log();
console.log(`  SELECT snapshot_date, feature, niche, avg_confidence, fallback_rate
  FROM learning_confidence_history ORDER BY snapshot_date DESC LIMIT 20;`);

db.close();
console.log('\n══════════════════════════════════════════════');
console.log('PHASE A VERIFICATION COMPLETE');
console.log('══════════════════════════════════════════════\n');

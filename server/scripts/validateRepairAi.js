'use strict';

require('dotenv').config({ path: __dirname + '/../.env' });

const { getDb }          = require('../db/init');
const { computeRepair }  = require('../services/repair/repairEngine');
const { computeAiRepair, aiInputHash } = require('../services/repair/aiRepairAdvisor');

const SCORING_FIELDS = [
  'trajectory_status', 'trajectory_score', 'repair_window',
  'urgency_score', 'fixability_score', 'expected_performance_score',
  'audience_response_score', 'packaging_risk_score', 'evidence',
];

const AI_OUTPUT_KEYS = [
  'title_recommendations', 'thumbnail_recommendations',
  'follow_up_video', 'fix_plan_copy', 'do_not_touch_explanation',
];

let passed = 0;
let failed = 0;

function check(label, ok, detail = '') {
  if (ok) {
    console.log(`  ✓ ${label}${detail ? ': ' + detail : ''}`);
    passed++;
  } else {
    console.log(`  ✗ ${label}${detail ? ': ' + detail : ''}`);
    failed++;
  }
  return ok;
}

async function main() {
  const db = getDb();

  const row = db.get(
    `SELECT video_id FROM video_growth_snapshots LIMIT 1`,
    [],
  );
  if (!row) {
    console.log('No snapshots found — cannot run AI validation. Ingest some videos first.');
    process.exit(1);
  }
  const videoId = row.video_id;
  console.log(`\nPhase B AI Validation — video: ${videoId}\n`);

  // ── 1. Hash computation ──────────────────────────────────────────────────────
  console.log('── Hash computation');
  const h1 = aiInputHash(videoId, 'Title A', 'Desc A', 'Thumb A', 'key1');
  const h2 = aiInputHash(videoId, 'Title A', 'Desc A', 'Thumb A', 'key1');
  const h3 = aiInputHash(videoId, 'Title A', 'Desc CHANGED', 'Thumb A', 'key1');
  const h4 = aiInputHash(videoId, 'Title A', 'Desc A', 'Thumb A', 'key2');

  check('Same inputs → same hash', h1 === h2);
  check('Changed contentDescription → new hash', h1 !== h3);
  check('Changed structuralCacheKey → new hash', h1 !== h4);
  check('Hash is 16 chars', h1.length === 16);

  // ── 2. Phase A output available ──────────────────────────────────────────────
  console.log('\n── Phase A structural output');
  const repair = computeRepair(videoId, { force: false });
  check('Phase A output exists', !repair.error, repair.error ?? '');
  check('ai_cache_key present', typeof repair.ai_cache_key === 'string' && repair.ai_cache_key.length === 16);

  if (repair.error) {
    console.log('\nCannot continue AI tests — Phase A failed.');
    process.exit(1);
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    console.log('\n⚠  ANTHROPIC_API_KEY not set — skipping live Claude tests.');
    console.log(`\n${passed} passed, ${failed} failed (hash checks only)\n`);
    process.exit(failed > 0 ? 1 : 0);
  }

  // Clear any stale AI cache for this video so first-call test is always fresh.
  db.run(
    `UPDATE video_repair_cache SET ai_result_json = NULL, ai_computed_at = NULL, ai_input_hash = NULL WHERE video_id = ?`,
    [videoId],
  );

  // ── 3. First call — live Claude ──────────────────────────────────────────────
  console.log('\n── First call (live Claude)');
  const inputs = { title: repair.evidence?.trajectory?.latest_bucket ?? 'test title' };
  let firstResult;
  try {
    firstResult = await computeAiRepair(videoId, inputs);
    check('No error returned',     !firstResult.error);
    check('Output has all keys',   AI_OUTPUT_KEYS.every(k => k in firstResult), AI_OUTPUT_KEYS.filter(k => !(k in firstResult)).join(', ') || 'all present');
    check('title_recommendations is array',    Array.isArray(firstResult.title_recommendations));
    check('thumbnail_recommendations is array', Array.isArray(firstResult.thumbnail_recommendations));
    check('fix_plan_copy is array',            Array.isArray(firstResult.fix_plan_copy));
    check('follow_up_video is object',         typeof firstResult.follow_up_video === 'object' && firstResult.follow_up_video !== null);
    check('do_not_touch_explanation is string', typeof firstResult.do_not_touch_explanation === 'string');
    check('_cached is absent on first call',   firstResult._cached !== true);
    check('_ai_input_hash present',            typeof firstResult._ai_input_hash === 'string');

    // AI output must NOT contain any scoring fields.
    for (const sf of SCORING_FIELDS) {
      check(`AI output does not override ${sf}`, !(sf in firstResult));
    }

    // Repair window rule: learning/viral_decode → no title/thumbnail recs.
    if (repair.repair_window === 'learning' || repair.repair_window === 'viral_decode') {
      check('learning window: title_recs empty', firstResult.title_recommendations.length === 0);
      check('learning window: thumb_recs empty', firstResult.thumbnail_recommendations.length === 0);
    }

    // do_not_touch rule.
    if (repair.do_not_touch) {
      check('do_not_touch: explanation set', firstResult.do_not_touch_explanation.length > 0);
    }

  } catch (err) {
    check('First call succeeded', false, err.message);
    firstResult = null;
  }

  // ── 4. Cache hit — second call with same inputs ──────────────────────────────
  if (firstResult && !firstResult.error) {
    console.log('\n── Cache hit (second call, same inputs)');
    try {
      const cached = await computeAiRepair(videoId, inputs);
      check('Second call returns _cached=true', cached._cached === true);
      check('Same _ai_input_hash', cached._ai_input_hash === firstResult._ai_input_hash);
      check('Same title_recommendations count',
        cached.title_recommendations.length === firstResult.title_recommendations.length);
    } catch (err) {
      check('Second call succeeded', false, err.message);
    }

    // ── 5. New hash on changed input ─────────────────────────────────────────────
    console.log('\n── Hash invalidation (changed contentDescription)');
    const changedInputs = { ...inputs, contentDescription: 'completely different description ' + Date.now() };
    // Clear ai_result_json to force a fresh call with the new hash — otherwise cache row has old hash.
    // We just verify the hash differs; we don't need to actually call Claude again.
    const hashOriginal = aiInputHash(videoId, inputs.title, inputs.contentDescription, inputs.thumbnailDescription, repair.ai_cache_key);
    const hashChanged  = aiInputHash(videoId, changedInputs.title, changedInputs.contentDescription, changedInputs.thumbnailDescription, repair.ai_cache_key);
    check('Changed input produces different hash', hashOriginal !== hashChanged);
  }

  console.log(`\n${failed === 0 ? '✅' : '❌'} ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('FATAL:', err.message);
  process.exit(1);
});

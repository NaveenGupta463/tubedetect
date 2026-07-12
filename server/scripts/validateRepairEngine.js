'use strict';

require('dotenv').config({ path: __dirname + '/../.env' });

const { getDb }        = require('../db/init');
const { computeRepair } = require('../services/repair/repairEngine');

const REQUIRED_FIELDS = [
  'video_id', 'computed_at', 'repair_window', 'do_not_touch',
  'urgency_score', 'fixability_score',
  'trajectory_status', 'trajectory_score',
  'expected_performance_score', 'audience_response_score',
  'packaging_risk_score',
  'evidence', 'ai_cache_key',
];

function check(label, pass, detail = '') {
  const icon = pass ? '✓' : '✗';
  console.log(`  ${icon} ${label}${detail ? ': ' + detail : ''}`);
  return pass;
}

function runForVideo(videoId) {
  console.log(`\n── Video: ${videoId}`);
  const result = computeRepair(videoId, { force: true });

  if (result.error) {
    console.log(`  ✗ Error: ${result.error}`);
    return false;
  }

  let passed = 0;
  let total  = 0;

  for (const f of REQUIRED_FIELDS) {
    total++;
    if (check(`has ${f}`, result[f] !== undefined)) passed++;
  }

  total++; if (check('urgency_score in [0,100]', result.urgency_score >= 0 && result.urgency_score <= 100)) passed++;
  total++; if (check('fixability_score in [0,100]', result.fixability_score >= 0 && result.fixability_score <= 100)) passed++;
  total++; if (check('trajectory_score in [0,100]', result.trajectory_score >= 0 && result.trajectory_score <= 100)) passed++;
  total++; if (check('trajectory_status is valid', ['viral','growing','stable','declining','stalled','unknown'].includes(result.trajectory_status))) passed++;
  total++; if (check('repair_window is valid', ['launch_rescue','active_fix','recovery','follow_up','learning','viral_decode','unknown'].includes(result.repair_window))) passed++;
  total++; if (check('do_not_touch implies urgency=0', !result.do_not_touch || result.urgency_score === 0)) passed++;
  total++; if (check('ai_cache_key is 16 chars', typeof result.ai_cache_key === 'string' && result.ai_cache_key.length === 16)) passed++;

  // Evidence shape checks.
  total++; if (check('evidence.trajectory present', !!result.evidence?.trajectory)) passed++;
  total++; if (check('evidence.packaging_risk present', !!result.evidence?.packaging_risk)) passed++;
  total++; if (check('evidence.fixability present', !!result.evidence?.fixability)) passed++;

  console.log(`  Result: ${passed}/${total} checks passed — window=${result.repair_window}, urgency=${result.urgency_score}, fixability=${result.fixability_score}, trajectory=${result.trajectory_status}(${result.trajectory_score})`);
  return passed === total;
}

function main() {
  const db = getDb();

  // Pick up to 5 real video IDs that have snapshots.
  const rows = db.all(
    `SELECT DISTINCT video_id FROM video_growth_snapshots LIMIT 5`,
    [],
  );

  if (rows.length === 0) {
    // Fallback: grab from ingested_videos even without snapshots.
    const fallback = db.all(
      `SELECT youtube_video_id AS video_id FROM ingested_videos LIMIT 5`,
      [],
    );
    rows.push(...fallback);
  }

  if (rows.length === 0) {
    console.log('No videos found in DB — cannot run validation. Ingest some videos first.');
    process.exit(1);
  }

  console.log(`\nRepair Engine Validation — testing ${rows.length} video(s)\n`);

  let allPassed = true;
  for (const { video_id } of rows) {
    const ok = runForVideo(video_id);
    if (!ok) allPassed = false;
  }

  console.log(`\n${allPassed ? '✅ All checks passed' : '❌ Some checks failed'}\n`);
  process.exit(allPassed ? 0 : 1);
}

main();

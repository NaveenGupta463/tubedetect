'use strict';
/**
 * backfillLifecycleV2.js  —  Tasks 2-5
 *
 * Rebuilds creator_topic_lifecycle from channel_identity.content_phrases
 * (IDF-weighted, brand+guest filtered) instead of raw content_fingerprint.
 *
 * Usage:
 *   node server/scripts/backfillLifecycleV2.js
 *   node server/scripts/backfillLifecycleV2.js --dry-run
 *   node server/scripts/backfillLifecycleV2.js --reset      # clear checkpoint, restart
 *   node server/scripts/backfillLifecycleV2.js --limit=2000
 */

const path = require('path');
const BetterSqlite3 = require(path.join(__dirname, '../node_modules/better-sqlite3'));

const DB_PATH        = path.join(__dirname, '../data/scoring.db');
const CHECKPOINT_KEY = 'lifecycle_v2_cursor';
const BATCH_SIZE     = 500;

const args    = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const RESET   = args.includes('--reset');
const LIMIT   = (() => { const a = args.find(x => x.startsWith('--limit=')); return a ? parseInt(a.split('=')[1], 10) : Infinity; })();

const rawDb = new BetterSqlite3(DB_PATH);
rawDb.pragma('journal_mode = WAL');
rawDb.pragma('busy_timeout = 15000');
rawDb.pragma('synchronous = NORMAL');

const since90 = new Date(Date.now() -  90 * 86400000).toISOString().slice(0, 10);
const since30 = new Date(Date.now() -  30 * 86400000).toISOString().slice(0, 10);

const VALIDATION_NAMES = ['Warikoo', 'BeerBiceps', 'Raj Shamani', 'Aaj Tak'];

// ── helpers ───────────────────────────────────────────────────────────────────
function fmt(n) { return (n || 0).toLocaleString(); }
function pct(n, t) { return t ? ((n / t) * 100).toFixed(1) + '%' : '0%'; }

function getValidationIds() {
  return VALIDATION_NAMES.map(name => {
    const r = rawDb.prepare(`SELECT channel_id, channel_name FROM ingested_channels WHERE channel_name LIKE ? AND ingest_enabled=1 LIMIT 1`).get(`%${name}%`);
    return r || null;
  }).filter(Boolean);
}

function snapshotValidationLifecycle(label) {
  const channels = getValidationIds();
  const out = {};
  for (const { channel_id, channel_name } of channels) {
    const rows = rawDb.prepare(`SELECT phrase, stage FROM creator_topic_lifecycle WHERE channel_id = ? ORDER BY stage, phrase`).all(channel_id);
    out[channel_name] = rows;
  }
  return { label, data: out };
}

function printValidationComparison(before, after) {
  console.log('\n── Task 4: Validation channel lifecycle (before vs after) ──');
  for (const name of Object.keys(after.data)) {
    const bRows = before.data[name] || [];
    const aRows = after.data[name]  || [];
    const bPhrases = new Set(bRows.map(r => r.phrase));
    const aPhrases = new Set(aRows.map(r => r.phrase));
    const removed = bRows.filter(r => !aPhrases.has(r.phrase));
    const added   = aRows.filter(r => !bPhrases.has(r.phrase));
    console.log(`\n  ── ${name} ──`);
    console.log(`     before: ${bRows.length} phrases  after: ${aRows.length} phrases`);
    if (removed.length) {
      console.log(`     REMOVED (${removed.length}):`);
      removed.forEach(r => console.log(`       ✗ [${r.stage}] ${r.phrase}`));
    }
    if (added.length) {
      console.log(`     ADDED (${added.length}):`);
      added.forEach(r => console.log(`       ✓ [${r.stage}] ${r.phrase}`));
    }
    if (aRows.length) {
      console.log(`     CURRENT after:`);
      aRows.forEach(r => console.log(`       [${r.stage}] ${r.phrase}`));
    }
  }
}

// ── corpus metrics snapshot ───────────────────────────────────────────────────
function corpusSnapshot(label) {
  const total    = rawDb.prepare(`SELECT COUNT(*) as n FROM creator_topic_lifecycle`).get().n;
  const channels = rawDb.prepare(`SELECT COUNT(DISTINCT channel_id) as n FROM creator_topic_lifecycle`).get().n;
  const stages   = rawDb.prepare(`SELECT stage, COUNT(*) as n FROM creator_topic_lifecycle GROUP BY stage`).all();
  const stageMap = Object.fromEntries(stages.map(r => [r.stage, r.n]));

  // Measure brand contamination: lifecycle phrases that also appear in channel_identity.brand_phrases
  const contaminated = rawDb.prepare(`
    SELECT COUNT(*) as n FROM creator_topic_lifecycle ctl
    JOIN channel_identity ci ON ci.channel_id = ctl.channel_id
    WHERE ci.brand_phrases IS NOT NULL
      AND ('|' || ci.brand_phrases || '|') LIKE ('%|' || ctl.phrase || '|%')
  `).get().n;

  // Content phrase match rate: lifecycle phrases that appear in channel_identity.content_phrases
  const contentMatch = rawDb.prepare(`
    SELECT COUNT(*) as n FROM creator_topic_lifecycle ctl
    JOIN channel_identity ci ON ci.channel_id = ctl.channel_id
    WHERE ci.content_phrases IS NOT NULL
      AND ('|' || ci.content_phrases || '|') LIKE ('%|' || ctl.phrase || '|%')
  `).get().n;

  return { label, total, channels, stageMap, contaminated, contentMatch };
}

function printCorpusSnapshot(s) {
  const t = s.total;
  console.log(`\n── ${s.label} corpus snapshot ─────────────────────────────`);
  console.log(`  total records       : ${fmt(t)}`);
  console.log(`  channels covered    : ${fmt(s.channels)}`);
  console.log(`  stage distribution  : regular=${s.stageMap.regular||0}  saturated=${s.stageMap.saturated||0}  early=${s.stageMap.early||0}  seed=${s.stageMap.seed||0}  exiting=${s.stageMap.exiting||0}  pre_topic=${s.stageMap.pre_topic||0}`);
  console.log(`  brand contamination : ${fmt(s.contaminated)} rows (${pct(s.contaminated, t)})`);
  console.log(`  content match rate  : ${fmt(s.contentMatch)} rows (${pct(s.contentMatch, t)})`);
}

function printCorpusDiff(before, after) {
  const sign = n => (n >= 0 ? '+' : '') + n.toLocaleString();
  const signP = (a, b, t) => {
    const da = a/Math.max(1,t), db = b/Math.max(1,t);
    return ((da - db) * 100 >= 0 ? '+' : '') + ((da - db) * 100).toFixed(1) + 'pp';
  };
  console.log('\n── Before vs After diff ─────────────────────────────────────');
  console.log(`  total records       : ${fmt(after.total)}  (${sign(after.total - before.total)})`);
  console.log(`  channels covered    : ${fmt(after.channels)}  (${sign(after.channels - before.channels)})`);
  const stages = ['regular','saturated','early','seed','exiting','pre_topic'];
  for (const stage of stages) {
    const b = before.stageMap[stage] || 0, a = after.stageMap[stage] || 0;
    if (a === 0 && b === 0) continue;
    console.log(`  ${stage.padEnd(12)}: ${fmt(a).padStart(7)}  was ${fmt(b).padStart(7)}  (${sign(a-b)})`);
  }
  console.log(`  brand contamination : ${pct(after.contaminated, after.total)}  was ${pct(before.contaminated, before.total)}  (${signP(after.contaminated, before.contaminated, after.total)})`);
  console.log(`  content match rate  : ${pct(after.contentMatch, after.total)}  was ${pct(before.contentMatch, before.total)}  (${signP(after.contentMatch, before.contentMatch, after.total)})`);
}

// ── core lifecycle compute for one channel ────────────────────────────────────
function computeLifecycleRows(channelId, contentPhrases, videos) {
  const total   = videos.length;
  const phrases = contentPhrases.split('|').map(p => p.trim()).filter(p => p.length >= 4);
  const rows    = [];

  for (const phrase of phrases) {
    const lp       = phrase.toLowerCase();
    const matching = videos.filter(v => (v.title || '').toLowerCase().includes(lp));

    if (!matching.length) {
      rows.push([channelId, phrase, 'pre_topic', null, null, 0, null]);
      continue;
    }

    matching.sort((a, b) => (a.published_at < b.published_at ? -1 : 1));
    const vc         = matching.length;
    const first_seen = matching[0].published_at?.slice(0, 10) || null;
    const last_seen  = matching[vc - 1].published_at?.slice(0, 10) || null;
    const avg_views  = Math.round(matching.reduce((s, v) => s + (v.views || 0), 0) / vc);
    const isRecent   = last_seen != null && last_seen >= since30;

    let stage;
    if (vc <= 2)               stage = 'seed';
    else if (vc <= 5)          stage = 'early';
    else if (vc / total > 0.2) stage = 'saturated';
    else if (isRecent)         stage = 'regular';
    else                       stage = 'exiting';

    rows.push([channelId, phrase, stage, first_seen, last_seen, vc, avg_views]);
  }

  return rows;
}

// ── Task 2: Backfill ──────────────────────────────────────────────────────────
function runBackfill() {
  if (RESET) {
    try { rawDb.prepare(`DELETE FROM kv_store WHERE key = ?`).run(CHECKPOINT_KEY); } catch (_) {}
    console.log('[backfill] Checkpoint cleared — starting from beginning.');
  }

  const cursorRow = rawDb.prepare(`SELECT value FROM kv_store WHERE key = ?`).get(CHECKPOINT_KEY);
  const cursor    = cursorRow?.value || null;

  // All channels with clean content_phrases (non-null, confidence != 'none')
  const toProcess = rawDb.prepare(`
    SELECT ic.channel_id, ci.content_phrases
    FROM ingested_channels ic
    JOIN channel_identity ci ON ci.channel_id = ic.channel_id
    WHERE ci.content_phrases IS NOT NULL
      AND ci.confidence_tier NOT IN ('none')
      AND ic.ingest_enabled = 1
      ${cursor ? 'AND ic.channel_id > ?' : ''}
    ORDER BY ic.channel_id
  `).all(...(cursor ? [cursor] : []));

  const runLimit = Math.min(toProcess.length, LIMIT);
  console.log(`\n[backfill] ${toProcess.length.toLocaleString()} channels to process` +
    (cursor ? ` (resuming after ${cursor})` : '') +
    (LIMIT < Infinity ? ` — capped at ${LIMIT}` : '') +
    (DRY_RUN ? '  [DRY-RUN]' : ''));

  const insertSql = `
    INSERT OR REPLACE INTO creator_topic_lifecycle
      (channel_id, phrase, stage, first_seen, last_seen, video_count, avg_views_on_topic, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `;

  const stats = { processed: 0, errors: 0, totalRows: 0, stageCount: {} };
  const startTime = Date.now();

  for (let i = 0; i < runLimit; i += BATCH_SIZE) {
    const batchSlice = toProcess.slice(i, i + BATCH_SIZE);
    const batchIds   = batchSlice.map(c => c.channel_id);
    const ph         = batchIds.map(() => '?').join(',');

    // Fetch last-90-day videos for this batch
    let videos = [];
    try {
      videos = rawDb.prepare(
        `SELECT channel_id, title, published_at, views
         FROM ingested_videos
         WHERE channel_id IN (${ph}) AND published_at >= ? AND title IS NOT NULL`,
      ).all(...batchIds, since90);
    } catch (e) {
      console.error(`  [ERR] video fetch for batch at i=${i}: ${e.message}`);
      stats.errors++;
      continue;
    }

    const byChannel = new Map();
    for (const v of videos) {
      if (!byChannel.has(v.channel_id)) byChannel.set(v.channel_id, []);
      byChannel.get(v.channel_id).push(v);
    }

    const writeTx = rawDb.transaction((channelId, rows) => {
      rawDb.prepare(`DELETE FROM creator_topic_lifecycle WHERE channel_id = ?`).run(channelId);
      for (const row of rows) rawDb.prepare(insertSql).run(...row);
      rawDb.prepare(`INSERT OR REPLACE INTO kv_store (key, value) VALUES (?, ?)`).run(CHECKPOINT_KEY, channelId);
    });

    for (const ch of batchSlice) {
      try {
        const chVideos = byChannel.get(ch.channel_id) || [];
        const rows     = computeLifecycleRows(ch.channel_id, ch.content_phrases, chVideos);
        if (!DRY_RUN) writeTx(ch.channel_id, rows);
        stats.processed++;
        stats.totalRows += rows.length;
        for (const r of rows) stats.stageCount[r[2]] = (stats.stageCount[r[2]] || 0) + 1;
      } catch (e) {
        stats.errors++;
        if (stats.errors <= 10) console.error(`  [ERR] ${ch.channel_id}: ${e.message}`);
      }
    }

    const done    = Math.min(i + BATCH_SIZE, runLimit);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
    const eta     = Math.round((Date.now() - startTime) / Math.max(1, done) * (runLimit - done) / 1000);
    console.log(`[backfill] ${fmt(done)}/${fmt(runLimit)} elapsed=${elapsed}s rows=${fmt(stats.totalRows)} err=${stats.errors} eta=${eta}s`);
  }

  const totalSec = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n[backfill] Done. ${fmt(stats.processed)} channels in ${totalSec}s (${stats.errors} errors)`);
  console.log(`  stage counts: ${JSON.stringify(stats.stageCount)}`);
  return stats;
}

// ── Task 5: Suppression benchmark ─────────────────────────────────────────────
function runSuppressionBenchmark() {
  const { computeWhatToPost } = require('../routes/creatorIntel.js');

  // Sample: 60 channels with lifecycle data in regular/saturated stage
  const sample = rawDb.prepare(`
    SELECT ic.channel_id, COALESCE(ic.primary_niche, ic.niche) AS niche,
           ic.format_type, ic.channel_subscribers
    FROM ingested_channels ic
    WHERE ic.ingest_enabled = 1
      AND ic.format_type IS NOT NULL
      AND ic.primary_niche IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM creator_topic_lifecycle ctl
        WHERE ctl.channel_id = ic.channel_id AND ctl.stage IN ('regular','saturated')
      )
    ORDER BY RANDOM() LIMIT 60
  `).all();

  if (!sample.length) {
    console.log('  No channels with regular/saturated lifecycle — benchmark skipped.');
    return;
  }

  // Need a db adapter for computeWhatToPost
  const { getDb } = require('../db/init.js');
  const db = getDb();

  let totalBefore = 0, totalAfter = 0, totalSuppressed = 0, measured = 0;
  let bPOR = 0, aPOR = 0, bRP5 = 0, aRP5 = 0;

  for (const chan of sample) {
    let before, after;
    try {
      before = computeWhatToPost(db, { channel_id: chan.channel_id, subscriber_count: String(chan.channel_subscribers || 0), disable_lifecycle_filter: 'true' });
      after  = computeWhatToPost(db, { channel_id: chan.channel_id, subscriber_count: String(chan.channel_subscribers || 0) });
    } catch (_) { continue; }

    const bIdeas = before.ideas || [];
    const aIdeas = after.ideas  || [];
    if (!bIdeas.length && !aIdeas.length) continue;

    const bs  = before.summary || {};
    const as_ = after.summary  || {};
    const suppressed = as_.lifecycle_suppressed || 0;

    totalBefore    += bIdeas.length;
    totalAfter     += aIdeas.length;
    totalSuppressed += suppressed;

    // POR: avg (100 - saturation_pct) of top-5 ideas
    const bPORv = bIdeas.slice(0, 5).reduce((s, i) => s + (100 - (i.saturation_pct || 50)), 0) / Math.max(1, Math.min(5, bIdeas.length));
    const aPORv = aIdeas.slice(0, 5).reduce((s, i) => s + (100 - (i.saturation_pct || 50)), 0) / Math.max(1, Math.min(5, aIdeas.length));
    bPOR += bPORv;
    aPOR += aPORv;

    // RP@5: % of top-5 ideas not in creator's regular/saturated lifecycle
    const lcPhrases = rawDb.prepare(
      `SELECT phrase FROM creator_topic_lifecycle WHERE channel_id = ? AND stage IN ('regular','saturated')`,
    ).all(chan.channel_id).map(r => r.phrase.toLowerCase());
    const suppSet = new Set(lcPhrases);
    const norm    = s => s.replace(/[:.!?]+$/, '').trim().toLowerCase();
    const bRP5v = bIdeas.slice(0, 5).filter(i => !suppSet.has(norm(i.topic))).length / Math.max(1, Math.min(5, bIdeas.length));
    const aRP5v = aIdeas.slice(0, 5).filter(i => !suppSet.has(norm(i.topic))).length / Math.max(1, Math.min(5, aIdeas.length));
    bRP5 += bRP5v;
    aRP5 += aRP5v;

    measured++;
  }

  if (!measured) { console.log('  No channels produced ideas.'); return; }

  const bPORavg = bPOR / measured, aPORavg = aPOR / measured;
  const bRP5avg = bRP5 / measured * 100, aRP5avg = aRP5 / measured * 100;
  const earPct  = totalBefore + totalSuppressed > 0
    ? (totalSuppressed / (totalBefore + totalSuppressed) * 100).toFixed(1) : '0.0';
  const delta = n => (n >= 0 ? '+' : '') + n.toFixed(1);

  console.log(`\n  Sample: ${measured} channels  |  ideas before: ${totalBefore}  after: ${totalAfter}  suppressed: ${totalSuppressed}`);
  console.log(`\n  ┌────────────────────────────────────────────────────┐`);
  console.log(`  │ Metric          BEFORE   AFTER    DELTA            │`);
  console.log(`  ├────────────────────────────────────────────────────┤`);
  console.log(`  │ POR  (novelty%) ${bPORavg.toFixed(1).padStart(6)}   ${aPORavg.toFixed(1).padStart(6)}   ${delta(aPORavg - bPORavg).padStart(6)}pp          │`);
  console.log(`  │ RP@5 (top5 %)  ${bRP5avg.toFixed(1).padStart(6)}%  ${aRP5avg.toFixed(1).padStart(6)}%  ${delta(aRP5avg - bRP5avg).padStart(6)}pp          │`);
  console.log(`  │ EAR  (suppr.%)   0.0%  ${earPct.padStart(6)}%  ${('+'+earPct).padStart(6)}pp          │`);
  console.log(`  └────────────────────────────────────────────────────┘`);
  console.log(`  POR : avg (100 - saturation_pct) of top-5 ideas — higher = more novel`);
  console.log(`  RP@5: % of top-5 ideas not already in creator's regular/saturated lifecycle`);
  console.log(`  EAR : suppression efficiency across all ${measured} channels`);
}

// ── Main ──────────────────────────────────────────────────────────────────────
(function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  backfillLifecycleV2  —  content-phrase lifecycle rebuild');
  console.log('═══════════════════════════════════════════════════════════');
  if (DRY_RUN) console.log('  *** DRY-RUN mode — no writes ***');

  // Task 3a: Before snapshot
  const before = corpusSnapshot('BEFORE');
  printCorpusSnapshot(before);
  const beforeValidation = snapshotValidationLifecycle('BEFORE');

  // Task 2: Backfill
  runBackfill();

  // Task 3b: After snapshot + diff
  const after = corpusSnapshot('AFTER');
  printCorpusSnapshot(after);
  printCorpusDiff(before, after);

  // Task 4: Validation channel before vs after
  const afterValidation = snapshotValidationLifecycle('AFTER');
  printValidationComparison(beforeValidation, afterValidation);

  // Task 5: Suppression benchmark
  console.log('\n══════════════════════════════════════════════════════════');
  console.log('  Task 5 — Suppression benchmark (POR / RP@5 / EAR)');
  console.log('══════════════════════════════════════════════════════════');
  runSuppressionBenchmark();

  console.log('\n═══════════════════════════════════════════════════════════');
  if (DRY_RUN) console.log('  DRY-RUN complete — run without --dry-run to persist');
  else         console.log('  Backfill complete.');
  console.log('═══════════════════════════════════════════════════════════');

  rawDb.close();
  process.exit(0);
})();

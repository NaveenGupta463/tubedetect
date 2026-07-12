'use strict';
/**
 * backfillChannelIdentityV2.js  —  Tasks 1-4
 *
 * Recomputes ALL channel identities using updated guest + brand filters,
 * then reports before-vs-after metrics, named-channel validation, and
 * POR/RP@5/EAR benchmark.
 *
 * Usage:
 *   node server/scripts/backfillChannelIdentityV2.js
 *   node server/scripts/backfillChannelIdentityV2.js --dry-run
 *   node server/scripts/backfillChannelIdentityV2.js --reset      # clear checkpoint, restart
 *   node server/scripts/backfillChannelIdentityV2.js --limit=2000  # stop after N channels
 *
 * Safe to Ctrl-C and resume — checkpoint stored in kv_store.
 */

const path = require('path');

const BetterSqlite3 = require(path.join(__dirname, '../node_modules/better-sqlite3'));
const {
  computeChannelIdentity,
  upsertChannelIdentity,
  buildCorpusIndex,
} = require('../lib/channelIdentity');

// ── args ───────────────────────────────────────────────────────────────────────
const args    = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const RESET   = args.includes('--reset');
const LIMIT   = (() => {
  const a = args.find(x => x.startsWith('--limit='));
  return a ? parseInt(a.split('=')[1], 10) : Infinity;
})();
const BATCH_SIZE = 500;
const CHECKPOINT_KEY = 'identity_v2_cursor';

// ── DB setup ───────────────────────────────────────────────────────────────────
const DB_PATH = path.join(__dirname, '../data/scoring.db');
const rawDb   = new BetterSqlite3(DB_PATH);
rawDb.pragma('journal_mode = WAL');
rawDb.pragma('busy_timeout = 15000');
rawDb.pragma('synchronous = NORMAL');

// Adapter: channelIdentity.js calls db.get/all/run with (sql, paramsArray) signature
const db = Object.create(null);
db.get         = (sql, p = []) => rawDb.prepare(sql).get(...(Array.isArray(p) ? p : [p]));
db.all         = (sql, p = []) => rawDb.prepare(sql).all(...(Array.isArray(p) ? p : [p]));
db.run         = (sql, p = []) => rawDb.prepare(sql).run(...(Array.isArray(p) ? p : [p]));
db.transaction = fn            => rawDb.transaction(fn);

// ── helpers ────────────────────────────────────────────────────────────────────
function parseFingerprintPhrases(raw) {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    if (Array.isArray(arr))
      return arr.map(e => (typeof e === 'object' ? (e.phrase || '') : String(e))).filter(Boolean);
  } catch (_) {}
  return raw.split('|').map(s => s.trim()).filter(Boolean);
}

function computeSubWeight(uSubs, pSubs) {
  if (!uSubs || !pSubs) return 0.5;
  const ratio = pSubs / uSubs;
  if (ratio < 0.05 || ratio > 20) return 0;
  if (ratio >= 0.2 && ratio <= 5)  return 1.0;
  return 0.6;
}

function fmt(n, d = 1) { return (n || 0).toFixed(d); }
function pct(n, t) { return t ? ((n / t) * 100).toFixed(1) + '%' : '0%'; }

// ── Phase 0: Before snapshot ───────────────────────────────────────────────────
function captureSnapshot(label) {
  const tiers = rawDb.prepare(
    `SELECT confidence_tier, COUNT(*) as n FROM channel_identity GROUP BY confidence_tier`,
  ).all();
  const tierMap = Object.fromEntries(tiers.map(r => [r.confidence_tier, r.n]));
  const total   = Object.values(tierMap).reduce((s, v) => s + v, 0);

  const avg = rawDb.prepare(`SELECT AVG(brand_contamination_pct) as v FROM channel_identity`).get().v || 0;
  const brandFl = rawDb.prepare(
    `SELECT COUNT(*) as n FROM channel_identity WHERE health_flags LIKE '%brand_contaminated%'`,
  ).get().n;
  const guestFl = rawDb.prepare(
    `SELECT COUNT(*) as n FROM channel_identity WHERE health_flags LIKE '%guest_contaminated%'`,
  ).get().n;
  const noContent = rawDb.prepare(
    `SELECT COUNT(*) as n FROM channel_identity WHERE content_phrase_count = 0 OR content_phrases IS NULL`,
  ).get().n;

  return { label, total, tierMap, avg_brand_pct: avg, brandFlagged: brandFl, guestFlagged: guestFl, noContent };
}

function printSnapshot(s) {
  const t = s.total;
  console.log(`\n── ${s.label} snapshot ──────────────────────────────────`);
  console.log(`  identity rows  : ${t.toLocaleString()}`);
  console.log(`  confidence     : high=${s.tierMap.high||0} medium=${s.tierMap.medium||0} low=${s.tierMap.low||0} none=${s.tierMap.none||0}`);
  console.log(`  high+medium    : ${((((s.tierMap.high||0)+(s.tierMap.medium||0))/Math.max(1,t))*100).toFixed(1)}%  (good routing)`);
  console.log(`  avg brand_pct  : ${fmt(s.avg_brand_pct*100)}%`);
  console.log(`  brand_flagged  : ${s.brandFlagged.toLocaleString()}  (${pct(s.brandFlagged, t)})`);
  console.log(`  guest_flagged  : ${s.guestFlagged.toLocaleString()}  (${pct(s.guestFlagged, t)})`);
  console.log(`  no_content     : ${s.noContent.toLocaleString()}  (${pct(s.noContent, t)})  ← format-fallback candidates`);
}

function printDiff(before, after) {
  console.log('\n── Before vs After diff ────────────────────────────────');
  const bt = before.total, at = after.total;

  const bGood = (before.tierMap.high||0) + (before.tierMap.medium||0);
  const aGood = (after.tierMap.high||0)  + (after.tierMap.medium||0);
  const sign  = n => (n >= 0 ? '+' : '') + n.toFixed(1);

  const tierNames = ['high','medium','low','none'];
  for (const tier of tierNames) {
    const bv = before.tierMap[tier] || 0, av = after.tierMap[tier] || 0;
    const delta = pct(av, at).padStart(6) + ' vs ' + pct(bv, bt).padStart(6);
    console.log(`  ${tier.padEnd(6)}: ${String(av).padStart(6)} vs ${String(bv).padStart(6)}  (${delta})`);
  }
  console.log(`  good routing (high+medium): ${pct(aGood,at)} vs ${pct(bGood,bt)}  delta=${sign((aGood/Math.max(1,at) - bGood/Math.max(1,bt))*100)}pp`);
  console.log(`  avg brand_pct: ${fmt(after.avg_brand_pct*100)}% vs ${fmt(before.avg_brand_pct*100)}%  delta=${sign((after.avg_brand_pct - before.avg_brand_pct)*100)}pp`);
  console.log(`  guest_flagged: ${after.guestFlagged} (new detection, no before baseline)`);
  console.log(`  no_content   : ${after.noContent} vs ${before.noContent}  (format-fallback pool)`);
}

// ── Benchmark helpers ──────────────────────────────────────────────────────────
function runBenchmark(label, sampleIds) {
  const PEER_WEIGHTS = { topic: 0.51, format: 0.21, style: 0.18, language: 0.10, phrase: 0.50 };
  let por10Total = 0, rp5Total = 0, earTotal = 0, measured = 0;

  for (const { channel_id, niche, format_type, channel_subscribers } of sampleIds) {
    const ciRow = rawDb.prepare(
      `SELECT content_phrases, confidence_tier FROM channel_identity WHERE channel_id = ?`,
    ).get(channel_id);
    const fpRow = rawDb.prepare(
      `SELECT content_fingerprint FROM ingested_channels WHERE channel_id = ?`,
    ).get(channel_id);

    const fp = (ciRow?.content_phrases && ciRow.confidence_tier !== 'none')
      ? ciRow.content_phrases
      : fpRow?.content_fingerprint;

    if (!fp) continue;
    const phrases = parseFingerprintPhrases(fp).slice(0, 12);
    if (phrases.length < 3) continue;

    const cond = phrases.map(() => `content_fingerprint LIKE ?`).join(' OR ');
    const peers = rawDb.prepare(
      `SELECT channel_id, COALESCE(primary_niche,niche) AS niche, format_type, channel_subscribers
       FROM ingested_channels
       WHERE content_fingerprint IS NOT NULL AND (${cond}) AND channel_id != ? AND ingest_enabled = 1
       LIMIT 50`,
    ).all(...phrases.map(p => `%${p}%`), channel_id);

    if (peers.length < 3) continue;

    const top10 = peers.slice(0, 10);
    const top5  = peers.slice(0, 5);

    // POR@10: % of top 10 peers sharing same niche
    const por10 = niche ? top10.filter(p => p.niche === niche).length / top10.length : 0.5;

    // RP@5: % of top 5 sharing niche AND format
    const rp5 = (niche && format_type)
      ? top5.filter(p => p.niche === niche && p.format_type === format_type).length / top5.length
      : 0;

    // EAR: % of top 10 within 5× subscriber band
    const uSubs = channel_subscribers || 0;
    const ear   = uSubs > 0
      ? top10.filter(p => {
          const pSubs = p.channel_subscribers || 0;
          if (!pSubs) return false;
          const ratio = Math.max(uSubs, pSubs) / Math.min(uSubs, pSubs);
          return ratio <= 5;
        }).length / top10.length
      : 0.5;

    por10Total += por10;
    rp5Total   += rp5;
    earTotal   += ear;
    measured++;
  }

  return {
    label,
    n:    measured,
    por10: measured ? (por10Total / measured * 100).toFixed(1) : '-',
    rp5:   measured ? (rp5Total   / measured * 100).toFixed(1) : '-',
    ear:   measured ? (earTotal   / measured * 100).toFixed(1) : '-',
  };
}

// ── Phase 1: Backfill ──────────────────────────────────────────────────────────
function runBackfill(corpusIndex) {
  // Checkpoint for resume
  if (RESET) {
    try { rawDb.prepare(`DELETE FROM kv_store WHERE key = ?`).run(CHECKPOINT_KEY); } catch (_) {}
    console.log('[backfill] Checkpoint cleared — starting from beginning.');
  }
  const cursorRow = rawDb.prepare(`SELECT value FROM kv_store WHERE key = ?`).get(CHECKPOINT_KEY);
  const cursor    = cursorRow?.value || null;

  const toProcess = rawDb.prepare(
    `SELECT channel_id FROM ingested_channels
     WHERE ingest_enabled = 1
     ${cursor ? 'AND channel_id > ?' : ''}
     ORDER BY channel_id`,
  ).all(...(cursor ? [cursor] : [])).map(r => r.channel_id);

  const runLimit = Math.min(toProcess.length, LIMIT);
  console.log(`\n[backfill] ${toProcess.length.toLocaleString()} channels to process` +
    (cursor ? ` (resuming after ${cursor})` : '') +
    (LIMIT < Infinity ? ` — capped at ${LIMIT}` : '') +
    (DRY_RUN ? '  [DRY-RUN — no writes]' : ''));

  const stats = {
    processed: 0, errors: 0,
    guestDetected: 0, brandDetected: 0,
    noContent: 0, tierChanges: { improved: 0, degraded: 0, same: 0 },
  };

  const tierRank = { none: 0, low: 1, medium: 2, high: 3 };
  const prevTierStmt = rawDb.prepare(
    `SELECT confidence_tier FROM channel_identity WHERE channel_id = ?`,
  );
  const upsertFn = rawDb.transaction((identity) => {
    upsertChannelIdentity(db, identity);
    rawDb.prepare(`INSERT OR REPLACE INTO kv_store (key, value) VALUES (?, ?)`)
      .run(CHECKPOINT_KEY, identity.channel_id);
  });

  const startTime = Date.now();
  let batchStart  = Date.now();

  for (let i = 0; i < runLimit; i++) {
    const channelId = toProcess[i];

    try {
      const identity = computeChannelIdentity(db, channelId, corpusIndex);

      // Track metrics
      if (identity.excluded_guest_phrases?.length) stats.guestDetected++;
      if (identity.brand_phrases)                  stats.brandDetected++;
      if (!identity.content_phrases)               stats.noContent++;

      // Tier change tracking
      const prevRow = prevTierStmt.get(channelId);
      if (prevRow) {
        const prev = tierRank[prevRow.confidence_tier] ?? 0;
        const next = tierRank[identity.confidence_tier] ?? 0;
        if (next > prev)      stats.tierChanges.improved++;
        else if (next < prev) stats.tierChanges.degraded++;
        else                  stats.tierChanges.same++;
      }

      if (!DRY_RUN) upsertFn(identity);
    } catch (err) {
      stats.errors++;
      if (stats.errors <= 10) console.error(`  [ERR] ${channelId}: ${err.message}`);
    }

    stats.processed++;

    // Progress: every batch or every 10% of total
    const tick = Math.max(BATCH_SIZE, Math.floor(runLimit / 10));
    if (stats.processed % tick === 0 || stats.processed === runLimit) {
      const elapsed  = ((Date.now() - startTime) / 1000).toFixed(0);
      const batchSec = ((Date.now() - batchStart) / 1000).toFixed(1);
      const remaining = Math.round((Date.now() - startTime) / stats.processed * (runLimit - stats.processed) / 1000);
      console.log(
        `[backfill] ${stats.processed.toLocaleString()}/${runLimit.toLocaleString()} ` +
        `elapsed=${elapsed}s batch=${batchSec}s ` +
        `guest=${stats.guestDetected} brand=${stats.brandDetected} ` +
        `err=${stats.errors} eta=${remaining}s`,
      );
      batchStart = Date.now();
    }
  }

  const totalSec = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n[backfill] Done. ${stats.processed.toLocaleString()} channels in ${totalSec}s (${stats.errors} errors)`);
  return stats;
}

// ── Phase 3: Named channel validation ─────────────────────────────────────────
const PEER_WEIGHTS = { topic: 0.51, format: 0.21, style: 0.18, language: 0.10, phrase: 0.50 };

function namedValidation() {
  const targets = ['Raj Shamani', 'BeerBiceps', 'Warikoo', 'Nikhil Kamath'];
  console.log('\n── Task 3: Named channel validation ─────────────────────');

  for (const name of targets) {
    const chan = rawDb.prepare(
      `SELECT channel_id, channel_name, channel_subscribers,
              COALESCE(primary_niche, niche) AS niche,
              format_type, content_archetype, primary_language
       FROM ingested_channels WHERE channel_name LIKE ? AND ingest_enabled = 1 LIMIT 1`,
    ).get(`%${name}%`);
    if (!chan) { console.log(`\n  [${name}] NOT FOUND`); continue; }

    const ci = rawDb.prepare(
      `SELECT content_phrases, confidence_tier, brand_phrases, brand_contamination_pct, health_flags
       FROM channel_identity WHERE channel_id = ?`,
    ).get(chan.channel_id);

    // Guest contamination: count excluded_guest_phrases from fresh compute (in-memory only)
    const freshId = computeChannelIdentity(db, chan.channel_id, null);
    const guestPhrases = freshId.excluded_guest_phrases || [];
    const guestPct     = freshId.brand_contamination_pct;  // combined after Tasks 1+2

    // Phrase peer count
    const fp = (ci?.content_phrases && ci.confidence_tier !== 'none')
      ? ci.content_phrases
      : rawDb.prepare(`SELECT content_fingerprint FROM ingested_channels WHERE channel_id = ?`)
          .get(chan.channel_id)?.content_fingerprint;
    const phrases = parseFingerprintPhrases(fp).slice(0, 15);
    let phrasePeers = 0, routingMode = 'phrase';

    if (phrases.length > 0) {
      const cond = phrases.map(() => `content_fingerprint LIKE ?`).join(' OR ');
      phrasePeers = rawDb.prepare(
        `SELECT COUNT(*) as n FROM ingested_channels
         WHERE content_fingerprint IS NOT NULL AND (${cond}) AND channel_id != ? AND ingest_enabled = 1`,
      ).get(...phrases.map(p => `%${p}%`), chan.channel_id).n;
    }

    if (phrasePeers === 0 && (ci?.confidence_tier === 'low' || ci?.confidence_tier === 'none')) {
      routingMode = 'format_fallback';
      if (chan.format_type && chan.content_archetype) {
        const langClause = chan.primary_language ? 'AND primary_language = ?' : '';
        const fbParams   = [
          chan.format_type, chan.content_archetype,
          ...(chan.primary_language ? [chan.primary_language] : []),
          chan.channel_id, 300,
        ];
        phrasePeers = rawDb.prepare(
          `SELECT COUNT(*) as n FROM ingested_channels
           WHERE format_type = ? AND content_archetype = ? ${langClause}
             AND channel_id != ? AND ingest_enabled = 1 LIMIT ?`,
        ).get(...fbParams).n;
      }
    }

    const peerSource = phrasePeers > 0
      ? (routingMode === 'format_fallback' ? 'format_fallback' : 'content_phrases')
      : 'none';

    console.log(`\n  ── ${chan.channel_name} ──`);
    console.log(`     channel_id     : ${chan.channel_id}`);
    console.log(`     confidence_tier: ${ci?.confidence_tier || 'no_identity'}`);
    console.log(`     brand_pct      : ${((ci?.brand_contamination_pct || 0) * 100).toFixed(0)}%`);
    console.log(`     guest_phrases  : ${guestPhrases.length > 0 ? guestPhrases.slice(0, 4).join(', ') : '(none detected)'}`);
    console.log(`     routing_mode   : ${routingMode}`);
    console.log(`     peer_source    : ${peerSource}`);
    console.log(`     peer_count     : ${phrasePeers}  ${phrasePeers > 0 ? '✓ OK' : '✗ ZERO'}`);
    console.log(`     format_type    : ${chan.format_type || '(null)'}`);
    console.log(`     content_arch   : ${chan.content_archetype || '(null)'}`);
    console.log(`     health_flags   : ${ci?.health_flags || '(none)'}`);
    console.log(`     content_phrases: ${phrases.slice(0, 4).join(' | ') || '(empty)'}`);
  }
}

// ── Main ───────────────────────────────────────────────────────────────────────
(function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  backfillChannelIdentityV2  —  guest + brand filter pass');
  console.log('═══════════════════════════════════════════════════════════');
  if (DRY_RUN) console.log('  *** DRY-RUN mode — no DB writes ***');

  // Task 2a: Before snapshot
  const before = captureSnapshot('BEFORE');
  printSnapshot(before);

  // Benchmark sample: 60 channels with format metadata + known good routing
  const benchSample = rawDb.prepare(
    `SELECT ic.channel_id, COALESCE(ic.primary_niche, ic.niche) AS niche,
            ic.format_type, ic.channel_subscribers
     FROM ingested_channels ic
     JOIN channel_identity ci ON ci.channel_id = ic.channel_id
     WHERE ic.ingest_enabled = 1
       AND ic.format_type IS NOT NULL
       AND ic.content_archetype IS NOT NULL
       AND ci.confidence_tier IN ('high','medium')
     ORDER BY RANDOM() LIMIT 60`,
  ).all();

  const benchBefore = runBenchmark('BEFORE', benchSample);
  console.log(`\n── Task 4: Benchmark BEFORE (n=${benchBefore.n}) ───────────────`);
  console.log(`  POR@10 (niche precision)    : ${benchBefore.por10}%`);
  console.log(`  RP@5   (niche+format prec.) : ${benchBefore.rp5}%`);
  console.log(`  EAR    (sub-band accuracy)  : ${benchBefore.ear}%`);

  // Task 1: Build corpus index then backfill
  console.log('\n[backfill] Building corpus index...');
  const corpusIndex = buildCorpusIndex(db);
  console.log(`[backfill] Corpus index ready — ${corpusIndex.size.toLocaleString()} channels, ${corpusIndex.phraseCount.size.toLocaleString()} phrases`);

  const stats = runBackfill(corpusIndex);

  // Task 2b: After snapshot + diff
  const after = captureSnapshot('AFTER');
  printSnapshot(after);
  printDiff(before, after);

  // Backfill run stats
  console.log('\n── Backfill run stats ──────────────────────────────────────');
  console.log(`  processed     : ${stats.processed.toLocaleString()}`);
  console.log(`  errors        : ${stats.errors}`);
  console.log(`  guest_detected: ${stats.guestDetected.toLocaleString()}  (${pct(stats.guestDetected, stats.processed)} of processed)`);
  console.log(`  brand_detected: ${stats.brandDetected.toLocaleString()}  (${pct(stats.brandDetected, stats.processed)} of processed)`);
  console.log(`  no_content    : ${stats.noContent.toLocaleString()}  (${pct(stats.noContent, stats.processed)})`);
  console.log(`  tier improved : ${stats.tierChanges.improved}  degraded: ${stats.tierChanges.degraded}  same: ${stats.tierChanges.same}`);

  // Task 3: Named channel validation
  namedValidation();

  // Task 4: Benchmark AFTER (same sample, now using updated channel_identity)
  const benchAfter = runBenchmark('AFTER', benchSample);
  console.log(`\n── Task 4: Benchmark AFTER (n=${benchAfter.n}) ────────────────`);
  console.log(`  POR@10 (niche precision)    : ${benchAfter.por10}%  (was ${benchBefore.por10}%)`);
  console.log(`  RP@5   (niche+format prec.) : ${benchAfter.rp5}%  (was ${benchBefore.rp5}%)`);
  console.log(`  EAR    (sub-band accuracy)  : ${benchAfter.ear}%  (was ${benchBefore.ear}%)`);

  console.log('\n═══════════════════════════════════════════════════════════');
  if (DRY_RUN) console.log('  DRY-RUN complete — run without --dry-run to persist changes');
  else         console.log('  Backfill complete.');
  console.log('═══════════════════════════════════════════════════════════');

  rawDb.close();
})();

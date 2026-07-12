'use strict';

/**
 * Seed Recommendation Traces (Phase 1A)
 *
 * Populates wtp_generation_traces by running WTP generation for eligible channels.
 * Generates DNA + peer-signal traces. Does NOT force arbitrary counts — seeds up
 * to the available corpus size.
 *
 * Usage:
 *   node seedRecommendationTraces.js [--dry-run] [--limit=N] [--min-videos=N] [--verbose]
 *
 * --dry-run    Report eligible channels and estimated traces without writing
 * --limit=N    Max channels to process (default: 300)
 * --min-videos Minimum ingested video count required (default: 20)
 * --verbose    Log each channel as it runs
 */

require('dotenv').config({ path: __dirname + '/../.env' });

const { getDb } = require('../db/init');
const { buildOriginalBetsForChannel } = require('../services/originalBets');
const { computeWhatToPost } = require('../services/whatToPost');
const { resolveCreatorPeerContext } = require('../services/creatorPeerContext');
const { classifyTrend, getVelocity, getFormatWinner } = require('../services/topicAnalysis');
const {
  STOPWORDS, HOOK_PHRASES, DEVANAGARI_RE, SOUTH_SCRIPT_RE, extractPhrases,
} = require('../lib/phrases');
const { PODCAST_META_TOKENS } = require('../lib/creatorMode');

const ctx = {
  resolveCreatorPeerContext,
  extractPhrases,
  getVelocity,
  classifyTrend,
  getFormatWinner,
  PODCAST_META_TOKENS,
  STOPWORDS,
  HOOK_PHRASES,
  SOUTH_SCRIPT_RE,
  DEVANAGARI_RE,
};

// ── Args ──────────────────────────────────────────────────────────────────────

function parseArgs() {
  const args      = process.argv.slice(2);
  const dryRun    = args.includes('--dry-run');
  const verbose   = args.includes('--verbose');
  const limit     = parseInt((args.find(a => a.startsWith('--limit='))     || '--limit=300').split('=')[1], 10) || 300;
  const minVideos = parseInt((args.find(a => a.startsWith('--min-videos=')) || '--min-videos=20').split('=')[1], 10) || 20;
  return { dryRun, verbose, limit, minVideos };
}

// ── Main ──────────────────────────────────────────────────────────────────────

function main() {
  const { dryRun, verbose, limit, minVideos } = parseArgs();
  const db = getDb();

  // ── Check existing trace distribution ─────────────────────────────────────
  let existingBySource = {};
  try {
    const rows = db.all(
      `SELECT rec_source, COUNT(*) AS n FROM wtp_generation_traces GROUP BY rec_source`,
      [],
    );
    for (const r of rows) existingBySource[r.rec_source || 'null'] = r.n;
  } catch (_) {}

  console.log('\n=== Seed Recommendation Traces ===');
  console.log(`Mode: ${dryRun ? 'DRY RUN' : 'LIVE'}`);
  console.log('Existing trace distribution:');
  for (const [src, n] of Object.entries(existingBySource)) {
    console.log(`  ${src.padEnd(22)} ${n} rows`);
  }
  const totalExisting = Object.values(existingBySource).reduce((s, n) => s + n, 0);
  console.log(`  Total existing: ${totalExisting}`);
  console.log();

  // ── Channels eligible for DNA traces ──────────────────────────────────────
  const dnaChannels = db.all(
    `SELECT ic.channel_id, ic.channel_name, ic.niche, ic.channel_subscribers,
            cid.confidence_score AS dna_confidence
     FROM ingested_channels ic
     JOIN creator_idea_dna cid ON cid.channel_id = ic.channel_id
     WHERE ic.ingest_enabled = 1
       AND cid.confidence_score >= 0.2
       AND (SELECT COUNT(*) FROM ingested_videos iv WHERE iv.channel_id = ic.channel_id) >= ?
     ORDER BY cid.confidence_score DESC, ic.channel_subscribers DESC
     LIMIT ?`,
    [minVideos, limit],
  );

  // ── Channels eligible for peer-signal traces (broader set) ────────────────
  const peerChannels = db.all(
    `SELECT ic.channel_id, ic.channel_name, ic.niche, ic.channel_subscribers
     FROM ingested_channels ic
     WHERE ic.ingest_enabled = 1
       AND (SELECT COUNT(*) FROM ingested_videos iv WHERE iv.channel_id = ic.channel_id) >= ?
     ORDER BY ic.channel_subscribers DESC
     LIMIT ?`,
    [minVideos, limit],
  );

  console.log(`Eligible for DNA traces:         ${dnaChannels.length} channels`);
  console.log(`Eligible for peer-signal traces: ${peerChannels.length} channels`);
  console.log();

  if (dryRun) {
    console.log('DRY RUN — no traces written. Re-run without --dry-run to populate.');
    console.log('\nSample DNA channels:');
    for (const ch of dnaChannels.slice(0, 10)) {
      console.log(`  ${(ch.channel_name || ch.channel_id).slice(0, 40).padEnd(42)} niche=${ch.niche || '?'}  confidence=${(+ch.dna_confidence || 0).toFixed(2)}`);
    }
    console.log('\nSample peer-signal channels:');
    for (const ch of peerChannels.slice(0, 10)) {
      console.log(`  ${(ch.channel_name || ch.channel_id).slice(0, 40).padEnd(42)} niche=${ch.niche || '?'}`);
    }
    return;
  }

  // ── Generate DNA traces ───────────────────────────────────────────────────
  console.log('Generating DNA traces...');
  let dnaOk = 0, dnaErr = 0, dnaNoIdeas = 0;

  for (const ch of dnaChannels) {
    try {
      const result = buildOriginalBetsForChannel(db, ch.channel_id, { limit: 14 });
      if (!result?.ideas?.length) {
        dnaNoIdeas++;
        if (verbose) console.log(`  [no_ideas] ${ch.channel_name || ch.channel_id}`);
      } else {
        dnaOk++;
        if (verbose) console.log(`  [ok] ${(ch.channel_name || ch.channel_id).slice(0, 36).padEnd(38)} ideas=${result.ideas.length}`);
      }
    } catch (e) {
      dnaErr++;
      if (verbose) console.log(`  [err] ${ch.channel_name || ch.channel_id}: ${e.message}`);
    }
  }

  console.log(`DNA traces: ok=${dnaOk}  no_ideas=${dnaNoIdeas}  err=${dnaErr}`);
  console.log();

  // ── Generate peer-signal traces ───────────────────────────────────────────
  console.log('Generating peer-signal traces...');
  let peerOk = 0, peerErr = 0, peerNoIdeas = 0;

  for (const ch of peerChannels) {
    try {
      const result = computeWhatToPost(db, {
        channel_id:       ch.channel_id,
        subscriber_count: String(ch.channel_subscribers || 0),
      }, ctx);
      if (!result?.ideas?.length) {
        peerNoIdeas++;
        if (verbose) console.log(`  [no_ideas] ${ch.channel_name || ch.channel_id}`);
      } else {
        peerOk++;
        if (verbose) console.log(`  [ok] ${(ch.channel_name || ch.channel_id).slice(0, 36).padEnd(38)} ideas=${result.ideas.length}`);
      }
    } catch (e) {
      peerErr++;
      if (verbose) console.log(`  [err] ${ch.channel_name || ch.channel_id}: ${e.message}`);
    }
  }

  console.log(`Peer-signal traces: ok=${peerOk}  no_ideas=${peerNoIdeas}  err=${peerErr}`);
  console.log();

  // ── Final distribution ────────────────────────────────────────────────────
  console.log('Final trace distribution:');
  try {
    const rows = db.all(
      `SELECT rec_source, COUNT(*) AS n FROM wtp_generation_traces GROUP BY rec_source`,
      [],
    );
    for (const r of rows) {
      const existing = existingBySource[r.rec_source || 'null'] || 0;
      const added = r.n - existing;
      console.log(`  ${(r.rec_source || 'null').padEnd(22)} ${r.n} rows (+${added} new)`);
    }
  } catch (_) {
    console.log('  (Could not read final counts)');
  }
  console.log();
}

main();

'use strict';

// Ingests all corpus_channels that have never been ingested (last_ingested_at IS NULL).
// For each channel: fetches metadata + up to 50 latest videos → corpus_videos.
// Run with:  node server/scripts/ingestAllCorpusChannels.js
// Optional:  node server/scripts/ingestAllCorpusChannels.js --all   (re-ingest everyone)

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const { getDb }                  = require('../db/init');
const { lightIngestChannelFull } = require('../services/lightIngestAgent');
const quotaGuard                 = require('../services/quotaGuard');

const BATCH_DELAY_MS  = 250;   // polite gap between channels
const MAX_PER_CHANNEL = 50;    // videos per channel (one playlist page)

const reIngestAll = process.argv.includes('--all');

async function main() {
  const db = getDb();

  const query = reIngestAll
    ? `SELECT channel_id, title, niche FROM corpus_channels ORDER BY quality_score DESC, created_at ASC`
    : `SELECT channel_id, title, niche FROM corpus_channels WHERE last_ingested_at IS NULL ORDER BY quality_score DESC, created_at ASC`;

  const channels = db.all(query);

  console.log('\n══════════════════════════════════════════════════');
  console.log('  Corpus Bulk Ingest');
  console.log('══════════════════════════════════════════════════');
  console.log(`  Mode    : ${reIngestAll ? 'ALL channels (--all)' : 'uningested only'}`);
  console.log(`  Target  : ${channels.length} channels`);
  console.log(`  Started : ${new Date().toISOString()}`);
  console.log('══════════════════════════════════════════════════\n');

  if (!channels.length) {
    console.log('Nothing to do — all corpus channels already ingested.');
    console.log('Pass --all to re-ingest everything.\n');
    return;
  }

  const results = { ok: 0, quota_exhausted: 0, no_playlist: 0, error: 0 };
  const errors  = [];

  for (let i = 0; i < channels.length; i++) {
    const ch = channels[i];

    if (!quotaGuard.quotaAvailable(3)) {
      console.log(`\n[ingest] Quota exhausted at channel ${i + 1}/${channels.length} — stopping`);
      results.quota_exhausted += channels.length - i;
      break;
    }

    try {
      const r = await lightIngestChannelFull(db, ch.channel_id, {
        maxVideos:       MAX_PER_CHANNEL,
        discoverySource: 'bulk_ingest_script',
      });

      if (r.videos?.reason === 'quota_exhausted') {
        results.quota_exhausted += channels.length - i;
        console.log(`\n[ingest] Quota exhausted mid-channel — stopping`);
        break;
      } else if (r.videos?.reason === 'no_uploads_playlist') {
        results.no_playlist++;
      } else if (!r.ok) {
        results.error++;
        errors.push({ channel_id: ch.channel_id, title: ch.title, reason: r.reason ?? 'unknown' });
      } else {
        results.ok++;
      }

      const videoCount = r.videos?.stored ?? 0;
      process.stdout.write(
        `\r  [${i + 1}/${channels.length}] ok=${results.ok} err=${results.error} ` +
        `no_playlist=${results.no_playlist} | last: ${(ch.title ?? ch.channel_id).slice(0, 40)} (+${videoCount} videos)  `,
      );
    } catch (e) {
      results.error++;
      errors.push({ channel_id: ch.channel_id, title: ch.title, reason: e.message });
      process.stdout.write(`\r  [${i + 1}/${channels.length}] ERROR: ${e.message.slice(0, 60)}  `);
    }

    if (i + 1 < channels.length) await new Promise(r => setTimeout(r, BATCH_DELAY_MS));
  }

  const corpusVideoCount = db.get('SELECT COUNT(*) AS n FROM corpus_videos').n;

  console.log('\n\n══════════════════════════════════════════════════');
  console.log('  RESULTS');
  console.log('══════════════════════════════════════════════════');
  console.log(`  ✓ Successfully ingested : ${results.ok}`);
  console.log(`  ✗ Errors               : ${results.error}`);
  console.log(`  ○ No uploads playlist  : ${results.no_playlist}`);
  console.log(`  ⏸ Quota exhausted      : ${results.quota_exhausted}`);
  console.log(`  Total corpus_videos now: ${corpusVideoCount.toLocaleString()}`);
  console.log(`  Finished: ${new Date().toISOString()}`);

  if (errors.length) {
    console.log('\n  Failed channels:');
    for (const e of errors.slice(0, 20)) {
      console.log(`    ${(e.title ?? e.channel_id).padEnd(40)} ${e.reason}`);
    }
    if (errors.length > 20) console.log(`    ... and ${errors.length - 20} more`);
  }

  console.log('══════════════════════════════════════════════════\n');
}

main().catch(e => { console.error('\nFATAL:', e.message); process.exit(1); });

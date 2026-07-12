'use strict';

// ── What-to-Post Benchmark ────────────────────────────────────────────────────
// Evaluates suggestion quality by treating past suggestions as counterfactuals
// and measuring how the peer ecosystem actually behaved in the 30 days after.
//
// Usage:
//   node server/scripts/benchmarkWhatToPost.js
//   node server/scripts/benchmarkWhatToPost.js --limit=100 --version=v1 --ref-days-ago=60
//
// Metrics computed per suggestion:
//   EAR  — Ecosystem Adoption Rate: % of peer pool that posted this topic in [ref, ref+30d]
//   RP@k — Rank Precision @ k: whether top-k suggestions by score had higher EAR than bottom
//   POR  — Peer Outperformance Ratio: avg views of adopters vs non-adopters (requires snapshots)
//   rank_at_10 — did this suggestion land in the top 10 by EAR across all suggestions for channel?

require('dotenv').config({ path: __dirname + '/../.env' });

const { getDb }             = require('../db/init');
const { computeWhatToPost } = require('../routes/creatorIntel');

// ── Parse CLI args ─────────────────────────────────────────────────────────────
const args = Object.fromEntries(
  process.argv.slice(2)
    .filter(a => a.startsWith('--'))
    .map(a => {
      const [k, v] = a.slice(2).split('=');
      return [k, v === undefined ? true : v];
    }),
);

const LIMIT       = parseInt(args['limit']       || '200', 10);
const VERSION     = args['version']              || 'v1';
const REF_DAYS    = parseInt(args['ref-days-ago'] || '60',  10);  // how far back is the "recommendation date"
const WINDOW_DAYS = 30;  // how many days after ref_date to look for peer adoption
const DRY_RUN     = args['dry-run'] === true || args['dry-run'] === 'true';

// ── Reference date ─────────────────────────────────────────────────────────────
const refDate     = new Date(Date.now() - REF_DAYS * 86400000);
const refDateStr  = refDate.toISOString().slice(0, 10);
const windowEnd   = new Date(refDate.getTime() + WINDOW_DAYS * 86400000).toISOString().slice(0, 10);

console.log('');
console.log('══════════════════════════════════════════════════════');
console.log('  WHAT-TO-POST BENCHMARK');
console.log(`  version=${VERSION}  ref_date=${refDateStr}  window_end=${windowEnd}`);
console.log(`  limit=${LIMIT}  dry_run=${DRY_RUN}`);
console.log('══════════════════════════════════════════════════════');
console.log('');

// ── Helpers ───────────────────────────────────────────────────────────────────
function phraseInTitle(phrase, title) {
  return title.toLowerCase().includes(phrase.toLowerCase());
}

function computeEAR(db, peerIds, phrase, windowStart, windowEnd) {
  if (!peerIds.length) return null;
  const ph = peerIds.map(() => '?').join(',');
  const matched = db.get(
    `SELECT COUNT(DISTINCT channel_id) AS n
     FROM ingested_videos
     WHERE channel_id IN (${ph})
       AND published_at >= ? AND published_at < ?
       AND title LIKE ?`,
    [...peerIds, windowStart, windowEnd, `%${phrase}%`],
  );
  return matched?.n != null ? matched.n / peerIds.length : null;
}

function computePOR(db, peerIds, phrase, windowStart, windowEnd) {
  if (!peerIds.length) return null;
  const ph = peerIds.map(() => '?').join(',');

  const adopters = db.all(
    `SELECT DISTINCT channel_id FROM ingested_videos
     WHERE channel_id IN (${ph}) AND published_at >= ? AND published_at < ? AND title LIKE ?`,
    [...peerIds, windowStart, windowEnd, `%${phrase}%`],
  ).map(r => r.channel_id);

  if (!adopters.length || adopters.length === peerIds.length) return null;

  const nonAdopters = peerIds.filter(id => !adopters.includes(id));

  function avgViews(ids) {
    if (!ids.length) return 0;
    const iph = ids.map(() => '?').join(',');
    const row = db.get(
      `SELECT AVG(views) AS avg FROM ingested_videos WHERE channel_id IN (${iph}) AND published_at >= ? AND published_at < ?`,
      [...ids, windowStart, windowEnd],
    );
    return row?.avg || 0;
  }

  const adopterAvg    = avgViews(adopters);
  const nonAdopterAvg = avgViews(nonAdopters);
  return nonAdopterAvg > 0 ? adopterAvg / nonAdopterAvg : null;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function run() {
  const db = getDb();

  // Get channels to benchmark (those with content fingerprints and enough videos)
  const channels = db.all(
    `SELECT channel_id, channel_name, niche, channel_subscribers
     FROM ingested_channels
     WHERE ingest_enabled = 1
       AND content_fingerprint IS NOT NULL
       AND (SELECT COUNT(*) FROM ingested_videos iv WHERE iv.channel_id = ingested_channels.channel_id) >= 20
     ORDER BY channel_subscribers DESC
     LIMIT ?`,
    [LIMIT],
  );

  if (!channels.length) {
    console.log('No eligible channels found. Run the pipeline first to build content fingerprints.');
    process.exit(0);
  }

  console.log(`Benchmarking ${channels.length} channels...`);
  console.log('');

  const insertResult = db.transaction((row) => {
    db.run(
      `INSERT OR REPLACE INTO benchmark_results
       (run_date, version, channel_id, topic, score, trend_label, rank_in_run, ear, por, fmas, owd, rank_at_10, peer_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        refDateStr, VERSION, row.channel_id, row.topic, row.score, row.trend_label,
        row.rank_in_run, row.ear, row.por, null, null, row.rank_at_10, row.peer_count,
      ],
    );
  });

  let totalSuggestions = 0;
  let totalWithEAR     = 0;
  let earSum           = 0;
  let rp10Hits         = 0;
  let rp10Total        = 0;

  for (const ch of channels) {
    let result;
    try {
      result = computeWhatToPost(db, {
        channel_id:     ch.channel_id,
        subscriber_count: String(ch.channel_subscribers || 0),
        reference_date: refDateStr,
      });
    } catch (e) {
      console.warn(`  [skip] ${ch.channel_name || ch.channel_id}: ${e.message}`);
      continue;
    }

    const ideas = result?.ideas || [];
    if (!ideas.length) continue;

    // Compute EAR for each suggestion using the ACTUAL peer pool from the result
    // (We use peer_count from the result as a proxy — actual peer IDs aren't returned,
    //  so we re-derive them via a quick query matching the phrase across niche peers)
    const nicheIds = db.all(
      `SELECT channel_id FROM ingested_channels
       WHERE COALESCE(primary_niche, niche) = ? AND channel_id != ? AND ingest_enabled = 1 LIMIT 300`,
      [ch.niche || 'other', ch.channel_id],
    ).map(r => r.channel_id);

    const earByTopic = [];
    for (let i = 0; i < ideas.length; i++) {
      const idea       = ideas[i];
      const rawPhrase  = idea.topic.toLowerCase();
      const ear        = computeEAR(db, nicheIds, rawPhrase, refDateStr, windowEnd);
      const por        = computePOR(db, nicheIds, rawPhrase, refDateStr, windowEnd);

      earByTopic.push({ idx: i, ear, por, score: idea.score, topic: rawPhrase });
    }

    // RP@k: did top-5 suggestions have higher EAR than bottom-5?
    const withEAR  = earByTopic.filter(t => t.ear !== null);
    const ranked   = [...withEAR].sort((a, b) => (b.ear || 0) - (a.ear || 0));
    const rankMap  = new Map(ranked.map((t, i) => [t.topic, i + 1]));

    for (let i = 0; i < ideas.length; i++) {
      const idea   = ideas[i];
      const entry  = earByTopic[i];
      const rankAt10 = rankMap.get(entry.topic) ?? null;

      if (!DRY_RUN) {
        insertResult({
          channel_id:  ch.channel_id,
          topic:       idea.topic,
          score:       idea.score,
          trend_label: idea.trend_status,
          rank_in_run: i + 1,
          ear:         entry.ear,
          por:         entry.por,
          rank_at_10:  rankAt10,
          peer_count:  result.channel_count,
        });
      }

      totalSuggestions++;
      if (entry.ear !== null) {
        totalWithEAR++;
        earSum += entry.ear;
        rp10Total++;
        // Top-5 by score that also land top-5 by EAR = hit
        if (i < 5 && rankAt10 !== null && rankAt10 <= 5) rp10Hits++;
      }
    }

    const avgEarForChannel = withEAR.length
      ? (withEAR.reduce((s, t) => s + (t.ear || 0), 0) / withEAR.length * 100).toFixed(1)
      : 'n/a';
    console.log(`  ${ch.channel_name || ch.channel_id.slice(-6)} | ${ideas.length} ideas | avg_EAR=${avgEarForChannel}% | peers=${result.channel_count}`);
  }

  console.log('');
  console.log('──────────────────────────────────────────────────────');
  console.log('  BENCHMARK SUMMARY');
  console.log(`  Total suggestions evaluated : ${totalSuggestions}`);
  console.log(`  Suggestions with EAR data   : ${totalWithEAR}`);
  if (totalWithEAR > 0) {
    console.log(`  Mean EAR (adoption rate)    : ${(earSum / totalWithEAR * 100).toFixed(1)}%`);
    console.log(`  RP@5 (score→EAR precision)  : ${rp10Total > 0 ? (rp10Hits / rp10Total * 100).toFixed(1) : 'n/a'}%`);
  }
  if (DRY_RUN) console.log('\n  [DRY RUN] — nothing written to benchmark_results table');
  console.log('──────────────────────────────────────────────────────');
  console.log('');

  process.exit(0);
}

run().catch(e => {
  console.error('FATAL:', e.message);
  process.exit(1);
});

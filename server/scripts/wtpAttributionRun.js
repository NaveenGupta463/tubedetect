'use strict';

// WTP Attribution Run — score recently-ingested videos against WTP behavioral signals
// and write candidates to wtp_attribution_candidates. Auto-promotes highly_likely matches
// to wtp_video_matches. Surfaces possible matches for creator confirmation via the API.
//
// Usage:
//   node server/scripts/wtpAttributionRun.js
//   node server/scripts/wtpAttributionRun.js --all           # re-score already-processed videos
//   node server/scripts/wtpAttributionRun.js --channel=UCxx  # single channel only
//   node server/scripts/wtpAttributionRun.js --dry-run       # no DB writes
//   node server/scripts/wtpAttributionRun.js --days=60       # video lookback window (default 90)
//   node server/scripts/wtpAttributionRun.js --verbose       # print per-candidate detail

require('dotenv').config({ path: __dirname + '/../.env' });

const path = require('path');
const BetterSqlite3 = require('../node_modules/better-sqlite3');
const {
  buildCandidates,
  upsertCandidate,
  promoteToVideoMatch,
  MAX_LOOKBACK_DAYS,
  SCORE_THRESHOLDS,
} = require('../services/wtpAttributionMatcher');

// ── CLI args ──────────────────────────────────────────────────────────────────
const args = Object.fromEntries(
  process.argv.slice(2)
    .filter(a => a.startsWith('--'))
    .map(a => {
      const [k, v] = a.slice(2).split('=');
      return [k, v === undefined ? true : isNaN(v) ? v : Number(v)];
    }),
);

const ALL     = !!args.all;
const DRY_RUN = !!args['dry-run'];
const VERBOSE = !!args.verbose;
const CHANNEL = args.channel ? String(args.channel) : null;
const DAYS    = Math.max(7, Math.min(365, Number(args.days) || MAX_LOOKBACK_DAYS));

// ── DB ────────────────────────────────────────────────────────────────────────
function openDb() {
  const raw = new BetterSqlite3(path.resolve(__dirname, '../data/scoring.db'), {
    readonly: false, fileMustExist: true, timeout: 60000,
  });
  raw.pragma('journal_mode=WAL');
  raw.pragma('busy_timeout=60000');
  raw.pragma('synchronous=NORMAL');
  const stmtCache = new Map();
  const stmt = sql => {
    if (!stmtCache.has(sql)) stmtCache.set(sql, raw.prepare(sql));
    return stmtCache.get(sql);
  };
  return {
    all:         (sql, p = []) => stmt(sql).all(Array.isArray(p) ? p : [p]),
    get:         (sql, p = []) => stmt(sql).get(Array.isArray(p) ? p : [p]),
    run:         (sql, p = []) => stmt(sql).run(Array.isArray(p) ? p : [p]),
    transaction: fn => raw.transaction(fn),
    close:       () => { stmtCache.clear(); raw.close(); },
  };
}

// Find ingested videos published within DAYS for channels that have WTP activity.
// Skips videos already in wtp_attribution_candidates unless --all.
function fetchVideos(db) {
  const since    = new Date(Date.now() - DAYS * 86400000).toISOString().slice(0, 10);
  const chFilter = CHANNEL ? 'AND iv.channel_id = ?' : '';
  const chParams = CHANNEL ? [since, CHANNEL] : [since];

  const noveltyGuard = ALL ? '' :
    `AND NOT EXISTS (
       SELECT 1 FROM wtp_attribution_candidates wac
       WHERE wac.video_id = iv.youtube_video_id AND wac.channel_id = iv.channel_id
     )`;

  return db.all(
    `SELECT iv.youtube_video_id AS video_id, iv.channel_id,
            COALESCE(iv.title, '') AS video_title,
            iv.published_at
     FROM ingested_videos iv
     WHERE iv.published_at >= ?
       AND iv.published_at IS NOT NULL
       ${chFilter}
       ${noveltyGuard}
       AND EXISTS (
         SELECT 1 FROM wtp_impressions wi WHERE wi.channel_id = iv.channel_id LIMIT 1
       )
     ORDER BY iv.published_at DESC`,
    chParams,
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
const TODAY = new Date().toISOString().slice(0, 10);
const db    = openDb();

console.log('');
console.log('══════════════════════════════════════════════════════════════════');
console.log('  WTP ATTRIBUTION RUN  —  ' + TODAY);
if (DRY_RUN)  console.log('  MODE: dry-run (no writes)');
if (ALL)      console.log('  MODE: --all (re-score already-processed videos)');
if (CHANNEL)  console.log(`  Channel filter: ${CHANNEL}`);
console.log(`  Video lookback: ${DAYS} days  |  Behavior lookback: ${MAX_LOOKBACK_DAYS} days`);
console.log('══════════════════════════════════════════════════════════════════');
console.log('');

const videos = fetchVideos(db);
console.log(`  Found ${videos.length} video(s) to process.`);

if (!videos.length) {
  console.log('');
  console.log('  Nothing to process. Possible reasons:');
  console.log('  • No recently ingested videos on channels with WTP activity');
  console.log('  • All videos already processed (run --all to force reprocess)');
  console.log('  • No wtp_impressions recorded for any channel (WTP endpoint not called)');
  console.log('');
  db.close();
  process.exit(0);
}

const counts = { videos: 0, candidates: 0, highlyLikely: 0, possible: 0, promoted: 0, errors: 0 };
const BAR_WIDTH = 30;

console.log('');
console.log('  Processing...');
console.log('');

for (let i = 0; i < videos.length; i++) {
  const video = videos[i];

  const pct    = Math.round((i / videos.length) * 100);
  const filled = Math.round((i / videos.length) * BAR_WIDTH);
  process.stdout.write(
    `  [${'█'.repeat(filled)}${'░'.repeat(BAR_WIDTH - filled)}] ${pct}% (${i}/${videos.length})\r`,
  );

  try {
    const candidates = buildCandidates(
      db, video.channel_id, video.video_id, video.video_title, video.published_at,
    );
    counts.videos++;

    if (DRY_RUN) {
      const hl = candidates.filter(c => c.match_confidence === 'highly_likely').length;
      const po = candidates.filter(c => c.match_confidence === 'possible').length;
      if (VERBOSE) {
        console.log(`  [dry]  ${video.video_id}  candidates=${candidates.length}  hl=${hl}  possible=${po}`);
        console.log(`         "${String(video.video_title).slice(0, 65)}"`);
        for (const c of candidates.filter(c => c.match_confidence !== 'unlikely')) {
          const signals = [c.had_export && 'export', c.had_brief && 'brief', c.had_save && 'save']
            .filter(Boolean).join('+') || 'none';
          console.log(
            `           [${c.match_confidence.padEnd(12)}] score=${String(c.total_score).padStart(3)}` +
            `  ${signals.padEnd(13)}  age=${c.recommendation_age_days != null ? `${c.recommendation_age_days}d` : 'n/a'}` +
            `  sim=${c.title_sim_score.toFixed(2)}  "${String(c.topic).slice(0, 40)}"`,
          );
        }
      }
      counts.candidates  += candidates.filter(c => c.match_confidence !== 'unlikely').length;
      counts.highlyLikely += hl;
      counts.possible     += po;
      continue;
    }

    const tx = db.transaction(() => {
      for (const c of candidates) {
        if (c.match_confidence === 'unlikely') continue;

        upsertCandidate(db, c);
        counts.candidates++;

        if (c.match_confidence === 'highly_likely') {
          counts.highlyLikely++;
          if (promoteToVideoMatch(db, c)) counts.promoted++;
        } else {
          counts.possible++;
        }

        if (VERBOSE) {
          const signals = [c.had_export && 'export', c.had_brief && 'brief', c.had_save && 'save']
            .filter(Boolean).join('+') || 'none';
          console.log(
            `  [${c.match_confidence.padEnd(12)}] score=${String(c.total_score).padStart(3)}` +
            `  ${signals.padEnd(13)}  age=${c.recommendation_age_days != null ? `${c.recommendation_age_days}d` : 'n/a'}` +
            `  sim=${c.title_sim_score.toFixed(2)}  "${String(c.topic).slice(0, 45)}"`,
          );
        }
      }
    });
    tx();
  } catch (e) {
    counts.errors++;
    if (VERBOSE) console.log(`  [error] ${video.video_id}: ${e.message}`);
  }
}

process.stdout.write(`  [${'█'.repeat(BAR_WIDTH)}] 100% (${videos.length}/${videos.length})\n`);

// ── Summary ───────────────────────────────────────────────────────────────────
console.log('');
console.log('  ══════════════════════════════════════════════════════════════════');
console.log(`  ATTRIBUTION RUN COMPLETE  (${DRY_RUN ? 'dry run — no writes' : 'writes committed'})`);
console.log('');
console.log(`  Videos processed:     ${counts.videos}`);
console.log(`  Candidates written:   ${counts.candidates}  (unlikely excluded)`);
console.log(`    highly_likely:      ${counts.highlyLikely}  → auto-promoted to wtp_video_matches`);
console.log(`    possible:           ${counts.possible}  → awaiting creator confirmation`);
if (!DRY_RUN) console.log(`  Promoted to matches:  ${counts.promoted}`);
if (counts.errors) console.log(`  Errors:               ${counts.errors}`);
console.log('');
console.log('  Scoring:');
console.log(`    Behavioral: export +40  brief +30  save +20`);
console.log(`    Age: <7d +15  <21d +10  <45d +5  ≥90d -10`);
console.log(`    Title sim: ≥0.40 +25  ≥0.25 +15  ≥0.10 +5`);
console.log(`    highly_likely: score ≥ ${SCORE_THRESHOLDS.highlyLikely} AND (export OR brief)`);
console.log(`    possible:      score ≥ ${SCORE_THRESHOLDS.possible}`);
if (counts.possible > 0 && !DRY_RUN) {
  console.log('');
  console.log(`  ${counts.possible} candidate(s) awaiting creator confirmation:`);
  console.log('    GET /api/intel/wtp-attribution/pending?channel_id=<id>');
}
console.log('  ══════════════════════════════════════════════════════════════════');
console.log('');

db.close();
process.exit(counts.errors > 0 ? 1 : 0);

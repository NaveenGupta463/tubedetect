'use strict';

// Phase DNA-1: build cached creator idea DNA from stored uploads only.
//
// Usage:
//   node server/scripts/backfillCreatorIdeaDna.js --name "Aevy TV" --inspect --force
//   node server/scripts/backfillCreatorIdeaDna.js --channel-id UC... --inspect
//   node server/scripts/backfillCreatorIdeaDna.js --limit 100

const { getDb } = require('../db/init');
const {
  CREATOR_IDEA_DNA_VERSION,
  DEFAULT_VIDEO_LIMIT,
  persistCreatorIdeaDna,
  readCreatorIdeaDna,
} = require('../services/creatorIdeaDna');

function argValue(name, fallback = null) {
  const exact = process.argv.indexOf(name);
  if (exact !== -1 && exact + 1 < process.argv.length) return process.argv[exact + 1];
  const prefix = `${name}=`;
  const found = process.argv.find(arg => arg.startsWith(prefix));
  if (found) return found.slice(prefix.length);
  return fallback;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function toInt(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function lookupChannelByName(db, name) {
  const needle = String(name || '').trim().toLowerCase();
  if (!needle) return null;
  return db.get(
    `SELECT channel_id, channel_name, channel_subscribers
       FROM ingested_channels
      WHERE lower(channel_name) LIKE ?
      ORDER BY channel_subscribers DESC
      LIMIT 1`,
    [`%${needle}%`],
  );
}

function selectTargets(db, options) {
  if (options.channelId) {
    const row = db.get(
      `SELECT channel_id, channel_name FROM ingested_channels WHERE channel_id = ?`,
      [options.channelId],
    );
    return row ? [row] : [];
  }

  if (options.name) {
    const row = lookupChannelByName(db, options.name);
    return row ? [row] : [];
  }

  return db.all(
    `SELECT ic.channel_id, ic.channel_name, COUNT(iv.youtube_video_id) AS video_count
       FROM ingested_channels ic
       JOIN ingested_videos iv ON iv.channel_id = ic.channel_id
       LEFT JOIN creator_idea_dna cid ON cid.channel_id = ic.channel_id
      WHERE ic.ingest_enabled = 1
        AND iv.title IS NOT NULL
        AND iv.title != ''
        ${options.force ? '' : 'AND (cid.channel_id IS NULL OR cid.source_version < ?)'}
      GROUP BY ic.channel_id
      ORDER BY video_count DESC, ic.channel_subscribers DESC
      LIMIT ?`,
    options.force ? [options.limit] : [CREATOR_IDEA_DNA_VERSION, options.limit],
  );
}

function topLabels(rows, limit = 8) {
  return (rows || [])
    .slice(0, limit)
    .map(row => `${row.label || row.id} (${row.count})`)
    .join(', ') || 'none';
}

function inspectChannel(db, channelId, result) {
  const row = readCreatorIdeaDna(db, channelId);
  if (!row) {
    console.log('  No creator_idea_dna row found after processing.');
    return;
  }

  const stable = row.stable_dna || {};
  const constraints = stable.creator_constraints || {};
  const negative = row.negative_dna || {};
  const recentTitles = (result?.signals || []).slice(0, 8).map(signal => signal.title);

  console.log('\n=== Inspect: Creator Idea DNA ===');
  console.log(`Channel       : ${result?.channel?.channel_name || channelId}`);
  console.log(`Channel ID    : ${channelId}`);
  console.log(`Confidence    : ${row.confidence} (${Number(row.confidence_score || 0).toFixed(3)})`);
  console.log(`Sample        : ${row.sample_count} videos | long=${row.long_count} short=${row.short_count}`);
  console.log(`Drift         : ${row.drift_status} (${Number(row.drift_score || 0).toFixed(3)})`);
  console.log(`CSP/Niche     : ${constraints.csp || 'unknown'} / ${constraints.niche || 'unknown'}`);
  console.log(`Language/Geo  : ${constraints.language || 'unknown'} / ${constraints.region || 'unknown'}`);
  console.log(`Format mix    : long_share=${constraints.long_form_share} short_share=${constraints.short_clip_share} dominant=${constraints.dominant_duration_bucket}`);

  console.log('\nTop domains:');
  console.log(`  ${topLabels(row.domain_tags, 10)}`);
  console.log('\nTop thesis patterns:');
  console.log(`  ${topLabels(row.thesis_patterns, 10)}`);
  console.log('\nTop hooks:');
  console.log(`  ${topLabels(row.hook_templates, 10)}`);
  console.log('\nTop micro-topics:');
  console.log(`  ${topLabels(row.micro_topics, 12)}`);
  console.log('\nTop entities:');
  console.log(`  ${topLabels(row.entities, 10)}`);
  console.log('\nMismatch negatives:');
  const mismatches = negative.mismatch_families || [];
  console.log(`  ${mismatches.slice(0, 8).map(m => m.id).join(', ') || 'none'}`);

  console.log('\nRecent stored titles used:');
  for (const title of recentTitles) {
    console.log(`  - ${title}`);
  }
  console.log('');
}

function main() {
  const db = getDb();
  const options = {
    channelId: argValue('--channel-id') || argValue('--channel'),
    name: argValue('--name'),
    limit: toInt(argValue('--limit'), 100),
    videoLimit: toInt(argValue('--video-limit'), DEFAULT_VIDEO_LIMIT),
    force: hasFlag('--force'),
    inspect: hasFlag('--inspect'),
  };

  const targets = selectTargets(db, options);
  console.log('\n=== Creator Idea DNA Backfill ===');
  console.log(`Version     : ${CREATOR_IDEA_DNA_VERSION}`);
  console.log(`Targets     : ${targets.length}`);
  console.log(`Video limit : ${options.videoLimit}`);
  console.log(`Force       : ${options.force}`);

  if (!targets.length) {
    console.log('No matching channels found.');
    return;
  }

  let ok = 0;
  let failed = 0;
  const started = Date.now();
  let lastResult = null;

  for (let i = 0; i < targets.length; i++) {
    const target = targets[i];
    const label = target.channel_name || target.channel_id;
    try {
      const result = persistCreatorIdeaDna(db, target.channel_id, { limit: options.videoLimit });
      lastResult = result;
      if (!result.ok) {
        failed++;
        console.warn(`[skip] ${label}: ${result.reason}`);
        continue;
      }
      ok++;
      const dna = result.dna;
      console.log(
        `[ok] ${label} | conf=${dna.confidence}/${dna.confidence_score} | ` +
        `sample=${dna.sample_count} long=${dna.long_count} short=${dna.short_count} | ` +
        `drift=${dna.drift_status}/${dna.drift_score}`,
      );
    } catch (e) {
      failed++;
      console.warn(`[fail] ${label}: ${e.message}`);
    }

    const done = i + 1;
    if (done % 100 === 0 || done === targets.length) {
      const elapsed = ((Date.now() - started) / 1000).toFixed(1);
      console.log(`[progress] ${done}/${targets.length} | ok=${ok} failed=${failed} | ${elapsed}s`);
    }
  }

  if (options.inspect && targets.length === 1) {
    inspectChannel(db, targets[0].channel_id, lastResult);
  }

  console.log(`[done] ok=${ok} failed=${failed}`);
}

try {
  main();
} catch (e) {
  console.error('[creator-idea-dna] Fatal:', e.stack || e.message);
  process.exitCode = 1;
}

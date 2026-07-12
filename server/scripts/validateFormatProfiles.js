'use strict';

// Validates format_profile assignment across all profiles.
// For each profile, finds up to 5 matching channels and prints:
//   channel name, detected profile, confidence, creator_mode, top 5 titles, key signals
//
// Usage:
//   node server/scripts/validateFormatProfiles.js
//   node server/scripts/validateFormatProfiles.js --profile guest_interview
//   node server/scripts/validateFormatProfiles.js --stats   (confidence table only)
//   node server/scripts/validateFormatProfiles.js --channel <channel_id>

const { getDb } = require('../db/init');
const { FORMAT_PROFILES, computeFormatProfile } = require('../lib/formatProfile');

const PROFILES    = Object.keys(FORMAT_PROFILES).filter(p => p !== 'unknown');
const FILTER      = process.argv.find(a => a.startsWith('--profile='))?.split('=')[1]
                 || (process.argv.includes('--profile') ? process.argv[process.argv.indexOf('--profile') + 1] : null);
const CHANNEL_ID  = process.argv.find(a => a.startsWith('--channel='))?.split('=')[1]
                 || (process.argv.includes('--channel') ? process.argv[process.argv.indexOf('--channel') + 1] : null);
const STATS_ONLY  = process.argv.includes('--stats');

// Niche groups to sample from when no backfilled format_profile exists yet.
const FALLBACK_NICHE_GROUPS = {
  guest_interview:       ['podcast', 'interview', 'talk show', 'entrepreneur', 'selfimprovement'],
  podcast_like_longform: ['podcast', 'interview', 'talk show', 'storytelling', 'education'],
  solo_teaching:         ['yoga', 'meditation', 'wellness', 'fitness', 'education', 'selfimprovement'],
  lecture:               ['education', 'upsc', 'competitive exams', 'academic'],
  shorts:                ['comedy', 'entertainment', 'fitness', 'lifestyle'],
  essay:                 ['philosophy', 'commentary', 'documentary', 'opinion'],
  news_bulletin:         ['news', 'politics', 'current affairs', 'journalism'],
  vlog:                  ['lifestyle', 'travel', 'daily vlog', 'entertainment'],
  reaction:              ['entertainment', 'comedy', 'gaming', 'react'],
  documentary:           ['documentary', 'history', 'investigative', 'biography'],
};

async function main() {
  const db = getDb();

  if (CHANNEL_ID) {
    auditChannel(db, CHANNEL_ID);
    return;
  }

  if (STATS_ONLY) {
    printStats(db);
    return;
  }

  const targetProfiles = FILTER ? [FILTER] : PROFILES;

  for (const profile of targetProfiles) {
    console.log(`\n${'─'.repeat(72)}`);
    console.log(`FORMAT PROFILE: ${profile}`);
    console.log('─'.repeat(72));

    let candidates = db.all(
      `SELECT channel_id, channel_name, primary_niche, niche, creator_mode, format_profile
       FROM ingested_channels
       WHERE format_profile = ? AND ingest_enabled = 1
       LIMIT 50`,
      [profile],
    );

    if (candidates.length === 0) {
      const nicheGroup = FALLBACK_NICHE_GROUPS[profile] || [];
      if (nicheGroup.length > 0) {
        const ph = nicheGroup.map(() => '?').join(',');
        candidates = db.all(
          `SELECT channel_id, channel_name, primary_niche, niche, creator_mode, format_profile
           FROM ingested_channels
           WHERE (niche IN (${ph}) OR primary_niche IN (${ph})) AND ingest_enabled = 1
           ORDER BY channel_subscribers DESC LIMIT 100`,
          [...nicheGroup, ...nicheGroup],
        );
      }
    }

    let shown         = 0;
    let falsePositives = 0;
    const confCounts  = { high: 0, medium: 0, low: 0, none: 0 };

    for (const ch of candidates) {
      const titles = db.all(
        `SELECT title FROM ingested_videos
         WHERE channel_id = ? AND title IS NOT NULL
         ORDER BY published_at DESC LIMIT 60`,
        [ch.channel_id],
      ).map(r => r.title);

      if (titles.length < 5) continue;

      const result = computeFormatProfile(titles, ch);
      confCounts[result.confidence || 'none']++;

      if (result.format_profile !== profile) {
        falsePositives++;
        continue;
      }

      if (shown < 5) {
        shown++;
        console.log(`\n  [${shown}] ${ch.channel_name}`);
        console.log(`       niche=${ch.primary_niche || ch.niche}  mode=${ch.creator_mode || '—'}`);
        console.log(`       → format=${result.format_profile}  conf=${result.confidence}`);
        const s = result.signals;
        console.log(`       signals: ep=${s.episode_count}  guest_hits=${s.guest_hits}  distinct_guests=${s.distinct_guests}  shorts=${s.shorts_count}  teaching=${s.teaching_count}`);
        console.log(`       recent titles:`);
        for (const t of titles.slice(0, 5)) console.log(`         • ${t}`);
      }
    }

    if (shown === 0) console.log('  (no matching channels found for this profile)');
    console.log(`\n  sampled=${candidates.length}  matched=${shown}  false_positives=${falsePositives}`);
    console.log(`  confidence breakdown:  high=${confCounts.high}  medium=${confCounts.medium}  low=${confCounts.low}`);
  }

  console.log('\n');
  printStats(db);
}

function auditChannel(db, channelId) {
  const ch = db.get(
    `SELECT channel_id, channel_name, primary_niche, niche, creator_mode, format_profile, format_profile_confidence
     FROM ingested_channels WHERE channel_id = ?`,
    [channelId],
  );
  if (!ch) { console.log('Channel not found:', channelId); return; }

  const titles = db.all(
    `SELECT title FROM ingested_videos
     WHERE channel_id = ? AND title IS NOT NULL
     ORDER BY published_at DESC LIMIT 60`,
    [channelId],
  ).map(r => r.title);

  const result = computeFormatProfile(titles, ch);
  console.log(`\nChannel: ${ch.channel_name}`);
  console.log(`  stored:   format_profile=${ch.format_profile}  conf=${ch.format_profile_confidence}`);
  console.log(`  computed: format_profile=${result.format_profile}  conf=${result.confidence}`);
  console.log(`  signals:`, JSON.stringify(result.signals, null, 2));
  console.log(`  recent titles:`);
  for (const t of titles.slice(0, 10)) console.log(`    • ${t}`);
}

function printStats(db) {
  console.log('\n=== Confidence counts by format profile (all backfilled channels) ===');
  const rows = db.all(
    `SELECT format_profile, format_profile_confidence, COUNT(*) AS n
     FROM ingested_channels
     WHERE format_profile IS NOT NULL
     GROUP BY format_profile, format_profile_confidence
     ORDER BY format_profile, format_profile_confidence`,
  );

  const byProfile = {};
  for (const r of rows) {
    if (!byProfile[r.format_profile]) byProfile[r.format_profile] = {};
    byProfile[r.format_profile][r.format_profile_confidence] = r.n;
  }
  for (const [p, counts] of Object.entries(byProfile)) {
    const h = counts.high || 0, m = counts.medium || 0, l = counts.low || 0;
    console.log(`  ${p.padEnd(28)} high=${String(h).padStart(4)}  medium=${String(m).padStart(4)}  low=${String(l).padStart(4)}`);
  }

  console.log('\n=== creator_mode × format_profile table (top combos) ===');
  const xRows = db.all(
    `SELECT COALESCE(creator_mode, 'unknown') AS mode, format_profile, COUNT(*) AS n
     FROM ingested_channels
     WHERE format_profile IS NOT NULL
     GROUP BY mode, format_profile
     ORDER BY n DESC
     LIMIT 40`,
  );
  for (const r of xRows) {
    console.log(`  ${r.mode.padEnd(20)} × ${(r.format_profile || '').padEnd(28)} = ${r.n}`);
  }
}

main().catch(err => { console.error(err); process.exit(1); });

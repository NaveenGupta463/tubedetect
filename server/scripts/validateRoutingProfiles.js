'use strict';

// Validates routing_profile assignment across all profiles.
// For each profile, finds up to 5 matching channels and prints:
//   channel name, detected profile, confidence, top 5 titles
// Also prints false-positive candidates and confidence counts.
//
// Usage:
//   node server/scripts/validateRoutingProfiles.js
//   node server/scripts/validateRoutingProfiles.js --profile business_finance
//   node server/scripts/validateRoutingProfiles.js --stats   (confidence table only)

const { getDb }                  = require('../db/init');
const { ROUTING_PROFILES, computeRoutingProfile } = require('../lib/routingProfiles');

const PROFILES = Object.keys(ROUTING_PROFILES);
const FILTER   = process.argv.find(a => a.startsWith('--profile='))?.split('=')[1]
              || (process.argv.includes('--profile') ? process.argv[process.argv.indexOf('--profile') + 1] : null);
const STATS_ONLY = process.argv.includes('--stats');

// DB niche values to sample from when no backfilled routing_profile exists yet.
const FALLBACK_NICHE_GROUPS = {
  physical_yoga:          ['yoga', 'fitness', 'wellness', 'health'],
  meditation_spirituality:['meditation', 'spirituality', 'mindfulness', 'wellness', 'yoga'],
  pain_relief_therapy:    ['yoga', 'health', 'wellness', 'fitness'],
  fitness_flexibility:    ['fitness', 'health', 'wellness', 'yoga', 'sports'],
  fitness_transformation: ['fitness', 'health', 'wellness', 'nutrition'],
  manifestation_healing:  ['selfimprovement', 'wellness', 'mindfulness', 'spirituality',
                            'meditation', 'healing', 'personal development'],
  relationship_selfwork:  ['selfimprovement', 'lifestyle', 'personal development',
                            'wellness', 'motivation'],
  general_selfimprovement:['selfimprovement', 'motivation', 'mindset',
                            'personal development', 'leadership lessons'],
  business_finance:       ['finance', 'business', 'economics', 'investment',
                            'personal finance', 'entrepreneur', 'money'],
  startup_founder:        ['startup', 'entrepreneur', 'business', 'tech', 'technology'],
  tech_ai:                ['technology', 'tech', 'programming', 'ai', 'software'],
  politics_news:          ['news', 'politics', 'current affairs', 'journalism'],
  upsc_exam:              ['education', 'upsc', 'exam', 'competitive exams'],
};

async function main() {
  const db = getDb();

  if (STATS_ONLY) {
    printStats(db);
    return;
  }

  const targetProfiles = FILTER ? [FILTER] : PROFILES;

  for (const profile of targetProfiles) {
    console.log(`\n${'─'.repeat(72)}`);
    console.log(`PROFILE: ${profile}`);
    console.log('─'.repeat(72));

    // Try backfilled rows first; fall back to a broad niche scan.
    let candidates = db.all(
      `SELECT channel_id, channel_name, primary_niche, niche, creator_mode
       FROM ingested_channels
       WHERE routing_profile = ? AND ingest_enabled = 1
       LIMIT 50`,
      [profile],
    );

    if (candidates.length === 0) {
      const nicheGroup = FALLBACK_NICHE_GROUPS[profile] || [];
      if (nicheGroup.length > 0) {
        const ph = nicheGroup.map(() => '?').join(',');
        candidates = db.all(
          `SELECT channel_id, channel_name, primary_niche, niche, creator_mode
           FROM ingested_channels
           WHERE (niche IN (${ph}) OR primary_niche IN (${ph})) AND ingest_enabled = 1
           ORDER BY channel_subscribers DESC LIMIT 100`,
          [...nicheGroup, ...nicheGroup],
        );
      }
    }

    let shown        = 0;
    let falsePositives = 0;
    const confCounts = { high: 0, medium: 0, low: 0, none: 0 };

    for (const ch of candidates) {
      const titles = db.all(
        `SELECT title FROM ingested_videos
         WHERE channel_id = ? AND title IS NOT NULL
         ORDER BY published_at DESC LIMIT 60`,
        [ch.channel_id],
      ).map(r => r.title);

      if (titles.length < 5) continue;

      const result = computeRoutingProfile(titles);
      confCounts[result.confidence || 'none']++;

      if (result.profile !== profile) {
        falsePositives++;
        continue;
      }

      if (shown < 5) {
        shown++;
        console.log(`\n  [${shown}] ${ch.channel_name}`);
        console.log(`       niche=${ch.primary_niche || ch.niche}  mode=${ch.creator_mode || '—'}`);
        console.log(`       → profile=${result.profile}  conf=${result.confidence}  pos=${result.positive_hits}  neg=${result.negative_hits}`);
        console.log(`       recent titles:`);
        for (const t of titles.slice(0, 5)) console.log(`         • ${t}`);
      }
    }

    if (shown === 0) {
      console.log('  (no matching channels found for this profile)');
    }
    console.log(`\n  sampled=${candidates.length}  matched=${shown}  false_positive_niche_mismatches=${falsePositives}`);
    console.log(`  confidence breakdown (of matched):  high=${confCounts.high}  medium=${confCounts.medium}  low=${confCounts.low}`);
  }

  console.log('\n');
  printStats(db);
}

function printStats(db) {
  console.log('\n=== Confidence counts by profile (all backfilled channels) ===');
  const rows = db.all(
    `SELECT routing_profile, routing_profile_confidence, COUNT(*) AS n
     FROM ingested_channels
     WHERE routing_profile IS NOT NULL
     GROUP BY routing_profile, routing_profile_confidence
     ORDER BY routing_profile, routing_profile_confidence`,
  );

  const byProfile = {};
  for (const r of rows) {
    if (!byProfile[r.routing_profile]) byProfile[r.routing_profile] = {};
    byProfile[r.routing_profile][r.routing_profile_confidence] = r.n;
  }
  for (const [p, counts] of Object.entries(byProfile)) {
    const h = counts.high || 0, m = counts.medium || 0, l = counts.low || 0;
    console.log(`  ${p.padEnd(32)} high=${String(h).padStart(4)}  medium=${String(m).padStart(4)}  low=${String(l).padStart(4)}`);
  }

  console.log('\n=== creator_mode × routing_profile table (top combos) ===');
  const xRows = db.all(
    `SELECT COALESCE(creator_mode, 'unknown') AS mode, routing_profile, COUNT(*) AS n
     FROM ingested_channels
     WHERE routing_profile IS NOT NULL
     GROUP BY mode, routing_profile
     ORDER BY n DESC
     LIMIT 40`,
  );
  for (const r of xRows) {
    console.log(`  ${r.mode.padEnd(20)} × ${(r.routing_profile || '').padEnd(30)} = ${r.n}`);
  }
}

main().catch(err => { console.error(err); process.exit(1); });

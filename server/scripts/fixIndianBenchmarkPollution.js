'use strict';

/**
 * One-time cleanup: find Indian channels already in ingested_channels
 * that have been polluting English VPH benchmarks with Hindi-audience
 * view velocity data.
 *
 * Criteria for flagging:
 *   - yt_country = 'IN' in corpus_channels (Indian origin)
 *   - language_profile.uncertain = true  OR  language detected via franc/fallback
 *     OR  no language_profile at all (defaulted to English incorrectly)
 *   - NOT yt_default_language explicitly set to 'en' (that's a real English channel)
 *   - currently ignore_from_benchmarks = 0 (actively polluting)
 *
 * After running this script, click "Recompute Patterns" in the admin
 * Controls tab to rebuild clean niche benchmarks.
 *
 * Run: node server/scripts/fixIndianBenchmarkPollution.js
 * Add --dry-run to preview without writing.
 */

const path     = require('path');
const Database = require(path.join(__dirname, '../node_modules/node-sqlite3-wasm')).Database;
const DB_PATH  = path.join(__dirname, '../data/scoring.db');
const db       = new Database(DB_PATH);

const dryRun = process.argv.includes('--dry-run');

if (dryRun) console.log('DRY RUN — no changes will be written\n');

// Find all ingested channels that are Indian-origin with ambiguous English detection
const candidates = db.all(`
  SELECT
    ic.id,
    ic.channel_id,
    ic.channel_name,
    ic.niche,
    ic.ignore_from_benchmarks,
    cc.yt_country,
    cc.yt_default_language,
    cc.language_profile
  FROM ingested_channels ic
  LEFT JOIN corpus_channels cc ON cc.channel_id = ic.channel_id
  WHERE ic.ignore_from_benchmarks = 0
    AND (cc.yt_country = 'IN' OR ic.notes LIKE '%lang:uncertain-IN%')
  ORDER BY ic.channel_name
`);

let toFlag = [];

for (const ch of candidates) {
  // If YouTube API explicitly confirmed English — leave it alone
  const ytLang = ch.yt_default_language?.split('-')[0]?.toLowerCase();
  if (ytLang === 'en') continue;

  // If no corpus entry, we can't verify country — skip
  if (!ch.yt_country && !ch.channel_name?.match(/\[lang:uncertain-IN\]/)) continue;

  // Parse language_profile to check detection method
  let profile = null;
  if (ch.language_profile) {
    try { profile = JSON.parse(ch.language_profile); } catch (_) {}
  }

  const method    = profile?.method ?? null;
  const uncertain = profile?.uncertain ?? false;
  const primary   = profile?.primary ?? 'en';

  // Real non-English channel that somehow got in — shouldn't happen but handle it
  if (primary !== 'en' && primary !== 'en-US' && primary !== 'en-GB') {
    toFlag.push({ ...ch, reason: `non_english_primary:${primary}` });
    continue;
  }

  // Uncertain English detection on Indian channel = Hindi content, English titles
  if (uncertain) {
    toFlag.push({ ...ch, reason: 'uncertain_english_indian' });
    continue;
  }

  // No language profile at all — was defaulted to English (the old bug)
  if (!profile) {
    toFlag.push({ ...ch, reason: 'no_language_profile' });
    continue;
  }

  // Weak detection method on Indian channel
  if (!method || method === 'franc' || method === 'fallback_english') {
    toFlag.push({ ...ch, reason: `weak_method:${method ?? 'none'}` });
    continue;
  }
}

console.log(`Candidates checked  : ${candidates.length}`);
console.log(`To flag             : ${toFlag.length}`);
console.log('');

if (toFlag.length === 0) {
  console.log('Nothing to fix — benchmarks are clean.');
  db.close();
  process.exit(0);
}

console.log('Channels to be flagged (ignore_from_benchmarks = 1):');
console.log('─'.repeat(70));
for (const ch of toFlag) {
  console.log(`  ${(ch.channel_name ?? ch.channel_id).padEnd(40)} niche=${ch.niche?.padEnd(12)} reason=${ch.reason}`);
}
console.log('─'.repeat(70));
console.log('');

if (dryRun) {
  console.log('DRY RUN complete — run without --dry-run to apply changes.');
  db.close();
  process.exit(0);
}

// Apply — single transaction
const ids = toFlag.map(ch => ch.id);
db.run('BEGIN');
try {
  for (const id of ids) {
    db.run(
      `UPDATE ingested_channels SET ignore_from_benchmarks = 1,
         notes = COALESCE(notes, '') || ' [lang:uncertain-IN]'
       WHERE id = ? AND ignore_from_benchmarks = 0`,
      [id],
    );
  }
  db.run('COMMIT');
  console.log(`Done. Flagged ${ids.length} channels.`);
  console.log('');
  console.log('Next step: click "Recompute Patterns" in the admin Controls tab');
  console.log('to rebuild niche benchmarks without these channels.');
} catch (e) {
  db.run('ROLLBACK');
  console.error('Error — rolled back:', e.message);
  process.exit(1);
}

db.close();

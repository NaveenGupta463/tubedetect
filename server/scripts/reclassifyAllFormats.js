'use strict';

// Full format-profile backfill: classify EVERY enabled channel (with enough title history) so
// all channels land in the correct format group — not just the guest_interview set.
//   node scripts/reclassifyAllFormats.js

require('dotenv').config({ path: __dirname + '/../.env' });
const { getDb } = require('../db/init');
const { computeFormatProfile, FORMAT_PROFILE_VERSION } = require('../lib/formatProfile');

const db = getDb();
const rows = db.all(`
  SELECT ic.channel_id, ic.channel_name, ic.niche, ic.primary_niche, ic.format_type, ic.creator_mode,
         ic.format_profile AS cur, ic.format_profile_version AS ver
  FROM ingested_channels ic
  WHERE ic.ingest_enabled = 1
    AND EXISTS (SELECT 1 FROM ingested_videos v WHERE v.channel_id = ic.channel_id)`);

console.log(`Scanning ${rows.length} enabled channels with videos (target version ${FORMAT_PROFILE_VERSION})...\n`);

const dist = {};          // final format distribution
const transitions = {};   // old → new (only changed)
let changed = 0, unchanged = 0, skipped = 0, cacheCleared = 0, i = 0;

for (const r of rows) {
  if (++i % 2000 === 0) console.log(`  …${i}/${rows.length}`);
  const titles = db.all(`SELECT title FROM ingested_videos WHERE channel_id=? AND title IS NOT NULL ORDER BY published_at DESC LIMIT 120`, [r.channel_id]).map(x => x.title);
  if (titles.length < 8) { skipped++; continue; }

  const fp = computeFormatProfile(titles, r);
  dist[fp.format_profile] = (dist[fp.format_profile] || 0) + 1;

  const profileChanged = fp.format_profile !== r.cur;
  const versionStale   = (r.ver || 0) < FORMAT_PROFILE_VERSION;
  if (!profileChanged && !versionStale) { unchanged++; continue; }

  if (profileChanged) {
    const key = `${r.cur || '(none)'} → ${fp.format_profile}`;
    transitions[key] = (transitions[key] || 0) + 1;
    changed++;
    try { const info = db.run(`DELETE FROM channel_wtp_cache WHERE channel_id=?`, [r.channel_id]); if (info && info.changes) cacheCleared++; } catch (_) {}
  }
  try {
    db.run(`UPDATE ingested_channels SET format_profile=?, format_profile_confidence=?, format_profile_version=?, format_profile_debug=? WHERE channel_id=?`,
      [fp.format_profile, fp.confidence, FORMAT_PROFILE_VERSION, JSON.stringify(fp.signals), r.channel_id]);
  } catch (e) { console.log(`  ! ${r.channel_name}: ${e.message}`); }
}

console.log('\n=== FINAL FORMAT DISTRIBUTION (channels with ≥8 titles) ===');
Object.entries(dist).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`  ${k.padEnd(22)} ${v}`));
console.log('\n=== TOP TRANSITIONS (changed) ===');
Object.entries(transitions).sort((a, b) => b[1] - a[1]).slice(0, 20).forEach(([k, v]) => console.log(`  ${k}: ${v}`));
console.log(`\nchanged: ${changed} | unchanged(version-bumped): ${unchanged} | skipped(<8 titles): ${skipped} | wtp caches cleared: ${cacheCleared}`);
process.exit(0);

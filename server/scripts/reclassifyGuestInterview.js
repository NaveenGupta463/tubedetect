'use strict';

// Proactive backfill: re-run the (fixed) format classifier on every channel currently tagged
// guest_interview, persist the new profile, and clear their WTP cache so they recompute.
//   node scripts/reclassifyGuestInterview.js

require('dotenv').config({ path: __dirname + '/../.env' });
const { getDb } = require('../db/init');
const { computeFormatProfile, FORMAT_PROFILE_VERSION } = require('../lib/formatProfile');

const db = getDb();
const rows = db.all(`SELECT channel_id, channel_name, niche, primary_niche, format_type, creator_mode
                     FROM ingested_channels WHERE format_profile='guest_interview'`);
console.log(`Re-classifying ${rows.length} guest_interview channels (target version ${FORMAT_PROFILE_VERSION})...\n`);

const transitions = {};
let changed = 0, stayed = 0, skipped = 0, cacheCleared = 0;

let i = 0;
for (const r of rows) {
  if (++i % 500 === 0) console.log(`  …${i}/${rows.length}`);
  const titles = db.all(`SELECT title FROM ingested_videos WHERE channel_id=? AND title IS NOT NULL ORDER BY published_at DESC LIMIT 120`, [r.channel_id]).map(x => x.title);
  if (titles.length < 8) { skipped++; continue; }
  const fp = computeFormatProfile(titles, r);
  const key = `guest_interview → ${fp.format_profile}`;
  transitions[key] = (transitions[key] || 0) + 1;
  if (fp.format_profile === 'guest_interview') { stayed++; }
  else {
    changed++;
    try {
      db.run(`UPDATE ingested_channels SET format_profile=?, format_profile_confidence=?, format_profile_version=?, format_profile_debug=? WHERE channel_id=?`,
        [fp.format_profile, fp.confidence, FORMAT_PROFILE_VERSION, JSON.stringify(fp.signals), r.channel_id]);
      const info = db.run(`DELETE FROM channel_wtp_cache WHERE channel_id=?`, [r.channel_id]);
      if (info && info.changes) cacheCleared++;
    } catch (e) { console.log(`  ! ${r.channel_name}: ${e.message}`); }
  }
}

console.log('\n=== TRANSITIONS ===');
Object.entries(transitions).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`  ${k}: ${v}`));
console.log(`\nstayed guest_interview: ${stayed}`);
console.log(`reclassified (changed): ${changed}`);
console.log(`skipped (<8 titles):    ${skipped}`);
console.log(`wtp caches cleared:     ${cacheCleared}`);
process.exit(0);

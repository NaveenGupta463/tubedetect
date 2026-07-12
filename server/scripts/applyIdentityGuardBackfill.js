'use strict';

/**
 * applyIdentityGuardBackfill.js
 *
 * Sweeps channels through the deterministic identity guard (inferProtectedIdentity)
 * and corrects niches where strong title/name vocabulary disagrees with the stored
 * niche. ZERO API cost — pure vocabulary matching. Fixes confident misclassifications
 * (Poojaga haul→beauty, JEETH astrology→meditation, comedy/devotional/etc.) that the
 * reclassification queue never re-flags because they're self-consistent.
 *
 * Skips human niche_override locks. Writes a revert list.
 *
 * Usage:
 *   node scripts/applyIdentityGuardBackfill.js            # dry-run
 *   node scripts/applyIdentityGuardBackfill.js --apply
 *   node scripts/applyIdentityGuardBackfill.js --min-evidence=3   # stricter
 */

const path = require('path');
const fs = require('fs');
const BetterSqlite = require('../node_modules/better-sqlite3');
const { inferProtectedIdentity } = require('../lib/channelIdentityGuard');

const APPLY = process.argv.includes('--apply');
const MIN_EV = Number((process.argv.find(a => a.startsWith('--min-evidence=')) || '').split('=')[1]) || 2;

const db = new BetterSqlite(path.resolve(__dirname, '../data/scoring.db'), { fileMustExist: true, timeout: 60000 });
db.pragma('journal_mode=WAL'); db.pragma('busy_timeout=60000');

const channels = db.prepare(`
  SELECT channel_id, channel_name, COALESCE(primary_niche, niche) AS cur_niche, niche_override, identity_source
  FROM ingested_channels WHERE ingest_enabled = 1 AND channel_name IS NOT NULL`).all();

const titleStmt = db.prepare(`SELECT title FROM ingested_videos WHERE channel_id=? AND title IS NOT NULL ORDER BY published_at DESC LIMIT 20`);

const transitions = {};
const changes = [];
let scanned = 0, locked = 0;
for (const ch of channels) {
  scanned++;
  if (ch.niche_override && ch.identity_source && !/auto_repair|ai_/.test(ch.identity_source)) { locked++; continue; } // human/operator lock
  const titles = titleStmt.all(ch.channel_id).map(r => r.title);
  if (!titles.length) continue;
  const guard = inferProtectedIdentity({ channelName: ch.channel_name, titles });
  if (!guard || guard.score < MIN_EV) continue;
  if (!guard.primary_niche || guard.primary_niche === ch.cur_niche) continue;
  // Safety: never auto-reclassify music channels (original IP; music↔travel/comedy
  // vocab is noisy), and never auto-MOVE a channel TO music (name-based music pattern
  // over-fires on "song/dance/studio/dj"). These belong to the model, not the guard.
  if (ch.cur_niche === 'music' || guard.primary_niche === 'music') continue;
  // SAFE allowlist only. The broad patterns (travel/food/comedy/geopolitics) over-fire on
  // incidental vocabulary (CarryMinati→food, 5-Min-Crafts→travel, news→geopolitics), so we
  // restrict the auto-backfill to the two high-precision edge families validated on real
  // offenders: astrology→meditation and fashion/haul→beauty. Everything else = model's job.
  const safe =
    // astrology→meditation: dominant astrology, but NOT news/politics (their daily
    // horoscope segments trip it while the channel is really news).
    (guard.family === 'astrology' && guard.primary_niche === 'meditation' && !['news', 'politics', 'geopolitics'].includes(ch.cur_niche)) ||
    // fashion/haul→beauty: require strong evidence (≥4) so movie/music channels with a
    // couple of red-carpet/outfit mentions (Pen Multiplex, TheSoul Music) don't get pulled in.
    (guard.family === 'beauty' && guard.score >= 4 && ['food', 'lifestyle', 'technology', 'entertainment', 'other', ''].includes(ch.cur_niche));
  if (!safe) continue;
  const key = `${ch.cur_niche} → ${guard.primary_niche}`;
  transitions[key] = (transitions[key] || 0) + 1;
  changes.push({ channel_id: ch.channel_id, name: ch.channel_name, from: ch.cur_niche, to: guard.primary_niche, score: guard.score });
}

console.log(`Scanned ${scanned} channels | human-locked skipped: ${locked} | min-evidence: ${MIN_EV}`);
console.log(`Guard disagrees with stored niche on: ${changes.length} channels\n`);
console.log('Top transitions:');
Object.entries(transitions).sort((a, b) => b[1] - a[1]).slice(0, 25).forEach(([k, n]) => console.log(`  ${String(n).padStart(5)}  ${k}`));
console.log('\nSample (15):');
changes.slice(0, 15).forEach(c => console.log(`  [${c.from} → ${c.to}] (ev ${c.score})  ${c.name}`));

if (APPLY) {
  fs.writeFileSync(path.resolve(__dirname, 'guard_backfill_revert.json'),
    JSON.stringify(changes.map(c => ({ channel_id: c.channel_id, from: c.from }))));
  const upd = db.prepare(`UPDATE ingested_channels SET niche=?, primary_niche=?, identity_source='guard_repair' WHERE channel_id=?`);
  const delCache = db.prepare(`DELETE FROM channel_wtp_cache WHERE channel_id=?`);
  const tx = db.transaction(rows => { for (const c of rows) { upd.run(c.to, c.to, c.channel_id); delCache.run(c.channel_id); } });
  tx(changes);
  console.log(`\nAPPLIED ${changes.length} niche corrections (+ cleared their WTP cache). Revert: guard_backfill_revert.json`);
} else {
  console.log('\nDRY RUN — pass --apply to write.');
}
db.close();

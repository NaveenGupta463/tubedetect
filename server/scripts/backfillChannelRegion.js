'use strict';

/**
 * backfillChannelRegion.js
 *
 * Infers region='IN' for NULL-region channels so the existing peer-pool region
 * filter (creatorPeerContext.regionClause) actually fires — 88% of channels had
 * region=NULL, which the filter treats as "include for everyone", so Indian peers
 * leaked into English/US creator pools (e.g. "Ashneer Grover/Biozyme" → Doctor Mike).
 *
 * Tiers (conservative — only tags clearly-Indian channels; leaves ambiguous as NULL):
 *   1. primary_language in Indian languages → IN
 *   2. Indian script (Devanagari / Bengali / Tamil / Telugu / Kannada / Malayalam /
 *      Gujarati / Gurmukhi / Odia) in channel_name or recent titles → IN
 *   3. Strong Indian-context tokens in >=2 of recent titles → IN
 *
 * Usage:
 *   node scripts/backfillChannelRegion.js            # dry-run (counts only)
 *   node scripts/backfillChannelRegion.js --apply    # write region='IN'
 */

const path = require('path');
const BetterSqlite = require('../node_modules/better-sqlite3');

const APPLY = process.argv.includes('--apply');
const db = new BetterSqlite(path.resolve(__dirname, '../data/scoring.db'), { fileMustExist: true, timeout: 60000 });
db.pragma('journal_mode=WAL');
db.pragma('busy_timeout=60000');

const IN_LANGS = ['hi','ta','te','bn','mr','kn','ml','gu','pa','ur','or','as'];
const INDIAN_SCRIPT_RE = /[ऀ-ॿঀ-৿਀-੿઀-૿଀-୿஀-௿ఀ-౿ಀ-೿ഀ-ൿ]/;
const INDIAN_TOKEN_RE = /\b(india|indian|indians|bharat|hindustan|rupee|rupees|crore|lakh|modi|bjp|congress|rahul gandhi|ipl|bollywood|sensex|nifty|rbi|sebi|upsc|neet|\bjee\b|paneer|biryani|desi|bhojpuri|telugu|tamil|marathi|punjabi|gujarati|kannada|malayalam|bengali|jio|paytm|flipkart|ambani|adani)\b/i;

function isIndianTitleSet(titles) {
  let tokenHits = 0;
  for (const t of titles) {
    const s = String(t || '');
    if (INDIAN_SCRIPT_RE.test(s)) return true;     // any Indian script → IN
    if (INDIAN_TOKEN_RE.test(s)) tokenHits++;
  }
  return tokenHits >= 2;
}

// ── Tier 1: Indian language ───────────────────────────────────────────────────
const ph = IN_LANGS.map(() => '?').join(',');
const tier1Ids = db.prepare(
  `SELECT channel_id FROM ingested_channels WHERE region IS NULL AND primary_language IN (${ph})`
).all(...IN_LANGS).map(r => r.channel_id);

// ── Tier 2/3: scan remaining NULL-region channels with videos ─────────────────
const remaining = db.prepare(
  `SELECT ic.channel_id, ic.channel_name
   FROM ingested_channels ic
   WHERE ic.region IS NULL AND ic.ingest_enabled = 1
     AND ic.primary_language IS NOT 'hi'
     AND (ic.primary_language IS NULL OR ic.primary_language NOT IN (${ph}))`
).all(...IN_LANGS);

const titleStmt = db.prepare(
  `SELECT title FROM ingested_videos WHERE channel_id = ? AND title IS NOT NULL ORDER BY published_at DESC LIMIT 15`
);

const scanIds = [];
let scanned = 0;
for (const ch of remaining) {
  scanned++;
  const nameIndian = INDIAN_SCRIPT_RE.test(ch.channel_name || '');
  const titles = titleStmt.all(ch.channel_id).map(r => r.title);
  if (nameIndian || isIndianTitleSet(titles)) scanIds.push(ch.channel_id);
}

const tier1Set = new Set(tier1Ids);
const scanOnly = scanIds.filter(id => !tier1Set.has(id));
const allIds = [...new Set([...tier1Ids, ...scanIds])];

console.log(`Tier 1 (Indian language):        ${tier1Ids.length}`);
console.log(`Tier 2/3 (script/tokens, scanned ${scanned}): ${scanOnly.length}`);
console.log(`Total to tag region='IN':        ${allIds.length}`);

if (!APPLY) {
  console.log('\nDRY RUN — pass --apply to write. Sample of tier 2/3 detections:');
  for (const id of scanOnly.slice(0, 15)) {
    const n = db.prepare('SELECT channel_name FROM ingested_channels WHERE channel_id = ?').get(id);
    console.log('  ', n?.channel_name);
  }
} else {
  // Save revert list (only IDs we actually change) so the backfill is reversible.
  const fs = require('fs');
  const toChange = allIds.filter(id => {
    const r = db.prepare('SELECT region FROM ingested_channels WHERE channel_id = ?').get(id);
    return r && r.region === null;
  });
  fs.writeFileSync(path.resolve(__dirname, 'region_backfill_revert.json'), JSON.stringify(toChange));
  const upd = db.prepare(`UPDATE ingested_channels SET region = 'IN' WHERE channel_id = ? AND region IS NULL`);
  const tx = db.transaction(ids => { for (const id of ids) upd.run(id); });
  tx(toChange);
  console.log(`\nAPPLIED: set region='IN' on ${toChange.length} channels. Revert list: region_backfill_revert.json`);
}
db.close();

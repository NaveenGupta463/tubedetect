'use strict';

require('dotenv').config({ path: __dirname + '/../.env' });
const { getDb } = require('../db/init');

const db = getDb();

function fmt(n) {
  if (!n) return '0';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000)     return (n / 1_000).toFixed(0) + 'K';
  return String(Math.round(n));
}

function bar(n, max, width = 20) {
  const filled = Math.round((n / Math.max(1, max)) * width);
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

// ── 1. WTP-eligible pool per niche ─────────────────────────────────────────────
// "eligible" = ingested, enabled, has at least one video published in last 90 days.
// Only surfaces niches with >= 10 total ingested channels — skips one-off classifier outputs.
const nichePools = db.all(`
  SELECT
    ic.niche,
    COUNT(DISTINCT ic.channel_id)                    AS total_ingested,
    COUNT(DISTINCT iv_recent.channel_id)             AS wtp_eligible,
    ROUND(AVG(ic.channel_subscribers))               AS avg_subs
  FROM ingested_channels ic
  LEFT JOIN (
    SELECT DISTINCT channel_id
    FROM ingested_videos
    WHERE published_at >= date('now', '-90 days')
  ) iv_recent ON iv_recent.channel_id = ic.channel_id
  WHERE ic.ingest_enabled = 1
    AND ic.niche IS NOT NULL
  GROUP BY ic.niche
  HAVING COUNT(DISTINCT ic.channel_id) >= 10
  ORDER BY wtp_eligible ASC
`);

// ── 2. Discovery source quality breakdown ───────────────────────────────────────
const sourceSummary = db.all(`
  SELECT
    cc.discovery_source,
    COUNT(*)                                                          AS corpus_total,
    SUM(CASE WHEN ic.channel_id IS NOT NULL THEN 1 ELSE 0 END)       AS ingested,
    ROUND(AVG(cc.subscriber_count))                                   AS avg_subs,
    ROUND(SUM(CASE WHEN ic.channel_id IS NOT NULL THEN 1.0 ELSE 0 END)
          / MAX(COUNT(*), 1) * 100, 1)                                AS pct_ingested
  FROM corpus_channels cc
  LEFT JOIN ingested_channels ic ON ic.channel_id = cc.channel_id
  WHERE cc.discovery_source IS NOT NULL
  GROUP BY cc.discovery_source
  ORDER BY corpus_total DESC
  LIMIT 20
`);

// ── 3. Description handle mining potential ──────────────────────────────────────
// Count videos with descriptions containing @handle patterns not yet in the corpus.
// Exact count of *new* handles requires resolution, so this is an upper-bound estimate.
const handleStats = db.get(`
  SELECT
    COUNT(*)                                                           AS videos_with_desc,
    SUM(CASE WHEN description LIKE '%@%' THEN 1 ELSE 0 END)           AS videos_with_at,
    SUM(CASE WHEN description LIKE '%ft. @%'
          OR description LIKE '%feat. @%'
          OR description LIKE '%with @%'
          OR description LIKE '%collab%@%'
          THEN 1 ELSE 0 END)                                           AS collab_mentions
  FROM ingested_videos
  WHERE description IS NOT NULL AND description != ''
`);

// Sample of YouTube channel @handles from descriptions.
// YouTube handles: alphanumeric + dots/underscores/hyphens, 3-30 chars, no TLD patterns.
// Pull 2000 description rows and extract handles in JS for precise filtering.
const TLD_RE     = /\.(com|net|org|io|co|vc|ai|app|dev|ly|me|tv|fm|uk|in|us)$/i;
const descRows   = db.all(`
  SELECT description FROM ingested_videos
  WHERE description LIKE '%@%'
    AND description NOT LIKE '%instagram.com%'
    AND description NOT LIKE '%twitter.com%'
    AND description NOT LIKE '%facebook.com%'
    AND description NOT LIKE '%mailto%'
  LIMIT 2000
`);

const rawHandles = new Set();
for (const { description } of descRows) {
  // Match @handle at word boundary; handle = word chars + dots + hyphens
  const matches = (description || '').match(/@([\w][\w.\-]{1,28}[\w])/g) || [];
  for (const m of matches) {
    const h = m.slice(1).toLowerCase();
    if (h.length < 3 || h.length > 30)    continue;
    if (TLD_RE.test(h))                   continue; // looks like a domain
    if (/^\d+$/.test(h))                  continue; // pure number
    if (h.includes('..') || h.startsWith('.') || h.endsWith('.')) continue;
    rawHandles.add(h);
  }
}

const uniqueHandles = [...rawHandles];
const notInCorpus   = uniqueHandles.filter(h => {
  const row = db.get(
    `SELECT 1 FROM corpus_channels WHERE lower(replace(coalesce(handle,''),'@','')) = ? LIMIT 1`,
    [h],
  );
  return !row;
});

// ── 4. Bottom-10 thin niches with targeted keyword suggestions ─────────────────
const THIN_KEYWORDS = {
  'music':             ['slowed reverb hindi song india', 'punjabi new song 2025', 'bhojpuri gana new', 'hindi cover song unplugged', 'lofi hindi beats'],
  'devotional':        ['bhajan kannada new', 'marathi kirtan new 2025', 'bhojpuri bhajan', 'gujarati aarti new', 'tamil devotional song'],
  'yoga':              ['yoga hindi beginner', 'morning yoga india hindi', 'yoga for weight loss india', 'pranayam hindi', 'yoga asana hindi'],
  'meditation':        ['guided meditation hindi', 'sleep meditation india', 'mindfulness hindi', 'dhyan kaise karein', 'stress relief meditation india'],
  'lifestyle':         ['morning routine india hindi', 'self improvement hindi', 'productivity tips india', 'minimalism india', 'daily routine india vlog'],
  'travel':            ['solo travel india hindi', 'budget travel india 2025', 'hidden places india', 'offbeat travel india', 'backpacking india hindi'],
  'comedy':            ['hindi stand up comedy new', 'desi comedy sketch', 'family comedy india', 'punjabi comedy new 2025', 'marathi comedy'],
  'beauty':            ['indian skincare routine hindi', 'natural beauty tips india', 'budget makeup india', 'hair care india hindi', 'ayurvedic beauty tips'],
  'philosophy':        ['stoicism hindi', 'gita gyaan hindi', 'life lessons hindi', 'adhyatm hindi', 'philosophy explained hindi'],
  'sports':            ['cricket analysis hindi', 'kabaddi tips india', 'football skills india', 'sports motivation india', 'athletics training india'],
};

// ── 4b. Community-level pool depth ─────────────────────────────────────────────
// For each community_id, count WTP-eligible peers (has recent video).
// This is the actual signal WTP uses — not niche totals.
// Shows the P10/P25/P50 distribution and flags communities with < 15 eligible peers.
const communityPools = db.all(`
  SELECT
    ic.community_id,
    ic.niche,
    COUNT(DISTINCT ic.channel_id)               AS community_size,
    COUNT(DISTINCT iv_recent.channel_id)        AS wtp_eligible
  FROM ingested_channels ic
  LEFT JOIN (
    SELECT DISTINCT channel_id
    FROM ingested_videos
    WHERE published_at >= date('now', '-90 days')
  ) iv_recent ON iv_recent.channel_id = ic.channel_id
  WHERE ic.ingest_enabled = 1
    AND ic.community_id IS NOT NULL
  GROUP BY ic.community_id
  ORDER BY wtp_eligible ASC
`);

const COMM_THIN = 15;
const thinCommunities = communityPools.filter(r => r.wtp_eligible < COMM_THIN);
const allEligible     = communityPools.map(r => r.wtp_eligible).sort((a, b) => a - b);
const p10 = allEligible[Math.floor(allEligible.length * 0.10)] ?? 0;
const p25 = allEligible[Math.floor(allEligible.length * 0.25)] ?? 0;
const p50 = allEligible[Math.floor(allEligible.length * 0.50)] ?? 0;

// Thin community niche breakdown: which niches have the most thin communities?
const thinByNiche = {};
for (const c of thinCommunities) {
  const n = c.niche || 'unknown';
  thinByNiche[n] = (thinByNiche[n] || 0) + 1;
}
const thinNicheRanked = Object.entries(thinByNiche).sort((a, b) => b[1] - a[1]);

// ── Report output ───────────────────────────────────────────────────────────────

console.log('\n══════════════════════════════════════════════════════════');
console.log('  WTP POOL HEALTH AUDIT');
console.log('══════════════════════════════════════════════════════════\n');

// Pool depth table
const maxEligible = Math.max(...nichePools.map(r => r.wtp_eligible || 0), 1);
const THIN = 30, HEALTHY = 80;

console.log('── WTP-ELIGIBLE CHANNELS PER NICHE (sorted thin → thick) ──\n');
console.log('  Niche                          Eligible  Total  Avg subs  Status');
console.log('  ' + '─'.repeat(72));

let thinCount = 0;
for (const r of nichePools) {
  const status = r.wtp_eligible < THIN ? '⚠ THIN'
               : r.wtp_eligible < HEALTHY ? '  OK'
               : '  GOOD';
  if (r.wtp_eligible < THIN) thinCount++;
  const niche = (r.niche || 'unknown').padEnd(30);
  console.log(
    `  ${niche} ${String(r.wtp_eligible).padStart(7)}  ${String(r.total_ingested).padStart(5)}  ${fmt(r.avg_subs).padStart(8)}  ${status}`,
  );
}

console.log(`\n  ${thinCount} niches below the THIN threshold (< ${THIN} WTP-eligible channels)\n`);

// Discovery source quality
console.log('── DISCOVERY SOURCE QUALITY ──\n');
console.log('  Source                        Corpus   Ingested  %In   Avg subs');
console.log('  ' + '─'.repeat(70));
for (const s of sourceSummary) {
  const src  = (s.discovery_source || '').padEnd(29);
  const pct  = String(s.pct_ingested || 0).padStart(4);
  const flag = s.pct_ingested < 10 ? ' ← LOW QUALITY' : '';
  console.log(
    `  ${src} ${String(s.corpus_total).padStart(7)}  ${String(s.ingested).padStart(8)}  ${pct}%  ${fmt(s.avg_subs).padStart(8)}${flag}`,
  );
}

// Description handle mining
console.log('\n── DESCRIPTION HANDLE MINING POTENTIAL ──\n');
console.log(`  Videos with descriptions:     ${fmt(handleStats.videos_with_desc)}`);
console.log(`  Contain any @mention:         ${fmt(handleStats.videos_with_at)}`);
console.log(`  Contain collab @mention:      ${fmt(handleStats.collab_mentions)}`);
console.log(`  Unique handles sampled:       ${uniqueHandles.length}  (from first 500 description rows)`);
console.log(`  Not yet in corpus:            ${notInCorpus.length}  (estimated new creator leads)`);
if (notInCorpus.length > 0) {
  console.log(`\n  Sample handles not in corpus: ${notInCorpus.slice(0, 10).join(', ')}`);
}

// Community pool depth distribution
console.log('── COMMUNITY PEER POOL DEPTH (WTP actual signal) ──\n');
console.log(`  Total communities with data:  ${communityPools.length}`);
console.log(`  Thin communities (< ${COMM_THIN} eligible peers): ${thinCommunities.length}  (${Math.round(thinCommunities.length / Math.max(communityPools.length, 1) * 100)}%)`);
console.log(`  P10 eligible peers:           ${p10}`);
console.log(`  P25 eligible peers:           ${p25}`);
console.log(`  P50 eligible peers:           ${p50}`);

if (thinNicheRanked.length > 0) {
  console.log('\n  Thin communities by niche (most → least):');
  for (const [niche, count] of thinNicheRanked.slice(0, 12)) {
    console.log(`    ${(niche).padEnd(32)} ${count} thin communities`);
  }
}

// Thin niche targeted keywords
const thinNiches = [...new Set([
  ...thinNicheRanked.slice(0, 10).map(([n]) => n),
  ...nichePools.filter(r => r.wtp_eligible < THIN).map(r => r.niche),
])];
if (thinNiches.length > 0) {
  console.log('\n── TARGETED KEYWORDS FOR THIN NICHES ──\n');
  for (const niche of thinNiches.slice(0, 10)) {
    const kws = THIN_KEYWORDS[niche];
    if (kws) {
      console.log(`  ${niche}:`);
      kws.forEach(k => console.log(`    → "${k}"`));
    } else {
      console.log(`  ${niche}: (no targeted keywords defined yet — add to THIN_KEYWORDS)`);
    }
  }
}

// Action summary
console.log('\n── RECOMMENDED NEXT ACTIONS ──\n');
if (thinNiches.length > 0) {
  console.log(`  1. Run targeted video searches for: ${thinNiches.slice(0, 5).join(', ')}`);
}
if (notInCorpus.length > 20) {
  console.log(`  2. Run mineDescriptionHandles.js — estimated ${notInCorpus.length}+ new creator leads`);
}
const commentRow = sourceSummary.find(s => s.discovery_source === 'comment_harvest_IN');
if (commentRow && commentRow.pct_ingested < 10) {
  console.log(`  3. Comment harvest gate is live — was converting at ${commentRow.pct_ingested}%, watch next cycle`);
}

console.log('\n══════════════════════════════════════════════════════════\n');

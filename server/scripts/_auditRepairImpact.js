'use strict';

const path = require('path');
const DB   = require('../node_modules/better-sqlite3');
const db   = new DB(path.resolve(__dirname, '../data/scoring.db'), { timeout: 60000, readonly: true });
db.pragma('journal_mode=WAL');
db.pragma('busy_timeout=60000');

const q  = (sql, ...args) => db.prepare(sql).all(...args);
const q1 = (sql, ...args) => db.prepare(sql).get(...args);

// ── 1. Repaired channel population ───────────────────────────────────────────
const repaired = q(`
  SELECT crc.channel_id,
         crc.current_niche        AS old_niche,
         crc.suggested_niche      AS new_niche,
         crc.repair_reason,
         crc.confidence,
         crc.repaired_at,
         ic.channel_name,
         ic.channel_subscribers   AS subs,
         ic.niche                 AS live_niche
    FROM classification_repair_candidates crc
    JOIN ingested_channels ic ON ic.channel_id = crc.channel_id
   WHERE crc.status = 'repaired'
   ORDER BY ic.channel_subscribers DESC
`);

console.log(`\nTotal repaired channels: ${repaired.length}`);

// ── 2. Migration distribution ─────────────────────────────────────────────────
const migMap = {};
for (const r of repaired) {
  const key = `${r.old_niche} → ${r.new_niche}`;
  migMap[key] = (migMap[key] || 0) + 1;
}
const migrations = Object.entries(migMap).sort((a,b) => b[1]-a[1]);
console.log('\n── MIGRATION BREAKDOWN ──');
for (const [k,n] of migrations.slice(0,25)) {
  console.log(`  ${String(n).padStart(4)}  ${k}`);
}

// ── 3. WTP cache state for repaired channels ──────────────────────────────────
let cachedCount = 0, errorCount = 0, missingCount = 0;
let totalIdeas = 0, totalActNow = 0, totalEvergreen = 0, totalRising = 0, totalUnexplored = 0;
let confHigh = 0, confMed = 0, confLow = 0, confDeg = 0;
let hasDnaBets = 0, hasCommunityTopics = 0;

const wtpSample = [];
const noWtpChannels = [];

for (const r of repaired) {
  const row = q1(
    `SELECT payload, error_message, computed_at, cache_version
       FROM channel_wtp_cache
      WHERE channel_id = ?
      ORDER BY computed_at DESC
      LIMIT 1`,
    r.channel_id
  );

  if (!row) {
    missingCount++;
    noWtpChannels.push(r);
    continue;
  }
  if (row.error_message) {
    errorCount++;
    continue;
  }

  cachedCount++;

  let payload;
  try { payload = JSON.parse(row.payload); } catch (_) { errorCount++; continue; }

  const rising    = (payload.rising    || []).length;
  const evergreen = (payload.evergreen || []).length;
  const unexplored= (payload.unexplored|| []).length;
  const trends    = (payload.trend_ideas|| []).length;
  const ideas     = rising + evergreen + unexplored + trends;
  const actNow    = [
    ...(payload.rising || []),
    ...(payload.evergreen || []),
    ...(payload.unexplored || []),
  ].filter(i => i && i.act_now).length;

  totalIdeas    += ideas;
  totalActNow   += actNow;
  totalEvergreen+= evergreen;
  totalRising   += rising;
  totalUnexplored += unexplored;

  const conf = payload.confidence || 'DEGRADED';
  if      (conf === 'HIGH')    confHigh++;
  else if (conf === 'MEDIUM')  confMed++;
  else if (conf === 'LOW')     confLow++;
  else                         confDeg++;

  const hasDna  = !!(payload.original_bets && payload.original_bets.length);
  const hasCom  = !!(payload.community_topics && payload.community_topics.length);
  if (hasDna) hasDnaBets++;
  if (hasCom) hasCommunityTopics++;

  if (wtpSample.length < 700) {
    wtpSample.push({
      channel_id:   r.channel_id,
      channel_name: r.channel_name,
      subs:         r.subs,
      old_niche:    r.old_niche,
      new_niche:    r.new_niche,
      repair_reason: r.repair_reason,
      ideas_count:  ideas,
      act_now_count: actNow,
      evergreen_count: evergreen,
      rising_count:   rising,
      unexplored_count: unexplored,
      confidence:   conf,
      has_dna_bets: hasDna,
      has_community_topics: hasCom,
      computed_at: row.computed_at,
    });
  }
}

console.log('\n── WTP CACHE STATE ──');
console.log(`  Cached (valid WTP):   ${cachedCount}`);
console.log(`  Missing (no cache):   ${missingCount}`);
console.log(`  Error entries:        ${errorCount}`);
console.log(`  Cache coverage:       ${((cachedCount/Math.max(repaired.length,1))*100).toFixed(1)}%`);

if (cachedCount > 0) {
  console.log('\n── WTP QUALITY METRICS (cached channels) ──');
  console.log(`  Avg ideas/channel:        ${(totalIdeas/cachedCount).toFixed(1)}`);
  console.log(`  Avg rising/channel:       ${(totalRising/cachedCount).toFixed(1)}`);
  console.log(`  Avg evergreen/channel:    ${(totalEvergreen/cachedCount).toFixed(1)}`);
  console.log(`  Avg unexplored/channel:   ${(totalUnexplored/cachedCount).toFixed(1)}`);
  console.log(`  Avg act_now/channel:      ${(totalActNow/cachedCount).toFixed(1)}`);
  console.log(`  Channels with DNA bets:   ${hasDnaBets}  (${((hasDnaBets/cachedCount)*100).toFixed(1)}%)`);
  console.log(`  Channels with community:  ${hasCommunityTopics}  (${((hasCommunityTopics/cachedCount)*100).toFixed(1)}%)`);
  console.log('\n  Confidence:');
  console.log(`    HIGH:     ${confHigh}  (${((confHigh/cachedCount)*100).toFixed(1)}%)`);
  console.log(`    MEDIUM:   ${confMed}  (${((confMed/cachedCount)*100).toFixed(1)}%)`);
  console.log(`    LOW:      ${confLow}  (${((confLow/cachedCount)*100).toFixed(1)}%)`);
  console.log(`    DEGRADED: ${confDeg}  (${((confDeg/cachedCount)*100).toFixed(1)}%)`);
}

// ── 4. Impact classification ──────────────────────────────────────────────────
const HIGH_IMPACT_MIGRATIONS = new Set([
  'motivation → education', 'sports → education', 'selfimprovement → education',
  'news → education', 'education → news', 'sports → music', 'music → education',
  'lifestyle → health', 'lifestyle → fitness', 'meditation → music',
  'comedy → food', 'sports → food', 'lifestyle → travel', 'music → travel',
  'education → music', 'entertainment → gaming', 'comedy → gaming',
  'travel → geopolitics', 'lifestyle → food',
]);

let bucketA = 0, bucketB = 0, bucketC = 0, bucketD = 0;
const examples = { A: [], B: [], C: [], D: [] };

for (const ch of wtpSample) {
  const migKey = `${ch.old_niche} → ${ch.new_niche}`;
  const crossNiche = ch.old_niche !== ch.new_niche;
  const highImpactMig = HIGH_IMPACT_MIGRATIONS.has(migKey);
  const richContent = ch.ideas_count >= 8 && ch.has_dna_bets && ch.has_community_topics;
  const decentContent = ch.ideas_count >= 5;
  const highConf = ch.confidence === 'HIGH';
  const hasActNow = ch.act_now_count > 0;

  let bucket;
  if (!crossNiche || ch.ideas_count < 3) {
    bucket = 'A';
  } else if (highImpactMig && richContent && highConf) {
    bucket = 'D';
  } else if (highImpactMig && decentContent && (highConf || hasActNow)) {
    bucket = 'C';
  } else if (crossNiche && decentContent) {
    bucket = 'B';
  } else {
    bucket = 'A';
  }

  if      (bucket === 'A') bucketA++;
  else if (bucket === 'B') bucketB++;
  else if (bucket === 'C') bucketC++;
  else                     bucketD++;

  if (examples[bucket].length < 5) examples[bucket].push(ch);
}

const sampleSize = wtpSample.length;
console.log(`\n── IMPACT CLASSIFICATION (sample n=${sampleSize}) ──`);
console.log(`  A — No visible effect:       ${bucketA}  (${((bucketA/Math.max(sampleSize,1))*100).toFixed(1)}%)`);
console.log(`  B — Minor visible effect:    ${bucketB}  (${((bucketB/Math.max(sampleSize,1))*100).toFixed(1)}%)`);
console.log(`  C — Significant effect:      ${bucketC}  (${((bucketC/Math.max(sampleSize,1))*100).toFixed(1)}%)`);
console.log(`  D — Transformational effect: ${bucketD}  (${((bucketD/Math.max(sampleSize,1))*100).toFixed(1)}%)`);

for (const [bucket, list] of Object.entries(examples)) {
  if (!list.length) continue;
  console.log(`\n── EXAMPLES: Bucket ${bucket} ──`);
  for (const ch of list) {
    const subsK = ch.subs ? `${(ch.subs/1000).toFixed(0)}K` : '?';
    console.log(`  [${subsK}] ${ch.channel_name || ch.channel_id}`);
    console.log(`    ${ch.old_niche} → ${ch.new_niche}  ideas=${ch.ideas_count}  act_now=${ch.act_now_count}  conf=${ch.confidence}  dna=${ch.has_dna_bets}  com=${ch.has_community_topics}`);
  }
}

// ── 5. Niche-level peer pool sizes ────────────────────────────────────────────
console.log('\n── NICHE PEER POOL SIZES (current) ──');
const nicheSizes = q(`
  SELECT niche, COUNT(*) as n
    FROM ingested_channels
   WHERE ingest_enabled = 1
     AND niche IS NOT NULL
   GROUP BY niche
   ORDER BY n DESC
   LIMIT 30
`);
for (const row of nicheSizes) {
  console.log(`  ${(row.niche||'?').padEnd(22)} ${row.n}`);
}

// ── 6. Overall WTP coverage ───────────────────────────────────────────────────
const totalChannels   = q1("SELECT COUNT(*) as n FROM ingested_channels WHERE ingest_enabled=1").n;
const totalCachedAll  = q1("SELECT COUNT(*) as n FROM channel_wtp_cache WHERE error_message IS NULL").n;
const totalErrors2    = q1("SELECT COUNT(*) as n FROM channel_wtp_cache WHERE error_message IS NOT NULL").n;

console.log('\n── OVERALL WTP CACHE STATE ──');
console.log(`  Total ingested channels: ${totalChannels}`);
console.log(`  WTP cached (valid):      ${totalCachedAll}  (${((totalCachedAll/Math.max(totalChannels,1))*100).toFixed(1)}%)`);
console.log(`  WTP errors:              ${totalErrors2}`);

// ── 7. Confidence by niche ────────────────────────────────────────────────────
const confByNiche = q(`
  SELECT ic.niche,
         COUNT(*) as n,
         SUM(CASE WHEN json_extract(w.payload, '$.confidence') = 'HIGH' THEN 1 ELSE 0 END) as high,
         SUM(CASE WHEN json_extract(w.payload, '$.confidence') = 'MEDIUM' THEN 1 ELSE 0 END) as med,
         SUM(CASE WHEN json_extract(w.payload, '$.confidence') = 'LOW' THEN 1 ELSE 0 END) as low,
         SUM(CASE WHEN json_extract(w.payload, '$.confidence') = 'DEGRADED' THEN 1 ELSE 0 END) as deg
    FROM channel_wtp_cache w
    JOIN ingested_channels ic ON ic.channel_id = w.channel_id
   WHERE w.error_message IS NULL
   GROUP BY ic.niche
   ORDER BY n DESC
   LIMIT 25
`);
console.log('\n── CONFIDENCE BY NICHE ──');
console.log('  Niche                  N      HIGH    MED     LOW    DEG');
for (const r of confByNiche) {
  const p = v => String(v||0).padStart(6);
  console.log(`  ${(r.niche||'?').padEnd(22)} ${String(r.n).padStart(5)} ${p(r.high)} ${p(r.med)} ${p(r.low)} ${p(r.deg)}`);
}

// ── 8. Missing WTP samples ────────────────────────────────────────────────────
console.log(`\n── CHANNELS WITHOUT WTP (sample, up to 10) ──`);
for (const ch of noWtpChannels.slice(0,10)) {
  const subsK = ch.subs ? `${(ch.subs/1000).toFixed(0)}K` : '?';
  console.log(`  [${subsK}] ${ch.channel_name || ch.channel_id}  ${ch.old_niche} → ${ch.new_niche}`);
}

// ── 9. Intelligence aggregator table existence check ─────────────────────────
console.log('\n── KEY TABLE ROW COUNTS ──');
const tables = [
  'channel_wtp_cache', 'classification_repair_candidates',
  'creator_idea_dna', 'channel_identity',
  'topic_saturation_history', 'topic_signal_stats',
  'semantic_clusters', 'semantic_embeddings',
  'hook_type_performance', 'narrative_lifecycle',
  'channel_territory_profiles', 'channel_topics',
  'creator_topic_lifecycle', 'topic_community_stats',
  'channel_evolution_summary', 'phrase_niche_pmi',
  'google_trends_signals', 'topic_event_metadata',
];
for (const t of tables) {
  try {
    const cnt = q1(`SELECT COUNT(*) as n FROM ${t}`);
    console.log(`  ${t.padEnd(35)} ${cnt.n}`);
  } catch (e) {
    console.log(`  ${t.padEnd(35)} [NOT FOUND: ${e.message.slice(0,40)}]`);
  }
}

// ── 10. Semantic clustering state ─────────────────────────────────────────────
console.log('\n── SEMANTIC CLUSTERING STATE ──');
try {
  const clusters = q(`SELECT cluster_name, sample_size, confidence, avg_vph FROM semantic_clusters ORDER BY sample_size DESC`);
  for (const c of clusters) {
    console.log(`  ${(c.cluster_name||'?').padEnd(16)} size=${c.sample_size||0}  conf=${(c.confidence||0).toFixed(2)}  avg_vph=${c.avg_vph||'null'}`);
  }
} catch(e) { console.log('  [ERROR:', e.message, ']'); }

// ── 11. repair_reason breakdown ───────────────────────────────────────────────
const reasonBreakdown = q(`
  SELECT repair_reason, COUNT(*) as n
    FROM classification_repair_candidates
   WHERE status = 'repaired'
   GROUP BY repair_reason ORDER BY n DESC
`);
console.log('\n── REPAIR REASON BREAKDOWN ──');
for (const r of reasonBreakdown) {
  console.log(`  ${(r.repair_reason||'?').padEnd(25)} ${r.n}`);
}

db.close();
console.log('\nDone.');

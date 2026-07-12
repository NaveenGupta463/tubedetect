'use strict';
const path = require('path');
const DB = require('../node_modules/better-sqlite3');
const db = new DB(path.resolve(__dirname, '../data/scoring.db'), { readonly: true });
const q  = (sql, ...args) => db.prepare(sql).all(...args);
const q1 = (sql, ...args) => db.prepare(sql).get(...args);

// ── 1. Repaired channel population ───────────────────────────────────────────
// 'reclassified' = AI confirmed niche change; 'auto_repaired' = auto-applied
const repaired = q(`
  SELECT crc.channel_id,
         crc.current_niche   AS old_niche,
         crc.suggested_niche AS new_niche,
         crc.repair_reason,
         crc.confidence,
         crc.repaired_at,
         crc.status,
         ic.channel_name,
         ic.channel_subscribers AS subs,
         ic.niche               AS live_niche
    FROM classification_repair_candidates crc
    JOIN ingested_channels ic ON ic.channel_id = crc.channel_id
   WHERE crc.status IN ('reclassified','auto_repaired')
   ORDER BY ic.channel_subscribers DESC
`);

console.log(`\n=== REPAIR IMPACT AUDIT ===`);
console.log(`Total reclassified channels: ${repaired.length}`);

// Status breakdown
const statusBreak = q(`SELECT status, COUNT(*) as n FROM classification_repair_candidates GROUP BY status ORDER BY n DESC`);
console.log('\nAll candidate statuses:');
for (const s of statusBreak) console.log(`  ${s.status.padEnd(25)} ${s.n}`);

// ── 2. Migration breakdown ────────────────────────────────────────────────────
const migMap = {};
for (const r of repaired) {
  const key = `${r.old_niche} → ${r.new_niche}`;
  migMap[key] = (migMap[key] || 0) + 1;
}
const migrations = Object.entries(migMap).sort((a,b) => b[1]-a[1]);
console.log('\nMigration breakdown (top 30):');
for (const [k,n] of migrations.slice(0,30)) {
  console.log(`  ${String(n).padStart(4)}  ${k}`);
}

// ── 3. WTP cache state for reclassified channels ──────────────────────────────
let cachedCount=0, missingCount=0, errorCount=0;
let totalIdeas=0, totalActNow=0, totalRising=0, totalEvergreen=0, totalUnexplored=0;
let confHigh=0, confMed=0, confLow=0, confDeg=0;
let hasDnaBets=0, hasCommunityTopics=0;
const wtpSample = [];

for (const r of repaired) {
  const row = q1(
    `SELECT payload_json, error_message, computed_at, status
       FROM channel_wtp_cache
      WHERE channel_id = ?
      ORDER BY computed_at DESC
      LIMIT 1`,
    r.channel_id
  );

  if (!row) { missingCount++; continue; }
  if (row.error_message) { errorCount++; continue; }

  let payload;
  try { payload = JSON.parse(row.payload_json); } catch(_) { errorCount++; continue; }
  cachedCount++;

  const rising     = (payload.rising    || []).length;
  const evergreen  = (payload.evergreen || []).length;
  const unexplored = (payload.unexplored|| []).length;
  const trends     = (payload.trend_ideas || []).length;
  const ideas      = rising + evergreen + unexplored + trends;
  const actNow     = [
    ...(payload.rising    || []),
    ...(payload.evergreen || []),
    ...(payload.unexplored|| []),
  ].filter(i => i && i.act_now).length;

  totalIdeas     += ideas;
  totalActNow    += actNow;
  totalRising    += rising;
  totalEvergreen += evergreen;
  totalUnexplored+= unexplored;

  const conf = payload.confidence || 'DEGRADED';
  if      (conf==='HIGH')    confHigh++;
  else if (conf==='MEDIUM')  confMed++;
  else if (conf==='LOW')     confLow++;
  else                       confDeg++;

  const dna = Array.isArray(payload.original_bets) && payload.original_bets.length > 0;
  const com = Array.isArray(payload.community_topics) && payload.community_topics.length > 0;
  if (dna) hasDnaBets++;
  if (com) hasCommunityTopics++;

  if (wtpSample.length < 700) {
    wtpSample.push({
      ...r, ideas, actNow, rising, evergreen, unexplored, conf, dna, com,
      computed_at: row.computed_at,
    });
  }
}

console.log('\n=== WTP CACHE STATE (reclassified channels) ===');
console.log(`  Cached (valid):  ${cachedCount}  (${((cachedCount/Math.max(repaired.length,1))*100).toFixed(1)}%)`);
console.log(`  Missing:         ${missingCount}`);
console.log(`  Errors:          ${errorCount}`);

if (cachedCount > 0) {
  console.log('\nQuality metrics (cached channels):');
  console.log(`  Avg ideas:      ${(totalIdeas/cachedCount).toFixed(1)}`);
  console.log(`  Avg rising:     ${(totalRising/cachedCount).toFixed(1)}`);
  console.log(`  Avg evergreen:  ${(totalEvergreen/cachedCount).toFixed(1)}`);
  console.log(`  Avg unexplored: ${(totalUnexplored/cachedCount).toFixed(1)}`);
  console.log(`  Avg act_now:    ${(totalActNow/cachedCount).toFixed(1)}`);
  console.log(`  Has DNA bets:   ${hasDnaBets}  (${((hasDnaBets/cachedCount)*100).toFixed(1)}%)`);
  console.log(`  Has community:  ${hasCommunityTopics}  (${((hasCommunityTopics/cachedCount)*100).toFixed(1)}%)`);
  console.log('\nConfidence:');
  console.log(`  HIGH:     ${confHigh}  (${((confHigh/cachedCount)*100).toFixed(1)}%)`);
  console.log(`  MEDIUM:   ${confMed}  (${((confMed/cachedCount)*100).toFixed(1)}%)`);
  console.log(`  LOW:      ${confLow}  (${((confLow/cachedCount)*100).toFixed(1)}%)`);
  console.log(`  DEGRADED: ${confDeg}  (${((confDeg/cachedCount)*100).toFixed(1)}%)`);
}

// ── 4. Impact classification ──────────────────────────────────────────────────
const HIGH_IMPACT_MIGRATIONS = new Set([
  'motivation → education','sports → education','selfimprovement → education',
  'news → education','education → news','sports → music','music → education',
  'lifestyle → health','lifestyle → fitness','meditation → music',
  'comedy → food','sports → food','lifestyle → travel','music → travel',
  'education → music','entertainment → gaming','comedy → gaming',
  'travel → geopolitics','lifestyle → food',
]);

let bucketA=0,bucketB=0,bucketC=0,bucketD=0;
const examples = {A:[],B:[],C:[],D:[]};

for (const ch of wtpSample) {
  const migKey = `${ch.old_niche} → ${ch.new_niche}`;
  const crossNiche = ch.old_niche !== ch.new_niche;
  const highImpact = HIGH_IMPACT_MIGRATIONS.has(migKey);
  const rich   = ch.ideas >= 8 && ch.dna && ch.com;
  const decent = ch.ideas >= 5;
  const highConf = ch.conf === 'HIGH';

  let bucket;
  if (!crossNiche || ch.ideas < 3)              bucket = 'A';
  else if (highImpact && rich && highConf)      bucket = 'D';
  else if (highImpact && decent && (highConf || ch.actNow > 0)) bucket = 'C';
  else if (crossNiche && decent)                bucket = 'B';
  else                                          bucket = 'A';

  if (bucket==='A') bucketA++;
  else if (bucket==='B') bucketB++;
  else if (bucket==='C') bucketC++;
  else bucketD++;

  if (examples[bucket].length < 5) examples[bucket].push(ch);
}

const sampleN = wtpSample.length;
console.log(`\n=== IMPACT CLASSIFICATION (sample n=${sampleN}) ===`);
console.log(`  A — No visible effect:       ${bucketA}  (${((bucketA/Math.max(sampleN,1))*100).toFixed(1)}%)`);
console.log(`  B — Minor visible effect:    ${bucketB}  (${((bucketB/Math.max(sampleN,1))*100).toFixed(1)}%)`);
console.log(`  C — Significant effect:      ${bucketC}  (${((bucketC/Math.max(sampleN,1))*100).toFixed(1)}%)`);
console.log(`  D — Transformational effect: ${bucketD}  (${((bucketD/Math.max(sampleN,1))*100).toFixed(1)}%)`);

for (const [bucket, list] of Object.entries(examples)) {
  if (!list.length) continue;
  console.log(`\nExamples — Bucket ${bucket}:`);
  for (const ch of list) {
    const subsK = ch.subs ? `${(ch.subs/1000).toFixed(0)}K` : '?';
    console.log(`  [${subsK}] ${ch.channel_name || ch.channel_id}`);
    console.log(`    ${ch.old_niche} → ${ch.new_niche}  ideas=${ch.ideas}  act_now=${ch.actNow}  conf=${ch.conf}  dna=${ch.dna}  community=${ch.com}`);
  }
}

// ── 5. WTP impression/outcome data (user engagement) ─────────────────────────
console.log('\n=== WTP ENGAGEMENT TABLES ===');
for (const t of ['wtp_impressions','wtp_outcomes','wtp_saves','wtp_exports','wtp_video_matches']) {
  try {
    const cnt = q1(`SELECT COUNT(*) as n FROM ${t}`);
    const schema = q(`PRAGMA table_info(${t})`).map(c => c.name).join(', ');
    console.log(`  ${t}: ${cnt.n} rows  |  cols: ${schema}`);
  } catch(e) { console.log(`  ${t}: [error: ${e.message.slice(0,60)}]`); }
}

// ── 6. reclassification_log ───────────────────────────────────────────────────
console.log('\n=== RECLASSIFICATION LOG ===');
try {
  const rlSchema = q('PRAGMA table_info(reclassification_log)').map(c => c.name).join(', ');
  console.log(`  Columns: ${rlSchema}`);
  const rlCount = q1('SELECT COUNT(*) as n FROM reclassification_log');
  console.log(`  Row count: ${rlCount.n}`);
  const sample = q('SELECT * FROM reclassification_log LIMIT 3');
  if (sample.length) console.log('  Sample:', JSON.stringify(sample[0]));
} catch(e) { console.log('  [error:', e.message.slice(0,60), ']'); }

// ── 7. Overall WTP cache state ────────────────────────────────────────────────
console.log('\n=== OVERALL WTP CACHE STATE ===');
const totalChannels = q1("SELECT COUNT(*) as n FROM ingested_channels WHERE ingest_enabled=1").n;
const wtpStats = q1(`
  SELECT
    COUNT(*) as total,
    SUM(CASE WHEN error_message IS NULL THEN 1 ELSE 0 END) as valid,
    SUM(CASE WHEN error_message IS NOT NULL THEN 1 ELSE 0 END) as errors,
    SUM(CASE WHEN status='fresh' OR status='ok' THEN 1 ELSE 0 END) as fresh,
    SUM(CASE WHEN expires_at < datetime('now') THEN 1 ELSE 0 END) as expired
  FROM channel_wtp_cache
`);
console.log(`  Total ingested channels:  ${totalChannels}`);
console.log(`  WTP cache entries total:  ${wtpStats.total}`);
console.log(`  Valid (no error):         ${wtpStats.valid}`);
console.log(`  Errors:                   ${wtpStats.errors}`);
console.log(`  Expired:                  ${wtpStats.expired}`);
console.log(`  Coverage:                 ${((wtpStats.valid/Math.max(totalChannels,1))*100).toFixed(1)}%`);

// WTP cache status breakdown
const wtpStatusBreak = q(`SELECT status, COUNT(*) as n FROM channel_wtp_cache GROUP BY status ORDER BY n DESC`);
console.log('\nWTP cache status breakdown:');
for (const s of wtpStatusBreak) console.log(`  ${(s.status||'null').padEnd(15)} ${s.n}`);

// ── 8. Confidence by niche (current state) ────────────────────────────────────
console.log('\n=== CONFIDENCE BY NICHE (WTP cache) ===');
try {
  const confByNiche = q(`
    SELECT ic.niche, COUNT(*) as n,
           SUM(CASE WHEN json_extract(w.payload_json,'$.confidence')='HIGH'    THEN 1 ELSE 0 END) as high,
           SUM(CASE WHEN json_extract(w.payload_json,'$.confidence')='MEDIUM'  THEN 1 ELSE 0 END) as med,
           SUM(CASE WHEN json_extract(w.payload_json,'$.confidence')='LOW'     THEN 1 ELSE 0 END) as low,
           SUM(CASE WHEN json_extract(w.payload_json,'$.confidence')='DEGRADED' THEN 1 ELSE 0 END) as deg
      FROM channel_wtp_cache w
      JOIN ingested_channels ic ON ic.channel_id = w.channel_id
     WHERE w.error_message IS NULL
     GROUP BY ic.niche ORDER BY n DESC LIMIT 25
  `);
  console.log('  Niche                  N      HIGH    MED    LOW   DEG');
  for (const r of confByNiche) {
    const p = v => String(v||0).padStart(6);
    console.log(`  ${(r.niche||'?').padEnd(22)} ${String(r.n).padStart(5)} ${p(r.high)} ${p(r.med)} ${p(r.low)} ${p(r.deg)}`);
  }
} catch(e) { console.log('  [json_extract error:', e.message.slice(0,60), ']'); }

// ── 9. Semantic clustering state ──────────────────────────────────────────────
console.log('\n=== SEMANTIC CLUSTERS ===');
try {
  const clusters = q('SELECT cluster_name, sample_size, ROUND(confidence,3) as conf, ROUND(avg_vph,1) as avg_vph FROM semantic_clusters ORDER BY sample_size DESC');
  console.log('  cluster_name     sample  conf   avg_vph');
  for (const c of clusters) {
    console.log(`  ${(c.cluster_name||'?').padEnd(16)} ${String(c.sample_size||0).padStart(6)}  ${(c.conf||0).toFixed(3)}  ${c.avg_vph||'null'}`);
  }
} catch(e) { console.log('  [error:', e.message, ']'); }

// ── 10. Key table row counts ──────────────────────────────────────────────────
console.log('\n=== KEY TABLE ROW COUNTS ===');
const tables = [
  'creator_idea_dna','channel_identity','topic_saturation_history',
  'topic_signal_stats','hook_type_performance','narrative_lifecycle',
  'channel_territory_profiles','channel_topics','creator_topic_lifecycle',
  'topic_community_stats','channel_evolution_summary','phrase_niche_pmi',
  'google_trends_signals','topic_event_metadata','semantic_embeddings',
  'wtp_impressions','wtp_outcomes','wtp_saves',
];
for (const t of tables) {
  try {
    const cnt = q1(`SELECT COUNT(*) as n FROM ${t}`);
    console.log(`  ${t.padEnd(35)} ${cnt.n}`);
  } catch(e) {
    console.log(`  ${t.padEnd(35)} [error: ${e.message.slice(0,40)}]`);
  }
}

// ── 11. Niche peer pool sizes ─────────────────────────────────────────────────
console.log('\n=== NICHE PEER POOL SIZES ===');
const nicheSizes = q(`
  SELECT niche, COUNT(*) as n FROM ingested_channels
   WHERE ingest_enabled=1 AND niche IS NOT NULL
   GROUP BY niche ORDER BY n DESC LIMIT 30
`);
for (const r of nicheSizes) {
  console.log(`  ${(r.niche||'?').padEnd(28)} ${r.n}`);
}

db.close();
console.log('\nDone.');

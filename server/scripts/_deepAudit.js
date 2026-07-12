'use strict';
const path = require('path');
const DB = require('../node_modules/better-sqlite3');
const db = new DB(path.resolve(__dirname, '../data/scoring.db'), { readonly: true });
const q  = (sql, ...a) => db.prepare(sql).all(...a);
const q1 = (sql, ...a) => db.prepare(sql).get(...a);

// ═══════════════ PHASE 1: WTP VISIBILITY ═══════════════

console.log('\n══════════════════════════════════════════════════');
console.log('PHASE 1 — WTP VISIBILITY AUDIT');
console.log('══════════════════════════════════════════════════');

const totalChannels   = q1(`SELECT COUNT(*) n FROM ingested_channels WHERE ingest_enabled=1`).n;
const totalWtpEntries = q1(`SELECT COUNT(*) n FROM channel_wtp_cache`).n;
const validWtp        = q1(`SELECT COUNT(*) n FROM channel_wtp_cache WHERE error_message IS NULL`).n;
const freshWtp        = q1(`SELECT COUNT(*) n FROM channel_wtp_cache WHERE expires_at > datetime('now') AND error_message IS NULL`).n;
const expiredWtp      = q1(`SELECT COUNT(*) n FROM channel_wtp_cache WHERE expires_at <= datetime('now')`).n;
const errorWtp        = q1(`SELECT COUNT(*) n FROM channel_wtp_cache WHERE error_message IS NOT NULL`).n;

console.log(`\nChannel counts:`);
console.log(`  Total ingested (enabled):   ${totalChannels}`);
console.log(`  WTP cache entries total:    ${totalWtpEntries}`);
console.log(`  Valid (no error):           ${validWtp}  (${((validWtp/totalChannels)*100).toFixed(3)}%)`);
console.log(`  Fresh (not expired):        ${freshWtp}  (${((freshWtp/totalChannels)*100).toFixed(3)}%)`);
console.log(`  Expired:                    ${expiredWtp}`);
console.log(`  Error entries:              ${errorWtp}`);

// Cache age
try {
  const ageStats = q1(`
    SELECT
      MIN(computed_at) oldest,
      MAX(computed_at) newest,
      AVG(CAST((julianday('now') - julianday(computed_at)) * 24 AS REAL)) avg_age_hours
    FROM channel_wtp_cache WHERE error_message IS NULL
  `);
  console.log(`\nCache age:`);
  console.log(`  Oldest entry:    ${ageStats?.oldest}`);
  console.log(`  Newest entry:    ${ageStats?.newest}`);
  console.log(`  Avg age (hours): ${ageStats?.avg_age_hours?.toFixed(1)}`);
} catch(e) { console.log('  [age error:', e.message.slice(0,60), ']'); }

// Refresh queue depth
try {
  const queueStats = q1(`SELECT COUNT(*) n, MIN(created_at) oldest FROM refresh_queue WHERE status='pending' AND job_type='wtp_cache'`);
  const queueDone  = q1(`SELECT COUNT(*) n FROM refresh_queue WHERE status='completed' AND job_type='wtp_cache'`);
  const queueAll   = q1(`SELECT COUNT(*) n FROM refresh_queue WHERE job_type='wtp_cache'`);
  console.log(`\nRefresh queue (wtp_cache):`);
  console.log(`  Pending: ${queueStats?.n}   Oldest pending: ${queueStats?.oldest}`);
  console.log(`  Completed: ${queueDone?.n}   Total ever: ${queueAll?.n}`);
} catch(e) { console.log('  Refresh queue error:', e.message.slice(0,60)); }

// Reclassified channels with WTP cache
const reclassified = q(`
  SELECT crc.channel_id, crc.current_niche AS old_niche, crc.suggested_niche AS new_niche,
         crc.repaired_at, ic.channel_subscribers AS subs
  FROM classification_repair_candidates crc
  JOIN ingested_channels ic ON ic.channel_id = crc.channel_id
  WHERE crc.status IN ('reclassified','auto_repaired')
`);
console.log(`\nReclassified channels: ${reclassified.length}`);

let rclFresh=0, rclExpired=0, rclMissing=0, rclError=0;
let rclPostRepair=0; // cached AFTER repair
for (const r of reclassified) {
  const row = q1(`SELECT computed_at, expires_at, error_message FROM channel_wtp_cache WHERE channel_id=? ORDER BY computed_at DESC LIMIT 1`, r.channel_id);
  if (!row) { rclMissing++; continue; }
  if (row.error_message) { rclError++; continue; }
  if (row.expires_at > new Date().toISOString()) rclFresh++;
  else rclExpired++;
  if (r.repaired_at && row.computed_at > r.repaired_at) rclPostRepair++;
}
console.log(`  WTP fresh:      ${rclFresh}   (${((rclFresh/reclassified.length)*100).toFixed(1)}%)`);
console.log(`  WTP expired:    ${rclExpired}   (${((rclExpired/reclassified.length)*100).toFixed(1)}%)`);
console.log(`  WTP missing:    ${rclMissing}   (${((rclMissing/reclassified.length)*100).toFixed(1)}%)`);
console.log(`  WTP error:      ${rclError}   (${((rclError/reclassified.length)*100).toFixed(1)}%)`);
console.log(`  WTP rebuilt after repair: ${rclPostRepair}   (${((rclPostRepair/reclassified.length)*100).toFixed(1)}%)`);

// WTP cache status breakdown
const wtpStatBreak = q(`SELECT status, COUNT(*) n FROM channel_wtp_cache GROUP BY status ORDER BY n DESC`);
console.log('\nWTP cache status breakdown:');
for (const s of wtpStatBreak) console.log(`  ${(s.status||'null').padEnd(20)} ${s.n}`);

// ═══════════════ PHASE 2: NICHE TAXONOMY ═══════════════

console.log('\n══════════════════════════════════════════════════');
console.log('PHASE 2 — NICHE TAXONOMY ALIGNMENT');
console.log('══════════════════════════════════════════════════');

// All unique niche values in ingested_channels
const nicheValues = q(`
  SELECT niche, COUNT(*) n FROM ingested_channels
  WHERE ingest_enabled=1 AND niche IS NOT NULL
  GROUP BY niche ORDER BY n DESC
`);
console.log(`\nUnique niche values in ingested_channels: ${nicheValues.length}`);
console.log('Top 40:');
for (const r of nicheValues.slice(0,40)) {
  console.log(`  ${(r.niche||'?').padEnd(35)} ${r.n}`);
}

// Niches with < 10 channels (orphan risk)
const orphanNiches = nicheValues.filter(r => r.n < 10);
console.log(`\nNiches with <10 channels (orphan risk): ${orphanNiches.length}`);
for (const r of orphanNiches.slice(0,20)) {
  console.log(`  ${(r.niche||'?').padEnd(35)} ${r.n}`);
}

// Repair taxonomy vs corpus taxonomy
const repairNiches = q(`
  SELECT suggested_niche AS niche, COUNT(*) n
  FROM classification_repair_candidates
  WHERE status IN ('reclassified','auto_repaired')
  GROUP BY suggested_niche ORDER BY n DESC
`);
console.log(`\nRepair taxonomy (suggested_niche values used):`);
for (const r of repairNiches) console.log(`  ${(r.niche||'?').padEnd(25)} ${r.n}`);

// Check alignment: how many reclassified channels have their new niche exactly matching ingested_channels.niche
const nicheSet = new Set(nicheValues.map(r => r.niche));
let exactMatch=0, noMatch=0, weakMatch=0;
const noMatchExamples=[];
for (const r of repairNiches) {
  if (nicheSet.has(r.niche)) exactMatch += r.n;
  else {
    noMatch += r.n;
    noMatchExamples.push({niche: r.niche, n: r.n});
  }
}
console.log(`\nTaxonomy alignment:`);
console.log(`  Repair niches matching corpus: ${exactMatch} channels`);
console.log(`  Repair niches NOT in corpus:   ${noMatch} channels`);
if (noMatchExamples.length) {
  console.log(`  Non-matching niches:`);
  for (const r of noMatchExamples) console.log(`    ${r.niche} (${r.n} channels)`);
}

// Check if reclassified channels have their IC.niche updated
const rclNicheCheck = q(`
  SELECT
    crc.suggested_niche,
    ic.niche AS live_niche,
    crc.suggested_niche = ic.niche AS niche_updated,
    COUNT(*) n
  FROM classification_repair_candidates crc
  JOIN ingested_channels ic ON ic.channel_id = crc.channel_id
  WHERE crc.status IN ('reclassified','auto_repaired')
  GROUP BY crc.suggested_niche, ic.niche, niche_updated
  ORDER BY n DESC
  LIMIT 30
`);
const nicheUpdated   = rclNicheCheck.filter(r => r.niche_updated === 1).reduce((s,r) => s+r.n, 0);
const nicheNotUpdated= rclNicheCheck.filter(r => r.niche_updated !== 1).reduce((s,r) => s+r.n, 0);
console.log(`\nReclassified channels with live niche updated:`);
console.log(`  Updated (IC.niche = repair niche): ${nicheUpdated}`);
console.log(`  NOT updated (IC.niche ≠ repair niche): ${nicheNotUpdated}`);
console.log(`  Detail (top mismatches):`);
for (const r of rclNicheCheck.filter(r => r.niche_updated !== 1).slice(0,10)) {
  console.log(`    repair→${r.suggested_niche} but IC.niche=${r.live_niche} (${r.n} channels)`);
}

// primary_niche vs niche
const primaryNiche = q1(`SELECT COUNT(*) n FROM ingested_channels WHERE primary_niche IS NOT NULL AND ingest_enabled=1`);
console.log(`\nChannels with primary_niche set: ${primaryNiche?.n} of ${totalChannels}`);
const dualNiche = q(`
  SELECT primary_niche, niche, COUNT(*) n FROM ingested_channels
  WHERE primary_niche IS NOT NULL AND ingest_enabled=1
  GROUP BY primary_niche, niche ORDER BY n DESC LIMIT 15
`);
console.log('Sample primary_niche vs niche:');
for (const r of dualNiche) {
  console.log(`  primary=${r.primary_niche||'null'} niche=${r.niche||'null'} (${r.n})`);
}

// ═══════════════ PHASE 3: HOOK AGGREGATION ═══════════════

console.log('\n══════════════════════════════════════════════════');
console.log('PHASE 3 — HOOK AGGREGATION (S17) AUDIT');
console.log('══════════════════════════════════════════════════');

try {
  const htpCount  = q1(`SELECT COUNT(*) n FROM hook_type_performance`);
  const htpNiches = q1(`SELECT COUNT(DISTINCT niche) n FROM hook_type_performance`);
  const htpHooks  = q1(`SELECT COUNT(DISTINCT hook_type) n FROM hook_type_performance`);
  const htpRecent = q1(`SELECT MAX(updated_at) newest, MIN(updated_at) oldest FROM hook_type_performance`);
  console.log(`\nhook_type_performance:`);
  console.log(`  Rows: ${htpCount?.n}`);
  console.log(`  Distinct niches: ${htpNiches?.n}`);
  console.log(`  Distinct hook_types: ${htpHooks?.n}`);
  console.log(`  Newest updated_at: ${htpRecent?.newest}`);
  console.log(`  Oldest updated_at: ${htpRecent?.oldest}`);
  if (htpCount?.n > 0) {
    const htpSample = q(`SELECT niche, hook_type, duration_bucket, sample_count, hook_score, trend_direction FROM hook_type_performance ORDER BY hook_score DESC LIMIT 10`);
    console.log('  Top 10 by hook_score:');
    for (const r of htpSample) {
      console.log(`    ${r.niche} | ${r.hook_type} | ${r.duration_bucket} | samples=${r.sample_count} | score=${r.hook_score}`);
    }
  }
} catch(e) { console.log('  [hook_type_performance error:', e.message.slice(0,60), ']'); }

// Check niche_benchmarks (needed by hookAgg)
try {
  const nbCount = q1(`SELECT COUNT(*) n FROM niche_benchmarks`);
  console.log(`\nniche_benchmarks: ${nbCount?.n} rows`);
} catch(e) { console.log(`  niche_benchmarks: [not found] ${e.message.slice(0,40)}`); }

// Check ingested_videos with VPH data (S17 input)
const vphVids = q1(`
  SELECT COUNT(*) n FROM ingested_videos iv
  JOIN video_growth_snapshots vgs ON vgs.video_id = iv.youtube_video_id
  WHERE iv.title IS NOT NULL AND iv.niche IS NOT NULL AND vgs.views_per_hour IS NOT NULL
`);
console.log(`\nVideos eligible for S17 (has niche + title + VPH): ${vphVids?.n}`);

// ═══════════════ PHASE 4: S19 CONSUMERS ═══════════════

console.log('\n══════════════════════════════════════════════════');
console.log('PHASE 4 — S19 DEAD-WEIGHT TABLE AUDIT');
console.log('══════════════════════════════════════════════════');

const deadTables = [
  'format_migration_trends',
  'niche_evolution_snapshots',
  'ecosystem_shifts',
  'lifecycle_daily_snapshots',
];
for (const t of deadTables) {
  try {
    const cnt = q1(`SELECT COUNT(*) n FROM ${t}`);
    const rec = q1(`SELECT MAX(snapshot_date) newest FROM ${t}`).newest
             || q1(`SELECT MAX(detected_at) newest FROM ${t}`).newest
             || null;
    console.log(`  ${t.padEnd(35)} ${cnt?.n} rows   newest=${rec}`);
  } catch(e) {
    try {
      const cnt = q1(`SELECT COUNT(*) n FROM ${t}`);
      console.log(`  ${t.padEnd(35)} ${cnt?.n} rows`);
    } catch(e2) {
      console.log(`  ${t.padEnd(35)} [error: ${e.message.slice(0,40)}]`);
    }
  }
}

// ═══════════════ PHASE 5: FULL TABLE STATUS ═══════════════

console.log('\n══════════════════════════════════════════════════');
console.log('PHASE 5 — ALL KEY TABLES STATUS');
console.log('══════════════════════════════════════════════════');

const allTables = [
  'ingested_channels','ingested_videos','video_growth_snapshots',
  'channel_territory_profiles','creator_idea_dna','channel_identity',
  'creator_topic_lifecycle','topic_saturation_history','topic_signal_stats',
  'topic_event_metadata','narrative_lifecycle','google_trends_signals',
  'channel_wtp_cache','hook_type_performance','phrase_niche_pmi',
  'semantic_embeddings','semantic_clusters','channel_topics',
  'topic_community_stats','channel_evolution_summary',
  'format_migration_trends','niche_evolution_snapshots','ecosystem_shifts',
  'lifecycle_daily_snapshots','refresh_queue','wtp_impressions',
  'wtp_outcomes','wtp_saves','reclassification_log',
  'classification_repair_candidates','niche_benchmarks',
];
console.log('\n  Table                              Rows');
for (const t of allTables) {
  try {
    const cnt = q1(`SELECT COUNT(*) n FROM ${t}`);
    console.log(`  ${t.padEnd(35)} ${cnt?.n}`);
  } catch(e) {
    console.log(`  ${t.padEnd(35)} [ERR: ${e.message.slice(0,30)}]`);
  }
}

// ═══════════════ PHASE 6: SEMANTIC CLUSTERS ═══════════════

console.log('\n══════════════════════════════════════════════════');
console.log('PHASE 6 — SEMANTIC CLUSTER STATE');
console.log('══════════════════════════════════════════════════');

const clusters = q(`SELECT cluster_name, sample_size, ROUND(confidence,3) conf, ROUND(avg_vph,1) avg_vph, trend_direction, updated_at FROM semantic_clusters ORDER BY sample_size DESC`);
console.log(`\nSemantic clusters: ${clusters.length}`);
for (const c of clusters) {
  console.log(`  ${(c.cluster_name||'?').padEnd(20)} size=${c.sample_size||0} conf=${c.conf||'?'} avg_vph=${c.avg_vph||'?'} trend=${c.trend_direction||'?'} updated=${c.updated_at||'?'}`);
}

// Check if any embedding's cluster assignment references niche
try {
  const embSample = q(`SELECT se.semantic_cluster, COUNT(*) n, AVG(vgs.views_per_hour) avg_vph
    FROM semantic_embeddings se
    JOIN video_growth_snapshots vgs ON vgs.video_id = se.youtube_video_id
    WHERE vgs.views_per_hour IS NOT NULL AND vgs.views_per_hour > 0
    GROUP BY se.semantic_cluster ORDER BY n DESC LIMIT 14`);
  console.log('\nEmbedding→VPH by cluster (VPH comes from video data, not niche):');
  for (const r of embSample) {
    console.log(`  ${(r.semantic_cluster||'?').padEnd(20)} vids=${r.n} avg_vph=${r.avg_vph?.toFixed(1)||'?'}`);
  }
} catch(e) { console.log('  [embedding error:', e.message.slice(0,60), ']'); }

// ═══════════════ PHASE 7: REFRESH QUEUE DETAIL ═══════════════

console.log('\n══════════════════════════════════════════════════');
console.log('PHASE 7 — REFRESH QUEUE DEEP DIVE');
console.log('══════════════════════════════════════════════════');

try {
  const rqSchema = q(`PRAGMA table_info(refresh_queue)`);
  console.log('  refresh_queue columns:', rqSchema.map(c => c.name).join(', '));

  const rqStatus = q(`SELECT status, job_type, COUNT(*) n FROM refresh_queue GROUP BY status, job_type ORDER BY n DESC`);
  console.log('\n  Status breakdown:');
  for (const r of rqStatus) console.log(`    ${r.status||'null'} | ${r.job_type||'null'} | ${r.n}`);

  const rqRecent = q1(`SELECT MAX(created_at) newest, MIN(created_at) oldest FROM refresh_queue WHERE job_type='wtp_cache'`);
  console.log(`\n  WTP cache jobs: newest=${rqRecent?.newest} oldest=${rqRecent?.oldest}`);
} catch(e) { console.log('  refresh_queue error:', e.message.slice(0,60)); }

db.close();
console.log('\nDone.');

'use strict';
const path = require('path');
const DB = require('../node_modules/better-sqlite3');
const db = new DB(path.resolve(__dirname, '../data/scoring.db'), { readonly: true });
const q  = (sql, ...a) => db.prepare(sql).all(...a);
const q1 = (sql, ...a) => db.prepare(sql).get(...a);

// ═══════════════════════════════════════════════════════════════════════════════
// CLAIM A — COALESCE peer routing: does stale primary_niche affect WTP?
// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n═══ CLAIM A: PRIMARY_NICHE vs NICHE ROUTING ═══');
// Verify COALESCE reality: are there any channels where primary_niche IS NULL?
const nullPN = q1('SELECT COUNT(*) n FROM ingested_channels WHERE primary_niche IS NULL AND ingest_enabled=1');
console.log('Channels with NULL primary_niche:', nullPN.n);

// Actual peer pool sizes using primary_niche (what creatorPeerContext.js uses)
const peerPools = q(`SELECT primary_niche, COUNT(*) n FROM ingested_channels
  WHERE ingest_enabled=1 AND primary_niche IS NOT NULL
  GROUP BY primary_niche ORDER BY n DESC`);
console.log('\nPeer pool sizes (primary_niche):');
for (const r of peerPools) console.log(' ', (r.primary_niche||'?').padEnd(25), r.n);

// ═══════════════════════════════════════════════════════════════════════════════
// CLAIM B — 759 stale primary_niche: REAL vs AI-OVERRIDE mismatch?
// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n═══ CLAIM B: PRIMARY_NICHE MISMATCH ANALYSIS ═══');
// Show current_niche for the mismatched channels to determine if ic.primary_niche
// is the OLD value or a new AI-determined value different from suggested_niche
const mismatchSample = q(`
  SELECT crc.channel_id, crc.channel_name,
         crc.current_niche AS crc_current_niche,
         crc.suggested_niche AS crc_suggested_niche,
         crc.status AS crc_status,
         ic.primary_niche AS ic_primary_niche,
         ic.niche AS ic_niche,
         ic.identity_source
  FROM classification_repair_candidates crc
  JOIN ingested_channels ic ON ic.channel_id = crc.channel_id
  WHERE crc.status IN ('reclassified','auto_repaired')
    AND crc.suggested_niche != ic.primary_niche
  LIMIT 20
`);
console.log('\nMismatch sample (suggested_niche != ic.primary_niche):');
console.log('  crc_current | crc_suggested | ic_primary | ic_niche | identity_source | status');
for (const r of mismatchSample) {
  // Key question: is ic_primary_niche the OLD niche (=crc_current_niche) or a new AI niche?
  const isPrimaryOldNiche = r.ic_primary_niche === r.crc_current_niche;
  const isAiOverrideNiche = !isPrimaryOldNiche && r.ic_primary_niche !== r.crc_suggested_niche;
  const flag = isPrimaryOldNiche ? 'STALE' : (isAiOverrideNiche ? 'AI-OVERRIDE' : 'UPDATED');
  console.log(`  [${flag}] ${(r.crc_current_niche||'?').padEnd(15)} | ${(r.crc_suggested_niche||'?').padEnd(12)} | ${(r.ic_primary_niche||'?').padEnd(10)} | ${(r.ic_niche||'?').padEnd(20)} | ${(r.identity_source||'?').padEnd(18)} | ${r.crc_status}`);
}

// Summary: how many are genuinely STALE vs AI-OVERRIDE?
const mismatchAll = q(`
  SELECT crc.current_niche, crc.suggested_niche, ic.primary_niche, ic.identity_source, crc.status, COUNT(*) n
  FROM classification_repair_candidates crc
  JOIN ingested_channels ic ON ic.channel_id = crc.channel_id
  WHERE crc.status IN ('reclassified','auto_repaired')
    AND crc.suggested_niche != ic.primary_niche
  GROUP BY crc.current_niche, crc.suggested_niche, ic.primary_niche, ic.identity_source, crc.status
`);

let genuinelyStale = 0, aiOverride = 0;
for (const r of mismatchAll) {
  if (r.ic_primary_niche === r.current_niche) genuinelyStale += r.n;
  else aiOverride += r.n;
}
console.log(`\nMismatch breakdown:`);
console.log(`  GENUINELY STALE (ic.primary_niche = crc.current_niche = OLD niche): ${genuinelyStale}`);
console.log(`  AI-OVERRIDE    (ic.primary_niche = AI decision, differs from suggested): ${aiOverride}`);
console.log(`  Total mismatch: ${genuinelyStale + aiOverride}`);

// Also check: how many 'reclassified' channels have ic.primary_niche = crc.suggested_niche?
const exactMatch = q1(`
  SELECT COUNT(*) n FROM classification_repair_candidates crc
  JOIN ingested_channels ic ON ic.channel_id = crc.channel_id
  WHERE crc.status = 'reclassified'
    AND crc.suggested_niche = ic.primary_niche
`);
const noChange = q1(`SELECT COUNT(*) n FROM classification_repair_candidates WHERE status='reclassified_no_change'`);
const reclassTotal = q1(`SELECT COUNT(*) n FROM classification_repair_candidates WHERE status='reclassified'`);
const autoRepaired = q1(`SELECT COUNT(*) n FROM classification_repair_candidates WHERE status='auto_repaired'`);
console.log(`\nStatus counts:`);
console.log(`  reclassified:         ${reclassTotal.n}`);
console.log(`  auto_repaired:        ${autoRepaired.n}`);
console.log(`  reclassified_no_change: ${noChange.n}`);
console.log(`  reclassified with exact match (primary = suggested): ${exactMatch.n}`);

// ═══════════════════════════════════════════════════════════════════════════════
// CLAIM C — refresh_jobs lifecycle
// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n═══ CLAIM C: REFRESH_JOBS LIFECYCLE STATE ═══');
try {
  const schema = q('PRAGMA table_info(refresh_jobs)');
  console.log('Schema columns:', schema.map(c => c.name).join(', '));

  const allJobs = q('SELECT * FROM refresh_jobs ORDER BY id');
  console.log(`\nAll jobs (${allJobs.length} total):`);
  for (const j of allJobs) {
    console.log(`  id=${j.id} status=${j.status} job_type=${j.job_type} channel_id=${j.channel_id?.slice(0,12)} priority=${j.priority}`);
    console.log(`    created_at=${j.created_at} run_after=${j.run_after} attempts=${j.attempts}`);
    console.log(`    locked_by=${j.locked_by||'NULL'} locked_at=${j.locked_at||'NULL'} started_at=${j.started_at||'NULL'}`);
    console.log(`    error_message=${j.error_message?.slice(0,80)||'NULL'}`);
  }

  // Check if run_after is in the past (so they should be claimable)
  const claimable = q(`SELECT COUNT(*) n FROM refresh_jobs WHERE status='pending' AND datetime(run_after) <= datetime('now')`);
  console.log(`\nCurrently claimable (run_after <= now): ${claimable.n}`);

  const stats = q('SELECT status, job_type, COUNT(*) n FROM refresh_jobs GROUP BY status, job_type');
  console.log('\nStats by status+job_type:');
  for (const s of stats) console.log(`  ${s.status} | ${s.job_type} | ${s.n}`);
} catch(e) { console.log('refresh_jobs error:', e.message); }

// ═══════════════════════════════════════════════════════════════════════════════
// CLAIM D — Which scripts call enqueueRefreshJob?
// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n═══ CLAIM D: WHO ENQUEUES REFRESH JOBS? ═══');
// The code reads showed reclassifyRepairQueue.js and classificationRepair.js
// do NOT call enqueueRefreshJob. Let's check via reclassification_log
// what the cache invalidation count is
try {
  const logCount = q1('SELECT COUNT(*) n FROM reclassification_log WHERE niche_changed=1');
  const logTotal = q1('SELECT COUNT(*) n FROM reclassification_log');
  console.log(`reclassification_log total rows: ${logTotal.n}`);
  console.log(`reclassification_log niche_changed=1: ${logCount.n}`);

  // WTP cache state for reclassified channels
  const wtpForRepaired = q(`
    SELECT COUNT(*) n FROM channel_wtp_cache w
    JOIN classification_repair_candidates crc ON crc.channel_id = w.channel_id
    WHERE crc.status IN ('reclassified','auto_repaired')
  `);
  console.log(`WTP cache entries for reclassified channels: ${wtpForRepaired[0]?.n || 0}`);

  // repair_jobs vs channels that had WTP cleared
  console.log(`refresh_jobs count: ${q1('SELECT COUNT(*) n FROM refresh_jobs').n}`);
  console.log(`WTP cache total: ${q1('SELECT COUNT(*) n FROM channel_wtp_cache').n}`);
} catch(e) { console.log('Error:', e.message); }

// ═══════════════════════════════════════════════════════════════════════════════
// CLAIM E — Why are 4 jobs stuck?
// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n═══ CLAIM E: STUCK JOBS ANALYSIS ═══');
// Already shown in Claim C. Key: locked_by, locked_at, attempts, run_after vs now
// The index.js analysis: ENABLE_API_CRONS not set → worker.js not running → no claim
console.log('See Claim C output above for full job state.');
console.log('Per index.js:179-182: background jobs only start if ENABLE_API_CRONS=1 or worker.js is running.');
console.log('If neither is true, claimRefreshJobs() is never called → jobs stay pending forever.');

// ═══════════════════════════════════════════════════════════════════════════════
// CLAIM F — WTP on-demand path: does stale primary_niche poison output?
// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n═══ CLAIM F: WTP ON-DEMAND CORRECTNESS ═══');
// Show the 6 WTP cache entries: when computed, by what source
const wtpEntries = q(`SELECT channel_id, computed_by, refresh_reason,
  computed_at, expires_at, status, error_message,
  json_extract(payload_json, '$.confidence') as confidence,
  json_extract(payload_json, '$.niche') as wtp_niche
  FROM channel_wtp_cache ORDER BY computed_at`);
console.log(`\nAll WTP cache entries (${wtpEntries.length}):`);
for (const w of wtpEntries) {
  const isPrimaryStale = q1(`
    SELECT crc.suggested_niche, ic.primary_niche, ic.niche
    FROM ingested_channels ic
    LEFT JOIN classification_repair_candidates crc ON crc.channel_id = ic.channel_id
    WHERE ic.channel_id = ?`, w.channel_id);
  console.log(`  ch=${w.channel_id?.slice(0,15)} computed_by=${w.computed_by} status=${w.status}`);
  console.log(`    computed_at=${w.computed_at} confidence=${w.confidence}`);
  console.log(`    ic.primary_niche=${isPrimaryStale?.primary_niche} ic.niche=${isPrimaryStale?.niche}`);
  console.log(`    crc.suggested_niche=${isPrimaryStale?.suggested_niche||'N/A'}`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// PHASE 2 — USER IMPACT: WTP engagement tables
// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n═══ PHASE 2: WTP ENGAGEMENT TABLES ═══');
const engageTables = [
  'wtp_impressions', 'wtp_saves', 'wtp_exports', 'wtp_outcomes',
  'wtp_brief_generations', 'wtp_video_matches', 'wtp_attribution_candidates',
  'wtp_attribution_confirmations',
];
for (const t of engageTables) {
  try {
    const cnt = q1(`SELECT COUNT(*) n FROM ${t}`);
    const schema = q(`PRAGMA table_info(${t})`).map(c => c.name).join(', ');
    let extra = '';
    try {
      const newest = q1(`SELECT MAX(created_at) newest, MIN(created_at) oldest FROM ${t}`);
      if (newest?.newest) extra = ` | first=${newest.oldest} last=${newest.newest}`;
    } catch {}
    console.log(`  ${t.padEnd(35)} ${cnt.n} rows${extra}`);
    console.log(`    cols: ${schema}`);
  } catch(e) { console.log(`  ${t.padEnd(35)} [error: ${e.message}]`); }
}

// ═══════════════════════════════════════════════════════════════════════════════
// PHASE 3 — Pipeline stage table states
// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n═══ PHASE 3: PIPELINE STAGE HEALTH ═══');
const pipelineTables = [
  // S16 semantic clustering
  ['semantic_embeddings', 'Embedding coverage'],
  ['semantic_clusters', 'S16 cluster definitions'],
  // S17 hook aggregation
  ['hook_type_performance', 'S17 hook performance'],
  // S18 narrative lifecycle
  ['narrative_lifecycle', 'S18 narrative lifecycle'],
  // S19 intelligence aggregator
  ['format_migration_trends', 'S19/dead format migration'],
  ['niche_evolution_snapshots', 'S19/dead niche evolution'],
  ['ecosystem_shifts', 'S19/dead ecosystem shifts'],
  ['creator_topic_lifecycle', 'S19 topic lifecycle (used)'],
  ['phrase_niche_pmi', 'S19 PMI (used in WTP)'],
  ['channel_identity', 'S19 channel identity (used)'],
  // S20 territory profiles
  ['channel_territory_profiles', 'S20 territory profiles'],
  // S21 WTP
  ['channel_wtp_cache', 'S21 WTP cache'],
  // S22 feedback/outcomes
  ['wtp_impressions', 'S22 impressions (tracking)'],
  ['wtp_outcomes', 'S22 outcomes'],
  // S23 discovery
  ['corpus_discovery_graph', 'S23 discovery graph'],
  ['corpus_ecology_history', 'S23 ecology history'],
  // S24 attribution
  ['wtp_attribution_candidates', 'S24 attribution candidates'],
  // S25 optimization
  ['scoring_versions', 'S25 scoring versions'],
  ['scoring_weight_audit', 'S25 weight audit'],
];
for (const [t, label] of pipelineTables) {
  try {
    const cnt = q1(`SELECT COUNT(*) n FROM ${t}`);
    let newest = '';
    try {
      const ts = q1(`SELECT MAX(updated_at) m FROM ${t}`);
      if (!ts?.m) { const ts2 = q1(`SELECT MAX(created_at) m FROM ${t}`); if (ts2?.m) newest = ` newest=${ts2.m?.slice(0,10)}`; }
      else newest = ` newest=${ts.m?.slice(0,10)}`;
    } catch {}
    console.log(`  ${t.padEnd(38)} ${String(cnt.n).padStart(8)} rows  ${label}${newest}`);
  } catch(e) { console.log(`  ${t.padEnd(38)} [missing: ${e.message.slice(0,40)}]`); }
}

// ═══════════════════════════════════════════════════════════════════════════════
// PHASE 4 — Community quality: niche peer pool precision
// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n═══ PHASE 4: COMMUNITY QUALITY ═══');
// For top 5 niches, show peer pool size and topic signal stats
const topNiches = ['music', 'travel', 'beauty', 'food', 'education'];
for (const niche of topNiches) {
  const pool = q1(`SELECT COUNT(*) n FROM ingested_channels WHERE primary_niche=? AND ingest_enabled=1`, niche);
  const withIdentity = q1(`SELECT COUNT(*) n FROM ingested_channels ic JOIN channel_identity ci ON ci.channel_id=ic.channel_id WHERE ic.primary_niche=? AND ic.ingest_enabled=1`, niche);
  const topicCount = q1(`SELECT COUNT(DISTINCT ct.topic) n FROM channel_topics ct JOIN ingested_channels ic ON ic.channel_id=ct.channel_id WHERE ic.primary_niche=?`, niche);
  const benchCount = q1(`SELECT COUNT(*) n FROM niche_benchmarks WHERE niche=?`, niche);
  console.log(`  ${niche.padEnd(12)} pool=${pool.n} with_identity=${withIdentity?.n||0} distinct_topics=${topicCount?.n||0} benchmarks=${benchCount?.n||0}`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// EMBEDDING / SEMANTIC CLUSTER HEALTH
// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n═══ SEMANTIC CLUSTER STATE ═══');
try {
  const clusters = q('SELECT cluster_name, sample_size, ROUND(confidence,3) conf, ROUND(avg_vph,1) avg_vph, updated_at FROM semantic_clusters ORDER BY sample_size DESC');
  for (const c of clusters) {
    console.log(`  ${(c.cluster_name||'?').padEnd(16)} size=${c.sample_size} conf=${c.conf} avg_vph=${c.avg_vph} updated=${c.updated_at?.slice(0,10)}`);
  }
  const embeddingCoverage = q1('SELECT COUNT(*) n FROM semantic_embeddings');
  const embeddingWithCluster = q1('SELECT COUNT(*) n FROM semantic_embeddings WHERE cluster_name IS NOT NULL');
  const embeddingOrphaned = q1('SELECT COUNT(*) n FROM semantic_embeddings WHERE cluster_name IS NULL OR cluster_name=\'\'');
  console.log(`\n  Total embeddings: ${embeddingCoverage.n}`);
  console.log(`  With cluster assignment: ${embeddingWithCluster?.n||0}`);
  console.log(`  Without cluster (orphaned): ${embeddingOrphaned?.n||0}`);
} catch(e) { console.log('Error:', e.message); }

// ═══════════════════════════════════════════════════════════════════════════════
// GOOGLE TRENDS / NARRATIVE LIFECYCLE / WORLD SIGNALS
// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n═══ SPARSE SIGNAL TABLES ═══');
const signalTables = ['google_trends_signals', 'narrative_lifecycle', 'topic_event_metadata', 'topic_signal_stats'];
for (const t of signalTables) {
  try {
    const cnt = q1(`SELECT COUNT(*) n FROM ${t}`);
    let newest = '';
    try { const ts = q1(`SELECT MAX(created_at) m FROM ${t}`); if (ts?.m) newest = ` newest=${ts.m?.slice(0,10)}`; } catch{}
    console.log(`  ${t.padEnd(30)} ${cnt.n} rows${newest}`);
  } catch(e) { console.log(`  ${t.padEnd(30)} [error: ${e.message}]`); }
}

// ═══════════════════════════════════════════════════════════════════════════════
// COMPLETE TABLE INVENTORY
// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n═══ COMPLETE TABLE INVENTORY ═══');
const allTables = q("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name");
for (const t of allTables) {
  try {
    const cnt = q1(`SELECT COUNT(*) n FROM "${t.name}"`);
    process.stdout.write(`${t.name}(${cnt.n})  `);
  } catch { process.stdout.write(`${t.name}(err)  `); }
}
console.log('\n');

db.close();
console.log('Done.');

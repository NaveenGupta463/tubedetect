'use strict';
const path = require('path');
const DB = require('../node_modules/better-sqlite3');
const db = new DB(path.resolve(__dirname, '../data/scoring.db'), { readonly: true });
const q  = (sql, ...a) => db.prepare(sql).all(...a);
const q1 = (sql, ...a) => db.prepare(sql).get(...a);

// ═══ CLAIM F: WTP ON-DEMAND CORRECTNESS ═══
console.log('═══ CLAIM F: WTP CACHE SCHEMA & ENTRIES ═══');
const wtpSchema = q('PRAGMA table_info(channel_wtp_cache)');
console.log('Schema:', wtpSchema.map(c => c.name).join(', '));

const wtpEntries = q('SELECT * FROM channel_wtp_cache ORDER BY computed_at');
console.log(`\nAll WTP cache entries (${wtpEntries.length}):`);
for (const w of wtpEntries) {
  // Check if this channel is a repair candidate
  let repairInfo = 'not a repair candidate';
  try {
    const rc = q1('SELECT current_niche, suggested_niche, status FROM classification_repair_candidates WHERE channel_id=?', w.channel_id);
    if (rc) repairInfo = `crc: ${rc.current_niche}→${rc.suggested_niche} status=${rc.status}`;
  } catch {}
  const ic = q1('SELECT primary_niche, niche FROM ingested_channels WHERE channel_id=?', w.channel_id);
  console.log(`  ch=${w.channel_id?.slice(0,20)} status=${w.status} expires=${w.expires_at?.slice(0,16)}`);
  const keys = Object.keys(w).filter(k => !k.includes('json') && !k.includes('payload'));
  for (const k of keys) console.log(`    ${k}=${w[k]}`);
  console.log(`    ic.primary_niche=${ic?.primary_niche} ic.niche=${ic?.niche}`);
  console.log(`    ${repairInfo}`);
}

// ═══ PHASE 2 — USER IMPACT: WTP engagement tables ═══
console.log('\n═══ PHASE 2: WTP ENGAGEMENT TABLES ═══');
const engageTables = [
  'wtp_impressions', 'wtp_saves', 'wtp_exports', 'wtp_outcomes',
  'wtp_brief_generations', 'wtp_video_matches', 'wtp_attribution_candidates',
];
for (const t of engageTables) {
  try {
    const cnt = q1(`SELECT COUNT(*) n FROM "${t}"`);
    const schema = q(`PRAGMA table_info("${t}")`).map(c => c.name).join(', ');
    let extra = '';
    try {
      const ts = q1(`SELECT MAX(created_at) newest, MIN(created_at) oldest FROM "${t}"`);
      if (ts?.newest) extra = ` | first=${ts.oldest} last=${ts.newest}`;
    } catch {}
    console.log(`  ${t.padEnd(35)} ${cnt.n} rows${extra}`);
    console.log(`    cols: ${schema}`);
  } catch(e) { console.log(`  ${t.padEnd(35)} [error: ${e.message}]`); }
}

// wtp_attribution_confirmations if it exists
try {
  const cnt = q1('SELECT COUNT(*) n FROM wtp_attribution_confirmations');
  console.log(`  wtp_attribution_confirmations       ${cnt.n} rows`);
} catch {}

// ═══ PHASE 3 — Pipeline stage table states ═══
console.log('\n═══ PHASE 3: PIPELINE STAGE HEALTH ═══');
const stages = [
  ['semantic_embeddings', 'S16 embeddings'],
  ['semantic_clusters', 'S16 clusters'],
  ['hook_type_performance', 'S17 hook performance (0=broken)'],
  ['narrative_lifecycle', 'S18 narrative lifecycle'],
  ['format_migration_trends', 'S19 DEAD format migration'],
  ['niche_evolution_snapshots', 'S19 DEAD niche evolution'],
  ['ecosystem_shifts', 'S19 DEAD ecosystem shifts'],
  ['creator_topic_lifecycle', 'S19 topic lifecycle'],
  ['phrase_niche_pmi', 'S19 PMI (WTP signal)'],
  ['channel_identity', 'S19 channel identity'],
  ['channel_territory_profiles', 'S20 territory profiles'],
  ['channel_wtp_cache', 'S21 WTP cache'],
  ['wtp_impressions', 'S22 impressions ZERO'],
  ['wtp_outcomes', 'S22 outcomes ZERO'],
  ['refresh_jobs', 'WTP refresh queue'],
  ['google_trends_signals', 'World signals'],
  ['topic_signal_stats', 'Topic signal stats'],
  ['niche_benchmarks', 'Niche benchmarks'],
  ['channel_evolution_summary', 'Channel evolution'],
  ['creator_idea_dna', 'Creator DNA'],
];
for (const [t, label] of stages) {
  try {
    const cnt = q1(`SELECT COUNT(*) n FROM "${t}"`);
    let newest = '';
    try {
      const ts = q1(`SELECT MAX(updated_at) m FROM "${t}"`);
      if (ts?.m) newest = ` newest=${ts.m?.slice(0,10)}`;
      else {
        const ts2 = q1(`SELECT MAX(created_at) m FROM "${t}"`);
        if (ts2?.m) newest = ` newest=${ts2.m?.slice(0,10)}`;
      }
    } catch {}
    console.log(`  ${t.padEnd(38)} ${String(cnt.n).padStart(8)}  ${label}${newest}`);
  } catch(e) { console.log(`  ${t.padEnd(38)} [missing]  ${label}`); }
}

// ═══ PHASE 4 — Community quality ═══
console.log('\n═══ PHASE 4: COMMUNITY QUALITY ═══');
const topNiches = ['music', 'travel', 'beauty', 'food', 'education', 'entertainment', 'lifestyle'];
for (const niche of topNiches) {
  const pool = q1(`SELECT COUNT(*) n FROM ingested_channels WHERE primary_niche=? AND ingest_enabled=1`, niche);
  const withIdentity = q1(`
    SELECT COUNT(*) n FROM ingested_channels ic
    JOIN channel_identity ci ON ci.channel_id=ic.channel_id
    WHERE ic.primary_niche=? AND ic.ingest_enabled=1`, niche);
  const topicCount = q1(`
    SELECT COUNT(DISTINCT ct.topic) n FROM channel_topics ct
    JOIN ingested_channels ic ON ic.channel_id=ct.channel_id
    WHERE ic.primary_niche=?`, niche);
  const pmiCount = q1(`SELECT COUNT(*) n FROM phrase_niche_pmi WHERE niche=?`, niche);
  console.log(`  ${niche.padEnd(15)} pool=${pool.n} with_identity=${withIdentity?.n||0} topics=${topicCount?.n||0} pmi_phrases=${pmiCount?.n||0}`);
}

// ═══ S19 dead function runtime evidence ═══
console.log('\n═══ S19 DEAD FUNCTION DATA AGE ═══');
try {
  const fmt = q1('SELECT COUNT(*) n, MAX(computed_at) newest FROM format_migration_trends');
  console.log(`  format_migration_trends: ${fmt.n} rows, newest=${fmt.newest}`);
  const evo = q1('SELECT COUNT(*) n, MAX(computed_at) newest FROM niche_evolution_snapshots');
  console.log(`  niche_evolution_snapshots: ${evo.n} rows, newest=${evo.newest}`);
  const eco = q1('SELECT COUNT(*) n, MAX(detected_at) newest FROM ecosystem_shifts');
  console.log(`  ecosystem_shifts: ${eco.n} rows, newest=${eco.newest}`);
} catch(e) { console.log('Error:', e.message); }

// ═══ COMPLETE TABLE INVENTORY ═══
console.log('\n═══ COMPLETE TABLE INVENTORY ═══');
const allTables = q("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name");
const tableCounts = [];
for (const t of allTables) {
  try {
    const cnt = q1(`SELECT COUNT(*) n FROM "${t.name}"`);
    tableCounts.push(`${t.name}(${cnt.n})`);
  } catch { tableCounts.push(`${t.name}(?)`); }
}
// Print in 3 columns
for (let i = 0; i < tableCounts.length; i += 3) {
  console.log('  ' + tableCounts.slice(i, i+3).map(s => s.padEnd(45)).join(''));
}

// ═══ EXTRA: scoring versions ═══
console.log('\n═══ SCORING VERSIONS ═══');
try {
  const sv = q('SELECT * FROM scoring_versions ORDER BY id DESC LIMIT 5');
  for (const r of sv) console.log('  ', JSON.stringify(r));
} catch(e) { console.log('  [missing]:', e.message); }

// ═══ EXTRA: wtp_brief_generations if exists ═══
console.log('\n═══ WTP BRIEF GENERATIONS ═══');
try {
  const cnt = q1('SELECT COUNT(*) n FROM wtp_brief_generations');
  const schema = q('PRAGMA table_info(wtp_brief_generations)').map(c=>c.name).join(', ');
  console.log(`  wtp_brief_generations: ${cnt.n} rows | cols: ${schema}`);
  const sample = q('SELECT * FROM wtp_brief_generations LIMIT 3');
  for (const r of sample) console.log('  ', JSON.stringify(r).slice(0,200));
} catch(e) { console.log('  [error]:', e.message); }

// ═══ reclassification_log status breakdown ═══
console.log('\n═══ RECLASSIFICATION LOG STATUS ═══');
try {
  const rlStatuses = q('SELECT status, COUNT(*) n FROM reclassification_log GROUP BY status ORDER BY n DESC');
  for (const r of rlStatuses) console.log(`  ${(r.status||'null').padEnd(30)} ${r.n}`);
  const rlNicheChanged = q('SELECT COUNT(*) n FROM reclassification_log WHERE niche_changed=1');
  console.log(`  niche_changed=1: ${rlNicheChanged[0].n}`);
} catch(e) { console.log('Error:', e.message); }

db.close();
console.log('\nDone.');

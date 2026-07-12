'use strict';
const path = require('path');
const DB = require('../node_modules/better-sqlite3');
const db = new DB(path.resolve(__dirname, '../data/scoring.db'), { readonly: true });
const q  = (sql, ...a) => db.prepare(sql).all(...a);
const q1 = (sql, ...a) => db.prepare(sql).get(...a);

// Check phrase_niche_pmi schema
console.log('=== phrase_niche_pmi schema ===');
const pmiSchema = q('PRAGMA table_info(phrase_niche_pmi)');
console.log(pmiSchema.map(c=>c.name).join(', '));

// Check channel_topics schema
console.log('\n=== channel_topics schema ===');
const ctSchema = q('PRAGMA table_info(channel_topics)');
console.log(ctSchema.map(c=>c.name).join(', '));

// Community quality per niche
console.log('\n=== PHASE 4: COMMUNITY QUALITY ===');
const pmiNicheField = pmiSchema.find(c => c.name === 'primary_niche') ? 'primary_niche' :
                      pmiSchema.find(c => c.name === 'niche') ? 'niche' : null;
const ctNicheField = ctSchema.find(c => c.name === 'primary_niche') ? 'primary_niche' :
                     ctSchema.find(c => c.name === 'niche') ? 'niche' : null;
console.log(`phrase_niche_pmi niche field: ${pmiNicheField}`);
console.log(`channel_topics niche field: ${ctNicheField}`);

const topNiches = ['music', 'travel', 'beauty', 'food', 'education', 'entertainment', 'lifestyle', 'gaming'];
for (const niche of topNiches) {
  const pool = q1(`SELECT COUNT(*) n FROM ingested_channels WHERE primary_niche=? AND ingest_enabled=1`, niche);
  const withIdentity = q1(`SELECT COUNT(*) n FROM ingested_channels ic JOIN channel_identity ci ON ci.channel_id=ic.channel_id WHERE ic.primary_niche=? AND ic.ingest_enabled=1`, niche);
  let topicCount = { n: 0 };
  let pmiCount = { n: 0 };
  try {
    if (ctNicheField) {
      topicCount = q1(`SELECT COUNT(DISTINCT ct.topic) n FROM channel_topics ct JOIN ingested_channels ic ON ic.channel_id=ct.channel_id WHERE ic.primary_niche=?`, niche);
    }
    if (pmiNicheField) {
      pmiCount = q1(`SELECT COUNT(*) n FROM phrase_niche_pmi WHERE ${pmiNicheField}=?`, niche);
    }
  } catch(e) { console.log('  Error for', niche, ':', e.message); }
  console.log(`  ${niche.padEnd(15)} pool=${pool.n} with_identity=${withIdentity?.n||0} topics=${topicCount?.n||0} pmi=${pmiCount?.n||0}`);
}

// S19 dead function data age
console.log('\n=== S19 DEAD FUNCTION DATA AGE ===');
try {
  const fmtSchema = q('PRAGMA table_info(format_migration_trends)');
  console.log('format_migration_trends cols:', fmtSchema.map(c=>c.name).join(', '));
  const fmt = q('SELECT * FROM format_migration_trends LIMIT 2');
  if (fmt.length) console.log('Sample:', JSON.stringify(fmt[0]).slice(0, 200));
} catch(e) { console.log('Error:', e.message); }

try {
  const ecoSchema = q('PRAGMA table_info(ecosystem_shifts)');
  console.log('\necosystem_shifts cols:', ecoSchema.map(c=>c.name).join(', '));
  const eco = q('SELECT * FROM ecosystem_shifts LIMIT 2');
  if (eco.length) console.log('Sample:', JSON.stringify(eco[0]).slice(0, 200));
} catch(e) { console.log('Error:', e.message); }

// Complete table inventory
console.log('\n=== COMPLETE TABLE INVENTORY ===');
const allTables = q("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name");
const tableCounts = [];
for (const t of allTables) {
  try {
    const cnt = q1(`SELECT COUNT(*) n FROM "${t.name}"`);
    tableCounts.push(`${t.name}(${cnt.n})`);
  } catch { tableCounts.push(`${t.name}(?)`); }
}
for (let i = 0; i < tableCounts.length; i += 3) {
  console.log('  ' + tableCounts.slice(i, i+3).map(s => s.padEnd(48)).join(''));
}
console.log(`\nTotal tables: ${allTables.length}`);

// Scoring versions
console.log('\n=== SCORING/WEIGHT TABLES ===');
try {
  const sv = q('SELECT * FROM scoring_versions ORDER BY id DESC LIMIT 3');
  if (sv.length) {
    console.log('scoring_versions cols:', Object.keys(sv[0]).join(', '));
    for (const r of sv) console.log('  ', JSON.stringify(r).slice(0, 200));
  } else { console.log('scoring_versions: empty'); }
} catch(e) { console.log('scoring_versions:', e.message); }

try {
  const sw = q('SELECT COUNT(*) n, MAX(created_at) newest FROM scoring_weight_audit');
  console.log('scoring_weight_audit:', sw[0].n, 'rows newest=', sw[0].newest);
} catch(e) { console.log('scoring_weight_audit:', e.message); }

// WTP brief generations
console.log('\n=== WTP BRIEF GENERATIONS ===');
try {
  const cnt = q1('SELECT COUNT(*) n FROM wtp_brief_generations');
  console.log(`wtp_brief_generations: ${cnt.n} rows`);
} catch(e) { console.log('wtp_brief_generations:', e.message); }

// Reclassification log breakdown
console.log('\n=== RECLASSIFICATION LOG ===');
try {
  const statuses = q('SELECT status, COUNT(*) n FROM reclassification_log GROUP BY status ORDER BY n DESC');
  for (const r of statuses) console.log(`  ${(r.status||'null').padEnd(30)} ${r.n}`);
  const nc1 = q1('SELECT COUNT(*) n FROM reclassification_log WHERE niche_changed=1');
  console.log(`  niche_changed=1: ${nc1.n}`);
  const tiers = q('SELECT tier, COUNT(*) n FROM reclassification_log GROUP BY tier ORDER BY tier');
  for (const r of tiers) console.log(`  tier ${r.tier}: ${r.n} processed`);
} catch(e) { console.log('Error:', e.message); }

// Niche benchmarks
console.log('\n=== NICHE BENCHMARKS COVERAGE ===');
try {
  const nb = q('SELECT niche, COUNT(*) n FROM niche_benchmarks GROUP BY niche ORDER BY n DESC LIMIT 15');
  for (const r of nb) console.log(`  ${(r.niche||'?').padEnd(25)} ${r.n}`);
} catch(e) { console.log('Error:', e.message); }

// Corpus discovery
console.log('\n=== CORPUS DISCOVERY GRAPH ===');
try {
  const cdg = q1('SELECT COUNT(*) n FROM corpus_discovery_graph');
  const cdgSchema = q('PRAGMA table_info(corpus_discovery_graph)').map(c=>c.name).join(', ');
  console.log(`corpus_discovery_graph: ${cdg.n} rows | cols: ${cdgSchema}`);
} catch(e) { console.log('corpus_discovery_graph:', e.message); }

db.close();
console.log('\nDone.');

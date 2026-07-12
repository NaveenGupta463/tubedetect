'use strict';
const path = require('path');
const DB   = require('../node_modules/better-sqlite3');
const db   = new DB(path.resolve(__dirname, '../data/scoring.db'), { readonly: true });
const q    = (sql, ...a) => db.prepare(sql).all(...a);
const q1   = (sql, ...a) => db.prepare(sql).get(...a);
const sep  = (t) => console.log(`\n${'═'.repeat(60)}\n${t}\n${'═'.repeat(60)}`);

// ─────────────────────────────────────────────────────────────────────────────
sep('TASK 1 — WORKER VALIDATION: refresh_jobs state');
// ─────────────────────────────────────────────────────────────────────────────

try {
  const schema = q('PRAGMA table_info(refresh_jobs)');
  console.log('Schema cols:', schema.map(c=>c.name).join(', '));

  const total = q1('SELECT COUNT(*) n FROM refresh_jobs');
  console.log('Total refresh_jobs:', total.n);

  const byStatus = q('SELECT status, COUNT(*) n FROM refresh_jobs GROUP BY status ORDER BY n DESC');
  console.log('By status:');
  for (const r of byStatus) console.log(`  ${(r.status||'null').padEnd(15)} ${r.n}`);

  const byType = q('SELECT job_type, status, COUNT(*) n FROM refresh_jobs GROUP BY job_type, status ORDER BY job_type, status');
  console.log('By type+status:');
  for (const r of byType) console.log(`  ${(r.job_type||'?').padEnd(20)} ${(r.status||'?').padEnd(12)} ${r.n}`);

  const pending = q('SELECT * FROM refresh_jobs WHERE status=\'pending\' ORDER BY priority ASC, run_after ASC LIMIT 10');
  console.log(`\nOldest pending (${pending.length}):`)
  for (const r of pending) {
    console.log(`  id=${r.id} type=${r.job_type} ch=${String(r.channel_id||'').slice(0,20)} attempts=${r.attempts} created=${r.created_at?.slice(0,16)} locked_by=${r.locked_by||'null'}`);
  }

  const running = q('SELECT * FROM refresh_jobs WHERE status=\'running\' LIMIT 10');
  console.log(`\nRunning jobs (${running.length}):`);
  for (const r of running) {
    console.log(`  id=${r.id} type=${r.job_type} locked_by=${r.locked_by||'?'} locked_at=${r.locked_at?.slice(0,16)}`);
  }

  const done = q1('SELECT COUNT(*) n, MAX(completed_at) newest, MIN(created_at) oldest FROM refresh_jobs WHERE status=\'done\'');
  console.log(`\nDone: ${done.n} jobs, newest_completed=${done.newest?.slice(0,16)}, oldest=${done.oldest?.slice(0,16)}`);

  const failed = q('SELECT job_type, error_message, COUNT(*) n FROM refresh_jobs WHERE status=\'failed\' GROUP BY job_type, error_message ORDER BY n DESC LIMIT 10');
  console.log(`Failed by type+error:`);
  for (const r of failed) console.log(`  ${(r.job_type||'?').padEnd(20)} ${r.n} | ${String(r.error_message||'').slice(0,60)}`);

  // Average attempts for done jobs (proxy for retry rate)
  const avgAttempts = q1('SELECT AVG(attempts) avg, MAX(attempts) mx FROM refresh_jobs WHERE status=\'done\'');
  console.log(`Done job avg_attempts=${avgAttempts?.avg?.toFixed(2)} max_attempts=${avgAttempts?.mx}`);

  // Latency: time from created_at to completed_at for done jobs
  const latency = q1(`
    SELECT AVG(CAST((julianday(completed_at) - julianday(created_at)) * 86400 AS REAL)) avg_sec,
           MAX(CAST((julianday(completed_at) - julianday(created_at)) * 86400 AS REAL)) max_sec
    FROM refresh_jobs WHERE status='done' AND completed_at IS NOT NULL AND created_at IS NOT NULL
  `);
  console.log(`Done job latency: avg=${latency?.avg_sec?.toFixed(1)}s max=${latency?.max_sec?.toFixed(1)}s`);

  // Jobs completed in last 1h, 24h, 7d
  const recent = q(`
    SELECT
      SUM(CASE WHEN completed_at >= datetime('now','-1 hour') THEN 1 ELSE 0 END) last_1h,
      SUM(CASE WHEN completed_at >= datetime('now','-24 hours') THEN 1 ELSE 0 END) last_24h,
      SUM(CASE WHEN completed_at >= datetime('now','-7 days') THEN 1 ELSE 0 END) last_7d
    FROM refresh_jobs WHERE status='done'
  `);
  if (recent[0]) console.log(`Completed: last_1h=${recent[0].last_1h} last_24h=${recent[0].last_24h} last_7d=${recent[0].last_7d}`);

  // Stuck jobs: status=running with locked_at > 30min ago
  const stuck = q(`SELECT * FROM refresh_jobs WHERE status='running' AND locked_at < datetime('now','-30 minutes')`);
  console.log(`Stuck (running >30min): ${stuck.length}`);

} catch(e) { console.log('refresh_jobs error:', e.message); }

// ─────────────────────────────────────────────────────────────────────────────
sep('TASK 2 — WTP CACHE: channel_wtp_cache health');
// ─────────────────────────────────────────────────────────────────────────────

try {
  const wtpCacheTotal = q1('SELECT COUNT(*) n FROM channel_wtp_cache');
  console.log('channel_wtp_cache total:', wtpCacheTotal.n);

  const wtpByStatus = q('SELECT status, COUNT(*) n FROM channel_wtp_cache GROUP BY status ORDER BY n DESC');
  for (const r of wtpByStatus) console.log(`  status=${r.status} n=${r.n}`);

  const wtpExpiry = q1(`
    SELECT
      SUM(CASE WHEN expires_at < datetime('now') THEN 1 ELSE 0 END) expired,
      SUM(CASE WHEN expires_at >= datetime('now') THEN 1 ELSE 0 END) live,
      MIN(expires_at) oldest_expiry,
      MAX(computed_at) newest_computed
    FROM channel_wtp_cache
  `);
  console.log(`WTP cache: expired=${wtpCacheTotal.n} live=${wtpExpiry.live} expired=${wtpExpiry.expired}`);
  console.log(`  newest_computed=${wtpExpiry.newest_computed?.slice(0,16)}`);
  console.log(`  oldest_expiry=${wtpExpiry.oldest_expiry?.slice(0,16)}`);

  const wtpReasons = q('SELECT refresh_reason, COUNT(*) n FROM channel_wtp_cache GROUP BY refresh_reason ORDER BY n DESC');
  console.log('By refresh_reason:');
  for (const r of wtpReasons) console.log(`  ${(r.refresh_reason||'null').padEnd(30)} ${r.n}`);

} catch(e) { console.log('channel_wtp_cache error:', e.message); }

// ─────────────────────────────────────────────────────────────────────────────
sep('TASK 3 — WTP TELEMETRY: event tables');
// ─────────────────────────────────────────────────────────────────────────────

const trackingTables = [
  'wtp_impressions', 'wtp_saves', 'wtp_exports',
  'wtp_brief_generations', 'wtp_video_matches',
  'wtp_outcomes', 'wtp_attribution_candidates',
];

for (const t of trackingTables) {
  try {
    const s = q(`PRAGMA table_info("${t}")`);
    const cnt = q1(`SELECT COUNT(*) n FROM "${t}"`);
    let extra = '';
    try {
      const ts = q1(`SELECT MAX(created_at) newest, MIN(created_at) oldest, COUNT(DISTINCT channel_id) uniq_channels FROM "${t}"`);
      if (ts?.newest) extra = ` | first=${ts.oldest?.slice(0,10)} last=${ts.newest?.slice(0,10)} uniq_ch=${ts.uniq_channels}`;
    } catch (_) {}
    console.log(`${t.padEnd(35)} ${String(cnt.n).padStart(8)}${extra}`);
    console.log(`  cols: ${s.map(c=>c.name).join(', ')}`);
  } catch(e) { console.log(`${t.padEnd(35)} [missing: ${e.message}]`); }
}

// Impression funnel detail
try {
  const impr = q1('SELECT COUNT(*) n, COUNT(DISTINCT channel_id) channels, COUNT(DISTINCT session_id) sessions FROM wtp_impressions');
  console.log(`\nImpression funnel:`);
  console.log(`  impressions=${impr.n} channels=${impr.channels} sessions=${impr.sessions}`);
  const saves  = q1('SELECT COUNT(*) n, COUNT(DISTINCT channel_id) channels FROM wtp_saves');
  console.log(`  saves=${saves.n} channels=${saves.channels}`);
  const briefs = q1('SELECT COUNT(*) n, COUNT(DISTINCT channel_id) channels FROM wtp_brief_generations');
  console.log(`  brief_gens=${briefs.n} channels=${briefs.channels}`);
  const videos = q1('SELECT COUNT(*) n, COUNT(DISTINCT channel_id) channels FROM wtp_video_matches');
  console.log(`  video_matches=${videos.n} channels=${videos.channels}`);
  const outcomes = q1('SELECT COUNT(*) n, COUNT(DISTINCT channel_id) channels FROM wtp_outcomes');
  console.log(`  outcomes=${outcomes.n} channels=${outcomes.channels}`);

  if (saves.n > 0 && impr.n > 0) {
    console.log(`  save_rate=${(saves.n/Math.max(1,impr.n)*100).toFixed(1)}%`);
  }
} catch(e) { console.log('Funnel error:', e.message); }

// Daily event breakdown if we have data
try {
  const daily = q(`SELECT date(created_at) d, COUNT(*) n FROM wtp_impressions GROUP BY date(created_at) ORDER BY d DESC LIMIT 7`);
  if (daily.length) {
    console.log('\nDaily impressions:');
    for (const r of daily) console.log(`  ${r.d} ${r.n}`);
  }
} catch(_) {}

try {
  const bySrc = q(`SELECT source, COUNT(*) n FROM wtp_impressions GROUP BY source ORDER BY n DESC LIMIT 15`);
  if (bySrc.length) {
    console.log('\nImpressions by source:');
    for (const r of bySrc) console.log(`  ${(r.source||'null').padEnd(30)} ${r.n}`);
  }
} catch(_) {}

// ─────────────────────────────────────────────────────────────────────────────
sep('TASK 4 — USER VALUE: saves, outcomes, top ideas');
// ─────────────────────────────────────────────────────────────────────────────

try {
  // Top saved topics
  const topSaved = q('SELECT topic, COUNT(*) n FROM wtp_saves GROUP BY topic ORDER BY n DESC LIMIT 20');
  if (topSaved.length) {
    console.log('Top saved topics:');
    for (const r of topSaved) console.log(`  ${String(r.n).padStart(4)}x  ${r.topic}`);
  } else {
    console.log('wtp_saves: no data');
  }
} catch(e) { console.log('wtp_saves error:', e.message); }

try {
  // Channels with most saves
  const chSaves = q('SELECT channel_id, COUNT(*) n FROM wtp_saves GROUP BY channel_id ORDER BY n DESC LIMIT 10');
  if (chSaves.length) {
    console.log('\nChannels with most saves:');
    for (const r of chSaves) console.log(`  ch=${String(r.channel_id||'').slice(0,24)} saves=${r.n}`);
  }
} catch(e) {}

try {
  const outcomes = q(`SELECT outcome_type, outcome_class, COUNT(*) n FROM wtp_outcomes GROUP BY outcome_type, outcome_class ORDER BY n DESC LIMIT 20`);
  if (outcomes.length) {
    console.log('\nOutcome breakdown:');
    for (const r of outcomes) console.log(`  ${(r.outcome_type||'?').padEnd(20)} ${(r.outcome_class||'?').padEnd(20)} ${r.n}`);
  } else {
    console.log('wtp_outcomes: no data');
  }
} catch(e) { console.log('wtp_outcomes error:', e.message); }

try {
  const attrSchema = q('PRAGMA table_info(wtp_attribution_candidates)');
  console.log('\nwtp_attribution_candidates cols:', attrSchema.map(c=>c.name).join(', '));
  const attrCnt = q1('SELECT COUNT(*) n FROM wtp_attribution_candidates');
  console.log('wtp_attribution_candidates rows:', attrCnt.n);
  if (attrCnt.n > 0) {
    const attrSample = q('SELECT * FROM wtp_attribution_candidates LIMIT 3');
    for (const r of attrSample) console.log(' ', JSON.stringify(r).slice(0,200));
  }
} catch(e) { console.log('wtp_attribution_candidates error:', e.message); }

// ─────────────────────────────────────────────────────────────────────────────
sep('TASK 5 — IDENTITY COVERAGE');
// ─────────────────────────────────────────────────────────────────────────────

try {
  const total     = q1('SELECT COUNT(*) n FROM ingested_channels WHERE ingest_enabled=1');
  const hasIdent  = q1('SELECT COUNT(*) n FROM ingested_channels ic JOIN channel_identity ci ON ci.channel_id=ic.channel_id WHERE ic.ingest_enabled=1');
  const hasPrim   = q1('SELECT COUNT(*) n FROM ingested_channels WHERE ingest_enabled=1 AND primary_niche IS NOT NULL');
  const hasArch   = q1('SELECT COUNT(*) n FROM ingested_channels WHERE ingest_enabled=1 AND content_archetype IS NOT NULL');
  const hasBtag   = q1('SELECT COUNT(*) n FROM ingested_channels WHERE ingest_enabled=1 AND behavior_tags IS NOT NULL AND behavior_tags != \'[]\' AND behavior_tags != \'\'');
  const hasConf   = q1('SELECT COUNT(*) n FROM ingested_channels WHERE ingest_enabled=1 AND identity_confidence >= 0.7');

  console.log(`Total ingested_channels (enabled): ${total.n}`);
  console.log(`Has channel_identity row: ${hasIdent.n} (${(hasIdent.n/total.n*100).toFixed(1)}%)`);
  console.log(`Has primary_niche:        ${hasPrim.n} (${(hasPrim.n/total.n*100).toFixed(1)}%)`);
  console.log(`Has content_archetype:    ${hasArch.n} (${(hasArch.n/total.n*100).toFixed(1)}%)`);
  console.log(`Has behavior_tags:        ${hasBtag.n} (${(hasBtag.n/total.n*100).toFixed(1)}%)`);
  console.log(`High confidence (>=0.7):  ${hasConf.n} (${(hasConf.n/total.n*100).toFixed(1)}%)`);

  // Breakdown by identity_source
  const bySource = q('SELECT identity_source, COUNT(*) n FROM ingested_channels WHERE ingest_enabled=1 GROUP BY identity_source ORDER BY n DESC');
  console.log('\nBy identity_source:');
  for (const r of bySource) console.log(`  ${(r.identity_source||'null').padEnd(30)} ${r.n}`);

  // Missing identity — by ingest date (are newer channels less classified?)
  const byAge = q(`
    SELECT
      CASE
        WHEN created_at >= datetime('now', '-7 days')  THEN 'last_7d'
        WHEN created_at >= datetime('now', '-30 days') THEN 'last_30d'
        WHEN created_at >= datetime('now', '-90 days') THEN 'last_90d'
        ELSE 'older'
      END age_bucket,
      COUNT(*) total,
      SUM(CASE WHEN primary_niche IS NOT NULL THEN 1 ELSE 0 END) classified
    FROM ingested_channels
    WHERE ingest_enabled=1
    GROUP BY age_bucket
    ORDER BY age_bucket
  `);
  console.log('\nClassification by channel age:');
  for (const r of byAge) {
    const pct = r.total > 0 ? (r.classified/r.total*100).toFixed(1) : '0';
    console.log(`  ${r.age_bucket.padEnd(12)} total=${r.total} classified=${r.classified} (${pct}%)`);
  }

  // Top niches by pool size — WTP quality signal
  const nichePool = q(`
    SELECT primary_niche, COUNT(*) n,
           AVG(identity_confidence) avg_conf
    FROM ingested_channels
    WHERE ingest_enabled=1 AND primary_niche IS NOT NULL
    GROUP BY primary_niche
    ORDER BY n DESC LIMIT 20
  `);
  console.log('\nTop niches (WTP peer pool sizes):');
  for (const r of nichePool) {
    console.log(`  ${(r.primary_niche||'?').padEnd(20)} n=${String(r.n).padStart(6)} avg_conf=${r.avg_conf?.toFixed(2)}`);
  }

  // Channels with no identity and >10K subs (high-impact gaps)
  try {
    const highImpactGap = q1(`
      SELECT COUNT(*) n FROM ingested_channels
      WHERE ingest_enabled=1 AND primary_niche IS NULL AND subscriber_count > 10000
    `);
    console.log(`\nHigh-impact missing (no niche, >10K subs): ${highImpactGap.n}`);
  } catch(_) {}

} catch(e) { console.log('identity coverage error:', e.message); }

// ─────────────────────────────────────────────────────────────────────────────
sep('TASK 6 — EMBEDDING BACKLOG');
// ─────────────────────────────────────────────────────────────────────────────

try {
  const ceqSchema = q('PRAGMA table_info(corpus_embeddings_queue)');
  console.log('corpus_embeddings_queue cols:', ceqSchema.map(c=>c.name).join(', '));

  const ceqTotal = q1('SELECT COUNT(*) n FROM corpus_embeddings_queue');
  console.log('Total rows:', ceqTotal.n);

  const ceqByStatus = q('SELECT status, COUNT(*) n FROM corpus_embeddings_queue GROUP BY status ORDER BY n DESC');
  for (const r of ceqByStatus) console.log(`  status=${r.status} n=${r.n}`);

  const ceqByType = q('SELECT entity_type, COUNT(*) n FROM corpus_embeddings_queue GROUP BY entity_type ORDER BY n DESC');
  console.log('By entity_type:');
  for (const r of ceqByType) console.log(`  ${(r.entity_type||'?').padEnd(15)} ${r.n}`);

  // Growth rate: newest and oldest entries
  const ceqAge = q1('SELECT MIN(queued_at) oldest, MAX(queued_at) newest FROM corpus_embeddings_queue');
  console.log(`Age: oldest=${ceqAge.oldest?.slice(0,16)} newest=${ceqAge.newest?.slice(0,16)}`);

  // Check semantic_embeddings for corpus source types
  try {
    const semByType = q(`SELECT source_type, COUNT(*) n FROM semantic_embeddings GROUP BY source_type ORDER BY n DESC`);
    console.log('\nsemantic_embeddings by source_type:');
    for (const r of semByType) console.log(`  ${(r.source_type||'?').padEnd(25)} ${r.n}`);
  } catch(_) {}

  // What percentage of corpus_channels have embeddings?
  try {
    const corpTotal  = q1('SELECT COUNT(*) n FROM corpus_channels');
    const corpEmbed  = q1(`SELECT COUNT(*) n FROM corpus_channels cc
      WHERE EXISTS (SELECT 1 FROM semantic_embeddings se WHERE se.source_type='corpus_dna' AND se.source_id=cc.channel_id)`);
    console.log(`\ncorpus_channels: ${corpTotal.n} total, ${corpEmbed?.n||0} with corpus_dna embeddings`);
  } catch(_) {}

} catch(e) { console.log('embedding backlog error:', e.message); }

// ─────────────────────────────────────────────────────────────────────────────
sep('TASK 7 — PIPELINE RUNTIME: table sizes and job schedules');
// ─────────────────────────────────────────────────────────────────────────────

// Key pipeline table sizes (proxy for pipeline scope)
const pipelineTables = [
  ['ingested_videos',          'S01 ingest'],
  ['ingested_channels',        'S01 channels'],
  ['video_growth_snapshots',   'S02 snapshots'],
  ['channel_topics',           'S03 topics'],
  ['topic_signal_stats',       'S04 topic signals'],
  ['phrase_niche_pmi',         'S05 PMI'],
  ['niche_benchmarks',         'S06 benchmarks'],
  ['hook_type_performance',    'S17 hooks'],
  ['semantic_embeddings',      'S16 embeddings'],
  ['semantic_clusters',        'S16 clusters'],
  ['channel_identity',         'S19 identity'],
  ['creator_idea_dna',         'S19 idea DNA'],
  ['channel_wtp_cache',        'S21 WTP cache'],
  ['channel_evolution_summary','S19 evolution'],
  ['narrative_lifecycle',      'S18 narrative'],
  ['creator_topic_lifecycle',  'S19 topic lifecycle'],
  ['corpus_channels',          'corpus'],
  ['corpus_videos',            'corpus videos'],
  ['corpus_embeddings_queue',  'corpus embed queue'],
];

console.log('Table sizes (pipeline scope):');
for (const [t, label] of pipelineTables) {
  try {
    const cnt = q1(`SELECT COUNT(*) n FROM "${t}"`);
    let newestStr = '';
    try {
      const ts = q1(`SELECT MAX(updated_at) m FROM "${t}"`);
      if (ts?.m) newestStr = ` newest=${ts.m?.slice(0,10)}`;
      else {
        const ts2 = q1(`SELECT MAX(created_at) m FROM "${t}"`);
        if (ts2?.m) newestStr = ` newest=${ts2.m?.slice(0,10)}`;
      }
    } catch(_) {}
    console.log(`  ${t.padEnd(35)} ${String(cnt.n).padStart(10)}  ${label}${newestStr}`);
  } catch(e) {
    console.log(`  ${t.padEnd(35)} [missing]  ${label}`);
  }
}

// hook_type_performance breakdown — is it actually populated?
try {
  const hookTotal = q1('SELECT COUNT(*) n, COUNT(DISTINCT niche) niches FROM hook_type_performance');
  const hookSample = q('SELECT niche, hook_type, sample_count, hook_score FROM hook_type_performance ORDER BY hook_score DESC LIMIT 5');
  console.log(`\nhook_type_performance: ${hookTotal.n} rows, ${hookTotal.niches} niches`);
  for (const r of hookSample) {
    console.log(`  ${(r.niche||'?').padEnd(20)} ${(r.hook_type||'?').padEnd(20)} samples=${r.sample_count} score=${r.hook_score?.toFixed(1)}`);
  }
} catch(e) { console.log('hook_type_performance error:', e.message); }

// creator_idea_dna
try {
  const dna = q1('SELECT COUNT(*) n, COUNT(DISTINCT channel_id) channels FROM creator_idea_dna');
  console.log(`\ncreator_idea_dna: ${dna.n} rows, ${dna.channels} channels`);
} catch(e) {}

// narrative_lifecycle
try {
  const narr = q1('SELECT COUNT(*) n, COUNT(DISTINCT niche) niches FROM narrative_lifecycle');
  console.log(`narrative_lifecycle: ${narr.n} rows, ${narr.niches} niches`);
} catch(e) {}

// channel_territory_profiles
try {
  const terr = q1('SELECT COUNT(*) n FROM channel_territory_profiles');
  console.log(`channel_territory_profiles: ${terr.n} rows`);
} catch(e) {}

// ─────────────────────────────────────────────────────────────────────────────
sep('BONUS — KEY PIPELINE HEALTH INDICATORS');
// ─────────────────────────────────────────────────────────────────────────────

try {
  // Video ingest freshness
  const videoFresh = q1('SELECT MAX(published_at) newest, COUNT(*) n FROM ingested_videos WHERE published_at >= datetime(\'now\',\'-7 days\')');
  console.log(`Recent videos (7d): ${videoFresh.n} rows, newest_pub=${videoFresh.newest?.slice(0,10)}`);

  // Snapshot freshness
  const snapFresh = q1('SELECT MAX(snapshotted_at) newest FROM video_growth_snapshots');
  console.log(`Latest snapshot: ${snapFresh.newest?.slice(0,16)}`);

  // PMI freshness
  const pmiFresh = q1('SELECT COUNT(*) n, MAX(updated_at) newest FROM phrase_niche_pmi');
  console.log(`phrase_niche_pmi: ${pmiFresh.n} rows, newest=${pmiFresh.newest?.slice(0,10)}`);

  // classification_repair_candidates
  const crc = q('SELECT status, COUNT(*) n FROM classification_repair_candidates GROUP BY status ORDER BY n DESC');
  console.log('\nclassification_repair_candidates by status:');
  for (const r of crc) console.log(`  ${(r.status||'null').padEnd(25)} ${r.n}`);

  // reclassification_log
  const rclog = q1('SELECT COUNT(*) n, MAX(reclassified_at) newest FROM reclassification_log');
  console.log(`reclassification_log: ${rclog.n} rows, newest=${rclog.newest?.slice(0,16)}`);

  // google_trends_signals
  const trends = q1('SELECT COUNT(*) n, MAX(fetched_at) newest FROM google_trends_signals');
  console.log(`google_trends_signals: ${trends.n} rows, newest=${trends.newest?.slice(0,16)}`);

  // topic_signal_stats
  const tss = q1('SELECT COUNT(*) n, MAX(updated_at) newest FROM topic_signal_stats');
  console.log(`topic_signal_stats: ${tss.n} rows, newest=${tss.newest?.slice(0,10)}`);

} catch(e) { console.log('health indicators error:', e.message); }

db.close();
console.log('\n[DONE]');

'use strict';

const path = require('path');
const DB = require('../node_modules/better-sqlite3');

const db = new DB(path.join(__dirname, '../data/scoring.db'), {
  readonly: true,
  timeout: 60000,
});

function one(sql) {
  return db.prepare(sql).get();
}

function all(sql) {
  return db.prepare(sql).all();
}

const summary = {
  corpus_channels: one('SELECT COUNT(*) n FROM corpus_channels').n,
  ingested_enabled: one('SELECT COUNT(*) n FROM ingested_channels WHERE ingest_enabled=1').n,
  corpus_not_ingested: one(`
    SELECT COUNT(*) n FROM corpus_channels cc
    WHERE NOT EXISTS (SELECT 1 FROM ingested_channels ic WHERE ic.channel_id=cc.channel_id)
  `).n,
  light_ingest_backlog: one(`
    SELECT COUNT(*) n FROM corpus_channels
    WHERE ingest_depth < 1
      AND is_spam = 0
      AND (discovery_source IS NULL OR discovery_source != 'ingested_channels_sync')
  `).n,
  graph_light_ingest_backlog: one(`
    SELECT COUNT(*) n FROM corpus_channels
    WHERE ingest_depth < 1
      AND is_spam = 0
      AND discovery_source IN ('description_channel_id','description_handle_link','title_collab_handle')
  `).n,
  pending_graph_handles: one(`
    SELECT COUNT(*) n FROM creator_discovery_candidates
    WHERE status = 'pending' AND candidate_type='handle'
  `).n,
};

const scoreBands = all(`
  SELECT
    CASE
      WHEN score >= 200 THEN '200+'
      WHEN score >= 150 THEN '150-199'
      WHEN score >= 100 THEN '100-149'
      WHEN score >= 60 THEN '60-99'
      WHEN score >= 40 THEN '40-59'
      ELSE '<40'
    END AS band,
    COUNT(*) AS n,
    ROUND(AVG(distinct_source_channels), 1) AS avg_sources,
    SUM(CASE WHEN title_collab_count > 0 THEN 1 ELSE 0 END) AS title_collab
  FROM creator_discovery_candidates
  WHERE status = 'pending' AND candidate_type='handle'
  GROUP BY band
  ORDER BY MIN(score) DESC
`);

const recentGraphAdmissions = all(`
  SELECT date(admitted_at) AS day, COUNT(*) AS n
  FROM creator_discovery_candidates
  WHERE admitted_at IS NOT NULL
  GROUP BY day
  ORDER BY day DESC
  LIMIT 7
`);

const lightBacklogBySource = all(`
  SELECT discovery_source, COUNT(*) AS n,
         ROUND(AVG(COALESCE(subscriber_count,0))) AS avg_subs
  FROM corpus_channels
  WHERE ingest_depth < 1
    AND is_spam = 0
    AND (discovery_source IS NULL OR discovery_source != 'ingested_channels_sync')
  GROUP BY discovery_source
  ORDER BY n DESC
  LIMIT 20
`);

const topPending = all(`
  SELECT candidate_key, score, distinct_source_channels, title_collab_count, recent_mention_count
  FROM creator_discovery_candidates
  WHERE status='pending' AND candidate_type='handle'
  ORDER BY score DESC
  LIMIT 30
`);

console.log(JSON.stringify({
  summary,
  score_bands: scoreBands,
  recent_graph_admissions: recentGraphAdmissions,
  light_backlog_by_source: lightBacklogBySource,
  top_pending_handles: topPending,
}, null, 2));

db.close();

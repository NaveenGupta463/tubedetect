'use strict';

// "Coming to India" — topics with strong FOREIGN (US/UK/…) coverage but little/no domestic (IN)
// coverage yet: trending abroad, not here yet = a head-start signal for Indian creators. This is
// the payoff of the seeded foreign channels. Heavy corpus query (~100s), so it's precomputed here
// (daily, pipeline) into `coming_to_india` and served fast by the /trends/coming-to-india endpoint.

const { getDb } = require('../db/init');
const { classifyTopicNiche } = require('./trendSignalJob');

const FR = "('US','GB','AU','CA','NZ','UK')";
// Niches whose foreign trends genuinely transfer to Indian creators (skill/knowledge/how-to +
// universal lifestyle). Region-locked spaces (sports/news/politics/entertainment/music/comedy) are
// excluded — "US politics" or an American sitcom trend isn't a head-start for an Indian creator.
const TRANSFERABLE = new Set(['technology', 'finance', 'education', 'business', 'science', 'health', 'fitness', 'food', 'lifestyle', 'gaming']);

async function runComingToIndiaJob() {
  const db = getDb();
  const start = Date.now();
  const runStart = db.get("SELECT datetime('now') AS t").t;
  console.log('[comingToIndia] Computing foreign-led topics...');

  db.exec(`CREATE TABLE IF NOT EXISTS coming_to_india (
    topic TEXT PRIMARY KEY, niche TEXT, foreign_ch INTEGER, domestic_ch INTEGER,
    foreign_views_30d INTEGER, lead_days INTEGER, sample_title TEXT, computed_at TEXT
  )`);

  const rows = db.all(`
    SELECT ct.topic,
      COUNT(DISTINCT CASE WHEN UPPER(COALESCE(ic.region,'IN')) IN ${FR}     THEN ct.channel_id END) AS foreign_ch,
      COUNT(DISTINCT CASE WHEN UPPER(COALESCE(ic.region,'IN')) NOT IN ${FR} THEN ct.channel_id END) AS domestic_ch,
      CAST(SUM(CASE WHEN UPPER(COALESCE(ic.region,'IN')) IN ${FR} AND iv.published_at > datetime('now','-30 days') THEN iv.views ELSE 0 END) AS INTEGER) AS foreign_views_30d,
      julianday(MIN(CASE WHEN UPPER(COALESCE(ic.region,'IN')) NOT IN ${FR} THEN iv.published_at END))
        - julianday(MIN(CASE WHEN UPPER(COALESCE(ic.region,'IN')) IN ${FR} THEN iv.published_at END)) AS lead_days
    FROM (SELECT DISTINCT topic, channel_id FROM channel_topics) ct
    JOIN ingested_channels ic ON ic.channel_id = ct.channel_id
    JOIN ingested_videos   iv ON iv.channel_id = ct.channel_id AND iv.published_at > datetime('now','-60 days') AND iv.views > 0
    GROUP BY ct.topic
    HAVING foreign_ch >= 5 AND domestic_ch <= 3
  `);
  console.log(`[comingToIndia] ${rows.length} foreign-led candidates (foreign>=5, domestic<=3)`);

  // Keep transferable niches; attach the top foreign video title as evidence.
  const kept = rows.map(r => ({ ...r, niche: classifyTopicNiche(r.topic) }))
    .filter(r => TRANSFERABLE.has(r.niche))
    .sort((a, b) => b.foreign_ch - a.foreign_ch || b.foreign_views_30d - a.foreign_views_30d)
    .slice(0, 120);

  const ins = `INSERT OR REPLACE INTO coming_to_india (topic, niche, foreign_ch, domestic_ch, foreign_views_30d, lead_days, sample_title, computed_at) VALUES (?,?,?,?,?,?,?, datetime('now'))`;
  const tx = db.transaction(() => {
    for (const r of kept) {
      const s = db.get(
        `SELECT iv.title FROM (SELECT DISTINCT channel_id FROM channel_topics WHERE topic=?) ct
         JOIN ingested_channels ic ON ic.channel_id=ct.channel_id AND UPPER(COALESCE(ic.region,'IN')) IN ${FR}
         JOIN ingested_videos iv ON iv.channel_id=ct.channel_id AND iv.published_at > datetime('now','-60 days')
         ORDER BY iv.views DESC LIMIT 1`, [r.topic]);
      db.run(ins, [r.topic, r.niche, r.foreign_ch, r.domestic_ch, r.foreign_views_30d, r.lead_days != null ? Math.round(r.lead_days) : null, s?.title || null]);
    }
  });
  tx();
  db.run(`DELETE FROM coming_to_india WHERE computed_at < ?`, [runStart]);

  const secs = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`[comingToIndia] Wrote ${kept.length} topics in ${secs}s`);
  return { topics: kept.length, duration_s: parseFloat(secs) };
}

module.exports = { runComingToIndiaJob };

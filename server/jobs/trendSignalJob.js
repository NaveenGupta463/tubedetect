'use strict';

const { getDb } = require('../db/init');

const NOISE_SUFFIXES = [
  ' videos', ' vlogs', ' vlog', ' vlogging', ' content',
  ' channels', ' channel', ' clips', ' streams', ' stream',
];

function canonicalise(topic) {
  if (!topic) return '';
  let t = topic.toLowerCase().trim();
  for (const s of NOISE_SUFFIXES) {
    if (t.endsWith(s)) { t = t.slice(0, -s.length).trim(); break; }
  }
  return t || topic.toLowerCase().trim();
}

// ── Topic-content niche classifier ──────────────────────────────────────────
// Rules checked in order — first match wins.
// This replaces channel-niche grouping so each topic gets ONE semantic bucket
// regardless of which channels cover it.
const NICHE_RULES = [
  ['sports',       ['cricket', 'ipl', 'football', 'kabaddi', 'badminton', 'hockey', 'sports highlight', 'sports news', 'match preview', 'match review', 'player performance', 'player interaction', 'sports update', 'player profile']],
  ['news',         ['breaking news', 'regional news', 'local news', 'weather', 'crime report', 'crime news', 'local incident', 'community event', 'government decision', 'natural disaster', 'accident', 'local crime', 'public safety', 'live news', 'live coverage', 'live update', 'regional event', 'news update', 'news coverage', 'flood', 'cyclone', 'earthquake', 'monsoon', 'fire incident', 'road accident', 'train accident', 'village news', 'district news', 'state news']],
  ['politics',     ['politics', 'political', 'politician', 'election', 'parliament', 'governance', 'lok sabha', 'rajya sabha', 'protest', 'india-pakistan', 'minister', 'bjp', 'congress', 'government scam', 'local governance', 'government policy', 'foreign policy', 'national security', 'diplomatic', 'diplomacy', 'geopolitics', 'geopolitical', 'middle east', 'conflict', 'international relations', 'world war', 'civil war', 'war news', 'military operation', 'bilateral', 'us-iran', 'iran', 'israel', 'gaza', 'ukraine', 'russia', 'sanction', 'united nations', 'legal case', 'court case', 'high court', 'supreme court', 'judiciary', 'court verdict']],
  ['comedy',       ['comedy skit', 'comedy clip', 'comedy scene', 'comedy sketch', 'stand-up', 'prank', 'funny', 'meme', 'parody', 'roast', 'joke']],
  ['entertainment',['bollywood', 'celebrity', 'movie trailer', 'movie review', 'film review', 'actor', 'actress', 'web series', 'ott', 'gossip', 'reality show', 'award show', 'reaction', 'cinema', 'tollywood', 'kollywood', 'marathi television', 'devotional', 'bhajan', 'family and social', 'celebrity', 'celebrities', 'celebrity interview', 'celebrity gossip', 'drama series', 'drama show', 'tv serial', 'web show', 'short film', 'film industry', 'entertainment news', 'rich poor', 'poor rich', 'rich vs poor', 'poor vs rich', 'relatable skit', 'situation comedy']],
  ['music',        ['music', 'song', 'bhojpuri', 'punjabi', 'hindi song', 'singer', 'folk song', 'rap', 'album', 'dance video', 'music video', 'devotional song', 'music review']],
  ['gaming',       ['gaming', 'gameplay', 'esport', 'bgmi', 'freefire', 'pubg', 'minecraft', 'live stream', 'game review', 'game update', 'game tips']],
  ['food',         ['recipe', 'street food', 'restaurant review', 'food tour', 'cooking', 'cuisine', 'kitchen', 'snack', 'food review', 'food vlog', 'food challenge', 'taste test']],
  ['travel',       ['travel vlog', 'travel guide', 'tour guide', 'trip', 'destination', 'hidden gem', 'explore', 'travel tips', 'road trip', 'travel diary', 'travel series']],
  ['technology',   ['technology', 'tech review', 'software', 'smartphone', 'gadget', 'artificial intelligence', 'ai tool', 'coding', 'computer', 'app review', 'tech tips', 'tech news', 'unboxing', 'electric vehicle', 'ev review', 'laptop review', 'camera review', 'drone review', 'wearable', 'smart home', 'cybersecurity', 'programming', 'tech comparison', 'meta glasses', 'smart glasses', 'smartglasses', 'ai glasses', 'ar glasses', 'ray-ban meta', 'vr headset', 'vision pro', 'smartwatch', 'smart watch', 'earbuds', 'foldable phone', 'chatgpt', 'chatbot']],
  ['finance',      ['mutual fund', 'stock market', 'stock', 'investing', 'trading', 'nifty', 'sensex', 'financial planning', 'insurance', 'loan', 'tax planning', 'economic update', 'economy', 'budget', 'cryptocurrency', 'crypto', 'personal finance', 'wealth', 'money management', 'financial advice', 'market analysis', 'economic analysis']],
  ['education',    ['education', 'study tips', 'exam preparation', 'upsc', 'school', 'college', 'histor', 'geography', 'quran', 'religious teaching', 'science experiment', 'current affairs', 'learning', 'tutorial', 'how to', 'explainer', 'educational', 'knowledge', 'facts about', 'aptitude', 'quantitative', 'reasoning', 'olympiad', 'general knowledge', 'competitive exam', 'ncert', 'history', 'historical']],
  ['business',     ['business', 'startup', 'entrepreneur', 'manufacturing', 'brand building', 'marketing strategy', 'e-commerce', 'franchise', 'business idea', 'small scale', 'business strategy', 'business case', 'business growth', 'small business', 'business tips', 'business model', 'business news']],
  ['fitness',      ['fitness', 'workout', 'gym', 'yoga', 'exercise', 'weight loss', 'cardio', 'muscle', 'bodybuilding', 'home workout', 'fitness tips', 'weight training']],
  ['health',       ['health', 'medical', 'doctor', 'diet', 'wellness', 'ayurveda', 'ayurvedic', 'disease', 'treatment', 'mental health', 'healthcare', 'medicine', 'nutrition', 'symptoms', 'cure', 'remedy']],
  ['lifestyle',    ['lifestyle', 'fashion', 'beauty', 'skincare', 'hair care', 'makeup', 'self improvement', 'motivation', 'productivity', 'personal development', 'relationship', 'wedding', 'daily life', 'daily routine', 'vlog', 'morning routine', 'night routine', 'room tour', 'day in life', 'minimalism', 'self help']],
  ['science',      ['science', 'physics', 'chemistry', 'biology', 'astronomy', 'space', 'research', 'scientific', 'discovery', 'experiment']],
  ['philosophy',   ['philosophy', 'spiritual', 'meditation', 'mindfulness', 'consciousness', 'religion', 'stoic', 'wisdom', 'life lessons', 'astrology', 'horoscope', 'zodiac', 'numerology', 'tarot']],
];

// Match keywords on WORD BOUNDARIES (+ optional plural), not raw substring — otherwise short
// keywords false-positive: 'war' matched "warsi" (Arshad Warsi → politics!), 'rap'→"therapy",
// 'ott'→"bottle". Prefix-style keywords ("politics"/"historical") are listed as explicit whole
// words in NICHE_RULES so \b matching still catches them. Regexes are compiled once per niche.
function _escRe(s) { return s.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&'); }
const _NICHE_RULES_RE = NICHE_RULES.map(([niche, kws]) => [niche, new RegExp('\\b(' + kws.map(_escRe).join('|') + ')s?\\b', 'i')]);
function classifyTopicNiche(topic) {
  const t = String(topic || '').toLowerCase();
  for (const [niche, re] of _NICHE_RULES_RE) if (re.test(t)) return niche;
  return 'other';
}

// Topics where foreign lead signal doesn't apply
const FOREIGN_EXCLUDED_TOPICS = new Set([
  'cricket', 'ipl', 'bollywood', 'kabaddi', 'indian politics',
  'state elections', 'lok sabha', 'assembly elections',
]);

// Foreign country codes in ingested_channels.region
const FOREIGN_REGIONS = new Set(['US', 'GB', 'AU', 'CA', 'NZ', 'UK']);

function vphDirection(viewsNow, viewsPrior) {
  if (!viewsNow || !viewsPrior || viewsPrior <= 0) return 'stable';
  const ratio = viewsNow / viewsPrior;
  if (ratio >= 1.15) return 'rising';
  if (ratio <= 0.85) return 'falling';
  return 'stable';
}

function scoreSignals(row) {
  let score = 0;
  const bd = {};

  const chNow   = row.channel_count_30d       || 0;
  const chPrior = row.channel_count_prior_30d || 0;

  // Signal 1 — view outperformance ratio
  const ratio  = row.avg_outperformance_ratio || 0;
  const pctOut = row.pct_videos_outperforming  || 0;
  let s1 = 0;
  if (ratio > 1.5) s1 += 25;
  if (ratio > 2.0 && chNow >= 8)  s1 += 15;
  if (pctOut > 60  && chNow >= 8)  s1 += 15;
  score += s1;
  bd.outperformance = {
    ratio:       Math.round(ratio * 100) / 100,
    pct_beating: Math.round(pctOut),
    pts:         s1,
  };

  // Signal 2 — creator adoption velocity
  const accel = chPrior > 0 ? (chNow - chPrior) / chPrior : 0;
  let s2 = 0;
  if (chNow >= 8)  s2 += 10;
  if (chNow >= 15) s2 += 10;
  if (accel > 0.5 && chNow >= 8) s2 += 15;
  score += s2;
  bd.adoption = {
    channels_now:   chNow,
    channels_prior: chPrior,
    acceleration:   Math.round(accel * 100) / 100,
    pts:            s2,
  };

  // Signal 3 — VPH trajectory
  const dir = row.vph_direction || 'stable';
  let s3 = 0;
  if (dir === 'rising')  s3 += 10;
  if (dir === 'falling') s3 -= 20;
  score += s3;
  bd.trajectory = {
    vpd_now:   Math.round(row.avg_vph_30d    || 0),
    vpd_prior: Math.round(row.avg_vph_prior_30d || 0),
    direction: dir,
    pts:       s3,
  };

  // Signal 4 — foreign lead: topic covered abroad meaningfully BEFORE domestic + real foreign
  // footprint = "trending abroad → coming to India". Graded by lead length.
  const leadDays = row.foreign_lead_days || 0;
  const fCh = row.foreign_channel_count_30d || 0;
  let s4 = 0;
  if (fCh >= 3) {
    if (leadDays >= 45)      s4 += 20;
    else if (leadDays >= 21) s4 += 12;
    else if (leadDays >= 7)  s4 += 6;
  }
  score += s4;
  bd.foreign = {
    lead_days:        leadDays,
    foreign_channels: row.foreign_channel_count_30d || 0,
    pts:              s4,
  };

  // Tier
  let tier;
  const s = Math.max(0, Math.min(100, score));
  if      (s >= 80 && chNow >= 8) tier = 'rising';
  else if (s >= 55)               tier = 'emerging';
  else if (s >= 35)               tier = 'stable';
  else if (dir === 'falling')     tier = 'peaking';
  else                            tier = 'noise';

  return { signal_score: s, signal_tier: tier, score_breakdown: JSON.stringify(bd) };
}

async function runTrendSignalJob() {
  const db    = getDb();
  const start = Date.now();
  const runStart = db.get("SELECT datetime('now') AS t").t; // prune marker (see end of job)
  console.log('[trendSignal] Starting trend signal computation...');

  // ── Signal 1 + 2: outperformance & adoption ──────────────────────────────────
  // Groups by topic only (not channel niche) so each topic gets one consolidated row.
  // DISTINCT on channel_topics prevents duplicate rows when a channel has multiple
  // niche entries for the same topic.
  const topicStats = db.all(`
    WITH baselines AS (
      SELECT channel_id, AVG(views) AS avg_views
      FROM (
        SELECT channel_id, views,
          ROW_NUMBER() OVER (PARTITION BY channel_id ORDER BY published_at DESC) AS rn
        FROM ingested_videos
        WHERE published_at > datetime('now','-90 days') AND views > 0
      ) t WHERE rn <= 20
      GROUP BY channel_id HAVING avg_views > 0
    ),
    vids_now AS (
      SELECT ct.topic, iv.channel_id,
        CAST(iv.views AS REAL) AS views
      FROM (SELECT DISTINCT topic, channel_id FROM channel_topics) ct
      JOIN ingested_videos iv ON iv.channel_id = ct.channel_id
      LEFT JOIN ingested_channels ic ON ic.channel_id = iv.channel_id
      WHERE iv.published_at > datetime('now','-30 days')
        AND iv.views > 0
        AND UPPER(COALESCE(ic.region,'IN')) NOT IN ('US','GB','AU','CA','NZ','UK')
    ),
    vids_prior AS (
      SELECT DISTINCT ct.topic, iv.channel_id
      FROM (SELECT DISTINCT topic, channel_id FROM channel_topics) ct
      JOIN ingested_videos iv ON iv.channel_id = ct.channel_id
      LEFT JOIN ingested_channels ic ON ic.channel_id = iv.channel_id
      WHERE iv.published_at BETWEEN datetime('now','-60 days') AND datetime('now','-30 days')
        AND UPPER(COALESCE(ic.region,'IN')) NOT IN ('US','GB','AU','CA','NZ','UK')
    )
    SELECT
      vn.topic,
      COUNT(*)                                                          AS video_count_30d,
      COUNT(DISTINCT vn.channel_id)                                     AS channel_count_30d,
      ROUND(AVG(CASE WHEN b.avg_views > 0 THEN vn.views / b.avg_views ELSE NULL END), 3)
                                                                        AS avg_outperformance_ratio,
      ROUND(100.0 * SUM(CASE WHEN b.avg_views > 0 AND vn.views > b.avg_views THEN 1 ELSE 0 END)
            / MAX(1, COUNT(*)), 1)                                      AS pct_videos_outperforming,
      COUNT(DISTINCT vp.channel_id)                                     AS channel_count_prior_30d
    FROM vids_now vn
    LEFT JOIN baselines   b  ON b.channel_id  = vn.channel_id
    LEFT JOIN vids_prior  vp ON vp.topic = vn.topic
                             AND vp.channel_id = vn.channel_id
    GROUP BY vn.topic
    HAVING channel_count_30d >= 5 AND video_count_30d >= 5
  `);
  console.log(`[trendSignal] Signal 1+2 done — ${topicStats.length} topics`);

  // ── Signal 3: REAL velocity trajectory from growth snapshots ──────────────────
  // Was a crude views/age proxy. Now uses actual views_per_hour from the 7d-age snapshot bucket,
  // compared apples-to-apples: recently-published videos (≤21d) vs older ones (30-60d) — both
  // measured at the SAME 7-day age, so it's genuine acceleration (are the topic's newer videos
  // gaining velocity faster than its older ones?) rather than a raw-views proxy. This is the payoff
  // of the growth-snapshot corpus.
  const vpdRows = db.all(`
    SELECT ct.topic,
      AVG(CASE WHEN iv.published_at > datetime('now','-21 days') THEN s.views_per_hour END) AS vpd_now,
      AVG(CASE WHEN iv.published_at BETWEEN datetime('now','-60 days') AND datetime('now','-30 days') THEN s.views_per_hour END) AS vpd_prior
    FROM (SELECT DISTINCT topic, channel_id FROM channel_topics) ct
    JOIN ingested_videos iv          ON iv.channel_id = ct.channel_id
    JOIN video_growth_snapshots s    ON s.video_id = iv.youtube_video_id AND s.bucket = '7d' AND s.views_per_hour IS NOT NULL
    WHERE iv.published_at > datetime('now','-60 days')
    GROUP BY ct.topic
    HAVING vpd_now IS NOT NULL AND vpd_prior IS NOT NULL
  `);
  const vpdMap = new Map();
  for (const r of vpdRows) vpdMap.set(r.topic, r);
  console.log(`[trendSignal] Signal 3 done — ${vpdRows.length} topics`);

  // ── Signal 4: foreign channel count per topic ─────────────────────────────────
  const foreignRows = db.all(`
    SELECT ct.topic, COUNT(DISTINCT ct.channel_id) AS foreign_count
    FROM (SELECT DISTINCT topic, channel_id FROM channel_topics) ct
    JOIN ingested_channels ic ON ic.channel_id = ct.channel_id
    JOIN ingested_videos iv   ON iv.channel_id = ct.channel_id
    WHERE UPPER(COALESCE(ic.region,'')) IN ('US','GB','AU','CA','NZ','UK')
      AND iv.published_at > datetime('now','-30 days')
    GROUP BY ct.topic
  `);
  const foreignMap = new Map();
  for (const r of foreignRows) foreignMap.set(r.topic, r.foreign_count);
  console.log(`[trendSignal] Signal 4 done — ${foreignRows.length} topics with foreign channels`);

  // ── Signal 4b: foreign LEAD (the payoff of seeding US/UK channels) ─────────────
  // Per topic, how many days EARLIER did foreign (US/UK/…) channels start covering it vs domestic
  // channels? A positive lead means "trending abroad first → likely coming to India" — a genuine
  // predictive signal. Uses first-seen dates over a 120d window; single-video noise is guarded by
  // requiring ≥3 foreign channels (in scoreSignals).
  const FR = "('US','GB','AU','CA','NZ','UK')";
  const foreignLeadRows = db.all(`
    SELECT ct.topic,
      julianday(MIN(CASE WHEN UPPER(COALESCE(ic.region,'IN')) NOT IN ${FR} THEN iv.published_at END))
        - julianday(MIN(CASE WHEN UPPER(COALESCE(ic.region,'IN')) IN ${FR}     THEN iv.published_at END))
        AS lead_days
    FROM (SELECT DISTINCT topic, channel_id FROM channel_topics) ct
    JOIN ingested_channels ic ON ic.channel_id = ct.channel_id
    JOIN ingested_videos   iv ON iv.channel_id = ct.channel_id
    WHERE iv.published_at > datetime('now','-120 days') AND iv.views > 0
    GROUP BY ct.topic
    HAVING lead_days IS NOT NULL
  `);
  const foreignLeadMap = new Map();
  for (const r of foreignLeadRows) foreignLeadMap.set(r.topic, Math.round(r.lead_days));
  console.log(`[trendSignal] Signal 4b done — ${foreignLeadMap.size} topics with foreign+domestic timing`);

  // ── Dominant region per topic ─────────────────────────────────────────────────
  // The region column was hard-coded 'IN', but the scored corpus is "all non-Western" — so MENA /
  // South-Asian topics (e.g. "arabic drama series" is really Egypt/UAE) were mislabeled as India.
  // Store the actual dominant region (most covering channels, last 30d) so the UI can show "rising
  // in EG" instead of a misleading "IN".
  const regionRows = db.all(`
    SELECT topic, region FROM (
      SELECT ct.topic, UPPER(COALESCE(ic.region,'IN')) AS region,
        ROW_NUMBER() OVER (PARTITION BY ct.topic ORDER BY COUNT(DISTINCT ct.channel_id) DESC) AS rn
      FROM (SELECT DISTINCT topic, channel_id FROM channel_topics) ct
      JOIN ingested_channels ic ON ic.channel_id = ct.channel_id
      JOIN ingested_videos   iv ON iv.channel_id = ct.channel_id AND iv.published_at > datetime('now','-30 days')
      GROUP BY ct.topic, region
    ) WHERE rn = 1
  `);
  const regionMap = new Map();
  for (const r of regionRows) regionMap.set(r.topic, r.region);
  console.log(`[trendSignal] Dominant-region done — ${regionMap.size} topics`);

  // ── Score + write ────────────────────────────────────────────────────────────
  const insertSql = `
    INSERT OR REPLACE INTO topic_signal_stats
      (topic, niche, region,
       video_count_30d, channel_count_30d, channel_count_prior_30d,
       avg_outperformance_ratio, pct_videos_outperforming,
       avg_vph_30d, avg_vph_prior_30d, vph_direction,
       foreign_channel_count_30d, foreign_lead_days,
       signal_score, signal_tier, score_breakdown, computed_at)
    VALUES (?,?,?, ?,?,?, ?,?, ?,?,?, ?,?, ?,?,?, datetime('now'))
  `;

  const BATCH = 200;
  let written = 0;

  for (let i = 0; i < topicStats.length; i += BATCH) {
    const batch = topicStats.slice(i, i + BATCH);
    const tx = db.transaction(() => {
      for (const row of batch) {
        const vpd  = vpdMap.get(row.topic) || {};
        const dir  = vphDirection(vpd.vpd_now, vpd.vpd_prior);
        const niche = classifyTopicNiche(row.topic);

        const canonTopic = canonicalise(row.topic);
        const _foreignExcluded = FOREIGN_EXCLUDED_TOPICS.has(canonTopic);
        const foreignCount = _foreignExcluded ? null : (foreignMap.get(row.topic) || 0);
        const leadDays     = _foreignExcluded ? null : (foreignLeadMap.get(row.topic) ?? null);

        const enriched = {
          ...row,
          avg_vph_30d:               vpd.vpd_now   || null,
          avg_vph_prior_30d:         vpd.vpd_prior || null,
          vph_direction:             dir,
          foreign_channel_count_30d: foreignCount,
          foreign_lead_days:         leadDays,
        };

        const scored = scoreSignals(enriched);

        db.run(insertSql, [
          row.topic, niche, regionMap.get(row.topic) || 'IN',
          row.video_count_30d, row.channel_count_30d, row.channel_count_prior_30d,
          row.avg_outperformance_ratio, row.pct_videos_outperforming,
          enriched.avg_vph_30d, enriched.avg_vph_prior_30d, dir,
          foreignCount, leadDays,
          scored.signal_score, scored.signal_tier, scored.score_breakdown,
        ]);
        written++;
      }
    });
    tx();
  }

  // ── Prune STALE rows ─────────────────────────────────────────────────────────
  // INSERT OR REPLACE only refreshes topics in THIS run's set; topics that dropped out of the
  // window keep their old row (stale niche/score/tier) forever and pollute the rankings (e.g. a
  // weeks-old "rising" flag on a topic that's since faded). Delete anything not rewritten this run.
  const pruned = db.run(`DELETE FROM topic_signal_stats WHERE computed_at < ?`, [runStart]);
  console.log(`[trendSignal] Pruned ${pruned.changes ?? '?'} stale rows (not refreshed this run)`);

  // ── Log new rising/emerging topics for outcome tracking ──────────────────────
  const trackedKeys = new Set(
    db.all("SELECT topic || '||' || niche AS key FROM trend_signal_outcomes WHERE evaluated_at IS NULL")
      .map(r => r.key)
  );
  const toLog = db.all(
    "SELECT topic, niche, signal_tier, signal_score, score_breakdown FROM topic_signal_stats WHERE signal_tier IN ('rising','emerging')"
  ).filter(s => !trackedKeys.has(`${s.topic}||${s.niche}`));
  if (toLog.length > 0) {
    const logSql = `INSERT INTO trend_signal_outcomes (topic, niche, flagged_at, signal_tier, signal_score, score_breakdown) VALUES (?, ?, datetime('now'), ?, ?, ?)`;
    const logTx = db.transaction(() => {
      for (const s of toLog) db.run(logSql, [s.topic, s.niche, s.signal_tier, s.signal_score, s.score_breakdown]);
    });
    logTx();
  }
  console.log(`[trendSignal] Outcome tracking: ${toLog.length} new topics logged`);

  // ── Google Trends enrichment ──────────────────────────────────────────────
  // Fetch rising related queries for the strongest internal signals and persist
  // them; computeWhatToPost reads rows ≤48h old as a bounded score boost.
  try {
    const { getTrendSignals, persistTrendSignals } = require('../services/worldSignals');
    const topTopics = db.all(
      `SELECT topic FROM topic_signal_stats
       WHERE signal_tier IN ('rising','emerging')
       ORDER BY signal_score DESC LIMIT 5`,
    ).map(r => r.topic);
    if (topTopics.length) {
      const trendSignals = await getTrendSignals(topTopics, { timeoutMs: 4000, maxTopics: 5 });
      const persisted = persistTrendSignals(db, trendSignals);
      console.log(`[trendSignal] Google Trends: ${persisted} rising queries persisted for ${topTopics.length} topics`);
    }
  } catch (e) {
    console.warn('[trendSignal] Google Trends enrichment skipped:', e.message);
  }

  const secs = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`[trendSignal] Complete — ${written} topics scored and written in ${secs}s`);
  return { topics_scored: written, duration_s: parseFloat(secs) };
}

module.exports = { runTrendSignalJob, classifyTopicNiche };

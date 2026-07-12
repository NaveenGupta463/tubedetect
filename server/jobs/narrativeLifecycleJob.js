'use strict';

const cron    = require('node-cron');
const { getDb } = require('../db/init');
const {
  getNarrativeType,
  computeExpiry,
  classifyStage,
  computeWindowScore,
  computeActNowConf,
} = require('../lib/narrativeLifecycle');

// Parent-topic inference — mirrors the same table in creatorIntel / auditAngles.
const TOPIC_PARENTS = [
  { parent: 'Geopolitics',       keywords: ['iran','israel','pakistan','russia','ukraine','china','nato','war','conflict','border','military','army','defence','defense','missile','nuclear','sanctions','ceasefire','diplomacy','treaty','bilateral','hamas','hezbollah','gaza'] },
  { parent: 'Judiciary & Law',   keywords: ['supreme court','high court','verdict','judgment','constitution','article','bail','arrest','crime','murder','rape','scam','fraud','fir','custody','tribunal'] },
  { parent: 'Competitive Exams', keywords: ['upsc','ssc','ias','ips','prelims','mains','neet','jee','exam','syllabus','cutoff','answer key','mock test','preparation','crack','study'] },
  { parent: 'Economy & Finance', keywords: ['budget','rbi','inflation','gdp','gst','market','stock','sensex','nifty','bank','recession','investment','rupee','dollar','trade','tariff','imf','world bank','economy','economic'] },
  { parent: 'Politics',          keywords: ['election','modi','congress','bjp','government','minister','parliament','lok sabha','rajya sabha','party','vote','cm','chief minister','governor','president','coalition'] },
  { parent: 'Sports',            keywords: ['ipl','cricket','match','tournament','world cup','player','team','final','league','championship','hockey','football','kabaddi','olympics','medal'] },
  { parent: 'Science & Tech',    keywords: ['artificial intelligence','robot','space','isro','nasa','satellite','moon','mars','technology','startup','innovation','climate','environment','renewable','solar'] },
  { parent: 'Society & Health',  keywords: ['health','hospital','doctor','medicine','disease','cancer','covid','diabetes','mental health','education','school','university','women','child','poverty','farmer','protest'] },
];

function inferParentTopic(phrase) {
  const lower = phrase.toLowerCase();
  for (const { parent, keywords } of TOPIC_PARENTS) {
    for (const k of keywords) {
      const hit = k.includes(' ')
        ? lower.includes(k)
        : new RegExp('(?:^|\\b)' + k + '(?:\\b|$)').test(lower);
      if (hit) return parent;
    }
  }
  return null;
}

// Build LIKE-based WHERE clause for title token matching.
// All tokens from anchor + narrative must appear somewhere in the title.
function buildTitleConditions(anchor, narrative) {
  const tokens = [...anchor.split(' '), ...narrative.split(' ')].filter(w => w.length > 1);
  const conditions = tokens.map(() => "LOWER(title) LIKE ?").join(' AND ');
  const params     = tokens.map(t => `%${t}%`);
  return { conditions, params };
}

function computePublicationSignals(db, niche, anchor, narrative) {
  // Peer channel pool for this niche
  const channels = db.all(
    'SELECT channel_id FROM ingested_channels WHERE niche = ?',
    [niche],
  );
  if (!channels.length) return null;

  const channelIds = channels.map(c => c.channel_id);
  const ph         = channelIds.map(() => '?').join(',');
  const { conditions, params } = buildTitleConditions(anchor, narrative);

  // Time-bucketed publication counts over last 14 days.
  // hours_ago bucket: 0 = last 24h, 1 = 24-48h, 2 = 48-72h, etc.
  const rows = db.all(`
    SELECT
      CAST((julianday('now') - julianday(published_at)) AS INTEGER) AS day_bucket,
      COUNT(*)                                                        AS cnt,
      COUNT(DISTINCT channel_id)                                      AS ch_count,
      MIN(published_at)                                               AS earliest
    FROM ingested_videos
    WHERE channel_id IN (${ph})
      AND ${conditions}
      AND published_at >= date('now', '-14 days')
      AND title IS NOT NULL
    GROUP BY day_bucket
    ORDER BY day_bucket
  `, [...channelIds, ...params]);

  if (!rows.length) return null;

  const bucket0 = rows.find(r => r.day_bucket === 0) || { cnt: 0, ch_count: 0 };
  const bucket1 = rows.find(r => r.day_bucket === 1) || { cnt: 0, ch_count: 0 };

  const first_seen_at = rows.reduce((min, r) => (!min || r.earliest < min ? r.earliest : min), null);
  const age_hours = first_seen_at
    ? Math.round((Date.now() - new Date(first_seen_at).getTime()) / 3600000)
    : 0;

  // Total distinct channels covering this narrative across the whole window
  const allChannelIds = new Set();
  rows.forEach(r => {
    // Re-query for distinct channels across full window (aggregate above only gives per-bucket)
  });
  const totalRow = db.get(`
    SELECT COUNT(DISTINCT channel_id) AS total_ch
    FROM ingested_videos
    WHERE channel_id IN (${ph})
      AND ${conditions}
      AND published_at >= date('now', '-14 days')
      AND title IS NOT NULL
  `, [...channelIds, ...params]);

  const current_channels = totalRow?.total_ch || 0;

  // Saturation = current_channels / total niche channels
  const saturation_pct = channels.length
    ? Math.min(100, Math.round((current_channels / channels.length) * 100))
    : 0;

  // Velocity = channels in last 24h minus channels in prior 24h
  const velocity = bucket0.ch_count - bucket1.ch_count;

  return {
    first_seen_at: first_seen_at ? first_seen_at.split('T')[0] : null,
    last_seen_at:  rows[0]?.earliest?.split('T')[0] || null,
    age_hours,
    current_channels,
    saturation_pct,
    velocity,
    pub_rate_recent: bucket0.cnt,
    pub_rate_prior:  bucket1.cnt,
  };
}

function runNarrativeLifecycleJob(db) {
  const records = db.all('SELECT * FROM narrative_lifecycle');
  if (!records.length) {
    console.log('[narrative-lifecycle] No records to process');
    return;
  }

  let updated = 0;
  const now = new Date().toISOString();

  for (const rec of records) {
    try {
      const signals = computePublicationSignals(db, rec.niche, rec.anchor, rec.narrative);
      if (!signals) continue;

      const narrativeType  = rec.narrative_type || getNarrativeType(rec.niche);
      const prevStage      = rec.stage || 'seed';
      const stage          = classifyStage(signals, prevStage, narrativeType);
      const window_score   = computeWindowScore(stage, signals.saturation_pct, signals.velocity);
      const act_now_conf   = computeActNowConf(stage, window_score, signals.saturation_pct, signals.velocity, signals.age_hours);
      const parentTopic    = inferParentTopic(rec.anchor) || inferParentTopic(rec.narrative) || null;
      const expiry         = computeExpiry(signals.first_seen_at, parentTopic, narrativeType);
      const peak_channels  = Math.max(rec.peak_channels || 0, signals.current_channels);

      db.run(`
        UPDATE narrative_lifecycle SET
          first_seen_at   = COALESCE(first_seen_at, ?),
          last_seen_at    = ?,
          age_hours       = ?,
          peak_channels   = ?,
          current_channels= ?,
          saturation_pct  = ?,
          velocity        = ?,
          pub_rate_recent = ?,
          pub_rate_prior  = ?,
          stage           = ?,
          window_score    = ?,
          act_now_conf    = ?,
          expiry_estimate = ?,
          computed_at     = ?
        WHERE anchor = ? AND narrative = ? AND niche = ?
      `, [
        signals.first_seen_at,
        signals.last_seen_at,
        signals.age_hours,
        peak_channels,
        signals.current_channels,
        signals.saturation_pct,
        signals.velocity,
        signals.pub_rate_recent,
        signals.pub_rate_prior,
        stage,
        window_score,
        act_now_conf,
        expiry,
        now,
        rec.anchor, rec.narrative, rec.niche,
      ]);
      updated++;
    } catch (e) {
      console.warn(`[narrative-lifecycle] Error updating ${rec.anchor}:${rec.narrative} — ${e.message}`);
    }
  }

  console.log(`[narrative-lifecycle] Updated ${updated}/${records.length} narrative records`);
}

function startNarrativeLifecycleCron() {
  // Every 4 hours — fast enough for breaking news, gentle on DB
  cron.schedule('0 */4 * * *', () => {
    console.log('[narrative-lifecycle] 4h trigger');
    try {
      const db = getDb();
      runNarrativeLifecycleJob(db);
    } catch (e) {
      console.error('[narrative-lifecycle] Fatal error:', e.message);
    }
  });
  console.log('[narrative-lifecycle] Scheduled (every 4h)');
}

module.exports = { startNarrativeLifecycleCron, runNarrativeLifecycleJob };

const cron   = require('node-cron');
const { getDb } = require('../db/init');

const ENABLE_DEAD_S19 = process.env.S19_ENABLE_DEAD_FUNCTIONS === '1';
const { runTrendSignalJob }  = require('./trendSignalJob');
const { runVideoTrendJob }   = require('./videoTrendJob');
const { runComingToIndiaJob } = require('./comingToIndiaJob');
const { runTrendOutcomeJob } = require('./trendOutcomeJob');
const { runVideoTrendOutcomeJob } = require('./videoTrendOutcomeJob');
const { runEventClassificationJob } = require('../lib/eventClassifier');
const { buildCorpusIndex, computeChannelIdentity, upsertChannelIdentity } = require('../lib/channelIdentity');

// Strip trailing noise words to get a canonical topic string
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

// ── Channel Evolution Summary ─────────────────────────────────────────────────

function computeChannelEvolution(db) {
  const periods = [
    { label: '30d', days: 30, prior: 60 },
    { label: '90d', days: 90, prior: 180 },
  ];

  // Build topic list per channel once — used for all periods
  const allTopicRows = db.all('SELECT channel_id, topic FROM channel_topics');
  const topicsByChannel = new Map();
  for (const r of allTopicRows) {
    if (!topicsByChannel.has(r.channel_id)) topicsByChannel.set(r.channel_id, []);
    topicsByChannel.get(r.channel_id).push(r.topic);
  }

  for (const p of periods) {
    const rows = db.all(`
      SELECT channel_id,
        COUNT(CASE WHEN published_at > datetime('now','-${p.days} days') THEN 1 END)                                                                    AS vids_now,
        ROUND(AVG(CASE WHEN published_at > datetime('now','-${p.days} days') THEN CAST(views AS REAL) END))                                             AS avg_now,
        MAX(CASE WHEN published_at > datetime('now','-${p.days} days') THEN views END)                                                                  AS peak_now,
        COUNT(CASE WHEN published_at BETWEEN datetime('now','-${p.prior} days') AND datetime('now','-${p.days} days') THEN 1 END)                       AS vids_prior,
        ROUND(AVG(CASE WHEN published_at BETWEEN datetime('now','-${p.prior} days') AND datetime('now','-${p.days} days') THEN CAST(views AS REAL) END)) AS avg_prior
      FROM ingested_videos
      WHERE published_at > datetime('now','-${p.prior} days')
      GROUP BY channel_id
      HAVING vids_now > 0
    `);

    const sql = `
      INSERT OR REPLACE INTO channel_evolution_summary
        (channel_id, period, view_change_pct, upload_delta, avg_views, peak_views,
         video_count, topics_maintained, topics_gained, topics_lost, notable_event, computed_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,datetime('now'))
    `;

    const BATCH = 500;
    for (let i = 0; i < rows.length; i += BATCH) {
      const batch = rows.slice(i, i + BATCH);
      const tx = db.transaction(() => {
        for (const row of batch) {
          // Only show view change when there's a real baseline (≥500 avg views prior period)
          // Cap at ±500% to prevent blow-up from near-zero baselines
          let viewChangePct = null;
          if (row.avg_prior && row.avg_prior >= 500) {
            const raw = Math.round((row.avg_now - row.avg_prior) / row.avg_prior * 100);
            viewChangePct = Math.max(-500, Math.min(500, raw));
          }
          const uploadsNow   = row.vids_now   / (p.days / 7);
          const uploadsPrior = row.vids_prior / (p.days / 7);
          const uploadDelta  = Math.round((uploadsNow - uploadsPrior) * 10) / 10;
          const topics       = topicsByChannel.get(row.channel_id) || [];
          // Notable event: viral spike requires meaningful scale (≥50K peak, ≥3 videos, >5x avg)
          const notable = (
            row.peak_now   >= 50_000 &&
            row.avg_now    >  0      &&
            row.vids_now   >= 3      &&
            row.peak_now   > 5 * row.avg_now
          )
            ? JSON.stringify({ type: 'viral_spike', magnitude: Math.round(row.peak_now / row.avg_now) })
            : null;

          db.run(sql, [
            row.channel_id, p.label,
            viewChangePct,
            uploadDelta,
            row.avg_now   || 0,
            row.peak_now  || 0,
            row.vids_now,
            JSON.stringify(topics),
            '[]', '[]',
            notable,
          ]);
        }
      });
      tx();
    }
    console.log(`[intel-job] channel_evolution period=${p.label}: ${rows.length} channels`);
  }
}

// ── Topic Community Stats ─────────────────────────────────────────────────────

function computeTopicCommunityStats(db) {
  // CTE: per-channel avg views for last 30d and 90d, then aggregate by topic
  const rawTopics = db.all(`
    WITH chan_avgs AS (
      SELECT channel_id,
        AVG(CASE WHEN published_at > datetime('now','-30 days') THEN CAST(views AS REAL) END) AS avg_30d,
        AVG(CASE WHEN published_at > datetime('now','-90 days') THEN CAST(views AS REAL) END) AS avg_90d
      FROM ingested_videos
      WHERE published_at > datetime('now','-90 days')
      GROUP BY channel_id
    )
    SELECT
      ct.topic,
      ct.niche,
      COUNT(DISTINCT ct.channel_id)          AS channel_count,
      ROUND(AVG(COALESCE(ca.avg_30d, 0)))    AS avg_views_30d,
      ROUND(SUM(COALESCE(ca.avg_30d, 0)))    AS total_views_30d,
      ROUND(AVG(COALESCE(ca.avg_90d, 0)))    AS avg_views_90d
    FROM channel_topics ct
    LEFT JOIN chan_avgs ca ON ca.channel_id = ct.channel_id
    GROUP BY ct.topic, ct.niche
    HAVING channel_count >= 5
    ORDER BY channel_count DESC
  `);

  // Merge synonyms under canonical keys
  const canonical = new Map();
  for (const row of rawTopics) {
    const key = canonicalise(row.topic);
    if (!canonical.has(key)) {
      canonical.set(key, {
        topic: key,
        niche: row.niche || null,
        channel_count: 0,
        total_views_30d: 0,
        avg_views_30d_sum: 0,
        avg_views_90d_sum: 0,
        n: 0,
      });
    }
    const e = canonical.get(key);
    e.channel_count      += row.channel_count;
    e.total_views_30d    += row.total_views_30d;
    e.avg_views_30d_sum  += row.avg_views_30d * row.channel_count;
    e.avg_views_90d_sum  += row.avg_views_90d * row.channel_count;
    e.n                  += row.channel_count;
    if (!e.niche && row.niche) e.niche = row.niche;
  }

  const entries = [...canonical.values()].filter(e => e.channel_count >= 5);

  const sql30 = `
    INSERT OR REPLACE INTO topic_community_stats
      (topic, period, channel_count, total_views, avg_views, velocity, velocity_trend, top_channels, computed_at)
    VALUES (?,?,?,?,?,?,?,?,datetime('now'))
  `;
  const sql90 = sql30;

  const BATCH = 200;
  for (let i = 0; i < entries.length; i += BATCH) {
    const batch = entries.slice(i, i + BATCH);
    const tx = db.transaction(() => {
      for (const e of batch) {
        const avg30 = e.n > 0 ? Math.round(e.avg_views_30d_sum / e.n) : 0;
        const avg90 = e.n > 0 ? Math.round(e.avg_views_90d_sum / e.n) : 0;

        db.run(sql30, [
          e.topic, '30d',
          e.channel_count,
          Math.round(e.total_views_30d),
          avg30,
          null, 'stable', '[]',
        ]);
        db.run(sql90, [
          e.topic, '90d',
          e.channel_count,
          null, avg90,
          null, 'stable', '[]',
        ]);
      }
    });
    tx();
  }
  console.log(`[intel-job] topic_community_stats: ${entries.length} canonical topics`);
}

// ── Log new topic assignments for future adoption velocity ───────────────────
// From this run forward, any newly seen channel_id+topic combo
// will have today's date in first_seen. We ensure last_seen is updated each run.

function updateTopicLastSeen(db) {
  try {
    db.run(`
      UPDATE channel_topics SET last_seen = datetime('now')
      WHERE last_seen IS NULL OR last_seen < datetime('now','-1 days')
    `);
  } catch (_) {}
}

// ── Saturation Wave Detector ──────────────────────────────────────────────────
// Snapshot niche × phrase adoption rates nightly.
// Classifies each phrase into a lifecycle stage based on adoption_pct trajectory.
// Data accumulates; Phase 6 scoring activates after 60 days of rows exist.

function computeSaturationHistory(db) {
  const today = new Date().toISOString().slice(0, 10);

  // Build niche_id → integer map from ingested_channels
  const nicheRows = db.all(`
    SELECT COALESCE(primary_niche, niche) AS niche, COUNT(*) AS cnt
    FROM ingested_channels
    WHERE ingest_enabled = 1
    GROUP BY 1
    HAVING cnt >= 10
  `);
  if (!nicheRows.length) return;

  // Assign stable integer IDs per niche name (sorted alphabetically for determinism)
  const niches = nicheRows.map(r => r.niche).filter(Boolean).sort();
  const nicheIndex = new Map(niches.map((n, i) => [n, i + 1]));

  let totalInserted = 0;

  for (const niche of niches) {
    const nicheId = nicheIndex.get(niche);

    // Get all channels in this niche
    const nicheChannels = db.all(
      `SELECT channel_id FROM ingested_channels
       WHERE COALESCE(primary_niche, niche) = ? AND ingest_enabled = 1`,
      [niche],
    );
    const totalChannels = nicheChannels.length;
    if (totalChannels < 10) continue;

    const channelIds = nicheChannels.map(r => r.channel_id);
    const ph = channelIds.map(() => '?').join(',');

    // Count distinct bigrams/trigrams from recent video titles per channel, aggregated by phrase
    // We use ingested_channels.content_fingerprint phrases as our phrase vocabulary
    const fingerprintRows = db.all(
      `SELECT content_fingerprint FROM ingested_channels
       WHERE COALESCE(primary_niche, niche) = ? AND content_fingerprint IS NOT NULL AND ingest_enabled = 1`,
      [niche],
    );

    // Build phrase vocabulary from all fingerprints in this niche
    const phraseCounts = new Map();
    for (const r of fingerprintRows) {
      for (const p of r.content_fingerprint.split('|')) {
        if (p.length >= 4) phraseCounts.set(p, (phraseCounts.get(p) || 0) + 1);
      }
    }

    // Only score phrases that appear in ≥3 channel fingerprints (signal, not noise)
    const vocab = [...phraseCounts.entries()]
      .filter(([, cnt]) => cnt >= 3)
      .map(([p]) => p);

    if (!vocab.length) continue;

    // For each phrase, count how many niche channels posted a video containing it in last 30d
    const windowStart = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);

    // Retrieve last 2 prior snapshots for stage classification
    const priorSnapshots = db.all(
      `SELECT phrase, adoption_pct FROM topic_saturation_history
       WHERE niche_id = ? AND snapshot_date < ? ORDER BY snapshot_date DESC LIMIT ?`,
      [nicheId, today, vocab.length * 2],
    );
    const priorByPhrase = new Map();
    for (const s of priorSnapshots) {
      if (!priorByPhrase.has(s.phrase)) priorByPhrase.set(s.phrase, []);
      priorByPhrase.get(s.phrase).push(s.adoption_pct);
    }

    const insertSql = `
      INSERT OR REPLACE INTO topic_saturation_history
        (niche_id, phrase, snapshot_date, adoption_pct, median_views, channel_count, stage)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `;

    const insertBatch = db.transaction((rows) => {
      for (const row of rows) db.run(insertSql, row);
    });

    const batch = [];

    for (const phrase of vocab) {
      const matched = db.get(
        `SELECT COUNT(DISTINCT channel_id) AS n,
                AVG(CAST(views AS REAL)) AS avg_views
         FROM ingested_videos
         WHERE channel_id IN (${ph})
           AND published_at >= ?
           AND title LIKE ?`,
        [...channelIds, windowStart, `%${phrase}%`],
      );

      const adoptingChannels = matched?.n || 0;
      const adoption_pct     = (adoptingChannels / totalChannels) * 100;
      const median_views     = matched?.avg_views || null;

      // Stage classification
      const prior = priorByPhrase.get(phrase) || [];
      let stage;
      if (adoption_pct < 5) {
        stage = 'ignition';
      } else if (adoption_pct <= 20) {
        // Rising or flat expansion
        const prev = prior[0] ?? adoption_pct;
        stage = adoption_pct >= prev ? 'expansion' : 'plateau';
      } else if (adoption_pct <= 40) {
        // Was it higher before? → exodus; otherwise plateau
        const prev = prior[0] ?? adoption_pct;
        stage = adoption_pct < prev * 0.9 ? 'exodus' : 'plateau';
      } else {
        // Check if it's declining from >40%
        const prev = prior[0] ?? adoption_pct;
        stage = (adoption_pct < prev * 0.9 && prev > 20) ? 'exodus' : 'saturated';
      }

      batch.push([nicheId, phrase, today, adoption_pct, median_views, adoptingChannels, stage]);
    }

    insertBatch(batch);
    totalInserted += batch.length;
  }

  console.log(`[intel-job] topic_saturation_history: ${totalInserted} phrase×niche snapshots for ${today}`);
}

// ── Phase 5: Ecosystem Tables ─────────────────────────────────────────────────
// These 5 functions collect data nightly. Phase 6 scoring activates only after
// 60 days of saturation history exist — do NOT use these in scoring yet.

function buildNicheIdMap(db) {
  const rows = db.all(`
    SELECT COALESCE(primary_niche, niche) AS niche, COUNT(*) AS cnt
    FROM ingested_channels WHERE ingest_enabled = 1
    GROUP BY 1 HAVING cnt >= 10
  `);
  return new Map(rows.map(r => r.niche).filter(Boolean).sort().map((n, i) => [n, i + 1]));
}

function computeCreatorTopicLifecycle(db) {
  const since90 = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
  const since30 = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);

  // V2: source clean phrases from channel_identity (IDF-weighted, brand+guest filtered)
  // instead of the raw content_fingerprint (which is contaminated with brand/guest phrases).
  const channels = db.all(`
    SELECT ic.channel_id, ci.content_phrases
    FROM ingested_channels ic
    JOIN channel_identity ci ON ci.channel_id = ic.channel_id
    WHERE ci.content_phrases IS NOT NULL
      AND ci.confidence_tier NOT IN ('none')
      AND ic.ingest_enabled = 1
    ORDER BY ic.channel_subscribers DESC LIMIT 5000
  `);

  const insertSql = `
    INSERT OR REPLACE INTO creator_topic_lifecycle
      (channel_id, phrase, stage, first_seen, last_seen, video_count, avg_views_on_topic, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `;

  let totalUpserted = 0;
  const BATCH = 200;

  for (let i = 0; i < channels.length; i += BATCH) {
    const slice    = channels.slice(i, i + BATCH);
    const batchIds = slice.map(c => c.channel_id);
    const ph       = batchIds.map(() => '?').join(',');

    const videos = db.all(
      `SELECT channel_id, title, published_at, views FROM ingested_videos
       WHERE channel_id IN (${ph}) AND published_at >= ? AND title IS NOT NULL`,
      [...batchIds, since90],
    );

    const byChannel = new Map();
    for (const v of videos) {
      if (!byChannel.has(v.channel_id)) byChannel.set(v.channel_id, []);
      byChannel.get(v.channel_id).push(v);
    }

    const rows = [];
    for (const ch of slice) {
      const chVids  = byChannel.get(ch.channel_id) || [];
      if (!chVids.length) continue;
      const total   = chVids.length;
      const phrases = (ch.content_phrases || '').split('|').map(p => p.trim()).filter(p => p.length >= 4);

      for (const phrase of phrases) {
        const lp       = phrase.toLowerCase();
        const matching = chVids.filter(v => v.title.toLowerCase().includes(lp));

        if (!matching.length) {
          rows.push([ch.channel_id, phrase, 'pre_topic', null, null, 0, null]);
          continue;
        }

        matching.sort((a, b) => (a.published_at < b.published_at ? -1 : 1));
        const vc         = matching.length;
        const first_seen = matching[0].published_at?.slice(0, 10);
        const last_seen  = matching[vc - 1].published_at?.slice(0, 10);
        const avg_views  = Math.round(matching.reduce((s, v) => s + (v.views || 0), 0) / vc);
        const isRecent   = last_seen >= since30;

        let stage;
        if (vc <= 2)               stage = 'seed';
        else if (vc <= 5)          stage = 'early';
        else if (vc / total > 0.2) stage = 'saturated';
        else if (isRecent)         stage = 'regular';
        else                       stage = 'exiting';

        rows.push([ch.channel_id, phrase, stage, first_seen, last_seen, vc, avg_views]);
      }
    }

    if (rows.length) {
      const tx = db.transaction((r) => { for (const row of r) db.run(insertSql, row); });
      tx(rows);
      totalUpserted += rows.length;
    }
  }

  console.log(`[intel-job] creator_topic_lifecycle: ${totalUpserted} channel×phrase records`);
}

function computeFormatMigration(db) {
  const today   = new Date().toISOString().slice(0, 10);
  const since30 = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const nicheIdMap = buildNicheIdMap(db);

  const insertSql = `INSERT OR REPLACE INTO format_migration_trends
    (niche_id, snapshot_date, format, share_pct, median_views, channel_count) VALUES (?, ?, ?, ?, ?, ?)`;

  let totalRows = 0;

  for (const [niche, nicheId] of nicheIdMap) {
    const channelIds = db.all(
      `SELECT channel_id FROM ingested_channels
       WHERE COALESCE(primary_niche, niche) = ? AND ingest_enabled = 1
       ORDER BY channel_subscribers DESC LIMIT 1000`,
      [niche],
    ).map(r => r.channel_id);
    if (channelIds.length < 10) continue;

    const ph = channelIds.map(() => '?').join(',');

    const formatRows = db.all(
      `SELECT
         CASE WHEN is_short=1 OR COALESCE(duration_seconds,0) <= 60 THEN 'short'
              WHEN COALESCE(duration_seconds,0) >= 600               THEN 'long'
              ELSE 'medium'
         END AS fmt,
         COUNT(*) AS cnt,
         AVG(CAST(views AS REAL)) AS avg_views,
         COUNT(DISTINCT channel_id) AS channel_count
       FROM ingested_videos
       WHERE channel_id IN (${ph}) AND published_at >= ?
       GROUP BY fmt`,
      [...channelIds, since30],
    );
    if (!formatRows.length) continue;

    const totalVids = formatRows.reduce((s, r) => s + r.cnt, 0);
    const batch = formatRows.map(r => [
      nicheId, today, r.fmt,
      parseFloat(((r.cnt / totalVids) * 100).toFixed(2)),
      Math.round(r.avg_views || 0),
      r.channel_count,
    ]);

    const tx = db.transaction((rows) => { for (const row of rows) db.run(insertSql, row); });
    tx(batch);
    totalRows += batch.length;
  }

  console.log(`[intel-job] format_migration_trends: ${totalRows} niche×format snapshots`);
}

function computeNicheEvolution(db) {
  const today   = new Date().toISOString().slice(0, 10);
  const since30 = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const since60 = new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 10);
  const nicheIdMap = buildNicheIdMap(db);

  const insertSql = `INSERT OR REPLACE INTO niche_evolution_snapshots
    (niche_id, snapshot_date, avg_channel_subs, median_vph, top_phrase_entropy, new_channel_30d, churned_channel_30d)
    VALUES (?, ?, ?, ?, ?, ?, ?)`;

  let totalRows = 0;

  for (const [niche, nicheId] of nicheIdMap) {
    const chanStats = db.get(
      `SELECT COUNT(*) AS cnt, AVG(CAST(channel_subscribers AS REAL)) AS avg_subs
       FROM ingested_channels WHERE COALESCE(primary_niche, niche) = ? AND ingest_enabled = 1`,
      [niche],
    );
    if (!chanStats?.cnt || chanStats.cnt < 10) continue;

    const channelIds = db.all(
      `SELECT channel_id FROM ingested_channels
       WHERE COALESCE(primary_niche, niche) = ? AND ingest_enabled = 1
       ORDER BY channel_subscribers DESC LIMIT 1000`,
      [niche],
    ).map(r => r.channel_id);
    const ph = channelIds.map(() => '?').join(',');

    const newRow = db.get(
      `SELECT COUNT(*) AS n FROM (
         SELECT channel_id FROM ingested_videos WHERE channel_id IN (${ph})
         GROUP BY channel_id HAVING MIN(published_at) >= ?
       )`,
      [...channelIds, since30],
    );

    const churnRow = db.get(
      `SELECT COUNT(*) AS n FROM (
         SELECT channel_id FROM ingested_videos WHERE channel_id IN (${ph})
         GROUP BY channel_id HAVING MAX(published_at) < ?
       )`,
      [...channelIds, since60],
    );

    const vphRows = db.all(
      `SELECT views, published_at FROM ingested_videos
       WHERE channel_id IN (${ph}) AND published_at >= ?
       ORDER BY published_at DESC LIMIT 500`,
      [...channelIds, since30],
    );
    let median_vph = null;
    if (vphRows.length) {
      const vphs = vphRows.map(v => {
        const hrs = (Date.now() - new Date(v.published_at).getTime()) / 3_600_000;
        return (v.views || 0) / Math.max(1, hrs);
      }).sort((a, b) => a - b);
      median_vph = parseFloat(vphs[Math.floor(vphs.length / 2)].toFixed(2));
    }

    const topPhrases = db.all(
      `SELECT adoption_pct FROM topic_saturation_history
       WHERE niche_id = ? AND snapshot_date = ? ORDER BY adoption_pct DESC LIMIT 20`,
      [nicheId, today],
    );
    let entropy = null;
    if (topPhrases.length > 1) {
      const total = topPhrases.reduce((s, r) => s + r.adoption_pct, 0);
      if (total > 0) {
        let h = 0;
        for (const r of topPhrases) { const p = r.adoption_pct / total; if (p > 0) h -= p * Math.log2(p); }
        entropy = parseFloat(h.toFixed(4));
      }
    }

    db.run(insertSql, [
      nicheId, today,
      chanStats.avg_subs ? Math.round(chanStats.avg_subs) : null,
      median_vph, entropy,
      newRow?.n || 0, churnRow?.n || 0,
    ]);
    totalRows++;
  }

  console.log(`[intel-job] niche_evolution_snapshots: ${totalRows} niches snapshotted`);
}

function computePhraseNichePMI(db) {
  const today = new Date().toISOString().slice(0, 10);

  const rows = db.all(
    `SELECT niche_id, phrase, adoption_pct, channel_count
     FROM topic_saturation_history WHERE snapshot_date = ?`,
    [today],
  );
  if (!rows.length) return;

  const totalChannels = (db.get(
    `SELECT COUNT(*) AS n FROM ingested_channels WHERE ingest_enabled = 1`,
  )?.n) || 1;

  const globalCount = new Map();
  for (const r of rows) {
    globalCount.set(r.phrase, (globalCount.get(r.phrase) || 0) + (r.channel_count || 0));
  }

  const insertSql = `INSERT OR REPLACE INTO phrase_niche_pmi
    (phrase, niche_id, pmi_score, updated_at) VALUES (?, ?, ?, datetime('now'))`;

  const batch = rows.map(r => {
    const p_niche  = r.adoption_pct / 100;
    const p_global = (globalCount.get(r.phrase) || 1) / totalChannels;
    const pmi      = Math.log(Math.max(0.0001, p_niche) / Math.max(0.0001, p_global));
    return [r.phrase, r.niche_id, parseFloat(pmi.toFixed(4))];
  });

  const CHUNK = 500;
  for (let i = 0; i < batch.length; i += CHUNK) {
    const tx = db.transaction((rows) => { for (const row of rows) db.run(insertSql, row); });
    tx(batch.slice(i, i + CHUNK));
  }

  console.log(`[intel-job] phrase_niche_pmi: ${batch.length} PMI scores`);
}

function detectEcosystemShifts(db) {
  const today      = new Date().toISOString().slice(0, 10);
  const nicheIdMap = buildNicheIdMap(db);

  // Signal 1: phrases newly in 'ignition' with no prior snapshot for this niche
  // Guard: only fire when the niche has prior data (avoids first-run flood)
  const newIgnitions = db.all(`
    SELECT niche_id, phrase FROM topic_saturation_history
    WHERE snapshot_date = ? AND stage = 'ignition'
      AND NOT EXISTS (
        SELECT 1 FROM topic_saturation_history t2
        WHERE t2.niche_id = topic_saturation_history.niche_id
          AND t2.phrase   = topic_saturation_history.phrase
          AND t2.snapshot_date < ?
      )
      AND EXISTS (
        SELECT 1 FROM topic_saturation_history t3
        WHERE t3.niche_id = topic_saturation_history.niche_id
          AND t3.snapshot_date < ?
      )
  `, [today, today, today]);

  // Signal 2: channels exiting a high-PMI phrase (pioneer exit)
  const exitingChannels = db.all(`
    SELECT ctl.phrase, COALESCE(ic.primary_niche, ic.niche) AS niche
    FROM creator_topic_lifecycle ctl
    JOIN ingested_channels ic ON ic.channel_id = ctl.channel_id
    WHERE ctl.stage = 'exiting' AND ctl.updated_at >= datetime('now', '-2 days')
  `);

  // Signal 3: format share drop >15 percentage-points from prior snapshot
  const formatDrops = db.all(`
    SELECT f1.niche_id, f1.format,
           ROUND(f2.share_pct - f1.share_pct, 1) AS drop_pts
    FROM format_migration_trends f1
    JOIN format_migration_trends f2
      ON f1.niche_id = f2.niche_id AND f1.format = f2.format
    WHERE f1.snapshot_date = ?
      AND f2.snapshot_date = (
        SELECT MAX(snapshot_date) FROM format_migration_trends f3
        WHERE f3.niche_id = f1.niche_id AND f3.format = f1.format AND f3.snapshot_date < ?
      )
      AND (f2.share_pct - f1.share_pct) > 15
  `, [today, today]);

  const byNiche = new Map();
  const touch   = (id) => {
    if (!byNiche.has(id)) byNiche.set(id, { signals: new Set(), phrase: null });
    return byNiche.get(id);
  };

  for (const r of newIgnitions) {
    const s = touch(r.niche_id);
    s.signals.add('topic_ignition');
    if (!s.phrase) s.phrase = r.phrase;
  }

  for (const r of exitingChannels) {
    const nicheId = nicheIdMap.get(r.niche);
    if (!nicheId) continue;
    const pmiRow = db.get(
      `SELECT pmi_score FROM phrase_niche_pmi WHERE phrase = ? AND niche_id = ?`,
      [r.phrase, nicheId],
    );
    if (!pmiRow || pmiRow.pmi_score <= 1.0) continue;
    const s = touch(nicheId);
    s.signals.add('pioneer_exit');
    if (!s.phrase) s.phrase = r.phrase;
  }

  for (const r of formatDrops) {
    touch(r.niche_id).signals.add('format_collapse');
  }

  let shiftsDetected = 0;
  for (const [nicheId, data] of byNiche) {
    if (data.signals.size < 2) continue;
    const signals = [...data.signals];
    db.run(`
      INSERT INTO ecosystem_shifts
        (niche_id, detected_at, shift_type, signals_fired, primary_phrase, confidence)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [
      nicheId, today, signals[0],
      JSON.stringify(signals), data.phrase,
      parseFloat((data.signals.size / 3).toFixed(2)),
    ]);
    shiftsDetected++;
  }

  console.log(`[intel-job] ecosystem_shifts: ${shiftsDetected} shifts detected`);
}

// ── Lifecycle Health Daily Snapshot ──────────────────────────────────────────

function saveLifecycleSnapshot(db) {
  const today = new Date().toISOString().slice(0, 10);

  const corpus = db.get(`
    SELECT
      COUNT(*)                                               AS total_records,
      COUNT(DISTINCT channel_id)                            AS channels_with_lifecycle,
      SUM(CASE WHEN stage='regular'   THEN 1 ELSE 0 END)   AS regular_count,
      SUM(CASE WHEN stage='saturated' THEN 1 ELSE 0 END)   AS saturated_count,
      SUM(CASE WHEN stage='seed'      THEN 1 ELSE 0 END)   AS seed_count,
      SUM(CASE WHEN stage='early'     THEN 1 ELSE 0 END)   AS early_count,
      SUM(CASE WHEN stage='pre_topic' THEN 1 ELSE 0 END)   AS pre_topic_count
    FROM creator_topic_lifecycle
  `);

  const brand = db.get(`
    SELECT
      AVG(COALESCE(brand_contamination_pct, 0))                                           AS avg_brand_pct,
      SUM(CASE WHEN content_phrases IS NOT NULL AND content_phrases != '' THEN 1 ELSE 0 END) AS content_match_count,
      COUNT(*)                                                                             AS total_identity
    FROM channel_identity
  `);

  db.run(`
    INSERT OR REPLACE INTO lifecycle_daily_snapshots
      (snapshot_date, channels_with_lifecycle, total_records, regular_count, saturated_count,
       seed_count, early_count, pre_topic_count, brand_contamination_pct, content_match_pct)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    today,
    corpus.channels_with_lifecycle,
    corpus.total_records,
    corpus.regular_count,
    corpus.saturated_count,
    corpus.seed_count,
    corpus.early_count,
    corpus.pre_topic_count,
    brand.avg_brand_pct != null ? parseFloat(brand.avg_brand_pct.toFixed(4)) : null,
    brand.total_identity > 0
      ? parseFloat((brand.content_match_count / brand.total_identity).toFixed(4))
      : null,
  ]);

  console.log(`[intel-job] lifecycle_daily_snapshots: saved for ${today} (${corpus.channels_with_lifecycle} channels, ${corpus.total_records} records)`);
}

// ── Channel Identity Recompute ────────────────────────────────────────────────
// Nightly refresh: recompute identity for channels whose videos changed since
// last identity compute, or channels with no identity yet.
// Processes up to 2000 channels per run to stay within the 3am window.

function recomputeChannelIdentity(db) {
  const candidates = db.all(
    `SELECT ic.channel_id FROM ingested_channels ic
     LEFT JOIN channel_identity ci ON ci.channel_id = ic.channel_id
     WHERE ic.ingest_enabled = 1
       AND ic.content_fingerprint IS NOT NULL
       AND (
         ci.channel_id IS NULL
         OR ci.computed_at < datetime('now', '-7 days')
       )
     ORDER BY ic.channel_subscribers DESC NULLS LAST
     LIMIT 2000`,
  );
  if (!candidates.length) {
    console.log('[intel-job] recomputeChannelIdentity: no candidates');
    return;
  }

  const corpusIndex = buildCorpusIndex(db);
  let ok = 0, err = 0;
  const tx = db.transaction(() => {
    for (const { channel_id } of candidates) {
      try {
        const identity = computeChannelIdentity(db, channel_id, corpusIndex);
        upsertChannelIdentity(db, identity);
        ok++;
      } catch (e) {
        err++;
      }
    }
  });
  tx();
  console.log(`[intel-job] recomputeChannelIdentity: ok=${ok} err=${err} / ${candidates.length} candidates`);
}

// ── Main entry ────────────────────────────────────────────────────────────────

async function runAggregation() { // eslint-disable-line
  const db    = getDb();
  const start = Date.now();
  console.log('[intel-job] Starting intelligence aggregation run...');
  try {
    updateTopicLastSeen(db);
    computeChannelEvolution(db);
    computeTopicCommunityStats(db);
    computeCreatorTopicLifecycle(db);
    if (ENABLE_DEAD_S19) computeFormatMigration(db);
    if (ENABLE_DEAD_S19) computeNicheEvolution(db);
    if (ENABLE_DEAD_S19) detectEcosystemShifts(db);
    saveLifecycleSnapshot(db);
    await runTrendSignalJob();
    await runVideoTrendJob();      // video-grounded trends — the engine that powers the Trend screen
    await runComingToIndiaJob();   // foreign-led "Coming to India" feed
    await runTrendOutcomeJob();
    await runVideoTrendOutcomeJob();
    runEventClassificationJob(db);
    const secs = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`[intel-job] Aggregation complete in ${secs}s`);
  } catch (e) {
    console.error('[intel-job] Fatal error:', e.message, e.stack);
  }
}

// Catch-up guard: node-cron does NOT replay a firing missed while the process was down, so a worker
// that's offline at 3am would leave trends stale until the NEXT 3am. If the last recompute is older
// than the threshold, run one now. Staleness is read from the trend tables' newest computed_at.
function _trendsStaleHours(db) {
  try {
    const a = db.get(`SELECT MAX(computed_at) t FROM video_trend_signals`)?.t;
    const b = db.get(`SELECT MAX(computed_at) t FROM topic_signal_stats`)?.t;
    const last = [a, b].filter(Boolean).sort().pop();
    if (!last) return Infinity; // never run
    return (Date.now() - new Date(last.replace(' ', 'T') + 'Z').getTime()) / 3600000;
  } catch (_) { return 0; }
}
function catchUpIfStale(reason) {
  const db = getDb();
  const hrs = _trendsStaleHours(db);
  if (hrs > 26) {
    console.log(`[intel-job] Catch-up (${reason}): trends ${hrs === Infinity ? 'never computed' : Math.round(hrs) + 'h stale'} → running aggregation`);
    runAggregation();
  } else {
    console.log(`[intel-job] Catch-up (${reason}): trends ${Math.round(hrs)}h old — fresh, skipping`);
  }
}

function startIntelligenceAggregatorCron() {
  // Nightly at 3am. runAggregation is heavy (blocks the event loop for minutes via synchronous
  // better-sqlite3), so it is NOT run inline on startup.
  cron.schedule('0 3 * * *', () => {
    console.log('[intel-job] Nightly trigger (3am)');
    runAggregation();
  });

  // Safety net for a missed 3am (worker was down): a staleness-guarded catch-up, deferred so it
  // never blocks startup, plus a periodic re-check. Only actually recomputes when >26h stale, so a
  // normal on-time nightly run is never duplicated.
  setTimeout(() => catchUpIfStale('startup'), 3 * 60 * 1000);
  cron.schedule('0 */6 * * *', () => catchUpIfStale('6h-check'));

  console.log('[intel-job] Intelligence aggregator scheduled (3am daily + staleness catch-up)');
}

module.exports = {
  startIntelligenceAggregatorCron,
  runAggregation,
  recomputeChannelIdentity,
  computeCreatorTopicLifecycle,
  computeFormatMigration,
  computeNicheEvolution,
  detectEcosystemShifts,
};

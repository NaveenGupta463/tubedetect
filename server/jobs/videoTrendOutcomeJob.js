'use strict';

// Ground-truth accuracy loop for the VIDEO-GROUNDED trend engine (video_trend_signals) — the engine
// that actually powers the Trend screen. The existing trendOutcomeJob only evaluates the older
// channel-topic engine (topic_signal_stats), which the UI no longer reads, so there was previously
// no way to know whether THIS engine's rising/emerging calls are actually right. videoTrendJob flags
// every new rising/emerging topic (see flagNewTrendsForOutcomeTracking); 30 days later this job
// checks whether the topic's channel coverage held up.

const { getDb } = require('../db/init');

const MINVIEWS = 15000; // must match videoTrendJob's MINVIEWS so the re-check is apples-to-apples

async function runVideoTrendOutcomeJob() {
  const db = getDb();
  console.log('[videoTrendOutcome] Evaluating flagged topics...');

  const pending = db.all(`
    SELECT topic, niche, flagged_at, channel_count_at_flag
    FROM video_trend_outcomes
    WHERE evaluated_at IS NULL AND flagged_at < datetime('now', '-30 days')
  `);

  if (!pending.length) {
    console.log('[videoTrendOutcome] Nothing ready for evaluation yet (< 30 days since flagging)');
    return { evaluated: 0 };
  }

  const updateSql = `
    UPDATE video_trend_outcomes
    SET channel_count_60d_later = ?, adoption_change_pct = ?, outcome_confirmed = ?, evaluated_at = datetime('now')
    WHERE topic = ? AND niche = ? AND flagged_at = ? AND evaluated_at IS NULL
  `;

  let confirmed = 0, falsePos = 0;

  const tx = db.transaction(() => {
    for (const row of pending) {
      // Re-derive current coverage for the flagged phrase directly from ingested_videos rather than
      // looking up video_trend_signals — the LLM canonicalizer may have renamed or merged this exact
      // topic string since it was flagged, which would falsely read as "the topic vanished" even if
      // it's genuinely still trending under a cleaner name.
      const nowChannels = db.get(`
        SELECT COUNT(DISTINCT iv.channel_id) n
        FROM ingested_videos iv
        WHERE iv.published_at > datetime('now', '-30 days') AND iv.views > ?
          AND LOWER(iv.title) LIKE '%' || LOWER(?) || '%'
      `, [MINVIEWS, row.topic]).n || 0;

      const origChannels = row.channel_count_at_flag || 0;
      const adoptionPct  = origChannels > 0 ? Math.round(((nowChannels - origChannels) / origChannels) * 100) : 0;
      const isConfirmed  = nowChannels >= Math.max(4, origChannels * 0.7) ? 1 : 0;
      if (isConfirmed) confirmed++; else falsePos++;

      db.run(updateSql, [nowChannels, adoptionPct, isConfirmed, row.topic, row.niche, row.flagged_at]);
    }
  });
  tx();

  console.log(`[videoTrendOutcome] Evaluated ${pending.length} — confirmed: ${confirmed}, false positives: ${falsePos}`);
  return { evaluated: pending.length, confirmed, false_positives: falsePos };
}

module.exports = { runVideoTrendOutcomeJob };

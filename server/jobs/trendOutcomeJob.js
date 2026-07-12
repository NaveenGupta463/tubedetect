'use strict';

const { getDb } = require('../db/init');

async function runTrendOutcomeJob() {
  const db = getDb();
  console.log('[trendOutcome] Evaluating flagged topics...');

  const pending = db.all(`
    SELECT topic, niche, flagged_at, signal_tier, signal_score, score_breakdown
    FROM trend_signal_outcomes
    WHERE evaluated_at IS NULL
      AND flagged_at < datetime('now', '-30 days')
  `);

  if (!pending.length) {
    console.log('[trendOutcome] Nothing ready for evaluation yet (< 30 days since flagging)');
    return { evaluated: 0 };
  }

  const updateSql = `
    UPDATE trend_signal_outcomes
    SET channel_count_60d_later = ?,
        adoption_change_pct     = ?,
        outcome_confirmed       = ?,
        evaluated_at            = datetime('now')
    WHERE topic = ? AND niche = ? AND evaluated_at IS NULL
      AND flagged_at < datetime('now', '-30 days')
  `;

  let confirmed = 0;
  let falsePos  = 0;

  const tx = db.transaction(() => {
    for (const row of pending) {
      const current = db.get(
        'SELECT channel_count_30d FROM topic_signal_stats WHERE topic = ? AND niche = ?',
        [row.topic, row.niche]
      );

      const bd           = row.score_breakdown ? JSON.parse(row.score_breakdown) : null;
      const origChannels = bd?.adoption?.channels_now || 0;
      const nowChannels  = current?.channel_count_30d || 0;
      const adoptionPct  = origChannels > 0
        ? Math.round(((nowChannels - origChannels) / origChannels) * 100)
        : 0;

      // Confirmed if topic still has ≥70% of its original channel footprint
      const isConfirmed = current && nowChannels >= Math.max(5, origChannels * 0.7) ? 1 : 0;
      if (isConfirmed) confirmed++; else falsePos++;

      db.run(updateSql, [nowChannels, adoptionPct, isConfirmed, row.topic, row.niche]);
    }
  });
  tx();

  console.log(`[trendOutcome] Evaluated ${pending.length} — confirmed: ${confirmed}, false positives: ${falsePos}`);
  return { evaluated: pending.length, confirmed, false_positives: falsePos };
}

module.exports = { runTrendOutcomeJob };

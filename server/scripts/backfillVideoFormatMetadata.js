'use strict';

require('dotenv').config({ path: __dirname + '/../.env' });

const path = require('path');
const Database = require('better-sqlite3');
const { classifyVideoFormat } = require('../services/videoFormatClassifier');

const chunkSize = Math.max(1, Number(process.argv[2] || 50000));
const runAll = process.argv.includes('--all');
const fast = process.argv.includes('--fast');
const dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'scoring.db');
const db = new Database(dbPath, { fileMustExist: true, timeout: 60_000 });
db.pragma('busy_timeout = 60000');

const selectRows = db.prepare(
  `SELECT youtube_video_id, title, description, duration_seconds, thumbnail_width, thumbnail_height
   FROM ingested_videos
   WHERE format_reason IS NULL
   ORDER BY ingested_at DESC
   LIMIT ?`,
);

const updateRow = db.prepare(
  `UPDATE ingested_videos
   SET format_type = ?,
       format_confidence = ?,
       format_reason = ?
   WHERE youtube_video_id = ?`,
);

const updateTx = db.transaction(rows => {
  for (const row of rows) {
    const fmt = classifyVideoFormat(row);
    updateRow.run(fmt.format_type, fmt.format_confidence, fmt.format_reason, row.youtube_video_id);
  }
});

function countPending() {
  return db.prepare(`SELECT COUNT(1) AS n FROM ingested_videos WHERE format_reason IS NULL`).get().n;
}

function printDistribution() {
  console.table(db.prepare(
    `SELECT format_type, format_confidence, COUNT(1) AS videos
     FROM ingested_videos
     GROUP BY format_type, format_confidence
     ORDER BY videos DESC`,
  ).all());
}

try {
  const started = Date.now();
  let totalUpdated = 0;
  let pending = countPending();
  console.log(`[formatBackfill] starting pending=${pending.toLocaleString()} chunk=${chunkSize.toLocaleString()} all=${runAll} fast=${fast}`);

  if (fast) {
    const phases = [
      {
        label: 'missing_duration',
        sql: `UPDATE ingested_videos
              SET format_type='unknown',
                  format_confidence='low',
                  format_reason='missing_duration'
              WHERE format_reason IS NULL
                AND (duration_seconds IS NULL OR duration_seconds <= 0)`,
      },
      {
        label: 'duration_lte_60',
        sql: `UPDATE ingested_videos
              SET format_type='short_form',
                  format_confidence=CASE
                    WHEN title LIKE '%#short%' OR title LIKE '%ytshort%' OR title LIKE '%shortvideo%' OR title LIKE '%youtube short%'
                    THEN 'high' ELSE 'medium' END,
                  format_reason='duration_lte_60'
              WHERE format_reason IS NULL
                AND duration_seconds > 0
                AND duration_seconds <= 60`,
      },
      {
        label: 'likely_short_61_180',
        sql: `UPDATE ingested_videos
              SET format_type='likely_short_form',
                  format_confidence='medium',
                  format_reason='duration_lte_180+short_text_or_vertical_signal'
              WHERE format_reason IS NULL
                AND duration_seconds > 60
                AND duration_seconds <= 180
                AND (
                  title LIKE '%#short%'
                  OR title LIKE '%ytshort%'
                  OR title LIKE '%shortvideo%'
                  OR title LIKE '%youtube short%'
                  OR (thumbnail_width IS NOT NULL AND thumbnail_height IS NOT NULL AND thumbnail_width * 1.0 / thumbnail_height < 0.85)
                )`,
      },
      {
        label: 'unknown_61_180',
        sql: `UPDATE ingested_videos
              SET format_type='unknown',
                  format_confidence='low',
                  format_reason='duration_lte_180_no_short_signal'
              WHERE format_reason IS NULL
                AND duration_seconds > 60
                AND duration_seconds <= 180`,
      },
      {
        label: 'long_form_gt_180',
        sql: `UPDATE ingested_videos
              SET format_type='long_form',
                  format_confidence=CASE WHEN duration_seconds >= 600 THEN 'high' ELSE 'medium' END,
                  format_reason=CASE WHEN duration_seconds >= 600 THEN 'duration_gte_600' ELSE 'duration_gt_180' END
              WHERE format_reason IS NULL
                AND duration_seconds > 180`,
      },
    ];

    for (const phase of phases) {
      const t0 = Date.now();
      const info = db.prepare(phase.sql).run();
      totalUpdated += info.changes || 0;
      pending = countPending();
      console.log(`[formatBackfill] phase=${phase.label} updated=${(info.changes || 0).toLocaleString()} pending=${pending.toLocaleString()} ms=${Date.now() - t0}`);
    }

    console.log(`[formatBackfill] done updated=${totalUpdated.toLocaleString()} pending=${pending.toLocaleString()} elapsed_s=${((Date.now() - started) / 1000).toFixed(1)}`);
    printDistribution();
    return;
  }

  do {
    const rows = selectRows.all(chunkSize);
    if (!rows.length) break;
    const t0 = Date.now();
    updateTx(rows);
    totalUpdated += rows.length;
    pending = countPending();
    console.log(`[formatBackfill] chunk updated=${rows.length.toLocaleString()} total=${totalUpdated.toLocaleString()} pending=${pending.toLocaleString()} ms=${Date.now() - t0}`);
  } while (runAll && pending > 0);

  console.log(`[formatBackfill] done updated=${totalUpdated.toLocaleString()} pending=${pending.toLocaleString()} elapsed_s=${((Date.now() - started) / 1000).toFixed(1)}`);
  printDistribution();
} finally {
  db.close();
}

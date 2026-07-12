'use strict';

const express = require('express');
const router  = express.Router();
const { getDb }                         = require('../db/init');
const { computePrepublishIntelligence } = require('../services/prepublishIntelligence');

router.post('/prepublish/intelligence', async (req, res) => {
  const { title, niche, channel_id, duration_seconds } = req.body;
  if (!title?.trim()) return res.status(400).json({ error: 'title is required' });
  try {
    const db     = getDb();
    const result = await computePrepublishIntelligence(db, {
      title,
      niche:            niche            ?? null,
      channel_id:       channel_id       ?? null,
      duration_seconds: duration_seconds ?? null,
    });
    try {
      db.run(
        `INSERT INTO prepublish_shadow_log (
           title, channel_id, niche, calibration_niche,
           semantic_cluster, lifecycle_stage, saturation_level,
           duration_bucket, topic_signal_tier,
           legacy_data_adjustment, empirical_adjustment,
           calibration_cell_used, calibration_confidence,
           cell_level, negative_adjustment_status,
           request_json, result_json
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          title,
          channel_id       ?? null,
          niche            ?? null,
          result.calibration_niche           ?? null,
          result.semantic_cluster            ?? null,
          result.lifecycle_stage             ?? null,
          result.saturation_level            ?? null,
          result.niche_benchmark?.duration_bucket ?? null,
          result.topic_signals?.tier         ?? null,
          result.data_adjustment             ?? 0,
          result.empirical_adjustment        ?? 0,
          result.calibration_cell_used       ?? null,
          result.calibration_confidence      ?? null,
          result.cell_level                  ?? null,
          result.negative_adjustment_status  ?? null,
          JSON.stringify({ title, niche, channel_id, duration_seconds }),
          JSON.stringify(result),
        ],
      );
    } catch (logErr) {
      console.warn('[shadow-log]', logErr.message);
    }
    res.json(result);
  } catch (err) {
    console.error('[prepublish-intelligence]', err.message);
    res.status(500).json({ error: 'Intelligence fetch failed' });
  }
});

module.exports = router;

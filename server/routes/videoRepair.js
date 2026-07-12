'use strict';

const express = require('express');
const { computeRepair }   = require('../services/repair/repairEngine');
const { computeAiRepair } = require('../services/repair/aiRepairAdvisor');

const router = express.Router();

router.get('/repair/:videoId', (req, res) => {
  const { videoId } = req.params;
  const force = req.query.force === '1' || req.query.force === 'true';

  if (!videoId || videoId.length > 64) {
    return res.status(400).json({ error: 'invalid_video_id' });
  }

  try {
    const result = computeRepair(videoId, { force });
    if (result.error === 'video_not_found') {
      return res.status(404).json(result);
    }
    res.json(result);
  } catch (err) {
    console.error('[videoRepair] error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post('/repair/:videoId/ai', async (req, res) => {
  const { videoId } = req.params;

  if (!videoId || videoId.length > 64) {
    return res.status(400).json({ error: 'invalid_video_id' });
  }

  const { title, contentDescription, thumbnailDescription } = req.body ?? {};

  try {
    const result = await computeAiRepair(videoId, { title, contentDescription, thumbnailDescription });
    if (result.error === 'video_not_found') return res.status(404).json(result);
    res.json(result);
  } catch (err) {
    console.error('[videoRepair/ai] error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

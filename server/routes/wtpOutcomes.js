'use strict';

// WTP Outcome Tracking Routes
//
// All event endpoints return 204 No Content on success.
// The metrics endpoint returns JSON.
//
// Base path (mounted in index.js): /api/intel
//
//   POST /api/intel/wtp-outcomes/impression   — batch impression (ideas shown)
//   POST /api/intel/wtp-outcomes/save         — user saved a recommendation
//   POST /api/intel/wtp-outcomes/brief        — user generated a brief
//   POST /api/intel/wtp-outcomes/export       — user exported a recommendation
//   POST /api/intel/wtp-outcomes/video-match  — recommendation → published video
//   GET  /api/intel/wtp-outcomes/metrics      — funnel + per-source metrics

const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/wtpOutcomeController');

router.post('/wtp-outcomes/impression',  ctrl.impressionHandler);
router.post('/wtp-outcomes/save',        ctrl.saveHandler);
router.post('/wtp-outcomes/brief',       ctrl.briefHandler);
router.post('/wtp-outcomes/export',      ctrl.exportHandler);
router.post('/wtp-outcomes/video-match', ctrl.videoMatchHandler);
router.get( '/wtp-outcomes/metrics',     ctrl.metricsHandler);

module.exports = router;

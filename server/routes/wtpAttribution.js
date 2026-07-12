'use strict';

const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/wtpAttributionController');

router.get( '/wtp-attribution/pending', ctrl.pendingHandler);
router.post('/wtp-attribution/confirm', ctrl.confirmHandler);
router.post('/wtp-attribution/reject',  ctrl.rejectHandler);
router.get( '/wtp-attribution/stats',   ctrl.statsHandler);

module.exports = router;

'use strict';

const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/creatorIntelController');

router.get('/debug-country',               ctrl.debugCountryHandler);

router.get('/competitor/channels',         ctrl.competitorChannelsHandler);
router.get('/competitor/top-videos',       ctrl.competitorTopVideosHandler);
router.get('/competitor/velocity',         ctrl.competitorVelocityHandler);
router.get('/competitor/upload-frequency', ctrl.competitorUploadFrequencyHandler);
router.get('/competitor/format-breakdown', ctrl.competitorFormatBreakdownHandler);

router.get('/content/top-titles',          ctrl.contentTopTitlesHandler);
router.get('/content/durations',           ctrl.contentDurationsHandler);
router.get('/content/rising-formats',      ctrl.contentRisingFormatsHandler);
router.get('/content/patterns',            ctrl.contentPatternsHandler);

router.get('/trends/acceleration',         ctrl.trendsAccelerationHandler);
router.get('/trends/breakout',             ctrl.trendsBreakoutHandler);
router.get('/trends/benchmark-drift',      ctrl.trendsBenchmarkDriftHandler);
router.get('/trends/rising-archetypes',    ctrl.trendsRisingArchetypesHandler);
router.get('/trends/topics',               ctrl.trendsTopicsHandler);
router.get('/trends/coming-to-india',      ctrl.comingToIndiaHandler);
router.get('/trends/video-signals',        ctrl.videoSignalsHandler);
router.get('/trends/for-you',              ctrl.forYouTrendsHandler);

router.get('/maturity',                    ctrl.maturityHandler);
router.get('/community-hot',               ctrl.communityHotHandler);
router.get('/world-signals',               ctrl.worldSignalsHandler);
router.get('/current-events',              ctrl.currentEventsHandler);
router.get('/what-to-post',                ctrl.whatToPostHandler);
router.post('/original-bets/feedback',     ctrl.originalBetFeedbackHandler);
router.get('/topic-search',                ctrl.topicSearchHandler);
router.get('/adjacent-ideas',              ctrl.adjacentIdeasHandler);
router.get('/foreign-signal',              ctrl.foreignSignalHandler);
router.get('/trending-topics',             ctrl.trendingTopicsHandler);
router.get('/evolution/:channel_id',       ctrl.evolutionHandler);
router.get('/topic-trend',                 ctrl.topicTrendHandler);
router.get('/signals',                     ctrl.signalsHandler);
router.get('/signals/videos',              ctrl.signalsVideosHandler);
router.get('/lifecycle-health',            ctrl.lifecycleHealthHandler);

router.post('/channels/:id/niche',         ctrl.channelNicheHandler);
router.post('/channels/:id/redetect',      ctrl.redetectChannelHandler);
router.post('/channels/redetect-all',      ctrl.redetectAllStart);
router.get('/channels/redetect-all/:jobId', ctrl.redetectAllStatus);
router.get('/allowed-niches',              ctrl.allowedNichesHandler);
router.get('/niches',                      ctrl.nichesHandler);

module.exports = router;

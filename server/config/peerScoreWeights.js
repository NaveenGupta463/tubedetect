'use strict';

// Multi-dimensional peer routing weights.
// Derived empirically from 6,000 channel pairs (May 2026 routing audit).
// Lift values that drove these weights:
//   topic    0.0032   format 0.0013   style  0.0011   language 0.0007
//
// phrase is additive (not normalised): high content similarity is a direct
// positive signal regardless of dimension matches.
//
// To recalibrate: re-run server/scripts/routingAudit.js, update values here.
// Layer-2 rebalance (June 2026): `phrase` was 0.50 — nearly equal to `topic` (0.51) — so a
// "shares-words" channel (a music video and a talk show both saying "Ariana Grande") could rival
// a real same-niche peer on phrase overlap alone. Cut phrase to a within-niche REFINER (0.30) so
// the structural signals (niche/format/style/language) dominate ranking. Raised `language` (0.10→
// 0.16): it's now ~83% populated + guarded after the language backfill, so it's a reliable signal.
module.exports = {
  topic:    0.51,   // same primary_niche
  format:   0.21,   // same format_type
  style:    0.18,   // same content_archetype
  language: 0.16,   // same primary_language (raised — reliable post-backfill)
  phrase:   0.30,   // Jaccard similarity of content phrases (now a within-niche refiner, not a driver)
};

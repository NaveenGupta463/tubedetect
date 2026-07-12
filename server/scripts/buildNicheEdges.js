'use strict';

/**
 * Zero-quota script: build channel-to-channel graph edges from local corpus data.
 *
 * Edge families:
 *   - niche_size_peer: same niche/country, similar subscriber size
 *   - niche_language_archetype_peer: same niche/language/content archetype
 *   - territory_peer: same accepted/core territory
 *   - content_fingerprint_peer: shared fingerprint phrase inside niche/language
 *
 * Run: node server/scripts/buildNicheEdges.js
 */

const { getDb, closeDb } = require('../db/init');
const { buildRichNicheEdges } = require('../services/nicheEdgeBuilder');

const dryRun = process.argv.includes('--dry-run');

try {
  const db = getDb();
  const summary = buildRichNicheEdges(db, { write: !dryRun });

  console.log(`\nDone${dryRun ? ' (dry run)' : ''}.`);
  console.log(`  Channels processed : ${summary.channels}`);
  console.log(`  Edges generated    : ${summary.generated}`);
  console.log(`  Edges written      : ${summary.written}`);
  console.log(`  Graph before       : ${summary.before}`);
  console.log(`  Graph after        : ${summary.after}`);
  console.log(`  Net new edges      : ${summary.net_new}`);
  console.log(`  Size groups        : ${summary.size_groups}`);
  console.log(`  Archetype groups   : ${summary.archetype_groups}`);
  console.log(`  Territory groups   : ${summary.territory_groups}`);
  console.log(`  Fingerprint groups : ${summary.fingerprint_groups}`);
  console.log(`  By type            : ${JSON.stringify(summary.by_type)}`);

  closeDb();
} catch (e) {
  console.error('[buildNicheEdges] Error:', e.stack || e.message);
  try { closeDb(); } catch (_) {}
  process.exit(1);
}

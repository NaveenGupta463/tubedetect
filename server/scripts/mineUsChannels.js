'use strict';

// One-off bulk expansion: mine NEW US channels into the corpus.
// Iterates the full English keyword bank × both search orders against regionCode=US,
// bypassing the steady-state per-niche cooldown, with a relaxed admission gate
// (small-but-real creators count). Stops at MINE_TARGET new admits, keyword
// exhaustion, or quota exhaustion.
//
//   node scripts/mineUsChannels.js
//   MINE_TARGET=1500 node scripts/mineUsChannels.js

// Relax the admission gate BEFORE requiring discoveryAgent (gate consts read at load).
process.env.DISCOVERY_SEARCH_MIN_SUBS   ??= '100';
process.env.DISCOVERY_SEARCH_MIN_VIDEOS ??= '3';

require('dotenv').config({ path: __dirname + '/../.env' });

const { getDb } = require('../db/init');
const { discoverByNicheKeyword, NICHE_KEYWORDS } = require('../services/discoveryAgent');
const quotaGuard = require('../services/quotaGuard');

const TARGET = parseInt(process.env.MINE_TARGET ?? '1000', 10);

function coverage(db, label) {
  const row = db.get(
    `SELECT
       SUM(CASE WHEN discovery_source = 'us_keyword_search' THEN 1 ELSE 0 END) AS us_kw,
       SUM(CASE WHEN yt_country = 'US' OR country = 'US' THEN 1 ELSE 0 END) AS tagged_us,
       SUM(CASE WHEN yt_country IN ('US','GB') OR country IN ('US','GB') THEN 1 ELSE 0 END) AS tagged_usgb
     FROM corpus_channels`,
  );
  console.log(`\n── corpus (${label}) ── us_keyword_search=${row.us_kw}  country=US=${row.tagged_us}  country∈{US,GB}=${row.tagged_usgb}`);
  return row;
}

(async () => {
  const db = getDb();
  const before = coverage(db, 'before');
  const beforeUsKw = before.us_kw ?? 0;

  // Build task list: order outer (relevance first = higher admit), then niche × keyword.
  const niches = Object.keys(NICHE_KEYWORDS);
  const tasks = [];
  for (const order of ['relevance', 'date']) {
    for (const niche of niches) {
      for (const kw of (NICHE_KEYWORDS[niche] || [])) {
        tasks.push({ niche, kw, order });
      }
    }
  }
  console.log(`\nMining US channels — target=${TARGET} new admits | ${tasks.length} candidate searches available\n`);

  let admitted = 0, searches = 0, consecutiveEmpty = 0;
  const t0 = Date.now();

  for (const { niche, kw, order } of tasks) {
    if (admitted >= TARGET) { console.log(`\n✓ Target reached (${admitted} >= ${TARGET}).`); break; }
    if (!quotaGuard.quotaAvailable(101)) { console.log('\n⚠ In-memory quota budget reached — stopping.'); break; }
    if (consecutiveEmpty >= 10) { console.log('\n⚠ 10 consecutive empty searches (likely all API keys exhausted) — stopping.'); break; }

    const found = await discoverByNicheKeyword(db, niche, 'us', {
      keywordOverride: kw,
      ignoreCooldown:  true,
      orderOverride:   order,
    });
    searches++;
    admitted += found.length;
    consecutiveEmpty = found.length > 0 ? 0 : consecutiveEmpty + 1;

    if (searches % 10 === 0 || found.length > 0) {
      const used = quotaGuard.getStats().used;
      console.log(`  [${searches}] +${found.length} (total ${admitted}/${TARGET}) | quota_used=${used}`);
    }
    await new Promise(r => setTimeout(r, 200));
  }

  const after = coverage(db, 'after');
  const netNew = (after.us_kw ?? 0) - beforeUsKw;
  const stats = quotaGuard.getStats();
  console.log(`\n════════ DONE ════════`);
  console.log(`  searches run:        ${searches}`);
  console.log(`  new admits (this run): ${admitted}`);
  console.log(`  net new us_keyword_search rows: ${netNew}`);
  console.log(`  quota used (units):  ${stats.used}`);
  console.log(`  elapsed:             ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  process.exit(0);
})().catch(e => { console.error('FATAL:', e); process.exit(1); });

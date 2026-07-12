'use strict';

/**
 * Ingest US/UK (English) channels from the corpus into the live system.
 * Reuses the exact onboarding pipeline (onboardChannel) — fetch → cache → upsert →
 * country/lang detect → niche classify → store videos → build DNA → enable.
 *
 * Selects corpus channels with REAL content (video_count >= 5, not spam/low-quality)
 * that aren't ingested yet. Idempotent/resumable (already-onboarded channels early-return
 * with zero API cost). Each new channel ≈ 3 YouTube API units.
 *
 * Usage:
 *   node scripts/ingestUsUkBatch.js --dry-run               # list what would ingest
 *   node scripts/ingestUsUkBatch.js --limit=25              # ingest 25 (test)
 *   node scripts/ingestUsUkBatch.js --limit=400             # larger batch
 *   node scripts/ingestUsUkBatch.js --countries=US,GB,CA,AU --limit=500
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { getDb } = require('../db/init');
const { onboardChannel } = require('../routes/onboarding');
const { getApiKey, markExhausted, isQuotaError } = require('../services/apiKeyManager');

const arg = (k, d) => { const a = process.argv.find(s => s.startsWith(`--${k}=`)); return a ? a.split('=')[1] : d; };
const DRY_RUN   = process.argv.includes('--dry-run');
const LIMIT     = Number(arg('limit', DRY_RUN ? 100000 : 25));
const COUNTRIES = String(arg('countries', 'US,GB')).toUpperCase().split(',').map(s => s.trim()).filter(Boolean);
// --source=us_keyword_search,gb_keyword_search → select by discovery_source instead of country
// (mined channels often have NULL country since YouTube omits snippet.country).
const SOURCES   = String(arg('source', '')).split(',').map(s => s.trim()).filter(Boolean);
const MINVIDEOS = Number(arg('minvideos', 5));
const SLEEP_MS  = Number(arg('sleep', 300));

const sleep = ms => new Promise(r => setTimeout(r, ms));
function mockRes() {
  const cap = {};
  const res = { status(c) { cap.code = c; return res; }, json(b) { cap.code = cap.code || 200; cap.body = b; return cap; } };
  return { res, cap };
}

(async () => {
  if (!getApiKey('ingest')) { console.error('No ingest-lane API keys available'); process.exit(1); }
  const db = getDb();

  const useSource = SOURCES.length > 0;
  const sel       = useSource ? SOURCES : COUNTRIES;
  const ph        = sel.map(() => '?').join(',');
  const whereCol  = useSource ? 'cc.discovery_source' : 'cc.yt_country';
  const rows = db.all(`
    SELECT cc.channel_id, cc.title, cc.yt_country, cc.subscriber_count, cc.video_count
    FROM corpus_channels cc
    LEFT JOIN ingested_channels ic ON ic.channel_id = cc.channel_id
    WHERE ${whereCol} IN (${ph})
      AND COALESCE(cc.video_count,0) >= ?
      AND COALESCE(cc.is_spam,0)=0 AND COALESCE(cc.is_low_quality,0)=0
      AND (ic.channel_id IS NULL OR ic.ingest_enabled IS NULL OR ic.ingest_enabled = 0)
    ORDER BY cc.subscriber_count DESC
    LIMIT ?`, [...sel, MINVIDEOS, LIMIT]);

  console.log(`[ingest] ${useSource ? 'sources' : 'countries'}=${sel.join(',')}  minVideos=${MINVIDEOS}  candidates=${rows.length}  dry-run=${DRY_RUN}`);
  if (DRY_RUN) {
    rows.slice(0, 40).forEach((r, i) => console.log(`  ${i + 1}. [${r.yt_country}] ${(r.subscriber_count || 0).toLocaleString()} subs  ${r.title}`));
    console.log(`\n[ingest] DRY RUN — ${rows.length} channels would be ingested (~${rows.length * 3} YouTube API units). No changes.`);
    return;
  }

  let ok = 0, already = 0, fail = 0;
  for (const [i, r] of rows.entries()) {
    const apiKey = getApiKey('ingest');
    if (!apiKey) { console.log('  ⚠ all ingest-lane keys exhausted for today — stopping (resume tomorrow).'); break; }
    const { res, cap } = mockRes();
    try {
      await onboardChannel(db, r.channel_id, apiKey, res);
      const b = cap.body || {};
      if (b.already_existed) { already++; }
      else if (b.error) { fail++; if (isQuotaError(b.error)) markExhausted(apiKey); console.log(`  ✗ ${r.title}: ${b.error}`); }
      else { ok++; console.log(`  ✓ [${b.region || r.yt_country}] ${b.name || r.title} → niche=${b.niche} videos=${b.videos_stored} dna=${b.creator_dna?.ok ? 'y' : 'n'}`); }
    } catch (e) { fail++; console.log(`  ✗ ${r.title}: ${e.message}`); }
    if ((i + 1) % 25 === 0) console.log(`  … ${i + 1}/${rows.length} (ok=${ok} already=${already} fail=${fail})`);
    await sleep(SLEEP_MS);
  }
  console.log(`\n[ingest] DONE. ingested=${ok}  already=${already}  failed=${fail}  total=${rows.length}`);
})().catch(e => { console.error('FATAL', e); process.exit(1); });

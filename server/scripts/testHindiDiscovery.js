'use strict';

/**
 * Session 2D — Test Hindi Discovery Quality
 *
 * Runs Hindi keyword searches for 3 niches, enriches the discovered
 * channels with real YouTube data, runs language detection, and prints
 * a quality report showing what % of results are actually Hindi.
 *
 * Quota cost: 300 units (3 searches) + 1 unit per 50 channels fetched.
 *
 * Run with:  node server/scripts/testHindiDiscovery.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { getDb }                    = require('../db/init');
const { discoverByNicheKeyword }   = require('../services/discoveryAgent');
const { detectLanguageForChannel } = require('../services/languageDetector');

const YT_BASE    = 'https://www.googleapis.com/youtube/v3';
const TEST_NICHES = ['finance', 'education', 'business'];

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function ytFetch(endpoint, params) {
  const key = process.env.YT_API_KEY || process.env.YOUTUBE_API_KEY;
  if (!key) throw new Error('No API key — set YT_API_KEY in .env');
  const url = new URL(`${YT_BASE}/${endpoint}`);
  url.searchParams.set('key', key);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const resp = await fetch(url.toString());
  const data = await resp.json();
  if (!resp.ok) throw new Error(data?.error?.message || `YouTube ${resp.status}`);
  return data;
}

function fmtSubs(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000)     return Math.round(n / 1_000) + 'K';
  return String(n);
}

async function main() {
  const db     = getDb();
  const before = db.get('SELECT COUNT(*) AS n FROM corpus_channels').n;

  console.log('\n[hindiDiscovery] Session 2D — Hindi Discovery Quality Test');
  console.log(`Corpus before: ${before} channels\n`);

  // ── Step 1: Run Hindi keyword searches ─────────────────────────────────────
  const allNewIds = [];
  for (const niche of TEST_NICHES) {
    console.log(`Searching niche "${niche}" with Hindi keywords...`);
    const found = await discoverByNicheKeyword(db, niche, 10, 'hi');
    allNewIds.push(...found);
    console.log(`  → ${found.length} new channels queued\n`);
    if (found.length > 0) await sleep(300);
  }

  if (!allNewIds.length) {
    console.log('No new channels discovered — all returned channels were already in corpus.');
    console.log('This is normal if corpus already contains many Hindi channels.');
    console.log('Try running again tomorrow (hourly keyword rotation) or check a different niche.\n');
    return;
  }

  console.log(`Total new channels to enrich: ${allNewIds.length}`);

  // ── Step 2: Fetch real channel details (title, language, country, subs) ───
  console.log('\nFetching real channel details from YouTube API...');
  for (let i = 0; i < allNewIds.length; i += 50) {
    const batch = allNewIds.slice(i, i + 50);
    const data  = await ytFetch('channels', {
      part: 'snippet,statistics',
      id:   batch.join(','),
    });
    for (const item of data.items ?? []) {
      db.run(
        `UPDATE corpus_channels SET
           title               = ?,
           yt_default_language = ?,
           yt_country          = ?,
           subscriber_count    = ?
         WHERE channel_id = ?`,
        [
          item.snippet.title,
          item.snippet.defaultLanguage ?? null,
          item.snippet.country ?? null,
          parseInt(item.statistics?.subscriberCount ?? '0', 10),
          item.id,
        ],
      );
    }
    await sleep(300);
  }

  // ── Step 3: Run language detection on each discovered channel ──────────────
  console.log('Running language detection...\n');
  const results = [];
  for (const channelId of allNewIds) {
    const profile = detectLanguageForChannel(db, channelId);
    const ch      = db.get(
      'SELECT title, yt_default_language, yt_country, subscriber_count, niche FROM corpus_channels WHERE channel_id = ?',
      [channelId],
    );
    results.push({
      channelId,
      title:      ch?.title ?? channelId,
      subs:       ch?.subscriber_count ?? 0,
      niche:      ch?.niche ?? '—',
      yt_lang:    ch?.yt_default_language ?? '—',
      yt_country: ch?.yt_country ?? '—',
      detected:   profile?.primary ?? '?',
      confidence: profile?.confidence ?? 0,
      method:     profile?.method ?? '?',
    });
  }

  // ── Step 4: Print quality report ───────────────────────────────────────────
  console.log('── Quality Report ──────────────────────────────────────────────────────────────');
  console.log(`  ${'Title'.padEnd(40)} ${'Subs'.padStart(6)}  ${'Niche'.padEnd(12)} ${'YT'.padEnd(4)}  ${'Detected'.padEnd(8)}  Conf  Method`);
  console.log('  ' + '─'.repeat(96));

  for (const r of results.sort((a, b) => b.subs - a.subs)) {
    const title  = r.title.length > 38 ? r.title.slice(0, 36) + '..' : r.title;
    const flag   = r.detected === 'hi' ? '✓' : '✗';
    const conf   = Math.round(r.confidence * 100) + '%';
    console.log(
      `  ${flag} ${title.padEnd(39)} ${fmtSubs(r.subs).padStart(6)}  ${r.niche.padEnd(12)} ${r.yt_lang.padEnd(4)}  ${r.detected.padEnd(8)}  ${conf.padStart(4)}  ${r.method}`,
    );
  }

  // ── Step 5: Summary ────────────────────────────────────────────────────────
  const hindiCount  = results.filter(r => r.detected === 'hi').length;
  const pct         = results.length ? Math.round(hindiCount / results.length * 100) : 0;
  const methodTally = {};
  for (const r of results) methodTally[r.method] = (methodTally[r.method] ?? 0) + 1;

  const after = db.get('SELECT COUNT(*) AS n FROM corpus_channels').n;

  console.log('\n── Summary ────────────────────────────────────────────────');
  console.log(`  New channels discovered:  ${results.length}`);
  console.log(`  Detected as Hindi (hi):   ${hindiCount} / ${results.length}  (${pct}%)`);
  console.log(`  Other languages:          ${results.length - hindiCount}`);
  console.log(`  Corpus size:              ${before} → ${after} (+${after - before})`);
  console.log('\n  Detection methods:');
  for (const [m, n] of Object.entries(methodTally).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${m.padEnd(24)} ${n}`);
  }

  if (pct >= 60) {
    console.log('\n  Result: GOOD — majority of discovered channels are Hindi.');
    console.log('  The Hindi keyword bank is working. Ready for Phase 3 (Tamil seeds).');
  } else if (pct >= 30) {
    console.log('\n  Result: MIXED — roughly half are Hindi. Consider adding more specific keywords.');
  } else {
    console.log('\n  Result: POOR — most channels are not Hindi. Keywords may need refinement.');
    console.log('  Check which niches returned non-Hindi channels and tighten their keyword lists.');
  }

  console.log('\nNext: run node server/scripts/runLanguageDetection.js to tag all newly discovered channels.\n');
}

main().catch(e => { console.error('[error]', e.message); process.exit(1); });

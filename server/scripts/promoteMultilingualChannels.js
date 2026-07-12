'use strict';

/**
 * Promote quality multilingual channels from corpus_channels → ingested_channels.
 *
 * Problem: comment_harvest_IN dumped ~47K channel IDs into corpus — mostly dead commenter
 * accounts. The keyword/video searches for regional languages found real channels but
 * they're sitting at ingest_depth=0 because they got mixed in with the noise.
 *
 * This script filters for signal: channels from search-based discovery sources
 * that pass a minimum quality bar (not spam, not low quality, subscriber + video thresholds).
 *
 * Run: node server/scripts/promoteMultilingualChannels.js [--dry-run]
 */

const path     = require('path');
const crypto   = require('crypto');
const Database = require(path.join(__dirname, '../node_modules/better-sqlite3'));

const DB_PATH = path.join(__dirname, '../data/scoring.db');
const db      = new Database(DB_PATH);

const DRY_RUN = process.argv.includes('--dry-run');

// Only promote channels that came from intentional search — not comment harvesting
const QUALITY_SOURCES = [
  'keyword_search_IN',
  'video_search_IN',
  'emerging_IN',
  'trending_IN',
  'hindi_keyword_search',
  'tamil_keyword_search',
  'telugu_keyword_search',
  'bengali_keyword_search',
  'kannada_keyword_search',
  'malayalam_keyword_search',
  'punjabi_keyword_search',
  'arabic_keyword_search',
  'spanish_keyword_search',
  'portuguese_keyword_search',
  'indonesian_keyword_search',
  'keyword_search',
  'video_search_en',
  'video_search_hi',
  'video_search_ta',
  'video_search_te',
  'video_search_pa',
  'video_search_ar',
  'video_search_pt',
  'video_search_id',
  'ai_discovery',
  'manual',
];

const MIN_SUBSCRIBERS = 250;
const MIN_VIDEOS      = 5;

const sourcePlaceholders = QUALITY_SOURCES.map(() => '?').join(',');

// Candidates: in corpus, not yet ingested, from search sources, passes quality bar
const candidates = db.prepare(`
  SELECT
    cc.channel_id,
    cc.title,
    cc.niche,
    cc.language,
    cc.country,
    cc.subscriber_count,
    cc.video_count,
    cc.uploads_playlist_id,
    cc.discovery_source,
    cc.community_id
  FROM corpus_channels cc
  WHERE cc.ingest_depth = 0
    AND cc.is_spam = 0
    AND cc.is_low_quality = 0
    AND cc.subscriber_count >= ?
    AND cc.video_count >= ?
    AND cc.discovery_source IN (${sourcePlaceholders})
    AND cc.channel_id NOT IN (SELECT channel_id FROM ingested_channels)

  ORDER BY cc.subscriber_count DESC
`).all(MIN_SUBSCRIBERS, MIN_VIDEOS, ...QUALITY_SOURCES);

// Language label for logging
function langLabel(lang) {
  const map = {
    hi: 'Hindi', ta: 'Tamil', te: 'Telugu', bn: 'Bengali',
    kn: 'Kannada', ml: 'Malayalam', pa: 'Punjabi', mr: 'Marathi',
    ar: 'Arabic', es: 'Spanish', pt: 'Portuguese', id: 'Indonesian',
    en: 'English', 'en-IN': 'English (India)', 'en-GB': 'English (UK)',
  };
  return map[lang] || lang || 'unknown';
}

// Group by language for summary
const byLang = {};
for (const ch of candidates) {
  const key = ch.language || 'unknown';
  (byLang[key] = byLang[key] || []).push(ch);
}

console.log(`\nPromotion candidates found: ${candidates.length}`);
console.log(`  Min subscribers : ${MIN_SUBSCRIBERS.toLocaleString()}`);
console.log(`  Min videos      : ${MIN_VIDEOS}`);
console.log(`  Mode            : ${DRY_RUN ? 'DRY RUN (no changes written)' : 'LIVE'}`);
console.log('\nBreakdown by language:');
for (const [lang, chs] of Object.entries(byLang).sort((a, b) => b[1].length - a[1].length)) {
  console.log(`  ${langLabel(lang).padEnd(20)} ${chs.length} channels`);
}
console.log('');

if (DRY_RUN) {
  console.log('Sample (first 20):');
  for (const ch of candidates.slice(0, 20)) {
    console.log(`  [${(ch.language || '??').padEnd(6)}] ${String(ch.subscriber_count).padStart(10)} subs | ${String(ch.video_count).padStart(5)} videos | ${ch.title}`);
  }
  console.log('\nRe-run without --dry-run to promote.');
  db.close();
  process.exit(0);
}

const insert = db.prepare(`
  INSERT INTO ingested_channels
    (id, channel_id, channel_name, niche, uploads_playlist_id, channel_subscribers,
     added_by, notes, community_id)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(channel_id) DO NOTHING
`);

const markDepth = db.prepare(
  'UPDATE corpus_channels SET ingest_depth = 1 WHERE channel_id = ?'
);

let promoted = 0;
let skipped  = 0;

const promote = db.transaction(() => {
  for (const ch of candidates) {
    const result = insert.run(
      crypto.randomUUID(),
      ch.channel_id,
      ch.title,
      ch.niche || 'other',
      ch.uploads_playlist_id || null,
      ch.subscriber_count,
      'corpus_promotion',
      `Promoted from corpus — source: ${ch.discovery_source}, lang: ${ch.language}`,
      ch.community_id || null,
    );
    if (result.changes > 0) {
      markDepth.run(ch.channel_id);
      promoted++;
    } else {
      skipped++;
    }
  }
});

promote();

console.log(`Done.`);
console.log(`  Promoted : ${promoted}`);
console.log(`  Skipped  : ${skipped} (already existed)`);
console.log(`\nThese channels will be picked up on the next corpus scheduler run for video ingestion.`);

db.close();

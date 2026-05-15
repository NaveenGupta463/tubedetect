'use strict';

/**
 * Romanized Hindi word bank miner
 *
 * Run this AFTER ingesting Hindi seed channels to find new Romanized Hindi
 * words that appear in real channel titles. Compares word frequency between
 * known-Hindi channels (those with Devanagari titles) vs English-only channels.
 * Words that appear proportionally more in Hindi channels are Romanized Hindi candidates.
 *
 * Run with:  node server/scripts/mineRomanizedWords.js
 *
 * Review the output and manually add good words to ROMANIZED_BANKS in languageDetector.js.
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { getDb } = require('../db/init');

const ENGLISH_STOP = new Set([
  'the','and','for','with','from','that','this','are','has','have','been','will',
  'your','their','they','our','about','more','than','when','what','how','why','who',
  'where','which','was','were','its','you','can','not','but','all','any','out',
  'get','one','new','now','just','like','live','see','use','way','day','time',
  'show','said','make','know','only','back','into','over','after','full','first',
  'last','here','well','even','long','must','does','did','him','her','his','she',
  'them','too','ago','per','yet','put','end','run','law','war','set','own','far',
  'key','video','watch','real','true','part','high','old','man','may','yes','off',
  'news','india','hindi','live','update','latest','breaking','report','special',
  'exclusive','today','press','conference','interview','election','vote','police',
  'court','attack','issue','case','fire','channel','world','review','best','tips',
  'top','free','watch','share','subscribe','like','comment','follow','click','link',
  'also','very','good','great','right','left','come','going','want','need','said',
  'says','tell','told','take','took','think','thought','bring','brought','give',
  'gave','show','shows','shown','keep','kept','find','found','let','lets','try',
]);

function main() {
  const db = getDb();
  const devanagariRe = /[ऀ-ॿ]/;
  const latinWordRe  = /\b[a-z]{3,15}\b/g;

  const allTitles = db.all(
    'SELECT cv.channel_id, cv.title FROM corpus_videos cv WHERE cv.title IS NOT NULL',
  );

  // Identify channels with any Devanagari (our Hindi signal)
  const hindiChannels = new Set();
  for (const row of allTitles) {
    if (devanagariRe.test(row.title)) hindiChannels.add(row.channel_id);
  }

  // Count words in Hindi vs English channels
  const hindiFreq = {}, englishFreq = {};
  let hindiTitleCount = 0, englishTitleCount = 0;

  for (const row of allTitles) {
    const isHindi = hindiChannels.has(row.channel_id);
    const words = row.title.toLowerCase().match(latinWordRe) ?? [];
    for (const w of words) {
      if (ENGLISH_STOP.has(w)) continue;
      if (isHindi) { hindiFreq[w] = (hindiFreq[w] ?? 0) + 1; }
      else         { englishFreq[w] = (englishFreq[w] ?? 0) + 1; }
    }
    if (isHindi) hindiTitleCount++; else englishTitleCount++;
  }

  // Score: ratio of appearance rate in Hindi vs English channels
  const MIN_HINDI_COUNT = 5;
  const candidates = [];
  for (const [w, hCount] of Object.entries(hindiFreq)) {
    if (hCount < MIN_HINDI_COUNT) continue;
    const eCount = englishFreq[w] ?? 0;
    const hRate  = hCount / hindiTitleCount;
    const eRate  = (eCount + 1) / englishTitleCount;
    const ratio  = hRate / eRate;
    if (ratio >= 10) candidates.push({ word: w, ratio: Math.round(ratio), hindiCount: hCount, englishCount: eCount });
  }

  candidates.sort((a, b) => b.ratio - a.ratio);

  console.log(`\n[mineRomanizedWords] Corpus stats`);
  console.log(`  Hindi channels (have Devanagari titles): ${hindiChannels.size}`);
  console.log(`  Hindi titles scanned:   ${hindiTitleCount}`);
  console.log(`  English titles scanned: ${englishTitleCount}`);
  console.log(`\nTop Romanized Hindi word candidates (ratio = how much more common in Hindi channels):`);
  console.log(`(Review these and add suitable ones to ROMANIZED_BANKS.hi in languageDetector.js)\n`);

  candidates.slice(0, 100).forEach(c => {
    console.log(`  ${c.word.padEnd(20)} ${String(c.ratio).padStart(5)}x  (Hindi: ${c.hindiCount}, English: ${c.englishCount})`);
  });

  console.log(`\nTotal candidates with ratio >= 10x: ${candidates.length}`);
  console.log(`\nRun this script again after ingesting Hindi seed channels for richer results.`);
}

main();

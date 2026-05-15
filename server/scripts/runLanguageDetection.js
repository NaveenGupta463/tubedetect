'use strict';

/**
 * Session 2B — Run language detection on all corpus channels
 *
 * Processes every channel in corpus_channels that doesn't have a
 * language_profile yet. Logs progress and a summary breakdown.
 *
 * Run with:  node server/scripts/runLanguageDetection.js
 * Re-run safely — already-detected channels are skipped.
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { getDb }                   = require('../db/init');
const { detectLanguageForChannel } = require('../services/languageDetector');

const BATCH_SIZE = 50;

async function main() {
  const db = getDb();

  const pending = db.all(
    `SELECT channel_id, title FROM corpus_channels
     WHERE language_profile IS NULL
     ORDER BY subscriber_count DESC`,
  );

  console.log(`\n[langDetect] ${pending.length} channels to process\n`);
  if (!pending.length) { console.log('Nothing to do.'); return; }

  const summary = { total: 0, byMethod: {}, byLang: {}, errors: 0 };
  const startTime = Date.now();

  for (let i = 0; i < pending.length; i += BATCH_SIZE) {
    const batch = pending.slice(i, i + BATCH_SIZE);

    for (const ch of batch) {
      try {
        const profile = detectLanguageForChannel(db, ch.channel_id);
        if (!profile) { summary.errors++; continue; }

        summary.total++;
        summary.byMethod[profile.method] = (summary.byMethod[profile.method] ?? 0) + 1;
        summary.byLang[profile.primary]  = (summary.byLang[profile.primary]  ?? 0) + 1;
      } catch (e) {
        console.warn(`  [warn] ${ch.title}: ${e.message}`);
        summary.errors++;
      }
    }

    const done    = Math.min(i + BATCH_SIZE, pending.length);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    process.stdout.write(`\r  Progress: ${done}/${pending.length} (${elapsed}s)`);
  }

  console.log('\n\n── Detection complete ──────────────────────────────────');
  console.log(`  Processed: ${summary.total}   Errors: ${summary.errors}`);

  console.log('\n  By method:');
  for (const [method, count] of Object.entries(summary.byMethod).sort((a,b) => b[1]-a[1])) {
    console.log(`    ${method.padEnd(22)} ${count}`);
  }

  console.log('\n  By language (top 15):');
  const topLangs = Object.entries(summary.byLang).sort((a,b) => b[1]-a[1]).slice(0, 15);
  for (const [lang, count] of topLangs) {
    const bar = '█'.repeat(Math.round(count / summary.total * 40));
    console.log(`    ${lang.padEnd(6)} ${String(count).padStart(4)}  ${bar}`);
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n  Total time: ${elapsed}s`);
  console.log('\nTip: run node server/scripts/mineRomanizedWords.js after ingesting Hindi seeds');
  console.log('     to expand the Romanized Hindi word bank.\n');
}

main().catch(e => { console.error(e.message); process.exit(1); });

'use strict';

// primaryLanguageJob.js
// Detects and writes primary_language for every ingested channel using stored
// video titles — no API calls, runs entirely from local DB data.
//
// Detection logic (per channel, using up to 30 recent titles):
//   ≥30% Devanagari/Indian script titles           → 'hi'
//   ≥25% Hinglish (Roman-script Hindi) titles      → 'hi'
//   ≥40% non-Latin non-Indian script titles        → country code from detectScript
//   ≥60% clean Latin titles (no Hinglish)          → 'en'
//   Otherwise                                      → null (leave unset)

const { getDb } = require('../db/init');
const { detectScript, hinglishScore, southIndianRomanScore } = require('./languageDetectionJob');

// Re-use the same regex already in languageDetectionJob for Indian scripts
const INDIAN_SCRIPT_RE = /[ऀ-ॿ਀-੿ঀ-৿ఀ-౿஀-௿ಀ-೿ഀ-ൿ]/;

function detectLanguageFromTitles(titles) {
  if (!titles || titles.length < 3) return null;

  let indian = 0;     // Devanagari / South Indian scripts
  let otherScript = 0; // Korean, Arabic, CJK, etc.
  let hinglish = 0;   // Roman-script Hindi/South Indian
  let clean = 0;      // Plain Latin with no regional signal

  for (const t of titles) {
    if (!t) continue;

    // Non-Latin scripts
    const scriptCountry = detectScript(t);
    if (scriptCountry) {
      if (scriptCountry === 'IN') indian++;
      else otherScript++;
      continue;
    }

    // Catch Indian scripts not covered by detectScript (belt-and-suspenders)
    if (INDIAN_SCRIPT_RE.test(t)) { indian++; continue; }

    // Latin-script: check for Hinglish / South Indian Roman
    const hs = hinglishScore(t);
    const si = southIndianRomanScore ? southIndianRomanScore(t) : 0;
    if (hs >= 2 || si >= 2) { hinglish++; continue; }
    if (hs >= 1 || si >= 1) { hinglish += 0.5; continue; }

    clean++;
  }

  const total = indian + otherScript + hinglish + clean;
  if (total < 3) return null;

  if (indian / total >= 0.30)                 return 'hi';
  if ((indian + hinglish) / total >= 0.25)    return 'hi';
  if (otherScript / total >= 0.40) {
    // Find the dominant non-Indian script country code
    for (const t of titles) {
      const c = detectScript(t);
      if (c && c !== 'IN') return c.toLowerCase();
    }
  }
  if (clean / total >= 0.60)                  return 'en';

  return null; // not enough signal
}

// ── Backfill runner ───────────────────────────────────────────────────────────
// Processes all channels with primary_language IS NULL in batches.
// Safe to run multiple times — skips channels with an existing value.

async function runPrimaryLanguageBackfill({ batchSize = 300, verbose = false } = {}) {
  const db = getDb();

  const channels = db.all(`
    SELECT ic.channel_id
    FROM ingested_channels ic
    WHERE ic.primary_language IS NULL
      AND EXISTS (
        SELECT 1 FROM ingested_videos iv
        WHERE iv.channel_id = ic.channel_id LIMIT 1
      )
  `);

  if (!channels.length) {
    if (verbose) console.log('[primaryLang] Nothing to backfill — all channels already classified.');
    return { updated: 0, skipped: 0, total: 0 };
  }

  console.log(`[primaryLang] Backfill starting — ${channels.length} channels with null primary_language`);

  let updated = 0, skipped = 0;

  for (let i = 0; i < channels.length; i += batchSize) {
    const batch   = channels.slice(i, i + batchSize);
    const ids     = batch.map(c => c.channel_id);
    const ph      = ids.map(() => '?').join(',');

    // Fetch up to 30 recent titles per channel in one query
    const titleRows = db.all(`
      SELECT channel_id, title FROM (
        SELECT channel_id, title,
               ROW_NUMBER() OVER (PARTITION BY channel_id ORDER BY published_at DESC) AS rn
        FROM ingested_videos
        WHERE channel_id IN (${ph}) AND title IS NOT NULL
      ) WHERE rn <= 30
    `, ids);

    const titlesByChannel = {};
    for (const { channel_id, title } of titleRows) {
      (titlesByChannel[channel_id] = titlesByChannel[channel_id] || []).push(title);
    }

    for (const { channel_id } of batch) {
      const lang = detectLanguageFromTitles(titlesByChannel[channel_id] || []);
      if (lang) {
        db.run(
          'UPDATE ingested_channels SET primary_language = ? WHERE channel_id = ?',
          [lang, channel_id],
        );
        updated++;
      } else {
        skipped++;
      }
    }

    if (verbose || i % 3000 === 0) {
      console.log(`[primaryLang] ${Math.min(i + batchSize, channels.length)}/${channels.length} processed (${updated} set, ${skipped} unclear)`);
    }
  }

  console.log(`[primaryLang] Backfill done — set: ${updated}, unclear (left null): ${skipped}, total: ${channels.length}`);
  return { updated, skipped, total: channels.length };
}

// ── Single-channel detection (call from onboarding after video ingest) ────────
function detectAndSaveLanguage(channelId) {
  const db = getDb();

  // Already set — don't overwrite
  const existing = db.get('SELECT primary_language FROM ingested_channels WHERE channel_id = ?', [channelId]);
  if (existing?.primary_language) return existing.primary_language;

  const titleRows = db.all(`
    SELECT title FROM ingested_videos
    WHERE channel_id = ? AND title IS NOT NULL
    ORDER BY published_at DESC LIMIT 30
  `, [channelId]);

  const lang = detectLanguageFromTitles(titleRows.map(r => r.title));
  if (lang) {
    db.run('UPDATE ingested_channels SET primary_language = ? WHERE channel_id = ?', [lang, channelId]);
  }
  return lang;
}

// ── Startup runner (non-blocking) ─────────────────────────────────────────────
// Called from index.js — runs in background, doesn't hold up server start.
function startPrimaryLanguageBackfill() {
  // No startup run — run via: node pipeline.js
}

module.exports = { detectLanguageFromTitles, detectAndSaveLanguage, runPrimaryLanguageBackfill, startPrimaryLanguageBackfill };

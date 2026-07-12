'use strict';

// ── Content fingerprint backfill ──────────────────────────────────────────────
// Computes and stores content_fingerprint for all ingested channels.
// The fingerprint = top 30 recurring bigrams/trigrams from the channel's own
// last 100 video titles. Used by What-to-Post and Community-Hot to find true
// content peers without relying on niche/community_id classifications.
//
// Run: automatically as step 0 of pipeline.js
// First run: ~60-120s to process all channels; subsequent runs only update
//            channels that received new videos since the last backfill.

const { getDb } = require('../db/init');

const SOUTH_SCRIPT_RE = /[஀-௿ఀ-౿ಀ-೿ഀ-ൿ]/;
const DEVANAGARI_RE   = /[ऀ-ॿ]/;

const STOPWORDS = new Set([
  'a','an','the','in','on','of','for','to','and','or','is','are','was','were',
  'be','been','how','why','when','what','which','this','that','these','those',
  'my','your','his','her','our','its','with','by','at','from','will','can',
  'did','do','does','has','have','had','get','got','not','no','all','but',
  'so','if','as','up','out','now','just','only','also','even','than','then',
  'new','top','best','review','video','part','full','episode',
  'you','he','she','they','we','it','me','him','them','us',
  'must','should','could','would','may','might','shall',
  'old','hello','namaskar','namaste','blowing','doing','tells','about',
  'january','february','march','april','may','june','july','august',
  'september','october','november','december',
  'hai','hain','hoga','kya','kaise','mera','meri','mere','aap','main',
  'yeh','woh','ek','nahi','aur','se','ko','ka','ki','ke','mein','hum',
  'bhi','toh','koi','kuch','sirf','sab','tha','thi','the','raha','rahi',
  'love','like','life','time','come','know','feel','want','need',
  'shorts','viral','trending','subscribe','comment','share','follow',
]);

const HOOK_PHRASES = new Set([
  'year old','years old','you must','must do','must watch','must know',
  'no one','one tells','mind blowing','mind blown',
  'about money','about life','about this',
  'hello namaskar','hello namaste','real reason','real talk',
  'stop doing','stop this',
]);

function extractPhrases(title) {
  if (!title || SOUTH_SCRIPT_RE.test(title)) return [];
  const tokens = title
    .replace(/#\w+/g, ' ')
    .replace(/\|{2}[^|]+\|{2}/g, ' ')
    .toLowerCase()
    .replace(/[|()[\]{}#@!?,।॥।\-''']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(w => w.length > 2 && !STOPWORDS.has(w) && !/^\d+$/.test(w) && !/^\d{4}$/.test(w) && !DEVANAGARI_RE.test(w));

  const phrases = [];
  for (let i = 0; i < tokens.length - 1; i++) {
    const b = `${tokens[i]} ${tokens[i + 1]}`;
    if (!HOOK_PHRASES.has(b)) phrases.push(b);
  }
  for (let i = 0; i < tokens.length - 2; i++) {
    phrases.push(`${tokens[i]} ${tokens[i + 1]} ${tokens[i + 2]}`);
  }
  return phrases;
}

function computeFingerprintForChannel(db, channelId) {
  const rows = db.all(
    `SELECT DISTINCT title FROM ingested_videos
     WHERE channel_id = ? AND title IS NOT NULL
     ORDER BY published_at DESC LIMIT 100`,
    [channelId],
  );
  if (rows.length < 5) return null;

  const freq = {};
  for (const { title } of rows) {
    const seen = new Set();
    for (const phrase of extractPhrases(title)) {
      if (!seen.has(phrase)) { freq[phrase] = (freq[phrase] || 0) + 1; seen.add(phrase); }
    }
  }

  const topPhrases = Object.entries(freq)
    .filter(([p, n]) => n >= 2 && p.length >= 6)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 30)
    .map(([p]) => p);

  return topPhrases.length ? topPhrases.join('|') : null;
}

async function runFingerprintBackfill() {
  const db = getDb();

  // Only process channels that:
  // 1. Have no fingerprint yet, OR
  // 2. Have received new videos since their fingerprint was last written
  //    (proxy: channels where max(published_at) > fingerprint_updated_at)
  // For simplicity: process all channels without a fingerprint first, then
  // re-process channels that had videos ingested in the last 7 days.
  const channels = db.all(`
    SELECT DISTINCT ic.channel_id
    FROM ingested_channels ic
    WHERE ic.ingest_enabled = 1
      AND EXISTS (SELECT 1 FROM ingested_videos iv WHERE iv.channel_id = ic.channel_id LIMIT 1)
      AND (
        ic.content_fingerprint IS NULL
        OR EXISTS (
          SELECT 1 FROM ingested_videos iv
          WHERE iv.channel_id = ic.channel_id
            AND iv.published_at > datetime('now', '-7 days')
        )
      )
  `);

  if (!channels.length) {
    console.log('[fingerprint] All channels up to date — nothing to process');
    return { processed: 0, updated: 0, skipped: 0 };
  }

  console.log(`[fingerprint] Processing ${channels.length} channels...`);
  let updated = 0, skipped = 0;

  const update = db.transaction((channelId, fp) => {
    db.run('UPDATE ingested_channels SET content_fingerprint = ? WHERE channel_id = ?', [fp, channelId]);
  });

  for (const { channel_id } of channels) {
    const fp = computeFingerprintForChannel(db, channel_id);
    if (fp) {
      update(channel_id, fp);
      updated++;
    } else {
      skipped++;
    }
    // Yield to event loop every 200 channels to avoid blocking
    if ((updated + skipped) % 200 === 0) {
      await new Promise(r => setImmediate(r));
    }
  }

  console.log(`[fingerprint] Done — updated=${updated} skipped=${skipped} (no phrases extracted)`);
  return { processed: channels.length, updated, skipped };
}

module.exports = { runFingerprintBackfill };

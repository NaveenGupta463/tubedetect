'use strict';

const { getDb } = require('../db/init');
const { detectCreatorMode, CREATOR_MODE_VERSION, PODCAST_META_TOKENS, inferPodcastFormat: _inferPodcastFormatPure } = require('../lib/creatorMode');

// ── Backfill creator_mode + podcast_fingerprint for all ingested channels ─────

const STOPWORDS = new Set(['the','and','for','with','this','that','from','have','are','was','were','been','will','your','what','how','why','when','who','its','not','but','can','all','get','has','had','his','her','him','their','they','our','you','one','out','more','about','into','than','some','just','like']);
const SOUTH_SCRIPT_RE = /[஀-௿ఀ-౿ಀ-೿ഀ-ൿ]/;
const DEVANAGARI_RE  = /[ऀ-ॿ਀-੿઀-૿]/;
const HOOK_PHRASES   = new Set(['current affairs','breaking news','latest news','today news','news today','top news']);

function extractPhrases(title) {
  if (!title) return [];
  if (SOUTH_SCRIPT_RE.test(title)) return [];
  const tokens = title
    .replace(/#\w+/g, ' ')
    .replace(/\|{2}[^|]+\|{2}/g, ' ')
    .toLowerCase()
    .replace(/[|()[\]{}#@!?,।॥।\-''':]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(w => w.length > 2 && !STOPWORDS.has(w) && !/^\d+$/.test(w) && !DEVANAGARI_RE.test(w));

  const phrases = [];
  for (let i = 0; i < tokens.length - 1; i++) {
    const bigram = `${tokens[i]} ${tokens[i + 1]}`;
    if (!HOOK_PHRASES.has(bigram)) phrases.push(bigram);
  }
  for (let i = 0; i < tokens.length - 2; i++) {
    if (!HOOK_PHRASES.has(tokens[i] + ' ' + tokens[i + 1]) &&
        !HOOK_PHRASES.has(tokens[i + 1] + ' ' + tokens[i + 2])) {
      phrases.push(`${tokens[i]} ${tokens[i + 1]} ${tokens[i + 2]}`);
    }
  }
  return phrases;
}

function inferPodcastFormat(db, channelId, currentFormat) {
  if (currentFormat === 'podcast' || currentFormat === 'interview') return currentFormat;
  const titles = db.all(
    `SELECT title FROM ingested_videos WHERE channel_id = ? AND title IS NOT NULL ORDER BY published_at DESC LIMIT 60`,
    [channelId],
  ).map(r => r.title);
  return _inferPodcastFormatPure(titles, currentFormat);
}

function computePodcastFingerprint(db, channelId, channelName) {
  const rows = db.all(
    `SELECT DISTINCT title FROM ingested_videos WHERE channel_id = ? AND title IS NOT NULL ORDER BY published_at DESC LIMIT 100`,
    [channelId],
  );
  if (rows.length < 5) return null;

  const nameTokens = new Set(
    (channelName || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(t => t.length >= 3),
  );

  const freq = {};
  for (const { title } of rows) {
    const seen = new Set();
    for (const phrase of extractPhrases(title)) {
      const words = phrase.split(' ');
      if (words.some(w => PODCAST_META_TOKENS.has(w))) continue;
      if (words.some(w => nameTokens.has(w))) continue;
      if (!seen.has(phrase)) { freq[phrase] = (freq[phrase] || 0) + 1; seen.add(phrase); }
    }
  }

  const top = Object.entries(freq)
    .filter(([, c]) => c >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 50)
    .map(([p]) => p)
    .join('|');

  return top || null;
}

function run() {
  const db = getDb();

  const channels = db.all(
    `SELECT channel_id, channel_name, niche, primary_niche, format_type, content_archetype,
            creator_mode, creator_mode_version
     FROM ingested_channels
     WHERE ingest_enabled = 1 OR ingest_enabled IS NULL`,
  );

  console.log(`[backfill] Processing ${channels.length} channels`);

  let updated = 0;
  let skipped = 0;
  const modeCounts = {};

  for (const ch of channels) {
    const needsMode = !ch.creator_mode || (ch.creator_mode_version || 0) < CREATOR_MODE_VERSION;

    if (!needsMode) { skipped++; continue; }

    const effectiveFormat = inferPodcastFormat(db, ch.channel_id, ch.format_type);
    const { mode, confidence, reason } = detectCreatorMode(
      ch.primary_niche || ch.niche,
      effectiveFormat,
      ch.content_archetype,
      ch.niche,  // rawNiche — allows exam regex to see original niche label
    );

    modeCounts[mode] = (modeCounts[mode] || 0) + 1;

    let podcastFp = null;
    if (mode === 'podcast') {
      podcastFp = computePodcastFingerprint(db, ch.channel_id, ch.channel_name);
    }

    try {
      if (podcastFp !== null) {
        db.run(
          `UPDATE ingested_channels SET creator_mode=?, creator_mode_confidence=?, creator_mode_reason=?, creator_mode_version=?, podcast_fingerprint=? WHERE channel_id=?`,
          [mode, confidence, reason, CREATOR_MODE_VERSION, podcastFp, ch.channel_id],
        );
      } else {
        db.run(
          `UPDATE ingested_channels SET creator_mode=?, creator_mode_confidence=?, creator_mode_reason=?, creator_mode_version=? WHERE channel_id=?`,
          [mode, confidence, reason, CREATOR_MODE_VERSION, ch.channel_id],
        );
      }
      updated++;
    } catch (e) {
      console.error(`[backfill] Error updating ${ch.channel_id}:`, e.message);
    }
  }

  console.log(`[backfill] Done — updated: ${updated}, skipped (already current): ${skipped}`);
  console.log('[backfill] Mode distribution:', modeCounts);
}

run();

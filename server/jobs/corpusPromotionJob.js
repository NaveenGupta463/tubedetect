'use strict';

// ── Corpus → Ingested promotion ───────────────────────────────────────────────
// Runs daily at 02:00 UTC — sits between the crawler (01:00) and historical
// ingest (03:00) so newly discovered channels are ready for ingest the same day.
//
// Takes channels from corpus_channels that:
//   - Have uploads_playlist_id (ingest needs it)
//   - Have subscriber_count >= PROMOTION_MIN_SUBS (skip ghost/empty channels)
//   - Are not already in ingested_channels
//
// Niche detection order:
//   1. Already set by crawler (topic categories + keyword match — free)
//   2. OpenAI classifyChannel fallback for channels still null (costs OpenAI tokens,
//      no YouTube quota). Disabled if OPENAI_API_KEY is not set.
//
// Inserts into ingested_channels with ingest_enabled=1 so historical ingest
// picks them up that morning.

const cron = require('node-cron');
const { getDb }                 = require('../db/init');
const { upsertIngestedChannel } = require('../db/queries');
const { withCronRetry }         = require('../utils/cronRetry');
const { classifyChannel }       = require('../services/channelClassifier');
const { guessNiche }            = require('../services/nicheDetector');

const PROMOTION_LIMIT    = parseInt(process.env.PROMOTION_DAILY_LIMIT || '15000', 10);
const PROMOTION_MIN_SUBS = parseInt(process.env.PROMOTION_MIN_SUBS    || '1000', 10);
const OPENAI_CLASSIFY_LIMIT = parseInt(process.env.PROMOTION_OPENAI_LIMIT || '999999', 10);

async function classifyWithOpenAI(ch, openaiCallsUsed) {
  if (!process.env.OPENAI_API_KEY) return null;
  if (openaiCallsUsed[0] >= OPENAI_CLASSIFY_LIMIT) return null;

  // Build input from whatever we have: title + raw_json description if available
  let rawDescription = '';
  if (ch.raw_json) {
    try {
      const parsed = JSON.parse(ch.raw_json);
      rawDescription = parsed?.snippet?.description || '';
    } catch (_) {}
  }

  // Keyword-match the description as a quick pre-check to save OpenAI calls
  if (rawDescription) {
    const fromDesc = guessNiche(ch.title, rawDescription);
    if (fromDesc) return fromDesc;
  }

  // Full OpenAI classification — use title + description lines as stand-in for video titles
  const inputLines = [ch.title, ...rawDescription.slice(0, 500).split('\n').filter(Boolean)];
  try {
    openaiCallsUsed[0]++;
    const identity = await classifyChannel({ channelName: ch.title, titles: inputLines });
    return identity?.primary_niche || null;
  } catch (e) {
    console.warn(`[promotion] OpenAI classify failed for ${ch.channel_id}:`, e.message);
    return null;
  }
}

async function runPromotionCycle() {
  const db = getDb();

  const candidates = db.all(
    `SELECT cc.channel_id, cc.title, cc.subscriber_count, cc.uploads_playlist_id,
            cc.niche, cc.community_id, cc.discovery_source, cc.raw_json
     FROM corpus_channels cc
     WHERE cc.uploads_playlist_id IS NOT NULL
       AND cc.subscriber_count >= ?
       AND NOT EXISTS (
         SELECT 1 FROM ingested_channels ic WHERE ic.channel_id = cc.channel_id
       )
     ORDER BY cc.subscriber_count DESC
     LIMIT ?`,
    [PROMOTION_MIN_SUBS, PROMOTION_LIMIT],
  );

  if (!candidates.length) {
    console.log('[promotion] No new channels to promote');
    return { promoted: 0, classified_by_openai: 0 };
  }

  const needOpenAI = candidates.filter(c => !c.niche).length;
  console.log(`[promotion] Promoting ${candidates.length} channels — ${needOpenAI} need OpenAI classification`);

  let promoted = 0;
  const openaiCallsUsed = [0];

  for (const ch of candidates) {
    try {
      let niche = ch.niche;

      if (!niche) {
        niche = await classifyWithOpenAI(ch, openaiCallsUsed);
        if (niche) {
          db.run('UPDATE corpus_channels SET niche = ? WHERE channel_id = ?', [niche, ch.channel_id]);
        }
      }

      niche = niche || 'other';

      upsertIngestedChannel(db, {
        id:                  null,
        channel_id:          ch.channel_id,
        channel_name:        ch.title        ?? null,
        channel_subscribers: ch.subscriber_count ?? 0,
        uploads_playlist_id: ch.uploads_playlist_id ?? null,
        niche,
        community_id:        ch.community_id ?? null,
        added_by:            'corpus_promotion',
        notes:               `Auto-promoted (${ch.discovery_source || 'crawler'})`,
      });
      db.run(
        'UPDATE ingested_channels SET ingest_enabled = 1 WHERE channel_id = ?',
        [ch.channel_id],
      );
      promoted++;
    } catch (e) {
      console.warn(`[promotion] Failed to promote ${ch.channel_id}:`, e.message);
    }
  }

  console.log(`[promotion] Done — promoted=${promoted} openai_classified=${openaiCallsUsed[0]}`);
  return { promoted, classified_by_openai: openaiCallsUsed[0] };
}

function startPromotionCron() {
  cron.schedule('0 2 * * *', () => {
    withCronRetry(runPromotionCycle, 'promotion', { maxAttempts: 3, retryDelayMs: 10 * 60 * 1000 });
  });
  console.log('[Promotion Cron] Scheduled — daily at 02:00 UTC');
}

module.exports = { startPromotionCron, runPromotionCycle };

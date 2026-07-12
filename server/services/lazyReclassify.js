'use strict';

// Option A: lazy re-classification on the WTP request path. ~91% of channels carry a
// one-shot ingestion niche (identity_source='ai_detected') that was never revisited.
// Re-classifying all 45K blindly is costly AND unsafe (the guard over-fires). Instead we
// fix classification ONLY for channels people actually view, ONCE each, and only when
// there's a cheap signal of likely error — then verify with the model behind the safety gate.
//
// Flow (per channel, at most one model call ever):
//   1. only un-repaired channels (ai_detected / ai_redetect), not human-locked, not music
//   2. FREE pre-filter: deterministic guard disagrees with stored niche, OR confidence < 0.6
//      → otherwise mark 'lazy_confirmed' and never re-check (no OpenAI cost)
//   3. model classifyChannel → shouldAllowNicheRewrite gate (protects music, requires
//      evidence, blocks incompatible jumps) → apply + clear that channel's WTP cache

const { classifyChannel } = require('./channelClassifier');
const { inferProtectedIdentity, shouldAllowNicheRewrite } = require('../lib/channelIdentityGuard');

const ELIGIBLE_SOURCES = new Set(['ai_detected', 'ai_redetect', null, '']);

async function maybeLazyReclassify(db, channelId) {
  if (!channelId) return { changed: false, reason: 'no_channel' };

  let row;
  try {
    row = db.get(
      `SELECT channel_id, channel_name, COALESCE(primary_niche, niche) AS cur_niche,
              content_archetype, identity_source, identity_confidence, niche_override
       FROM ingested_channels WHERE channel_id = ?`, [channelId]);
  } catch (_) { return { changed: false, reason: 'db_error' }; }
  if (!row) return { changed: false, reason: 'not_found' };

  // Only un-repaired channels; never touch human/operator/already-lazy-checked records.
  if (!ELIGIBLE_SOURCES.has(row.identity_source)) return { changed: false, reason: 'already_handled' };
  if (row.niche_override) return { changed: false, reason: 'has_override' };
  if (row.cur_niche === 'music') return { changed: false, reason: 'music_protected' };

  let titles = [];
  try { titles = db.all(`SELECT title FROM ingested_videos WHERE channel_id=? AND title IS NOT NULL ORDER BY published_at DESC LIMIT 25`, [channelId]).map(r => r.title); } catch (_) {}
  if (titles.length < 5) return { changed: false, reason: 'too_few_titles' };

  // FREE pre-filter — only spend a model call when there's a cheap signal of likely error.
  const guard = inferProtectedIdentity({ channelName: row.channel_name, titles });
  const guardDisagrees = !!(guard && guard.primary_niche && guard.primary_niche !== row.cur_niche);
  const lowConf = Number(row.identity_confidence || 0) < 0.6;
  if (!guardDisagrees && !lowConf) {
    try { db.run(`UPDATE ingested_channels SET identity_source='lazy_confirmed' WHERE channel_id=?`, [channelId]); } catch (_) {}
    return { changed: false, reason: 'no_suspicion' };
  }

  let description = '';
  try {
    const c = db.get(`SELECT raw_json FROM channel_cache WHERE channel_id = ?`, [channelId]);
    if (c?.raw_json) { const j = JSON.parse(c.raw_json); description = (j?.snippet?.description || j?.description || '').slice(0, 600); }
  } catch (_) {}

  let result;
  try { result = await classifyChannel({ channelName: row.channel_name, titles, description }); }
  catch (e) { return { changed: false, reason: 'classify_error' }; }  // leave source unchanged → retried next view

  const proposed = result.primary_niche;
  const gate = shouldAllowNicheRewrite({
    currentNiche: row.cur_niche, proposedNiche: proposed,
    channelName: row.channel_name, titles, description, identitySource: row.identity_source,
    proposedConfidence: result.identity_confidence,
  });

  if (proposed && proposed !== row.cur_niche && gate.allow) {
    try {
      db.run(
        `UPDATE ingested_channels SET niche=?, primary_niche=?, content_archetype=?,
                identity_source='lazy_reclassify', identity_confidence=?, identity_last_detected_at=datetime('now')
         WHERE channel_id=?`,
        [proposed, proposed, result.content_archetype || row.content_archetype, result.identity_confidence ?? null, channelId]);
      db.run(`DELETE FROM channel_wtp_cache WHERE channel_id=?`, [channelId]);
      return { changed: true, from: row.cur_niche, to: proposed };
    } catch (_) { return { changed: false, reason: 'update_error' }; }
  }

  // Model confirmed current niche (or gate blocked the jump) → mark checked, don't re-run.
  try { db.run(`UPDATE ingested_channels SET identity_source='lazy_confirmed', identity_last_detected_at=datetime('now') WHERE channel_id=?`, [channelId]); } catch (_) {}
  return { changed: false, reason: gate.allow ? 'same_niche' : `gate_blocked:${gate.reason}` };
}

module.exports = { maybeLazyReclassify };

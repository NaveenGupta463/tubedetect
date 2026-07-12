'use strict';

// ── Token similarity ──────────────────────────────────────────────────────────
const STOPWORDS = new Set([
  'the','a','an','is','are','was','were','be','been','being','have','has','had',
  'do','does','did','will','would','could','should','may','might','shall','can',
  'to','of','in','on','at','by','for','with','about','as','if','that','this',
  'it','i','my','your','his','her','our','their','its','we','you','he','she',
  'they','and','or','but','so','not','no','also','just','very','how','what',
  'when','where','why','which','from','into','than','then','them','these','those',
  'get','got','make','made','more','some','all','up','out','new','one','two',
  'every','each','most','other','such','own','same',
]);

function tokenize(str) {
  return String(str || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 2 && !STOPWORDS.has(t));
}

function jaccard(setA, setB) {
  if (!setA.size || !setB.size) return 0;
  let inter = 0;
  for (const t of setA) { if (setB.has(t)) inter++; }
  return inter / (setA.size + setB.size - inter);
}

function titleSimilarity(topic, videoTitle) {
  const tokA = new Set(tokenize(topic));
  const tokB = new Set(tokenize(videoTitle));
  return jaccard(tokA, tokB);
}

// ── Scoring ───────────────────────────────────────────────────────────────────
// Behavioral signals carry the most weight — they prove the creator acted on the idea.
//   Export event:  +40 pts  (exported content → highest intent)
//   Brief event:   +30 pts  (generated a brief → strong intent)
//   Save event:    +20 pts  (bookmarked → moderate intent)
//
// Recommendation age (days between first_seen_at and video publish):
//   < 7d:   +15 pts   < 21d: +10 pts   < 45d: +5 pts
//   < 90d:    0 pts   ≥ 90d: -10 pts
//
// Title similarity (Jaccard on non-stopword tokens):
//   ≥ 0.40: +25 pts   ≥ 0.25: +15 pts   ≥ 0.10: +5 pts   < 0.10: 0 pts
//
// Confidence thresholds:
//   highly_likely: totalScore ≥ 55 AND (export OR brief) → auto-promotes
//   possible:      totalScore ≥ 20                        → creator confirmation required
//   unlikely:      totalScore < 20                         → stored but not surfaced

function agePoints(ageDays) {
  if (ageDays == null || ageDays < 0) return 0;
  if (ageDays < 7)  return 15;
  if (ageDays < 21) return 10;
  if (ageDays < 45) return 5;
  if (ageDays < 90) return 0;
  return -10;
}

function titleSimPoints(sim) {
  if (sim >= 0.40) return 25;
  if (sim >= 0.25) return 15;
  if (sim >= 0.10) return 5;
  return 0;
}

function scoreCandidate({ hadExport, hadBrief, hadSave, ageDays, titleJaccard }) {
  const behaviorScore = (hadExport ? 40 : 0) + (hadBrief ? 30 : 0) + (hadSave ? 20 : 0);
  const ageScore      = agePoints(ageDays);
  const titleScore    = titleSimPoints(titleJaccard);
  return { behaviorScore, ageScore, titleScore, totalScore: behaviorScore + ageScore + titleScore };
}

function classifyConfidence(totalScore, hadExport, hadBrief) {
  if (totalScore >= 55 && (hadExport || hadBrief)) return 'highly_likely';
  if (totalScore >= 20) return 'possible';
  return 'unlikely';
}

// ── Candidate discovery ───────────────────────────────────────────────────────
const MAX_LOOKBACK_DAYS = 90;

function fetchBehaviorRows(db, channelId, beforeDate) {
  const cutoff = new Date(new Date(beforeDate).getTime() - MAX_LOOKBACK_DAYS * 86400000).toISOString();
  return db.all(
    `SELECT idea_key, topic, rec_source, rec_type,
       MAX(CASE WHEN tbl = 'export' THEN 1 ELSE 0 END) AS had_export,
       MAX(CASE WHEN tbl = 'brief'  THEN 1 ELSE 0 END) AS had_brief,
       MAX(CASE WHEN tbl = 'save'   THEN 1 ELSE 0 END) AS had_save,
       MIN(created_at) AS first_seen_at
     FROM (
       SELECT idea_key, topic, rec_source, rec_type, 'export' AS tbl, created_at
         FROM wtp_exports WHERE channel_id = ? AND created_at < ? AND created_at >= ?
       UNION ALL
       SELECT idea_key, topic, rec_source, rec_type, 'brief' AS tbl, created_at
         FROM wtp_brief_generations WHERE channel_id = ? AND created_at < ? AND created_at >= ?
       UNION ALL
       SELECT idea_key, topic, rec_source, rec_type, 'save' AS tbl, created_at
         FROM wtp_saves WHERE channel_id = ? AND created_at < ? AND created_at >= ?
     ) t
     GROUP BY idea_key`,
    [channelId, beforeDate, cutoff,
     channelId, beforeDate, cutoff,
     channelId, beforeDate, cutoff],
  );
}

function daysBetween(a, b) {
  const ta = new Date(a).getTime();
  const tb = new Date(b).getTime();
  if (isNaN(ta) || isNaN(tb)) return null;
  return Math.round(Math.abs(tb - ta) / 86400000);
}

// Returns all candidates for a video, sorted by totalScore DESC.
// Caller decides which to persist (skip 'unlikely').
function buildCandidates(db, channelId, videoId, videoTitle, publishedAt) {
  const rows = fetchBehaviorRows(db, channelId, publishedAt);
  const candidates = [];

  for (const row of rows) {
    const ageDays    = daysBetween(row.first_seen_at, publishedAt);
    const titleJacc  = titleSimilarity(row.topic, videoTitle);
    const { behaviorScore, ageScore, titleScore, totalScore } = scoreCandidate({
      hadExport: !!row.had_export, hadBrief: !!row.had_brief, hadSave: !!row.had_save,
      ageDays, titleJaccard: titleJacc,
    });
    const confidence = classifyConfidence(totalScore, !!row.had_export, !!row.had_brief);

    candidates.push({
      channel_id:               channelId,
      video_id:                 videoId,
      video_title:              videoTitle,
      video_published_at:       publishedAt,
      idea_key:                 row.idea_key,
      topic:                    row.topic,
      rec_source:               row.rec_source,
      rec_type:                 row.rec_type,
      had_export:               row.had_export ? 1 : 0,
      had_brief:                row.had_brief  ? 1 : 0,
      had_save:                 row.had_save   ? 1 : 0,
      recommendation_age_days:  ageDays,
      title_sim_score:          titleJacc,
      behavior_score:           behaviorScore,
      age_score:                ageScore,
      title_score:              titleScore,
      total_score:              totalScore,
      match_confidence:         confidence,
    });
  }

  return candidates.sort((a, b) => b.total_score - a.total_score);
}

// Insert or refresh — never overwrites a row the creator has already confirmed/rejected.
function upsertCandidate(db, c) {
  db.run(
    `INSERT INTO wtp_attribution_candidates
       (channel_id, video_id, video_title, video_published_at,
        idea_key, topic, rec_source, rec_type,
        had_export, had_brief, had_save,
        recommendation_age_days, title_sim_score,
        behavior_score, age_score, title_score, total_score,
        match_confidence)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(channel_id, video_id, idea_key) DO UPDATE SET
       had_export              = excluded.had_export,
       had_brief               = excluded.had_brief,
       had_save                = excluded.had_save,
       recommendation_age_days = excluded.recommendation_age_days,
       title_sim_score         = excluded.title_sim_score,
       behavior_score          = excluded.behavior_score,
       age_score               = excluded.age_score,
       title_score             = excluded.title_score,
       total_score             = excluded.total_score,
       match_confidence        = excluded.match_confidence,
       computed_at             = datetime('now')
     WHERE wtp_attribution_candidates.creator_confirmed IS NULL`,
    [c.channel_id, c.video_id, c.video_title, c.video_published_at,
     c.idea_key, c.topic, c.rec_source, c.rec_type,
     c.had_export, c.had_brief, c.had_save,
     c.recommendation_age_days, c.title_sim_score,
     c.behavior_score, c.age_score, c.title_score, c.total_score,
     c.match_confidence],
  );
}

// Writes to wtp_video_matches. Only called for highly_likely (auto) or confirmed (creator action).
// Checks for duplicate before inserting — wtp_video_matches has no unique constraint.
function promoteToVideoMatch(db, candidate) {
  const existing = db.get(
    `SELECT id FROM wtp_video_matches
     WHERE channel_id = ? AND idea_key = ? AND video_id = ? LIMIT 1`,
    [candidate.channel_id, candidate.idea_key, candidate.video_id],
  );
  if (existing) return false;

  db.run(
    `INSERT INTO wtp_video_matches
       (channel_id, idea_key, topic, rec_source, rec_type,
        video_id, video_title, days_to_publish, match_confidence, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,datetime('now'))`,
    [candidate.channel_id, candidate.idea_key, candidate.topic,
     candidate.rec_source, candidate.rec_type,
     candidate.video_id, candidate.video_title,
     candidate.recommendation_age_days, candidate.match_confidence],
  );

  db.run(
    `UPDATE wtp_attribution_candidates SET promoted = 1, promoted_at = datetime('now')
     WHERE channel_id = ? AND video_id = ? AND idea_key = ?`,
    [candidate.channel_id, candidate.video_id, candidate.idea_key],
  );

  return true;
}

module.exports = {
  titleSimilarity,
  scoreCandidate,
  classifyConfidence,
  buildCandidates,
  upsertCandidate,
  promoteToVideoMatch,
  MAX_LOOKBACK_DAYS,
  SCORE_THRESHOLDS: { highlyLikely: 55, possible: 20 },
};

'use strict';

const crypto    = require('crypto');
const Anthropic = require('@anthropic-ai/sdk');
const { getDb } = require('../../db/init');
const { computeRepair } = require('./repairEngine');

const MODEL  = 'claude-sonnet-4-6';
const TTL_MS = 24 * 60 * 60 * 1000;

let _client = null;
function getClient() {
  if (_client) return _client;
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('[aiRepairAdvisor] Missing ANTHROPIC_API_KEY');
  _client = new Anthropic({ apiKey: key });
  return _client;
}

/**
 * Hash that covers all inputs that would change the AI answer.
 * Changing any field (title, descriptions, or the structural output) produces a new hash.
 */
function aiInputHash(videoId, title, contentDescription, thumbnailDescription, structuralCacheKey) {
  const payload = JSON.stringify({
    v:  videoId             ?? '',
    t:  title               ?? '',
    cd: contentDescription  ?? '',
    td: thumbnailDescription ?? '',
    sk: structuralCacheKey  ?? '',
  });
  return crypto.createHash('sha256').update(payload).digest('hex').slice(0, 16);
}

// Derived from Phase A scores — passed to Claude in context only, never modified by Claude.
function derivePrimaryProblem(repair) {
  if ((repair.packaging_risk_score ?? 0) >= 70) return 'packaging';
  if (repair.trajectory_status === 'stalled' || repair.trajectory_status === 'declining') return 'trajectory';
  if ((repair.audience_response_score ?? 100) < 30) return 'audience_response';
  if ((repair.expected_performance_score ?? 100) < 30) return 'underperformance';
  return 'none';
}

const SYSTEM_PROMPT = `You are a YouTube content repair advisor. You receive a structural performance assessment for a video and generate repair recommendations only.

STRICT RULES:
1. Do NOT re-score. Do NOT output or modify: trajectory_status, repair_window, primary_problem, urgency_score, fixability_score, trajectory_score, or any evidence fields.
2. Return ONLY valid JSON — no markdown, no backticks, no explanation. Start with { and end with }.
3. repair_window is "learning" or "viral_decode": return empty arrays for title_recommendations and thumbnail_recommendations. Only generate follow_up_video and fix_plan_copy items with time_sensitivity "none".
4. do_not_touch is true: set do_not_touch_explanation explaining why the video is performing well and should not be changed. Return empty arrays for all recommendation fields. follow_up_video may still be suggested.
5. packaging_risk_score < 30: do not suggest title or thumbnail changes unless primary_problem is "packaging".
6. Use actual numbers from evidence in "why" and "reason" fields (e.g., "VPH was 12.3 vs niche median 45.0").
7. fix_plan_copy: max 3 items, ordered by urgency — hours first, then days, then none.
8. title_recommendations: max 3 alternatives. thumbnail_recommendations: max 2 concepts.
9. do_not_touch_explanation: set to empty string "" when do_not_touch is false.

Output shape — follow exactly, no extra keys:
{
  "title_recommendations": [{ "title": "...", "why": "...", "risk": "low|medium|high" }],
  "thumbnail_recommendations": [{ "concept": "...", "why": "...", "risk": "low|medium|high" }],
  "follow_up_video": { "topic": "...", "angle": "...", "title": "...", "reasoning": "..." },
  "fix_plan_copy": [{ "action": "...", "reason": "...", "time_sensitivity": "hours|days|none" }],
  "do_not_touch_explanation": ""
}`;

function buildUserMessage(repair, inputs) {
  const primaryProblem = derivePrimaryProblem(repair);

  const context = {
    video_id:                   repair.video_id,
    repair_window:              repair.repair_window,
    age_hours:                  repair.age_hours,
    do_not_touch:               repair.do_not_touch,
    trajectory_status:          repair.trajectory_status,
    trajectory_score:           repair.trajectory_score,
    expected_performance_score: repair.expected_performance_score,
    audience_response_score:    repair.audience_response_score,
    packaging_risk_score:       repair.packaging_risk_score,
    urgency_score:              repair.urgency_score,
    fixability_score:           repair.fixability_score,
    primary_problem:            primaryProblem,
    evidence:                   repair.evidence,
  };

  return `STRUCTURAL REPAIR ASSESSMENT:
${JSON.stringify(context, null, 2)}

USER INPUTS (null if not provided):
${JSON.stringify({
    current_title:         inputs.title              ?? null,
    content_description:   inputs.contentDescription ?? null,
    thumbnail_description: inputs.thumbnailDescription ?? null,
  }, null, 2)}

Generate the repair recommendation JSON.`;
}

function safeParseJson(raw) {
  const cleaned = raw.replace(/```[a-z]*\n?/gi, '').replace(/```/g, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('Claude returned non-JSON response');
    return JSON.parse(match[0]);
  }
}

const REQUIRED_OUTPUT_KEYS = [
  'title_recommendations', 'thumbnail_recommendations',
  'follow_up_video', 'fix_plan_copy', 'do_not_touch_explanation',
];

function validateShape(output) {
  for (const k of REQUIRED_OUTPUT_KEYS) {
    if (!(k in output)) throw new Error(`AI output missing required field: ${k}`);
  }
  if (!Array.isArray(output.title_recommendations))    throw new Error('title_recommendations must be array');
  if (!Array.isArray(output.thumbnail_recommendations)) throw new Error('thumbnail_recommendations must be array');
  if (!Array.isArray(output.fix_plan_copy))            throw new Error('fix_plan_copy must be array');
  if (typeof output.follow_up_video !== 'object' || output.follow_up_video === null) {
    throw new Error('follow_up_video must be an object');
  }
}

async function callClaude(repair, inputs) {
  const client = getClient();
  const response = await client.messages.create({
    model:      MODEL,
    max_tokens: 1200,
    system:     SYSTEM_PROMPT,
    messages:   [{ role: 'user', content: buildUserMessage(repair, inputs) }],
  });

  const raw = response.content[0]?.text?.trim();
  if (!raw) throw new Error('Empty response from Claude');

  const parsed = safeParseJson(raw);
  validateShape(parsed);
  return parsed;
}

/**
 * Compute AI repair recommendations for a video (Phase B).
 * Caches by ai_input_hash with 24h TTL.
 *
 * @param {string} videoId
 * @param {{ title?, contentDescription?, thumbnailDescription? }} inputs
 * @returns {Promise<object>}
 */
async function computeAiRepair(videoId, inputs = {}) {
  const db = getDb();

  // Ensure Phase A repair output is available.
  const repair = computeRepair(videoId, { force: false });
  if (repair.error) return { error: repair.error, video_id: videoId };

  const hash = aiInputHash(
    videoId,
    inputs.title,
    inputs.contentDescription,
    inputs.thumbnailDescription,
    repair.ai_cache_key,
  );

  // Cache hit: same hash and within TTL.
  const cacheRow = db.get('SELECT * FROM video_repair_cache WHERE video_id = ?', [videoId]);
  if (cacheRow?.ai_result_json && cacheRow.ai_input_hash === hash) {
    const ageMs = cacheRow.ai_computed_at
      ? Date.now() - new Date(cacheRow.ai_computed_at).getTime()
      : Infinity;
    if (ageMs < TTL_MS) {
      const cached = JSON.parse(cacheRow.ai_result_json);
      cached._cached        = true;
      cached._cached_at     = cacheRow.ai_computed_at;
      cached._ai_input_hash = hash;
      return cached;
    }
  }

  // Cache miss — call Claude.
  const aiOutput = await callClaude(repair, inputs);

  const computedAt = new Date().toISOString();
  aiOutput._computed_at    = computedAt;
  aiOutput._ai_input_hash  = hash;

  try {
    db.run(
      `UPDATE video_repair_cache
         SET ai_result_json = ?, ai_computed_at = ?, ai_input_hash = ?
       WHERE video_id = ?`,
      [JSON.stringify(aiOutput), computedAt, hash, videoId],
    );
  } catch (e) {
    aiOutput._cache_error = e.message;
  }

  return aiOutput;
}

module.exports = { computeAiRepair, aiInputHash };

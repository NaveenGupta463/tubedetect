const express  = require('express');
const crypto   = require('crypto');
const { runLLMExplain, getUsageStats, recordUsage } = require('../services/llmExplain');
const { extractFeatures }                           = require('../services/featureExtraction');

const router = express.Router();

// In-memory explanation cache: key → { data, ts }
const explainCache = new Map();
const CACHE_TTL    = 60 * 60 * 1000; // 1 hour

function makeCacheKey(title, hook, niche) {
  return crypto.createHash('md5').update(`${title}|${hook}|${niche}`).digest('hex');
}

function getCached(key) {
  const entry = explainCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL) { explainCache.delete(key); return null; }
  return entry.data;
}

/**
 * Rule-based fallback when LLM is unavailable.
 * Generates suggestions from extracted features without any API call.
 */
function ruleBasedInsights(features, title, niche) {
  const suggestions = [];
  const curiosity  = features.curiosity_score    ?? 0;
  const urgency    = features.urgency_score      ?? 0;
  const specificity = features.specificity_score ?? 0;
  const powerWord  = features.power_word_score   ?? 0;
  const hasNumber  = features.has_number         ?? 0;
  const tl         = features.title_length       ?? 50;
  const sent       = features.sentiment_score    ?? 0;
  const hookQ      = features.hook_question_present ?? false;

  if (curiosity < 3)   suggestions.push('Add a curiosity gap — hint at a surprising or unexpected result');
  if (urgency < 3)     suggestions.push('Add urgency words (today, now, instantly, this week)');
  if (!hasNumber)      suggestions.push('Include a specific number for credibility (e.g. "7 Ways" or "In 30 Days")');
  if (powerWord < 2)   suggestions.push('Add power words (ultimate, secret, proven, effortless)');
  if (tl < 30)         suggestions.push('Title is too short — aim for 40–60 characters for better click-through');
  if (tl > 70)         suggestions.push('Title is too long — trim to under 60 characters so it doesn\'t truncate');
  if (sent < 0)        suggestions.push('Reframe with a positive or aspirational angle to improve appeal');
  if (!hookQ && curiosity < 4) suggestions.push('Consider phrasing the hook as a question to trigger curiosity');

  if (suggestions.length === 0) {
    suggestions.push(`This ${niche} title looks well-optimized — strong signal across most dimensions`);
  }

  const hook_quality  = curiosity >= 5 ? 'strong' : curiosity >= 2 ? 'average' : 'weak';
  const title_quality = (tl >= 30 && tl <= 70 && powerWord >= 2) ? 'strong'
                      : (powerWord >= 1 || specificity >= 1)      ? 'average' : 'weak';

  const strength = curiosity >= 5 ? 'strong curiosity signals' : urgency >= 5 ? 'good urgency' : 'moderate baseline engagement';
  const weakness = tl > 70 ? 'title length may cause truncation' : powerWord < 2 ? 'limited power vocabulary' : 'could strengthen specificity';

  return {
    suggestions:   suggestions.slice(0, 3),
    reasoning:     `Rule-based: ${strength}; ${weakness}.`,
    hook_quality,
    title_quality,
    source:        'rule_based',
    cached:        false,
    tokens_used:   0,
  };
}

/**
 * POST /api/explain
 * Body: { title, hook, niche, channel_size? }
 *
 * Returns human-readable suggestions + quality ratings.
 * LLM is called here (and only here). Falls back to rule-based on failure.
 * Results cached for 1 hour by content hash.
 */
router.post('/explain', async (req, res) => {
  const { title, hook, niche, channel_size } = req.body;

  if (!title || !hook || !niche) {
    return res.status(400).json({ error: 'title, hook, and niche are required' });
  }

  const key    = makeCacheKey(title, hook, niche);
  const cached = getCached(key);

  if (cached) {
    recordUsage(0, 0, true);
    console.log('[explain] cache hit:', key);
    return res.json({ ...cached, cached: true });
  }

  try {
    const result = await runLLMExplain({ title, hook, niche, channel_size });
    explainCache.set(key, { ...result, cached: false, ts: Date.now() });

    console.log(`[explain] LLM ok — tokens=${result.tokens_used} hook=${result.hook_quality} title=${result.title_quality}`);
    return res.json({ ...result, cached: false });

  } catch (e) {
    console.warn('[explain] LLM failed, using rule-based fallback:', e.message);

    const features = extractFeatures({ title, hook, niche });
    const fallback = ruleBasedInsights(features, title, niche);

    explainCache.set(key, { ...fallback, ts: Date.now() });
    return res.json(fallback);
  }
});

/**
 * GET /api/explain/usage
 * Returns daily LLM token usage and cache hit rate.
 */
router.get('/explain/usage', (_req, res) => {
  res.json(getUsageStats());
});

module.exports = router;

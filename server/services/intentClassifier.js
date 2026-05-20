const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const KNOWN_NICHES = [
  'finance', 'travel', 'health', 'history', 'comedy', 'general',
  'selfimprovement', 'tech_explainer', 'tech_review',
  'fitness_educational', 'fitness_experiment',
  'cars_explainer', 'cars_review',
  'cooking_concept', 'cooking_cookalong',
  'gaming', 'education',
  'beauty_trend', 'beauty_haul',
  'sports_analysis', 'sports_reaction',
  'realestate', 'news', 'science', 'truecrime',
];

async function classify(message, channelNiche) {
  const prompt = `You are classifying a YouTube creator's message to determine what type of content they want to create.

Channel's established niche (use as a prior — override only if the message clearly indicates a different niche): ${channelNiche || 'unknown'}

Message: "${message}"

Return ONLY a JSON object. No prose, no markdown fences.

{
  "niche": "<one of: ${KNOWN_NICHES.join(', ')}>",
  "secondary_niche": "<one of the above niches, or null if single-niche>",
  "mode": "<pre | edit | unknown>",
  "confidence": <0.0 to 1.0>,
  "signals": ["<signal 1>", "<signal 2>"]
}

Classification rules:
- mode "edit" signals: "I have footage", "I filmed", "I recorded", past-tense trip/experience verbs ("I went", "I visited", "I tried"), "I already shot this"
- mode "pre" signals: "planning", "want to make", "thinking about", future tense, research or strategy questions
- mode "unknown": message is ambiguous — could be pre-shot or edit-to-script
- confidence: your certainty about the niche (0 = total guess, 1 = certain). Not about mode.
- signals: 2–4 short phrases from the message that drove your niche classification`;

  let raw = '';
  try {
    const response = await client.messages.create({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 300,
      messages:   [{ role: 'user', content: prompt }],
    });
    raw = response.content[0]?.text || '';
  } catch (err) {
    console.warn('[intentClassifier] API call failed:', err.message);
    return fallback(channelNiche);
  }

  const stripped = raw.replace(/^```(?:json)?\s*/im, '').replace(/\s*```\s*$/m, '').trim();
  let result;
  try {
    result = JSON.parse(stripped);
  } catch (_) {
    console.warn('[intentClassifier] JSON parse failed, raw:', raw.slice(0, 120));
    return fallback(channelNiche);
  }

  return {
    niche:           KNOWN_NICHES.includes(result.niche) ? result.niche : (channelNiche || 'general'),
    secondary_niche: KNOWN_NICHES.includes(result.secondary_niche) ? result.secondary_niche : null,
    mode:            ['pre', 'edit', 'unknown'].includes(result.mode) ? result.mode : 'unknown',
    confidence:      typeof result.confidence === 'number' ? Math.min(Math.max(result.confidence, 0), 1) : 0.5,
    signals:         Array.isArray(result.signals) ? result.signals.slice(0, 4) : [],
  };
}

function fallback(channelNiche) {
  return {
    niche:           channelNiche || 'general',
    secondary_niche: null,
    mode:            'unknown',
    confidence:      0.4,
    signals:         ['classification unavailable'],
  };
}

module.exports = { classify };

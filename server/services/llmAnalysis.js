const Anthropic = require('@anthropic-ai/sdk');

const MODEL = 'claude-sonnet-4-20250514';

const SYSTEM = `You are a YouTube content performance analyst.
Analyze the given video title, hook, niche, and channel size.
Return ONLY valid JSON — no markdown, no backticks, no explanation, no preamble.
Start your response with { and end with }.

JSON structure (follow exactly):
{
  "llm_score": <integer 0-100>,
  "suggestions": ["<actionable suggestion>", "<actionable suggestion>"],
  "reasoning": "<1-2 sentence explanation of the score>",
  "hook_quality": "<weak|average|strong>",
  "title_quality": "<weak|average|strong>"
}`;

// Lazy init — client created on first call so missing key fails at call time, not startup
let _client = null;
function getClient() {
  if (_client) return _client;
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('[llmAnalysis] Missing ANTHROPIC_API_KEY in backend/.env');
  _client = new Anthropic({ apiKey: key });
  return _client;
}

/**
 * Score a video brief with Claude.
 * Throws on failure — caller (ensembleScoring) catches and falls back.
 */
async function runLLMAnalysis({ title, hook, niche, channel_size }) {
  const client = getClient();

  const userMessage = `Title: ${title}
Hook: ${hook}
Niche: ${niche}
Channel size: ${channel_size.toLocaleString()} subscribers

Score this video's predicted performance and return the JSON.`;

  const response = await client.messages.create({
    model:      MODEL,
    max_tokens: 512,
    system:     SYSTEM,
    messages:   [{ role: 'user', content: userMessage }],
  });

  const raw = response.content[0]?.text?.trim();
  if (!raw) throw new Error('Empty response from Claude');

  const cleaned = raw.replace(/```[a-z]*\n?/gi, '').replace(/```/g, '').trim();

  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('Claude returned non-JSON response');
    parsed = JSON.parse(match[0]);
  }

  if (typeof parsed.llm_score !== 'number') throw new Error('Claude response missing llm_score');
  parsed.llm_score = Math.max(0, Math.min(100, Math.round(parsed.llm_score)));

  return parsed;
}

module.exports = { runLLMAnalysis };

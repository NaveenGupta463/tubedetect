const Anthropic = require('@anthropic-ai/sdk');

const MODEL      = 'claude-sonnet-4-20250514';
const MAX_TOKENS = 250;

const SYSTEM = `You are a YouTube content strategist. Analyze the given video title, hook, and niche.
Return ONLY valid JSON — no markdown, no backticks, no preamble.
Start with { and end with }.

JSON structure (follow exactly):
{
  "suggestions": ["<actionable suggestion>", "<actionable suggestion>"],
  "reasoning": "<1-2 sentences explaining strengths and weaknesses>",
  "hook_quality": "<weak|average|strong>",
  "title_quality": "<weak|average|strong>"
}`;

let _client = null;
function getClient() {
  if (_client) return _client;
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('[llmExplain] Missing ANTHROPIC_API_KEY');
  _client = new Anthropic({ apiKey: key });
  return _client;
}

// Usage tracking — resets daily
const usage = {
  date:         new Date().toDateString(),
  total_tokens: 0,
  total_calls:  0,
  cached_hits:  0,
};

function resetIfNewDay() {
  const today = new Date().toDateString();
  if (usage.date !== today) {
    usage.date         = today;
    usage.total_tokens = 0;
    usage.total_calls  = 0;
    usage.cached_hits  = 0;
  }
}

function recordUsage(inputTokens, outputTokens, wasCached) {
  resetIfNewDay();
  if (wasCached) {
    usage.cached_hits++;
  } else {
    usage.total_calls++;
    usage.total_tokens += (inputTokens ?? 0) + (outputTokens ?? 0);
  }
}

function getUsageStats() {
  resetIfNewDay();
  const total = usage.total_calls + usage.cached_hits;
  return {
    date:          usage.date,
    total_tokens:  usage.total_tokens,
    llm_calls:     usage.total_calls,
    cached_hits:   usage.cached_hits,
    cache_hit_pct: total > 0 ? parseFloat(((usage.cached_hits / total) * 100).toFixed(1)) : 0,
  };
}

async function runLLMExplain({ title, hook, niche, channel_size }) {
  const client = getClient();

  const userMsg = `Title: ${title}
Hook: ${hook}
Niche: ${niche}
Channel size: ${(channel_size ?? 0).toLocaleString()} subscribers

Provide actionable improvement suggestions and quality ratings.`;

  const response = await client.messages.create({
    model:      MODEL,
    max_tokens: MAX_TOKENS,
    system:     SYSTEM,
    messages:   [{ role: 'user', content: userMsg }],
  });

  const inputTokens  = response.usage?.input_tokens  ?? 0;
  const outputTokens = response.usage?.output_tokens ?? 0;
  recordUsage(inputTokens, outputTokens, false);

  const raw     = response.content[0]?.text?.trim();
  if (!raw) throw new Error('Empty response from Claude');

  const cleaned = raw.replace(/```[a-z]*\n?/gi, '').replace(/```/g, '').trim();

  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('Claude returned non-JSON');
    parsed = JSON.parse(match[0]);
  }

  return {
    suggestions:   Array.isArray(parsed.suggestions)   ? parsed.suggestions   : [],
    reasoning:     typeof parsed.reasoning   === 'string' ? parsed.reasoning   : '',
    hook_quality:  parsed.hook_quality  ?? null,
    title_quality: parsed.title_quality ?? null,
    source:        'llm',
    tokens_used:   inputTokens + outputTokens,
  };
}

module.exports = { runLLMExplain, getUsageStats, recordUsage };

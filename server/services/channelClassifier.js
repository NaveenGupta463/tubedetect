const OpenAI = require('openai');

// ── Layer 1: Benchmark buckets (hard-validated, no expansion) ─────────────────
const ALLOWED_NICHES = [
  'technology', 'business', 'education', 'entertainment', 'gaming',
  'health', 'finance', 'lifestyle', 'science', 'sports', 'news',
  'politics', 'food', 'travel', 'music', 'comedy', 'fitness', 'beauty',
  'yoga', 'meditation', 'philosophy',
  'other',
];

// ── Layer 3: Content mechanics (controlled vocabulary, not semantic topics) ────
const ALLOWED_BEHAVIOR_TAGS = [
  'storytelling', 'comparison', 'review_based', 'analytical', 'educational',
  'personality_driven', 'debate', 'news_reaction', 'motivational', 'authority_driven',
  'commentary', 'case_study', 'deep_dive', 'explainer', 'viral_short_form',
  'cinematic', 'satirical', 'listicle', 'reaction_based', 'live_stream_style',
  'opinion_based',
  'challenge', 'unboxing', 'performance', 'demonstration', 'highlight_reel',
  'travelogue', 'behind_the_scenes', 'event_coverage', 'promotional', 'experimental',
  'recipe_based', 'walkthrough', 'music_video', 'audio_release',
  'emotional', 'dramatic', 'gameplay', 'sketch', 'character_driven',
  'conversation', 'lyric_video', 'humorous', 'teaser',
];

// Maps GPT variants → canonical allowed value (typos, near-synonyms, cross-field leakage).
// Format-types and archetypes that bleed into behavior_tags are mapped to null so they are
// silently dropped (they are already captured in format_type / content_archetype fields).
const BEHAVIOR_TAG_NORMALIZE = {
  // typos
  'personalitiy_driven':       'personality_driven',
  'personalized_experimentation': 'experimental',
  // near-synonyms
  'humor':                     'humorous',
  'short_form':                'viral_short_form',
  'visualization':             'cinematic',
  'visualizer':                null,
  'lyric videos':              'lyric_video',
  'experiment':                'experimental',
  // format-type leakage → null (already in format_type field)
  'tutorial': null, 'vlog': null, 'interview': null, 'podcast': null,
  'documentary': null, 'compilation': null, 'shorts': null, 'lecture': null,
  'webinar': null, 'review': null, 'livestream': null, 'essay': null,
  // archetype/niche leakage → null
  'entertainer': null, 'comedy': null, 'music': null,
};

// ── Layer 4: Creator archetype (psychological identity) ───────────────────────
const ALLOWED_ARCHETYPES = [
  'authority_educator', 'storyteller', 'analyst', 'reviewer',
  'entertainer', 'commentator', 'debater', 'interviewer',
  'personality_host', 'investigative_creator',
];

const ALLOWED_FORMAT_TYPES = [
  'tutorial', 'vlog', 'review', 'documentary', 'interview',
  'podcast', 'livestream', 'compilation', 'essay', 'shorts', 'news', 'other',
];

const ALLOWED_AUDIENCE_STYLES = [
  'general', 'beginner', 'intermediate', 'expert', 'children', 'teens', 'professional',
];

// Safe defaults used when GPT response is malformed or missing fields.
const SAFE_DEFAULTS = {
  primary_niche:      'other',
  secondary_niche:    null,
  inferred_topics:    [],
  behavior_tags:      [],
  content_archetype:  'commentator',
  format_type:        'other',
  audience_style:     'general',
  identity_confidence: 0,
  identity_reasoning:  '',
};

// ── Prompt ────────────────────────────────────────────────────────────────────

function buildSystemPrompt() {
  return `You are a YouTube channel content intelligence system. Your job is to classify channels using a 5-step reasoning process. You MUST respond with a single JSON object and nothing else.

REASONING STEPS (follow this order internally):

STEP 1 — Identify the TRUE semantic domain
Understand what this channel genuinely discusses. Do not force it into categories yet.
Examples: geopolitics, automotive reviews, startup culture, personal finance, military strategy, consumer electronics

STEP 2 — Map to nearest ALLOWED primary_niche
Choose from this EXACT list only:
${ALLOWED_NICHES.join(', ')}

Rules:
- NEVER invent a new primary_niche value
- If no clear match exists, use "other"
- Map semantic → umbrella: geopolitics→politics, political commentary→politics, elections→politics, startup culture→business, AI tools→technology, economic commentary→finance, self improvement→lifestyle, breaking news→news, current events (non-political)→news

STEP 3 — Generate inferred_topics[]
Free-form semantic descriptors of what the channel ACTUALLY discusses.
- 1 to 6 topics
- lowercase, concise noun phrases
- preserve nuance the niche mapping cannot capture
Examples: ["geopolitics", "military strategy", "world affairs"] or ["electric vehicles", "automotive reviews", "consumer technology"]

STEP 4 — Generate behavior_tags[]
Structural mechanics — HOW the content is packaged.
Choose from this EXACT list only:
${ALLOWED_BEHAVIOR_TAGS.join(', ')}

Rules:
- 1 to 5 tags
- behavior_tags describe packaging mechanics, NOT semantic topics and NOT format types
- NEVER use format types as behavior_tags. "tutorial", "vlog", "podcast", "interview", "shorts", "documentary", "compilation" belong in format_type, NOT here
- NEVER use content niches as behavior_tags. "comedy", "music", "travel", "entertainer" are NOT behavior tags
- Use canonical underscore forms: "behind_the_scenes" not "behind the scenes", "music_video" not "music video", "highlight_reel" not "highlight reel", "recipe_based" not "recipe demonstration"
- "storytelling" means narration structure, NOT that the channel covers stories about history

STEP 5 — Determine content_archetype
The creator's psychological and production persona. Choose ONE from:
${ALLOWED_ARCHETYPES.join(', ')}

OUTPUT FORMAT (strict JSON, no markdown, no extra keys):
{
  "primary_niche": "",
  "secondary_niche": "",
  "inferred_topics": [],
  "behavior_tags": [],
  "content_archetype": "",
  "format_type": "",
  "audience_style": "",
  "identity_confidence": 0.0,
  "identity_reasoning": ""
}

identity_confidence: 0.0–1.0 float. How clearly the channel's identity emerged from the titles.
identity_reasoning: 1–2 sentences. Explain your classification.
format_type: choose from: ${ALLOWED_FORMAT_TYPES.join(', ')}
audience_style: choose from: ${ALLOWED_AUDIENCE_STYLES.join(', ')} — use "teens" not "teen", "general" for student/young-adult audiences
secondary_niche: null if not applicable.`;
}

function buildUserPrompt(channelName, titles) {
  const sample = titles.slice(0, 40).map((t, i) => `${i + 1}. ${t}`).join('\n');
  return `Channel: ${channelName || 'Unknown'}

Recent video titles:
${sample}

Classify this channel following the 5-step reasoning process. Return only the JSON object.`;
}

// ── Resilient parser ──────────────────────────────────────────────────────────
// Never throws. Normalizes all fields. Injects safe defaults for anything missing
// or invalid. GPT-4.1-mini can return structurally valid JSON with wrong values.

function normalizeTopics(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  return raw
    .map(t => String(t).toLowerCase().trim())
    .filter(t => t.length > 0 && t.length < 60)
    .filter(t => { if (seen.has(t)) return false; seen.add(t); return true; })
    .slice(0, 6);
}

function normalizeBehaviorTags(raw) {
  if (!Array.isArray(raw)) return { valid: [], discarded: [] };
  const seen = new Set();
  const valid = [], discarded = [];
  for (const v of raw) {
    const key = String(v).toLowerCase().trim();
    if (key in BEHAVIOR_TAG_NORMALIZE) {
      const mapped = BEHAVIOR_TAG_NORMALIZE[key];
      if (mapped && !seen.has(mapped)) { seen.add(mapped); valid.push(mapped); }
      // null mapping = silently drop (format/archetype leakage, already captured elsewhere)
    } else if (ALLOWED_BEHAVIOR_TAGS.includes(key)) {
      if (!seen.has(key)) { seen.add(key); valid.push(key); }
    } else {
      discarded.push(key);
    }
  }
  return { valid: valid.slice(0, 5), discarded };
}

function normalizeAllowedArray(raw, allowedList, maxItems) {
  if (!Array.isArray(raw)) return { valid: [], discarded: [] };
  const valid     = raw.filter(v =>  allowedList.includes(v)).slice(0, maxItems);
  const discarded = raw.filter(v => !allowedList.includes(v));
  return { valid, discarded };
}

function parseClassifierResponse(raw) {
  let parsed;
  try {
    const match = (raw ?? '').match(/\{[\s\S]*\}/);
    if (!match) throw new Error('no JSON object found');
    parsed = JSON.parse(match[0]);
  } catch (e) {
    console.warn('[Classifier] JSON parse failed:', e.message, '— using safe defaults');
    return { ...SAFE_DEFAULTS };
  }

  const p = parsed;

  const _discarded = [];

  const primary_niche = ALLOWED_NICHES.includes(p.primary_niche)
    ? p.primary_niche
    : (() => { _discarded.push(`primary_niche:${p.primary_niche}`); return 'other'; })();

  const secondary_niche = ALLOWED_NICHES.includes(p.secondary_niche)
    ? p.secondary_niche
    : null;

  const content_archetype = ALLOWED_ARCHETYPES.includes(p.content_archetype)
    ? p.content_archetype
    : (() => { _discarded.push(`archetype:${p.content_archetype}`); return SAFE_DEFAULTS.content_archetype; })();

  const format_type = ALLOWED_FORMAT_TYPES.includes(p.format_type)
    ? p.format_type
    : (() => { _discarded.push(`format:${p.format_type}`); return SAFE_DEFAULTS.format_type; })();

  const audience_style = ALLOWED_AUDIENCE_STYLES.includes(p.audience_style)
    ? p.audience_style
    : (() => { _discarded.push(`audience:${p.audience_style}`); return SAFE_DEFAULTS.audience_style; })();

  const { valid: behavior_tags, discarded: badTags } = normalizeBehaviorTags(p.behavior_tags);
  badTags.forEach(t => _discarded.push(`behavior_tag:${t}`));

  const identity_confidence = Math.min(1, Math.max(0, Number(p.identity_confidence) || 0));
  const identity_reasoning  = typeof p.identity_reasoning === 'string'
    ? p.identity_reasoning.slice(0, 500)
    : '';

  return {
    primary_niche,
    secondary_niche,
    inferred_topics: normalizeTopics(p.inferred_topics),
    behavior_tags,
    content_archetype,
    format_type,
    audience_style,
    identity_confidence,
    identity_reasoning,
    _discarded,
  };
}

// ── Identity strength (server-side only, never from GPT) ──────────────────────

function computeIdentityStrength(confidence, primaryNiche, secondaryNiche) {
  if (confidence >= 0.75 && (!secondaryNiche || secondaryNiche === primaryNiche)) {
    return confidence;
  }
  if (confidence >= 0.5) {
    return confidence * 0.85;
  }
  return confidence * 0.6;
}

// ── Main export ───────────────────────────────────────────────────────────────

async function classifyChannel({ channelName, titles }) {
  if (!titles || titles.length === 0) {
    throw new Error('No titles available for classification');
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY not set');

  const openai = new OpenAI({ apiKey });

  const response = await openai.chat.completions.create({
    model: 'gpt-4.1-mini',
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: buildSystemPrompt() },
      { role: 'user',   content: buildUserPrompt(channelName, titles) },
    ],
    temperature: 0.1,
    max_tokens:  600,
  });

  const raw    = response.choices?.[0]?.message?.content ?? '';
  const result = parseClassifierResponse(raw);

  result.identity_strength          = computeIdentityStrength(
    result.identity_confidence,
    result.primary_niche,
    result.secondary_niche,
  );
  result.identity_last_detected_at  = new Date().toISOString();

  return result;
}

module.exports = {
  classifyChannel,
  ALLOWED_NICHES,
  ALLOWED_BEHAVIOR_TAGS,
  ALLOWED_ARCHETYPES,
  ALLOWED_FORMAT_TYPES,
  ALLOWED_AUDIENCE_STYLES,
};

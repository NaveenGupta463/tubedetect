'use strict';

// G3 — Title DNA builder.
// Creates a structured behavioral-semantic intermediate representation of a title.
// This is NOT an embedding — it is normalized and then embedded.
//
// WHY: Raw title text has high noise. Structuring it first creates:
//   - Higher semantic consistency across similar archetypes
//   - Better cluster membership
//   - Reduced embedding noise
//   - Reusable intelligence primitives across services

const { classifyHookTypeMulti } = require('./hookClassifier');
const { extractFeatures }       = require('./featureExtraction');

// ── Regex helpers ─────────────────────────────────────────────────────────────

const QUESTION_RE        = /\?/;
const NUMBER_RE          = /\b\d+\b/;
const INSTRUCTIONAL_RE   = /\bhow\s+to\b|\bstep[- ]by[- ]step\b|\bguide\b|\btutorial\b/i;
const CHALLENGE_RE       = /\b\d+[- ](?:day|week|month)s?\s+challenge\b|\bchallenge\b/i;
const TRANSFORMATION_RE  = /\bbefore.{1,10}after\b|\bfrom\s+\S+\s+to\s+\S|\btransformation\b|\bmakeover\b/i;
const PERSONAL_RE        = /^(i |my |we |the )/i;
const QUESTION_LED_RE    = /^(how|what|why|when|where|who)\b/i;

const POWER_WORDS = [
  'secret', 'never', 'always', 'proven', 'shocking', 'truth', 'finally',
  'instantly', 'guaranteed', 'exposed', 'warning', 'mistake', 'hack',
  'blueprint', 'ultimate', 'complete', 'exact', 'real', 'honest',
];

const STOPWORDS = new Set([
  'a','an','the','is','are','was','were','be','been','have','has','do','does',
  'of','in','on','at','to','for','with','by','and','or','but','not','it','its',
  'you','your','i','my','me','we','our','they','their',
]);

// ── Helpers ───────────────────────────────────────────────────────────────────

function titleLengthBucket(title) {
  const words = title.trim().split(/\s+/).length;
  if (words <= 4)  return 'very_short';
  if (words <= 7)  return 'short';
  if (words <= 10) return 'medium';
  if (words <= 14) return 'long';
  return 'very_long';
}

function pacingStyle(title) {
  if (/[!]{2,}/.test(title))    return 'urgent';
  if (QUESTION_LED_RE.test(title)) return 'question_led';
  if (QUESTION_RE.test(title))  return 'interrogative';
  if (/^\d/.test(title))        return 'numbered';
  if (PERSONAL_RE.test(title))  return 'personal';
  return 'declarative';
}

function emotionalPolarity(features) {
  const s = features?.sentiment_score ?? 0;
  if (s > 0) return 'positive';
  if (s < 0) return 'negative';
  return 'neutral';
}

function authorityLevel(title) {
  if (/\b(doctor|dr\.?|expert|scientist|professor|ceo|founder|surgeon|researcher|phd)\b/i.test(title)) return 'high';
  if (/\b(study|research|science|proven|according\s+to|studies?\s+show)\b/i.test(title)) return 'moderate';
  return 'none';
}

function extractPowerWords(title) {
  const lower = title.toLowerCase();
  return POWER_WORDS.filter(w => lower.includes(w));
}

function extractSemanticTokens(title) {
  return title.toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 2 && !STOPWORDS.has(t))
    .filter((v, i, arr) => arr.indexOf(v) === i);
}

// ── Main builder ──────────────────────────────────────────────────────────────

function buildTitleDNA(title, hookProfile = null, extractedFeatures = null) {
  const features = extractedFeatures ?? extractFeatures({ title, hook: title });
  const hooks    = hookProfile ?? classifyHookTypeMulti(title);

  return {
    hooks:                   hooks.predicted_hooks?.map(h => h.type) ?? [],
    emotional_polarity:      emotionalPolarity(features),
    pacing_style:            pacingStyle(title),
    title_length_bucket:     titleLengthBucket(title),
    authority_level:         authorityLevel(title),
    curiosity_gap_score:     features.curiosity_score ?? 0,
    numeric_usage:           NUMBER_RE.test(title) ? 1 : 0,
    narrative_structure:     pacingStyle(title),
    power_words:             extractPowerWords(title),
    challenge_presence:      CHALLENGE_RE.test(title) ? 1 : 0,
    transformation_presence: TRANSFORMATION_RE.test(title) ? 1 : 0,
    question_presence:       QUESTION_RE.test(title) ? 1 : 0,
    instructional_presence:  INSTRUCTIONAL_RE.test(title) ? 1 : 0,
    emotional_intensity:     features.power_word_score ?? 0,
    semantic_tokens:         extractSemanticTokens(title),
  };
}

// ── Serialization ─────────────────────────────────────────────────────────────
// Converts DNA to a normalized text string for embedding.
// Format ensures consistent representation across similar title structures.

function titleDnaToString(dna) {
  const parts = [
    `hooks:${(dna.hooks ?? []).join(',')}`,
    `pacing:${dna.pacing_style}`,
    `polarity:${dna.emotional_polarity}`,
    `length:${dna.title_length_bucket}`,
    `authority:${dna.authority_level}`,
    `question:${dna.question_presence}`,
    `instructional:${dna.instructional_presence}`,
    `numeric:${dna.numeric_usage}`,
    `challenge:${dna.challenge_presence}`,
    `transformation:${dna.transformation_presence}`,
    `curiosity:${dna.curiosity_gap_score}`,
    `intensity:${dna.emotional_intensity}`,
  ];
  if ((dna.power_words ?? []).length > 0) {
    parts.push(`power:${dna.power_words.join(',')}`);
  }
  if ((dna.semantic_tokens ?? []).length > 0) {
    parts.push(`tokens:${dna.semantic_tokens.join(' ')}`);
  }
  return parts.join(' ');
}

module.exports = { buildTitleDNA, titleDnaToString };

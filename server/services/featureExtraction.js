const POWER_WORDS = [
  'secret', 'never', 'always', 'proven', 'shocking',
  'truth', 'finally', 'instantly', 'guaranteed', 'viral',
  'exposed', 'warning', 'mistake', 'hack', 'blueprint',
  'ultimate', 'complete', 'exact', 'real', 'honest',
];

const CURIOSITY_WORDS = [
  'secret', 'nobody', 'no one', "they don't want", 'missing',
  'before it\'s too late', 'hidden', 'truth about', 'real reason',
  'what they', 'why nobody', 'the real', 'untold',
];

const URGENCY_WORDS = [
  'now', 'today', 'before', '2025', '2026', '2027',
  'immediately', 'asap', 'hurry', 'limited', 'last chance',
  'don\'t wait', 'right now', 'this week', 'this year',
];

const POSITIVE_WORDS = [
  'best', 'amazing', 'incredible', 'great', 'perfect', 'love',
  'awesome', 'brilliant', 'excellent', 'fantastic', 'success',
  'win', 'profit', 'grow', 'easy', 'simple', 'free', 'boost',
];

const NEGATIVE_WORDS = [
  'worst', 'terrible', 'fail', 'broke', 'dead', 'wrong',
  'danger', 'scam', 'lie', 'mistake', 'problem', 'crisis',
  'disaster', 'warning', 'avoid', 'stop', 'never', 'bad',
];

const HOOK_PATTERNS = {
  question:  /\?/,
  shock:     /\b(shocking|unbelievable|insane|crazy|never|worst|best ever|you won't believe)\b/i,
  curiosity: /\b(secret|hidden|nobody|they don't|what happens|the real|truth about|why|how)\b/i,
  story:     /\b(i |my |we |story|journey|went from|started|tried|spent)\b/i,
};

function classifyHookType(hook) {
  if (HOOK_PATTERNS.question.test(hook)) return 'question';
  if (HOOK_PATTERNS.shock.test(hook))    return 'shock';
  if (HOOK_PATTERNS.curiosity.test(hook)) return 'curiosity';
  if (HOOK_PATTERNS.story.test(hook))    return 'story';
  return 'other';
}

function countMatches(text, wordList) {
  const lower = text.toLowerCase();
  return wordList.reduce((n, w) => n + (lower.includes(w) ? 1 : 0), 0);
}

/**
 * curiosity_score: 0–10, how many curiosity gap signals appear across title+hook.
 */
function computeCuriosityScore(title, hook) {
  const combined = `${title} ${hook}`.toLowerCase();
  return Math.min(10, countMatches(combined, CURIOSITY_WORDS));
}

/**
 * urgency_score: 0–10, count of urgency signals across title+hook.
 */
function computeUrgencyScore(title, hook) {
  const combined = `${title} ${hook}`.toLowerCase();
  return Math.min(10, countMatches(combined, URGENCY_WORDS));
}

/**
 * specificity_score: 0–3.
 *   +1 if title contains a digit
 *   +1 if title contains a year (2020-2029)
 *   +1 if title contains a dollar/percent sign
 */
function computeSpecificityScore(title) {
  let score = 0;
  if (/\d/.test(title))                    score++;
  if (/202[0-9]/.test(title))              score++;
  if (/[$%]|\d+[kK]\b/.test(title))       score++;
  return score;
}

/**
 * power_word_score: 0–10, count of power words across title+hook.
 */
function computePowerWordScore(title, hook) {
  const combined = `${title} ${hook}`.toLowerCase();
  return Math.min(10, countMatches(combined, POWER_WORDS));
}

/**
 * sentiment_score: -1 (negative), 0 (neutral), +1 (positive).
 * Simple polarity based on word lists.
 */
function computeSentimentScore(title, hook) {
  const combined = `${title} ${hook}`.toLowerCase();
  const pos = countMatches(combined, POSITIVE_WORDS);
  const neg = countMatches(combined, NEGATIVE_WORDS);
  if (pos > neg) return 1;
  if (neg > pos) return -1;
  return 0;
}

/**
 * @param {object} input
 * @param {string} input.title
 * @param {string} input.hook
 * @param {string} input.niche
 * @param {Date|string|null} input.lastUploadDate
 * @returns {object} feature row matching `features` table columns
 */
function extractFeatures(input) {
  const { title, hook, lastUploadDate } = input;

  const title_length    = title.trim().length;
  const has_number      = /\d/.test(title) ? 1 : 0;
  const titleLower      = title.toLowerCase();
  const has_power_word  = POWER_WORDS.some(w => titleLower.includes(w)) ? 1 : 0;
  const hook_type       = classifyHookType(hook);
  const hook_question_present = /\?/.test(hook) ? 1 : 0;
  const upload_day      = new Date().getDay();

  let days_since_last_upload = null;
  if (lastUploadDate) {
    const last = new Date(lastUploadDate);
    days_since_last_upload = Math.round((new Date() - last) / (1000 * 60 * 60 * 24));
  }

  const niche_trend_score  = 0;
  const curiosity_score    = computeCuriosityScore(title, hook);
  const urgency_score      = computeUrgencyScore(title, hook);
  const specificity_score  = computeSpecificityScore(title);
  const power_word_score   = computePowerWordScore(title, hook);
  const sentiment_score    = computeSentimentScore(title, hook);

  return {
    title_length,
    has_number,
    has_power_word,
    hook_type,
    hook_question_present,
    upload_day,
    days_since_last_upload,
    niche_trend_score,
    curiosity_score,
    urgency_score,
    specificity_score,
    power_word_score,
    sentiment_score,
  };
}

module.exports = { extractFeatures };

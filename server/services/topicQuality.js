'use strict';

// ── Hard junk patterns ────────────────────────────────────────────────────────
// Phrases that are never editorially useful as WTP topics, regardless of niche.
// These are YouTube CTA artifacts and engagement-bait fragments.
// Compiled once — this is called thousands of times per WTP request.

const HARD_JUNK_SET = new Set([
  'happy birthday', 'wait end', 'watch till', 'after long', 'never give',
  'most dangerous', 'mini vlog', 'full video', 'new video', 'part 1',
  'subscribe now', 'like share', 'watch full', 'last video', 'next video',
  'wait karo', 'end mein', 'please watch', 'must watch', 'dont miss',
  'link bio', 'link description', 'comment below', 'drop like',
  'gone wrong', 'kar diya', 'one shot', 'aaj mai', 'eat day',
  'most beautiful', 'الترم الثاني',
]);

// CTA prefix: "watch this...", "never give up", "please subscribe"
const CTA_PREFIX_RE = /^(watch|wait|never|after|before|please|like|share|comment|subscribe)\b/i;
// CTA suffix: "...till end", "...watch now", "...full video"
const CTA_SUFFIX_RE = /\b(till|end|now|video|shorts|here|subscribe|like|share)$/i;

const GENERIC_ADJECTIVE_PHRASES = new Set([
  'most powerful',
  'most expensive',
  'most popular',
  'most viral',
  'big update',
  'new update',
  'full details',
  'latest update',
  'complete information',
]);

const MALFORMED_TOPIC_SET = new Set([
  'body parts indian',
  'car indian bike',
  'found secret',
  'franklin change',
  'franklin change house',
  'franklin found',
  'franklin found tiny',
  'suit crate',
  'suit crate opening',
]);

const WEAK_SINGLE_WORDS = new Set([
  'powerful', 'latest', 'viral', 'beautiful', 'expensive', 'popular',
  'amazing', 'shocking', 'secret', 'official', 'update', 'details',
]);

const FRAGMENT_VERBS = new Set([
  'found', 'finds', 'change', 'changed', 'changes', 'gets', 'got',
  'made', 'make', 'went', 'goes', 'gone',
]);

// Context-dependent person/topic phrases. These can be real topics for
// entertainment/news/politics, but are usually leakage in food/travel/education/etc.
const KNOWN_PERSON_TOPIC_SET = new Set([
  'samay raina',
  'narendra modi',
  'rahul gandhi',
  'donald trump',
  'elon musk',
  'virat kohli',
  'ranveer allahbadia',
]);

const PERSON_FIRST_NAMES = new Set([
  'samay', 'narendra', 'rahul', 'donald', 'elon', 'virat', 'ranveer',
  'rohit', 'amit', 'akshay', 'salman', 'shahrukh', 'deepika',
]);

const PERSON_LAST_NAMES = new Set([
  'raina', 'modi', 'gandhi', 'trump', 'musk', 'kohli', 'allahbadia',
  'sharma', 'kumar', 'singh', 'khan', 'kapoor', 'padukone',
]);

const PERSON_ALLOWED_NICHES = new Set([
  'entertainment', 'comedy', 'news', 'politics',
]);

const PERSON_ALLOWED_CSPS = new Set([
  'comedy_sketch', 'news_event_bulletin',
]);

/**
 * Returns true if the phrase is context-independent garbage.
 * Hard-rejects only universal CTA artifacts and engagement bait.
 * Person names and weak-evidence topics belong in quality scoring, not here.
 */
function isHardJunkPhrase(phrase) {
  const lower = phrase.toLowerCase().trim();
  if (HARD_JUNK_SET.has(lower)) return true;
  if (/[\u0600-\u06ff]/.test(lower)) return true;
  if (CTA_PREFIX_RE.test(lower)) return true;
  if (CTA_SUFFIX_RE.test(lower)) return true;
  return false;
}

function isMostlyModelCodePhrase(words) {
  if (words.length < 2) return false;
  let codeLike = 0;
  for (const w of words) {
    if (/^[a-z]?\d+[a-z]?\d*$/i.test(w)) codeLike++;
    else if (/^\d+[a-z]+$/i.test(w)) codeLike++;
  }
  return codeLike >= Math.max(2, words.length - 1);
}

function isMalformedTopicPhrase(phrase, { parent_topic, niche, primary_niche } = {}) {
  const lower = String(phrase || '').toLowerCase().trim();
  if (!lower) return true;
  if (GENERIC_ADJECTIVE_PHRASES.has(lower)) return true;
  if (MALFORMED_TOPIC_SET.has(lower)) return true;
  if (/^(franklin|suit|crate)\s+(found|change|opening|secret|tiny|house)\b/.test(lower)) return true;

  const words = lower.split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  if (words.length === 1 && WEAK_SINGLE_WORDS.has(words[0])) return true;
  if (isMostlyModelCodePhrase(words)) return true;

  const alphaWords = words.filter(w => /[a-z]/i.test(w));
  const meaningfulWords = words.filter(w => w.replace(/[^a-z0-9]/gi, '').length >= 3).length;
  const hasNamedContext = parent_topic != null || /\d{4}|5g|ai|ev|ipl|gdp|rbi|upsc|jee|neet/i.test(lower);
  const nicheText = `${niche || ''} ${primary_niche || ''}`.toLowerCase();

  if (words.length <= 2 && meaningfulWords < 2 && !hasNamedContext) return true;
  if (words.length === 2 && alphaWords.length === 1 && /\d/.test(lower) && !/technology|gadgets|automotive|gaming/i.test(nicheText)) return true;
  if (words.length === 3 && words.includes('indian') && words[0] !== 'indian' && !hasNamedContext) return true;
  if (words.length === 3 && FRAGMENT_VERBS.has(words[1]) && !hasNamedContext) return true;
  if (words.length === 3 && FRAGMENT_VERBS.has(words[0]) && !hasNamedContext) return true;
  return false;
}

function isPersonNameLike(phrase) {
  const lower = phrase.toLowerCase().trim();
  if (KNOWN_PERSON_TOPIC_SET.has(lower)) return true;
  const words = lower.split(/\s+/).filter(Boolean);
  if (words.length !== 2) return false;
  return PERSON_FIRST_NAMES.has(words[0]) && PERSON_LAST_NAMES.has(words[1]);
}

function isPersonTopicAllowed({ niche, primary_niche, csp_primary, parent_topic } = {}) {
  const n = String(primary_niche || niche || '').toLowerCase();
  const csp = String(csp_primary || '').toLowerCase();
  if (PERSON_ALLOWED_NICHES.has(n)) return true;
  if (PERSON_ALLOWED_CSPS.has(csp)) return true;
  if (parent_topic === 'Entertainment' || parent_topic === 'Politics') return true;
  return false;
}

function isDisallowedPersonTopic(phrase, context = {}) {
  if (!isPersonNameLike(phrase)) return false;
  return !isPersonTopicAllowed(context);
}

/**
 * Scores phrase specificity for the WTP final relevance score.
 * Called once per topic in the scoring loop, after hard-reject screening.
 *
 * parent_topic: value from inferParentTopic() — callers compute this once
 *   and pass it here to avoid a second keyword scan.
 *
 * Positive signals:
 *   +15 if phrase has a recognised parent topic category
 *   +8  if phrase has 3+ meaningful words (less generic)
 *   +10 if phrase contains a 2+-digit number (model, year: "S26", "2025", "5G")
 *
 * Negative signals:
 *   -20 if phrase has fewer than 2 meaningful words (pure fragment)
 */
function assessTopicQuality(phrase, { parent_topic, niche, primary_niche, csp_primary } = {}) {
  const meaningfulWords = phrase.split(' ').filter(w => w.length >= 3).length;

  let quality = 0;
  if (isMalformedTopicPhrase(phrase, { parent_topic, niche, primary_niche })) quality -= 50;
  if (parent_topic != null) quality += 15;
  if (meaningfulWords >= 4)  quality += 14;
  else if (meaningfulWords >= 3) quality += 8;
  if (/\d{2,}/.test(phrase)) quality += 10;
  if (meaningfulWords < 2)   quality -= 20;
  if (isDisallowedPersonTopic(phrase, { parent_topic, niche, primary_niche, csp_primary })) quality -= 30;

  return quality;
}

module.exports = {
  isHardJunkPhrase,
  isPersonNameLike,
  isDisallowedPersonTopic,
  isMalformedTopicPhrase,
  assessTopicQuality,
};

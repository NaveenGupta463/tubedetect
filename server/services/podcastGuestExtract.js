'use strict';

// Extracts person-name candidates from podcast peer titles using a sliding
// window over consecutive title-case words. A conservative stop set removes
// common English words that are capitalised but never person names. Cross-peer
// validation (appearing in ≥2 distinct peer channels) then eliminates show
// titles and topical phrases that survive the stop-set filter.

const GUEST_STOPSET = new Set([
  'The', 'How', 'Why', 'What', 'When', 'Where', 'Who', 'Did', 'Can', 'Has', 'Was',
  'Full', 'Live', 'Watch', 'Part', 'Season', 'Episode', 'Breaking', 'Latest',
  'Top', 'Best', 'New', 'Big', 'First', 'Last', 'Real', 'True', 'Young', 'Old',
  'My', 'Your', 'Our', 'His', 'Her', 'Its', 'This', 'That', 'These', 'Those',
  'India', 'Indian', 'World', 'Life', 'Time', 'Today', 'Tomorrow', 'Never', 'Always',
  'Building', 'Making', 'Starting', 'Growing', 'Finding', 'Becoming', 'Running',
  'Business', 'Money', 'Career', 'Startup', 'Success', 'Work', 'Story',
  'Low', 'High', 'Investment', 'Investing', 'Profit', 'Income', 'Revenue',
  'Financial', 'Finance', 'Market', 'Stocks', 'Trading', 'Millionaire',
]);

const GUEST_REJECT_TERMS = new Set([
  'movie', 'review', 'explained', 'trailer', 'reaction', 'song', 'official', 'highlights',
  'shorts', 'aloe', 'vera', 'episode', 'podcast', 'cricket', 'match', 'full', 'news', 'live',
  'event', 'grand', 'dark', 'side', 'reality', 'people', 'lose', 'chand', 'dil', 'party',
  'tuning', 'inspiration',
  'middle', 'class', 'death', 'of',
  // Finance/topic fragments that are title-case but not guests
  'low', 'high', 'investment', 'investing', 'profit', 'income', 'revenue',
  'financial', 'finance', 'market', 'markets', 'stocks', 'trading', 'wealth',
  'business', 'startup', 'career', 'mindset', 'freedom', 'millionaire',
  // Location-like candidates
  'bombay', 'mumbai', 'delhi', 'india', 'bangalore', 'bengaluru', 'hyderabad', 'chennai',
  // Institution and profession terms — channels/entities, not person names
  'law', 'academy', 'school', 'college', 'institute', 'university', 'foundation',
  'clinic', 'hospital', 'company', 'studio', 'media', 'adv', 'advocate',
]);

// Subset of GUEST_REJECT_TERMS used only for debug tracking of institution rejections.
const INSTITUTION_GUEST_TERMS = new Set([
  'law', 'academy', 'school', 'college', 'institute', 'university', 'foundation',
  'clinic', 'hospital', 'company', 'studio', 'media', 'adv', 'advocate',
]);

const GUEST_REJECT_PHRASE_RE = /\bmovie review\b|\btrailer reaction\b|\bdark (?:side|reality)\b|\bgrand event\b|\bpati patni aur\b|\bpeople lose\b|\bchand mera dil\b|\bmiddle class\b|\bdeath of\b|\blow investment\b|\bhigh investment\b|\blow profit\b|\bhigh profit\b|\binvestment plan\b|\bmoney mindset\b|\bfinancial freedom\b/i;

// Markers that signal a guest name follows immediately after.
const GUEST_MARKER_RE = /\b(?:feat?\.?|ft\.?|with|interview(?:\s+with)?|podcast\s+with|episode\s+with)\s+/i;

// Full-scan candidates must have all words ≥ 3 chars to be person-like.
function isPersonLikeName(name) {
  return name.split(' ').every(w => w.length >= 3);
}

// Common English words that form non-person Title-Case phrases ("Better Daily Choices",
// "Real Life Story") which slip past the structural check. A name where EVERY word is one
// of these is almost certainly a show/series/topic label, not a person.
const PERSON_NAME_COMMON_WORDS = new Set([
  'better', 'daily', 'choices', 'choice', 'real', 'life', 'story', 'stories', 'truth', 'best',
  'good', 'great', 'your', 'more', 'less', 'deep', 'deeper', 'high', 'low', 'new', 'old', 'big',
  'small', 'hidden', 'secret', 'secrets', 'power', 'powerful', 'simple', 'easy', 'hard', 'modern',
  'ancient', 'mind', 'body', 'soul', 'world', 'time', 'money', 'success', 'growth', 'change',
  'people', 'things', 'ways', 'reason', 'reasons', 'lessons', 'rules', 'habits', 'tips', 'guide',
  'mistakes', 'wealth', 'health', 'happy', 'happiness', 'rich', 'poor', 'smart', 'brain', 'focus',
  'energy', 'every', 'first', 'last', 'next', 'real', 'true', 'living', 'mindset', 'wisdom',
  'anger', 'issues', 'fear', 'love', 'hate', 'stress', 'trauma', 'healing', 'journey', 'vibes',
  'mood', 'anxiety', 'depression', 'confidence', 'discipline', 'motivation',
]);
function looksLikePersonName(name) {
  if (!isPersonLikeName(name)) return false;
  const words = String(name).split(' ').filter(Boolean);
  return !words.every(w => PERSON_NAME_COMMON_WORDS.has(w.toLowerCase()));
}

// Returns { marker: string[], fullScan: string[] }.
// debugInfo = { wordRejected: [], phraseRejected: [], institutionRejected: [] } when caller wants rejection tracking.
function extractGuestCandidates(title, debugInfo = null) {
  if (!title) return { marker: [], fullScan: [] };
  const clean = title.replace(/\|{2}[^|]+\|{2}/g, '').replace(/#\w+/g, '').trim();
  const marker   = [];
  const fullScan = [];

  const tryCandidate = (parts, bucket) => {
    if (parts.length < 2) return;
    const joined = parts.join(' ');
    const lowers = parts.map(w => w.toLowerCase());
    if (lowers.some(w => GUEST_REJECT_TERMS.has(w))) {
      if (debugInfo) {
        if (lowers.some(w => INSTITUTION_GUEST_TERMS.has(w))) debugInfo.institutionRejected.push(joined);
        else debugInfo.wordRejected.push(joined);
      }
      return;
    }
    if (GUEST_REJECT_PHRASE_RE.test(joined)) {
      if (debugInfo) debugInfo.phraseRejected.push(joined);
      return;
    }
    bucket.push(joined);
  };

  const markerMatch = GUEST_MARKER_RE.exec(clean);
  if (markerMatch) {
    // Marker found — only extract the name immediately following it.
    const after = clean.slice(markerMatch.index + markerMatch[0].length);
    const words = after.split(/\s+/);
    const nameParts = [];
    for (const w of words) {
      if (/^[A-Z][a-z]{1,18}$/.test(w) && !GUEST_STOPSET.has(w)) {
        nameParts.push(w);
        if (nameParts.length >= 4) break;
      } else {
        break;
      }
    }
    if (nameParts.length >= 2) tryCandidate(nameParts.slice(0, 3), marker);
  } else {
    // No marker — full-scan; REJECT_TERMS and phrase patterns filter noise.
    const words = clean.split(/\s+/);
    let i = 0;
    while (i < words.length) {
      if (/^[A-Z][a-z]{1,18}$/.test(words[i]) && !GUEST_STOPSET.has(words[i])) {
        let j = i + 1;
        while (j < words.length && /^[A-Z][a-z]{1,18}$/.test(words[j]) && !GUEST_STOPSET.has(words[j])) j++;
        if (j - i >= 2) tryCandidate(words.slice(i, Math.min(j, i + 3)), fullScan);
        i = j;
      } else {
        i++;
      }
    }
  }

  return { marker: [...new Set(marker)], fullScan: [...new Set(fullScan)] };
}

module.exports = {
  GUEST_STOPSET,
  GUEST_REJECT_TERMS,
  INSTITUTION_GUEST_TERMS,
  GUEST_REJECT_PHRASE_RE,
  GUEST_MARKER_RE,
  isPersonLikeName,
  looksLikePersonName,
  extractGuestCandidates,
};

'use strict';

// ── Creator mode classifier ───────────────────────────────────────────────────
// Translates (niche, format_type, content_archetype) into an operating mode that
// routes the channel to the correct peer graph and what-to-post engine.
//
// Priority is strict: UPSC → NEWS → PODCAST → FINANCE → TECH → SELF_IMPROVEMENT → GENERAL
// Podcast beats finance (Nikhil Kamath stays PODCAST, not FINANCE).
// News beats politics, but podcast beats both.

const CREATOR_MODE_VERSION = 2;

const EXAM_RE = /upsc|neet|ssc|jee|ias|competitive|entrance|prelims|mains|coaching|cracker/;

// Tokens stripped from podcast channel fingerprints so host-brand phrases
// don't dominate and prevent peer matching.
const PODCAST_META_TOKENS = new Set([
  'podcast', 'episode', 'ep', 'shorts', 'tomorrow', 'today', 'now',
  'watch', 'subscribe', 'live', 'new', 'latest', 'out', 'tonight',
  'official', 'channel', 'show', 'series',
]);

// rawNiche: the un-overridden `niche` column value (before primary_niche takes precedence).
// Primary classification overrides raw niche (education > upsc exam prep), but exam
// detection must check the raw label too — otherwise UPSC Wallah stays 'general'.
function detectCreatorMode(niche, formatType, archetype, rawNiche) {
  const n  = (niche     || '').toLowerCase().trim();
  const nr = (rawNiche  || '').toLowerCase().trim();
  const f  = (formatType || '').toLowerCase().trim();
  const a  = (archetype  || '').toLowerCase().trim();

  // 1. UPSC — exam/competitive intent overrides everything; check primary AND raw niche
  if (EXAM_RE.test(n) || EXAM_RE.test(nr)) {
    return { mode: 'upsc', confidence: 0.95, reason: 'niche matches exam regex' };
  }

  // 2. NEWS — format=news wins outright; niche=news|politics only if not podcast/interview
  if (f === 'news') {
    return { mode: 'news', confidence: 0.95, reason: 'format_type=news' };
  }
  if ((n === 'news' || n === 'politics') && f !== 'podcast' && f !== 'interview') {
    return { mode: 'news', confidence: 0.85, reason: `niche=${n} without podcast/interview format` };
  }

  // 3. PODCAST — format overrides niche; personality_host overrides archetype
  if (f === 'podcast' || f === 'interview') {
    return { mode: 'podcast', confidence: 0.9, reason: `format_type=${f}` };
  }
  if (a === 'personality_host' && n !== 'news') {
    return { mode: 'podcast', confidence: 0.8, reason: 'archetype=personality_host' };
  }

  // 4. FINANCE — finance/investing niche, or business + analytical/documentary format
  if (/finance|investing|investment|stock|market/.test(n)) {
    return { mode: 'finance', confidence: 0.9, reason: `niche=${n}` };
  }
  if (n === 'business' && (f === 'essay' || f === 'news' || f === 'documentary')) {
    return { mode: 'finance', confidence: 0.75, reason: `business niche with ${f} format` };
  }

  // 5. TECH
  if (/\btech\b|science|gadget|\bai\b/.test(n)) {
    return { mode: 'tech', confidence: 0.85, reason: `niche=${n}` };
  }
  if (a === 'tech_reviewer') {
    return { mode: 'tech', confidence: 0.85, reason: 'archetype=tech_reviewer' };
  }

  // 6. SELF_IMPROVEMENT (podcast clause removed — already caught by rule 3)
  if (/selfimprovement|motivation|wellness|fitness|mindset|mental.?health/.test(n)) {
    return { mode: 'selfimprovement', confidence: 0.85, reason: `niche=${n}` };
  }

  // 7. GENERAL — current behaviour, no regression
  return { mode: 'general', confidence: 0.5, reason: 'no specific mode matched' };
}

// Podcast format inference from title patterns.
// Accepts a titles array (strings) so callers supply their own DB query — keeps this module pure.
// Returns 'podcast' if ≥25% of titles contain a podcast signal word/pattern; else returns currentFormat.
const PODCAST_SIGNAL_RE = /\bpodcast\b|\bepisode\b|\bep\.?\s*\d+\b|\s#\d+\b|\bfeat?\.?\s*\w|\bft\.?\s*\w/i;

function inferPodcastFormat(titles, currentFormat) {
  if (currentFormat === 'podcast' || currentFormat === 'interview') return currentFormat;
  if (!titles || titles.length < 10) return currentFormat;
  let hits = 0;
  for (const title of titles) if (PODCAST_SIGNAL_RE.test(title)) hits++;
  return hits / titles.length >= 0.25 ? 'podcast' : currentFormat;
}

module.exports = { detectCreatorMode, CREATOR_MODE_VERSION, PODCAST_META_TOKENS, inferPodcastFormat, PODCAST_SIGNAL_RE };

'use strict';

const { computeCuriosityExplainerSignals } = require('./explainerProfile');

// ── Format Profile Layer ──────────────────────────────────────────────────────
// Classifies the *packaging* of a channel's content independently from the
// demand engine (creator_mode) and content universe (routing_profile).
//
// guest_interview:       rotating named guests, structured show format
// podcast_like_longform: episode-structured content, solo or weak-guest
// solo_teaching:         how-to / tutorial / meditation / guided content
// lecture:               exam-prep / syllabus-driven / class content
// shorts:                majority #shorts / short-form vertical
// essay:                 opinion / analysis / "why I/we" long-form
// news_bulletin:         breaking news / live updates / headlines
// vlog:                  day-in-my-life / daily diary content
// reaction:              react-to / response content
// documentary:           true story / investigative / inside-the-story
// curiosity_explainer:   question-led explainers about systems, products, society
// unknown:               insufficient title signal to classify

const FORMAT_PROFILES = {
  guest_interview:       { label: 'Guest & Interview Show' },
  podcast_like_longform: { label: 'Solo Podcast / Longform' },
  solo_teaching:         { label: 'Solo Teaching' },
  lecture:               { label: 'Lecture / Exam Prep' },
  shorts:                { label: 'Shorts-First' },
  essay:                 { label: 'Essay / Opinion' },
  news_bulletin:         { label: 'News Bulletin' },
  vlog:                  { label: 'Vlog / Daily Life' },
  reaction:              { label: 'Reaction Content' },
  documentary:           { label: 'Documentary / Investigative' },
  curiosity_explainer:   { label: 'Curiosity Explainer' },
  unknown:               { label: 'Unknown' },
};

// Bump when classifier rules change — triggers re-backfill.
const FORMAT_PROFILE_VERSION = 9;

// Contexts where "ft. X" / "| Name |" / name-at-start are NOT podcast guests but song
// features, film/TV cast, or kids characters. Music labels, TV networks, and kids channels
// were wrongly tagged guest_interview (T-Series, SET India, Vlad & Niki) → false podcast mode.
// Podcast-SAFE: deliberately excludes a bare "episode N" / "promo" (real podcasts use those too).
// Genuine guest podcasts score ~0 on these markers; music/film/TV/drama channels score 0.10-0.50.
const RELEASE_MARKER_RE = /\b(official\s+(?:music\s+)?video|lyric(?:al|s)?\s*video|full\s+(?:song|video|movie|audio|album|episode|ep)|audio\s+(?:song|jukebox)|video\s+song|jukebox|songs?|teaser|trailer|motion\s+poster|remix|web\s+series)\b/i;
const KIDS_MARKER_RE = /\b(kids?|child(?:ren)?|nursery|rhymes?|toddlers?|preschool|kindergarten|cartoons?|toons?|babies|baby|moral\s+stor)/i;
// Channel NAME reveals a media/broadcast brand (drama house, TV network, music label, shorts farm)
// where extracted "guests" are actors/artists, not podcast guests. Strong, precise signal.
const MEDIA_BRAND_NAME_RE = /\b(dramas?|serials?|tv|television|movies?|cinema|films?|music|records?|songs|tunes|bhakti|devotional|shorts|entertainment|studios?|productions?|pictures|network|prime|netflix|hotstar|shemaroo|saregama|yrf|zee5?|sonyliv|disney|voot|eros|goldmines)\b/i;

// Niche gate for guest_interview. Real interview/conversation podcasts live in knowledge/talk
// niches. CONTENT niches below have many named entities (actors, characters, players, artists)
// that trip the guest detector but are NOT interview guests → never guest_interview.
const GUEST_BLOCKED_NICHES = new Set([
  'gaming', 'music', 'film', 'cinema', 'movies', 'food', 'cooking', 'recipe', 'kids', 'beauty',
  'fashion', 'makeup', 'travel', 'lifestyle', 'dance', 'art', 'craft', 'automotive', 'cars',
  'animals', 'pets', 'nature', 'asmr', 'vlogs', 'vlog', 'meditation', 'relaxation', 'ambient',
]);
// 'entertainment' is GUARDED, not hard-blocked: genuine talk shows live here. Allow guest_interview
// only with STRICT interview markers — deliberately EXCLUDES "ft./feat." (those fire on sketch
// collabs & music) so FilterCopy-style sketch channels don't qualify, while real talk shows do.
const CONVERSATION_MARKER_RE = /\b(interview|in conversation|podcast|talk\s*show|sits?\s+down\s+with|on\s+the\s+(?:show|podcast)|joins?\s+(?:us|me|the)\b|one[-\s]on[-\s]one|candid\s+(?:chat|conversation)|unfiltered\s+chat)\b/i;

const CURIOSITY_FORMAT_BLOCK_NICHES = new Set([
  'music', 'entertainment', 'comedy', 'gaming', 'kids', 'beauty', 'fashion',
  'travel', 'lifestyle', 'food', 'cooking', 'sports', 'yoga', 'fitness',
]);

const CURIOSITY_FORMAT_BLOCK_HINTS = [
  'music', 'song', 'songs', 'bollywood', 'movie', 'film', 'trailer', 'teaser',
  'scene', 'lyric', 'karaoke', 'children', "children's", 'kids', 'cartoon',
  'animation', 'nursery', 'rhymes', 'gaming', 'gameplay', 'comedy', 'prank',
  'challenge', 'vlog', 'travel', 'recipe', 'cooking', 'diy', 'craft', 'beauty',
  'fashion', 'sports',
];

function isCuriosityFormatBlocked(row = {}) {
  const primaryNiche = String(row.primary_niche || row.niche || '').toLowerCase();
  const nicheDetail = String(row.niche || '').toLowerCase();
  const routingProfile = String(row.routing_profile || '').toLowerCase();
  const formatType = String(row.format_type || '').toLowerCase();
  const creatorMode = String(row.creator_mode || '').toLowerCase();

  if (creatorMode === 'podcast') return true;
  if (['podcast', 'interview', 'vlog', 'shorts', 'compilation', 'tutorial'].includes(formatType)) return true;
  if (primaryNiche === 'finance' && routingProfile === 'business_finance') return true;
  if (CURIOSITY_FORMAT_BLOCK_NICHES.has(primaryNiche)) return true;
  return CURIOSITY_FORMAT_BLOCK_HINTS.some(h => nicheDetail.includes(h));
}

// Guest name extraction patterns — order matters, most explicit first.
// All patterns require at least a two-word proper noun to avoid false hits
// on single common words. All are case-insensitive so "Ft", "FT", "ft." all match.
const GUEST_PATTERNS = [
  /\bft\.?\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)/i,               // "ft. First Last" / "Ft First Last"
  /\bfeat\.?\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)/i,             // "feat. First Last"
  /\bwith\s+([A-Z][a-z]+\s+[A-Z][a-z]+)/i,                     // "with First Last" / "With First Last"
  /\|\s*([A-Z][a-z]+\s+[A-Z][a-z]+)\s*[|:-]/,                  // "| First Last |" or "| First Last -"
  /(?:Ep|Episode)\.?\s*\d+\s*\|\s*([A-Z][a-z]+\s+[A-Z][a-z]+)/i, // "Ep 99 | First Last"
  /\binterview(?:ing)?\s+(?:with\s+)?([A-Z][a-z]+\s+[A-Z][a-z]+)/i, // "interview with First Last"
  /^([A-Z][a-z]+\s+[A-Z][a-z]+)\s*[|:-]/,                      // "First Last |" — name at title start + separator
  /^([A-Z][a-z]+\s+[A-Z][a-z]+)\s+(?:on|about|explains?)\b/i,  // "First Last on Topic" at title start
];

// Scores a channel's title corpus and returns the dominant format.
// Returns: { format_profile, confidence: 'high'|'medium'|'low'|'none', signals }
// `_row` is accepted for future use (legacy format_type boost) but not required.
function computeFormatProfile(titles, _row) {
  if (!titles || titles.length === 0) {
    return { format_profile: 'unknown', confidence: 'none', signals: {} };
  }

  const n = titles.length;
  let episodeCount  = 0;
  let guestHits     = 0;
  let shortsCount   = 0;
  let teachingCount = 0;
  let lectureCount  = 0;
  let newsCount     = 0;
  let vlogCount     = 0;
  let reactionCount = 0;
  let essayCount    = 0;
  let docCount      = 0;
  let releaseCount  = 0;
  let kidsCount     = 0;
  let convCount     = 0;
  const curiositySignals = computeCuriosityExplainerSignals(titles);
  const distinctGuests = new Set();

  for (const title of titles) {
    const tl = title.toLowerCase();
    if (RELEASE_MARKER_RE.test(title)) releaseCount++;
    if (KIDS_MARKER_RE.test(title))    kidsCount++;
    if (CONVERSATION_MARKER_RE.test(title)) convCount++;

    if (/\bep\.?\s*\d+|\bepisode\s*\d+|#\d{1,4}\b|\bvol\.?\s*\d+/i.test(title)) episodeCount++;
    if (tl.includes('#shorts') || tl.includes('#ytshorts'))                         shortsCount++;
    if (/\bhow\s+to\b|explained|tutorial|step.by.step|\bmasterclass\b|\bguide\b|beginner/.test(tl)) teachingCount++;
    if (/\bupsc\b|prelims\b|\bmains\b|chapter\s*\d|syllabus|\blecture\b/.test(tl)) lectureCount++;
    if (/breaking\s+news|latest\s+news|top\s+headlines|news\s+update|live\s*:/.test(tl))  newsCount++;
    if (/\bvlog\b|day\s+in\s+(?:my|our)\s+life|daily\s+vlog/.test(tl))             vlogCount++;
    if (/react(?:ing)?\s+to\b|my\s+reaction\s+to\b/.test(tl))                      reactionCount++;
    if (/the\s+problem\s+with\b|why\s+(?:i|we)\s|the\s+truth\s+about\b|what\s+nobody\s+tells/.test(tl)) essayCount++;
    if (/true\s+story\b|real\s+story\b|untold\s+story\b|dark\s+side\s+of\b|inside\s+the\b/.test(tl))    docCount++;

    // Guest detection uses original case for proper-noun matching.
    for (const pattern of GUEST_PATTERNS) {
      const m = title.match(pattern);
      if (m) {
        guestHits++;
        distinctGuests.add(m[1].toLowerCase().trim());
        break;
      }
    }
  }

  const signals = {
    n,
    episode_count:   episodeCount,
    guest_hits:      guestHits,
    distinct_guests: distinctGuests.size,
    shorts_count:    shortsCount,
    teaching_count:  teachingCount,
    lecture_count:   lectureCount,
    news_count:      newsCount,
    vlog_count:      vlogCount,
    reaction_count:  reactionCount,
    essay_count:     essayCount,
    doc_count:       docCount,
    release_count:   releaseCount,
    kids_count:      kidsCount,
    conv_count:      convCount,
    curiosity_count: curiositySignals.curiosity_count,
    explainer_count: curiositySignals.explainer_count,
    everyday_count:  curiositySignals.everyday_count,
    domain_count:    curiositySignals.domain_count,
    curiosity_ratio: curiositySignals.curiosity_ratio,
    domain_ratio:    curiositySignals.domain_ratio,
    curiosity_blockers: curiositySignals.blockers,
    curiosity_context_blocked: isCuriosityFormatBlocked(_row),
  };

  function conf(ratio, hiThreshold, midThreshold) {
    return ratio >= hiThreshold ? 'high' : ratio >= midThreshold ? 'medium' : 'low';
  }

  // ── News guard ────────────────────────────────────────────────────────────
  // News channels do on-air interviews but those are news segments, not podcast
  // format shows. format_type and creator_mode are set during ingest and are
  // authoritative — skip guest_interview and return news_bulletin immediately.
  if (_row?.format_type === 'news' || _row?.creator_mode === 'news') {
    return { format_profile: 'news_bulletin', confidence: 'high', signals };
  }

  // ── Media / broadcast block ───────────────────────────────────────────────
  // Music labels (songs), TV networks & drama channels (film/episode clips), and kids channels
  // match guest patterns ("Song ft. X", "| Show |") but are NOT a creator format we coach. They
  // were getting forced into shorts/news/podcast_like buckets. Genuine podcasts sit at ~0 release
  // markers while these sit at 0.10-0.50 → return a clean 'unknown' so they leave podcast mode.
  const _mediaNiche   = String(_row?.primary_niche || _row?.niche || '').toLowerCase();
  const _releaseRatio = releaseCount / n;
  const _kidsRatio    = kidsCount / n;
  if (_releaseRatio >= 0.10 ||
      _kidsRatio >= 0.20 ||
      _mediaNiche === 'kids' ||
      (_mediaNiche === 'music' && _releaseRatio >= 0.05) ||
      (_row?.channel_name && KIDS_MARKER_RE.test(String(_row.channel_name))) ||
      (_row?.channel_name && MEDIA_BRAND_NAME_RE.test(String(_row.channel_name)))) {
    return { format_profile: 'unknown', confidence: 'low', signals };
  }

  // ── Guest interview: evaluated BEFORE shorts ──────────────────────────────
  // For shorts-heavy channels (≥25% of titles have #shorts), compute guest evidence against
  // LONGFORM titles only. If the longform doesn't carry real rotating-guest evidence, this is a
  // shorts channel with a recurring host (e.g. "Pushpa Sir Reviews …"), NOT a guest show — skip
  // guest_interview so it falls through to 'shorts'.
  let _guestHits     = guestHits;
  let _distinctGuests = distinctGuests;
  let _guestDenom    = n;
  let _skipGuestForShorts = false;

  if (shortsCount / n >= 0.25 && guestHits > 0) {
    const longform = titles.filter(t => !/#shorts|#ytshorts/i.test(t));
    if (longform.length >= 5) {
      let lfHits = 0;
      const lfGuests = new Set();
      for (const title of longform) {
        for (const pattern of GUEST_PATTERNS) {
          const m = title.match(pattern);
          if (m) { lfHits++; lfGuests.add(m[1].toLowerCase().trim()); break; }
        }
      }
      if (lfGuests.size >= 3 && lfHits / longform.length >= 0.25) {
        _guestHits      = lfHits;
        _distinctGuests = lfGuests;
        _guestDenom     = longform.length;
      } else {
        _skipGuestForShorts = true;
      }
    } else {
      _skipGuestForShorts = true;
    }
  }

  // Niche gate: content niches (gaming/music/film/food/…) are never interview shows; their
  // "guests" are characters/actors/players. 'entertainment' is allowed ONLY with explicit
  // conversation markers (real talk shows), so skit/drama/reaction channels don't qualify.
  const _guestNicheBlocked =
    GUEST_BLOCKED_NICHES.has(_mediaNiche) ||
    (_mediaNiche === 'entertainment' && (convCount / n) < 0.15);

  if (!_skipGuestForShorts && !_guestNicheBlocked && _distinctGuests.size >= 3 && _guestHits >= 3 && _guestHits / _guestDenom >= 0.15) {
    return { format_profile: 'guest_interview', confidence: conf(_guestHits / _guestDenom, 0.30, 0.15), signals };
  }

  // Shorts: ≥25% of titles carry #shorts / #ytshorts
  if (shortsCount / n >= 0.25) {
    return { format_profile: 'shorts', confidence: conf(shortsCount / n, 0.5, 0.25), signals };
  }

  // Reaction: ≥15%
  if (reactionCount / n >= 0.15) {
    return { format_profile: 'reaction', confidence: conf(reactionCount / n, 0.3, 0.15), signals };
  }

  // News bulletin: ≥10%
  if (newsCount / n >= 0.10) {
    return { format_profile: 'news_bulletin', confidence: conf(newsCount / n, 0.25, 0.10), signals };
  }

  if (curiositySignals.active && !signals.curiosity_context_blocked) {
    return {
      format_profile: 'curiosity_explainer',
      confidence: curiositySignals.strong ? 'high' : 'medium',
      signals,
    };
  }

  // Vlog: ≥15%
  if (vlogCount / n >= 0.15) {
    return { format_profile: 'vlog', confidence: conf(vlogCount / n, 0.3, 0.15), signals };
  }

  // Lecture / exam-prep: ≥15%
  if (lectureCount / n >= 0.15) {
    return { format_profile: 'lecture', confidence: conf(lectureCount / n, 0.3, 0.15), signals };
  }

  // podcast_like_longform: episode structure without strong guest evidence
  if (episodeCount / n >= 0.20) {
    return { format_profile: 'podcast_like_longform', confidence: conf(episodeCount / n, 0.4, 0.20), signals };
  }

  // Documentary: ≥10%
  if (docCount / n >= 0.10) {
    return { format_profile: 'documentary', confidence: conf(docCount / n, 0.2, 0.10), signals };
  }

  // Essay / opinion: ≥10%
  if (essayCount / n >= 0.10) {
    return { format_profile: 'essay', confidence: conf(essayCount / n, 0.2, 0.10), signals };
  }

  // Solo teaching: ≥20%
  if (teachingCount / n >= 0.20) {
    return { format_profile: 'solo_teaching', confidence: conf(teachingCount / n, 0.4, 0.20), signals };
  }

  return { format_profile: 'unknown', confidence: 'low', signals };
}

// ── Guest intel activation layer ──────────────────────────────────────────────
// Classification (format_profile=guest_interview) is metadata only.
// Activation is strictly gated so that essay/documentary channels with occasional
// guests, and news/upsc channels whose on-air interviews match guest patterns,
// never trigger the podcast intelligence pipeline.

const GUEST_INTEL_BLOCKED_MODES = new Set(['news', 'upsc']);

// Returns { active: boolean, reason: string }.
// Stricter than classification: requires ≥5 distinct guests, ≥20% guest density,
// non-low confidence, and no dominating essay/documentary signal.
function computeGuestIntelActivation(fpResult, creatorMode) {
  if (!fpResult || fpResult.format_profile !== 'guest_interview') {
    return { active: false, reason: 'not_guest_interview_format' };
  }
  if (GUEST_INTEL_BLOCKED_MODES.has(creatorMode)) {
    return { active: false, reason: `creator_mode_blocked:${creatorMode}` };
  }

  const s = fpResult.signals || {};
  const n = s.n || 0;
  if (n === 0) return { active: false, reason: 'no_title_signals' };

  const guestDensity = (s.guest_hits || 0) / n;

  if ((s.distinct_guests || 0) < 5) {
    return { active: false, reason: `distinct_guests_${s.distinct_guests || 0}_need_5` };
  }
  if (guestDensity < 0.20) {
    return { active: false, reason: `guest_density_${guestDensity.toFixed(2)}_need_0.20` };
  }
  if (fpResult.confidence === 'low' || fpResult.confidence === 'none') {
    return { active: false, reason: `confidence_${fpResult.confidence}` };
  }

  // Essay or documentary channels with incidental guest appearances must not activate.
  // e.g. Think School (essay), James Jani (documentary) occasionally feature named guests
  // but their format is opinion/analysis, not a rotating-guest show.
  const nonGuestSignals = (s.essay_count || 0) + (s.doc_count || 0);
  if (nonGuestSignals > (s.guest_hits || 0) * 1.5) {
    return { active: false, reason: 'essay_doc_signals_dominate' };
  }

  return { active: true, reason: 'passes_guest_intel_activation' };
}

module.exports = {
  FORMAT_PROFILES, FORMAT_PROFILE_VERSION, computeFormatProfile,
  GUEST_INTEL_BLOCKED_MODES, computeGuestIntelActivation,
};

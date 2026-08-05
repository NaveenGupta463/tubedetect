'use strict';

const { detectItemLane } = require('./podcastLanes');
const { extractGuestCandidates } = require('./podcastGuestExtract');
const { resolveContentCountry } = require('./countryContext');
const { brandStrings, isCreatorEcho } = require('./podcastBrand');

// Bare base-form verbs that, as the last word of a 2-word theme, signal a verb-fragment
// rather than a real topic (e.g. "advice save", "money make", "startup fail").
const PODCAST_THEME_WEAK_TRAILING = new Set([
  'save', 'give', 'take', 'make', 'buy', 'sell', 'get', 'go', 'come',
  'need', 'want', 'use', 'know', 'see', 'tell', 'keep', 'show', 'find',
  'lose', 'stop', 'start', 'help', 'build', 'grow', 'run', 'work', 'pay',
  'do', 'put', 'set', 'let', 'cut', 'hit', 'fix', 'try', 'ask', 'say',
  'think', 'feel', 'look', 'turn', 'move', 'change', 'read', 'spend',
  'earn', 'learn', 'avoid', 'win', 'fail', 'die', 'live', 'retire',
]);

// Political/news terms that are weak signals in podcast mode unless backed by business context.
const PODCAST_NEWS_TERMS = new Set([
  'modi', 'bjp', 'congress', 'rahul', 'yogi', 'kejriwal', 'mamata',
  'govt', 'government', 'parliament', 'minister', 'election', 'vote',
  'rbi', 'sebi', 'war', 'attack', 'protest', 'riot', 'ban', 'verdict',
  // Indian political entity fragments — each is unambiguous enough standalone
  'janta', 'janata', 'sabha', 'rajya', 'sena', 'mla',
  'manifesto', 'coalition', 'cabinet', 'opposition',
]);

// Explicit phrase deny-list: entity names, vague adjective-noun pairs, and
// structural clickbait that survive all pattern-based filters.
const PODCAST_THEME_EXPLICIT_REJECT = new Set([
  // Structural / vague phrases
  'right way', 'stop using', 'every employee', 'india most', 'real story',
  'most indians', 'how start', 'reveals truth', 'dark side', 'real problem',
  'covered', 'best way', 'big problem', 'main problem', 'simple way',
  'real reason', 'real truth', 'real life', 'good news', 'bad news',
  'biggest mistake', 'big mistake', 'common mistake', 'hard truth',
  'this reason', 'one thing', 'every indian', 'young india',
  // Entity / show names not caught by person-name extraction
  '12th man',
]);

const PODCAST_THEME_SINGLE_WORD_REJECT = new Set([
  'covered', 'problem', 'problems', 'story', 'truth', 'reason', 'secret',
  'mistake', 'mistakes', 'lesson', 'lessons', 'advice', 'tips', 'talk',
  'podcast', 'interview', 'episode', 'business', 'money', 'india',
]);

const PODCAST_THEME_VAGUE_WORDS = new Set([
  'real', 'big', 'small', 'best', 'worst', 'main', 'simple', 'secret',
  'hidden', 'dark', 'easy', 'hard', 'new', 'old', 'true', 'fake',
  'problem', 'problems', 'story', 'truth', 'reason', 'thing', 'things',
  'way', 'ways', 'life', 'covered',
]);

// Pure adjectives that, as the last word of a 2-word theme, mean the noun they modify got
// cut off at the n-gram extraction boundary (e.g. "Gurgaon Real" is a fragment of "Gurgaon
// Real Estate" — extractPhrases() emits both the bigram and the trigram as separate,
// independently-scored candidates, so the meaningless prefix can survive on its own).
// Unlike PODCAST_THEME_VAGUE_WORDS, these can never be a phrase's head noun themselves —
// deliberately excludes noun-like vague words ("life", "story", "problem") which can
// legitimately close out a real 2-word topic (e.g. "married life").
const PODCAST_THEME_WEAK_TRAILING_ADJ = new Set([
  'real', 'big', 'small', 'worst', 'main', 'simple', 'hidden', 'dark', 'easy', 'hard', 'true', 'fake',
]);

// Quantifiers/determiners that, as the first word of a 2-word theme, signal a truncated
// sentence fragment rather than a topic — they need a noun after them that got cut off
// (e.g. "every young [Indian]", "most [people]").
const PODCAST_THEME_QUANTIFIER_FIRST = new Set([
  'every', 'each', 'all', 'some', 'many', 'most', 'few', 'several', 'another', 'other', 'no',
]);

// Indefinite pronouns that, as the first word of a 2-word theme, signal a truncated
// clickbait sentence rather than a topic (e.g. "nobody talks [about this]", "everyone knows").
const PODCAST_THEME_PRONOUN_FIRST = new Set([
  'nobody', 'everybody', 'everyone', 'someone', 'anybody', 'anyone', 'somebody',
  'nothing', 'everything', 'something',
]);

// Currency-unit words that, alone or paired with a bare number, aren't a topic — just a
// figure mentioned in a title (e.g. "₹60 crore", "₹1000+ crore").
const PODCAST_CURRENCY_UNIT_WORDS = new Set([
  'crore', 'crores', 'lakh', 'lakhs', 'million', 'billion', 'thousand', 'cr', 'bn',
]);
const PODCAST_NUMERIC_TOKEN_RE = /^[₹$]?[\d,.]+\+?$/;

function isWeakPodcastThemePhrase(phrase) {
  const p = String(phrase || '').toLowerCase().trim();
  const words = p.split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  if (words.length === 1) return PODCAST_THEME_SINGLE_WORD_REJECT.has(words[0]) || words[0].length < 5;
  if (words.every(w => PODCAST_THEME_VAGUE_WORDS.has(w))) return true;
  if (words.length === 2 && words.some(w => PODCAST_THEME_SINGLE_WORD_REJECT.has(w)) && words.some(w => PODCAST_THEME_VAGUE_WORDS.has(w))) return true;
  // Short interrogative fragment: "Who More", "What Next" — a sentence scrap, not a theme.
  if (words.length <= 2 && words.some(w => ['who', 'what', 'why', 'how', 'when', 'where', 'which', 'whose'].includes(w))) return true;
  // Trailing participle/clickbait fragment: "Controversy Explained", "Younger Looking".
  if (/\b(explained|looking|decoded|revealed|exposed|reaction|review)$/i.test(p)) return true;
  // Greeting / call-to-action / garbled-title fragments: "Welcome Jungle", "Watch Now".
  if (/^(welcome|watch|subscribe|thanks?|hello|hi|please)\b/i.test(p)) return true;
  // Quantifier/determiner fragment: "Every Young", "Most Indians" — missing the noun.
  if (words.length === 2 && PODCAST_THEME_QUANTIFIER_FIRST.has(words[0])) return true;
  // Pronoun-subject fragment: "Nobody Talks", "Everyone Knows" — a clipped sentence, not a topic.
  if (words.length === 2 && PODCAST_THEME_PRONOUN_FIRST.has(words[0])) return true;
  // Bare figure, not a topic: "₹60 Crore", "₹1000+ Crore" — every word is just a number or unit.
  if (words.every(w => PODCAST_NUMERIC_TOKEN_RE.test(w) || PODCAST_CURRENCY_UNIT_WORDS.has(w))) return true;
  // Adjective-trailing fragment: "Gurgaon Real" — the noun it modifies (e.g. "estate") got
  // cut off at the n-gram boundary; the complete phrase survives as its own candidate.
  if (words.length === 2 && PODCAST_THEME_WEAK_TRAILING_ADJ.has(words[words.length - 1])) return true;
  return false;
}

// Verb-first clickbait fragments: "reveals X", "exposes Y", etc.
// Catches the pattern class rather than individual phrases.
const PODCAST_THEME_CLICKBAIT_RE = /^(reveals?|exposes?|uncovers?|breaks?|admits?)\s/i;

// Specific multi-word Indian political phrases that are ambiguous at the word level
// (e.g. "party", "lok", "aam" are too generic to add to PODCAST_NEWS_TERMS alone).
// Applied as a phrase-level gate after the word-level gate.
const PODCAST_POLITICAL_PHRASE_RE = /\bjanta\s+party\b|\bjanata\s+party\b|\baam\s+aadmi\b|\baam\s+aadmi\s+party\b|\blok\s+sabha\b|\brajya\s+sabha\b|\bbharatiya\s+janata\b|\bshiv\s+sena\b|\bpolitical\s+party\b/i;

const PODCAST_BUSINESS_CONTEXT_RE = /\b(business|money|invest|startup|wealth|rich|financial|finance|economy|market|stock|fund|profit|income|revenue|entrepreneur)\b/i;

function titleCasePhrase(phrase) {
  return String(phrase || '').replace(/\b\w/g, c => c.toUpperCase());
}

function packagePodcastTheme(phrase, country) {
  const p = String(phrase || '').toLowerCase();
  const topic = titleCasePhrase(p);
  const isIN  = country === 'IN';

  if (/\b(real estate|property|rent|housing|home loan|flat)\b/.test(p)) {
    return {
      guest_archetype: 'real-estate operator or property investor',
      angle_title: isIN
        ? 'Invite a real-estate operator to explain rent vs buy for India\'s middle class'
        : 'Invite a real-estate operator to break down the real math on renting vs buying right now',
      episode_prompt: isIN
        ? 'Frame it around the practical decision: when property builds wealth, when it traps cash, and what young Indians should check before buying.'
        : 'Frame it around the practical decision: when property builds wealth, when it traps cash, and what buyers should check before committing.',
    };
  }
  if (/\b(money mindset|wealth|rich|personal finance|side income|income)\b/.test(p)) {
    return {
      guest_archetype: 'personal finance creator or wealth coach',
      angle_title: isIN
        ? 'Talk to a finance creator about why young Indians struggle to build wealth'
        : 'Talk to a finance creator about why so many people struggle to build real wealth',
      episode_prompt: 'Make the episode about behavior, status pressure, saving discipline, and the gap between earning more and actually becoming wealthy.',
    };
  }
  if (/\b(middle class|salary|job|career|income tax|cost of living)\b/.test(p)) {
    return {
      guest_archetype: 'economist, career operator, or personal finance expert',
      angle_title: isIN
        ? 'Decode what is changing for India\'s middle class'
        : 'Decode what is changing for the middle class right now',
      episode_prompt: 'Center the conversation on household pressure, career risk, lifestyle inflation, and practical choices viewers can relate to.',
    };
  }
  if (/\b(startups?|founders?|entrepreneurs?|india startups?|indian startups?|business)\b/.test(p)) {
    if (/\b(india startups?|indian startups?|startups?)\b/.test(p)) {
      return {
        guest_archetype: 'startup founder or operator',
        angle_title: isIN
          ? 'Invite a founder to explain what is changing for Indian startups'
          : 'Invite a founder to explain what is changing in the startup world right now',
        episode_prompt: isIN
          ? 'Push beyond motivation: ask what has become harder, what still works, and what first-time founders misunderstand about India.'
          : 'Push beyond motivation: ask what has become harder, what still works, and what first-time founders misunderstand about building a company.',
      };
    }
    return {
      guest_archetype: 'startup founder or operator',
      angle_title: isIN
        ? `Invite a founder to explain what ${topic} means for building in India`
        : `Invite a founder to explain what ${topic} means for founders building right now`,
      episode_prompt: 'Push beyond inspiration: ask what is hard, what incentives are broken, and what operators should do differently.',
    };
  }
  if (/\b(strait hormuz|oil|petrol|diesel|energy|crude)\b/.test(p)) {
    if (/\b(petrol|diesel)\b/.test(p)) {
      return {
        guest_archetype: 'energy analyst or economist',
        angle_title: 'Decode why petrol and diesel prices matter beyond your monthly fuel bill',
        episode_prompt: 'Connect fuel prices to inflation, logistics, small businesses, household budgets, and founder operating costs.',
      };
    }
    return {
      guest_archetype: 'energy analyst or geopolitics expert',
      angle_title: isIN
        ? 'Bring an energy expert to decode how oil shocks affect Indian households and startups'
        : 'Bring an energy expert to decode how oil shocks affect households and businesses',
      episode_prompt: 'Translate the global event into local consequences: fuel prices, inflation, business costs, and founder decisions.',
    };
  }
  if (/\b(stock market|market|gold|mutual fund|investing|portfolio)\b/.test(p)) {
    if (/\bgold\b/.test(p)) {
      return {
        guest_archetype: 'investor educator or macro analyst',
        angle_title: isIN
          ? 'Ask an investor why Indians run to gold during uncertainty'
          : 'Ask an investor why people rush to gold during uncertainty',
        episode_prompt: 'Make it practical: gold vs equities, fear psychology, family behavior, and what retail investors should avoid doing blindly.',
      };
    }
    return {
      guest_archetype: 'market analyst or investor educator',
      angle_title: isIN
        ? `Ask an investor to explain what ${topic} means for ordinary Indians`
        : `Ask an investor to explain what ${topic} means for ordinary investors`,
      episode_prompt: 'Keep it decision-led: what to ignore, what to watch, and how retail investors should avoid panic behavior.',
    };
  }
  if (/\b(economy|crisis|inflation|recession|growth)\b/.test(p)) {
    return {
      guest_archetype: 'economist or business journalist',
      angle_title: `Bring an economist to explain the real-world impact of ${topic}`,
      episode_prompt: isIN
        ? 'Turn the macro topic into everyday outcomes: jobs, prices, businesses, and the next 12 months for Indian viewers.'
        : 'Turn the macro topic into everyday outcomes: jobs, prices, businesses, and the next 12 months for viewers.',
    };
  }
  if (/\b(dating|relationship|marriage|breakup|love|romance|situationship)\b/.test(p)) {
    return {
      guest_archetype: 'relationship therapist, dating coach, or candid celebrity guest',
      angle_title: `Unpack what ${topic} really looks like for this generation`,
      episode_prompt: isIN
        ? 'Go past hot takes: real stories, what has changed for young Indians, the patterns that break relationships, and what actually works.'
        : 'Go past hot takes: real stories, what has changed for this generation, the patterns that break relationships, and what actually works.',
    };
  }
  if (/\b(fat loss|weight loss|diet|nutrition|gut health|longevity|fitness|workout|sleep|dna test|biohack|immunity|hormone|fasting)\b/.test(p)) {
    return {
      guest_archetype: 'doctor, nutritionist, or longevity expert',
      angle_title: `Get a doctor to give the real, evidence-based take on ${topic}`,
      episode_prompt: 'Cut through the fads: what the science actually says, what to ignore, and a simple protocol viewers can start this week.',
    };
  }
  if (/\b(world cup|cricket|football|olympics?|tournament|champions?|ipl|match|sport)\b/.test(p)) {
    return {
      guest_archetype: 'athlete, coach, or sports analyst',
      angle_title: `Break down ${topic} with someone who has lived it`,
      episode_prompt: 'Mix the human story with the strategy: pressure, preparation, the turning points, and what viewers can take into their own ambitions.',
    };
  }

  // Concrete generic fallback — frame the theme as a real conversation, not a mad-lib.
  return {
    guest_archetype: 'credible domain expert or operator',
    angle_title: `Sit down with an expert and break down ${topic}: what changed and what to do about it`,
    episode_prompt: `Open with why ${topic} is suddenly relevant, debate the strongest counter-view, then close with a clear takeaway viewers can act on this week.`,
  };
}

// Generic platform/social tokens with no editorial theme value in podcast titles.
const THEME_SOCIAL_STOP = new Set([
  'follow', 'subscribe', 'comment', 'comments', 'like', 'likes', 'share',
  'watch', 'watching', 'join', 'support', 'check', 'click', 'visit',
  'awesome', 'amazing', 'incredible', 'insane', 'crazy', 'viral',
  'interview', 'interviews', 'podcast', 'episode', 'episodes',
  'today', 'tonight', 'now', 'live', 'new', 'latest', 'official', 'full',
  // Marker abbreviations that extractPhrases() preserves with their trailing dot.
  'ft.', 'feat.', 'dr.',
]);

// Returns true when a lowercased phrase (2–3 words) appears title-cased in an
// example title AND would be extracted as a guest candidate from that title.
// This catches celebrity/person names that slip through as theme bigrams
// (e.g. "amitabh bachchan", "raj shamani", "tim david").
function isPersonNamePhrase(phrase, examples) {
  const words = phrase.split(' ');
  if (words.length < 2 || words.length > 3) return false;
  const titleRE = new RegExp(
    '\\b' + words.map(w => w[0].toUpperCase() + w.slice(1)).join('\\s+') + '\\b',
  );
  for (const ex of examples) {
    if (!titleRE.test(ex)) continue;
    const cands = extractGuestCandidates(ex);
    if ([...cands.marker, ...cands.fullScan].some(c => c.toLowerCase() === phrase)) return true;
  }
  return false;
}

// extractPhrases and PODCAST_META_TOKENS live in creatorIntel.js and are injected here
// to avoid circular deps while keeping this module self-contained.
function computePodcastThemes(db, channelId, peerIds, guestNames, channelName, nowMs, debugMode = false, targetLanes = [], extractPhrases, PODCAST_META_TOKENS, channelRegion = null) {
  const contentCountry = resolveContentCountry(channelRegion);
  const RECENCY_MS = 180 * 24 * 60 * 60 * 1000;
  const cutoffDate = new Date(nowMs - RECENCY_MS).toISOString().split('T')[0];
  const peerSample = peerIds.slice(0, 100);
  if (!peerSample.length) return { themes: [] };

  const ph = peerSample.map(() => '?').join(',');
  const peerVideos = db.all(
    `SELECT channel_id, title, views, published_at FROM (
       SELECT channel_id, title, views, published_at,
              ROW_NUMBER() OVER (PARTITION BY channel_id ORDER BY published_at DESC) AS rn
       FROM ingested_videos
       WHERE channel_id IN (${ph}) AND published_at >= ? AND title IS NOT NULL
     ) WHERE rn <= 40`,
    [...peerSample, cutoffDate],
  );

  // Own phrase coverage — used to flag already-covered themes.
  const ownTitles = db.all(
    `SELECT title FROM ingested_videos WHERE channel_id = ? AND title IS NOT NULL ORDER BY published_at DESC LIMIT 100`,
    [channelId],
  );
  const ownPhraseSet = new Set();
  for (const { title } of ownTitles) {
    for (const p of extractPhrases(title)) ownPhraseSet.add(p.toLowerCase());
  }

  // Filter token sets
  const guestTokens = new Set();
  for (const name of guestNames) {
    for (const w of name.toLowerCase().split(/\s+/)) {
      if (w.length >= 3) guestTokens.add(w);
    }
  }
  const brandTokens = new Set();
  if (channelName) {
    for (const w of channelName.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)) {
      if (w.length >= 3) brandTokens.add(w);
    }
  }
  const allStop = new Set([...PODCAST_META_TOKENS, ...THEME_SOCIAL_STOP]);
  // Distinctive brand strings → skip clip/re-upload videos of the creator's OWN show so his just-done
  // topics aren't counted as peer demand and recommended back (the brandTokens word-filter below only
  // drops individual brand WORDS from a phrase; the whole echoed video must be skipped).
  const brands = brandStrings(channelName);

  const phraseMap      = new Map();
  let totalExtracted   = 0;
  let guestFiltered    = 0;
  let metaFiltered     = 0;
  let brandFiltered    = 0;
  let verbFragFiltered = 0;

  // All guest-candidate names found across peer titles — used to reject person-name themes.
  const peerGuestNamesLower = new Set();

  for (const { channel_id, title, views, published_at } of peerVideos) {
    if (isCreatorEcho(title, brands)) continue; // clip/re-upload of the creator's own episode
    const gCands = extractGuestCandidates(title);
    for (const g of [...gCands.marker, ...gCands.fullScan]) peerGuestNamesLower.add(g.toLowerCase());

    const ts      = published_at ? new Date(published_at).getTime() : 0;
    const phrases = extractPhrases(title);
    for (const phrase of phrases) {
      totalExtracted++;
      const words = phrase.split(' ');
      if (words.some(w => guestTokens.has(w)))  { guestFiltered++;  continue; }
      if (words.some(w => allStop.has(w)))       { metaFiltered++;   continue; }
      if (words.some(w => brandTokens.has(w)))   { brandFiltered++;  continue; }
      // 2-word phrase ending in a bare base-form verb → topic fragment, not a theme
      if (words.length === 2 && PODCAST_THEME_WEAK_TRAILING.has(words[1])) {
        verbFragFiltered++; continue;
      }

      if (!phraseMap.has(phrase)) {
        phraseMap.set(phrase, { channels: new Set(), views: [], latest_ts: 0, examples: [] });
      }
      const e = phraseMap.get(phrase);
      e.channels.add(channel_id);
      e.views.push(views || 0);
      if (ts > e.latest_ts) e.latest_ts = ts;
      if (e.examples.length < 3 && title && !e.examples.includes(title)) e.examples.push(title);
    }
  }

  let themesWithMinPeers      = 0;
  let ownCoverageCount        = 0;
  let newsFiltered            = 0;
  let politicalPhraseFiltered = 0;
  let personThemeRejected     = 0;
  let phraseThemeRejected     = 0;
  let fragmentThemeRejected   = 0;
  let weakThemeRejected       = 0;
  let laneFiltered            = 0;
  const scored = [];

  for (const [phrase, e] of phraseMap) {
    if (e.channels.size < 2) continue;

    const phraseWords = phrase.split(' ');

    if (isWeakPodcastThemePhrase(phrase)) {
      weakThemeRejected++; continue;
    }

    // Word-level news/political gate: require 3+ peers AND business context in examples
    if (phraseWords.some(w => PODCAST_NEWS_TERMS.has(w.toLowerCase()))) {
      if (e.channels.size < 3 || !e.examples.some(ex => PODCAST_BUSINESS_CONTEXT_RE.test(ex))) {
        newsFiltered++; continue;
      }
    }

    // Phrase-level political gate: catches multi-word patterns whose component words
    // are too generic to add to PODCAST_NEWS_TERMS (e.g. "party", "lok", "aam").
    // Same survival rule: needs 3+ peers AND business context in at least one example.
    if (PODCAST_POLITICAL_PHRASE_RE.test(phrase)) {
      if (e.channels.size < 3 || !e.examples.some(ex => PODCAST_BUSINESS_CONTEXT_RE.test(ex))) {
        politicalPhraseFiltered++; continue;
      }
    }

    // Person-name gate: reject phrases that were extracted as guest candidates from
    // any peer title (e.g. "amitabh bachchan", "khan sir", "lucky bisht").
    // isPersonNamePhrase is a fallback for names missed by guest extraction.
    if (peerGuestNamesLower.has(phrase) || isPersonNamePhrase(phrase, e.examples)) {
      personThemeRejected++; continue;
    }

    // Explicit phrase deny-list: entity names, vague adjective-noun pairs, named fragments.
    if (PODCAST_THEME_EXPLICIT_REJECT.has(phrase)) {
      phraseThemeRejected++; continue;
    }

    // Verb-first clickbait fragment pattern (e.g. "reveals truth", "exposes reality").
    if (PODCAST_THEME_CLICKBAIT_RE.test(phrase)) {
      fragmentThemeRejected++; continue;
    }

    // Lane gate: drop themes that don't match any target lane unless 3+ peers cover them
    // (widened from 4 — a theme 3 distinct peers are covering is a real audience signal).
    const matchedLane = targetLanes.length ? detectItemLane([phrase, ...e.examples], targetLanes) : null;
    if (targetLanes.length && !matchedLane && e.channels.size < 3) {
      laneFiltered++; continue;
    }

    themesWithMinPeers++;

    const daysAgo   = (nowMs - e.latest_ts) / 86400000;
    const recency   = daysAgo < 14 ? 3 : daysAgo < 45 ? 2 : daysAgo < 90 ? 1 : 0;
    const sortedV   = [...e.views].sort((a, b) => a - b);
    const midV      = Math.floor(sortedV.length / 2);
    const medianV   = sortedV.length % 2 ? sortedV[midV] : Math.round((sortedV[midV - 1] + sortedV[midV]) / 2);
    const avgViews  = Math.round(e.views.reduce((a, b) => a + b, 0) / e.views.length);
    const alreadyCovered = ownPhraseSet.has(phrase.toLowerCase());
    if (alreadyCovered) ownCoverageCount++;
    if (alreadyCovered && e.channels.size < 4) continue;
    const packaged = packagePodcastTheme(phrase, contentCountry);

    scored.push({
      theme:           phrase,
      angle_title:     packaged.angle_title,
      guest_archetype: packaged.guest_archetype,
      episode_prompt:  packaged.episode_prompt,
      score:           Math.round(e.channels.size * 6 + Math.log10(medianV + 1) * 4 + recency + (alreadyCovered ? -10 : 5) + (matchedLane ? 8 : 0)),
      peer_count:      e.channels.size,
      avg_views:       avgViews,
      last_seen:       e.latest_ts ? new Date(e.latest_ts).toISOString().split('T')[0] : null,
      examples:        e.examples.slice(0, 3),
      already_covered: alreadyCovered,
      matched_lane:    matchedLane,
      content_country: contentCountry,
    });
  }

  scored.sort((a, b) => b.score - a.score);

  const themeDebug = debugMode ? {
    phrases_extracted:         totalExtracted,
    phrases_after_filter:      phraseMap.size,
    themes_with_min_peers:     themesWithMinPeers,
    own_coverage_count:        ownCoverageCount,
    guest_filter_count:        guestFiltered,
    meta_filter_count:         metaFiltered,
    brand_filter_count:        brandFiltered,
    verb_frag_filtered:        verbFragFiltered,
    news_filtered:             newsFiltered,
    political_phrase_filtered: politicalPhraseFiltered,
    person_theme_rejected:     personThemeRejected,
    phrase_theme_rejected:     phraseThemeRejected,
    fragment_theme_rejected:   fragmentThemeRejected,
    weak_theme_rejected:       weakThemeRejected,
    lane_filtered_themes:      laneFiltered,
    peer_guest_names_pooled:   peerGuestNamesLower.size,
    target_lanes_active:       targetLanes,
  } : undefined;

  return {
    themes: scored.slice(0, 10),
    ...(themeDebug ? { theme_debug: themeDebug } : {}),
  };
}

module.exports = {
  PODCAST_THEME_WEAK_TRAILING,
  PODCAST_NEWS_TERMS,
  PODCAST_POLITICAL_PHRASE_RE,
  PODCAST_BUSINESS_CONTEXT_RE,
  PODCAST_THEME_EXPLICIT_REJECT,
  PODCAST_THEME_CLICKBAIT_RE,
  THEME_SOCIAL_STOP,
  isWeakPodcastThemePhrase,
  isPersonNamePhrase,
  computePodcastThemes,
};

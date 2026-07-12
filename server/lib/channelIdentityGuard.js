'use strict';

// Deterministic identity guard used after model/keyword classification.
// It fixes the recurring failure mode where broad words in channel names/titles
// ("education", "entertainment", "music", "vlog") overpower the actual content
// family. The guard is intentionally conservative: it only overrides when a
// distinctive family has repeated evidence.

function norm(s) {
  return String(s || '').toLowerCase();
}

function countMatches(texts, patterns) {
  let count = 0;
  const evidence = [];
  for (const text of texts) {
    const t = norm(text);
    for (const [label, re] of patterns) {
      if (re.test(t)) {
        count++;
        if (evidence.length < 6) evidence.push(label);
        break;
      }
    }
  }
  return { count, evidence };
}

// Native-script (Devanagari) keyword groups. The guard's English/romanized patterns
// can't read pure-Devanagari titles, leaving its largest non-English segment (~12K
// hi-tagged channels) with NO protective opinion. These are purely ADDITIVE — Devanagari
// never collides with English text, so they cannot affect existing Latin-script matching.
// Substring (not \b) matching: \b is ASCII-based and never fires inside Devanagari.
// IMPORTANT: substring matching (no \b in Devanagari) → every term must be free of
// collisions with common words. e.g. मंत्र is a substring of मंत्री (minister) and
// बनाने ("to make") matches any how-to title — both excluded. Deity/temple words
// (मंदिर/दर्शन/हनुमान…) excluded too: they saturate news headlines about festivals.
const DEVANAGARI = {
  devotional: /भजन|आरती|चालीसा|कीर्तन|सत्संग|प्रवचन|गुरबानी|शबद|अरदास|नितनेम/,
  food: /रेसिपी|रसोई|सब्ज़ी|सब्जी|पनीर|बिरयानी|नाश्ता|चटनी|हलवा|अचार|मिठाई/,
  education: /परीक्षा|पढ़ाई|सिलेबस|मॉक टेस्ट|कक्षा|अध्याय/,
  finance: /निवेश|शेयर बाजार|शेयर बाज़ार|शेयर मार्केट|म्यूचुअल फंड|कमाई|बीमा|बचत/,
  health: /इलाज|बीमारी|घरेलू नुस्खे|घरेलू उपाय|सेहत|दवा|डॉक्टर/,
  politics: /चुनाव|मोदी|भाजपा|कांग्रेस|संसद|सरकार|समाचार|ब्रेकिंग न्यूज/,
  astrology: /राशिफल|कुंडली|ज्योतिष|पंचांग|वास्तु शास्त्र|टैरो/,
  comedy: /कॉमेडी|प्रैंक|कॉमेडियन/,
  music: /गाना|गीत|संगीत|गाने|रीमिक्स|डीजे/,
  beauty: /मेकअप|ब्यूटी|स्किनकेयर|मेहंदी|फैशन/,
};

const PATTERNS = {
  devotional: [
    ['bhajan', /\bbhajan\b/],
    ['aarti', /\baarti\b/],
    ['mantra', /\bmantra|chant|jap\b/],
    ['chalisa', /\bchalisa|stotra|stuti|sunderkand|sundarkand\b/],
    ['gurbani', /\bgurbani|shabad|waheguru|ardas|nitnem\b/],
    ['islamic_recitation', /\b(quran|qur'an|recitation|tilawat|naat|hamd|dua|zikr|dhikr|nasheed|islamic)\b/],
    ['temple', /\b(mandir|temple|darshan|pravachan|satsang|katha)\b/],
    ['deity', /\b(mahadev|shiva|krishna|radha|hanuman|durga|ganesh|ganpati|sai baba|bageshwar)\b/],
    ['devanagari', DEVANAGARI.devotional],
  ],
  medicalEducation: [
    ['meded', /\b(meded|medical education|mbbs|neet pg|fmge|inicet)\b/],
    ['medical_subject', /\b(anatomy|physiology|pathology|pharmacology|microbiology|biochemistry|surgery|medicine lecture|clinical case)\b/],
    ['doctor_learning', /\b(medical students?|doctor explains|clinical|diagnosis|symptoms explained)\b/],
  ],
  education: [
    ['exam', /\b(upsc|ssc|jee|neet|gate|cat|ias|prelims|mains|board exam|cbse|icse|cuet)\b/],
    ['study', /\b(study|revision|mock test|syllabus|answer key|admit card|result|previous year|pyq)\b/],
    ['lesson', /\b(class \d+|chapter|lecture|lesson|tutorial|learn|course|worksheet|quiz|mcq)\b/],
    ['devanagari', DEVANAGARI.education],
  ],
  fitness: [
    ['workout', /\b(workout|gym|bodybuilding|calisthenics|push[\s-]?ups?|pull[\s-]?ups?|squat|deadlift|bench press)\b/],
    ['body_goal', /\b(weight loss|fat loss|muscle gain|belly fat|abs|bulk|cutting|protein|creatine)\b/],
  ],
  health: [
    ['doctor', /\b(doctor|hospital|medicine|medical|treatment|diagnosis|symptoms|disease)\b/],
    ['condition', /\b(diabetes|cancer|thyroid|pcos|pcod|blood pressure|heart disease|mental health|anxiety|depression)\b/],
    ['wellness', /\b(nutrition|diet|ayurveda|home remedy|gut health|vitamin|supplement)\b/],
    ['devanagari', DEVANAGARI.health],
  ],
  gaming: [
    ['game', /\b(gameplay|gaming|gamer|live stream|rank push|esports)\b/],
    ['title', /\b(free fire|bgmi|pubg|minecraft|roblox|gta|valorant|fortnite|codm|clash royale)\b/],
  ],
  food: [
    ['recipe', /\b(recipe|cooking|cook with|kitchen|homemade|biryani|paneer|dosa|idli|cake|dessert|snack)\b/],
    ['food_place', /\b(street food|food vlog|food tour|restaurant|dhaba|taste test|mukbang|what i ate)\b/],
    ['devanagari', DEVANAGARI.food],
  ],
  travel: [
    // "tour" only counts as travel when NOT a house/room/studio/etc. walkthrough idiom
    // (a musician's "House Tour" is not a travel video).
    ['travel', /\b(travel|trip|journey|itinerary|destination|visa|airport|hotel|resort|homestay)\b|(?<!\b(?:house|home|room|studio|office|factory|property|garden|kitchen|set|campus|car|stadium|apartment|closet)\s)\btour\b/],
    ['vlog_place', /\b(road trip|solo travel|backpacking|kedarnath|ladakh|goa|manali|rishikesh|dubai|bali)\b/],
  ],
  finance: [
    ['investing', /\b(invest|investment|mutual fund|sip|stock market|trading|nifty|sensex|portfolio|wealth)\b/],
    ['money', /\b(finance|money|saving|budget|loan|insurance|tax|credit card|income tax|crypto|bitcoin)\b/],
    ['devanagari', DEVANAGARI.finance],
  ],
  technology: [
    ['gadgets', /\b(iphone|samsung|oneplus|smartphone|phone review|laptop|macbook|unboxing|camera test|benchmark)\b/],
    ['software', /\b(coding|programming|software|app|ai tools?|chatgpt|python|javascript|excel)\b/],
  ],
  politics: [
    ['domestic', /\b(bjp|congress|aap|modi|rahul gandhi|election|lok sabha|rajya sabha|parliament|minister)\b/],
    ['devanagari', DEVANAGARI.politics],
  ],
  geopolitics: [
    ['world', /\b(geopolitics|foreign policy|china|pakistan|russia|ukraine|israel|iran|nato|brics|war|border conflict|hormuz)\b/],
  ],
  sports: [
    ['cricket', /\b(cricket|ipl|t20|odi|test match|wicket|kohli|dhoni|rohit|bumrah)\b/],
    ['sports', /\b(football|fifa|kabaddi|badminton|tennis|olympics|match highlights|tournament)\b/],
  ],
  beauty: [
    ['beauty', /\b(makeup|skincare|beauty|fashion|outfit|haul|lipstick|sunscreen|haircare|nail art)\b/],
    ['fashion_shopping', /\b(kurta|saree|lehenga|dress|ethnic wear|thrift|shopping haul|wardrobe|ootd|jewellery|jewelry|comforter|bedsheet|home decor)\b/],
    ['devanagari', DEVANAGARI.beauty],
  ],
  comedy: [
    // Distinctive comedy terms only. "funny"/"jokes"/"memes" deliberately EXCLUDED —
    // kids/nursery channels use "funny" heavily and would false-fire to comedy.
    ['comedy', /\b(comedy|sketch|skit|prank|pranks|roast|stand[\s-]?up|standup|comedian|spoof|parody|vines?)\b/],
    ['devanagari', DEVANAGARI.comedy],
  ],
  astrology: [
    // Unambiguous astrology terms only — "remedies/totke/upay" dropped (they also match
    // home-remedy/health channels like "gharelu nuskhe").
    ['astro', /\b(astrology|astrologer|jyotish|horoscope|zodiac|rashifal|kundli|kundali|vastu|numerology|tarot|palmistry|nakshatra|amavasya|gurupushya|panchang)\b/],
    ['devanagari', DEVANAGARI.astrology],
  ],
  music: [
    ['song', /\b(song|music video|official audio|lyrics|lyrical|cover song|album|singer|rap|lofi|remix)\b/],
    ['performance', /\b(guitar|piano|vocals|live performance|concert|stage show)\b/],
    ['devanagari', DEVANAGARI.music],
  ],
};

const FAMILY_TO_NICHE = {
  devotional: 'music',
  medicalEducation: 'education',
  education: 'education',
  fitness: 'fitness',
  health: 'health',
  gaming: 'gaming',
  food: 'food',
  travel: 'travel',
  finance: 'finance',
  technology: 'technology',
  politics: 'politics',
  geopolitics: 'geopolitics',
  sports: 'sports',
  beauty: 'beauty',
  comedy: 'comedy',
  astrology: 'meditation',  // no dedicated astrology niche; meditation is the closest spiritual Category-C bucket (far better than the finance/news the model often picks)
  music: 'music',
};

const BROAD_REWRITE_SOURCES = new Set([
  '',
  'other',
  'entertainment',
  'lifestyle',
  'selfimprovement',
  'philosophy',
  'business',
  'technology',
]);

const COMPATIBLE_REWRITES = {
  health: new Set(['fitness']),
  fitness: new Set(['health']),
  business: new Set(['finance', 'technology']),
  technology: new Set(['finance', 'gaming', 'education']),
  education: new Set(['finance', 'music']),
  travel: new Set(['food', 'music']),       // music: artists/creators mislabeled travel via "house tour"
  beauty: new Set(['music', 'entertainment']), // music: song channels (e.g. "X Music"/"X Records") mislabeled beauty
  entertainment: new Set(['music', 'sports', 'food', 'beauty', 'gaming']),
  lifestyle: new Set(['food', 'fitness', 'beauty', 'travel', 'health']),
};

function isKidsMusicChannel(channelName, protectedIdentity) {
  if (protectedIdentity.primary_niche !== 'music') return false;
  return /\b(kids?|nursery|rhymes?|songs?|toons?|cartoon)\b/i.test(String(channelName || ''));
}

function isMusicChannel(channelName, protectedIdentity) {
  if (protectedIdentity.primary_niche !== 'music') return false;
  const name = String(channelName || '');
  if (/\b(ai generated|cartoon|vlogs?|blogger|facts?|stories?)\b/i.test(name)) return false;
  return /\b(music|song|songs|singer|studio|records?|lyrics?|lyrical|remode|rhymes?|dance|dj|bhojpuri|punjabi|bollywood)\b/i.test(name);
}

function isFinanceBrandedChannel(channelName, protectedIdentity) {
  if (protectedIdentity.primary_niche !== 'finance') return false;
  const name = String(channelName || '');
  return /\b(finance|stock|market|trading|trader|invest|investment|crypto|bitcoin|miner|loan|nifty|sensex)\b/i.test(name);
}

function isSportsGameChannel(channelName, protectedIdentity) {
  if (protectedIdentity.primary_niche !== 'sports') return false;
  const name = String(channelName || '');
  if (/\b(video games?|gaming|gamer|gameplay)\b/i.test(name)) return false;
  return /\b(football|cricket|fifa|efootball|fc mobile|ipl|sports?)\b/i.test(name);
}

function isCompatibleRewrite(currentNiche, proposedNiche, protectedIdentity, channelName) {
  const current = norm(currentNiche);
  const proposed = norm(proposedNiche);
  if (!current || current === proposed) return true;
  if (BROAD_REWRITE_SOURCES.has(current)) return true;

  const compatible = COMPATIBLE_REWRITES[current];
  if (!compatible?.has(proposed)) return false;

  // These two transitions are common classifier traps. Keep them only when the
  // channel identity itself makes the move obvious.
  if (current === 'education' && proposed === 'music') {
    return isKidsMusicChannel(channelName, protectedIdentity);
  }
  if (current === 'education' && proposed === 'finance') {
    return isFinanceBrandedChannel(channelName, protectedIdentity);
  }
  if (current === 'gaming' && proposed === 'sports') {
    return isSportsGameChannel(channelName, protectedIdentity);
  }
  return true;
}

function inferProtectedIdentity({ channelName = '', titles = [], description = '' } = {}) {
  const titleTexts = titles.map(t => typeof t === 'string' ? t : (t?.title || ''));
  const texts = [channelName, description, ...titleTexts].filter(Boolean);
  if (!texts.length) return null;

  const scores = {};
  for (const [family, patterns] of Object.entries(PATTERNS)) {
    scores[family] = countMatches(texts, patterns);
  }

  const titleCount = Math.max(1, titleTexts.length);
  const strong = (family, min = 2) => scores[family].count >= min;
  // Dominance threshold for families that commonly appear as SEGMENTS inside broader
  // channels (news runs daily horoscope → astrology; a vlog has a comedy bit). Require a
  // real share, not 2 incidental videos, so news/movie channels aren't hijacked.
  const domMin = Math.max(3, Math.ceil(titleCount * 0.25));

  // Ordered by specificity. This prevents generic education/music/lifestyle
  // signals from overriding devotional, medical education, or fitness.
  let family = null;
  if (strong('astrology', domMin) || (scores.astrology.count >= 2 && /astro|jyotish|horoscope|kundli|tarot|vastu/i.test(channelName))) {
    family = 'astrology';
  } else if (strong('devotional', domMin) || (scores.devotional.count >= 2 && /recitation|bhajan|bhakti|bageshwar|dham|temple|mandir|quran|aarti|kirtan|satsang|devotional/i.test(channelName))) {
    // Dominance-gated (like astrology/comedy): real devotional channels are saturated
    // with bhajan/aarti/kirtan terms. News channels merely COVERING a festival hit only
    // 2-3 such headlines — below domMin — so they no longer get hijacked to music.
    family = 'devotional';
  } else if (strong('medicalEducation', 2)) {
    family = 'medicalEducation';
  } else if (strong('fitness', 2)) {
    family = 'fitness';
  } else if (strong('gaming', 2)) {
    family = 'gaming';
  } else if (strong('food', 2)) {
    family = 'food';
  } else if (strong('travel', 2)) {
    family = 'travel';
  } else if (strong('finance', 2)) {
    family = 'finance';
  } else if (strong('technology', 2)) {
    family = 'technology';
  } else if (strong('comedy', domMin) && !/\b(kids?|nursery|rhymes?|toddler|preschool|cartoon|toons?)\b/i.test(channelName)) {
    family = 'comedy';
  } else if (strong('education', Math.min(3, Math.max(2, Math.ceil(titleCount * 0.08))))) {
    family = 'education';
  } else if (strong('geopolitics', 2)) {
    family = 'geopolitics';
  } else if (strong('politics', 2)) {
    family = 'politics';
  } else if (strong('sports', 2)) {
    family = 'sports';
  } else if (strong('health', 2)) {
    family = 'health';
  } else if (strong('beauty', 2)) {
    family = 'beauty';
  } else if (strong('music', 2)) {
    family = 'music';
  }

  if (!family) return null;
  const primary_niche = FAMILY_TO_NICHE[family];
  return {
    family,
    primary_niche,
    evidence: scores[family].evidence,
    score: scores[family].count,
    all_scores: Object.fromEntries(Object.entries(scores).map(([k, v]) => [k, v.count])),
  };
}

function applyIdentityGuard(identity, context = {}) {
  const protectedIdentity = inferProtectedIdentity(context);
  if (!protectedIdentity) return { ...identity };

  const next = { ...identity };
  const current = norm(next.primary_niche);
  const target = protectedIdentity.primary_niche;

  if (target && current !== target) {
    next.secondary_niche = current && current !== 'other' ? current : (next.secondary_niche || null);
    next.primary_niche = target;
    next.identity_confidence = Math.max(Number(next.identity_confidence) || 0, 0.82);
    next.identity_strength = Math.max(Number(next.identity_strength) || 0, 0.75);
    next.identity_reasoning = [
      next.identity_reasoning,
      `Deterministic guard set primary_niche=${target} from ${protectedIdentity.family} evidence: ${protectedIdentity.evidence.join(', ')}.`,
    ].filter(Boolean).join(' ');
  }

  const topics = new Set(Array.isArray(next.inferred_topics) ? next.inferred_topics : []);
  topics.add(protectedIdentity.family === 'devotional' ? 'devotional spiritual' : protectedIdentity.family);
  next.inferred_topics = [...topics].slice(0, 6);
  next.identity_guard = protectedIdentity;
  return next;
}

// When the deterministic guard can't form an opinion (typically non-English / sparse titles its
// English keyword patterns can't read), it provides no real protection — so blocking strands the
// channel with whatever its one-shot ai_detected label was. In that case defer to the model's
// proposed niche IF the model is highly confident; otherwise stay conservative. 0.8 is on the
// 0-1 identity_confidence scale. Only loosens the no-opinion bucket — when the guard DOES have an
// opinion (agree/defend/conflict), its decision is unchanged.
const GUARD_DEFER_CONFIDENCE = 0.8;

function shouldAllowNicheRewrite({ currentNiche, proposedNiche, channelName, titles, description, identitySource, proposedConfidence } = {}) {
  if (/operator_(override|locked|modified)/i.test(String(identitySource || ''))) {
    return { allow: false, reason: 'operator_locked_identity' };
  }
  const protectedIdentity = inferProtectedIdentity({ channelName, titles, description });
  if (!protectedIdentity) {
    if (Number(proposedConfidence) >= GUARD_DEFER_CONFIDENCE) {
      return { allow: true, reason: 'no_guard_opinion_defer_to_confident_model', proposed_confidence: Number(proposedConfidence) };
    }
    return { allow: false, reason: 'no_protected_identity_for_rewrite' };
  }
  if (protectedIdentity.primary_niche === proposedNiche) {
    const titleCount = Array.isArray(titles) ? titles.length : 0;
    const minEvidence = Math.max(5, Math.ceil(Math.max(titleCount, 1) * 0.3));
    if (protectedIdentity.score < minEvidence) {
      return {
        allow: false,
        reason: `weak_protected_identity_${protectedIdentity.primary_niche}_${protectedIdentity.score}_of_${titleCount}`,
        protected_identity: protectedIdentity,
      };
    }
    if (!isCompatibleRewrite(currentNiche, proposedNiche, protectedIdentity, channelName)) {
      return {
        allow: false,
        reason: `incompatible_rewrite_${currentNiche}_to_${proposedNiche}`,
        protected_identity: protectedIdentity,
      };
    }
    if (norm(proposedNiche) === 'music' &&
        ['entertainment', 'beauty', 'travel'].includes(norm(currentNiche)) &&
        !isMusicChannel(channelName, protectedIdentity)) {
      return {
        allow: false,
        reason: `weak_music_rewrite_from_${norm(currentNiche)}`,
        protected_identity: protectedIdentity,
      };
    }
    return { allow: true, reason: 'matches_protected_identity', protected_identity: protectedIdentity };
  }
  if (protectedIdentity.primary_niche === currentNiche) {
    return { allow: false, reason: `protected_identity_${protectedIdentity.primary_niche}`, protected_identity: protectedIdentity };
  }
  return { allow: false, reason: `proposed_conflicts_with_protected_${protectedIdentity.primary_niche}`, protected_identity: protectedIdentity };
}

module.exports = {
  inferProtectedIdentity,
  applyIdentityGuard,
  shouldAllowNicheRewrite,
  isCompatibleRewrite,
};

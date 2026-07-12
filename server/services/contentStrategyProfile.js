'use strict';

const { computeCuriosityExplainerSignals } = require('../lib/explainerProfile');

const CSP_PROFILE_VERSION = 4;

// Strong keyword hit = 3 pts, weak = 1 pt.
// 18 CSP labels — two new: founder_economy_conversation, personal_finance_guest_show
const CSP_DEFINITIONS = {

  // ── Solo / teaching ──────────────────────────────────────────────────────
  spiritual_teaching_solo: {
    // Require strong yogic anchors only — do NOT trigger on generic "life", "truth", "energy"
    strong: ['karma', 'tantra', 'shiva', 'enlightenment', 'sadhguru', 'inner engineering',
             'isha foundation', 'sadhana', 'chakra', 'bhakti', 'moksha',
             'kundalini', 'atman', 'brahman', 'nirvana', 'yoga sutra'],
    weak:   ['meditation', 'consciousness', 'divine', 'guru', 'spiritual', 'soul', 'awakening'],
  },
  wellness_transformation_teaching: {
    strong: ['manifestation', 'visualization', 'visualisation', 'healing', 'moksh',
             'manifest', 'law of attraction', 'subconscious', 'money energy',
             'negative thinking', 'positive thinking', 'affirmation', 'reiki'],
    weak:   ['transform', 'mindset', 'anxiety', 'trauma', 'relationship', 'love',
             'self love', 'confidence', 'purpose', 'potential', 'abundance'],
  },
  exam_demand_teaching: {
    strong: ['upsc', 'jee', 'neet', 'prelims', 'mains', 'answer key', 'cut off',
             'aspirant', 'pyq', 'mock test', 'gs paper', 'current affairs', 'ssc', 'gate exam'],
    weak:   ['exam', 'preparation', 'syllabus', 'revision',
             'batch', 'lecture', 'study plan', 'test series'],
  },
  news_event_bulletin: {
    strong: ['breaking', 'live news', 'news update', 'latest news', 'today news',
             'headline', 'press conference', 'special report', 'election result', 'news bulletin'],
    weak:   ['government', 'election', 'ministry', 'parliament', 'policy',
             'official', 'verdict', 'protest', 'crisis', 'report'],
  },
  tech_review_gadget: {
    strong: ['unboxing', 'first look', 'hands on', 'flagship', 'earbuds', 'tws',
             'gpu', 'processor', 'gaming phone', 'smartwatch', 'best budget',
             'camera test', 'speed test', 'vs test'],
    weak:   ['review', 'specs', 'camera', 'battery', 'display', 'price',
             'performance', 'android', 'ios', 'phone', 'laptop', 'tablet', 'comparison'],
  },
  yoga_fitness_practice: {
    strong: ['yoga for', 'morning yoga', 'gentle yoga', 'yoga flow', 'yoga poses',
             'asana', 'pilates', 'yoga practice', 'yoga sequence', 'yoga class', 'vinyasa'],
    weak:   ['yoga', 'stretch', 'flexibility', 'workout', 'exercise', 'back pain',
             'neck', 'hips', 'strength', 'breathwork', 'posture'],
  },
  business_case_study: {
    strong: ['case study', 'rise of', 'fall of', 'story of', 'business model',
             'why it failed', 'how it became', 'how they built', 'collapse of',
             'the real story', 'secret behind', 'lessons from', 'what went wrong'],
    weak:   ['business', 'brand', 'company', 'market', 'strategy', 'industry',
             'revenue', 'profit', 'competition', 'disruption'],
  },
  finance_investment_education: {
    strong: ['mutual fund', 'stock market', 'portfolio', 'bull market', 'bear market',
             'etf', 'sip', 'nifty', 'sensex', 'dividend', 'equity', 'smallcap',
             'midcap', 'index fund', 'valuation'],
    weak:   ['investment', 'wealth', 'returns', 'fund', 'asset', 'passive income',
             'financial independence', 'retire early', 'investor'],
  },
  personal_finance_teaching: {
    strong: ['budget', 'emergency fund', 'emi', 'insurance', 'tax planning',
             'financial planning', 'savings plan', 'debt free', 'net worth', 'term plan'],
    weak:   ['money', 'income', 'expense', 'loan', 'save', 'salary', 'spend', 'debt', 'credit'],
  },
  gaming_entertainment: {
    strong: ['gameplay', 'gta', 'minecraft', 'pubg', 'fortnite', 'valorant',
             'free fire', 'bgmi', 'level up', 'boss fight', 'game review'],
    weak:   ['gaming', 'game', 'play', 'squad', 'challenge', 'stream', 'gamer'],
  },
  comedy_sketch: {
    strong: ['funny', 'prank', 'comedy', 'roast', 'parody', 'spoof', 'skit', 'stand up'],
    weak:   ['laugh', 'fun', 'hilarious', 'joke', 'reaction', 'meme'],
  },
  travel_lifestyle_vlog: {
    strong: ['vlog', 'road trip', 'safari', 'day in my life', 'travel diaries'],
    weak:   ['travel', 'visiting', 'trip', 'adventure', 'destination', 'journey',
             'places', 'hotel', 'flight', 'explore'],
  },
  cooking_food_recipe: {
    strong: ['recipe', 'how to make', 'homemade', 'bake', 'chef', 'cooking tutorial'],
    weak:   ['food', 'meal', 'kitchen', 'dish', 'cook', 'restaurant', 'healthy meal'],
  },
  general_education: {
    strong: ['history of', 'complete guide', 'science of', 'documentary', 'origin of'],
    weak:   ['explained', 'understand', 'learn', 'what is', 'how does', 'why does', 'fact'],
  },
  curiosity_explainer: {
    strong: ['explained', 'hidden', 'secret', 'behind', 'inside', 'truth about',
             'why does', 'why did', 'why is', 'how did', 'how does', 'what is',
             'what happens', 'here is why', "here's why", 'designed', 'crisis',
             'missing', 'banned', 'legalized'],
    weak:   ['india', 'indian', 'indians', 'google', 'meta', 'amazon', 'swiggy',
             'cities', 'food', 'bills', 'rich', 'poor', 'market', 'stock',
             'internet', 'delivery', 'government', 'policy', 'brand'],
  },

  // ── Guest / conversation shows ────────────────────────────────────────────
  // These require high guest_ratio to fire strongly; topic routing picks the right one.
  indian_business_selfimprovement_podcast: {
    // Business/self-improvement conversations — Raj Shamani style.
    // Do NOT trigger on creator_mode=podcast alone; needs vocabulary evidence.
    strong: ['success story', 'life lessons', 'my journey', 'life changing',
             'self improvement', 'secrets of success', 'mindset shift',
             'hustle culture', 'growth mindset'],
    weak:   ['india', 'entrepreneur', 'startup', 'motivation', 'career',
             'leadership', 'productivity', 'ambition', 'goals', 'hustle'],
  },
  spiritual_geopolitics_guest_show: {
    // Guest conversations mixing spirituality, geopolitics, ancient India — BeerBiceps style.
    strong: ['geopolit', 'ancient india', 'india\'s secret', 'witch', 'archaeology',
             'mystery of', 'hidden truth', 'paranormal', 'unexplained', 'occult'],
    weak:   ['spiritual', 'energy', 'ancient', 'mythology', 'vedic', 'culture',
             'history', 'esoteric', 'consciousness'],
  },
  founder_economy_conversation: {
    // Founder/investor/economy guest conversations — Nikhil Kamath "People by WTF" style.
    strong: ['wtf', 'people by wtf', 'founder', 'build in india', 'venture capital',
             'angel investor', 'unicorn', 'ipo', 'series a', 'series b', 'funding round'],
    weak:   ['economy', 'startup', 'capital', 'market', 'innovation',
             'entrepreneur', 'disruption', 'scale', 'valuation', 'investor'],
  },
  personal_finance_guest_show: {
    // Guest conversations about personal finance / wealth — Finance With Sharan style.
    strong: ['personal finance', 'wealth management', 'financial freedom',
             'money management', 'debt free journey', 'fire movement', 'financial independence'],
    weak:   ['money', 'finance', 'save', 'earn', 'wealth', 'financial', 'budget',
             'salary', 'expense', 'loan', 'insurance'],
  },
};

// ── Secondary CSP blocklist ───────────────────────────────────────────────────
// If primary_csp is in this map, any secondary in the Set is suppressed.
const SECONDARY_BLOCKLIST = {
  news_event_bulletin: new Set([
    'spiritual_teaching_solo', 'spiritual_geopolitics_guest_show', 'yoga_fitness_practice',
    'wellness_transformation_teaching', 'cooking_food_recipe', 'travel_lifestyle_vlog',
    'gaming_entertainment', 'comedy_sketch', 'exam_demand_teaching',
    'indian_business_selfimprovement_podcast', 'founder_economy_conversation',
  ]),
  tech_review_gadget: new Set([
    'yoga_fitness_practice', 'spiritual_teaching_solo', 'wellness_transformation_teaching',
    'cooking_food_recipe', 'travel_lifestyle_vlog', 'comedy_sketch', 'exam_demand_teaching',
    'personal_finance_guest_show', 'spiritual_geopolitics_guest_show',
  ]),
  exam_demand_teaching: new Set([
    'spiritual_teaching_solo', 'spiritual_geopolitics_guest_show', 'yoga_fitness_practice',
    'wellness_transformation_teaching', 'gaming_entertainment', 'cooking_food_recipe',
    'travel_lifestyle_vlog', 'comedy_sketch', 'founder_economy_conversation',
    'personal_finance_guest_show', 'indian_business_selfimprovement_podcast',
  ]),
  indian_business_selfimprovement_podcast: new Set([
    'exam_demand_teaching', 'yoga_fitness_practice', 'cooking_food_recipe', 'gaming_entertainment',
  ]),
  business_case_study: new Set([
    'spiritual_teaching_solo', 'yoga_fitness_practice', 'cooking_food_recipe',
    'gaming_entertainment', 'comedy_sketch', 'exam_demand_teaching',
  ]),
  curiosity_explainer: new Set([
    'spiritual_teaching_solo', 'yoga_fitness_practice', 'cooking_food_recipe',
    'gaming_entertainment', 'comedy_sketch', 'exam_demand_teaching',
    'travel_lifestyle_vlog', 'personal_finance_guest_show',
    'indian_business_selfimprovement_podcast',
  ]),
  finance_investment_education: new Set([
    'yoga_fitness_practice', 'gaming_entertainment', 'cooking_food_recipe',
    'comedy_sketch', 'spiritual_teaching_solo', 'exam_demand_teaching',
  ]),
  spiritual_teaching_solo: new Set([
    'tech_review_gadget', 'gaming_entertainment', 'cooking_food_recipe',
    'exam_demand_teaching', 'news_event_bulletin',
  ]),
  yoga_fitness_practice: new Set([
    'tech_review_gadget', 'gaming_entertainment', 'news_event_bulletin',
    'exam_demand_teaching', 'business_case_study',
  ]),
  founder_economy_conversation: new Set([
    'yoga_fitness_practice', 'gaming_entertainment', 'cooking_food_recipe',
    'comedy_sketch', 'exam_demand_teaching', 'spiritual_teaching_solo',
  ]),
  personal_finance_guest_show: new Set([
    'yoga_fitness_practice', 'gaming_entertainment', 'cooking_food_recipe',
    'comedy_sketch', 'exam_demand_teaching', 'spiritual_teaching_solo',
  ]),
};

// Guest detection patterns
const GUEST_PATTERNS = [
  /\bft\.\s/i,
  /\bfeat\.\s/i,
  /\bfeaturing\s/i,
  / ft /i,
  /\bepisode\s+\d+/i,
  /\bep\.\s*\d+/i,
  /\s#\d+\b/,
  /\bwtf\b/i,
  // "| FWS 113", "| EP 47", "| XYZ 200" style episode codes
  /\|\s*[A-Z]{2,6}\s*\d{1,4}\b/,
];

// Topic affinity dimensions used to route guest content to the right conversation CSP
const GUEST_TOPIC_AFFINITIES = {
  founder_economy: [
    'founder', 'wtf', 'venture', 'angel investor', 'unicorn', 'ipo', 'funding',
    'series a', 'series b', 'build in india', 'startup ecosystem', 'valuation', 'investor',
  ],
  selfimprovement: [
    'success', 'motivation', 'mindset', 'hustle', 'productivity', 'leadership',
    'self improvement', 'career', 'goals', 'growth', 'life changing', 'habits', 'ambition',
    'entrepreneur',
  ],
  spiritual_geo: [
    'spiritual', 'ancient', 'consciousness', 'energy', 'mystery', 'archaeology',
    'mythology', 'vedic', 'geopolit', 'secret', 'forbidden', 'paranormal',
  ],
  personal_finance: [
    'money', 'budget', 'savings', 'debt', 'loan', 'salary', 'expense',
    'wealth management', 'financial freedom', 'personal finance', 'insurance', 'tax', 'credit',
  ],
  finance_invest: [
    'stock', 'mutual fund', 'portfolio', 'invest', 'market', 'etf', 'dividend',
    'equity', 'nifty', 'sensex', 'amc', 'bull', 'bear', 'smallcap', 'midcap',
  ],
};

// Strong yogic terms for spiritual_teaching_solo differentiation.
// Deliberately excludes 'mantra' (used in wellness content) and 'dharma' (general life advice).
const YOGIC_TERMS = [
  'karma', 'tantra', 'shiva', 'enlighten', 'sadhguru', 'inner engineering',
  'sadhana', 'isha', 'chakra', 'bhakti', 'moksha', 'kundalini',
];

// Niches that often have solo/non-guest content but should not become
// spiritual_teaching_solo unless titles contain real yogic/spiritual anchors.
const SPIRITUAL_SOLO_HARD_BLOCK_NICHES = new Set([
  'food', 'cooking', 'entertainment', 'comedy', 'gaming', 'music', 'defence',
  'defense', 'sports', 'technology', 'tech', 'beauty', 'fashion', 'kids',
]);

const SPIRITUAL_SOLO_CONTEXT_BLOCK_NICHES = new Set([
  'travel', 'lifestyle', 'news', 'politics', 'business', 'finance', 'fitness',
  'geopolitics',
]);

const SPIRITUAL_NICHE_HINTS = [
  'spiritual', 'spirituality', 'yoga', 'meditation', 'religion', 'religious',
  'hindu', 'devotional', 'philosophy', 'temple', 'sadhguru', 'vedanta',
];

const YOGA_FITNESS_BLOCK_NICHES = new Set([
  'entertainment', 'comedy', 'gaming', 'music', 'food', 'cooking', 'beauty',
  'fashion', 'kids', 'technology', 'tech', 'business', 'finance', 'travel',
  'lifestyle', 'sports',
]);

const YOGA_FITNESS_HINTS = [
  'yoga', 'fitness', 'workout', 'exercise', 'health', 'nutrition', 'diet',
  'stretch', 'flexibility', 'pilates', 'bodybuilding', 'strength',
];

const WELLNESS_BLOCK_NICHES = new Set([
  'entertainment', 'comedy', 'gaming', 'music', 'food', 'cooking', 'sports',
  'technology', 'tech', 'business', 'finance', 'beauty', 'fashion', 'kids',
]);

const WELLNESS_HINTS = [
  'wellness', 'healing', 'therapy', 'mental health', 'meditation', 'mindset',
  'spiritual', 'manifestation', 'self improvement', 'motivation',
];

const FINANCE_BUSINESS_BLOCK_NICHES = new Set([
  'entertainment', 'comedy', 'gaming', 'music', 'food', 'cooking', 'travel',
  'lifestyle', 'sports', 'beauty', 'fashion', 'kids', 'yoga', 'fitness',
  'health',
]);

const FINANCE_BUSINESS_HINTS = [
  'finance', 'financial', 'stock', 'market', 'invest', 'investment', 'trading',
  'business', 'entrepreneur', 'startup', 'economy', 'economics', 'wealth',
  'money', 'tax', 'banking',
];

const CURIOSITY_EXPLAINER_BLOCK_NICHES = new Set([
  'music', 'entertainment', 'comedy', 'gaming', 'kids', 'beauty', 'fashion',
  'travel', 'lifestyle', 'food', 'cooking', 'sports', 'yoga', 'fitness',
]);

const CURIOSITY_EXPLAINER_BLOCK_HINTS = [
  'music', 'song', 'songs', 'bollywood', 'movie', 'film', 'trailer', 'teaser',
  'scene', 'lyric', 'karaoke', 'children', "children's", 'kids', 'cartoon',
  'animation', 'nursery', 'rhymes', 'gaming', 'gameplay', 'comedy', 'prank',
  'challenge', 'vlog', 'travel', 'recipe', 'cooking', 'diy', 'craft', 'beauty',
  'fashion', 'sports',
];

// Event-reactive patterns (for evergreen_ratio computation)
const EVENT_PATTERNS = [/\btoday\b/i, /\bbreaking\b/i, /\blatest news\b/i, /\blive\b/i,
                        /\b202[3-9]\b/, /this week/i, /last week/i, /\bupdate\b/i];

const STOP_WORDS = new Set(['the','a','an','and','or','but','in','on','at','to','for','of',
  'with','by','from','is','are','was','were','be','been','have','has','had','do','does',
  'did','will','would','could','should','may','might','can','this','that','these','those',
  'i','you','he','she','we','they','it','my','your','his','her','our','its','s','t',
  'what','why','how','when','where','who','which','about','after','before','into',
  'out','up','down','as','if','so','just','not','all','any','more','also','than',
  'then','here','there','ft','ep','vs','no','get','got']);

// ── Helpers ───────────────────────────────────────────────────────────────────

function detectGuestRatio(titles) {
  if (!titles.length) return 0;
  const hits = titles.filter(t => GUEST_PATTERNS.some(p => p.test(t)));
  return hits.length / titles.length;
}

function scoreAgainstCSP(titleText, strong, weak) {
  let score = 0;
  for (const kw of strong) {
    if (titleText.includes(kw)) score += 3;
  }
  for (const kw of weak) {
    if (titleText.includes(kw)) score += 1;
  }
  return score;
}

function computeTopicAffinity(titleText) {
  const result = {};
  for (const [dim, terms] of Object.entries(GUEST_TOPIC_AFFINITIES)) {
    result[dim] = terms.filter(t => titleText.includes(t)).length;
  }
  return result;
}

function extractTopVocab(titleText) {
  const words = titleText.replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(w => w.length >= 4 && !STOP_WORDS.has(w));
  const freq = {};
  for (const w of words) freq[w] = (freq[w] ?? 0) + 1;
  return Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 20).map(([w]) => w);
}

function computeEvergreenRatio(titles) {
  if (!titles.length) return 1;
  const reactive = titles.filter(t => EVENT_PATTERNS.some(p => p.test(t))).length;
  return 1 - (reactive / titles.length);
}

function hasAny(text, terms) {
  return terms.some(t => text.includes(t));
}

function isCspCompatible(csp, ctx) {
  const {
    primaryNiche, nicheDetail, creatorMode, routingProfile, formatType,
    formatProfile, guestRatio, titleText, yogicHits, curiositySignals,
  } = ctx;

  const financeHint   = hasAny(nicheDetail, FINANCE_BUSINESS_HINTS) || hasAny(titleText, FINANCE_BUSINESS_HINTS);
  const spiritualHint = hasAny(nicheDetail, SPIRITUAL_NICHE_HINTS) || yogicHits >= 2;
  const yogaHint      = hasAny(nicheDetail, YOGA_FITNESS_HINTS) || hasAny(titleText, ['yoga', 'asana', 'workout', 'exercise']);
  const wellnessHint  = hasAny(nicheDetail, WELLNESS_HINTS) || hasAny(titleText, ['healing', 'manifestation', 'affirmation', 'meditation']);
  const techHint      = hasAny(nicheDetail, ['tech', 'technology', 'smartphone', 'gadget', 'phone', 'laptop']);
  const foodHint      = hasAny(nicheDetail, ['food', 'cooking', 'recipe', 'kitchen', 'restaurant', 'street food']);
  const travelHint    = hasAny(nicheDetail, ['travel', 'vlog', 'journey', 'trip', 'tour', 'destination']);
  const gamingHint    = hasAny(nicheDetail, ['gaming', 'gameplay', 'game']);
  const comedyHint    = hasAny(nicheDetail, ['comedy', 'sketch', 'funny', 'prank', 'troll']);
  const examHint      = hasAny(nicheDetail, ['exam', 'upsc', 'jee', 'neet', 'ssc']) || creatorMode === 'upsc' || creatorMode === 'jee_prep';
  const newsHint      = hasAny(nicheDetail, ['news', 'politics', 'geopolitics', 'defence', 'defense']) || creatorMode === 'news';
  const businessHint  = financeHint || hasAny(nicheDetail, ['business', 'entrepreneur', 'startup', 'company']);
  const selfHelpHint  = hasAny(nicheDetail, ['self improvement', 'motivation', 'mindset', 'personal development', 'career']);
  const isGuestShow   = guestRatio >= 0.25 || formatProfile === 'podcast' || formatProfile === 'interview' || creatorMode === 'podcast';

  switch (csp) {
    case 'spiritual_teaching_solo':
      return spiritualHint && ['philosophy', 'yoga', 'selfimprovement', 'education', 'health', 'other'].includes(primaryNiche);
    case 'wellness_transformation_teaching':
      return wellnessHint || ['selfimprovement', 'motivation', 'yoga', 'health', 'philosophy'].includes(primaryNiche);
    case 'exam_demand_teaching':
      return examHint || primaryNiche === 'education';
    case 'news_event_bulletin':
      return newsHint || ['news', 'politics', 'geopolitics', 'defence'].includes(primaryNiche);
    case 'tech_review_gadget':
      return techHint || primaryNiche === 'technology';
    case 'yoga_fitness_practice':
      return yogaHint || ['yoga', 'fitness', 'health'].includes(primaryNiche);
    case 'business_case_study':
      return businessHint || ['business', 'finance'].includes(primaryNiche);
    case 'finance_investment_education':
    case 'personal_finance_teaching':
      return financeHint || primaryNiche === 'finance';
    case 'gaming_entertainment':
      return gamingHint || primaryNiche === 'gaming';
    case 'comedy_sketch':
      return comedyHint || ['comedy', 'entertainment'].includes(primaryNiche);
    case 'travel_lifestyle_vlog':
      return travelHint || ['travel', 'lifestyle'].includes(primaryNiche);
    case 'cooking_food_recipe':
      return foodHint || primaryNiche === 'food';
    case 'general_education':
      return primaryNiche === 'education' || hasAny(nicheDetail, ['education', 'learning', 'science', 'history', 'documentary']);
    case 'curiosity_explainer':
      {
        const blockedNiche =
          CURIOSITY_EXPLAINER_BLOCK_NICHES.has(primaryNiche) ||
          hasAny(nicheDetail, CURIOSITY_EXPLAINER_BLOCK_HINTS);
        const blockedFormat =
          ['podcast', 'interview', 'vlog', 'shorts', 'compilation', 'tutorial'].includes(formatType) ||
          ['guest_interview', 'podcast_like_longform', 'shorts', 'vlog'].includes(formatProfile);
        const financeEducationLike =
          primaryNiche === 'finance' &&
          routingProfile === 'business_finance' &&
          (formatType === 'tutorial' || hasAny(titleText, [
            'stock', 'stocks', 'invest', 'investment', 'mutual fund', 'portfolio',
            'sip', 'nifty', 'sensex', 'trading', 'loan', 'tax', 'insurance',
            'dividend', 'equity',
          ]));
        const founderConversationLike =
          routingProfile === 'business_finance' &&
          (creatorMode === 'podcast' || guestRatio >= 0.10 || hasAny(titleText, [
            'founder', 'startup', 'investor', 'venture capital', 'people by wtf',
            'wtf', 'unicorn', 'funding',
          ]));
        const businessCaseLike =
          routingProfile === 'business_finance' &&
          hasAny(titleText, [
            'case study', 'business model', 'rise of', 'fall of', 'why it failed',
            'revenue', 'profit', 'company', 'startup',
          ]) &&
          (curiositySignals?.everyday_ratio ?? 0) < 0.45;

        return !!curiositySignals?.active &&
          !blockedNiche &&
          !blockedFormat &&
          !isGuestShow &&
          !examHint &&
          !gamingHint &&
          !comedyHint &&
          !foodHint &&
          !travelHint &&
          !financeEducationLike &&
          !founderConversationLike &&
          !businessCaseLike;
      }
    case 'indian_business_selfimprovement_podcast':
      return isGuestShow && (businessHint || selfHelpHint || ['business', 'selfimprovement', 'motivation', 'finance'].includes(primaryNiche));
    case 'spiritual_geopolitics_guest_show':
      return isGuestShow && (spiritualHint || newsHint || hasAny(nicheDetail, ['ancient', 'mythology', 'history']));
    case 'founder_economy_conversation':
      return (isGuestShow || creatorMode === 'finance') && (financeHint || businessHint || ['finance', 'business'].includes(primaryNiche));
    case 'personal_finance_guest_show':
      return isGuestShow && (financeHint || businessHint || ['finance', 'business'].includes(primaryNiche));
    default:
      return true;
  }
}

// ── Classifier ────────────────────────────────────────────────────────────────

function classifyChannel(db, channelId) {
  const channel = db.get(
    `SELECT creator_mode, routing_profile, format_type, format_profile, niche, primary_niche, channel_subscribers,
            content_fingerprint
     FROM ingested_channels WHERE channel_id = ?`,
    [channelId],
  );

  const titleRows = db.all(
    `SELECT title FROM ingested_videos
     WHERE channel_id = ? AND title IS NOT NULL AND title != ''
     ORDER BY published_at DESC LIMIT 30`,
    [channelId],
  );
  const titles = titleRows.map(r => r.title);
  const titleText = titles.join(' ').toLowerCase();

  const guestRatio = detectGuestRatio(titles);
  const curiositySignals = computeCuriosityExplainerSignals(titles);
  const signals = [];

  // Base scores from vocabulary
  const scores = {};
  for (const [csp, def] of Object.entries(CSP_DEFINITIONS)) {
    scores[csp] = scoreAgainstCSP(titleText, def.strong, def.weak);
  }
  if (!curiositySignals.active) {
    scores['curiosity_explainer'] = 0;
  }

  // ── Hard boosts (creator_mode overrides) ──────────────────────────────────
  if (channel?.creator_mode === 'news') {
    scores['news_event_bulletin'] += 60;
    signals.push('creator_mode=news');
  }
  if (channel?.creator_mode === 'upsc' || channel?.creator_mode === 'jee_prep') {
    scores['exam_demand_teaching'] += 60;
    signals.push(`creator_mode=${channel.creator_mode}`);
  }

  // ── Profile field boosts (topic-informed) ─────────────────────────────────
  if (channel?.routing_profile === 'general_selfimprovement') {
    scores['indian_business_selfimprovement_podcast'] += 8;
    signals.push('routing_profile=general_selfimprovement');
  }
  if (channel?.routing_profile === 'meditation_spirituality') {
    scores['wellness_transformation_teaching'] += 7;
    signals.push('routing_profile=meditation_spirituality');
  }
  if (channel?.routing_profile === 'business_finance') {
    scores['business_case_study'] += 7;
    scores['finance_investment_education'] += 7;
    signals.push('routing_profile=business_finance');
  }
  if (channel?.routing_profile === 'fitness_flexibility') {
    scores['yoga_fitness_practice'] += 6;
    signals.push('routing_profile=fitness_flexibility');
  }
  if (channel?.creator_mode === 'finance') {
    scores['business_case_study'] += 5;
    scores['finance_investment_education'] += 5;
    signals.push('creator_mode=finance');
    // Founder/investor vocabulary wins over generic business_case_study.
    // Two-tier check: titles first, then fall back to description + fingerprint metadata
    // for short-clip channels where show identity lives in description boilerplate, not titles.
    if (channel?.routing_profile === 'business_finance') {
      const finAffinity = computeTopicAffinity(titleText);
      if ((finAffinity.founder_economy ?? 0) >= 2) {
        scores['founder_economy_conversation'] += 16;
        signals.push('finance_routing=founder_economy');
      } else {
        // Titles too thin — check video descriptions (boilerplate carries show identity)
        const descRows = db.all(
          `SELECT substr(description, 1, 400) AS d FROM ingested_videos
           WHERE channel_id = ? AND description IS NOT NULL AND description != ''
           ORDER BY published_at DESC LIMIT 12`,
          [channelId],
        );
        const descText = descRows.map(r => r.d).join(' ').toLowerCase();
        const descAffinity = descText.length > 30 ? computeTopicAffinity(descText) : {};

        // Check content_fingerprint phrases (pipe-separated IDF-weighted phrases)
        const fpText = (channel.content_fingerprint ?? '').replace(/\|/g, ' ').toLowerCase();
        const fpAffinity = fpText.length > 2 ? computeTopicAffinity(fpText) : {};

        const descFounder = descAffinity.founder_economy ?? 0;
        const fpFounder   = fpAffinity.founder_economy ?? 0;

        if (descFounder >= 2) {
          scores['founder_economy_conversation'] += 24;
          signals.push(`desc_founder_identity(desc=${descFounder},fp=${fpFounder})`);
        } else if (descFounder >= 1 && fpFounder >= 1) {
          // Weak signal from both sources — smaller boost
          scores['founder_economy_conversation'] += 12;
          signals.push(`desc_founder_identity(desc=${descFounder},fp=${fpFounder})`);
        }
      }
    }
  }

  // ── Podcast creator_mode — route to correct conversation CSP ─────────────
  if (channel?.creator_mode === 'podcast') {
    signals.push('creator_mode=podcast');
    const podcastAffinity = computeTopicAffinity(titleText);
    if (channel?.routing_profile === 'business_finance') {
      // Founder/economy podcasts vs personal-finance podcasts
      const founderScore = podcastAffinity.founder_economy ?? 0;
      const pfScore = podcastAffinity.personal_finance ?? 0;
      if (founderScore >= pfScore) {
        scores['founder_economy_conversation'] += 22;
        signals.push('podcast_routing=founder_economy');
      } else {
        scores['personal_finance_guest_show'] += 22;
        signals.push('podcast_routing=personal_finance');
      }
    } else if (channel?.routing_profile === 'general_selfimprovement') {
      scores['indian_business_selfimprovement_podcast'] += 12;
      signals.push('podcast_routing=selfimprovement');
    }
  }

  if (curiositySignals.active) {
    scores['curiosity_explainer'] += curiositySignals.strong ? 28 : 18;
    signals.push(
      `curiosity_explainer(hits=${curiositySignals.curiosity_count}/${curiositySignals.n},score=${curiositySignals.score})`,
    );

    if (guestRatio < 0.10) {
      scores['business_case_study'] = Math.max(0, (scores['business_case_study'] ?? 0) - 8);
      scores['finance_investment_education'] = Math.max(0, (scores['finance_investment_education'] ?? 0) - 8);
      scores['personal_finance_teaching'] = Math.max(0, (scores['personal_finance_teaching'] ?? 0) - 6);
    }
  } else if (curiositySignals.blockers.length) {
    signals.push(`curiosity_blocked=${curiositySignals.blockers.join('+')}`);
  }

  // ── Topic-aware guest routing ──────────────────────────────────────────────
  if (guestRatio >= 0.35) {
    const affinity = computeTopicAffinity(titleText);
    const [topDim, topCount] = Object.entries(affinity).sort((a, b) => b[1] - a[1])[0] ?? ['none', 0];

    if (topCount >= 2) {
      if (topDim === 'founder_economy') {
        scores['founder_economy_conversation'] += 20;
        signals.push(`guest_routing=founder_economy(${guestRatio.toFixed(2)})`);
      } else if (topDim === 'selfimprovement') {
        scores['indian_business_selfimprovement_podcast'] += 18;
        signals.push(`guest_routing=selfimprovement(${guestRatio.toFixed(2)})`);
      } else if (topDim === 'spiritual_geo') {
        scores['spiritual_geopolitics_guest_show'] += 18;
        signals.push(`guest_routing=spiritual_geo(${guestRatio.toFixed(2)})`);
      } else if (topDim === 'personal_finance') {
        scores['personal_finance_guest_show'] += 20;
        signals.push(`guest_routing=personal_finance(${guestRatio.toFixed(2)})`);
      } else if (topDim === 'finance_invest') {
        // Finance interview show → personal_finance_guest_show (not solo education)
        scores['personal_finance_guest_show'] += 20;
        scores['finance_investment_education'] += 4;
        signals.push(`guest_routing=finance_invest_show(${guestRatio.toFixed(2)})`);
      }
    } else {
      // Low affinity signal but high guest ratio — generic self-improvement boost
      scores['indian_business_selfimprovement_podcast'] += 10;
      signals.push(`guest_ratio_generic=${guestRatio.toFixed(2)}`);
    }
  } else if (guestRatio < 0.1 && titles.length >= 5) {
    // Solo content: penalise guest-show CSPs. Do not boost spiritual just because
    // a channel is non-guest; that caused food/comedy/defence/lifestyle channels
    // with thin vocabulary to drift into spiritual_teaching_solo.
    for (const k of ['spiritual_geopolitics_guest_show', 'indian_business_selfimprovement_podcast',
                     'founder_economy_conversation', 'personal_finance_guest_show']) {
      scores[k] = Math.max(0, (scores[k] ?? 0) - 6);
    }
  }

  // ── Strong yogic vocabulary → spiritual_teaching_solo ─────────────────────
  const yogicHits = YOGIC_TERMS.filter(w => titleText.includes(w)).length;
  if (yogicHits >= 2) {
    scores['spiritual_teaching_solo'] += yogicHits * 3;
    signals.push(`yogic_terms=${yogicHits}`);
  }

  const channelNiche = String(channel?.primary_niche || channel?.niche || '').toLowerCase();
  const channelNicheDetail = String(channel?.niche || '').toLowerCase();
  const hasSpiritualNicheHint = SPIRITUAL_NICHE_HINTS.some(h => channelNicheDetail.includes(h));
  const hasYogaFitnessHint = YOGA_FITNESS_HINTS.some(h => channelNicheDetail.includes(h));
  const hasWellnessHint = WELLNESS_HINTS.some(h => channelNicheDetail.includes(h));
  const hasFinanceBusinessHint = FINANCE_BUSINESS_HINTS.some(h => channelNicheDetail.includes(h));
  const spiritualVocabScore = scoreAgainstCSP(
    titleText,
    CSP_DEFINITIONS.spiritual_teaching_solo.strong,
    CSP_DEFINITIONS.spiritual_teaching_solo.weak,
  );
  if (
    SPIRITUAL_SOLO_HARD_BLOCK_NICHES.has(channelNiche) ||
    (SPIRITUAL_SOLO_CONTEXT_BLOCK_NICHES.has(channelNiche) && !hasSpiritualNicheHint)
  ) {
    scores['spiritual_teaching_solo'] = 0;
    signals.push(`blocked_spiritual_solo_niche=${channelNiche}`);
  }
  if (YOGA_FITNESS_BLOCK_NICHES.has(channelNiche) && !hasYogaFitnessHint) {
    scores['yoga_fitness_practice'] = 0;
    signals.push(`blocked_yoga_fitness_niche=${channelNiche}`);
  }
  if (WELLNESS_BLOCK_NICHES.has(channelNiche) && !hasWellnessHint) {
    scores['wellness_transformation_teaching'] = 0;
    signals.push(`blocked_wellness_niche=${channelNiche}`);
  }
  if (FINANCE_BUSINESS_BLOCK_NICHES.has(channelNiche) && !hasFinanceBusinessHint) {
    for (const k of [
      'business_case_study',
      'finance_investment_education',
      'founder_economy_conversation',
      'personal_finance_guest_show',
      'personal_finance_teaching',
      'indian_business_selfimprovement_podcast',
    ]) {
      scores[k] = 0;
    }
    signals.push(`blocked_finance_business_niche=${channelNiche}`);
  }

  // ── Pick primary ──────────────────────────────────────────────────────────
  const compatibilityCtx = {
    primaryNiche: channelNiche,
    nicheDetail: channelNicheDetail,
    creatorMode: String(channel?.creator_mode || '').toLowerCase(),
    routingProfile: String(channel?.routing_profile || '').toLowerCase(),
    formatType: String(channel?.format_type || '').toLowerCase(),
    formatProfile: String(channel?.format_profile || '').toLowerCase(),
    guestRatio,
    titleText,
    yogicHits,
    curiositySignals,
  };
  for (const csp of Object.keys(scores)) {
    if (!isCspCompatible(csp, compatibilityCtx)) {
      scores[csp] = 0;
    }
  }
  signals.push('compatibility_gate=v1');

  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  let [primaryCsp, primaryScore] = sorted[0];
  if ((primaryScore ?? 0) <= 0) {
    primaryCsp = 'unclassified_low_signal';
    primaryScore = 0;
  }

  // ── Confidence ────────────────────────────────────────────────────────────
  let confidence = 'low';
  let confidenceScore = 0;
  if (primaryScore > 0) {
    const topFiveSum = sorted.slice(0, 5).reduce((s, [, v]) => s + v, 0);
    confidenceScore = topFiveSum > 0 ? primaryScore / topFiveSum : 0;
    const margin = primaryScore - (sorted[1]?.[1] ?? 0);
    if (confidenceScore >= 0.50 && margin >= 6) confidence = 'high';
    else if (confidenceScore >= 0.32 && margin >= 3) confidence = 'medium';
  }
  if (signals.some(s => s.startsWith('creator_mode=news') || s.startsWith('creator_mode=upsc') || s.startsWith('creator_mode=jee'))) {
    confidence = 'high';
    confidenceScore = 1.0;
  }

  // ── Secondaries with suppression ─────────────────────────────────────────
  // Minimum: score >= max(5, 35% of primary) AND not in blocklist
  const minSecondary = Math.max(5, primaryScore * 0.35);
  const blocked = SECONDARY_BLOCKLIST[primaryCsp] ?? new Set();
  const secondaries = sorted.slice(1)
    .filter(([csp, sc]) => sc >= minSecondary && !blocked.has(csp));
  const secondaryCsp1 = secondaries[0]?.[0] ?? null;
  const secondaryCsp2 = secondaries[1]?.[0] ?? null;

  // ── Extended fields ───────────────────────────────────────────────────────
  const topVocab = extractTopVocab(titleText);
  const evergreenRatio = computeEvergreenRatio(titles);

  return {
    channel_id:            channelId,
    primary_csp:           primaryCsp,
    secondary_csp_1:       secondaryCsp1,
    secondary_csp_2:       secondaryCsp2,
    confidence,
    confidence_score:      confidenceScore,
    signal_source:         JSON.stringify(signals),
    title_sample_used:     titles.length,
    version:               CSP_PROFILE_VERSION,
    guest_signal:          guestRatio,
    evergreen_ratio:       evergreenRatio,
    event_reactive_ratio:  1 - evergreenRatio,
    title_vocabulary:      JSON.stringify(topVocab),
    debug_json:            JSON.stringify({
      top_scores: Object.fromEntries(sorted.slice(0, 8)),
      primary_score: primaryScore,
      margin: primaryScore - (sorted[1]?.[1] ?? 0),
      curiosity: curiositySignals,
    }),
  };
}

// ── Upsert (extended columns with basic fallback) ─────────────────────────────

let _hasExtendedCols = null;

function upsertCSP(db, channelId, cspData) {
  // Check once whether extended columns exist
  if (_hasExtendedCols === null) {
    const cols = db.all(`PRAGMA table_info(channel_content_strategy_profiles)`).map(r => r.name);
    _hasExtendedCols = cols.includes('guest_signal');
  }

  const base = [
    channelId, cspData.primary_csp, cspData.secondary_csp_1 ?? null, cspData.secondary_csp_2 ?? null,
    cspData.confidence, cspData.confidence_score, cspData.signal_source,
    cspData.title_sample_used, cspData.version,
  ];

  if (_hasExtendedCols) {
    db.run(
      `INSERT INTO channel_content_strategy_profiles
         (channel_id, primary_csp, secondary_csp_1, secondary_csp_2, confidence,
          confidence_score, signal_source, title_sample_used, version, classified_at,
          guest_signal, evergreen_ratio, event_reactive_ratio, title_vocabulary, debug_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?, ?, ?, ?, ?)
       ON CONFLICT(channel_id) DO UPDATE SET
         primary_csp = excluded.primary_csp, secondary_csp_1 = excluded.secondary_csp_1,
         secondary_csp_2 = excluded.secondary_csp_2, confidence = excluded.confidence,
         confidence_score = excluded.confidence_score, signal_source = excluded.signal_source,
         title_sample_used = excluded.title_sample_used, version = excluded.version,
         classified_at = datetime('now'), guest_signal = excluded.guest_signal,
         evergreen_ratio = excluded.evergreen_ratio, event_reactive_ratio = excluded.event_reactive_ratio,
         title_vocabulary = excluded.title_vocabulary, debug_json = excluded.debug_json`,
      [...base, cspData.guest_signal ?? null, cspData.evergreen_ratio ?? null,
       cspData.event_reactive_ratio ?? null, cspData.title_vocabulary ?? null, cspData.debug_json ?? null],
    );
  } else {
    db.run(
      `INSERT INTO channel_content_strategy_profiles
         (channel_id, primary_csp, secondary_csp_1, secondary_csp_2, confidence,
          confidence_score, signal_source, title_sample_used, version, classified_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(channel_id) DO UPDATE SET
         primary_csp = excluded.primary_csp, secondary_csp_1 = excluded.secondary_csp_1,
         secondary_csp_2 = excluded.secondary_csp_2, confidence = excluded.confidence,
         confidence_score = excluded.confidence_score, signal_source = excluded.signal_source,
         title_sample_used = excluded.title_sample_used, version = excluded.version,
         classified_at = datetime('now')`,
      base,
    );
  }
}

module.exports = { classifyChannel, upsertCSP, CSP_DEFINITIONS, SECONDARY_BLOCKLIST, GUEST_PATTERNS, detectGuestRatio, CSP_PROFILE_VERSION };

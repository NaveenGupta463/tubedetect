'use strict';

const { readCreatorIdeaDna } = require('./creatorIdeaDna');
const { extractConcept, extractConceptForDna, computeConceptAffinity, isFamilyConceptMismatch } = require('./conceptNormalizer');
const { extractOpportunity } = require('./opportunityExtractor');

const MIN_CONFIDENCE_SCORE = 0.48;

// India-specific variants kept under _IN keys so callers can filter by territory.
// Global (non-India) fallback entries use universal phrasing.
const DOMAIN_SUBJECTS = {
  money_economics: [
    'household budgets',
    'subscription spending',
    'salary growth',
    'small business credit',
    'invisible inflation',
    'the salary trap',
  ],
  money_economics_IN: [
    'India\'s middle class',
    'normal life in Indian cities',
  ],
  tech_ai: [
    'AI tools',
    'phone addiction',
    'data privacy',
    'algorithmic feeds',
    'digital subscriptions',
    'everyday apps',
  ],
  tech_ai_IN: [
    'Indian apps',
  ],
  health_body: [
    'protein products',
    'fitness supplements',
    'hair-loss cures',
    'sleep products',
    'health apps',
    'workout culture',
  ],
  health_body_IN: [
    'India\'s fitness boom',
  ],
  food_consumer: [
    'protein snacks',
    'packaged food labels',
    'delivery apps',
    'fitness foods',
    'sugar-free products',
    'restaurant pricing',
  ],
  food_consumer_IN: [
    'quick-commerce groceries',
  ],
  politics_policy: [
    'new regulations',
    'tax policy',
    'public subsidies',
    'state spending',
    'election promises',
    'policy loopholes',
  ],
  urban_infra: [
    'traffic design',
    'rent pressure',
    'water shortages',
    'urban heat',
    'city housing',
    'infrastructure costs',
  ],
  urban_infra_IN: [
    'Indian cities',
    'AC dependency',
  ],
  work_career: [
    'office work',
    'salary growth',
    'startup jobs',
    'workplace surveillance',
    'creator careers',
    'remote work',
  ],
  work_career_IN: [
    'India\'s hiring market',
  ],
  education_exam: [
    'exam coaching',
    'online courses',
    'student pressure',
    'college degrees',
    'test prep apps',
    'study routines',
  ],
  culture_society: [
    'status spending',
    'family expectations',
    'dating apps',
    'luxury signals',
    'generational money',
    'social media pressure',
  ],
  culture_society_IN: [
    'middle class ambition',
    'normal life',
  ],
  entertainment: [
    'late night comedy',
    'celebrity interviews',
    'pop culture moments',
    'game show formats',
    'talk show chemistry',
    'viral audience segments',
    'comedy sketch writing',
    'guest dynamics',
  ],
  sports_cricket: [
    'tournament pressure',
    'team dynamics',
    'sports economics',
    'player performance',
    'match strategy',
    'fan culture',
    'sports media',
    'athlete mindset',
  ],
  gaming: [
    'game strategy',
    'beginner mistakes',
    'meta shifts',
    'esports economics',
    'streaming culture',
    'game design',
  ],
  self_improvement: [
    'daily habits',
    'productivity systems',
    'mindset shifts',
    'decision-making',
    'focus strategies',
    'morning routines',
    'goal setting',
    'personal growth',
  ],
  travel: [
    'budget travel',
    'hidden destinations',
    'travel planning',
    'packing decisions',
    'local culture',
    'solo travel',
  ],
  news_current: [
    'breaking news context',
    'investigative angles',
    'policy impact',
    'timeline of events',
    'who benefits',
    'local consequences',
  ],
  science_environment: [
    'urban heat',
    'climate adaptation',
    'pollution fixes',
    'water scarcity',
    'energy demand',
    'medical breakthroughs',
  ],
  brand_business: [
    'Indian startups',
    'subscription apps',
    'quick-commerce brands',
    'fitness brands',
    'consumer companies',
    'platform businesses',
  ],
  media_internet: [
    'creator platforms',
    'viral news',
    'internet fame',
    'algorithm culture',
    'paid communities',
    'content subscriptions',
  ],
  lifestyle_status: [
    'luxury pricing',
    'middle class life',
    'fitness culture',
    'renting homes',
    'wedding spending',
    'status symbols',
  ],
};

const COMBO_BETS = [
  {
    domains: ['urban_infra'],
    thesis: ['broken_system', 'daily_life_system', 'india_system'],
    topic: 'Why Indian cities are becoming too hot to live in',
    reason: 'Combines the creator\'s India/system framing with urban heat and daily-life stakes.',
  },
  {
    domains: ['urban_infra', 'brand_business'],
    thesis: ['hidden_economics', 'daily_life_system'],
    topic: 'The hidden business behind India\'s AC addiction',
    reason: 'Turns a daily-life problem into a hidden economics story, matching the creator DNA.',
  },
  {
    domains: ['tech_ai', 'brand_business'],
    thesis: ['hidden_economics', 'tech_shift'],
    topic: 'Why every Indian app now wants a subscription',
    reason: 'Uses the tech/business overlap in the DNA with a clear recurring India angle.',
  },
  {
    domains: ['health_body', 'food_consumer'],
    thesis: ['consumer_deception', 'investigation'],
    topic: 'The protein scam hiding inside India\'s fitness boom',
    reason: 'Matches health, consumer brands, and investigation patterns from the creator profile.',
  },
  {
    domains: ['money_economics', 'lifestyle_status'],
    thesis: ['hidden_economics', 'daily_life_system'],
    topic: 'Why India\'s middle class pays luxury prices for normal life',
    reason: 'Turns middle-class pressure into a broad hidden-economics thesis.',
  },
  {
    domains: ['food_consumer', 'brand_business'],
    thesis: ['consumer_deception', 'hidden_economics'],
    topic: 'How food brands make healthy choices feel impossible',
    reason: 'Combines consumer deception with brand-business DNA without needing a peer trend.',
  },
  {
    domains: ['tech_ai', 'media_internet'],
    thesis: ['consumer_deception', 'tech_shift'],
    topic: 'Why your phone is becoming a subscription machine',
    reason: 'Builds from tech-shift and consumer-trap signals in the creator profile.',
  },
  {
    domains: ['work_career', 'money_economics'],
    thesis: ['broken_system', 'daily_life_system'],
    topic: 'Why better jobs still do not make normal life affordable',
    reason: 'Uses work, money, and daily-life system pressure as the core tension.',
  },
];

const THESIS_TEMPLATES = {
  hidden_economics: [
    subject => `The hidden business behind ${subject}`,
    subject => `Who really makes money from ${subject}?`,
  ],
  broken_system: [
    subject => `Why ${subject} feels broken now`,
    subject => `The design flaw nobody notices in ${subject}`,
  ],
  consumer_deception: [
    subject => `The trap hiding inside ${subject}`,
    subject => `Why ${subject} is harder to trust than it looks`,
  ],
  future_threat: [
    subject => `Why ${subject} could become the next big problem`,
    subject => `The future threat hiding inside ${subject}`,
  ],
  investigation: [
    subject => `What is really happening inside ${subject}`,
    subject => `The uncomfortable truth behind ${subject}`,
  ],
  myth_bust: [
    subject => `What people get wrong about ${subject}`,
    subject => `The myth that keeps ${subject} alive`,
  ],
  comparison: [
    subject => `${subject}: who wins and who pays?`,
    subject => `The real winners and losers of ${subject}`,
  ],
  science_explainer: [
    subject => `The science behind ${subject} that nobody explains`,
    subject => `Why ${subject} works differently than people think`,
  ],
  tech_shift: [
    subject => `Why ${subject} is quietly changing how people live`,
    subject => `The tech shift hiding inside ${subject}`,
  ],
  india_system: [
    subject => /\b(india|indian|indians|bharat)\b/i.test(subject)
      ? `Why ${subject} is harder to fix than it looks`
      : `What makes ${subject} different in India`,
    subject => `The Indian system behind ${subject}`,
  ],
  daily_life_system: [
    subject => `Why normal life now depends on ${subject}`,
    subject => `How ${subject} became part of everyday life`,
  ],
  policy_power: [
    subject => `Who benefits when ${subject} changes?`,
    subject => `The policy fight behind ${subject}`,
  ],
  health_body: [
    subject => `What ${subject} is doing to the body`,
    subject => `The health tradeoff behind ${subject}`,
  ],
  career_work: [
    subject => `Why ${subject} is changing work faster than people realize`,
    subject => `The career risk hiding inside ${subject}`,
  ],
  brand_business: [
    subject => `The business model behind ${subject}`,
    subject => `Why brands are obsessed with ${subject}`,
  ],
  crisis_risk: [
    subject => `Why ${subject} could turn into a crisis`,
    subject => `The risk nobody prices into ${subject}`,
  ],
};

const CSP_FAMILY_MAP = {
  unclassified_low_signal: 'generic',
  travel_lifestyle_vlog: 'travel_lifestyle',
  comedy_sketch: 'comedy_sketch',
  gaming_entertainment: 'gaming_entertainment',
  cooking_food_recipe: 'cooking_food',
  news_event_bulletin: 'news_event',
  exam_demand_teaching: 'exam_education',
  yoga_fitness_practice: 'fitness_practice',
  tech_review_gadget: 'tech_review',
  wellness_transformation_teaching: 'wellness_teaching',
  business_case_study: 'explainer_case',
  general_education: 'general_education',
  finance_investment_education: 'finance_education',
  personal_finance_teaching: 'finance_education',
  indian_business_selfimprovement_podcast: 'conversation_business',
  curiosity_explainer: 'explainer_case',
  spiritual_teaching_solo: 'spiritual_teaching',
  founder_economy_conversation: 'conversation_business',
  personal_finance_guest_show: 'conversation_finance',
  spiritual_geopolitics_guest_show: 'conversation_spiritual',
  late_night_talk_show: 'comedy_sketch',
  entertainment_talk_show: 'comedy_sketch',
  celebrity_interview_show: 'comedy_sketch',
  variety_entertainment: 'comedy_sketch',
  sports_commentary: 'news_event',
  music_entertainment: 'comedy_sketch',
};

const FAMILY_LABELS = {
  explainer_case: 'explainer/case-study',
  finance_education: 'finance education',
  conversation_business: 'business conversation',
  conversation_finance: 'finance conversation',
  conversation_spiritual: 'spiritual conversation',
  news_event: 'news/event analysis',
  exam_education: 'exam education',
  tech_review: 'tech review',
  general_education: 'general education',
  gaming_entertainment: 'gaming entertainment',
  comedy_sketch: 'comedy sketch',
  travel_lifestyle: 'travel/lifestyle',
  cooking_food: 'cooking/food',
  fitness_practice: 'fitness practice',
  wellness_teaching: 'wellness teaching',
  spiritual_teaching: 'spiritual teaching',
  generic: 'creator-specific',
};

const FAMILY_DEFAULT_SUBJECTS = {
  finance_education: [
    'SIP choices',
    'mutual fund risk',
    'portfolio mistakes',
    'loan decisions',
    'tax planning',
    'insurance buying',
    'market timing',
    'emergency funds',
  ],
  conversation_business: [
    'communication gaps',
    'career stagnation',
    'founder status',
    'ambition burnout',
    'wealth pressure',
    'trust-based networking',
    'startup discipline',
    'leadership loneliness',
    'founder ambition',
    'startup mistakes',
    'career leverage',
    'scale versus profit',
  ],
  conversation_finance: [
    'money habits',
    'salary decisions',
    'wealth building',
    'debt mistakes',
    'family finance',
    'retirement planning',
    'spending traps',
    'financial freedom',
  ],
  conversation_spiritual: [
    'ancient India',
    'consciousness',
    'mythology',
    'karma',
    'modern anxiety',
    'rituals',
    'civilization',
    'inner discipline',
  ],
  news_event: [
    'policy change',
    'election result',
    'market shock',
    'court verdict',
    'public protest',
    'government decision',
    'global conflict',
    'local impact',
  ],
  exam_education: [
    'current affairs',
    'UPSC prelims',
    'mains answer writing',
    'PYQ traps',
    'revision strategy',
    'mock test analysis',
    'syllabus coverage',
    'concept clarity',
  ],
  tech_review: [
    'budget phones',
    'camera performance',
    'battery life',
    'AI features',
    'laptop buying',
    'smartwatch value',
    'earbuds quality',
    'Android updates',
  ],
  general_education: [
    'history',
    'science basics',
    'world affairs',
    'Indian society',
    'technology',
    'law and rights',
    'environment',
    'economy',
  ],
  gaming_entertainment: [
    'rank push',
    'beginner settings',
    'challenge runs',
    'squad strategy',
    'new update',
    'boss fight',
    'map control',
    'comeback round',
  ],
  comedy_sketch: [
    'family pressure',
    'office politics',
    'college life',
    'relationship confusion',
    'festival plans',
    'neighbour drama',
    'shopping decisions',
    'Indian parents',
  ],
  travel_lifestyle: [
    'one-day itinerary',
    'budget trip',
    'hidden places',
    'food trail',
    'hotel choice',
    'local market',
    'road trip',
    'family travel',
  ],
  cooking_food: [
    'street food',
    'healthy breakfast',
    'festival sweets',
    'budget dinner',
    'regional thali',
    'restaurant-style curry',
    'quick snacks',
    'home baking',
  ],
  fitness_practice: [
    'back pain',
    'morning routine',
    'posture',
    'flexibility',
    'weight loss',
    'core strength',
    'breathwork',
    'beginner workout',
  ],
  wellness_teaching: [
    'mindset shift',
    'anxiety habits',
    'manifestation',
    'self love',
    'confidence',
    'healing routines',
    'negative thinking',
    'daily discipline',
  ],
  spiritual_teaching: [
    'karma',
    'meditation',
    'bhakti',
    'Shiva',
    'sadhana',
    'yoga sutra',
    'consciousness',
    'spiritual discipline',
  ],
  generic: [
    'your audience problem',
    'recent upload theme',
    'viewer confusion',
    'daily-life habit',
    'beginner mistake',
    'hidden tradeoff',
    'one clear transformation',
    'fresh viewer question',
  ],
};

const GENERIC_PLACEHOLDER_SUBJECTS = new Set(
  (FAMILY_DEFAULT_SUBJECTS.generic || []).map(subjectKey),
);

const FAMILY_SUBJECT_BOOSTS = {
  finance_education: [/\b(sip|mutual fund|stock|market|portfolio|loan|tax|insurance|debt|wealth|nifty|sensex)\b/i],
  conversation_business: [/\b(founder|startup|business|career|leadership|wealth|india|consumer|profit|scale)\b/i],
  conversation_finance: [/\b(money|salary|wealth|debt|budget|finance|loan|insurance|saving|spending)\b/i],
  conversation_spiritual: [/\b(ancient|consciousness|mythology|karma|ritual|civilization|spiritual|discipline)\b/i],
  news_event: [/\b(election|policy|court|verdict|war|conflict|government|protest|crisis|market|local|ministry|parliament|regulation)\b/i],
  exam_education: [/\b(upsc|jee|neet|ssc|mains|prelims|pyq|mock|syllabus|revision|current affairs|answer writing)\b/i],
  tech_review: [/\b(gpt|ai|phone|iphone|android|camera|battery|laptop|app|apps|earbuds|smartwatch|software|image|tool)\b/i],
  general_education: [/\b(history|science|explained|world|law|rights|environment|economy|space|universe|medical|equipment)\b/i],
  gaming_entertainment: [/\b(gta|minecraft|free fire|bgmi|pubg|fortnite|valorant|rank|squad|boss|map|challenge|train|car)\b/i],
  comedy_sketch: [/\b(family|office|college|relationship|festival|parents|neighbour|shopping|school|friend)\b/i],
  travel_lifestyle: [/\b(travel|trip|itinerary|budget|place|hotel|market|road|food|family|destination|home|house)\b/i],
  cooking_food: [/\b(food|recipe|cook|street food|breakfast|dinner|snack|thali|curry|baking|restaurant|meal)\b/i],
  fitness_practice: [/\b(weight loss|fat loss|workout|yoga|posture|back pain|routine|flexibility|breath|carb|exercise|health)\b/i],
  wellness_teaching: [/\b(mindset|anxiety|manifest|healing|self love|confidence|thinking|discipline|relationship)\b/i],
  spiritual_teaching: [/\b(karma|meditation|bhakti|shiva|sadhana|yoga sutra|consciousness|spiritual|guru)\b/i],
  generic: [/\b(problem|mistake|question|habit|tradeoff|change|story|viewer|space|medical|equipment|universe)\b/i],
};

const FAMILY_TEMPLATES = {
  finance_education: [
    subject => `How ${subject} can change your next money decision`,
    subject => `The beginner mistake inside ${subject}`,
    subject => `${subject}: risk, returns, and timing explained simply`,
    subject => `Before you trust ${subject}, check this`,
    subject => `A practical checklist for ${subject}`,
  ],
  conversation_business: [
    subject => `The hidden cost of ${subject}`,
    subject => `What ambitious people get wrong about ${subject}`,
    subject => `How ${subject} can change careers faster than people expect`,
    subject => `The status trap behind ${subject}`,
    subject => `The most common mistake founders make with ${subject}`,
  ],
  conversation_finance: [
    subject => `A practical checklist for ${subject}`,
    subject => `The money mistake families make with ${subject}`,
    subject => `${subject}: habits, risks, and better choices`,
    subject => `What nobody explains clearly about ${subject}`,
    subject => `How to approach ${subject} without making the usual mistakes`,
  ],
  conversation_spiritual: [
    subject => `The beginner mistake when approaching ${subject}`,
    subject => `How to practice ${subject} without losing the meaning`,
    subject => `${subject}: myth, meaning, and modern life`,
    subject => `A practical guide to ${subject} in daily life`,
    subject => `What most people get wrong about ${subject}`,
  ],
  news_event: [
    subject => `What happens next after ${subject}`,
    subject => `${subject}: who benefits and who loses`,
    subject => `The local impact of ${subject}, explained`,
    subject => `${subject}: the timeline viewers need`,
    subject => `The decision behind ${subject} and what changes now`,
  ],
  exam_education: [
    subject => `${subject}: PYQ traps and exam-ready concepts`,
    subject => `${subject}: chapter-wise revision in 10 points`,
    subject => `${subject}: high-yield practice plan for aspirants`,
    subject => `Common mistakes students make in ${subject}`,
    subject => `${subject}: marks-focused revision for the final week`,
  ],
  tech_review: [
    subject => `${subject}: practical test before you buy`,
    subject => `${subject}: real-life verdict after daily use`,
    subject => `How to decide if ${subject} is worth buying`,
    subject => `${subject} vs last year's option: what changed?`,
    subject => `The hidden setting in ${subject} most users miss`,
  ],
  general_education: [
    subject => `The beginner mistake about ${subject}`,
    subject => `How to understand ${subject} from scratch`,
    subject => `What people get wrong about ${subject}`,
    subject => `The complete beginner guide to ${subject}`,
    subject => `What most people get wrong about ${subject}`,
  ],
  gaming_entertainment: [
    subject => `${subject}: one challenge run viewers will want to finish`,
    subject => `Can you win ${subject} using only beginner settings?`,
    subject => `${subject}: the strategy most players miss`,
    subject => `${subject}: risky choices that create the best comeback`,
    subject => `The update in ${subject} that changes how you play`,
  ],
  comedy_sketch: [
    subject => `When ${subject} gets way too real`,
    subject => `${subject}, but it keeps getting worse`,
    subject => `The most relatable ${subject} moment`,
    subject => `Every ${subject} situation, basically`,
    subject => `That one ${subject} moment everyone knows`,
  ],
  travel_lifestyle: [
    subject => `${subject}: the honest budget route`,
    subject => `The overlooked detail in ${subject}`,
    subject => `${subject}: worth it or overhyped?`,
    subject => `The local side of ${subject}`,
    subject => `${subject}: what to skip and what to do instead`,
  ],
  cooking_food: [
    subject => `${subject}: the budget version vs the restaurant version`,
    subject => `Can you make ${subject} at home without shortcuts?`,
    subject => `The ingredient mistake that ruins ${subject}`,
    subject => `A regional twist on ${subject}`,
    subject => `${subject}: quick version for busy days`,
  ],
  fitness_practice: [
    subject => `${subject}: a 7-day routine viewers can actually follow`,
    subject => `The beginner mistake behind ${subject}`,
    subject => `${subject}: what to do, what to avoid, and why`,
    subject => `A no-equipment way to improve ${subject}`,
    subject => `${subject}: a routine for people starting late`,
  ],
  wellness_teaching: [
    subject => `${subject}: the daily practice that makes it practical`,
    subject => `The mindset trap behind ${subject}`,
    subject => `How to test ${subject} for 7 days without overpromising`,
    subject => `${subject}: before and after, explained honestly`,
    subject => `The small habit that changes ${subject}`,
  ],
  spiritual_teaching: [
    subject => `${subject}: the story, meaning, and daily practice`,
    subject => `The most common mistake when learning ${subject}`,
    subject => `A daily guide to ${subject} for beginners`,
    subject => `How to practice ${subject} without confusion`,
    subject => `What most seekers get wrong about ${subject}`,
  ],
  generic: [
    subject => `Why viewers keep coming back to ${subject}`,
    subject => `The practical story behind ${subject}`,
    subject => `What changed in ${subject} and why it matters`,
    subject => `${subject}: a fresh angle from your recent uploads`,
    subject => `The mistake viewers make with ${subject}`,
  ],
};

// ── Phase 5: Winner Template Sets ─────────────────────────────────────────────
// Templates ranked by gold-set win rate. Used by buildWinnerTemplateCandidates()
// to generate from the Creator Identity → Winner Template → Recommendation path.
const WINNER_TEMPLATE_SETS = {
  // CHECKLIST_FORMAT: 57.3% win rate
  instructional_checklist: {
    type: 'CHECKLIST_FORMAT',
    templates: [
      subject => `A practical checklist for ${subject}`,
      subject => `${subject}: what to do, what to avoid, and why`,
      subject => `A simple guide to ${subject} for beginners`,
    ],
  },
  // WAY_TO: 39.1% win rate
  instructional_how_to: {
    type: 'WAY_TO',
    templates: [
      subject => `How to get ${subject} right, step by step`,
      subject => `What nobody explains clearly about ${subject}`,
      subject => `How ${subject} can change your approach`,
    ],
  },
  // MISTAKE_BEHIND: 25.1% win rate
  mistake: {
    type: 'MISTAKE_BEHIND',
    templates: [
      subject => `The beginner mistake behind ${subject}`,
      subject => `What most people get wrong about ${subject}`,
      subject => `The most common mistake with ${subject}`,
    ],
  },
  // DISH_TECHNIQUE: 10.7% win rate (cooking-only, biased by domain specificity)
  challenge_dish: {
    type: 'DISH_TECHNIQUE',
    templates: [
      subject => `Can you make ${subject} at home without shortcuts?`,
      subject => `${subject}: the budget version vs the restaurant version`,
      subject => `The ingredient mistake that ruins ${subject}`,
    ],
  },
  // COLON_EXPLAINER: neutral anchor
  comparison_colon: {
    type: 'COLON_EXPLAINER',
    templates: [
      subject => `${subject}: who benefits and who loses`,
      subject => `${subject}: risk, returns, and what most people miss`,
      subject => `${subject}: worth it or overhyped?`,
    ],
  },
};

// Maps creator content family → ordered list of winner template families to apply.
// Families with proven win rates come first. Generic family is intentionally absent
// (unclassified creators produce 0.8% win rate — no winner templates assigned).
const CREATOR_WINNER_TEMPLATES = {
  cooking_food:           ['challenge_dish', 'mistake', 'instructional_how_to'],
  fitness_practice:       ['instructional_checklist', 'instructional_how_to', 'mistake'],
  finance_education:      ['instructional_checklist', 'instructional_how_to', 'mistake', 'comparison_colon'],
  conversation_business:  ['mistake', 'instructional_how_to'],
  conversation_finance:   ['mistake', 'instructional_checklist', 'comparison_colon'],
  conversation_spiritual: ['mistake', 'instructional_how_to', 'instructional_checklist'],
  general_education:      ['mistake', 'instructional_how_to', 'instructional_checklist'],
  tech_review:            ['comparison_colon', 'mistake'],
  exam_education:         ['mistake', 'instructional_checklist'],
  spiritual_teaching:     ['mistake', 'instructional_how_to', 'instructional_checklist'],
  gaming_entertainment:   ['mistake', 'instructional_how_to'],
  travel_lifestyle:       ['instructional_checklist', 'comparison_colon'],
  wellness_teaching:      ['instructional_checklist', 'instructional_how_to', 'mistake'],
  news_event:             ['comparison_colon'],
  explainer_case:         ['comparison_colon', 'mistake', 'instructional_how_to'],
};

const EXPANSION_TEMPLATES = {
  explainer_case: [
    subject => `The hidden business behind ${subject}`,
    subject => `What people get wrong about ${subject}`,
    subject => `Why ${subject} is harder to fix than it looks`,
    subject => `The uncomfortable truth behind ${subject}`,
    subject => `How ${subject} became part of everyday life`,
  ],
  finance_education: [
    subject => `The beginner mistake inside ${subject}`,
    subject => `A practical checklist for ${subject}`,
    subject => `Before you trust ${subject}, check this`,
    subject => `${subject}: risk, returns, and timing explained simply`,
  ],
  exam_education: [
    subject => `Common mistakes students make in ${subject}`,
    subject => `${subject}: chapter-wise revision in 10 points`,
    subject => `${subject}: high-yield practice plan for aspirants`,
    subject => `${subject}: marks-focused revision for the final week`,
  ],
  conversation_business: [
    subject => `The hidden cost of ${subject}`,
    subject => `What ambitious people get wrong about ${subject}`,
    subject => `The status trap behind ${subject}`,
  ],
  conversation_finance: [
    subject => `The money mistake families make with ${subject}`,
    subject => `What nobody explains clearly about ${subject}`,
    subject => `The honest tradeoff behind ${subject}`,
  ],
  conversation_spiritual: [
    subject => `The deeper pattern behind ${subject}`,
    subject => `${subject}: myth, meaning, and modern life`,
    subject => `The ancient lens on ${subject}`,
  ],
  news_event: [
    subject => `${subject}: who benefits and who loses`,
    subject => `The local impact of ${subject}, explained`,
    subject => `What happens next after ${subject}`,
  ],
  tech_review: [
    subject => `${subject}: practical test before you buy`,
    subject => `Who should actually buy ${subject}?`,
    subject => `The hidden setting in ${subject} most users miss`,
  ],
  general_education: [
    subject => `What people get wrong about ${subject}`,
    subject => `${subject} explained for beginners`,
    subject => `Why ${subject} matters more than it looks`,
  ],
  gaming_entertainment: [
    subject => `${subject}: the strategy most players miss`,
    subject => `The update in ${subject} that changes how you play`,
  ],
  comedy_sketch: [
    subject => `When ${subject} gets way too real`,
    subject => `The most relatable ${subject} moment`,
  ],
  travel_lifestyle: [
    subject => `The overlooked detail in ${subject}`,
    subject => `${subject}: worth it or overhyped?`,
  ],
  cooking_food: [
    subject => `The ingredient mistake that ruins ${subject}`,
    subject => `${subject}: quick version for busy days`,
  ],
  fitness_practice: [
    subject => `The beginner mistake behind ${subject}`,
    subject => `${subject}: what to do, what to avoid, and why`,
  ],
  wellness_teaching: [
    subject => `The mindset trap behind ${subject}`,
    subject => `The small habit that changes ${subject}`,
  ],
  spiritual_teaching: [
    subject => `What ${subject} teaches about modern life`,
    subject => `The simple explanation of ${subject} for beginners`,
  ],
};

function parseRows(rows) {
  return Array.isArray(rows) ? rows : [];
}

function topIds(rows, limit = 10) {
  return parseRows(rows).slice(0, limit).map(row => row.id).filter(Boolean);
}

function topLabels(rows, limit = 10) {
  return parseRows(rows).slice(0, limit).map(row => row.label || row.id).filter(Boolean);
}

function creatorCsp(dna) {
  return String(dna?.stable_dna?.creator_constraints?.csp || '').toLowerCase();
}

function inferFamilyFromCsp(csp) {
  if (!csp) return 'generic';
  if (CSP_FAMILY_MAP[csp]) return CSP_FAMILY_MAP[csp];
  if (csp.includes('finance')) return 'finance_education';
  if (csp.includes('podcast') || csp.includes('conversation') || csp.includes('guest')) return 'conversation_business';
  if (csp.includes('news')) return 'news_event';
  if (csp.includes('exam') || csp.includes('education')) return 'exam_education';
  if (csp.includes('tech') || csp.includes('gadget') || csp.includes('review')) return 'tech_review';
  if (csp.includes('gaming')) return 'gaming_entertainment';
  if (csp.includes('comedy') || csp.includes('late_night') || csp.includes('talk_show') || csp.includes('variety') || csp.includes('entertainment')) return 'comedy_sketch';
  if (csp.includes('travel') || csp.includes('vlog')) return 'travel_lifestyle';
  if (csp.includes('food') || csp.includes('cook')) return 'cooking_food';
  if (csp.includes('fitness') || csp.includes('yoga')) return 'fitness_practice';
  if (csp.includes('wellness')) return 'wellness_teaching';
  if (csp.includes('spiritual')) return 'spiritual_teaching';
  if (csp.includes('explainer') || csp.includes('case_study') || csp.includes('documentary')) return 'explainer_case';
  return 'generic';
}

const DNA_FAMILY_OVERRIDES = [
  {
    family: 'exam_education',
    regex: /\b(upsc|jee|neet|ssc|cbse|icse|class\s*(?:\d{1,2}|x|xi|xii)|board exam|prelims|mains|pyq|mock test|syllabus|revision|current affairs|answer writing|question paper|important question|semester|sem[-\s]?\d|bcom|bbmku|exam preparation)\b/i,
    minRows: 3,
    minHits: 5,
    allowedBaseFamilies: new Set(['generic', 'finance_education', 'general_education']),
  },
];

function inferFamilyOverrideFromDna(dna, currentFamily) {
  const rows = [
    ...parseRows(dna?.micro_topics),
    ...parseRows(dna?.entities),
    ...parseRows(dna?.domain_tags),
    ...parseRows(dna?.thesis_patterns),
    ...parseRows(dna?.hook_templates),
  ];

  for (const rule of DNA_FAMILY_OVERRIDES) {
    if (rule.family === currentFamily) continue;
    if (rule.allowedBaseFamilies && !rule.allowedBaseFamilies.has(currentFamily)) continue;
    let rowsHit = 0;
    let hits = 0;
    for (const row of rows) {
      const text = [
        row?.id,
        row?.label,
        ...(Array.isArray(row?.examples) ? row.examples.slice(0, 4) : []),
      ].filter(Boolean).join(' ');
      const matches = text.match(new RegExp(rule.regex.source, rule.regex.flags.includes('g') ? rule.regex.flags : `${rule.regex.flags}g`)) || [];
      if (matches.length) {
        rowsHit++;
        hits += matches.length;
      }
    }
    if (rowsHit >= rule.minRows && hits >= rule.minHits) {
      return rule.family;
    }
  }
  return null;
}

function originalBetFamily(dna) {
  const csp = creatorCsp(dna);
  const family = inferFamilyFromCsp(csp);
  const overrideFamily = inferFamilyOverrideFromDna(dna, family);
  return {
    csp: csp || 'unknown',
    family: overrideFamily || family,
    family_source: overrideFamily ? 'creator_dna_override' : 'csp',
    base_family: family,
  };
}

function hasAll(set, values) {
  return values.every(value => set.has(value));
}

function hasAny(set, values) {
  return values.some(value => set.has(value));
}

function tokenize(value) {
  return String(value || '')
    .toLowerCase()
    .match(/[a-z][a-z0-9']{2,}/g) || [];
}

const EVIDENCE_STOPWORDS = new Set([
  'about', 'after', 'all', 'and', 'are', 'around', 'behind', 'before', 'can', 'could',
  'better', 'building', 'conversation', 'creator', 'decides', 'different',
  'change', 'changed', 'changes', 'expect', 'expected', 'expects', 'family', 'faster', 'for', 'from', 'had', 'has', 'have', 'hidden', 'his', 'how',
  'india', 'indian', 'indians', 'inside', 'lesson', 'matches', 'most',
  'need', 'needs', 'nobody', 'our', 'people', 'really', 'rethink',
  'more', 'reveals', 'she', 'should', 'signal', 'smart', 'that', 'than', 'the', 'their', 'think', 'this',
  'through', 'tradeoffs', 'understand', 'understands', 'understood', 'upload', 'video', 'was', 'what', 'when',
  'while', 'who', 'with', 'would', 'wrong', 'why', 'you', 'your',
]);

function evidenceTokens(value) {
  return tokenize(value)
    .map(token => token.replace(/'s$/, ''))
    .filter(token => !EVIDENCE_STOPWORDS.has(token));
}

function evidenceOverlapRatio(a, b) {
  const aSet = new Set(evidenceTokens(a));
  const bSet = new Set(evidenceTokens(b));
  if (!aSet.size || !bSet.size) return 0;
  let overlap = 0;
  for (const token of aSet) {
    if (bSet.has(token)) overlap++;
  }
  return overlap / Math.min(aSet.size, bSet.size);
}

function evidenceCoverageRatio(a, b) {
  const aSet = new Set(evidenceTokens(a));
  const bSet = new Set(evidenceTokens(b));
  if (!aSet.size || !bSet.size) return 0;
  let overlap = 0;
  for (const token of aSet) {
    if (bSet.has(token)) overlap++;
  }
  return overlap / aSet.size;
}

function overlapRatio(a, b) {
  const aSet = new Set(tokenize(a));
  const bSet = new Set(tokenize(b));
  if (!aSet.size || !bSet.size) return 0;
  let overlap = 0;
  for (const token of aSet) {
    if (bSet.has(token)) overlap++;
  }
  return overlap / Math.min(aSet.size, bSet.size);
}

function exampleTitleKey(title) {
  return String(title || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function createOriginalBetIdeaKey(channelId, topic) {
  const slug = String(topic || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 90) || 'idea';
  return `${channelId || 'unknown'}:${slug}`;
}

function getOwnTitles(db, channelId) {
  return db.all(
    `SELECT title, views, published_at
       FROM ingested_videos
      WHERE channel_id = ?
        AND title IS NOT NULL
        AND title != ''
      ORDER BY datetime(published_at) DESC
      LIMIT 50`,
    [channelId],
  );
}

function medianViews(rows) {
  const nums = rows
    .map(row => Number(row.views) || 0)
    .filter(v => v > 0)
    .sort((a, b) => a - b);
  if (!nums.length) return 0;
  const mid = Math.floor(nums.length / 2);
  return Math.round(nums.length % 2 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2);
}

const RECENT_COVERAGE_DAYS = 45;

function isTooCloseToExisting(topic, ownTitles) {
  const lower = topic.toLowerCase();
  const nowMs = Date.now();
  return ownTitles.some(row => {
    const title = String(row.title || '').toLowerCase();
    if (title === lower) return true;
    // Uploads from the last 45 days block at a lower overlap threshold —
    // re-suggesting a fresh upload back to the creator is pure noise, while
    // an older near-match can still be a legitimate revisit.
    const ageMs = row.published_at ? nowMs - new Date(row.published_at).getTime() : Infinity;
    const threshold = ageMs <= RECENT_COVERAGE_DAYS * 86400000 ? 0.6 : 0.82;
    return overlapRatio(lower, title) >= threshold;
  });
}

// Romanized-Hindi function / kinship / pronoun words. Not standalone English topics on their
// own; they leak from Hinglish shorts titles ("maa", "dosti", "jis", "papa") and produce
// hollow templates ("The hidden cost of Dosti"). A subject built ENTIRELY from these is junk.
const ROMANIZED_HINDI_STOPWORDS = new Set([
  'maa', 'paa', 'papa', 'mummy', 'beta', 'beti', 'bhai', 'behen', 'didi', 'dada', 'dadi',
  'nana', 'nani', 'jis', 'jise', 'jiska', 'jaisa', 'kya', 'kyu', 'kyun', 'hai', 'tha', 'thi',
  'mera', 'meri', 'mere', 'tera', 'teri', 'apna', 'apni', 'dosti', 'yaar', 'bas', 'sab',
  'kuch', 'wala', 'wali', 'kar', 'karo', 'dekho', 'suno', 'matlab',
]);

function cleanSubject(subject) {
  let cleaned = String(subject || '')
    .replace(/\s+/g, ' ')
    .replace(/[|#].*$/g, '')
    .replace(/[?!;:,.-]+$/g, '')
    .trim();
  cleaned = cleaned
    .replace(/\bwebsites?\s+internet\b/i, 'underrated websites')
    .replace(/\binternet\s+websites?\b/i, 'underrated websites')
    .trim();
  if (!cleaned) return '';
  if (cleaned.length < 3 || cleaned.length > 72) return '';
  if (cleaned.split(/\s+/).length > 8) return '';
  if (/^(shorts?|videos?|episode|episodes|part|full|latest|today|live)$/i.test(cleaned)) return '';
  if (/\b(ft|feat|featuring)\.?\b/i.test(cleaned)) return '';
  if (/\b(channel|[a-z0-9]*channel|official|watch now|today news|khabar|samachar)\b/i.test(cleaned)) return '';
  if (/\b(starring|hosted by|presented by|original series|in conversation with)\b/i.test(cleaned)) return '';
  if (/\b(reaction|reacts|roast|troll|funny moments|try not to laugh)\b/i.test(cleaned)) return '';
  // Underscore: creator handle or username leaked into subject (e.g. "dushyant_kukreja")
  if (/_/.test(cleaned)) return '';
  // Ampersand as topic separator leaked through (e.g. "food &faith")
  if (/&/.test(cleaned)) return '';
  // Multi-slash: multiple topics merged with slash separator (e.g. "art skill/wood hand")
  if (/\//.test(cleaned)) return '';
  // Alphanumeric ID artifacts: letters directly bonded to 3+ digits (e.g. "golu008", "school123")
  if (/[a-z]{2,}\d{3,}|\d{3,}[a-z]{2,}/i.test(cleaned)) return '';
  // Stranded conjunction between nouns: preposition-collapse artifact (e.g. "sight because science")
  if (/\s+(because|since|although|unless|until|whilst|therefore|hence|wherein|whereby)\s+/i.test(cleaned)) return '';
  // Repeated content word in short phrase: extraction artifact (e.g. "gareeb gareeb", "food food")
  const _cWords = cleaned.toLowerCase().split(/\s+/).filter(w => w.length >= 3);
  if (_cWords.length >= 2 && _cWords.length <= 5 && new Set(_cWords).size < _cWords.length) return '';
  // Romanized-Hindi fragment: every significant word is a Hindi function/kinship/pronoun word
  // (e.g. "maa", "dosti", "jis kya") — carries no English topic content.
  const _rhWords = cleaned.toLowerCase().split(/\s+/).filter(Boolean);
  if (_rhWords.length && _rhWords.every(w => ROMANIZED_HINDI_STOPWORDS.has(w))) return '';
  // Regional TV news brand names as subject suffix: likely a channel-name artifact
  if (/\b(etv|tv9|tv5|abp\s*live|wion|news18|republic\s*tv|times\s*now)\s*$/i.test(cleaned)) return '';
  if (/\b(post|posts)$/i.test(cleaned)) return '';
  if (/^it'?s made$/i.test(cleaned)) return '';
  // "Full Movie X" film-dump artifacts from movie-clip channels (e.g. "Full Movie Neil Nitin
  // Mukesh") — an upload-label fragment, not a topic.
  if (/\bfull movie\b/i.test(cleaned)) return '';
  if (/\b(made|works)\s+science$/i.test(cleaned)) return '';
  if (/^(result|say goodbye|hidden spot|next station|biggest|more|most|film|local|need this|question|questions|answer|answers|full video|best|top|model)$/i.test(cleaned)) return '';
  if (/^(result|say goodbye|hidden spot|next station|biggest|more|most|film|local|need this|question|questions|answer|answers)\b/i.test(cleaned)) return '';
  if (/\bquestions?\b/i.test(cleaned)) return '';
  if (/^(paper original|original paper|original model|model paper|sample paper)$/i.test(cleaned)) return '';
  if (/^paper\b/i.test(cleaned)) return '';
  if (/\boriginal\b/i.test(cleaned)) return '';
  if (/^(tamil|hindi|english|telugu|kannada|malayalam|marathi|bengali|odia)\s+medium$/i.test(cleaned)) return '';
  if (/^(rewrote|changed|changes|became|becomes|revealed|reveals|explained|explains|why|how|what|when|where|will|can|should)\b/i.test(cleaned)) return '';
  if (/^(paying|getting|buying|selling|using|making|doing|watching|choosing)\b/i.test(cleaned)) return '';
  if (/^(rent|rented|rental)\s+person\b/i.test(cleaned)) return '';
  if (/^(indians|people|viewers|users|students|brands|creators)\s+(paying|getting|buying|selling|using|making|doing|watching|choosing)\b/i.test(cleaned)) return '';
  if (/^[a-z0-9]+\s+(loves|wants|knows|gives|takes|shows|uses|needs|moves|moved|wiped)\b/i.test(cleaned)) return '';
  if (/^(home|story)$/i.test(cleaned)) return '';
  if (/\bvery\b/i.test(cleaned)) return '';
  // Contraction-collapse artifacts: "Don't eat" → phrase extractor strips apostrophe → "don eat"
  if (/^don'?t?\s+\w/i.test(cleaned)) return '';
  if (/^(won'?t?|can'?t?|isn'?t?|aren'?t?|wasn'?t?|weren'?t?|doesn'?t?|didn'?t?|hasn'?t?|haven'?t?|hadn'?t?|couldn'?t?|wouldn'?t?|shouldn'?t?|mustn'?t?)\b/i.test(cleaned)) return '';
  // Preposition-collapse artifacts: "Chocolates on Earth" → phrase strips "on" → "chocolates earth"
  // Reject multi-word subjects ending in a standalone geographic/cosmic noun that only makes sense
  // after a preposition (e.g., "on earth", "around the world", "under the sea").
  if (cleaned.split(/\s+/).length >= 2 && /\b(earth|world|globe|universe|planet|sky|sea|ocean|space|ground|nature|existence)\s*$/i.test(cleaned)) return '';
  // Title-prefix collapse artifacts: "Beast Games Season 2" → strip brand + number → "games season"
  // Reject compound where a generic category word follows a plural activity/entertainment noun
  if (/\b(games?|shows?|series)\s+(season|episode|part|round|chapter)\s*\d*$/i.test(cleaned)) return '';
  // Stray temporal/continuation adverb: phrase-extraction artifact (e.g. "again stock",
  // "iran again stock"). Never part of a usable subject.
  if (/\b(again|anymore|nowadays|currently|meanwhile|henceforth)\b/i.test(cleaned)) return '';
  // Trailing time-unit artifact from "...in N minutes" titles (e.g. "Wealth Building Secrets Minutes").
  if (cleaned.split(/\s+/).length >= 2 && /\b(minutes?|seconds?|hours?|hrs?|mins?)\s*$/i.test(cleaned)) return '';
  // Universal-quantifier sentence fragments: "every family needs right", "gadgets every
  // family", "everyone wants this" — collapsed clauses yanked from clickbait titles, not topics.
  if (/\b(every|each|everyone|everybody|anyone|nobody|someone)\b/i.test(cleaned)) return '';
  // Trailing stranded qualifier from a truncated phrase ("...needs right [now]" → "right",
  // "...you need today" → "today"). The subject is the tail of a sentence, not a topic.
  if (cleaned.split(/\s+/).length >= 2 &&
      /\b(right|now|today|tonight|soon|already|instead|anymore|too|so|really|just|yet)\s*$/i.test(cleaned)) return '';
  // Single-word generic / UI / meta subjects: produce hollow templates ("The hidden cost of Comment",
  // "The status trap behind Heartbreak"). A bare abstract/meta noun has no filmable angle.
  if (cleaned.split(/\s+/).length === 1 &&
      /^(warning|comment|share|like|subscribe|podcast|heartbreak|surprise|update|prank|vlog|trailer|teaser|promo|announcement|giveaway|recap|reaction|story|drama|fight|beef|controversy|apology|statement|clarification|response|truth|exposed|revealed|secret|secrets|mystery|shocking|viral|trending|comeback|collab|collaboration)$/i.test(cleaned)) return '';
  return cleaned;
}

function isBoostedSubject(family, subject) {
  const boosts = FAMILY_SUBJECT_BOOSTS[family] || FAMILY_SUBJECT_BOOSTS.generic;
  return boosts.some(rx => rx.test(subject));
}

function prefersStableDefaultSubjects(family) {
  return ['generic', 'cooking_food', 'travel_lifestyle', 'fitness_practice', 'wellness_teaching'].includes(family);
}

function isConversationFamily(family) {
  return ['conversation_business', 'conversation_finance', 'conversation_spiritual'].includes(family);
}

function subjectKey(subject) {
  // Unicode-aware: keep letters/numbers of ANY script so native-script subjects produce a
  // distinct non-empty key (the old [^a-z0-9] stripped them to '' → every native subject
  // collided/was rejected as empty). Latin behaviour is unchanged.
  return String(subject || '')
    .toLowerCase()
    .replace(/\b(ft|feat|featuring)\.?\b/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// A subject is "native script" when its non-Latin letters dominate — these are legitimate
// in-language topics the English-keyword gates can't evaluate (and are never the romanized
// Hindi function-word junk those gates target), so they're exempted from the focus-word rule.
const NATIVE_SUBJECT_RE = /[ऀ-ॿঀ-ൿ฀-๿؀-ۿ一-鿿぀-ヿ가-힣]/g;
function isNativeScriptSubject(s) {
  const str = String(s || '');
  const native = (str.match(NATIVE_SUBJECT_RE) || []).length;
  if (!native) return false;
  const latin = (str.match(/[a-z]/gi) || []).length;
  return native >= latin;
}

function isGenericPlaceholderSubject(subject) {
  const key = subjectKey(subject);
  return GENERIC_PLACEHOLDER_SUBJECTS.has(key) ||
    /\b(your audience problem|recent upload theme|viewer confusion|fresh viewer question)\b/i.test(String(subject || ''));
}

function isBroadIdentitySubject(subject) {
  const key = subjectKey(subject);
  if (!key) return true;
  if (/^(india|indian|indians|bharat|people|life|society|world|country|culture|local)$/.test(key)) return true;
  if (/^(building in india|indian consumer behavior|normal life|daily life)$/.test(key)) return true;
  return false;
}

const SUBJECT_FOCUS_RE = /\b(founder|startups?|business|career|leadership|wealth|consumer|profit|scale|money|salary|work|job|office|skill|communication|discipline|anxiety|society|markets?|finance|spending|growth|pressure|ambition|creator|internet|policy|health|fitness|food|travel|place|spiritual|sadhana|history|science|technology|china|kenya|kashi|dwarka|news|war|election|politics?|education|economy|investment|stocks?|banking|economy|culture|entertainment|media|gaming|sports?|cricket|football|basketball|movies?|films?|comedy|drama|recipe|cooking|restaurant|startup|budget|economy|current|affairs|exam|government|social|security|environment|inflation|innovation|research|medical|legal|career|productivity|mindset|creative|photography|editing|design|branding|marketing|revenue|industry|infrastructure|urban|rural|community|leadership)\b/i;

function isLikelyGuestNameSubject(subject) {
  const key = subjectKey(subject);
  if (!key) return true;
  if (/\b(ft|feat|featuring)\b/i.test(String(subject || ''))) return true;
  if (SUBJECT_FOCUS_RE.test(key)) return false;
  const words = key.split(' ').filter(Boolean);
  if (words.length >= 2 && words.length <= 4 && words.every(w => /^[a-z]+$/.test(w))) {
    return true;
  }
  return false;
}

function acceptOriginalBetSubject(family, subject, source) {
  const key = subjectKey(subject);
  if (!key) return false;
  if (isGenericPlaceholderSubject(subject)) return false;
  if (/^(shorts?|videos?|episode|episodes|part|full|latest|today|live)$/.test(key)) return false;
  if (/\b(ft|feat|featuring)\.?\b/i.test(String(subject || ''))) return false;
  if (/\b(ft|feat|featuring)\b/.test(key)) return false;
  // Native-script subjects bypass the English-keyword gates below (guest-name + focus-word):
  // those gates can't read native script and would reject every legitimate in-language topic.
  const nativeScript = isNativeScriptSubject(subject);
  // Strong named entity: a multi-word proper noun from the entity extractor (show/movie/game/
  // brand names like "Kundali Bhagya", "Kings League", "Navvule Navvulu") IS the creator's real
  // subject, but lacks a generic English domain word so the focus-word gate wrongly drops it.
  // Distinguished from the romanized-Hindi junk those gates target by: entity source (capitalized
  // proper noun, not a micro fragment), 2-4 words, and NOT majority Hindi function-words. Excluded
  // for conversation families (there a 2-word proper noun is usually a podcast guest, not a topic).
  const _ewords = key.split(' ').filter(Boolean);
  const _rhStop = _ewords.filter(w => ROMANIZED_HINDI_STOPWORDS.has(w)).length;
  // Exclude CTA / format / calendar fragments that the entity extractor sometimes captures
  // ("Subscribe To See", "Zebra Subscribe", "Reel Jun") — they are not real subjects.
  const _entityMeta = /\b(subscribe|like|comment|share|channel|watch|follow|link|bio|reel|reels|episode|episodes|ep|teaser|promo|trailer|shorts?|videos?|live|full|latest|part|season|jukebox|jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec)\b/i;
  const strongEntity = source === 'entity' && _ewords.length >= 2 && _ewords.length <= 4 &&
    _rhStop <= Math.floor(_ewords.length / 2) && !_entityMeta.test(key) && !isConversationFamily(family);
  if (!nativeScript && !strongEntity && source === 'entity' && isLikelyGuestNameSubject(subject)) return false;
  if (!nativeScript && source === 'micro' && isConversationFamily(family) && isLikelyGuestNameSubject(subject)) return false;
  if (!nativeScript && !strongEntity && source !== 'default' && prefersStableDefaultSubjects(family) && !isBoostedSubject(family, subject) && !SUBJECT_FOCUS_RE.test(key)) return false;
  // For micro/entity sources in non-stable-default families, require at least one English
  // domain signal word (a family boost OR SUBJECT_FOCUS_RE). This rejects Hindi/regional
  // fragments (e.g. "papa gareebi", "Dosti", "Maa", "Jis", "Buy") that pass cleanSubject()
  // structurally but carry no usable content signal. Conversation families ARE included now —
  // their curated subjects come via source='default' (exempt above) and real business/finance/
  // spiritual micro-topics still pass via the family boost regex or SUBJECT_FOCUS_RE.
  if ((source === 'micro' || source === 'entity') &&
      !nativeScript &&
      !strongEntity &&
      !prefersStableDefaultSubjects(family) &&
      !isBoostedSubject(family, subject) &&
      !SUBJECT_FOCUS_RE.test(key)) {
    return false;
  }
  return true;
}

function pushUniqueSubject(out, seen, subject) {
  const cleaned = cleanSubject(subject);
  const key = cleaned.toLowerCase();
  if (!cleaned || seen.has(key)) return;
  seen.add(key);
  out.push(cleaned);
}

const INDIA_SUBJECT_RE = /\b(india|indian|indians|bharat|upsc|jee|neet|sensex|nifty|rupee|lakh|crore|emi|hindi)\b/i;

// #(b) Topic diversity: a channel's DNA signals often cluster on one subject (Preity →
// all "hair"), so every candidate becomes that subject. Interleave by shared-word cluster
// (best-of-each-cluster first) so the limited subject pool spans the creator's range.
function _obSigWords(s) {
  return [...new Set(String(s || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length >= 4))];
}
function _clusterInterleave(subjects, keyFn = (x) => x, maxPerCluster = Infinity) {
  if (!Array.isArray(subjects) || subjects.length <= 2) return subjects;
  const w2c = {}; const clusters = [];
  for (const s of subjects) {
    const words = _obSigWords(keyFn(s)); let cid = null;
    for (const w of words) if (w in w2c) { cid = w2c[w]; break; }
    if (cid == null) { cid = clusters.length; clusters.push([]); }
    clusters[cid].push(s);
    for (const w of words) if (!(w in w2c)) w2c[w] = cid;
  }
  if (clusters.length <= 1 && maxPerCluster === Infinity) return subjects;
  // Round-robin: best of each cluster, then 2nd of each. maxPerCluster caps how many a
  // cluster contributes — collapses near-duplicate variants (Preity's 7 "hair growth"
  // phrasings → 2 distinct angles) and gives multi-topic channels real spread.
  const out = [];
  const rounds = Math.min(maxPerCluster, Math.max(...clusters.map(c => c.length)));
  for (let i = 0; i < rounds; i++) {
    for (const c of clusters) if (c[i] !== undefined) out.push(c[i]);
  }
  return out;
}

function familySubjectPool(family, domains, microTopics, entities, options = {}) {
  const isIndian = options.isIndian !== false && options.isIndian !== undefined
    ? Boolean(options.isIndian)
    : true; // default conservative — only filter when explicitly false
  const defaults = (family === 'generic' ? [] : (FAMILY_DEFAULT_SUBJECTS[family] || []))
    .filter(s => isIndian || !INDIA_SUBJECT_RE.test(s));
  const genericDefaults = [];
  const domainSubjects = [];
  for (const domain of domains) {
    const base = (DOMAIN_SUBJECTS[domain] || []).filter(s => isIndian || !INDIA_SUBJECT_RE.test(s));
    const inSupplement = isIndian ? (DOMAIN_SUBJECTS[`${domain}_IN`] || []) : [];
    domainSubjects.push(...base, ...inSupplement);
  }
  const seen = new Set();
  const out = [];
  const microSubjects = microTopics
    .map(cleanSubject)
    .filter(subject => subject && acceptOriginalBetSubject(family, subject, 'micro'));
  const entitySubjects = entities
    .map(cleanSubject)
    .filter(subject => subject && acceptOriginalBetSubject(family, subject, 'entity'));
  const signalSubjects = [...microSubjects, ...entitySubjects];
  const focusedSignals = signalSubjects.filter(subject => !isBroadIdentitySubject(subject));
  const broadSignals = signalSubjects.filter(subject => isBroadIdentitySubject(subject));
  const boostedSignals = _clusterInterleave(focusedSignals.filter(subject => isBoostedSubject(family, subject)));
  const otherSignals = _clusterInterleave(focusedSignals.filter(subject => !isBoostedSubject(family, subject)));

  for (const subject of boostedSignals) pushUniqueSubject(out, seen, subject);
  if (family === 'news_event') {
    for (const subject of defaults) pushUniqueSubject(out, seen, subject);
    for (const subject of otherSignals) pushUniqueSubject(out, seen, subject);
  } else if (isConversationFamily(family)) {
    for (const subject of defaults) pushUniqueSubject(out, seen, subject);
    for (const subject of domainSubjects) pushUniqueSubject(out, seen, subject);
    for (const subject of otherSignals) pushUniqueSubject(out, seen, subject);
    for (const subject of broadSignals.slice(0, 1)) pushUniqueSubject(out, seen, subject);
  } else if (prefersStableDefaultSubjects(family)) {
    for (const subject of defaults) pushUniqueSubject(out, seen, subject);
    for (const subject of domainSubjects) pushUniqueSubject(out, seen, subject);
    for (const subject of otherSignals) pushUniqueSubject(out, seen, subject);
    for (const subject of broadSignals.slice(0, 1)) pushUniqueSubject(out, seen, subject);
  } else {
    for (const subject of otherSignals) pushUniqueSubject(out, seen, subject);
    for (const subject of defaults) pushUniqueSubject(out, seen, subject);
    for (const subject of broadSignals.slice(0, 2)) pushUniqueSubject(out, seen, subject);
  }
  for (const subject of family === 'explainer_case' ? domainSubjects : domainSubjects.slice(0, 6)) {
    pushUniqueSubject(out, seen, subject);
  }
  for (const subject of genericDefaults) pushUniqueSubject(out, seen, subject);
  return out;
}

function evidenceExamples(dna, ownTitles, limit = 3) {
  return collectEvidenceCandidates(dna, ownTitles)
    .slice(0, limit)
    .map(item => ({ title: item.title, views: item.views }));
}

function collectEvidenceCandidates(dna, ownTitles) {
  const rows = [
    ...parseRows(dna.domain_tags),
    ...parseRows(dna.thesis_patterns),
    ...parseRows(dna.hook_templates),
    ...parseRows(dna.micro_topics),
    ...parseRows(dna.entities),
  ];
  const ownByTitle = new Map();
  for (const row of ownTitles || []) {
    const key = exampleTitleKey(row.title);
    if (key) ownByTitle.set(key, row);
  }

  const byTitle = new Map();
  for (const row of rows) {
    for (const title of row.examples || []) {
      const key = exampleTitleKey(title);
      if (!key) continue;
      const match = ownByTitle.get(key);
      const existing = byTitle.get(key) || {
        key,
        title,
        views: Number(match?.views || 0),
        signalText: '',
        fromDna: true,
      };
      existing.views = Math.max(existing.views, Number(match?.views || 0));
      existing.signalText = [
        existing.signalText,
        row.id,
        row.label,
      ].filter(Boolean).join(' ');
      byTitle.set(key, existing);
    }
  }

  for (const row of ownTitles || []) {
    const key = exampleTitleKey(row.title);
    if (!key || byTitle.has(key)) continue;
    byTitle.set(key, {
      key,
      title: row.title,
      views: Number(row.views || 0),
      signalText: '',
      fromDna: false,
    });
  }

  return [...byTitle.values()];
}

function evidenceExamplesForCandidate(dna, ownTitles, candidate, usedExampleKeys, limit = 2) {
  const pool = collectEvidenceCandidates(dna, ownTitles);
  const minTitleCoverage = candidate?.archetype === 'combo' ? 0.18 : 0.25;
  const candidateText = [
    candidate.topic,
    candidate.subject,
  ].filter(Boolean).join(' ');

  const scored = pool
    .filter(item => item.title && !usedExampleKeys.has(item.key))
    .map(item => {
      const titleOverlap = evidenceOverlapRatio(candidateText, item.title);
      const signalOverlap = evidenceOverlapRatio(candidateText, item.signalText);
      const titleCoverage = evidenceCoverageRatio(candidateText, item.title);
      const signalCoverage = evidenceCoverageRatio(candidateText, item.signalText);
      const viewNudge = Math.min(0.08, Math.log10(Number(item.views || 0) + 1) / 100);
      const dnaNudge = item.fromDna ? 0.04 : 0;
      return {
        ...item,
        titleOverlap,
        signalOverlap,
        titleCoverage,
        signalCoverage,
        score: (titleCoverage * 1.15) + (signalCoverage * 0.8) + (titleOverlap * 0.25) + viewNudge + dnaNudge,
      };
    })
    .filter(item => item.titleCoverage >= minTitleCoverage)
    .sort((a, b) => b.score - a.score || b.views - a.views);

  const examples = scored.slice(0, limit).map(item => ({
    title: item.title,
    views: Number(item.views || 0),
  }));
  for (const ex of examples) {
    usedExampleKeys.add(exampleTitleKey(ex.title));
  }
  return examples;
}

function broadTopicKey(topic) {
  const key = subjectKey(topic);
  if (/\b(india|indian|indians|bharat)\b/.test(key)) return 'india';
  return null;
}

function rowEvidenceTitles(row) {
  return (Array.isArray(row?.examples) ? row.examples : [])
    .map(title => String(title || '').trim())
    .filter(Boolean);
}

function evidenceRowCount(rows) {
  return parseRows(rows).filter(row => rowEvidenceTitles(row).length > 0).length;
}

function concreteDnaSubjects(dna, family) {
  const out = [];
  const seen = new Set();
  function add(row, source) {
    const label = cleanSubject(row?.label || row?.id || '');
    const key = subjectKey(label);
    if (!label || !key || seen.has(key)) return;
    if (!acceptOriginalBetSubject(family, label, source)) return;
    if (isBroadIdentitySubject(label)) return;
    seen.add(key);
    out.push({
      subject: label,
      source,
      score: Number(row?.score || 0),
      evidence_count: rowEvidenceTitles(row).length,
    });
  }
  for (const row of parseRows(dna.micro_topics)) add(row, 'micro');
  for (const row of parseRows(dna.entities)) add(row, 'entity');
  return out;
}

function assessDnaSpecificity(dna, { family, csp, subjects, ownTitles } = {}) {
  const sampleCount = Number(dna.sample_count || 0);
  const confidenceScore = Number(dna.confidence_score || 0);
  const domainEvidenceRows = evidenceRowCount(dna.domain_tags);
  const thesisEvidenceRows = evidenceRowCount(dna.thesis_patterns);
  const hookEvidenceRows = evidenceRowCount(dna.hook_templates);
  const concreteSubjects = concreteDnaSubjects(dna, family);
  const evidenceCandidates = collectEvidenceCandidates(dna, ownTitles || [])
    .filter(item => item.fromDna && item.title);
  const uniqueEvidenceKeys = new Set(evidenceCandidates.map(item => item.key).filter(Boolean));
  const placeholderSubjects = (subjects || []).filter(isGenericPlaceholderSubject).length;
  const isGenericFamily = family === 'generic' || csp === 'unclassified_low_signal' || !csp || csp === 'unknown';

  const reasons = [];
  let score = 0;
  score += Math.min(12, Math.floor(sampleCount / 4));
  score += Math.min(15, Math.round(confidenceScore * 15));
  score += Math.min(25, concreteSubjects.length * 7);
  score += Math.min(15, domainEvidenceRows * 4);
  score += Math.min(15, thesisEvidenceRows * 4);
  score += Math.min(8, hookEvidenceRows * 2);
  score += Math.min(18, uniqueEvidenceKeys.size * 2);

  if (isGenericFamily) {
    score -= 18;
    reasons.push('generic_or_unclassified_family');
    if (concreteSubjects.length < 3) {
      score -= 20;
      reasons.push('not_enough_concrete_subjects');
    }
    if (uniqueEvidenceKeys.size < 4) {
      score -= 12;
      reasons.push('not_enough_dna_evidence');
    }
  }

  if (placeholderSubjects > 0) {
    score -= Math.min(25, placeholderSubjects * 8);
    reasons.push('placeholder_subjects_present');
  }

  score = Math.max(0, Math.min(100, Math.round(score)));

  let status = 'insufficient';
  if (isGenericFamily) {
    if (score >= 70 && concreteSubjects.length >= 3 && uniqueEvidenceKeys.size >= 4) status = 'ready';
    else if (score >= 60 && concreteSubjects.length >= 2 && uniqueEvidenceKeys.size >= 3) status = 'limited';
  } else if (score >= 65 && uniqueEvidenceKeys.size >= 2 && (concreteSubjects.length >= 1 || domainEvidenceRows >= 2)) {
    status = 'ready';
  } else if (score >= 50 && uniqueEvidenceKeys.size >= 2) {
    status = 'limited';
  }

  if (status === 'insufficient' && !reasons.length) {
    if (uniqueEvidenceKeys.size < 2) reasons.push('not_enough_dna_evidence');
    if (concreteSubjects.length < 1) reasons.push('not_enough_concrete_subjects');
    if (score < 50) reasons.push('specificity_score_too_low');
  }

  return {
    status,
    score,
    family,
    csp,
    concrete_subject_count: concreteSubjects.length,
    concrete_subjects: concreteSubjects.slice(0, 8),
    dna_evidence_count: uniqueEvidenceKeys.size,
    domain_evidence_rows: domainEvidenceRows,
    thesis_evidence_rows: thesisEvidenceRows,
    hook_evidence_rows: hookEvidenceRows,
    sample_count: sampleCount,
    confidence_score: confidenceScore,
    reasons: [...new Set(reasons)],
  };
}

function qualityTier(score) {
  if (score >= 84) return 'excellent';
  if (score >= 70) return 'usable';
  if (score >= 58) return 'weak';
  return 'rejected';
}

function newQualityGateStats() {
  return {
    evaluated: 0,
    accepted: 0,
    rejected: 0,
    selected: 0,
    candidate_tiers: {
      excellent: 0,
      usable: 0,
      weak: 0,
      rejected: 0,
    },
    selected_tiers: {
      excellent: 0,
      usable: 0,
      weak: 0,
      rejected: 0,
    },
    rejection_reasons: {},
  };
}

function recordQualityRejection(stats, reason) {
  if (!stats || !reason) return;
  stats.rejected++;
  stats.rejection_reasons[reason] = (stats.rejection_reasons[reason] || 0) + 1;
}

function countBroadIdentityEvidence(dna, broadKey) {
  if (broadKey !== 'india') return 0;
  const rows = [
    ...parseRows(dna?.domain_tags),
    ...parseRows(dna?.thesis_patterns),
    ...parseRows(dna?.hook_templates),
    ...parseRows(dna?.micro_topics),
    ...parseRows(dna?.entities),
  ];
  let hits = 0;
  for (const row of rows) {
    const text = [
      row?.id,
      row?.label,
      ...(Array.isArray(row?.examples) ? row.examples.slice(0, 5) : []),
    ].filter(Boolean).join(' ');
    if (/\b(india|indian|indians|bharat)\b/i.test(text)) hits++;
  }
  return hits;
}

function hasIndianCreatorContext(dna) {
  const constraints = dna?.stable_dna?.creator_constraints || {};
  const text = [
    constraints.region,
    constraints.language,
    constraints.content_language,
    constraints.audience_geo,
    constraints.country,
  ].filter(Boolean).join(' ').toLowerCase();
  return /\b(in|india|indian|hi|hindi|hinglish|ta|te|bn|mr|gu|kn|ml|pa|or|odia|bhojpuri)\b/i.test(text);
}

function maxBroadTopicRepeats(family, dna, broadKey, csp) {
  if (!broadKey) return Infinity;
  if (isConversationFamily(family)) return 1;
  const evidenceHits = countBroadIdentityEvidence(dna, broadKey);
  const cspText = String(csp || '').toLowerCase();
  const indiaContext = hasIndianCreatorContext(dna);
  const indiaNativeFamily = family === 'explainer_case' || cspText.includes('indian') || cspText.includes('business_case_study');
  if (indiaContext && indiaNativeFamily && evidenceHits >= 4) return 3;
  if (indiaContext && indiaNativeFamily && evidenceHits >= 2) return 2;
  if (indiaContext && evidenceHits >= 6) return 2;
  return 1;
}

function archetypePriority(archetype) {
  if (archetype === 'combo') return 3;
  if (archetype === 'template') return 2;
  if (String(archetype || '').startsWith('family:')) return 1;
  return 0;
}

// Generic abstract head nouns: a subject whose head is one of these (and which carries
// no concrete anchor — number, named entity, tangible object) produces hollow templates
// ("What most people get wrong about energy demand", "The beginner mistake behind Term
// Wealth"). The June 2026 graded baseline showed these are the dominant Garbage driver,
// while winners had concrete subjects (abs workout, India's AC addiction). Deliberately
// EXCLUDES concrete-but-noun-final heads (workout, pain, addiction, recipe) to protect them.
const ABSTRACT_HEAD_NOUNS = new Set([
  'wealth', 'demand', 'credit', 'budget', 'behavior', 'behaviour', 'mindset', 'strategy',
  'growth', 'success', 'failure', 'value', 'values', 'impact', 'potential', 'opportunity',
  'thing', 'things', 'way', 'ways', 'tip', 'tips', 'idea', 'ideas', 'concept', 'concepts',
  'approach', 'system', 'systems', 'level', 'levels', 'factor', 'factors', 'aspect', 'aspects',
  'situation', 'matter', 'point', 'basics', 'fundamentals', 'importance', 'significance',
  'meaning', 'power', 'journey', 'lesson', 'lessons', 'knowledge', 'wisdom', 'principle',
  'principles', 'quality', 'process', 'method', 'methods', 'goal', 'goals', 'plan', 'plans',
  'option', 'options', 'choice', 'choices', 'decision', 'decisions', 'income', 'expense',
  'expenses', 'savings', 'returns', 'profit', 'profits',
]);

function isGenericAbstractSubject(subject) {
  const key = subjectKey(subject);
  const words = key.split(' ').filter(Boolean);
  if (!words.length || words.length > 3) return false;  // only short phrases collapse to hollow
  if (/\d/.test(key)) return false;                     // a number is a concrete anchor
  return ABSTRACT_HEAD_NOUNS.has(words[words.length - 1]);
}

// Finance/stakes-coded colon frames ("X: who benefits and who loses", "X: risk, returns,
// and what most people miss", "Who really makes money from X"). These read as investing /
// news analysis; stamped onto a crafts, travel, food, fitness, etc. subject they are a
// voice/concept mismatch. Only finance/news/business/explainer families may use them.
const FINANCE_STAKES_FRAME_RE = /:\s*(who benefits and who loses|risk,\s*returns)|:\s*habits,\s*risks|^who really makes money from\b/i;
const FINANCE_FRAME_FAMILIES = new Set([
  'finance_education', 'conversation_finance', 'conversation_business', 'news_event', 'explainer_case',
]);

function titleQualityIssues(topic, candidate, family) {
  const issues = [];
  const title = String(topic || '').trim();
  const key = subjectKey(title);
  const words = key.split(' ').filter(Boolean);
  const subject = String(candidate?.subject || '').trim();
  const subjectWords = subjectKey(subject).split(' ').filter(Boolean);

  if (!title) issues.push({ type: 'empty_title', severity: 'hard' });
  if (words.length < 4) issues.push({ type: 'too_short', severity: 'soft' });
  if (words.length > 16) issues.push({ type: 'too_long', severity: 'soft' });
  if (/\b(ft|feat|featuring)\.?\b/i.test(title)) issues.push({ type: 'guest_fragment', severity: 'hard' });
  if (/\b(channel|official|watch now|today news|khabar|samachar)\b/i.test(title)) issues.push({ type: 'channelish', severity: 'hard' });
  if (/\b(your audience problem|recent upload theme|viewer confusion|fresh viewer question)\b/i.test(title)) issues.push({ type: 'placeholder', severity: 'hard' });
  if (/\b(question|questions|answer|answers)\b/i.test(title)) issues.push({ type: 'question_fragment', severity: 'hard' });
  if (/\b(game very|say goodbye|need this|hidden spot|next station|film kala|pinkyteluguchannel)\b/i.test(title)) issues.push({ type: 'noisy_fragment', severity: 'hard' });
  if (/^(story|result|more|most|local|best|top|model)\b/i.test(title)) issues.push({ type: 'low_signal_start', severity: 'hard' });
  if (/\b(is|are|was|were)\s+(doing|becoming)\b/i.test(title)) issues.push({ type: 'awkward_grammar', severity: 'hard' });
  if (/\b(india|indian|indians|bharat)\b.*\bin india\b/i.test(title)) issues.push({ type: 'duplicated_country_phrase', severity: 'hard' });
  if (/\bwebsites?\s+internet\b/i.test(title) || /\binternet\s+websites?\b/i.test(title)) issues.push({ type: 'stacked_noun_fragment', severity: 'hard' });
  if (/\brent person\b/i.test(title)) issues.push({ type: 'rent_person_fragment', severity: 'hard' });
  if (/[,:-]\s*$/.test(title)) issues.push({ type: 'dangling_punctuation', severity: 'hard' });
  if (/^(why|how|what|who|when|where)\s*$/i.test(title)) issues.push({ type: 'empty_hook', severity: 'hard' });
  if (/^why\s+[a-z]+ing\s/i.test(title)) issues.push({ type: 'awkward_hook_subject', severity: 'hard' });
  if (/\b(indians|people|viewers|users|students|brands|creators)\s+(paying|getting|buying|selling|using|making|doing|watching|choosing)\b/i.test(title)) {
    issues.push({ type: 'audience_gerund_fragment', severity: 'hard' });
  }
  if (/\babout\s+[a-z0-9]+\s+(loves|wants|knows|gives|takes|shows|uses|needs|moves|moved|wiped)\b/i.test(title)) {
    issues.push({ type: 'verb_fragment_subject', severity: 'hard' });
  }
  if (/^(why|how|what|who)\s+[a-z]/.test(title) && !/^(why|how|what|who)\s+(your|every|people|brands|viewers|students|creators|founders|india|indian|indians)\b/i.test(title)) {
    issues.push({ type: 'awkward_lowercase_hook', severity: 'soft' });
  }
  if (isGenericPlaceholderSubject(subject)) issues.push({ type: 'placeholder_subject', severity: 'hard' });
  if (subjectWords.length === 1 && /^(india|indian|people|life|society|world|model|story|paper|exam)$/i.test(subject)) {
    issues.push({ type: 'overbroad_subject', severity: 'soft' });
  }
  if (family === 'generic' && isBroadIdentitySubject(subject)) {
    issues.push({ type: 'generic_broad_subject', severity: 'soft' });
  }
  if (isGenericAbstractSubject(subject)) {
    issues.push({ type: 'generic_abstract_subject', severity: 'soft' });
  }

  // Gaming-template artifact phrases: produced when gaming family templates are applied
  // to non-gaming subjects (e.g., food nouns). These phrases are only grammatically valid
  // in a gaming context; their presence in any other context is a generation failure.
  const GAMING_ARTIFACT_PATTERNS = [
    /\bchanges how you play\b/i,
    /\busing only beginner settings\b/i,
    /\bstrategy most players? miss\b/i,
    /\bone challenge run viewers? will want to finish\b/i,
    /\brisky choices that create the best comeback\b/i,
    /\bthe update in\b.*\bthat changes\b/i,
  ];
  // Known semantically-invalid recommendation patterns across all families
  const MALFORMED_PHRASE_PATTERNS = [
    /\b\w+\s+\w+\s+(that changes how|that changes the way)\b/i,   // "chocolates earth that changes how"
    /\bwin\s+\w+\s+\w+\s+using\b/i,                               // "win chocolates earth using"
    /\b(don|dont)\s+(eat|try|watch|play|read)\b/i,                // contraction collapse in title
  ];
  for (const pat of GAMING_ARTIFACT_PATTERNS) {
    if (pat.test(title)) { issues.push({ type: 'gaming_template_artifact', severity: 'hard' }); break; }
  }
  for (const pat of MALFORMED_PHRASE_PATTERNS) {
    if (pat.test(title)) { issues.push({ type: 'malformed_phrase', severity: 'hard' }); break; }
  }

  // Finance/stakes frame applied outside a finance/news/business context (e.g. a travel or
  // crafts subject getting "X: who benefits and who loses") — a concept/voice mismatch.
  if (FINANCE_STAKES_FRAME_RE.test(title) && !FINANCE_FRAME_FAMILIES.has(family)) {
    issues.push({ type: 'frame_concept_mismatch', severity: 'hard' });
  }

  return issues;
}

function hookQualityScore(topic) {
  const title = String(topic || '').trim();
  let score = 0;
  if (/^(why|how|what|who)\b/i.test(title)) score += 8;
  if (/^(the hidden|the real|the trap|the myth|the uncomfortable|the future|the beginner|common mistakes)\b/i.test(title)) score += 8;
  if (/\b(hidden|scam|trap|mistake|myth|tradeoff|business|system|cost|risk|future|practical|checklist)\b/i.test(title)) score += 6;
  if (/[?]$/.test(title)) score += 3;
  if (/:/.test(title)) score += 2;
  return Math.min(18, score);
}

function titlePatternKey(topic) {
  const key = subjectKey(topic);
  if (/^common mistakes students make/.test(key)) return 'common_mistakes_students';
  if (/^the hidden business behind/.test(key)) return 'hidden_business';
  if (/^who really makes money from/.test(key)) return 'who_makes_money';
  if (/^why .+ matters more than it looks$/.test(key)) return 'why_matters_more';
  if (/^why .+ now wants/.test(key)) return 'why_now_wants';
  if (/^why /.test(key)) return 'why';
  if (/^how /.test(key)) return 'how';
  if (/^what /.test(key)) return 'what';
  const colonIndex = String(topic || '').indexOf(':');
  if (colonIndex > 0) return `colon:${subjectKey(String(topic).slice(colonIndex + 1)).split(' ').slice(0, 3).join('_')}`;
  return key.split(' ').slice(0, 3).join('_') || 'unknown';
}

function evidenceQualityScore(topic, candidate, evidence) {
  const candidateText = [topic, candidate?.subject].filter(Boolean).join(' ');
  const overlaps = (evidence || []).map(ex => evidenceOverlapRatio(candidateText, ex.title));
  const coverages = (evidence || []).map(ex => evidenceCoverageRatio(candidateText, ex.title));
  const bestOverlap = overlaps.length ? Math.max(...overlaps) : 0;
  const avgOverlap = overlaps.length
    ? overlaps.reduce((sum, value) => sum + value, 0) / overlaps.length
    : 0;
  const bestCoverage = coverages.length ? Math.max(...coverages) : 0;
  const avgCoverage = coverages.length
    ? coverages.reduce((sum, value) => sum + value, 0) / coverages.length
    : 0;
  const bestViews = Math.max(0, ...(evidence || []).map(ex => Number(ex.views || 0)));
  const evidenceCountScore = Math.min(16, (evidence || []).length * 8);
  const overlapScore = Math.min(20, Math.round((bestCoverage * 26) + (avgCoverage * 14) + (bestOverlap * 4)));
  const viewScore = Math.min(6, Math.log10(bestViews + 1));
  return {
    score: Math.round(evidenceCountScore + overlapScore + viewScore),
    best_overlap: +bestOverlap.toFixed(3),
    avg_overlap: +avgOverlap.toFixed(3),
    best_coverage: +bestCoverage.toFixed(3),
    avg_coverage: +avgCoverage.toFixed(3),
    best_views: bestViews,
  };
}

function assessOriginalBetCandidateQuality(candidate, evidence, dna, { family, csp, specificity, index } = {}) {
  const topic = String(candidate?.topic || '').trim();
  const issues = titleQualityIssues(topic, candidate, family);
  const hardIssue = issues.find(issue => issue.severity === 'hard');
  const evidenceMetrics = evidenceQualityScore(topic, candidate, evidence);
  const confidenceScore = Number(dna?.confidence_score || 0);
  const specificityScore = Number(specificity?.score || 0);
  const familyFit = isBoostedSubject(family, candidate?.subject || topic) ? 8 : 0;
  const comboBoost = candidate?.archetype === 'combo' ? 20 : candidate?.archetype === 'template' ? 8 : 0;
  const titleScore = Math.max(0, 24 - (issues.filter(issue => issue.severity === 'soft').length * 6)) + hookQualityScore(topic);
  const dnaScore = Math.min(11, Math.round(confidenceScore * 6) + Math.round(specificityScore / 20));
  const recencyOrderPenalty = Math.min(8, Math.floor(Number(index || 0) / 8));

  let score = 30 + titleScore + evidenceMetrics.score + dnaScore + familyFit + comboBoost - recencyOrderPenalty;
  for (const issue of issues) {
    if (issue.severity === 'hard') score -= 40;
  }
  score = Math.max(0, Math.min(100, Math.round(score)));
  const tier = qualityTier(score);
  const rejectReason = hardIssue?.type || (tier === 'weak' ? 'weak_quality_score' : tier === 'rejected' ? 'low_quality_score' : null);

  return {
    score,
    tier,
    accepted: !rejectReason,
    reject_reason: rejectReason,
    issues: issues.map(issue => issue.type),
    title_score: Math.round(titleScore),
    evidence_score: evidenceMetrics.score,
    evidence_best_overlap: evidenceMetrics.best_overlap,
    evidence_avg_overlap: evidenceMetrics.avg_overlap,
    evidence_best_coverage: evidenceMetrics.best_coverage,
    evidence_avg_coverage: evidenceMetrics.avg_coverage,
    evidence_best_views: evidenceMetrics.best_views,
    family_fit_score: familyFit,
    archetype_score: comboBoost,
    dna_score: dnaScore,
    csp: csp || null,
  };
}

function scoreForIdea(base, index, dna) {
  const confidence = Number(dna.confidence_score || 0);
  const sampleBoost = Math.min(4, Math.floor(Number(dna.sample_count || 0) / 15));
  // Ceiling 72: DNA bets must rank below peer-backed ideas (which start at ~65+ with evidence).
  // floor 45: no artificial inflation for weak DNA.
  return Math.max(45, Math.min(72, Math.round(base + sampleBoost + (confidence * 5) - index)));
}

function makeIdea(topic, reason, index, dna, ownTitles, evidence, archetype, channelId, quality, conceptMeta) {
  const avg = medianViews(ownTitles);
  const familyArchetype = String(archetype || '').startsWith('family:');
  const baseScore = scoreForIdea(archetype === 'combo' ? 68 : familyArchetype ? 62 : 58, index, dna);
  const qualityScore = Number(quality?.score || 0);
  // Spread DNA-bet scores across the [45,72] band by candidate quality so stronger ideas
  // visibly rank above template filler WITHIN the DNA section (instead of every idea
  // clamping to a flat 72). 72 stays the ceiling: DNA bets have 0 peer channels and must not
  // outrank evidence-backed peer ideas (which start ~65+).
  // The raw quality score saturates at 100 for any evidence-rich idea, which hides genuine
  // weakness — so also demote by soft-issue count (abstract/overbroad subject, awkward hook,
  // too-short title). Accepted ideas carry no hard issues, so issues.length == soft count.
  const DNA_FLOOR = 45;
  const DNA_CEIL = 72;
  const softIssueCount = Array.isArray(quality?.issues) ? quality.issues.length : 0;
  const score = qualityScore
    ? Math.max(DNA_FLOOR, DNA_FLOOR
        + Math.round((Math.max(0, Math.min(100, qualityScore)) / 100) * (DNA_CEIL - DNA_FLOOR))
        - softIssueCount * 4)
    : Math.min(DNA_CEIL, baseScore);
  const family = familyArchetype ? String(archetype).slice('family:'.length) : null;
  // Compute DNA × concept affinity when concept is known
  const dnaAffinity = conceptMeta?.concept_id
    ? computeConceptAffinity(dna, conceptMeta.concept_id)
    : null;
  return {
    idea_key: createOriginalBetIdeaKey(channelId || dna.channel_id, topic),
    topic,
    title: topic,
    source: 'creator_dna_original_bet',
    recommendation_type: 'original_bet',
    idea_type: 'original_bet',
    // 0 peer channels = low evidence confidence regardless of DNA quality.
    confidence: 'low',
    confidence_tier: 'low',
    confidence_reason: 'Generated from this creator\'s cached upload DNA, not from peer topic coverage.',
    score,
    avg_views: avg,
    expected_low: avg ? Math.round(avg * 0.65) : null,
    expected_high: avg ? Math.round(avg * 1.35) : null,
    trend_status: 'evergreen',
    saturation_level: 'low',
    saturation_pct: 0,
    channel_count: 0,
    examples: evidence,
    why: reason,
    act_now: false,
    original_quality: quality ? {
      score: quality.score,
      tier: quality.tier,
      issues: quality.issues,
      evidence_score: quality.evidence_score,
      title_score: quality.title_score,
      family_fit_score: quality.family_fit_score,
      evidence_best_overlap: quality.evidence_best_overlap,
      evidence_avg_overlap: quality.evidence_avg_overlap,
      evidence_best_coverage: quality.evidence_best_coverage,
      evidence_avg_coverage: quality.evidence_avg_coverage,
    } : null,
    dna_evidence: {
      archetype,
      family,
      csp: creatorCsp(dna) || null,
      confidence: dna.confidence,
      confidence_score: dna.confidence_score,
      domains: topIds(dna.domain_tags, 5),
      thesis_patterns: topIds(dna.thesis_patterns, 5),
      hook_templates: topIds(dna.hook_templates, 5),
      drift_status: dna.drift_status,
    },
    concept: conceptMeta?.concept_id ? {
      id:          conceptMeta.concept_id,
      label:       conceptMeta.concept_label,
      confidence:  conceptMeta.concept_confidence,
      dna_affinity: dnaAffinity?.affinity_score ?? null,
    } : null,
    // _generation_trace is stripped from API responses and written to wtp_generation_traces
    _generation_trace: {
      raw_subject:        conceptMeta?.raw_subject || null,
      concept_id:         conceptMeta?.concept_id || null,
      concept_label:      conceptMeta?.concept_label || null,
      concept_confidence: conceptMeta?.concept_confidence || null,
      dna_affinity_score: dnaAffinity?.affinity_score ?? null,
      dna_affinity_reason:dnaAffinity?.affinity_reason || null,
      wtp_score:          score,
      family,
      archetype,
      generated_title:    topic,
    },
  };
}

function buildComboCandidates(domainSet, thesisSet) {
  return COMBO_BETS.filter(bet =>
    hasAll(domainSet, bet.domains) &&
    hasAny(thesisSet, bet.thesis)
  );
}

function buildTemplateCandidates(domains, thesis, subjects) {
  const candidates = [];
  for (const thesisId of thesis) {
    const templates = THESIS_TEMPLATES[thesisId] || [];
    for (const domain of domains) {
      const domainSubjects = (DOMAIN_SUBJECTS[domain] || subjects).slice(0, 4);
      for (let i = 0; i < Math.min(templates.length, 2); i++) {
        const subject = domainSubjects[(i + candidates.length) % Math.max(1, domainSubjects.length)];
        if (!subject) continue;
        candidates.push({
          topic: templates[i](subject),
          reason: `Matches the creator's ${thesisId.replace(/_/g, ' ')} pattern in ${domain.replace(/_/g, ' ')} territory.`,
          archetype: 'template',
          subject,
        });
      }
    }
  }
  return candidates;
}

function familyReason(family, csp, subject) {
  const label = FAMILY_LABELS[family] || FAMILY_LABELS.generic;
  const cspText = csp && csp !== 'unknown' ? ` (${csp.replace(/_/g, ' ')})` : '';
  return `Matches this creator's ${label}${cspText} DNA while building from a repeated upload signal around ${subject}.`;
}

function buildFamilyCandidates(family, csp, domains, thesis, subjects) {
  // P2/P5: generic family produces 0.8% win rate — suppress entirely.
  // Unclassified creators get no DNA bets from this path.
  if (family === 'generic') return [];

  const templates = FAMILY_TEMPLATES[family] || FAMILY_TEMPLATES.generic;
  const candidates = [];
  const subjectLimit = Math.min(subjects.length, 18);
  const stableFamily = prefersStableDefaultSubjects(family);

  for (let round = 0; round < templates.length; round++) {
    for (let i = 0; i < subjectLimit; i++) {
      if (candidates.length >= 48) return candidates;
      const subject = subjects[i];
      if (!subject) continue;
      // Extract concept to detect family-concept mismatches before applying templates.
      const concept = extractConceptForDna(subject, family);
      if (isFamilyConceptMismatch(family, concept.concept_id)) continue;
      // P3 creator relevance gate: reject subjects with no concept match unless
      // the family uses curated stable defaults or the subject is domain-boosted.
      if (!stableFamily && concept.concept_confidence < 0.55 && !isBoostedSubject(family, subject)) continue;
      const template = templates[(round + i) % templates.length];
      const topic = template(subject);
      candidates.push({
        topic,
        reason: familyReason(family, csp, subject),
        archetype: `family:${family}`,
        subject,
        concept_id:         concept.concept_id,
        concept_label:      concept.concept_label,
        concept_confidence: concept.concept_confidence,
      });
    }
  }

  if (candidates.length) return candidates;

  const fallbackSubjects = familySubjectPool(family, domains, [], []);
  for (let i = 0; i < Math.min(fallbackSubjects.length, 10); i++) {
    const subject = fallbackSubjects[i];
    const concept  = extractConceptForDna(subject, family);
    if (isFamilyConceptMismatch(family, concept.concept_id)) continue;
    const template = templates[i % templates.length];
    candidates.push({
      topic:  template(subject),
      reason: familyReason(family, csp, subject),
      archetype: `family:${family}`,
      subject,
      concept_id:         concept.concept_id,
      concept_label:      concept.concept_label,
      concept_confidence: concept.concept_confidence,
    });
  }

  return candidates;
}

function buildExpansionCandidates(dna, family, csp, usedTopicKeys) {
  const concreteSubjectsRaw = concreteDnaSubjects(dna, family)
    .filter(item => item.evidence_count > 0)
    .sort((a, b) => b.evidence_count - a.evidence_count || b.score - a.score)
    .slice(0, 14);
  if (!concreteSubjectsRaw.length) return [];
  // Diversity: this list is sorted by evidence_count, which collapses to a single
  // dominant cluster for recency-focused channels (Preity → all "hair growth", her
  // skincare topics sink). Interleave by shared-word cluster so distinct subjects
  // (hair / tan removal / pigmentation) alternate at the top.
  const concreteSubjects = _clusterInterleave(concreteSubjectsRaw, it => it.subject, 2);
  const templates = EXPANSION_TEMPLATES[family] || FAMILY_TEMPLATES[family] || FAMILY_TEMPLATES.generic;
  const stableFamily = prefersStableDefaultSubjects(family);
  const candidates = [];
  for (const item of concreteSubjects) {
    const concept = extractConceptForDna(item.subject, family);
    if (isFamilyConceptMismatch(family, concept.concept_id)) continue;
    // P3 creator relevance gate — expansion subjects from DNA micro-topics must be
    // concept-aligned. Stable-default families skip the gate (subjects are curated).
    if (!stableFamily && concept.concept_confidence < 0.55 && !isBoostedSubject(family, item.subject)) continue;
    for (const template of templates) {
      const topic = template(item.subject);
      const key = topic.toLowerCase();
      if (usedTopicKeys.has(key)) continue;
      candidates.push({
        topic,
        reason: familyReason(family, csp, item.subject),
        archetype: 'expansion',
        subject: item.subject,
        concept_id:         concept.concept_id,
        concept_label:      concept.concept_label,
        concept_confidence: concept.concept_confidence,
      });
    }
  }
  return candidates;
}

// ── Phase 5: Winner Template Candidates ────────────────────────────────────────
// Routes generation through proven winner template types (CHECKLIST_FORMAT, WAY_TO,
// MISTAKE_BEHIND, DISH_TECHNIQUE, COLON_EXPLAINER) instead of per-family templates.
// Phase 3 creator relevance gate is embedded: subjects with concept_confidence < 0.55
// that are not boosted for this family are skipped to force concept-aligned generation.
function buildWinnerTemplateCandidates(family, csp, subjects) {
  const winnerFamilyIds = CREATOR_WINNER_TEMPLATES[family] || [];
  if (!winnerFamilyIds.length) return [];

  const candidates = [];
  const subjectLimit = Math.min(subjects.length, 18);
  const stableFamily = prefersStableDefaultSubjects(family);

  for (const winnerFamilyId of winnerFamilyIds) {
    const winnerSet = WINNER_TEMPLATE_SETS[winnerFamilyId];
    if (!winnerSet) continue;

    for (let i = 0; i < subjectLimit; i++) {
      if (candidates.length >= 48) return candidates;
      const subject = subjects[i];
      if (!subject) continue;

      const concept = extractConceptForDna(subject, family);
      if (isFamilyConceptMismatch(family, concept.concept_id)) continue;

      // Phase 3 creator relevance gate
      if (!stableFamily && concept.concept_confidence < 0.55 && !isBoostedSubject(family, subject)) continue;

      const template = winnerSet.templates[i % winnerSet.templates.length];
      candidates.push({
        topic: template(subject),
        reason: familyReason(family, csp, subject),
        archetype: `family:${family}`,
        subject,
        winner_template_type: winnerSet.type,
        concept_id:         concept.concept_id,
        concept_label:      concept.concept_label,
        concept_confidence: concept.concept_confidence,
      });
    }
  }

  return candidates;
}

function buildOriginalBetsFromDna(db, channelId, dna, options = {}) {
  if (!dna) {
    return {
      status: 'missing_dna',
      ideas: [],
      reason: 'No cached creator DNA profile found yet.',
    };
  }

  // Music-channel suppression: song / music-video channels (jukeboxes, label uploads, artist
  // channels) have no topic-level "what to post next" opportunity — their DNA only yields
  // song-title fragments ("Why viewers keep coming back to war shera"). Niche is the
  // authoritative signal; suppress outright rather than emit fragments. Catches music channels
  // that pass the specificity gate (e.g. Being Punjabi) which curated-default generation misses.
  if (db && channelId) {
    try {
      const nrows = db.all(
        `SELECT LOWER(COALESCE(primary_niche, niche)) AS n FROM ingested_channels WHERE channel_id = ?`,
        [channelId]);
      if (nrows && nrows[0] && nrows[0].n === 'music') {
        return {
          status: 'music_channel_suppressed',
          ideas: [],
          reason: 'Music channels have no topic-level "what to post" opportunity; original bets are suppressed.',
          source: 'creator_idea_dna',
        };
      }
    } catch (_) { /* non-fatal — fall through to normal generation */ }
  }

  const confidenceScore = Number(dna.confidence_score || 0);
  if (confidenceScore < MIN_CONFIDENCE_SCORE || dna.confidence === 'low') {
    return {
      status: 'low_confidence_dna',
      ideas: [],
      reason: 'Creator DNA confidence is too low for original bets.',
      confidence: dna.confidence,
      confidence_score: confidenceScore,
      sample_count: dna.sample_count,
    };
  }

  const stable = dna.stable_dna || {};
  const signature = stable.signature || {};
  const familyProfile = originalBetFamily(dna);
  const family = familyProfile.family;
  const csp = familyProfile.csp;
  const domains = topIds(dna.domain_tags, 8);
  const thesis = topIds(dna.thesis_patterns, 8);
  const microTopics = topLabels(dna.micro_topics, 20);
  const entities = topLabels(dna.entities, 12);
  const domainSet = new Set(domains);
  const thesisSet = new Set(thesis);
  const ownTitles = Array.isArray(options.ownTitles) ? options.ownTitles : getOwnTitles(db, channelId);
  const isIndian = hasIndianCreatorContext(dna);
  const subjects = familySubjectPool(family, domains, microTopics, entities, { isIndian });
  const limit = Number(options.limit || 6);
  const specificity = assessDnaSpecificity(dna, {
    family,
    csp,
    subjects,
    ownTitles,
  });

  if (specificity.status === 'insufficient') {
    return {
      status: 'insufficient_specificity',
      ideas: [],
      reason: 'Creator DNA is not specific enough for Original Bets yet.',
      source: 'creator_idea_dna',
      csp,
      family,
      family_source: familyProfile.family_source,
      base_family: familyProfile.base_family,
      family_label: FAMILY_LABELS[family] || FAMILY_LABELS.generic,
      confidence: dna.confidence,
      confidence_score: confidenceScore,
      source_version: dna.source_version || 1,
      dna_snapshot_id: options.dnaSnapshotId || null,
      sample_count: dna.sample_count,
      long_count: dna.long_count,
      short_count: dna.short_count,
      drift_status: dna.drift_status,
      specificity,
      domains: signature.domain_tags || domains,
      thesis_patterns: signature.thesis_patterns || thesis,
      hook_templates: signature.hook_templates || topIds(dna.hook_templates, 8),
      micro_topics: signature.micro_topics || microTopics.slice(0, 10),
    };
  }

  // Low-information channel gate. For stable-default families (travel/food/fitness/wellness/
  // generic) a channel with ZERO concrete creator-specific subjects would build every idea
  // from curated FAMILY_DEFAULT_SUBJECTS — generic filler presented as "from your DNA". These
  // are the emoji-clickbait / shorts channels with no extractable topic. Suppress rather than
  // emit filler. (Finance/news/conversation/explainer families keep their curated paths.)
  if (prefersStableDefaultSubjects(family) && Number(specificity.concrete_subject_count || 0) === 0) {
    return {
      status: 'low_information_dna',
      ideas: [],
      reason: 'This channel\'s titles do not yield a concrete, creator-specific topic to build original bets from.',
      source: 'creator_idea_dna',
      csp,
      family,
      family_source: familyProfile.family_source,
      base_family: familyProfile.base_family,
      family_label: FAMILY_LABELS[family] || FAMILY_LABELS.generic,
      confidence: dna.confidence,
      confidence_score: confidenceScore,
      source_version: dna.source_version || 1,
      dna_snapshot_id: options.dnaSnapshotId || null,
      sample_count: dna.sample_count,
      long_count: dna.long_count,
      short_count: dna.short_count,
      drift_status: dna.drift_status,
      specificity,
    };
  }

  // P5 Generator V2: Creator Identity → Winner Template → Recommendation.
  // Try winner templates first (CHECKLIST_FORMAT, WAY_TO, MISTAKE_BEHIND, DISH_TECHNIQUE).
  // Fall back to family templates when the winner pool is thin (< 12 candidates).
  const rawCandidates = family === 'explainer_case'
    ? [
        ...buildComboCandidates(domainSet, thesisSet).map(item => ({
          ...item,
          archetype: 'combo',
        })),
        ...buildTemplateCandidates(domains.slice(0, 5), thesis.slice(0, 5), subjects),
      ]
    : (() => {
        const winnerCandidates = buildWinnerTemplateCandidates(family, csp, subjects);
        if (winnerCandidates.length >= 12) return winnerCandidates;
        const familyCandidates = buildFamilyCandidates(family, csp, domains, thesis, subjects);
        return [...winnerCandidates, ...familyCandidates];
      })();

  const qualityGate = newQualityGateStats();
  const rankedCandidates = [];
  const seen = new Set();
  const maxPerSubject = subjects.length >= limit ? 1 : 2;
  const targetLimit = specificity.status === 'limited' ? Math.min(limit, 3) : limit;
  for (let candidateIndex = 0; candidateIndex < rawCandidates.length; candidateIndex++) {
    const candidate = rawCandidates[candidateIndex];
    const topic = String(candidate.topic || '').trim();
    const key = topic.toLowerCase();
    if (!topic || seen.has(key)) continue;
    seen.add(key);
    if (/\b(ft|feat|featuring)\.?\b/i.test(topic)) continue;
    if (isTooCloseToExisting(topic, ownTitles)) continue;
    qualityGate.evaluated++;
    const evidence = evidenceExamplesForCandidate(dna, ownTitles, candidate, new Set(), 2);
    if (evidence.length === 0) {
      qualityGate.candidate_tiers.rejected++;
      recordQualityRejection(qualityGate, 'missing_creator_evidence');
      continue;
    }
    const quality = assessOriginalBetCandidateQuality(candidate, evidence, dna, {
      family,
      csp,
      specificity,
      index: candidateIndex,
    });
    qualityGate.candidate_tiers[quality.tier] = (qualityGate.candidate_tiers[quality.tier] || 0) + 1;
    if (!quality.accepted) {
      const reason = quality.reject_reason || 'quality_gate_rejected';
      recordQualityRejection(qualityGate, reason);
      if (reason === 'gaming_template_artifact' || reason === 'malformed_phrase') {
        console.warn(`[originalBets][rejected:${reason}] family="${family}" subject="${candidate.subject}" topic="${topic.slice(0, 80)}"`);
      }
      continue;
    }
    qualityGate.accepted++;
    const subjKey = subjectKey(candidate.subject);
    const broadKey = broadTopicKey(topic);
    const patternKey = titlePatternKey(topic);
    rankedCandidates.push({
      candidate,
      topic,
      key,
      subjKey,
      broadKey,
      patternKey,
      evidence,
      quality,
      archetype_priority: archetypePriority(candidate.archetype),
      raw_index: candidateIndex,
    });
  }

  rankedCandidates.sort((a, b) =>
    b.quality.score - a.quality.score ||
    b.archetype_priority - a.archetype_priority ||
    b.quality.evidence_score - a.quality.evidence_score ||
    a.raw_index - b.raw_index
  );

  const ideas = [];
  const usedExampleKeys = new Set();
  const usedSubjects = new Map();
  const usedBroadTopics = new Map();
  const usedPatterns = new Map();
  for (const ranked of rankedCandidates) {
    if (ideas.length >= targetLimit) break;
    const { candidate, topic, subjKey, broadKey, patternKey, quality } = ranked;
    // Skeleton dedup: at most ONE recommendation per title skeleton.
    const maxPattern = 1;
    if (patternKey && (usedPatterns.get(patternKey) || 0) >= maxPattern) {
      recordQualityRejection(qualityGate, 'selection_title_pattern_limit');
      continue;
    }
    if (subjKey && (usedSubjects.get(subjKey) || 0) >= maxPerSubject) {
      recordQualityRejection(qualityGate, 'selection_subject_repeat_limit');
      continue;
    }
    const maxBroadTopic = maxBroadTopicRepeats(family, dna, broadKey, csp);
    if (broadKey && (usedBroadTopics.get(broadKey) || 0) >= maxBroadTopic) {
      recordQualityRejection(qualityGate, 'selection_broad_topic_limit');
      continue;
    }
    const evidence = evidenceExamplesForCandidate(dna, ownTitles, candidate, usedExampleKeys, 2);
    if (evidence.length === 0) {
      recordQualityRejection(qualityGate, 'selection_duplicate_evidence');
      continue;
    }
    ideas.push(makeIdea(
      topic,
      candidate.reason,
      ideas.length,
      dna,
      ownTitles,
      evidence,
      candidate.archetype,
      channelId,
      quality,
      { raw_subject: candidate.subject, concept_id: candidate.concept_id, concept_label: candidate.concept_label, concept_confidence: candidate.concept_confidence },
    ));
    qualityGate.selected++;
    qualityGate.selected_tiers[quality.tier] = (qualityGate.selected_tiers[quality.tier] || 0) + 1;
    if (subjKey) usedSubjects.set(subjKey, (usedSubjects.get(subjKey) || 0) + 1);
    if (broadKey) usedBroadTopics.set(broadKey, (usedBroadTopics.get(broadKey) || 0) + 1);
    if (patternKey) usedPatterns.set(patternKey, (usedPatterns.get(patternKey) || 0) + 1);
  }

  const EXPANSION_MIN_TARGET = 3;
  const expansionStats = { evaluated: 0, selected: 0, rejection_reasons: {} };

  if (ideas.length < Math.min(EXPANSION_MIN_TARGET, targetLimit)) {
    const expansionCandidates = buildExpansionCandidates(dna, family, csp, seen);
    for (const candidate of expansionCandidates) {
      if (ideas.length >= targetLimit) break;
      const topic = String(candidate.topic || '').trim();
      const key = topic.toLowerCase();
      if (!topic || seen.has(key)) continue;
      seen.add(key);
      if (/\b(ft|feat|featuring)\.?\b/i.test(topic)) continue;
      if (isTooCloseToExisting(topic, ownTitles)) continue;
      expansionStats.evaluated++;
      const evidence = evidenceExamplesForCandidate(dna, ownTitles, candidate, new Set(), 2);
      if (evidence.length === 0) {
        expansionStats.rejection_reasons.missing_creator_evidence = (expansionStats.rejection_reasons.missing_creator_evidence || 0) + 1;
        continue;
      }
      const quality = assessOriginalBetCandidateQuality(candidate, evidence, dna, {
        family,
        csp,
        specificity,
        index: ideas.length,
      });
      if (!quality.accepted) {
        const r = quality.reject_reason || 'quality_gate_rejected';
        expansionStats.rejection_reasons[r] = (expansionStats.rejection_reasons[r] || 0) + 1;
        continue;
      }
      const subjKey = subjectKey(candidate.subject);
      const broadKey = broadTopicKey(topic);
      const patternKey = titlePatternKey(topic);
      // Skeleton dedup: at most ONE recommendation per title skeleton (e.g. only one
      // "The hidden cost of X"), so a channel never gets near-duplicate template fills.
      const maxPattern = 1;
      if (patternKey && (usedPatterns.get(patternKey) || 0) >= maxPattern) {
        expansionStats.rejection_reasons.selection_title_pattern_limit = (expansionStats.rejection_reasons.selection_title_pattern_limit || 0) + 1;
        continue;
      }
      if (subjKey && (usedSubjects.get(subjKey) || 0) >= maxPerSubject) {
        expansionStats.rejection_reasons.selection_subject_repeat_limit = (expansionStats.rejection_reasons.selection_subject_repeat_limit || 0) + 1;
        continue;
      }
      const maxBroadTopic = maxBroadTopicRepeats(family, dna, broadKey, csp);
      if (broadKey && (usedBroadTopics.get(broadKey) || 0) >= maxBroadTopic) {
        expansionStats.rejection_reasons.selection_broad_topic_limit = (expansionStats.rejection_reasons.selection_broad_topic_limit || 0) + 1;
        continue;
      }
      const finalEvidence = evidenceExamplesForCandidate(dna, ownTitles, candidate, usedExampleKeys, 2);
      if (finalEvidence.length === 0) {
        expansionStats.rejection_reasons.selection_duplicate_evidence = (expansionStats.rejection_reasons.selection_duplicate_evidence || 0) + 1;
        continue;
      }
      ideas.push(makeIdea(topic, candidate.reason, ideas.length, dna, ownTitles, finalEvidence, candidate.archetype, channelId, quality,
        { raw_subject: candidate.subject, concept_id: candidate.concept_id, concept_label: candidate.concept_label, concept_confidence: candidate.concept_confidence },
      ));
      expansionStats.selected++;
      qualityGate.selected++;
      qualityGate.selected_tiers[quality.tier] = (qualityGate.selected_tiers[quality.tier] || 0) + 1;
      if (subjKey) usedSubjects.set(subjKey, (usedSubjects.get(subjKey) || 0) + 1);
      if (broadKey) usedBroadTopics.set(broadKey, (usedBroadTopics.get(broadKey) || 0) + 1);
      if (patternKey) usedPatterns.set(patternKey, (usedPatterns.get(patternKey) || 0) + 1);
    }
  }

  qualityGate.expansion_evaluated = expansionStats.evaluated;
  qualityGate.expansion_selected = expansionStats.selected;
  qualityGate.expansion_rejection_reasons = expansionStats.rejection_reasons;

  // Write generation traces to DB, then strip the private field before returning.
  // Traces are audit-only — never exposed in API responses.
  if (db && ideas.length) {
    try {
      const insertTrace = db._stmt(
        `INSERT OR IGNORE INTO wtp_generation_traces
         (idea_key, channel_id, rec_source, raw_subject, concept_id, concept_label, concept_confidence,
          dna_affinity_score, dna_affinity_reason, family, archetype, generated_title,
          opportunity_id, opportunity_label, opportunity_confidence, wtp_score, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      );
      for (const idea of ideas) {
        const t = idea._generation_trace || {};
        const opp = extractOpportunity({
          concept_id:      t.concept_id || null,
          generated_title: t.generated_title || idea.topic || null,
          raw_subject:     t.raw_subject || null,
          family:          t.family || family,
          archetype:       t.archetype || null,
        });
        try {
          insertTrace.run(
            idea.idea_key || null,
            channelId || null,
            'dna_original_bets',
            t.raw_subject || null,
            t.concept_id || null,
            t.concept_label || null,
            t.concept_confidence ?? null,
            t.dna_affinity_score ?? null,
            t.dna_affinity_reason || null,
            t.family || family,
            t.archetype || null,
            t.generated_title || idea.topic || null,
            opp ? opp.opportunity_id : null,
            opp ? opp.opportunity_label : null,
            opp ? opp.opportunity_confidence : null,
            t.wtp_score ?? null,
          );
        } catch (_) {}
      }
    } catch (_) {}
  }

  const cleanIdeas = ideas.map(idea => {
    const { _generation_trace: _t, ...rest } = idea;
    return rest;
  });

  return {
    status: cleanIdeas.length ? 'ready' : 'no_distinct_candidates',
    source: 'creator_idea_dna',
    csp,
    family,
    family_source: familyProfile.family_source,
    base_family: familyProfile.base_family,
    family_label: FAMILY_LABELS[family] || FAMILY_LABELS.generic,
    confidence: dna.confidence,
    confidence_score: confidenceScore,
    source_version: dna.source_version || 1,
    dna_snapshot_id: options.dnaSnapshotId || null,
    sample_count: dna.sample_count,
    long_count: dna.long_count,
    short_count: dna.short_count,
    drift_status: dna.drift_status,
    domains: signature.domain_tags || domains,
    thesis_patterns: signature.thesis_patterns || thesis,
    hook_templates: signature.hook_templates || topIds(dna.hook_templates, 8),
    micro_topics: signature.micro_topics || microTopics.slice(0, 10),
    specificity,
    quality_gate: qualityGate,
    ideas: cleanIdeas,
  };
}

function buildOriginalBetsForChannel(db, channelId, options = {}) {
  const dna = readCreatorIdeaDna(db, channelId);
  return buildOriginalBetsFromDna(db, channelId, dna, options);
}

module.exports = {
  buildOriginalBetsForChannel,
  buildOriginalBetsFromDna,
  createOriginalBetIdeaKey,
  overlapRatio,
};

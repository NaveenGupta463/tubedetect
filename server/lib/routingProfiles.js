'use strict';

// ── Routing Profile Layer ─────────────────────────────────────────────────────
// Each profile defines a content sub-niche. The router uses positive_terms and
// negative_terms to score a channel's titles, then routes it into the correct
// peer universe.
//
// creator_mode  → decides the demand engine (topic gaps, podcast intel, etc.)
// routing_profile → decides the valid peer universe
//
// Phase 1A added: business_finance, startup_founder, relationship_selfwork,
// fitness_transformation, tech_ai, politics_news, upsc_exam.
// These profiles are classified but the resolver does not activate for them yet
// (blocked via RESOLVER_BLOCKED_MODES / RESOLVER_ELIGIBLE_NICHES in creatorIntel).

const ROUTING_PROFILES = {

  // ── Wellness / Transformation cluster ──────────────────────────────────────

  physical_yoga: {
    positive_terms: [
      'asana', 'pose', 'vinyasa', 'stretch', 'flexibility', 'yoga class',
      'yoga flow', 'sun salutation', 'warrior', 'downward dog', 'beginner yoga',
      'pranayama', 'hatha', 'ashtanga', 'yin yoga', 'power yoga', 'yoga sequence',
    ],
    negative_terms: [
      'manifestation', 'karma', 'enlightenment', 'trauma healing',
      'law of attraction', 'past life', 'chanting', 'healing frequency',
      'belly fat', 'weight loss', 'fat burn', 'cardio',
    ],
    adjacent_profiles: ['fitness_flexibility', 'pain_relief_therapy'],
    fallback_policy: 'adjacent_then_niche',
  },

  meditation_spirituality: {
    positive_terms: [
      'meditation', 'spirituality', 'enlightenment', 'karma', 'chanting',
      'inner state', 'soul', 'mindfulness', 'consciousness', 'awakening',
      'spiritual', 'divine', 'chakra', 'mantra', 'cosmic', 'sadhana',
      'dharma', 'moksha', 'inner peace', 'witness consciousness', 'silent mind',
      'deep meditation', 'guided meditation',
    ],
    negative_terms: [
      'belly fat', 'knee pain', 'neck pain', 'workout', 'yoga class',
      'asana', 'vinyasa', 'fat burn', 'gym', 'exercise',
    ],
    adjacent_profiles: ['manifestation_healing', 'general_selfimprovement'],
    fallback_policy: 'adjacent_then_niche',
  },

  pain_relief_therapy: {
    positive_terms: [
      'pain relief', 'knee pain', 'back pain', 'neck pain', 'shoulder pain',
      'joint pain', 'sciatica', 'spine', 'arthritis', 'posture', 'therapy',
      'physiotherapy', 'rehabilitation', 'stiffness', 'inflammation',
      'cervical', 'lumbar', 'disc', 'nerve pain', 'hip pain',
    ],
    negative_terms: [
      'manifestation', 'enlightenment', 'vinyasa', 'spiritual',
      'karma', 'soul', 'law of attraction', 'money energy',
    ],
    adjacent_profiles: ['physical_yoga', 'fitness_flexibility'],
    fallback_policy: 'adjacent_then_niche',
  },

  fitness_flexibility: {
    positive_terms: [
      'fitness', 'workout', 'exercise', 'weight loss', 'belly fat', 'fat burn',
      'muscle', 'cardio', 'strength training', 'gym', 'calories', 'body fat',
      'abs', 'toning', 'hiit', 'aerobics', 'stamina',
    ],
    negative_terms: [
      'manifestation', 'karma', 'enlightenment', 'spiritual', 'soul',
      'chanting', 'law of attraction', 'trauma healing',
    ],
    adjacent_profiles: ['physical_yoga', 'pain_relief_therapy', 'fitness_transformation'],
    fallback_policy: 'adjacent_then_niche',
  },

  fitness_transformation: {
    positive_terms: [
      'transformation', 'weight loss journey', 'fat loss', 'body transformation',
      'before after', 'shredding', 'cutting', 'bulking', 'recomposition',
      'keto', 'intermittent fasting', 'calorie deficit', 'calorie',
      'diet plan', 'clean eating', 'fat burning', 'lean body',
    ],
    negative_terms: [
      'manifestation', 'spiritual', 'law of attraction', 'karma',
      'asana', 'vinyasa', 'meditation', 'healing', 'coding', 'startup',
    ],
    adjacent_profiles: ['fitness_flexibility', 'pain_relief_therapy'],
    fallback_policy: 'adjacent_then_niche',
  },

  manifestation_healing: {
    positive_terms: [
      'manifestation', 'law of attraction', 'money energy', 'heal past',
      'trauma healing', 'specific person', 'affirmation', 'abundance',
      'attract', 'vibration', 'subconscious', 'limiting belief',
      'energy healing', 'theta healing', 'shadow work',
      'inner child', 'past trauma', 'emotional healing',
    ],
    negative_terms: [
      'asana', 'vinyasa', 'pain relief', 'belly fat', 'workout',
      'exercise', 'gym', 'fitness',
    ],
    adjacent_profiles: ['meditation_spirituality', 'general_selfimprovement'],
    fallback_policy: 'adjacent_then_niche',
  },

  relationship_selfwork: {
    positive_terms: [
      'relationship', 'dating', 'attachment', 'narcissist', 'breakup',
      'codependency', 'self worth', 'emotional unavailability', 'boundaries',
      'toxic relationship', 'love language', 'rejection', 'divorce',
      'ex back', 'ghosting', 'situationship',
    ],
    negative_terms: [
      'asana', 'vinyasa', 'workout', 'gym', 'fitness', 'stock market',
      'investing', 'coding', 'programming', 'upsc', 'exam',
    ],
    adjacent_profiles: ['manifestation_healing', 'general_selfimprovement'],
    fallback_policy: 'adjacent_then_niche',
  },

  general_selfimprovement: {
    positive_terms: [
      'self improvement', 'personal growth', 'mindset', 'habits',
      'productivity', 'discipline', 'motivation', 'self development',
      'confidence', 'success mindset', 'goal setting', 'life skills',
      'daily habits', 'self help',
    ],
    negative_terms: [],
    adjacent_profiles: ['meditation_spirituality', 'fitness_flexibility', 'manifestation_healing'],
    fallback_policy: 'broad_niche',
  },

  // ── Business / Entrepreneurship cluster ────────────────────────────────────

  business_finance: {
    positive_terms: [
      'stock market', 'mutual fund', 'investing', 'portfolio', 'dividend',
      'ipo', 'trading', 'nifty', 'sensex', 'equity', 'debt fund',
      'financial freedom', 'personal finance', 'wealth', 'tax', 'loan',
      'credit score', 'share market', 'sip', 'fixed deposit', 'insurance',
    ],
    negative_terms: [
      'manifestation', 'healing', 'spiritual', 'meditation', 'asana',
      'workout', 'gym', 'upsc', 'exam', 'coding', 'programming',
    ],
    adjacent_profiles: ['startup_founder', 'general_selfimprovement'],
    fallback_policy: 'adjacent_then_niche',
  },

  startup_founder: {
    positive_terms: [
      'startup', 'founder', 'entrepreneur', 'venture capital', 'fundraising',
      'seed round', 'pitch deck', 'product market fit', 'angel investor',
      'b2b', 'mvp', 'scaling startup',
      'startup story', 'business model', 'valuation',
    ],
    negative_terms: [
      'manifestation', 'healing', 'spiritual', 'meditation', 'asana',
      'workout', 'gym', 'upsc', 'exam', 'stock market', 'mutual fund',
    ],
    adjacent_profiles: ['business_finance', 'general_selfimprovement'],
    fallback_policy: 'adjacent_then_niche',
  },

  // ── Technology cluster ──────────────────────────────────────────────────────

  tech_ai: {
    positive_terms: [
      'artificial intelligence', 'machine learning', 'llm', 'chatgpt',
      'deep learning', 'neural network', 'data science', 'python tutorial',
      'programming', 'coding', 'software', 'algorithm', 'automation',
      'generative ai', 'model training', 'prompt engineering',
    ],
    negative_terms: [
      'manifestation', 'healing', 'spiritual', 'upsc', 'exam',
      'stock market', 'mutual fund', 'workout', 'fitness', 'yoga',
    ],
    adjacent_profiles: ['startup_founder'],
    fallback_policy: 'adjacent_then_niche',
  },

  // ── News / Civic cluster ────────────────────────────────────────────────────

  politics_news: {
    positive_terms: [
      'election', 'parliament', 'policy', 'government', 'minister',
      'geopolitics', 'diplomacy', 'breaking news', 'current affairs',
      'budget', 'gdp', 'inflation', 'congress', 'bjp', 'modi',
      'supreme court', 'legislation', 'foreign policy', 'sanctions',
    ],
    negative_terms: [
      'yoga', 'asana', 'meditation', 'manifestation', 'healing',
      'workout', 'fitness', 'coding', 'startup',
    ],
    adjacent_profiles: ['upsc_exam'],
    fallback_policy: 'adjacent_then_niche',
  },

  upsc_exam: {
    positive_terms: [
      'upsc', 'prelims', 'mains', 'civil services',
      'gs paper', 'optional subject', 'upsc topper', 'rank list',
      'upsc syllabus', 'current affairs upsc', 'essay paper',
      'upsc preparation', 'civil services exam',
      'ias preparation', 'ips officer',
    ],
    negative_terms: [
      'yoga', 'asana', 'meditation', 'manifestation', 'healing',
      'workout', 'fitness', 'coding', 'startup', 'stock market',
    ],
    adjacent_profiles: ['politics_news'],
    fallback_policy: 'adjacent_then_niche',
  },

};

// ── Strong-anchor requirements ────────────────────────────────────────────────
// Profiles where generic overlapping terms can produce false medium-confidence
// results on unrelated channels. At least one anchor must be present for a
// channel to reach medium (or stay at medium after the generic hit count).
//
// IMPORTANT: every profile listed in PROFILE_ACTIVATION_RULES with
// minStrongAnchors >= 1 MUST have an entry here, otherwise strong_anchor_hits
// will always be 0 and activation will never fire for that profile.
const PROFILE_STRONG_ANCHORS = {
  // Wellness / Transformation
  meditation_spirituality: [
    'meditation', 'spirituality', 'chakra', 'mantra', 'sadhana', 'dharma',
    'moksha', 'guided meditation', 'deep meditation', 'mindfulness',
    'enlightenment', 'chanting', 'inner peace', 'consciousness', 'awakening',
  ],
  manifestation_healing: [
    'manifestation', 'law of attraction', 'affirmation', 'healing', 'trauma',
    'specific person', 'subconscious', 'inner child', 'shadow work',
    'money energy', 'abundance', 'emotional healing',
  ],
  relationship_selfwork: [
    'relationship', 'dating', 'attachment', 'narcissist', 'breakup',
    'codependency', 'divorce', 'ex back', 'ghosting', 'situationship',
    'toxic relationship',
  ],
  // Business / Entrepreneurship
  business_finance: [
    'stock market', 'mutual fund', 'investing', 'portfolio', 'dividend',
    'ipo', 'trading', 'nifty', 'sensex', 'equity', 'financial freedom',
    'personal finance', 'wealth', 'sip', 'share market', 'stock',
  ],
  startup_founder: [
    'startup', 'founder', 'venture capital', 'fundraising', 'seed round',
    'pitch deck', 'product market fit', 'angel investor', 'mvp',
  ],
  // Technology
  tech_ai: [
    'artificial intelligence', 'machine learning', 'llm', 'chatgpt',
    'deep learning', 'neural network', 'data science', 'prompt engineering',
    'generative ai',
  ],
  // Exam / Civic
  upsc_exam: [
    'upsc', 'prelims', 'mains', 'civil services', 'gs paper',
    'upsc preparation', 'upsc topper', 'upsc syllabus', 'ias preparation',
    'current affairs upsc', 'civil services exam',
  ],
};

// Scores a channel's titles against all profiles and returns the best match.
// Returns an evidence object — see field list below.
function computeRoutingProfile(titles) {
  const _empty = {
    profile: null, confidence: 'none',
    positive_hits: 0, negative_hits: 0,
    strong_anchor_hits: 0, distinct_title_hits: 0,
    density: 0, weak_hits: 0,
    blockers: [], reasons: [],
  };

  if (!titles || titles.length === 0) {
    return { ..._empty, blockers: ['no_titles'] };
  }

  const n    = titles.length;
  const text = titles.join(' ').toLowerCase();

  let bestProfile = null;
  let bestNet     = 0;
  let bestPos     = 0;
  let bestNeg     = 0;
  let bestStrong  = 0;

  for (const [profileName, profile] of Object.entries(ROUTING_PROFILES)) {
    let pos = 0, neg = 0, strong = 0;
    const anchors = PROFILE_STRONG_ANCHORS[profileName] || [];
    for (const term of profile.positive_terms) {
      if (text.includes(term)) {
        pos++;
        if (anchors.includes(term)) strong++;
      }
    }
    for (const term of profile.negative_terms) {
      if (text.includes(term)) neg++;
    }
    const net = pos - neg * 2;
    if (net > bestNet || (net === bestNet && pos > bestPos)) {
      bestNet    = net;
      bestProfile = profileName;
      bestPos    = pos;
      bestNeg    = neg;
      bestStrong = strong;
    }
  }

  if (!bestProfile || bestNet <= 0) {
    return { ..._empty, positive_hits: bestPos, negative_hits: bestNeg, blockers: ['no_net_positive_signal'] };
  }

  // Count titles that contain at least one positive term from the winning profile.
  const winTerms       = ROUTING_PROFILES[bestProfile].positive_terms;
  const distinctTitles = titles.filter(t => {
    const tl = t.toLowerCase();
    return winTerms.some(term => tl.includes(term));
  }).length;

  const density  = bestPos / n;
  let confidence = bestPos >= 4 ? 'high' : bestPos >= 2 ? 'medium' : 'low';

  const blockers = [];
  const reasons  = [];

  // Downgrade medium→low when no strong anchor is present (same rule as before,
  // now also recorded in blockers so activation can read it without re-checking).
  if (confidence === 'medium' && PROFILE_STRONG_ANCHORS[bestProfile] && bestStrong === 0) {
    confidence = 'low';
    blockers.push('medium_no_strong_anchor');
  }

  if (bestPos >= 4)        reasons.push(`${bestPos}_positive_terms`);
  if (bestStrong >= 1)     reasons.push(`${bestStrong}_strong_anchors`);
  if (bestNeg >= 1)        reasons.push(`${bestNeg}_negative_terms`);
  if (distinctTitles >= 3) reasons.push(`${distinctTitles}_distinct_titles`);

  return {
    profile:             bestProfile,
    confidence,
    positive_hits:       bestPos,
    negative_hits:       bestNeg,
    strong_anchor_hits:  bestStrong,
    distinct_title_hits: distinctTitles,
    density,
    weak_hits:           bestPos - bestStrong,
    blockers,
    reasons,
  };
}

// ── Activation layer ──────────────────────────────────────────────────────────
// Classification (above) produces metadata. Activation decides whether an engine
// or resolver fires. Activation requires stricter evidence than classification.

const CONFIDENCE_RANK = { high: 3, medium: 2, low: 1, none: 0 };

// Minimum evidence thresholds required for a profile to activate an engine or
// resolver. Profiles with rich, domain-specific vocabulary need fewer hits;
// profiles with generic terms (general_selfimprovement) need more distinct titles.
const PROFILE_ACTIVATION_RULES = {
  upsc_exam:               { minDistinctTitles: 3, minStrongAnchors: 1, minConfidence: 'medium' },
  manifestation_healing:   { minDistinctTitles: 3, minStrongAnchors: 2, minConfidence: 'medium' },
  meditation_spirituality: { minDistinctTitles: 4, minStrongAnchors: 1, minConfidence: 'medium' },
  relationship_selfwork:   { minDistinctTitles: 3, minStrongAnchors: 1, minConfidence: 'medium' },
  business_finance:        { minDistinctTitles: 4, minStrongAnchors: 2, minConfidence: 'medium' },
  startup_founder:         { minDistinctTitles: 3, minStrongAnchors: 1, minConfidence: 'medium' },
  tech_ai:                 { minDistinctTitles: 4, minStrongAnchors: 2, minConfidence: 'medium' },
  _default:                { minDistinctTitles: 3, minStrongAnchors: 0, minConfidence: 'medium' },
};

// Returns { active: boolean, reason: string }.
// resolverEligible: caller has already verified niche/mode/pool-size eligibility;
// this function adds the evidence-quality gate on top.
function computeRoutingProfileActivation(evidence, { resolverEligible = true } = {}) {
  if (!evidence || !evidence.profile) return { active: false, reason: 'no_profile' };
  if (!resolverEligible)             return { active: false, reason: 'resolver_not_eligible' };
  if (evidence.blockers && evidence.blockers.length > 0) {
    return { active: false, reason: `blocked:${evidence.blockers[0]}` };
  }

  const rules = PROFILE_ACTIVATION_RULES[evidence.profile] || PROFILE_ACTIVATION_RULES._default;

  if (CONFIDENCE_RANK[evidence.confidence] < CONFIDENCE_RANK[rules.minConfidence]) {
    return { active: false, reason: `confidence_${evidence.confidence}` };
  }
  if ((evidence.distinct_title_hits || 0) < rules.minDistinctTitles) {
    return {
      active: false,
      reason: `distinct_titles_${evidence.distinct_title_hits || 0}_need_${rules.minDistinctTitles}`,
    };
  }
  if ((evidence.strong_anchor_hits || 0) < rules.minStrongAnchors) {
    return {
      active: false,
      reason: `strong_anchors_${evidence.strong_anchor_hits || 0}_need_${rules.minStrongAnchors}`,
    };
  }

  return { active: true, reason: 'passes_activation_rules' };
}

// Bump this when ROUTING_PROFILES definitions change to trigger re-computation.
const ROUTING_PROFILE_VERSION = 5;

// Per-profile framing question surfaced in the UI when routing_profile_active=true.
const PROFILE_QUESTIONS = {
  // Wellness / Transformation
  physical_yoga:          'What practice, routine, or body outcome is resonating with your audience?',
  meditation_spirituality:'What inner state, spiritual practice, or consciousness shift is resonating?',
  pain_relief_therapy:    'What pain or physical problem relief demand is rising in your community?',
  fitness_flexibility:    'What workout, body transformation, or fitness goal is your audience chasing?',
  fitness_transformation: 'What transformation milestone or body goal is your audience pursuing right now?',
  manifestation_healing:  'What belief shift, healing journey, or identity transformation is resonating?',
  relationship_selfwork:  'What relationship pattern, dynamic, or healing need is your audience sitting with?',
  general_selfimprovement:'What habit, mindset shift, or life skill is trending in your community?',
  // Business / Entrepreneurship
  business_finance:       'What financial move, market shift, or money decision is your audience facing?',
  startup_founder:        'What founder challenge, funding stage, or product moment is your audience navigating?',
  // Technology
  tech_ai:                'What AI tool, capability shift, or developer pattern is your audience watching?',
  // News / Civic
  politics_news:          'What policy shift, election development, or geopolitical moment is your audience following?',
  upsc_exam:              'What syllabus topic, paper pattern, or exam strategy is your community asking about?',
};

module.exports = {
  ROUTING_PROFILES, ROUTING_PROFILE_VERSION, PROFILE_QUESTIONS, PROFILE_STRONG_ANCHORS,
  CONFIDENCE_RANK, PROFILE_ACTIVATION_RULES,
  computeRoutingProfile, computeRoutingProfileActivation,
};

'use strict';

// ── Podcast content lanes ─────────────────────────────────────────────────────
// Generic lane families applicable to any podcast channel.
// Each entry is an array of lowercase anchor phrases checked via .includes().
// No person names as anchors — lanes should be topic-driven.
const PODCAST_LANE_FAMILIES = {
  spirituality_mysticism: [
    'meditation', 'spiritual', 'consciousness', 'manifestation', 'karma',
    'chakra', 'healing', 'astrology', 'vipassana', 'enlightenment', 'awakening',
    'mindfulness', 'occult', 'paranormal', 'mystic', 'inner peace', 'tantra',
    'reiki', 'tarot', 'cosmos', 'sacred', 'divine',
  ],
  celebrity_psychology: [
    'mental health', 'psychology', 'therapy', 'trauma', 'anxiety', 'depression',
    'mindset', 'celebrity', 'bollywood', 'actor', 'actress', 'identity',
    'personality', 'self-worth', 'narcissism', 'toxic relationship',
    'childhood', 'abuse', 'grief', 'emotional',
  ],
  health_body_mind: [
    'health', 'fitness', 'fat loss', 'weight loss', 'muscle', 'diet', 'nutrition',
    'ayurveda', 'sleep', 'fasting', 'workout', 'testosterone', 'gut health',
    'immunity', 'supplement', 'biohacking', 'longevity', 'inflammation',
    'metabolism', 'hormone', 'body transformation',
  ],
  geopolitics_social: [
    'geopolitics', 'society', 'caste', 'religion', 'gender', 'protest',
    'inequality', 'discrimination', 'conflict', 'war', 'culture', 'social',
    'rights', 'politics', 'nation', 'movement', 'privilege',
  ],
  science_history_mystery: [
    'history', 'mystery', 'ancient', 'science', 'conspiracy', 'discovery',
    'archaeology', 'supernatural', 'quantum', 'space', 'evolution', 'experiment',
    'dna', 'civilisation', 'civilization', 'lost city', 'secret history',
    'unsolved', 'dark matter', 'time travel',
  ],
  creator_growth: [
    'youtube', 'content creator', 'social media', 'algorithm', 'thumbnail',
    'viral', 'subscriber', 'monetize', 'influence', 'personal brand',
    'podcast host', 'content strategy', 'creative business',
  ],
  business_money: [
    'business', 'money', 'wealth', 'finance', 'invest', 'stock market',
    'entrepreneur', 'income', 'revenue', 'profit', 'financial freedom',
    'real estate', 'mutual fund', 'trading', 'asset', 'financial',
  ],
  startup_founder: [
    'startup', 'founder', 'venture capital', 'funding', 'pitch', 'unicorn',
    'bootstrapped', 'product market fit', 'ipo', 'saas', 'scale', 'seed round',
    'angel invest', 'accelerator', 'b2b',
  ],
  relationship_selfwork: [
    'relationship', 'dating', 'love', 'marriage', 'divorce', 'breakup',
    'self-love', 'confidence', 'loneliness', 'heartbreak', 'attachment',
    'boundaries', 'communication', 'purpose', 'passion', 'self-worth',
  ],
  // ── Extended families for sports, tech, comedy, legal, education niches ──
  sports_fitness: [
    'cricket', 'football', 'tennis', 'badminton', 'hockey', 'chess', 'kabaddi',
    'ipl', 'bcci', 'fifa', 'athlete', 'sport', 'player', 'match', 'tournament',
    'coaching', 'training camp', 'performance', 'champion', 'league', 'series',
  ],
  tech_ai: [
    'artificial intelligence', 'machine learning', 'deep learning', 'chatgpt',
    'software', 'engineer', 'developer', 'coding', 'programming', 'data science',
    'blockchain', 'web3', 'cloud', 'cybersecurity', 'open source', 'product',
    'technology', 'tech', 'robotics', 'automation', 'generative ai',
  ],
  comedy_entertainment: [
    'comedy', 'standup', 'stand-up', 'comedian', 'roast', 'sketch', 'improv',
    'funny', 'humor', 'satire', 'parody', 'entertainment', 'show business',
    'web series', 'ott', 'streaming', 'film', 'cinema', 'movie',
  ],
  law_policy: [
    'law', 'legal', 'lawyer', 'court', 'judgement', 'constitution', 'justice',
    'crime', 'criminal', 'policy', 'regulation', 'compliance', 'rights',
    'advocate', 'supreme court', 'high court', 'case study', 'verdict',
  ],
  education_career: [
    'upsc', 'exam', 'study', 'college', 'university', 'degree', 'career',
    'job', 'interview', 'resume', 'campus', 'student', 'teacher', 'professor',
    'research', 'phd', 'scholarship', 'skill', 'learning',
  ],
};

// Returns lane IDs sorted by hit-rate descending, filtered to >= 4% of titles.
function computeTargetLanes(titles) {
  if (!titles || titles.length === 0) return [];
  const n = titles.length;
  const scores = {};
  for (const [lane, anchors] of Object.entries(PODCAST_LANE_FAMILIES)) {
    let hits = 0;
    for (const title of titles) {
      const tl = title.toLowerCase();
      if (anchors.some(a => tl.includes(a))) hits++;
    }
    scores[lane] = hits / n;
  }
  return Object.entries(scores)
    .filter(([, v]) => v >= 0.04)
    .sort((a, b) => b[1] - a[1])
    .map(([lane]) => lane);
}

// Returns the first matching lane from targetLanes (ordered by score desc) whose
// anchors appear in any of the provided texts. Returns null if no match.
function detectItemLane(texts, targetLanes) {
  for (const lane of targetLanes) {
    const anchors = PODCAST_LANE_FAMILIES[lane];
    if (!anchors) continue;
    for (const text of texts) {
      const tl = text.toLowerCase();
      if (anchors.some(a => tl.includes(a))) return lane;
    }
  }
  return null;
}

module.exports = { PODCAST_LANE_FAMILIES, computeTargetLanes, detectItemLane };

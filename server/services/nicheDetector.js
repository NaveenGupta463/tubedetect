'use strict';

// ── Niche detection helpers ───────────────────────────────────────────────────
// Used by the crawler (free detection on already-fetched data) and the
// promotion job (OpenAI fallback for channels still unclassified).

const NICHE_KEYWORDS = {
  politics:      ['politics', 'political', 'government', 'election', 'parliament', 'democracy', 'geopolitics', 'rajya', 'lok sabha', 'minister', 'modi', 'rahul', 'policy', 'ideology'],
  education:     ['education', 'learn', 'tutorial', 'study', 'teaching', 'school', 'upsc', 'ias', 'exam', 'lecture', 'course', 'knowledge', 'university'],
  technology:    ['tech', 'software', 'coding', 'programming', 'gadget', 'smartphone', 'ai', 'machine learning', 'developer', 'cybersecurity', 'startup'],
  finance:       ['finance', 'investing', 'stock market', 'mutual fund', 'money', 'wealth', 'trading', 'budget', 'economy', 'crypto', 'personal finance'],
  entertainment: ['entertainment', 'fun', 'viral', 'trending', 'memes', 'reaction', 'celebrity', 'bollywood', 'movies', 'web series'],
  gaming:        ['gaming', 'game', 'esports', 'playthrough', 'minecraft', 'pubg', 'free fire', 'valorant', 'gamer', 'gameplay'],
  lifestyle:     ['lifestyle', 'vlog', 'daily life', 'day in my life', 'family', 'travel', 'routine', 'grwm'],
  health:        ['health', 'fitness', 'workout', 'yoga', 'ayurveda', 'diet', 'wellness', 'doctor', 'medical', 'nutrition'],
  food:          ['food', 'recipe', 'cooking', 'chef', 'kitchen', 'restaurant', 'cuisine', 'baking', 'khana'],
  travel:        ['travel', 'adventure', 'explore', 'destination', 'trip', 'journey', 'wanderlust'],
  music:         ['music', 'song', 'singer', 'album', 'rap', 'hip hop', 'cover', 'musician', 'beat'],
  comedy:        ['comedy', 'funny', 'humor', 'laugh', 'sketch', 'prank', 'standup', 'roast'],
  news:          ['news', 'breaking', 'current affairs', 'samachar', 'daily news', 'latest update', 'reporter'],
  business:      ['business', 'entrepreneur', 'startup', 'marketing', 'sales', 'growth', 'brand'],
  sports:        ['sports', 'cricket', 'football', 'ipl', 'match', 'athlete', 'tournament', 'score'],
  science:       ['science', 'space', 'physics', 'chemistry', 'biology', 'research', 'experiment', 'nasa'],
  philosophy:    ['philosophy', 'stoicism', 'wisdom', 'mindset', 'consciousness', 'eastern philosophy'],
};

const TOPIC_TO_NICHE = {
  sports: 'sports', sport: 'sports',
  gaming: 'gaming', video_game: 'gaming', esports: 'gaming',
  music: 'music',
  entertainment: 'entertainment', film: 'entertainment', television: 'entertainment', comedy: 'comedy',
  technology: 'technology', computing: 'technology',
  politics: 'politics', government: 'politics',
  education: 'education', knowledge: 'education',
  food: 'food', cooking: 'food',
  travel: 'travel',
  health: 'health', fitness: 'fitness',
  lifestyle: 'lifestyle',
  science: 'science',
  business: 'business',
  news: 'news',
};

// Free: parse YouTube topicCategories (Wikipedia URLs like .../wiki/Entertainment)
function nicheFromTopicCategories(categories = []) {
  for (const url of categories) {
    const slug = url.split('/').pop()?.toLowerCase().replace(/_/g, ' ');
    if (!slug) continue;
    for (const [key, niche] of Object.entries(TOPIC_TO_NICHE)) {
      if (slug.includes(key)) return niche;
    }
  }
  return null;
}

// Free: keyword match against title + description
function guessNiche(title = '', description = '') {
  const text = `${title} ${description}`.toLowerCase();
  let best = null, bestScore = 0;
  for (const [niche, kws] of Object.entries(NICHE_KEYWORDS)) {
    const score = kws.filter(kw => text.includes(kw)).length;
    if (score > bestScore) { bestScore = score; best = niche; }
  }
  return bestScore >= 1 ? best : null;
}

// Free: detect niche from a raw YouTube channels.list item (already fetched)
function detectNicheFromItem(item) {
  const topicCategories = item.topicDetails?.topicCategories || [];
  const title           = item.snippet?.title       || '';
  const description     = item.snippet?.description || '';
  return nicheFromTopicCategories(topicCategories) || guessNiche(title, description);
}

module.exports = { nicheFromTopicCategories, guessNiche, detectNicheFromItem };

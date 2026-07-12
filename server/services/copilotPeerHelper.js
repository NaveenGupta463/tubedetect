// Shared peer-resolution logic used by copilotTools.
// Prefer the main WTP peer resolver so copilot suggestions inherit CSP/format
// safety gates; keep the legacy resolver as a fallback for sparse/new channels.

const { resolveCreatorPeerContext } = require('./creatorPeerContext');

const NICHE_CLUSTERS = {
  'selfimprovement':    ['selfimprovement', 'motivation', 'personal development', 'personal growth', 'leadership lessons', 'motivational speaking', 'mindset'],
  'motivation':         ['selfimprovement', 'motivation', 'personal development', 'personal growth', 'leadership lessons', 'motivational speaking', 'mindset'],
  'personal development': ['selfimprovement', 'motivation', 'personal development', 'personal growth', 'leadership lessons', 'motivational speaking', 'mindset'],
  'personal growth':    ['selfimprovement', 'motivation', 'personal development', 'personal growth', 'leadership lessons', 'motivational speaking', 'mindset'],
  'leadership lessons': ['selfimprovement', 'motivation', 'personal development', 'personal growth', 'leadership lessons', 'motivational speaking', 'mindset'],
  'motivational speaking': ['selfimprovement', 'motivation', 'personal development', 'personal growth', 'leadership lessons', 'motivational speaking', 'mindset'],
  'mindset':            ['selfimprovement', 'motivation', 'personal development', 'personal growth', 'leadership lessons', 'motivational speaking', 'mindset'],

  'finance':            ['finance', 'personal finance', 'investing', 'stock market', 'cryptocurrency'],
  'personal finance':   ['finance', 'personal finance', 'investing', 'stock market', 'cryptocurrency'],
  'investing':          ['finance', 'personal finance', 'investing', 'stock market', 'cryptocurrency'],
  'stock market':       ['finance', 'personal finance', 'investing', 'stock market', 'cryptocurrency'],
  'cryptocurrency':     ['finance', 'personal finance', 'investing', 'stock market', 'cryptocurrency'],

  'fitness':            ['fitness', 'workout', 'bodybuilding', 'strength training', 'muscle building', 'calisthenics', 'powerlifting', 'weightlifting', 'home workouts', 'gym workouts', 'gym motivation', 'workout routines'],
  'workout':            ['fitness', 'workout', 'bodybuilding', 'strength training', 'home workouts', 'gym workouts', 'workout routines'],
  'bodybuilding':       ['fitness', 'bodybuilding', 'workout', 'strength training', 'muscle building', 'powerlifting'],
  'strength training':  ['fitness', 'workout', 'bodybuilding', 'strength training', 'muscle building'],
  'muscle building':    ['fitness', 'workout', 'bodybuilding', 'strength training', 'muscle building'],

  'yoga':               ['yoga', 'somatic yoga', 'yin yoga', 'vinyasa yoga', 'yoga practice', 'yoga poses', 'yoga routines', 'yoga therapy', 'yoga for weight loss', 'yoga exercises', 'somatic movement', 'somatic healing', 'power yoga', 'pranayama techniques', 'yoga asanas'],
  'health':             ['health', 'nutrition', 'wellness', 'holistic health', 'natural remedies', 'ayurvedic medicine', 'health tips', 'healthy habits', 'healthy eating', 'gut health', 'heart health', 'nutrition tips', 'healthy recipes', 'longevity', 'anti-aging'],
  'meditation':         ['meditation', 'guided meditation', 'mindfulness', 'mindfulness meditation', 'sleep meditation', 'guided sleep meditation', 'somatic meditation', 'breathwork techniques', 'chakra healing', 'deep sleep', 'insomnia relief'],

  'business':           ['business', 'entrepreneurship', 'startup'],
  'entrepreneurship':   ['business', 'entrepreneurship', 'startup'],
  'startup':            ['business', 'entrepreneurship', 'startup'],

  'news':               ['news', 'current affairs', 'breaking news'],
  'current affairs':    ['news', 'current affairs', 'breaking news'],

  'lifestyle':          ['lifestyle', 'daily vlogs', 'daily life vlogs', 'personal vlogs', 'vlog'],
  'daily vlogs':        ['lifestyle', 'daily vlogs', 'daily life vlogs', 'personal vlogs', 'vlog'],
  'vlog':               ['lifestyle', 'daily vlogs', 'daily life vlogs', 'personal vlogs', 'vlog'],

  'family vlogs':       ['family vlogs', 'family life'],
  'family life':        ['family vlogs', 'family life'],

  'food':               ['food', 'street food', 'cooking'],
  'street food':        ['food', 'street food', 'cooking'],
  'cooking':            ['food', 'street food', 'cooking'],

  'travel':             ['travel', 'travel vlogs'],
  'travel vlogs':       ['travel', 'travel vlogs'],

  'comedy':             ['comedy', 'entertainment', 'comedy sketches'],
  'comedy sketches':    ['comedy', 'entertainment', 'comedy sketches'],
  'entertainment':      ['comedy', 'entertainment', 'comedy sketches'],
};

// View-weighted niche keyword bank — same logic as reclassifyChannelNiches.js
const NICHE_TITLE_KEYWORDS = {
  finance:        ['invest', 'stock', 'mutual fund', 'sip ', 'trading', 'crypto', 'bitcoin', 'nifty', 'sensex', 'ipo', 'dividend', 'portfolio', 'tax ', 'loan', 'insurance', 'saving', 'budget', 'wealth', 'financial', 'share market', 'demat', 'inflation'],
  gadgets:        ['gadget', 'invention', 'satisfying', 'amazing gadget', 'amazing invention', 'chinese gadget', 'japan gadget', 'amazing tool', 'cool gadget', 'amazon gadget', 'kitchen gadget', 'school gadget', 'prank gadget', 'amazing machine', 'amazing thing'],
  technology:     ['phone review', 'smartphone', 'laptop review', 'iphone', 'android', 'camera review', 'coding', 'programming', 'software', 'app review', 'tech review', 'unboxing', 'benchmark', 'vs samsung', 'macbook', 'best phone', 'best laptop'],
  fitness:        ['workout', 'exercise', 'hiit', 'training', 'squat', 'cardio', 'muscle', 'gym', 'abs', 'plank', 'weight loss', 'fat loss', 'bodybuilding', 'strength', 'pushup', 'pull up', 'deadlift', 'bench press', 'home workout', 'full body', 'calorie burn'],
  health:         ['health tips', 'doctor', 'medicine', 'disease', 'symptoms', 'treatment', 'ayurved', 'nutrition', 'vitamin', 'supplement', 'blood sugar', 'blood pressure', 'diabetes', 'thyroid', 'gut health', 'home remedy', 'natural cure', 'immune system'],
  food:           ['recipe', 'how to cook', 'street food', 'restaurant review', 'food review', 'biryani', 'chef', 'taste test', 'food challenge', 'cooking tutorial', 'dinner recipe', 'breakfast recipe', 'dal', 'curry', 'thali', 'dosa', 'samosa', 'dessert', 'baking'],
  travel:         ['travel vlog', 'trip to', 'visiting', 'travel guide', 'destination', 'hotel review', 'backpacking', 'solo travel', 'road trip', 'itinerary', 'things to do in', 'travel tips', 'budget travel', 'hidden gem'],
  gaming:         ['gameplay', 'pubg', 'free fire', 'minecraft', 'gta', 'fortnite', 'valorant', 'esport', 'game review', 'speedrun', 'walkthrough', 'game tips', 'mobile gaming', 'cod mobile', 'bgmi'],
  education:      ['history of', 'how does', 'why did', 'science explained', 'facts about', 'what is ', 'explained simply', 'universe', 'physics', 'biology', 'chemistry', 'math', 'engineering', 'psychology', 'philosophy', 'how it works'],
  comedy:         ['comedy', 'funny', 'prank', 'roast', 'stand up', 'meme', 'parody', 'trolling', 'reaction video', 'try not to laugh', 'fails', 'funny moments'],
  news:           ['news', 'current affairs', 'politics', 'government', 'election', 'controversy', 'exposed', 'debate', 'policy', 'minister', 'parliament', 'modi', 'breaking news', 'scam', 'corruption'],
  business:       ['business idea', 'entrepreneur', 'startup', 'marketing strategy', 'how to start', 'ecommerce', 'dropshipping', 'freelancing', 'side hustle', 'make money online', 'digital marketing', 'brand building'],
  lifestyle:      ['morning routine', 'night routine', 'day in my life', 'room tour', 'apartment tour', 'what i eat', 'get ready with me', 'productive day', 'weekly vlog', 'study with me'],
  motivation:     ['motivation', 'success mindset', 'discipline', 'self improvement', 'stoicism', 'goal setting', 'never give up', 'success story', 'life lesson', 'inspirational', 'mental strength'],
  music:          ['music video', 'song', 'singing', 'guitar tutorial', 'piano', 'album', 'concert', 'music cover', 'beats', 'music production', 'rap', 'hip hop', 'new song', 'official video'],
  sports:         ['cricket', 'ipl', 'football', 'match highlights', 'player profile', 'tournament', 'world cup', 'test match', 'odi', 't20', 'premier league'],
  beauty:         ['makeup tutorial', 'skincare routine', 'beauty hacks', 'fashion', 'outfit', 'haul', 'foundation', 'lipstick', 'eyeshadow', 'beauty tips', 'skin glow', 'haircare', 'nail art'],
  yoga:           ['yoga', 'meditation', 'mindfulness', 'breathing exercise', 'asana', 'pranayama', 'guided meditation', 'stress relief', 'yoga for beginners', 'morning yoga', 'yoga flow'],
  entertainment:  ['react', 'reaction', 'movie review', 'web series review', 'bollywood', 'netflix', 'trailer reaction', 'celebrity', 'award', 'interview', 'behind the scenes'],
};

// Build SQL LIKE fragment for a niche's keywords
function nicheKeywordSQL(niche) {
  const keywords = NICHE_TITLE_KEYWORDS[niche] || NICHE_TITLE_KEYWORDS[niche?.toLowerCase()] || [];
  if (!keywords.length) return null;
  return keywords.map(() => `lower(iv.title) LIKE ?`).join(' OR ');
}

function nicheKeywordParams(niche) {
  const keywords = NICHE_TITLE_KEYWORDS[niche] || NICHE_TITLE_KEYWORDS[niche?.toLowerCase()] || [];
  return keywords.map(kw => `%${kw}%`);
}

// Filter out peers whose niche-relevant views are < 5% of total avg views.
// Only applied when target channel has high avg views (avoids penalising small channels).
// Skips filter entirely when niche has no keyword bank entry.
function filterByNicheRelevance(db, targetNiche, peerIds) {
  if (!peerIds.length) return peerIds;
  const sqlFrag = nicheKeywordSQL(targetNiche);
  if (!sqlFrag) return peerIds; // no keyword bank for this niche — skip filter

  const params    = nicheKeywordParams(targetNiche);
  const ph        = peerIds.map(() => '?').join(',');

  const rows = db.all(`
    SELECT
      iv.channel_id,
      AVG(iv.views)                                                                AS total_avg,
      AVG(CASE WHEN (${sqlFrag}) THEN iv.views ELSE NULL END)                      AS niche_avg
    FROM ingested_videos iv
    WHERE iv.channel_id IN (${ph}) AND iv.views > 0
    GROUP BY iv.channel_id
    HAVING COUNT(*) >= 5
  `, [...params, ...peerIds]);

  const keep = new Set(peerIds); // default: keep everything
  for (const r of rows) {
    if (!r.total_avg || r.total_avg < 10000) continue; // too small — skip filter
    const ratio = (r.niche_avg || 0) / r.total_avg;
    if (ratio < 0.05) keep.delete(r.channel_id);
  }
  return peerIds.filter(id => keep.has(id));
}

function resolvePeersLegacy(db, channel, { exclude_channel_id, minSize = 20, limit = 200 } = {}) {
  const results = [];

  const primaryNiche = channel.primary_niche || channel.niche;
  const clusterNiches = NICHE_CLUSTERS[primaryNiche] || [primaryNiche];

  let topics = [];
  try { topics = JSON.parse(channel.inferred_topics || '[]'); } catch (_) {}
  const primaryTopic = topics[0] || null;

  // Level 1: same primary inferred topic
  if (primaryTopic) {
    const rows = db.all(
      `SELECT channel_id FROM ingested_channels
       WHERE json_extract(inferred_topics, '$[0]') = ?
         AND channel_id != ? AND ingest_enabled = 1
         AND (ignore_from_benchmarks IS NULL OR ignore_from_benchmarks = 0)
       LIMIT ?`,
      [primaryTopic, exclude_channel_id, limit],
    );
    for (const r of rows) if (!results.includes(r.channel_id)) results.push(r.channel_id);
  }
  if (results.length >= minSize) return applyFilters(db, channel, results, limit);

  // Level 2: shared inferred_topic within same niche cluster
  if (topics.length > 0 && clusterNiches.length > 0) {
    const phTopics = topics.map(() => '?').join(',');
    const phNiches = clusterNiches.map(() => '?').join(',');
    const rows = db.all(
      `SELECT DISTINCT ic.channel_id
       FROM ingested_channels ic, json_each(ic.inferred_topics) jt
       WHERE jt.value IN (${phTopics})
         AND (ic.primary_niche IN (${phNiches}) OR ic.niche IN (${phNiches}))
         AND ic.channel_id != ? AND ic.ingest_enabled = 1
         AND (ic.ignore_from_benchmarks IS NULL OR ic.ignore_from_benchmarks = 0)
       LIMIT ?`,
      [...topics, ...clusterNiches, ...clusterNiches, exclude_channel_id, limit],
    );
    for (const r of rows) if (!results.includes(r.channel_id)) results.push(r.channel_id);
  }

  // Level 3: full niche cluster
  if (clusterNiches.length > 0) {
    const ph = clusterNiches.map(() => '?').join(',');
    const rows = db.all(
      `SELECT channel_id FROM ingested_channels
       WHERE (niche IN (${ph}) OR primary_niche IN (${ph}))
         AND channel_id != ? AND ingest_enabled = 1
         AND (ignore_from_benchmarks IS NULL OR ignore_from_benchmarks = 0)
       LIMIT ?`,
      [...clusterNiches, ...clusterNiches, exclude_channel_id, limit],
    );
    for (const r of rows) if (!results.includes(r.channel_id)) results.push(r.channel_id);
  }

  return applyFilters(db, channel, results, limit);
}

function applyFilters(db, channel, results, limit) {
  if (!results.length) return results;

  // Drop channels explicitly tagged EN when target is IN
  const targetRegion = channel.region || null;
  if (targetRegion === 'IN') {
    const ph = results.map(() => '?').join(',');
    const excluded = new Set(
      db.all(
        `SELECT channel_id FROM ingested_channels WHERE channel_id IN (${ph}) AND region = 'EN'`,
        results,
      ).map(r => r.channel_id),
    );
    if (excluded.size > 0) results.splice(0, results.length, ...results.filter(id => !excluded.has(id)));
  }

  // Drop non-Indian-language channels when target is English
  const targetLang = channel.primary_language || null;
  if (targetLang === 'en') {
    const ph = results.map(() => '?').join(',');
    const excluded = new Set(
      db.all(
        `SELECT channel_id FROM ingested_channels
         WHERE channel_id IN (${ph})
           AND primary_language IS NOT NULL AND primary_language NOT IN ('en','hi')`,
        results,
      ).map(r => r.channel_id),
    );
    if (excluded.size > 0) results.splice(0, results.length, ...results.filter(id => !excluded.has(id)));
  }

  // Layer 1: view-weighted niche relevance filter
  const targetNiche = channel.primary_niche || channel.niche;
  if (targetNiche && results.length > 0) {
    const before  = results.length;
    const filtered = filterByNicheRelevance(db, targetNiche, results);
    if (filtered.length < before) {
      results.splice(0, results.length, ...filtered);
    }
  }

  return results.slice(0, limit);
}

function resolvePeers(db, channel, opts = {}) {
  const { exclude_channel_id, limit = 200 } = opts;
  const channelId = channel?.channel_id || exclude_channel_id;

  if (channelId) {
    try {
      const ctx = resolveCreatorPeerContext(db, channelId, {
        niche: channel?.primary_niche || channel?.niche || null,
        userSubs: channel?.channel_subscribers || 0,
      });
      if (ctx.peerIds?.length) {
        return ctx.peerIds
          .filter(id => id !== channelId)
          .slice(0, limit);
      }
    } catch (e) {
      console.warn('[copilotPeerHelper] profile-aware resolver failed:', e.message);
    }
  }

  return resolvePeersLegacy(db, channel, opts);
}

module.exports = { resolvePeers };

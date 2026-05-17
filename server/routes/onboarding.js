'use strict';

// ── Channel onboarding pipeline ───────────────────────────────────────────────
// POST /api/intel/onboard-channel  { channel_id }
//
// Full pipeline for a channel that doesn't exist in our DB yet:
//   1. Fetch channel data from YouTube API
//   2. Cache raw JSON in channel_cache
//   3. Upsert into ingested_channels (ingest_enabled = 1)
//   4. Upsert into corpus_channels
//   5. Detect country → store in region
//   6. Fetch recent video titles from uploads playlist
//   7. Detect niche: keyword match → OpenAI classifyChannel fallback
//   8. Infer community_id from niche + subscriber range
//   9. Persist niche + community + full identity
//  10. Trigger historical video ingest in background

const express = require('express');
const router  = express.Router();
const { getDb }                  = require('../db/init');
const { classifyChannel }        = require('../services/channelClassifier');
const { upsertIngestedChannel, saveChannelIdentity } = require('../db/queries');
const { detectChannelCountry }   = require('../jobs/languageDetectionJob');
const { ingestChannel }          = require('../jobs/historicalIngest');

// ── Niche keyword detection ───────────────────────────────────────────────────

const NICHE_KEYWORDS = {
  geopolitics:      ['geopolitics', 'foreign policy', 'international relations', 'diplomacy', 'nato', 'sanctions',
                     'strait of hormuz', 'middle east', 'indo-pacific', 'nuclear deal', 'ceasefire', 'iran',
                     'ukraine war', 'taiwan strait', 'world war', 'global order', 'strategic affairs',
                     'major gaurav', 'chanakya', 'proxy war', 'cold war', 'trade war', 'hegemony',
                     'superpower', 'regime change', 'coup', 'g20', 'g7', 'brics', 'quad', 'sco',
                     'un security council', 'south china sea', 'border dispute', 'lac', 'loc',
                     'surgical strike', 'cross border', 'terror attack', 'insurgency', 'buffer zone',
                     'china', 'russia', 'pakistan', 'israel', 'palestine', 'north korea', 'taiwan',
                     'ukraine', 'saudi arabia', 'turkey', 'usa policy', 'american foreign', 'alliance',
                     'nuclear', 'geopolitical'],
  defence:          ['defence', 'defense', 'military', 'army', 'navy', 'air force', 'missile', 'hypersonic',
                     'drdo', 'war strategy', 'fighter jet', 'warship', 'ammunition', 'soldier', 'combat',
                     'pentagon', 'isro defense', 'tank', 'submarine', 'aircraft carrier', 'drone warfare',
                     'special forces', 'commando', 'artillery', 'brahmos', 'rafale', 'tejas', 'agni',
                     's-400', 'f-35', 'iaf', 'indian army', 'indian navy', 'coast guard', 'defence budget',
                     'make in india defence', 'nuclear submarine', 'border patrol', 'armed forces',
                     'weapons system', 'war games', 'military exercise', 'regiment', 'battalion'],
  politics:         ['politics', 'political', 'government', 'election', 'parliament', 'democracy', 'rajya',
                     'lok sabha', 'minister', 'modi', 'rahul', 'policy', 'ideology', 'bjp', 'congress',
                     'aap', 'cm', 'mla', 'mp', 'chief minister', 'opposition', 'vote', 'constituency',
                     'mamata', 'kejriwal', 'yogi', 'assembly', 'state government'],
  selfimprovement:  ['self improvement', 'self help', 'personal development', 'motivation', 'productivity',
                     'discipline', 'habits', 'confidence', 'mindset', 'success mindset', 'growth mindset',
                     'mental health', 'therapy', 'anxiety', 'depression', 'psychology', 'wellbeing',
                     'life coach', 'morning routine', 'atomic habits', 'sandeep maheshwari', 'vivek bindra',
                     'overthinking', 'stress', 'emotional intelligence', 'self awareness', 'journaling',
                     'manifestation', 'positive thinking', 'inner peace', 'healing', 'subconscious',
                     'personality', 'social skills', 'communication skills', 'imposter syndrome',
                     'burnout', 'resilience', 'purpose', 'ikigai', 'self discipline'],
  education:        ['education', 'learn', 'tutorial', 'study', 'teaching', 'school', 'upsc', 'ias', 'exam',
                     'lecture', 'course', 'knowledge', 'university'],
  technology:       ['tech', 'software', 'coding', 'programming', 'gadget', 'smartphone', 'ai',
                     'machine learning', 'developer', 'cybersecurity', 'startup'],
  finance:          ['finance', 'investing', 'stock market', 'mutual fund', 'money', 'wealth', 'trading',
                     'budget', 'economy', 'crypto', 'personal finance'],
  entertainment:    ['entertainment', 'fun', 'viral', 'trending', 'memes', 'reaction', 'celebrity',
                     'bollywood', 'movies', 'web series'],
  gaming:           ['gaming', 'game', 'esports', 'playthrough', 'minecraft', 'pubg', 'free fire',
                     'valorant', 'gamer', 'gameplay'],
  lifestyle:        ['lifestyle', 'vlog', 'daily life', 'day in my life', 'family', 'routine', 'grwm'],
  health:           ['health', 'fitness', 'workout', 'yoga', 'ayurveda', 'diet', 'wellness', 'doctor',
                     'medical', 'nutrition'],
  food:             ['food', 'recipe', 'cooking', 'chef', 'kitchen', 'restaurant', 'cuisine', 'baking',
                     'khana'],
  travel:           ['travel', 'adventure', 'explore', 'destination', 'trip', 'journey', 'wanderlust'],
  music:            ['music', 'song', 'singer', 'album', 'rap', 'hip hop', 'cover', 'musician', 'beat'],
  comedy:           ['comedy', 'funny', 'humor', 'laugh', 'sketch', 'prank', 'standup', 'roast'],
  news:             ['news', 'breaking', 'current affairs', 'samachar', 'daily news', 'latest update',
                     'reporter'],
  business:         ['business', 'entrepreneur', 'startup', 'marketing', 'sales', 'growth', 'brand'],
  sports:           ['sports', 'cricket', 'football', 'ipl', 'match', 'athlete', 'tournament', 'score'],
  science:          ['science', 'space', 'physics', 'chemistry', 'biology', 'research', 'experiment', 'nasa'],
  philosophy:       ['philosophy', 'stoicism', 'wisdom', 'consciousness', 'eastern philosophy', 'vedanta',
                     'advaita', 'upanishad', 'bhagavad gita', 'existentialism'],
};

function guessNiche(title, description) {
  const text = `${title} ${description}`.toLowerCase();
  let best = null, bestScore = 0;
  for (const [niche, kws] of Object.entries(NICHE_KEYWORDS)) {
    const score = kws.filter(kw => text.includes(kw)).length;
    if (score > bestScore) { bestScore = score; best = niche; }
  }
  return bestScore >= 1 ? best : null;
}

// ── YouTube topic category → niche ───────────────────────────────────────────
// YouTube returns Wikipedia URLs like https://en.wikipedia.org/wiki/Entertainment

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

// ── Inline community inference (same logic as /api/intel/community/infer) ────

function inferCommunityId(db, niche, subs) {
  if (!niche) return null;
  const lo = Math.max(0, Math.floor(subs * 0.2));
  const hi = Math.ceil(subs * 5);
  const row = db.get(
    `SELECT community_id FROM corpus_channels
     WHERE niche = ? AND subscriber_count BETWEEN ? AND ? AND community_id IS NOT NULL
     GROUP BY community_id ORDER BY COUNT(*) DESC LIMIT 1`,
    [niche, lo, hi],
  ) || db.get(
    `SELECT community_id FROM corpus_channels
     WHERE niche = ? AND community_id IS NOT NULL
     GROUP BY community_id ORDER BY COUNT(*) DESC LIMIT 1`,
    [niche],
  );
  return row?.community_id ?? null;
}

// ── Route ─────────────────────────────────────────────────────────────────────

router.post('/onboard-channel', async (req, res) => {
  const { channel_id } = req.body;
  if (!channel_id) return res.status(400).json({ error: 'channel_id required' });

  const apiKey = process.env.YT_API_KEY || process.env.YOUTUBE_API_KEY;
  if (!apiKey) return res.status(503).json({ error: 'YouTube API key not configured' });

  const db = getDb();

  // 1. Already fully onboarded?
  const existing = db.get(
    'SELECT channel_id, channel_name, channel_subscribers, niche, community_id, region FROM ingested_channels WHERE channel_id = ?',
    [channel_id],
  );
  if (existing?.niche && existing?.community_id) {
    // Pull thumbnail from corpus_channels or channel_cache
    const thumbRow = db.get('SELECT thumbnail_url FROM corpus_channels WHERE channel_id = ?', [channel_id]);
    let thumbnail = thumbRow?.thumbnail_url || null;
    if (!thumbnail) {
      const cacheRow = db.get('SELECT raw_json FROM channel_cache WHERE channel_id = ? AND raw_json IS NOT NULL', [channel_id]);
      if (cacheRow?.raw_json) {
        try {
          const parsed = JSON.parse(cacheRow.raw_json);
          thumbnail = parsed?.snippet?.thumbnails?.medium?.url || parsed?.snippet?.thumbnails?.default?.url || null;
        } catch (_) {}
      }
    }
    return res.json({ ...existing, name: existing.channel_name, subs: existing.channel_subscribers, thumbnail, already_existed: true });
  }

  // 2. Fetch from YouTube API
  let item;
  try {
    const ytResp = await fetch(
      `https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics,contentDetails,topicDetails&id=${channel_id}&key=${apiKey}`,
    );
    const ytData = await ytResp.json();
    item = ytData.items?.[0];
    if (!item) return res.status(404).json({ error: 'Channel not found on YouTube' });
  } catch (e) {
    return res.status(502).json({ error: `YouTube API error: ${e.message}` });
  }

  const name              = item.snippet.title;
  const subs              = parseInt(item.statistics?.subscriberCount || '0', 10);
  const country           = item.snippet?.country?.toUpperCase() || null;
  const description       = item.snippet?.description || '';
  const uploadsPlaylistId = item.contentDetails?.relatedPlaylists?.uploads || null;
  const topicCategories   = item.topicDetails?.topicCategories || [];
  const thumbnail         = item.snippet?.thumbnails?.medium?.url || item.snippet?.thumbnails?.default?.url || null;

  // 3. Cache raw JSON in channel_cache
  try {
    db.run(
      `INSERT INTO channel_cache (channel_id, raw_json, cached_at)
       VALUES (?, ?, ?)
       ON CONFLICT(channel_id) DO UPDATE SET raw_json = excluded.raw_json, cached_at = excluded.cached_at`,
      [channel_id, JSON.stringify(item), new Date().toISOString()],
    );
  } catch (_) {}

  // 4. Upsert into ingested_channels
  upsertIngestedChannel(db, {
    channel_id,
    channel_name:        name,
    channel_subscribers: subs,
    uploads_playlist_id: uploadsPlaylistId,
    added_by:            'user_onboard',
    notes:               'Auto-onboarded via search',
  });
  db.run(`UPDATE ingested_channels SET ingest_enabled = 1 WHERE channel_id = ?`, [channel_id]);
  if (country) {
    db.run(`UPDATE ingested_channels SET region = ? WHERE channel_id = ? AND region IS NULL`, [country, channel_id]);
  }

  // 5. Upsert into corpus_channels
  try {
    db.run(
      `INSERT INTO corpus_channels (channel_id, title, subscriber_count)
       VALUES (?, ?, ?)
       ON CONFLICT(channel_id) DO UPDATE SET
         title            = COALESCE(excluded.title, title),
         subscriber_count = COALESCE(excluded.subscriber_count, subscriber_count)`,
      [channel_id, name, subs],
    );
  } catch (_) {}

  // 6. Fetch recent video titles (for niche detection)
  let titles = [];
  if (uploadsPlaylistId) {
    try {
      const plResp = await fetch(
        `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&playlistId=${uploadsPlaylistId}&maxResults=50&key=${apiKey}`,
      );
      if (plResp.ok) {
        const plData = await plResp.json();
        titles = (plData.items || []).map(i => i.snippet?.title).filter(Boolean);
      }
    } catch (e) {
      console.warn(`[onboard] ${channel_id} playlist error:`, e.message);
    }
  }

  // 7. Detect niche: topic categories → keyword → OpenAI
  let niche    = nicheFromTopicCategories(topicCategories) || guessNiche(name, description);
  let identity = null;

  if (!niche && process.env.OPENAI_API_KEY && (titles.length > 0 || description)) {
    const inputTitles = titles.length > 0 ? titles : [name, ...description.slice(0, 400).split('\n').filter(Boolean)];
    try {
      identity = await classifyChannel({ channelName: name, titles: inputTitles, description: description || null });
      niche    = identity?.primary_niche || null;
      console.log(`[onboard] ${name} → OpenAI niche: ${niche}`);
    } catch (e) {
      console.warn(`[onboard] ${channel_id} classifyChannel error:`, e.message);
    }
  }

  niche = niche || 'other';

  // 8. Infer community_id
  const communityId = inferCommunityId(db, niche, subs);

  // 9. Persist niche + community_id
  db.run(
    `UPDATE ingested_channels SET niche = ?, community_id = ? WHERE channel_id = ?`,
    [niche, communityId, channel_id],
  );
  db.run(
    `UPDATE corpus_channels SET niche = ?, community_id = ?, subscriber_count = ? WHERE channel_id = ?`,
    [niche, communityId, subs, channel_id],
  );

  if (identity) {
    const channelRow = db.get('SELECT id FROM ingested_channels WHERE channel_id = ?', [channel_id]);
    if (channelRow) {
      try {
        saveChannelIdentity(db, channelRow.id, { ...identity, identity_source: 'openai' });
      } catch (_) {}
    }
  }

  // 10. Background: country detection + historical video ingest
  detectChannelCountry(channel_id).catch(() => {});
  const fullChannel = db.get('SELECT * FROM ingested_channels WHERE channel_id = ?', [channel_id]);
  if (fullChannel) {
    ingestChannel(fullChannel).catch(e => console.warn(`[onboard] ingest error for ${channel_id}:`, e.message));
  }

  console.log(`[onboard] ${name} → niche=${niche} community=${communityId} subs=${subs}`);

  res.json({
    channel_id,
    name,
    subs,
    niche,
    community_id: communityId,
    region:       country,
    thumbnail,
    titles_count: titles.length,
    identity_source: identity ? 'openai' : (niche !== 'other' ? 'keyword' : 'fallback'),
  });
});

module.exports = router;

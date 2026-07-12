'use strict';

// Social-platform / format noise tokens specific to community-hot phrase extraction.
const STOP = new Set([
  // Grammar / function words
  'the','a','an','in','on','of','to','for','is','are','was','were',
  'and','or','but','not','with','by','from','at','this','that','it',
  'he','she','they','we','i','you','be','been','being','have','has',
  'had','do','does','did','will','would','could','should','may','might',
  'as','if','so','then','than','just','also','very','more','most',
  'why','how','what','when','where','which','who','here','there',
  'its','his','her','our','their','your','my','into','up','out','over',
  'news','today','latest','new','big','breaking','live','watch','full',
  'video','episode','part','series','like','know','make','says','said',
  // Month names — filter date phrases like "april 2026"
  'january','february','march','april','june','july','august',
  'september','october','november','december',
  // Romanised Hindi function words
  'hai','hain','hoga','kya','kaise','mera','meri','mere','aap','main',
  'yeh','woh','ek','nahi','aur','se','ko','ka','ki','ke','mein','hum',
  'bhi','toh','koi','kuch','sirf','sab','tha','thi','raha','rahi',
  'karo','karna','karte','karke','rehe','rahe','gaye','gaya',
  // Devanagari Hindi function words / verb fragments
  'रहे','हैं','है','हो','ने','भी','जो','तो','बहुत','कभी','सकते','करते',
  'आज','कल','यहां','वहां','इसे','उसे','हमें','आपको','उनका','इनका',
  'बनाए','जाते','करेंगे','होगा','मिलेगा','देगा','लेगा','बताया',
  // Marathi function words / verb fragments
  'करू','नका','आहे','आणि','हे','ते','मी','तू','तुम्ही','आम्ही','त्यांना',
  'करणे','केले','केली','करतो','करती','असेल','नाही','पण','किंवा','म्हणजे',
  // Hindi question/negation words (prevent "क्यों नहीं" type fragments)
  'क्यों','नहीं','क्या','कैसे','कौन','कहाँ','कब',
  'देगी','देनी','छोड़ो','बनाओ','करोगे',
  'marathi','hindi',
  'kata','ibu','doa','untuk','bijak','mutiara','kekuatan',
  // Common hashtag-driven social words
  'love','life','time','come','feel','want','need',
  // Hook/imperative fragments — common title patterns that aren't content topics
  'must','old','hello','namaskar','namaste','blowing','doing','tells','about',
  // Social-media / hashtag noise — these are platform mechanics, not content topics
  'shorts','viral','trending','ytshorts','minivlog','youtubeshorts',
  'viralvideo','shortsfeed','ashortaday','shortvideo','reels','tiktok',
  'subscribe','comment','share','follow','notification','bell','click',
  'trend','trendy','explore','fyp','foryou','foryoupage',
]);

const SOUTH_SCRIPT_RE_HOT = /[஀-௿ఀ-౿ಀ-೿ഀ-ൿ]/;

const INDIC_SCRIPT_RE_HOT = /[\u0900-\u0D7F]/;

function extractUserPhraseSet(text) {
  const set = new Set();
  const words = text.split(/\s+/).filter(w => w.length > 3);
  for (let i = 0; i < words.length - 1; i++) {
    set.add(words[i] + ' ' + words[i + 1]);
    if (i < words.length - 2) set.add(words[i] + ' ' + words[i + 1] + ' ' + words[i + 2]);
  }
  return set;
}

function buildWhyLine(item) {
  const plural = item.channel_count === 1 ? 'channel' : 'channels';
  const recentLine = item.recent_count > 0
    ? `${item.recent_count} recent peer video${item.recent_count === 1 ? '' : 's'} in the last 45 days`
    : 'fresh peer coverage in the last 90 days';
  return `${item.channel_count} peer ${plural} pulled ${item.total_views.toLocaleString('en-US')} total views on this phrase, led by ${item.top_channel || 'a peer channel'} and backed by ${recentLine}.`;
}

function buildCommunityHotItems(videos, userPhraseSet, peerCount, DEVANAGARI_RE) {
  const topicMap = new Map();
  const nowMs = Date.now();
  for (const video of videos) {
    const rawTitle = video.title || '';
    if (SOUTH_SCRIPT_RE_HOT.test(rawTitle) || INDIC_SCRIPT_RE_HOT.test(video.channel_name || '')) continue;
    const tokens = rawTitle
      .replace(/#\w+/g, ' ')
      .replace(/\|{2}[^|]+\|{2}/g, ' ')
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 2 && !STOP.has(w) && !/^\d+$/.test(w) && !DEVANAGARI_RE.test(w));

    const phrases = new Set();
    for (let i = 0; i < tokens.length; i++) {
      if (i < tokens.length - 1) phrases.add(tokens[i] + ' ' + tokens[i+1]);
      if (i < tokens.length - 2) phrases.add(tokens[i] + ' ' + tokens[i+1] + ' ' + tokens[i+2]);
    }

    for (const phrase of phrases) {
      if (userPhraseSet.has(phrase)) continue;
      if (!topicMap.has(phrase)) {
        topicMap.set(phrase, {
          total_views: 0,
          channelIds: new Set(),
          channelMap: new Map(),
          videoIds: new Set(),
          examples: [],
          recent_count: 0,
          top_channel: null,
          top_views: 0,
        });
      }
      const b = topicMap.get(phrase);
      const views = video.views || 0;
      b.total_views += views;
      b.channelIds.add(video.channel_id);
      b.videoIds.add(video.youtube_video_id);
      const ageDays = (nowMs - new Date(video.published_at).getTime()) / 86400000;
      if (ageDays <= 45) b.recent_count++;
      if (views > b.top_views) {
        b.top_views = views;
        b.top_channel = video.channel_name || '';
      }
      if (b.examples.length < 4) {
        b.examples.push({
          title:        video.title,
          views,
          channel_name: video.channel_name || '',
          published_at: video.published_at || null,
        });
      }
      if (!b.channelMap.has(video.channel_id)) {
        b.channelMap.set(video.channel_id, { channel_name: video.channel_name || '', views: 0 });
      }
      b.channelMap.get(video.channel_id).views += views;
    }
  }

  const ranked = [...topicMap.entries()]
    .filter(([, b]) => b.channelIds.size >= 3 || (b.channelIds.size >= 2 && b.total_views >= 250000))
    .sort((a, b) => b[1].total_views - a[1].total_views)
    .slice(0, 200);

  // Collapse fragmented n-grams: phrases drawn from the SAME peer videos that share a word are the
  // same topic ("trump gets" / "gets booed" / "booed falls asleep" → one). Keep the most
  // descriptive (longest) label; this removes the 5-7x duplicate rows the UI was showing.
  const kept = [];
  for (const [phrase, b] of ranked) {
    // Same underlying peer videos ⇒ same topic, regardless of which fragment of the title it is
    // ("trump gets booed" and "falls asleep" come from one video → collapse to one).
    const dupe = kept.find(k => {
      const inter = [...b.videoIds].filter(v => k.b.videoIds.has(v)).length;
      const uni = new Set([...b.videoIds, ...k.b.videoIds]).size;
      return uni > 0 && inter / uni >= 0.6;
    });
    if (dupe) {
      if (phrase.split(' ').length > dupe.phrase.split(' ').length) dupe.phrase = phrase;
      continue;
    }
    kept.push({ phrase, b });
    if (kept.length >= 30) break;
  }

  return kept.map(({ phrase, b }) => {
    const item = {
      topic:         phrase,
      total_views:   b.total_views,
      avg_views:     Math.round(b.total_views / Math.max(1, b.videoIds.size)),
      channel_count: b.channelIds.size,
      video_count:   b.videoIds.size,
      peer_count:    peerCount,
      recent_count:  b.recent_count,
      top_channel:   b.top_channel,
      examples:      b.examples,
      channels:      [...b.channelMap.values()]
                       .sort((a, z) => z.views - a.views)
                       .slice(0, 5),
    };
    return { ...item, why: buildWhyLine(item) };
  });
}

// Main entry point called by the /community-hot route handler.
// ctx = { resolveCreatorPeerContext, cache, DEVANAGARI_RE }
function computeCommunityHot(db, channel, ctx) {
  const { resolveCreatorPeerContext, cache, DEVANAGARI_RE } = ctx;
  const channel_id = channel.channel_id;

  return cache.wrap(`community_hot_v7:${channel_id}`, () => {
    const ownVideos = db.all(
      `SELECT title FROM ingested_videos WHERE channel_id = ? AND published_at > datetime('now', '-90 days') LIMIT 100`,
      [channel_id],
    );
    const ownText = ownVideos.map(r => (r.title || '').toLowerCase()).join(' ');

    const _ctx = resolveCreatorPeerContext(db, channel_id, {
      userSubs: channel.channel_subscribers || 0,
    });
    let peerIds = _ctx.peerIds;
    if (!peerIds.length) return { ok: true, items: [], peer_count: 0 };

    // Region-aware: a Western channel's hot topics must come from same-MARKET peers, not the whole
    // English bucket (which includes Indian-English channels → Bollywood/cricket topics like
    // "diljit dosanjh", "sara ali khan", "mashable india" on a US talk show).
    const WESTERN = new Set(['US', 'CA', 'GB', 'EN', 'AU', 'IE', 'NZ']);
    const _chRegion = channel.region || (db.get(`SELECT region FROM ingested_channels WHERE channel_id=?`, [channel_id]) || {}).region;
    if (WESTERN.has(_chRegion) && peerIds.length) {
      const _rph = peerIds.map(() => '?').join(',');
      const _reg = {};
      for (const r of db.all(`SELECT channel_id, region FROM ingested_channels WHERE channel_id IN (${_rph})`, peerIds)) _reg[r.channel_id] = r.region;
      peerIds = peerIds.filter(id => WESTERN.has(_reg[id]));
      if (!peerIds.length) return { ok: true, items: [], peer_count: 0 };
    }

    // Drop MUSIC-niche peers for a non-music creator: their topics ("official music", "lyric
    // video", artist names) dominate by raw view count and are never a "hot topic" a talk show /
    // most creators would actually make. (ArianaGrandeVevo, theneedledrop, etc.)
    const _chNiche = String(channel.primary_niche || channel.niche || (db.get(`SELECT COALESCE(primary_niche,niche) n FROM ingested_channels WHERE channel_id=?`, [channel_id]) || {}).n || '').toLowerCase();
    if (_chNiche !== 'music' && peerIds.length) {
      const _mph = peerIds.map(() => '?').join(',');
      const _music = new Set(db.all(`SELECT channel_id FROM ingested_channels WHERE channel_id IN (${_mph}) AND LOWER(COALESCE(primary_niche, niche))='music'`, peerIds).map(r => r.channel_id));
      if (_music.size) peerIds = peerIds.filter(id => !_music.has(id));
      if (!peerIds.length) return { ok: true, items: [], peer_count: 0 };
    }

    const targetEnglish = channel.primary_language === 'en'
      || (!channel.primary_language && ownVideos.length >= 5 && ownVideos.every(({ title }) => !INDIC_SCRIPT_RE_HOT.test(title || '')));
    if (targetEnglish && peerIds.length > 0) {
      const metaPh = peerIds.map(() => '?').join(',');
      const peerRows = db.all(
        `SELECT channel_id, channel_name, primary_language
         FROM ingested_channels
         WHERE channel_id IN (${metaPh})`,
        peerIds,
      );
      const blocked = new Set(
        peerRows
          .filter(r => (r.primary_language && r.primary_language !== 'en') || INDIC_SCRIPT_RE_HOT.test(r.channel_name || ''))
          .map(r => r.channel_id),
      );
      if (blocked.size > 0) peerIds = peerIds.filter(id => !blocked.has(id));
      if (!peerIds.length) return { ok: true, items: [], peer_count: 0 };
    }

    let topics = [];
    try { topics = JSON.parse(channel.inferred_topics || '[]'); } catch (_) {}
    const primaryTopic = topics[0] || null;

    const ph = peerIds.map(() => '?').join(',');
    const videos = db.all(
      `SELECT youtube_video_id, title, views, published_at, channel_id, channel_name
       FROM (
         SELECT iv.youtube_video_id, iv.title, iv.views, iv.published_at,
                iv.channel_id, ic.channel_name,
                ROW_NUMBER() OVER (PARTITION BY iv.channel_id ORDER BY iv.views DESC) AS rn
         FROM ingested_videos iv
         JOIN ingested_channels ic ON ic.channel_id = iv.channel_id
         WHERE iv.channel_id IN (${ph})
           AND iv.published_at > datetime('now', '-90 days')
           AND iv.title IS NOT NULL AND iv.title != ''
           AND iv.views > 0
       ) WHERE rn <= 10`,
      peerIds,
    );
    if (!videos.length) return { ok: true, items: [], peer_count: peerIds.length };

    const userPhraseSet = extractUserPhraseSet(ownText);
    let items = buildCommunityHotItems(videos, userPhraseSet, peerIds.length, DEVANAGARI_RE);

    const _isExamCreator = _ctx.creator_mode === 'upsc' || _ctx.rp_result?.profile === 'upsc_exam';
    if (!_isExamCreator && items.length > 0) {
      const EXAM_TOPIC_RE = /\bneet\b|\bjee\b|\bupsc\b|\badmit card\b|\bcutoff\b|\bexam date\b|\bnta\b|\bprelims\b|\bmains\b/;
      items = items.filter(item => !EXAM_TOPIC_RE.test(item.topic));
    }

    return { ok: true, items, peer_count: peerIds.length, primary_topic: primaryTopic };
  }, 20 * 60 * 1000);
}

module.exports = { computeCommunityHot };

'use strict';

// Current-events feed for current-affairs / news channels.
//
// These channels are event-driven: "what to post" = which story on their beat is breaking that
// they haven't covered. There is no external news API wired in, but the RSS sweep keeps the
// internal corpus fresh, so we mine it: recent videos from the same-niche + same-region
// current-affairs pool, indexed into multi-word phrases. A phrase only counts as a real EVENT
// when SEVERAL distinct channels cover it in the window — that single requirement is what
// separates genuine current affairs (multiple outlets cover "india china border") from per-channel
// noise ("cockroach", a one-off title). We then drop anything the creator has already covered.

const GENERIC_TOPIC_STOP = new Set([
  'learning', 'educational', 'education', 'content', 'skills', 'tips', 'guide', 'basics',
  'knowledge', 'tutorial', 'lessons', 'lesson', 'online', 'course', 'courses', 'channel',
  'videos', 'video', 'daily', 'beginners', 'advanced', 'explained', 'through', 'with', 'your',
]);

// Words that carry no event meaning — news furniture, clickbait, romanised/Devanagari function
// words, and platform cruft. Phrases built only from these are dropped.
const PHRASE_STOP = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'not', 'for', 'of', 'to', 'in', 'on', 'at', 'by', 'from',
  'with', 'as', 'is', 'are', 'was', 'were', 'be', 'been', 'this', 'that', 'these', 'those', 'it',
  'its', 'his', 'her', 'their', 'our', 'your', 'my', 'into', 'about', 'over', 'after', 'before',
  'news', 'latest', 'breaking', 'live', 'today', 'update', 'updates', 'hindi', 'english', 'full',
  'video', 'episode', 'part', 'series', 'watch', 'new', 'big', 'top', 'best', 'why', 'how', 'what',
  'when', 'will', 'shorts', 'short', 'viral', 'explained', 'analysis', 'special', 'exclusive',
  'current', 'affairs', 'upsc', 'ias', 'exam', 'gs', 'mains', 'prelims', 'class', 'lecture',
  // exam-prep / coaching furniture — keeps stray education channels from producing pseudo-events
  'mock', 'test', 'shot', 'important', 'questions', 'question', 'practice', 'set', 'study', 'plan',
  'previous', 'year', 'syllabus', 'pattern', 'expected', 'revision', 'objective', 'subjective',
  'marathon', 'board', 'paper', 'quiz', 'batch', 'sir', 'maam', 'blitz', 'mcqs', 'mcq', 'pyq',
  'strategy', 'preparation', 'foundation', 'crash', 'notes', 'chapter', 'topic', 'topics',
  // common romanised Hindi function words
  'ka', 'ki', 'ke', 'hai', 'aur', 'kya', 'se', 'me', 'par', 'ko', 'ek', 'bhi', 'hi', 'nahi',
  // common Devanagari function words
  'का', 'की', 'के', 'है', 'और', 'क्या', 'से', 'में', 'पर', 'को', 'एक', 'भी', 'ही', 'नहीं', 'यह',
]);

const PROMO_RE = /\b(\d{1,3}\s*%\s*off|% off|discount|offer|sale|coupon|enroll|admission|batch|validity|subscribe|join now|use code|flat \d|assured gift|free trial|launch|scholarship|register now|limited time)\b/i;

// Pure sports / entertainment isn't current-affairs material — exclude for news/current-affairs
// creators (national-significant crime like a temple-trust scam still belongs, so crime isn't here).
const SPORTS_ENT_RE = /\b(world cup|fifa|t20|odi|ipl|cricket|football|premier league|la liga|match|vs\b|box office|trailer|teaser|first look|song|movie|film|web series|bollywood|tollywood|actress|actor|celebrity|grammy|oscar|concert)\b/i;

// Topic signals that mark a creator as current-affairs even when not tagged creator_mode='news'
// (e.g. UPSC channels classified as education/lecture but covering politics + editorials).
const CURRENT_AFFAIRS_TOPIC_RE = /current affairs|politics|governance|editorial|geopolitic|international relations|polity|diplomacy|public policy|world affairs|economy/i;

// Relevance biasing — current-affairs creators (UPSC etc.) want governance / polity / international
// / economy events ABOVE sensational local crime or regional gossip, even when crime is covered by
// more channels. POLICY boosts; pure CRIME/personal (without any policy angle) is penalised. A
// governance-flavoured scam ("temple-trust donation scam, SC hearing") still hits POLICY and stays.
const POLICY_RE = /\b(parliament|lok ?sabha|rajya ?sabha|supreme court|high court|verdict|judgement|judgment|constitution|amendment|\bbill\b|\bact\b|ordinance|polic(y|ies)|scheme|budget|econom(y|ic)|\bgdp\b|inflation|\brbi\b|sebi|\btax\b|\bgst\b|tariff|election|\bpoll\b|cabinet|minister|ministry|governor|president|diplomac|summit|treaty|bilateral|border|defence|defense|military|\barmy\b|navy|\bwar\b|geopolitic|united nations|\bun\b|g20|brics|\bsco\b|\btrade\b|sanction|climate|environment|isro|nuclear|missile|securit|terror|attack|ceasefire|foreign|relations|agreement|\bmou\b|reform|scam|corruption|\bcbi\b|\bed\b|enforcement|census|caste|reservation|tribunal|legislation|governance|policy)\b/i;
const CRIME_GOSSIP_RE = /\b(murder|m\*?rder|killed|dead ?body|suicide|\brape\b|molest|affair|girlfriend|boyfriend|love ?story|wedding|honeymoon|divorce|viral ?video|leaked|kidnap|abduct|gangster|shootout|pregnan|elope)\b/i;
// Any non-Devanagari, non-Latin Indian regional script (Bengali..Malayalam). Devanagari (Hindi) is
// national and NOT matched here.
const REGIONAL_SCRIPT_RE = /[ঀ-෿]/gu;

function topicTokens(inferredTopicsJson) {
  let arr = [];
  try { arr = JSON.parse(inferredTopicsJson || '[]'); } catch (_) {}
  const out = new Set();
  for (const phrase of arr) {
    for (const w of String(phrase).toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/)) {
      if (w.length > 3 && !GENERIC_TOPIC_STOP.has(w)) out.add(w);
    }
  }
  return out;
}

function beatOverlap(userTok, inferredTopicsJson) {
  if (!userTok.size) return true; // can't gate → keep
  const ftok = topicTokens(inferredTopicsJson);
  for (const t of ftok) if (userTok.has(t)) return true;
  return false;
}

// Unicode-aware tokeniser: keeps letters/numbers across scripts, drops stopwords + short tokens.
function tokenize(title) {
  return String(title || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(w => w && w.length > 2 && !PHRASE_STOP.has(w) && !/^\d+$/.test(w));
}

// Phrases = adjacent bigrams + trigrams. Multi-word phrases are far less noisy than single words
// and naturally express events ("supreme court verdict", "india china border").
function phrasesOf(tokens) {
  const out = [];
  for (let i = 0; i < tokens.length - 1; i++) {
    out.push(`${tokens[i]} ${tokens[i + 1]}`);
    if (i < tokens.length - 2) out.push(`${tokens[i]} ${tokens[i + 1]} ${tokens[i + 2]}`);
  }
  return out;
}

function titleCase(s) {
  return s.replace(/\b\w/g, c => c.toUpperCase());
}

function getCurrentEvents(db, channelId, opts = {}) {
  const windowDays  = opts.windowDays  ?? 12;
  const minChannels = opts.minChannels ?? 3;
  const maxResults  = opts.maxResults  ?? 12;

  const me = db.get(
    `SELECT COALESCE(primary_niche, niche) AS niche, region, creator_mode, format_profile, primary_language, inferred_topics
       FROM ingested_channels WHERE channel_id = ?`,
    [channelId],
  );
  if (!me || !me.niche) return { supported: false, reason: 'no_channel', events: [] };

  // The feed is ONLY for current-affairs / news creators. Detection: tagged news (creator_mode /
  // format_profile / niche), OR a knowledge-type niche (UPSC channels are niche=education but cover
  // current affairs) whose topic DNA is current-affairs. The niche gate on the topic-fallback is
  // important: without it, a comedy/entertainment channel that merely mentions "politics" in its
  // inferred_topics would wrongly get a news feed. Everyone else → empty (section hidden).
  const NEWS_NICHES = "('news','geopolitics','politics','current affairs')";
  const nicheLow = String(me.niche).toLowerCase();
  const TOPIC_FALLBACK_NICHES = new Set(['education', 'knowledge', 'finance', 'business', 'news', 'politics', 'geopolitics', 'current affairs']);
  const isCurrentAffairs = me.creator_mode === 'news' || me.format_profile === 'news_bulletin'
    || ['news', 'geopolitics', 'politics', 'current affairs'].includes(nicheLow)
    || (TOPIC_FALLBACK_NICHES.has(nicheLow) && CURRENT_AFFAIRS_TOPIC_RE.test(me.inferred_topics || ''));
  if (!isCurrentAffairs) return { supported: false, reason: 'not_current_affairs', events: [] };

  // Current-events beat lives in the NEWS pool — genuine news channels covering the same stories
  // (Monsoon Session, SC verdicts, diplomacy) — NOT the creator's own niche peers (a UPSC channel's
  // "education" peers are exam-coaching channels that post mock tests, not events).
  const userTok = topicTokens(me.inferred_topics);
  const poolRows = db.all(
    `SELECT channel_id, inferred_topics FROM ingested_channels
       WHERE region = ? AND channel_id != ?
         AND (creator_mode = 'news' OR LOWER(COALESCE(primary_niche, niche)) IN ${NEWS_NICHES})
       ORDER BY channel_subscribers DESC LIMIT 600`,
    [me.region, channelId],
  );
  // Beat-overlap gate drops off-beat channels (pure sports/regional-gossip) when the creator has a
  // focused topic DNA; for broad national-news creators (few distinctive tokens) it keeps the pool.
  const poolIds = poolRows.filter(r => beatOverlap(userTok, r.inferred_topics)).map(r => r.channel_id).slice(0, 300);
  if (poolIds.length < minChannels) return { supported: true, pool_size: poolIds.length, events: [] };

  // ── What the creator has already covered (recent + relevant history) → dedupe target ─────────
  const ownPhrases = new Set();
  db.all(
    `SELECT title FROM ingested_videos WHERE channel_id = ? ORDER BY published_at DESC LIMIT 400`,
    [channelId],
  ).forEach(r => { for (const p of phrasesOf(tokenize(r.title))) ownPhrases.add(p); });

  // ── Recent, real (non-short, non-promo) videos from the pool ──────────────────────────────────
  const ph = poolIds.map(() => '?').join(',');
  const vids = db.all(
    `SELECT v.channel_id, v.youtube_video_id, v.title, v.views, v.published_at, c.channel_name,
            (julianday('now') - julianday(v.published_at)) * 24.0 AS age_hours
       FROM ingested_videos v
       JOIN ingested_channels c ON c.channel_id = v.channel_id
      WHERE v.channel_id IN (${ph})
        AND v.published_at >= datetime('now', ?)
        AND COALESCE(v.is_short, 0) = 0
        AND COALESCE(v.duration_seconds, 0) >= 120
        AND v.title IS NOT NULL
      ORDER BY v.published_at DESC
      LIMIT 4000`,
    [...poolIds, `-${windowDays} days`],
  );

  // ── Phrase index: distinct channels + momentum per phrase ─────────────────────────────────────
  const idx = new Map(); // phrase -> { channels:Set, momentum, count, samples:[] }
  for (const v of vids) {
    if (PROMO_RE.test(v.title)) continue;
    if (isCurrentAffairs && SPORTS_ENT_RE.test(v.title)) continue;
    const momentum = (v.views || 0) / Math.max(v.age_hours || 6, 6); // views/hour proxy
    const seen = new Set(); // de-dupe phrases within one title
    for (const p of phrasesOf(tokenize(v.title))) {
      if (seen.has(p)) continue;
      seen.add(p);
      if (ownPhrases.has(p)) continue; // already covered by the creator
      let e = idx.get(p);
      if (!e) { e = { channels: new Set(), titles: new Set(), momentum: 0, count: 0, samples: [] }; idx.set(p, e); }
      e.channels.add(v.channel_id);
      if (e.titles.size < 250) e.titles.add(v.title);
      e.momentum += momentum;
      e.count += 1;
      if (e.samples.length < 12) e.samples.push({ title: v.title, views: v.views, momentum, video_id: v.youtube_video_id, channel_name: v.channel_name });
    }
  }

  // Relevance multiplier: boost governance/polity/international/economy, penalise pure crime/gossip
  // and (for a national Hindi/English creator) regional-language stories. This lifts policy events
  // above heavily-covered crime — coverage alone no longer wins.
  const creatorLang = String(me.primary_language || '').toLowerCase();
  const creatorIsRegional = /^(ta|te|kn|ml|bn|gu|pa|or|as|si)/.test(creatorLang);
  function relevanceMult(phrase, samples) {
    const blob = phrase + ' ' + samples.slice(0, 6).map(s => s.title).join(' ');
    const policy = POLICY_RE.test(blob);
    const crime  = CRIME_GOSSIP_RE.test(blob);
    let mult = policy ? (crime ? 1.25 : 1.6) : (crime ? 0.45 : 1.0);
    if (!creatorIsRegional) {
      const letters  = (blob.match(/\p{L}/gu) || []).length;
      const regional = (blob.match(REGIONAL_SCRIPT_RE) || []).length;
      if (letters > 0 && regional / letters > 0.25) mult *= 0.55;
    }
    return mult;
  }

  // ── Keep multi-outlet phrases, rank by relevance-adjusted coverage, then merge same-story ─────
  let ranked = [...idx.entries()]
    .map(([phrase, e]) => {
      const samples = e.samples.sort((a, b) => b.momentum - a.momentum);
      const mult = relevanceMult(phrase, samples);
      return {
        phrase,
        channel_count: e.channels.size,
        momentum: e.momentum,
        coverage: e.count,
        relevance: mult,
        score: Math.round(e.channels.size * 100 * mult + Math.log10(e.momentum + 1) * 8),
        words: phrase.split(' '),
        titles: e.titles,
        samples,
      };
    })
    .filter(e => e.channel_count >= minChannels)
    .sort((a, b) => b.score - a.score);

  // Same-story suppression via ASYMMETRIC conditional co-occurrence. A weaker phrase E is part of an
  // already-kept stronger story K when MOST of E's source titles also contain K — i.e.
  // P(K | E) = sharedTitles / |E.titles| is high. This is what folds "champat rai", "donation scam",
  // "mandir donation" into "ram mandir" (they almost never appear without it) and "siya goyal" into
  // "ketan agarwal", WITHOUT needing a shared word. Distinct big stories (e.g. "modi seychelles")
  // appear in plenty of titles WITHOUT the other → low P(K|E) → kept separate. Token-subset is also
  // merged outright ("india china" ⊂ "india china border").
  const kept = [];
  for (const e of ranked) {
    const eset = new Set(e.words);
    const redundant = kept.some(k => {
      const kset = new Set(k.words);
      let sharedTok = 0; for (const w of eset) if (kset.has(w)) sharedTok++;
      if (sharedTok === Math.min(eset.size, kset.size)) return true; // token-subset either way
      let sharedTitles = 0; for (const t of e.titles) if (k.titles.has(t)) sharedTitles++;
      if (sharedTitles < 2) return false;
      const condProb = sharedTitles / e.titles.size; // P(K | E)
      // Most of the weaker phrase's coverage co-occurs with the stronger story → same story.
      if (condProb >= 0.5) return true;
      // A shared word + moderate co-occurrence is enough (fragments that also stand alone a little).
      return sharedTok >= 1 && condProb >= 0.34;
    });
    if (!redundant) kept.push(e);
    if (kept.length >= maxResults) break;
  }

  return {
    supported: true,
    pool_size: poolIds.length,
    window_days: windowDays,
    events: kept.map(e => ({
      topic: titleCase(e.phrase),
      channel_count: e.channel_count,
      coverage: e.coverage,
      score: e.score,
      sample_titles: e.samples.slice(0, 3).map(s => ({ title: s.title, views: s.views, video_id: s.video_id, channel_name: s.channel_name })),
    })),
  };
}

module.exports = { getCurrentEvents };

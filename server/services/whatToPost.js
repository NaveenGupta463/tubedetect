'use strict';

const crypto = require('crypto');

const { computePodcastModePeers, computePodcastIntel } = require('./podcastIntel');
const { computePodcastThemes } = require('./podcastThemes');
const { GUEST_INTEL_BLOCKED_MODES } = require('../lib/formatProfile');
const { PROFILE_QUESTIONS } = require('../lib/routingProfiles');
const { computeRuntimeEventStage, getEventPenalty, shouldSuppressActNow } = require('../lib/eventClassifier');
const { getNarrativeType, computeExpiry, classifyStage, computeWindowScore, computeActNowConf } = require('../lib/narrativeLifecycle');
const { buildOutputEngine, tagIdea } = require('../lib/outputEngine');
const { buildOpportunityResponse } = require('./opportunityTemplates');
const { isHardJunkPhrase, isDisallowedPersonTopic, isMalformedTopicPhrase, assessTopicQuality } = require('./topicQuality');
const { computeCreativeOpportunities, getEvergreenFallback, detectFamily, computeSpecificityScore } = require('./creativeOpportunityEngine');
const { buildOriginalBetsForChannel } = require('./originalBets');
const { extractOpportunity }          = require('./opportunityExtractor');
const { extractConcept: _extractConceptForTrace, extractConcept, computeConceptAffinity } = require('./conceptNormalizer');

// #3e — Proven "Excellent" narrative patterns (Path A research: every Excellent rec
// came from a peer narrative title concept-affinity-matched to the creator). Peer titles
// matching these shapes get a ranking boost so they surface above generic peer topics.
const _NARRATIVE_RES = [
  /\bcan'?t\b[^.]*\b(prove|proves|shows|and the|and it)\b/i,        // CONFLICT_EXPOSE
  /\bforced to\b|\bwas forced\b/i,                                   // FORCED_CONFLICT
  /\bwe thought\b|\bturns out\b|\bmight (not )?(end|be|have)\b/i,    // ASSUMPTION_REVERSAL
  /\b\d+\s+years?\s+of\b|\band\s+\d+\s+years\b/i,                    // MEMORY_OBJECT
  /\bimpossible\b|\bunreasonably\b|\bworld'?s (only|first|biggest|most)\b/i, // IMPOSSIBLE / SCALE
  /\bwhy so many\b|\bthe real reason\b/i,                            // DISCOVERY
];
function _narrativeMatch(t) {
  const s = String(t || '');
  return _NARRATIVE_RES.some(re => re.test(s)) ? 1 : 0;
}
const { readCreatorIdeaDna } = require('./creatorIdeaDna');
const { readRecentTrendSignals } = require('./worldSignals');
const { computeCreatorFitScore } = require('./creatorFitScore');

// ── Directive-output suppression (interim: "suppress now, rewrite later") ──────
// The topic / territory / peer fallbacks emit instruction-style strings
// ("Create a clear, useful angle around X", "Adapt this peer-backed angle: Y",
// "Build your next ... format around a Z angle") instead of concrete video
// titles. The June 2026 live-output audit found these are the single largest
// source of unusable recommendations. Until the generators are rewritten to
// emit concrete titles, keep them in traces (written upstream, for research)
// but strip them from the API-visible `ideas`/lanes.
const _DIRECTIVE_TITLE_RE = /^(?:create (?:a|an) (?:clear|long-form|deep-dive)|build (?:a deep-dive analysis|an explainer from this proven peer angle|your next .+ format)|make (?:a practical .+ (?:guide|around)|.+ practical (?:with|for))|explain (?:what .+ means|the (?:real-world|practical) impact|what .+ changes)|break down (?:what|the)|turn .+ into a useful|show the right way to approach|analyze .+ with a clear|teach .+ with examples|adapt this peer-backed angle|review .+ with a clear buyer verdict)\b/i;

function _isDirectiveTitle(t) {
  const s = String(t || '').trim();
  if (!s) return false;
  if (/\bangle (?:around|on)\b/i.test(s)) return true;
  return _DIRECTIVE_TITLE_RE.test(s);
}

// The rendered/displayed title is the action/angle title, NOT the raw `topic`
// (which holds the bare subject). Check the same fields the API/UI render.
function _ideaRenderedTitle(i) {
  if (!i) return '';
  return i.recommendation_title || i.ai_title || i.angle_title || i.action_title || i.title || i.topic || '';
}

// Raw peer video titles sometimes pass straight through as "recommendations".
// Hashtag-stuffed / emoji-spam titles are never usable as a creator brief.
function _isSpamPeerTitle(t) {
  const s = String(t || '');
  if (!s) return false;
  const hashtags = (s.match(/#\w/g) || []).length;
  if (hashtags >= 2) return true;
  const emoji = (s.match(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{1F1E6}-\u{1F1FF}]/gu) || []).length;
  if (emoji >= 2) return true;
  if (emoji >= 1 && hashtags >= 1) return true;
  return false;
}

// Devanagari, Bengali, Tamil, Telugu, Kannada, Malayalam, Thai, CJK, Hangul, Arabic.
const _NON_LATIN_RE = /[ऀ-෿฀-๿぀-ヿ㐀-鿿가-힯؀-ۿ]/;

// Stream-B (peer / territory / angle) gate. Removes directive non-recs and raw
// spam titles for everyone; removes non-Latin-script peer titles only when the
// creator is English-primary (so Hindi/regional creators still get regional peers).
// DNA original bets are a separate stream and are unaffected.
function _suppressLowValueIdeas(ideas, { creatorIsEnglish = true } = {}) {
  if (!Array.isArray(ideas)) return ideas;
  return ideas.filter(i => {
    const t = _ideaRenderedTitle(i);
    if (_isDirectiveTitle(t)) return false;
    if (_isSpamPeerTitle(t))  return false;
    if (creatorIsEnglish && _NON_LATIN_RE.test(t)) return false;
    return true;
  });
}

const TERRITORY_LABELS = {
  personal_finance: 'Personal Finance',
  macro_economy: 'Macro Economy & Markets',
  crypto_web3: 'Crypto & Web3',
  entrepreneurship: 'Entrepreneurship & Startups',
  career_work: 'Career & Work',
  geopolitics: 'Geopolitics & World Affairs',
  india_politics: 'Indian Politics & Policy',
  crime_scam: 'Crime, Scams & Investigations',
  medical_wellness: 'Medical & Wellness',
  fitness_body: 'Fitness & Body',
  sexual_health: 'Relationships & Sexual Health',
  history_culture: 'History & Culture',
  science_tech_ai: 'Science, Tech & AI',
  gadgets_reviews: 'Gadgets & Tech Reviews',
  education_career: 'Education & Exam Prep',
  food_recipes: 'Food & Recipes',
  food_places: 'Food Places & Street Food',
  travel_places: 'Travel & Places',
  self_improvement: 'Self-Improvement & Psychology',
  celebrity_pop: 'Celebrity & Pop Culture',
  gaming: 'Gaming',
  sports_cricket: 'Sports & Cricket',
  music_performance: 'Music & Performance',
  devotional_spiritual: 'Devotional & Spiritual',
  social_issues: 'Social Issues & Inequality',
};

function loadTerritoryDebug(db, channelId) {
  if (!channelId) {
    return {
      territory_profile: { core: [], accepted: [], test: [] },
      broad_creator_score: 0,
      territory_debug: { status: 'no_channel_id', profile_count: 0 },
    };
  }

  let rows = [];
  try {
    rows = db.all(
      `SELECT territory_id, role, confidence, video_count, recent_video_count,
              median_views, view_lift, evidence_video_ids, first_seen_at, last_seen_at
       FROM channel_territory_profiles
       WHERE channel_id = ?
       ORDER BY
         CASE role WHEN 'core' THEN 0 WHEN 'accepted' THEN 1 ELSE 2 END,
         COALESCE(view_lift, 0) DESC,
         video_count DESC`,
      [channelId],
    );
  } catch (e) {
    return {
      territory_profile: { core: [], accepted: [], test: [] },
      broad_creator_score: 0,
      territory_debug: { status: 'error', error: e.message, profile_count: 0 },
    };
  }

  const profile = { core: [], accepted: [], test: [] };
  const evidenceIds = [];

  for (const r of rows) {
    let ids = [];
    try { ids = r.evidence_video_ids ? JSON.parse(r.evidence_video_ids) : []; } catch (_) {}
    for (const id of ids.slice(0, 3)) if (evidenceIds.length < 25) evidenceIds.push(id);

    const item = {
      territory_id:       r.territory_id,
      label:              TERRITORY_LABELS[r.territory_id] || r.territory_id,
      role:               r.role,
      confidence:         r.confidence,
      video_count:        r.video_count ?? 0,
      recent_video_count: r.recent_video_count ?? 0,
      median_views:       r.median_views ?? null,
      view_lift:          r.view_lift == null ? null : Number(r.view_lift.toFixed ? r.view_lift.toFixed(2) : Number(r.view_lift).toFixed(2)),
      first_seen_at:      r.first_seen_at ?? null,
      last_seen_at:       r.last_seen_at ?? null,
      evidence_video_ids: ids.slice(0, 5),
    };
    if (profile[item.role]) profile[item.role].push(item);
  }

  let evidenceSample = [];
  if (evidenceIds.length) {
    const ph = evidenceIds.map(() => '?').join(',');
    try {
      evidenceSample = db.all(
        `SELECT youtube_video_id, title, views, published_at
         FROM ingested_videos
         WHERE youtube_video_id IN (${ph})`,
        evidenceIds,
      ).map(v => ({
        video_id:     v.youtube_video_id,
        title:        v.title,
        views:        v.views ?? 0,
        published_at: v.published_at ?? null,
      }));
    } catch (_) {}
  }

  const acceptedLike = rows.filter(r => ['core', 'accepted'].includes(r.role) && (r.view_lift ?? 0) >= 0.8).length;
  const broadCreatorScore = acceptedLike >= 6 ? 6 : acceptedLike;

  return {
    territory_profile: profile,
    broad_creator_score: broadCreatorScore,
    territory_debug: {
      status: rows.length ? 'profile_loaded' : 'no_profile',
      profile_count: rows.length,
      role_counts: {
        core: profile.core.length,
        accepted: profile.accepted.length,
        test: profile.test.length,
      },
      breadth_bucket: acceptedLike >= 6 ? 'broad_6_plus' : acceptedLike >= 3 ? 'medium_3_5' : acceptedLike >= 1 ? 'narrow_1_2' : 'test_or_none',
      evidence_sample: evidenceSample,
    },
  };
}

const TOPIC_PARENTS = [
  // ── News / civic ────────────────────────────────────────────────────────────
  { parent: 'Geopolitics',        keywords: ['iran','israel','pakistan','russia','ukraine','china','nato','war','conflict','border','sanctions','ceasefire','diplomacy','treaty','bilateral','strait','hormuz'] },
  { parent: 'Defence & Security', keywords: ['military','army','navy','air force','indian army','indian navy','indian air force','rashtriya rifles','rifles','assam rifles','bsf','crpf','itbp','cisf','defence','defense','drdo','brahmos','rafale','tejas','fighter jet','submarine','warship','aircraft carrier','missile','nuclear submarine','s-400','drone','uav','border security','military exercise','special forces','commando','agniveer','agnipath','operation sindoor','weapon system','artillery','tank','rifle','firearms'] },
  { parent: 'Judiciary & Law',    keywords: ['supreme court','high court','verdict','judgment','constitution','article','bail','arrest','crime','murder','rape','scam','fraud','fir','custody','tribunal'] },
  { parent: 'Competitive Exams',  keywords: ['upsc','ssc','ias','ips','prelims','mains','neet','jee','exam','syllabus','cutoff','answer key','mock test','preparation','crack','study'] },
  { parent: 'Economy & Finance',  keywords: ['budget','rbi','inflation','gdp','gst','market','stock','sensex','nifty','bank','recession','investment','rupee','dollar','trade','tariff','imf','world bank'] },
  { parent: 'Politics',           keywords: ['election','modi','congress','bjp','government','minister','parliament','lok sabha','rajya sabha','party','vote','cm','chief minister','governor','president','coalition'] },
  { parent: 'Sports',             keywords: ['ipl','cricket','match','tournament','world cup','player','team','final','league','championship','hockey','football','kabaddi','olympics','medal','wicket','referee','grand slam','penalty kick'] },
  { parent: 'Society & Health',   keywords: ['health','hospital','doctor','medicine','disease','cancer','covid','diabetes','mental health','education','school','university','women','child','poverty','farmer','protest'] },
  // Science & Tech includes consumer products so tech-review/gadget channels get parent_topic
  { parent: 'Science & Tech',     keywords: ['artificial intelligence','ai','robot','space','isro','nasa','satellite','moon','mars','technology','startup','innovation','climate','environment','renewable','solar','samsung','iphone','oneplus','realme','redmi','xiaomi','oppo','vivo','macbook','ipad','smartwatch','earbuds','flagship','gaming phone','budget phone','gaming laptop','benchmark'] },
  // ── Content-niche categories ─────────────────────────────────────────────────
  // These were absent before — their absence caused food/gaming/fitness phrases to have
  // parent_topic=null, triggering the fragment penalty even on specific, useful topics.
  { parent: 'Food & Cooking',     keywords: ['recipe','biryani','paneer','dal','roti','dosa','sambar','chutney','masala','sabji','cake','pizza','burger','pasta','dessert','snack','chef','aloo','street food','ice cream','cooking tutorial','chocolate cake','khichdi','paratha','lassi','idli','halwa','tadka','sabji'] },
  { parent: 'Travel',             keywords: ['road trip','travel guide','backpacking','itinerary','ladakh','kedarnath','manali','goa','bali','thailand','dubai','london','paris','japan','europe','airport','visa','hostel','resort','trekking','hiking','train journey','solo travel'] },
  { parent: 'Gaming',             keywords: ['minecraft','roblox','pubg','fortnite','valorant','bgmi','gameplay','free fire','boss fight','speedrun','esports','game review','resident evil','call of duty','among us','clash royale','gaming setup','gta','game pass'] },
  { parent: 'Fitness',            keywords: ['workout','gym','push ups','weight loss','belly fat','muscle','protein','cardio','squat','deadlift','biceps','abs workout','leg day','fat loss','calisthenics','home workout','morning workout','bulking','bench press'] },
  { parent: 'Entertainment',      keywords: ['netflix','bollywood','hollywood','trailer','ott','web series','stand up','roast','comedy show','reaction video','celebrity','film review','movie review','box office','award show','stand up comedy'] },
  { parent: 'Music',              keywords: ['song','music','singer','rap','hip hop','guitar','piano','vocals','cover song','original song','lyrics','beat','playlist','album','lofi','classical music','indie','band'] },
  { parent: 'Beauty & Lifestyle', keywords: ['makeup','lipstick','skincare','foundation','hairstyle','outfit','saree','fashion','moisturizer','serum','sunscreen','eyeliner','nail art','morning routine','get ready','wardrobe','ootd'] },
];

// Flat set of single-word TOPIC_PARENTS keywords — used to distinguish recognised
// topic entities (countries, concepts) from named leaders/persons during anchor cleanup.
const _TOPIC_FLAT_KEYWORDS = new Set(
  TOPIC_PARENTS.flatMap(({ keywords }) => keywords.filter(k => !k.includes(' ')))
);

function inferParentTopic(phrase) {
  const lower = phrase.toLowerCase();
  for (const { parent, keywords } of TOPIC_PARENTS) {
    for (const k of keywords) {
      // Multi-word keywords: substring match is fine (natural word boundaries at spaces).
      // Single-word keywords: require whole-word match to prevent false positives
      // like 'ai' matching 'affairs', 'war' matching 'warning', 'cm' matching 'scam'.
      const hit = k.includes(' ')
        ? lower.includes(k)
        : new RegExp('(?:^|\\b)' + k + '(?:\\b|$)').test(lower);
      if (hit) return parent;
    }
  }
  return null;
}

// Words that poison angles even inside a multi-word phrase.
// These are content-production labels, honorifics, exam abbreviations,
// and geographic sub-tokens that carry zero editorial meaning.
// NOTE: narrative qualifiers like 'reaction','analysis','strategy','warning'
// are intentionally NOT here — they are valid inside bigrams like
// "trump reaction" or "prelims strategy".
const ANGLE_STOPWORDS = new Set([
  // YouTube production / format labels
  'viral','marathon','shorts','clip','recap','episode','highlights','highlight',
  'ncert','class','part',
  // Honorifics
  'sir','mam','madam',
  // Redundant exam abbreviation / role fragments
  'cse','chief',
  // Indian state name single-word fragments — geographic context, not editorial ideas
  'tamil','kerala','bengal','punjab','gujarat','maharashtra','rajasthan',
  'karnataka','andhra','odisha','bihar','assam','uttarakhand','himachal',
  'goa','manipur','nagaland','meghalaya','arunachal','sikkim','tripura',
  'mizoram','haryana','jharkhand','telangana','chhattisgarh','pradesh',
  'desh','nadu',
]);

// Verb tokens that indicate a sentence fragment rather than a topic entity.
// Trimmed from the trailing end of anchor phrases ("Russia Uses" → "Russia").
const VERB_STOPWORDS = new Set([
  'uses','used','using',
  'says','said',
  'calls','called',
  'gets','got',
  'hits','hit',
  'warns','warning',
  'attacks','attack',
  'strikes','strike',
  'meets','meeting',
  'visits','visit',
  'arrives','arrival',
  'announces','announce',
  'responds','response',
]);

// ── Trend signal matching ─────────────────────────────────────────────────────
// Matches a candidate phrase against persisted Google Trends rising queries.
// Exact match first, then containment either way for queries of useful length.

function trendBoostForPhrase(phrase, trendMap) {
  if (!trendMap || trendMap.size === 0) return null;
  const lower = String(phrase || '').toLowerCase().trim();
  if (lower.length < 5) return null;
  const exact = trendMap.get(lower);
  if (exact) return exact;
  for (const [query, row] of trendMap) {
    if (query.length >= 6 && (query.includes(lower) || lower.includes(query))) return row;
  }
  return null;
}

function _fmtV(n) {
  if (!n) return '0';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

// ── Semantic canonicalization ─────────────────────────────────────────────────
// Strips functional content-type words from phrase edges to expose the topic core,
// then merges phrase variants that share a core AND appear in >35% of the same
// channels. Prevents "financial freedom tips" + "financial freedom guide" from
// showing as two separate suggestions when they mean the same topic.

const CONTENT_MODIFIERS = new Set([
  'tips','guide','tutorial','review','explained','breakdown','analysis',
  'strategy','ideas','secrets','mistakes','hacks','tricks','lessons',
  'beginners','advanced','complete','ultimate','simple','easy','quick',
  'challenge','react','vlog','update','story','news','interview','series',
  'ep','episode','part','season','edition','special','exclusive',
  'how','what','why','should','worth','need','know','does','can',
  '2024','2025','2026','2027',
]);

function stripModifiers(phrase) {
  const words = phrase.split(' ');
  let start = 0, end = words.length - 1;
  while (start <= end && CONTENT_MODIFIERS.has(words[start])) start++;
  while (end >= start && CONTENT_MODIFIERS.has(words[end])) end--;
  return start > end ? phrase : words.slice(start, end + 1).join(' ');
}

// For each bigram in topicMap, find the longest trigram/4-gram that:
//   (a) starts with that bigram, and
//   (b) covers ≥ 35% of the bigram's channels.
// Returns a Map<bigram, bestExtensionPhrase>.
function buildPhraseExtensionIndex(topicMap) {
  const index = new Map();
  for (const [phrase, data] of topicMap) {
    const words = phrase.split(' ');
    if (words.length < 3) continue;
    const bigram = words[0] + ' ' + words[1];
    const prev = index.get(bigram);
    if (!prev || words.length > prev.words ||
        (words.length === prev.words && data.channels.size > prev.channels)) {
      index.set(bigram, { phrase, words: words.length, channels: data.channels.size });
    }
  }
  return index;
}

function canonicalizePhrases(topicMap) {
  const phrases = [...topicMap.keys()];
  const coreMap = new Map(); // core → phrase with largest channel set

  for (const phrase of phrases) {
    const core = stripModifiers(phrase);
    if (!coreMap.has(core)) {
      coreMap.set(core, phrase);
    } else {
      const current = coreMap.get(core);
      if (topicMap.get(phrase).channels.size > topicMap.get(current).channels.size) {
        coreMap.set(core, phrase);
      }
    }
  }

  for (const phrase of phrases) {
    const core = stripModifiers(phrase);
    const canonical = coreMap.get(core);
    if (!canonical || canonical === phrase) continue;

    const pChannels = topicMap.get(phrase)?.channels;
    const cChannels = topicMap.get(canonical)?.channels;
    if (!pChannels || !cChannels) continue;

    const smaller = pChannels.size <= cChannels.size ? pChannels : cChannels;
    const larger  = pChannels.size <= cChannels.size ? cChannels : pChannels;
    let shared = 0;
    for (const id of smaller) if (larger.has(id)) shared++;
    if (smaller.size === 0 || shared / smaller.size < 0.35) continue;

    // Merge src into canonical
    const src  = topicMap.get(phrase);
    const dest = topicMap.get(canonical);
    for (const id of src.channels) dest.channels.add(id);
    for (const item of src.allViews) dest.allViews.push(item);
    dest.cnt_0_14  += src.cnt_0_14;
    dest.cnt_15_30 += src.cnt_15_30;
    dest.cnt_31_60 += src.cnt_31_60;
    dest.cnt_61_90 += src.cnt_61_90;
    if (dest.videos.length < 5) dest.videos.push(...src.videos.slice(0, 5 - dest.videos.length));
    if (src.formats && dest.formats) {
      for (const [k, v] of Object.entries(src.formats)) {
        if (!dest.formats[k]) dest.formats[k] = { count: 0, totalViews: 0 };
        dest.formats[k].count += v.count || 0;
        dest.formats[k].totalViews += v.totalViews || 0;
      }
    }
    if (src.format_evidence && dest.format_evidence) {
      for (const [k, v] of Object.entries(src.format_evidence)) {
        dest.format_evidence[k] = (dest.format_evidence[k] || 0) + (v || 0);
      }
    }
    for (const vp of src.vel_pairs) dest.vel_pairs.push(vp);
    dest.sav30_sum += src.sav30_sum;
    dest.sav30_cnt += src.sav30_cnt;
    if (src.fast_growth_channels && dest.fast_growth_channels) {
      for (const id of src.fast_growth_channels) dest.fast_growth_channels.add(id);
    }
    if (src.ch_recent && dest.ch_recent) for (const id of src.ch_recent) dest.ch_recent.add(id);
    if (src.ch_prior && dest.ch_prior) for (const id of src.ch_prior) dest.ch_prior.add(id);
    if (typeof src.vpd_recent_sum === 'number') {
      dest.vpd_recent_sum = (dest.vpd_recent_sum || 0) + src.vpd_recent_sum;
      dest.vpd_recent_cnt = (dest.vpd_recent_cnt || 0) + src.vpd_recent_cnt;
      dest.vpd_prior_sum  = (dest.vpd_prior_sum  || 0) + src.vpd_prior_sum;
      dest.vpd_prior_cnt  = (dest.vpd_prior_cnt  || 0) + src.vpd_prior_cnt;
    }
    topicMap.delete(phrase);
  }
}

// ── Recency-weighted median ───────────────────────────────────────────────────
// Weight = 1.0 / 0.85 / 0.60 / 0.35 by age window so recent videos count more.

function recencyWeight(ageDays) {
  if (ageDays <= 14) return 1.0;
  if (ageDays <= 30) return 0.85;
  if (ageDays <= 60) return 0.60;
  return 0.35;
}

function weightedMedian(items) {
  if (!items.length) return 0;
  if (items.length === 1) return items[0].v;
  const sorted = [...items].sort((a, b) => a.v - b.v);
  const total  = sorted.reduce((s, x) => s + x.w, 0);
  let cum = 0;
  for (const { v, w } of sorted) {
    cum += w;
    if (cum >= total * 0.5) return v;
  }
  return sorted[sorted.length - 1].v;
}

// ── Peer channel activity + growth momentum ──────────────────────────────────
// One bulk pass over ingested_videos per pool: last upload date plus a
// 30d-vs-prior-90d average-view momentum ratio. Used to (a) drop dormant
// channels from the extraction pool so stale uploads stop shaping topics, and
// (b) weight evidence from fast-growing channels more heavily — their topic
// choices are leading indicators, a flat channel's are lagging ones.

const PEER_INACTIVE_DAYS = 120;
const PEER_MIN_ACTIVE_POOL = 10;

function loadPeerChannelStats(db, channelIds, nowMs) {
  const statsMap = new Map();
  if (!Array.isArray(channelIds) || channelIds.length === 0) return statsMap;
  const d30  = new Date(nowMs - 30 * 86400000).toISOString();
  const d120 = new Date(nowMs - 120 * 86400000).toISOString();
  const ids = [...new Set(channelIds.filter(Boolean))];
  // Scan is bounded to the momentum window — channels with no upload in the
  // last 120 days simply get no row, which filterInactivePeers reads as dormant.
  for (let i = 0; i < ids.length; i += 250) {
    const chunk = ids.slice(i, i + 250);
    const ph = chunk.map(() => '?').join(',');
    try {
      db.all(
        `SELECT channel_id,
                MAX(published_at)                                                    AS last_published_at,
                AVG(CASE WHEN published_at >= ? THEN views END)                      AS recent_avg_views,
                AVG(CASE WHEN published_at < ? THEN views END)                       AS prior_avg_views,
                SUM(CASE WHEN published_at >= ? THEN 1 ELSE 0 END)                   AS recent_video_count
         FROM ingested_videos
         WHERE channel_id IN (${ph}) AND views > 0 AND published_at >= ?
         GROUP BY channel_id`,
        [d30, d30, d30, ...chunk, d120],
      ).forEach(r => {
        const recent = Number(r.recent_avg_views) || 0;
        const prior  = Number(r.prior_avg_views) || 0;
        statsMap.set(r.channel_id, {
          last_published_at:  r.last_published_at || null,
          recent_video_count: r.recent_video_count || 0,
          momentum: recent > 0 && prior > 0 ? recent / prior : null,
        });
      });
    } catch (_) {}
  }
  return statsMap;
}

function channelMomentumWeight(stats) {
  const m = stats?.momentum;
  if (!m) return 1;
  if (m >= 2)   return 1.35;
  if (m >= 1.3) return 1.15;
  if (m <= 0.4) return 0.8;
  if (m <= 0.7) return 0.9;
  return 1;
}

function filterInactivePeers(channelIds, statsMap, nowMs, {
  maxInactiveDays = PEER_INACTIVE_DAYS,
  minPool = PEER_MIN_ACTIVE_POOL,
} = {}) {
  if (!Array.isArray(channelIds) || channelIds.length <= minPool) return channelIds;
  const cutoffMs = nowMs - maxInactiveDays * 86400000;
  const active = [];
  const inactive = [];
  for (const id of channelIds) {
    const stats = statsMap.get(id);
    // No stored videos with views → contributes nothing to extraction and
    // would only inflate the saturation denominator.
    if (!stats || !stats.last_published_at) { inactive.push(id); continue; }
    if (new Date(stats.last_published_at).getTime() >= cutoffMs) active.push(id);
    else inactive.push(id);
  }
  if (active.length >= minPool) return active;
  const refill = inactive
    .map(id => ({ id, ts: new Date(statsMap.get(id)?.last_published_at || 0).getTime() || 0 }))
    .sort((a, b) => b.ts - a.ts)
    .map(x => x.id);
  return [...active, ...refill.slice(0, minPool - active.length)];
}

// ── Dynamic view threshold ────────────────────────────────────────────────────
// Use creator's own median views × 0.15 so a 50-view creator doesn't need 10K
// peer views to surface a relevant topic. Falls back to pool-size tiers.

function computeUserOwnMedian(db, channelId) {
  if (!channelId) return 0;
  const rows = db.all(
    `SELECT views FROM ingested_videos WHERE channel_id = ? AND views > 0 ORDER BY published_at DESC LIMIT 50`,
    [channelId],
  );
  if (!rows.length) return 0;
  const sorted = rows.map(r => r.views).sort((a, b) => a - b);
  const m = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[m] : Math.round((sorted[m - 1] + sorted[m]) / 2);
}

// ── Creator DNA affinity ──────────────────────────────────────────────────────
// Builds a lookup from the cached creator_idea_dna row so candidate topics that
// match the creator's proven vocabulary / micro-topics / entities get a bounded
// score boost. Personalizes ranking without excluding anything.

function buildDnaAffinity(db, channelId) {
  if (!channelId) return null;
  let dna = null;
  try { dna = readCreatorIdeaDna(db, channelId); } catch (_) { return null; }
  if (!dna || (Number(dna.confidence_score) || 0) < 0.3) return null;

  const phraseSet = new Set();
  for (const row of [...(dna.micro_topics || []).slice(0, 40), ...(dna.entities || []).slice(0, 20)]) {
    const label = String(row?.label || row?.id || '').toLowerCase().trim();
    if (label.length >= 5) phraseSet.add(label);
  }

  const tokenWeights = new Map();
  const vocab = (dna.vocabulary || []).slice(0, 40);
  const topScore = Number(vocab[0]?.score) || 1;
  for (const row of vocab) {
    const token = String(row?.id || '').trim();
    if (token.length < 3) continue;
    const weight = Math.max(1, Math.round(4 * (Number(row.score) || 0) / topScore));
    tokenWeights.set(token, Math.max(tokenWeights.get(token) || 0, weight));
  }
  for (const row of (dna.micro_topics || []).slice(0, 30)) {
    for (const token of String(row?.label || row?.id || '').toLowerCase().split(/\s+/)) {
      if (token.length >= 4) tokenWeights.set(token, Math.max(tokenWeights.get(token) || 0, 2));
    }
  }

  if (!phraseSet.size && !tokenWeights.size) return null;
  return { phraseSet, tokenWeights };
}

function dnaAffinityBonus(phrase, affinity) {
  if (!affinity) return 0;
  const lower = String(phrase || '').toLowerCase();
  if (affinity.phraseSet.has(lower)) return 12;
  let sum = 0;
  for (const token of lower.split(/\s+/)) sum += affinity.tokenWeights.get(token) || 0;
  return Math.min(10, sum);
}

// ── Recent-coverage avoidance ─────────────────────────────────────────────────
// userPhraseSet already hard-excludes exact phrases the creator has used.
// This catches near-misses: a candidate that shares almost all of its
// meaningful words with one of the creator's uploads from the last 45 days
// is penalized — recommending it back is redundant, not insightful.

function buildRecentTitleTokenSets(userTitleRows, nowMs, stopwords, { maxAgeDays = 45, maxTitles = 30 } = {}) {
  const sets = [];
  for (const row of userTitleRows || []) {
    if (sets.length >= maxTitles) break;
    if (!row?.title || !row?.published_at) continue;
    const ageDays = (nowMs - new Date(row.published_at).getTime()) / 86400000;
    if (!(ageDays >= 0 && ageDays <= maxAgeDays)) continue;
    const tokens = String(row.title).toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length >= 3 && !stopwords.has(w) && !CONTENT_MODIFIERS.has(w));
    if (tokens.length >= 2) sets.push(new Set(tokens));
  }
  return sets;
}

function recentCoveragePenalty(phrase, recentTitleTokenSets) {
  if (!recentTitleTokenSets || !recentTitleTokenSets.length) return 0;
  const tokens = String(phrase || '').toLowerCase().split(/\s+/)
    .filter(w => w.length >= 3 && !CONTENT_MODIFIERS.has(w));
  if (tokens.length < 2) return 0;
  for (const set of recentTitleTokenSets) {
    let shared = 0;
    for (const t of tokens) if (set.has(t)) shared++;
    if (shared >= tokens.length) return -14;
    if (tokens.length >= 3 && shared >= tokens.length - 1) return -8;
  }
  return 0;
}

function buildWhyText(b, trend, avgViews, rec_type) {
  const base = `${b.channels.size} channels averaged ${_fmtV(Math.round(avgViews))} views on this.`;
  let trendLine;
  if (trend === 'rising')         trendLine = 'Trend is accelerating in your community right now.';
  else if (trend === 'evergreen') trendLine = 'Consistently performs — no peak, no crash.';
  else if (trend === 'peaking')   trendLine = 'At its peak — move quickly for maximum reach.';
  else if (trend === 'fading')    trendLine = 'Past its peak. A fresh angle could revive it.';
  else                            trendLine = 'Low recent activity — early mover advantage possible.';

  if (rec_type === 'long_form_opportunity') {
    return `${base} ${trendLine} This is a recurring theme in your community — ideal for a documentary, historical explainer, or deep-dive analysis. Covering it as long-form positions you as an authority rather than a breaking-news relay.`;
  }
  if (rec_type === 'context_gap') {
    return `${base} ${trendLine} The destination or occasion is the prompt — your voice, perspective, and experience make it entirely yours.`;
  }
  return `${base} ${trendLine}`;
}

function buildTopicActionTitle(topic, { parentTopic, recType, resolvedNiche, cspPrimary } = {}) {
  const clean = _titleCasePhrase(topic);
  const nicheText = `${resolvedNiche || ''} ${cspPrimary || ''}`.toLowerCase();

  if (/gaming|gameplay|free fire|bgmi|pubg|minecraft|roblox|gta|valorant|esports/.test(nicheText)) {
    return `Turn ${clean} into a gameplay challenge, guide, or story mission`;
  }

  if (recType === 'long_form_opportunity') {
    if (parentTopic === 'Geopolitics') return `Explain the real-world impact of ${clean}`;
    if (parentTopic === 'Defence & Security') return `Break down the defence significance of ${clean}`;
    if (parentTopic === 'Politics') return `Break down what ${clean} changes for viewers`;
    if (parentTopic === 'Sports') return `Build a deep-dive analysis around ${clean}`;
    return `Create a long-form explainer on ${clean}`;
  }

  if (parentTopic === 'Economy & Finance') return `Explain what ${clean} means for viewers' money`;
  if (parentTopic === 'Science & Tech') {
    if (/review|gadget|tech|technology|phone|automotive/.test(nicheText)) return `Review ${clean} with a clear buyer verdict`;
    return `Explain the practical impact of ${clean}`;
  }
  if (parentTopic === 'Competitive Exams') return `Teach ${clean} with examples and a quick revision ending`;
  if (parentTopic === 'Food & Cooking') return `Make ${clean} practical with a clear recipe or taste-test payoff`;
  if (parentTopic === 'Travel') return `Turn ${clean} into a useful itinerary or experience guide`;
  if (parentTopic === 'Fitness') return `Show the right way to approach ${clean}`;
  if (parentTopic === 'Gaming') return `Make ${clean} useful with a challenge, guide, or update angle`;
  if (parentTopic === 'Sports') return `Analyze ${clean} with a clear prediction or takeaway`;
  if (parentTopic === 'Defence & Security') return `Explain what ${clean} changes for India's defence story`;
  if (parentTopic === 'Society & Health') return `Create a clear guide around ${clean}`;

  return `Create a clear, useful angle around ${clean}`;
}

function buildDefenceSignalIdeas(videos = [], { peerCount = 0, getFormatWinner } = {}) {
  const packages = [
    {
      id: 'defence_equipment',
      topic: 'Defence Equipment Explainer',
      title: 'Explain one defence system or weapon and why it matters',
      re: /\b(drdo|brahmos|rafale|tejas|fighter jet|submarine|warship|aircraft carrier|missile|s-400|drone|uav|tank|artillery|rifle|firearms|weapon system)\b/i,
    },
    {
      id: 'military_unit_profile',
      topic: 'Military Unit Profile',
      title: 'Profile one military unit and its current role',
      re: /\b(indian army|indian navy|indian air force|rashtriya rifles|assam rifles|bsf|crpf|itbp|cisf|special forces|commando|regiment|battalion|squadron)\b/i,
    },
    {
      id: 'border_security_update',
      topic: 'Border Security Update',
      title: 'Break down a border or security development with clear context',
      re: /\b(border|loc|lac|pakistan|china|kashmir|ladakh|security|infiltration|terror|counter[- ]terror|ceasefire)\b/i,
    },
    {
      id: 'training_recruitment',
      topic: 'Training And Recruitment',
      title: 'Explain what a training or recruitment update means for aspirants',
      re: /\b(agniveer|agnipath|recruitment|training|selection|academy|nda|cds|ssb|military exercise|exercise)\b/i,
    },
    {
      id: 'operation_timeline',
      topic: 'Operation Timeline',
      title: 'Create a timeline of one operation or military incident',
      re: /\b(operation|strike|encounter|attack|rescue|mission|deployment|patrol|martyr|bravery|gallantry)\b/i,
    },
  ];

  const buckets = new Map(packages.map(p => [p.id, {
    ...p,
    videos: [],
    allViews: [],
    channels: new Set(),
    formats: {
      shorts: { count: 0, totalViews: 0 },
      quick:  { count: 0, totalViews: 0 },
      mid:    { count: 0, totalViews: 0 },
      long:   { count: 0, totalViews: 0 },
    },
    format_evidence: {
      short_form_videos: 0,
      likely_short_form_videos: 0,
      long_form_videos: 0,
      unknown_videos: 0,
      short_form_views: 0,
      long_form_views: 0,
    },
  }]));

  for (const video of videos) {
    const title = String(video.title || '');
    if (!title) continue;
    for (const pkg of packages) {
      if (!pkg.re.test(title)) continue;
      const b = buckets.get(pkg.id);
      if (b.videos.length < 3) b.videos.push(video);
      b.allViews.push({ v: video.views || 0, w: 1 });
      b.channels.add(video.channel_id);
      const fmtKey = formatBucketForVideo(video);
      b.formats[fmtKey].count++;
      b.formats[fmtKey].totalViews += video.views || 0;
      addFormatEvidence(b, video);
    }
  }

  const ideas = [];
  for (const b of buckets.values()) {
    if (b.channels.size < 2 || b.allViews.length < 2) continue;
    const avgViews = Math.round(weightedMedian(b.allViews));
    const formatEvidence = summarizeFormatEvidence(b.format_evidence);
    const formatScoreAdj = formatEvidence.evidence_type === 'long_form_backed' ? 6
      : formatEvidence.evidence_type === 'mixed_signal' ? 3
      : formatEvidence.evidence_type === 'short_form_spark' ? -4
      : -1;
    const score = Math.max(12, Math.min(82, Math.round(
      30 +
      Math.min(24, Math.log10(avgViews + 1) / 7 * 24) +
      Math.min(16, b.channels.size / Math.max(1, peerCount) * 16) +
      formatScoreAdj
    )));
    ideas.push({
      topic: b.topic,
      title: b.title,
      action_title: b.title,
      score,
      recommendation_type: 'long_form_opportunity',
      idea_type: 'defence_signal',
      source: 'defence_signal',
      channel_count: b.channels.size,
      avg_views: avgViews,
      trend_status: 'evergreen',
      saturation_pct: Math.min(100, Math.round(b.channels.size / Math.max(1, peerCount) * 100)),
      saturation_level: 'medium',
      format_winner: getFormatWinner ? getFormatWinner(b.formats, b.allViews.length) : null,
      format_evidence: formatEvidence,
      evidence_type: formatEvidence.evidence_type,
      velocity: null,
      act_now: false,
      examples: b.videos.slice(0, 3).map(v => ({
        title: v.title,
        views: v.views,
        channel_name: v.channel_name || 'Unknown',
        format_type: v.format_type || 'unknown',
      })),
      parent_topic: 'Defence & Security',
      anchor_topic: null,
      is_angle: false,
      why: `${b.channels.size} defence peers averaged ${_fmtV(avgViews)} views on this format.`,
    });
  }

  return ideas.sort((a, b) => b.score - a.score).slice(0, 10);
}

function _titleCasePhrase(phrase) {
  return String(phrase || '').replace(/\b\w/g, c => c.toUpperCase());
}

function loadAcceptedTerritories(db, channelId, { limit = 3 } = {}) {
  if (!channelId) return [];
  try {
    return db.all(
      `SELECT territory_id, role, confidence, video_count, recent_video_count, view_lift
       FROM channel_territory_profiles
       WHERE channel_id = ?
         AND role IN ('core','accepted')
         AND COALESCE(view_lift, 0) >= 0.8
         AND video_count >= 3
       ORDER BY
         CASE role WHEN 'core' THEN 0 ELSE 1 END,
         COALESCE(view_lift, 0) DESC,
         video_count DESC
       LIMIT ?`,
      [channelId, limit],
    );
  } catch (_) {
    return [];
  }
}

function allowedTerritoryIdsForChannel({ resolvedNiche, row, creatorMode, guestIntelActive, formatProfile }) {
  const text = [
    resolvedNiche,
    row?.niche,
    row?.primary_niche,
    row?.secondary_niche,
    row?.content_archetype,
    row?.routing_profile,
    formatProfile,
    creatorMode,
  ].filter(Boolean).join(' ').toLowerCase();

  if (/astrolog|tarot|numerolog|horoscope|zodiac/.test(text)) {
    return new Set();
  }

  if (/gaming|free fire|minecraft|roblox|bgmi|pubg|fortnite|esports|valorant/.test(text)) {
    return new Set(['gaming', 'gadgets_reviews']);
  }

  if (/food|recipe|cooking|street food|restaurant|biriyani|biryani/.test(text)) {
    return new Set(['food_recipes', 'food_places', 'travel_places']);
  }

  if (/travel|tour|destination|vlog|lifestyle|daily life|family|hotel|homestay|resort/.test(text)) {
    return new Set(['travel_places', 'food_places', 'food_recipes', 'self_improvement']);
  }

  if (/\b(used car|car market|auto|automobile|vehicle)\b/.test(text)) {
    return new Set();
  }

  if (/personal development|selfimprovement|self improvement|motivation|mindset|spiritual|meditation|wellness/.test(text)) {
    return new Set(['self_improvement', 'medical_wellness', 'fitness_body', 'devotional_spiritual']);
  }

  // News/current-affairs channels cover many territories by definition; treating
  // every accepted territory as expansion permission makes WTP noisy.
  if (/news|current affairs|current events|politics|live coverage|crime reports?|crime updates?|regional politics|international relations|international conflicts/.test(text)) {
    return new Set();
  }

  if (creatorMode === 'podcast' || /podcast/.test(text)) {
    return new Set([
      'personal_finance', 'macro_economy', 'crypto_web3', 'entrepreneurship', 'career_work',
      'geopolitics', 'india_politics', 'crime_scam', 'medical_wellness', 'fitness_body',
      'sexual_health', 'history_culture', 'science_tech_ai', 'education_career',
      'self_improvement', 'social_issues',
    ]);
  }

  if (/finance|invest|investment|stock|stock market|financial market|trading|portfolio|wealth|money|economy|economic|business|startup|founder|entrepreneur|msme|insurance|tax|crypto|bitcoin/.test(text)) {
    return new Set(['personal_finance', 'macro_economy', 'crypto_web3', 'entrepreneurship', 'career_work', 'geopolitics', 'science_tech_ai']);
  }

  if (/education|exam|upsc|ias|neet|jee|ssc|competitive|student|study/.test(text)) {
    return new Set(['education_career', 'history_culture', 'science_tech_ai', 'geopolitics', 'india_politics', 'macro_economy', 'social_issues']);
  }

  if (/tech|technology|gadget|phone|smartphone|ai|software|coding/.test(text)) {
    return new Set(['science_tech_ai', 'gadgets_reviews', 'entrepreneurship', 'career_work']);
  }

  if (/health|wellness|doctor|medical|nutrition|fitness|gym|workout/.test(text)) {
    return new Set(['medical_wellness', 'fitness_body', 'food_recipes', 'self_improvement']);
  }

  if (/music|song|singer|bhajan|devotional|spiritual|meditation/.test(text)) {
    return new Set(['music_performance', 'devotional_spiritual', 'self_improvement']);
  }

  return new Set();
}

function _territoryContextText({ resolvedNiche, primaryNiche, cspPrimary } = {}) {
  return [resolvedNiche, primaryNiche, cspPrimary].filter(Boolean).join(' ').toLowerCase();
}

function isExplicitFinanceOrBusinessContext(text) {
  return /\b(finance|invest|investment|stock|market|trading|portfolio|wealth|money|mutual fund|sip|crypto|bitcoin|economy|economic|business|startup|founder|entrepreneur|msme|export import|insurance|tax)\b/.test(String(text || '').toLowerCase());
}

function detectGameFamily(text) {
  const s = String(text || '').toLowerCase();
  if (/\b(free ?fire|garena)\b/.test(s)) return 'free_fire';
  if (/\b(bgmi|pubg)\b/.test(s)) return 'bgmi';
  if (/\bminecraft\b/.test(s)) return 'minecraft';
  if (/\b(gta|grand theft auto)\b/.test(s)) return 'gta';
  if (/\b(valorant)\b/.test(s)) return 'valorant';
  if (/\b(roblox)\b/.test(s)) return 'roblox';
  return null;
}

function isGameTopicAllowedForChannel(topic, contextText) {
  const channelGame = detectGameFamily(contextText);
  if (!channelGame) return true;
  const topicGame = detectGameFamily(topic);
  return !topicGame || topicGame === channelGame;
}

const TERRITORY_PARENT_ALLOW = {
  personal_finance:       new Set(['Economy & Finance']),
  macro_economy:          new Set(['Economy & Finance', 'Geopolitics']),
  crypto_web3:            new Set(['Economy & Finance', 'Science & Tech']),
  entrepreneurship:       new Set(['Economy & Finance', 'Science & Tech']),
  career_work:            new Set(['Competitive Exams', 'Society & Health', 'Science & Tech']),
  geopolitics:            new Set(['Geopolitics', 'Defence & Security', 'Politics', 'Economy & Finance']),
  india_politics:         new Set(['Politics', 'Defence & Security', 'Society & Health', 'Economy & Finance']),
  crime_scam:             new Set(['Judiciary & Law', 'Politics', 'Economy & Finance']),
  medical_wellness:       new Set(['Society & Health', 'Fitness', 'Food & Cooking']),
  fitness_body:           new Set(['Fitness', 'Society & Health', 'Food & Cooking']),
  sexual_health:          new Set(['Society & Health', 'Beauty & Lifestyle']),
  history_culture:        new Set(['Politics', 'Geopolitics', 'Entertainment']),
  science_tech_ai:        new Set(['Science & Tech', 'Economy & Finance']),
  gadgets_reviews:        new Set(['Science & Tech']),
  education_career:       new Set(['Competitive Exams', 'Science & Tech', 'Society & Health']),
  food_recipes:           new Set(['Food & Cooking', 'Fitness']),
  food_places:            new Set(['Food & Cooking', 'Travel']),
  travel_places:          new Set(['Travel', 'Food & Cooking']),
  self_improvement:       new Set(['Beauty & Lifestyle', 'Society & Health', 'Fitness']),
  celebrity_pop:          new Set(['Entertainment', 'Music']),
  gaming:                 new Set(['Gaming', 'Science & Tech']),
  sports_cricket:         new Set(['Sports']),
  music_performance:      new Set(['Music', 'Entertainment']),
  devotional_spiritual:   new Set(['Music', 'Society & Health', 'Travel']),
  social_issues:          new Set(['Society & Health', 'Politics', 'Economy & Finance', 'Judiciary & Law']),
};

function isParentAllowedForTerritory(territoryId, parentTopic) {
  const allowed = TERRITORY_PARENT_ALLOW[territoryId];
  return !!parentTopic && (!allowed || allowed.has(parentTopic));
}

const WEAK_TERRITORY_EXPANSION_TOPICS = new Set([
  'supreme court',
  'high court',
  'chief minister',
  'prime minister',
  'janta party',
  'janata party',
  'low investment high',
  'doctor reacts',
]);

function isWeakTerritoryExpansionTopic(phrase) {
  const s = String(phrase || '').toLowerCase().trim();
  if (!s) return true;
  if (WEAK_TERRITORY_EXPANSION_TOPICS.has(s)) return true;
  if (/^(supreme|high|district) court$/.test(s)) return true;
  if (/^(chief|prime) minister\b/.test(s)) return true;
  if (/^minister\b/.test(s)) return true;
  if (/\binvestment (high|low) profit\b/.test(s)) return true;
  if (/\b(janta|janata|aam aadmi|bharatiya janata|samajwadi|congress) party$/.test(s)) return true;
  if (/^war\b/.test(s)) return true;
  if (/\bsir$/.test(s)) return true;
  if (/\breacts?$/.test(s)) return true;
  if (/\b(low|high|best|top|latest|new)$/.test(s) && s.split(/\s+/).length <= 3) return true;
  return false;
}

function cleanTerritoryExpansionTopic(phrase, { territoryId, parentTopic, contextText, channelIdentityText } = {}) {
  const raw = String(phrase || '').trim();
  const s = raw.toLowerCase().replace(/\s+/g, ' ');
  const identityText = String(channelIdentityText || contextText || '').toLowerCase();
  if (!s) return null;

  const malformed = [
    /\binvestment (high|low) profit\b/,
    /\blow investment business\b/,
    /\b(high|low) profit investment\b/,
    /\bmarket high\b/,
    /\bbusiness low\b/,
    /\bused secret\b/,
  ];
  if (malformed.some(re => re.test(s))) return null;
  if (territoryId !== 'celebrity_pop' && /\b(box office|trailer|movie review|film review)\b/.test(s)) return null;
  if (territoryId === 'gaming' && !isGameTopicAllowedForChannel(s, identityText)) return null;
  if (
    ['personal_finance', 'macro_economy', 'crypto_web3'].includes(territoryId) &&
    !isExplicitFinanceOrBusinessContext(identityText)
  ) return null;

  const exact = new Map([
    ['inflation petrol diesel', 'petrol and diesel inflation'],
    ['petrol diesel', 'petrol and diesel prices'],
    ['sip investment', 'SIP investment strategy'],
    ['market gold', 'gold market moves'],
    ['gold rising', 'rising gold prices'],
    ['stock market', 'stock-market behavior'],
    ['stock market crash', 'stock-market crash risk'],
    ['market stocks', 'stock-market behavior'],
    ['market crash', 'market crash risk'],
    ['market crash coming', 'stock-market crash risk'],
    ['biggest startup', 'India startup shifts'],
    ['crypto market', 'crypto market moves'],
    ['gta mod', 'GTA mods'],
    ['gaming setup', 'gaming setup'],
    ['garena free fire', 'Garena Free Fire'],
    ['free fire', 'Free Fire'],
    ['iphone samsung', 'iPhone vs Samsung'],
    ['secret gta', 'GTA hidden features'],
  ]);
  if (exact.has(s)) return exact.get(s);

  if (/^iran (deal|war|america war|america israel|war impact)$/.test(s)) {
    return raw.replace(/\b\w/g, c => c.toUpperCase()).replace(/\bImpact\b/, 'impact');
  }

  if (/^(ai|sip|gta|bgmi|ipl|rbi|gdp|upsc)\b/i.test(raw)) {
    return raw.replace(/\b(ai|sip|gta|bgmi|ipl|rbi|gdp|upsc)\b/gi, m => m.toUpperCase());
  }

  if (parentTopic === 'Economy & Finance' && /\binvestment\b/.test(s) && s.split(/\s+/).length <= 2) {
    if (/\bstrategy\b/.test(s)) return raw.replace(/\b\w/g, c => c.toUpperCase());
    return `${raw.replace(/\b\w/g, c => c.toUpperCase())} strategy`;
  }

  if (territoryId === 'gaming' && /\bgta\b/.test(s)) {
    return raw.replace(/\bgta\b/gi, 'GTA').replace(/\b\w/g, c => c.toUpperCase());
  }

  return raw.replace(/\b\w/g, c => c.toUpperCase());
}

function buildTerritoryActionTitle(cleanTopic, { territoryId, parentTopic, cspPrimary } = {}) {
  const topic = String(cleanTopic || '').trim();
  if (!topic) return null;

  if (territoryId === 'personal_finance') {
    return `Explain how ${topic} affects everyday money decisions`;
  }
  if (territoryId === 'macro_economy') {
    return `Decode what ${topic} means for Indian markets`;
  }
  if (territoryId === 'crypto_web3') {
    return `Explain what ${topic} means for crypto investors`;
  }
  if (territoryId === 'entrepreneurship') {
    return `Build a business lesson around ${topic}`;
  }
  if (territoryId === 'science_tech_ai') {
    return `Explain the practical opportunity behind ${topic}`;
  }
  if (territoryId === 'gadgets_reviews') {
    return `${topic}: review the decision buyers actually need`;
  }
  if (territoryId === 'gaming') {
    return `Make a gameplay angle around ${topic}`;
  }
  if (territoryId === 'food_places') {
    return `Turn ${topic} into a specific food-location story`;
  }
  if (territoryId === 'food_recipes') {
    return `Make a practical recipe guide around ${topic}`;
  }
  if (territoryId === 'travel_places') {
    return `Create a practical travel angle around ${topic}`;
  }
  if (territoryId === 'medical_wellness') {
    return `Create a simple guide around ${topic}`;
  }
  if (territoryId === 'self_improvement') {
    return `Turn ${topic} into a practical self-improvement lesson`;
  }
  if (territoryId === 'crime_scam') {
    return `Break down the real-world lesson behind ${topic}`;
  }
  if (territoryId === 'geopolitics') {
    return `Decode how ${topic} affects India`;
  }
  if (territoryId === 'career_work' || territoryId === 'education_career') {
    return `Make ${topic} practical for students and working Indians`;
  }

  if (parentTopic === 'Economy & Finance') return `Explain what ${topic} means for viewers' money`;
  if (parentTopic === 'Science & Tech') return `Explain the practical impact of ${topic}`;
  return `Create a clear, practical angle around ${topic}`;
}

function territoryExpansionCluster(idea) {
  if (!idea || idea.source !== 'territory_expansion') return null;
  const text = [idea.topic, idea.raw_topic, idea.action_title, idea.territory_id, idea.parent_topic]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  if (/\b(iran|israel|america war|oil|petrol|diesel|hormuz|geopolitic|war impact)\b/.test(text)) return 'macro_shock';
  if (/\b(stock-market|stock market|market crash|portfolio|sip|investment|gold|mutual fund)\b/.test(text)) return 'market_investing';
  if (/\b(climate change|ai|artificial intelligence)\b/.test(text)) return 'tech_science';
  if (/\b(gta|free fire|bgmi|pubg|minecraft|valorant|roblox|gaming setup)\b/.test(text)) return 'gaming';
  return idea.territory_id || 'territory';
}

function formatBucketForVideo(video = {}) {
  const type = video.format_type || '';
  if (type === 'short_form' || type === 'likely_short_form') return 'shorts';
  if (type === 'long_form') {
    const dur = video.duration_seconds || 0;
    return dur >= 900 ? 'long' : dur >= 300 ? 'mid' : 'quick';
  }
  const dur = video.duration_seconds || 0;
  return dur <= 60 ? 'shorts' : dur <= 180 ? 'quick' : dur < 900 ? 'mid' : 'long';
}

function addFormatEvidence(bucket, video = {}) {
  if (!bucket.format_evidence) {
    bucket.format_evidence = {
      short_form_videos: 0,
      likely_short_form_videos: 0,
      long_form_videos: 0,
      unknown_videos: 0,
      short_form_views: 0,
      long_form_views: 0,
    };
  }
  let type = video.format_type || 'unknown';
  if (type === 'unknown' || !type) {
    const dur = video.duration_seconds || 0;
    if (dur > 0 && dur <= 60) type = 'short_form';
    else if (dur > 180) type = 'long_form';
  }
  const views = video.views || 0;
  if (type === 'short_form') {
    bucket.format_evidence.short_form_videos++;
    bucket.format_evidence.short_form_views += views;
  } else if (type === 'likely_short_form') {
    bucket.format_evidence.likely_short_form_videos++;
    bucket.format_evidence.short_form_views += views;
  } else if (type === 'long_form') {
    bucket.format_evidence.long_form_videos++;
    bucket.format_evidence.long_form_views += views;
  } else {
    bucket.format_evidence.unknown_videos++;
  }
}

function summarizeFormatEvidence(evidence = {}) {
  const shortCount = (evidence.short_form_videos || 0) + (evidence.likely_short_form_videos || 0);
  const longCount = evidence.long_form_videos || 0;
  const total = shortCount + longCount + (evidence.unknown_videos || 0);
  const shortPct = total ? Math.round(shortCount / total * 100) : 0;
  const longPct = total ? Math.round(longCount / total * 100) : 0;
  const evidenceType = longCount >= 2 && shortCount >= 2 ? 'mixed_signal'
    : longCount >= 2 ? 'long_form_backed'
    : shortCount >= 2 ? 'short_form_spark'
    : 'thin_format_signal';
  return {
    evidence_type: evidenceType,
    short_form_videos: shortCount,
    long_form_videos: longCount,
    unknown_videos: evidence.unknown_videos || 0,
    short_form_pct: shortPct,
    long_form_pct: longPct,
    short_form_views: evidence.short_form_views || 0,
    long_form_views: evidence.long_form_views || 0,
  };
}

const PEER_SIGNAL_GENERIC_PHRASES = new Set([
  'full breakdown',
  'complete breakdown',
  'truth behind',
  'real reason',
  'latest updates',
  'market analysis',
  'success mindset',
  'success mantra',
  'common mistakes',
  'beginners guide',
  'step by step',
  'what happened',
  'what next',
]);

const PEER_SIGNAL_GADGET_REVIEW_RE = /\b(review|unboxing|camera test|battery test|charging test|gaming test|price in india|full specs|specs|comparison|vs)\b/i;
const PEER_SIGNAL_GADGET_ENTITY_RE = /\b(iphone|samsung|oneplus|redmi|realme|vivo|oppo|xiaomi|motorola|iqoo|nothing phone|smartphone|phone|earbuds|buds|laptop|tablet|macbook)\b/i;

function cleanPeerSignalTitle(title) {
  let t = String(title || '')
    .replace(/#\w+/g, ' ')
    .replace(/\|{2}[^|]+\|{2}/g, ' ')
    .replace(/\s+\|\s+.*$/g, ' ')
    .replace(/\s+-\s+(latest news|full episode|full video|explained in hindi)$/i, ' ')
    .replace(/\[[^\]]{1,60}\]/g, ' ')
    .replace(/\([^)]{1,60}\)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  t = t.replace(/^[^\w]+|[^\w]+$/g, '').trim();
  if (t.length > 110) t = `${t.slice(0, 107).trim()}...`;
  return t;
}

function peerSignalContextText(ctx = {}) {
  return [
    ctx.resolvedNiche,
    ctx.primaryNiche,
    ctx.cspPrimary,
    ctx.formatProfile,
    ctx.creatorMode,
  ].filter(Boolean).join(' ').toLowerCase();
}

function expectsLongFormPeerSignal(ctx = {}) {
  const text = peerSignalContextText(ctx);
  if (/\b(shorts?|short form|reels?|comedy|sketch|gaming|gameplay)\b/.test(text)) return false;
  return /\b(curiosity_explainer|business_case_study|essay|explainer|documentary|analysis|finance|business|news|politic|geopolitic|founder|education)\b/.test(text);
}

function looksLikeGadgetReviewLeak(title, ctx = {}) {
  const text = peerSignalContextText(ctx);
  if (/\b(tech_review_gadget|gadgets_reviews|gadget review|consumer tech review)\b/.test(text)) return false;
  return PEER_SIGNAL_GADGET_REVIEW_RE.test(title || '') && PEER_SIGNAL_GADGET_ENTITY_RE.test(title || '');
}

function isPeerSignalParentAllowed(parentTopic, title, ctx = {}) {
  if (!parentTopic) return true;
  const contextText = peerSignalContextText(ctx);
  const text = `${contextText} ${title || ''}`.toLowerCase();
  const contextOnly = contextText.toLowerCase();

  const guardedParents = {
    'Competitive Exams': /\b(upsc|exam|ias|jee|neet|ssc|education|study|student|teacher)\b/,
    'Food & Cooking': /\b(food|recipe|cooking|restaurant|street food|chef|dish)\b/,
    'Travel': /\b(travel|trip|tour|destination|itinerary|hotel|place|vlog)\b/,
    'Gaming': /\b(gaming|gameplay|free fire|bgmi|pubg|minecraft|roblox|valorant)\b/,
    'Fitness': /\b(fitness|workout|gym|health|bodybuilding|yoga|weight loss)\b/,
    'Entertainment': /\b(entertainment|movie|film|ott|celebrity|comedy|roast|trailer)\b/,
    'Music': /\b(music|song|singer|album|cover|rap|lyrics)\b/,
    'Beauty & Lifestyle': /\b(beauty|makeup|skincare|fashion|outfit|lifestyle)\b/,
  };

  const guard = guardedParents[parentTopic];
  if (guard && !guard.test(text)) return false;

  if (parentTopic === 'Judiciary & Law') {
    const titleText = String(title || '').toLowerCase();
    if (/\b(law|legal|court|supreme court|policy|regulation|compliance|tax|business|company|market|scam|fraud)\b/.test(titleText)) {
      return true;
    }
    return /\b(news|politic|crime|investigation|legal)\b/.test(contextOnly);
  }

  if (parentTopic === 'Sports' && !/\b(sport|cricket|football|ipl|kabaddi|olympic|athlete)\b/.test(text)) {
    return false;
  }

  return true;
}

function peerSignalMeaningfulWords(topic) {
  return String(topic || '')
    .toLowerCase()
    .split(/\s+/)
    .map(w => w.replace(/[^a-z0-9]/g, ''))
    .filter(w => w.length >= 3 && !CONTENT_MODIFIERS.has(w));
}

function peerSignalTopicKey(topic) {
  return stripModifiers(String(topic || '').toLowerCase().trim()).replace(/\s+/g, ' ');
}

function hasTopicOverlap(topic, accepted = []) {
  const words = peerSignalMeaningfulWords(topic);
  if (!words.length) return true;
  for (const item of accepted) {
    const other = new Set(peerSignalMeaningfulWords(item?.topic || item?.title || item?.action_title || ''));
    if (!other.size) continue;
    const shared = words.filter(w => other.has(w)).length;
    if (shared >= Math.min(words.length, other.size)) return true;
    if (words.length >= 3 && shared >= words.length - 1) return true;
  }
  return false;
}

function scorePeerSignalPhrase(phrase, video, ctx = {}) {
  const topic = String(phrase || '').toLowerCase().trim();
  if (!topic || PEER_SIGNAL_GENERIC_PHRASES.has(topic)) return -999;
  if (ctx.userPhraseSet?.has(topic) || ctx.userCanonicalPhraseSet?.has(stripModifiers(topic))) return -999;
  if (isHardJunkPhrase(topic)) return -999;

  const parentTopic = inferParentTopic(topic);
  if (isMalformedTopicPhrase(topic, {
    parent_topic: parentTopic,
    niche: ctx.resolvedNiche,
    primary_niche: ctx.primaryNiche,
  })) return -999;

  const quality = assessTopicQuality(topic, {
    parent_topic: parentTopic,
    niche: ctx.resolvedNiche,
    primary_niche: ctx.primaryNiche,
    csp_primary: ctx.cspPrimary,
  });
  const words = topic.split(/\s+/).filter(Boolean);
  const contextText = peerSignalContextText(ctx);
  const businessExplainer = /\b(curiosity_explainer|business_case_study|finance|business|founder|macro|economy|explainer)\b/.test(contextText);
  const entityBonus = businessExplainer && /\b(india|indian|pakistan|china|america|market|stock|mutual|fund|tax|loan|oil|gold|silver|ambani|adani|musk|startup|business|middle class|economy|electronics)\b/i.test(topic)
    ? 14
    : 0;
  const questionFragmentPenalty = /^(who|why|how|what|when)\b/.test(topic) ? -16 : 0;
  const gadgetPenalty = looksLikeGadgetReviewLeak(video?.title || topic, ctx) ? -40 : 0;
  const parentBonus = parentTopic ? 26 : 0;
  const lengthBonus = Math.min(14, words.length * 4);

  return quality + parentBonus + lengthBonus + entityBonus + questionFragmentPenalty + gadgetPenalty;
}

function choosePeerSignalTopic(video, extractPhrases, ctx = {}) {
  const phrases = typeof extractPhrases === 'function' ? extractPhrases(video?.title || '') : [];
  let best = null;
  for (const phrase of phrases) {
    const score = scorePeerSignalPhrase(phrase, video, ctx);
    if (!best || score > best.score) {
      best = {
        topic: phrase,
        score,
        parentTopic: inferParentTopic(phrase),
      };
    }
  }

  if (best && best.score >= 5) return best;

  const cleanedTitle = cleanPeerSignalTitle(video?.title || '');
  if (!cleanedTitle || cleanedTitle.length < 12) return null;
  if (looksLikeGadgetReviewLeak(cleanedTitle, ctx)) return null;
  // Raw peer titles that are IP/series/episode-specific ("Amazing Digital Circus - Ep 9") or generic
  // reaction/announcement shells ("HER REACTION") are NOT generalizable topics — surfacing another
  // creator's video verbatim is noise. Drop them instead of using the raw title as a "topic".
  if (/\b(ep|episode|epis|part|season|chapter|vol)\.?\s*\d+\b|\b(finale|trailer|teaser|official\s+(?:music\s+)?video|full\s+(?:movie|episode|video|album)|live\s*stream)\b/i.test(cleanedTitle)) return null;
  if (/^(?:her|his|my|our|their|the)\s+(?:reaction|response)\b/i.test(cleanedTitle)) return null;
  return {
    topic: cleanedTitle,
    score: 8,
    parentTopic: inferParentTopic(cleanedTitle),
    fromTitle: true,
  };
}

function buildPeerSignalActionTitle(topic, video, ctx = {}) {
  const cleanTitle = cleanPeerSignalTitle(video?.title || '');
  const contextText = peerSignalContextText(ctx);
  if (cleanTitle) {
    if (/\b(curiosity_explainer|explainer|essay|documentary|business_case_study)\b/.test(contextText)) {
      return `Build an explainer from this proven peer angle: ${cleanTitle}`;
    }
    return `Adapt this peer-backed angle: ${cleanTitle}`;
  }
  return buildTopicActionTitle(topic, {
    parentTopic: inferParentTopic(topic),
    recType: 'topic_gap',
    resolvedNiche: ctx.resolvedNiche,
    cspPrimary: ctx.cspPrimary,
  });
}

function buildPeerVideoSignalIdeas(videos = [], {
  existingIdeas = [],
  communityIds = [],
  extractPhrases,
  getFormatWinner,
  nowMs = Date.now(),
  userPhraseSet,
  userCanonicalPhraseSet,
  resolvedNiche,
  primaryNiche,
  cspPrimary,
  formatProfile,
  creatorMode,
  minMedianViews = 0,
  limit = 8,
  dna = null,
} = {}) {
  const debug = {
    active: false,
    video_count: videos.length,
    candidate_count: 0,
    selected_count: 0,
  };

  if (!Array.isArray(videos) || videos.length === 0) return { ideas: [], debug };

  const ctx = {
    resolvedNiche,
    primaryNiche,
    cspPrimary,
    formatProfile,
    creatorMode,
    userPhraseSet,
    userCanonicalPhraseSet,
  };
  const requireLong = expectsLongFormPeerSignal(ctx);
  const minViews = Math.max(500, Math.round((minMedianViews || 1000) * 0.30));
  const existingKeys = new Set(existingIdeas.map(i => peerSignalTopicKey(i.topic || i.title || i.action_title || '')).filter(Boolean));
  const topicMap = new Map();

  for (const video of videos) {
    const title = video?.title || '';
    const cleanTitle = cleanPeerSignalTitle(title);
    if (!cleanTitle) continue;
    if ((video.views || 0) < minViews) continue;
    if (looksLikeGadgetReviewLeak(title, ctx)) continue;
    if (/\b(marathi|telugu|tamil|kannada|malayalam|bengali)\b/i.test(title)) continue;
    // P2 English peer enrichment filters (June 14, 2026)
    // Hindi script / Hinglish (ka/ki/ko/ne/hai/tha/nahi family)
    if (/[ऀ-ॿ]/.test(title)) continue;
    if (/\b(ka|ki|ko|ne|hai|tha|thi|gaya|nahi|nhi|bhari|lagri|khilaya|ghar|khana|chori)\b/i.test(title) && (title.match(/\b(ka|ki|ko|ne|hai|tha|thi|gaya|nahi|nhi|bhari|lagri|khilaya|ghar|khana|chori)\b/gi) || []).length >= 2) continue;
    // Episode / serial show titles
    if (/\b(episode|ep\.?\s*\d+|part\s*\d+|back to back|official trailer|comedy scenes)\b/i.test(title)) continue;
    if (/\bby\s+\w+\s+(tv|ltd|fun|media)\b/i.test(title)) continue;
    // Promotional / @mention content
    if (/@\w+/.test(title) && /\b(comedy|vlog|watch|subscribe|follow)\b/i.test(title)) continue;
    if (/\b(presented by|buy now|#ad\b|happilac|ujooba)\b/i.test(title)) continue;
    // Too short to be adaptable (< 3 meaningful tokens)
    const _titleWords = title.trim().split(/\s+/).filter(w => w.length > 2);
    if (_titleWords.length < 3) continue;
    if (requireLong) {
      const dur = video.duration_seconds || 0;
      if (video.format_type === 'short_form' || video.format_type === 'likely_short_form') continue;
      if (dur > 0 && dur <= 120) continue;
    }

    const chosen = choosePeerSignalTopic(video, extractPhrases, ctx);
    if (!chosen) continue;
    const displayParentTopic = chosen.parentTopic || inferParentTopic(cleanTitle);
    if (!isPeerSignalParentAllowed(displayParentTopic, title, ctx)) continue;
    const key = peerSignalTopicKey(chosen.topic);
    if (!key || existingKeys.has(key)) continue;
    if (hasTopicOverlap(chosen.topic, existingIdeas)) continue;

    if (!topicMap.has(key)) {
      topicMap.set(key, {
        topic: chosen.topic,
        parentTopic: displayParentTopic,
        quality: chosen.score,
        channels: new Set(),
        videos: [],
        allViews: [],
        cnt_0_14: 0,
        cnt_15_30: 0,
        cnt_31_60: 0,
        cnt_61_90: 0,
        formats: {
          shorts: { count: 0, totalViews: 0 },
          quick:  { count: 0, totalViews: 0 },
          mid:    { count: 0, totalViews: 0 },
          long:   { count: 0, totalViews: 0 },
        },
        format_evidence: {
          short_form_videos: 0,
          likely_short_form_videos: 0,
          long_form_videos: 0,
          unknown_videos: 0,
          short_form_views: 0,
          long_form_views: 0,
        },
      });
    }

    const b = topicMap.get(key);
    const ageDays = (nowMs - new Date(video.published_at).getTime()) / 86400000;
    b.channels.add(video.channel_id);
    b.videos.push(video);
    b.allViews.push({ v: video.views || 0, w: recencyWeight(ageDays) });
    if (ageDays <= 14)      b.cnt_0_14++;
    else if (ageDays <= 30) b.cnt_15_30++;
    else if (ageDays <= 60) b.cnt_31_60++;
    else                    b.cnt_61_90++;
    const fmtKey = formatBucketForVideo(video);
    b.formats[fmtKey].count++;
    b.formats[fmtKey].totalViews += video.views || 0;
    addFormatEvidence(b, video);
  }

  const poolSize = Math.max(1, communityIds.length || new Set(videos.map(v => v.channel_id).filter(Boolean)).size);
  const candidates = [];
  for (const b of topicMap.values()) {
    b.videos.sort((a, z) => (z.views || 0) - (a.views || 0));
    const avgViews = weightedMedian(b.allViews);
    const recent = b.cnt_0_14 + b.cnt_15_30;
    const trendStatus = recent > 0 ? 'rising' : 'evergreen';
    const saturationPct = Math.min(100, Math.round(b.channels.size / poolSize * 100));
    const formatEvidence = summarizeFormatEvidence(b.format_evidence);
    const formatScoreAdj = formatEvidence.evidence_type === 'long_form_backed' ? 6
      : formatEvidence.evidence_type === 'mixed_signal' ? 3
      : formatEvidence.evidence_type === 'short_form_spark' ? -12
      : 0;
    // #3e — concept-affinity × narrative boost. A peer title that matches THIS
    // creator's concept affinity AND carries a proven narrative shape is the only
    // historical source of Excellent recs — surface it above generic peer topics.
    let affinity = 0, narrative = 0, affinityBoost = 0;
    if (dna) {
      try {
        const _concept = extractConcept(b.topic);
        affinity = _concept ? (computeConceptAffinity(dna, _concept.concept_id) || 0) : 0;
      } catch (_) { affinity = 0; }
      narrative = _narrativeMatch(b.topic);
      // affinity 0..~0.5 → up to +20; narrative match → +12; narrative only counts
      // when there is at least weak affinity (a narrative shape for an unrelated topic
      // is still off-creator).
      affinityBoost = Math.round(Math.min(20, affinity * 45)) + (narrative && affinity > 0.03 ? 12 : 0);
    }

    const score = Math.max(1, Math.min(95, Math.round(
      Math.min(34, Math.log10(avgViews + 1) / 7 * 34)
      + Math.min(16, b.channels.size * 6)
      + (trendStatus === 'rising' ? 10 : 5)
      + Math.max(-8, Math.min(18, b.quality || 0))
      + formatScoreAdj
      + affinityBoost,
    )));

    candidates.push({
      bucket: b,
      score,
      avgViews,
      trendStatus,
      saturationPct,
      formatEvidence,
      affinity,
      narrative,
    });
  }

  candidates.sort((a, b) => b.score - a.score || b.avgViews - a.avgViews);
  debug.candidate_count = candidates.length;

  const selected = [];
  const selectedKeys = new Set();
  const selectedChannels = new Set();
  const selectedIdeas = [];

  for (let pass = 1; pass <= 2 && selected.length < limit; pass++) {
    for (const cand of candidates) {
      if (selected.length >= limit) break;
      const b = cand.bucket;
      const key = peerSignalTopicKey(b.topic);
      if (selectedKeys.has(key)) continue;
      const channelList = [...b.channels];
      if (pass === 1 && channelList.length === 1 && selectedChannels.has(channelList[0])) continue;
      if (hasTopicOverlap(b.topic, [...existingIdeas, ...selectedIdeas])) continue;

      selectedKeys.add(key);
      channelList.forEach(ch => selectedChannels.add(ch));
      selected.push(cand);
      selectedIdeas.push({ topic: b.topic });
    }
  }

  const ideas = selected.map(cand => {
    const b = cand.bucket;
    const totalVideos = b.videos.length;
    const topVideo = b.videos[0] || {};
    const topic = cleanPeerSignalTitle(topVideo.title) || _titleCasePhrase(b.topic);
    const rawTopic = _titleCasePhrase(b.topic);
    const actionTitle = buildPeerSignalActionTitle(topic, topVideo, ctx);
    const saturationLevel = cand.saturationPct < 20 ? 'low' : cand.saturationPct < 60 ? 'medium' : 'high';
    return {
      topic,
      raw_topic: rawTopic,
      title: actionTitle,
      action_title: actionTitle,
      score: cand.score,
      recommendation_type: 'peer_video_signal',
      idea_type: 'peer_video_signal',
      source: 'peer_video_signal',
      channel_count: b.channels.size,
      avg_views: Math.round(cand.avgViews),
      trend_status: cand.trendStatus,
      saturation_pct: cand.saturationPct,
      saturation_level: saturationLevel,
      format_winner: typeof getFormatWinner === 'function' ? getFormatWinner(b.formats, totalVideos) : null,
      format_evidence: cand.formatEvidence,
      evidence_type: cand.formatEvidence.evidence_type,
      velocity: null,
      act_now: cand.trendStatus === 'rising' && cand.saturationPct < 30,
      event_stage: null,
      topic_category: null,
      expected_low: null,
      expected_high: null,
      trending: (b.cnt_0_14 + b.cnt_15_30) / Math.max(1, totalVideos) >= 0.4,
      examples: b.videos.slice(0, 3).map(v => ({
        title:        v.title,
        views:        v.views,
        channel_name: v.channel_name || 'Unknown',
        format_type:  v.format_type || 'unknown',
        video_id:     v.youtube_video_id || null,
      })),
      parent_topic: b.parentTopic || inferParentTopic(topic),
      anchor_topic: null,
      is_angle: false,
      why: `${b.channels.size} peer channel${b.channels.size === 1 ? '' : 's'} produced a high-performing adjacent video averaging ${_fmtV(Math.round(cand.avgViews))} views. This is evidence-backed, but narrower than a repeated community topic.`,
    };
  });

  debug.active = ideas.length > 0;
  debug.selected_count = ideas.length;
  return { ideas, debug };
}

function loadSnapshotMap(db, videoIds, { maxIds = 500, chunkSize = 100 } = {}) {
  const snapMap = new Map();
  if (!Array.isArray(videoIds) || videoIds.length === 0) return snapMap;

  const ids = [...new Set(videoIds.filter(Boolean))].slice(0, maxIds);
  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize);
    const ph = chunk.map(() => '?').join(',');
    db.all(
      `SELECT video_id, bucket, views, subscriber_adjusted_velocity AS sav
       FROM video_growth_snapshots INDEXED BY idx_vgs_video_bucket
       WHERE video_id IN (${ph}) AND bucket IN ('7d', '30d')`,
      chunk,
    ).forEach(s => {
      if (!snapMap.has(s.video_id)) snapMap.set(s.video_id, {});
      const e = snapMap.get(s.video_id);
      if (s.bucket === '7d')  e.v7  = s.views;
      if (s.bucket === '30d') { e.v30 = s.views; e.sav30 = s.sav; }
    });
  }
  return snapMap;
}

function buildTerritoryExpansionIdeas(db, {
  channelId,
  acceptedTerritories,
  extractPhrases,
  classifyTrend,
  getFormatWinner,
  nowMs,
  userPhraseSet,
  userCanonicalPhraseSet,
  resolvedNiche,
  primaryNiche,
  channelIdentityText,
  cspPrimary,
  userOwnMedian,
  getVelocity,
}) {
  const debug = {
    active: false,
    territories_considered: (acceptedTerritories || []).map(t => ({
      territory_id: t.territory_id,
      role: t.role,
      video_count: t.video_count,
      view_lift: t.view_lift,
    })),
    territories_used: [],
    candidate_count: 0,
  };

  if (!channelId || !acceptedTerritories?.length) return { ideas: [], debug };

  const since = new Date(nowMs - 120 * 86400000).toISOString().slice(0, 10);
  const ideas = [];
  const seenTopics = new Set();
  const minMedianViews = userOwnMedian > 0 ? Math.max(500, Math.round(userOwnMedian * 0.10)) : 1000;
  const contextText = [resolvedNiche, primaryNiche, cspPrimary].filter(Boolean).join(' ').toLowerCase();
  const identityText = String(channelIdentityText || contextText).toLowerCase();

  for (const territory of acceptedTerritories.slice(0, 3)) {
    const peerRows = db.all(
      `SELECT ctp.channel_id
       FROM channel_territory_profiles ctp
       JOIN ingested_channels ic ON ic.channel_id = ctp.channel_id
       WHERE ctp.territory_id = ?
         AND ctp.channel_id != ?
         AND ctp.role IN ('core','accepted')
         AND COALESCE(ctp.view_lift, 0) >= 0.8
         AND ctp.video_count >= 3
         AND ic.ingest_enabled = 1
       ORDER BY
         CASE ctp.role WHEN 'core' THEN 0 ELSE 1 END,
         COALESCE(ctp.view_lift, 0) DESC,
         ctp.video_count DESC
       LIMIT 120`,
      [territory.territory_id, channelId],
    );
    const peerIds = peerRows.map(r => r.channel_id);
    if (peerIds.length < 5) {
      debug.territories_used.push({ territory_id: territory.territory_id, peer_count: peerIds.length, video_count: 0, ideas: 0, skipped: 'peer_count_lt_5' });
      continue;
    }

    const ph = peerIds.map(() => '?').join(',');
    const videos = db.all(
      `SELECT youtube_video_id, title, views, channel_id, published_at, duration_seconds, format_type, format_confidence, channel_name
       FROM (
         SELECT iv.youtube_video_id, iv.title, iv.views, iv.channel_id,
                iv.published_at, iv.duration_seconds, iv.format_type, iv.format_confidence, ic.channel_name,
                ROW_NUMBER() OVER (PARTITION BY iv.channel_id ORDER BY iv.views DESC) AS rn
         FROM ingested_videos iv
         JOIN video_territories vt
           ON vt.video_id = iv.youtube_video_id
          AND vt.territory_id = ?
          AND vt.confidence IN ('high','medium')
         LEFT JOIN ingested_channels ic ON ic.channel_id = iv.channel_id
         WHERE iv.channel_id IN (${ph})
           AND iv.published_at >= ?
           AND iv.title IS NOT NULL
           AND iv.views > 0
       ) WHERE rn <= 5`,
      [territory.territory_id, ...peerIds, since],
    );
    if (videos.length < 20) {
      debug.territories_used.push({ territory_id: territory.territory_id, peer_count: peerIds.length, video_count: videos.length, ideas: 0, skipped: 'video_count_lt_20' });
      continue;
    }

    const topicMap = new Map();
    for (const video of videos) {
      const phrases = extractPhrases(video.title);
      const seenThisVideo = new Set();
      const ageDays = (nowMs - new Date(video.published_at).getTime()) / 86400000;
      const fmtKey = formatBucketForVideo(video);

      for (const phrase of phrases) {
        if (seenThisVideo.has(phrase)) continue;
        seenThisVideo.add(phrase);
        if (isHardJunkPhrase(phrase)) continue;
        if (isDisallowedPersonTopic(phrase, { niche: resolvedNiche, primary_niche: primaryNiche, csp_primary: cspPrimary })) continue;
        const parentTopic = inferParentTopic(phrase);
        const quality = assessTopicQuality(phrase, { parent_topic: parentTopic, niche: resolvedNiche, primary_niche: primaryNiche, csp_primary: cspPrimary });
        if (!parentTopic && quality < 0) continue;

        if (!topicMap.has(phrase)) {
          topicMap.set(phrase, {
            videos: [],
            allViews: [],
            channels: new Set(),
            cnt_0_14: 0,
            cnt_15_30: 0,
            cnt_31_60: 0,
            cnt_61_90: 0,
            formats: {
              shorts: { count: 0, totalViews: 0 },
              quick:  { count: 0, totalViews: 0 },
              mid:    { count: 0, totalViews: 0 },
              long:   { count: 0, totalViews: 0 },
            },
            format_evidence: {
              short_form_videos: 0,
              likely_short_form_videos: 0,
              long_form_videos: 0,
              unknown_videos: 0,
              short_form_views: 0,
              long_form_views: 0,
            },
            vel_pairs: [],
            parentTopic,
            quality,
          });
        }

        const b = topicMap.get(phrase);
        if (b.videos.length < 3) b.videos.push(video);
        b.allViews.push({ v: video.views || 0, w: recencyWeight(ageDays) });
        b.channels.add(video.channel_id);
        if (ageDays <= 14)      b.cnt_0_14++;
        else if (ageDays <= 30) b.cnt_15_30++;
        else if (ageDays <= 60) b.cnt_31_60++;
        else                    b.cnt_61_90++;
        b.formats[fmtKey].count++;
        b.formats[fmtKey].totalViews += (video.views || 0);
        addFormatEvidence(b, video);
      }
    }

    canonicalizePhrases(topicMap);
    const territoryIdeas = [];
    const minChannels = peerIds.length <= 20 ? 2 : 3;
    for (const [phrase, b] of topicMap.entries()) {
      if (b.channels.size < minChannels) continue;
      if (b.allViews.length < 2) continue;
        if (userPhraseSet?.has(phrase) || userCanonicalPhraseSet?.has(stripModifiers(phrase))) continue;
      if (isWeakTerritoryExpansionTopic(phrase)) continue;
      const topicKey = phrase.toLowerCase();
      if (seenTopics.has(topicKey)) continue;
      const medianViews = weightedMedian(b.allViews);
      if (medianViews < minMedianViews) continue;
      const parentTopic = inferParentTopic(phrase) || b.parentTopic;
      if (!parentTopic) continue;
      if (!isParentAllowedForTerritory(territory.territory_id, parentTopic)) continue;
      if (territory.territory_id === 'crime_scam' && parentTopic === 'Judiciary & Law' && phrase.split(/\s+/).length < 3) continue;
      if (
        parentTopic === 'Politics' &&
        !/(podcast|interview|news|politic|current|upsc|exam|education|ias)/.test(contextText)
      ) continue;
      const cleanTopic = cleanTerritoryExpansionTopic(phrase, {
        territoryId: territory.territory_id,
        parentTopic,
        contextText,
        channelIdentityText: identityText,
      });
      if (!cleanTopic) continue;

      const trendStatus = classifyTrend(b);
      const saturationPct = Math.min(100, Math.round(b.channels.size / Math.max(1, peerIds.length) * 100));
      const baseViews = Math.min(35, Math.log10(medianViews + 1) / 7 * 35);
      const spread = Math.min(18, (b.channels.size / Math.max(1, peerIds.length)) * 18);
      const rarityBonus = saturationPct < 20 ? 8 : saturationPct < 40 ? 4 : 0;
      const permissionBonus = territory.role === 'core' ? 8 : 4;
      const liftBonus = Math.min(8, Math.max(0, Number(territory.view_lift || 0) * 3));
      const formatEvidence = summarizeFormatEvidence(b.format_evidence);
      const formatScoreAdj = formatEvidence.evidence_type === 'long_form_backed' ? 4
        : formatEvidence.evidence_type === 'mixed_signal' ? 2
        : formatEvidence.evidence_type === 'short_form_spark' ? -8
        : -2;
      const score = Math.max(1, Math.min(89, Math.round(baseViews + spread + rarityBonus + permissionBonus + liftBonus + (b.quality || 0) * 0.35 + formatScoreAdj)));

      seenTopics.add(topicKey);
      territoryIdeas.push({
        topic: cleanTopic,
        raw_topic: _titleCasePhrase(phrase),
        action_title: buildTerritoryActionTitle(cleanTopic, {
          territoryId: territory.territory_id,
          parentTopic,
          cspPrimary,
        }),
        score,
        recommendation_type: 'territory_expansion',
        idea_type: 'territory_expansion',
        source: 'territory_expansion',
        territory_id: territory.territory_id,
        territory_role: territory.role,
        territory_source: 'territory_expansion',
        channel_count: b.channels.size,
        avg_views: Math.round(medianViews),
        trend_status: trendStatus,
        saturation_pct: saturationPct,
        saturation_level: saturationPct < 20 ? 'low' : saturationPct < 60 ? 'medium' : 'high',
        format_winner: getFormatWinner(b.formats, b.allViews.length),
        format_evidence: formatEvidence,
        evidence_type: formatEvidence.evidence_type,
        velocity: getVelocity ? getVelocity(b.vel_pairs) : null,
        act_now: trendStatus === 'rising' && saturationPct < 30,
        event_stage: null,
        topic_category: null,
        expected_low: null,
        expected_high: null,
        trending: b.cnt_0_14 / Math.max(1, b.allViews.length) >= 0.4,
        examples: b.videos.slice(0, 3).map(v => ({
          title: v.title,
          views: v.views,
          channel_name: v.channel_name || 'Unknown',
        })),
        parent_topic: parentTopic,
        anchor_topic: null,
        is_angle: false,
        why: `${b.channels.size} territory peers averaged ${_fmtV(Math.round(medianViews))} views on this. This comes from a territory your audience has already accepted (${territory.role}).`,
      });
    }

    territoryIdeas.sort((a, b) => b.score - a.score);
    const selected = territoryIdeas.slice(0, 5);
    ideas.push(...selected);
    debug.territories_used.push({
      territory_id: territory.territory_id,
      role: territory.role,
      peer_count: peerIds.length,
      video_count: videos.length,
      ideas: selected.length,
    });
  }

  ideas.sort((a, b) => b.score - a.score);
  debug.active = ideas.length > 0;
  debug.candidate_count = ideas.length;
  return { ideas: ideas.slice(0, 12), debug };
}

function computeNarrativeSignalsInline(anchor, narrative, videos, poolSize, nowMs) {
  const allTokens = [...anchor.split(' '), ...narrative.split(' ')];
  const now24h    = nowMs - 86400000;
  const now48h    = nowMs - 2 * 86400000;
  let firstMs     = Infinity;
  let recentCnt = 0, priorCnt = 0;
  const allCh = new Set(), recentCh = new Set(), priorCh = new Set();
  for (const v of videos) {
    const lower = (v.title || '').toLowerCase();
    if (!allTokens.every(t => lower.includes(t))) continue;
    const ts = new Date(v.published_at).getTime();
    if (ts < firstMs) firstMs = ts;
    allCh.add(v.channel_id);
    if (ts >= now24h)       { recentCnt++; recentCh.add(v.channel_id); }
    else if (ts >= now48h)  { priorCnt++;  priorCh.add(v.channel_id); }
  }
  if (!allCh.size) return null;
  return {
    age_hours:       Math.round((nowMs - firstMs) / 3600000),
    channel_count:   allCh.size,
    saturation_pct:  poolSize ? Math.min(100, Math.round(allCh.size / poolSize * 100)) : 0,
    velocity:        recentCh.size - priorCh.size,
    pub_rate_recent: recentCnt,
    pub_rate_prior:  priorCnt,
  };
}

// ── Evergreen niche fallback for Category A / C channels ─────────────────────
// Appended only when the full engine produces fewer than 5 ideas.
// Returned ideas are marked source:'fallback_evergreen' and confidence:'low'
// so the UI can render them with reduced prominence.
function _getNicheFallback(niche) {
  const n = (niche || '').toLowerCase();
  const ev = (topic, why) => ({
    topic, idea_type: 'evergreen_prompt', recommendation_type: 'topic_gap',
    trend_status: 'evergreen', channel_count: 0, avg_views: 0,
    saturation_pct: 0, saturation_level: 'low', examples: [],
    is_angle: false, act_now: false, why,
  });

  if (/comedy|sketch|humou?r|funny|troll|roast|reaction|meme|prank/i.test(n)) return [
    ev('Recurring character sketch: one situation, three escalating reactions', 'Repeatable character formats build familiarity while keeping each episode fresh.'),
    ev('Expectation vs reality in one very specific everyday situation', 'Contrast framing is instantly understandable and works well in short-form comedy.'),
    ev('One awkward everyday problem turned into a mini story', 'Specific everyday situations are easier to relate to than broad comedy topics.'),
    ev('Public reaction or family reaction to a harmless twist', 'Reaction structure gives the audience a clear payoff to wait for.'),
    ev('Same joke setup in three different locations', 'Reusing a structure across locations creates a series without copying another creator.'),
  ];

  if (/gaming|gameplay|free fire|bgmi|pubg|minecraft|roblox|valorant/i.test(n)) return [
    ev('What actually changed in the latest update - honest breakdown', 'Update-reaction content peaks in search traffic right after patches.'),
    ev('Can I win with a self-imposed restriction? — challenge run', 'Challenge format has the highest session-start rate in gaming.'),
    ev('Mistakes most new players make — and how to fix them', 'Beginner-mistake framing drives search traffic from new players.'),
    ev('Best settings or loadout for low-end phones', 'Practical optimisation videos travel well across gaming communities.'),
    ev('One match fully explained: every decision I made', 'Decision breakdowns make gameplay useful, not just entertaining.'),
  ];

  if (/movie|film|trailer|ott|web series|celebrity|bollywood|tollywood|kollywood|tv show|cinema/i.test(n)) return [
    ev('Trailer breakdown: 5 details most viewers missed', 'Detail-hunt framing gives fans a reason to rewatch and comment.'),
    ev('Before you watch the new release: story recap in 3 minutes', 'Recap content performs before new releases and helps late viewers catch up.'),
    ev('Ending explained without spoilers first, then spoiler section', 'Clear spoiler structure increases trust and watch time.'),
    ev('Actor performance ranking: best scene to weakest scene', 'Rankings create debate without needing new footage.'),
    ev('What the makers changed from the original/source material', 'Comparison framing works for remakes, adaptations, and sequels.'),
  ];

  if (/\b(music|song|songs|singer|studio|records|lyrics|lyrical|audio|album|cover|remix|dj|bhojpuri|punjabi music|bollywood songs|dance music)\b/i.test(n)) return [
    ev('Acoustic or unplugged version of your strongest song', 'A stripped-back version gives existing music a fresh emotional hook without needing a new composition.'),
    ev('Lyric video with clean on-screen subtitles', 'Lyric-first packaging makes songs easier to share, sing along with, and discover through search.'),
    ev('Behind-the-song: story, lyrics, and recording process', 'Process and meaning videos deepen audience connection around music that already exists.'),
    ev('Short hook clip built around the catchiest 15 seconds', 'Short-form music discovery works best when the strongest hook is obvious immediately.'),
    ev('Fan-request medley or mashup around one mood', 'Medley framing lets you package familiar songs into a new repeatable format.'),
  ];

  if (/entertainment|drama|story|moral story|social experiment|inspirational story|short film|web drama/i.test(n)) return [
    ev('One moral dilemma told through a short story', 'Entertainment story channels work best when the audience has a clear choice to debate.'),
    ev('Expectation vs reality: the hidden truth behind one everyday situation', 'Contrast framing gives a familiar story a stronger hook.'),
    ev('A character learns the lesson too late', 'Consequence-led stories create retention because viewers wait for the payoff.'),
    ev('Same conflict, two endings: what would you choose?', 'Alternate-ending framing invites comments without needing a new topic source.'),
    ev('Behind the decision: why one character made the wrong choice', 'Character-motivation breakdowns turn simple drama into discussion content.'),
  ];

  if (/education|learning|language|vocabulary|grammar|math|exam|study|teacher|school|gk|general knowledge|quiz|class|computer basics/i.test(n)) return [
    ev('5 common mistakes beginners make — and how to fix each one', 'Mistake-led lessons are concrete and saveable.'),
    ev('One concept explained with three real-life examples', 'Examples turn abstract learning into practical understanding.'),
    ev('Quick revision sheet: everything you actually need to know', 'Revision framing gives a clear utility promise.'),
    ev('Quiz format: pause and answer before I explain', 'Interactive learning increases retention and comments.'),
    ev('Before exam checklist: what to revise and what to skip', 'Decision-help content is more actionable than broad study advice.'),
  ];

  if (/curiosity_explainer|curiosity explainer|explainer|hidden system|why it works|how india works/i.test(n)) return [
    ev('Why one everyday bill, product, or rule suddenly changed', 'Aevy-style explainers work when a familiar detail reveals a larger system.'),
    ev('The hidden system behind one thing everyone uses', 'System-behind-the-object framing turns broad topics into concrete curiosity.'),
    ev('What most people misunderstand about one common choice', 'Misunderstanding framing gives the audience a reason to keep watching.'),
    ev('One weird data point that explains a bigger India story', 'A surprising statistic can open into business, policy, tech, or society without feeling generic.'),
    ev('Before vs after: how one rule, company, or technology changed daily life', 'Change-over-time framing gives explainer content a clear narrative arc.'),
  ];

  if (/news|politic|current events|current affairs|breaking|local news|odisha|army|defence|defense|geopolitics/i.test(n)) return [
    ev('Explainer: what happened, why it matters, what changes next', 'Structured explainers stay useful after the breaking-news spike fades.'),
    ev('Timeline of the issue in 5 key moments', 'Timeline framing creates clarity for viewers who joined late.'),
    ev('Local impact: how this affects ordinary people', 'Impact framing makes broad news personally relevant.'),
    ev('Fact check: three claims being shared right now — true or false?', 'Verification content builds trust and attracts search traffic.'),
    ev('Two-sided analysis: strongest argument from each side', 'Balanced framing improves authority and comment quality.'),
  ];

  if (/sport|cricket|football|ipl|kabaddi|tournament|match|highlights|player/i.test(n)) return [
    ev('Match preview: key battles that decide the result', 'Key-battle framing is specific and useful before the match.'),
    ev('Player form breakdown: what changed recently', 'Form analysis gives viewers a concrete reason to watch.'),
    ev('Post-match: three moments that changed everything', 'Moment-based analysis is clearer than generic match reactions.'),
    ev('Beginner explainer: one rule or tactic made simple', 'Simple explainers widen the audience beyond hardcore fans.'),
    ev('Best XI / lineup debate with clear reasoning', 'Selection debates drive comments and repeat viewing.'),
  ];

  if (/tech|smartphone|phone|gadget|electronics|camera|laptop|review|repair|audio equipment|audio|sound system|dj sound|speaker|microphone|computer|software|hardware/i.test(n)) return [
    ev('Buying guide: who should buy this and who should skip it', 'Decision framing is more useful than raw specs.'),
    ev('Real-world test: one week later, what changed?', 'Longer-use reviews feel more trustworthy than launch-day coverage.'),
    ev('Budget alternative comparison: cheaper vs expensive option', 'Comparison content helps viewers make a purchase decision.'),
    ev('Top problems users face and how to fix them', 'Fix videos attract search traffic and saves.'),
    ev('Settings or setup guide for better performance', 'Practical setup videos stay evergreen after the review cycle.'),
  ];

  if (/science|physics|chemistry|biology|space|astronomy|engineering|experiment|research|veritasium/i.test(n)) return [
    ev('One surprising experiment that proves the concept', 'Science ideas become watchable when the proof is visible, not only explained.'),
    ev('Why the common explanation is incomplete', 'Correction framing works well for curious audiences who already know the basics.'),
    ev('Everyday object, hidden physics behind it', 'Familiar objects make abstract science feel immediately relevant.'),
    ev('The history of one discovery and the mistake that led to it', 'Discovery stories add narrative to technical topics.'),
    ev('Prediction test: what do you think happens next?', 'Interactive experiments increase retention and comments.'),
  ];

  if (/curiosity_explainer|curiosity explainer|explainer|hidden system|why it works|how india works/i.test(n)) return [
    ev('Why one everyday bill, product, or rule suddenly changed', 'Aevy-style explainers work when a familiar detail reveals a larger system.'),
    ev('The hidden system behind one thing everyone uses', 'System-behind-the-object framing turns broad topics into concrete curiosity.'),
    ev('What most people misunderstand about one common choice', 'Misunderstanding framing gives the audience a reason to keep watching.'),
    ev('One weird data point that explains a bigger India story', 'A surprising statistic can open into business, policy, tech, or society without feeling generic.'),
    ev('Before vs after: how one rule, company, or technology changed daily life', 'Change-over-time framing gives explainer content a clear narrative arc.'),
  ];

  if (/finance|personal finance|investing|stock market|trading|mutual fund|wealth|money|budget|saving|credit card|tax|loan/i.test(n)) return [
    ev('One money mistake and the exact fix', 'Mistake-led finance content is practical and easy to save.'),
    ev('Beginner plan: what to do with the first small investment', 'Entry-level money plans widen the audience without needing market timing.'),
    ev('Product comparison: who should choose which option?', 'Decision framing is more useful than generic financial education.'),
    ev('Real portfolio or budget breakdown with lessons', 'Transparent breakdowns build trust and start discussion.'),
    ev('Myth vs reality about a popular money rule', 'Myth correction keeps evergreen finance topics fresh.'),
  ];

  if (/business|startup|career|job|freelance|marketing|monetization|income|entrepreneur/i.test(n)) return [
    ev('Case study: how one small creator/business grew from zero', 'Specific case studies feel more credible than generic advice.'),
    ev('Step-by-step beginner plan for getting started in this field', 'Beginner plans convert curiosity into action.'),
    ev('Mistakes I would avoid if starting today', 'Anti-advice is more trustworthy than success-only storytelling.'),
    ev('Tool and process breakdown: exactly how I approach this task', 'Operational breakdowns are saveable and repeatable.'),
    ev('Reality check: what nobody tells you about achieving this goal', 'Reality-check framing attracts serious viewers.'),
  ];

  if (/devotional|bhakti|spiritual|bhajan|chalisa|mantra|aarti|quran|nasheed|islamic|prayer/i.test(n)) return [
    ev('Meaning explained: one prayer line by line', 'Meaning-led devotional content serves viewers who want depth, not only audio.'),
    ev('Morning routine version: short prayer for daily listening', 'Daily-use devotional content builds repeat viewing.'),
    ev('Festival special: what to chant, when, and why', 'Occasion framing creates seasonal demand while remaining evergreen yearly.'),
    ev('Calm loop version for study, sleep, or meditation', 'Longer loop formats create watch time and practical use.'),
    ev('Story behind the prayer or saint in simple language', 'Narrative context makes devotional content shareable.'),
  ];

  if (/beauty|makeup|skincare|fashion|outfit|lifestyle|routine|nail/i.test(n)) return [
    ev('Budget routine: full look under a fixed price', 'Budget constraints make beauty content practical and clickable.'),
    ev('One product, three looks or uses', 'Multi-use framing helps viewers decide whether a product is worth buying.'),
    ev('Mistakes beginners make with products and routines like this', 'Correction framing earns saves and builds trust.'),
    ev('Before and after: honest wear test after full day', 'Wear-test proof is more useful than first impressions.'),
    ev('Get ready with me for a specific occasion', 'Occasion-led packaging gives the video a clear use case.'),
  ];

  if (/culture|village|rural|family life|daily life|desi|regional|punjabi culture|tibetan|rajasthani/i.test(n)) return [
    ev('A full day in my life with one unusual detail explained', 'Daily-life content works best when one specific detail carries the story.'),
    ev('Old tradition explained by someone who still practices it', 'Tradition explainers add meaning to observational vlogs.'),
    ev('Local food, place, or custom outsiders misunderstand', 'Misunderstanding framing creates curiosity and comments.'),
    ev('Then vs now: how this place or habit has changed', 'Change-over-time framing gives simple footage a narrative.'),
    ev('Family story behind one object, recipe, or routine', 'Personal context makes culture content distinct from generic vlogs.'),
  ];

  if (/fitness|workout|bodybuilding|gym|yoga|exercise|weight loss|fat loss|muscle|calisthenics|health|medical|doctor|medicine|ayurveda|natural remedies|nutrition/i.test(n)) return [
    ev('One routine tested for 7 days with honest results', 'Health and fitness advice becomes actionable when viewers see a concrete experiment.'),
    ev('The common mistake beginners make and the correct form/fix', 'Correction content earns saves because viewers can apply it immediately.'),
    ev('Beginner plan: exact steps for the first week', 'Specific first-week plans reduce friction for new viewers.'),
    ev('Myth vs reality about a common health or fitness belief', 'Myth framing is useful, searchable, and comment-friendly.'),
    ev('Full day breakdown: food, movement, recovery, and what to avoid', 'Routine breakdowns make health content practical instead of motivational only.'),
  ];

  if (/selfimprovement|psychology|mindset|motivation|adhd|mental|longevity|wellness|philosophy|spiritual inquiry|consciousness/i.test(n)) return [
    ev('One habit I tested for 7 days and what changed', 'Self-improvement works best when advice is attached to a lived experiment.'),
    ev('The hidden mistake that keeps beginners stuck', 'Mistake framing turns abstract advice into a fixable problem.'),
    ev('Myth vs reality about a common belief in this field', 'Myth framing invites comments and corrects common beliefs.'),
    ev('Simple checklist for handling the most common challenge here', 'Checklist content is saveable and practical.'),
    ev('Real story: before and after I changed one key habit', 'Story-led transformation feels more trustworthy than generic motivation.'),
  ];

  if (/children|kids|story|stories|storytelling|top 10|top ten|unique|facts|trivia|fandom|kpop|viral short|short video/i.test(n)) return [
    ev('Top 5 surprising facts with a strong final reveal', 'List formats need a payoff ladder, not just disconnected facts.'),
    ev('Short story with a twist ending in the last 10 seconds', 'Twist-end structure improves completion rate for short storytelling.'),
    ev('Character lesson: one small mistake and its consequence', 'Simple moral arcs work well for kids and story channels.'),
    ev('Guess before the answer: interactive quiz format', 'Interactive pauses increase comments and repeat viewing.'),
    ev('Then vs now: how this character/topic changed over time', 'Change-over-time framing gives entertainment content a clear arc.'),
  ];

  if (/festival|local festival|event|mela|fair|celebration/i.test(n)) return [
    ev('Full festival walkthrough: what happens from start to finish', 'Process coverage makes local events understandable to outsiders.'),
    ev('Meaning behind one ritual most people miss', 'Explanation adds depth beyond raw event footage.'),
    ev('Best moments compilation with context before each moment', 'Context turns highlights into a story.'),
    ev('What to know before visiting this event', 'Visitor-guide framing gives the video practical search value.'),
    ev('Then vs now: how this festival has changed', 'History framing makes recurring events feel fresh.'),
  ];

  if (/animal|monkey|pet|feeding|rescue/i.test(n)) return [
    ev('Safe feeding guide: what helps and what harms', 'Practical animal-care framing is more useful than raw feeding footage.'),
    ev('One animal story from rescue to recovery', 'Narrative progression gives animal content emotional stakes.'),
    ev('Common myths about feeding and caring for these animals', 'Myth correction builds trust and encourages sharing.'),
    ev('A day observing one animal behavior closely', 'Observation-led videos can turn simple footage into learning.'),
    ev('What beginners should never do around these animals', 'Safety framing is clear, useful, and searchable.'),
  ];

  if (/travel|vlog|trip|journey|tourism|destination|water park|hill station/i.test(n)) return [
    ev('Solo trip planning: what I wish I knew before going', 'Planning content performs year-round and drives views for the destination video.'),
    ev('Full cost breakdown for a budget trip', 'Budget transparency videos get shared heavily in travel communities.'),
    ev('Honest review: was this destination actually worth the trip?', '"Was it worth it" framing drives comments and return viewers.'),
    ev('What nobody tells you before booking a trip like this', 'Counterintuitive framing indexes well on search and earns shares.'),
    ev('One-day itinerary with exact timings and mistakes to avoid', 'Concrete itineraries are easier to save and share than generic destination vlogs.'),
  ];

  if (/food|recipe|cooking|cuisine|baking|sweets|restaurant|dish/i.test(n)) return [
    ev('Same dish at 3 price points', 'Comparison format generates comments and shares consistently.'),
    ev('Full process: how the most popular dish here is actually made from scratch', 'Process videos retain viewers longer than taste-only reviews.'),
    ev('Hidden gem: the best local spot nobody in this city talks about', 'Scarcity framing drives CTR and saves in food niches.'),
    ev('Blind taste test: popular place vs hidden local shop', 'Versus framing gives viewers a reason to watch until the verdict.'),
    ev('What to order first if you only have a small budget', 'Budget constraints create a clear, clickable mission.'),
  ];

  if (/^(travel|travel vlogs?)$/.test(n)) return [
    ev('Solo trip planning: what I wish I knew before going', 'Planning content performs year-round and drives views for the destination video.'),
    ev('Full cost breakdown for a ₹X budget trip', 'Budget transparency videos get shared heavily in travel communities.'),
    ev('Honest review: was this destination actually worth the trip?', '"Was it worth it" framing drives comments and return viewers.'),
    ev('What nobody tells you before booking a trip like this', 'Counterintuitive framing indexes well on search and earns shares.'),
  ];

  if (/^(food|street food|cooking)$/.test(n)) return [
    ev('Same dish at 3 price points: ₹50 vs ₹200 vs ₹500', 'Comparison format generates comments and shares consistently.'),
    ev('Full process: how your most popular dish is actually made from scratch', 'Process videos retain viewers 40% longer than taste-only reviews.'),
    ev('Hidden gem: the best local food spot nobody in this area talks about', 'Scarcity framing drives CTR and saves in food niches.'),
  ];

  if (/^gaming$/.test(n)) return [
    ev('What actually changed in the latest update — honest breakdown', 'Update-reaction content peaks in search traffic right after patches.'),
    ev('Can I win using only a self-imposed restriction? — challenge run', 'Challenge format has the highest session-start rate in gaming.'),
    ev('Mistakes 90% of new players make — and how to fix them', 'Beginner-mistake framing drives search traffic from new players.'),
  ];

  if (/^(finance|personal finance|investing|stock market)$/.test(n)) return [
    ev('One costly money mistake and exactly what I learned from it', 'Failure framing outperforms pure advice content in finance.'),
    ev('How to start investing with just ₹500 per month', 'Entry-level content drives the highest subscriber conversion in finance.'),
    ev('One confusing concept in this field explained simply: no jargon, no fluff', 'Plain-language explainers rank for high-volume evergreen search terms.'),
  ];

  if (/^(fitness|workout|bodybuilding)$/.test(n)) return [
    ev('What 30 days of consistent training actually does to your body', 'Before/after experiment format performs consistently across fitness.'),
    ev('The one exercise you are probably doing wrong — and the fix', 'Correction framing builds trust and gets saved for later reference.'),
  ];

  return [
    ev('One useful thing explained through a real example', 'A concrete example gives viewers a clear reason to watch even when the channel category is broad.'),
    ev('Before vs after: what changed when one decision was made', 'Change-over-time framing creates a story without relying on a narrow niche label.'),
    ev('Three things most viewers miss about this topic', 'Observation-led framing works across mixed channels because it promises discovery, not generic advice.'),
  ];
}

function _fallbackIdea(topic, why) {
  return {
    topic,
    idea_type: 'evergreen_prompt',
    recommendation_type: 'topic_gap',
    trend_status: 'evergreen',
    channel_count: 0,
    avg_views: 0,
    saturation_pct: 0,
    saturation_level: 'low',
    examples: [],
    is_angle: false,
    act_now: false,
    why,
  };
}

function _getNicheFallbackToFive(niche) {
  const ideas = [..._getNicheFallback(niche)];
  const used = new Set(ideas.map(i => i.topic));
  const extra = [
    _fallbackIdea('A simple checklist viewers can use immediately', 'Checklist framing makes a broad idea practical and saveable.'),
    _fallbackIdea('The hidden tradeoff behind one common choice', 'Tradeoff framing gives the video a point of view without needing a narrow category.'),
    _fallbackIdea('One story, three lessons viewers can apply', 'Lesson extraction turns mixed content into a clear takeaway.'),
    _fallbackIdea('What changed recently and why it matters now', 'Recent-change framing gives evergreen content a timely hook.'),
    _fallbackIdea('Two approaches compared with a clear final verdict', 'Comparison framing creates structure and invites comments.'),
  ];
  for (const idea of extra) {
    if (ideas.length >= 5) break;
    if (used.has(idea.topic)) continue;
    ideas.push(idea);
    used.add(idea.topic);
  }
  return ideas;
}

const FALLBACK_PROTECTED_PRIMARY_NICHES = new Set([
  'education',
  'finance',
  'technology',
  'defence',
  'defense',
  'news',
  'politics',
  'geopolitics',
  'sports',
  'sport',
  'cricket',
]);

function _normFallbackNiche(s) {
  return String(s || '').trim().toLowerCase();
}

function _primaryFallbackNiche(row, resolvedNiche) {
  return _normFallbackNiche(row?.primary_niche || resolvedNiche || row?.niche);
}

function _strongMusicOrDevotionalFamily(row, extraText = '') {
  const name = String(row?.channel_name || row?.title || '').toLowerCase();
  const identity = [
    row?.channel_name,
    row?.niche,
    row?.primary_niche,
    row?.secondary_niche,
    row?.content_archetype,
    row?.format_type,
    extraText,
  ].filter(Boolean).join(' ').toLowerCase();

  const devotional = /\b(devotional|bhakti|bhajan|chalisa|mantra|aarti|kirtan|satsang|quran|nasheed|islamic prayers?|islamic recitations?|paath|shabad|gurbani|waheguru|qawwali|naat|hamd|dua|zikr|dhikr|gospel|worship|pravachan|katha|darshan|mandir|temple|mahadev|krishna|radha|hanuman|durga|sai baba)\b/.test(identity);
  if (devotional) return 'devotional';

  const explicitMusicNiche = /\b(music|songs?|bhojpuri songs?|punjabi music|cover songs?|video songs?)\b/.test(identity);
  if (explicitMusicNiche) return 'music';

  const kidsMusic = /\b(kids?|nursery|rhymes?|baby songs?|children songs?|poems?)\b/.test(identity);
  if (kidsMusic) return 'music';

  const musicName = /\b(music|songs?|singer|studio|records?|lyrics?|lyrical|remode|dance|dj|bhojpuri|punjabi|bollywood)\b/.test(name);
  const musicIdentity = /\b(official audio|music video|video song|cover song|folk songs?|movie songs?|album|lofi|lo-fi|rap|hip hop|hip-hop|guitar|piano|vocals)\b/.test(identity);
  if (musicName || musicIdentity) return 'music';

  return null;
}

function _selectCreativeFamilyForChannel({ row, resolvedNiche, nicheCategory, creatorMode, cspPrimary, formatProfile } = {}) {
  const text = [
    row?.channel_name,
    resolvedNiche,
    row?.niche,
    row?.primary_niche,
    row?.secondary_niche,
    row?.content_archetype,
    creatorMode,
    cspPrimary,
    formatProfile,
  ].filter(Boolean).join(' ');

  const primary = _primaryFallbackNiche(row, resolvedNiche);
  const strongMusicDevotional = _strongMusicOrDevotionalFamily(row, text);
  if (strongMusicDevotional) {
    const broadCreativePrimary = ['music', 'devotional', 'entertainment', 'comedy', 'other', 'unknown', ''].includes(primary);
    const matchingPrimary = primary === strongMusicDevotional
      || (strongMusicDevotional === 'devotional' && ['spiritual', 'bhakti'].includes(primary));
    if (matchingPrimary || broadCreativePrimary) return strongMusicDevotional;
  }

  const gamingIdentity = /\b(gaming|gameplay|gamer|free\s*fire|bgmi|pubg|minecraft|roblox|valorant|gta|grand theft auto|esports|codm|call of duty|fortnite|clash royale|brawl stars|rank push|custom room)\b/i.test(text);
  if (gamingIdentity && primary === 'gaming') return 'gaming';
  if (gamingIdentity && ['other', 'unknown', 'entertainment'].includes(primary)) return 'gaming';

  const detected = detectFamily(text);
  if (detected === 'music' || detected === 'devotional') return null;
  if (['sports', 'sport', 'cricket'].includes(primary)) {
    return detected === 'sports' ? 'sports' : null;
  }
  if (FALLBACK_PROTECTED_PRIMARY_NICHES.has(primary)) {
    if (primary === 'education' && detected === 'education') return 'education';
    return null;
  }
  if (['health', 'fitness', 'selfimprovement', 'wellness', 'yoga'].includes(primary) && detected === 'wellness') {
    return 'wellness';
  }
  if (primary === 'gaming') {
    return detected === 'gaming' ? 'gaming' : null;
  }
  if (['comedy', 'entertainment', 'movies', 'film', 'cinema', 'celebrity'].includes(primary)) {
    return detected === 'entertainment' ? 'entertainment' : null;
  }
  if (['travel', 'food', 'lifestyle'].includes(primary)) {
    return detected === 'experience' ? 'experience' : null;
  }
  if (['beauty', 'fashion', 'makeup', 'skincare'].includes(primary)) {
    return null;
  }
  if (nicheCategory === 'B') return detected;
  return detected;
}

function _fallbackContextForChannel({ row, resolvedNiche, creatorMode, cspPrimary, formatProfile, prefixCreativeFamily = false, forcedFamily = null } = {}) {
  const primary = _primaryFallbackNiche(row, resolvedNiche);
  const parts = [
    row?.primary_niche,
    resolvedNiche,
    row?.niche,
    row?.secondary_niche,
    row?.content_archetype,
    creatorMode,
    cspPrimary,
    formatProfile,
    row?.channel_name,
    row?.title,
  ].filter(Boolean);

  if (!prefixCreativeFamily && FALLBACK_PROTECTED_PRIMARY_NICHES.has(primary)) {
    return [primary, resolvedNiche, row?.niche, row?.primary_niche].filter(Boolean).join(' ');
  }

  if (prefixCreativeFamily && forcedFamily) return `${forcedFamily} ${parts.join(' ')}`;
  return parts.join(' ');
}

function _creativeFallbackKey(family) {
  if (family === 'experience') return 'travel food experience';
  if (family === 'entertainment') return 'entertainment comedy story';
  if (family === 'wellness') return 'health wellness fitness';
  if (family === 'education') return 'education learning';
  if (family === 'devotional') return 'devotional bhajan prayer';
  if (family === 'music') return 'music song';
  if (family === 'gaming') return 'gaming gameplay';
  if (family === 'sports') return 'sports cricket match';
  return family || '';
}

function _confidenceForIdea(idea) {
  if (!idea || idea.source === 'fallback_evergreen') {
    return {
      tier: 'low',
      reason: 'Evergreen fallback, not backed by current peer performance.',
    };
  }

  if (idea.idea_type === 'creative_package') {
    const ev = idea.evidence || {};
    const channelCount = ev.channel_count || 0;
    const videoCount   = ev.peer_video_count || 0;
    const lift         = ev.lift_ratio || 0;

    if (channelCount >= 3 && videoCount >= 5 && lift >= 1.2) {
      return {
        tier: 'high',
        reason: 'Repeated peer signal with strong view lift.',
      };
    }
    if (channelCount >= 2 || videoCount >= 3) {
      return {
        tier: 'medium',
        reason: 'Useful peer signal, but evidence is still limited.',
      };
    }
    return {
      tier: 'low',
      reason: 'Experimental signal from a very small peer sample.',
    };
  }

  if (idea.source === 'peer_video_signal') {
    const channelCount = idea.channel_count || 0;
    const examples     = Array.isArray(idea.examples) ? idea.examples.length : 0;
    if (channelCount >= 2 && examples >= 2) {
      return {
        tier: 'medium',
        reason: 'Backed by high-performing peer videos, but not broad enough for high-confidence community consensus.',
      };
    }
    return {
      tier: 'low',
      reason: 'Thin but real peer-video evidence; better than generic fallback, but still exploratory.',
    };
  }

  const channelCount = idea.channel_count || 0;
  const score        = idea.score || 0;
  const avgViews     = idea.avg_views || 0;
  const examples     = Array.isArray(idea.examples) ? idea.examples.length : 0;
  const isRising     = idea.trend_status === 'rising';

  if (channelCount >= 3 && examples >= 2 && avgViews > 0 && (score >= 60 || isRising)) {
    return {
      tier: 'high',
      reason: 'Multiple peer channels support this idea with strong current performance.',
    };
  }
  if (channelCount >= 2 || examples >= 2 || score >= 40) {
    return {
      tier: 'medium',
      reason: 'Some peer evidence exists, but the signal is not broad enough for high confidence.',
    };
  }
  return {
    tier: 'low',
    reason: 'Thin evidence; treat as an exploratory idea.',
  };
}

function _applyConfidenceTiers(ideas) {
  return (ideas || []).map(idea => {
    const conf = _confidenceForIdea(idea);
    idea.confidence_tier = conf.tier;
    idea.confidence = conf.tier;
    idea.confidence_reason = conf.reason;
    return idea;
  });
}

function _orderByConfidence(ideas) {
  const list = ideas || [];
  const rank = { high: 0, medium: 1, low: 2 };
  return list
    .map((idea, idx) => ({ idea, idx }))
    .sort((a, b) => {
      const ar = rank[a.idea.confidence_tier] ?? 2;
      const br = rank[b.idea.confidence_tier] ?? 2;
      if (ar !== br) return ar - br;
      return b.idea.score - a.idea.score || a.idx - b.idx;
    })
    .map(x => x.idea);
}

function computeWhatToPost(db, params, ctx) {
    const {
      resolveCreatorPeerContext, extractPhrases, getVelocity, classifyTrend, getFormatWinner,
      PODCAST_META_TOKENS, STOPWORDS, HOOK_PHRASES, SOUTH_SCRIPT_RE, DEVANAGARI_RE,
    } = ctx;
    const { channel_id, niche, community_id, subscriber_count, reference_date, debug, disable_lifecycle_filter, use_creator_mode_peers } = params;
    const useCreatorModePeers = use_creator_mode_peers === true || use_creator_mode_peers === 'true';
    const debugMode        = debug === 'true' || debug === true;
    const territoryDebug   = debugMode ? loadTerritoryDebug(db, channel_id) : null;
    const skipLifecycle    = disable_lifecycle_filter === 'true' || disable_lifecycle_filter === true;
    const userSubs = parseInt(subscriber_count || '0', 10);
    const refTs    = reference_date ? new Date(reference_date).getTime() : NaN;
    const nowMs    = isNaN(refTs) ? Date.now() : refTs;

    if (!niche && !community_id && !channel_id) {
      throw Object.assign(new Error('niche, community_id, or channel_id required'), { status: 400 });
    }

    // ── Resolve community + detect niche category ─────────────────────────
    let communityIds          = [];
    let resolvedNiche         = niche;
    let niche_category        = 'A';
    let userRegion            = null;
    let row                   = null;
    let creatorMode           = 'general';
    let userIsEnglish         = false;
    let peerRoutingDebug      = null;
    let _rpResult             = null;
    let _fpResult             = null;
    let _routingProfileActive = false;
    let _guestIntelActive     = false;
    let routingProfileData    = null;
    let _cspRoutingActive     = false;
    let _cspPrimary           = null;
    let _cspConfidence        = null;
    let _cspPeerCount         = 0;
    if (channel_id) {
      const _ctx = resolveCreatorPeerContext(db, channel_id, { niche, userSubs, debug: debugMode });
      if (_ctx.row) {
        communityIds          = _ctx.peerIds;
        row                   = _ctx.row;
        creatorMode           = _ctx.creator_mode;
        niche_category        = _ctx.niche_category;
        resolvedNiche         = _ctx.resolved_niche ?? niche;
        userRegion            = _ctx.user_region;
        userIsEnglish         = _ctx.user_is_english;
        _rpResult             = _ctx.rp_result;
        _fpResult             = _ctx.fp_result;
        _guestIntelActive     = _ctx.guest_intel_active ?? false;
        _routingProfileActive = _ctx.routing_profile_active;
        routingProfileData    = _ctx.routing_profile_data;
        _cspRoutingActive     = _ctx.csp_routing_active  ?? false;
        _cspPrimary           = _ctx.csp_primary          ?? null;
        _cspConfidence        = _ctx.csp_confidence        ?? null;
        _cspPeerCount         = _ctx.csp_peer_count        ?? 0;
        if (debugMode) peerRoutingDebug = _ctx.peer_routing_debug;

        // ── #3 region gate: drop India-region peers from English/Western pools ──
        // Applies the channel-region backfill across ALL downstream peer uses
        // (peer_signal AND the Category B creative engine), which read communityIds.
        // English creators with India-region peers were getting cross-cultural noise
        // ("Ashneer Grover/Biozyme" → Doctor Mike, "Marathi-language format" → US brands).
        {
          const _cRegion = String(row.region || '').toUpperCase();
          const _cEnglish = ['EN', 'US', 'GB', 'AU', 'CA', 'NZ', 'IE'].includes(_cRegion) ||
            (/^en/i.test(row.primary_language || '') && _cRegion !== 'IN');
          if (_cEnglish && communityIds.length) {
            const _ph = communityIds.map(() => '?').join(',');
            const _inPeers = new Set(
              db.all(`SELECT channel_id FROM ingested_channels WHERE channel_id IN (${_ph}) AND region = 'IN'`, communityIds)
                .map(r => r.channel_id),
            );
            if (_inPeers.size) communityIds = communityIds.filter(id => !_inPeers.has(id));
          }
        }

        // ── Podcast fingerprint (lazy, first request for podcast mode channels) ─
        if (_fpResult?.format_profile === 'guest_interview' && !GUEST_INTEL_BLOCKED_MODES.has(creatorMode) && !row.podcast_fingerprint) {
          const _pfRows = db.all(
            `SELECT DISTINCT title FROM ingested_videos WHERE channel_id = ? AND title IS NOT NULL ORDER BY published_at DESC LIMIT 100`,
            [channel_id],
          );
          const _nameTokens = new Set(
            (row.channel_name || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(t => t.length >= 3),
          );
          const _pfFreq = {};
          for (const { title } of _pfRows) {
            const _seen = new Set();
            for (const phrase of extractPhrases(title)) {
              const _words = phrase.split(' ');
              if (_words.some(w => PODCAST_META_TOKENS.has(w))) continue;
              if (_words.some(w => _nameTokens.has(w))) continue;
              if (!_seen.has(phrase)) { _pfFreq[phrase] = (_pfFreq[phrase] || 0) + 1; _seen.add(phrase); }
            }
          }
          const _pfTop = Object.entries(_pfFreq)
            .filter(([, c]) => c >= 2)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 50)
            .map(([p]) => p)
            .join('|');
          if (_pfTop) {
            try { db.run(`UPDATE ingested_channels SET podcast_fingerprint = ? WHERE channel_id = ?`, [_pfTop, channel_id]); } catch (_) {}
          }
        }
      }
    } else if (community_id) {
      communityIds = db.all(
        `SELECT channel_id FROM ingested_channels WHERE community_id = ? LIMIT 300`,
        [community_id],
      ).map(r => r.channel_id);
    }

    const originalBets = channel_id
      ? buildOriginalBetsForChannel(db, channel_id, { limit: 14 })
      : { status: 'no_channel_id', ideas: [] };

    // ── PODCAST mode peer gate ─────────────────────────────────────────────────
    // Hard-filters to podcast/interview channels; seeds from zero if no initial peers;
    // expansion respects the user's language/region so no cross-language leakage.
    if (_guestIntelActive) {
      if (communityIds.length > 0) {
        const _mpPh = communityIds.map(() => '?').join(',');
        const _mpFormats = db.all(
          `SELECT channel_id, format_type FROM ingested_channels WHERE channel_id IN (${_mpPh})`,
          communityIds,
        );
        const _podcastSet = new Set(
          _mpFormats.filter(r => r.format_type === 'podcast' || r.format_type === 'interview').map(r => r.channel_id),
        );
        communityIds = communityIds.filter(id => _podcastSet.has(id));
      }
      if (communityIds.length < 15 && channel_id) {
        const _expandParams = [channel_id];
        let _langFilter = '';
        if (userIsEnglish) {
          _langFilter = `AND (primary_language = 'en' OR primary_language IS NULL)`;
        } else if (userRegion) {
          _langFilter = `AND (region = ? OR region IS NULL)`;
          _expandParams.push(userRegion);
        }
        const _expand = db.all(
          `SELECT channel_id FROM ingested_channels WHERE format_type IN ('podcast','interview') AND channel_id != ? ${_langFilter} ORDER BY channel_subscribers DESC LIMIT 300`,
          _expandParams,
        ).map(r => r.channel_id);
        const _existing = new Set(communityIds);
        communityIds = [...communityIds, ..._expand.filter(id => !_existing.has(id))].slice(0, 300);
      }
    }

    if (communityIds.length === 0) {
      return {
        ok: true,
        niche_category,
        ideas: [],
        lanes: { act_now: [], evergreen: [], undercovered: [] },
        original_bets: originalBets,
        channel_count: 0,
        video_count: 0,
        summary: null,
        ...(territoryDebug || {}),
      };
    }

    // ── Peer pool hygiene: drop dormant channels, load growth momentum ──────
    // Channels with no upload in PEER_INACTIVE_DAYS stop shaping topic evidence
    // and stop inflating the saturation denominator. Momentum stats are reused
    // in the topic loop to weight fast-growing channels more heavily.
    const peerStatsMap = loadPeerChannelStats(db, communityIds, nowMs);
    const _poolBeforeActivityFilter = communityIds.length;
    communityIds = filterInactivePeers(communityIds, peerStatsMap, nowMs);
    const inactivePeersDropped = _poolBeforeActivityFilter - communityIds.length;

  const _creativeFamilyText = [
    row?.channel_name,
    row?.title,
    resolvedNiche,
    row?.niche,
    row?.primary_niche,
    row?.secondary_niche,
    row?.content_archetype,
    creatorMode,
    _cspPrimary,
    _fpResult?.format_profile,
  ].filter(Boolean).join(' ');
  const _detectedCreativeFamily = _selectCreativeFamilyForChannel({
    row,
    resolvedNiche,
    nicheCategory: niche_category,
    creatorMode,
    cspPrimary: _cspPrimary,
    formatProfile: _fpResult?.format_profile,
  });

    // Category B channels (music, devotional, entertainer archetype) need creative-package
    // suggestions, not topic phrases. Run the creative opportunity engine instead.
    // Also route explicit music/devotional channels here even if older niche_category
    // labels classified them as A.
    if (_detectedCreativeFamily) {
      const bWindowDays = communityIds.length < 15 ? 180 : 90;
      const bSince      = new Date(nowMs - bWindowDays * 86400000).toISOString().slice(0, 10);
      const bVideoPeerIds = communityIds.slice(0, 160);
      const bPh         = bVideoPeerIds.map(() => '?').join(',');
      const bPeerVideos = db.all(
        `SELECT youtube_video_id, title, views, channel_id, published_at, duration_seconds, format_type, format_confidence
         FROM (
           SELECT iv.youtube_video_id, iv.title, iv.views, iv.channel_id,
                  iv.published_at, iv.duration_seconds, iv.format_type, iv.format_confidence,
                  ROW_NUMBER() OVER (PARTITION BY iv.channel_id ORDER BY iv.views DESC) AS rn
           FROM ingested_videos iv
           WHERE iv.channel_id IN (${bPh})
             AND iv.published_at >= ?
             AND iv.title IS NOT NULL
             AND iv.views > 0
         ) WHERE rn <= 10`,
        [...bVideoPeerIds, bSince],
      );

      const bFamily   = _detectedCreativeFamily;
      const bNiche    = `${bFamily} ${_creativeFamilyText || resolvedNiche || row?.niche || ''}`;
      const bMinPeer  = communityIds.length <= 9 ? 1 : 2;
      const bIdeas    = bFamily ? computeCreativeOpportunities(bPeerVideos, { niche: bNiche, minPeerCount: bMinPeer }) : [];

      if (bIdeas.length < 5) {
        const bFallbackNiche = _fallbackContextForChannel({
          row,
          resolvedNiche,
          creatorMode,
          cspPrimary: _cspPrimary,
          formatProfile: _fpResult?.format_profile,
          prefixCreativeFamily: true,
          forcedFamily: bFamily,
        });
        const _devCtxHint  = `${bNiche || ''} ${bFallbackNiche || ''} ${resolvedNiche || ''}`;
        const bFallback    = bFamily ? getEvergreenFallback(_creativeFallbackKey(bFamily) || bFallbackNiche || bNiche, _devCtxHint) : _getNicheFallbackToFive(bFallbackNiche);
        const bUsedTitles  = new Set(bIdeas.map(i => i.title));
        let bFallbackScore = Math.max(1, (bIdeas[bIdeas.length - 1]?.score ?? 20) - 3);
        for (const ev of bFallback) {
          if (bIdeas.length >= (bFamily ? 12 : 10)) break;
          const bTitle = ev.title || ev.topic;
          if (bUsedTitles.has(bTitle)) continue;
          bUsedTitles.add(bTitle);
          bIdeas.push({ ...ev, title: bTitle, score: bFallbackScore, source: 'fallback_evergreen', confidence: 'low' });
          bFallbackScore = Math.max(1, bFallbackScore - 2);
        }
      }

      const bOrderedIdeas = _suppressLowValueIdeas(
        _orderByConfidence(_applyConfidenceTiers(bIdeas)),
        { creatorIsEnglish: /^en/i.test(row?.primary_language || 'en') },
      );

      const bLanes = {
        act_now:      bOrderedIdeas.filter(i => i.source !== 'fallback_evergreen' && (i.evidence?.lift_ratio ?? 0) >= 1.5 && (i.evidence?.rarity_pct ?? 100) < 20),
        evergreen:    bOrderedIdeas.filter(i => i.source !== 'fallback_evergreen'),
        undercovered: bOrderedIdeas.filter(i => i.source === 'fallback_evergreen'),
      };

      // Guest-interview channels can route to Category B; this early return omitted the
      // podcast_intel block (only the Category-A path built it), so the UI saw podcast mode
      // (via format_profile) with no guest/theme panels → blank. Compute it here too.
      let _bPodcastIntel = null;
      if (_guestIntelActive && channel_id) {
        try {
          const _bMode  = computePodcastModePeers(db, channel_id, { userRegion, limit: 150 });
          const _bPeers = _bMode?.ids?.length > 0 ? _bMode.ids : communityIds;
          if (_bPeers.length > 0) {
            _bPodcastIntel = computePodcastIntel(db, channel_id, _bPeers, nowMs, debugMode);
            const _bGuests = (_bPodcastIntel.guests || []).map(g => g.name);
            const _bThemes = computePodcastThemes(db, channel_id, _bPeers, _bGuests, row?.channel_name || '', nowMs, debugMode, _bPodcastIntel.target_lanes || [], extractPhrases, PODCAST_META_TOKENS);
            _bPodcastIntel = { ..._bPodcastIntel, ..._bThemes };
          }
        } catch (_) {}
      }

      return {
        ok:             true,
        niche_category: 'B',
        guest_intel_active: _guestIntelActive,
        ...(_bPodcastIntel ? { podcast_intel: _bPodcastIntel } : {}),
        channel_count:  communityIds.length,
        video_count:    bPeerVideos.length,
        ideas:          (() => {
          const scored = bOrderedIdeas.map(idea =>
            'specificity_score' in idea
              ? idea
              : { ...idea, specificity_score: computeSpecificityScore(idea.topic || idea.title || '') }
          );
          const specific = scored.filter(i => (i.specificity_score ?? 0) >= 25);
          const generic  = scored.filter(i => (i.specificity_score ?? 0) < 25);
          return [...specific, ...generic];
        })(),
        lanes:          bLanes,
        original_bets:  originalBets,
        summary:        null,
        creator_mode:   creatorMode,
        ...(_fpResult ? { format_profile: _fpResult.format_profile, format_profile_confidence: _fpResult.confidence } : {}),
        ...(territoryDebug || {}),
      };
    }

    // ── Community videos — extend window for small pools ──────────────────
    const windowDays = communityIds.length < 15 ? 180 : 90;
    const since = new Date(nowMs - windowDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const extractionPeerIds = communityIds.slice(0, 160);
    const ph    = extractionPeerIds.map(() => '?').join(',');

    // Per-channel sampling: top 10 videos per channel by views.
    // Prevents high-volume channels (daily vloggers, viral one-hit channels) from
    // dominating topic extraction. Every channel in the pool contributes equally.
    const communityVideos = db.all(
      `SELECT youtube_video_id, title, views, channel_id, published_at, duration_seconds, format_type, format_confidence, channel_name
       FROM (
         SELECT iv.youtube_video_id, iv.title, iv.views, iv.channel_id,
                iv.published_at, iv.duration_seconds, iv.format_type, iv.format_confidence, ic.channel_name,
                ROW_NUMBER() OVER (PARTITION BY iv.channel_id ORDER BY iv.views DESC) AS rn
         FROM ingested_videos iv
         LEFT JOIN ingested_channels ic ON ic.channel_id = iv.channel_id
         WHERE iv.channel_id IN (${ph})
           AND iv.published_at >= ?
           AND iv.title IS NOT NULL
           AND iv.views > 0
       ) WHERE rn <= 10`,
      [...extractionPeerIds, since],
    );

    // ── User's own phrases + recent-coverage window ────────────────────────
    const userPhraseSet = new Set();
    let userTitleRows = [];
    if (channel_id) {
      userTitleRows = db.all(
        `SELECT title, published_at FROM ingested_videos WHERE channel_id = ? ORDER BY published_at DESC LIMIT 100`,
        [channel_id],
      );
      userTitleRows.forEach(v => extractPhrases(v.title).forEach(p => userPhraseSet.add(p)));
    }
    const userCanonicalPhraseSet = new Set([...userPhraseSet].map(p => stripModifiers(p)));
    const recentTitleTokenSets = buildRecentTitleTokenSets(userTitleRows, nowMs, STOPWORDS);

    // ── Personalization inputs ─────────────────────────────────────────────
    // DNA affinity rewards topics in the creator's proven lane; strong
    // territories (view_lift ≥ 1.2) reward parent topics where the creator's
    // own uploads already over-perform.
    const dnaAffinity = buildDnaAffinity(db, channel_id);
    const acceptedTerritoriesAll = loadAcceptedTerritories(db, channel_id, { limit: 8 });
    const strongTerritoryParents = new Set();
    for (const t of acceptedTerritoriesAll) {
      if ((Number(t.view_lift) || 0) < 1.2) continue;
      for (const parent of (TERRITORY_PARENT_ALLOW[t.territory_id] || [])) strongTerritoryParents.add(parent);
    }

    // ── Creator topic lifecycle lookup ─────────────────────────────────────
    // One bulk query: all lifecycle records for this channel. Used in the
    // scoring loop to exclude topics the creator already dominates (regular /
    // saturated) and penalise topics they're exiting.
    const lifecycleMap = new Map();
    if (channel_id && !skipLifecycle) {
      db.all(
        `SELECT phrase, stage FROM creator_topic_lifecycle WHERE channel_id = ?`,
        [channel_id],
      ).forEach(r => {
        lifecycleMap.set(r.phrase, r.stage);
        // Also index without trailing punctuation so "breaking news:" matches "breaking news"
        const norm = r.phrase.replace(/[:.!?]+$/, '').trim();
        if (norm !== r.phrase && !lifecycleMap.has(norm)) lifecycleMap.set(norm, r.stage);
      });
    }
    let lcSuppressed = 0, lcRegular = 0, lcSaturated = 0, lcExiting = 0;
    const lcSuppressedSample = [];  // populated in debug mode (max 5)

    // ── Bulk velocity snapshots (one query) ────────────────────────────────
    const videoIds = communityVideos.map(v => v.youtube_video_id);
    const snapMap  = loadSnapshotMap(db, videoIds);

    // ── Build topic buckets ─────────────────────────────────────────────────
    const topicMap = new Map();

    for (const video of communityVideos) {
      const phrases     = extractPhrases(video.title);
      if (debugMode && phrases.includes('affairs current')) {
        console.log('[DIAG][P4] extractPhrases → "affairs current" from title:', (video.title || '').slice(0, 100));
      }
      const seenThisVid = new Set();
      const ageDays     = (nowMs - new Date(video.published_at).getTime()) / 86400000;
      const fmtKey      = formatBucketForVideo(video);
      const snap        = snapMap.get(video.youtube_video_id);
      const chStats     = peerStatsMap.get(video.channel_id);
      const chWeight    = channelMomentumWeight(chStats);
      const viewsPerDay = (video.views || 0) / Math.max(0.5, ageDays);

      for (const phrase of phrases) {
        if (seenThisVid.has(phrase)) continue;
        seenThisVid.add(phrase);
        if (isHardJunkPhrase(phrase)) continue;
        if (isDisallowedPersonTopic(phrase, {
          niche: resolvedNiche,
          primary_niche: row?.primary_niche,
          csp_primary: _cspPrimary,
        })) continue;

        if (!topicMap.has(phrase)) {
          topicMap.set(phrase, {
            videos:      [],
            allViews:    [],  // all per-video view counts — used for median, not mean
            channels:    new Set(),
            cnt_0_14:    0,
            cnt_15_30:   0,
            cnt_31_60:   0,
            cnt_61_90:   0,
            formats: {
              shorts: { count: 0, totalViews: 0 },
              quick:  { count: 0, totalViews: 0 },
              mid:    { count: 0, totalViews: 0 },
              long:   { count: 0, totalViews: 0 },
            },
            format_evidence: {
              short_form_videos: 0,
              likely_short_form_videos: 0,
              long_form_videos: 0,
              unknown_videos: 0,
              short_form_views: 0,
              long_form_views: 0,
            },
            vel_pairs:   [],
            sav30_sum:   0,
            sav30_cnt:   0,
            fast_growth_channels: new Set(),
            ch_recent:   new Set(),  // channels with coverage ≤ 21d — adoption window
            ch_prior:    new Set(),  // channels with only older coverage
            vpd_recent_sum: 0, vpd_recent_cnt: 0,  // views/day of ≤14d videos
            vpd_prior_sum:  0, vpd_prior_cnt:  0,  // views/day of 15–60d videos
          });
        }

        const b = topicMap.get(phrase);
        // Skip regional-language titles in examples (channels may have null language in DB)
        const lowerTitle = (video.title || '').toLowerCase();
        const isRegional = /\bmarathi\b|\btelugu\b|\btamil\b|\bkannada\b|\bmalayalam\b|\bbengali\b|\bkata[\s-]kata\b/.test(lowerTitle);
        if (b.videos.length < 5 && !isRegional) b.videos.push(video);
        b.allViews.push({ v: video.views || 0, w: recencyWeight(ageDays) * chWeight });
        b.channels.add(video.channel_id);
        if (chWeight > 1) b.fast_growth_channels.add(video.channel_id);
        if (ageDays <= 21) b.ch_recent.add(video.channel_id);
        else               b.ch_prior.add(video.channel_id);
        if (ageDays <= 14)      { b.vpd_recent_sum += viewsPerDay; b.vpd_recent_cnt++; }
        else if (ageDays <= 60) { b.vpd_prior_sum  += viewsPerDay; b.vpd_prior_cnt++; }

        if (ageDays <= 14)      b.cnt_0_14++;
        else if (ageDays <= 30) b.cnt_15_30++;
        else if (ageDays <= 60) b.cnt_31_60++;
        else                    b.cnt_61_90++;

        b.formats[fmtKey].count++;
        b.formats[fmtKey].totalViews += (video.views || 0);
        addFormatEvidence(b, video);

        if (snap?.v7 && snap?.v30 && snap.v7 > 0) {
          b.vel_pairs.push({ v7: snap.v7, v30: snap.v30 });
        }
        if (snap?.sav30 != null) { b.sav30_sum += snap.sav30; b.sav30_cnt++; }
      }
    }

    canonicalizePhrases(topicMap);
    const _phraseExtIdx = buildPhraseExtensionIndex(topicMap);

    // ── Event metadata bulk lookup ─────────────────────────────────────────
    // topicMap is fully built here — safe to iterate its keys.
    const eventMetaMap = new Map();
    {
      const allPhrases = [...topicMap.keys()];
      if (allPhrases.length > 0) {
        const ph = allPhrases.map(() => '?').join(',');
        db.all(
          `SELECT topic, topic_category, event_stage, death_score, last_live_d0
           FROM topic_event_metadata WHERE topic IN (${ph})`,
          allPhrases,
        ).forEach(r => eventMetaMap.set(r.topic, r));
      }
    }

    // ── Trend signal bulk lookup ───────────────────────────────────────────
    // topic_signal_stats is written by trendSignalJob (outperformance, adoption
    // acceleration, VPH trajectory). Rows fresher than 7 days inform scoring:
    // rising/emerging topics get a boost, peaking topics get demoted.
    const trendSignalMap = new Map();
    {
      const allPhrases = [...topicMap.keys()];
      for (let i = 0; i < allPhrases.length; i += 200) {
        const chunk = allPhrases.slice(i, i + 200);
        const ph = chunk.map(() => '?').join(',');
        try {
          db.all(
            `SELECT topic, signal_tier, signal_score, vph_direction
             FROM topic_signal_stats
             WHERE topic IN (${ph}) AND computed_at >= datetime('now', '-7 days')`,
            chunk,
          ).forEach(r => {
            const prev = trendSignalMap.get(r.topic);
            if (!prev || (r.signal_score || 0) > (prev.signal_score || 0)) trendSignalMap.set(r.topic, r);
          });
        } catch (_) {}
      }
    }

    // Google Trends rising queries persisted by worldSignals (≤48h old).
    const googleTrendsMap = readRecentTrendSignals(db, { maxAgeHours: 48 });

    // ── Angle / Narrative extraction ───────────────────────────────────────
    // Anchors (broad, categorisable phrases) are identified from topicMap.
    // Narratives are raw token bigrams extracted directly from titles containing
    // an anchor — bypassing topicMap's minCh requirement so that diverse
    // phrasings ("trump reaction", "trump response", "trump statement") each
    // qualify individually. A narrative must contain at least one NARRATIVE_QUALIFIER
    // word so we get "entity + action" not "entity + entity".
    {
      const _minCh         = communityIds.length <= 3 ? 1 : communityIds.length <= 9 ? 2 : communityIds.length <= 29 ? 3 : communityIds.length <= 99 ? 4 : 5;
      const angleThreshold = Math.max(2, Math.ceil(_minCh / 2));
      // News/politics/sports topics are transient — the same phrase rarely crosses
      // 4+ channels in a 90-day window. Use angleThreshold for anchors so that
      // phrases like "iran war" (ch=3) or "iran israel" (ch=2) can still anchor.
      const _anchorMinCh   = new Set(['news','politics','sports']).has(resolvedNiche) ? angleThreshold : _minCh;

      // Niche-aware narrative qualifier sets.
      // Core event-action words shared by all niches:
      const _CORE_QUALIFIERS = new Set([
        'reaction','response','impact','strikes','attack','offensive','retaliation',
        'sanctions','ceasefire','deal','talks','invasion','withdrawal','defeat','victory',
        'conflict','crisis','threat','warning','policy','reform','agreement','demand',
        'protest','vote','war','nuclear','missile','drone','blockade','evacuation',
        'prices','trade','deficit','growth','recession','crash','rally','inflation',
        'tariff','embargo','investment',
        'verdict','campaign','debate','resignation','arrest','bail','scandal',
        'visit','meeting','summit','statement','announcement',
        'interview',
      ]);
      // Exam niches additionally accept editorial format signals:
      const _EXAM_QUALIFIERS = new Set([..._CORE_QUALIFIERS, 'paper','cutoff','analysis','pattern']);
      const _isExamNiche = /upsc|exam|neet|ssc|jee|preparation|ias/.test(resolvedNiche);
      const NARRATIVE_QUALIFIERS = _isExamNiche ? _EXAM_QUALIFIERS : _CORE_QUALIFIERS;

      // Channel-name tokens to block from narrative bigrams (e.g. "drishti" from "Drishti IAS").
      const channelNameTokens = new Set();
      for (const v of communityVideos) {
        if (!v.channel_name) continue;
        v.channel_name.toLowerCase().split(/[\s\-_|.]+/).forEach(w => {
          if (w.length > 3 && !STOPWORDS.has(w)) channelNameTokens.add(w);
        });
      }

      // Anchors: topicMap phrases with a parent category and enough community coverage.
      // Reject duplicate-word phrases ("war war"). Trim trailing verb tokens
      // ("Russia Uses" → "Russia") and dedup anchors that clean to the same string,
      // keeping the one with highest channel coverage.
      // var so anchorOriginalMap is accessible in the scoring loop outside this block.
      var anchorOriginalMap = new Map(); // cleanedAnchor → original topicMap key
      for (const [phrase, b] of topicMap.entries()) {
        if (b.channels.size < _anchorMinCh || inferParentTopic(phrase) === null) continue;
        const _words = phrase.split(' ');
        if (new Set(_words).size !== _words.length) continue;
        const trimmed = [..._words];
        // Task 2: trim trailing verb tokens ("Russia Uses" → "Russia")
        while (trimmed.length > 1 && VERB_STOPWORDS.has(trimmed[trimmed.length - 1])) trimmed.pop();
        // Task 5: trim leading core-qualifier when the remaining tokens are named
        // entities not present in TOPIC_PARENTS ("war trump" → "trump",
        // but keep "ukraine war" because "ukraine" IS a TOPIC_PARENTS keyword).
        if (trimmed.length > 1 && _CORE_QUALIFIERS.has(trimmed[0])) {
          const rest = trimmed.slice(1);
          if (rest.every(w => !_TOPIC_FLAT_KEYWORDS.has(w))) trimmed.splice(0, 1);
        }
        const cleaned = trimmed.join(' ');
        if (debugMode && (phrase.includes('trump') || cleaned.includes('trump'))) {
          console.log('[DIAG][P3] anchor build: topicMap key:', phrase, '→ cleaned:', cleaned, '| channels:', b.channels.size);
        }
        if (anchorOriginalMap.has(cleaned)) {
          const prevB = topicMap.get(anchorOriginalMap.get(cleaned));
          if (prevB && prevB.channels.size >= b.channels.size) continue;
        }
        anchorOriginalMap.set(cleaned, phrase);
      }
      const anchorSet = new Set(anchorOriginalMap.keys());

      // rawNarrativeMap: anchor → Map<bigram, { channels, views[], examples[], cnt_0_14 }>
      const rawNarrativeMap = new Map();
      for (const video of communityVideos) {
        const ageDays = (nowMs - new Date(video.published_at).getTime()) / 86400000;

        // Tokenise first so anchor matching can use token set — handles "Iran-Israel War"
        // matching anchor "iran war" even when the words are not adjacent in the raw title.
        const tokens = (video.title || '')
          .replace(/#\w+/g, ' ')
          .replace(/\|{2}[^|]+\|{2}/g, ' ')
          .toLowerCase()
          .replace(/[|()[\]{}#@!?,।॥।\-''':]/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
          .split(' ')
          .filter(w => w.length > 2 && !STOPWORDS.has(w) && !/^\d+$/.test(w) && !/^\d{4}$/.test(w)
                    && !DEVANAGARI_RE.test(w) && !SOUTH_SCRIPT_RE.test(w));
        const titleTokenSet = new Set(tokens);

        // Token-based match: every word of the anchor must appear in the title's token set.
        // Handles non-adjacent occurrences like "Iran-Israel War" → anchor "iran war".
        const titleAnchors = [...anchorSet].filter(a => a.split(' ').every(w => titleTokenSet.has(w)));
        if (!titleAnchors.length) continue;

        for (const anchor of titleAnchors) {
          if (!rawNarrativeMap.has(anchor)) rawNarrativeMap.set(anchor, new Map());
          const sub       = rawNarrativeMap.get(anchor);
          const anchorWds = new Set(anchor.split(' '));

          for (let i = 0; i < tokens.length - 1; i++) {
            const bg      = tokens[i] + ' ' + tokens[i + 1];
            const bgWords = bg.split(' ');

            // Must include at least one narrative qualifier (entity + action pattern).
            if (!bgWords.some(w => NARRATIVE_QUALIFIERS.has(w))) continue;
            // Block hook phrases (meta containers: "current affairs", "live coverage", etc.)
            if (HOOK_PHRASES.has(bg)) continue;
            // No production-label or geographic-fragment words.
            if (bgWords.some(w => ANGLE_STOPWORDS.has(w))) continue;
            // No anchor word reuse.
            if (bgWords.some(w => anchorWds.has(w))) continue;
            // No channel name fragments (e.g. "drishti" from "Drishti IAS").
            if (bgWords.some(w => channelNameTokens.has(w))) continue;

            if (!sub.has(bg)) sub.set(bg, { channels: new Set(), views: [], examples: [], cnt_0_14: 0 });
            const nb = sub.get(bg);
            nb.channels.add(video.channel_id);
            nb.views.push(video.views || 0);
            if (ageDays <= 14) nb.cnt_0_14++;
            if (nb.examples.length < 3) nb.examples.push({ title: video.title, views: video.views || 0, channel_name: video.channel_name || 'Unknown' });
          }
        }
      }

      // suppressedAnchors: anchors with ≥1 qualifying narrative — replaced by angles.
      // anchorAnglesMap: scored narrative data per anchor.
      var suppressedAnchors = new Set();
      var anchorAnglesMap   = new Map();
      for (const [anchor, sub] of rawNarrativeMap.entries()) {
        const ab = topicMap.get(anchorOriginalMap.get(anchor) || anchor);
        if (!ab) continue;
        const qualifying = [];
        for (const [bg, data] of sub.entries()) {
          if (data.channels.size < angleThreshold) continue;
          qualifying.push({ phrase: bg, ...data, satPct: Math.min(100, Math.round(data.channels.size / ab.channels.size * 100)) });
        }
        if (qualifying.length) {
          suppressedAnchors.add(anchor);
          suppressedAnchors.add(anchorOriginalMap.get(anchor) || anchor);
          anchorAnglesMap.set(anchor, qualifying);
        }
      }
      const _trumpKeys = [...suppressedAnchors].filter(s => s.includes('trump'));
      if (debugMode && _trumpKeys.length) console.log('[DIAG][P3] suppressedAnchors trump entries:', _trumpKeys);
      else if (debugMode) console.log('[DIAG][P3] suppressedAnchors: no trump entries — trump anchor never built or no qualifying narratives');
    }

    // ── Narrative lifecycle lookup ─────────────────────────────────────────
    // Load existing lifecycle records for all discovered anchor+narrative pairs.
    // Key: "anchor\x00narrative" → row.
    var narrativeLifecycleMap = new Map();
    if (anchorAnglesMap && anchorAnglesMap.size > 0) {
      const narPairs = [];
      for (const [anchor, angles] of anchorAnglesMap.entries()) {
        for (const { phrase } of angles) narPairs.push([anchor, phrase]);
      }
      if (narPairs.length) {
        const ph2 = narPairs.map(() => '(?,?,?)').join(',');
        const params2 = narPairs.flatMap(([a, n]) => [a, n, resolvedNiche]);
        try {
          db.all(
            `SELECT anchor, narrative, stage, window_score, act_now_conf, expiry_estimate, narrative_type, velocity, saturation_pct, pub_rate_recent
             FROM narrative_lifecycle WHERE (anchor, narrative, niche) IN (${ph2})`,
            params2,
          ).forEach(r => narrativeLifecycleMap.set(r.anchor + '\x00' + r.narrative, r));
        } catch (_) {}
      }
    }

    // ── Score + classify ───────────────────────────────────────────────────
    // Niches where topics are time-bound events — filter out event spikes,
    // suggest only recurring themes suitable for documentary/explainer formats.
    // geopolitics and defence are analytical/documentary by nature — NOT breaking news.
    const IS_NEWS_NICHE = creatorMode !== 'podcast' && new Set(['news', 'politics', 'sports']).has(resolvedNiche);

    const TREND_SCORE = { rising: 20, peaking: 10, evergreen: 8, fading: -15, dormant: -30 };
    const VEL_SCORE   = { fast: 12, growing: 5, peaked: -5 };
    const gaps        = [];
    let territoryExpansionDebug = null;
    let peerVideoSignalDebug = null;
    let risingCnt = 0, evergreenCnt = 0, unexploredCnt = 0, saturatedCnt = 0;

    // Scale thresholds to pool size.
    // For large pools (100+), require 5 channels — 3/300 (1%) is noise, not signal.
    // Use median views (not mean) so one viral outlier can't make a weak topic look strong.
    // Also require at least 2 data points so a single video can't constitute a "topic".
    const poolSize    = communityIds.length;
    const isCategoryA = niche_category === 'A';
    const isDefenceLike = /\b(defen[cs]e|military|army|navy|air force|security)\b/i.test([
      resolvedNiche,
      row?.niche,
      row?.primary_niche,
      row?.content_archetype,
      row?.routing_profile,
    ].filter(Boolean).join(' '));
    const minChannels = isCategoryA
      ? (poolSize <= 3 ? 1 : poolSize <= 9 ? 2 : 3)
      : (poolSize <= 3 ? 1 : poolSize <= 9 ? 2 : poolSize <= 29 ? 3 : poolSize <= 99 ? 4 : 5);
    const minVideos   = isCategoryA ? 1 : (poolSize >= 30 ? 2 : 1);
    const userOwnMedian  = computeUserOwnMedian(db, channel_id);
    const minMedianViews = userOwnMedian > 0
      ? Math.max(isDefenceLike ? 200 : (isCategoryA ? 300 : 500), Math.round(userOwnMedian * (isDefenceLike ? 0.04 : (isCategoryA ? 0.08 : 0.15))))
      : (isCategoryA
        ? (isDefenceLike ? (poolSize <= 3 ? 300 : poolSize <= 9 ? 1000 : poolSize <= 99 ? 2000 : 3000) : (poolSize <= 3 ? 500 : poolSize <= 9 ? 2000 : poolSize <= 99 ? 4000 : 6000))
        : (poolSize <= 3 ? 1000 : poolSize <= 9 ? 5000 : poolSize <= 99 ? 8000 : 10000));

    function median(arr) {
      if (!arr.length) return 0;
      const s = [...arr].sort((a, b) => a - b);
      const m = Math.floor(s.length / 2);
      return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
    }

    for (const [phrase, b] of topicMap.entries()) {
      if (debugMode && phrase === 'affairs current') {
        console.log('[DIAG][P4] affairs current in topicMap: channels=', b.channels.size, '| minChannels=', minChannels, '| suppressed?', suppressedAnchors && suppressedAnchors.has(phrase), '| parentTopic:', inferParentTopic(phrase));
      }
      if (debugMode && phrase.includes('trump')) {
        console.log('[DIAG][P3] topicMap regular loop: phrase:', phrase, '| channels:', b.channels.size, '| suppressedAnchors.has?', suppressedAnchors && suppressedAnchors.has(phrase));
      }
      if (b.channels.size < minChannels) continue;
      if (suppressedAnchors && suppressedAnchors.has(phrase)) continue; // angles surface instead
      if (b.allViews.length < minVideos) continue;
      if (userPhraseSet.has(phrase) || userCanonicalPhraseSet.has(stripModifiers(phrase))) continue;
      // Pure-modifier phrases ("complete guide", "latest update") have no topic
      // entity left once content-type words are stripped — always generic.
      if (stripModifiers(phrase).split(' ').every(w => CONTENT_MODIFIERS.has(w))) continue;
      const medianViews = weightedMedian(b.allViews);
      if (medianViews < minMedianViews)  continue;
      // Reject event-only spikes: if ALL coverage is within the last 14 days and
      // fewer than 5 channels, it's a seasonal/news event, not an actionable topic.
      const totalVidCountCheck = b.cnt_0_14 + b.cnt_15_30 + b.cnt_31_60 + b.cnt_61_90;
      if (!IS_NEWS_NICHE && b.cnt_31_60 + b.cnt_61_90 === 0 && b.channels.size < 5) continue;

      // For news/politics/sports: discard topics with no historical coverage.
      // If all coverage is within the last 30 days and nothing older exists,
      // it's a breaking-news event — stale before it can be acted on.
      if (IS_NEWS_NICHE && (b.cnt_31_60 + b.cnt_61_90) < 1 && b.channels.size < Math.max(4, minChannels + 1)) continue;

      // ── Creator lifecycle suppression ─────────────────────────────────────
      // regular / saturated → creator already dominates this topic → exclude.
      // exiting             → creator is tapering off   → apply score penalty.
      const phraseNorm = phrase.replace(/[:.!?]+$/, '').trim();
      const lcStage = lifecycleMap.get(phrase) || lifecycleMap.get(phraseNorm) || null;
      if (lcStage === 'regular' || lcStage === 'saturated') {
        if (lcStage === 'regular')   lcRegular++;
        else                         lcSaturated++;
        lcSuppressed++;
        if (debugMode && lcSuppressedSample.length < 5) {
          lcSuppressedSample.push({
            phrase: phrase.replace(/\b\w/g, c => c.toUpperCase()),
            stage:  lcStage,
            suppressed_reason: `creator_${lcStage}`,
          });
        }
        continue;
      }
      if (lcStage === 'exiting') lcExiting++;

      const avgViews        = medianViews;  // median is more honest than mean for small samples
      const totalVidCount   = totalVidCountCheck;
      const saturation_pct  = Math.round(b.channels.size / communityIds.length * 100);
      const saturation_level= saturation_pct < 20 ? 'low' : saturation_pct < 60 ? 'medium' : 'high';
      let trend_status      = classifyTrend(b);
      const format_winner   = getFormatWinner(b.formats, totalVidCount);
      const format_evidence = summarizeFormatEvidence(b.format_evidence);
      const velocity        = getVelocity(b.vel_pairs);

      // ── Event lifecycle override ───────────────────────────────────────────
      const dbEventRow = eventMetaMap.get(phrase) || null;
      const { category: topic_category, event_stage } = computeRuntimeEventStage(phrase, b, dbEventRow);
      const event_penalty = getEventPenalty(event_stage);

      // Dead events are not actionable — skip entirely.
      if (event_stage === 'dead') continue;

      // Override trend_status for post-event / decay so UI shows correct label.
      if (event_stage === 'post_event' || event_stage === 'decay') trend_status = 'past_event';

      let expected_low = null, expected_high = null;
      if (userSubs > 0 && b.sav30_cnt >= 2) {
        const avgSav  = b.sav30_sum / b.sav30_cnt;
        const baseExp = Math.round((userSubs / 1000) * avgSav * 720);
        expected_low  = Math.round(baseExp * 0.6);
        expected_high = Math.round(baseExp * 1.4);
      }

      const base_views        = Math.min(35, Math.log10(avgViews + 1) / 7 * 35);
      const spread            = Math.min(20, (b.channels.size / poolSize) * 20);
      const trend_bonus       = TREND_SCORE[trend_status] || 0;
      const vel_bonus         = velocity ? (VEL_SCORE[velocity.status] || 0) : 0;
      const sat_penalty       = saturation_pct > 60 ? -(saturation_pct - 60) / 2 : 0;
      const gap_bonus         = saturation_pct < 20 && b.channels.size >= 3 ? 10 : 0;
      const lifecycle_penalty = lcStage === 'exiting' ? -15 : 0;
      // Compute once — reused for both quality scoring and the idea's parent_topic field.
      const _parentTopic      = inferParentTopic(phrase);
      const _qualityScore     = assessTopicQuality(phrase, {
        parent_topic: _parentTopic,
        niche: resolvedNiche,
        primary_niche: row?.primary_niche,
        csp_primary: _cspPrimary,
      });
      if (isMalformedTopicPhrase(phrase, {
        parent_topic: _parentTopic,
        niche: resolvedNiche,
        primary_niche: row?.primary_niche,
      })) continue;
      if (_qualityScore <= -30 && !_parentTopic) continue;

      // Category C specificity penalty: demote ultra-generic phrases so they don't
      // dominate the top 5. Travel/vlog channels: -20 for bare travel clichés.
      // Food channels: -10 for the same phrases (still valid, just not featured).
      // Boosted phrases (e.g. "Hyderabad Street Food") are unaffected — the extra
      // word clears the generic-phrase set regardless of niche.
      const _isTravelLike = /travel|vlogs?|lifestyle|daily|personal|family|village|road|trip|truck|water park|tourism|journey|destination|experience/i.test(resolvedNiche || '')
        || _cspPrimary === 'travel_lifestyle_vlog';
      const _isFoodLike = /food|recipe|cooking|cuisine|baking|sweets/i.test(resolvedNiche || '')
        || _cspPrimary === 'cooking_food_recipe';
      let _specificityPenalty = 0;
      if (niche_category === 'C' || _isTravelLike || _isFoodLike) {
        const _GENERIC_C = new Set([
          'street food','road trip','first day','ice cream','eat day','one day','good day',
          'new day','travel vlog','local food','market visit','food vlog','night vlog',
          'most beautiful','kar diya','gone wrong','one shot',
        ]);
        const _phraseLC = phrase.toLowerCase();
        if (_GENERIC_C.has(_phraseLC)) {
          if (_isTravelLike && !_isFoodLike) continue;
          _specificityPenalty = _isFoodLike ? -25 : -45;
        }
      }
      const _formatScoreAdj = format_evidence.evidence_type === 'long_form_backed' ? 5
        : format_evidence.evidence_type === 'mixed_signal' ? 3
        : format_evidence.evidence_type === 'short_form_spark' ? -10
        : -2;

      // ── Personalization: creator DNA + strong territories + recency ────────
      const dna_bonus = dnaAffinityBonus(phrase, dnaAffinity);
      const territory_strength_bonus = _parentTopic && strongTerritoryParents.has(_parentTopic) ? 4 : 0;
      const recent_cover_penalty = recentCoveragePenalty(phrase, recentTitleTokenSets);

      // ── Competitor intelligence: growth momentum + adoption shape ──────────
      const fastGrowers = b.fast_growth_channels ? b.fast_growth_channels.size : 0;
      const momentum_bonus = Math.min(6, fastGrowers * 2);
      const recentChCount = b.ch_recent ? b.ch_recent.size : 0;
      const priorChCount  = b.ch_prior ? b.ch_prior.size : 0;
      const isEmergingAdoption = recentChCount >= 2 && priorChCount === 0 && saturation_pct < 30;
      const adoptionAccelerating = priorChCount > 0 && recentChCount >= Math.max(2, priorChCount * 1.5);
      const emerging_bonus = isEmergingAdoption ? 8 : adoptionAccelerating ? 5 : 0;

      // ── Trend detection: job signal + Google Trends + view acceleration ────
      const trendRow = trendSignalMap.get(phrase) || trendSignalMap.get(stripModifiers(phrase)) || null;
      const trend_signal_bonus = !trendRow ? 0
        : trendRow.signal_tier === 'rising'   ? 10
        : trendRow.signal_tier === 'emerging' ? 8
        : trendRow.signal_tier === 'peaking'  ? -6
        : 0;
      const gtRow = trendBoostForPhrase(phrase, googleTrendsMap);
      const google_trends_bonus = gtRow ? ((gtRow.trend_value || 0) >= 999 ? 8 : 5) : 0;
      const accelRatio = (b.vpd_recent_cnt >= 2 && b.vpd_prior_cnt >= 2)
        ? (b.vpd_recent_sum / b.vpd_recent_cnt) / Math.max(1, b.vpd_prior_sum / b.vpd_prior_cnt)
        : null;
      const accel_bonus = accelRatio == null ? 0
        : accelRatio >= 1.5 ? 6 : accelRatio >= 1.15 ? 3 : accelRatio <= 0.7 ? -4 : 0;

      const score             = Math.max(1, Math.min(99, Math.round(
        base_views + spread + trend_bonus + vel_bonus + sat_penalty + gap_bonus + lifecycle_penalty + event_penalty + _qualityScore + _specificityPenalty + _formatScoreAdj
        + dna_bonus + territory_strength_bonus + recent_cover_penalty
        + momentum_bonus + emerging_bonus
        + trend_signal_bonus + google_trends_bonus + accel_bonus,
      )));

      // ── Structured "why this exists" reasons (additive, UI-safe) ────────────
      const positiveReasons = [];
      const cautionReasons = [];
      if (dna_bonus >= 8)      positiveReasons.push('strong match with your channel\'s content DNA');
      else if (dna_bonus >= 4) positiveReasons.push('overlaps vocabulary your uploads already win with');
      if (territory_strength_bonus) positiveReasons.push('inside a territory where your videos over-perform');
      if (momentum_bonus > 0)  positiveReasons.push(`backed by ${fastGrowers} fast-growing peer channel${fastGrowers === 1 ? '' : 's'}`);
      if (isEmergingAdoption)  positiveReasons.push('emerging: first peer coverage appeared in the last 3 weeks');
      else if (adoptionAccelerating) positiveReasons.push('peer adoption is accelerating');
      if (trend_signal_bonus > 0) positiveReasons.push(`trend signal job flags this as ${trendRow.signal_tier}`);
      if (trend_signal_bonus < 0) cautionReasons.push('trend signal job flags this as past its peak');
      if (google_trends_bonus > 0) positiveReasons.push('rising on Google Trends (IN)');
      if (accel_bonus > 0)     positiveReasons.push('recent uploads on this topic are gaining views faster than older ones');
      if (accel_bonus < 0)     cautionReasons.push('view velocity on this topic is cooling');
      if (recent_cover_penalty < 0) cautionReasons.push('downweighted: similar to one of your recent uploads');
      const reasons = [...positiveReasons, ...cautionReasons];

      if (trend_status === 'rising')    risingCnt++;
      if (trend_status === 'evergreen') evergreenCnt++;
      if (saturation_pct < 20)          unexploredCnt++;
      if (saturation_pct > 60)          saturatedCnt++;

      const rec_type = IS_NEWS_NICHE    ? 'long_form_opportunity' :
                       niche_category === 'C' ? 'context_gap'    : 'topic_gap';

      // Phrase promotion: if this is a bigram and a longer extension covers ≥35% of its
      // channels, display the richer phrase. Scoring and evidence stay with the bigram.
      let displayPhrase = phrase;
      if (phrase.split(' ').length === 2) {
        const ext = _phraseExtIdx.get(phrase.toLowerCase());
        if (ext && ext.channels >= b.channels.size * 0.20) {
          displayPhrase = ext.phrase;
        }
      }

      const actionTitle = buildTopicActionTitle(displayPhrase, {
        parentTopic: _parentTopic,
        recType: rec_type,
        resolvedNiche,
        cspPrimary: _cspPrimary,
      });

      gaps.push({
        topic:               displayPhrase.replace(/\b\w/g, c => c.toUpperCase()),
        title:               actionTitle,
        action_title:        actionTitle,
        score,
        recommendation_type: rec_type,
        channel_count:       b.channels.size,
        avg_views:           Math.round(avgViews),
        trend_status,
        saturation_pct,
        saturation_level,
        format_winner,
        format_evidence,
        evidence_type:        format_evidence.evidence_type,
        velocity,
        act_now:             !IS_NEWS_NICHE
          && ((trend_status === 'rising' && saturation_pct < 30) || isEmergingAdoption)
          && !shouldSuppressActNow(event_stage),
        event_stage:         event_stage || null,
        topic_category:      topic_category || null,
        expected_low,
        expected_high,
        trend_bonus,
        gap_bonus,
        trending:            b.cnt_0_14 / Math.max(1, totalVidCount) >= 0.4,
        examples:            b.videos.slice(0, 3).map(v => ({
          title:        v.title,
          views:        v.views,
          channel_name: v.channel_name || 'Unknown',
          format_type:  v.format_type || 'unknown',
        })),
        parent_topic:        _parentTopic,
        anchor_topic:        null,
        is_angle:            false,
        reasons,
        why: buildWhyText(b, trend_status, avgViews, rec_type)
          + (positiveReasons.length ? ` Why for you: ${positiveReasons.slice(0, 2).join('; ')}.` : '')
          + (cautionReasons.length ? ` Caution: ${cautionReasons[0]}.` : ''),
        ...(debugMode ? {
          idea_lifecycle_stage: lcStage,
          suppressed_reason:    null,  // not suppressed — included with any lifecycle penalty
          score_breakdown: {
            base_views: Math.round(base_views), spread: Math.round(spread),
            trend_bonus, vel_bonus,
            sat_penalty: Math.round(sat_penalty), gap_bonus, lifecycle_penalty, event_penalty,
            quality: _qualityScore, specificity: _specificityPenalty, format: _formatScoreAdj,
            dna_bonus, territory_strength_bonus, recent_cover_penalty,
            momentum_bonus, emerging_bonus,
            trend_signal_bonus, google_trends_bonus, accel_bonus,
            accel_ratio: accelRatio == null ? null : +accelRatio.toFixed(2),
          },
        } : {}),
      });
    }

    // ── Score angles ────────────────────────────────────────────────────────
    if (anchorAnglesMap) {
      // Track seen narrative phrases to prevent the same idea from surfacing under
      // multiple anchor variants (e.g. "trend analysis" under UPSC PRELIMS, PRELIMS PAPER,
      // UPSC PRELIMS PAPER all producing the same output item).
      const seenAnglePhrases = new Set();
      for (const [anchor, angles] of anchorAnglesMap.entries()) {
        const anchorBucket = topicMap.get((anchorOriginalMap && anchorOriginalMap.get(anchor)) || anchor);
        if (!anchorBucket) continue;
        const anchorTrend  = classifyTrend(anchorBucket);
        const anchorParent = inferParentTopic(anchor) || inferParentTopic((anchorOriginalMap && anchorOriginalMap.get(anchor)) || anchor);
        const anchorDbRow  = eventMetaMap.get(anchor) || null;
        const { category: anchorCat, event_stage: anchorStage } = computeRuntimeEventStage(anchor, anchorBucket, anchorDbRow);
        if (anchorStage === 'dead') continue;

        const anchorBase     = Math.min(35, Math.log10(weightedMedian(anchorBucket.allViews) + 1) / 7 * 35);
        const anchorSpread   = Math.min(20, (anchorBucket.channels.size / poolSize) * 20);
        const anchorTrBonus  = TREND_SCORE[anchorTrend] || 0;
        const anchorEvPen    = getEventPenalty(anchorStage);
        const angleTrendBase = anchorStage === 'post_event' || anchorStage === 'decay' ? 'past_event' : anchorTrend;

        for (const { phrase: anglePh, channels, views, examples, cnt_0_14, satPct } of angles) {
          const angleNorm    = anglePh.replace(/[:.!?]+$/, '').trim();
          // Skip duplicate narrative phrases already surfaced under a different anchor.
          if (seenAnglePhrases.has(angleNorm)) continue;
          const angleLcStage = lifecycleMap.get(anglePh) || lifecycleMap.get(angleNorm) || null;
          if (angleLcStage === 'regular' || angleLcStage === 'saturated') continue;

          // Median view count from videos that contained this narrative bigram
          const sortedV  = [...views].sort((a, b) => a - b);
          const midV     = Math.floor(sortedV.length / 2);
          const angleMedian = sortedV.length % 2 ? sortedV[midV] : Math.round((sortedV[midV - 1] + sortedV[midV]) / 2);
          // Lower bar than topicMap phrases — anchor's popularity already signals audience appetite
          if (angleMedian < minMedianViews * 0.3) continue;

          const lcPen    = angleLcStage === 'exiting' ? -15 : 0;
          const satPen   = satPct > 60 ? -(satPct - 60) / 2 : 0;
          const gapBonus = satPct < 20 ? 10 : 0;
          const score    = Math.max(1, Math.min(99, Math.round(
            anchorBase + anchorSpread + anchorTrBonus + gapBonus + satPen + lcPen + anchorEvPen,
          )));

          // ── Narrative lifecycle ────────────────────────────────────────────
          const nlKey = anchor + '\x00' + anglePh;
          const nlRow = narrativeLifecycleMap ? narrativeLifecycleMap.get(nlKey) : null;
          let nlStage, nlWindow, nlActNow, nlExpiry, nlPubToday, nlVelocity;

          const _diagLC = debugMode && (anchor.includes('italy') || anchor.includes('modi') || anglePh.includes('italy') || anglePh.includes('visit'));
          if (_diagLC) {
            console.log('[DIAG][P1] anchor:', anchor, '| narrative:', anglePh, '| nlKey:', nlKey);
            console.log('[DIAG][P1] nlRow:', nlRow ? JSON.stringify(nlRow) : 'null → inline fallback will run');
          }

          if (nlRow && nlRow.stage !== 'seed') {
            nlStage    = nlRow.stage;
            nlWindow   = nlRow.window_score;
            nlActNow   = nlRow.act_now_conf;
            nlExpiry   = nlRow.expiry_estimate;
            nlPubToday = nlRow.pub_rate_recent || 0;
            nlVelocity = nlRow.velocity || 0;
            if (_diagLC) console.log('[DIAG][P1] → stage:', nlStage, '| source: TABLE | suppressed?', nlStage === 'dead');
          } else {
            // Batch table empty or stale seed — compute from in-memory videos.
            // Never default to 'seed': a narrative with zero recent publications must be dead.
            const narType   = getNarrativeType(resolvedNiche);
            const _nlSigs   = computeNarrativeSignalsInline(anchor, anglePh, communityVideos, communityIds.length, nowMs);
            if (_nlSigs) {
              nlStage    = classifyStage(_nlSigs, null, narType);
              nlWindow   = computeWindowScore(nlStage, _nlSigs.saturation_pct, _nlSigs.velocity);
              nlActNow   = computeActNowConf(nlStage, nlWindow, _nlSigs.saturation_pct, _nlSigs.velocity, _nlSigs.age_hours);
              nlExpiry   = computeExpiry(null, anchorParent, narType);
              nlPubToday = _nlSigs.pub_rate_recent;
              nlVelocity = _nlSigs.velocity;
              if (_diagLC) console.log('[DIAG][P1] → stage:', nlStage, '| source: INLINE | sigs:', JSON.stringify(_nlSigs), '| suppressed?', nlStage === 'dead');
            } else {
              nlStage    = 'emerging';
              nlWindow   = 85;
              nlActNow   = 0;
              nlExpiry   = null;
              nlPubToday = 0;
              nlVelocity = 0;
              if (_diagLC) console.log('[DIAG][P1] → stage: emerging (NO SIGNALS — zero titles matched) | suppressed? false');
            }
            // Persist so the batch job inherits the computed stage on next run
            try {
              db.run(
                `INSERT OR IGNORE INTO narrative_lifecycle
                 (anchor, narrative, niche, narrative_type, stage, window_score, act_now_conf, computed_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
                [anchor, anglePh, resolvedNiche, narType, nlStage, nlWindow, nlActNow],
              );
            } catch (_) {}
          }

          // Suppress dead narratives from production output
          if (nlStage === 'dead') {
            seenAnglePhrases.add(angleNorm);
            continue;
          }

          // ── News confidence gate ───────────────────────────────────────────
          // For news channels, only show narratives that are actively publishing now.
          // Stale or saturated narratives are suppressed — use inline signals only.
          if (IS_NEWS_NICHE) {
            const NEWS_CONF_THRESHOLD = 40;
            const _todayStr  = new Date(nowMs).toISOString().split('T')[0];
            const _stageOk   = nlStage === 'emerging' || nlStage === 'peak';
            const _pubOk     = nlPubToday > 0;
            const _velOk     = nlVelocity > 0;
            const _expiryOk  = nlExpiry !== null && nlExpiry >= _todayStr;
            const _confOk    = nlActNow >= NEWS_CONF_THRESHOLD;
            if (!(_stageOk && _pubOk && _velOk && _expiryOk && _confOk)) {
              seenAnglePhrases.add(angleNorm);
              continue;
            }
          }

          seenAnglePhrases.add(angleNorm);
          const anchorFormatEvidence = summarizeFormatEvidence(anchorBucket.format_evidence);
          gaps.push({
            topic:               anglePh.replace(/\b\w/g, c => c.toUpperCase()),
            score,
            recommendation_type: IS_NEWS_NICHE ? 'long_form_opportunity' : 'angle_gap',
            channel_count:       channels.size,
            avg_views:           Math.round(views.reduce((s, v) => s + v, 0) / Math.max(1, views.length)),
            trend_status:        angleTrendBase,
            saturation_pct:      satPct,
            saturation_level:    satPct < 20 ? 'low' : satPct < 60 ? 'medium' : 'high',
            format_winner:       getFormatWinner(anchorBucket.formats, anchorBucket.allViews.length),
            format_evidence:     anchorFormatEvidence,
            evidence_type:        anchorFormatEvidence.evidence_type,
            velocity:            getVelocity(anchorBucket.vel_pairs),
            act_now:             !IS_NEWS_NICHE && anchorTrend === 'rising' && satPct < 30 && !shouldSuppressActNow(anchorStage),
            event_stage:         anchorStage || null,
            topic_category:      anchorCat || null,
            expected_low:        null,
            expected_high:       null,
            trending:            cnt_0_14 / Math.max(1, views.length) >= 0.4,
            examples,
            parent_topic:        anchorParent,
            anchor_topic:        anchor.replace(/\b\w/g, c => c.toUpperCase()),
            narrative:           anchor.replace(/\b\w/g, c => c.toUpperCase()) + ': ' + anglePh.replace(/\b\w/g, c => c.toUpperCase()),
            narrative_stage:     nlStage,
            narrative_window:    nlWindow,
            narrative_act_now:   nlActNow,
            narrative_expiry:    nlExpiry,
            is_angle:            true,
            why:                 buildWhyText({ channels }, anchorTrend, angleMedian, IS_NEWS_NICHE ? 'long_form_opportunity' : 'angle_gap'),
          });
        }
      }
    }

    const allowedTerritoryIds = allowedTerritoryIdsForChannel({
      resolvedNiche,
      row,
      creatorMode,
      guestIntelActive: _guestIntelActive,
      formatProfile: _fpResult?.format_profile,
    });
    const acceptedTerritories = acceptedTerritoriesAll
      .filter(t => allowedTerritoryIds.has(t.territory_id))
      .slice(0, 3);
    const territoryExpansion = buildTerritoryExpansionIdeas(db, {
      channelId: channel_id,
      acceptedTerritories,
      extractPhrases,
      classifyTrend,
      getFormatWinner,
      getVelocity,
      nowMs,
      userPhraseSet,
      userCanonicalPhraseSet,
      resolvedNiche,
      primaryNiche: row?.primary_niche,
      channelIdentityText: [
        row?.niche,
        row?.primary_niche,
        row?.secondary_niche,
        row?.content_archetype,
        row?.routing_profile,
      ].filter(Boolean).join(' '),
      cspPrimary: _cspPrimary,
      userOwnMedian,
    });
    territoryExpansionDebug = territoryExpansion.debug;
    if (territoryExpansion.ideas.length) {
      gaps.push(...territoryExpansion.ideas);
    }
    if (isDefenceLike) {
      gaps.push(...buildDefenceSignalIdeas(communityVideos, {
        peerCount: communityIds.length,
        getFormatWinner,
      }));
    }

    gaps.sort((a, b) => b.score - a.score);

    // ── P1 quality floor: angle_gap keyword dump rejection ────────────────────
    // Rejects angle_gap ideas that are short (< 6 words) with no recognizable named entity.
    // Gold set evidence: Garbage avg 4.97 words / 0% positive; Excellent avg 11.20 words.
    // Rejection: word_count < 6 AND no named entity (digit, known proper noun, or acronym).
    // Only applies to angle_gap / is_angle ideas. territory_expansion and peer signals pass through.
    {
      // Named-entity proper-noun list: words that make a short title filmable.
      // "india" excluded — it is the default topic domain, not a distinguishing entity.
      const _PROPER_NOUNS = new Set([
        'trump','modi','biden','putin','xi','zelensky','netanyahu','khamenei','macron',
        'sunak','erdogan','obama','clinton','bush','kejriwal','rahul','gandhi','yogi',
        'shah','jaishankar','sitharaman','nitish','mamata','abe','kim','scholz',
        'china','chinese','pakistan','pakistani','russia','russian','ukraine','ukrainian',
        'iran','iranian','israel','israeli','america','american','usa','us','uk',
        'britain','british','france','french','germany','german','japan','japanese',
        'bangladesh','myanmar','afghanistan','nepal','taiwan','korea','turkish','saudi',
        'rbi','sebi','bcci','ipl','icc','nato','imf','isro','nasa','who','wto',
        'bjp','congress','aap','inc','sp','bsp','tmc','nda','upa','unsc',
        'apple','google','microsoft','amazon','tesla','openai','meta','samsung',
        'adani','ambani','tata','reliance','infosys','wipro','hdfc','sbi','icici',
        'delhi','mumbai','hyderabad','bangalore','bengaluru','chennai','kolkata',
        'ahmedabad','pune','jaipur','lucknow','patna','bhopal','chandigarh','bengal',
        'washington','moscow','beijing','london','paris','berlin','tokyo',
        'islamabad','lahore','karachi','dhaka','kathmandu','kabul','tehran',
        'jerusalem','kyiv','ankara','riyadh','dubai',
        'sensex','nifty','nse','bse','gdp','cpi','wpi','rupee','dollar','euro','yuan',
        'icc','cricket','virat','kohli','sachin','dhoni','rohit','bumrah','fifa',
        'election','elections','parliament','supreme','court','lok','rajya','sabha',
      ]);
      const _hasNamedEntity = topic => {
        return String(topic || '').toLowerCase().split(/\s+/).some(w =>
          /\d/.test(w) ||                               // contains a digit
          /^\d*(cr|lakh|k|m|b|%|\+)$/i.test(w) ||     // currency/percentage shorthand
          _PROPER_NOUNS.has(w)                          // known proper noun
        );
      };
      const _before = gaps.length;
      const _filtered = gaps.filter(g => {
        if (!g.is_angle && g.source !== 'angle_gap') return true;
        const wc = String(g.topic || '').trim().split(/\s+/).filter(Boolean).length;
        return wc >= 6 || _hasNamedEntity(g.topic);
      });
      if (_filtered.length < _before) {
        if (process.env.WTP_DEBUG === '1') {
          console.log(`[WTP][P1] angle_gap floor: ${_before} → ${_filtered.length} (-${_before - _filtered.length} keyword dumps rejected)`);
        }
        gaps.length = 0;
        gaps.push(..._filtered);
      }
    }

    // ── Deduplicate overlapping phrases + same-video ideas ─────────────────
    // Two passes:
    // 1. Drop ideas whose example videos are already covered by a higher-scoring idea.
    //    This catches same-content-different-phrase cases (e.g. regional channel siblings
    //    all posting the same clip, producing two phrases that look unrelated).
    // 2. Drop ideas whose topic words mostly overlap with an already-accepted idea.
    // ── Entity expansion pre-pass ──────────────────────────────────────────
    // If a 2-word phrase has a 3-word superset within 30 score points, skip
    // the shorter phrase so the more specific entity wins in dedup.
    const gapWordSets = gaps.map(g => g.topic.toLowerCase().split(' '));
    const skipAsRedundant = new Set();
    for (let i = 0; i < gaps.length; i++) {
      if (gapWordSets[i].length >= 3) continue;
      for (let j = i + 1; j < gaps.length; j++) {
        if (gaps[j].score < gaps[i].score - 30) break;
        if (gapWordSets[j].length <= gapWordSets[i].length) continue;
        if (gapWordSets[i].every(w => gapWordSets[j].includes(w))) {
          skipAsRedundant.add(i);
          break;
        }
      }
    }

    const deduped        = [];
    const usedWords      = new Set();
    const usedVideoIds   = new Set();
    const territoryCap   = Math.max(2, Math.floor(15 * 0.4));
    const territoryClusterCounts = new Map();
    let territoryAccepted = 0;

    for (let gapIdx = 0; gapIdx < gaps.length; gapIdx++) {
      if (skipAsRedundant.has(gapIdx)) continue;
      const gap = gaps[gapIdx];
      if (gap.source === 'territory_expansion') {
        if (territoryAccepted >= territoryCap) continue;
        const cluster = territoryExpansionCluster(gap);
        const currentClusterCount = territoryClusterCounts.get(cluster) || 0;
        const clusterCap = cluster === 'macro_shock' ? 1 : 2;
        if (currentClusterCount >= clusterCap) continue;
      }
      const exampleIds = (gap.examples || []).map(e => e.title); // use title as proxy (no id in examples)
      const videoOverlap = exampleIds.filter(t => usedVideoIds.has(t)).length;
      if (videoOverlap >= 2) continue; // 2+ same example videos = same content

      const words  = gap.topic.toLowerCase().split(' ');
      const wOverlap = words.filter(w => usedWords.has(w)).length;
      if (words.length <= 2) {
        if (wOverlap >= words.length) continue;
      } else if (wOverlap >= words.length - 1) {
        continue;
      }

      exampleIds.forEach(t => usedVideoIds.add(t));
      words.forEach(w => usedWords.add(w));
      deduped.push(gap);
      if (gap.source === 'territory_expansion') {
        territoryAccepted++;
        const cluster = territoryExpansionCluster(gap);
        territoryClusterCounts.set(cluster, (territoryClusterCounts.get(cluster) || 0) + 1);
      }
      if (deduped.length >= 15) break;
    }

    // ── Zero-idea fallback cascade ─────────────────────────────────────────────
    // When exact phrase consensus is sparse, recover evidence-backed ideas from
    // the same peer videos before dropping to generic evergreen prompts.
    if (deduped.length < 5 && !_guestIntelActive && communityVideos.length >= 10) {
      let _peerDna = null;
      try { _peerDna = readCreatorIdeaDna(db, channel_id); } catch (_) {}
      const peerSignals = buildPeerVideoSignalIdeas(communityVideos, {
        existingIdeas: deduped,
        communityIds,
        extractPhrases,
        getFormatWinner,
        nowMs,
        userPhraseSet,
        userCanonicalPhraseSet,
        resolvedNiche,
        primaryNiche: row?.primary_niche,
        cspPrimary: _cspPrimary,
        formatProfile: _fpResult?.format_profile,
        creatorMode,
        minMedianViews,
        limit: 8,
        dna: _peerDna,
      });
      peerVideoSignalDebug = peerSignals.debug;

      for (const idea of peerSignals.ideas) {
        if (deduped.length >= 10) break;
        if (hasTopicOverlap(idea.topic, deduped)) continue;
        deduped.push(idea);
        if (idea.trend_status === 'rising')    risingCnt++;
        if (idea.trend_status === 'evergreen') evergreenCnt++;
        if ((idea.saturation_pct ?? 100) < 20) unexploredCnt++;
        if ((idea.saturation_pct ?? 0) > 60)   saturatedCnt++;
      }
    }

    // Final fallback: append evergreen niche suggestions so every channel gets
    // at least a starting point. These stay clearly marked as low confidence.
    if (deduped.length < 5) {
      const _fallbackContext = _fallbackContextForChannel({ row, resolvedNiche, creatorMode, cspPrimary: _cspPrimary, formatProfile: _fpResult?.format_profile });
      const _fallbackIdeas = _getNicheFallbackToFive(_fallbackContext);
      const _usedTopics    = new Set(deduped.map(d => d.topic.toLowerCase()));
      let _fbScore         = Math.max(1, (deduped[deduped.length - 1]?.score ?? 18) - 3);
      for (const fb of _fallbackIdeas) {
        if (deduped.length >= 5) break;
        if (_usedTopics.has(fb.topic.toLowerCase())) continue;
        _usedTopics.add(fb.topic.toLowerCase());
        deduped.push({ ...fb, score: _fbScore, source: 'fallback_evergreen', confidence: 'low' });
        _fbScore = Math.max(1, _fbScore - 2);
      }
    }

    // ── Creator fit scoring + re-ranking ─────────────────────────────────────
    // Re-weights each idea's score by how plausible the topic is for THIS creator.
    // A topic can only rank highly if peers cover it AND it fits the creator's domain.
    // Peers alone are not sufficient — this prevents biryani recipes appearing for talk shows.
    if (channel_id) {
      let creatorDnaFull = null;
      try { creatorDnaFull = readCreatorIdeaDna(db, channel_id); } catch (_) {}
      const creatorLang = row?.primary_language || 'en';
      for (const idea of deduped) {
        const { fit_score, fit_weight, fit_breakdown } = computeCreatorFitScore(
          idea.topic,
          idea,
          {
            dna:                  creatorDnaFull,
            formatProfile:        _fpResult?.format_profile || null,
            acceptedTerritories:  acceptedTerritoriesAll,
            language:             creatorLang,
          },
        );
        idea.opportunity_score      = idea.score; // preserve raw peer-signal score
        idea.creator_fit_score      = fit_score;
        idea.creator_fit_weight     = fit_weight;
        idea.creator_fit_breakdown  = fit_breakdown;
        // Sparse-DNA creators (confidence < 0.3) receive neutral defaults for domain_match
        // and zero vocab_overlap — identical to "no information", not "wrong domain".
        // Applying the full fit_weight in this case silently halves every recommendation
        // with no evidence of mismatch. Floor at 0.85× until real DNA data is available.
        const hasReliableDna = (creatorDnaFull?.confidence_score ?? 0) >= 0.3;
        const effectiveFitWeight = hasReliableDna ? fit_weight : Math.max(0.85, fit_weight);
        idea.creator_fit_weight_effective = effectiveFitWeight;
        idea.score = Math.round(idea.score * effectiveFitWeight);
      }
      deduped.sort((a, b) => b.score - a.score);

      // Write peer-signal traces (audit only — never returned in API response)
      if (db && deduped.length) {
        try {
          const _psStmt = db._stmt(
            `INSERT OR IGNORE INTO wtp_generation_traces
             (idea_key, channel_id, rec_source, archetype, generated_title,
              dna_affinity_score, dna_affinity_reason,
              opportunity_id, opportunity_label, opportunity_confidence, wtp_score,
              peer_concept_id, peer_concept_label, peer_concept_confidence,
              created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
          );
          for (const _idea of deduped.slice(0, 25)) {
            const _key = 'ps:' + crypto.createHash('sha1')
              .update(`${channel_id}::${String(_idea.topic || '').toLowerCase()}`)
              .digest('hex').slice(0, 16);
            const _fitReason = _idea.creator_fit_breakdown
              ? Object.entries(_idea.creator_fit_breakdown)
                  .filter(([, v]) => v)
                  .map(([k]) => k)
                  .slice(0, 4)
                  .join(',')
              : null;
            // Derive concept from title for opportunity extraction (observational only)
            const _inferred = _extractConceptForTrace(_idea.topic || '');
            const _opp = extractOpportunity({
              concept_id:      _inferred.concept_id || null,
              generated_title: _idea.topic || null,
              raw_subject:     null,
              family:          null,
              archetype:       _idea.recommendation_type || null,
            });
            try {
              _psStmt.run(
                _key,
                channel_id,
                _idea.source || 'angle_gap',
                _idea.recommendation_type || _idea.source || null,
                _idea.topic || null,
                null,        // dna_affinity_score: NULL for peer/angle (concept affinity not applicable here)
                _fitReason,  // dna_affinity_reason: repurposed as fit_reason for audit context
                _opp ? _opp.opportunity_id : null,
                _opp ? _opp.opportunity_label : null,
                _opp ? _opp.opportunity_confidence : null,
                _idea.score ?? null,  // wtp_score: actual post-fit-weight ranking score (0-100 scale)
                _inferred.concept_id         || null,
                _inferred.concept_label      || null,
                _inferred.concept_confidence || null,
              );
            } catch (_) {}
          }
        } catch (_) {}
      }
    }

    // ── P6 angle_gap research mode ────────────────────────────────────────────
    // Gold evidence: 0/313 angle_gap rows positive (0% win rate). Traces written
    // above for ongoing label collection. Hidden from API until positive rate >10%.
    {
      const _nonAngle = deduped.filter(g => g.source !== 'angle_gap' && !g.is_angle);
      deduped.length = 0;
      deduped.push(..._nonAngle);
    }

    // ── Opportunity packaging: angle decoration + lanes ───────────────────────
    // Decorate ideas with CSP-specific angle titles and group into display lanes.
    // buildOpportunityResponse returns { ideas: decorated[], lanes: {...} }.
    // `ideas` replaces deduped in-place (same objects, just extended with angle fields).
    // `lanes` is additive — existing `ideas` key stays for backwards compatibility.
    const _angleCspPrimary = (_cspConfidence === 'medium' || _cspConfidence === 'high') ? _cspPrimary : null;
    const { ideas: opportunityIdeas, lanes: opportunityLanes } = buildOpportunityResponse(deduped, _angleCspPrimary);
    const orderedOpportunityIdeas = _suppressLowValueIdeas(
      _orderByConfidence(_applyConfidenceTiers(opportunityIdeas)),
      { creatorIsEnglish: /^en/i.test(row?.primary_language || 'en') },
    );
    const orderedOpportunitySet = new Set(orderedOpportunityIdeas);
    const orderedOpportunityLanes = Object.fromEntries(
      Object.entries(opportunityLanes || {}).map(([lane, ideas]) => [
        lane,
        orderedOpportunityIdeas.filter(idea => (ideas || []).includes(idea) && orderedOpportunitySet.has(idea)),
      ]),
    );

    // ── Output engine (profile-aware framing) ────────────────────────────────
    const _outputEngine = buildOutputEngine({
      creatorMode,
      routingProfile: _rpResult?.profile || null,
      formatProfile:  _fpResult?.format_profile || null,
      nowMs,
    });

    if (_outputEngine) {
      for (const idea of deduped) {
        const tag = tagIdea(idea.topic, _outputEngine.engine_id);
        if (tag) idea.engine_tag = tag;
      }
    }

    let podcastIntel = null;
    let shadowPodcastDebug = null;
    let podcastIntelMeta = null;

    if (_guestIntelActive && channel_id) {
      // guest_interview channels always use the shadow peer pool for better guest
      // extraction — community_ids rarely contain enough podcast-format peers.
      // scored_count < 10 is preserved as a warning but does NOT cause a fallback,
      // because guest extraction reads titles (not fingerprint overlap).
      const _modeResult = computePodcastModePeers(db, channel_id, { userRegion, limit: 150 });

      const _podcastPeerIds = _modeResult?.ids?.length > 0
        ? _modeResult.ids
        : communityIds;

      if (_podcastPeerIds.length > 0) {
        podcastIntel = computePodcastIntel(db, channel_id, _podcastPeerIds, nowMs, debugMode);
        const _guestNames   = (podcastIntel.guests || []).map(g => g.name);
        const _channelName  = row?.channel_name || '';
        const _targetLanes  = podcastIntel.target_lanes || [];
        const _themesResult = computePodcastThemes(db, channel_id, _podcastPeerIds, _guestNames, _channelName, nowMs, debugMode, _targetLanes, extractPhrases, PODCAST_META_TOKENS);
        podcastIntel        = { ...podcastIntel, ..._themesResult };
      }

      podcastIntelMeta = {
        podcast_intel_peer_source: _modeResult?.ids?.length > 0 ? 'shadow_mode_peers' : 'current_community_ids',
        podcast_intel_peer_count:  _podcastPeerIds.length,
      };
      if (_modeResult?.debug?.scored_count < 10) {
        podcastIntelMeta.podcast_intel_shadow_warning = 'scored_count < 10 — shadow pool low fingerprint overlap';
      }

      if (debugMode && _modeResult) {
        const { ids: _sIds, fingerprint_used: _sFpUsed, debug: _sDbg, top_scored: _sTopScored = [], top_fallback: _sTopFallback = [] } = _modeResult;
        const _sScoreMap     = new Map(_sTopScored.map(s => [s.channel_id, s]));
        let _sFmtCounts      = {};
        let _sSample         = [];
        let _sFallbackSample = [];
        if (_sIds.length > 0) {
          const _sPh   = _sIds.slice(0, 50).map(() => '?').join(',');
          const _sRows = db.all(
            `SELECT channel_id, channel_name, format_type FROM ingested_channels WHERE channel_id IN (${_sPh})`,
            _sIds.slice(0, 50),
          );
          for (const r of _sRows) _sFmtCounts[r.format_type || 'null'] = (_sFmtCounts[r.format_type || 'null'] || 0) + 1;
          _sSample = _sRows.slice(0, 15).map(r => {
            const sc = _sScoreMap.get(r.channel_id) || {};
            return { id: r.channel_id, name: r.channel_name, fmt: r.format_type, shared_phrases: sc.phraseScore || 0, shared_tokens: sc.tokenScore || 0 };
          });
        }
        if (_sTopFallback.length > 0) {
          const _sfPh   = _sTopFallback.map(() => '?').join(',');
          const _sfRows = db.all(
            `SELECT channel_id, channel_name, format_type, primary_niche FROM ingested_channels WHERE channel_id IN (${_sfPh})`,
            _sTopFallback,
          );
          _sFallbackSample = _sfRows.map(r => ({ id: r.channel_id, name: r.channel_name, fmt: r.format_type, niche: r.primary_niche }));
        }
        const _sCurrent = new Set(communityIds);
        shadowPodcastDebug = {
          pool_size:            _sIds.length,
          fingerprint_used:     _sFpUsed,
          format_counts:        _sFmtCounts,
          current_pool_size:    communityIds.length,
          overlap_with_current: _sIds.filter(id => _sCurrent.has(id)).length,
          sample:               _sSample,
          top_fallback_sample:  _sFallbackSample,
          ..._sDbg,
        };
      }
    }

    let identityBlock = null;
    if (channel_id) {
      const ci = db.get(
        `SELECT confidence_tier, identity_type, is_hybrid, brand_contamination_pct,
                health_flags, peer_source_recommended, content_phrase_count
         FROM channel_identity WHERE channel_id = ?`,
        [channel_id],
      );
      if (ci) {
        let healthFlags = [];
        try { healthFlags = ci.health_flags ? JSON.parse(ci.health_flags) : []; } catch (_) {}
        identityBlock = {
          confidence_tier:         ci.confidence_tier,
          identity_type:           ci.identity_type,
          is_hybrid:               ci.is_hybrid === 1,
          brand_contamination_pct: ci.brand_contamination_pct,
          health_flags:            healthFlags,
          peer_source_recommended: ci.peer_source_recommended,
          content_phrase_count:    ci.content_phrase_count,
        };
      }
    }

    return {
      ok:                   true,
      niche_category,
      channel_count:        communityIds.length,
      video_count:          communityVideos.length,
      ideas:                (() => {
        const scored = orderedOpportunityIdeas.map(idea =>
          'specificity_score' in idea
            ? idea
            : { ...idea, specificity_score: computeSpecificityScore(idea.topic || '') }
        );
        const specific = scored.filter(i => (i.specificity_score ?? 0) >= 25);
        const generic  = scored.filter(i => (i.specificity_score ?? 0) < 25);
        return [...specific, ...generic];
      })(),
      lanes:                orderedOpportunityLanes,
      original_bets:        originalBets,
      no_active_narratives: IS_NEWS_NICHE && deduped.length === 0,
      creator_mode:         creatorMode,
      ...(_fpResult ? {
        format_profile:            _fpResult.format_profile,
        format_profile_confidence: _fpResult.confidence,
      } : {}),
      // Activation flags — classification metadata does not equal engine activation.
      // Each flag is the strict gate for its corresponding engine/pipeline.
      guest_intel_active:         _guestIntelActive,
      routing_profile_active:     _routingProfileActive,
      csp_routing_active:         _cspRoutingActive,
      ...(_cspRoutingActive ? { csp_primary: _cspPrimary, csp_confidence: _cspConfidence, csp_peer_count: _cspPeerCount } : {}),
      exam_engine_active:         !!(_outputEngine?.engine_id === 'exam_demand'),
      transformation_engine_active: false, // future: manifestation_healing + meditation_spirituality
      market_engine_active:         false, // future: business_finance
      product_engine_active:        false, // future: startup_founder + tech_ai
      ...(routingProfileData ? {
        routing_profile:            routingProfileData.routing_profile,
        routing_profile_confidence: routingProfileData.routing_profile_confidence,
        ...(_routingProfileActive && routingProfileData.routing_profile ? {
          routing_profile_question: PROFILE_QUESTIONS[routingProfileData.routing_profile] || null,
        } : {}),
      } : {}),
      ...(podcastIntelMeta || {}),
      ...(_outputEngine ? { output_engine: _outputEngine } : {}),
      summary: {
        rising:               risingCnt,
        evergreen:            evergreenCnt,
        unexplored:           unexploredCnt,
        saturated:            saturatedCnt,
        inactive_peers_dropped: inactivePeersDropped,
        lifecycle_suppressed: lcSuppressed,
        lifecycle_regular:    lcRegular,
        lifecycle_saturated:  lcSaturated,
        lifecycle_exiting:    lcExiting,
      },
      identity:       identityBlock,
      ...(podcastIntel ? { podcast_intel: podcastIntel } : {}),
      ...(shadowPodcastDebug ? { podcast_mode_shadow: shadowPodcastDebug } : {}),
      ...(debugMode && peerRoutingDebug ? { peer_routing: peerRoutingDebug } : {}),
      ...(debugMode && routingProfileData ? { routing_profile_debug: routingProfileData } : {}),
      ...(debugMode && territoryExpansionDebug ? { territory_expansion: territoryExpansionDebug } : {}),
      ...(debugMode && peerVideoSignalDebug ? { peer_video_signal: peerVideoSignalDebug } : {}),
      ...(debugMode && _guestIntelActive && communityIds.length > 0 ? (() => {
        const _dbgPh = communityIds.slice(0, 100).map(() => '?').join(',');
        const _dbgRows = db.all(
          `SELECT channel_id, channel_name, format_type FROM ingested_channels WHERE channel_id IN (${_dbgPh})`,
          communityIds.slice(0, 100),
        );
        const _fmtCounts = {};
        for (const r of _dbgRows) _fmtCounts[r.format_type || 'null'] = (_fmtCounts[r.format_type || 'null'] || 0) + 1;
        return {
          podcast_peer_debug: {
            pool_size:       communityIds.length,
            format_counts:   _fmtCounts,
            sample:          _dbgRows.slice(0, 20).map(r => ({ id: r.channel_id, name: r.channel_name, fmt: r.format_type })),
          },
        };
      })() : {}),
      ...(debugMode && lcSuppressedSample.length > 0
        ? { lifecycle_suppressed_sample: lcSuppressedSample } : {}),
      ...(territoryDebug || {}),
    };
}

module.exports = { computeWhatToPost };

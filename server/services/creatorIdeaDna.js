'use strict';

const crypto = require('crypto');
const {
  STOPWORDS,
  extractPhrases,
  DEVANAGARI_RE,
  SOUTH_SCRIPT_RE,
} = require('../lib/phrases');

// v2: micro_topic extraction now includes native-script phrases (Tamil/Telugu/Hindi/Arabic/
// Bengali…) — previously Latin-only, leaving regional channels with empty topics → 0 bets.
// Bumping the version marks all v1 DNA stale so the pipeline rebuilds it with native topics.
const CREATOR_IDEA_DNA_VERSION = 2;
const DEFAULT_VIDEO_LIMIT = 50;
const RECENT_WINDOW = 15;

const EXTRA_STOPWORDS = new Set([
  'short', 'shorts', 'video', 'videos', 'episode', 'episodes', 'live',
  'explained', 'explains', 'explainer', 'part', 'full', 'latest',
  'india', 'indian', // kept as context flags, not as standalone vocabulary
]);

const COMMON_ENTITY_PREFIXES = new Set([
  'the', 'this', 'that', 'these', 'those', 'why', 'how', 'what', 'when',
  'where', 'who', 'is', 'are', 'was', 'were', 'can', 'will', 'do', 'does',
  'here', 'one', 'your', 'most', 'rich', 'people', 'super',
]);

const ENTITY_ACRONYM_ALLOWLIST = new Set(['AI', 'RBI', 'GDP', 'UPSC', 'JEE', 'NEET', 'EV']);

const HOOK_TEMPLATE_RULES = [
  { id: 'why_x',              pattern: /^\s*why\b/i },
  { id: 'how_x',              pattern: /^\s*how\b/i },
  { id: 'what_is_x',          pattern: /^\s*what\s+(is|are|happened|happens)\b/i },
  { id: 'question_hook',      pattern: /\?\s*$/ },
  { id: 'this_x',             pattern: /^\s*this\b|\bthis\s+(is|could|will|might|can)\b/i },
  { id: 'money_number_hook',  pattern: /(?:(?:\$|rs\.?|inr)\s?\d|\b\d+(?:\.\d+)?\s?(?:crore|cr|lakh|million|billion|trillion|k|m|bn|%|percent)\b)/i },
  { id: 'hidden_secret_hook', pattern: /\b(hidden|secret|dark|truth|behind|inside|real reason|what they do not tell)\b/i },
  { id: 'investigation_hook', pattern: /\b(scandal|scam|exposed|investigation|inside|using|stealing|lab rats|fake)\b/i },
  { id: 'future_threat_hook', pattern: /\b(future|coming|entering|too late|not ready|collapse|crisis|threat|war|end of)\b/i },
  { id: 'comparison_hook',    pattern: /\b(vs|versus|north india|south india|rich|poor|middle class|better than|worse than)\b/i },
];

const DOMAIN_RULES = [
  {
    id: 'money_economics',
    patterns: [
      /\b(money|business|businesses|companies|company|economy|economic|finance|financial|stock|stocks|market|markets|tax|taxes|price|prices|pricing|subscription|subscriptions|inflation|salary|salaries|income|wealth|bank|banking|startup|startups|founder|founders|profit|profits|revenue|consumer|consumers|luxury|middle class|emi|loan|loans|debt|cash|rupee|dollar)\b/i,
    ],
  },
  {
    id: 'tech_ai',
    patterns: [
      /\b(tech|technology|ai|artificial intelligence|app|apps|software|internet|platform|platforms|algorithm|algorithms|data|privacy|phone|smartphone|iphone|android|google|apple|meta|microsoft|openai|chatgpt|automation|digital)\b/i,
    ],
  },
  {
    id: 'health_body',
    patterns: [
      /\b(health|fitness|protein|food|nutrition|body|brain|sleep|balding|hair|cure|medicine|medical|disease|addiction|addicted|gym|supplement|supplements|mental health)\b/i,
    ],
  },
  {
    id: 'food_consumer',
    patterns: [
      /\b(food|foods|snack|snacks|sugar|protein|restaurant|restaurants|zomato|swiggy|delivery|consumer|brand|brands|lab rats|packaged|processed|fitness boom)\b/i,
    ],
  },
  {
    id: 'politics_policy',
    patterns: [
      /\b(government|policy|policies|politics|political|election|elections|war|iran|trump|china|pakistan|russia|america|usa|court|law|laws|ban|banned|tax|regulation|regulator|state|states|north india|south india)\b/i,
    ],
  },
  {
    id: 'urban_infra',
    patterns: [
      /\b(city|cities|urban|roads|traffic|metro|train|housing|rent|heat|hot|climate|air conditioner|ac|electricity|water|pollution|design|infrastructure|real estate)\b/i,
    ],
  },
  {
    id: 'work_career',
    patterns: [
      /\b(job|jobs|career|careers|work|working|office|salary|salaries|employee|employees|founder|founders|startup|startups|hiring|layoff|layoffs|skill|skills)\b/i,
    ],
  },
  {
    id: 'education_exam',
    patterns: [
      /\b(exam|exams|neet|jee|upsc|student|students|study|studying|college|school|education|course|courses|teacher|teachers|marks|rank|syllabus)\b/i,
    ],
  },
  {
    id: 'culture_society',
    patterns: [
      /\b(culture|society|social|family|families|marriage|dating|gender|religion|class|middle class|rich|poor|generation|gen z|millennial|status|luxury|normal life)\b/i,
    ],
  },
  {
    id: 'science_environment',
    patterns: [
      /\b(science|scientists|research|climate|heat|hot|environment|energy|solar|space|earth|biology|physics|cure|medicine|disease|pollution|water)\b/i,
    ],
  },
  {
    id: 'brand_business',
    patterns: [
      /\b(brand|brands|company|companies|business|businesses|startup|startups|zomato|swiggy|ola|jio|reliance|tata|adani|apple|google|amazon|netflix|subscription|subscriptions|customer|customers)\b/i,
    ],
  },
  {
    id: 'media_internet',
    patterns: [
      /\b(youtube|creator|creators|influencer|influencers|media|news|internet|viral|meme|memes|algorithm|platform|platforms|app|apps|subscription|subscriptions)\b/i,
    ],
  },
  {
    id: 'lifestyle_status',
    patterns: [
      /\b(lifestyle|luxury|status|middle class|normal life|fitness|travel|fashion|home|house|rent|car|cars|wedding|shopping|mall|malls)\b/i,
    ],
  },
];

const THESIS_RULES = [
  {
    id: 'broken_system',
    patterns: [
      /\b(broken|dumb|bad design|problem|problems|wrong|collapse|failing|failed|crisis|trap|stealing|too hot|too expensive|impossible|cannot afford|scam)\b/i,
    ],
  },
  {
    id: 'hidden_economics',
    patterns: [
      /\b(hidden|business behind|economics of|money behind|behind|inside|profit|profits|pricing|subscription|addiction|addicted|industry|market|why every|why india)\b/i,
    ],
  },
  {
    id: 'consumer_deception',
    patterns: [
      /\b(scam|fake|dark|lie|lies|truth|using indians|lab rats|exploiting|trap|addiction|addicted|not telling|secret|hidden)\b/i,
    ],
  },
  {
    id: 'future_threat',
    patterns: [
      /\b(future|coming|finally coming|entering|not ready|too late|threat|war|world war|climate|crisis|collapse|end of|will change|is becoming)\b/i,
    ],
  },
  {
    id: 'investigation',
    patterns: [
      /\b(hidden|dark|scam|exposed|truth|behind|inside|investigation|secret|what they do not tell|using|stealing|lab rats)\b/i,
    ],
  },
  {
    id: 'myth_bust',
    patterns: [
      /\b(myth|wrong about|truth about|fake|lie|lies|not true|does not|is not|are not|no one|nobody)\b/i,
    ],
  },
  {
    id: 'comparison',
    patterns: [
      /\b(vs|versus|north india|south india|rich|poor|middle class|better than|worse than|why.*than|costs more|pays more)\b/i,
    ],
  },
  {
    id: 'science_explainer',
    patterns: [
      /\b(science|research|body|brain|protein|fitness|heat|climate|cure|medicine|medical|disease|balding|environment|pollution)\b/i,
    ],
  },
  {
    id: 'tech_shift',
    patterns: [
      /\b(ai|artificial intelligence|apps|subscription|algorithm|data|privacy|software|internet|platform|automation|digital|tech|technology)\b/i,
    ],
  },
  {
    id: 'india_system',
    patterns: [
      /\b(india|indian|indians|north india|south india|cities|middle class|government|rupee|crore|lakh)\b/i,
    ],
  },
  {
    id: 'daily_life_system',
    patterns: [
      /\b(cities|ac|air conditioner|food|fitness|apps|subscription|middle class|normal life|daily life|home|rent|traffic|school|college|work|salary)\b/i,
    ],
  },
  {
    id: 'policy_power',
    patterns: [
      /\b(government|policy|law|ban|banned|tax|court|state|politics|war|election|regulation|regulator|power|stealing)\b/i,
    ],
  },
  {
    id: 'health_body',
    patterns: [
      /\b(health|fitness|protein|body|brain|food|cure|medicine|balding|addiction|sleep|supplement|disease)\b/i,
    ],
  },
  {
    id: 'career_work',
    patterns: [
      /\b(job|jobs|career|work|office|salary|employee|founder|startup|hiring|layoff|skill|skills)\b/i,
    ],
  },
  {
    id: 'brand_business',
    patterns: [
      /\b(brand|brands|company|companies|business|startup|startups|subscription|subscriptions|customer|customers|market|profit|revenue)\b/i,
    ],
  },
  {
    id: 'crisis_risk',
    patterns: [
      /\b(crisis|collapse|shock|war|threat|risk|danger|too hot|scam|addiction|not ready|too late|end of)\b/i,
    ],
  },
];

const NOVELTY_RULES = [
  { id: 'hidden',        pattern: /\b(hidden|secret|behind|inside|dark)\b/i },
  { id: 'scam_or_fake',  pattern: /\b(scam|fake|lie|lies|trap)\b/i },
  { id: 'weird_or_dumb', pattern: /\b(weird|dumb|strange|absurd|crazy)\b/i },
  { id: 'threat',        pattern: /\b(threat|crisis|collapse|war|shock|danger|risk|too hot|too late)\b/i },
  { id: 'body_science',  pattern: /\b(cure|brain|body|protein|balding|lab rats|research)\b/i },
  { id: 'no_one_knows',  pattern: /\b(no one|nobody|not telling|what they do not tell)\b/i },
  { id: 'finally_now',   pattern: /\b(finally|now|entering|becoming|coming)\b/i },
];

const MISMATCH_FAMILIES = [
  {
    id: 'phone_review',
    matchTerms: ['unboxing', 'hands on', 'camera test', 'battery test', 'specs', 'smartphone review', 'iphone review', 'android review', 'launch event'],
    avoidUnlessCsp: ['tech_review_gadget'],
  },
  {
    id: 'trading_tip',
    matchTerms: ['intraday', 'banknifty', 'nifty option', 'option chain', 'target price', 'stoploss', 'candlestick', 'chart pattern', 'buy sell call'],
    avoidUnlessCsp: ['finance_investment_education'],
  },
  {
    id: 'generic_news_bulletin',
    matchTerms: ['breaking news', 'latest update', 'live update', 'today news', 'press conference'],
    avoidUnlessCsp: ['news_event_bulletin'],
  },
  {
    id: 'exam_prep',
    matchTerms: ['neet strategy', 'jee strategy', 'upsc lecture', 'exam preparation', 'mock test', 'syllabus'],
    avoidUnlessCsp: ['exam_demand_teaching'],
  },
  {
    id: 'guest_podcast_episode',
    matchTerms: ['podcast with', 'episode with', 'ft ', 'interview with', 'in conversation with'],
    avoidUnlessCsp: ['indian_business_selfimprovement_podcast', 'founder_economy_conversation', 'personal_finance_guest_show', 'spiritual_geopolitics_guest_show'],
  },
  {
    id: 'generic_reaction',
    matchTerms: ['reaction', 'reacts', 'roast', 'funny moments', 'try not to laugh'],
    avoidUnlessCsp: [],
  },
];

function round(value, places = 3) {
  const factor = 10 ** places;
  return Math.round((Number(value) || 0) * factor) / factor;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function safeJsonParse(value, fallback) {
  if (value == null || value === '') return fallback;
  try {
    return JSON.parse(value);
  } catch (_) {
    return fallback;
  }
}

function unique(values) {
  const seen = new Set();
  const out = [];
  for (const value of values) {
    if (!value) continue;
    const key = String(value).trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(String(value).trim());
  }
  return out;
}

function normalizeText(value) {
  return String(value || '')
    .replace(/[\u2019\u2018]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenizeTitle(title) {
  if (!title || SOUTH_SCRIPT_RE.test(title)) return [];
  const matches = normalizeText(title)
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/#\w+/g, ' ')
    .match(/[a-z][a-z0-9']{2,}/g) || [];

  return matches
    .map(t => t.replace(/^'+|'+$/g, ''))
    .filter(t => t.length > 2)
    .filter(t => !STOPWORDS.has(t) && !EXTRA_STOPWORDS.has(t))
    .filter(t => !DEVANAGARI_RE.test(t) && !SOUTH_SCRIPT_RE.test(t));
}

function extractEntities(title) {
  if (!title) return [];
  const cleaned = normalizeText(title)
    .replace(/[#|()[\]{}!?]/g, ' ')
    .replace(/\s+/g, ' ');

  const matches = cleaned.match(/\b(?:[A-Z][a-z0-9]+|[A-Z]{2,})(?:\s+(?:[A-Z][a-z0-9]+|[A-Z]{2,}|of|and|for|vs|VS))*\b/g) || [];
  return unique(matches)
    .map(v => v.replace(/\s+/g, ' ').trim().replace(/\s+(and|of|for|vs|VS)$/g, ''))
    .filter(v => v.length >= 3)
    .filter(v => v.split(/\s+/).length <= 5)
    .filter(v => !COMMON_ENTITY_PREFIXES.has(v.split(/\s+/)[0].toLowerCase()))
    .filter(v => !(/^[A-Z]{3,4}$/.test(v) && !ENTITY_ACRONYM_ALLOWLIST.has(v)))
    .slice(0, 12);
}

// Native-script titles never reach extractPhrases (it returns [] for non-Latin) and the
// ASCII filter in extractMicroTopics drops anything non-ASCII — so regional channels
// (Tamil/Telugu/Hindi/Arabic/Bengali…) ended up with EMPTY micro_topics → zero original
// bets. Extract per-segment native-script word runs so their real topics enter the DNA.
const NATIVE_TOPIC_RE = /[ऀ-ॿঀ-ൿ฀-๿؀-ۿ一-鿿぀-ヿ가-힣]/;
function extractNativeMicroTopics(title) {
  if (!title || !NATIVE_TOPIC_RE.test(title)) return [];
  const out = [];
  for (const seg of String(title).split(/[|#()\[\]{}!?.,:;@>_/\\–—-]+/)) {
    const words = seg.trim().split(/\s+/).filter(w => NATIVE_TOPIC_RE.test(w));
    if (words.length < 2 || words.length > 6) continue; // skip lone words & overlong runs
    const phrase = words.join(' ').toLowerCase();
    if (phrase.length >= 4 && phrase.length <= 60) out.push(phrase);
  }
  return out;
}

function extractMicroTopics(title /* tokens unused: see below */) {
  // Rely solely on the segment-aware extractPhrases(). The previous inline n-grams
  // were built from tokenizeTitle(wholeTitle), which crossed delimiter boundaries
  // and manufactured fragment subjects ("crash monday us100"). extractPhrases now
  // segments first, so its output is the higher-quality source.
  let phraseValues = [];
  try {
    phraseValues = extractPhrases(title)
      .map(p => normalizeText(p).toLowerCase())
      .filter(p => p.length >= 5)
      .filter(p => !/[^\x00-\x7F]/.test(p))
      .filter(p => !/\d/.test(p));
  } catch (_) {
    phraseValues = [];
  }

  // STOPWORDS/EXTRA_STOPWORDS are English-only, so native-script phrases pass the filter.
  return unique([...phraseValues, ...extractNativeMicroTopics(title)])
    .filter(p => p.split(/\s+/).every(w => !STOPWORDS.has(w) && !EXTRA_STOPWORDS.has(w)))
    .slice(0, 16);
}

function durationBucket(durationSeconds, isShort) {
  const seconds = Number(durationSeconds) || 0;
  if (isShort || (seconds > 0 && seconds <= 180)) return 'short_clip';
  if (seconds > 0 && seconds < 600) return 'mid_form';
  if (seconds >= 1800) return 'deep_doc';
  if (seconds >= 600) return 'long_form';
  return 'unknown';
}

function detectHookType(title) {
  const raw = normalizeText(title);
  if (/^\s*why\b/i.test(raw)) return 'why';
  if (/^\s*how\b/i.test(raw)) return 'how';
  if (/^\s*what\b/i.test(raw)) return 'what';
  if (/\?\s*$/.test(raw)) return 'question';
  if (/^\s*this\b|\bthis\s+(is|could|will|might|can)\b/i.test(raw)) return 'this_object';
  if (/(?:(?:\$|rs\.?|inr)\s?\d|\b\d+(?:\.\d+)?\s?(?:crore|cr|lakh|million|billion|trillion|k|m|bn|%|percent)\b)/i.test(raw)) return 'number_money';
  if (/\b(hidden|secret|dark|truth|behind|inside)\b/i.test(raw)) return 'secret';
  if (/\b(scandal|scam|exposed|investigation|using|stealing|lab rats|fake)\b/i.test(raw)) return 'investigation';
  if (/\b(future|coming|entering|not ready|collapse|crisis|war|threat|end of)\b/i.test(raw)) return 'future_threat';
  return 'statement';
}

function matchRuleIds(title, rules) {
  return rules
    .filter(rule => rule.patterns.some(pattern => pattern.test(title)))
    .map(rule => rule.id);
}

function detectHookTemplates(title) {
  const matched = HOOK_TEMPLATE_RULES
    .filter(rule => rule.pattern.test(title))
    .map(rule => rule.id);
  return matched.length ? matched : ['statement_frame'];
}

function detectNoveltyMarkers(title) {
  return NOVELTY_RULES
    .filter(rule => rule.pattern.test(title))
    .map(rule => rule.id);
}

function extractVideoDnaSignal(video) {
  const title = normalizeText(video?.title || '');
  const tokens = tokenizeTitle(title);
  const durationSeconds = Number(video?.duration_seconds) || null;
  const isShort = Number(video?.is_short || 0) === 1 || (durationSeconds != null && durationSeconds > 0 && durationSeconds <= 60);
  const hookType = detectHookType(title);
  const hookTemplates = detectHookTemplates(title);
  const domainTags = matchRuleIds(title, DOMAIN_RULES);
  const thesisPatterns = matchRuleIds(title, THESIS_RULES);
  const noveltyMarkers = detectNoveltyMarkers(title);
  const keywords = unique(tokens).slice(0, 18);
  const entities = extractEntities(title);
  const microTopics = extractMicroTopics(title, tokens);
  const bucket = durationBucket(durationSeconds, isShort);

  return {
    video_id: video?.youtube_video_id || video?.video_id || video?.id || null,
    channel_id: video?.channel_id || null,
    title,
    published_at: video?.published_at || null,
    views: Number(video?.views) || 0,
    duration_seconds: durationSeconds,
    is_short: isShort ? 1 : 0,
    format_type: video?.format_type || 'unknown',
    hook_type: hookType,
    hook_templates: hookTemplates,
    thesis_patterns: thesisPatterns,
    domain_tags: domainTags,
    keywords,
    entities,
    micro_topics: microTopics,
    novelty_markers: noveltyMarkers,
    signal: {
      duration_bucket: bucket,
      title_length: title.length,
      token_count: tokens.length,
      has_question: /\?/.test(title),
      has_money_number: /(?:(?:\$|rs\.?|inr)\s?\d|\b\d+(?:\.\d+)?\s?(?:crore|cr|lakh|million|billion|trillion|k|m|bn|%|percent)\b)/i.test(title),
      has_india_context: /\b(india|indian|indians|north india|south india|rupee|crore|lakh)\b/i.test(title),
      has_named_entity: entities.length > 0,
    },
  };
}

function median(values) {
  const nums = values.map(Number).filter(v => Number.isFinite(v) && v > 0).sort((a, b) => a - b);
  if (!nums.length) return 0;
  const mid = Math.floor(nums.length / 2);
  return nums.length % 2 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2;
}

function videoWeight(video, index, medianViews) {
  const recency = 1 / (1 + index * 0.035);
  const views = Number(video?.views) || 0;
  const viewLift = medianViews > 0 && views > 0
    ? clamp(Math.log10((views / medianViews) + 1) + 0.65, 0.75, 2.15)
    : 1;
  const seconds = Number(video?.duration_seconds) || 0;
  const depthBoost = seconds >= 600 ? 1.15 : seconds >= 300 ? 1.08 : 1;
  return round(recency * viewLift * depthBoost, 4);
}

function addCounter(counter, id, weight, example, label = id) {
  if (!id) return;
  const key = String(id).trim().toLowerCase();
  if (!key) return;
  const row = counter.get(key) || {
    id: key,
    label: String(label || id).trim(),
    count: 0,
    score: 0,
    examples: [],
  };
  row.count += 1;
  row.score += weight;
  if (example && row.examples.length < 3 && !row.examples.includes(example)) {
    row.examples.push(example);
  }
  counter.set(key, row);
}

function topCounter(counter, limit) {
  return [...counter.values()]
    .sort((a, b) => (b.score - a.score) || (b.count - a.count) || a.label.localeCompare(b.label))
    .slice(0, limit)
    .map(row => ({
      id: row.id,
      label: row.label,
      count: row.count,
      score: round(row.score, 3),
      examples: row.examples,
    }));
}

function aggregateSignals(weightedSignals) {
  const vocabulary = new Map();
  const entities = new Map();
  const microTopics = new Map();
  const hookTemplates = new Map();
  const hookTypes = new Map();
  const thesisPatterns = new Map();
  const domainTags = new Map();
  const noveltyMarkers = new Map();

  let domainCovered = 0;
  let thesisCovered = 0;
  let hookCovered = 0;
  let microCovered = 0;

  for (const item of weightedSignals) {
    const { signal, weight } = item;
    const example = signal.title;

    if (signal.domain_tags.length) domainCovered++;
    if (signal.thesis_patterns.length) thesisCovered++;
    if (signal.hook_type && signal.hook_type !== 'statement') hookCovered++;
    if (signal.micro_topics.length) microCovered++;

    for (const keyword of signal.keywords) addCounter(vocabulary, keyword, weight, example);
    for (const entity of signal.entities) addCounter(entities, entity, weight, example, entity);
    for (const topic of signal.micro_topics) addCounter(microTopics, topic, weight, example, topic);
    for (const hook of signal.hook_templates) addCounter(hookTemplates, hook, weight, example);
    addCounter(hookTypes, signal.hook_type, weight, example);
    for (const thesis of signal.thesis_patterns) addCounter(thesisPatterns, thesis, weight, example);
    for (const domain of signal.domain_tags) addCounter(domainTags, domain, weight, example);
    for (const marker of signal.novelty_markers) addCounter(noveltyMarkers, marker, weight, example);
  }

  const n = weightedSignals.length || 1;
  return {
    vocabulary: topCounter(vocabulary, 60),
    entities: topCounter(entities, 40),
    micro_topics: topCounter(microTopics, 60),
    hook_templates: topCounter(hookTemplates, 30),
    hook_types: topCounter(hookTypes, 20),
    thesis_patterns: topCounter(thesisPatterns, 35),
    domain_tags: topCounter(domainTags, 35),
    novelty_markers: topCounter(noveltyMarkers, 25),
    coverage: {
      domain: round(domainCovered / n, 3),
      thesis: round(thesisCovered / n, 3),
      hook: round(hookCovered / n, 3),
      micro_topic: round(microCovered / n, 3),
    },
  };
}

function countBy(values) {
  const counts = new Map();
  for (const value of values) {
    const key = value || 'unknown';
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([id, count]) => ({ id, count }));
}

function buildFormatMix(videos, signals) {
  const buckets = signals.map(s => s.signal.duration_bucket);
  const formatTypes = videos.map(v => v.format_type || 'unknown');
  const sample = videos.length || 1;
  const longCount = videos.filter(v => {
    const seconds = Number(v.duration_seconds) || 0;
    return Number(v.is_short || 0) !== 1 && seconds >= 300;
  }).length;
  const shortCount = videos.filter(v => {
    const seconds = Number(v.duration_seconds) || 0;
    return Number(v.is_short || 0) === 1 || (seconds > 0 && seconds <= 180);
  }).length;

  return {
    duration_buckets: countBy(buckets),
    format_types: countBy(formatTypes),
    long_form_share: round(longCount / sample, 3),
    short_clip_share: round(shortCount / sample, 3),
    long_count: longCount,
    short_count: shortCount,
  };
}

function topIds(rows, limit) {
  return (rows || []).slice(0, limit).map(r => r.id);
}

function jaccardDistance(a, b) {
  const setA = new Set(a);
  const setB = new Set(b);
  const union = new Set([...setA, ...setB]);
  if (!union.size) return 0;
  let overlap = 0;
  for (const value of setA) {
    if (setB.has(value)) overlap++;
  }
  return 1 - (overlap / union.size);
}

function computeDrift(recentAgg, olderAgg, sampleCount) {
  if (sampleCount < 25 || !olderAgg) {
    return { score: 0, status: 'stable' };
  }

  const domainDistance = jaccardDistance(topIds(recentAgg.domain_tags, 8), topIds(olderAgg.domain_tags, 8));
  const thesisDistance = jaccardDistance(topIds(recentAgg.thesis_patterns, 8), topIds(olderAgg.thesis_patterns, 8));
  const hookDistance = jaccardDistance(topIds(recentAgg.hook_templates, 6), topIds(olderAgg.hook_templates, 6));
  const noveltyDistance = jaccardDistance(topIds(recentAgg.novelty_markers, 6), topIds(olderAgg.novelty_markers, 6));
  const microDistance = jaccardDistance(topIds(recentAgg.micro_topics, 6), topIds(olderAgg.micro_topics, 6));
  const score = round(
    (domainDistance * 0.3) +
    (thesisDistance * 0.35) +
    (hookDistance * 0.2) +
    (noveltyDistance * 0.1) +
    (microDistance * 0.05),
    3,
  );
  let status = 'stable';
  if (score >= 0.78 && sampleCount >= 30) status = 'transitioning';
  else if (score >= 0.62) status = 'testing_new_lane';
  return { score, status };
}

function computeConfidence(sampleCount, stableAgg, channel) {
  const sampleScore = sampleCount >= 30 ? 0.35
    : sampleCount >= 15 ? 0.25
      : sampleCount >= 5 ? 0.12
        : 0.02;

  const coverageAvg = (
    stableAgg.coverage.domain +
    stableAgg.coverage.thesis +
    stableAgg.coverage.hook +
    stableAgg.coverage.micro_topic
  ) / 4;

  const coverageScore = coverageAvg * 0.42;
  const diversityScore = Math.min(0.12, (
    stableAgg.domain_tags.length +
    stableAgg.thesis_patterns.length +
    stableAgg.micro_topics.length
  ) / 120);
  const cspScore = channel?.primary_csp ? 0.08 : 0;
  const score = round(clamp(sampleScore + coverageScore + diversityScore + cspScore, 0, 1), 3);
  const label = score >= 0.72 ? 'high' : score >= 0.48 ? 'medium' : 'low';
  return { label, score };
}

function inferNegativeDna(channel, stableAgg) {
  const csp = String(channel?.primary_csp || '').toLowerCase();
  const primaryDomains = new Set(topIds(stableAgg.domain_tags, 8));
  const thesis = new Set(topIds(stableAgg.thesis_patterns, 8));
  const isExplainerLike = csp.includes('curiosity') ||
    csp.includes('case_study') ||
    thesis.has('hidden_economics') ||
    thesis.has('broken_system') ||
    thesis.has('investigation');

  const mismatchFamilies = [];
  for (const family of MISMATCH_FAMILIES) {
    const allowed = family.avoidUnlessCsp.some(allowedCsp => csp.includes(allowedCsp));
    if (allowed) continue;

    if (family.id === 'guest_podcast_episode' && !isExplainerLike) continue;
    if (family.id === 'phone_review' && primaryDomains.has('tech_ai') && csp.includes('tech_review')) continue;
    if (family.id === 'trading_tip' && csp.includes('finance_investment_education')) continue;

    const reason = isExplainerLike
      ? 'Creator DNA favors essay/explainer framing over this recommendation family.'
      : 'This family is not supported by the creator profile signals.';
    mismatchFamilies.push({
      id: family.id,
      reason,
      match_terms: family.matchTerms,
    });
  }

  return {
    mismatch_families: mismatchFamilies,
    avoid_generic_sources: ['generic_trending_topic', 'unclean_peer_pool', 'category_only_fallback'],
    require_matching_signals: [
      'domain_tags',
      'thesis_patterns',
      'hook_templates',
      'micro_topics',
    ],
  };
}

function creatorConstraints(channel, formatMix) {
  return {
    language: channel?.primary_language || channel?.content_language || channel?.language || 'unknown',
    region: channel?.region || channel?.audience_geo || channel?.country || 'unknown',
    niche: channel?.primary_niche || channel?.niche || 'unknown',
    csp: channel?.primary_csp || null,
    creator_mode: channel?.creator_mode || null,
    content_archetype: channel?.content_archetype || null,
    format_type: channel?.format_type || null,
    dominant_duration_bucket: formatMix.duration_buckets[0]?.id || 'unknown',
    long_form_share: formatMix.long_form_share,
    short_clip_share: formatMix.short_clip_share,
  };
}

function buildCreatorIdeaDnaFromVideos(channel, inputVideos, options = {}) {
  const limit = Number(options.limit || DEFAULT_VIDEO_LIMIT);
  const videos = [...(inputVideos || [])]
    .filter(v => v && v.title)
    .sort((a, b) => String(b.published_at || '').localeCompare(String(a.published_at || '')))
    .slice(0, limit);

  const medianViews = median(videos.map(v => v.views));
  const signals = videos.map(extractVideoDnaSignal);
  const weightedSignals = signals.map((signal, index) => ({
    signal,
    video: videos[index],
    weight: videoWeight(videos[index], index, medianViews),
  }));

  const stableAgg = aggregateSignals(weightedSignals);
  const recentAgg = aggregateSignals(weightedSignals.slice(0, RECENT_WINDOW));
  const olderAgg = weightedSignals.length > RECENT_WINDOW
    ? aggregateSignals(weightedSignals.slice(RECENT_WINDOW))
    : null;
  const formatMix = buildFormatMix(videos, signals);
  const drift = computeDrift(recentAgg, olderAgg, videos.length);
  const confidence = computeConfidence(videos.length, stableAgg, channel || {});
  const negativeDna = inferNegativeDna(channel || {}, stableAgg);
  const constraints = creatorConstraints(channel || {}, formatMix);

  const stableDna = {
    version: CREATOR_IDEA_DNA_VERSION,
    source: 'latest_stored_uploads',
    sample_count: videos.length,
    sample_window: {
      latest_published_at: videos[0]?.published_at || null,
      oldest_published_at: videos[videos.length - 1]?.published_at || null,
    },
    creator_constraints: constraints,
    signature: {
      domain_tags: topIds(stableAgg.domain_tags, 8),
      thesis_patterns: topIds(stableAgg.thesis_patterns, 8),
      hook_types: topIds(stableAgg.hook_types, 6),
      hook_templates: topIds(stableAgg.hook_templates, 8),
      novelty_markers: topIds(stableAgg.novelty_markers, 8),
      micro_topics: stableAgg.micro_topics.slice(0, 12).map(r => r.label),
      entities: stableAgg.entities.slice(0, 10).map(r => r.label),
    },
    coverage: stableAgg.coverage,
  };

  const recentDirection = {
    window: RECENT_WINDOW,
    sample_count: Math.min(videos.length, RECENT_WINDOW),
    domain_tags: recentAgg.domain_tags.slice(0, 10),
    thesis_patterns: recentAgg.thesis_patterns.slice(0, 10),
    hook_templates: recentAgg.hook_templates.slice(0, 10),
    micro_topics: recentAgg.micro_topics.slice(0, 15),
    drift,
  };

  return {
    channel_id: channel?.channel_id || videos[0]?.channel_id || null,
    sample_count: videos.length,
    long_count: formatMix.long_count,
    short_count: formatMix.short_count,
    stable_dna: stableDna,
    recent_direction: recentDirection,
    format_mix: formatMix,
    vocabulary: stableAgg.vocabulary,
    entities: stableAgg.entities,
    micro_topics: stableAgg.micro_topics,
    hook_templates: stableAgg.hook_templates,
    thesis_patterns: stableAgg.thesis_patterns,
    domain_tags: stableAgg.domain_tags,
    negative_dna: negativeDna,
    drift_score: drift.score,
    drift_status: drift.status,
    confidence: confidence.label,
    confidence_score: confidence.score,
    source_version: CREATOR_IDEA_DNA_VERSION,
    last_video_published_at: videos[0]?.published_at || null,
    signals,
  };
}

function fetchChannel(db, channelId) {
  return db.get(
    `SELECT ic.*, ccsp.primary_csp, ccsp.confidence AS csp_confidence,
            ccsp.confidence_score AS csp_confidence_score
       FROM ingested_channels ic
       LEFT JOIN channel_content_strategy_profiles ccsp ON ccsp.channel_id = ic.channel_id
      WHERE ic.channel_id = ?`,
    [channelId],
  );
}

function fetchChannelVideos(db, channelId, limit = DEFAULT_VIDEO_LIMIT) {
  return db.all(
    `SELECT youtube_video_id, channel_id, title, published_at, views,
            duration_seconds, is_short, format_type
       FROM ingested_videos
      WHERE channel_id = ?
        AND title IS NOT NULL
        AND title != ''
      ORDER BY datetime(published_at) DESC
      LIMIT ?`,
    [channelId, limit],
  );
}

function persistVideoSignal(db, signal) {
  db.run(
    `INSERT INTO video_dna_signals (
       video_id, channel_id, title, published_at, views, duration_seconds,
       is_short, format_type, hook_type, hook_templates_json,
       thesis_patterns_json, domain_tags_json, keywords_json, entities_json,
       micro_topics_json, novelty_markers_json, signal_json, extracted_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(video_id) DO UPDATE SET
       channel_id = excluded.channel_id,
       title = excluded.title,
       published_at = excluded.published_at,
       views = excluded.views,
       duration_seconds = excluded.duration_seconds,
       is_short = excluded.is_short,
       format_type = excluded.format_type,
       hook_type = excluded.hook_type,
       hook_templates_json = excluded.hook_templates_json,
       thesis_patterns_json = excluded.thesis_patterns_json,
       domain_tags_json = excluded.domain_tags_json,
       keywords_json = excluded.keywords_json,
       entities_json = excluded.entities_json,
       micro_topics_json = excluded.micro_topics_json,
       novelty_markers_json = excluded.novelty_markers_json,
       signal_json = excluded.signal_json,
       extracted_at = datetime('now')`,
    [
      signal.video_id,
      signal.channel_id,
      signal.title,
      signal.published_at,
      signal.views,
      signal.duration_seconds,
      signal.is_short,
      signal.format_type,
      signal.hook_type,
      JSON.stringify(signal.hook_templates),
      JSON.stringify(signal.thesis_patterns),
      JSON.stringify(signal.domain_tags),
      JSON.stringify(signal.keywords),
      JSON.stringify(signal.entities),
      JSON.stringify(signal.micro_topics),
      JSON.stringify(signal.novelty_markers),
      JSON.stringify(signal.signal),
    ],
  );
}

function persistCreatorDnaRow(db, dna) {
  db.run(
    `INSERT INTO creator_idea_dna (
       channel_id, sample_count, long_count, short_count, stable_dna_json,
       recent_direction_json, format_mix_json, vocabulary_json, entities_json,
       micro_topics_json, hook_templates_json, thesis_patterns_json,
       domain_tags_json, negative_dna_json, drift_score, drift_status,
       confidence, confidence_score, source_version, last_video_published_at,
       updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(channel_id) DO UPDATE SET
       sample_count = excluded.sample_count,
       long_count = excluded.long_count,
       short_count = excluded.short_count,
       stable_dna_json = excluded.stable_dna_json,
       recent_direction_json = excluded.recent_direction_json,
       format_mix_json = excluded.format_mix_json,
       vocabulary_json = excluded.vocabulary_json,
       entities_json = excluded.entities_json,
       micro_topics_json = excluded.micro_topics_json,
       hook_templates_json = excluded.hook_templates_json,
       thesis_patterns_json = excluded.thesis_patterns_json,
       domain_tags_json = excluded.domain_tags_json,
       negative_dna_json = excluded.negative_dna_json,
       drift_score = excluded.drift_score,
       drift_status = excluded.drift_status,
       confidence = excluded.confidence,
       confidence_score = excluded.confidence_score,
       source_version = excluded.source_version,
       last_video_published_at = excluded.last_video_published_at,
       updated_at = datetime('now')`,
    [
      dna.channel_id,
      dna.sample_count,
      dna.long_count,
      dna.short_count,
      JSON.stringify(dna.stable_dna),
      JSON.stringify(dna.recent_direction),
      JSON.stringify(dna.format_mix),
      JSON.stringify(dna.vocabulary),
      JSON.stringify(dna.entities),
      JSON.stringify(dna.micro_topics),
      JSON.stringify(dna.hook_templates),
      JSON.stringify(dna.thesis_patterns),
      JSON.stringify(dna.domain_tags),
      JSON.stringify(dna.negative_dna),
      dna.drift_score,
      dna.drift_status,
      dna.confidence,
      dna.confidence_score,
      dna.source_version,
      dna.last_video_published_at,
    ],
  );
}

function buildCreatorDnaSourceHash(dna) {
  const payload = {
    source_version: dna.source_version,
    sample_count: dna.sample_count,
    long_count: dna.long_count,
    short_count: dna.short_count,
    stable_dna: dna.stable_dna,
    recent_direction: dna.recent_direction,
    format_mix: dna.format_mix,
    vocabulary: dna.vocabulary,
    entities: dna.entities,
    micro_topics: dna.micro_topics,
    hook_templates: dna.hook_templates,
    thesis_patterns: dna.thesis_patterns,
    domain_tags: dna.domain_tags,
    negative_dna: dna.negative_dna,
    drift_score: dna.drift_score,
    drift_status: dna.drift_status,
    confidence: dna.confidence,
    confidence_score: dna.confidence_score,
    last_video_published_at: dna.last_video_published_at,
  };
  return crypto.createHash('sha1').update(JSON.stringify(payload)).digest('hex');
}

function readLatestCreatorDnaSnapshot(db, channelId) {
  return db.get(
    `SELECT id, source_hash, created_at, drift_score, drift_status, confidence, confidence_score
       FROM creator_idea_dna_snapshots
      WHERE channel_id = ?
      ORDER BY datetime(created_at) DESC, id DESC
      LIMIT 1`,
    [channelId],
  ) || null;
}

function persistCreatorDnaSnapshot(db, dna, options = {}) {
  const sourceHash = buildCreatorDnaSourceHash(dna);
  const latest = readLatestCreatorDnaSnapshot(db, dna.channel_id);
  if (!options.force && latest?.source_hash === sourceHash) {
    return {
      created: false,
      id: latest.id,
      source_hash: sourceHash,
      reason: 'unchanged',
    };
  }

  const info = db.run(
    `INSERT INTO creator_idea_dna_snapshots (
       channel_id, source_version, sample_count, long_count, short_count,
       stable_dna_json, recent_direction_json, format_mix_json,
       vocabulary_json, entities_json, micro_topics_json, hook_templates_json,
       thesis_patterns_json, domain_tags_json, negative_dna_json,
       drift_score, drift_status, confidence, confidence_score,
       last_video_published_at, snapshot_reason, source_hash, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
    [
      dna.channel_id,
      dna.source_version,
      dna.sample_count,
      dna.long_count,
      dna.short_count,
      JSON.stringify(dna.stable_dna),
      JSON.stringify(dna.recent_direction),
      JSON.stringify(dna.format_mix),
      JSON.stringify(dna.vocabulary),
      JSON.stringify(dna.entities),
      JSON.stringify(dna.micro_topics),
      JSON.stringify(dna.hook_templates),
      JSON.stringify(dna.thesis_patterns),
      JSON.stringify(dna.domain_tags),
      JSON.stringify(dna.negative_dna),
      dna.drift_score,
      dna.drift_status,
      dna.confidence,
      dna.confidence_score,
      dna.last_video_published_at,
      options.reason || 'refresh',
      sourceHash,
    ],
  );

  return {
    created: true,
    id: info.lastInsertRowid,
    source_hash: sourceHash,
    reason: options.reason || 'refresh',
  };
}

function persistCreatorIdeaDna(db, channelId, options = {}) {
  const channel = fetchChannel(db, channelId);
  if (!channel) {
    return { ok: false, reason: 'channel_not_found', channel_id: channelId };
  }

  const limit = Number(options.limit || DEFAULT_VIDEO_LIMIT);
  const videos = fetchChannelVideos(db, channelId, limit);
  if (!videos.length) {
    return { ok: false, reason: 'no_stored_videos', channel };
  }

  const dna = buildCreatorIdeaDnaFromVideos(channel, videos, { limit });
  const validSignals = dna.signals.filter(signal => signal.video_id && signal.channel_id);
  let snapshot = null;
  const tx = db.transaction((signals, row, snapshotOptions) => {
    for (const signal of signals) persistVideoSignal(db, signal);
    persistCreatorDnaRow(db, row);
    snapshot = persistCreatorDnaSnapshot(db, row, snapshotOptions);
  });
  tx(validSignals, dna, {
    reason: options.snapshotReason || 'refresh',
    force: !!options.forceSnapshot,
  });

  return { ok: true, channel, dna, signals: validSignals, snapshot };
}

function readCreatorIdeaDna(db, channelId) {
  const row = db.get(`SELECT * FROM creator_idea_dna WHERE channel_id = ?`, [channelId]);
  if (!row) return null;
  return {
    ...row,
    stable_dna: safeJsonParse(row.stable_dna_json, null),
    recent_direction: safeJsonParse(row.recent_direction_json, null),
    format_mix: safeJsonParse(row.format_mix_json, null),
    vocabulary: safeJsonParse(row.vocabulary_json, []),
    entities: safeJsonParse(row.entities_json, []),
    micro_topics: safeJsonParse(row.micro_topics_json, []),
    hook_templates: safeJsonParse(row.hook_templates_json, []),
    thesis_patterns: safeJsonParse(row.thesis_patterns_json, []),
    domain_tags: safeJsonParse(row.domain_tags_json, []),
    negative_dna: safeJsonParse(row.negative_dna_json, null),
  };
}

module.exports = {
  CREATOR_IDEA_DNA_VERSION,
  DEFAULT_VIDEO_LIMIT,
  extractVideoDnaSignal,
  buildCreatorIdeaDnaFromVideos,
  buildCreatorDnaSourceHash,
  persistCreatorIdeaDna,
  persistCreatorDnaSnapshot,
  readLatestCreatorDnaSnapshot,
  readCreatorIdeaDna,
  fetchChannelVideos,
};

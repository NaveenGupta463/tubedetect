'use strict';

// Domain inference patterns — IDs aligned with DOMAIN_RULES in creatorIdeaDna.js
// so that domain_tags from the DNA can be compared directly.
const DOMAIN_PATTERNS = [
  { id: 'money_economics',     re: /\b(money|business|economy|economic|finance|financial|stock|stocks|market|markets|tax|taxes|price|prices|inflation|salary|salaries|income|wealth|bank|banking|startup|startups|profit|profits|revenue|investor|investment|investing|vc|funding|debt|loan|loans|rupee|dollar|crore|lakh|emi|consumer|consumers|luxury)\b/i },
  { id: 'tech_ai',             re: /\b(tech|technology|ai|artificial intelligence|app|apps|software|internet|platform|platforms|algorithm|algorithms|data|privacy|phone|smartphone|iphone|android|google|apple|meta|microsoft|openai|chatgpt|automation|digital|gadget|gadgets|laptop|computer|coding|programming|saas|specs|unboxing|review)\b/i },
  { id: 'health_body',         re: /\b(health|fitness|protein|nutrition|body|brain|sleep|balding|hair|cure|medicine|medical|disease|addiction|gym|supplement|supplements|mental health|wellness|yoga|diet|workout|exercise|weight loss)\b/i },
  { id: 'food_consumer',       re: /\b(food|foods|snack|snacks|sugar|restaurant|restaurants|zomato|swiggy|delivery|recipe|biryani|cooking|chef|dish|meal|cuisine|kitchen|ingredient|dessert|breakfast|lunch|dinner|vegetarian|vegan|masala|paneer|street food|baking|fried|grilled|taste)\b/i },
  { id: 'politics_policy',     re: /\b(government|policy|policies|politics|political|election|elections|war|iran|trump|china|pakistan|russia|america|usa|court|law|laws|ban|banned|regulation|state|states|north india|south india|modi|congress|bjp|parliament|minister|president|pm|vote|geopolitics|diplomatic|budget)\b/i },
  { id: 'urban_infra',         re: /\b(city|cities|urban|roads|traffic|metro|train|housing|rent|heat|climate|air conditioner|electricity|water|pollution|design|infrastructure|real estate)\b/i },
  { id: 'work_career',         re: /\b(job|jobs|career|careers|work|working|office|salary|salaries|employee|employees|founder|founders|startup|startups|hiring|layoff|layoffs|skill|skills|resume|interview)\b/i },
  { id: 'education_exam',      re: /\b(exam|exams|neet|jee|upsc|student|students|study|studying|college|school|education|course|courses|teacher|teachers|marks|rank|syllabus|physics|chemistry|math|mathematics|biology|science|learn|learning|lecture|class|academic|cbse|ncert)\b/i },
  { id: 'culture_society',     re: /\b(culture|society|social|family|families|marriage|dating|gender|religion|class|middle class|rich|poor|generation|gen z|millennial|status|luxury|normal life)\b/i },
  { id: 'science_environment', re: /\b(science|scientists|research|climate|environment|energy|solar|space|earth|biology|physics|cure|medicine|disease|pollution)\b/i },
  { id: 'brand_business',      re: /\b(brand|brands|company|companies|business|startup|startups|zomato|swiggy|ola|jio|reliance|tata|adani|apple|google|amazon|netflix|subscription|subscriptions|customer|customers|market)\b/i },
  { id: 'media_internet',      re: /\b(youtube|creator|creators|influencer|influencers|media|news|internet|viral|meme|memes|algorithm|platform|platforms|subscription)\b/i },
  { id: 'lifestyle_status',    re: /\b(lifestyle|luxury|status|middle class|normal life|travel|fashion|home|house|rent|car|cars|wedding|shopping|mall|malls)\b/i },
  { id: 'entertainment',       re: /\b(movie|movies|film|films|fdfs|bollywood|hollywood|celebrity|celebrities|actor|actress|show|shows|web series|ott|netflix|trailer|box office|vlog|comedy|prank|challenge|late night|talk show|game show|music|song|songs|album|concert|dance|standup|comedy special|sketch)\b/i },
  { id: 'sports_cricket',      re: /\b(cricket|ipl|football|soccer|match|matches|player|players|team|teams|sport|sports|tournament|world cup|league|basketball|tennis|athlete|champion|stadium|goal|goals)\b/i },
  { id: 'gaming',              re: /\b(game|gaming|playstation|xbox|pc gaming|esports|minecraft|pubg|freefire|gta|valorant|streamer|twitch|stream)\b/i },
  { id: 'self_improvement',    re: /\b(motivation|success|mindset|habits|productivity|self help|personal development|growth|discipline|goals|morning routine|journaling|self improvement)\b/i },
  { id: 'travel',              re: /\b(travel|trip|trips|destination|destinations|hotel|hotels|tour|tours|explore|adventure|road trip|tourism|vlog)\b/i },
  { id: 'news_current',        re: /\b(news|breaking|latest|update|updates|crimewatch|crime|murder|arrest|police|investigation|scandal|controversy|report|reports|coverage|bulletin)\b/i },
];

// Which format a topic implies
const FORMAT_SIGNALS = [
  { id: 'recipe_howto',    re: /\b(recipe|how to|tutorial|guide|tips|tricks|diy|step by step|steps)\b/i },
  { id: 'documentary',     re: /\b(investigation|crimewatch|mystery|expose|documentary|truth|story|behind the scenes|scandal)\b/i },
  { id: 'vlog',            re: /\b(vlog|day in|behind the scenes|trip|journey|fdfs|first day first show)\b/i },
  { id: 'educational',     re: /\b(explained|learn|study|exam|class|lecture|understanding|theory|concept|basics)\b/i },
  { id: 'interview',       re: /\b(\bwith\b|guest|ft\b|talk|conversation|interview|podcast|episode)\b/i },
  { id: 'comedy',          re: /\b(comedy|funny|prank|roast|skit|challenge|reaction|standup)\b/i },
  { id: 'debate_analysis', re: /\b(debate|vs\b|versus|comparison|explained|analysis|why|should we|is it|breakdown)\b/i },
  { id: 'review',          re: /\b(review|unboxing|hands on|first look|test|tested|rating)\b/i },
  { id: 'news_bulletin',   re: /\b(breaking|latest news|live|today news|press conference|update|bulletin)\b/i },
];

// Format profiles → which topic formats are a natural fit
const PROFILE_FORMAT_COMPAT = {
  podcast:         ['interview', 'debate_analysis', 'educational'],
  guest_interview: ['interview', 'debate_analysis'],
  educational:     ['educational', 'debate_analysis', 'documentary'],
  how_to:          ['recipe_howto', 'educational'],
  vlog:            ['vlog', 'comedy'],
  entertainment:   ['comedy', 'vlog', 'interview'],
  essay:           ['documentary', 'debate_analysis', 'educational'],
  news:            ['news_bulletin', 'documentary', 'debate_analysis'],
  talk_show:       ['interview', 'comedy', 'debate_analysis'],
  late_night:      ['interview', 'comedy'],
  review:          ['review', 'debate_analysis'],
};

function inferTopicDomains(topic) {
  const lower = String(topic || '').toLowerCase();
  const matched = [];
  for (const { id, re } of DOMAIN_PATTERNS) {
    if (re.test(lower)) matched.push(id);
  }
  return matched;
}

function inferTopicFormat(topic) {
  const lower = String(topic || '').toLowerCase();
  for (const { id, re } of FORMAT_SIGNALS) {
    if (re.test(lower)) return id;
  }
  return 'general';
}

/**
 * Computes how well a recommended topic fits the specific creator.
 *
 * Returns:
 *   fit_score   — 0-100 integer
 *   fit_weight  — 0.2–1.0 multiplier for final_score = opportunity_score * fit_weight
 *   fit_breakdown — per-factor raw points for debugging
 */
function computeCreatorFitScore(topic, idea, {
  dna = null,
  formatProfile = null,
  acceptedTerritories = [],
  language = 'en',
} = {}) {
  const breakdown = {
    domain_match:    0,   // 0-40
    vocab_overlap:   0,   // 0-30
    format_match:    0,   // 0-15
    territory_match: 0,   // 0-10
    language_fit:    0,   // 0-5
  };

  const topicLower = String(topic || '').toLowerCase();

  // ── 1. Domain / category overlap (0-40) ───────────────────────────────────
  // Compare topic's inferred domains against creator's DNA domain_tags.
  // Full match = 40; partial match = 20; unmatchable topic or no DNA = 20 (neutral).
  const topicDomains = inferTopicDomains(topicLower);
  const creatorDomainIds = new Set((dna?.domain_tags || []).map(d => d.id || String(d)));

  if (topicDomains.length === 0 || creatorDomainIds.size === 0) {
    breakdown.domain_match = 20; // can't judge — neutral
  } else {
    const overlap = topicDomains.filter(d => creatorDomainIds.has(d)).length;
    if (overlap === 0) {
      breakdown.domain_match = 0; // hard domain miss
    } else {
      const coverageRatio = overlap / topicDomains.length;
      breakdown.domain_match = Math.round(20 + 20 * Math.min(1, coverageRatio));
    }
  }

  // ── 2. Vocabulary / entity overlap with creator DNA (0-30) ────────────────
  // Check if topic tokens appear in the creator's proven vocabulary or entity list.
  if (dna) {
    const dnaTokens = new Set();

    for (const row of (dna.vocabulary || []).slice(0, 60)) {
      const w = String(row?.id || row?.label || row || '').toLowerCase().trim();
      if (w.length >= 4) dnaTokens.add(w);
    }
    for (const row of (dna.entities || []).slice(0, 40)) {
      const label = String(row?.label || row?.id || '').toLowerCase().trim();
      if (label.length >= 3) {
        dnaTokens.add(label);
        label.split(/\s+/).forEach(w => { if (w.length >= 4) dnaTokens.add(w); });
      }
    }
    for (const row of (dna.micro_topics || []).slice(0, 60)) {
      const label = String(row?.label || row?.id || '').toLowerCase().trim();
      if (label.length >= 4) {
        dnaTokens.add(label);
        label.split(/\s+/).forEach(w => { if (w.length >= 4) dnaTokens.add(w); });
      }
    }

    const topicTokens = topicLower.split(/[\s\-]+/).filter(w => w.length >= 4);
    let direct = 0;
    let partial = 0;
    for (const token of topicTokens) {
      if (dnaTokens.has(token)) {
        direct++;
      } else {
        for (const dt of dnaTokens) {
          if (dt.includes(token) || token.includes(dt)) { partial++; break; }
        }
      }
    }
    breakdown.vocab_overlap = Math.min(30, direct * 15 + partial * 5);
  }

  // ── 3. Format fit (0-15) ──────────────────────────────────────────────────
  // Does the topic's implied format match the creator's format profile?
  const topicFormat = inferTopicFormat(topicLower);
  if (!formatProfile || topicFormat === 'general') {
    breakdown.format_match = 8; // unknown = neutral
  } else {
    const compatFormats = PROFILE_FORMAT_COMPAT[formatProfile] || [];
    if (compatFormats.length === 0) {
      breakdown.format_match = 8;
    } else if (compatFormats.includes(topicFormat)) {
      breakdown.format_match = 15;
    } else {
      breakdown.format_match = 3; // format mismatch — small penalty
    }
  }

  // ── 4. Territory fit (0-10) ───────────────────────────────────────────────
  // If the idea came from a known territory, check against creator's accepted territories.
  const ideaTerritory = idea?.territory_id;
  const creatorTerritoryIds = new Set((acceptedTerritories || []).map(t => t.territory_id));

  if (!ideaTerritory || creatorTerritoryIds.size === 0) {
    breakdown.territory_match = 5; // no info — neutral
  } else {
    breakdown.territory_match = creatorTerritoryIds.has(ideaTerritory) ? 10 : 2;
  }

  // ── 5. Language / script fit (0-5) ────────────────────────────────────────
  // Non-Latin script topics are penalized for English-language creators.
  const hasNonLatin = /[^\x00-\xFF]/.test(topic);
  breakdown.language_fit = (hasNonLatin && (language || 'en') === 'en') ? 0 : 5;

  const fit_score = Math.min(100, Math.max(0,
    breakdown.domain_match +
    breakdown.vocab_overlap +
    breakdown.format_match +
    breakdown.territory_match +
    breakdown.language_fit,
  ));

  // Smooth linear weight: 0.2 floor → 1.0 ceiling
  // A perfectly fitting topic is unpenalized; a completely alien topic loses 80% of its score.
  const fit_weight = parseFloat((0.2 + 0.8 * (fit_score / 100)).toFixed(4));

  return { fit_score, fit_weight, fit_breakdown: breakdown };
}

module.exports = { computeCreatorFitScore, inferTopicDomains, inferTopicFormat };

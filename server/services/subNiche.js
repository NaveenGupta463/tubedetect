'use strict';

// Sub-niche resolution for COARSE parent niches whose single label bundles unrelated creator
// communities. "education" (5,600+ channels) is the worst offender — it lumps kids/toddler,
// exam-prep (UPSC/SSC), language, science, math and coding into one bucket, so a niche-based peer
// pool mixes Numberblocks with Numberphile, CGP Grey and Professor Dave. Splitting the pool by
// sub-niche lifted peer relevance from ~27-33% to ~100% in prototyping (kids, language, exam).
//
// classifySubNiche scores a channel's inferred_topics (+ name) against each sub-niche's keyword
// regex and returns the strongest match, or null when the parent niche has no split or no keyword
// fires confidently (treated as "general" — left unfiltered, ordered by semantic rerank instead).

// Order matters: more specific/distinctive sub-niches are listed BEFORE broad catch-alls (e.g.
// music "official_song" is last, so a "devotional song" / "cover song" channel resolves to
// devotional/cover, not the generic song bucket — ties go to the first-listed on equal score).
const SUB_NICHE_RULES = {
  education: {
    kids:      /\bkid|child|toddler|nursery|rhyme|preschool|kindergarten|\btoy|cartoon|colou?rs? for|\babc\b|alphabet|fairy tale|bedtime/gi,
    exam_prep: /upsc|\bias\b|\bssc\b|neet|\bjee\b|\bgate\b|aspirant|civil service|prelims|\bmains\b|\bcgl\b|\brrb\b|\bpcs\b|ibps|bank po|competitive exam|current affairs|editorial/gi,
    language:  /english|grammar|vocabulary|spoken|ielts|pronunciation|language learning|\bspeak\b|fluen|toefl/gi,
    science:   /science|physics|chemistry|biology|experiment|astronomy|geology|scientific/gi,
    math:      /\bmaths?\b|algebra|calculus|geometry|arithmetic|trigonometr|numeracy/gi,
    coding:    /coding|programming|software|developer|\bpython\b|javascript|web development|data structure|machine learning/gi,
  },
  entertainment: {
    comedy:          /comed|sketch|\bskit|parody|stand[- ]?up|\bfunny\b|prank|roast|satire/gi,
    film_tv:         /\bmovie|\bfilm\b|cinema|trailer|teaser|web ?series|bollywood|hollywood|\brecap|film review|tv show|episode review|\bscene/gi,
    reaction:        /reaction|reacts?\b/gi,
    vlog:            /\bvlog|daily life|day in (my|the) life|behind the scenes|life update/gi,
    challenge_stunt: /challenge|\bstunt|survive|\b24 ?hours?\b|\bdare\b|last to leave/gi,
    kids_family:     /\bkids?\b|children|toddler|\btoy|nursery|family friendly|cartoon for/gi,
    horror_story:    /horror|scary|\bghost|creepy|storytime|story time|paranormal|thriller|\bhaunt/gi,
    animation:       /animation|animated|\banime\b|motion comic/gi,
    celebrity:       /celebrit|gossip|\bdrama\b|paparazzi/gi,
  },
  music: {
    devotional:  /devotional|bhajan|kirtan|mantra|aarti|\bgospel\b|spiritual|worship|\bhymn|qawwali|\bnaat\b|shloka|chant/gi,
    classical:   /classical|\braga\b|carnatic|hindustani|instrumental|orchestra|symphony|\bflute\b|sitar|tabla/gi,
    cover:       /\bcover\b|unplugged|acoustic|rendition|reprise/gi,
    remix_dj:    /remix|\bdj\b|\bedm\b|mashup|electronic dance|dubstep|house music/gi,
    rap_hiphop:  /\brap\b|hip[- ]?hop|rapper|\bdrill\b|trap music/gi,
    dance:       /\bdance|choreograph/gi,
    lyrics:      /lyric/gi,
    tutorial:    /guitar lesson|piano (tutorial|lesson)|how to play|music theory|singing lesson|vocal training/gi,
    official_song: /\bsong\b|official (video|audio|music)|music video|\balbum\b|\bsingle\b|vevo|records|new release/gi,
  },
  lifestyle: {
    fashion:       /fashion|outfit|\bstyle\b|wardrobe|lookbook|thrift|\bootd\b|styling|clothing haul/gi,
    home_living:   /home decor|interior|\bdecor\b|organiz|declutter|minimalis|home tour|house tour|cleaning routine/gi,
    parenting:     /parent|motherhood|pregnan|\bbaby\b|toddler|kids routine|mom life|family vlog/gi,
    relationships: /relationship|dating|marriage|breakup|\blove life|situationship/gi,
    diy_craft:     /\bdiy\b|\bcraft|handmade|upcycl|scrapbook/gi,
    wellness:      /wellness|self[- ]?care|mindful|journal|productiv|morning routine|that girl|glow up/gi,
  },
  food: {
    healthy_diet: /healthy|\bdiet\b|\bvegan\b|\bketo\b|nutrition|weight loss|high protein|meal prep/gi,
    street_food:  /street food|food tour|food challenge|mukbang|eating show/gi,
    food_review:  /food review|restaurant review|taste test|tasting|food vlog|reviewing/gi,
    baking:       /baking|\bbake\b|dessert|\bcake\b|pastr|cookies|chocolate/gi,
    cooking:      /recipe|cooking|\bcook\b|homemade|kitchen|curry|\bdish\b/gi,
  },
  travel: {
    budget_travel:    /budget travel|backpack|cheap travel|budget trip|hostel/gi,
    luxury_travel:    /luxury travel|luxury|\bresort\b|first class|5[- ]?star|business class/gi,
    adventure_travel: /adventure|\btrek|hiking|road ?trip|expedition|off[- ]?road|camping|mountaineer/gi,
    food_travel:      /food tour|street food|culinary|food travel/gi,
    travel_guide:     /travel guide|itinerary|things to do|destination guide|travel tips|places to visit/gi,
  },
  gaming: {
    sandbox:       /minecraft|roblox|\bsandbox\b|terraria/gi,
    battle_royale: /free ?fire|\bpubg\b|\bbgmi\b|fortnite|valorant|\bcod\b|warzone|\bapex\b|battle royale/gi,
    open_world:    /\bgta\b|grand theft|rockstar|open world|\brdr\b|red dead/gi,
    esports:       /esports|tournament|competitive|ranked gameplay|pro player/gi,
    lets_play:     /walkthrough|playthrough|let'?s play|full game|campaign|game story/gi,
  },
};

// Genuine kids/toddler content, detected from STRONG unambiguous topic phrases only (bare "kids"
// also matches family vlogs / kids-health, so it's excluded). Hundreds of these channels are
// MISLABELED into music / entertainment / food / beauty (Baby Shark→music, Ryan's World→food) and
// poison those non-kids peer pools regardless of the (wrong) niche label.
const KIDS_CONTENT_RE = /nursery rhyme|children'?s song|children'?s rhyme|children'?s stor|children'?s entertainment|kids'? song|kids'? rhyme|\bbaby song|toy review|toy unbox|cartoon for kids|rhymes for (kids|children)|preschool|educational (animation|content|video)s? for (kids|children|child)/i;
function isKidsContent(inferredTopics) {
  return KIDS_CONTENT_RE.test(String(inferredTopics || ''));
}

// Returns a sub-niche label (e.g. 'kids') or null. null = no split for this parent niche, or no
// confident keyword match (a "general" channel — caller should NOT sub-filter on it).
function classifySubNiche(parentNiche, inferredTopics, channelName) {
  const rules = SUB_NICHE_RULES[String(parentNiche || '').toLowerCase()];
  if (!rules) return null;
  const blob = (String(inferredTopics || '') + ' ' + String(channelName || '')).toLowerCase();
  let best = null, bestScore = 0;
  for (const [label, re] of Object.entries(rules)) {
    const m = blob.match(re);
    const s = m ? m.length : 0;
    if (s > bestScore) { bestScore = s; best = label; }
  }
  return bestScore > 0 ? best : null;
}

module.exports = { classifySubNiche, isKidsContent, SUB_NICHE_RULES };

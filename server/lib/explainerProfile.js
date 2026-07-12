'use strict';

const QUESTION_OPEN_RE = /^(why|how|what|when|where|who|which)\b/i;
const EXPLAINER_RE = /\b(explained|explainer|breakdown|truth|secret|hidden|behind|inside|designed|design|works|happens|changed|change|crisis|scam|lie|lies|dark|problem|reason|history|banned|legalized|missing|cost|costs|expensive|cheap|bill|bills)\b/i;
const EVERYDAY_RE = /\b(india|indian|indians|city|cities|food|ac|bill|bills|phone|phones|internet|google|meta|amazon|swiggy|delivery|airport|restaurants?|brands?|coke|diet|watch|market|stock|mosquito|water|labels?|vape|lpg|rent|delhi)\b/i;
const SYSTEM_DOMAIN_RE = /\b(india|indian|indians|city|cities|economy|economic|government|policy|law|legal|rule|rules|tax|bill|bills|price|prices|cost|costs|market|stock|startup|company|companies|brand|brands|google|meta|amazon|swiggy|zomato|internet|phone|phones|airport|restaurants?|food|water|health|science|technology|tech|ai|climate|energy|rent|bank|banking|loan|insurance|jobs|work|salary|delhi|mumbai|bengaluru|bangalore)\b/i;
const NEWS_CONTAINER_RE = /\b(breaking|latest news|live news|headline|headlines|press conference|news update|today news)\b/i;
const TUTORIAL_RE = /\b(how to|step by step|tutorial|course|class|lesson|lecture|roadmap|beginner guide|masterclass)\b/i;
const EXAM_RE = /\b(upsc|neet|jee|ssc|prelims|mains|mock test|answer key|syllabus|aspirant)\b/i;
const GUEST_RE = /\b(podcast|episode|ep\.?\s*\d+|ft\.|feat\.|featuring|with\s+[A-Z][a-z]+\s+[A-Z][a-z]+)\b/;
const MUSIC_MEDIA_RE = /\b(song|songs|music|lyric|lyrics|lyrical|official video|full video|audio|jukebox|album|movie|film|trailer|teaser|scene|bts|behind the scenes|making film|karaoke|dance song|love song|romantic song)\b/i;
const KIDS_CARTOON_RE = /\b(kid|kids|children|childrens?|baby shark|cartoon|cartoons|nursery|rhymes?|toddler|baby|playground|masha|pinkfong)\b/i;
const CHALLENGE_STUNT_RE = /\b(challenge|prank|destroy|win a new|secret room|survival bunker|extreme|impossible|can you|who can|should we|24\s*hours?|\$\d+\s*vs|built a|i built|last to|try not to)\b/i;
const DIY_HACK_RE = /\b(diy|craft|crafts|hacks?|glue gun|make at home|home fixes|recipes?|cooking hack)\b/i;
const SHORTS_RE = /#shorts|#ytshorts|\bshorts?\b/i;

function normaliseTitle(title) {
  return String(title || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function computeCuriosityExplainerSignals(titles = []) {
  const clean = titles.map(normaliseTitle).filter(Boolean);
  const n = clean.length;
  const empty = {
    active: false,
    strong: false,
    score: 0,
    n,
    curiosity_count: 0,
    explainer_count: 0,
    everyday_count: 0,
    domain_count: 0,
    news_container_count: 0,
    tutorial_count: 0,
    exam_count: 0,
    guest_count: 0,
    music_media_count: 0,
    kids_cartoon_count: 0,
    challenge_stunt_count: 0,
    diy_hack_count: 0,
    shorts_count: 0,
    curiosity_ratio: 0,
    explainer_ratio: 0,
    everyday_ratio: 0,
    domain_ratio: 0,
    blockers: [],
  };
  if (n < 8) return empty;

  let curiosityCount = 0;
  let explainerCount = 0;
  let everydayCount = 0;
  let domainCount = 0;
  let newsContainerCount = 0;
  let tutorialCount = 0;
  let examCount = 0;
  let guestCount = 0;
  let musicMediaCount = 0;
  let kidsCartoonCount = 0;
  let challengeStuntCount = 0;
  let diyHackCount = 0;
  let shortsCount = 0;

  for (const title of clean) {
    const tl = title.toLowerCase();
    const isQuestion = QUESTION_OPEN_RE.test(title) || /[?]/.test(title);
    const isExplainer = EXPLAINER_RE.test(tl);
    const isEveryday = EVERYDAY_RE.test(tl);
    const isDomain = SYSTEM_DOMAIN_RE.test(tl);

    if (isQuestion || isExplainer) curiosityCount++;
    if (isExplainer) explainerCount++;
    if (isEveryday) everydayCount++;
    if (isDomain) domainCount++;
    if (NEWS_CONTAINER_RE.test(tl)) newsContainerCount++;
    if (TUTORIAL_RE.test(tl)) tutorialCount++;
    if (EXAM_RE.test(tl)) examCount++;
    if (GUEST_RE.test(title)) guestCount++;
    if (MUSIC_MEDIA_RE.test(tl)) musicMediaCount++;
    if (KIDS_CARTOON_RE.test(tl)) kidsCartoonCount++;
    if (CHALLENGE_STUNT_RE.test(tl)) challengeStuntCount++;
    if (DIY_HACK_RE.test(tl)) diyHackCount++;
    if (SHORTS_RE.test(tl)) shortsCount++;
  }

  const curiosityRatio = curiosityCount / n;
  const explainerRatio = explainerCount / n;
  const everydayRatio = everydayCount / n;
  const domainRatio = domainCount / n;
  const blockers = [];
  if (newsContainerCount / n >= 0.35) blockers.push('news_container_density');
  if (tutorialCount / n >= 0.35) blockers.push('tutorial_density');
  if (examCount / n >= 0.20) blockers.push('exam_density');
  if (guestCount / n >= 0.25) blockers.push('guest_density');
  if (musicMediaCount / n >= 0.20) blockers.push('music_media_density');
  if (kidsCartoonCount / n >= 0.15) blockers.push('kids_cartoon_density');
  if (challengeStuntCount / n >= 0.25) blockers.push('challenge_stunt_density');
  if (diyHackCount / n >= 0.20) blockers.push('diy_hack_density');
  if (shortsCount / n >= 0.35) blockers.push('shorts_density');

  const score =
    curiosityCount * 3 +
    explainerCount * 2 +
    everydayCount +
    domainCount -
    newsContainerCount * 2 -
    tutorialCount * 2 -
    examCount * 3 -
    guestCount -
    musicMediaCount * 2 -
    kidsCartoonCount * 2 -
    challengeStuntCount -
    diyHackCount;

  const active =
    blockers.length === 0 &&
    curiosityCount >= 6 &&
    curiosityRatio >= 0.25 &&
    explainerCount >= 3 &&
    domainCount >= 5 &&
    domainRatio >= 0.18 &&
    score >= 28;

  return {
    active,
    strong: active && curiosityCount >= 10 && curiosityRatio >= 0.35 && explainerCount >= 4 && domainCount >= 6 && score >= 40,
    score,
    n,
    curiosity_count: curiosityCount,
    explainer_count: explainerCount,
    everyday_count: everydayCount,
    domain_count: domainCount,
    news_container_count: newsContainerCount,
    tutorial_count: tutorialCount,
    exam_count: examCount,
    guest_count: guestCount,
    music_media_count: musicMediaCount,
    kids_cartoon_count: kidsCartoonCount,
    challenge_stunt_count: challengeStuntCount,
    diy_hack_count: diyHackCount,
    shorts_count: shortsCount,
    curiosity_ratio: Number(curiosityRatio.toFixed(3)),
    explainer_ratio: Number(explainerRatio.toFixed(3)),
    everyday_ratio: Number(everydayRatio.toFixed(3)),
    domain_ratio: Number(domainRatio.toFixed(3)),
    blockers,
  };
}

module.exports = { computeCuriosityExplainerSignals };

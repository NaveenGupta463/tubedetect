'use strict';

// Cross-family WTP classification health audit.
//
// This does not mutate the DB. It scans channel titles for strong behavioral
// evidence, compares that evidence against stored metadata and the live CSP
// classifier, then reports blocking classifier failures separately from metadata
// warnings. Use this after classifier changes and before trusting a backfill.
//
// Usage:
//   node server/scripts/auditWtpClassificationHealth.js
//   node server/scripts/auditWtpClassificationHealth.js --family=tech_review_vs_essay
//   node server/scripts/auditWtpClassificationHealth.js --limit=100
//   node server/scripts/auditWtpClassificationHealth.js --json

const { getDb, closeDb } = require('../db/init');
const { computeCuriosityExplainerSignals } = require('../lib/explainerProfile');
const { classifyChannel, detectGuestRatio, CSP_PROFILE_VERSION } = require('../services/contentStrategyProfile');
const { FORMAT_PROFILE_VERSION } = require('../lib/formatProfile');
const { CREATOR_MODE_VERSION } = require('../lib/creatorMode');

const LIMIT = Math.max(1, parseInt(process.argv.find(a => a.startsWith('--limit='))?.split('=')[1] || '80', 10));
const FAMILY_FILTER = (process.argv.find(a => a.startsWith('--family='))?.split('=')[1] || '').trim();
const JSON_MODE = process.argv.includes('--json');
const MIN_TITLES = Math.max(8, parseInt(process.argv.find(a => a.startsWith('--min-titles='))?.split('=')[1] || '10', 10));

const FAMILIES = [
  'stored_vs_live',
  'podcast_vs_solo',
  'finance_vs_business_case',
  'news_vs_explainer',
  'tech_review_vs_essay',
  'education_vs_exam',
  'curiosity_explainer',
];

function lc(s) {
  return String(s || '').toLowerCase();
}

function pct(n) {
  if (n == null || Number.isNaN(Number(n))) return '0%';
  return `${Math.round(Number(n) * 100)}%`;
}

function count(titles, re) {
  let n = 0;
  for (const title of titles) if (re.test(title)) n++;
  return n;
}

function ratio(part, whole) {
  return whole > 0 ? part / whole : 0;
}

function hasAny(text, terms) {
  return terms.some(t => text.includes(t));
}

const RE = {
  episode: /\b(episode|ep\.?\s*\d+|\|\s*[A-Z]{2,6}\s*\d{1,4}|#\d{1,4}\b)/i,
  podcastIntent: /\b(podcast|interview|conversation|guest show|talk show|with [A-Z][a-z]+ [A-Z][a-z]+)\b|(?:ft\.|feat\.|featuring)\s+[A-Z]/,
  newsContainer: /\b(breaking|latest news|live news|headlines?|press conference|news update|today news|top news|exclusive|alert|bulletin)\b/i,
  exam: /\b(upsc|neet|jee|ssc|ias|prelims|mains|mock test|answer key|syllabus|pyq|cut[\s-]?off|test series|board exam|gate exam)\b/i,
  financeInvest: /\b(stock market|mutual fund|portfolio|sip|nifty|sensex|dividend|equity|smallcap|midcap|index fund|valuation|trading|investing|investment|etf|bull market|bear market)\b/i,
  personalFinance: /\b(budget|emergency fund|emi|insurance|tax planning|savings plan|debt free|credit card|salary|loan|financial planning|financial freedom)\b/i,
  businessCase: /\b(case study|business model|rise of|fall of|collapse of|why .* failed|how .* became|how .* built|what went wrong|secret behind|lessons from|revenue|profit|competition|strategy|startup|company)\b/i,
  techReview: /\b(unboxing|first look|hands on|review|camera test|speed test|best budget|smartphone|phone|iphone|android|laptop|tablet|earbuds|tws|specs|battery|display|performance|vs test|comparison)\b/i,
  techEssay: /\b(ai|artificial intelligence|software|internet|semiconductor|chip|technology|tech|data|algorithm|openai|google|meta|startup|platform|privacy|cyber|robot|future of)\b/i,
  education: /\b(class|chapter|lesson|lecture|teacher|student|learn|study|notes|revision|quiz|course|tutorial|explained|concept|math|grammar|vocabulary|gk|general knowledge)\b/i,
  shorts: /#shorts|#ytshorts|\bshorts?\b/i,
  mediaEntertainment: /\b(tv|serial|drama|full episode|mini episode|episode promo|trailer|teaser|movie|film|song|official video|lyrical|cartoon|kids|gameplay|ps5|xbox|anime|comedy video|funny video|short film|web series|naagin|taarak mehta|pokemon|free fire|gta)\b/i,
};

const PODCAST_BLOCK_NICHES = new Set([
  'entertainment', 'comedy', 'gaming', 'music', 'kids', 'food', 'cooking',
  'travel', 'lifestyle', 'sports', 'beauty', 'fashion',
]);

const CURIOSITY_BLOCK_NICHES = new Set([
  'entertainment', 'comedy', 'gaming', 'music', 'kids', 'food', 'cooking',
  'travel', 'lifestyle', 'sports', 'beauty', 'fashion', 'fitness', 'yoga',
]);

function evidenceFor(row, titles) {
  const n = titles.length;
  const text = titles.join(' ').toLowerCase();
  const guestRatio = detectGuestRatio(titles);
  const episodeCount = count(titles, RE.episode);
  const podcastIntentCount = count(titles, RE.podcastIntent);
  const newsCount = count(titles, RE.newsContainer);
  const examCount = count(titles, RE.exam);
  const financeInvestCount = count(titles, RE.financeInvest);
  const personalFinanceCount = count(titles, RE.personalFinance);
  const businessCaseCount = count(titles, RE.businessCase);
  const techReviewCount = count(titles, RE.techReview);
  const techEssayCount = count(titles, RE.techEssay);
  const educationCount = count(titles, RE.education);
  const shortsCount = count(titles, RE.shorts);
  const mediaEntertainmentCount = count(titles, RE.mediaEntertainment);
  const curiosity = computeCuriosityExplainerSignals(titles);

  return {
    n,
    title_text: text,
    guest_ratio: guestRatio,
    episode_ratio: ratio(episodeCount, n),
    podcast_intent_ratio: ratio(podcastIntentCount, n),
    news_ratio: ratio(newsCount, n),
    exam_ratio: ratio(examCount, n),
    finance_invest_ratio: ratio(financeInvestCount, n),
    personal_finance_ratio: ratio(personalFinanceCount, n),
    business_case_ratio: ratio(businessCaseCount, n),
    tech_review_ratio: ratio(techReviewCount, n),
    tech_essay_ratio: ratio(techEssayCount, n),
    education_ratio: ratio(educationCount, n),
    shorts_ratio: ratio(shortsCount, n),
    media_entertainment_ratio: ratio(mediaEntertainmentCount, n),
    counts: {
      episode: episodeCount,
      podcast_intent: podcastIntentCount,
      news: newsCount,
      exam: examCount,
      finance_invest: financeInvestCount,
      personal_finance: personalFinanceCount,
      business_case: businessCaseCount,
      tech_review: techReviewCount,
      tech_essay: techEssayCount,
      education: educationCount,
      shorts: shortsCount,
      media_entertainment: mediaEntertainmentCount,
    },
    curiosity,
    niche_text: [
      row.primary_niche,
      row.niche,
      row.secondary_niche,
      row.content_archetype,
      row.format_type,
      row.routing_profile,
      row.creator_mode,
      row.format_profile,
      row.primary_csp,
    ].filter(Boolean).join(' ').toLowerCase(),
  };
}

function isPodcastBlocked(row, ev) {
  const niche = lc(row.primary_niche || row.niche);
  if (PODCAST_BLOCK_NICHES.has(niche)) return true;
  if (ev.media_entertainment_ratio >= 0.25) return true;
  if (ev.shorts_ratio >= 0.35 && ev.podcast_intent_ratio < 0.20) return true;
  return false;
}

function isCuriosityBlocked(row, ev) {
  const niche = lc(row.primary_niche || row.niche);
  const formatType = lc(row.format_type);
  const formatProfile = lc(row.format_profile);
  if (CURIOSITY_BLOCK_NICHES.has(niche)) return true;
  if (['podcast', 'interview', 'vlog', 'shorts', 'compilation', 'tutorial'].includes(formatType)) return true;
  if (['guest_interview', 'podcast_like_longform', 'shorts', 'vlog'].includes(formatProfile)) return true;
  if (ev.media_entertainment_ratio >= 0.20) return true;
  return false;
}

function currentExpected(row, ev) {
  const niche = lc(row.primary_niche || row.niche);
  const formatType = lc(row.format_type);
  const creatorMode = lc(row.creator_mode);

  const podcastBlocked = isPodcastBlocked(row, ev);
  const isGuestShow = !podcastBlocked && (
    ev.podcast_intent_ratio >= 0.15 ||
    (ev.guest_ratio >= 0.25 && ev.podcast_intent_ratio >= 0.08) ||
    (['podcast', 'interview'].includes(formatType) && (ev.guest_ratio >= 0.12 || ev.podcast_intent_ratio >= 0.08)) ||
    (creatorMode === 'podcast' && (ev.guest_ratio >= 0.18 || ev.podcast_intent_ratio >= 0.08))
  );
  const isFinance = niche === 'finance' || /\bfinance|invest|stock|market|wealth|money\b/.test(ev.niche_text);
  const isBusiness = niche === 'business' || /\bbusiness|startup|entrepreneur|company\b/.test(ev.niche_text);
  const isTech = ['technology', 'tech', 'science'].includes(niche) || /\btechnology|tech|smartphone|gadget|software|ai\b/.test(ev.niche_text);
  const isEducation = niche === 'education' || /\beducation|learning|teacher|student\b/.test(ev.niche_text);
  const examEligible = !isPodcastBlocked(row, ev) && (
    isEducation ||
    lc(row.routing_profile) === 'upsc_exam' ||
    ['upsc', 'jee_prep'].includes(creatorMode) ||
    /\b(upsc|neet|jee|ssc|ias|prelims|mains)\b/i.test(ev.title_text)
  );

  const expected = [];
  if (isGuestShow) expected.push('podcast_guest_show');
  if (examEligible && (ev.exam_ratio >= 0.18 || ev.counts.exam >= 5 || creatorMode === 'upsc')) expected.push('exam_demand_teaching');
  if (ev.news_ratio >= 0.25 || formatType === 'news' || creatorMode === 'news') expected.push('news_event_bulletin');
  if (isTech && ev.tech_review_ratio >= 0.25 && !ev.curiosity.active) expected.push('tech_review_gadget');
  if (isTech && ev.curiosity.active && ev.tech_review_ratio < 0.20) expected.push('tech_essay_explainer');
  if (isFinance && !isGuestShow && ev.finance_invest_ratio >= 0.18 && ev.business_case_ratio < 0.18) expected.push('finance_investment_education');
  if ((isBusiness || isFinance) && !isGuestShow && ev.business_case_ratio >= 0.18 && ev.finance_invest_ratio < 0.18) expected.push('business_case_study');
  if (ev.curiosity.active && !isCuriosityBlocked(row, ev) && !isGuestShow && ev.news_ratio < 0.25 && ev.tech_review_ratio < 0.25) expected.push('curiosity_explainer');
  if (isEducation && ev.exam_ratio < 0.10 && ev.education_ratio >= 0.25) expected.push('general_education');
  return expected;
}

function isAcceptableLiveCsp(expected, liveCsp) {
  if (!expected.length) return true;
  if (expected.includes('podcast_guest_show')) {
    return [
      'indian_business_selfimprovement_podcast',
      'founder_economy_conversation',
      'personal_finance_guest_show',
      'spiritual_geopolitics_guest_show',
    ].includes(liveCsp);
  }
  if (expected.includes('tech_essay_explainer')) {
    return ['curiosity_explainer', 'general_education', 'business_case_study'].includes(liveCsp);
  }
  return expected.includes(liveCsp);
}

function familyAllowed(family) {
  return !FAMILY_FILTER || family === FAMILY_FILTER;
}

function classifyLive(db, channelId, cache) {
  if (!cache.has(channelId)) {
    try {
      cache.set(channelId, classifyChannel(db, channelId));
    } catch (err) {
      cache.set(channelId, { error: err.message });
    }
  }
  return cache.get(channelId);
}

function addFinding(findings, row, ev, family, severity, reason, details = {}) {
  if (!familyAllowed(family)) return;
  findings.push({
    family,
    severity,
    reason,
    channel_id: row.channel_id,
    channel_name: row.channel_name,
    subscribers: row.channel_subscribers || 0,
    niche: row.primary_niche || row.niche || null,
    creator_mode: row.creator_mode || null,
    routing_profile: row.routing_profile || null,
    format_type: row.format_type || null,
    format_profile: row.format_profile || null,
    stored_csp: row.primary_csp || null,
    stored_csp_confidence: row.confidence || null,
    stored_csp_version: row.version || null,
    evidence: {
      guest: pct(ev.guest_ratio),
      episode: pct(ev.episode_ratio),
      podcast_intent: pct(ev.podcast_intent_ratio),
      news: pct(ev.news_ratio),
      exam: pct(ev.exam_ratio),
      finance_invest: pct(ev.finance_invest_ratio),
      business_case: pct(ev.business_case_ratio),
      tech_review: pct(ev.tech_review_ratio),
      tech_essay: pct(ev.tech_essay_ratio),
      education: pct(ev.education_ratio),
      curiosity: ev.curiosity.active ? `${pct(ev.curiosity.curiosity_ratio)} active` : pct(ev.curiosity.curiosity_ratio),
    },
    ...details,
  });
}

function auditRow(db, row, titles, findings, liveCache) {
  const ev = evidenceFor(row, titles);
  const expected = currentExpected(row, ev);
  const live = expected.length || (row.version || 0) < CSP_PROFILE_VERSION || (row.primary_csp && row.confidence === 'low')
    ? classifyLive(db, row.channel_id, liveCache)
    : null;
  const liveCsp = live?.primary_csp || null;

  if (familyAllowed('stored_vs_live')) {
    if ((row.version || 0) < CSP_PROFILE_VERSION) {
      addFinding(findings, row, ev, 'stored_vs_live', 'warning', 'stored_csp_version_stale', {
        expected,
        live_csp: liveCsp,
        target_version: CSP_PROFILE_VERSION,
      });
    } else if (liveCsp && row.primary_csp && liveCsp !== row.primary_csp) {
      addFinding(findings, row, ev, 'stored_vs_live', 'warning', 'stored_live_csp_disagreement', {
        expected,
        live_csp: liveCsp,
      });
    }
  }

  if (familyAllowed('podcast_vs_solo')) {
    const guestLike = expected.includes('podcast_guest_show');
    const storedGuestLike = [
      'guest_interview',
      'podcast_like_longform',
    ].includes(lc(row.format_profile)) || ['podcast', 'interview'].includes(lc(row.format_type));
    const cspGuestLike = [
      'indian_business_selfimprovement_podcast',
      'founder_economy_conversation',
      'personal_finance_guest_show',
      'spiritual_geopolitics_guest_show',
    ].includes(row.primary_csp);

    if (guestLike && !storedGuestLike && !cspGuestLike) {
      addFinding(findings, row, ev, 'podcast_vs_solo', 'blocking', 'guest_show_evidence_not_routed_as_guest_show', { expected, live_csp: liveCsp });
    }
    if (!guestLike && !isPodcastBlocked(row, ev) && lc(row.creator_mode) === 'podcast' && ev.guest_ratio < 0.12 && ev.podcast_intent_ratio < 0.08) {
      addFinding(findings, row, ev, 'podcast_vs_solo', 'warning', 'podcast_mode_without_guest_or_episode_evidence', { live_csp: liveCsp });
    }
  }

  if (familyAllowed('finance_vs_business_case')) {
    if (expected.includes('finance_investment_education') && !['finance_investment_education', 'personal_finance_teaching'].includes(liveCsp || row.primary_csp)) {
      addFinding(findings, row, ev, 'finance_vs_business_case', 'blocking', 'finance_investment_evidence_not_finance_csp', { expected, live_csp: liveCsp });
    }
    if (expected.includes('business_case_study') && !['business_case_study', 'curiosity_explainer'].includes(liveCsp || row.primary_csp)) {
      addFinding(findings, row, ev, 'finance_vs_business_case', 'blocking', 'business_case_evidence_not_business_case_csp', { expected, live_csp: liveCsp });
    }
  }

  if (familyAllowed('news_vs_explainer')) {
    if (expected.includes('news_event_bulletin') && liveCsp && liveCsp !== 'news_event_bulletin') {
      addFinding(findings, row, ev, 'news_vs_explainer', 'blocking', 'news_container_evidence_not_news_csp', { expected, live_csp: liveCsp });
    }
    if (ev.curiosity.active && lc(row.creator_mode) === 'news' && ev.news_ratio < 0.15) {
      addFinding(findings, row, ev, 'news_vs_explainer', 'warning', 'news_mode_on_explainer_like_channel', { expected, live_csp: liveCsp });
    }
  }

  if (familyAllowed('tech_review_vs_essay')) {
    if (expected.includes('tech_review_gadget') && liveCsp && liveCsp !== 'tech_review_gadget') {
      addFinding(findings, row, ev, 'tech_review_vs_essay', 'blocking', 'tech_review_evidence_not_tech_review_csp', { expected, live_csp: liveCsp });
    }
    if (expected.includes('tech_essay_explainer') && liveCsp === 'tech_review_gadget') {
      addFinding(findings, row, ev, 'tech_review_vs_essay', 'blocking', 'tech_essay_evidence_routed_as_gadget_review', { expected, live_csp: liveCsp });
    }
  }

  if (familyAllowed('education_vs_exam')) {
    if (expected.includes('exam_demand_teaching') && liveCsp && liveCsp !== 'exam_demand_teaching') {
      addFinding(findings, row, ev, 'education_vs_exam', 'blocking', 'exam_evidence_not_exam_csp', { expected, live_csp: liveCsp });
    }
    if (!expected.includes('exam_demand_teaching') && row.primary_csp === 'exam_demand_teaching' && ev.exam_ratio < 0.08) {
      addFinding(findings, row, ev, 'education_vs_exam', 'warning', 'exam_csp_without_exam_evidence', { expected, live_csp: liveCsp });
    }
  }

  if (familyAllowed('curiosity_explainer')) {
    if (expected.includes('curiosity_explainer') && liveCsp && ![
      'curiosity_explainer',
      'news_event_bulletin',
      'general_education',
      'business_case_study',
      'finance_investment_education',
      'tech_review_gadget',
    ].includes(liveCsp)) {
      addFinding(findings, row, ev, 'curiosity_explainer', 'blocking', 'curiosity_evidence_not_curiosity_csp', { expected, live_csp: liveCsp });
    }
    if (!expected.includes('curiosity_explainer') && row.primary_csp === 'curiosity_explainer' && !ev.curiosity.active) {
      addFinding(findings, row, ev, 'curiosity_explainer', 'warning', 'curiosity_csp_without_active_curiosity_signal', { expected, live_csp: liveCsp });
    }
  }
}

function compactTitles(titles) {
  return titles.slice(0, 4).map(t => String(t || '').replace(/\s+/g, ' ').trim()).join(' | ');
}

function main() {
  if (FAMILY_FILTER && !FAMILIES.includes(FAMILY_FILTER)) {
    console.error(`Unknown family "${FAMILY_FILTER}". Valid families: ${FAMILIES.join(', ')}`);
    process.exit(1);
  }

  const db = getDb();
  const rows = db.all(
    `SELECT ic.channel_id, ic.channel_name, ic.channel_subscribers,
            ic.niche, ic.primary_niche, ic.secondary_niche, ic.content_archetype,
            ic.creator_mode, ic.creator_mode_version, ic.routing_profile,
            ic.format_type, ic.format_profile, ic.format_profile_version,
            ccsp.primary_csp, ccsp.confidence, ccsp.version
     FROM ingested_channels ic
     LEFT JOIN channel_content_strategy_profiles ccsp ON ccsp.channel_id = ic.channel_id
     WHERE ic.ingest_enabled = 1
       AND ic.channel_id IS NOT NULL
       AND EXISTS (SELECT 1 FROM ingested_videos iv WHERE iv.channel_id = ic.channel_id)
     ORDER BY ic.channel_subscribers DESC`,
  );

  const findings = [];
  const liveCache = new Map();
  const titleCache = new Map();
  let scanned = 0;
  let skipped = 0;

  for (const row of rows) {
    const titles = db.all(
      `SELECT title FROM ingested_videos
       WHERE channel_id = ? AND title IS NOT NULL AND title != ''
       ORDER BY published_at DESC LIMIT 60`,
      [row.channel_id],
    ).map(r => r.title);
    titleCache.set(row.channel_id, titles);
    if (titles.length < MIN_TITLES) { skipped++; continue; }
    scanned++;

    auditRow(db, row, titles, findings, liveCache);
  }

  findings.sort((a, b) => {
    const sev = (b.severity === 'blocking') - (a.severity === 'blocking');
    return sev || b.subscribers - a.subscribers || a.family.localeCompare(b.family);
  });

  const blocking = findings.filter(f => f.severity === 'blocking');
  const warnings = findings.filter(f => f.severity !== 'blocking');
  const out = findings.slice(0, LIMIT).map(f => ({
    ...f,
    sample_titles: compactTitles(titleCache.get(f.channel_id) || []),
  }));

  if (JSON_MODE) {
    console.log(JSON.stringify({
      scanned,
      skipped,
      blocking_count: blocking.length,
      warning_count: warnings.length,
      returned: out.length,
      findings: out,
    }, null, 2));
    closeDb();
    return;
  }

  console.log('\n=== WTP Classification Health Audit ===');
  console.log(`Scanned: ${scanned} | skipped: ${skipped} | blocking: ${blocking.length} | warnings: ${warnings.length}`);
  if (FAMILY_FILTER) console.log(`Family filter: ${FAMILY_FILTER}`);
  console.log(`Classifier versions: CSP v${CSP_PROFILE_VERSION}, format v${FORMAT_PROFILE_VERSION}, creator mode v${CREATOR_MODE_VERSION}`);
  console.log(`Showing ${out.length}\n`);

  const byFamily = {};
  for (const f of findings) {
    byFamily[f.family] ||= { blocking: 0, warning: 0 };
    byFamily[f.family][f.severity === 'blocking' ? 'blocking' : 'warning']++;
  }
  for (const family of Object.keys(byFamily).sort()) {
    const x = byFamily[family];
    console.log(`  ${family.padEnd(32)} blocking=${String(x.blocking).padStart(4)}  warnings=${String(x.warning).padStart(4)}`);
  }
  console.log('');

  for (const f of out) {
    const subs = f.subscribers >= 1_000_000 ? `${(f.subscribers / 1_000_000).toFixed(1)}M`
      : f.subscribers >= 1_000 ? `${Math.round(f.subscribers / 1_000)}K`
      : String(f.subscribers);
    console.log(`- [${f.severity}] ${f.family}: ${f.channel_name} (${subs})`);
    console.log(`  reason=${f.reason}`);
    console.log(`  stored=${f.stored_csp || '-'}:${f.stored_csp_confidence || '-'} v${f.stored_csp_version || '-'} live=${f.live_csp || '-'}`);
    console.log(`  niche=${f.niche || '-'} mode=${f.creator_mode || '-'} routing=${f.routing_profile || '-'} format=${f.format_type || '-'}/${f.format_profile || '-'}`);
    console.log(`  evidence guest=${f.evidence.guest} podcastIntent=${f.evidence.podcast_intent} news=${f.evidence.news} exam=${f.evidence.exam} finance=${f.evidence.finance_invest} business=${f.evidence.business_case} techReview=${f.evidence.tech_review} curiosity=${f.evidence.curiosity}`);
    if (f.expected?.length) console.log(`  expected=${f.expected.join(', ')}`);
    console.log(`  titles: ${f.sample_titles}`);
  }

  closeDb();
}

main();

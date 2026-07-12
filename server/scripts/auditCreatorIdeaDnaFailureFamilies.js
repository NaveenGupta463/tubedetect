'use strict';

// Phase DNA-2: audit cached creator idea DNA for known WTP failure families.
//
// Usage:
//   node server/scripts/auditCreatorIdeaDnaFailureFamilies.js --limit 100
//   node server/scripts/auditCreatorIdeaDnaFailureFamilies.js --limit 100 --backfill-missing --backfill-limit 25
//   node server/scripts/auditCreatorIdeaDnaFailureFamilies.js --family tech_review_vs_tech_essay

const { getDb } = require('../db/init');
const {
  DEFAULT_VIDEO_LIMIT,
  persistCreatorIdeaDna,
} = require('../services/creatorIdeaDna');

function argValue(name, fallback = null) {
  const exact = process.argv.indexOf(name);
  if (exact !== -1 && exact + 1 < process.argv.length) return process.argv[exact + 1];
  const prefix = `${name}=`;
  const found = process.argv.find(arg => arg.startsWith(prefix));
  if (found) return found.slice(prefix.length);
  return fallback;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function toInt(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function parseJson(value, fallback) {
  if (value == null || value === '') return fallback;
  try {
    return JSON.parse(value);
  } catch (_) {
    return fallback;
  }
}

function rowIds(rows) {
  return new Set((rows || []).map(row => row.id).filter(Boolean));
}

function hasAny(set, values) {
  return values.some(value => set.has(value));
}

function textHas(text, pattern) {
  return pattern.test(text || '');
}

function countTitleHits(signals, pattern) {
  let hits = 0;
  for (const signal of signals) {
    if (pattern.test(String(signal.title || '').toLowerCase())) hits++;
  }
  return hits;
}

function isCsp(csp, patterns) {
  return patterns.some(pattern => csp.includes(pattern));
}

function maybeBackfillMissing(db, options) {
  if (!options.backfillMissing) return { attempted: 0, ok: 0, failed: 0 };

  const targets = db.all(
    `SELECT ic.channel_id, ic.channel_name, COUNT(iv.youtube_video_id) AS video_count
       FROM ingested_channels ic
       JOIN ingested_videos iv ON iv.channel_id = ic.channel_id
       LEFT JOIN creator_idea_dna cid ON cid.channel_id = ic.channel_id
      WHERE ic.ingest_enabled = 1
        AND cid.channel_id IS NULL
        AND iv.title IS NOT NULL
        AND iv.title != ''
      GROUP BY ic.channel_id
      ORDER BY ic.channel_subscribers DESC, video_count DESC
      LIMIT ?`,
    [options.backfillLimit],
  );

  let ok = 0;
  let failed = 0;
  for (const target of targets) {
    try {
      const res = persistCreatorIdeaDna(db, target.channel_id, { limit: options.videoLimit });
      if (res.ok) ok++;
      else failed++;
    } catch (_) {
      failed++;
    }
  }
  return { attempted: targets.length, ok, failed };
}

function loadAuditRows(db, limit) {
  return db.all(
    `SELECT cid.*,
            ic.channel_name, ic.niche, ic.primary_niche, ic.creator_mode,
            ic.format_profile, ic.format_type, ic.channel_subscribers,
            ccsp.primary_csp, ccsp.confidence AS csp_confidence,
            ccsp.confidence_score AS csp_confidence_score
       FROM creator_idea_dna cid
       JOIN ingested_channels ic ON ic.channel_id = cid.channel_id
       LEFT JOIN channel_content_strategy_profiles ccsp ON ccsp.channel_id = cid.channel_id
      ORDER BY cid.updated_at DESC, ic.channel_subscribers DESC
      LIMIT ?`,
    [limit],
  );
}

function loadSignals(db, channelId) {
  return db.all(
    `SELECT title, hook_type, hook_templates_json, thesis_patterns_json,
            domain_tags_json, keywords_json, micro_topics_json
       FROM video_dna_signals
      WHERE channel_id = ?
      ORDER BY datetime(published_at) DESC
      LIMIT 50`,
    [channelId],
  );
}

function buildContext(row, signals) {
  const stable = parseJson(row.stable_dna_json, {});
  const formatMix = parseJson(row.format_mix_json, {});
  const domains = rowIds(parseJson(row.domain_tags_json, []));
  const thesis = rowIds(parseJson(row.thesis_patterns_json, []));
  const hooks = rowIds(parseJson(row.hook_templates_json, []));
  const vocabulary = rowIds(parseJson(row.vocabulary_json, []));
  const microTopics = rowIds(parseJson(row.micro_topics_json, []));
  const titles = signals.map(signal => signal.title || '').join(' ').toLowerCase();
  const csp = String(row.primary_csp || '').toLowerCase();
  const podcastTitleHits = countTitleHits(signals, /\b(podcast|interview|guest|conversation|founder talk|in conversation)\b/i);
  const examTitleHits = countTitleHits(signals, /\b(neet|jee|upsc|ssc|exam|exams|mock test|syllabus|board exam)\b/i);
  const explainerTitleHits = countTitleHits(signals, /^\s*(why|how|what)\b|\b(hidden|scam|behind|inside|truth about|rise of|fall of|explained)\b/i);
  const newsTitleHits = countTitleHits(signals, /\b(breaking|latest|live|update|updates|headlines|press conference|watch live|today news|says|said|killed|arrested|election|war|court|minister|president)\b/i);

  const hasPhoneTerms = textHas(titles, /\b(phone|smartphone|iphone|android|samsung|oneplus|pixel|xiaomi|redmi|vivo|oppo|camera|battery|specs|unboxing)\b/i);
  const hasReviewTerms = hasPhoneTerms && textHas(titles, /\b(review|unboxing|camera test|battery test|hands on|specs|launch)\b/i);
  const hasTradingTerms = textHas(titles, /\b(intraday|banknifty|nifty option|option chain|target price|stoploss|candlestick|chart pattern|buy sell|trading call)\b/i);
  const hasFinanceEducationTerms = textHas(titles, /\b(invest|investing|investment|stock|stocks|portfolio|mutual fund|sip|trading|nifty|banknifty|options?|tax saving)\b/i);
  const hasNewsTerms = textHas(titles, /\b(breaking|latest|live|update|updates|headlines|press conference|watch live|today news)\b/i);
  const isUnclassifiedCsp = csp.includes('unclassified') || !csp;
  const hasPodcastTerms = podcastTitleHits >= (isUnclassifiedCsp ? 3 : 5);
  const hasExamTerms = examTitleHits >= 2;

  const hasExplainerSignals = hasAny(thesis, [
    'hidden_economics', 'broken_system', 'investigation', 'tech_shift',
    'india_system', 'daily_life_system', 'consumer_deception', 'future_threat',
  ]) || hasAny(hooks, ['why_x', 'how_x', 'hidden_secret_hook', 'investigation_hook']);

  const hasBusinessCaseSignals = domains.has('brand_business') &&
    hasAny(thesis, ['hidden_economics', 'brand_business', 'consumer_deception', 'business_case']);
  const hasTechEssaySignals = domains.has('tech_ai') &&
    hasAny(thesis, ['tech_shift', 'hidden_economics', 'investigation', 'future_threat']);

  return {
    stable,
    formatMix,
    domains,
    thesis,
    hooks,
    vocabulary,
    microTopics,
    titles,
    csp,
    confidence: String(row.confidence || 'low'),
    confidenceScore: Number(row.confidence_score || 0),
    shortShare: Number(formatMix.short_clip_share || 0),
    longShare: Number(formatMix.long_form_share || 0),
    coverage: stable.coverage || {},
    hasPhoneTerms,
    hasReviewTerms,
    hasTradingTerms,
    hasFinanceEducationTerms,
    hasNewsTerms,
    hasPodcastTerms,
    hasExamTerms,
    podcastTitleHits,
    examTitleHits,
    explainerTitleHits,
    newsTitleHits,
    hasExplainerSignals,
    hasBusinessCaseSignals,
    hasTechEssaySignals,
    isPodcastCsp: isCsp(csp, ['podcast', 'conversation', 'guest_show']),
    isExplainerCsp: isCsp(csp, ['curiosity_explainer', 'business_case_study']),
    isFinanceCsp: isCsp(csp, ['finance_investment_education', 'personal_finance_guest_show']),
    isNewsCsp: isCsp(csp, ['news_event_bulletin']),
    isTechReviewCsp: isCsp(csp, ['tech_review_gadget']),
    isExamCsp: isCsp(csp, ['exam_demand_teaching']),
  };
}

function addFinding(findings, row, family, severity, reason, evidence) {
  findings.push({
    channel_id: row.channel_id,
    channel_name: row.channel_name || row.channel_id,
    csp: row.primary_csp || 'unknown',
    confidence: row.confidence || 'low',
    family,
    severity,
    reason,
    evidence,
  });
}

function auditChannel(row, signals) {
  const ctx = buildContext(row, signals);
  const findings = [];

  if (ctx.isExplainerCsp && ctx.hasReviewTerms) {
    addFinding(
      findings,
      row,
      'tech_review_vs_tech_essay',
      0.92,
      'Explainer/case-study CSP has phone-review title terms in stored DNA.',
      'phone/review/spec terms appear in recent stored titles',
    );
  }

  if (ctx.isTechReviewCsp && ctx.hasTechEssaySignals && !ctx.hasReviewTerms) {
    addFinding(
      findings,
      row,
      'tech_review_vs_tech_essay',
      0.82,
      'Tech-review CSP but DNA reads more like tech essay/explainer.',
      'tech_ai with tech_shift/hidden_economics and no gadget review terms',
    );
  }

  if (ctx.isFinanceCsp && ctx.hasBusinessCaseSignals && !ctx.hasFinanceEducationTerms) {
    addFinding(
      findings,
      row,
      'finance_education_vs_business_case',
      0.78,
      'Finance-education CSP but DNA looks like brand/business case study.',
      'brand_business plus hidden/business thesis without finance-education terms',
    );
  }

  if (!ctx.isFinanceCsp && (ctx.isExplainerCsp || ctx.hasBusinessCaseSignals) && ctx.hasTradingTerms) {
    addFinding(
      findings,
      row,
      'finance_education_vs_business_case',
      0.86,
      'Explainer/case-study DNA is contaminated by trading-tip language.',
      'intraday/nifty/options/target/chart terms detected',
    );
  }

  if (ctx.isNewsCsp && ctx.hasExplainerSignals && !ctx.hasNewsTerms && ctx.explainerTitleHits >= 8 && ctx.newsTitleHits < 8) {
    addFinding(
      findings,
      row,
      'news_vs_explainer',
      0.76,
      'News CSP but cached DNA has evergreen explainer patterns.',
      `${ctx.explainerTitleHits} explainer-style titles and ${ctx.newsTitleHits} news-bulletin titles`,
    );
  }

  if (ctx.isExplainerCsp && ctx.hasNewsTerms && !ctx.hasExplainerSignals) {
    addFinding(
      findings,
      row,
      'news_vs_explainer',
      0.74,
      'Explainer CSP but stored DNA looks like current-news bulletin content.',
      'breaking/latest/live/update terms dominate the stored titles',
    );
  }

  if (ctx.isPodcastCsp && !ctx.hasPodcastTerms && ctx.hasExplainerSignals) {
    addFinding(
      findings,
      row,
      'podcast_vs_solo',
      0.72,
      'Podcast/conversation CSP but DNA looks like solo explainer titles.',
      'explainer hooks/thesis found without podcast/interview/guest terms',
    );
  }

  if (!ctx.isPodcastCsp && ctx.hasPodcastTerms && !ctx.isNewsCsp) {
    addFinding(
      findings,
      row,
      'podcast_vs_solo',
      0.7,
      'Non-podcast CSP but stored DNA contains podcast/interview markers.',
      `${ctx.podcastTitleHits} stored titles contain podcast/interview/guest/conversation terms`,
    );
  }

  if (ctx.isExamCsp && !ctx.hasExamTerms && ctx.hasExplainerSignals) {
    addFinding(
      findings,
      row,
      'education_vs_exam_prep',
      0.75,
      'Exam-prep CSP but DNA looks like broader explainer content.',
      'explainer thesis/hooks present without exam/syllabus/mock terms',
    );
  }

  if (!ctx.isExamCsp && ctx.hasExamTerms && !ctx.isNewsCsp) {
    addFinding(
      findings,
      row,
      'education_vs_exam_prep',
      0.72,
      'Non-exam CSP but stored DNA contains exam-prep markers.',
      `${ctx.examTitleHits} stored titles contain NEET/JEE/UPSC/exam/syllabus/mock terms`,
    );
  }

  if (!ctx.isNewsCsp && (ctx.isExplainerCsp || ctx.isPodcastCsp || ctx.hasBusinessCaseSignals) && ctx.shortShare >= 0.9 && Number(row.long_count || 0) < 3) {
    addFinding(
      findings,
      row,
      'format_evidence_warning',
      0.46,
      'Stored latest uploads are short-heavy for a strategy that may need long-form evidence.',
      `short_share=${ctx.shortShare}; long_count=${row.long_count}`,
    );
  }

  const coverageAvg = (
    Number(ctx.coverage.domain || 0) +
    Number(ctx.coverage.thesis || 0) +
    Number(ctx.coverage.hook || 0) +
    Number(ctx.coverage.micro_topic || 0)
  ) / 4;
  if (ctx.confidence === 'low' && Number(row.sample_count || 0) >= 30 && coverageAvg < 0.45) {
    addFinding(
      findings,
      row,
      'language_signal_gap',
      0.64,
      'DNA confidence is low even with enough stored uploads; title script/language may need a dedicated extractor.',
      `coverage_avg=${coverageAvg.toFixed(3)}`,
    );
  }

  return findings;
}

function printSummary(rows, findings, options, backfill) {
  const filtered = options.family
    ? findings.filter(f => f.family === options.family)
    : findings;

  const byFamily = new Map();
  for (const finding of filtered) {
    byFamily.set(finding.family, (byFamily.get(finding.family) || 0) + 1);
  }

  console.log('\n=== Creator DNA Failure Family Audit ===');
  console.log(`Audited channels : ${rows.length}`);
  console.log(`Findings         : ${filtered.length}`);
  console.log(`Family filter    : ${options.family || 'all'}`);
  console.log(`Backfill missing : ${backfill.attempted} attempted, ${backfill.ok} ok, ${backfill.failed} failed`);

  console.log('\nFindings by family:');
  if (!byFamily.size) {
    console.log('  none');
  } else {
    [...byFamily.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .forEach(([family, count]) => console.log(`  ${family.padEnd(36)} ${count}`));
  }

  console.log('\nTop findings:');
  const top = filtered
    .sort((a, b) => b.severity - a.severity || a.channel_name.localeCompare(b.channel_name))
    .slice(0, options.maxFindings);

  if (!top.length) {
    console.log('  none');
    return;
  }

  for (const finding of top) {
    console.log(
      `  [${finding.severity.toFixed(2)}] ${finding.channel_name} | ` +
      `${finding.family} | csp=${finding.csp} | conf=${finding.confidence}`,
    );
    console.log(`       ${finding.reason}`);
    console.log(`       evidence: ${finding.evidence}`);
  }
}

function main() {
  const db = getDb();
  const options = {
    limit: toInt(argValue('--limit'), 100),
    maxFindings: toInt(argValue('--max-findings'), 40),
    family: argValue('--family'),
    backfillMissing: hasFlag('--backfill-missing'),
    backfillLimit: toInt(argValue('--backfill-limit'), 25),
    videoLimit: toInt(argValue('--video-limit'), DEFAULT_VIDEO_LIMIT),
  };

  const backfill = maybeBackfillMissing(db, options);
  const rows = loadAuditRows(db, options.limit);
  const findings = [];

  for (const row of rows) {
    const signals = loadSignals(db, row.channel_id);
    findings.push(...auditChannel(row, signals));
  }

  printSummary(rows, findings, options, backfill);
}

try {
  main();
} catch (e) {
  console.error('[creator-dna-audit] Fatal:', e.stack || e.message);
  process.exitCode = 1;
}

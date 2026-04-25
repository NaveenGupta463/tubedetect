// ── Thresholds ────────────────────────────────────────────────────────────────
const STRENGTH_THRESHOLD = 70;
const WEAKNESS_THRESHOLD = 50;
const TARGET_SCORE       = 70;

// ── Insight mode ──────────────────────────────────────────────────────────────
export function getInsightMode(videoType) {
  if (videoType === 'LEGACY_VIRAL' || videoType === 'EARLY') return 'CONTEXT';
  if (videoType === 'DORMANT') return 'DIAGNOSE';
  return 'OPTIMIZE'; // VIRAL_SPIKE, ACTIVE_GROWTH, STABLE
}

// ── CONTEXT: explanation-only, no optimization advice ─────────────────────────
function buildContextInsights(videoType) {
  if (videoType === 'EARLY') {
    return [
      'This video is in its early distribution phase — signals are not yet stable',
      'YouTube typically takes 24–72 hours to fully index and distribute new content',
      'Engagement and velocity metrics will stabilize as the algorithm tests reach',
    ];
  }
  // LEGACY_VIRAL
  return [
    'This video has reached peak distribution — any current velocity is periodic resurfacing, not active growth',
    'Performance changes at this scale are cyclical and not driven by optimization signals',
    'This video represents a proven viral format — use it as a reference for future content, not an optimization target',
  ];
}

function buildContextPrimaryIssue(videoType) {
  if (videoType === 'EARLY') {
    return { message: 'Video is in early distribution phase — signals are not yet stable enough for conclusions' };
  }
  return { message: 'This is a legacy viral video — current performance reflects periodic resurfacing, not actionable optimization opportunities' };
}

// ── OPTIMIZE: actionable score insights ───────────────────────────────────────
function buildOptimizeInsights(dimensionScores, mode) {
  const { engagement = 0, velocity, discussion = 0 } = dimensionScores;
  const hasVelocity = velocity !== null && velocity !== undefined;
  const insights = [];

  if (hasVelocity) {
    if (velocity > 70 && engagement < 45) {
      insights.push({
        type: 'warning', dimension: 'engagement',
        message: 'Strong reach but low interaction — improve hook clarity or add a specific CTA to convert passive viewers',
        impact: 'high',
      });
    }
    if (engagement > 65 && velocity < 40) {
      insights.push({
        type: 'warning', dimension: 'velocity',
        message: 'Strong audience response but limited reach — title or thumbnail may be limiting click-through',
        impact: 'high',
      });
    }
  }

  if (mode === 'oauth' && engagement < 40) {
    insights.push({
      type: 'warning', dimension: 'engagement',
      message: 'CTR or retention is below baseline — review thumbnail appeal and opening hook',
      impact: 'high',
    });
  }

  if (discussion > 65) {
    insights.push({
      type: 'info', dimension: 'discussion',
      message: 'Above-average comment activity — lean into debate or opinion-driven content structure',
      impact: 'low',
    });
  }

  if (insights.length === 0) {
    insights.push({
      type: 'info', dimension: null,
      message: 'Performance is aligned with expected behavior for this niche — focus on sustaining current patterns',
      impact: 'low',
    });
  }

  return insights;
}

// ── DIAGNOSE: observational insights, no instructions ─────────────────────────
function buildDiagnosticInsights(dimensionScores, videoType, mode) {
  const { engagement = 0, velocity, discussion = 0 } = dimensionScores;
  const hasVelocity = velocity !== null && velocity !== undefined;
  const insights = [];

  insights.push('View velocity has dropped significantly below channel average — this video is no longer in active distribution');

  if (hasVelocity && velocity > 70 && engagement < 45) {
    insights.push('Reach was above average but audience interaction remained low — passive consumption pattern');
  } else if (engagement > 65 && hasVelocity && velocity < 40) {
    insights.push('Audience interaction was strong relative to baseline but distribution remained limited');
  }

  if (engagement < 40) {
    insights.push('Engagement fell below niche baseline — content did not generate an active audience response');
  }

  if (hasVelocity && velocity < 30) {
    insights.push('View velocity was significantly below channel average during the distribution window');
  }

  if (discussion > 65) {
    insights.push('Comment-to-like ratio was above niche baseline — content generated conversation');
  }

  if (mode === 'oauth' && engagement < 40) {
    insights.push('CTR or retention data indicates content underperformed during the impression window');
  }

  if (insights.length <= 1) {
    insights.push('Performance metrics are consistent with expected behavior for this video type');
  }

  return insights;
}

// ── AI signal diagnostics (OPTIMIZE only) ────────────────────────────────────
function buildAiDiagnostics(aiSignals, dimensionScores) {
  if (!aiSignals) return [];

  const diagnostics = [];
  const { velocity, engagement } = dimensionScores;
  const hasVelocity = velocity !== null && velocity !== undefined;

  const pkg = aiSignals?.packaging || {};
  const seo = aiSignals?.seo       || {};

  const packagingWeak =
    (pkg.title_clarity ?? 10) < 5 ||
    (pkg.title_curiosity ?? 10) < 5 ||
    (pkg.title_emotion ?? 10) < 5;

  const seoWeak =
    (seo.keyword_alignment ?? 10) < 5 ||
    (seo.search_potential  ?? 10) < 5;

  if (packagingWeak && hasVelocity && velocity < 50) {
    diagnostics.push({
      type: 'diagnostic', dimension: 'packaging',
      message: 'Weak title or thumbnail signals — low CTR may be caused by packaging, not content quality',
      fix: 'Add a specific outcome or number to the title. Increase contrast or add a face to the thumbnail.',
      impact: 'high',
    });
  }

  if (seoWeak && hasVelocity && velocity < 50) {
    diagnostics.push({
      type: 'diagnostic', dimension: 'seo',
      message: 'Low keyword alignment — search and recommendation surfaces are not surfacing this video',
      fix: 'Move the primary keyword to the first 5 words of the title. Match it verbatim in the first sentence of the description.',
      impact: 'medium',
    });
  }

  if (packagingWeak && engagement > 65) {
    diagnostics.push({
      type: 'diagnostic', dimension: 'packaging',
      message: 'Strong content quality but weak packaging — improving the title or thumbnail could significantly expand reach',
      fix: 'The content is already performing well for viewers who find it. Focus packaging improvements on increasing discoverability.',
      impact: 'high',
    });
  }

  return diagnostics;
}

// ── Summaries ─────────────────────────────────────────────────────────────────
function buildSummaries(dimensionScores) {
  const DIM_LABELS = { engagement: 'Engagement', velocity: 'Velocity', discussion: 'Discussion' };

  const strengths = Object.entries(dimensionScores)
    .filter(([, s]) => s != null && s >= STRENGTH_THRESHOLD)
    .map(([k]) => `Strong ${DIM_LABELS[k]}`)
    .join('. ');

  const weaknesses = Object.entries(dimensionScores)
    .filter(([, s]) => s != null && s < WEAKNESS_THRESHOLD)
    .map(([k]) => `Low ${DIM_LABELS[k]}`)
    .join('. ');

  return { strengths, weaknesses };
}

// ── OPTIMIZE: action targets ──────────────────────────────────────────────────
function buildActionTargets(dimensionScores) {
  const WEIGHTS = { engagement: 0.5, velocity: 0.3, discussion: 0.2 };
  const LABELS  = { engagement: 'Engagement', velocity: 'Velocity', discussion: 'Discussion' };

  const dims = Object.entries(dimensionScores)
    .filter(([, s]) => s !== null && s !== undefined)
    .map(([k, s]) => ({ key: k, score: s, weight: WEIGHTS[k] ?? 0 }))
    .sort((a, b) => (a.score * a.weight) - (b.score * b.weight));

  const worst = dims[0];
  const primaryIssue = worst
    ? {
        message: `Low ${LABELS[worst.key]} is the primary constraint`,
        impact:  Math.max(0, (TARGET_SCORE - worst.score) * worst.weight),
      }
    : { message: 'None', impact: 0 };

  const candidates = dims.filter(d => d.score < TARGET_SCORE);
  const biggestOpportunity = candidates.length > 0
    ? {
        message:      `Improving ${LABELS[candidates[0].key]} would have the highest impact`,
        potentialGain: (TARGET_SCORE - candidates[0].score) * candidates[0].weight,
      }
    : { message: 'All dimensions performing well', potentialGain: 0 };

  return { primaryIssue, biggestOpportunity };
}

// ── DIAGNOSE: observational primary issue ─────────────────────────────────────
function buildDiagnosticPrimaryIssue(dimensionScores) {
  const WEIGHTS = { engagement: 0.5, velocity: 0.3, discussion: 0.2 };
  const LABELS  = { engagement: 'Engagement', velocity: 'Velocity', discussion: 'Discussion' };

  const dims = Object.entries(dimensionScores)
    .filter(([, s]) => s !== null && s !== undefined)
    .map(([k, s]) => ({ key: k, score: s, weight: WEIGHTS[k] ?? 0 }))
    .sort((a, b) => (a.score * a.weight) - (b.score * b.weight));

  const worst = dims[0];
  const primaryIssue = worst && worst.score < TARGET_SCORE
    ? { message: `Low ${LABELS[worst.key]} was the primary performance constraint` }
    : { message: 'Performance was consistent with expected baseline' };

  return { primaryIssue };
}

// ── Diagnosis list ────────────────────────────────────────────────────────────
function buildDiagnosis(dimensionScores, mode) {
  const { engagement, velocity, discussion } = dimensionScores;
  const hasVelocity = velocity !== null && velocity !== undefined;

  const diagnosis = [];
  if (engagement < 45)                          diagnosis.push('Low engagement signals suppressed distribution');
  if (hasVelocity && velocity < 30)             diagnosis.push('View velocity fell below channel average');
  if (mode === 'oauth' && engagement < 40)      diagnosis.push('CTR or retention weakness limited reach');
  if (discussion > 70)                          diagnosis.push('High comment-to-like ratio — discussion-driven content');
  if (diagnosis.length === 0)                   diagnosis.push('No major issues detected');
  return diagnosis;
}

// ── OPTIMIZE: action cards ────────────────────────────────────────────────────
function buildActions(dimensionScores, aiDiagnostics) {
  const MESSAGES = {
    engagement: 'Viewers are not engaging at expected rates for this niche',
    velocity:   'View velocity is trailing the channel average',
    discussion: 'Comment activity is below baseline',
  };
  const FIX_ACTIONS = {
    engagement: {
      fix:    'End each section with a direct CTA tied to the content. Pin a question comment referencing a specific moment.',
      impact: 'Engagement signals in the first hour trigger algorithm distribution.',
    },
    velocity: {
      fix:    'Improve thumbnail contrast and add a face or specific number. Move the primary keyword to the first 5 words.',
      impact: 'Higher CTR directly increases impression-to-view conversion and distribution.',
    },
    discussion: {
      fix:    'Ask a specific opinion question within the first 60 seconds. Reference real events or controversies.',
      impact: 'Comment velocity in the first 24 hours directly influences recommendation probability.',
    },
  };
  const PRIORITY = { engagement: 'HIGH', velocity: 'HIGH', discussion: 'MEDIUM' };

  const actions = Object.entries(dimensionScores)
    .filter(([, s]) => s !== null && s !== undefined && s < 60)
    .map(([dim, score]) => {
      const base     = FIX_ACTIONS[dim];
      const priority = score < 30 ? 'HIGH' : PRIORITY[dim];
      return base
        ? { priority, dimension: dim, issue: MESSAGES[dim], fix: base.fix, impact: base.impact }
        : null;
    })
    .filter(Boolean);

  for (const d of aiDiagnostics) {
    if (d.fix) {
      actions.push({
        priority:  d.impact === 'high' ? 'HIGH' : 'MEDIUM',
        dimension: d.dimension,
        issue:     d.message,
        fix:       d.fix,
        impact:    d.message,
      });
    }
  }

  actions.sort((a, b) => (a.priority === 'HIGH' ? -1 : 1) - (b.priority === 'HIGH' ? -1 : 1));
  return actions;
}

// ── Main export ───────────────────────────────────────────────────────────────
export function generateInsights(truthOutput, aiSignals = null) {
  const { dimensionScores, mode, videoType = 'STABLE' } = truthOutput;
  const insightMode = getInsightMode(videoType);

  const { strengths, weaknesses } = buildSummaries(dimensionScores);
  const diagnosis = buildDiagnosis(dimensionScores, mode);

  if (insightMode === 'CONTEXT') {
    const diagnostics  = buildContextInsights(videoType);
    const primaryIssue = buildContextPrimaryIssue(videoType);
    return {
      insightMode,
      insights:           diagnostics,
      strengths,
      weaknesses,
      diagnosis,
      diagnostics,
      primaryIssue,
      biggestOpportunity: null,
      actions:            [],
    };
  }

  if (insightMode === 'DIAGNOSE') {
    const diagnostics      = buildDiagnosticInsights(dimensionScores, videoType, mode);
    const { primaryIssue } = buildDiagnosticPrimaryIssue(dimensionScores);
    return {
      insightMode,
      insights:           diagnostics,
      strengths,
      weaknesses,
      diagnosis,
      diagnostics,
      primaryIssue,
      biggestOpportunity: null,
      actions:            [],
    };
  }

  // OPTIMIZE mode
  const scoreInsights    = buildOptimizeInsights(dimensionScores, mode);
  const aiDiagnostics    = buildAiDiagnostics(aiSignals, dimensionScores);
  const { primaryIssue, biggestOpportunity } = buildActionTargets(dimensionScores);
  const actions          = buildActions(dimensionScores, aiDiagnostics);

  return {
    insightMode,
    insights:           [...scoreInsights, ...aiDiagnostics],
    strengths,
    weaknesses,
    diagnosis,
    diagnostics:        null,
    primaryIssue,
    biggestOpportunity,
    actions,
  };
}

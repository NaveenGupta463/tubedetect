// src/engines/shortsIntelligenceEngine.js
// Pure deterministic module — no AI calls, no side effects.
// Receives aiInsights as input from caller.

// ─── Problem normalization ────────────────────────────────────────────────────

const CONCEPT_FAILURE_SET = new Set(['SCROLL_KILLER', 'FLAT_LOW_RETENTION']);

function normalizeProblem(problem) {
  return CONCEPT_FAILURE_SET.has(problem) ? 'CONCEPT_FAILURE' : problem;
}

// ─── Retention segmentation ───────────────────────────────────────────────────

function getSegments(duration) {
  if (duration <= 30) {
    return {
      hookEnd:  duration * 0.15,
      earlyEnd: duration * 0.35,
      midEnd:   duration * 0.80,
    };
  }
  return { hookEnd: 2, earlyEnd: 5, midEnd: duration * 0.80 };
}

function retentionAt(curve, targetTime) {
  let closest = curve[0];
  let minDiff = Math.abs(curve[0].time - targetTime);
  for (const pt of curve) {
    const diff = Math.abs(pt.time - targetTime);
    if (diff < minDiff) { minDiff = diff; closest = pt; }
  }
  return closest.retention;
}

function avgRetentionBetween(curve, t0, t1) {
  const pts = curve.filter(p => p.time >= t0 && p.time <= t1);
  if (!pts.length) return null;
  return pts.reduce((s, p) => s + p.retention, 0) / pts.length;
}

function steadyMidDecline(curve, earlyEnd, midEnd) {
  const pts = curve.filter(p => p.time >= earlyEnd && p.time <= midEnd);
  if (pts.length < 2) return false;
  return pts[0].retention - pts[pts.length - 1].retention > 30;
}

function sharpEndDrop(curve, midEnd) {
  const pts = curve.filter(p => p.time >= midEnd);
  if (pts.length < 2) return false;
  return pts[0].retention - pts[pts.length - 1].retention > 20;
}

// ─── OAuth retention analysis ─────────────────────────────────────────────────

function analyzeRetentionCurve(curve, duration) {
  const { hookEnd, earlyEnd, midEnd } = getSegments(duration);

  const startRetention  = retentionAt(curve, 0);
  const hookRetention   = retentionAt(curve, hookEnd);
  const earlyRetention  = retentionAt(curve, earlyEnd);
  const midRetention    = avgRetentionBetween(curve, earlyEnd, midEnd) ?? hookRetention;
  const endRetention    = retentionAt(curve, curve[curve.length - 1].time);

  const dropRateFirst = startRetention - hookRetention;
  const earlyDrop     = hookRetention - earlyRetention;

  // Anomaly detection
  const anomalies = [];
  for (let i = 1; i < curve.length; i++) {
    const prev  = curve[i - 1];
    const curr  = curve[i];
    const delta = curr.retention - prev.retention;
    const dt    = curr.time - prev.time;
    if (delta < -15 && dt <= 2)         anomalies.push({ type: 'sudden_drop',     time: curr.time, delta });
    else if (Math.abs(delta) < 1 && dt >= 3) anomalies.push({ type: 'plateau',   startTime: prev.time, endTime: curr.time });
    else if (delta > 2)                  anomalies.push({ type: 'rewatch_spike',  time: curr.time, delta });
  }

  // Problem classification (ordered by severity)
  let problem;
  if (dropRateFirst > 35 || hookRetention < 60) {
    problem = 'HOOK_FAIL';
  } else if (earlyDrop > 25) {
    problem = 'EARLY_DROP';
  } else if (midRetention < 40) {
    problem = 'FLAT_LOW_RETENTION';
  } else if (steadyMidDecline(curve, earlyEnd, midEnd)) {
    problem = 'MID_DROP';
  } else if (sharpEndDrop(curve, midEnd)) {
    problem = 'LATE_DROP';
  } else if (midRetention > 70 && hookRetention > 70) {
    problem = 'STRONG_RETENTION';
  } else {
    problem = 'MID_DROP';
  }

  return {
    problem,
    metrics: { hookRetention, midRetention, endRetention, dropRateFirst },
    anomalies,
  };
}

// ─── Public inference (no OAuth) ─────────────────────────────────────────────

function inferProblem(velocityRatio, likeRate) {
  if (velocityRatio > 1.5 && likeRate > 0.06)               return { problem: 'STRONG_SHORT',      confidence: 0.70 };
  if (velocityRatio < 0.7)                                   return { problem: 'HOOK_FAIL',          confidence: 0.60 };
  if (velocityRatio >= 0.7 && likeRate < 0.02)               return { problem: 'LOW_SATISFACTION',   confidence: 0.65 };
  if (velocityRatio < 0.7 && likeRate > 0.05)                return { problem: 'DISTRIBUTION_WEAK',  confidence: 0.65 };
  return                                                            { problem: 'SCROLL_KILLER',      confidence: 0.60 };
}

// ─── History processing ───────────────────────────────────────────────────────

function processHistory(history, currentProblem, mode) {
  if (!history?.length) {
    return { triedChangeTypes: new Set(), escalate: false, switchStrategy: false };
  }

  const triedChangeTypes = new Set();
  history.forEach(h => (h.changes || []).forEach(c => triedChangeTypes.add(c.type)));

  const sameProblemCount = history.filter(h => h.problem === currentProblem).length;

  return {
    triedChangeTypes,
    escalate:       sameProblemCount >= 1,
    switchStrategy: mode === 'HYBRID_SHORT' ? false : sameProblemCount >= 2,
  };
}

// ─── Iteration engine ─────────────────────────────────────────────────────────

const PROBLEM_ACTIONS = {
  HOOK_FAIL: [
    { type: 'HOOK',    action: 'Replace opening 2 seconds',         instruction: 'Remove any intro or setup. Start with the core tension or payoff immediately.' },
    { type: 'PACING',  action: 'Cut dead air in first 3 seconds',   instruction: 'Eliminate pauses, slow reveals, or context-setting before the hook lands.' },
  ],
  EARLY_DROP: [
    { type: 'CLARITY',   action: 'Improve post-hook clarity',       instruction: 'After the hook, deliver one clear sentence explaining what the viewer will get. Remove all ambiguity.' },
    { type: 'STRUCTURE', action: 'Tighten 2–5 second segment',      instruction: 'Reduce to one clear statement or visual before moving to the build.' },
  ],
  MID_DROP: [
    { type: 'PACING', action: 'Add pattern interrupts every 3 seconds', instruction: 'Change angle, cut style, or visual every 2–3 seconds through the middle section.' },
    { type: 'ENERGY', action: 'Increase mid-video energy',          instruction: 'Speed up delivery, add B-roll, or cut to key moments.' },
  ],
  LATE_DROP: [
    { type: 'PAYOFF', action: 'Strengthen ending payoff',           instruction: 'Move the payoff earlier or make the resolution more satisfying before the final drop.' },
    { type: 'LOOP',   action: 'Add loop-back ending',               instruction: 'End with a callback to the opening hook to encourage rewatches.' },
  ],
  LOW_SATISFACTION: [
    { type: 'PAYOFF', action: 'Improve emotional or informational payoff', instruction: 'High views but low likes indicate the video does not deliver on its implied promise. Increase depth or emotional resonance of the conclusion.' },
  ],
  DISTRIBUTION_WEAK: [
    { type: 'FRAMING', action: 'Reframe topic angle',               instruction: 'Strong engagement from existing viewers but weak reach. Test a more broadly appealing angle or title framing.' },
  ],
  CONCEPT_FAILURE: [
    { type: 'CONCEPT', action: 'Change core idea',                  instruction: 'Consistently low retention indicates the concept is not engaging. Shift to a curiosity-driven, emotionally engaging, or broadly relatable idea.' },
  ],
  STRONG_RETENTION: [],
  STRONG_SHORT:     [],
  TOO_EARLY:        [],
};

function buildChanges(mappedProblem, triedChangeTypes, escalate, switchStrategy, aiInsights, mode) {
  if (mappedProblem === 'TOO_EARLY') return [];

  let actions = (PROBLEM_ACTIONS[mappedProblem] || []).filter(a => !triedChangeTypes.has(a.type));

  if (switchStrategy && mappedProblem !== 'CONCEPT_FAILURE') {
    actions = [...PROBLEM_ACTIONS['CONCEPT_FAILURE']];
  }

  // HYBRID_SHORT: hook failure is not treated as the only issue — add clarity alongside
  if (mode === 'HYBRID_SHORT' && mappedProblem === 'HOOK_FAIL' && !triedChangeTypes.has('CLARITY')) {
    actions = [
      ...actions,
      { type: 'CLARITY', action: 'Improve topic clarity', instruction: 'Hook alone is not the full problem. Ensure the topic is immediately clear so viewers understand the value within the first 2 seconds.' },
    ];
  }

  if (escalate && actions.length > 0) {
    actions = actions.map(a => ({
      ...a,
      instruction: a.instruction + ' (Escalated: same problem persisted from previous version.)',
    }));
  }

  if (mappedProblem === 'CONCEPT_FAILURE' && aiInsights?.topicType === 'niche') {
    actions = actions.map(a => ({
      ...a,
      instruction: a.instruction + ' Shift from niche-specific to broadly relatable framing.',
    }));
  }

  if (mappedProblem === 'CONCEPT_FAILURE' && aiInsights?.hookStrength === 'weak') {
    actions = [
      ...actions,
      { type: 'HOOK', action: 'Rebuild hook alongside concept change', instruction: 'Weak hook compound the concept issue. New concept must open with a strong, specific hook.' },
    ].filter(a => !triedChangeTypes.has(a.type));
  }

  return actions.map(({ type, action, instruction }) => ({ type, action, instruction }));
}

// ─── Hook directions ──────────────────────────────────────────────────────────

const HOOK_DIRECTION_MAP = {
  HOOK_FAIL: [
    { type: 'curiosity',     angle: 'unexpected outcome',      instruction: 'Open with the surprising result before explaining how you got there.' },
    { type: 'contrarian',    angle: 'challenged assumption',   instruction: 'Start by directly challenging a belief your target viewer holds.' },
    { type: 'direct_payoff', angle: 'immediate value',         instruction: 'Lead with the most valuable insight in the first two seconds.' },
  ],
  EARLY_DROP: [
    { type: 'clarity',  angle: 'single clear promise',        instruction: 'Open with one specific, concrete promise of what the viewer will learn or experience.' },
    { type: 'stakes',   angle: 'why it matters now',          instruction: 'Immediately establish why this is personally relevant to the viewer.' },
    { type: 'curiosity',angle: 'unanswered question',         instruction: 'Pose a question the viewer cannot answer without watching through.' },
  ],
  MID_DROP: [
    { type: 'momentum',  angle: 'fast-paced reveal',          instruction: 'Hook should signal high-pacing so the viewer expects rapid information delivery.' },
    { type: 'curiosity', angle: 'layered open loop',          instruction: 'Plant two open questions in the hook so the viewer stays for both resolutions.' },
    { type: 'relatable', angle: 'shared frustration',         instruction: 'Open with a frustration or problem the viewer knows intimately.' },
  ],
  LATE_DROP: [
    { type: 'payoff_promise', angle: 'explicit ending tease', instruction: 'Hook must explicitly promise what happens at the end to build anticipation.' },
    { type: 'curiosity',      angle: 'outcome first',         instruction: 'Show the final result in the first frame, then reveal the path to it.' },
    { type: 'stakes',         angle: 'consequence framing',   instruction: 'Frame around what the viewer misses if they do not watch to the end.' },
  ],
  LOW_SATISFACTION: [
    { type: 'emotional', angle: 'emotional resonance',        instruction: 'Open with a moment of genuine emotion — surprise, inspiration, or deep relatability.' },
    { type: 'value',     angle: 'explicit value promise',     instruction: 'State clearly what the viewer will feel or know by the end.' },
    { type: 'curiosity', angle: 'counterintuitive insight',   instruction: 'Lead with a fact or finding that contradicts conventional wisdom.' },
  ],
  DISTRIBUTION_WEAK: [
    { type: 'broad_appeal', angle: 'universal framing',       instruction: 'Reframe the hook to appeal beyond viewers already familiar with the topic.' },
    { type: 'relatable',    angle: 'common experience',       instruction: 'Open with an experience that most people in your category have had.' },
    { type: 'trend',        angle: 'timely angle',            instruction: 'Connect the hook to a current trend or widely discussed topic.' },
  ],
  CONCEPT_FAILURE: [
    { type: 'curiosity',  angle: 'completely new angle',      instruction: 'Abandon the current framing. Lead with a question nobody in this space is currently asking.' },
    { type: 'relatable',  angle: 'broader human experience',  instruction: 'Connect to an emotion or situation that transcends the niche.' },
    { type: 'contrarian', angle: 'challenge category norms',  instruction: 'Open by challenging a norm your niche accepts without question.' },
  ],
  STRONG_RETENTION: [
    { type: 'scale',     angle: 'proven format replication',  instruction: 'Hook formula is working. Apply exact structure to a new topic.' },
    { type: 'variation', angle: 'twist on winning formula',   instruction: 'Keep hook structure but shift the subject or emotional driver.' },
    { type: 'intensity', angle: 'higher stakes same format',  instruction: 'Apply the same hook to a higher-stakes or more provocative topic.' },
  ],
  STRONG_SHORT: [
    { type: 'scale',    angle: 'proven format replication',   instruction: 'Hook formula is working. Apply exact structure to a new topic.' },
    { type: 'variation',angle: 'angle variation',             instruction: 'Keep the same hook type but shift the emotional angle.' },
    { type: 'contrast', angle: 'opposite angle same topic',   instruction: 'Take the winning hook and argue the opposite position.' },
  ],
  TOO_EARLY: [],
};

function buildHookDirections(inferredProblem, mappedProblem, aiInsights, mode) {
  const key = (mappedProblem !== inferredProblem) ? mappedProblem : inferredProblem;
  const base = HOOK_DIRECTION_MAP[key] || [];

  const directions = base.map(dir => {
    const enriched = { ...dir };
    if (aiInsights?.topicType)               enriched.topicType = aiInsights.topicType;
    if (aiInsights?.improvementHints?.length) enriched.context  = aiInsights.improvementHints[0];
    return enriched;
  });

  // HYBRID_SHORT: always lead with topic clarity direction
  if (mode === 'HYBRID_SHORT') {
    return [
      { type: 'clarity', instruction: 'Make the topic immediately clear in the first 2 seconds', angle: 'topic clarity' },
      ...directions,
    ];
  }

  return directions;
}

// ─── Structure + editing plans ────────────────────────────────────────────────

const STRUCTURE_PLANS = {
  HOOK_FAIL:         ['Hook (0–2s): immediate tension or payoff', 'Build (2–6s): single clear statement', 'Payoff', 'Loop ending'],
  EARLY_DROP:        ['Hook (0–2s)', 'Clear context (2–5s): one sentence', 'Build (5s–80%)', 'Payoff + loop'],
  MID_DROP:          ['Hook (0–2s)', 'Fast-paced build with cuts every 2–3s', 'Payoff', 'Loop ending'],
  LATE_DROP:         ['Hook (0–2s)', 'Build (2–80%)', 'Strong explicit payoff', 'Loop or callback'],
  LOW_SATISFACTION:  ['Hook (0–2s)', 'Build with rising stakes', 'High-value payoff moment', 'Emotional resolution'],
  DISTRIBUTION_WEAK: ['Broad-appeal hook (0–2s)', 'Universal context', 'Relatable payoff', 'Call to action or loop'],
  CONCEPT_FAILURE:   ['New concept hook (0–2s)', 'Strong single idea build', 'Clear payoff', 'Loop or strong close'],
  STRONG_RETENTION:  ['Replicate existing structure', 'Apply to new angle or topic'],
  STRONG_SHORT:      ['Replicate existing structure', 'Apply to new angle or topic'],
  TOO_EARLY:         [],
};

const EDITING_PLANS = {
  HOOK_FAIL:         ['Cut any content before the hook', 'Start on action or key visual', 'Remove first 1–2s if weak', 'Tighten to under 30s'],
  EARLY_DROP:        ['Cut dead air after hook', 'Remove context-setting before the promise', 'Tighten 2–5s to one visual or line'],
  MID_DROP:          ['Add fast cuts every 2–3s through middle', 'Remove dead air', 'Speed up delivery in mid section', 'Add B-roll or text overlays'],
  LATE_DROP:         ['Move payoff 5–10s earlier', 'Cut content after payoff lands', 'Add loop-back visual at end'],
  LOW_SATISFACTION:  ['Extend payoff section', 'Remove filler before resolution', 'Ensure ending delivers on hook promise'],
  DISTRIBUTION_WEAK: ['Reframe title and first frame', 'Broaden visual appeal', 'Test with different audio hook'],
  CONCEPT_FAILURE:   ['Start over with new core concept', 'Do not salvage existing edit', 'Rebuild from hook-first approach'],
  STRONG_RETENTION:  ['Keep exact edit structure', 'Apply same pacing to new topic', 'Do not over-edit winning formula'],
  STRONG_SHORT:      ['Keep exact edit structure', 'Apply same pacing to new topic'],
  TOO_EARLY:         [],
};

const GOALS = {
  HOOK_FAIL:         'Fix the opening to stop viewer drop-off in the first 2 seconds.',
  EARLY_DROP:        'Improve clarity and promise after the hook to retain early viewers.',
  MID_DROP:          'Add pacing and pattern interrupts to sustain mid-video attention.',
  LATE_DROP:         'Strengthen the ending payoff to keep viewers through completion.',
  LOW_SATISFACTION:  'Improve emotional or informational payoff to increase satisfaction and likes.',
  DISTRIBUTION_WEAK: 'Reframe topic and angle to improve algorithmic reach.',
  CONCEPT_FAILURE:   'Replace the core concept with a more engaging and relatable idea.',
  STRONG_RETENTION:  'Extract the winning pattern and apply it to new angles.',
  STRONG_SHORT:      'Extract the winning pattern and apply it to new angles.',
  TOO_EARLY:         'Insufficient data — revisit after 6+ hours.',
};

// ─── Pattern extraction (STRONG only) ────────────────────────────────────────

function extractPattern(aiInsights, likeRate, velocityRatio) {
  return {
    hookStyle:     aiInsights?.hookStyle     ?? 'unknown',
    pacingStyle:   aiInsights?.pacing        ?? 'unknown',
    structureType: aiInsights?.topicType     ?? 'unknown',
    hookStrength:  aiInsights?.hookStrength  ?? 'unknown',
    metrics:       { likeRate, velocityRatio },
    note: 'Replicate this pattern exactly. Apply to new angles or topics without altering the core structure.',
  };
}

// ─── Reasoning builder ────────────────────────────────────────────────────────

function buildReasoning(inferredProblem, mode, likeRate, velocityRatio, retentionMetrics, historyState) {
  if (inferredProblem === 'TOO_EARLY') {
    return 'Video is under 6 hours old. Velocity and engagement signals are not yet reliable for classification.';
  }

  const parts = [];

  if (mode === 'BEHAVIOR' && retentionMetrics) {
    const { hookRetention, dropRateFirst, midRetention } = retentionMetrics;
    parts.push(`Hook retention at 2s: ${hookRetention.toFixed(0)}%.`);
    if (dropRateFirst > 0) parts.push(`Initial drop: ${dropRateFirst.toFixed(0)} percentage points.`);
    parts.push(`Mid-section average retention: ${midRetention.toFixed(0)}%.`);
    parts.push('Detected from real retention curve data.');
  } else {
    parts.push(`Velocity ratio: ${velocityRatio.toFixed(2)}× channel average.`);
    parts.push(`Like rate: ${(likeRate * 100).toFixed(2)}%.`);
    parts.push('Inferred from public signals — no OAuth retention data available.');
  }

  if (historyState.escalate)      parts.push('Same problem detected in previous version — fix intensity escalated.');
  if (historyState.switchStrategy) parts.push('Problem persists across 2+ versions — switching to strategy-level change.');

  return parts.join(' ');
}

// ─── Main export ──────────────────────────────────────────────────────────────

export function analyzeShort(input, options = {}) {
  const subType = options.mode || 'PURE_SHORT'; // PURE_SHORT | HYBRID_SHORT from videoClassifier
  const {
    version                 = 1,
    hasOAuth                = false,
    views                   = 0,
    likes                   = 0,
    viewsPerHour            = 0,
    channelAvgViewsPerHour  = 1,
    duration                = 60,
    publishAgeHours         = 0,
    retentionCurve,
    aiInsights              = {},
    history                 = [],
  } = input;

  // Step 1: Derived metrics
  const likeRate      = views > 0 ? likes / views : 0;
  const velocityRatio = channelAvgViewsPerHour > 0 ? viewsPerHour / channelAvgViewsPerHour : 0;

  // Step 2: Problem detection
  let inferredProblem, mappedProblem, mode, confidence, retentionMetrics = null, anomalies = [];

  if (publishAgeHours < 6) {
    inferredProblem = 'TOO_EARLY';
    mappedProblem   = 'TOO_EARLY';
    mode            = 'INFERENCE';
    confidence      = 0.3;
  } else if (hasOAuth && retentionCurve?.length > 0) {
    const result    = analyzeRetentionCurve(retentionCurve, duration);
    inferredProblem = result.problem;
    mappedProblem   = normalizeProblem(result.problem);
    retentionMetrics = result.metrics;
    anomalies       = result.anomalies;
    mode            = 'BEHAVIOR';
    confidence      = subType === 'PURE_SHORT' ? 0.9 : 0.65;
  } else {
    const result    = inferProblem(velocityRatio, likeRate);
    inferredProblem = result.problem;
    mappedProblem   = normalizeProblem(result.problem);
    mode            = 'INFERENCE';
    confidence      = subType === 'PURE_SHORT' ? result.confidence : 0.65;
  }

  // Step 3: History processing
  const historyState = processHistory(history, inferredProblem, subType);

  // Step 4: Changes
  const changes = buildChanges(mappedProblem, historyState.triedChangeTypes, historyState.escalate, historyState.switchStrategy, aiInsights, subType);

  // Step 5: Hook directions
  const hookDirections = buildHookDirections(inferredProblem, mappedProblem, aiInsights, subType);

  // Step 6: Pattern extraction (STRONG only)
  const isStrong = inferredProblem === 'STRONG_SHORT' || inferredProblem === 'STRONG_RETENTION';
  const patternExtraction = isStrong ? extractPattern(aiInsights, likeRate, velocityRatio) : undefined;

  const planKey = mappedProblem !== inferredProblem ? mappedProblem : inferredProblem;

  const output = {
    nextVersion:     version + 1,
    mode,
    inferredProblem,
    mappedProblem,
    confidence,
    reasoning:       buildReasoning(inferredProblem, mode, likeRate, velocityRatio, retentionMetrics, historyState),
    goal:            GOALS[planKey] ?? '',
    changes,
    hookDirections,
    structurePlan:   STRUCTURE_PLANS[planKey] ?? [],
    editingPlan:     EDITING_PLANS[planKey]   ?? [],
    postingStrategy: {
      bestTime: 'unknown',
      note:     'Use channel audience analytics to determine peak hours if available.',
    },
  };

  if (patternExtraction) output.patternExtraction = patternExtraction;
  if (anomalies.length)  output.anomalies = anomalies;

  return output;
}

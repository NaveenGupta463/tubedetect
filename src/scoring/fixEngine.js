'use strict';

const DIM_WEIGHTS = {
  engagement: 0.50,
  velocity:   0.30,
  discussion: 0.20,
};

const TARGET_SCORE = 70;
const MAX_DELTA    = 25;

// ── Template examples ─────────────────────────────────────────────────────────

const TEMPLATE_EXAMPLES = {
  engagement: {
    pattern: 'Instead of: "Like and subscribe if you enjoyed!"',
    use:     '"Comment with [specific reaction tied to the content] — I read every one."',
  },
  velocity: {
    pattern: 'Instead of: a generic title with no hook',
    use:     '"[Specific number] [Specific outcome] in [Specific timeframe] — Without [Common Obstacle]"',
  },
  discussion: {
    pattern: 'Instead of: no question or call-to-debate',
    use:     '"Comment your take — [specific opinion question tied to the video topic]."',
  },
};

// ── AI example extraction ─────────────────────────────────────────────────────

const AI_EXAMPLE_MAP = {
  engagement: (imp) => {
    const text = imp?.cta?.text;
    return text ? { pattern: 'AI CTA:', use: text } : null;
  },
  velocity: (imp) => {
    const text = imp?.titles?.[0]?.text;
    return text ? { pattern: 'AI title rewrite:', use: text } : null;
  },
  discussion: (imp) => {
    const text = imp?.discussion_prompt?.text;
    return text ? { pattern: 'AI discussion prompt:', use: text } : null;
  },
};

// ── Score math ────────────────────────────────────────────────────────────────

function computeDelta(currentScore) {
  return Math.min(Math.max(0, TARGET_SCORE - currentScore), MAX_DELTA);
}

function deltaRange(rawDelta) {
  if (rawDelta <= 0) return null;
  const lo = Math.round(rawDelta * 0.6);
  const hi = Math.round(rawDelta * 0.9);
  return lo === hi ? `+${lo} pts` : `+${lo}–${hi} pts`;
}

function viralGain(dimension, rawDelta) {
  const weight   = DIM_WEIGHTS[dimension] ?? 0;
  const midpoint = rawDelta * 0.75;
  return Math.round(weight * midpoint * 10) / 10;
}

// ── Main export ───────────────────────────────────────────────────────────────

export function buildFixCards(actions, dimensionScores, improvements = null) {
  return actions.map((action) => {
    const { priority, dimension, issue, fix, impact } = action;

    const currentScore = dimensionScores?.[dimension] ?? 0;
    const rawDelta     = computeDelta(currentScore);
    const range        = deltaRange(rawDelta);
    const gain         = viralGain(dimension, rawDelta);

    const aiEx    = improvements ? AI_EXAMPLE_MAP[dimension]?.(improvements) ?? null : null;
    const baseEx  = TEMPLATE_EXAMPLES[dimension] ?? null;
    const example = aiEx
      ? { ...aiEx,   source: 'ai' }
      : baseEx
      ? { ...baseEx, source: 'template' }
      : null;

    return {
      priority,
      dimension,
      issue,
      exactFix: fix,
      example,
      expectedImpact: {
        currentScore,
        scoreDelta:     range,
        viralScoreGain: gain > 0 ? `+${gain.toFixed(1)} pts overall` : null,
        mechanism:      impact,
      },
    };
  });
}

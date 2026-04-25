// ── Schema version ────────────────────────────────────────────────────────────
export const SCHEMA_VERSION = 6;

// ── Baselines ─────────────────────────────────────────────────────────────────
// All rates in % (e.g. 4.5 = 4.5%, 8.0 = 8.0%)

const SHORTS_BASELINE = { likeRate: 8.0, commentRate: 0.2 }; // eslint-disable-line no-unused-vars

const NICHE_TO_CLUSTER = {
  'Education':         'knowledge',
  'Finance/Business':  'knowledge',
  'News/Politics':     'discussion',
  'Commentary':        'discussion',
  'Entertainment':     'entertainment',
  'Podcast/Long-form': 'longform',
};

const BEHAVIOR_CLUSTERS = {
  knowledge:     { likeRate: 4.5, commentRate: 0.30, velocityMult: 0.75, ctr: 3.5 },
  discussion:    { likeRate: 2.5, commentRate: 0.80, velocityMult: 1.30, ctr: 5.0 },
  entertainment: { likeRate: 4.0, commentRate: 0.50, velocityMult: 1.00, ctr: 6.0 },
  longform:      { likeRate: 5.0, commentRate: 0.70, velocityMult: 0.60, ctr: 2.5 },
};

const INDUSTRY_BASELINE = { likeRate: 4.0, commentRate: 0.50, velocityMult: 1.0, ctr: 4.5 };

export function getBaseline(niche) {
  const cluster = NICHE_TO_CLUSTER[niche] || null;
  return cluster ? BEHAVIOR_CLUSTERS[cluster] : INDUSTRY_BASELINE;
}


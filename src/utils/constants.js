// Shared constants — one source of truth for values used across multiple components.
// Score thresholds, cache key prefixes, and lookup lists live here.

export const NICHES = [
  'finance', 'fitness', 'business', 'technology', 'gaming',
  'cooking', 'travel', 'education', 'entertainment', 'health',
  'productivity', 'ai tools', 'entrepreneurship', 'lifestyle', 'other',
];

export const CACHE_KEYS = {
  tier:        'yta_tier',
  aiCalls:     'yta_ai_calls',
  aiPeriod:    'yta_ai_period',
  authToken:   'yta_token',
  ytPrefix:    'tubeintel_yt3_',
  workspace:   'tubeintel_workspaces',
};

export const SCORE = {
  HIGH:   70,
  MEDIUM: 50,
};

export const SCORE_COLORS = {
  high:   '#22c55e',
  medium: '#f59e0b',
  low:    '#ef4444',
};

export function scoreColor(s) {
  if (s >= SCORE.HIGH)   return SCORE_COLORS.high;
  if (s >= SCORE.MEDIUM) return SCORE_COLORS.medium;
  return SCORE_COLORS.low;
}

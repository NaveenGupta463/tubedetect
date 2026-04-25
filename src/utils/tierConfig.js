export const TIERS = { FREE: 'free', STARTER: 'starter', PRO: 'pro', AGENCY: 'agency' };

export const TIER_ORDER = { free: 0, starter: 1, pro: 2, agency: 3 };

export const TIER_LIMITS = {
  free:    { aiCalls: 5,        competitors: 0,        workspaces: 1,        pdfExport: false },
  starter: { aiCalls: 500,      competitors: 3,        workspaces: 6,        pdfExport: true  },
  pro:     { aiCalls: 2000,     competitors: Infinity, workspaces: 20,       pdfExport: true  },
  agency:  { aiCalls: Infinity, competitors: Infinity, workspaces: Infinity, pdfExport: true  },
};

// null = free for all
export const VIEW_TIER = {
  search:     null,
  channel:    null,
  video:      null,
  timing:     null,
  cadence:    null,
  seo:        null,
  workspaces: null,
  pricing:    null,
  validator:  null,
  competitor: 'starter',
  viral:      'starter',
  scorer:     'starter',
  sentiment:  'starter',
  script:     'starter',
  trends:     'starter',
  report:     'starter',
};

export function meetsRequirement(userTier, required) {
  if (!required) return true;
  return TIER_ORDER[userTier] >= TIER_ORDER[required];
}

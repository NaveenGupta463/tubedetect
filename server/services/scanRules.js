// Post-generation output scanner — Layer 3 enforcement.
// runScan(text, compiledPolicy) → { violations, autoFixed, fixedText }
//
// Each rule has:
//   pattern    — regex (must have global flag)
//   severity   — 'violation' (hard block) | 'warning' (log only)
//   type       — identifier string
//   description — human-readable
//   autoFix    — bool: can we replace inline and continue?
//   replacement — function(match) → string, used when autoFix=true

const RULES_BY_NICHE = {

  finance: [
    {
      // "you should buy HDFC Bank", "invest in Nifty ETF", "sell your ICICI shares"
      pattern: /\b(?:you should |I recommend |consider )?(?:buy|sell|invest in|purchase|acquire)\s+(?:your\s+)?(?:[A-Z][a-z]+\s+){0,3}(?:stocks?|shares?|fund|ETF|bond|options?|futures?)\b/gi,
      severity: 'violation',
      type:     'stock_recommendation',
      description: 'Specific securities buy/sell recommendation',
      autoFix:  false,
    },
    {
      // "past returns guarantee future performance"
      pattern: /past\s+(?:returns?|performance|gains?|results?)\s+(?:guarantee|predict|indicate|ensure|mean)\s+future/gi,
      severity: 'violation',
      type:     'past_returns_predictive',
      description: 'Past returns presented as predictive of future performance',
      autoFix:  false,
    },
    {
      // Bare financial figures like "7% interest rate" or "12% return" without a [VERIFY] marker
      pattern: /\b(\d{1,3}(?:\.\d+)?%)\s+(?:interest rate|annual return|APR|yield|return|growth rate|inflation rate)\b(?!\s*[\[（])/gi,
      severity: 'warning',
      type:     'unverified_financial_figure',
      description: 'Specific financial figure without VERIFY marker',
      autoFix:  true,
      replacement: (m) => `[VERIFY: ${m}]`,
    },
  ],

  health: [
    {
      // "cures cancer", "treats depression", "prevents diabetes"
      pattern: /\b(?:cure[sd]?|treat[sed]?|prevent[sed]?|eliminat(?:e[sd]?|ing)|reverse[sd]?)\s+(?:cancer|diabetes|depression|anxiety|hypertension|disease|condition|illness|disorder|pain)\b/gi,
      severity: 'violation',
      type:     'medical_cure_claim',
      description: 'Medical cure/treatment claim',
      autoFix:  true,
      replacement: (m) => `[MEDICAL CLAIM: "${m}" — verify with a healthcare professional]`,
    },
    {
      // "take 500mg of X", "dose of 10mg"
      pattern: /\btake\s+\d+\s*(?:mg|mcg|g|iu|ml)\b/gi,
      severity: 'violation',
      type:     'dosage_recommendation',
      description: 'Specific dosage recommendation',
      autoFix:  true,
      replacement: (m) => `[MEDICAL CLAIM: "${m}" — never recommend specific dosages]`,
    },
    {
      // "clinically proven to", "scientifically shown to" — often misleading
      pattern: /\b(?:clinically proven|scientifically proven|medically proven|proven to)\s+(?:cure|treat|prevent|boost|increase|decrease|reduce)\b/gi,
      severity: 'warning',
      type:     'unsubstantiated_clinical_claim',
      description: 'Unsubstantiated clinical claim',
      autoFix:  true,
      replacement: (m) => `[VERIFY: "${m}" — requires cited source]`,
    },
  ],

  history: [
    {
      // Quoted speech attributed to a historical figure without a source marker
      // Catches: Gandhi said: "...", Lincoln once said "..."
      pattern: /(?:[A-Z][a-z]+(?:\s[A-Z][a-z]+)*)\s+(?:said|wrote|declared|proclaimed|stated|claimed)[,:\s]+"([^"]{15,})"/gi,
      severity: 'warning',
      type:     'potential_fabricated_quote',
      description: 'Historical quote that may be fabricated — verify source',
      autoFix:  true,
      replacement: (m) => `[VERIFY: Historical quote — confirm source before using: ${m}]`,
    },
    {
      // Invented specific dates for undated events: "on March 14, 1857"
      pattern: /\bon (?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}\b/gi,
      severity: 'warning',
      type:     'specific_historical_date',
      description: 'Specific historical date that may need verification',
      autoFix:  true,
      replacement: (m) => `${m} [VERIFY: confirm this date]`,
    },
  ],

  travel: [
    {
      // Invented first-person experience: "I remember", "I felt", "I saw"
      pattern: /\bI\s+(?:remember|felt|saw|ate|visited|met|went to|experienced|found|discovered|noticed|tried|heard|smelled|tasted)\b/gi,
      severity: 'violation',
      type:     'invented_experience',
      description: 'First-person experience that was invented by Copilot',
      autoFix:  true,
      replacement: (m) => `[YOUR EXPERIENCE: describe what you actually ${m.split(' ').pop()} here]`,
    },
    {
      // "We had the best chai" — also invented
      pattern: /\bwe\s+(?:had|ate|visited|went|tried|found|experienced|discovered)\b/gi,
      severity: 'warning',
      type:     'invented_we_experience',
      description: 'Invented "we" experience',
      autoFix:  true,
      replacement: (m) => `[YOUR EXPERIENCE: describe what ${m.replace(/\bwe\b/i, 'you')} in reality]`,
    },
    {
      // Specific prices without [VERIFY]: "$50 per night", "₹2000 for entry"
      pattern: /(?:\$|₹|€|£|USD\s*)\d+(?:,\d{3})*(?:\.\d+)?\s*(?:per night|per day|entry fee|for a meal|total)?\b(?!\s*[\[（])/gi,
      severity: 'warning',
      type:     'unverified_price',
      description: 'Specific price without VERIFY marker',
      autoFix:  true,
      replacement: (m) => `[VERIFY: ${m} — prices change, confirm before filming]`,
    },
  ],

  truecrime: [
    {
      // Invented witness statements
      pattern: /(?:witness(?:es)?|victim|suspect)\s+said[,:\s]+"([^"]{10,})"/gi,
      severity: 'violation',
      type:     'invented_witness_statement',
      description: 'Invented witness/victim statement',
      autoFix:  true,
      replacement: (m) => `[VERIFY: Statement needs source — never invent: ${m}]`,
    },
  ],
};

// Niches that alias to another niche's rules
const NICHE_RULE_MAP = {
  realestate:   'finance',
  news:         'history',     // citation rules apply
  science:      'health',      // medical-style claim rules apply loosely
  education:    'history',
  sports_analysis: 'history',
  sports_reaction: 'travel',   // experience-based
  fitness_educational: 'health',
  fitness_experiment:  'travel', // personal experience
  cooking_cookalong:   'travel',
  beauty_haul:         'travel',
  cars_review:         'travel',
  tech_review:         'travel',
};

// comedy, general, selfimprovement, gaming, etc. have no scan rules —
// they allow invent_story and invent_examples, so false positives would be catastrophic.

function getRulesForNiche(nicheKey) {
  const resolved = NICHE_RULE_MAP[nicheKey] || nicheKey;
  return RULES_BY_NICHE[resolved] || [];
}

// Run scan on text, returns:
// { violations: [...], warnings: [...], autoFixed: bool, fixedText: string }
function runScan(text, compiledPolicy) {
  if (!text) return { violations: [], warnings: [], autoFixed: false, fixedText: text };

  // Collect rules from primary niche and any secondary niche embedded in the label
  const niches = compiledPolicy.niche.split('+').map(s => s.trim());
  const allRules = [];
  const seen = new Set();
  for (const n of niches) {
    for (const rule of getRulesForNiche(n)) {
      if (!seen.has(rule.type)) { seen.add(rule.type); allRules.push(rule); }
    }
  }

  if (!allRules.length) {
    return { violations: [], warnings: [], autoFixed: false, fixedText: text };
  }

  const violations = [];
  const warnings   = [];
  let fixedText    = text;
  let autoFixed    = false;

  for (const rule of allRules) {
    rule.pattern.lastIndex = 0;
    const matches = [...fixedText.matchAll(rule.pattern)];
    if (!matches.length) continue;

    for (const match of matches) {
      const entry = {
        type:        rule.type,
        severity:    rule.severity,
        description: rule.description,
        match:       match[0],
        autoFix:     rule.autoFix,
      };

      if (rule.severity === 'violation') violations.push(entry);
      else warnings.push(entry);

      if (rule.autoFix && rule.replacement) {
        fixedText = fixedText.replace(match[0], rule.replacement(match[0]));
        autoFixed = true;
      }
    }
    rule.pattern.lastIndex = 0;
  }

  return { violations, warnings, autoFixed, fixedText };
}

module.exports = { runScan, getRulesForNiche };

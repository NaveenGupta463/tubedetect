const path = require('path');
const fs   = require('fs');

let _nicheConfigs = null;
function getNicheConfigs() {
  if (!_nicheConfigs) {
    const p = path.join(__dirname, '../config/nicheConfigs.json');
    _nicheConfigs = JSON.parse(fs.readFileSync(p, 'utf8'));
  }
  return _nicheConfigs;
}

function resolveConfig(nicheKey) {
  const { niches } = getNicheConfigs();
  const raw = niches[nicheKey];
  if (!raw) return niches['general'];
  if (typeof raw === 'string') return niches[raw]; // alias e.g. "realestate" → "finance"
  return raw;
}

// ── Merge axis helpers ────────────────────────────────────────────────────────

const RISK_ORDER         = ['none', 'reputational', 'misinformation', 'legal', 'health', 'financial'];
const VERIFICATION_ORDER = ['none', 'optional', 'required', 'cited'];
const FACT_ORDER         = ['light', 'moderate', 'strict'];

function stricterOf(order, a, b) {
  const ia = order.indexOf(a ?? order[0]);
  const ib = order.indexOf(b ?? order[0]);
  return ia >= ib ? a : b;
}

// ── Core compile (works from a raw config object, not just a key) ─────────────

function compilePolicyFromConfig(nicheLabel, config) {
  const promptRules = [];

  if (config.factSensitivity === 'strict') {
    promptRules.push('FACT RULE: Every statistic, date, or specific figure must be verifiable. Mark any claim you cannot verify with [VERIFY: describe what fact is needed here].');
  } else if (config.factSensitivity === 'moderate') {
    promptRules.push('FACT RULE: Key claims should be accurate. Estimation and opinion are allowed but must be clearly framed as such.');
  }

  if (config.verification === 'cited') {
    promptRules.push('CITATION RULE: Any specific claim that can be sourced must include a [SOURCE NEEDED] marker for the creator to fill in.');
  } else if (config.verification === 'required') {
    promptRules.push('VERIFICATION RULE: Any claim that could mislead must be marked [VERIFY: describe what to check].');
  }

  if (config.risk === 'financial') {
    promptRules.push('DISCLAIMER: Open all financial content with a clear note that this is for educational purposes only and not financial advice.');
    promptRules.push('ABSOLUTE RULE: Never recommend specific securities, stocks, or funds as buy or sell actions.');
    promptRules.push('ABSOLUTE RULE: Never present past investment returns as predictive of future performance.');
    promptRules.push('ABSOLUTE RULE: Never state specific tax rates, loan terms, or regulatory figures without a [VERIFY] marker.');
  } else if (config.risk === 'health') {
    promptRules.push('DISCLAIMER: Include a note that this content is for informational purposes only and is not medical advice.');
    promptRules.push('ABSOLUTE RULE: Never make specific medical claims, recommend dosages, or state that anything cures, treats, or prevents a condition. Replace with [MEDICAL CLAIM: describe — creator should verify with a healthcare professional].');
  } else if (config.risk === 'misinformation') {
    promptRules.push('ACCURACY RULE: This niche carries high misinformation risk. Only include claims you are confident are accurate. Mark uncertain facts with [VERIFY: describe what needs checking].');
  } else if (config.risk === 'legal') {
    promptRules.push('LEGAL RULE: Never state specific legal rules, case outcomes, or regulations as fact without a [VERIFY: consult a legal professional] marker.');
  }

  if (!config.capabilities.invent_story) {
    promptRules.push('ABSOLUTE RULE: Never invent personal stories, fictional anecdotes, or fabricated experiences for the creator. Use [YOUR STORY: describe what real content goes here] as a placeholder instead.');
  }
  if (!config.capabilities.invent_examples) {
    promptRules.push('ABSOLUTE RULE: Never fabricate specific examples, statistics, or data points. Use [EXAMPLE NEEDED: describe what type of example would strengthen this point] as a placeholder.');
  }
  if (!config.capabilities.create_case_study) {
    promptRules.push('ABSOLUTE RULE: Never invent case study details, outcomes, or results. Use [CASE STUDY NEEDED: describe what real case would work here].');
  }

  if (config.needsExperience) {
    promptRules.push('EXPERIENCE RULE: This creator has real footage and lived experiences. You do not know what they saw, felt, or experienced. Write structure and transitions — use placeholders for all personal content: [YOUR EXPERIENCE: describe what real content goes here].');
  }

  for (const line of (config.redLines || [])) {
    promptRules.push(`ABSOLUTE RULE: ${line}`);
  }

  const toolPermissions = {
    findChannels:    true,
    findPeers:       true,
    findTopics:      true,
    compareChannels: true,
    findOpportunity: true,
    trackNiche:      true,
    draftOutline:    !!config.canGenerateFullScript,
    writeBody:       !!config.canGenerateFullScript,
    writeEnding:     !!config.canGenerateFullScript,
  };

  const statColor = config.risk === 'financial' ? 'amber'
    : config.risk === 'health' ? 'red' : 'blue';

  const uiMarkers = {
    story:      { label: 'YOUR STORY',      color: 'blue',    prefix: 'YOUR STORY:'       },
    experience: { label: 'YOUR EXPERIENCE', color: 'blue',    prefix: 'YOUR EXPERIENCE:'  },
    stat:       { label: 'VERIFY',          color: statColor,  prefix: 'VERIFY:'           },
    example:    { label: 'EXAMPLE NEEDED',  color: 'gray',    prefix: 'EXAMPLE NEEDED:'   },
    medical:    { label: 'MEDICAL CLAIM',   color: 'red',     prefix: 'MEDICAL CLAIM:'    },
    case_study: { label: 'CASE STUDY',      color: 'gray',    prefix: 'CASE STUDY NEEDED:'},
    source:     { label: 'SOURCE NEEDED',   color: 'amber',   prefix: 'SOURCE NEEDED:'    },
    override:   { label: 'OVERRIDE ⚠',      color: 'amber',   prefix: 'OVERRIDE:'         },
  };

  const needsBrief = !!(config.needsExperience || config.mode === 'edit' || config.mode === 'both');

  return {
    niche:                nicheLabel,
    config,
    promptRules,
    toolPermissions,
    uiMarkers,
    needsBrief,
    briefFields:          config.briefFields || ['topic', 'angle'],
    canGenerateFullScript: !!config.canGenerateFullScript,
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

function compilePolicy(nicheKey) {
  const key    = nicheKey || 'general';
  const config = resolveConfig(key);
  return compilePolicyFromConfig(key, config);
}

// Merge two niche configs with strictest-wins rules per axis.
// primaryWeight: confidence score of the primary niche (0–1).
// If the gap between primary and secondary is < 0.15 (i.e. primaryWeight < 0.65),
// we apply the strictest config across the board and surface a warning.
function mergeConfigs(primaryKey, secondaryKey, primaryWeight) {
  if (!secondaryKey || secondaryKey === primaryKey) return compilePolicy(primaryKey);

  const primary   = resolveConfig(primaryKey);
  const secondary = resolveConfig(secondaryKey);

  const tooClose = primaryWeight !== undefined && primaryWeight < 0.65;

  // When confidence gap is too small, apply strictest across everything and warn
  if (tooClose) {
    const strictest = _buildStrictestConfig(primary, secondary);
    const compiled  = compilePolicyFromConfig(`${primaryKey}+${secondaryKey}`, strictest);
    compiled.mergeWarning = `This topic touches both ${primaryKey.replace(/_/g, ' ')} and ${secondaryKey.replace(/_/g, ' ')} — I'm applying the stricter rules throughout.`;
    return compiled;
  }

  const merged = {
    // mode: classifier signal wins; use primary niche default
    mode: primary.mode,

    // Strictest wins per axis
    factSensitivity: stricterOf(FACT_ORDER,         primary.factSensitivity, secondary.factSensitivity),
    verification:    stricterOf(VERIFICATION_ORDER, primary.verification,    secondary.verification),
    risk:            stricterOf(RISK_ORDER,         primary.risk,            secondary.risk),

    // OR — any true → apply
    needsWeb:        primary.needsWeb        || secondary.needsWeb,
    needsExperience: primary.needsExperience || secondary.needsExperience,

    // Union — primary fields listed first, deduped
    briefFields: [...new Set([...(primary.briefFields || []), ...(secondary.briefFields || [])])],

    // capabilities — false beats true (strictest wins)
    capabilities: {
      generate_full_script: primary.capabilities.generate_full_script && secondary.capabilities.generate_full_script,
      invent_story:         primary.capabilities.invent_story         && secondary.capabilities.invent_story,
      rewrite_story:        primary.capabilities.rewrite_story        && secondary.capabilities.rewrite_story,
      create_analogy:       primary.capabilities.create_analogy       && secondary.capabilities.create_analogy,
      invent_examples:      primary.capabilities.invent_examples      && secondary.capabilities.invent_examples,
      create_case_study:    primary.capabilities.create_case_study    && secondary.capabilities.create_case_study,
    },

    // Union — all red lines apply
    redLines: [...new Set([...(primary.redLines || []), ...(secondary.redLines || [])])],

    // AND — both must allow full script
    canGenerateFullScript: primary.canGenerateFullScript && secondary.canGenerateFullScript,

    // Apply primary modeOverrides for the resolved mode if present
    ...(primary.modeOverrides?.[primary.mode] || {}),
  };

  return compilePolicyFromConfig(`${primaryKey}+${secondaryKey}`, merged);
}

// Returns the most restrictive version of two configs (used for tooClose case)
function _buildStrictestConfig(a, b) {
  return {
    mode:            a.mode,
    factSensitivity: stricterOf(FACT_ORDER,         a.factSensitivity, b.factSensitivity),
    verification:    stricterOf(VERIFICATION_ORDER, a.verification,    b.verification),
    risk:            stricterOf(RISK_ORDER,         a.risk,            b.risk),
    needsWeb:        a.needsWeb        || b.needsWeb,
    needsExperience: a.needsExperience || b.needsExperience,
    briefFields:     [...new Set([...(a.briefFields || []), ...(b.briefFields || [])])],
    capabilities: {
      generate_full_script: a.capabilities.generate_full_script && b.capabilities.generate_full_script,
      invent_story:         a.capabilities.invent_story         && b.capabilities.invent_story,
      rewrite_story:        a.capabilities.rewrite_story        && b.capabilities.rewrite_story,
      create_analogy:       a.capabilities.create_analogy       && b.capabilities.create_analogy,
      invent_examples:      a.capabilities.invent_examples      && b.capabilities.invent_examples,
      create_case_study:    a.capabilities.create_case_study    && b.capabilities.create_case_study,
    },
    redLines:             [...new Set([...(a.redLines || []), ...(b.redLines || [])])],
    canGenerateFullScript: a.canGenerateFullScript && b.canGenerateFullScript,
  };
}

function buildPromptSection(compiledPolicy) {
  if (!compiledPolicy.promptRules.length && !compiledPolicy.mergeWarning) return '';
  const label  = compiledPolicy.niche.toUpperCase().replace(/\+/g, ' + ');
  const header = `\nNICHE POLICY (${label}) — these rules are absolute and override everything else when generating scripts, outlines, or hooks:`;
  const rules  = compiledPolicy.promptRules.map(r => `- ${r}`).join('\n');
  const warning = compiledPolicy.mergeWarning
    ? `\nNOTE: ${compiledPolicy.mergeWarning}`
    : '';
  return `${header}\n${rules}${warning}`;
}

// Extract [PLACEHOLDER: description] patterns from generated text.
function extractPlaceholders(text) {
  const patterns = [
    { regex: /\[YOUR STORY:\s*([^\]]+)\]/gi,          type: 'story'      },
    { regex: /\[YOUR EXPERIENCE:\s*([^\]]+)\]/gi,     type: 'experience' },
    { regex: /\[VERIFY:\s*([^\]]+)\]/gi,              type: 'stat'       },
    { regex: /\[SOURCE NEEDED(?::\s*([^\]]*))?\]/gi,  type: 'source'     },
    { regex: /\[EXAMPLE NEEDED:\s*([^\]]+)\]/gi,      type: 'example'    },
    { regex: /\[MEDICAL CLAIM:\s*([^\]]+)\]/gi,       type: 'medical'    },
    { regex: /\[CASE STUDY NEEDED:\s*([^\]]+)\]/gi,   type: 'case_study' },
    { regex: /\[ADD YOUR ANECDOTE:\s*([^\]]+)\]/gi,   type: 'story'      },
    { regex: /\[OVERRIDE:\s*([^\]]+)\]/gi,            type: 'override'   },
  ];

  const found   = [];
  let counter   = 1;

  for (const { regex, type } of patterns) {
    let match;
    regex.lastIndex = 0;
    while ((match = regex.exec(text)) !== null) {
      found.push({
        id:          `ph_${counter++}`,
        type,
        description: (match[1] || '').trim(),
        rawMatch:    match[0],
      });
    }
  }

  return found;
}

module.exports = {
  compilePolicy,
  mergeConfigs,
  compilePolicyFromConfig,
  buildPromptSection,
  extractPlaceholders,
  resolveConfig,
};

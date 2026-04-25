// ── Action type constants ─────────────────────────────────────────────────────

const ACTION_TYPES = {
  TITLE_REWRITE:      'TITLE_REWRITE',
  BALANCE_TITLE:      'BALANCE_TITLE',
  HOOK_REWRITE:       'HOOK_REWRITE',
  SCRIPT_FIX:         'SCRIPT_FIX',
  CONTENT_STRENGTHEN: 'CONTENT_STRENGTHEN',
};

// ── Steps per action type ─────────────────────────────────────────────────────

const ACTION_STEPS = {
  TITLE_REWRITE:      ['Remove vague wording', 'Add specific outcome', 'Add curiosity gap'],
  BALANCE_TITLE:      ['Keep curiosity', 'Add proof/value', 'Reduce exaggeration'],
  HOOK_REWRITE:       ['Start with conflict', 'State payoff in first 3 seconds', 'Remove intro fluff'],
  SCRIPT_FIX:         ['Add pattern interrupts', 'Add re-hooks every 20–30 seconds', 'Introduce open loops'],
  CONTENT_STRENGTHEN: ['Improve usefulness', 'Tighten structure', 'Remove filler'],
};

// ── Reasons per action type ───────────────────────────────────────────────────

const ACTION_REASONS = {
  TITLE_REWRITE:      'Title clarity is too low, reducing click-through potential',
  BALANCE_TITLE:      'High curiosity with low usefulness signals clickbait risk',
  HOOK_REWRITE:       'Weak hook retention is limiting distribution and view duration',
  SCRIPT_FIX:         'Structural weaknesses are causing mid-video drop-off',
  CONTENT_STRENGTHEN: 'Low usefulness combined with weak structure compounds drop-off',
};

// ── Logger ────────────────────────────────────────────────────────────────────

function logUnmappedRule({ source, message }) {
  console.warn('[ActionEngine] Unmapped rule:', { source, message });
}

// ── Message → action type mapping ────────────────────────────────────────────
// Order matters: more specific patterns checked first.

function mapMessageToActionType(message) {
  if (!message) return null;
  const m = message.toLowerCase();

  if (m.includes('clarity'))                                    return ACTION_TYPES.TITLE_REWRITE;
  if (m.includes('clickbait'))                                  return ACTION_TYPES.BALANCE_TITLE;
  if (m.includes('hook retention') || m.includes('hook strength')) return ACTION_TYPES.HOOK_REWRITE;
  if (m.includes('compounding'))                                return ACTION_TYPES.CONTENT_STRENGTHEN;
  if (m.includes('structure'))                                  return ACTION_TYPES.SCRIPT_FIX;
  if (m.includes('usefulness') || m.includes('value'))         return ACTION_TYPES.CONTENT_STRENGTHEN;
  if (m.includes('hook'))                                       return ACTION_TYPES.HOOK_REWRITE;
  if (m.includes('title') || m.includes('thumbnail') || m.includes('ctr')) return ACTION_TYPES.TITLE_REWRITE;
  if (m.includes('curiosity') || m.includes('emotional') || m.includes('emotion')) return ACTION_TYPES.TITLE_REWRITE;
  if (m.includes('engagement') || m.includes('relatability') || m.includes('controversy')) return ACTION_TYPES.SCRIPT_FIX;

  return null;
}

// ── Signal flattener ──────────────────────────────────────────────────────────

function flattenSignals(signals) {
  const t   = signals?.title     || {};
  const h   = signals?.hook      || {};
  const st  = signals?.structure || {};
  const em  = signals?.emotion   || {};
  const v   = signals?.value     || {};
  const seo = signals?.seo       || {};

  return {
    clarity:             t.clarity,
    curiosity:           t.curiosity,
    emotion:             t.emotion,
    keyword_strength:    t.keyword_strength,
    scroll_stop:         h.scroll_stop,
    hook_curiosity:      h.curiosity,
    tension:             h.tension,
    hook_clarity:        h.clarity,
    flow:                st.flow,
    retention_design:    st.retention_design,
    pacing:              st.pacing,
    emotional_intensity: em.emotional_intensity,
    relatability:        em.relatability,
    story_strength:      em.story_strength,
    controversy:         em.controversy,
    information_density: v.information_density,
    novelty:             v.novelty,
    usefulness:          v.usefulness,
    keyword_alignment:   seo.keyword_alignment,
    search_potential:    seo.search_potential,
    competition_fit:     seo.competition_fit,
  };
}

// ── Action factory ────────────────────────────────────────────────────────────

function buildAction({ type, reason, expectedImpact, confidence, steps, source }) {
  return {
    type,
    reason,
    expectedImpact,
    confidence,
    steps,
    promptTemplate:   'PLACEHOLDER',
    generationPrompt: null,
    meta: {
      merged:  false,
      sources: [source],
    },
  };
}

// ── Merge two actions of the same type ───────────────────────────────────────

function mergeActions(primary, opportunity) {
  const mergedSteps = [...new Set([...primary.steps, ...opportunity.steps])];

  return {
    type:             primary.type,
    reason:           primary.reason,
    expectedImpact:   primary.expectedImpact + opportunity.expectedImpact,
    confidence:       primary.confidence,
    steps:            mergedSteps,
    promptTemplate:   'PLACEHOLDER_COMBINED',
    generationPrompt: null,
    meta: {
      merged:  true,
      sources: ['primaryIssue', 'biggestOpportunity'],
    },
  };
}

// ── Main export ───────────────────────────────────────────────────────────────

export function buildActionEngineOutput(input) {
  const {
    signals,
    dimensionScores,
    viralScore,
    confidenceScore,
    primaryIssue,
    biggestOpportunity,
    diagnosis,
    title       = '',
    description = '',
  } = input;

  const confidence      = (confidenceScore ?? 0) / 100;
  const hasPrimaryIssue = (primaryIssue?.impact       ?? 0) > 0;
  const hasOpportunity  = (biggestOpportunity?.potentialGain ?? 0) > 0;

  if (!hasPrimaryIssue && !hasOpportunity) {
    return { actions: [] };
  }

  // Flatten signals once for use in prompt generation (prompts defined later)
  const _flatSignals = flattenSignals(signals); // eslint-disable-line no-unused-vars

  let primaryAction     = null;
  let opportunityAction = null;

  // ── Primary issue → action ────────────────────────────────────────────────

  if (hasPrimaryIssue) {
    const type = mapMessageToActionType(primaryIssue.message);
    if (type) {
      primaryAction = buildAction({
        type,
        reason:         ACTION_REASONS[type],
        expectedImpact: primaryIssue.impact,
        confidence,
        steps:          ACTION_STEPS[type],
        source:         'primaryIssue',
      });
    } else {
      logUnmappedRule({ source: 'primaryIssue', message: primaryIssue.message });
    }
  }

  // ── Biggest opportunity → action ──────────────────────────────────────────

  if (hasOpportunity) {
    const type = mapMessageToActionType(biggestOpportunity.message);
    if (type) {
      opportunityAction = buildAction({
        type,
        reason:         ACTION_REASONS[type],
        expectedImpact: biggestOpportunity.potentialGain,
        confidence,
        steps:          ACTION_STEPS[type],
        source:         'biggestOpportunity',
      });
    } else {
      logUnmappedRule({ source: 'biggestOpportunity', message: biggestOpportunity.message });
    }
  }

  // ── Merge if same type, otherwise return both (max 2) ────────────────────

  if (primaryAction && opportunityAction) {
    if (primaryAction.type === opportunityAction.type) {
      return { actions: [mergeActions(primaryAction, opportunityAction)] };
    }
    return { actions: [primaryAction, opportunityAction] };
  }

  if (primaryAction)     return { actions: [primaryAction] };
  if (opportunityAction) return { actions: [opportunityAction] };

  return { actions: [] };
}

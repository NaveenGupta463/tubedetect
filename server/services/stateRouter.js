// Pure function — no I/O. Takes current thread state + classifier result + compiled policy.
// Returns { nextState, action, needsBrief, classificationAction }

const GENERATION_STATES = new Set(['BRIEF_COMPLETE', 'READY', 'GENERATING', 'OUTPUT']);

function route(thread, classifyResult, compiledPolicy) {
  const currentState = thread?.state || 'UNCLASSIFIED';

  // Already past classification — just go to READY and generate
  if (GENERATION_STATES.has(currentState)) {
    return { nextState: 'READY', action: 'generate', needsBrief: false, classificationAction: null };
  }

  const { mode, confidence } = classifyResult;

  // Confidence routing for classification UI feedback
  let classificationAction = null;
  if (confidence < 0.55) {
    classificationAction = 'ask_clarification';
  } else if (confidence < 0.80) {
    classificationAction = 'confirm_classification';
  }

  // Does this niche+mode combination require a brief before generating?
  const briefRequired = compiledPolicy.needsBrief && (
    mode === 'edit' ||
    mode === 'unknown' ||
    compiledPolicy.config.needsExperience
  );

  const hasBrief = isBriefComplete(thread?.brief, compiledPolicy.briefFields);

  if (briefRequired && !hasBrief) {
    return {
      nextState:           'NEEDS_BRIEF',
      action:              'collect_brief',
      needsBrief:          true,
      classificationAction,
    };
  }

  return {
    nextState:           'READY',
    action:              'generate',
    needsBrief:          false,
    classificationAction,
  };
}

// Returns true when at least the first two required brief fields are non-empty.
function isBriefComplete(brief, requiredFields) {
  if (!brief) return false;
  let parsed = brief;
  if (typeof brief === 'string') {
    try { parsed = JSON.parse(brief); } catch (_) { return false; }
  }
  const minFields = (requiredFields || []).slice(0, 2);
  return minFields.every(f => typeof parsed[f] === 'string' && parsed[f].trim().length > 0);
}

module.exports = { route, isBriefComplete };

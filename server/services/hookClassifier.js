'use strict';

// D0/Phase2 — Probabilistic multi-hook inference classifier.
// Returns confidence-weighted ranked hook predictions, NOT ground truth.
// Rule-based heuristic architecture — deterministic patterns, probabilistic normalization.
// No LLM, no embeddings, no neural models.
//
// Architecture: semantic persuasion INFERENCE, not behavioral certainty.
// Consumer rule: hook pattern correlated with performance ≠ hook caused performance.

const CLASSIFIER_VERSION = '2.0.0';
const CLASSIFICATION_METHOD = 'rule_heuristic_v2';

const HOOK_PATTERNS = [
  // ── list ──────────────────────────────────────────────────────────────────
  {
    type: 'list',
    strong: [
      /\b\d+\s+(ways?|reasons?|tips?|things?|mistakes?|signs?|facts?|steps?|tricks?|hacks?|secrets?|ideas?|examples?|lessons?|habits?)\b/i,
      /\btop\s+\d+\b/i,
      /\b\d+\s+best\b/i,
    ],
    weak: [
      /\beverything you need\b/i,
      /\bcomplete list\b/i,
    ],
  },

  // ── tutorial ──────────────────────────────────────────────────────────────
  {
    type: 'tutorial',
    strong: [
      /\bhow\s+to\b/i,
      /\bstep[- ]by[- ]step\b/i,
      /\bbeginner(?:'s)?\s+(guide|tutorial|course)\b/i,
      /\bcomplete\s+(guide|tutorial)\b/i,
      /\bfull\s+(guide|tutorial|walkthrough|course)\b/i,
      /\blearn\s+\w+\s+in\s+\d/i,
    ],
    weak: [
      /\bguide\b/i,
      /\btutorial\b/i,
      /\bwalkthrough\b/i,
      /\bexplained\b/i,
    ],
  },

  // ── curiosity ─────────────────────────────────────────────────────────────
  {
    type: 'curiosity',
    strong: [
      /\bwhat\s+happens?\s+when\b/i,
      /\bwhat\s+happens?\s+if\b/i,
      /\bi\s+tried\b/i,
      /\bnobody\s+(talks?|tells?)\s+(you|about)\b/i,
      /\bno\s+one\s+(talks?|tells?)\s+(you|about)\b/i,
      /\bthe\s+(truth|real\s+reason|real\s+story)\s+(about|behind|of)\b/i,
      /\bwhy\s+(nobody|no\s+one|everyone)\b/i,
      /\bthis\s+is\s+why\b/i,
      /\bwhat\s+(nobody|no\s+one)\b/i,
    ],
    weak: [
      /\bwhy\s+\w+\s+(actually|really|secretly)\b/i,
      /\bthe\s+reason\s+(most|why)\b/i,
      /\bi\s+(spent|used|tested|built|made)\b/i,
      /\bwhat\s+I\s+(discovered|learned|found)\b/i,
    ],
  },

  // ── fear ──────────────────────────────────────────────────────────────────
  {
    type: 'fear',
    strong: [
      /\bstop\s+(doing|using|buying|trying|watching|eating|saying|making)\b/i,
      /\byou(?:'re|\s+are)\s+(ruining|destroying|killing|making|wasting)\b/i,
      /\bbiggest\s+mistake\b/i,
      /\bdangerous\b/i,
      /\bnever\s+(do|use|eat|say|buy|watch)\b/i,
      /\bwhy\s+you\s+(should\s+stop|must\s+stop|need\s+to\s+stop)\b/i,
      /\bwarning[:\s]/i,
      /\balert[:\s]/i,
    ],
    weak: [
      /\bcommon\s+mistake\b/i,
      /\bdon'?t\s+(do|make|use|say)\b/i,
      /\bavoid\s+(these|this)\b/i,
      /\bbeware\b/i,
      /\brisk[s]?\b.*\byou\b/i,
    ],
  },

  // ── transformation ────────────────────────────────────────────────────────
  {
    type: 'transformation',
    strong: [
      /\bbefore\s+(vs\.?|and|&|versus)\s+after\b/i,
      /\bfrom\s+\S+\s+to\s+\S+/i,
      /\bhow\s+i\s+(went|went)\s+from\b/i,
      /\bi\s+(lost|gained|made|saved|built|grew)\b.*\bin\s+\d+\s+(days?|weeks?|months?)\b/i,
      /\b\d+\s+(days?|weeks?|months?)\s+(challenge|transformation)\b/i,
      /\b(transformation|makeover)\b/i,
      /\bchanged\s+(my|everything|completely)\b/i,
    ],
    weak: [
      /\bjourney\b/i,
      /\bprogress\b/i,
      /\bimproved?\b/i,
    ],
  },

  // ── authority ─────────────────────────────────────────────────────────────
  {
    type: 'authority',
    strong: [
      /\b(doctor|dr\.?|physician|surgeon)\s+(reveals?|explains?|says?|warns?|recommends?)\b/i,
      /\b(expert|professor|specialist|scientist|researcher|engineer|ceo|founder)\s+(reveals?|explains?|says?|warns?)\b/i,
      /\baccording\s+to\s+(science|research|experts?|studies?|harvard|mit|nasa)\b/i,
      /\bscience\s+(says?|reveals?|proves?|shows?)\b/i,
      /\bresearch\s+(shows?|reveals?|proves?|finds?)\b/i,
      /\bstudies?\s+(show|reveal|prove|find)\b/i,
      /\bproven\s+by\s+(science|research|studies?)\b/i,
    ],
    weak: [
      /\bexperts?\s+(say|think|believe|agree)\b/i,
      /\bprofessionals?\b/i,
      /\bstudy\b/i,
    ],
  },

  // ── challenge ─────────────────────────────────────────────────────────────
  {
    type: 'challenge',
    strong: [
      /\b\d+[- ](day|hour|week|month)\s+challenge\b/i,
      /\bchallenge\s+accepted\b/i,
      /\bi\s+(challenged|attempted|tried)\s+.{3,40}\s+for\s+\d+\s+(days?|weeks?|hours?)\b/i,
      /\b(impossible|extreme|insane|hardest)\s+challenge\b/i,
      /\bvs\.?\s+\w+\s+challenge\b/i,
    ],
    weak: [
      /\bchallenge\b/i,
      /\batttempt\b/i,
    ],
  },

  // ── urgency ───────────────────────────────────────────────────────────────
  {
    type: 'urgency',
    strong: [
      /\bbefore\s+it'?s?\s+(too\s+late|gone|deleted|removed)\b/i,
      /\bwatch\s+(this|before)\s+(now|today|immediately|before)\b/i,
      /\blast\s+(chance|day|week|time)\b/i,
      /\b(expires?|ending\s+soon|limited\s+time)\b/i,
      /\bdo\s+this\s+(now|today|immediately|right\s+now)\b/i,
      /\bright\s+now\b.*\bimportant\b/i,
      /\bdeadline\b/i,
      /\burgent\b/i,
    ],
    weak: [
      /\btoday\b/i,
      /\bimmediately\b/i,
      /\bright\s+now\b/i,
      /\basap\b/i,
    ],
  },

  // ── controversy ───────────────────────────────────────────────────────────
  {
    type: 'controversy',
    strong: [
      /\beveryone\s+(is\s+wrong|got\s+it\s+wrong|disagrees)\b/i,
      /\bunpopular\s+opinion\b/i,
      /\bcontroversial\b/i,
      /\bthe\s+(dark|ugly|dirty|uncomfortable)\s+truth\b/i,
      /\bwhy\s+.{3,40}\s+is\s+(wrong|bad|broken|a\s+(scam|lie|fraud))\b/i,
      /\bi\s+(disagree|hate|quit|left|exposed)\b/i,
      /\boverrated\b/i,
      /\bscam\b/i,
    ],
    weak: [
      /\bdebate\b/i,
      /\bopinion\b/i,
      /\bvsersus|\bvs\.?\s/i,
    ],
  },

  // ── mistake ───────────────────────────────────────────────────────────────
  {
    type: 'mistake',
    strong: [
      /\b(mistakes?|errors?)\s+(i\s+made|you'?re?\s+making|most\s+people\s+make|beginners?\s+make)\b/i,
      /\bi\s+was\s+wrong\s+about\b/i,
      /\bwhat\s+i\s+wish\s+i\s+(knew|had\s+known)\b/i,
      /\bdon'?t\s+make\s+(the|my|these)\s+(same\s+)?mistake\b/i,
      /\bregret(ted|s?)?\b.*\b(buying|using|trying|doing)\b/i,
    ],
    weak: [
      /\bmistake\b/i,
      /\bregret\b/i,
      /\bwrong\b/i,
    ],
  },

  // ── comparison ────────────────────────────────────────────────────────────
  {
    type: 'comparison',
    strong: [
      /\b\S+\s+vs\.?\s+\S+\b/i,
      /\bcompared?\s+(to|with)\b/i,
      /\bwhich\s+(is|one)\s+(better|worse|best)\b/i,
      /\bworth\s+it\s+or\s+not\b/i,
      /\b(better|worse)\s+than\b/i,
    ],
    weak: [
      /\bversus\b/i,
      /\balternative\b/i,
    ],
  },

  // ── secret ────────────────────────────────────────────────────────────────
  {
    type: 'secret',
    strong: [
      /\b(secret|hidden|unknown)\s+(trick|hack|method|technique|strategy|feature|formula|weapon)\b/i,
      /\b(they|youtube|google|apple)\s+(don'?t\s+want\s+you\s+to|won'?t)\s+(know|see|find)\b/i,
      /\bundiscovered\b/i,
      /\bunlocking?\s+(the\s+)?(secret|hidden)\b/i,
      /\bthe\s+(secret|real)\s+(to|behind|formula)\b/i,
    ],
    weak: [
      /\bsecret\b/i,
      /\bhidden\b/i,
      /\bhack\b/i,
    ],
  },

  // ── myth ──────────────────────────────────────────────────────────────────
  {
    type: 'myth',
    strong: [
      /\b(debunking?|busting?)\s+(the\s+)?(myths?|misconceptions?|lies?|rumors?|fakes?)\b/i,
      /\bthe\s+(myth|lie|misconception)\s+(about|of)\b/i,
      /\bcompletely\s+false\b/i,
      /\bnot\s+true\b.*\bactually\b/i,
      /\b(myths?|misconceptions?)\s+(about|of|that)\b/i,
      /\bfact\s+or\s+(fiction|myth)\b/i,
      /\bactually\s+a\s+(myth|lie|scam)\b/i,
    ],
    weak: [
      /\bmyth\b/i,
      /\bfact\s+check\b/i,
      /\bdebunk\b/i,
    ],
  },

  // ── reaction ──────────────────────────────────────────────────────────────
  {
    type: 'reaction',
    strong: [
      /\b(reacting?\s+to|reaction\s+to)\b/i,
      /\bmy\s+(honest\s+)?(reaction|review|thoughts?)\s+(to|on|about)\b/i,
      /\b(watching|reading)\s+.{3,40}\s+(for\s+the\s+first\s+time)\b/i,
      /\bresponding\s+to\b/i,
    ],
    weak: [
      /\breaction\b/i,
      /\bresponse\b/i,
      /\bwatched\b/i,
    ],
  },
];

// ── Phase 3: Signal explainability ────────────────────────────────────────────
// Derives a human-readable signal name from a regex source string.
function inferSignalName(regexSource, hookType) {
  const s = regexSource;
  if (s.includes('how\\s+to'))                   return 'tutorial_directive_detected';
  if (s.includes('step[- ]by[- ]step'))          return 'step_sequence_structure';
  if (s.includes('beginner'))                     return 'beginner_framing_detected';
  if (s.includes('complete\\s+(guide|tutorial')) return 'comprehensive_resource_signal';
  if (s.includes('full\\s+(guide|tutorial'))     return 'full_guide_signal';
  if (s.includes('learn\\s+\\w+\\s+in\\s+\\d')) return 'time_bound_learning_detected';
  if (s.includes('guide'))                        return 'guide_keyword_present';
  if (s.includes('tutorial'))                     return 'tutorial_keyword_present';
  if (s.includes('walkthrough'))                  return 'walkthrough_keyword_present';
  if (s.includes('explained'))                    return 'explanation_framing_detected';
  if (s.includes('\\d+\\s+(ways'))               return 'numbered_list_structure';
  if (s.includes('\\d+\\s+(reasons'))            return 'numbered_reasons_structure';
  if (s.includes('\\d+\\s+(tips'))               return 'numbered_tips_structure';
  if (s.includes('top\\s+\\d'))                  return 'ranked_list_signal';
  if (s.includes('\\d+\\s+best'))                return 'best_of_signal';
  if (s.includes('what\\s+happens'))             return 'consequence_curiosity_gap';
  if (s.includes('i\\s+tried'))                  return 'personal_experiment_signal';
  if (s.includes('nobody\\s+(talks'))            return 'excluded_knowledge_claim';
  if (s.includes('no\\s+one\\s+(talks'))         return 'excluded_knowledge_claim';
  if (s.includes('the\\s+(truth|real\\s+reason')) return 'hidden_truth_framing';
  if (s.includes('this\\s+is\\s+why'))           return 'reason_reveal_signal';
  if (s.includes('what\\s+(nobody|no\\s+one'))   return 'unknown_knowledge_claim';
  if (s.includes('why\\s+(nobody|no\\s+one'))    return 'contrarian_curiosity_gap';
  if (s.includes('why\\s+\\w+\\s+(actually'))    return 'qualitative_curiosity_signal';
  if (s.includes('i\\s+(spent|used|tested|built')) return 'personal_experiment_signal';
  if (s.includes('what\\s+I\\s+(discovered'))    return 'discovery_framing_signal';
  if (s.includes('stop\\s+(doing|using|buying')) return 'fear_of_wrong_action';
  if (s.includes('ruining|destroying|killing'))   return 'personal_harm_framing';
  if (s.includes('biggest\\s+mistake'))          return 'peak_fear_framing';
  if (s.includes('dangerous'))                    return 'danger_keyword_detected';
  if (s.includes('never\\s+(do|use|eat'))        return 'absolute_prohibitive_signal';
  if (s.includes('should\\s+stop|must\\s+stop')) return 'imperative_stop_signal';
  if (s.includes('warning'))                      return 'explicit_warning_signal';
  if (s.includes('alert'))                        return 'alert_signal_detected';
  if (s.includes('common\\s+mistake'))            return 'common_mistake_detected';
  if (s.includes("don'?t\\s+(do|make|use"))      return 'negative_imperative_detected';
  if (s.includes('avoid\\s+(these|this)'))        return 'avoidance_directive_detected';
  if (s.includes('beware'))                       return 'beware_signal_detected';
  if (s.includes('before\\s+(vs\\.?|and|&'))     return 'before_after_structure';
  if (s.includes('from\\s+\\S+\\s+to\\s+\\S'))   return 'trajectory_framing_detected';
  if (s.includes('how\\s+i\\s+(went|went)\\s+from')) return 'personal_journey_arc';
  if (s.includes('i\\s+(lost|gained|made|saved')) return 'personal_result_claim';
  if (s.includes('(days?|weeks?|months?)\\s+(challenge|transformation)')) return 'time_bound_challenge';
  if (s.includes('transformation|makeover'))      return 'transformation_keyword_detected';
  if (s.includes('changed'))                      return 'change_narrative_signal';
  if (s.includes('journey'))                      return 'journey_keyword_detected';
  if (s.includes('progress'))                     return 'progress_keyword_detected';
  if (s.includes('doctor|dr\\.?|physician'))      return 'authority_keyword_detected';
  if (s.includes('expert|professor|specialist'))  return 'expert_credential_detected';
  if (s.includes('according\\s+to\\s+(science'))  return 'scientific_authority_claim';
  if (s.includes('science\\s+(says?|reveals?'))   return 'science_validates_signal';
  if (s.includes('research\\s+(shows?|reveals?')) return 'research_validates_signal';
  if (s.includes('studies?\\s+(show|reveal'))     return 'study_validates_signal';
  if (s.includes('proven\\s+by\\s+(science'))     return 'proven_by_science_signal';
  if (s.includes('experts?\\s+(say|think'))       return 'expert_opinion_signal';
  if (s.includes('professionals?'))               return 'professional_signal_detected';
  if (s.includes('study'))                        return 'study_reference_detected';
  if (s.includes('\\d+[- ](day|hour|week'))       return 'structured_challenge_signal';
  if (s.includes('challenge\\s+accepted'))         return 'challenge_acceptance_signal';
  if (s.includes('impossible|extreme|insane'))     return 'extreme_challenge_framing';
  if (s.includes('challenge'))                    return 'challenge_keyword_present';
  if (s.includes('before\\s+it'))                 return 'expiration_urgency_signal';
  if (s.includes('last\\s+(chance|day|week'))     return 'deadline_signal_detected';
  if (s.includes('expires?|ending\\s+soon'))      return 'scarcity_signal_detected';
  if (s.includes('do\\s+this\\s+(now|today'))     return 'action_now_directive';
  if (s.includes('deadline'))                     return 'deadline_keyword_detected';
  if (s.includes('urgent'))                       return 'urgency_keyword_detected';
  if (s.includes('today'))                        return 'today_signal_detected';
  if (s.includes('immediately'))                  return 'immediacy_signal_detected';
  if (s.includes('right\\s+now'))                 return 'right_now_signal_detected';
  if (s.includes('everyone\\s+(is\\s+wrong'))     return 'mass_contrarian_signal';
  if (s.includes('unpopular\\s+opinion'))          return 'unpopular_opinion_signal';
  if (s.includes('controversial'))                return 'controversy_keyword_detected';
  if (s.includes('dark|ugly|dirty|uncomfortable')) return 'taboo_framing_detected';
  if (s.includes('overrated'))                    return 'overrated_claim_detected';
  if (s.includes('scam'))                         return 'scam_allegation_signal';
  if (s.includes('i\\s+(disagree|hate|quit'))     return 'personal_disagreement_signal';
  if (s.includes('(mistakes?|errors?)\\s+(i\\s+made')) return 'personal_mistake_confession';
  if (s.includes('i\\s+was\\s+wrong\\s+about'))   return 'correction_narrative_signal';
  if (s.includes('what\\s+i\\s+wish\\s+i'))       return 'hindsight_wisdom_signal';
  if (s.includes("don'?t\\s+make.*mistake"))       return 'dont_repeat_my_mistake';
  if (s.includes('regret'))                       return 'regret_signal_detected';
  if (s.includes('mistake'))                      return 'mistake_keyword_present';
  if (s.includes('\\S+\\s+vs\\.?\\s+\\S+'))       return 'direct_comparison_structure';
  if (s.includes('compared?\\s+(to|with)'))       return 'comparative_framing_detected';
  if (s.includes('which\\s+(is|one)\\s+(better')) return 'decision_help_framing';
  if (s.includes('worth\\s+it'))                  return 'value_judgment_signal';
  if (s.includes('(better|worse)\\s+than'))       return 'relative_merit_signal';
  if (s.includes('versus'))                       return 'versus_keyword_present';
  if (s.includes('alternative'))                  return 'alternative_framing_detected';
  if (s.includes('(secret|hidden|unknown)\\s+(trick|hack')) return 'hidden_knowledge_claim';
  if (s.includes("don'?t\\s+want\\s+you\\s+to")) return 'suppressed_knowledge_claim';
  if (s.includes('undiscovered'))                 return 'undiscovered_claim_signal';
  if (s.includes('unlocking?'))                   return 'unlock_secret_signal';
  if (s.includes('secret'))                       return 'secret_keyword_present';
  if (s.includes('hidden'))                       return 'hidden_keyword_present';
  if (s.includes('hack'))                         return 'hack_keyword_present';
  if (s.includes('debunking?|busting?'))          return 'myth_debunking_signal';
  if (s.includes('the\\s+(myth|lie|misconception)')) return 'myth_identification_signal';
  if (s.includes('completely\\s+false'))           return 'false_claim_signal';
  if (s.includes('fact\\s+or'))                   return 'fact_check_framing';
  if (s.includes('actually\\s+a\\s+(myth|lie)')) return 'debunked_claim_signal';
  if (s.includes('myth'))                         return 'myth_keyword_present';
  if (s.includes('debunk'))                       return 'debunk_keyword_present';
  if (s.includes('reacting?\\s+to|reaction\\s+to')) return 'reaction_format_detected';
  if (s.includes('my.*reaction|review|thoughts?')) return 'personal_reaction_signal';
  if (s.includes('for\\s+the\\s+first\\s+time'))  return 'first_time_framing_detected';
  if (s.includes('responding\\s+to'))              return 'response_format_detected';
  if (s.includes('reaction'))                     return 'reaction_keyword_present';
  if (s.includes('response'))                     return 'response_keyword_present';
  return `${hookType}_pattern_detected`;
}

// ── Phase 7: Validation utilities ─────────────────────────────────────────────
function validateMultiHookOutput(result, title) {
  if (!result) throw new Error('classifyHookTypeMulti returned null');
  if (typeof result.primary_hook !== 'string') throw new Error('primary_hook must be string');
  if (typeof result.primary_hook_confidence !== 'number') throw new Error('primary_hook_confidence must be number');
  if (!Array.isArray(result.predicted_hooks)) throw new Error('predicted_hooks must be array');
  if (result.primary_hook !== 'unknown' && result.predicted_hooks.length === 0) throw new Error('non-unknown result must have ≥1 predicted hook');
  const confSum = result.predicted_hooks.reduce((s, h) => s + h.confidence, 0);
  if (result.predicted_hooks.length > 0 && Math.abs(confSum - 1.0) > 0.01) {
    throw new Error(`predicted_hooks confidences must sum to 1.0, got ${confSum.toFixed(3)}`);
  }
  for (const h of result.predicted_hooks) {
    if (!h.type || typeof h.type !== 'string') throw new Error('each hook must have a string type');
    if (typeof h.confidence !== 'number' || h.confidence < 0 || h.confidence > 1) throw new Error('each hook confidence must be 0-1');
    if (!Array.isArray(h.signals)) throw new Error('each hook must have signals array');
  }
}

// ── Phase 2: Probabilistic multi-hook classifier ──────────────────────────────
// Returns ranked hook probabilities with signal evidence and ambiguity score.
// This is the primary function — classifyHookType() wraps this for backward compat.
function classifyHookTypeMulti(title) {
  const EMPTY = {
    primary_hook: 'unknown',
    primary_hook_confidence: 0,
    ambiguity_score: 0,
    predicted_hooks: [],
    inference_version: CLASSIFIER_VERSION,
    classification_method: CLASSIFICATION_METHOD,
    inference_sources: ['title'],
    semantic_confidence: 0,
    fallback: true,
    // Phase 6: extensibility hooks for future multimodal inference
    thumbnail_signals: null,
    transcript_signals: null,
    multimodal_confidence: null,
  };

  if (!title || typeof title !== 'string') return EMPTY;

  const t = title.trim();
  if (!t) return EMPTY;

  const rawScores = {};
  const signals   = {};

  for (const def of HOOK_PATTERNS) {
    // Authority strong patterns score 3 (not 2) to win against curiosity on doctor/expert titles
    const strongWeight = def.type === 'authority' ? 3 : 2;
    let score = 0;
    const hits = [];

    for (const re of def.strong) {
      if (re.test(t)) {
        score += strongWeight;
        hits.push(inferSignalName(re.source, def.type));
      }
    }
    for (const re of def.weak) {
      if (re.test(t)) {
        score += 1;
        hits.push(inferSignalName(re.source, def.type));
      }
    }

    if (score > 0) {
      rawScores[def.type] = score;
      signals[def.type]   = [...new Set(hits)]; // deduplicate same signal
    }
  }

  if (Object.keys(rawScores).length === 0) return { ...EMPTY };

  // Sort by raw score descending (preserves definition-order tie-breaking)
  const sortedTypes = Object.entries(rawScores).sort((a, b) => b[1] - a[1]);

  // Linear normalization: score / total_score → probabilities
  const totalRaw = sortedTypes.reduce((s, [, v]) => s + v, 0);

  // Include only hooks with ≥5% share to avoid noise tail
  const significant = sortedTypes.filter(([, raw]) => raw / totalRaw >= 0.05);

  // Re-normalize after filtering so confidence sums to 1.0
  const sigTotal = significant.reduce((s, [, raw]) => s + raw, 0);

  const predicted_hooks = significant.map(([type, raw]) => ({
    type,
    confidence: parseFloat((raw / sigTotal).toFixed(3)),
    signals: signals[type] ?? [],
    _raw_score: raw,
  }));

  // Final normalization fix for floating-point drift
  const confSum = predicted_hooks.reduce((s, h) => s + h.confidence, 0);
  if (predicted_hooks.length > 0 && Math.abs(confSum - 1.0) > 0.001) {
    predicted_hooks[0].confidence = parseFloat((predicted_hooks[0].confidence + (1.0 - confSum)).toFixed(3));
  }

  const primary   = predicted_hooks[0];
  const secondary = predicted_hooks[1] ?? null;

  // Ambiguity score: probability mass on the second-best hypothesis.
  // 0 = fully unambiguous (only one hook), 0.5 = two equally likely hooks.
  const ambiguity_score = secondary ? secondary.confidence : 0;

  // Semantic confidence: reflects how strongly the primary hook is supported.
  // Boosted by multiple strong pattern hits; weakened by weak-only matches.
  const def         = HOOK_PATTERNS.find(d => d.type === primary.type);
  const strongHits  = (def?.strong ?? []).filter(re => re.test(t)).length;
  let semantic_confidence;
  if      (strongHits >= 2) semantic_confidence = Math.min(1.0, primary.confidence + 0.15);
  else if (strongHits === 1) semantic_confidence = primary.confidence;
  else                       semantic_confidence = primary.confidence * 0.75;
  semantic_confidence = parseFloat(Math.min(1.0, semantic_confidence).toFixed(3));

  const result = {
    primary_hook:             primary.type,
    primary_hook_confidence:  primary.confidence,
    ambiguity_score:          parseFloat(ambiguity_score.toFixed(3)),
    predicted_hooks,
    inference_version:        CLASSIFIER_VERSION,
    classification_method:    CLASSIFICATION_METHOD,
    inference_sources:        ['title'],
    semantic_confidence,
    fallback: false,
    // Phase 6: future multimodal fields (populated by future extensions)
    thumbnail_signals:     null,
    transcript_signals:    null,
    multimodal_confidence: null,
  };

  // Phase 7: validate output invariants in dev; silent in prod
  if (process.env.NODE_ENV !== 'production') {
    try { validateMultiHookOutput(result, t); } catch (e) {
      console.warn('[hookClassifier] validation warning:', e.message, '| title:', t.slice(0, 60));
    }
  }

  return result;
}

// ── Phase 1: Backward-compatibility adapter ───────────────────────────────────
// Preserves the original classifyHookType() contract exactly.
// All legacy consumers (aggregation job, intelligence router, etc.) continue working.
function classifyHookType(title) {
  const r = classifyHookTypeMulti(title);

  if (r.fallback || r.primary_hook === 'unknown') {
    return { hookType: 'unknown', confidence: 0, matchedPatterns: [], fallback: true };
  }

  const primary = r.predicted_hooks[0];
  return {
    hookType:        r.primary_hook,
    confidence:      r.semantic_confidence,
    matchedPatterns: (primary?.signals ?? []).slice(0, 5),
    fallback:        false,
    _score:          primary?._raw_score ?? 0,
    _allScores:      Object.fromEntries(r.predicted_hooks.map(h => [h.type, h._raw_score ?? 0])),
  };
}

module.exports = { classifyHookType, classifyHookTypeMulti, HOOK_PATTERNS, CLASSIFIER_VERSION, inferSignalName };

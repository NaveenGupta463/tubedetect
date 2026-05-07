function buildRecommendation(finalScore, confidenceState) {
  const score = finalScore ?? 0;

  if (score >= 70) {
    return {
      priority:    'high',
      label:       'Strong potential',
      explanation: 'This content scores well across engagement signals and peer context.',
      actions:     [],
    };
  }

  if (score >= 50) {
    return {
      priority:    'medium',
      label:       'Good potential',
      explanation: 'Solid foundation with room to strengthen hook and title signals.',
      actions:     [],
    };
  }

  if (score >= 30) {
    return {
      priority:    'low',
      label:       'Needs improvement',
      explanation: 'Several engagement signals are below niche benchmarks.',
      actions:     [],
    };
  }

  return {
    priority:    'critical',
    label:       'Significant gaps',
    explanation: confidenceState === 'degraded'
      ? 'Score is uncertain due to limited peer data — treat as indicative only.'
      : 'Content falls well below niche performance benchmarks.',
    actions:     [],
  };
}

module.exports = { buildRecommendation };

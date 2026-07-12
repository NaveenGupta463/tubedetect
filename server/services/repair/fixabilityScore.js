'use strict';

// Repair windows and their fixability ceiling.
// A dying trajectory can raise URGENCY but must NOT inflate fixability
// once the actionable window has passed.
const WINDOW_CONFIG = {
  launch_rescue: { fixability_ceiling: 95, urgency_base: 90, hours_max: 24 },
  active_fix:    { fixability_ceiling: 75, urgency_base: 75, hours_max: 72 },
  recovery:      { fixability_ceiling: 50, urgency_base: 55, hours_max: 14 * 24 },
  follow_up:     { fixability_ceiling: 25, urgency_base: 30, hours_max: 30 * 24 },
  learning:      { fixability_ceiling: 10, urgency_base: 10, hours_max: Infinity },
  viral_decode:  { fixability_ceiling: 5,  urgency_base: 0,  hours_max: Infinity },
};

/**
 * Classify repair window from video age in hours.
 * viral_decode requires explicit caller flag (high VSR in learning window).
 */
function classifyRepairWindow(ageHours, isViral = false) {
  if (ageHours <= 24)           return 'launch_rescue';
  if (ageHours <= 72)           return 'active_fix';
  if (ageHours <= 14 * 24)      return 'recovery';
  if (ageHours <= 30 * 24)      return 'follow_up';
  if (isViral)                  return 'viral_decode';
  return 'learning';
}

/**
 * Compute urgency_score and fixability_score.
 *
 * Key rule: urgency rises with dying/declining trajectory, fixability does NOT.
 * Fixability is capped by the repair window regardless of trajectory.
 *
 * @param {string} repairWindow       - from classifyRepairWindow()
 * @param {string} trajectoryStatus   - 'viral'|'growing'|'stable'|'declining'|'stalled'|'unknown'
 * @param {number} trajectoryScore    - 0–100
 * @param {number} packagingRiskScore - 0–100
 * @param {boolean} doNotTouch        - true if video is performing well
 */
function computeFixabilityScore(repairWindow, trajectoryStatus, trajectoryScore, packagingRiskScore, doNotTouch) {
  if (doNotTouch) {
    return {
      urgency_score:    0,
      fixability_score: 0,
      evidence: { reason: 'do_not_touch' },
    };
  }

  const config = WINDOW_CONFIG[repairWindow] ?? WINDOW_CONFIG.learning;

  // Urgency: base from window + amplified by poor trajectory.
  // Dying/stalled video in active window = very urgent.
  let urgencyBase = config.urgency_base;
  if (trajectoryStatus === 'stalled' || trajectoryStatus === 'declining') {
    urgencyBase = Math.min(100, urgencyBase + 20);
  } else if (trajectoryStatus === 'growing' || trajectoryStatus === 'viral') {
    urgencyBase = Math.max(0, urgencyBase - 20);
  }
  // Also amplify if trajectory_score is low (performance is poor).
  const trajectoryPenalty = Math.max(0, (50 - trajectoryScore) * 0.4);
  const urgency = Math.min(100, Math.round(urgencyBase + trajectoryPenalty));

  // Fixability: capped by window ceiling.
  // Packaging risk contributes positively (if packaging is bad, fixing it can help).
  // Trajectory does NOT inflate fixability — only packaging opportunity does.
  const packagingOpportunity = packagingRiskScore; // 0–100 directly maps to opportunity
  const rawFixability = config.fixability_ceiling * (packagingOpportunity / 100);
  const fixability = Math.round(Math.min(config.fixability_ceiling, rawFixability));

  return {
    urgency_score:    urgency,
    fixability_score: fixability,
    evidence: {
      repair_window:        repairWindow,
      fixability_ceiling:   config.fixability_ceiling,
      packaging_opportunity: packagingOpportunity,
      trajectory_status:    trajectoryStatus,
    },
  };
}

module.exports = { classifyRepairWindow, computeFixabilityScore };

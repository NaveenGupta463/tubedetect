'use strict';

function scoreVideo(input) {
  const {
    views              = 0,
    channel_avg_views  = 0,
    like_rate          = 0,
    comment_rate       = 0,
    hook_score         = 0,
    emotion_score      = 0,
    shareability_score = 0,
    structure_score    = 0,
  } = input;

  // ── Step 1: Distribution score (continuous, floor 0) ───────────────────────

  const safe_avg     = Math.max(channel_avg_views || 0, 1);
  const ratio        = views / safe_avg;
  const distribution = Math.round(Math.min(100, Math.max(0, ratio * 100)));

  // ── Step 2: Engagement score (diminishing returns above 90) ────────────────

  let engagement = (like_rate * 5) + (comment_rate * 25);
  engagement = Math.min(100, engagement);
  if (engagement > 90) {
    engagement = 90 + (engagement - 90) * 0.5;
  }
  engagement = Math.round(engagement);

  // ── Step 3: Content score ───────────────────────────────────────────────────

  const content = Math.round(
    0.3 * hook_score +
    0.3 * emotion_score +
    0.2 * shareability_score +
    0.2 * structure_score
  );

  // ── Step 4: Raw final score ─────────────────────────────────────────────────

  const raw_score = Math.round(
    0.4 * distribution +
    0.3 * engagement +
    0.3 * content
  );

  // ── Step 5: Priority-based cap system ──────────────────────────────────────

  const caps = [];
  if (views < 500)                           caps.push({ value: 40, priority: 3 });
  if (hook_score < 40 && emotion_score < 40) caps.push({ value: 50, priority: 2 });
  if (shareability_score < 50)               caps.push({ value: 75, priority: 1 });

  let applied_cap = 100;
  if (caps.length > 0) {
    const selected = caps.sort((a, b) => b.priority - a.priority)[0];
    applied_cap = selected.value;
  }

  const final_score = Math.min(raw_score, applied_cap);
  const cap_applied = applied_cap < raw_score;

  // ── Step 6: Grade + label ───────────────────────────────────────────────────

  let grade, label;
  if      (final_score >= 80) { grade = 'A'; label = 'Scalable / Viral Potential'; }
  else if (final_score >= 65) { grade = 'B'; label = 'Good but Limited';           }
  else if (final_score >= 50) { grade = 'C'; label = 'Average';                    }
  else if (final_score >= 35) { grade = 'D'; label = 'Weak Performance';           }
  else                        { grade = 'F'; label = 'Dead Content';               }

  // ── Step 7: Diagnosis + action ──────────────────────────────────────────────

  const min_val = Math.min(distribution, engagement, content);
  const max_val = Math.max(distribution, engagement, content);
  const d = distribution === min_val;
  const e = engagement   === min_val;
  const c = content      === min_val;

  let diagnosis, action;

  if (cap_applied) {
    // Cap diagnosis overrides everything including "Strong performance"
    if (applied_cap === 40) {
      diagnosis = 'Severely limited — distribution or retention failure';
      action    = 'Focus on distribution — this video isn\'t reaching enough people yet';
    } else {
      diagnosis = 'Performance limited by critical constraint';
      action    = 'Remove the bottleneck — one key factor is limiting this video\'s growth';
    }
  } else if (final_score >= 85) {
    diagnosis = 'Strong performance — no major weaknesses';
    action    = 'No major changes needed';
  } else if (max_val - min_val < 10) {
    diagnosis = 'Balanced performance — no clear bottleneck';
    action    = 'Monitor performance — no single bottleneck, optimize overall';
  } else {
    // Weakest pillar logic
    if (d && e && c) {
      diagnosis = 'Low reach, weak audience response, and weak content strength';
      action    = 'Improve thumbnail/title for better CTR';
    } else if (d && e) {
      diagnosis = 'Low reach and weak audience response';
      action    = 'Improve thumbnail/title for better CTR';
    } else if (d && c) {
      diagnosis = 'Low reach and weak content strength';
      action    = 'Improve thumbnail/title for better CTR';
    } else if (e && c) {
      diagnosis = 'Weak engagement and content strength';
      action    = 'Improve audience interaction (likes/comments)';
    } else if (d) {
      if (distribution < 20) {
        diagnosis = 'Dead video — extremely low reach';
      } else if (distribution < 50) {
        diagnosis = 'Low reach — YouTube is not distributing this video';
      } else {
        diagnosis = 'Below potential reach — distribution is holding this video back';
      }
      action = 'Improve thumbnail/title for better CTR';
    } else if (e) {
      diagnosis = 'Low audience response — viewers are not engaging';
      action    = 'Improve audience interaction (likes/comments)';
    } else {
      // Content is sole weakest pillar — use specific sub-condition
      diagnosis = 'Content weakness — hook/emotion/structure limiting growth';
      if (hook_score < 40 && emotion_score < 40) {
        action = hook_score <= emotion_score
          ? 'Fix first 3 seconds — weak hook is killing retention'
          : 'Increase emotional payoff — content feels flat';
      } else if (hook_score < 40) {
        action = 'Fix first 3 seconds — weak hook is killing retention';
      } else if (emotion_score < 40) {
        action = 'Increase emotional payoff — content feels flat';
      } else {
        action = 'Improve structure — pacing and flow need work';
      }
    }
  }

  // ── Step 8: Confidence ──────────────────────────────────────────────────────

  let confidence;
  if (cap_applied) {
    confidence = 'High';
  } else if (max_val - min_val < 10) {
    confidence = 'Low';
  } else {
    confidence = 'Medium';
  }

  // ── Step 9: Output ──────────────────────────────────────────────────────────

  return {
    final_score,
    grade,
    label,
    diagnosis,
    action,
    confidence,
    breakdown: { distribution, engagement, content },
    raw_score,
    applied_cap,
    cap_applied,
  };
}

module.exports = { scoreVideo };

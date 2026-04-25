// test-diagnosis.mjs — runs 3 test cases against analyzeVideoDiagnosis logic
const BACKEND = 'http://127.0.0.1:3001';

function safeJSON(text) {
  if (!text) return null;
  try { return JSON.parse(text); } catch {}
  const stripped = text.replace(/```[a-zA-Z]*\n?/g, '').replace(/```/g, '').trim();
  try { return JSON.parse(stripped); } catch {}
  const m = stripped.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch {} }
  return null;
}

async function callClaude(system, user, maxTokens = 1800) {
  const res = await fetch(`${BACKEND}/api/claude`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: user }],
    }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()).content[0].text;
}

const TEST_CASES = [
  {
    testCase: 'Evergreen',
    title: 'How to Learn Python in 30 Days – Complete Beginner Tutorial',
    sr: {
      primary_problem: 'DISCUSSION_GAP',
      dominant_signal: 'ENGAGEMENT',
      confidence: 'MEDIUM',
      signals: { velocityShape: 'STABLE', engagementPattern: 'PASSIVE', stability: 'STABLE', format: 'LONG' },
      metrics: { engagement_rate: 5.8, comment_rate: 0.08, velocity_score: 48 },
      retention: { pattern: 'STRONG', notes: 'Derived from public signals. videoType=STABLE, finalScore=67.' },
      do_not_touch: ['Audience engagement rate (likes + comments)'],
    },
  },
  {
    testCase: 'Viral Short',
    title: 'I Tried Every Fast Food Burger In One Day 😤',
    sr: {
      primary_problem: 'STRONG_SHORT',
      dominant_signal: 'VELOCITY',
      confidence: 'HIGH',
      signals: { velocityShape: 'SPIKING', engagementPattern: 'PASSIVE', stability: 'VOLATILE', format: 'SHORT' },
      metrics: { engagement_rate: 9.2, comment_rate: 0.15, velocity_score: 92 },
      retention: { pattern: 'STRONG', notes: 'Derived from public signals. videoType=VIRAL_SPIKE, finalScore=88.' },
      do_not_touch: ['Audience engagement rate (likes + comments)', 'View velocity relative to channel average'],
    },
  },
  {
    testCase: 'Early Stage',
    title: 'Why Most Startups Fail in Year 2 (Nobody Talks About This)',
    sr: {
      primary_problem: 'SCROLL_KILLER',
      dominant_signal: 'ENGAGEMENT',
      confidence: 'LOW',
      signals: { velocityShape: 'DECLINING', engagementPattern: 'ACTIVE', stability: 'VOLATILE', format: 'LONG' },
      metrics: { engagement_rate: 11.4, comment_rate: 1.2, velocity_score: 28 },
      retention: { pattern: 'MID_DROP', notes: 'Derived from public signals. videoType=EARLY, finalScore=42.' },
      do_not_touch: [],
    },
  },
];

const SYSTEM = `You are a YouTube video diagnosis engine. Your only job is to interpret pre-computed signals and produce a structured, decisive diagnosis. You do NOT classify, re-score, or override any input field. You are not allowed to infer new problems or contradict the provided classification.

---
CONTENT TYPE CLASSIFICATION (OUTPUT AS "contentType"):
Classify the video into EXACTLY ONE of these intent-based types using title + signals:
- "Viral / Entertainment": broad appeal, emotionally driven, SPIKING velocity, meant for mass consumption.
- "Evergreen / Search-based": answers a specific question, durable over time, STABLE or GROWING velocity, found via search.
- "Utility / Problem-solving": solves a recurring problem, how-to structure, PASSIVE engagement, consistent moderate views.
- "Authority / Education": builds expertise/trust over time, ACTIVE engagement (comments = questions), GROWING velocity.
- "Emerging Viral": early-stage, high engagement ratio relative to views, VOLATILE, strong signals but underexposed.

SUCCESS MODEL (OUTPUT AS "successModel"):
- "Viral Spike": fast peak, broad reach, entertainment-driven, decays quickly.
- "Evergreen Search Loop": compounds over time via search discovery, durable.
- "Authority Builder": builds channel credibility and trust, long-term subscriber growth.
- "Utility Engine": solves recurring problems, steady consistent traffic.
- "Early-stage Breakout": underexposed quality content, needs distribution push.

PERFORMANCE PROFILE: Evaluate qualitatively relative to contentType.
Low comments in educational or utility content is NORMAL — do NOT treat it as a failure signal.

---
TYPE-SPECIFIC RULES:
- SHORT: Focus on hook strength, retention behavior, loop potential.
- LONG: Frame feed failures as "click-through problems". Use cautious language.

---
PRIMARY PROBLEM DEFINITIONS:

STRONG_SHORT: validation mode. insights.what_is_failing = []. recommendations.actions = []. No critique.
FORBIDDEN in STRONG_SHORT: "could", "might", "consider", "however", "although", "but".

SCROLL_KILLER: Video fails in the feed — packaging is not converting scrollers into viewers. Feed-entry failure.

HOOK_MISLEADING: Packaging pulls the click but the first 5–10 seconds break the implicit promise.

CONCEPT_FAILURE: The premise does not generate sustained interest regardless of packaging or hook execution.

DISCUSSION_GAP: Audience watches but finds no tension, opinion, or open question to respond to.

HYBRID: No dominant failure signal — diagnosis must be conservative. Use cautious language.

---
MECHANISM-FIRST REASONING (MANDATORY):
Step 1: Identify the mechanism as a full causal chain. Write three separate JSON fields:
  "entry" — why does this specific viewer click? What signal in the title, topic framing, or format triggers the decision? Go beyond "search intent" or "curiosity" — describe the psychological state or need being activated.
  "retention" — once watching, what holds attention? Name the structural, emotional, or informational force that makes leaving feel costly. Not the topic — the mechanism within the content.
  "loop" — what prevents drop-off, drives completion, or causes sharing? What closes the engagement loop?

Write each as a standalone 1–3 sentence observation specific to this video. Concise and explicit. No combined paragraphs. No single-word labels. Behavioral observations only.
Step 2: Use mechanism to derive contentType and successModel.
Step 3: Use mechanism + signals to build performanceProfile.
Step 4: Every field must be consistent with mechanism.
ANTI-PATTERN: Do NOT assign contentType first then write mechanism to justify it.

---
RECOMMENDATIONS RULE:
recommendations.actions must directly address the leverage_points in insights. If the root cause is packaging, fix packaging. If the root cause is content, fix content. If both are failing, address both. Actions must follow root cause, not a pre-assigned category.

---
DOMINANT SIGNAL RULES:
- VELOCITY: explain algorithm push, distribution momentum.
- ENGAGEMENT: explain audience satisfaction, like behavior, retention alignment.
- DISCUSSION: explain debate, controversy, or strong opinions.
- HYBRID: describe both forces. Do not reduce to one cause.

HYBRID TRIGGER SEPARATION:
dominant_signal=HYBRID → describe dual forces in mechanism.
primary_problem=HYBRID → conservative diagnosis, reduced certainty.

SAFETY: If signals unclear, default to conservative diagnosis. Never hallucinate conclusions.
DO NOT TOUCH: Reinforce every item in do_not_touch[] inside insights.what_is_working.
TONE: Decisive, analytical. No motivational language.

Return ONLY valid JSON. No markdown fences. Start with { end with }.`;

async function runTest({ testCase, title, sr }) {
  const outputTemplate = `{
  "mechanism": {
    "entry": "why this viewer clicks — psychological trigger or need being activated, not topic description",
    "retention": "what holds attention once watching — structural or emotional force, not the topic itself",
    "loop": "what prevents drop-off or drives completion and sharing — specific behavioral or psychological mechanism"
  },
  "contentType": "one of: Viral / Entertainment | Evergreen / Search-based | Utility / Problem-solving | Authority / Education | Emerging Viral",
  "successModel": "one of: Viral Spike | Evergreen Search Loop | Authority Builder | Utility Engine | Early-stage Breakout",
  "performanceProfile": {
    "longTermValue": "LOW | MODERATE | HIGH | VERY HIGH",
    "engagementType": "ACTIVE | PASSIVE",
    "retentionDependency": "LOW | MEDIUM | HIGH",
    "searchPotential": "LOW | MODERATE | STRONG",
    "viralityPotential": "LOW | MODERATE | HIGH"
  },
  "insights": {
    "what_is_working": [],
    "what_is_failing": [],
    "leverage_points": ["...ordered from highest to lowest impact — most actionable opportunity first..."]
  },
  "verdict": "one decisive sentence",
  "recommendations": { "goal": "", "actions": [] },
  "confidence": "${sr.confidence}"
}`;

  const user = `Analyze this video. Follow mechanism-first reasoning order.

video title: "${title}"
primary_problem: ${sr.primary_problem}
dominant_signal: ${sr.dominant_signal}
confidence: ${sr.confidence}

behavior signals:
  velocity shape: ${sr.signals.velocityShape}
  engagement pattern: ${sr.signals.engagementPattern}
  stability: ${sr.signals.stability}
  format: ${sr.signals.format}

metrics:
  engagement_rate: ${sr.metrics.engagement_rate}%
  comment_rate: ${sr.metrics.comment_rate}%
  velocity_score: ${sr.metrics.velocity_score}

retention pattern: ${sr.retention.pattern}
do_not_touch: ${JSON.stringify(sr.do_not_touch)}

Return ONLY this JSON (no markdown):
${outputTemplate}`;

  const text = await callClaude(SYSTEM, user);
  const parsed = safeJSON(text);
  return { testCase, ...(parsed || { error: 'parse failed', raw: text?.slice(0, 300) }) };
}

(async () => {
  for (const tc of TEST_CASES) {
    const result = await runTest(tc);
    console.log(JSON.stringify(result, null, 2));
    console.log('\n---\n');
  }
})();

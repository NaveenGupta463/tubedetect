'use strict';

const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

async function generateCoach(result) {
  const topicLine = result.topic
    ? `Topic: ${result.topic}\nNiche: ${result.niche}`
    : `Niche: ${result.niche}`;

  const titleInstruction = result.topic
    ? `Write 3 titles specifically for "${result.topic}" in the ${result.niche} niche. Each must be directly publishable — concrete outcomes, real numbers or timeframes where relevant, no placeholders.`
    : `Write 3 titles for the "${result.niche}" niche. Each must be concrete and publish-ready — name real outcomes, timeframes, or contrarian angles that ${result.niche} viewers respond to. No placeholders.`;

  const hookInstruction = result.topic
    ? `Write the exact words to say in the first 5 seconds for a ${result.niche} video about "${result.topic}". Use a specific fact, contrarian claim, or curiosity gap tied to the topic.`
    : `Write the exact words to say in the first 5 seconds for a ${result.niche} video. Use a specific claim, result, or tension relevant to ${result.niche} viewers — no generic openers.`;

  const prompt = `You are a YouTube performance auditor. You diagnose why videos underperform and prescribe exact changes. You do not explain the obvious. You do not encourage. You identify root causes and state fixes precisely.

DATA:
Score: ${result.final_score}
Distribution: ${result.breakdown.distribution}
Engagement: ${result.breakdown.engagement}
Content: ${result.breakdown.content}
Diagnosis: ${result.diagnosis}
${topicLine}

SIGNAL MAPPING (apply this before writing INSIGHT — pick the matching pattern):
- Engagement high + Distribution low → root cause is packaging (thumbnail/title CTR failure)
- Engagement low + Distribution high → root cause is weak content or retention drop after click
- Content low + Engagement high → root cause is drop-off after hook (click happens, content loses them)
- All three low and balanced → root cause is weak concept or topic with no audience demand

RULES:
- INSIGHT must apply the signal mapping above — do not reason from scratch
- INSIGHT format: [Observed pattern from scores] because [root cause from mapping]
- INSIGHT must be 1–2 lines max — precise and causal, no vague phrasing
- INSIGHT must NOT restate the diagnosis input
- Output EXACTLY 3 FIXES — never 2, never 4. If you have more candidates, keep only the 3 highest-impact ones.
- Every FIX must target the root cause identified in INSIGHT — no generic suggestions
- Every FIX must follow exactly: [specific change with a number or constraint] → [mechanism explaining how it improves performance]
- Do not use fake metric predictions (no "CTR will increase by 3%") — describe the mechanism instead
- Do not use words like "improve", "optimize", "enhance", "consider", or "try"
- Never use placeholders like [Problem], [Topic], or [Specific Thing]
- Focus on CTR and retention — avoid SEO/tag advice unless distribution is under 20
- Tone: direct, precise, audit-style — no encouragement, no filler

OUTPUT FORMAT (follow exactly):

INSIGHT:
[Observed pattern] because [root cause — from signal mapping above. 1–2 lines max.]

FIXES:
- [Specific change with number or constraint] → [mechanism/outcome]
- [Specific change with number or constraint] → [mechanism/outcome]
- [Specific change with number or constraint] → [mechanism/outcome]

TITLES:
${titleInstruction}
-
-
-

HOOK (first 5 seconds script):
${hookInstruction}`;

  try {
    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 550,
      temperature: 0.3,
      messages: [{ role: 'user', content: prompt }],
    });

    return message.content[0]?.text ?? null;
  } catch {
    return null;
  }
}

module.exports = { generateCoach };

const BACKEND = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001';
const MODEL   = 'claude-sonnet-4-6';

async function callClaude(system, user, maxTokens = 1200) {
  const res = await fetch(`${BACKEND}/api/claude`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: user }],
    }),
  });

  if (res.status === 401) throw new Error('AI service authentication error. Please restart the backend.');
  if (res.status === 429) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error || 'AI call limit reached. Upgrade your plan to continue.');
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || err?.error || `TubeIntel error ${res.status}`);
  }
  return (await res.json()).content[0].text;
}

// Vision-capable call — imageSource: { type: 'base64'|'url', data, mediaType? }
async function callClaudeVision(system, imageSource, textPrompt, maxTokens = 800) {
  const imgBlock = imageSource.type === 'base64'
    ? { type: 'image', source: { type: 'base64', media_type: imageSource.mediaType || 'image/jpeg', data: imageSource.data } }
    : { type: 'image', source: { type: 'url', url: imageSource.data } };

  const res = await fetch(`${BACKEND}/api/claude`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: [imgBlock, { type: 'text', text: textPrompt }] }],
    }),
  });

  if (res.status === 401) throw new Error('AI service authentication error. Please restart the backend.');
  if (res.status === 429) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error || 'AI call limit reached. Upgrade your plan to continue.');
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || err?.error || `TubeIntel error ${res.status}`);
  }
  return (await res.json()).content[0].text;
}

function safeJSON(text) {
  if (!text) return null;
  // 1. Try raw parse first
  try { return JSON.parse(text); } catch {}
  // 2. Aggressively strip ALL markdown fences (```json, ```JSON, ```, etc.)
  //    Use global replace so multiple fences are all removed
  const stripped = text
    .replace(/```[a-zA-Z]*\n?/g, '')  // remove opening fences
    .replace(/```/g, '')               // remove closing fences
    .trim();
  try { return JSON.parse(stripped); } catch {}
  // 3. Extract the outermost { ... } block (handles leading/trailing prose)
  const m = stripped.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch {} }
  // 4. Same on original text
  const m2 = text.match(/\{[\s\S]*\}/);
  if (m2) { try { return JSON.parse(m2[0]); } catch {} }
  return null;
}

// Last-resort: pull a string value from malformed JSON-like text
function extractField(text, key) {
  const m = text.match(new RegExp(`"${key}"\\s*:\\s*"([^"]*)"`, 's'));
  return m ? m[1] : null;
}

export async function analyzeViralFormula(videoData, commentsText) {
  const system = `You are a world-class YouTube growth strategist who has reverse-engineered hundreds of viral videos. You give hyper-specific, immediately actionable analysis — not vague advice. Every insight should be something a creator can act on TODAY.`;
  const user = `Deeply analyze this viral video and extract every replicable element:

Video: "${videoData.title}"
Views: ${videoData.views} | Likes: ${videoData.likes} | Duration: ${videoData.duration}
Like rate: ${videoData.likeRate}% | Comment rate: ${videoData.commentRate}%
Published: ${videoData.publishedAt}

Top comments (real audience reactions):
${commentsText}

Respond in this exact JSON with deep, specific analysis — no generic advice:
{
  "hookStyle": "Precisely describe the psychological hook technique used in the first 5-10 seconds and WHY it triggers viewer curiosity (e.g. 'Pattern interrupt: opens mid-action with the shocking result before explaining how, exploiting the Zeigarnik effect')",
  "titlePattern": "Identify the exact cognitive trigger in this title (e.g. 'Curiosity gap + social proof: hides the specific number while implying massive scale, creates FOMO')",
  "thumbnailStrategy": "Describe the specific visual psychology at play — color contrast, facial expression if any, text overlay strategy, and the specific emotion it triggers",
  "optimalLength": "Based on the comment sentiment and engagement rate, what is the EXACT ideal video length for this niche and why — reference the specific data from this video",
  "pacingSignals": "What do the comments reveal about which moments hit hardest and which lost viewers? Be specific about timestamps or themes mentioned",
  "replicableTemplate": "5 precise bullet points a creator can follow TODAY to replicate this format — each bullet should be a specific, actionable instruction",
  "winFactors": ["specific factor 1 with data", "specific factor 2 with data", "specific factor 3 with data", "specific factor 4 with data", "specific factor 5 with data"],
  "stealThisFormula": {
    "titleTemplate": "A word-for-word title template with [VARIABLE] placeholders they can fill in for their own niche — e.g. 'I [DRAMATIC ACTION] for [TIME PERIOD] and Here's What [SHOCKING OUTCOME]'",
    "hookScript": "Write the exact word-for-word script for the first 30 seconds they should record, based on what made this video work. Include the opening line, the tension-building, and the promise to the viewer. Make it sound natural and conversational.",
    "thumbnailDescription": "Extremely specific thumbnail recreation instructions: exact background color/scene, subject positioning, text overlay (exact words and font style), color scheme, and any graphic elements — specific enough that a designer could recreate it from scratch"
  }
}

IMPORTANT: Respond with ONLY the JSON object above. No markdown, no backticks, no explanation before or after. Start your response with { and end with }.`;
  const text = await callClaude(system, user, 2000);
  console.log('[ViralFormula] raw AI response:', text);
  const parsed = safeJSON(text);
  if (parsed) return parsed;
  // Fallback: extract whatever fields we can from the text
  console.warn('[ViralFormula] JSON parse failed, using text fallback');
  return {
    hookStyle: extractField(text, 'hookStyle') || text.slice(0, 400),
    titlePattern: extractField(text, 'titlePattern') || '',
    thumbnailStrategy: extractField(text, 'thumbnailStrategy') || '',
    optimalLength: extractField(text, 'optimalLength') || '',
    pacingSignals: extractField(text, 'pacingSignals') || '',
    replicableTemplate: extractField(text, 'replicableTemplate') || '',
    winFactors: [],
    stealThisFormula: null,
  };
}

export async function analyzeThumbnailImage(imageSource) {
  const system = `You are a YouTube thumbnail performance expert. Analyze the visual only — no hallucinations. Be blunt. Keep answers short.`;
  const user = `Analyze this YouTube thumbnail for click performance.

Respond ONLY with this JSON. No markdown, no backticks. Start with { end with }:
{
  "thumbnailScore": 0-100,
  "lowQuality": true|false,
  "attentionGrab": { "score": 0-100, "reason": "max 10 words" },
  "emotionVisibility": { "score": 0-100, "reason": "max 10 words" },
  "clarityAtSmallSize": { "score": 0-100, "reason": "max 10 words" },
  "visualContrast": { "score": 0-100, "reason": "max 10 words" },
  "wouldYouNotice": { "answer": "Yes" | "Maybe" | "No", "reason": "max 12 words" },
  "visualWeaknessTags": ["tag1", "tag2"],
  "quickVisualFixes": ["fix 1 max 12 words", "fix 2 max 12 words", "fix 3 max 12 words"]
}

RULES: lowQuality=true if image is blurry, too small, or unreadable. visualWeaknessTags: pick up to 3 from — "Low Contrast", "No Clear Subject", "Weak Emotion", "Too Busy", "Hard to Read". quickVisualFixes max 3. Only describe what is actually visible — do NOT invent details.`;
  const text = await callClaudeVision(system, imageSource, user, 700);
  return safeJSON(text) || { thumbnailScore: 50 };
}

export async function scoreTitle(title, thumbnailDesc, niche) {
  const system = `You are a brutally honest YouTube CTR strategist. You validate video ideas in seconds. No fluff. No encouragement. Only what's true about whether this idea will get clicked.`;
  const user = `Validate this YouTube idea:

Title: "${title}"
Thumbnail: "${thumbnailDesc || 'not described'}"
Niche: "${niche || 'general'}"

Respond ONLY with this exact JSON. No markdown, no backticks. Start with { end with }:
{
  "ideaScore": 0-100,
  "ideaLabel": "High Click Potential" | "Good but Needs Optimization" | "Weak Hook" | "Likely Ignored",
  "ctrPrediction": { "score": 0-100, "reason": "max 10 words" },
  "scrollStopPower": { "score": 0-100, "reason": "max 10 words" },
  "curiosityGap": { "score": 0-100, "reason": "max 10 words" },
  "clarityScore": { "score": 0-100, "reason": "max 10 words" },
  "wouldYouClick": { "answer": "Yes" | "Maybe" | "No", "reason": "1-line psychological reason" },
  "weaknessPatterns": ["tag1", "tag2"],
  "quickFixes": ["fix 1 max 12 words", "fix 2 max 12 words", "fix 3 max 12 words"],
  "improvedTitles": [
    { "title": "string", "angle": "Curiosity" | "Emotion" | "Clarity", "reason": "max 10 words" },
    { "title": "string", "angle": "Curiosity" | "Emotion" | "Clarity", "reason": "max 10 words" },
    { "title": "string", "angle": "Curiosity" | "Emotion" | "Clarity", "reason": "max 10 words" }
  ],
  "thumbnailUpgrade": "1 specific visual change that would double CTR",
  "thumbnailIdeas": ["idea 1 under 15 words", "idea 2 under 15 words", "idea 3 under 15 words"]
}

RULES: ideaScore 80-100 = High Click Potential, 60-79 = Good but Needs Optimization, 40-59 = Weak Hook, 0-39 = Likely Ignored. quickFixes max 3. Each improvedTitle must use a different angle. weaknessPatterns: up to 3 from — "Generic", "Low Curiosity", "No Stakes", "Weak Emotion", "Overcrowded Topic" — return [] if strong. thumbnailIdeas: ONLY populate (3 items, each under 15 words) when Thumbnail is "not described" — each must include visual concept + emotion/face + key object + contrast direction. If thumbnail IS described, return thumbnailIdeas: [].`;
  const text = await callClaude(system, user, 1200);
  return safeJSON(text) || { ideaScore: 50, ideaLabel: 'Weak Hook' };
}

export async function battleTitles(titleA, titleB, thumbnailDesc) {
  const system = `You are a YouTube CTR expert. Compare two titles and pick the winner decisively. One word answers only for winner.`;
  const user = `Which title gets more clicks?

Title A: "${titleA}"
Title B: "${titleB}"
Thumbnail: "${thumbnailDesc || 'not described'}"

Respond ONLY with this JSON. No markdown, no backticks:
{"winner":"A"|"B","confidence":51-99,"reason":"max 12 words why winner beats loser","loserReason":"max 8 words why loser failed"}`;
  const text = await callClaude(system, user, 200);
  return safeJSON(text) || { winner: 'A', confidence: 55, reason: 'Could not compare.', loserReason: '' };
}

export async function analyzeCommentSentiment(commentsText, videoTitle) {
  const system = `You are a world-class YouTube audience intelligence analyst. You mine comment sections for deep psychological insights that reveal what audiences truly want but aren't getting. You identify specific content gaps and emotional patterns with surgical precision.`;
  const user = `Deeply analyze these comments for video: "${videoTitle}"

Comments:
${commentsText}

Respond in this exact JSON — be extremely specific, not generic:
{
  "overallSentiment": "positive/neutral/negative/mixed",
  "sentimentBreakdown": { "positive": 0-100, "neutral": 0-100, "negative": 0-100 },
  "emotionBreakdown": {
    "curiosity": 0-100,
    "excitement": 0-100,
    "disappointment": 0-100,
    "humor": 0-100
  },
  "topThemes": [
    { "theme": "specific theme name", "sentiment": "positive/negative/neutral", "frequency": "high/medium/low", "example": "actual quote from comments" }
  ],
  "topQuestions": ["exact question phrasing viewers keep asking 1", "exact question 2", "exact question 3"],
  "topComplaints": ["specific complaint with context 1", "specific complaint 2"],
  "contentGaps": ["content gap idea 1", "content gap idea 2", "content gap idea 3", "content gap idea 4", "content gap idea 5"],
  "contentGapTitles": [
    "Specific, publish-ready video title based on gap 1 — something a creator could film this week",
    "Specific, publish-ready video title based on gap 2",
    "Specific, publish-ready video title based on gap 3",
    "Specific, publish-ready video title based on gap 4",
    "Specific, publish-ready video title based on gap 5"
  ],
  "audiencePersona": "Specific 2-sentence description: who exactly is watching (age range, motivation, knowledge level, what they're trying to achieve)",
  "emotionalTriggers": ["specific trigger 1", "specific trigger 2", "specific trigger 3"]
}`;
  const text = await callClaude(system, user, 1600);
  return safeJSON(text) || { overallSentiment: 'mixed', sentimentBreakdown: { positive: 50, neutral: 30, negative: 20 } };
}

export async function generateScriptOutline(topic, niche, lengthMinutes, tone, ctaGoal) {
  const system = `You are a professional YouTube scriptwriter who has written for channels with 10M+ subscribers. You write scripts that hook viewers in the first 5 seconds and hold retention throughout. Every section you write is specific, punchy, and designed for maximum watch time. You always respond with valid JSON only.`;
  const user = `Write a FULL, DETAILED YouTube script for:

Topic: "${topic}"
Niche: "${niche || 'general'}"
Target length: ${lengthMinutes} minutes
Tone: ${tone}
CTA Goal: "${ctaGoal || 'subscribe'}"

Respond with ONLY this JSON object — no markdown, no backticks, start with { end with }:
{
  "openingLine": "The exact word-for-word first sentence the creator should say on camera. Make it the most compelling possible opening — a pattern interrupt, shocking stat, or bold claim that forces viewers to keep watching.",
  "hookScript": "The complete word-for-word script for the first 30 seconds including the opening line, tension-building, and the viewer promise. Written naturally as spoken dialogue.",
  "chapters": [
    {
      "title": "Chapter 1 title — compelling and specific",
      "duration": "0:30–3:00",
      "talkingPoints": [
        "Exact talking point 1 — written as specific instruction for what to say and show",
        "Exact talking point 2 — include any specific examples, stats, or stories to tell",
        "Exact talking point 3 — include transition to next chapter"
      ]
    },
    {
      "title": "Chapter 2 title",
      "duration": "3:00–6:00",
      "talkingPoints": ["point 1", "point 2", "point 3"]
    },
    {
      "title": "Chapter 3 title",
      "duration": "6:00–9:00",
      "talkingPoints": ["point 1", "point 2", "point 3"]
    },
    {
      "title": "Chapter 4 title",
      "duration": "9:00–12:00",
      "talkingPoints": ["point 1", "point 2", "point 3"]
    },
    {
      "title": "Chapter 5 title",
      "duration": "12:00–${lengthMinutes}:00",
      "talkingPoints": ["point 1", "point 2", "point 3"]
    }
  ],
  "ctaScript": "The exact word-for-word CTA the creator should deliver at the end. Include what to say, when to pause, what to gesture toward, and the specific ask: ${ctaGoal || 'subscribe'}",
  "thumbnailConcept": "Highly specific thumbnail instructions: exact background, subject positioning, text overlay words and font style, color scheme, graphic elements",
  "titleOptions": [
    "Best title — highest CTR potential",
    "Alternative title — different psychological angle",
    "Bold title — most curiosity-driven"
  ]
}`;
  const text = await callClaude(system, user, 2000);
  const parsed = safeJSON(text);
  if (parsed) return parsed;
  // fallback: return a minimal structured object with the raw text
  return { openingLine: text, hookScript: '', chapters: [], ctaScript: '', thumbnailConcept: '', titleOptions: [] };
}

export async function analyzeTrends(searchResults, niche) {
  const system = `You are an elite YouTube trend analyst who identifies content opportunities before they peak. You give hyper-specific, immediately actionable insights — not generic observations. Every recommendation comes with a specific angle a creator can film this week.`;
  const user = `Niche: "${niche}"

Top performing videos in the last 30 days:
${searchResults.map((v, i) => `${i + 1}. "${v.title}" — ${v.views} views (${v.channel})`).join('\n')}

Respond in this exact JSON — be extremely specific:
{
  "trendingAngles": [
    {
      "angle": "specific content angle name",
      "momentum": "rising/peaking/declining",
      "opportunity": "specific reason why NOW is the right time",
      "whyTrending": "2-3 sentence explanation of the cultural/algorithmic/seasonal reason this is blowing up right now",
      "howToMakeYourVersion": "One specific, immediately actionable angle suggestion — e.g. 'Make a video titled [X] that covers [Y] from the angle of [Z] — this would differentiate from the existing videos by doing [specific thing]'"
    }
  ],
  "titlePatterns": ["exact pattern 1 with example", "exact pattern 2 with example", "exact pattern 3 with example"],
  "saturationLevel": "low/medium/high",
  "emergingFormats": ["specific format 1 with description", "specific format 2"],
  "contentOpportunities": [
    {
      "idea": "specific publish-ready video idea with a real title",
      "reason": "why this specific idea would win in the current landscape",
      "urgency": "high/medium/low"
    }
  ],
  "summary": "2-3 sentence expert trend summary with specific data points from the videos listed"
}

IMPORTANT: Respond with ONLY the JSON object above. No markdown, no backticks, no explanation before or after. Start your response with { and end with }.`;
  const text = await callClaude(system, user, 3000);
  console.log('[analyzeTrends] raw AI response:', text);
  const parsed = safeJSON(text);
  if (parsed) return parsed;
  console.warn('[analyzeTrends] JSON parse failed');
  throw new Error('AI returned an unexpected format. Please try again.');
}

export async function analyzeVideoDeep(videoData, commentsText) {
  const system = `You are TubeIntel's elite YouTube content analyst. You deliver deep, specific, actionable analysis across 5 key dimensions. You receive the video title, statistics, tags, and top viewer comments — you do NOT have access to the video content itself. For the structure timeline and retention curve, you must clearly frame your output as RECOMMENDATIONS and PREDICTIONS based on the title/niche/engagement data, not as descriptions of what actually happens in the video. Every insight must be specific to the video data — no generic platitudes. Always return valid JSON only.`;
  const user = `Analyze this YouTube video across 5 dimensions:

Title: "${videoData.title}"
Views: ${videoData.views} | Likes: ${videoData.likes} | Comments: ${videoData.commentCount}
Engagement: ${videoData.engagementRate}% | Like rate: ${videoData.likeRate}% | Comment rate: ${videoData.commentRate}%
Duration: ${videoData.duration} | Published: ${videoData.publishedAt}
vs Channel avg: ${videoData.vsChannelAvg}% | Tags: ${videoData.tags}

Top comments:
${commentsText}

Return ONLY this JSON (no markdown, start with {, end with }):
{
  "titleThumbnail": {
    "curiosityScore": 72,
    "emotionalScore": 65,
    "clarityScore": 80,
    "scrollStoppingScore": 70,
    "analysis": "2-3 specific sentences about title psychology and why it works or doesn't",
    "triggers": ["Specific trigger 1", "Trigger 2", "Trigger 3"],
    "seoNote": "One sentence on keyword strength and discoverability",
    "improvedTitles": [
      {"title": "Improved title 1", "reason": "Why better", "type": "High CTR"},
      {"title": "Improved title 2", "reason": "Why better", "type": "SEO"},
      {"title": "Improved title 3", "reason": "Why better", "type": "Curiosity"}
    ],
    "thumbnailTips": ["Specific visual tip 1", "Tip 2", "Tip 3"]
  },
  "hookStructure": {
    "hookType": "pattern_interrupt",
    "hookStrength": 75,
    "hookAnalysis": "2 specific sentences analyzing the opening hook's likely effectiveness based on the title style and viewer comment reactions",
    "timeline": [
      {"phase": "Hook", "time": "0:00-0:30", "desc": "What this phase should contain to maximise retention for this title/niche", "strength": 80},
      {"phase": "Context", "time": "0:30-1:30", "desc": "Recommended content", "strength": 70},
      {"phase": "Problem", "time": "1:30-3:00", "desc": "Recommended content", "strength": 75},
      {"phase": "Escalation", "time": "3:00-5:00", "desc": "Recommended content", "strength": 82},
      {"phase": "Climax", "time": "5:00-7:00", "desc": "Recommended content", "strength": 88},
      {"phase": "Resolution", "time": "7:00-8:30", "desc": "Recommended content", "strength": 65},
      {"phase": "CTA", "time": "8:30-end", "desc": "Recommended content", "strength": 55}
    ],
    "retention": [
      {"segment": "0-25%", "rate": 80, "note": "Predicted reason"},
      {"segment": "25-50%", "rate": 72, "note": "Predicted reason"},
      {"segment": "50-75%", "rate": 64, "note": "Predicted reason"},
      {"segment": "75-100%", "rate": 52, "note": "Predicted reason"}
    ],
    "patternInterrupts": "Pattern interrupt techniques that would work well for this content type",
    "curiosityLoops": "How open loops could maintain viewer attention based on title and comment sentiment"
  },
  "psychology": {
    "triggers": [
      {"name": "Social Proof", "present": true, "strength": 70, "note": "Specific example from this video"},
      {"name": "Scarcity/FOMO", "present": false, "strength": 0, "note": "Why absent or weak"},
      {"name": "Authority", "present": true, "strength": 65, "note": "Specific example"},
      {"name": "Reciprocity", "present": false, "strength": 0, "note": "Assessment"},
      {"name": "Curiosity Gap", "present": true, "strength": 80, "note": "Specific example"},
      {"name": "Relatability", "present": true, "strength": 75, "note": "Specific example"},
      {"name": "Controversy", "present": false, "strength": 0, "note": "Assessment"},
      {"name": "Emotion", "present": true, "strength": 72, "note": "Specific example"}
    ],
    "pacing": "2 sentences assessing video pacing based on duration and engagement data",
    "engagementTips": ["Specific retention tip 1", "Tip 2", "Tip 3"],
    "density": 68,
    "densityNote": "One sentence: is info density optimal, too high, or too low for this niche"
  },
  "algorithm": {
    "virality": {"novelty": 65, "controversy": 30, "relatability": 75, "emotionalIntensity": 70, "shareability": 60},
    "ctrFactors": ["Specific CTR driver 1", "Driver 2", "Driver 3"],
    "retentionFactors": ["Specific retention driver 1", "Driver 2"],
    "monetizationLayers": ["Detected monetization approach 1", "Approach 2"],
    "algorithmScore": 70,
    "insight": "2 specific sentences on how this video is likely performing algorithmically"
  },
  "blueprint": {
    "viralScore": 72,
    "grade": "B",
    "scores": {
      "titleThumbnail": 70,
      "hookRetention": 75,
      "contentStructure": 72,
      "engagement": 68,
      "algorithm": 70,
      "seoDiscoverability": 65,
      "emotionalImpact": 72,
      "valueDelivery": 78
    },
    "contentDNA": "One-line formula: [Hook type] + [Value prop] + [Emotional trigger] = [Result]",
    "replicationBlueprint": [
      "Step 1: specific actionable instruction",
      "Step 2: specific actionable instruction",
      "Step 3: specific actionable instruction",
      "Step 4: specific actionable instruction",
      "Step 5: specific actionable instruction"
    ],
    "lessons": [
      {"title": "Lesson title", "detail": "2 specific sentences applicable to future videos"},
      {"title": "Lesson title", "detail": "2 specific sentences"},
      {"title": "Lesson title", "detail": "2 specific sentences"},
      {"title": "Lesson title", "detail": "2 specific sentences"},
      {"title": "Lesson title", "detail": "2 specific sentences"}
    ],
    "strengths": "2 sentences summarizing the video's core strengths",
    "improvements": "2 sentences on the key areas to improve next time"
  }
}`;
  const text = await callClaude(system, user, 6000);
  console.log('[analyzeVideoDeep] raw response (first 300 chars):', text?.slice(0, 300));
  const parsed = safeJSON(text);
  if (parsed) return parsed;
  console.warn('[analyzeVideoDeep] JSON parse failed. Full response:', text);
  return null;
}

export async function validateVideo(formData) {

  const system = `You are a senior YouTube growth strategist who has analyzed 10,000+ viral videos. You run a structured 4-layer decision engine before producing any output.

━━━ LAYER 0: FORMAT CLASSIFICATION ━━━
Before all scoring, classify the video format. This is INTERNAL — it modulates weights only, never branches logic completely.

PROVEN VIRAL FORMAT — classify as this if content contains ANY of:
- Real human reactions (genuine, unscripted)
- Money / reward / giveaway / surprise element
- Emotional unpredictability (kindness shock, reversal, unexpected outcome)
- Street interactions / social experiments
- Formats that repeatedly go viral despite topic saturation

COMMODITY FORMAT — classify as this if content is:
- Informational / listicle / tutorial without a human emotional core
- Opinion or commentary without surprise/reaction element
- Standard vlog, review, or educational content

Set internal formatType = "proven_viral" OR "commodity".

WEIGHT MODULATION based on formatType:
- If proven_viral: reduce saturation penalty weight 40–60%, increase CTR weight, increase emotional impact weight
- If commodity: keep saturation penalty strong, require higher novelty for high scores, viral baseline neutral

━━━ LAYER 1: CTR ENGINE ━━━
Evaluate ONLY title and thumbnail.
Think: "Will someone click?" — ignore content quality entirely.
Assess: scroll-stop power, curiosity gap, clarity, packaging synergy.
Output: ctrPotential (Low/Medium/High), clickDrivers (max 3), clickKillers (max 3).

━━━ LAYER 2: RETENTION ENGINE ━━━
Evaluate ONLY hook (0–30s), structure, and payoff.
Think: "Will someone keep watching?" — ignore title/thumbnail entirely.
Assess: hook type, structural tension, mid-video drop risk, ending payoff.
Output: retentionPotential (Low/Medium/High), dropRisks (max 3), engagementDrivers (max 3).

HOOK DETECTION ENGINE (run inside Layer 2, before setting retentionPotential):

Step 1 — Ignore the user's "Strong Hook" and "Good Pacing" selections entirely. Analyze ONLY: title, thumbnail description, and content description ("What happens in this video").

Step 2 — Detect hook signals. Interpret generously — detect even when implied, not only when explicit. Only classify as Weak when content is clearly routine, flat, or has zero narrative tension.
  - Curiosity Gap: something unusual mentioned but not fully explained (explicit OR implied)
  - Conflict/Problem: a challenge, tension, risk, or confrontation
  - Emotional Trigger: strong visible or implied emotion (shock, fear, excitement, embarrassment)
  - Payoff Promise: a clear reason to keep watching ("by the end", "result was shocking", implied outcome)
  - Philosophical Realization: an internal shift, non-obvious insight, or changed worldview — counts as a valid hook signal, NOT "no story"
  - Expectation vs Reality: sets up a contrast between what was expected and what actually happened
  - Internal Conflict: honest self-examination, doubt, or contradiction without external antagonist
  NOTE: Any of the above three non-dramatic signals satisfies hookQuality = Medium minimum. Do NOT classify as Weak solely because there is no external conflict or dramatic event.

Step 3 — Classify hookQuality:
  - 2 or more signals detected → "Strong"
  - Exactly 1 signal detected → "Medium"
  - 0 signals → "Weak"
  detectedSignals MUST ONLY list signals actually found. Do NOT return all 4 by default. If only Conflict and Emotional Trigger are present, return ["Conflict", "Emotional Trigger"] only.

Step 4 — Override user input if mismatch exists:
  - If user selected "Strong Hook" BUT hookQuality = "Weak" or "Medium" → override, add issue to hookAnalysis explaining mismatch
  - hookPotential in categoryScores MUST reflect detected hookQuality, NOT the user's selection
  - If override applied → set overrideApplied = true

Step 5 — Pacing detection:
  - If content description contains routine actions (waking up, eating, walking, laptop use, commute) AND no mention of escalation, event progression, or tension build → pacingQuality = "Slow"
  - Otherwise → pacingQuality = "Fast" or "Average" based on content signals

Step 6 — Hook Confidence scoring (numeric, 0–100):
  - Generic hook with no specific moment (e.g. "I tried X for 30 days") → hookConfidence ≤ 40
  - No specific emotional or conflict moment in first 30s → hookConfidence ≤ 50
  - Specific emotional or conflict moment present → hookConfidence 70–90
  - Strong curiosity gap + clear payoff promise → hookConfidence 85+
  - Write reasoning: explain what signals raised or lowered confidence based on specificity, conflict, and clarity
  - OVERRIDE TRIGGER: if hookQuality = "Strong" BUT hookConfidence < 50 → set overrideApplied = true (merged into existing override strip)

━━━ LAYER 3: DECISION ENGINE ━━━
Combine Layer 0 + Layer 1 + Layer 2 + full context.

⚠️ COMPUTATION ORDER (MANDATORY — execute in this exact sequence):
0. Emotion Detection Pre-Pass → derive emotionAnalysis (detectedEmotion, confidence) FIRST before all other engines
0.5. Content Type + Value Score → classify contentType, compute valueScore signals (insightDepth, authenticity, relatability, takeaway), detect anti-clickbait titles
1. Run Hook Detection Engine → derive hookQuality, hookConfidence, detectedSignals — use detectedEmotion as primary truth source
2. Run CTR Engine and Retention Engine — use role-separated emotion signals (see EMOTION HIERARCHY below)
3. Run Viewer Experience Simulation → derive viewerExperience, detect emotional mismatch, set alignmentFlag
4. Compute packagingMismatch (inside Packaging Sync Engine) based on all above
5. Apply all score caps and penalties (hookConfidence penalties, packagingMismatch caps, proven format floor, emotion confidence cap, valueScore failure override)
6. Compute viralScore, valueScore final, uploadReadiness.score, contentVerdict
7. Compute clickDeliveryMismatch (requires viralScore, hookQuality, retentionPotential from step 6)
8. Compute structuralStatus (requires hookConfidence, clickDeliveryMismatch.severity, contentVerdict from steps 6–7)
9. Compute finalVerdict (requires structuralStatus, clickDeliveryMismatch.severity from step 8)
10. Compute uploadDecision — MUST mirror finalVerdict (see DECISION HIERARCHY below)
Do NOT write finalVerdict or uploadDecision before steps 0–9 are complete.

━━━ EMOTION DETECTION ENGINE (Step 0) ━━━
Run BEFORE all other engines. Derive the primary emotional tone of the video.

DERIVATION RULE:
1. Extract emotion from content description (most reliable — primary source)
2. Cross-check with title tone and thumbnail tone
3. Confidence based on signal agreement:
   - All 3 agree → confidence 75–100
   - 2 of 3 agree → confidence 50–74
   - All diverge OR content description is vague → confidence < 50

Output detectedEmotion (primary, required) and optionally detectedEmotionSecondary (if content has two strong tones).
Compare with userEmotion (PRIMARY EMOTION TARGET from form). If mismatch → set mismatchNote.

EMOTION HIERARCHY (strict role separation — NEVER mix):
- detectedEmotion: primary truth source for hook strength evaluation, retention analysis, emotional engagement scoring
- actualEmotion (viewerExperience): used ONLY for retention engine, viewer satisfaction, emotional payoff validation
- expectedEmotion (viewerExperience): used ONLY for thumbnail/title alignment, CTR prediction, packaging mismatch detection
- userEmotion: advisory only — used for comparison and mismatch detection, MUST NOT heavily influence scoring

PRIORITY ORDER (when signals conflict): detectedEmotion > actualEmotion > expectedEmotion > userEmotion
EXCEPTION: if emotionAnalysis.confidence < 60 → suspend priority order, fall back to actualEmotion for retention decisions and expectedEmotion for CTR decisions

WEIGHTING: detectedEmotion = 80% weight in emotional scoring, userEmotion = 20% advisory

MISMATCH FLAGS:
- If expectedEmotion ≠ actualEmotion → set viewerExperience.alignmentFlag = "Packaging Misalignment"
- If userEmotion ≠ detectedEmotion → set emotionAnalysis.mismatchNote = "User-selected emotion differs from content — system adjusted for accuracy"

LOW CONFIDENCE FAIL-SAFE (apply when emotionAnalysis.confidence < 60):
- Reduce weight of detectedEmotion in downstream scoring
- Fall back to actualEmotion for retention, expectedEmotion for CTR
- Set emotionAnalysis.warningNote = "Low confidence in emotional signal — scoring adjusted to avoid false assumptions"
- Add riskFlag: "Low Emotion Signal Confidence"
- Cap uploadReadiness.score ≤ 75
- Downgrade confidence: High → Medium, Medium → Low, Low → stays Low (no double-penalty)
Rationale: low confidence = uncertainty, NOT failure. Avoid overconfidence, not over-penalization.

━━━ VALUE SCORE ENGINE ━━━
Run alongside CTR/Retention engines. Evaluates human impact, not algorithmic performance.

CONTENT TYPE CLASSIFICATION (set before scoring):
- "Viral": high CTR packaging + shareable format + external conflict or surprise
- "Value-Driven": high insight depth + authenticity + relatability, low virality signals
- "Hybrid": meaningful balance of both

ANTI-CLICKBAIT TITLE DETECTION: If title uses self-deprecating or honest framing ("Nothing Changed", "This Didn't Work", "I Was Wrong", "I Failed", "I Was Lying to Myself") → reduce ctrPotential slightly BUT increase authenticity and takeaway scores.

VALUE SCORE DERIVATION (0–100, averaged from four 0–10 signals):
- insightDepth (0–10): new thinking, non-obvious realization, challenges assumptions
- authenticity (0–10): honest vs performative — anti-clickbait titles, vulnerable framing, no hype
- relatability (0–10): shared internal struggle, universal human experience
- takeaway (0–10): does the viewer leave with something they will remember, apply, or share?

SCORE ANCHORS (apply when outputting final scores):
viralScore bands:
- 85–100: Exceptional packaging + hook — strong algorithm entry likely
- 70–84: Solid — algorithm will test it, outcome depends on execution
- 55–69: Borderline — needs clear fix before upload
- Below 55: Weak execution — upload risk is high

valueScore bands:
- 85–100: Rare — deeply insightful, authentic, genuinely memorable
- 70–84: Strong human value — niche audience will trust and return
- 50–69: Moderate — delivers some value but not distinctive
- Below 50: Low human value — generic, performative, or forgettable

STRICT INPUT SEPARATION (MANDATORY — never cross-contaminate):
- viralScore MUST be derived ONLY from: CTR engine signals (title + thumbnail), hookQuality, pacingQuality, packagingScore. No value signals.
- valueScore MUST be derived ONLY from: insightDepth, authenticity, relatability, takeaway. No virality signals.
- viralScore is a HOLISTIC QUALITATIVE JUDGMENT — apply all weights, format modulation, and caps, then produce one number. It is NOT arithmetic.
- uploadReadiness.score is ARITHMETIC SIMULATION ONLY — sum baseline + bonuses + penalties. It is NOT a quality judgment. Do not conflate these two.

FAILURE LOGIC OVERRIDE (CRITICAL):
IF valueScore >= 70 AND contentType = "Value-Driven":
→ verdict CANNOT be "Do Not Upload" solely due to low CTR signals
→ minimum verdict = "Needs Optimization"
→ set performancePrediction.audienceValueOutlook to reflect high satisfaction for niche viewers
→ biggestProblem must reference packaging, not content quality

NON-DRAMATIC STORY LABEL: If content contains Philosophical Realization, Expectation vs Reality, or Internal Conflict arc → do NOT label as "no story" or "Structural Content Failure". These are valid story structures.

PERFORMANCE PREDICTION (always populate):
- algorithmOutlook: one decisive line on reach/distribution based on CTR engine signals
- audienceValueOutlook: one decisive line on viewer satisfaction/trust based on valueScore

VIEWER EXPERIENCE SIMULATION (run in Layer 3 before scoring):
Extract expectedEmotion from title + thumbnail. Extract actualEmotion from content description.
- If mismatch → emotionalJourney = "Viewer feels misled → drop-off", inform packagingMismatch detection
- If aligned → emotionalJourney = "Viewer satisfaction → retention"
dropReason: simulate what the viewer thinks at the likely drop point.

SCORING STRICTNESS RULES (apply after packagingMismatch is computed):
- IF packagingMismatch = true AND retentionPotential = "Low" AND valueScore < 70 → cap viralScore ≤ 58, cap uploadReadiness.score ≤ 58, verdict MUST be "Do Not Upload"
- IF packagingMismatch = true AND retentionPotential = "Low" AND valueScore >= 70 AND contentType = "Value-Driven" → cap viralScore ≤ 65, verdict minimum = "Needs Optimization", label = "High-value content with limited algorithmic reach"
- IF hookConfidence < 40 → reduce viralScore by 10–15 points
- IF no clear payoff detectable in content → reduce viralScore by 10 points
- IF packagingMismatch = true → thumbnailImpactWeight = 70% of original; add insight to strategicInsight: "High CTR but low retention → algorithm suppression risk"

PROVEN FORMAT PROTECTION (apply after strictness rules):
IF content matches a proven format (challenge, transformation, case study, experiment, social experiment, day-in-life with clear arc) AND clear payoff exists AND no major execution flaws detected:
→ uploadReadiness.score minimum = 65
OVERRIDE CONDITIONS (floor does NOT apply if):
- packagingMismatch = true
- OR hookConfidence < 40

STEP A — PRIMARY FAILURE TYPE (mandatory, choose exactly one):
- "CTR Problem" — packaging weak, content may be fine
- "Retention Problem" — gets clicks but loses viewers
- "Packaging Mismatch" — ONLY when the core idea is strong BUT title/thumbnail fail to communicate it clearly. Do NOT assign this when hook or content structure is weak — that is a content problem, not a packaging problem.
- "Structural Content Failure" — when hook is weak AND retention signals are weak AND no clear conflict, payoff, or dramatic event is detectable in the content description. The failure lives inside the video itself, not in the packaging.
- "Audience Mismatch" — content doesn't fit the channel's existing audience

STEP B — CONFLICT DETECTION (mandatory):
IF ctrPotential=High AND retentionPotential=Low → conflictLabel="Click Trap", explanation="People will click but not watch"
IF ctrPotential=Low AND retentionPotential=High → conflictLabel="Hidden Gem", explanation="Good video but weak packaging"
IF both Low → conflictLabel="Low Potential"
IF both High → conflictLabel="Strong Candidate"
IF one High one Medium → conflictLabel="Uneven" with specific explanation

SATURATION OVERRIDE (apply inside Step B):
IF nicheSaturation is Medium or High AND formatType=proven_viral → do NOT treat saturation as a weakness. Treat it as demand validation. Shift evaluation weight toward execution quality: hook strength, emotional payoff, thumbnail impact.

STEP C — FINAL DECISION INTELLIGENCE (mandatory):

DOMINANT FACTOR — identify the single biggest bottleneck:
- If ctrPotential=Low → dominantFactor="CTR"
- If retentionPotential=Low → dominantFactor="Retention"
- If both Medium → dominantFactor = whichever scored lower in categoryScores (titleStrength vs hookPotential)
- If both High → dominantFactor=null

VIRAL BOOST RULE (apply when formatType=proven_viral):
Apply a soft upward tendency on viralProbability. Cap the boost by execution quality:
- If hook AND thumbnail AND emotional payoff are all strong → allow full boost (up to +2 on viralProbability)
- If any ONE of the three is weak → reduce boost proportionally (partial, ~+1)
- If TWO or more are weak → boost is minimal or zero
The format alone never guarantees a higher score — execution gates the boost.

KILL MOMENT — if any retention risk exists, identify the single most likely drop point:
- Must be specific to the content description submitted (e.g., "after the 2-minute setup before the main demonstration begins")
- If no retention risk → killMoment=null

TOP FIX — the single highest-impact action, derived from dominantFactor:
- If dominantFactor="CTR" → fix must target title or thumbnail only
- If dominantFactor="Retention" → fix must target hook or structure only
- If dominantFactor=null → fix targets the weakest remaining dimension
- Format: { change, impact (High/Medium/Low), reason }

EXPECTED SHIFT — describe how performance changes if topFix is applied:
- No numbers, no percentages
- Must describe a before → after trajectory (e.g., "If fixed, CTR moves from weak to competitive, driving stronger initial distribution from suggested feed")

PRIORITIZATION RULE — all growthLevers must align with dominantFactor:
- dominantFactor="CTR" → all levers fix title/thumbnail, zero retention advice
- dominantFactor="Retention" → all levers fix hook/structure, zero CTR advice
- dominantFactor=null → levers can be mixed

STEP D — GROWTH LEVERS must be rooted in dominantFactor (see prioritization rule above).

━━━ HOOK REWRITE ENGINE ━━━
Run this engine ONLY when hookAnalysis.hookQuality is "Weak" or "Medium".
If hookQuality is "Strong" → return empty arrays for all three fields.

INPUTS: title, thumbnail description, content description, hookAnalysis (detectedSignals, hookQuality, pacingQuality).

CORE RULE: Do NOT invent fake events. All rewrites must stay grounded in the actual content described. If content is vague, extract the most emotionally interesting real moment, or reframe around a stronger believable angle from the same content.

PRIMARY FIX STRATEGY DERIVATION:
- Identify the most critically missing hook signal from detectedSignals — the gap that, if filled, would have the highest retention impact given the content type.
- If Curiosity Gap is missing → primaryFixStrategy = "Curiosity Gap"
- If Conflict/Problem is missing and content has inherent tension → primaryFixStrategy = "Conflict"
- If no Emotional Trigger and content has human element → primaryFixStrategy = "Emotion"
- If no Payoff Promise → primaryFixStrategy = "Payoff"
- If multiple gaps exist, pick the one with highest impact for the specific content type.

REWRITE STRATEGIES (apply based on detected gaps):
1. No clear event → convert to "moment-focused framing" — focus on ONE specific incident
2. Weak curiosity → add open loop (viewer must feel "what happened?")
3. No emotion → inject human reaction (shock, regret, fear, awkwardness, surprise)
4. No payoff → clearly imply outcome (what changes? what is revealed?)

OUTPUT RULES:
- MAX 3 hookRewrites, MAX 3 titleRewrites
- Each rewrite MUST follow a DIFFERENT strategy: one Curiosity Gap, one Conflict/Problem, one Emotional/Payoff
- Each hookRewrite MUST target a signal that is ABSENT from detectedSignals — do NOT write rewrites that reinforce already-detected signals. If detectedSignals contains ["Conflict"], then the rewrites must address Curiosity Gap, Emotional Trigger, and Payoff Promise — not Conflict again.
- Do NOT generate similar variations
- Avoid vague lines like "Something crazy happened" — use specific, situational, emotionally grounded phrasing
- titleRewrites REPLACE titleAnalysis.improvedTitles — when this engine runs, set titleAnalysis.improvedTitles to []

HARD RULES — break any = failed output:
1. NEVER use percentages. Only Low / Medium / High.
2. Every insight specific to the submitted input — not generic.
3. Max 1–2 lines per point. No essays.
4. BANNED: "add tags", "improve SEO", "engage with audience", "use relevant keywords", "consider improving", "this is good".
5. Score consistency: if viralProbability < 5, ctrPotential and retentionPotential must NOT be High.
6. Do NOT mix CTR and retention analysis in the same point.
7. Always respond with valid JSON only.
8. THUMBNAIL FLOOR: if thumbnail has a human face with strong emotion + clear visible action + high contrast, scrollStoppingPower must NOT fall below 70 unless a specific major flaw is identified and stated.
9. FORMAT SAFETY: if format classification is uncertain, default to standard commodity evaluation. Classification modulates weights only — never fully overrides execution-based scoring. All score improvements must be proportional to actual execution signals present.
10. THUMBNAIL APPEAL FLOOR (applies ONLY when thumbnail input type is "image"): If the thumbnail contains ALL of — (a) a close-up human face with strong visible emotion, (b) the face occupies a significant portion of the frame and is the clearly dominant subject, (c) high contrast lighting with subject clearly separated from background, (d) bold readable text of 2–4 words max — then categoryScores.thumbnailAppeal MUST NOT be below 5. Override is allowed ONLY if: facial expression is weak or unclear, OR face is too small or not the dominant focal point, OR text is unreadable or poorly placed, OR composition is cluttered or lacks clear focus. If overridden, the reason MUST be stated explicitly inside thumbnailAnalysis.issues[].

━━━ THUMBNAIL INPUT RULES ━━━

THUMBNAIL INPUT TYPE determines how all thumbnail-dependent fields are evaluated:

TYPE = "image" (hasThumbnail=true): Analyze via vision. Full scoring range applies.

TYPE = "text" (description provided, no image):
- Treat as a REAL thumbnail. Extract same signals: subject focus, emotion intensity, contrast level, curiosity trigger, text clarity.
- DO NOT treat as weaker input in logic — but apply these caps:

  TIER 1 — Both clear subject AND (emotion OR visual hook) present:
    → scrollStoppingPower cap: ≤ 80, thumbnailAppeal cap: ≤ 8

  TIER 2 — One signal missing (subject present but no emotion/hook, OR emotion present but no clear subject):
    → scrollStoppingPower cap: ≤ 65, thumbnailAppeal cap: ≤ 6

  TIER 3 — Both missing OR description is vague/non-visual (e.g. "good thumbnail", "normal design"):
    → scrollStoppingPower cap: ≤ 50, thumbnailAppeal cap: ≤ 5
    → Add riskFlag: "Unclear Thumbnail Concept"
    → Trigger Thumbnail Rewrite Engine

  CONFIDENCE ADJUSTMENT: If thumbnailInput type is text AND confidence would be "High" → downgrade to "Medium". Never downgrade from Medium to Low for text input alone.

  Signal definitions:
    - Clear subject: description mentions a person, object, or scene that is visually identifiable
    - Clear emotion: description mentions an emotion (shocked, scared, excited, regret, fear, surprise)
    - Visual hook: description mentions a visual tension element (contrast, unusual object, dramatic moment, bold text)

TYPE = "none" (no image, no description):
- Skip thumbnail-dependent mismatch detection: Clickbait Mismatch, Curiosity Gap Break (thumbnail-related), Emotional Disconnect (thumbnail-related)
- Only evaluate: Hook Delivery Failure, Weak Reinforcement
- Add riskFlag: "Missing Thumbnail"

━━━ THUMBNAIL REWRITE ENGINE ━━━
ORDERING RULE: Evaluate thumbnailAnalysis and categoryScores FIRST. Only after scoring is complete, check the trigger condition. Do NOT generate thumbnailIdeas before scoring is complete.

Trigger ONLY when: thumbnailAnalysis.scrollStoppingPower < 70 OR categoryScores.thumbnailAppeal < 5.
If neither condition is met → set thumbnailIdeas = [].

INPUTS: title, thumbnail (image or text description — use whichever was provided), content description, thumbnailAnalysis (issues, fixes, scrollStoppingPower), hookAnalysis (detectedSignals, hookQuality).

CORE RULES:
1. Do NOT repeat or slightly modify the existing thumbnail — all concepts must be clearly different directions.
2. Do NOT invent fake events — stay grounded in actual content described.
3. ONE clear idea per thumbnail — no clutter, no multiple subjects.
4. Text overlay MUST be 2–4 words MAX — bold, high contrast, instantly readable.
5. High contrast is mandatory — subject must stand out clearly from background.
6. Mobile-first — must be understandable at 120×68px.

STRATEGY FRAMEWORK — MANDATORY EXACTLY 3 IDEAS, one per strategy:
1. Face Emotion Strategy → Close-up face showing strong emotion (shock, fear, regret, surprise)
2. Moment Snapshot Strategy → Freeze a key high-action or turning point moment
3. Curiosity Object Strategy → Highlight one unusual/mysterious object that creates questions

HOOK INTELLIGENCE RULE:
- If hookQuality = "Strong" → thumbnail must reinforce clarity and payoff, NOT create confusion
- If hookQuality = "Weak" or "Medium" → thumbnail must introduce curiosity gap and intrigue

ANTI-CLUTTER RULE: Avoid multiple faces, too many elements, busy backgrounds, long text. One subject, one emotion, one focal point.

━━━ PACKAGING SYNC ENGINE ━━━
Run for EVERY video. Goal: evaluate alignment between Title, Thumbnail, and Hook. Detect mismatches that hurt CTR and retention.

CORE PRINCIPLE: All 3 elements must tell the SAME story. Title = promise. Thumbnail = visual hook. Hook = delivery. Misalignment → viewer confusion → drop-off.

INPUTS: title, thumbnail (image or description), content description, hookAnalysis (detectedSignals, hookQuality), thumbnailAnalysis (scrollStoppingPower, issues).

SCORING — start at 10, subtract severity weight for each detected mismatch (stack all that apply, cap minimum at 0):
- Clickbait Mismatch: −3 (title promises something not supported by thumbnail or content)
- Hook Delivery Failure: −3 (title/thumbnail make a promise but hook does not begin delivering within 30s — derived from hookAnalysis.detectedSignals)
- Curiosity Gap Break: −2 (thumbnail creates curiosity but title fully explains the answer, OR both say the same thing — redundancy kills intrigue)
- Emotional Disconnect: −2 (thumbnail shows strong emotion but title is flat, or vice versa)
- Dual Focus Conflict: −2 (title and thumbnail focus on different topics/events)
- Weak Reinforcement: −1 (all elements exist but do not amplify each other)

NO-THUMBNAIL RULE: If thumbnail input type is "none" → skip Clickbait Mismatch, Curiosity Gap Break, and Emotional Disconnect. Only evaluate Hook Delivery Failure and Weak Reinforcement.

primaryFixStrategy DERIVATION — pick the highest-severity detected mismatch type, in this priority order: Clickbait Mismatch → Hook Delivery Failure → Curiosity Gap Break → Emotional Disconnect → Dual Focus Conflict → Weak Reinforcement. Map to dominant angle: Curiosity / Conflict / Emotion / Payoff.

packagingMismatch DERIVATION: Set packagingMismatch = true if ANY of:
- Title implies regret/failure but content is positive or neutral
- Thumbnail emotion is not delivered in the content
- Curiosity gap created by packaging is never resolved in content
- viewerExperience.emotionalJourney indicates mismatch
Otherwise set packagingMismatch = false.

STRONG PACKAGING LOCK: If packagingScore >= 9 → set recommendedPackaging = null. Only write a summary confirming alignment. Do NOT generate fix strategies.

If packagingScore < 9 → generate recommendedPackaging following ONE dominant angle only (Curiosity / Conflict / Emotion / Payoff). No mixing angles.

CONSISTENCY RULE (apply when other engines have run):
- If hookRewrites array is non-empty → packagingAnalysis.primaryFixStrategy MUST match the Hook Rewrite Engine's primaryFixStrategy. recommendedPackaging.hook must follow the same signal direction.
- If thumbnailIdeas array is non-empty → recommendedPackaging.thumbnailConcept must follow the same strategy type as thumbnailIdeas[0].strategy (Face Emotion / Moment Snapshot / Curiosity Object).

━━━ CONTENT VERDICT + STRATEGIC LAYER ━━━
Run AFTER viralScore and valueScore are finalized.

CONTENT VERDICT MATRIX — strict score-to-verdict mapping (ONLY these 5 labels are allowed):
1. viralScore ≥ 70 AND valueScore ≥ 70                        → "High Potential"
2. viralScore ≥ 70 AND valueScore 50–69                       → "Viral Candidate"
3. viralScore ≥ 70 AND valueScore < 50                        → "Viral Candidate"
4. viralScore 50–69 AND valueScore ≥ 70                       → "Strong Value, Limited Reach"
5. viralScore < 50 AND valueScore ≥ 70                        → "Strong Value, Limited Reach"
6. viralScore < 50 AND valueScore < 50                        → "Weak Content"
ELSE (all remaining combinations — true borderline)            → "Mid Performance — Needs Direction"

NOTE: Rules 2 and 3 are intentionally merged — any viralScore ≥ 70 with valueScore < 70 is Viral Candidate.
Rules 4 and 5 are intentionally merged — any valueScore ≥ 70 with viralScore < 70 is Strong Value, Limited Reach.
"Mid Performance — Needs Direction" applies ONLY to genuinely borderline cases where neither dimension dominates.
BANNED legacy labels — NEVER output these: "Upload Ready", "Needs Work", "Value Content". If any engine produces these, override with the mapping above.

CONTENT VERDICT DETAIL — analytical sub-label (always include alongside contentVerdict):
- "High Potential"                  → contentVerdictDetail = "Strong Reach + Strong Value"
- "Viral Candidate"                 → contentVerdictDetail = "High Reach, Low Depth"
- "Strong Value, Limited Reach"     → contentVerdictDetail = "Low CTR Ceiling, High Audience Trust"
- "Mid Performance — Needs Direction" → contentVerdictDetail = "Borderline — Execution Gap"
- "Weak Content"                    → contentVerdictDetail = "Weak on Both Dimensions"

conflictLabel (Click Trap / Hidden Gem / Strong Candidate / Low Potential / Uneven) is a DIAGNOSTIC LAYER ONLY:
- It MUST NOT influence contentVerdict
- It MUST NOT influence uploadDecision.decision
- It provides additional context only

CLICK DELIVERY MISMATCH (Step 7 — runs after viralScore, hookQuality, retentionPotential are finalized):
Derive clickDeliveryMismatch as a structured object — NOT a boolean.
- detected = true IF: (ctrPotential = "High" OR viralScore ≥ 65) AND (retentionPotential = "Low" OR hookQuality = "Weak")
- detected = false otherwise
- ctrSignal: "Strong" (viralScore ≥ 70 OR ctrPotential = High) / "Moderate" (viralScore 50–69) / "Weak" (viralScore < 50)
- retentionFoundation: "Strong" (hookQuality = Strong AND retentionPotential = High) / "Moderate" (Medium signals) / "Weak" (hookQuality = Weak OR retentionPotential = Low)
- severity: "Critical" (detected AND retentionFoundation = Weak AND ctrSignal = Strong) / "High" (detected AND retentionFoundation = Weak) / "Medium" (detected, partial mismatch) / "Low" (not detected or minimal gap)
- conclusion: decisive single sentence — e.g. "This video will win the click but lose the viewer."
When detected = true → add riskFlag: "Click Delivery Mismatch"

STRUCTURAL STATUS (Step 8 — derived field, NOT independently analyzed):
Derive structuralStatus after clickDeliveryMismatch is computed.
Set status = "FAIL" if ANY of:
- hookConfidence ≤ 50
- clickDeliveryMismatch.severity = "Critical"
- contentVerdict = "Weak Content" (only when structural issue, not value-driven)
VALUE-DRIVEN EXCEPTION — do NOT set FAIL from hookConfidence ≤ 50 alone when:
  contentType = "Value-Driven" AND valueScore ≥ 70
  (Value-driven content legitimately lacks dramatic hooks)
Set status = "PASS" otherwise.
reason: one short, specific cause — e.g. "Hook fails to establish retention anchor in first 30 seconds"

FINAL VERDICT (Step 9 — binary, top-level, primary decision signal):
Set finalVerdict = "DO NOT UPLOAD" if:
- structuralStatus.status = "FAIL"
OR
- clickDeliveryMismatch.severity = "Critical"
Set finalVerdict = "SAFE TO TEST" otherwise.

DECISION HIERARCHY — uploadDecision MUST mirror finalVerdict (Step 10):
IF finalVerdict = "DO NOT UPLOAD":
→ uploadDecision.decision = "Do Not Upload" — NO EXCEPTIONS, regardless of contentVerdict
IF finalVerdict = "SAFE TO TEST":
→ THEN apply content signal logic:
   - contentVerdict = "High Potential" AND retentionPotential ≠ "Low" → "Ready to Upload"
   - All other cases → "Optimize Before Upload"
uploadDecision MUST NOT independently override finalVerdict. finalVerdict is the single source of truth.

FRAMING RULE — when contentVerdict = "Strong Value, Limited Reach":
uploadDecision.reason MUST explicitly state: "Content is strong — issue is packaging, not substance."
NEVER imply the content itself is weak when this verdict applies.

STRATEGIC RECOMMENDATION (always populate, derived from dominantFactor + contentVerdict):
- direction: "Optimize CTR" / "Strengthen Hook" / "Fix Packaging" / "Elevate Content Value" / "Upload Now" / "Full Rework"
- action: specific one-line action tied to dominantFactor and contentVerdict
- priority: "Critical" (viralScore < 55 OR packagingMismatch) / "High" (viralScore 55–74) / "Low" (viralScore ≥ 75)
- impact: "High" / "Medium" / "Low"

PREDICTION CONFIDENCE (top-level meta-signal — based on INPUT CLARITY, not scores):
- High:   title + contentDescription + thumbnail (image or detailed text ≥50 words) all provided, content is specific
- Low:    title only OR contentDescription < 15 words OR critical fields missing
- Medium: everything else
Output as predictionConfidence string at top level.

━━━ UPLOAD READINESS ENGINE ━━━
Run for EVERY video, after Packaging Sync Engine. Goal: final upload decision signal based on content quality signals — NOT a virality prediction.

SCORING MODEL (start at 50, cap between 0–100):
Hook Quality: Strong → +20, Medium → +10, Weak → 0
Pacing Quality: Fast → +10, Average OR Medium → +5, Slow → 0
Thumbnail Strength (scrollStoppingPower): ≥80 → +15, 60–79 → +10, 40–59 → +5, <40 → 0
Thumbnail Appeal (categoryScores.thumbnailAppeal): ≥8 → +10, 6–7 → +5, <6 → 0
Packaging Score (packagingAnalysis.packagingScore): ≥9 → +15, 7–8 → +10, 5–6 → +5, <5 → 0
Penalties (stack all detected issues from packagingAnalysis.detectedIssues):
  Clickbait Mismatch → −10, Hook Delivery Failure → −10, Curiosity Gap Break → −7, Emotional Disconnect → −7, Dual Focus Conflict → −5, Weak Reinforcement → −3

ALIGNMENT RULE: uploadReadiness.score MUST be directionally consistent with packagingScore and hookQuality. Low packagingScore cannot produce high uploadReadiness.score. Scores must not contradict each other directionally.

SCOPE RULE: uploadReadiness.score is a DISTRIBUTION POTENTIAL predictor — it measures CTR + packaging + early distribution likelihood ONLY. It is NOT a content quality judgment and MUST NOT determine uploadDecision. uploadDecision is driven exclusively by contentVerdict and retentionPotential (see CONTENT VERDICT + STRATEGIC LAYER).

CONFIDENCE RULES (deterministic):
- High: hookQuality = Strong AND packagingScore ≥ 7
- Low: hookQuality = Weak OR packagingScore < 6 OR missing data
- Medium: everything else

TOP FIX SEPARATION RULE:
- Existing topFix object = mid-analysis component-level fix (CTR or retention specific)
- uploadReadiness.topFix string = final decision-level fix (highest overall upload impact)
- These MUST NOT repeat the same suggestion
- If both would suggest the same fix → populate only uploadReadiness.topFix, set topFix = null

RISK FLAGS — populate only when applicable, choose from: "Clickbait Risk", "Low Retention Risk", "Weak Thumbnail CTR", "Confusing Packaging", "Low Emotion Signal Confidence", "Unclear Thumbnail Concept", "Missing Thumbnail". Empty array if none.

SCORE BREAKDOWN OUTPUT RULE:
- By default, do NOT include scoreBreakdown
- Only include scoreBreakdown if packagingScore < 6 OR uploadReadiness.score < 60
- If included: keep minimal — no explanations, only numbers (baseline, each signal contribution, penalties array, no total field)

SUMMARY RULE: sharp one-line diagnosis specific to this video. Examples: "Strong hook + solid packaging, minor thumbnail weakness" / "Good idea but weak hook and unclear payoff"
TOP FIX RULE: single highest-impact fix derived from most severe mismatch or weakest signal. No generic advice.

━━━ OUTPUT STYLE RULES (apply to ALL text fields) ━━━
- No soft language: NEVER use "may", "might", "could", "perhaps", "possibly"
- Use decisive language: "will", "likely", "prevents", "blocks", "kills", "drives"
- Every major recommendation must answer: what happens if user does nothing AND what changes if fix is applied

━━━ SINGLE POINT OF FAILURE ━━━
Identify the ONE element that determines this video's success or failure.
- Must reflect dominantFactor (CTR vs Retention vs Packaging Sync)
- Must be decisive, not descriptive — one aggressive statement
- Examples: "This video lives or dies on thumbnail CTR" / "Title fails to communicate core story — zero clicks risk" / "Hook delay kills retention before payoff appears"
- Output as singlePointOfFailure string

━━━ TOP FIX UPGRADE ━━━
Extend topFix with ifIgnored: state the exact consequence if this fix is not applied.
- Use imperative tone for change field
- ifIgnored must be decisive: what will happen to distribution/CTR/retention
- Example ifIgnored: "Video will not generate enough CTR to enter algorithm testing"

━━━ CONSEQUENCE SIMULATION ━━━
Always run. Simulate what happens if the video uploads RIGHT NOW without any fixes.
Output as a structured JSON object — NO bullet points, NO multiline strings. Every field is a single line.
- expectedCTR: realistic range string based on CTR engine (e.g. "1–2%", "3–5%") — if ctrPotential=Low assume "0.8–1.5%"
- retentionDropPoint: specific timestamp + cause in one line (e.g. "30–45 seconds — setup delays payoff before viewer commits") — null if no retention risk
- distributionState: ONLY these three values: "Not Tested" (ctrPotential=Low or viralScore < 50) / "Limited" (Medium signals or partial mismatch) / "Suppressed" (High CTR signals but retentionFoundation = Weak — algorithm tests then kills)
- likelyOutcome: one decisive line — what the algorithm does with this video right now. Use decisive language.
- Examples: "Algorithm tests briefly then suppresses — drop-off detected within 24 hours" / "Limited distribution, never exits niche feed" / "Enters test pool but exits early due to low watch time"

NON-NEGOTIABLE FIX LANGUAGE (apply across topFix, growthLevers, hookRewrites, thumbnailIdeas, uploadReadiness.topFix):
Every critical fix MUST follow: Problem → Consequence → Fix
- Problem: what is structurally broken
- Consequence: what will happen to CTR/retention/distribution as a direct result
- Fix: exact, named, actionable instruction
BANNED words in fix fields: "maybe", "try", "consider", "might", "could", "perhaps"
Example: "The hook lacks any tension or turning point → viewers drop in the first 30 seconds before content value is reached → open with the single most unexpected moment from the video, not the setup"

━━━ SPREAD LIMITER ━━━
Inside viralOutlook, add spreadLimiter: explain exactly WHY this video will not break out beyond its niche.
- Connect packaging + emotion + novelty signals
- Must explain failure to expand beyond core viewers
- Use decisive language
- Examples: "Packaging signals routine content — no curiosity trigger for non-subscribers" / "Title lacks narrative hook — zero shareability outside existing audience"`;

  const user = `Evaluate this video before publishing:

TITLE: "${formData.title}"
DESCRIPTION: "${formData.description || 'Not provided'}"
TAGS: "${formData.tags || 'None'}"
CATEGORY: ${formData.category}
VIDEO LENGTH: ${formData.videoLength}
LANGUAGE: ${formData.language}
CHANNEL NAME: ${formData.channelName || 'Unknown'}
SUBSCRIBER COUNT: ${formData.subscribers || 'Unknown'}
AVG VIEWS/VIDEO: ${formData.avgViews || 'Unknown'}
UPLOAD FREQUENCY: ${formData.uploadFreq}
CONTENT DESCRIPTION: "${formData.contentDescription}"
PRIMARY EMOTION TARGET: ${formData.primaryEmotion}
NOTE: Hook strength and pacing are NOT self-reported — derive them exclusively from CONTENT DESCRIPTION above.
THUMBNAIL INPUT: ${
  formData.hasThumbnail ? 'Image uploaded (analyze via vision)'
  : formData.thumbDescription ? `Text description: "${formData.thumbDescription}"`
  : 'None provided'
}

Respond ONLY with this JSON (no markdown, start with {, end with }):
{
  "viralScore": 72,
  "valueScore": 0-100,
  "contentType": "Viral / Hybrid / Value-Driven",
  "finalVerdict": "DO NOT UPLOAD / SAFE TO TEST",
  "structuralStatus": {
    "status": "PASS / FAIL",
    "reason": "short specific cause — e.g. Hook fails to establish retention anchor in first 30 seconds"
  },
  "contentVerdict": "High Potential / Viral Candidate / Strong Value, Limited Reach / Mid Performance — Needs Direction / Weak Content",
  "contentVerdictDetail": "Strong Reach + Strong Value / High Reach, Low Depth / Low CTR Ceiling, High Audience Trust / Borderline — Execution Gap / Weak on Both Dimensions",
  "clickDeliveryMismatch": {
    "detected": false,
    "ctrSignal": "Strong / Moderate / Weak",
    "retentionFoundation": "Strong / Moderate / Weak",
    "severity": "Low / Medium / High / Critical",
    "conclusion": "decisive single sentence about the mismatch"
  },
  "predictionConfidence": "High / Medium / Low",
  "grade": "B",
  "formatStrength": "High (Proven Pattern)" | "Standard",
  "verdict": "One-line brutal truth about this specific video",
  "categoryScores": {
    "titleStrength": 7,
    "hookPotential": 5,
    "topicTiming": 6,
    "seoStrength": 5,
    "viralProbability": 4,
    "audienceMatch": 8,
    "competitionLevel": 6
  },
  "ctrEngine": {
    "ctrPotential": "Medium",
    "clickDrivers": [
      "Specific reason someone would click — reference actual title/thumbnail submitted",
      "Second click driver"
    ],
    "clickKillers": [
      "Specific reason someone would scroll past — reference actual title/thumbnail",
      "Second click killer"
    ]
  },
  "retentionEngine": {
    "retentionPotential": "Low",
    "dropRisks": [
      "Specific moment/reason viewers drop — reference hook strength and content description",
      "Second drop risk"
    ],
    "engagementDrivers": [
      "Specific reason viewers keep watching — reference content description",
      "Second engagement driver"
    ]
  },
  "primaryFailureType": "CTR Problem",
  "conflictLabel": "Hidden Gem",
  "conflictExplanation": "Good video but weak packaging — the content has retention potential but the title/thumbnail will prevent people from clicking",
  "dominantFactor": "CTR",
  "singlePointOfFailure": "One aggressive decisive statement — the single element that determines success or failure",
  "killMoment": {
    "timestampEstimate": "e.g. 1:30–2:00 or null if no retention risk",
    "cause": "Specific structural reason viewers drop at this point",
    "viewerThought": "Simulate viewer's internal reaction at this moment"
  },
  "topFix": {
    "change": "Imperative-tone action — the single highest-impact fix specific to dominantFactor",
    "impact": "High",
    "reason": "Why this specific fix matters — 1 decisive line",
    "ctrDelta": "current CTR range → improved range if fix applied (e.g. '1–2% → 4–6%')",
    "distributionDelta": "current distribution state → expected state after fix (e.g. 'Not Tested → Limited')",
    "ifIgnored": "Decisive consequence if this fix is not applied — what will happen"
  },
  "expectedShift": "If fixed, [describe before → after trajectory without numbers] — specific to this video",
  "uploadDecision": {
    "decision": "Ready to Upload / Optimize Before Upload / Do Not Upload",
    "reason": "One decisive reason — mirrors finalVerdict logic. For Strong Value, Limited Reach: must state Content is strong — issue is packaging, not substance"
  },
  "biggestProblem": "The single most critical issue — specific to this video, derived from the decision engine",
  "whyUnderperform": [
    "Specific reason 1 — directly tied to primaryFailureType",
    "Specific reason 2",
    "Specific reason 3"
  ],
  "growthLevers": [
    { "rank": 1, "lever": "Fix rooted in dominantFactor — specific action", "impact": "High", "confidence": "Medium" },
    { "rank": 2, "lever": "Second lever — also rooted in dominantFactor", "impact": "Medium", "confidence": "High" },
    { "rank": 3, "lever": "Third lever — aligned with dominantFactor prioritization rule", "impact": "Medium", "confidence": "Medium" }
  ],
  "hookAnalysis": {
    "detectedSignals": ["only signals actually found — e.g. Conflict, Emotional Trigger"],
    "hookQuality": "Strong / Medium / Weak",
    "hookConfidence": 0-100,
    "reasoning": "Why confidence is this level — specificity, conflict, clarity",
    "pacingQuality": "Fast / Average / Slow",
    "overrideApplied": true
  },
  "emotionAnalysis": {
    "detectedEmotion": "Primary emotional tone derived from content description",
    "detectedEmotionSecondary": "Optional secondary tone, or null",
    "confidence": 0-100,
    "userEmotion": "User-selected PRIMARY EMOTION TARGET",
    "mismatchNote": "User-selected emotion differs from content — system adjusted for accuracy OR null",
    "warningNote": "Low confidence in emotional signal — scoring adjusted to avoid false assumptions OR null"
  },
  "viewerExperience": {
    "expectedEmotion": "Emotion viewer expects from title + thumbnail",
    "actualEmotion": "Emotion content actually delivers",
    "emotionalJourney": "Viewer feels misled → drop-off OR Viewer satisfaction → retention",
    "dropReason": "Simulate viewer thought at likely drop point",
    "alignmentFlag": "Packaging Misalignment OR null"
  },
  "primaryFixStrategy": "Curiosity Gap / Conflict / Emotion / Payoff — derived from most critically missing hook signal",
  "hookRewrites": [
    { "hook": "...", "type": "Curiosity / Conflict / Emotional / Payoff", "whyItWorks": "..." },
    { "hook": "...", "type": "Curiosity / Conflict / Emotional / Payoff", "whyItWorks": "..." },
    { "hook": "...", "type": "Curiosity / Conflict / Emotional / Payoff", "whyItWorks": "..." }
  ],
  "titleRewrites": [
    { "title": "...", "strategy": "Curiosity Gap / Specific Event / Emotional Framing", "whyItWorks": "..." },
    { "title": "...", "strategy": "Curiosity Gap / Specific Event / Emotional Framing", "whyItWorks": "..." },
    { "title": "...", "strategy": "Curiosity Gap / Specific Event / Emotional Framing", "whyItWorks": "..." }
  ],
  "thumbnailIdeas": [
    { "strategy": "Face Emotion / Moment Snapshot / Curiosity Object", "concept": "...", "visual": "...", "textOverlay": "...", "whyItWorks": "..." },
    { "strategy": "Face Emotion / Moment Snapshot / Curiosity Object", "concept": "...", "visual": "...", "textOverlay": "...", "whyItWorks": "..." },
    { "strategy": "Face Emotion / Moment Snapshot / Curiosity Object", "concept": "...", "visual": "...", "textOverlay": "...", "whyItWorks": "..." }
  ],
  "titleAnalysis": {
    "rating": "Weak",
    "strength": "What actually works about this title — 1 line",
    "problem": "The core title weakness specific to this niche and audience",
    "fix": "Exact rewrite instruction — what word/element to change and why",
    "issues": [
      "Specific issue 1 — reference the actual title words",
      "Specific issue 2"
    ],
    "improvedTitles": []
  },
  "thumbnailAnalysis": {
    "scrollStoppingPower": 65,
    "focalPoint": "What is or should be the main focal point",
    "textLoad": "None / Light / Medium / Heavy — and whether it helps or hurts",
    "curiosityGap": "Does the thumbnail create a question the viewer needs answered? Specific assessment.",
    "visualHierarchy": "One line on whether the viewer's eye knows where to go",
    "faceSize": "large / medium / small / none",
    "faceSizeNote": "One line — impact on scroll-stop behavior for this content type",
    "elementCount": 3,
    "elementCountNote": "One line — whether element count helps or creates cognitive load",
    "contrastLevel": "high / medium / low",
    "contrastNote": "One line — how contrast affects visibility in feed",
    "issues": [
      "Specific thumbnail issue 1 — from CTR Engine analysis",
      "Specific thumbnail issue 2"
    ],
    "fixes": [
      "Specific fix 1 — actionable",
      "Specific fix 2 — actionable"
    ]
  },
  "retentionAnalysis": {
    "hook": "Assessment of first 30s — from Retention Engine analysis",
    "mid": "Mid-video retention prediction based on structure and content type",
    "ending": "Ending/CTA assessment"
  },
  "viralOutlook": {
    "ctrPotential": "Medium",
    "retentionPotential": "Low",
    "novelty": "Low",
    "predictionConfidence": "Medium",
    "finalVerdict": "Stable",
    "viewRange7Days": "Specific range based on channel avg and scores — e.g. 2,000–6,000",
    "spreadLimiter": "Decisive explanation of why video will not break out beyond niche — connect packaging + emotion + novelty"
  },
  "valueScoreBreakdown": {
    "insightDepth": 0-10,
    "authenticity": 0-10,
    "relatability": 0-10,
    "takeaway": 0-10
  },
  "performancePrediction": {
    "algorithmOutlook": "Decisive one-line prediction on reach and distribution",
    "audienceValueOutlook": "Decisive one-line prediction on viewer satisfaction and trust"
  },
  "strategicRecommendation": {
    "direction": "Optimize CTR / Strengthen Hook / Fix Packaging / Elevate Content Value / Upload Now / Full Rework",
    "action": "specific one-line action tied to dominantFactor and contentVerdict",
    "priority": "Critical / High / Low",
    "impact": "High / Medium / Low"
  },
  "strategicInsight": "One non-obvious insight specific to this video — something most creators miss",
  "topicTiming": {
    "status": "Warm",
    "bestPublishDay": "Thursday",
    "bestPublishTime": "6–8 PM IST",
    "nicheSaturation": "Medium",
    "saturationNote": "1–2 sentences — reference specific content patterns in this niche"
  },
  "strengths": [
    "Concrete strength 1 — mechanism, not praise",
    "Concrete strength 2 — what to replicate"
  ],
  "competitorIntelligence": [
    { "title": "Realistic top-performing video in this exact niche", "estimatedViews": "500K", "successReason": "Specific psychological or format reason", "theyDidBetter": "Exact thing they did better" },
    { "title": "Second reference video", "estimatedViews": "200K", "successReason": "Specific reason", "theyDidBetter": "Specific comparison" }
  ],
  "packagingAnalysis": {
    "packagingScore": 7,
    "packagingMismatch": false,
    "detectedIssues": ["Clickbait Mismatch", "Hook Delivery Failure"],
    "summary": "One-line assessment of overall packaging alignment",
    "primaryFixStrategy": "Curiosity / Conflict / Emotion / Payoff",
    "recommendedPackaging": {
      "title": "...",
      "thumbnailConcept": "...",
      "hook": "...",
      "whyThisWorks": "..."
    }
  },
  "consequenceSimulation": {
    "expectedCTR": "e.g. 1–2%",
    "retentionDropPoint": "timestamp + cause in one line — e.g. 30–45 seconds — setup delays payoff before viewer commits. null if no retention risk",
    "distributionState": "Not Tested / Limited / Suppressed",
    "likelyOutcome": "Decisive one-line outcome if uploaded now without fixes"
  },
  "uploadReadiness": {
    "score": 0-100,
    "confidence": "High / Medium / Low",
    "summary": "Sharp one-line diagnosis",
    "topFix": "Final decision-level fix — must not repeat topFix object above",
    "riskFlags": ["Clickbait Risk", "Weak Thumbnail CTR"],
    "scoreBreakdown": {
      "baseline": 50,
      "hookQuality": 20,
      "pacingQuality": 5,
      "thumbnailStrength": 10,
      "thumbnailAppeal": 5,
      "packagingScore": 10,
      "penalties": [{ "issue": "Hook Delivery Failure", "value": -10 }]
    }
  }
}`;

  const res = await fetch(`${BACKEND}/api/claude`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({
      model:      MODEL,
      max_tokens: 9000,
      system,
      messages:   [{ role: 'user', content: user }],
    }),
  });

  if (res.status === 401) throw new Error('AI service authentication error. Please restart the backend.');
  if (res.status === 429) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error || 'AI call limit reached. Upgrade your plan to continue.');
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || err?.error || `TubeIntel error ${res.status}`);
  }
  const text = (await res.json()).content[0].text;
  const parsed = safeJSON(text);
  if (parsed) return parsed;
  throw new Error('Analysis returned an unexpected format. Please try again.');
}

export async function predictGrowth(videoData, channelAvgViews) {
  const system = `You are a YouTube analytics expert who predicts video performance trajectories based on early metrics, content type, and channel benchmarks. You give specific, data-backed predictions — not hedged guesses.`;
  const user = `Predict the growth trajectory for this video:

Title: "${videoData.title}"
Current views: ${videoData.views}
Likes: ${videoData.likes} | Like rate: ${videoData.likeRate}%
Comment rate: ${videoData.commentRate}%
Duration: ${videoData.duration}
Published: ${videoData.publishedAt}
Channel average views: ${channelAvgViews}

Respond in this exact JSON:
{
  "expectedViews30Days": "specific number range e.g. '180K–320K'",
  "confidencePercent": 75,
  "vsChannelAverage": "above/at/below",
  "vsChannelAveragePercent": "e.g. '+240%' or '-40%'",
  "longevityType": "Evergreen/Trending/Dying",
  "longevityExplanation": "2 sentence explanation — why this content type will or won't hold value over time, referencing the title and engagement signals",
  "followUpVideo": {
    "title": "Specific, publish-ready title for the follow-up video that would capitalize on this video's momentum",
    "angle": "One sentence explaining the specific angle and why it capitalizes on this video's audience"
  },
  "growthScore": 7,
  "prediction": "2-3 sentence expert summary of exactly what to expect and why"
}

IMPORTANT: confidencePercent and growthScore MUST be plain integers. longevityType MUST be exactly one of: Evergreen, Trending, or Dying. Respond with ONLY the JSON object. No markdown, no backticks.`;
  const text = await callClaude(system, user, 2000);
  return safeJSON(text) || { prediction: text };
}

export async function analyzeChannelOverview(metrics) {
  const system = `You are TubeIntel's channel analytics AI. You analyze real YouTube channel data and produce hyper-specific, actionable insights. Never give generic advice. Every insight must reference the actual numbers provided. Always respond with valid JSON only.`;
  const user = `Analyze this YouTube channel's performance data and generate strategic insights:

CHANNEL METRICS (last ${metrics.days} days):
- Views: ${metrics.views} | Watch Time: ${metrics.watchTimeHours} hours
- Net Subscribers: ${metrics.netSubs >= 0 ? '+' : ''}${metrics.netSubs}
- Avg View Duration: ${metrics.avgViewDuration}s | Avg View %: ${metrics.avgViewPct}%
- Likes: ${metrics.likes} | Comments: ${metrics.comments} | Shares: ${metrics.shares}
- Impressions: ${metrics.totImpressions} | CTR: ${metrics.avgCtr}%
- Top traffic sources: ${metrics.topSources}
- Upload frequency: ~${metrics.uploadsPerWeek} videos/week
- Channel age: ${metrics.channelAgeDays} days
- Total subscribers: ${metrics.totalSubs}

Respond ONLY with this JSON (no markdown, start with {, end with }):
{
  "healthScore": 72,
  "healthLabel": "Growing Steadily",
  "momentum": "Accelerating",
  "momentumReason": "2 specific sentences explaining why — reference actual metrics",
  "summary": "3-4 sentence channel analysis paragraph using the actual numbers. Start with what's working, then what needs improvement, then one specific recommendation.",
  "topInsight": "The single most important insight from this data in one punchy sentence",
  "actions": [
    {"priority": "critical", "action": "Specific action 1", "impact": "Expected result with estimated %" },
    {"priority": "important", "action": "Specific action 2", "impact": "Expected result"},
    {"priority": "nice", "action": "Specific action 3", "impact": "Expected result"}
  ],
  "bestFormat": "Shorts/Long-form/Mid-length",
  "bestFormatReason": "One sentence why based on watch time and engagement data",
  "growthForecast": "Estimated subscriber gain next 30 days as a specific number range based on current velocity",
  "nextMilestone": 10000,
  "daysToMilestone": 45
}`;
  const text = await callClaude(system, user, 2000);
  return safeJSON(text) || null;
}

export async function generateVideoImprovements(videoData, analysisData) {
  const system = `You are an elite YouTube growth strategist AI. Your job is to generate EXTREMELY ACCURATE, CONTEXT-AWARE video improvements. This is NOT generic content generation — this is precision optimization. Every single output must feel like it was written specifically for this exact video and no other. Generic outputs are failures.`;

  const ts  = analysisData.titleScores || {};
  const dim = analysisData.dimensionScores || {};
  const thumbConcepts = analysisData.thumbnailConcepts || [];

  const user = `VIDEO DATA:
Title: "${videoData.title}"
Description: "${videoData.description}"
Tags: ${videoData.tags}
Views: ${videoData.views} | Likes: ${videoData.likes} | Comments: ${videoData.comments}
Engagement rate: ${videoData.engagementRate}%

DEEP ANALYSIS RESULTS:
Overall score: ${analysisData.viralScore ?? '?'}/100 (Grade: ${analysisData.grade ?? '?'})
Content DNA: ${analysisData.contentDNA}
What's working: ${analysisData.strengths}
What needs improvement: ${analysisData.weaknesses}

8 DIMENSION SCORES (all /100):
- Title & Thumbnail:   ${dim.titleThumbnail ?? '?'}
- Hook & Retention:    ${dim.hookRetention ?? '?'}
- Content Structure:   ${dim.contentStructure ?? '?'}
- Engagement:          ${dim.engagement ?? '?'}
- Algorithm:           ${dim.algorithm ?? '?'}
- SEO & Discoverability: ${dim.seoDiscoverability ?? '?'}
- Emotional Impact:    ${dim.emotionalImpact ?? '?'}
- Value Delivery:      ${dim.valueDelivery ?? '?'}

TITLE SUB-SCORES (all /100):
Curiosity: ${ts.curiosity ?? '?'} | Emotional: ${ts.emotional ?? '?'} | Clarity: ${ts.clarity ?? '?'} | Scroll-Stopping: ${ts.scrollStopping ?? '?'}

HOOK:
Strength: ${analysisData.hookStrength ?? '?'}/100 | Type: ${analysisData.hookType} | Analysis: ${analysisData.hookAnalysis}

EXISTING THUMBNAIL CONCEPTS (from prior analysis — score each, do NOT rewrite them):
${thumbConcepts.map((c, i) => `${i + 1}. ${c}`).join('\n')}

---

STEP 1 — BUILD CONTENT DNA (mandatory internal reasoning, do NOT output):
1. core_topic — the exact subject of this video
2. specific_angle — what makes THIS video's take unique
3. viewer_intent — why someone clicked this specific video
4. emotional_trigger — curiosity / fear / truth / drama / inspiration / etc.
5. content_type — story / opinion / educational / reaction / news / how-to

STEP 2 — PERFORMANCE REASONING (internal only, do NOT output):
Using all dimension scores above, reason about:
- Which dimension is the single biggest growth limiter?
- Which lever (CTR / retention / shareability) has most upside?
- For each fix, estimate realistic improvements (typically 5–18 pts). Be conservative — not optimistic.

STEP 3 — GENERATE IMPROVEMENTS:

1. THREE TITLES — one per angle: curiosity / clarity / emotion
Rules: MUST stay 100% on core_topic. MUST reflect specific_angle. MUST feel written for THIS creator. No generic templates.
Per title: project all 4 title sub-scores, the new Title & Thumbnail dimension score, and new overall score.

2. ONE HOOK — word-for-word script for the first 30 seconds
Rules: Directly connects to viewer_intent. Creates immediate tension or curiosity. Conversational. Topic-specific — not a generic "most people get X wrong."
Project: hook strength score, Hook & Retention dimension score, overall score.

3. SCORE EXISTING THUMBNAILS — do NOT rewrite them, only score each one's impact
For each of the ${thumbConcepts.length} thumbnail concept(s) above, estimate: projected Title & Thumbnail dimension score and projected overall score if that concept were used.

4. ONE CTA
Rules: Aligned with this audience's psychology. Natural extension of the content. Drives comments or shares — not a generic "like and subscribe."
Project: Engagement dimension score, overall score.

5. VIRAL PLAYBOOK — how to replicate what works in this video's format

STEP 4 — VALIDATE before outputting:
Does each output EXACTLY match the video topic? Would a top creator in this niche actually use it? If anything feels generic — regenerate it.

Respond with ONLY this JSON (no markdown, start with {, end with }):
{
  "titles": [
    {
      "text": "", "angle": "curiosity", "reason": "",
      "projectedTitleSubScores": { "curiosity": 0, "emotional": 0, "clarity": 0, "scrollStopping": 0 },
      "projectedDimensions": { "titleThumbnail": 0 },
      "projectedOverall": 0
    },
    {
      "text": "", "angle": "clarity", "reason": "",
      "projectedTitleSubScores": { "curiosity": 0, "emotional": 0, "clarity": 0, "scrollStopping": 0 },
      "projectedDimensions": { "titleThumbnail": 0 },
      "projectedOverall": 0
    },
    {
      "text": "", "angle": "emotion", "reason": "",
      "projectedTitleSubScores": { "curiosity": 0, "emotional": 0, "clarity": 0, "scrollStopping": 0 },
      "projectedDimensions": { "titleThumbnail": 0 },
      "projectedOverall": 0
    }
  ],
  "hook": {
    "text": "", "reason": "",
    "projectedHookStrength": 0,
    "projectedDimensions": { "hookRetention": 0 },
    "projectedOverall": 0
  },
  "thumbnails": [
    { "projectedDimensions": { "titleThumbnail": 0 }, "projectedOverall": 0 },
    { "projectedDimensions": { "titleThumbnail": 0 }, "projectedOverall": 0 },
    { "projectedDimensions": { "titleThumbnail": 0 }, "projectedOverall": 0 }
  ],
  "cta": {
    "text": "", "reason": "",
    "projectedDimensions": { "engagement": 0 },
    "projectedOverall": 0
  },
  "viral_playbook": {
    "hook_pattern": "The specific hook technique this video uses — be precise, name the psychology",
    "video_structure": "The exact content sequence that works for this video type and audience",
    "emotional_trigger": "The specific emotion this content activates and the psychological reason it works here",
    "cta_pattern": "The most effective CTA approach for this exact audience type and content style",
    "replication_steps": [
      "Step 1: specific actionable instruction tailored to this video format",
      "Step 2: specific actionable instruction",
      "Step 3: specific actionable instruction",
      "Step 4: specific actionable instruction"
    ]
  }
}`;

  const text = await callClaude(system, user, 3600);
  console.log('[generateVideoImprovements] raw response (first 300):', text?.slice(0, 300));
  const parsed = safeJSON(text);
  if (parsed) return parsed;
  console.warn('[generateVideoImprovements] JSON parse failed:', text);
  return null;
}

export async function analyzeChannelTab(tabName, data) {
  const system = `You are TubeIntel's YouTube analytics AI. You generate hyper-specific, data-driven insights for channel analytics. Every insight must reference actual numbers from the data. Always respond with valid JSON only.`;
  const user = `Generate insights for the ${tabName} analytics tab.

DATA:
${JSON.stringify(data, null, 2).slice(0, 3000)}

Respond ONLY with this JSON (no markdown, start with {, end with }):
{
  "headline": "One punchy insight headline specific to the data",
  "summary": "2-3 sentences of specific analysis referencing actual numbers from the data",
  "insights": [
    "Specific insight 1 with actual numbers",
    "Specific insight 2 with actual numbers",
    "Specific insight 3 with actual numbers"
  ],
  "actions": [
    {"action": "Specific action to take this week", "reason": "Why based on the data", "impact": "Expected outcome"},
    {"action": "Specific action 2", "reason": "Data-backed reason", "impact": "Expected outcome"}
  ],
  "warning": "One specific warning about a negative trend in the data, or null if no warnings",
  "opportunity": "One specific opportunity identified in the data"
}`;
  const text = await callClaude(system, user, 2000);
  return safeJSON(text) || null;
}

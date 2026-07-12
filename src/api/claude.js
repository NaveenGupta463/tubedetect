import { ROUTES, CLAUDE_MODEL } from '../config';

async function callClaude(system, user, maxTokens = 1200) {
  const res = await fetch(ROUTES.claude, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({
      model: CLAUDE_MODEL,
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

  const res = await fetch(ROUTES.claude, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({
      model: CLAUDE_MODEL,
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

export async function analyzeNiche({ topic, audience, channelName, subscriberCount, recentTitles, trendingVideos }) {
  const system = `You are a YouTube niche research expert. Identify trends, gaps, and opportunities for a specific creator. Return valid JSON only — no markdown, no backticks, no explanation. Start with { and end with }.`;

  const trendingList = trendingVideos.length
    ? trendingVideos.map((v, i) => `${i + 1}. "${v.title}" — ${v.views} views (${v.channelTitle})`).join('\n')
    : 'No trending data available for this query.';

  const user = `Creator context:
Channel: ${channelName}${subscriberCount ? ` (${subscriberCount} subscribers)` : ''}
Video topic: ${topic}
${audience ? `Target audience: ${audience}` : ''}
${recentTitles.length ? `Their recent videos: ${recentTitles.slice(0, 5).join(' | ')}` : ''}

Trending videos in this niche (last 30 days, by view count):
${trendingList}

Analyze the niche landscape and return this JSON:
{
  "niche": "2-4 word niche label",
  "trends": [
    {"angle": "trending angle or format title", "why": "1 sentence — why this is working right now", "signal": "high|medium|low"}
  ],
  "gaps": ["specific gap opportunity 1", "gap opportunity 2", "gap opportunity 3"],
  "recommended_angle": "specific angle for their exact topic that is underserved but in demand",
  "hook_idea": "a concrete opening line for their video — word-for-word suggestion"
}

Return exactly 5 trends and 3 gaps. Be specific and data-driven — no generic advice. Reference actual video titles or patterns where relevant.`;

  const text = await callClaude(system, user, 1400);
  const parsed = safeJSON(text);
  if (!parsed?.trends) throw new Error('Could not parse niche analysis. Try again.');
  return parsed;
}

export async function analyzeWhatWorks({ topic, niche, channelName, topVideos }) {
  const system = `You are a YouTube viral pattern analyst. Reverse-engineer what makes top videos perform and give creators a concrete, steal-ready playbook. Return valid JSON only — no markdown, no backticks. Start with { and end with }.`;

  const videoList = topVideos.length
    ? topVideos.map((v, i) => `${i + 1}. "${v.title}" — ${v.views} views (${v.channelTitle})`).join('\n')
    : 'No video data available.';

  const user = `Creator context:
Topic: ${topic}
Niche: ${niche || 'general YouTube'}
Channel: ${channelName}

Top performing videos in this niche (by view count):
${videoList}

Analyze these videos deeply. Extract the patterns that make them win. Return this JSON:
{
  "hooks": [
    {
      "formula": "hook type name (e.g. 'Shocking claim + immediate proof')",
      "example": "a real opening line from one of the listed videos",
      "template": "word-for-word template with [VARIABLE] placeholders the creator can fill in"
    }
  ],
  "title_patterns": [
    {
      "pattern": "pattern name (e.g. 'Number + Outcome + Timeframe')",
      "example": "real title from the list",
      "template": "fill-in template with [VARIABLE] placeholders"
    }
  ],
  "thumbnail_strategy": ["insight 1 (specific, not generic)", "insight 2", "insight 3"],
  "format_insights": "1-2 sentences about video length, pacing, or structure patterns that consistently win in this niche",
  "steal_this": "specific, word-for-word actionable recommendation for their exact topic — what they should do differently to beat the competition"
}

Return exactly 3 hooks, 3 title patterns, 3 thumbnail insights. Reference actual video titles from the list. No generic advice.`;

  const text = await callClaude(system, user, 1600);
  const parsed = safeJSON(text);
  if (!parsed?.hooks) throw new Error('Could not parse pattern analysis. Try again.');
  return parsed;
}

export async function analyzeVoice({ sampleText }) {
  const system = `You are a writing style analyst. Extract a creator's unique tone, vocabulary, and style from a writing sample so a ghostwriter could match it exactly when writing a YouTube script. Return valid JSON only — no markdown, no backticks. Start with { and end with }.`;

  const user = `Here is a writing sample from the creator:

---
${sampleText}
---

Analyze the writing style in detail. Return this JSON:
{
  "tone": "2-4 word tone descriptor (e.g. 'casual and motivational')",
  "personality_tags": ["tag1", "tag2", "tag3"],
  "title_style": "specific description of how they likely write titles based on their word choices",
  "common_patterns": ["writing or structural pattern 1", "pattern 2", "pattern 3"],
  "avoid": ["thing that would feel off-brand 1", "thing 2"],
  "voice_summary": "2 sentences a ghostwriter could use as their style brief — based only on what's present in this sample",
  "script_style_guide": "4 specific bullet-point instructions for writing a YouTube script that sounds exactly like this person — cover sentence length, energy level, vocabulary choices, and pacing"
}`;

  const text = await callClaude(system, user, 1200);
  const parsed = safeJSON(text);
  if (!parsed?.tone) throw new Error('Could not parse voice analysis. Try again.');
  return parsed;
}

export async function generateScript({ topic, audience, channelName, niche, recommendedAngle, tone, scriptStyleGuide }) {
  const system = `You are a YouTube scriptwriter. Write in the creator's exact voice. Return valid JSON only — no markdown, no backticks. Start with { and end with }.`;

  const contextLines = [
    `Channel: ${channelName || 'unknown'}`,
    `Topic: ${topic}`,
    audience         ? `Target audience: ${audience}`                                    : null,
    niche            ? `Niche: ${niche}`                                                 : null,
    recommendedAngle ? `Recommended angle (from niche research): ${recommendedAngle}`   : null,
  ].filter(Boolean).join('\n');

  const voiceLines = [
    tone             ? `Tone: ${tone}`                   : null,
    scriptStyleGuide ? `Style guide:\n${scriptStyleGuide}` : null,
  ].filter(Boolean).join('\n');

  const user = `${contextLines}

${voiceLines ? `Voice profile:\n${voiceLines}` : ''}

Write 3 different opening hooks (word-for-word, 30 seconds when spoken), a 4-5 section chapter outline with talking points, and a closing CTA. Match the creator's voice exactly.

Return this JSON:
{
  "hooks": [
    {"type": "formula name (e.g. 'Shocking Claim')", "script": "full word-for-word hook — 3-5 sentences, spoken in 30 seconds"}
  ],
  "outline": [
    {"section": "Section Name", "duration": "X min", "talking_points": ["point 1", "point 2", "point 3"]}
  ],
  "cta": "word-for-word closing CTA — 2-3 sentences, specific to this topic",
  "opening_line": "the single strongest first sentence from the best hook"
}

Return exactly 3 hooks and 4-5 outline sections. Write hooks in the creator's voice. Make them specific to this topic, not generic templates.`;

  const text = await callClaude(system, user, 2000);
  const parsed = safeJSON(text);
  if (!parsed?.hooks) throw new Error('Could not generate script. Try again.');
  return parsed;
}

export async function generateTitlesAndSEO({ topic, audience, channelName, niche, recommendedAngle, titlePatterns, titleStyle, tone, openingLine }) {
  const system = `You are a YouTube SEO and title expert. Generate high-CTR title variants and a complete SEO package. Return valid JSON only — no markdown, no backticks. Start with { and end with }.`;

  const contextLines = [
    `Channel: ${channelName || 'unknown'}`,
    `Topic: ${topic}`,
    audience          ? `Target audience: ${audience}`             : null,
    niche             ? `Niche: ${niche}`                          : null,
    recommendedAngle  ? `Best angle (from research): ${recommendedAngle}` : null,
    tone              ? `Creator tone: ${tone}`                    : null,
    titleStyle        ? `Their title style: ${titleStyle}`         : null,
    openingLine       ? `Script hook: "${openingLine}"`            : null,
  ].filter(Boolean).join('\n');

  const patternsBlock = titlePatterns?.length
    ? `Proven title patterns in this niche:\n${titlePatterns.map(p => `- ${p.pattern}: ${p.template}`).join('\n')}`
    : '';

  const user = `${contextLines}

${patternsBlock}

Generate 5 high-CTR title variants and a complete SEO package. Return this JSON:
{
  "titles": [
    {
      "title": "full video title",
      "formula": "formula name (e.g. 'Number + Result + Timeframe')",
      "angle": "1 sentence — what makes this title effective and why it will get clicks"
    }
  ],
  "thumbnail_concept": "specific visual description — background, subject, text overlay, colors, emotion. Specific enough for a designer to execute.",
  "primary_keyword": "main search keyword (what someone would type to find this video)",
  "tags": ["tag1", "tag2", "tag3"],
  "description_opening": "first 2-3 sentences of the video description — includes primary keyword naturally, hooks the reader, sets up the video"
}

Return exactly 5 title variants (use different formulas each time) and exactly 15 tags (mix of broad and long-tail). Titles must be under 70 characters. Tags must be lowercase, no #.`;

  const text = await callClaude(system, user, 1600);
  const parsed = safeJSON(text);
  if (!parsed?.titles) throw new Error('Could not generate titles. Try again.');
  return parsed;
}

export async function validateVideoBrief({ topic, audience, niche, recommendedAngle, chosenHook, chosenTitle, thumbnailConcept, primaryKeyword, tags, descriptionOpening, voiceTone, voiceSummary, hasScript }) {
  const system = `You are a YouTube launch strategist. Review a creator's Video Brief and give a final go/no-go decision with a score, strengths, and specific improvements. Return valid JSON only — no markdown, no backticks. Start with { and end with }.`;

  const sections = [
    `Topic: ${topic}`,
    audience         ? `Target audience: ${audience}`           : null,
    niche            ? `Niche: ${niche}`                        : null,
    recommendedAngle ? `Angle: ${recommendedAngle}`             : null,
    voiceTone        ? `Creator tone: ${voiceTone}`             : null,
    voiceSummary     ? `Voice: ${voiceSummary}`                 : null,
    chosenHook       ? `Opening hook: "${chosenHook}"`          : null,
    chosenTitle      ? `Title: "${chosenTitle}"`                : null,
    thumbnailConcept ? `Thumbnail concept: ${thumbnailConcept}` : null,
    primaryKeyword   ? `Primary keyword: ${primaryKeyword}`     : null,
    tags?.length     ? `SEO tags: ${tags.slice(0, 10).join(', ')}` : null,
    descriptionOpening ? `Description opening: ${descriptionOpening}` : null,
    hasScript        ? 'Script outline: present'               : 'Script outline: not yet created',
  ].filter(Boolean).join('\n');

  const user = `Review this Video Brief and score it for launch readiness:

${sections}

Score across 6 dimensions (each 0-100):
- angle: Is the topic angle specific, underserved, and compelling?
- hook: Will the opening line stop scrollers? Is it concrete and curiosity-driven?
- title: CTR potential — will this title get clicks in the feed?
- seo: Keyword strategy strength — primary keyword, tag coverage, search volume potential
- voice: Does everything feel like a consistent, authentic creator voice?
- readiness: Does the creator have enough material to actually record this video today?

Return this JSON:
{
  "score": 0-100,
  "decision": "GO" | "ALMOST" | "NOT YET",
  "decision_reason": "1 punchy sentence explaining the decision",
  "dimension_scores": { "angle": 0-100, "hook": 0-100, "title": 0-100, "seo": 0-100, "voice": 0-100, "readiness": 0-100 },
  "strengths": ["specific strength 1", "specific strength 2", "specific strength 3"],
  "improvements": [
    { "issue": "what is weak (max 6 words)", "fix": "exact action to take (1 sentence)" }
  ],
  "brief_summary": "2-3 sentence exec summary of the full video concept — what the video is, who it's for, and why it will perform"
}

Return 3 strengths and 2-3 improvements. Be specific — reference the actual hook/title/angle from the brief. No generic advice.`;

  const text = await callClaude(system, user, 1400);
  const parsed = safeJSON(text);
  if (!parsed?.score) throw new Error('Could not run validation. Try again.');
  return parsed;
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

async function analyzeVideoIntelligence(videoData, commentsText) {
  const system = `You are a cultural pattern analyst specializing in viral media. Your role is to decode WHY content reaches massive scale — the psychological, cultural, and algorithmic forces that drove millions of views. You analyze legacy viral videos as historical artifacts: what made them resonate at a deep human level. You never give optimization advice. You extract patterns that creators can study and apply to future content. Always return valid JSON only.`;
  const user = `Decode the viral pattern of this legacy YouTube video (${Math.round((Date.now() - new Date(videoData.publishedAt).getTime()) / 86400000 / 365 * 10) / 10} years old, ${(videoData.views / 1_000_000).toFixed(1)}M views):

Title: "${videoData.title}"
Views: ${videoData.views} | Likes: ${videoData.likes} | Comments: ${videoData.commentCount}
Published: ${videoData.publishedAt} | Duration: ${videoData.duration}
Tags: ${videoData.tags}

Top comments:
${commentsText}

Return ONLY this JSON (no markdown, start with {, end with }):
{
  "intelligence": {
    "patternStrengths": {
      "overallStrength": "Extreme",
      "titleStrength": "Very High",
      "hookStrength": "High",
      "emotionalResonance": "Extreme",
      "shareability": "Very High",
      "longevity": "High",
      "summary": "2 sentences explaining what made this video achieve extreme-scale virality"
    },
    "titleIntelligence": {
      "formulaType": "One label: e.g. Curiosity Gap / Controversy / Authority / How-To / Emotion",
      "psychologicalHook": "2 sentences on the specific psychological mechanism that made this title irresistible at scale",
      "whyItWorked": "2 sentences on why this exact phrasing triggered mass click behaviour",
      "culturalContext": "1 sentence on what cultural moment or collective anxiety this title tapped into",
      "replicableFormula": "The extractable title formula a creator could reuse: [Structure] + [Element] = [Result]"
    },
    "viewerBehaviorFlow": {
      "entryTriggerType": "One label: e.g. Shock / Curiosity / FOMO / Identity / Nostalgia / Controversy",
      "firstImpressionAnalysis": "2 sentences on what viewers experienced in the first 30 seconds that locked them in",
      "behavioralFlow": "3 sentences describing the emotional journey viewers went through from start to finish",
      "viralEntryMechanism": "2 sentences on what specifically triggered viewers to share — the precise emotional or social moment",
      "culturalTrigger": "2 sentences on the broader cultural or social dynamic that made this content spread beyond its initial audience"
    },
    "psychologicalDrivers": {
      "primaryDriver": "One label: e.g. Identity Validation / Shared Outrage / Collective Wonder / Social Currency / Escapism",
      "secondaryDriver": "One label",
      "driverAnalysis": "3 sentences explaining how the primary and secondary drivers worked together to generate sustained engagement",
      "commentBehavior": "2 sentences on what the comment patterns reveal about the psychological state viewers were in",
      "emotionalSignature": "The core emotion this video reliably triggered — in 5 words or fewer"
    },
    "distributionMechanics": {
      "primaryDistributionVector": "One label: e.g. Algorithm Push / Social Share / Search Discovery / External Platform / Word of Mouth",
      "velocityPattern": "2 sentences on how this video likely spread — slow burn vs spike, who shared it first",
      "algorithmSignals": "2 sentences on which YouTube algorithm signals this video likely maximised (CTR, retention, shares, comments)",
      "audienceExpansion": "2 sentences on how this video crossed its initial niche to reach a general audience",
      "sustainedReachReason": "1 sentence on why this video continues to surface years after publication"
    },
    "reusablePatterns": [
      {
        "pattern": "Pattern name (3-5 words)",
        "description": "2 sentences describing the specific reusable element from this video",
        "howToApply": "1 concrete sentence on how a creator can use this pattern in new content"
      },
      {
        "pattern": "Pattern name",
        "description": "2 sentences",
        "howToApply": "1 concrete sentence"
      },
      {
        "pattern": "Pattern name",
        "description": "2 sentences",
        "howToApply": "1 concrete sentence"
      },
      {
        "pattern": "Pattern name",
        "description": "2 sentences",
        "howToApply": "1 concrete sentence"
      },
      {
        "pattern": "Pattern name",
        "description": "2 sentences",
        "howToApply": "1 concrete sentence"
      }
    ]
  }
}`;
  const text = await callClaude(system, user, 4000);
  console.log('[analyzeVideoIntelligence] raw response (first 300 chars):', text?.slice(0, 300));
  const parsed = safeJSON(text);
  if (parsed) return parsed;
  console.warn('[analyzeVideoIntelligence] JSON parse failed. Full response:', text);
  return null;
}

export async function analyzeVideoDeep(videoData, commentsText) {
  if (videoData.videoType === 'LEGACY_VIRAL') {
    return analyzeVideoIntelligence(videoData, commentsText);
  }

  const noBaselineNote = videoData.noBaseline
    ? '\n\nNO BASELINE: This channel has insufficient historical data for reliable comparison. Avoid ratio-based claims and comparative language. Treat all signals as directional only.'
    : '';

  const lowDataNote = videoData.sampleLevel === 'very_low'
    ? '\n\nLOW DATA WARNING: This video has fewer than 500 views. All signal interpretation must be heavily hedged. Avoid definitive claims. Label all conclusions as preliminary. Do not generate strong pattern assertions.'
    : videoData.sampleLevel === 'low'
    ? '\n\nLOW SAMPLE NOTE: This video has limited views (under 2,000). Engagement signals have reduced reliability. Use moderately hedged language and avoid strong causal claims.'
    : videoData.lowVolume
    ? '\n\nLOW INTERACTION NOTE: This video has limited likes or comments. Engagement ratio signals may not be fully reliable — note this where relevant.'
    : '';

  const qualityNote = videoData.engagementQuality === 'LOW'
    ? '\n\nENGAGEMENT QUALITY WARNING: Engagement signals on this video may not reflect real audience behavior. Use hedged language for all engagement-based conclusions.'
    : '';

  const FINAL_STATE_CONTEXT = {
    CONFIRMED_VIRAL:   'Exceptional reach AND strong engagement. Explain why the video is succeeding on both distribution and audience response.',
    LEAKING_VIRAL:     'Exceptional reach but weak engagement. Explain the distribution success and why it is failing to convert viewers.',
    CRITICAL_LEAK:     'Extreme reach, severe engagement failure. Explain the disconnect between distribution scale and audience response.',
    CONFIRMED_STRONG:  'Consistent, reliable performance signals. Explain the balanced distribution and engagement and what is driving it.',
    EARLY_OR_BLOCKED:  'Limited distribution or early stage. Explain the constrained reach and what the engagement signals indicate.',
    WEAK:              'Poor signals across both reach and engagement. Explain what the weak performance indicates for this video.',
    INSUFFICIENT_DATA: 'Insufficient data for reliable conclusions. Frame all analysis as preliminary and heavily hedged.',
  };

  const finalStateNote = videoData.final_state
    ? `\n\nFINAL STATE: ${videoData.final_state} | Leak: ${videoData.leak} | Leak intensity: ${videoData.leak_intensity} | Reliability: ${videoData.reliability}\nBase your explanation STRICTLY on this state. Do not contradict it. Do not derive your own classification.\n${FINAL_STATE_CONTEXT[videoData.final_state] ?? ''}`
    : '';

  const dominantStateNote = videoData.final_state === 'CONFIRMED_VIRAL'
    ? '\n\nDOMINANT STATE: CONFIRMED VIRAL. Emphasize distribution momentum as the primary driver. Do NOT frame lower-than-expected engagement as failure — it reflects reach scale effects, not content weakness. Avoid negative framing or optimization suggestions.'
    : '';

  const confidenceToneNote = videoData.confidence === 'LOW'
    ? '\n\nCONFIDENCE: LOW — Avoid strong conclusions. Use cautious, conditional language throughout. Prefer: "early signal", "may indicate", "not yet reliable". Avoid: "is", "clearly", "confirmed".'
    : videoData.confidence === 'MEDIUM'
    ? '\n\nCONFIDENCE: MEDIUM — Use moderately hedged language. Prefer: "suggests", "likely", "appears to". Avoid: "clearly", "confirmed", "definitely".'
    : videoData.confidence === 'HIGH'
    ? '\n\nCONFIDENCE: HIGH — Signals are reliable. Use clear, direct language. Prefer: "is", "clearly", "confirmed". Avoid unnecessary hedging.'
    : '';

  const retentionNote = '\n\nRETENTION DATA: You do NOT have actual watch time or retention curve data. Never state retention patterns as confirmed facts. Never use "EARLY_DROP confirmed" or "retention failure". If inferring, use only "possible early drop-off (inferred from engagement patterns)" or state "no direct retention data available".';

  const authenticityNote = videoData.engagementAuthenticity === 'SUSPICIOUS'
    ? '\n\nENGAGEMENT AUTHENTICITY: SUSPICIOUS — signal mismatch detected. Highlight possible signal inconsistency. Avoid claiming strong audience validation. Suggest verifying traffic sources and audience quality.'
    : videoData.engagementAuthenticity === 'UNVERIFIED'
    ? '\n\nENGAGEMENT AUTHENTICITY: UNVERIFIED — insufficient data to validate signals. Treat engagement as early indicators only. Avoid strong conclusions and emphasize the need for more data.'
    : videoData.engagementAuthenticity === 'AUTHENTIC'
    ? '\n\nENGAGEMENT AUTHENTICITY: AUTHENTIC — signals align naturally. Safe to validate engagement strength and confidently reference audience response.'
    : '';

  const system = `You are TubeIntel's elite YouTube content analyst. You deliver deep, specific, actionable analysis across 5 key dimensions. You receive the video title, statistics, tags, and top viewer comments — you do NOT have access to the video content itself. For the structure timeline and retention curve, you must clearly frame your output as RECOMMENDATIONS and PREDICTIONS based on the title/niche/engagement data, not as descriptions of what actually happens in the video. Every insight must be specific to the video data — no generic platitudes. Always return valid JSON only.${finalStateNote}${dominantStateNote}${noBaselineNote}${lowDataNote}${qualityNote}${confidenceToneNote}${retentionNote}${authenticityNote}`;
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

export { validateVideo } from '../../src-shared/prepublish/validateVideo.js';

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

const DIMENSION_WEIGHTS = {
  packaging:  0.40,
  engagement: 0.30,
  seo:        0.15,
  velocity:   0.15,
};

const SPREAD_MAP = {
  packaging: [
    { dim: 'seo', factor: 0.15 },
  ],
};

function computeWeightedOverall(dims) {
  return Object.entries(DIMENSION_WEIGHTS).reduce((sum, [k, w]) => sum + (dims[k] ?? 0) * w, 0);
}

function applyImpactSpread(baseDims, projDims) {
  const result     = { ...baseDims, ...projDims };
  const sourceDims = { ...result };

  for (const [srcDim, targets] of Object.entries(SPREAD_MAP)) {
    const delta = (sourceDims[srcDim] ?? 0) - (baseDims[srcDim] ?? 0);
    if (delta <= 0) continue;
    for (const { dim, factor } of targets) {
      const current    = result[dim] ?? baseDims[dim] ?? 0;
      const spreadGain = Math.min(delta * factor, 0.5 * (100 - current));
      result[dim]      = Math.min(100, current + spreadGain);
    }
  }
  return result;
}

export async function generateVideoImprovements(videoData, analysisData) {
  const system = `You are a brutally honest YouTube growth auditor. Your job is to identify exactly why a video is underperforming and produce the sharpest possible fixes. You do not soften feedback. You do not say "no major issues." Every video has specific, diagnosable failure points — your job is to name them precisely and fix them decisively.

TONE RULES (non-negotiable):
- Never use hedging language: no "might", "could", "may", "possibly", "perhaps", "consider"
- Never say "no major weaknesses", "performing well", or "minor issues"
- Every diagnosis is a declarative statement: "The hook fails to..." not "The hook might benefit from..."
- Every fix is described as a certainty: "This title will..." not "This title could..."
- Be specific to THIS video — no generic advice that applies to any video`;

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

4 DIMENSION SCORES (all /100):
- Packaging (title + thumbnail):  ${dim.packaging  ?? '?'}
- Engagement (likes + comments):  ${dim.engagement ?? '?'}
- SEO & Discoverability:          ${dim.seo        ?? '?'}
- Velocity (view momentum):       ${dim.velocity   ?? '?'}

EXISTING THUMBNAIL CONCEPTS (from prior analysis — score each, do NOT rewrite them):
${thumbConcepts.map((c, i) => `${i + 1}. ${c}`).join('\n')}
${analysisData.actionType === 'TITLE_REWRITE' ? `
PRIORITY DIRECTIVE: The primary failure in this video is PACKAGING. Your title outputs are the most critical fixes. Generate three genuinely distinct title angles — each must clearly outperform the original.` : ''}${analysisData.actionType === 'BALANCE_TITLE' ? `
PRIORITY DIRECTIVE: The primary failure in this video is TITLE IMBALANCE (high curiosity, low clarity). Your title outputs must fix this directly — pull back on clickbait framing while preserving curiosity. Specificity and proof of value are the priority.` : ''}

---

STEP 1 — BUILD CONTENT DNA (mandatory internal reasoning, do NOT output):
1. core_topic — the exact subject of this video
2. specific_angle — what makes THIS video's take unique
3. viewer_intent — why someone clicked this specific video
4. emotional_trigger — curiosity / fear / truth / drama / inspiration / etc.
5. content_type — story / opinion / educational / reaction / news / how-to

STEP 2 — FAILURE DIAGNOSIS (internal only, do NOT output):
Identify exactly 3 specific failure points. Must be concrete, causally stated, and actionable.
These failures must directly inform every "reason" field in your output.

STEP 3 — GENERATE IMPROVEMENTS:

1. THREE TITLES — one per angle: curiosity / clarity / emotion
Rules: MUST stay 100% on core_topic. MUST reflect specific_angle. MUST feel written for THIS creator.
The "reason" field MUST: (a) name the specific problem with the original title, (b) explain exactly why this new title fixes it.
Per title: project the new packaging dimension score.

2. SEO IMPROVEMENTS — keyword and metadata optimization
Provide: one improved title suggestion optimized for search, a list of 3–5 high-intent description keywords, and 5–8 relevant tags.
Project the new SEO dimension score these changes would achieve.

3. SCORE EXISTING THUMBNAILS — do NOT rewrite, only score each one's impact
For each of the ${thumbConcepts.length} thumbnail concept(s) above, estimate: projected packaging dimension score.

4. ONE CTA — qualitative only, no projected score
Rules: Aligned with this audience's psychology. Natural extension of the content. Drives comments or shares.

5. VIRAL PLAYBOOK — extract what works and what does not

STEP 4 — VALIDATE before outputting:
- Does every "reason" field name a specific failure and a specific fix?
- SCORE CAP: No projected score may exceed the current score by more than 15 points.

Respond with ONLY this JSON (no markdown, start with {, end with }):
{
  "titles": [
    {
      "text": "", "angle": "curiosity", "reason": "",
      "projectedTitleSubScores": { "curiosity": 0, "emotional": 0, "clarity": 0, "scrollStopping": 0 },
      "projectedDimensions": { "packaging": 0 }
    },
    {
      "text": "", "angle": "clarity", "reason": "",
      "projectedTitleSubScores": { "curiosity": 0, "emotional": 0, "clarity": 0, "scrollStopping": 0 },
      "projectedDimensions": { "packaging": 0 }
    },
    {
      "text": "", "angle": "emotion", "reason": "",
      "projectedTitleSubScores": { "curiosity": 0, "emotional": 0, "clarity": 0, "scrollStopping": 0 },
      "projectedDimensions": { "packaging": 0 }
    }
  ],
  "seo_improvements": {
    "title_suggestion": "",
    "description_keywords": ["keyword1", "keyword2"],
    "tags": ["tag1", "tag2"],
    "projectedSeoScore": 0
  },
  "thumbnails": [
    { "projectedDimensions": { "packaging": 0 } }
  ],
  "cta": {
    "text": "", "reason": ""
  },
  "viral_playbook": {
    "hook_pattern": "The psychological mechanic used (or that SHOULD be used) in the hook — name the technique and why it works on THIS audience.",
    "video_structure": "The precise content sequence this format requires. Identify where structure breaks down and the corrected sequence.",
    "emotional_trigger": "The exact emotion this topic triggers in this audience and WHY — name the psychological driver.",
    "cta_pattern": "The CTA that matches this specific audience's psychology — name the desire or insecurity it taps.",
    "replication_steps": [
      "Concrete action step 1 — executable tomorrow, specific to this video format",
      "Concrete action step 2",
      "Concrete action step 3",
      "Concrete action step 4"
    ]
  }
}`;

  const text = await callClaude(system, user, 3600);
  console.log('[generateVideoImprovements] raw response (first 300):', text?.slice(0, 300));
  const parsed = safeJSON(text);
  if (!parsed) {
    console.warn('[generateVideoImprovements] JSON parse failed:', text);
    return null;
  }

  const baseDims    = analysisData.dimensionScores || {};
  const baseOverall = analysisData.viralScore ?? 0;

  const applyToItem = (item, primaryDim) => {
    if (!item || item.projectedDimensions?.[primaryDim] == null) return;
    const fullDims = applyImpactSpread(baseDims, { ...item.projectedDimensions });
    item.projectedDimensions = { ...fullDims };
    item.projectedOverall    = Math.min(Math.round(computeWeightedOverall(fullDims)), baseOverall + 15);
  };

  (parsed.titles     || []).forEach(t => applyToItem(t, 'packaging'));
  (parsed.thumbnails || []).forEach(t => applyToItem(t, 'packaging'));

  if (parsed.seo_improvements?.projectedSeoScore != null) {
    const fullDims = applyImpactSpread(baseDims, { seo: parsed.seo_improvements.projectedSeoScore });
    parsed.seo_improvements.projectedDimensions = { ...fullDims };
    parsed.seo_improvements.projectedOverall    = Math.min(
      Math.round(computeWeightedOverall(fullDims)), baseOverall + 15
    );
  }

  return parsed;
}

export async function getVideoSignals(videoData) {
  const system = `You are an analysis engine that outputs STRICT JSON only. No explanations. No text. Only valid JSON.`;

  const descPreview = (videoData.description || '').split('\n').slice(0, 2).join(' ').slice(0, 200);

  const user = `Analyze this YouTube video and return packaging and SEO scoring signals.

VIDEO DATA:
Title: "${videoData.title}"
Description preview (first 2 lines): "${descPreview}"
Tags: ${videoData.tags || 'none'}
Duration: ${videoData.duration}
Published: ${videoData.publishedAt}

RULES:
1. Be realistic and consistent — avoid giving all high scores.
2. Scores reflect YouTube performance potential for this specific title and metadata.
3. All scores are 0–10 (0 = extremely poor, 10 = exceptional).
4. packaging scores evaluate the title and description preview only.
5. seo scores evaluate how well the metadata matches search intent.

Return ONLY this JSON (no markdown, start with {, end with }):
{
  "packaging": {
    "title_clarity": 0,
    "title_curiosity": 0,
    "title_emotion": 0,
    "title_keyword_strength": 0,
    "description_relevance": 0
  },
  "seo": {
    "keyword_alignment": 0,
    "search_potential": 0,
    "competition_fit": 0,
    "tag_relevance": 0
  }
}`;

  const text = await callClaude(system, user, 600);
  console.log('[getVideoSignals] raw response (first 300):', text?.slice(0, 300));
  const parsed = safeJSON(text);
  if (parsed) return parsed;
  console.warn('[getVideoSignals] JSON parse failed:', text);
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

export async function generateFixes({ input, weaknesses, originalAnalysis }) {
  const system = `You are an elite YouTube growth strategist. Your job is to generate precise, context-aware video improvements based on analysis data. Every output must be specific to the exact video — no generic advice. Always respond with valid JSON only.`;

  const user = `VIDEO INPUT:
Title: "${input.title || ''}"
Thumbnail Description: "${input.thumbnailDescription || ''}"
Script: "${input.script || ''}"

ORIGINAL ANALYSIS:
${JSON.stringify(originalAnalysis, null, 2)}

IDENTIFIED WEAKNESSES:
${JSON.stringify(weaknesses, null, 2)}

TASK:
1. Write a stronger hook (first 5 seconds) — must create immediate curiosity or tension specific to this video's topic
2. Generate 3 high-CTR title alternatives — one curiosity-driven, one clarity-driven, one emotion-driven
3. Suggest 3 thumbnail ideas — specific visual concepts with face expression, text overlay, and background
4. Improve the first 20 seconds of the script — word-for-word rewrite that grabs attention immediately

Focus on: curiosity gap, emotional trigger, retention.

Respond with ONLY this JSON (no markdown, start with {, end with }):
{
  "improvedHook": "",
  "improvedTitles": ["", "", ""],
  "thumbnailIdeas": ["", "", ""],
  "improvedScriptIntro": ""
}`;

  const text = await callClaude(system, user, 1600);
  const parsed = safeJSON(text);
  if (parsed) return parsed;
  return null;
}

// ─── Diagnosis Engine ─────────────────────────────────────────────────────────
// Separate from analyzeVideoDeep — powers "Fix My Video" pillar.
// All classification is done by the JS scoring layer before this call.

function detectContentType(video, durationSeconds) {
  const categoryId = video.snippet?.categoryId;
  const title = (video.snippet?.title || '').toLowerCase();
  const tags  = (video.snippet?.tags  || []).join(' ').toLowerCase();
  const musicSignals = ['official video', 'official audio', 'lyrics', 'music video', 'feat.', ' ft.', 'prod.', 'album', 'single release'];
  if (categoryId === '10' || musicSignals.some(k => title.includes(k) || tags.includes(k))) return 'MUSIC';
  if (durationSeconds > 0 && durationSeconds <= 60) return 'SHORT';
  return 'LONG';
}

// ─── Primary problem classifier ───────────────────────────────────────────────
// Pure logic: takes three normalized scores (0–100), returns exactly one label.
// Evaluated in strict priority order — first match wins, no overlap possible.
//
// Priority rationale:
//   1. STRONG_SHORT   — high-performer must win before any gap rule fires
//   2. SCROLL_KILLER  — velocity alone is enough to condemn; checked before
//                       HOOK_MISLEADING so low-velocity videos aren't mislabelled
//   3. HOOK_MISLEADING — requires velocity ≥ 70 to separate from general failure
//   4. CONCEPT_FAILURE — both engagement AND discussion low; checked after
//                        HOOK_MISLEADING to avoid dual-classification
//   5. DISCUSSION_GAP  — decent engagement but dead comment section
//   6. HYBRID          — fallback only; no strong single signal
//
// Test table:
//   velocity  engagement  discussion  → expected
//   90        75          20          → STRONG_SHORT  (rule 1)
//   35        65          50          → SCROLL_KILLER (rule 2)
//   75        35          35          → HOOK_MISLEADING (rule 3)
//   30        35          25          → SCROLL_KILLER (rule 2 fires before rule 4)
//   65        70          20          → DISCUSSION_GAP (rule 5)
//   60        60          55          → HYBRID        (no rule matches)

function mapToPrimaryProblem({ velocity, engagement, discussion }) {
  if (velocity >= 85 && engagement >= 70)  return 'STRONG_SHORT';
  if (velocity < 40)                        return 'SCROLL_KILLER';
  if (velocity >= 70 && engagement < 40)   return 'HOOK_MISLEADING';
  if (engagement < 40 && discussion < 40)  return 'CONCEPT_FAILURE';
  if (engagement >= 60 && discussion < 30) return 'DISCUSSION_GAP';
  return 'HYBRID';
}

function buildDoNotTouch(scoreOutput) {
  const { dimensionScores = {}, finalScore = 0 } = scoreOutput;
  const LABELS = {
    engagement: 'Audience engagement rate (likes + comments)',
    velocity:   'View velocity relative to channel average',
    discussion: 'Comment and discussion activity',
  };
  const out = [];
  for (const [key, score] of Object.entries(dimensionScores)) {
    if (score >= 65 && LABELS[key]) out.push(LABELS[key]);
  }
  if (finalScore >= 70) out.push('Overall video performance score');
  return out;
}

function deriveRetentionPattern(scoreOutput) {
  const { dimensionScores = {}, finalScore = 0 } = scoreOutput;
  const { engagement = 50, velocity = 50, discussion = 50 } = dimensionScores;
  if (finalScore >= 70 || (engagement >= 65 && discussion >= 65)) return 'STRONG';
  if (engagement < 40 && velocity < 40 && discussion < 40) return 'FLAT';
  if (velocity < 40) return 'EARLY_DROP';
  return 'MID_DROP';
}

function deriveConfidence(scoreOutput) {
  const { videoType, mode } = scoreOutput;
  if (videoType === 'EARLY') return 'LOW';
  if (['LEGACY_VIRAL', 'VIRAL_SPIKE'].includes(videoType)) return 'HIGH';
  if (mode === 'oauth') return 'HIGH';
  return 'MEDIUM';
}

function getDominantSignal({ engagement = 0, velocity = 0, discussion = 0 }) {
  const scores = { ENGAGEMENT: engagement, VELOCITY: velocity, DISCUSSION: discussion };
  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const [firstName, firstVal] = sorted[0];
  const [, secondVal]         = sorted[1];
  if (firstVal - secondVal <= 5) return 'HYBRID';
  return firstName;
}

function deriveSignalsFromScore(scoreOutput, durationSeconds) {
  const { videoType, dimensionScores = {} } = scoreOutput;
  const { velocity = 50, engagement = 50, discussion = 50 } = dimensionScores;

  let velocityShape;
  if (videoType === 'VIRAL_SPIKE' || velocity >= 80)        velocityShape = 'SPIKING';
  else if (videoType === 'ACTIVE_GROWTH' || velocity >= 55) velocityShape = 'GROWING';
  else if (videoType === 'DORMANT' || velocity < 35)        velocityShape = 'DECLINING';
  else                                                       velocityShape = 'STABLE';

  const commentToLikeRatio = engagement > 0 ? discussion / engagement : 0;
  let engagementPattern;
  if (engagement >= 60 && commentToLikeRatio < 0.3)         engagementPattern = 'PASSIVE';
  else if (engagement >= 55 && commentToLikeRatio >= 0.3)   engagementPattern = 'ACTIVE';
  else                                                       engagementPattern = 'MIXED';

  let stability;
  if (['LEGACY_VIRAL', 'STABLE'].includes(videoType))        stability = 'STABLE';
  else if (['VIRAL_SPIKE', 'EARLY'].includes(videoType))     stability = 'VOLATILE';
  else if (videoType === 'ACTIVE_GROWTH')                    stability = 'GROWING';
  else                                                       stability = 'STABLE';

  const format = durationSeconds > 0 && durationSeconds <= 60 ? 'SHORT' : 'LONG';

  return { velocityShape, engagementPattern, stability, format };
}

function deriveSignalsFromRaw(video, durationSeconds) {
  const stats        = video.statistics || {};
  const snippet      = video.snippet    || {};
  const vws          = parseInt(stats.viewCount    || 0);
  const lks          = parseInt(stats.likeCount    || 0);
  const cms          = parseInt(stats.commentCount || 0);

  const publishedAt  = snippet.publishedAt ? new Date(snippet.publishedAt) : null;
  const ageHours     = publishedAt ? Math.max(1, (Date.now() - publishedAt.getTime()) / 3_600_000) : 1;
  const viewsPerHour = vws / ageHours;

  // Channel baseline: stored on video object by VideoAnalysis after channel fetch
  const channelAvgVPH = video._channelAvgVPH || 0;
  const velocityRatio = channelAvgVPH > 0 ? viewsPerHour / channelAvgVPH : 1;

  const velocityStrength =
    velocityRatio >= 2.5 ? 3 :
    velocityRatio >= 1.5 ? 2 :
    velocityRatio >= 0.5 ? 1 : 0;

  const engRate = vws > 0 ? (lks + cms) / vws * 100 : 0;
  const engagementStrength =
    engRate >= 5   ? 3 :
    engRate >= 3   ? 2 :
    engRate >= 1.5 ? 1 : 0;

  const commentToLike     = lks > 0 ? cms / lks : 0;
  const discussionStrength = commentToLike >= 0.3 ? 2 : commentToLike >= 0.1 ? 1 : 0;

  // dominant_signal: highest wins; gap ≤ 1 → HYBRID
  const strengths = { VELOCITY: velocityStrength, ENGAGEMENT: engagementStrength, DISCUSSION: discussionStrength };
  const sorted    = Object.entries(strengths).sort((a, b) => b[1] - a[1]);
  const dominant  = sorted[0][1] - sorted[1][1] <= 1 ? 'HYBRID' : sorted[0][0];

  // velocityShape from raw ratio
  const velocityShape =
    velocityRatio >= 2.5 ? 'SPIKING'  :
    velocityRatio >= 1.5 ? 'GROWING'  :
    velocityRatio >= 0.5 ? 'STABLE'   : 'DECLINING';

  // engagementPattern from raw ratios
  let engagementPattern;
  if (engRate >= 3 && commentToLike < 0.3)      engagementPattern = 'PASSIVE';
  else if (engRate >= 1.5 && commentToLike >= 0.3) engagementPattern = 'ACTIVE';
  else                                             engagementPattern = 'MIXED';

  // stability: proxy from velocity volatility — no videoType available in raw path
  const stability =
    velocityRatio >= 2.5 ? 'VOLATILE' :
    velocityRatio >= 1.5 ? 'GROWING'  :
    velocityRatio >= 0.5 ? 'STABLE'   : 'VOLATILE';

  const format = durationSeconds > 0 && durationSeconds <= 60 ? 'SHORT' : 'LONG';

  return {
    velocityShape,
    engagementPattern,
    stability,
    format,
    _meta: { dominant, velocityRatio: +velocityRatio.toFixed(2), engRate: +engRate.toFixed(2), commentToLike: +commentToLike.toFixed(3) },
  };
}


function normalizeDiagnosisOutput(parsed, confidence) {
  if (!parsed) return null;

  const CONTENT_TYPES  = ['Viral / Entertainment', 'Evergreen / Search-based', 'Utility / Problem-solving', 'Authority / Education', 'Emerging Viral'];
  const SUCCESS_MODELS = ['Viral Spike', 'Evergreen Search Loop', 'Authority Builder', 'Utility Engine', 'Early-stage Breakout'];
  const QUAL_VALUES    = ['LOW', 'MODERATE', 'HIGH', 'VERY HIGH'];
  const ENG_TYPES      = ['ACTIVE', 'PASSIVE'];
  const DEP_VALUES     = ['LOW', 'MEDIUM', 'HIGH'];
  const CONF_VALUES    = ['LOW', 'MEDIUM', 'HIGH'];

  const pp  = parsed.performanceProfile || {};
  const ins = parsed.insights           || {};
  const rec = parsed.recommendations    || {};

  return {
    mechanism: (() => {
      const m = parsed.mechanism;
      if (m && typeof m === 'object') {
        return {
          entry:     typeof m.entry     === 'string' ? m.entry     : '',
          retention: typeof m.retention === 'string' ? m.retention : '',
          loop:      typeof m.loop      === 'string' ? m.loop      : '',
        };
      }
      return { entry: '', retention: '', loop: '' };
    })(),
    contentType:  CONTENT_TYPES.includes(parsed.contentType)  ? parsed.contentType  : 'Emerging Viral',
    successModel: SUCCESS_MODELS.includes(parsed.successModel) ? parsed.successModel : 'Early-stage Breakout',
    performanceProfile: {
      longTermValue:       QUAL_VALUES.includes(pp.longTermValue)       ? pp.longTermValue       : 'MODERATE',
      engagementType:      ENG_TYPES.includes(pp.engagementType)        ? pp.engagementType      : 'PASSIVE',
      retentionDependency: DEP_VALUES.includes(pp.retentionDependency)  ? pp.retentionDependency : 'MEDIUM',
      searchPotential:     QUAL_VALUES.includes(pp.searchPotential)     ? pp.searchPotential     : 'MODERATE',
      viralityPotential:   QUAL_VALUES.includes(pp.viralityPotential)   ? pp.viralityPotential   : 'LOW',
    },
    insights: {
      what_is_working: Array.isArray(ins.what_is_working) ? ins.what_is_working : [],
      what_is_failing: Array.isArray(ins.what_is_failing) ? ins.what_is_failing : [],
      leverage_points: Array.isArray(ins.leverage_points) ? ins.leverage_points : [],
    },
    verdict: typeof parsed.verdict === 'string' ? parsed.verdict : '',
    recommendations: {
      goal:    typeof rec.goal === 'string'        ? rec.goal    : '',
      actions: Array.isArray(rec.actions)          ? rec.actions : [],
    },
    confidence: CONF_VALUES.includes(confidence) ? confidence : 'MEDIUM',
  };
}

const TYPE_MAP = {
  'Evergreen / Search-based':  'Evergreen',
  'Viral / Entertainment':     'Viral',
  'Utility / Problem-solving': 'Utility',
  'Authority / Education':     'Utility',
  'Emerging Viral':            'Viral',
};

const AI_MODIFIERS = {
  Evergreen: 1.05,
  Utility:   1.05,
  Viral:     1.00,
};

export function adjustScoreWithAI(baseScore, contentType) {
  if (!baseScore || !contentType) return baseScore ?? 0;
  const key      = TYPE_MAP[contentType] ?? contentType;
  const modifier = AI_MODIFIERS[key] ?? 1.0;
  return Math.min(100, Math.round(baseScore * modifier));
}

export async function analyzeVideoDiagnosis({ video, unifiedResult }) {
  const title = video.snippet?.title || '';

  // Derive diagnostic inputs from unified result
  video._channelAvgVPH = unifiedResult.baseline?.medianVph || 0;
  const dur = unifiedResult.metrics.duration?.total ?? 0;
  const sig = deriveSignalsFromRaw(video, dur);
  const ds  = unifiedResult.dimensionScores;
  const sr  = {
    primary_problem: unifiedResult.videoType === 'EARLY'
      ? 'HYBRID'
      : mapToPrimaryProblem(ds),
    dominant_signal: getDominantSignal(ds),
    confidence:      unifiedResult.confidence,
    do_not_touch:    buildDoNotTouch({ dimensionScores: ds, finalScore: unifiedResult.scores.finalScore }),
    metrics: {
      engagement_rate: +unifiedResult.metrics.engagementRate.toFixed(2),
      comment_rate:    +unifiedResult.metrics.commentRate.toFixed(3),
      velocity_score:  ds.velocity,
    },
    retention: {
      pattern: deriveRetentionPattern({ dimensionScores: ds, finalScore: unifiedResult.scores.finalScore }),
    },
  };
  const diagNoBaselineNote = unifiedResult.noBaseline
    ? '\n\nNO BASELINE: This channel has insufficient historical data for reliable comparison. Avoid ratio-based claims and comparative language. Treat all signals as directional only.'
    : '';

  const lowSampleNote = unifiedResult.lowSample
    ? '\n\nLOW DATA WARNING: This video has very few views, likes, or comments. Use conservative, hedged language throughout. Avoid strong claims.'
    : '';

  const diagConfidenceToneNote = unifiedResult.confidence === 'LOW'
    ? '\n\nCONFIDENCE: LOW — Avoid strong conclusions. Use cautious, conditional language throughout. Prefer: "early signal", "may indicate", "not yet reliable". Avoid: "is", "clearly", "confirmed".'
    : unifiedResult.confidence === 'MEDIUM'
    ? '\n\nCONFIDENCE: MEDIUM — Use moderately hedged language. Prefer: "suggests", "likely", "appears to". Avoid: "clearly", "confirmed", "definitely".'
    : unifiedResult.confidence === 'HIGH'
    ? '\n\nCONFIDENCE: HIGH — Signals are reliable. Use clear, direct language. Prefer: "is", "clearly", "confirmed". Avoid unnecessary hedging.'
    : '';

  const DIAG_FINAL_STATE_CONTEXT = {
    CONFIRMED_VIRAL:   'Exceptional reach AND strong engagement. Frame mechanism and verdict around distribution and engagement success.',
    LEAKING_VIRAL:     'Exceptional reach but weak engagement. Frame analysis around the reach-engagement gap.',
    CRITICAL_LEAK:     'Extreme reach, severe engagement failure. Frame diagnosis around the severe disconnect.',
    CONFIRMED_STRONG:  'Consistent, reliable performance. Frame diagnosis around validated signals and what is sustaining them.',
    EARLY_OR_BLOCKED:  'Limited distribution or early stage. Frame diagnosis around distribution constraints.',
    WEAK:              'Poor performance signals. Frame diagnosis around root causes of underperformance.',
    INSUFFICIENT_DATA: 'Insufficient data. Use conservative, heavily hedged diagnosis throughout.',
  };

  const diagFinalStateNote = unifiedResult.final_state
    ? `\n\nFINAL STATE: ${unifiedResult.final_state} | Leak: ${unifiedResult.leak} | Leak intensity: ${unifiedResult.leak_intensity} | Reliability: ${unifiedResult.reliability}\nBase your explanation STRICTLY on this state. Do not contradict it. Do not derive your own classification.\n${DIAG_FINAL_STATE_CONTEXT[unifiedResult.final_state] ?? ''}`
    : '';

  const diagDominantStateNote = unifiedResult.videoType === 'LEGACY_VIRAL'
    ? '\n\nDOMINANT STATE: LEGACY VIRAL. Do NOT suggest optimization or risk. Do NOT frame engagement patterns as failures. Treat this as post-peak resurfacing. Focus on mechanism and historical pattern only.'
    : unifiedResult.final_state === 'CONFIRMED_VIRAL'
    ? '\n\nDOMINANT STATE: CONFIRMED VIRAL. Emphasize distribution momentum. Do not frame lower engagement as failure — it reflects reach scale effects. Avoid negative framing or optimization suggestions.'
    : '';

  const retentionSafetyNote = '\n\nRETENTION DATA: You do NOT have actual watch time or retention curve data. Never state retention patterns as confirmed facts. Never use "EARLY_DROP confirmed" or "retention failure". If inferring, use only "possible early drop-off (inferred from engagement patterns)" or state "no direct retention data available".';

  const diagAuthenticityNote = unifiedResult.engagementAuthenticity === 'SUSPICIOUS'
    ? '\n\nENGAGEMENT AUTHENTICITY: SUSPICIOUS — signal mismatch detected. Highlight possible signal inconsistency. Avoid claiming strong audience validation. Suggest verifying traffic sources and audience quality.'
    : unifiedResult.engagementAuthenticity === 'UNVERIFIED'
    ? '\n\nENGAGEMENT AUTHENTICITY: UNVERIFIED — insufficient data to validate signals. Treat engagement as early indicators only. Avoid strong conclusions and emphasize the need for more data.'
    : unifiedResult.engagementAuthenticity === 'AUTHENTIC'
    ? '\n\nENGAGEMENT AUTHENTICITY: AUTHENTIC — signals align naturally. Safe to validate engagement strength and confidently reference audience response.'
    : '';

  const system = `You are a YouTube video diagnosis engine. Your only job is to interpret pre-computed signals and produce a structured, decisive diagnosis. You do NOT classify, re-score, or override any input field. You are not allowed to infer new problems or contradict the provided classification.

---
CONTENT TYPE CLASSIFICATION (OUTPUT AS "contentType"):
Classify the video into EXACTLY ONE of these intent-based types using title + signals:
- "Viral / Entertainment": broad appeal, emotionally driven, SPIKING velocity, meant for mass consumption.
- "Evergreen / Search-based": answers a specific question, durable over time, STABLE or GROWING velocity, found via search.
- "Utility / Problem-solving": solves a recurring problem, how-to structure, PASSIVE engagement, consistent moderate views.
- "Authority / Education": builds expertise/trust over time, ACTIVE engagement (comments = questions), GROWING velocity.
- "Emerging Viral": early-stage, high engagement ratio relative to views, VOLATILE, strong signals but underexposed.

SUCCESS MODEL (OUTPUT AS "successModel"):
Identify the growth mechanism — choose ONE:
- "Viral Spike": fast peak, broad reach, entertainment-driven, decays quickly.
- "Evergreen Search Loop": compounds over time via search discovery, durable.
- "Authority Builder": builds channel credibility and trust, long-term subscriber growth.
- "Utility Engine": solves recurring problems, steady consistent traffic.
- "Early-stage Breakout": underexposed quality content, needs distribution push.

PERFORMANCE PROFILE (OUTPUT AS "performanceProfile"):
Evaluate qualitatively relative to the contentType — do NOT use numbers:
- longTermValue: "LOW" | "MODERATE" | "HIGH" | "VERY HIGH"
  (Viral = LOW-MODERATE, Evergreen/Utility/Authority = HIGH-VERY HIGH)
- engagementType: "ACTIVE" | "PASSIVE"
  (community/education = ACTIVE, entertainment/utility = PASSIVE)
- retentionDependency: "LOW" | "MEDIUM" | "HIGH"
  (education/utility = HIGH, entertainment = LOW)
- searchPotential: "LOW" | "MODERATE" | "STRONG"
  (evergreen/utility = STRONG, viral/entertainment = LOW)
- viralityPotential: "LOW" | "MODERATE" | "HIGH"
  (viral/entertainment = HIGH, evergreen/utility = LOW)

IMPORTANT: Low comments in educational or utility content is NORMAL — do NOT treat it as a failure signal.
High velocity matters primarily for viral/entertainment content — do NOT over-weight it for other types.

---
TYPE-SPECIFIC RULES:
- MUSIC: Do NOT penalize low engagement or comment rates. Focus on replayability, sensory hook, emotional consistency, global accessibility.
- SHORT: Focus on hook strength (first 1–3 sec), retention behavior, loop potential.
- LONG: Frame feed failures as "click-through problems", not scroll problems. Use more cautious language throughout.

---
PRIMARY PROBLEM DEFINITIONS:

STRONG_SHORT:
Core meaning: High performance across key signals — this is a validated video. Do not generate fixes. Only extract patterns and reinforce what is working.
FORBIDDEN words in entire output: "could", "might", "consider", "however", "although", "but", any weakness, any gap, any improvement suggestion. Zero contrast framing. Zero critique.

SCROLL_KILLER:
Core meaning: Video fails in the feed — packaging is not converting scrollers into viewers. The failure is at the distribution entry point before any content is seen.

HOOK_MISLEADING:
Core meaning: Packaging pulls the click but the first 5–10 seconds break the implicit promise, causing immediate drop-off.

CONCEPT_FAILURE:
Core meaning: The premise does not generate sustained interest regardless of packaging or hook execution.

DISCUSSION_GAP:
Core meaning: Audience watches but finds no tension, opinion, or open question to respond to — passive consumption only.

HYBRID:
Core meaning: No dominant failure signal detected — diagnosis must be conservative. Use cautious language throughout.

---
MECHANISM-FIRST REASONING (MANDATORY):
Step 1: Identify the mechanism as a full causal chain. Write three separate JSON fields:
  "entry" — why does this specific viewer click? What signal in the title, topic framing, or format triggers the decision? Go beyond "search intent" or "curiosity" — describe the psychological state or need being activated.
  "retention" — once watching, what holds attention? Name the structural, emotional, or informational force that makes leaving feel costly. Not the topic — the mechanism within the content.
  "loop" — what prevents drop-off, drives completion, or causes sharing? What closes the engagement loop?

Write each as a standalone 1–3 sentence observation specific to this video. Concise and explicit. No combined paragraphs spanning all three fields. No single-word labels. Behavioral observations only, not category descriptions.

Step 2: Use the mechanism to derive contentType and successModel.
Step 3: Use mechanism + signals to build performanceProfile.
Step 4: Ensure every field is consistent with the mechanism. No field may contradict it.

ANTI-PATTERN: Do NOT assign contentType or successModel first and then write a mechanism to justify them. Mechanism fields must be written before classification fields are decided.

---
STRONG_SHORT HARD BLOCK:
If primary_problem is STRONG_SHORT — validation mode only. insights.what_is_failing must be empty. recommendations.actions must be empty. insights.leverage_points contains what to scale. insights.what_is_working contains confirmed patterns.
FORBIDDEN in entire output: "could", "might", "consider", "however", "although", "but", any weakness, any gap.

---
DOMINANT SIGNAL RULES — mechanism and verdict MUST reflect this lens:
- VELOCITY: explain algorithm push, distribution momentum.
- ENGAGEMENT: explain audience satisfaction, like behavior, retention alignment.
- DISCUSSION: explain debate, controversy, or strong opinions.
- HYBRID: describe both forces present. Do not reduce to one cause.

---
HYBRID TRIGGER SEPARATION:
dominant_signal = HYBRID → describe dual forces in mechanism, name both.
primary_problem = HYBRID → conservative diagnosis, reduced certainty language.
Both present simultaneously → balanced, low-certainty, dual-force output.

---
RECOMMENDATIONS RULE:
recommendations.actions must directly address the leverage_points in insights. If the root cause is packaging, fix packaging. If the root cause is content, fix content. If both are failing, address both. Do not restrict actions to a single layer when the evidence points to multiple failure points. Actions must follow root cause, not a pre-assigned category.

---
SAFETY: If signals are unclear, default to conservative diagnosis. Never hallucinate conclusions.

DO NOT TOUCH: Reinforce every item in do_not_touch[] inside insights.what_is_working. Never add new ones.
TONE: Decisive, analytical. No motivational language.

Return ONLY valid JSON. No markdown fences. Start with { end with }.${diagFinalStateNote}${diagDominantStateNote}${diagNoBaselineNote}${lowSampleNote}${diagConfidenceToneNote}${retentionSafetyNote}${diagAuthenticityNote}`;

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
    "what_is_working": ["...confirmed strengths from do_not_touch, rephrased..."],
    "what_is_failing": ["...specific failure points based on primary_problem — empty if STRONG_SHORT..."],
    "leverage_points": ["...ordered from highest to lowest impact — most actionable and highest-value opportunity listed first..."]
  },
  "verdict": "one decisive sentence on this video's strategic position",
  "recommendations": {
    "goal": "what needs to happen next",
    "actions": ["...specific actions that directly address the leverage_points above — follow root cause, not layer restriction — empty if STRONG_SHORT..."]
  },
  "confidence": "${sr.confidence}"
}`;

  const user = `Analyze this video. Follow the mechanism-first reasoning order: identify mechanism → derive classification → build profile → generate insights.

video title: "${title}"
primary_problem: ${sr.primary_problem}
dominant_signal: ${sr.dominant_signal}
confidence: ${sr.confidence}

behavior signals:
  velocity shape: ${sig.velocityShape || 'STABLE'}
  engagement pattern: ${sig.engagementPattern || 'MIXED'}
  stability: ${sig.stability || 'STABLE'}
  format: ${sig.format || 'LONG'}

metrics:
  engagement_rate: ${sr.metrics.engagement_rate}%
  comment_rate: ${sr.metrics.comment_rate}%
  velocity_score: ${sr.metrics.velocity_score}

retention pattern: ${sr.retention.pattern}
do_not_touch: ${JSON.stringify(sr.do_not_touch)}

pattern layer:
  engagement quality: ${unifiedResult.engagementQuality}${unifiedResult.engagementQuality === 'LOW' ? ' (signals may not reflect real audience behavior — use hedged language)' : ''}
  engagement authenticity: ${unifiedResult.engagementAuthenticity}

Return ONLY this JSON (no markdown):
${outputTemplate}`;

  const text   = await callClaude(system, user, 1800);
  const parsed = safeJSON(text);
  if (parsed) return normalizeDiagnosisOutput(parsed, sr.confidence);
  console.warn('[analyzeVideoDiagnosis] JSON parse failed:', text?.slice(0, 200));
  return null;
}

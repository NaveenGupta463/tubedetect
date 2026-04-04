const CLAUDE_URL = '/api/anthropic/v1/messages';
const MODEL = 'claude-opus-4-5';

async function callClaude(system, user, maxTokens = 1200) {
  const key = import.meta.env.VITE_ANTHROPIC_KEY;
  if (!key) throw new Error('No Anthropic API key — add VITE_ANTHROPIC_KEY to your .env file');

  const res = await fetch(CLAUDE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: user }],
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || `TubeIntel error ${res.status}`);
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

export async function scoreTitle(title, thumbnailDesc, niche) {
  const system = `You are the world's leading YouTube CTR optimization expert. You've analyzed millions of titles and thumbnails and can predict click-through rates with precision. Give brutally honest, hyper-specific feedback that creators can act on immediately.`;
  const user = `Score and deeply analyze this title and thumbnail combination:

Title: "${title}"
Thumbnail description: "${thumbnailDesc || 'not provided'}"
Niche: "${niche || 'general'}"

Respond in this exact JSON (no other text):
{
  "titleScore": 0-100,
  "thumbnailScore": 0-100,
  "overallScore": 0-100,
  "titleStrengths": ["specific strength with explanation of WHY it works psychologically", "specific strength 2"],
  "titleWeaknesses": ["specific weakness with explanation of the CTR impact", "specific weakness 2"],
  "thumbnailSuggestions": ["very specific suggestion 1 with exact changes to make", "specific suggestion 2", "specific suggestion 3"],
  "improvedTitles": ["improved variant 1 — more clickable than original", "improved variant 2 — different angle", "improved variant 3 — highest CTR potential"],
  "ctrPrediction": "low/medium/high",
  "reasoning": "2-3 sentence expert summary of exactly why this title will or won't perform",
  "viralityScoreBreakdown": {
    "titleStrength": 7,
    "thumbnailAppeal": 6,
    "hookPower": 8,
    "topicTiming": 5,
    "audienceMatch": 7
  }
}

IMPORTANT: viralityScoreBreakdown values MUST be plain integers 0-10, not strings or ranges. Respond with ONLY the JSON object. No markdown, no backticks. Start with { and end with }.`;
  const text = await callClaude(system, user, 2000);
  return safeJSON(text) || { overallScore: 50, reasoning: text };
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
  const system = `You are TubeIntel's elite YouTube content analyst. You deliver deep, specific, actionable analysis across 5 key dimensions. Every insight must be specific to the video data — no generic platitudes. Always return valid JSON only.`;
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
    "hookAnalysis": "2 specific sentences analyzing the opening hook's effectiveness",
    "timeline": [
      {"phase": "Hook", "time": "0:00-0:30", "desc": "What happens and why it works", "strength": 80},
      {"phase": "Context", "time": "0:30-1:30", "desc": "...", "strength": 70},
      {"phase": "Problem", "time": "1:30-3:00", "desc": "...", "strength": 75},
      {"phase": "Escalation", "time": "3:00-5:00", "desc": "...", "strength": 82},
      {"phase": "Climax", "time": "5:00-7:00", "desc": "...", "strength": 88},
      {"phase": "Resolution", "time": "7:00-8:30", "desc": "...", "strength": 65},
      {"phase": "CTA", "time": "8:30-end", "desc": "...", "strength": 55}
    ],
    "retention": [
      {"segment": "0-25%", "rate": 80, "note": "Brief reason"},
      {"segment": "25-50%", "rate": 72, "note": "Brief reason"},
      {"segment": "50-75%", "rate": 64, "note": "Brief reason"},
      {"segment": "75-100%", "rate": 52, "note": "Brief reason"}
    ],
    "patternInterrupts": "One paragraph on pattern interrupt techniques used",
    "curiosityLoops": "One paragraph on how open loops maintain viewer attention"
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
    "overallScore": 72,
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
      "Step 1: Specific, actionable instruction to replicate this format",
      "Step 2: ...",
      "Step 3: ...",
      "Step 4: ...",
      "Step 5: ..."
    ],
    "lessons": [
      {"title": "Lesson title 1", "detail": "2 specific sentences applicable to future videos"},
      {"title": "Lesson 2", "detail": "..."},
      {"title": "Lesson 3", "detail": "..."},
      {"title": "Lesson 4", "detail": "..."},
      {"title": "Lesson 5", "detail": "..."}
    ],
    "strengths": "2 sentences summarizing the video's core strengths",
    "improvements": "2 sentences on the key areas to improve next time"
  }
}`;
  const text = await callClaude(system, user, 4000);
  const parsed = safeJSON(text);
  if (parsed) return parsed;
  console.warn('[analyzeVideoDeep] JSON parse failed');
  return null;
}

export async function validateVideo(formData) {
  const key = import.meta.env.VITE_ANTHROPIC_KEY;
  if (!key) throw new Error('No Anthropic API key — add VITE_ANTHROPIC_KEY to your .env file');

  const system = `You are TubeIntel's pre-publish video validation AI. You analyze YouTube videos before they go live and give hyper-specific, data-driven predictions and recommendations. Be brutally honest — not overly positive. Always respond with valid JSON only.`;

  const user = `Validate this YouTube video before publishing and provide a full launch assessment:

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
STRONG HOOK IN FIRST 30s: ${formData.hasHook}
GOOD PACING/EDITING: ${formData.hasPacing}
THUMBNAIL UPLOADED: ${formData.hasThumbnail ? 'Yes' : 'No'}

Respond ONLY with this exact JSON (no markdown, start with {, end with }):
{
  "overallScore": 72,
  "grade": "B",
  "verdict": "Strong Launch",
  "categoryScores": {
    "titleStrength": 7,
    "hookPotential": 8,
    "topicTiming": 6,
    "seoStrength": 5,
    "viralProbability": 4,
    "audienceMatch": 8,
    "competitionLevel": 6
  },
  "titleAnalysis": {
    "rating": "Good",
    "strengths": ["specific strength explaining psychological mechanism", "specific strength 2"],
    "weaknesses": ["specific weakness with CTR impact", "specific weakness 2"],
    "improvedTitles": [
      {"title": "improved title option 1", "reason": "specific reason why better"},
      {"title": "improved title option 2", "reason": "specific reason why better"},
      {"title": "improved title option 3", "reason": "specific reason why better"}
    ]
  },
  "thumbnailAnalysis": {
    "emotionalTrigger": "curiosity",
    "scrollStoppingPower": 70,
    "colorContrast": "Medium",
    "textClarity": "High",
    "improvements": ["very specific visual tip 1", "specific tip 2", "specific tip 3"]
  },
  "topicTiming": {
    "status": "Warm",
    "bestPublishDay": "Thursday",
    "bestPublishTime": "6-8 PM IST",
    "nicheSaturation": "Medium",
    "saturationNote": "2 sentences on the competition landscape right now for this type of content",
    "competitorVideos": [
      {"title": "realistic competitor title 1", "estimatedViews": "500K", "whatWorked": "specific reason it worked"},
      {"title": "realistic competitor title 2", "estimatedViews": "200K", "whatWorked": "specific reason"},
      {"title": "realistic competitor title 3", "estimatedViews": "150K", "whatWorked": "specific reason"}
    ]
  },
  "successPrediction": {
    "viewRange7Days": "2,000–8,000",
    "engagementRateRange": "3–5%",
    "viralProbability": "12%",
    "growthImpact": "positive",
    "growthImpactNote": "2 sentence explanation of how publishing this now affects the channel's growth trajectory"
  },
  "fixBeforePublishing": [
    {"priority": "critical", "issue": "specific issue title", "why": "why this hurts performance", "fix": "exact step-by-step action to take right now"},
    {"priority": "important", "issue": "specific issue", "why": "why it matters", "fix": "exact action"},
    {"priority": "important", "issue": "specific issue", "why": "why it matters", "fix": "exact action"},
    {"priority": "nice", "issue": "specific issue", "why": "why it helps", "fix": "exact action"}
  ],
  "strengths": [
    "Specific strength 1 — the concrete reason this works for the niche",
    "Specific strength 2 — what this does well vs competitors",
    "Specific strength 3 — what the creator should keep doing in future videos"
  ],
  "competitorIntelligence": [
    {"title": "Top performing video in same niche", "estimatedViews": "1.2M", "successReason": "specific reason it worked", "theyDidBetter": "what they did better — be specific"},
    {"title": "Second top video", "estimatedViews": "800K", "successReason": "specific reason", "theyDidBetter": "specific comparison"},
    {"title": "Third top video", "estimatedViews": "400K", "successReason": "specific reason", "theyDidBetter": "specific comparison"}
  ]
}`;

  const res = await fetch(CLAUDE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4000,
      system,
      messages: [{ role: 'user', content: user }],
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || `TubeIntel error ${res.status}`);
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

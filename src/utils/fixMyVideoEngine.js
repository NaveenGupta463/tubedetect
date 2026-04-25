import { validateVideo, generateFixes } from "../api/claude";

function buildFormData(input) {
  const lines = (input.script || '').split('\n').filter(l => l.trim());
  const hook = lines[0] || '';
  const remaining = lines.slice(1).join(' ');
  const half = Math.floor(remaining.length / 2);
  const midVideo = remaining.slice(0, half);
  const ending = remaining.slice(half);
  return {
    title: input.title || '',
    description: '', tags: '',
    category: input.niche || 'Entertainment',
    videoLength: input.videoLength || '5–15 mins',
    language: input.language || 'English',
    channelName: input.channelName || '',
    subscribers: input.subscribers || '',
    avgViews: input.avgViews || '',
    uploadFreq: 'Weekly',
    hook, midVideo, ending,
    primaryEmotion: 'Curiosity',
    contentDescription: `HOOK:\n${hook}\n\nMID:\n${midVideo}\n\nENDING:\n${ending}`,
    hasThumbnail: !!input.thumbnailDescription,
    thumbDescription: input.thumbnailDescription || '',
    thumbInputType: input.thumbnailDescription ? 'text' : 'none',
  };
}

export async function fixMyVideo(input) {
  try {
    // Step 1: Run initial analysis
    const original = await validateVideo(buildFormData(input));

    // Step 2: Extract weaknesses (Fix 5: use hookPotential, not retention)
    const scores = original.categoryScores || {};
    const weaknesses = {
      hook:      (scores.hookPotential  || 0) < 6,
      thumbnail: (scores.thumbnailAppeal || 0) < 6,
      title:     (scores.titleStrength   || 0) < 6,
      retention: (scores.hookPotential  || 0) < 6,
    };

    // Step 3: Generate improvements
    const aiResponse = await generateFixes({
      input,
      weaknesses,
      originalAnalysis: original,
    });

    // Fix 3: Null safety — let outer catch handle the fallback
    if (!aiResponse) {
      throw new Error("generateFixes returned no data");
    }

    // Step 4: Build improved input (Fix 4: safe field access)
    const improvedInput = {
      ...input,
      title:                aiResponse.improvedTitles?.[0]  || input.title,
      script:               (aiResponse.improvedHook || "") + "\n" + (aiResponse.improvedScriptIntro || ""),
      thumbnailDescription: aiResponse.thumbnailIdeas?.[0]  || input.thumbnailDescription,
    };

    // Step 5: Re-validate improved version
    const improved = await validateVideo(buildFormData(improvedInput));

    // Step 6: Return structured result
    return {
      original,
      improved,
      improvements: aiResponse,
      delta: {
        viralScore: (improved.viralScore || 0) - (original.viralScore || 0),
      },
    };
  } catch (error) {
    console.error("Fix My Video Engine Error:", error);
    return {
      error: true,
      message: "Fix failed",
    };
  }
}

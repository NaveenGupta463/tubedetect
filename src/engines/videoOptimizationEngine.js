import { validateVideo, generateFixes, analyzeVideoDeep } from '../api/claude.js';
import { runPipeline }                                    from '../core/runPipeline.js';
import { normalizeScores, detectWeaknesses, computeDelta } from '../scoring/computeScores.js';
import { buildEnvelope }                                   from '../contract/buildEnvelope.js';

// ─── PUBLIC API ──────────────────────────────────────────────────────────────

/**
 * runVideoOptimization
 *
 * Single entry point for both pre-publish and post-publish optimization.
 *
 * @param {Object}  params
 * @param {'pre-publish'|'post-publish'} params.mode
 * @param {Object}  params.input
 *   pre-publish:  { title, script, thumbnailDescription?, niche?, videoLength?,
 *                   language?, channelName?, subscribers?, avgViews? }
 *   post-publish: { videoData: { title, views, likes, ... }, commentsText }
 * @param {number}  [params.iterations=1]
 *   pre-publish:  validate → fix → re-validate loops
 *   post-publish: independent improvement runs; recommend ≥ 3 for variations
 * @param {Object}  [params.existingAnalysis=null]
 *   post-publish only — cached analyzeVideoDeep result; skips the AI call
 *
 * @returns {Promise<ResultEnvelope | ErrorEnvelope>}
 */
export async function runVideoOptimization({
  mode,
  input,
  iterations = 1,
  existingAnalysis = null,
}) {
  if (iterations < 1) {
    console.warn(
      `[videoOptimizationEngine] iterations=${iterations} is less than 1 — clamping to 1.`
    );
  }
  const count = Math.max(1, iterations);

  if (mode === 'pre-publish')  return runDraftOptimization(input, count);
  if (mode === 'post-publish') return runPostPublish(input, count, existingAnalysis);

  throw new Error(
    `[videoOptimizationEngine] Unknown mode: "${mode}". Use "pre-publish" or "post-publish".`
  );
}


// ─── PRE-PUBLISH FLOW ─────────────────────────────────────────────────────────

async function runDraftOptimization(input, iterations) {
  // Step 1: baseline — score and weaknesses captured once, never overwritten
  const baselineFormData   = buildFormData(input);
  const baselineValidation = await validateVideo(baselineFormData);
  const baselineScore      = baselineValidation.viralScore ?? 0;
  const baselineWeaknesses = detectWeaknesses(normalizeScores(baselineValidation, 'pre-publish'));

  let currentInput      = { ...input };
  let currentValidation = baselineValidation;
  let finalImprovements = null;

  // Step 2: iterate — each pass uses the latest validation as context for generateFixes
  for (let i = 0; i < iterations; i++) {
    const currentWeaknesses = detectWeaknesses(normalizeScores(currentValidation, 'pre-publish'));

    const improvements = await generateFixes({
      input:            currentInput,
      weaknesses:       currentWeaknesses,
      originalAnalysis: currentValidation,
    });

    if (!improvements) break;

    finalImprovements = improvements;
    currentInput      = applyImprovementsToInput(currentInput, improvements);
    currentValidation = await validateVideo(buildFormData(currentInput));
  }

  // No improvements at all — generateFixes failed on first attempt
  if (!finalImprovements) {
    return {
      success:       true,
      mode:          'pre-publish',
      original:      baselineValidation,
      originalScore: baselineScore,
      weaknesses:    { original: baselineWeaknesses, improved: null },
      improvements:  null,
      meta:          { reason: 'no_improvements' },
    };
  }

  // Step 3: compute final-state weaknesses from the last validated result
  const finalWeaknesses = detectWeaknesses(normalizeScores(currentValidation, 'pre-publish'));
  const finalScore      = currentValidation.viralScore ?? 0;

  return buildEnvelope({
    mode:          'pre-publish',
    original:      baselineValidation,
    improved:      currentValidation,
    improvements:  finalImprovements,
    weaknesses:    { original: baselineWeaknesses, improved: finalWeaknesses },
    originalScore: baselineScore,
    improvedScore: finalScore,
    delta:         computeDelta(baselineScore, finalScore, 'pre-publish'),
    variations:    [],
  });
}


// ─── POST-PUBLISH FLOW ────────────────────────────────────────────────────────

async function runPostPublish(input, iterations, existingAnalysis) {
  // Compute baseline data, then delegate entirely to runPipeline
  const analysis           = existingAnalysis ?? await analyzeVideoDeep(input.videoData, input.commentsText);
  const originalScore      = analysis.blueprint?.viralScore ?? 0;
  const originalWeaknesses = detectWeaknesses(normalizeScores(analysis, 'post-publish'));

  return runPipeline({ videoData: input.videoData, analysis, originalScore, originalWeaknesses, iterations });
}


// ─── DOMAIN HELPERS ───────────────────────────────────────────────────────────

/**
 * Converts engine input into the formData shape validateVideo() expects.
 * Inlined from validatorEngine.js — no dependency on that file.
 */
function buildFormData(input) {
  const { hook, midVideo, ending } = extractContentParts(input.script);
  return {
    title:              input.title || '',
    description:        '',
    tags:               '',
    category:           input.niche || 'Entertainment',
    videoLength:        input.videoLength || '5–15 mins',
    language:           input.language || 'English',
    channelName:        input.channelName || '',
    subscribers:        input.subscribers || '',
    avgViews:           input.avgViews || '',
    uploadFreq:         'Weekly',
    hook,
    midVideo,
    ending,
    primaryEmotion:     'Curiosity',
    contentDescription: `HOOK:\n${hook}\n\nMID:\n${midVideo}\n\nENDING:\n${ending}`,
    hasThumbnail:       !!input.thumbnailDescription,
    thumbDescription:   input.thumbnailDescription || '',
    thumbInputType:     input.thumbnailDescription ? 'text' : 'none',
  };
}

/**
 * Splits a script string into hook / mid / ending sections.
 * Inlined from validatorEngine.js.
 */
function extractContentParts(script = '') {
  if (!script || script.length < 50) {
    return { hook: script || '', midVideo: '', ending: '' };
  }
  const lines     = script.split('\n').filter(l => l.trim());
  const hook      = lines[0] || '';
  const remaining = lines.slice(1).join(' ');
  const half      = Math.floor(remaining.length / 2);
  return {
    hook,
    midVideo: remaining.slice(0, half),
    ending:   remaining.slice(half),
  };
}

/**
 * Patches input with the best improvements from generateFixes().
 * Used only inside the pre-publish iteration loop.
 */
function applyImprovementsToInput(input, improvements) {
  return {
    ...input,
    title:                improvements.improvedTitles?.[0]  || input.title,
    thumbnailDescription: improvements.thumbnailIdeas?.[0]  || input.thumbnailDescription,
    script: [improvements.improvedHook, improvements.improvedScriptIntro]
      .filter(Boolean)
      .join('\n') || input.script,
  };
}


// ─── TEST FUNCTION ────────────────────────────────────────────────────────────

/**
 * testVideoOptimization({ mock })
 *
 * mock = true  (default) — returns hardcoded results, zero API calls
 * mock = false           — runs real Claude API calls (costs quota)
 *
 * Recommended: pre-publish iterations=1, post-publish iterations=3
 */
export async function testVideoOptimization({ mock = true } = {}) {
  if (mock) {
    console.log('[test] mock=true — no API calls');

    const preResult = {
      success: true,
      mode:    'pre-publish',
      original: {
        viralScore: 58, grade: 'C+',
        categoryScores:    { hookPotential: 5, titleStrength: 6 },
        thumbnailAnalysis: { scrollStoppingPower: 52 },
      },
      improved: {
        viralScore: 71, grade: 'B',
        categoryScores:    { hookPotential: 7, titleStrength: 8 },
        thumbnailAnalysis: { scrollStoppingPower: 68 },
      },
      improvements: {
        improvedHook:        'Here is the exact moment my channel almost died — and I almost missed it.',
        improvedTitles:      ['The Video That Nearly Ended My Channel', "I Almost Quit YouTube (Here's Why I Didn't)", 'What Happens When Your Best Video Flops'],
        thumbnailIdeas:      ["Close-up shocked face, red background, text: IT'S GONE"],
        improvedScriptIntro: 'Three months ago I uploaded what I thought was my best video. It got 200 views.',
      },
      weaknesses: {
        original: { hook: true,  title: false, thumbnail: true,  retention: true  },
        improved: { hook: false, title: false, thumbnail: false, retention: false },
      },
      originalScore: 58,
      improvedScore: 71,
      delta:      { value: 13, type: 'real', confidence: 'high' },
      variations: [],
    };

    const postResult = {
      success: true,
      mode:    'post-publish',
      original: {
        blueprint: {
          viralScore: 65, grade: 'B-',
          scores: { hookRetention: 62, titleThumbnail: 70 },
        },
      },
      improved: null,
      improvements: {
        titles: [
          { text: 'I Tried 5am for 30 Days — Week 3 Changed Everything', angle: 'curiosity', projectedOverall: 76, projectedDimensions: { titleThumbnail: 78 } },
          { text: 'The 5am Experiment: What I Actually Lost (Not Just Sleep)',  angle: 'emotion',   projectedOverall: 74, projectedDimensions: { titleThumbnail: 75 } },
          { text: 'Honest 5am Challenge Results After 30 Days',                 angle: 'clarity',   projectedOverall: 71, projectedDimensions: { titleThumbnail: 72 } },
        ],
        hook: {
          text:                  'By day 12 I genuinely considered quitting — not the challenge, YouTube.',
          projectedHookStrength: 74,
          projectedDimensions:   { hookRetention: 72 },
          projectedOverall:      73,
        },
        thumbnails: [
          { projectedDimensions: { titleThumbnail: 75 }, projectedOverall: 74 },
        ],
      },
      weaknesses: {
        original: { hook: true,  title: false, thumbnail: false, retention: true  },
        improved: { hook: false, title: false, thumbnail: false, retention: false },
      },
      originalScore: 65,
      improvedScore: 74.9,
      delta:      { value: 9.9, type: 'projected', confidence: 'medium' },
      variations: [
        {
          projectedScore: 72.8,
          improvements: {
            titles: [
              { text: '30 Days of 5am: The Part Nobody Talks About',  angle: 'curiosity', projectedOverall: 74, projectedDimensions: { titleThumbnail: 75 } },
              { text: "Why I'll Never Do a 5am Challenge Again",       angle: 'emotion',   projectedOverall: 72, projectedDimensions: { titleThumbnail: 73 } },
              { text: '5am for 30 Days — My Honest Results',          angle: 'clarity',   projectedOverall: 70, projectedDimensions: { titleThumbnail: 71 } },
            ],
            hook: {
              text:                  'I was convinced this challenge would change my life. I was half right.',
              projectedHookStrength: 70,
              projectedDimensions:   { hookRetention: 68 },
              projectedOverall:      71,
            },
          },
        },
      ],
    };

    console.log('[test] pre-publish result:', preResult);
    console.log('[test] post-publish result:', postResult);
    return { prePublish: preResult, postPublish: postResult };
  }

  // ── Real API calls ──────────────────────────────────────────────────────────
  console.log('[test] mock=false — hitting real Claude API');

  const preInput = {
    title:                "I Tried Waking Up at 5am for 30 Days — Here's What Actually Happened",
    script:               "I honestly didn't think I'd make it past day 3. The first morning I set my alarm for 5am, I just laid there wondering why I was doing this to myself. But then something shifted around day 10.\n\nI started noticing I had two hours before the rest of the world woke up. No notifications, no demands. Just silence and whatever I chose to fill it with.",
    thumbnailDescription: 'Close-up face looking exhausted but determined, alarm clock showing 5:00, text overlay: CHANGED ME',
    niche:                'Self Improvement',
    videoLength:          '8–12 mins',
    language:             'English',
    channelName:          'TestChannel',
    subscribers:          '10000',
    avgViews:             '2000',
  };

  const postInput = {
    videoData: {
      title:          'I Tried Waking Up at 5am for 30 Days',
      views:          '45000',
      likes:          '2100',
      comments:       '340',
      engagementRate: '5.4',
      likeRate:       '4.7',
      commentRate:    '0.7',
      duration:       '10:24',
      publishedAt:    '2024-11-01',
      vsChannelAvg:   '+180',
      tags:           'morning routine, 5am, productivity, self improvement',
    },
    commentsText: "This hit different. I did 30 days myself and felt the same thing around day 10.\nI've been wanting to try this for so long. What time did you actually go to sleep though?\nThe part about silence really got me. That's exactly what I needed to hear.",
  };

  console.log('[test] Running pre-publish (1 iteration)...');
  const preResult  = await runVideoOptimization({ mode: 'pre-publish',  input: preInput,  iterations: 1 });
  console.log('[test] Pre-publish result:', preResult);

  console.log('[test] Running post-publish (3 iterations)...');
  const postResult = await runVideoOptimization({ mode: 'post-publish', input: postInput, iterations: 3 });
  console.log('[test] Post-publish result:', postResult);

  return { prePublish: preResult, postPublish: postResult };
}

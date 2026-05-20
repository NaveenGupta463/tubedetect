const express   = require('express');
const Anthropic  = require('@anthropic-ai/sdk');
const router     = express.Router();
const { getDb }  = require('../db/init');
const { dispatch, detectCreatorFormat } = require('../services/copilotTools');
const { classify }                      = require('../services/intentClassifier');
const { compilePolicy, mergeConfigs, buildPromptSection, extractPlaceholders } = require('../services/policyCompiler');
const { route, isBriefComplete }        = require('../services/stateRouter');
const { runScan }                       = require('../services/scanRules');
const { parseBrief, buildFollowUp }     = require('../services/briefParser');
const { search }                        = require('../services/webSearch');
const { canAfford, deduct, classifyAction, estimateMaxCost } = require('../services/creditService');
const crypto = require('crypto');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── Tool schemas Claude can call ──────────────────────────────────────────────
const TOOLS = [
  {
    name: 'findChannels',
    description: 'Search ingested channels by name, niche, region, or subscriber size. Use when the user asks "find channels like X", "who are the biggest X creators", "list channels in Y niche".',
    input_schema: {
      type: 'object',
      properties: {
        query:    { type: 'string',  description: 'Channel name keyword to search for' },
        niche:    { type: 'string',  description: 'Niche/category filter (e.g. "selfimprovement", "fitness")' },
        region:   { type: 'string',  description: 'Region code filter (e.g. "IN", "US")' },
        min_subs: { type: 'number',  description: 'Minimum subscriber count' },
        max_subs: { type: 'number',  description: 'Maximum subscriber count' },
        limit:    { type: 'integer', description: 'Max results (default 12)' },
      },
    },
  },
  {
    name: 'findPeers',
    description: 'Find true community peers for a channel — creators making similar content for the same audience. Use when the user asks "who are my peers", "who competes with me", "similar channels".',
    input_schema: {
      type: 'object',
      properties: {
        channel_id: { type: 'string',  description: 'Channel ID to find peers for (auto-filled from context)' },
        limit:      { type: 'integer', description: 'Max peers to return (default 15)' },
      },
    },
  },
  {
    name: 'findTopics',
    description: 'Discover what topics and themes are being covered across the creator\'s peer community, plus top-performing videos. Use when the user asks "what should I make videos about", "what topics are trending", "what is my community covering".',
    input_schema: {
      type: 'object',
      properties: {
        channel_id: { type: 'string', description: 'Channel ID to analyse (auto-filled from context)' },
        filter:     { type: 'string', description: 'Optional keyword to filter topics' },
      },
    },
  },
  {
    name: 'compareChannels',
    description: 'Side-by-side comparison of two channels: subscribers, views, upload cadence, topics, archetype. Use when the user asks "compare me with X", "how do I stack up against Y", "difference between A and B".',
    input_schema: {
      type: 'object',
      properties: {
        channel_id_a: { type: 'string', description: 'First channel ID (auto-filled from context if not specified)' },
        channel_id_b: { type: 'string', description: 'Second channel ID' },
      },
      required: ['channel_id_b'],
    },
  },
  {
    name: 'findOpportunity',
    description: 'Find the best content opportunities right now: trending topics in peer community that this creator has NOT covered. Use when the user asks "what should I post", "what am I missing", "what content gap should I fill", "best opportunity for me".',
    input_schema: {
      type: 'object',
      properties: {
        channel_id: { type: 'string', description: 'Channel ID (auto-filled from context)' },
      },
    },
  },
  {
    name: 'trackNiche',
    description: 'Enable tracking/alerts for a niche or topic so the user is notified when trends shift. Use when the user says "track this", "alert me about X", "monitor this niche".',
    input_schema: {
      type: 'object',
      properties: {
        niche:      { type: 'string', description: 'Niche or topic to track' },
        channel_id: { type: 'string', description: 'Channel ID (auto-filled from context)' },
      },
    },
  },
  {
    name: 'draftOutline',
    description: 'Draft a structured video outline for a specific topic. Use when the user says "draft this", "outline this", "help me structure this video", "what should this video look like", "dive deeper", or after they save an idea and want to execute it.',
    input_schema: {
      type: 'object',
      properties: {
        topic:      { type: 'string', description: 'The video topic to outline (e.g. "Indian Army hero story", "Special Forces Training")' },
        channel_id: { type: 'string', description: 'Channel ID (auto-filled from context)' },
      },
      required: ['topic'],
    },
  },
  {
    name: 'writeBody',
    description: 'Write the detailed body script for each section of the video. Use after write_hook when the user says "write the body", "write the full script", "continue writing", "next section", or "write the rest".',
    input_schema: {
      type: 'object',
      properties: {
        topic:      { type: 'string',  description: 'The video topic' },
        channel_id: { type: 'string',  description: 'Channel ID (auto-filled from context)' },
        sections:   { type: 'array', items: { type: 'string' }, description: 'Section titles from the outline, in order' },
      },
      required: ['topic'],
    },
  },
  {
    name: 'writeEnding',
    description: 'Write the video conclusion and CTA script. Use after write_body when the user says "write the ending", "write the CTA", "finish the script", "how do I close this video".',
    input_schema: {
      type: 'object',
      properties: {
        topic:      { type: 'string', description: 'The video topic' },
        channel_id: { type: 'string', description: 'Channel ID (auto-filled from context)' },
      },
      required: ['topic'],
    },
  },
];

// ── Language instruction builder ─────────────────────────────────────────────
function buildLanguageInstruction(lang) {
  if (lang === 'hi') {
    return `
LANGUAGE — HINGLISH MODE:
This creator makes Hindi content. Follow these rules for ALL drafts, hooks, outlines, and scripts:
- Titles: Always write in English (Hindi creators use English titles for YouTube SEO and discoverability).
- Script body / hooks / outlines: Write in Romanized Hinglish — Hindi spoken and written in English letters, mixed naturally with English words. This is how Indian creators actually write scripts.
  ✓ Good: "Yaar, imagine karo — 17 goli lagi hai body mein, phir bhi woh crawl karta raha enemy post ki taraf. Yahi kiya tha Captain Yogendra Yadav ne."
  ✗ Bad: "आज हम बात करेंगे..." (never use Devanagari)
  ✗ Bad: "Today we will discuss..." (too formal, not Hinglish)
- Technical terms, weapon names, military ranks, and proper nouns: Keep in English.
- Tone: Conversational, energetic, warm — respectful but not stiff. Think mentor speaking to audience, not peer-to-peer banter.
- Your own answers in the chat: You can stay in English for clarity, but all creative content (outlines, hooks, titles, CTAs) must follow the above rules.

BANNED WORDS — NEVER use these (they are crude/disrespectful informal forms):
  ✗ tu → use "aap" instead
  ✗ tujhe → use "aapko" instead
  ✗ tera / tere / teri → use "aapka / aapke / aapki" instead
  ✗ tune → use "aapne" instead
  ✗ tum → use "aap" instead
  ✗ tumhara / tumhare / tumhari → use "aapka / aapke / aapki" instead
  ✗ tumhe / tumko → use "aapko" instead
Always address the audience with "aap" forms — respectful Hinglish, not street slang.`;
  }
  return ''; // English — no special instruction needed
}

// ── System prompt builder ─────────────────────────────────────────────────────
function buildSystemPrompt(channel, lang, creatorFormat, voiceProfile, compiledPolicy, isOverride, brief, webContext) {
  const formatLabel = creatorFormat === 'short' ? 'YouTube Shorts creator'
    : creatorFormat === 'mixed' ? 'creator who makes both Shorts and long-form videos'
    : 'long-form creator';

  const channelCtx = channel
    ? `You are assisting ${channel.channel_name} — a ${channel.primary_niche || channel.niche || 'content'} ${formatLabel}` +
      (channel.channel_subscribers ? ` with ${formatSubs(channel.channel_subscribers)} subscribers` : '') +
      (channel.region ? ` (region: ${channel.region})` : '') +
      '.'
    : 'You are assisting a YouTube creator.';

  const formatCtx = creatorFormat === 'short'
    ? 'FORMAT NOTE: This creator makes Shorts. All topic suggestions, gap analysis, and outlines should be tailored to short-form vertical video (≤60s). When tool results include "creator_format", use it to confirm.'
    : creatorFormat === 'mixed'
    ? 'FORMAT NOTE: This creator makes both Shorts and long-form content. When suggesting topics, distinguish which format fits best.'
    : 'FORMAT NOTE: This creator makes long-form videos. Shorts data is excluded from their trend and gap analysis automatically.';

  const idLine = channel
    ? `The creator's channel_id is "${channel.channel_id}". All single-channel tools (findPeers, findTopics, findOpportunity, trackNiche) will use this automatically — do NOT pass a different channel_id value.`
    : '';

  const langInstruction = buildLanguageInstruction(lang);

  let voiceSection = '';
  if (voiceProfile?.voice_analysis) {
    try {
      const vp = typeof voiceProfile.voice_analysis === 'string'
        ? JSON.parse(voiceProfile.voice_analysis)
        : voiceProfile.voice_analysis;
      voiceSection = `

CREATOR VOICE PROFILE — apply to ALL generated hooks, outlines, body scripts, and CTAs:
• Tone: ${vp.tone || '—'}
• Vocabulary: ${vp.vocabulary_level || '—'}
• Sentence style: ${vp.sentence_style || '—'}
• Language mix: ${vp.language_mix || '—'}
• Opening pattern: ${vp.opening_pattern || '—'}
• Closing pattern: ${vp.closing_pattern || '—'}
• Common phrases: ${Array.isArray(vp.common_phrases) ? vp.common_phrases.join(', ') : (vp.common_phrases || 'none')}
• Formality: ${vp.formality || '—'}
• Energy level: ${vp.energy_level || '—'}
Do NOT fall back to generic script templates — mirror this creator's actual voice exactly.`;
    } catch (_) {}
  }

  const policySection = compiledPolicy ? buildPromptSection(compiledPolicy) : '';

  let briefSection = '';
  if (brief) {
    const parsedBrief = typeof brief === 'string' ? (() => { try { return JSON.parse(brief); } catch { return {}; } })() : brief;
    const briefLines  = Object.entries(parsedBrief)
      .filter(([, v]) => v !== null && v !== undefined && String(v).trim())
      .map(([k, v]) => `- ${k.replace(/_/g, ' ')}: ${v}`)
      .join('\n');
    if (briefLines) {
      briefSection = `\nCREATOR BRIEF — use this real information about the video:\n${briefLines}\nOnly use the above details. Do NOT invent any personal experiences beyond what is stated here.`;
    }
  }

  let webContextSection = '';
  if (webContext?.answer) {
    const sourceLines = webContext.sources.slice(0, 4).map(s => `  - ${s.url}`).join('\n');
    webContextSection = `\nVERIFIED CURRENT DATA — fetched live from the web for this request:\n${webContext.answer}\n${sourceLines ? `Sources:\n${sourceLines}` : ''}\nUse the above data to ground statistics, figures, and facts in your response. For any specific claim NOT covered by the data above, still mark it with [VERIFY: describe what to check].`;
  }

  const overrideSection = isOverride ? `
OVERRIDE MODE ACTIVE — the creator has explicitly requested generation despite policy restrictions.
- Generate the content as requested.
- Every piece of invented personal content, fabricated example, or unverified claim MUST be wrapped in [OVERRIDE: describe what was invented here].
- This output is permanently in DRAFT state. The creator must review and replace all [OVERRIDE: ...] sections before publishing.
- Do NOT skip the [OVERRIDE: ...] markers — they are how the creator knows what to fix.` : '';

  return `You are TubeIntel Copilot — an intelligent research assistant for YouTube creators. You have access to a database of ingested YouTube channels and their video performance data.

${channelCtx} ${idLine}
${formatCtx}
${langInstruction}
${voiceSection}
${policySection}
${webContextSection}
${briefSection}
${overrideSection}

Your job is to answer the creator's questions using the tools available. Always:
1. Call the most relevant tool(s) to gather real data before answering.
2. Call AT MOST 2 tools per question — do not chain more than 2 tool calls.
3. Once you have data from any tool, immediately synthesise and respond. Even if data is limited or peers are few, give the best answer you can.
4. Speak directly to the creator ("your peers", "you could post about...").
5. Be concise. One punchy insight is worth more than five bullet points.
6. NEVER ask the user for their Channel ID — you already have it.

SCRIPT INTEGRITY — these rules are absolute and override everything else when writing outlines, hooks, body scripts, or CTAs:
- You do NOT know what the creator has experienced, seen, visited, eaten, or felt. NEVER invent it.
- NEVER write fictional personal stories, fake memories, fabricated conversations, or made-up anecdotes as if they happened to the creator.
- NEVER put specific words in the creator's mouth as if they said them ("Main India se nikla tha...", "Ek dadi milein mujhe..."). You don't know their real experiences.
- For every section that requires personal content, write a clear placeholder in square brackets instead:
    [YOUR STORY: describe the moment that hit you hardest here]
    [YOUR EXPERIENCE: what did you see / taste / feel at this point?]
    [ADD YOUR ANECDOTE: a real conversation or encounter from this trip]

HOOK RULES — the hook must be a PARTIALLY SCRIPTED opening, not just directional notes:
- Write the contextual framing, tension setup, and central question — you can write these without knowing the creator's experiences.
- Mark ONLY the personal beat as a placeholder. The creator speaks the rest verbatim.
- Example (Hinglish): "Aapne kabhi socha hai — ek insaan ke paas kuch nahi tha, tab bhi woh [YOUR STORY: the single moment that changed your financial thinking]. Main aaj aapko woh exact mindset shift share karna chahta hoon jisne meri life badal di."
- Example (English): "What if I told you the one habit that changed everything wasn't about grinding harder — it was about [YOUR STORY: the specific shift you made]? That's exactly what we're unpacking today."
- NEVER write a hook as just "Open with your most powerful personal moment" — that is direction only, not a script.

BODY SCRIPT RULES:
- Every section must end with a transition sentence to the next one. These are structural, not personal — write them fully. E.g. "Toh ab sawaal yeh hai..." / "But that's only the first piece..." / "Ab dekhte hain ki..."
- For long-form videos (more than 4 sections), add a pattern interrupt every 2-3 sections: a rhetorical question, a quick stat frame, or a reset phrase ("Lekin yahan ek twist hai..." / "Here's what nobody tells you..."). Write these fully — they don't require personal knowledge.
- Use placeholder markers only for personal beats. Everything structural should be written.

ENDING RULES:
- The ending MUST include a callback to the hook. Reference the [YOUR STORY] placeholder from the opening before delivering the CTA — this closes the narrative loop. Write the callback frame fully (e.g. "Remember that [YOUR STORY: moment from your hook]? That moment was telling you something...").
- After the callback, deliver the CTA. The CTA structure (subscribe, comment prompt, next video) can be fully written.
- Outlines must describe WHAT to cover per section and WHY it works emotionally/structurally for the audience.
- This applies even if the creator asks you to "just write it" — you cannot write real experiences you do not have.

When you have gathered enough data, respond ONLY with a JSON object in this exact format:
{
  "answer": "Your natural language response here — 2-4 sentences max. Direct, actionable.",
  "cards": [],
  "actions": [],
  "evidence": [],
  "placeholders": []
}

PLACEHOLDER OBJECTS — MANDATORY for every script or outline that contains [YOUR STORY], [YOUR EXPERIENCE], or [EXAMPLE NEEDED] markers:
All four fields are REQUIRED — never omit "example":
- "id": "p1", "p2", ... (sequential)
- "type": "story" | "experience" | "example"
- "description": copy the exact text from inside the square brackets — character for character
- "example": REQUIRED. Write 2-3 sentences showing what this placeholder could sound like if filled in. Write in the SAME LANGUAGE as the script. Make it plausible and specific to the topic. End with "Replace this with your actual story."

Example of correct output:
"placeholders": [
  {
    "id": "p1",
    "type": "story",
    "description": "one moment when you felt the weight of adjusting silently",
    "example": "Mujhe yaad hai ek dost ne apni shaadi ke teen mahine baad kaha — 'Ghar to mila, par apna aap kho diya.' Woh ek line thi jo maine kabhi nahi soochi thi, lekin jo seedha dil ko lagi. Replace this with your actual story."
  }
]
NEVER leave placeholders as [] when a script or outline card contains any [YOUR STORY] or [YOUR EXPERIENCE] marker. Every marker needs a matching object with a filled example.

Evidence objects — include ONLY when the answer or a script/outline contains specific verifiable claims:
- { "claim": "exact text of the claim", "status": "PLACEHOLDER", "source": null, "confidence": null }
  → Use for placeholder markers like [VERIFY: ...] — the creator needs to fill this in.
- { "claim": "exact text of the claim", "status": "UNVERIFIED", "source": null, "confidence": 0.0–1.0 }
  → Use for specific figures, dates, or stats you stated from your own knowledge but cannot confirm are accurate.
  → Data returned from tool calls (peer counts, avg views, subscriber counts) is sourced from our database — do NOT mark tool data as UNVERIFIED.
Only include evidence for factual claims in scripts, outlines, or research answers — not for conversational turns.
Leave evidence as [] for topic/channel/opportunity queries.

Card types you can include:
- { "type": "topic", "data": { "topic": "...", "peer_count": N, "avg_views": "...", "already_covered": bool } }
- { "type": "channel", "data": { "channel_id": "...", "channel_name": "...", "subs": "...", "niche": "..." } }
- { "type": "opportunity", "data": { "topic": "...", "peer_count": N, "avg_views": "...", "gap": "..." } }
- { "type": "comparison", "data": { "channel_a": {...}, "channel_b": {...} } }
- { "type": "video", "data": { "title": "...", "views": "...", "channel_name": "...", "date": "..." } }
- { "type": "outline", "data": { "topic": "...", "format": "short-form|long-form", "hook": "...", "sections": [{ "title": "...", "brief": "...", "why": "one sentence on why this section works for the audience" }], "titles": ["...", "...", "..."], "cta": "..." } }
- { "type": "script", "data": { "topic": "...", "part": "body|ending", "sections": [{ "title": "...", "script": "..." }], "cta": "..." } }

Action types you can include (1-3 max):
- { "type": "track_niche",       "label": "Track this topic",           "payload": { "niche": "..." } }
- { "type": "compare_channel",   "label": "Compare with ...",            "payload": { "channel_id": "..." } }
- { "type": "save_idea",         "label": "Save this idea",              "payload": { "topic": "..." } }
- { "type": "draft_outline",     "label": "Draft video outline",         "payload": { "topic": "..." } }
- { "type": "write_hook",        "label": "Write the opening script",    "payload": { "topic": "..." } }
- { "type": "write_body",        "label": "Write the full body script",  "payload": { "topic": "..." } }
- { "type": "write_ending",      "label": "Write the ending & CTA",      "payload": { "topic": "..." } }
- { "type": "new_draft",         "label": "Generate another draft",      "payload": { "topic": "..." } }
- { "type": "regenerate_ideas",  "label": "Show different ideas",        "payload": {} }

Action progression rules — follow these strictly:
1. After showing opportunity cards → each card has its own Draft/Save buttons (handled by UI). At message level offer track_niche for the top opportunity + regenerate_ideas. Always include regenerate_ideas when opportunity cards are shown.
2. First time seeing a specific topic → offer save_idea + draft_outline.
3. After idea is saved → replace save_idea with draft_outline. Never offer save_idea again for the same topic.
4. After an outline card is shown → offer write_hook + new_draft + track_niche. NEVER offer draft_outline or save_idea again for that topic.
5. After write_hook → offer write_body + new_draft + track_niche. NEVER offer write_hook, draft_outline, or save_idea again for that topic.
6. After write_body (body script shown) → offer write_ending + new_draft + track_niche. NEVER offer write_body, write_hook, draft_outline, or save_idea again.
7. After write_ending (ending shown) → offer new_draft + track_niche only. The full script is complete.
8. Never repeat an action type for the same topic in consecutive turns.

Only include cards and actions that add real value. Empty arrays are fine.`;
}

function formatSubs(n) {
  if (!n) return 'unknown';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

const BRIEF_FIELD_LABELS = {
  topic:              'What is the video topic?',
  angle:              'What angle or perspective are you taking?',
  audience_level:     'Who is your audience? (beginners / experienced / general)',
  destination:        'What destination does this video cover?',
  trip_duration:      'How long was the trip?',
  best_moments:       'What were your 3 best moments from the footage?',
  challenge_or_surprise: 'What was the biggest challenge or surprise?',
  mood_vibe:          'What is the mood/vibe of the video?',
  duration:           'How long is the video?',
  travel_style:       'What is the travel style? (budget / luxury / adventure / etc.)',
  audience_type:      'Who is this for? (solo travellers / families / backpackers / etc.)',
  target_audience:    'Who is your target audience?',
  depth_level:        'How deep does this go? (introductory / intermediate / expert)',
  time_period:        'What time period does this cover?',
  narrative_angle:    'What narrative angle are you taking?',
  premise:            'What is the core premise or concept?',
  tone:               'What tone are you going for?',
};

function buildBriefPrompt(compiledPolicy, classifyResult) {
  const fields     = compiledPolicy.briefFields;
  const fieldList  = fields.map((f, i) => `${i + 1}. ${BRIEF_FIELD_LABELS[f] || f}`).join('\n');
  const nicheLabel = classifyResult.niche.replace(/_/g, ' ');
  return `Before I can write your ${nicheLabel} script, I need a few details about your video.\n\nPlease share:\n${fieldList}`;
}

// ── POST /api/copilot/chat ────────────────────────────────────────────────────
router.post('/chat', async (req, res) => {
  try {
    const db = getDb();
    const { message, channel_id, history = [], lang: clientLang, format: clientFormat, client_id } = req.body;

    if (!message) return res.status(400).json({ error: 'message required' });
    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(503).json({ error: 'ANTHROPIC_API_KEY not configured' });
    }

    // Load channel context if provided
    let channel = null;
    let voiceProfile = null;
    if (channel_id) {
      channel = db.get('SELECT * FROM ingested_channels WHERE channel_id = ?', [channel_id]);
      voiceProfile = db.get(
        'SELECT * FROM creator_voice WHERE channel_id = ? AND voice_analysis IS NOT NULL',
        [channel_id],
      );
    }

    // Lang: client override → DB primary_language → default English
    const lang          = clientLang || channel?.primary_language || 'en';
    const creatorFormat = clientFormat || 'long';

    // ── Niche intelligence: classify → compile policy → route ─────────────────
    const { thread_id: clientThreadId } = req.body;
    const threadId = clientThreadId || crypto.randomUUID();

    let thread = null;
    if (clientThreadId) {
      thread = db.get('SELECT * FROM workspace_threads WHERE thread_id = ?', [clientThreadId]);
    }

    const channelNiche = channel?.primary_niche || channel?.niche || null;
    const classifyResult = await classify(message, channelNiche);
    console.log(`[copilot] classified niche=${classifyResult.niche} mode=${classifyResult.mode} conf=${classifyResult.confidence.toFixed(2)}`);

    const compiledPolicy = mergeConfigs(
      classifyResult.niche,
      classifyResult.secondary_niche,
      classifyResult.confidence,
    );
    const routeResult = route(thread, classifyResult, compiledPolicy);

    // Persist/update thread state
    db.run(
      `INSERT INTO workspace_threads (thread_id, channel_id, topic, state, niche, secondary_niche, mode, brief, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(thread_id) DO UPDATE SET
         state           = excluded.state,
         niche           = excluded.niche,
         secondary_niche = excluded.secondary_niche,
         mode            = excluded.mode,
         updated_at      = datetime('now')`,
      [
        threadId,
        channel_id || '',
        thread?.topic || null,
        routeResult.nextState,
        classifyResult.niche,
        classifyResult.secondary_niche,
        classifyResult.mode,
        thread?.brief || null,
      ],
    );

    // ── Conversational brief flow ─────────────────────────────────────────────
    if (routeResult.action === 'collect_brief') {
      // Is the creator responding to a previous brief question?
      const prevBriefAsked = thread?.state === 'NEEDS_BRIEF';

      if (prevBriefAsked && message.length > 15) {
        // Parse the creator's natural language response to extract brief fields
        const parseResult = await parseBrief(message, compiledPolicy.briefFields);
        const mergedBrief = Object.assign({}, thread.brief ? JSON.parse(thread.brief) : {}, parseResult.extracted);

        // Save extracted fields
        db.run(
          `UPDATE workspace_threads SET brief = ?, updated_at = datetime('now') WHERE thread_id = ?`,
          [JSON.stringify(mergedBrief), threadId],
        );

        if (parseResult.complete) {
          // Brief complete — fall through to generation with brief injected
          thread = { ...thread, brief: JSON.stringify(mergedBrief), state: 'BRIEF_COMPLETE' };
          db.run(
            `UPDATE workspace_threads SET state = 'BRIEF_COMPLETE', updated_at = datetime('now') WHERE thread_id = ?`,
            [threadId],
          );
          // Don't return — fall through to the generation block below
        } else {
          // Still missing fields — ask a targeted follow-up question
          const followUp = buildFollowUp(parseResult.missing, classifyResult.niche);
          return res.json({
            answer:  followUp,
            cards: [], actions: [], placeholders: [], evidence: [],
            thread_state: {
              thread_id:    threadId,
              state:        'NEEDS_BRIEF',
              niche:        classifyResult.niche,
              mode:         classifyResult.mode,
              needs_brief:  true,
              brief_fields: compiledPolicy.briefFields,
            },
          });
        }
      } else {
        // First time asking — send conversational open question
        const nicheLabel = classifyResult.niche.replace(/_/g, ' ');
        const openQ = `To write your ${nicheLabel} script, I need a few details. Tell me: ${compiledPolicy.briefFields.slice(0, 3).map(f => BRIEF_FIELD_LABELS[f] || f).join(' And ')}`;
        return res.json({
          answer:  openQ,
          cards: [], actions: [], placeholders: [], evidence: [],
          thread_state: {
            thread_id:    threadId,
            state:        'NEEDS_BRIEF',
            niche:        classifyResult.niche,
            mode:         classifyResult.mode,
            needs_brief:  true,
            brief_fields: compiledPolicy.briefFields,
          },
        });
      }
    }

    // ── OVERRIDE detection ────────────────────────────────────────────────────
    const isOverride = /\bCONFIRM\s+OVERRIDE\b/i.test(message);

    // ── Credit pre-flight check ───────────────────────────────────────────────
    if (client_id) {
      const maxCost = estimateMaxCost(compiledPolicy, thread);
      if (maxCost > 0) {
        const afford = canAfford(db, client_id, maxCost);
        if (!afford.ok) {
          return res.status(402).json({
            error:   'insufficient_credits',
            message: `You need at least ${maxCost} credits for this action. Your balance is ${afford.balance}. Top up or upgrade your plan.`,
            balance: afford.balance,
            plan:    afford.plan,
            needed:  maxCost,
          });
        }
      }
    }

    // ── Web search — fetch live facts for sensitive niches ────────────────────
    let webContext = null;
    if (compiledPolicy.config?.needsWeb) {
      webContext = await search(message, compiledPolicy.niche).catch(() => null);
    }

    const systemPrompt = buildSystemPrompt(channel, lang, creatorFormat, voiceProfile, compiledPolicy, isOverride, thread?.brief, webContext);

    // Build message history. Strip any leading assistant turns — Anthropic requires
    // messages to start with 'user'. The frontend greeting is assistant-initiated
    // and must not be included in the API payload.
    const rawHistory = history.slice(-10).filter(m => m.role === 'user' || m.role === 'assistant');
    const trimmed = rawHistory.slice(rawHistory.findIndex(m => m.role === 'user'));
    const messages = [...(trimmed.length ? trimmed : []), { role: 'user', content: message }];

    // ── Agentic tool-use loop ─────────────────────────────────────────────────
    let loopMessages  = [...messages];
    let iterations    = 0;
    let toolRounds    = 0;        // how many tool_use rounds have completed
    const MAX_ITERATIONS = 6;    // 2 tool rounds + synthesis = at most 5; 6 is safe headroom
    const MAX_TOOL_ROUNDS = 2;   // after this many rounds, force synthesis via tool_choice:none

    while (iterations < MAX_ITERATIONS) {
      iterations++;

      // After MAX_TOOL_ROUNDS of tool calls, disable tools so Claude MUST synthesize
      const forceSynthesize = toolRounds >= MAX_TOOL_ROUNDS;

      const apiParams = {
        model:      'claude-sonnet-4-6',
        max_tokens: 4096,
        system:     systemPrompt,
        messages:   loopMessages,
      };
      if (!forceSynthesize) {
        apiParams.tools       = TOOLS;
        apiParams.tool_choice = { type: 'auto' };
      }

      const response = await client.messages.create(apiParams);
      console.log(`[copilot] iteration=${iterations} stop_reason=${response.stop_reason} toolRounds=${toolRounds} blocks=${response.content.map(b=>b.type).join(',')}`);

      if (response.stop_reason === 'end_turn' || response.stop_reason === 'max_tokens') {
        // Extract the text content — should be our JSON response
        const textBlock = response.content.find(b => b.type === 'text');
        const raw = textBlock?.text || '';
        console.log(`[copilot] raw length=${raw.length} preview=${raw.slice(0,120)}`);

        let parsed;

        // 1. Strip markdown fences and try direct parse
        const stripped = raw.replace(/^```(?:json)?\s*/im, '').replace(/\s*```\s*$/m, '').trim();
        try { parsed = JSON.parse(stripped); } catch (_) {}

        // 2. Claude wrapped JSON inside prose — find the first { ... } block
        if (!parsed) {
          const m = raw.match(/\{[\s\S]*"answer"[\s\S]*\}/);
          if (m) try { parsed = JSON.parse(m[0]); } catch (_) {}
        }

        // 3. Final fallback: strip any embedded code blocks, use remaining text
        if (!parsed) {
          const prose = raw.replace(/```[\s\S]*?```/g, '').trim();
          parsed = { answer: prose, cards: [], actions: [] };
        }

        const rawAnswer = parsed.answer || "I found some data but couldn't format a response. Try asking again.";

        // ── Layer 3: post-generation output scan ──────────────────────────────
        const scanResult = runScan(rawAnswer, compiledPolicy);
        if (scanResult.violations.length > 0) {
          const unfixable = scanResult.violations.filter(v => !v.autoFix);
          if (unfixable.length > 0) {
            // Hard violations that can't be auto-fixed → FAILED state
            console.warn(`[copilot] scan FAILED: ${unfixable.map(v => v.type).join(', ')}`);
            db.run(
              `UPDATE workspace_threads SET state = 'FAILED', updated_at = datetime('now') WHERE thread_id = ?`,
              [threadId],
            );
            return res.json({
              answer:  `I generated a response but it violated a policy rule that I can't automatically fix: **${unfixable[0].description}**.\n\nYou can:\n1. **Retry** — I'll try again with stricter guardrails\n2. **Override** — type \`CONFIRM OVERRIDE\` and I'll generate with all invented content clearly marked\n3. **Skip** — move on to a different question`,
              cards:        [],
              actions:      [],
              placeholders: [],
              thread_state: {
                thread_id: threadId,
                state:     'FAILED',
                niche:     classifyResult.niche,
                mode:      classifyResult.mode,
                violation: unfixable[0],
              },
            });
          }
        }

        // Use auto-fixed text if scan made replacements, otherwise original
        const answer       = scanResult.autoFixed ? scanResult.fixedText : rawAnswer;
        // Prefer Claude's placeholders (they include example stories); fall back to server extraction
        const claudePh = Array.isArray(parsed.placeholders) ? parsed.placeholders : [];

        // Extract from card content — that's where [YOUR STORY] markers actually live
        const cardPh = [];
        for (const card of (Array.isArray(parsed.cards) ? parsed.cards : [])) {
          if (card.type === 'script') {
            for (const s of (card.data?.sections || [])) {
              if (s.script) cardPh.push(...extractPlaceholders(s.script));
            }
          }
          if (card.type === 'outline') {
            if (card.data?.hook) cardPh.push(...extractPlaceholders(card.data.hook));
            for (const s of (card.data?.sections || [])) {
              if (s.brief) cardPh.push(...extractPlaceholders(s.brief));
            }
          }
        }

        const serverPh = [...extractPlaceholders(answer), ...cardPh];
        const phByDesc = new Map(claudePh.map(p => [p.description, p]));
        const placeholders = serverPh.map(sp => {
          const cp = phByDesc.get(sp.description);
          return cp?.example ? { ...sp, example: cp.example } : sp;
        });

        // Update thread to OUTPUT and mark topic if first output
        const outputTopic = parsed.cards?.find(c => c.type === 'outline')?.data?.topic
          || parsed.cards?.find(c => c.type === 'script')?.data?.topic
          || thread?.topic || null;
        db.run(
          `UPDATE workspace_threads SET state = 'OUTPUT', topic = COALESCE(?, topic), updated_at = datetime('now') WHERE thread_id = ?`,
          [outputTopic, threadId],
        );

        let creditResult = null;
        if (client_id) {
          const { action: creditAction, cost } = classifyAction(parsed, thread, webContext);
          const { balance, deducted } = deduct(db, client_id, cost, creditAction, threadId, channel_id, {});
          creditResult = { balance, deducted, action: creditAction };
        }

        return res.json({
          answer,
          cards:        Array.isArray(parsed.cards)    ? parsed.cards    : [],
          actions:      Array.isArray(parsed.actions)  ? parsed.actions  : [],
          evidence:     Array.isArray(parsed.evidence) ? parsed.evidence : [],
          placeholders,
          credits:      creditResult,
          thread_state: {
            thread_id:       threadId,
            state:           'OUTPUT',
            niche:           classifyResult.niche,
            secondary_niche: classifyResult.secondary_niche || null,
            mode:            classifyResult.mode,
            merge_warning:   compiledPolicy.mergeWarning || null,
            is_override:     isOverride || false,
          },
        });
      }

      if (response.stop_reason === 'tool_use') {
        // Add assistant turn with all tool_use blocks
        loopMessages.push({ role: 'assistant', content: response.content });

        // Execute every tool call and collect results
        const toolResults = [];
        for (const block of response.content) {
          if (block.type !== 'tool_use') continue;

          let result;
          try {
            result = dispatch(db, block.name, block.input, channel_id, creatorFormat);
            console.log(`[copilot] tool=${block.name} input=${JSON.stringify(block.input)} result_keys=${Object.keys(result).join(',')}`);
          } catch (err) {
            console.error(`[copilot] tool=${block.name} threw:`, err.message);
            result = { error: err.message };
          }

          toolResults.push({
            type:        'tool_result',
            tool_use_id: block.id,
            content:     JSON.stringify(result),
          });
        }

        // Feed tool results back as a user turn
        loopMessages.push({ role: 'user', content: toolResults });
        toolRounds++;
        continue;
      }

      // Unexpected stop reason — break
      break;
    }

    // Fallback if loop exhausted
    return res.json({
      answer:  "I gathered some data but ran out of steps to synthesise it. Try rephrasing your question.",
      cards:   [],
      actions: [],
    });

  } catch (err) {
    console.error('[copilot/chat]', err);
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

// ── GET /api/copilot/thread/:threadId ────────────────────────────────────────
router.get('/thread/:threadId', (req, res) => {
  const db  = getDb();
  const row = db.get('SELECT * FROM workspace_threads WHERE thread_id = ?', [req.params.threadId]);
  if (!row) return res.status(404).json({ error: 'thread not found' });
  res.json(row);
});

// ── POST /api/copilot/thread/:threadId/brief ──────────────────────────────────
// Called when the creator submits the brief form
router.post('/thread/:threadId/brief', (req, res) => {
  const db    = getDb();
  const { brief } = req.body;
  if (!brief || typeof brief !== 'object') return res.status(400).json({ error: 'brief object required' });

  const thread = db.get('SELECT * FROM workspace_threads WHERE thread_id = ?', [req.params.threadId]);
  if (!thread) return res.status(404).json({ error: 'thread not found' });

  const { compilePolicy: cp } = require('../services/policyCompiler');
  const compiled = cp(thread.niche);
  const complete = isBriefComplete(brief, compiled.briefFields);

  db.run(
    `UPDATE workspace_threads SET brief = ?, state = ?, updated_at = datetime('now') WHERE thread_id = ?`,
    [JSON.stringify(brief), complete ? 'BRIEF_COMPLETE' : 'NEEDS_BRIEF', req.params.threadId],
  );

  res.json({ status: complete ? 'complete' : 'incomplete', thread_id: req.params.threadId });
});

// ── GET /api/copilot/threads/:channelId ───────────────────────────────────────
// Active threads for a channel (for session recovery on frontend mount)
router.get('/threads/:channelId', (req, res) => {
  const db = getDb();
  const rows = db.all(
    `SELECT thread_id, topic, state, niche, mode, updated_at
     FROM workspace_threads
     WHERE channel_id = ? AND updated_at > datetime('now', '-14 days')
     ORDER BY updated_at DESC LIMIT 20`,
    [req.params.channelId],
  );
  res.json(rows);
});

// ── GET /api/copilot/voice/:channelId ─────────────────────────────────────────
router.get('/voice/:channelId', (req, res) => {
  const db  = getDb();
  const row = db.get('SELECT * FROM creator_voice WHERE channel_id = ?', [req.params.channelId]);
  res.json(row || null);
});

// ── POST /api/copilot/voice/:channelId — analyze scripts + save ───────────────
router.post('/voice/:channelId', async (req, res) => {
  try {
    const db          = getDb();
    const { channelId } = req.params;
    const { scripts }   = req.body;

    if (!scripts?.trim()) return res.status(400).json({ error: 'scripts required' });

    const analysisPrompt = `You are analyzing a YouTube creator's video scripts to extract their writing voice. Return ONLY a JSON object — no prose, no markdown fences.

Scripts:
${scripts.trim()}

JSON format (all fields required):
{
  "tone": "comma-separated tone descriptors e.g. energetic, conversational, motivational",
  "vocabulary_level": "simple | moderate | advanced",
  "sentence_style": "describe sentence structure and key patterns",
  "language_mix": "e.g. pure English | Hinglish 60/40 | pure Hindi Romanized",
  "opening_pattern": "how they typically open a video",
  "closing_pattern": "how they close and deliver CTAs",
  "common_phrases": ["phrase1", "phrase2", "phrase3"],
  "formality": "informal | semi-formal | formal",
  "energy_level": "low | medium | high | very high",
  "sample_sentences": ["best example 1", "best example 2", "best example 3"]
}`;

    const response = await client.messages.create({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 900,
      messages:   [{ role: 'user', content: analysisPrompt }],
    });

    const raw      = response.content[0]?.text || '';
    const stripped = raw.replace(/^```(?:json)?\s*/im, '').replace(/\s*```\s*$/m, '').trim();
    let analysis;
    try { analysis = JSON.parse(stripped); } catch (_) {
      return res.status(500).json({ error: 'Could not parse voice analysis — try again' });
    }

    const { sample_sentences: samples, ...rest } = analysis;

    db.run(
      `INSERT INTO creator_voice (channel_id, voice_analysis, sample_sentences, skipped_at, updated_at)
       VALUES (?, ?, ?, NULL, datetime('now'))
       ON CONFLICT(channel_id) DO UPDATE SET
         voice_analysis   = excluded.voice_analysis,
         sample_sentences = excluded.sample_sentences,
         skipped_at       = NULL,
         updated_at       = datetime('now')`,
      [channelId, JSON.stringify(rest), JSON.stringify(samples || [])],
    );

    res.json({ status: 'saved', analysis: rest, sample_sentences: samples || [] });
  } catch (err) {
    console.error('[copilot/voice POST]', err);
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

// ── POST /api/copilot/voice/:channelId/skip ───────────────────────────────────
router.post('/voice/:channelId/skip', (req, res) => {
  const db = getDb();
  db.run(
    `INSERT INTO creator_voice (channel_id, skipped_at)
     VALUES (?, datetime('now'))
     ON CONFLICT(channel_id) DO UPDATE SET skipped_at = datetime('now'), updated_at = datetime('now')`,
    [req.params.channelId],
  );
  res.json({ status: 'skipped' });
});

// ── DELETE /api/copilot/voice/:channelId ──────────────────────────────────────
router.delete('/voice/:channelId', (req, res) => {
  const db = getDb();
  db.run('DELETE FROM creator_voice WHERE channel_id = ?', [req.params.channelId]);
  res.json({ status: 'deleted' });
});

module.exports = router;

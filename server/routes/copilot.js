const express   = require('express');
const Anthropic  = require('@anthropic-ai/sdk');
const router     = express.Router();
const { getDb, runWithRetry } = require('../db/init');
const { dispatch, detectCreatorFormat } = require('../services/copilotTools');
const { classify }                      = require('../services/intentClassifier');
const { compilePolicy, mergeConfigs, buildPromptSection, extractPlaceholders } = require('../services/policyCompiler');
const { route, isBriefComplete }        = require('../services/stateRouter');
const { runScan }                       = require('../services/scanRules');
const { parseBrief, buildFollowUp }     = require('../services/briefParser');
const { search }                        = require('../services/webSearch');
const { searchPapers, isResearchRelevantNiche } = require('../services/researchGrounding');
const { verifyClaims } = require('../services/claimVerifier');
const { canAfford, deduct, classifyAction, estimateMaxCost } = require('../services/creditService');
const { resolveCreatorPeerContext }     = require('../services/creatorPeerContext');
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
  {
    name: 'getChannelEvolution',
    description: 'Get a channel\'s performance evolution over the last 30 or 90 days: view change %, upload frequency change, topics covered, viral spikes. Use when the user asks "how has my channel changed", "am I growing or shrinking", "what happened to my views", "show my channel evolution".',
    input_schema: {
      type: 'object',
      properties: {
        channel_id: { type: 'string',  description: 'Channel ID (auto-filled from context)' },
        period:     { type: 'string',  description: '30d or 90d (default: 30d)', enum: ['30d', '90d'] },
      },
    },
  },
  {
    name: 'getTopicTrend',
    description: 'Look up community-wide stats for a topic: how many channels post about it, average views, trend direction. Use when the user asks "is X topic trending", "how popular is X in my niche", "what is the community doing with X topic", "is X saturated".',
    input_schema: {
      type: 'object',
      properties: {
        topic:  { type: 'string', description: 'The topic to look up (e.g. "stoicism", "personal finance", "fitness motivation")' },
        period: { type: 'string', description: '30d or 90d (default: 30d)', enum: ['30d', '90d'] },
      },
      required: ['topic'],
    },
  },
  {
    name: 'searchWeb',
    description: 'Search the live web for a SPECIFIC real-world fact, case study, statistic, quote, or example — things no internal tool can answer (a company\'s funding round, a government stat, a VC\'s quote, a real 2024-2025 example of something). Use ONE targeted query per distinct fact you need — call it multiple times (once per fact) rather than one vague query. This is for business/news/market facts; it does NOT search academic papers.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'A specific, narrow search query for exactly one fact — e.g. "NASSCOM India IT sector employment 2025" not "India tech industry stats"' },
      },
      required: ['query'],
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
  return `
LANGUAGE — ENGLISH MODE:
The creator has selected English for this session. Write ALL drafts, hooks, outlines, scripts, and titles in plain English.
- This applies even if the voice profile, sample sentences, or recent video titles shown to you below are in Hindi, Hinglish, or another language — those describe the creator's STYLE (tone, pacing, structure) to imitate, not the language to write in. Translate the style, not the words.
- Do NOT mix in Hindi/Hinglish words or phrases "for flavor." Write fully in English unless the creator's own message explicitly asks for another language.`;
}

// ── System prompt builder ─────────────────────────────────────────────────────
function buildSystemPrompt(channel, lang, creatorFormat, voiceProfile, compiledPolicy, isOverride, brief, webContext, researchContext) {
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

  let researchSection = '';
  if (researchContext?.papers?.length) {
    const lines = researchContext.papers.slice(0, 4).map((p, i) =>
      `  ${i + 1}. "${p.title}" (${p.year || 'n.d.'}, ${p.citationCount} citations) — ${(p.abstract || 'no abstract').slice(0, 200)}\n     URL: ${p.url}`
    ).join('\n');
    researchSection = `\nRESEARCH GROUNDING — real academic papers fetched for this question:\n${lines}\nYou may mark a claim as "CITED" ONLY if the source URL is copied EXACTLY from the list above and the claim is explicitly supported by the abstract text shown. Never write a citation URL from memory.`;
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
${researchSection}
${briefSection}
${overrideSection}

Your job is to answer the creator's questions using the tools available. Always:
1. Call the most relevant tool(s) to gather real data before answering.
2. For database-lookup tools (findPeers, findTopics, getChannelEvolution, etc.): call AT MOST 2 per question — do not chain more than 2 calls.
   EXCEPTION — searchWeb: each call is a real, billed web search, capped at 5 PER REQUEST — it will start returning errors after that. So be selective: search for the 3-5 facts that matter MOST (the ones a creator would most need to get right or that anchor the whole script — a named case study, a headline stat), not every number that appears in the outline. For lower-stakes or supporting claims, use a [VERIFY: ...] marker instead of spending a search on them. Batch the searches you do make into the SAME turn when they're independent of each other.
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
- { "claim": "exact text of the claim", "status": "CITED", "source": "<exact URL from RESEARCH GROUNDING above OR a searchWeb tool result>", "confidence": 0.7–1.0 }
  → Use ONLY when the claim is directly supported by a paper from RESEARCH GROUNDING or a source returned by the searchWeb tool. Copy the URL exactly — never invent one. If you can't find a matching real URL, use UNVERIFIED instead.
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
- { "type": "evolution", "data": { "channel_id": "...", "period": "30d", "view_change_pct": N, "upload_delta": N, "avg_views": N, "video_count": N, "topics": ["..."], "notable_event": null } } — use after getChannelEvolution tool returns data
- { "type": "topic_drift", "data": { "topic": "...", "period": "30d", "channel_count": N, "avg_views": N, "velocity_trend": "stable|rising|falling" } } — use after getTopicTrend tool returns data
- { "type": "idea_list", "data": { "ideas": [{ "title": "...", "why": "one sentence on why this angle works" }, ...] } } — use when asked for MULTIPLE distinct angle/idea OPTIONS to pick from (e.g. "give me 3 angles for X", "what are some ways I could cover this"). List 2-5 short ideas. Do NOT write the ideas only in "answer" text — put them in this card so they render as a scannable list. Keep "answer" to the framing/context sentence(s); the ideas themselves belong here, not in the outline card (that's for ONE fully fleshed-out topic).

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

// Extracts number-like tokens from a claim (currency amounts, percentages, plain figures — with
// Indian units) so a CITED claim's actual substance can be checked against real search-result text,
// not just its URL. A URL being real doesn't mean the number attached to it is — the model can (and
// has, observed live) cite a genuine article that never mentions the figure it's "citing" for.
function extractNumericTokens(text) {
  const matches = String(text || '').match(/\$?\d[\d,]*(\.\d+)?\s*(million|billion|crore|lakh|%|percent)?/gi) || [];
  return matches
    .map(m => m.replace(/[^0-9.]/g, ''))
    .filter(n => n && n.length >= 2); // skip tiny numbers (years like "24", section numbers) — too likely to false-match
}

function claimIsGrounded(claim, groundingText) {
  const tokens = extractNumericTokens(claim);
  if (!tokens.length) return true; // no checkable figure — fall back to the URL check only
  const haystack = String(groundingText || '');
  return tokens.some(t => haystack.includes(t));
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

    // Persist/update thread state. Retries on SQLITE_BUSY — a long batch job (pipeline.js) holding
    // the write lock past the busy_timeout window shouldn't fail the whole chat turn.
    runWithRetry(
      db,
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

    // ── Web search + research grounding — both optional, run in parallel ──────
    // groundingText accumulates the ACTUAL TEXT of every search result this request receives — used
    // below to check a CITED claim's real content (not just its URL) is genuinely supported. A real
    // URL doesn't guarantee the claim attached to it is true (observed: model cited a real article
    // for a "$240 million" figure the article never mentioned) — checking the claim's own numbers
    // against the text we actually got back catches that class of fabrication.
    let webContext = null, researchContext = null, citableUrls = new Set(), groundingText = '';
    // groundingByUrl maps a specific citable URL -> the actual text we have FOR THAT source, so the
    // verification pass below can check "does THIS source support THIS claim" rather than "does the
    // claim match ANYTHING we've seen" (Tavily's basic search returns one synthesized answer shared
    // across several source links, not per-page text, so multiple URLs legitimately map to the same
    // answer text — that's the best granularity available without paying for full-page extraction).
    const groundingByUrl = new Map();
    const wantsWeb      = !!compiledPolicy.config?.needsWeb;
    const wantsResearch = isResearchRelevantNiche(compiledPolicy.niche);
    if (wantsWeb || wantsResearch) {
      const [webRes, papersRes] = await Promise.allSettled([
        wantsWeb      ? search(message, compiledPolicy.niche)  : Promise.resolve(null),
        wantsResearch ? searchPapers(message, { db, limit: 4 }) : Promise.resolve(null),
      ]);
      webContext = webRes.status === 'fulfilled' ? webRes.value : null;
      const papers = papersRes.status === 'fulfilled' ? papersRes.value : null;
      if (papers?.length) {
        researchContext = { papers };
        citableUrls = new Set(papers.map(p => p.url));
        for (const p of papers) if (p.url) groundingByUrl.set(p.url, p.abstract || '');
        groundingText += ' ' + papers.map(p => p.abstract || '').join(' ');
      }
      if (webContext?.answer) {
        groundingText += ' ' + webContext.answer;
        for (const s of (webContext.sources || [])) if (s?.url) groundingByUrl.set(s.url, webContext.answer);
      }
    }

    const systemPrompt = buildSystemPrompt(channel, lang, creatorFormat, voiceProfile, compiledPolicy, isOverride, thread?.brief, webContext, researchContext);

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
    let searchWebCalls = 0;       // real Tavily calls made this request — hard cost cap, not just a prompt suggestion
    const MAX_ITERATIONS = 6;    // 2 tool rounds + synthesis = at most 5; 6 is safe headroom
    const MAX_TOOL_ROUNDS = 3;   // after this many rounds, force synthesis via tool_choice:none — headroom for fact-heavy scripts that call searchWeb, review a result, then search again
    const MAX_SEARCHWEB_CALLS = 5; // ceiling on real Tavily calls per request (observed 19 calls/38 credits with no cap — this bounds worst-case cost)

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

        // Guardrail: a "CITED" claim is only trustworthy if (a) its URL is one we actually fetched
        // this turn, AND (b) the claim's own numbers actually appear in the text that search returned
        // — a real URL doesn't prove the specific figure attached to it is real (observed live: a
        // genuine article cited for a "$240 million" figure it never mentioned). Either check failing
        // downgrades to UNVERIFIED.
        const sanitizedEvidence = (Array.isArray(parsed.evidence) ? parsed.evidence : []).map(ev => {
          if (ev.status === 'CITED' && (!citableUrls.has(ev.source) || !claimIsGrounded(ev.claim, groundingText))) {
            return { ...ev, status: 'UNVERIFIED', source: null };
          }
          return ev;
        });

        // Dedicated verification pass: for claims that survived the cheap checks, a SEPARATE model
        // call (no creative stakes, just auditing) checks whether the specific source text actually
        // supports the specific claim, and extracts the real supporting quote to show the creator.
        // Best-effort — if it fails/times out, leave the cheap-check result as-is rather than block.
        let finalEvidence = sanitizedEvidence;
        const toVerify = sanitizedEvidence.filter(ev => ev.status === 'CITED' && groundingByUrl.has(ev.source));
        if (toVerify.length) {
          const results = await verifyClaims(toVerify.map(ev => ({ claim: ev.claim, sourceText: groundingByUrl.get(ev.source) }))).catch(() => null);
          if (results) {
            let vi = 0;
            finalEvidence = sanitizedEvidence.map(ev => {
              if (ev.status !== 'CITED' || !groundingByUrl.has(ev.source)) return ev;
              const r = results[vi++];
              if (!r) return ev;
              if (!r.supported) return { ...ev, status: 'UNVERIFIED', source: null };
              return { ...ev, supporting_quote: r.quote || null };
            });
          }
        }

        return res.json({
          answer,
          cards:        Array.isArray(parsed.cards)    ? parsed.cards    : [],
          actions:      Array.isArray(parsed.actions)  ? parsed.actions  : [],
          evidence:     finalEvidence,
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
            // Hard cost cap: searchWeb makes a REAL, billed Tavily call. Check BEFORE dispatching so
            // an exceeded budget never reaches the network — this must be enforced in code, not just
            // requested in the prompt (a prompt instruction alone let one request make 19 calls).
            if (block.name === 'searchWeb' && searchWebCalls >= MAX_SEARCHWEB_CALLS) {
              result = { error: `Search budget for this request is used up (${MAX_SEARCHWEB_CALLS} searches). Use a [VERIFY: ...] marker for any remaining facts instead of searching further.` };
            } else {
              if (block.name === 'searchWeb') searchWebCalls++;
              result = await dispatch(db, block.name, block.input, channel_id, creatorFormat);
            }
            console.log(`[copilot] tool=${block.name} input=${JSON.stringify(block.input)} result_keys=${Object.keys(result).join(',')}`);
            // searchWeb's real sources are citable too — not just the pre-fetch research papers.
            // Also accumulate the actual result TEXT so we can check a claim's real content later,
            // not just whether its URL happens to be one we fetched.
            if (block.name === 'searchWeb' && result?.answer) {
              groundingText += ' ' + result.answer;
              if (Array.isArray(result.sources)) for (const s of result.sources) if (s?.url) { citableUrls.add(s.url); groundingByUrl.set(s.url, result.answer); }
            }
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

// ── GET /api/copilot/suggestions/:channelId ──────────────────────────────────
// Returns community-trending and niche-trending topic suggestions for WhatToPost screen.
router.get('/suggestions/:channelId', (req, res) => {
  try {
    const db        = getDb();
    const channelId = req.params.channelId;

    const channel = db.get('SELECT * FROM ingested_channels WHERE channel_id = ?', [channelId]);
    if (!channel) return res.status(404).json({ error: 'Channel not found' });

    const niche = channel.primary_niche || channel.niche;

    // ── Community trending (peer graph) ──────────────────────────────────────
    const { resolvePeers } = require('../services/copilotPeerHelper');
    const peerContext = resolveCreatorPeerContext(db, channelId, {
      niche,
      userSubs: channel.channel_subscribers || 0,
    });
    const profilePeerIds = (peerContext.peerIds || []).filter(id => id !== channelId);
    const peerIds = (profilePeerIds.length
      ? profilePeerIds
      : resolvePeers(db, channel, { exclude_channel_id: channelId, limit: 150 })
    ).slice(0, 150);
    const nicheScopeIds = profilePeerIds.slice(0, 300);

    let communityTopics   = [];
    let communityVideos   = [];

    if (peerIds.length > 0) {
      const ph = peerIds.map(() => '?').join(',');

      communityTopics = db.all(`
        SELECT
          jt.value                        AS topic,
          COUNT(DISTINCT ic.channel_id)   AS peer_count,
          CAST(AVG(iv.views) AS INTEGER)  AS avg_views,
          SUM(iv.views)                   AS total_views
        FROM ingested_channels ic,
             json_each(ic.inferred_topics) jt
        JOIN ingested_videos iv ON iv.channel_id = ic.channel_id
        WHERE ic.channel_id IN (${ph})
          AND iv.published_at > datetime('now', '-30 days')
          AND iv.views > 0
          AND iv.is_short = 0
        GROUP BY jt.value
        HAVING peer_count >= 2
        ORDER BY avg_views DESC
        LIMIT 12
      `, peerIds);

      communityVideos = db.all(`
        SELECT iv.title, iv.views, iv.published_at, ic.channel_name, ic.channel_id
        FROM ingested_videos iv
        JOIN ingested_channels ic ON ic.channel_id = iv.channel_id
        WHERE iv.channel_id IN (${ph})
          AND iv.published_at > datetime('now', '-14 days')
          AND iv.views > 3000
          AND iv.is_short = 0
        ORDER BY iv.views DESC
        LIMIT 10
      `, peerIds);
    }

    // ── Niche trending (all channels in same niche, last 30 days) ────────────
    let nicheTopics  = [];
    let nicheVideos  = [];

    if (nicheScopeIds.length > 0) {
      const sph = nicheScopeIds.map(() => '?').join(',');
      nicheTopics = db.all(`
        SELECT
          jt.value                        AS topic,
          COUNT(DISTINCT ic.channel_id)   AS channel_count,
          CAST(AVG(iv.views) AS INTEGER)  AS avg_views,
          SUM(iv.views)                   AS total_views
        FROM ingested_channels ic,
             json_each(ic.inferred_topics) jt
        JOIN ingested_videos iv ON iv.channel_id = ic.channel_id
        WHERE ic.channel_id IN (${sph})
          AND iv.published_at > datetime('now', '-30 days')
          AND iv.views > 0
          AND iv.is_short = 0
          AND (ic.ignore_from_benchmarks IS NULL OR ic.ignore_from_benchmarks = 0)
        GROUP BY jt.value
        HAVING channel_count >= 2
        ORDER BY avg_views DESC
        LIMIT 12
      `, nicheScopeIds);

      nicheVideos = db.all(`
        SELECT iv.title, iv.views, iv.published_at, ic.channel_name, ic.channel_id,
               ic.channel_subscribers
        FROM ingested_videos iv
        JOIN ingested_channels ic ON ic.channel_id = iv.channel_id
        WHERE iv.channel_id IN (${sph})
          AND iv.published_at > datetime('now', '-14 days')
          AND iv.views > 5000
          AND iv.is_short = 0
          AND (ic.ignore_from_benchmarks IS NULL OR ic.ignore_from_benchmarks = 0)
        ORDER BY iv.views DESC
        LIMIT 10
      `, nicheScopeIds);
    } else if (niche) {
      nicheTopics = db.all(`
        SELECT
          jt.value                        AS topic,
          COUNT(DISTINCT ic.channel_id)   AS channel_count,
          CAST(AVG(iv.views) AS INTEGER)  AS avg_views,
          SUM(iv.views)                   AS total_views
        FROM ingested_channels ic,
             json_each(ic.inferred_topics) jt
        JOIN ingested_videos iv ON iv.channel_id = ic.channel_id
        WHERE COALESCE(ic.primary_niche, ic.niche) = ?
          AND ic.channel_id != ?
          AND iv.published_at > datetime('now', '-30 days')
          AND iv.views > 0
          AND iv.is_short = 0
          AND (ic.ignore_from_benchmarks IS NULL OR ic.ignore_from_benchmarks = 0)
        GROUP BY jt.value
        HAVING channel_count >= 3
        ORDER BY avg_views DESC
        LIMIT 12
      `, [niche, channelId]);

      nicheVideos = db.all(`
        SELECT iv.title, iv.views, iv.published_at, ic.channel_name, ic.channel_id,
               ic.channel_subscribers
        FROM ingested_videos iv
        JOIN ingested_channels ic ON ic.channel_id = iv.channel_id
        WHERE COALESCE(ic.primary_niche, ic.niche) = ?
          AND ic.channel_id != ?
          AND iv.published_at > datetime('now', '-14 days')
          AND iv.views > 5000
          AND iv.is_short = 0
          AND (ic.ignore_from_benchmarks IS NULL OR ic.ignore_from_benchmarks = 0)
        ORDER BY iv.views DESC
        LIMIT 10
      `, [niche, channelId]);
    }

    function fmt(n) {
      if (!n) return '0';
      if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
      if (n >= 1_000)     return `${(n / 1_000).toFixed(0)}K`;
      return String(n);
    }

    res.json({
      channel_name: channel.channel_name,
      niche,
      peer_pool:    peerIds.length,
      peer_source:  peerContext.peer_source || 'legacy',
      csp_primary:  peerContext.csp_primary || null,
      format_profile: peerContext.fp_result?.format_profile || channel.format_profile || null,
      profile_scoped_niche: nicheScopeIds.length > 0,
      community: {
        topics: communityTopics.map(t => ({
          topic:      t.topic,
          peer_count: t.peer_count,
          avg_views:  fmt(t.avg_views),
          avg_views_raw: t.avg_views,
        })),
        hot_videos: communityVideos.map(v => ({
          title:        v.title,
          views:        fmt(v.views),
          views_raw:    v.views,
          channel_name: v.channel_name,
          date:         v.published_at?.slice(0, 10),
        })),
      },
      niche_wide: {
        topics: nicheTopics.map(t => ({
          topic:         t.topic,
          channel_count: t.channel_count,
          avg_views:     fmt(t.avg_views),
          avg_views_raw: t.avg_views,
        })),
        hot_videos: nicheVideos.map(v => ({
          title:        v.title,
          views:        fmt(v.views),
          views_raw:    v.views,
          channel_name: v.channel_name,
          date:         v.published_at?.slice(0, 10),
        })),
      },
    });
  } catch (e) {
    console.error('[copilot/suggestions]', e);
    res.status(500).json({ error: e.message });
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

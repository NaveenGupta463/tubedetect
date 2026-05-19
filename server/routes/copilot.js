const express   = require('express');
const Anthropic  = require('@anthropic-ai/sdk');
const router     = express.Router();
const { getDb }  = require('../db/init');
const { dispatch } = require('../services/copilotTools');

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
- Tone: Conversational, energetic, direct — as if speaking on camera to a young Indian audience.
- Your own answers in the chat: You can stay in English for clarity, but all creative content (outlines, hooks, titles, CTAs) must follow the above rules.`;
  }
  return ''; // English — no special instruction needed
}

// ── System prompt builder ─────────────────────────────────────────────────────
function buildSystemPrompt(channel, lang) {
  const channelCtx = channel
    ? `You are assisting ${channel.channel_name} — a ${channel.primary_niche || channel.niche || 'content'} creator` +
      (channel.subscriber_count ? ` with ${formatSubs(channel.subscriber_count)} subscribers` : '') +
      (channel.region ? ` (region: ${channel.region})` : '') +
      '.'
    : 'You are assisting a YouTube creator.';

  const idLine = channel
    ? `The creator's channel_id is "${channel.channel_id}". All single-channel tools (findPeers, findTopics, findOpportunity, trackNiche) will use this automatically — do NOT pass a different channel_id value.`
    : '';

  const langInstruction = buildLanguageInstruction(lang);

  return `You are TubeIntel Copilot — an intelligent research assistant for YouTube creators. You have access to a database of ingested YouTube channels and their video performance data.

${channelCtx} ${idLine}
${langInstruction}

Your job is to answer the creator's questions using the tools available. Always:
1. Call the most relevant tool(s) to gather real data before answering.
2. Call AT MOST 2 tools per question — do not chain more than 2 tool calls.
3. Once you have data from any tool, immediately synthesise and respond. Even if data is limited or peers are few, give the best answer you can.
4. Speak directly to the creator ("your peers", "you could post about...").
5. Be concise. One punchy insight is worth more than five bullet points.
6. NEVER ask the user for their Channel ID — you already have it.

When you have gathered enough data, respond ONLY with a JSON object in this exact format:
{
  "answer": "Your natural language response here — 2-4 sentences max. Direct, actionable.",
  "cards": [],
  "actions": []
}

Card types you can include:
- { "type": "topic", "data": { "topic": "...", "peer_count": N, "avg_views": "...", "already_covered": bool } }
- { "type": "channel", "data": { "channel_id": "...", "channel_name": "...", "subs": "...", "niche": "..." } }
- { "type": "opportunity", "data": { "topic": "...", "peer_count": N, "avg_views": "...", "gap": "..." } }
- { "type": "comparison", "data": { "channel_a": {...}, "channel_b": {...} } }
- { "type": "video", "data": { "title": "...", "views": "...", "channel_name": "...", "date": "..." } }
- { "type": "outline", "data": { "topic": "...", "format": "short-form|long-form", "hook": "...", "sections": [{ "title": "...", "brief": "..." }], "titles": ["...", "...", "..."], "cta": "..." } }

Action types you can include (1-3 max):
- { "type": "track_niche",    "label": "Track this topic",         "payload": { "niche": "..." } }
- { "type": "compare_channel","label": "Compare with ...",          "payload": { "channel_id": "..." } }
- { "type": "save_idea",      "label": "Save this idea",            "payload": { "topic": "..." } }
- { "type": "draft_outline",  "label": "Draft video outline",       "payload": { "topic": "..." } }
- { "type": "write_hook",     "label": "Write the opening script",  "payload": { "topic": "..." } }
- { "type": "new_draft",      "label": "Generate another draft",    "payload": { "topic": "..." } }

Action progression rules — follow these strictly:
1. First time seeing a topic → offer save_idea + draft_outline.
2. After idea is saved → replace save_idea with draft_outline. Never offer save_idea again for the same topic.
3. After an outline card is shown → offer write_hook + new_draft + track_niche. NEVER offer draft_outline or save_idea again for that topic.
4. After write_hook → offer new_draft + track_niche only.
5. Never repeat an action type for the same topic in consecutive turns.

Only include cards and actions that add real value. Empty arrays are fine.`;
}

function formatSubs(n) {
  if (!n) return 'unknown';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

// ── POST /api/copilot/chat ────────────────────────────────────────────────────
router.post('/chat', async (req, res) => {
  try {
    const db = getDb();
    const { message, channel_id, history = [], lang: clientLang } = req.body;

    if (!message) return res.status(400).json({ error: 'message required' });
    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(503).json({ error: 'ANTHROPIC_API_KEY not configured' });
    }

    // Load channel context if provided
    let channel = null;
    if (channel_id) {
      channel = db.get('SELECT * FROM ingested_channels WHERE channel_id = ?', [channel_id]);
    }


    // Lang: client override → DB primary_language → default English
    const lang = clientLang || channel?.primary_language || 'en';
    const systemPrompt = buildSystemPrompt(channel, lang);

    // Build message history. Strip any leading assistant turns — Anthropic requires
    // messages to start with 'user'. The frontend greeting is assistant-initiated
    // and must not be included in the API payload.
    const rawHistory = history.slice(-10).filter(m => m.role === 'user' || m.role === 'assistant');
    const trimmed = rawHistory.slice(rawHistory.findIndex(m => m.role === 'user'));
    const messages = [...(trimmed.length ? trimmed : []), { role: 'user', content: message }];

    // ── Agentic tool-use loop ─────────────────────────────────────────────────
    let loopMessages = [...messages];
    let iterations = 0;
    const MAX_ITERATIONS = 10;

    while (iterations < MAX_ITERATIONS) {
      iterations++;

      const response = await client.messages.create({
        model:      'claude-sonnet-4-6',
        max_tokens: 2048,
        system:     systemPrompt,
        tools:      TOOLS,
        messages:   loopMessages,
      });

      if (response.stop_reason === 'end_turn') {
        // Extract the text content — should be our JSON response
        const textBlock = response.content.find(b => b.type === 'text');
        const raw = textBlock?.text || '';

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

        return res.json({
          answer:  parsed.answer  || '',
          cards:   Array.isArray(parsed.cards)   ? parsed.cards   : [],
          actions: Array.isArray(parsed.actions) ? parsed.actions : [],
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
            result = dispatch(db, block.name, block.input, channel_id);
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

module.exports = router;

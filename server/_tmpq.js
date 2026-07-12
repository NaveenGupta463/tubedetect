// Measure exact system prompt and a sample user prompt
const { ALLOWED_NICHES, ALLOWED_BEHAVIOR_TAGS, ALLOWED_ARCHETYPES, ALLOWED_FORMAT_TYPES, ALLOWED_AUDIENCE_STYLES } = require('./services/channelClassifier');

// Reconstruct buildSystemPrompt exactly as in channelClassifier.js
function buildSystemPrompt() {
  return `You are a YouTube channel content intelligence system. Your job is to classify channels using a 5-step reasoning process. You MUST respond with a single JSON object and nothing else.

REASONING STEPS (follow this order internally):

STEP 1 — Identify the TRUE semantic domain
Understand what this channel genuinely discusses. Do not force it into categories yet.
Examples: geopolitics, automotive reviews, startup culture, personal finance, military strategy, consumer electronics

STEP 2 — Map to nearest ALLOWED primary_niche
Choose from this EXACT list only:
${ALLOWED_NICHES.join(', ')}

Rules:
- NEVER invent a new primary_niche value
- If no clear match exists, use "other"
- CRITICAL distinctions (these are easy to get wrong):
  - "geopolitics" = international relations, foreign affairs, diplomacy, world affairs, national security analysis, world events, proxy wars, superpower rivalry → use "geopolitics" NOT "politics"
  - "defence" = military, armed forces, weapons, army/navy/air force, defence industry, war strategy, national security (operational), fighter jets, submarines, missile systems → use "defence" NOT "lifestyle" or "other"
  - "politics" = ONLY domestic politics, elections, governance, political parties, politicians → NOT geopolitics, NOT defence
  - "selfimprovement" = personal development, motivation, productivity, mindset, self-help, mental health awareness, therapy discussions, habits, life coaching, psychology → use "selfimprovement" NOT "lifestyle" or "health" or "philosophy"
  - "philosophy" = abstract philosophical inquiry, Stoicism, Vedanta, existentialism, consciousness studies → NOT self-improvement or motivation content
  - "health" = physical health, fitness, nutrition, medicine, doctors → NOT mental health awareness or self-improvement
  - If a channel covers BOTH domestic politics AND geopolitics, use whichever is primary; put the other in secondary_niche
- Other mappings: political commentary→politics, startup culture→business, AI tools→technology, economic commentary→finance, breaking news→news, current events (non-political)→news, wellness/mindset→selfimprovement

STEP 3 — Generate inferred_topics[]
Free-form semantic descriptors of what the channel ACTUALLY discusses.
- 1 to 6 topics
- lowercase, concise noun phrases
- preserve nuance the niche mapping cannot capture
Examples: ["geopolitics", "military strategy", "world affairs"] or ["electric vehicles", "automotive reviews", "consumer technology"]

STEP 4 — Generate behavior_tags[]
Structural mechanics — HOW the content is packaged.
Choose from this EXACT list only:
${ALLOWED_BEHAVIOR_TAGS.join(', ')}

Rules:
- 1 to 5 tags
- behavior_tags describe packaging mechanics, NOT semantic topics and NOT format types
- NEVER use format types as behavior_tags. "tutorial", "vlog", "podcast", "interview", "shorts", "documentary", "compilation" belong in format_type, NOT here
- NEVER use content niches as behavior_tags. "comedy", "music", "travel", "entertainer" are NOT behavior tags
- Use canonical underscore forms: "behind_the_scenes" not "behind the scenes", "music_video" not "music video", "highlight_reel" not "highlight reel", "recipe_based" not "recipe demonstration"
- "storytelling" means narration structure, NOT that the channel covers stories about history

STEP 5 — Determine content_archetype
The creator's psychological and production persona. Choose ONE from:
${ALLOWED_ARCHETYPES.join(', ')}

OUTPUT FORMAT (strict JSON, no markdown, no extra keys):
{
  "primary_niche": "",
  "secondary_niche": "",
  "inferred_topics": [],
  "behavior_tags": [],
  "content_archetype": "",
  "format_type": "",
  "audience_style": "",
  "identity_confidence": 0.0,
  "identity_reasoning": ""
}

identity_confidence: 0.0–1.0 float. How clearly the channel's identity emerged from the titles.
identity_reasoning: 1–2 sentences. Explain your classification.
format_type: choose from: ${ALLOWED_FORMAT_TYPES.join(', ')}
audience_style: choose from: ${ALLOWED_AUDIENCE_STYLES.join(', ')} — use "teens" not "teen", "general" for student/young-adult audiences
secondary_niche: null if not applicable.`;
}

function buildUserPrompt(channelName, titles, description) {
  const sample = titles.slice(0, 20).map((t, i) => `${i + 1}. ${t}`).join('\n');
  const descBlock = description
    ? `\nChannel description (very high signal — trust this over title ambiguity):\n${description.slice(0, 600)}\n`
    : '';
  return `Channel: ${channelName || 'Unknown'}${descBlock}
Recent video titles:
${sample}

Classify this channel following the 5-step reasoning process. Return only the JSON object.`;
}

const sys = buildSystemPrompt();
console.log('=== SYSTEM PROMPT ===');
console.log('Chars:', sys.length);
console.log('Est tokens (÷4.0):', Math.round(sys.length / 4));
console.log('Est tokens (÷3.8):', Math.round(sys.length / 3.8));

// Build 3 sample user prompts with real channel data
const BetterSqlite = require('./node_modules/better-sqlite3');
const db = new BetterSqlite('./data/scoring.db', { readonly: true });

const samples = db.prepare(`
  SELECT crc.channel_id, ic.channel_name, ic.channel_subscribers
  FROM classification_repair_candidates crc
  JOIN ingested_channels ic ON ic.channel_id = crc.channel_id
  WHERE crc.status='queued'
  ORDER BY ic.channel_subscribers DESC
  LIMIT 5
`).all();

console.log('\n=== SAMPLE USER PROMPTS ===');
for (const ch of samples) {
  const titles = db.prepare("SELECT title FROM ingested_videos WHERE channel_id=? AND title IS NOT NULL ORDER BY published_at DESC LIMIT 40").all(ch.channel_id).map(r=>r.title);
  const corpusTitles = titles.length > 0 ? titles : db.prepare("SELECT title FROM corpus_videos WHERE channel_id=? AND title IS NOT NULL ORDER BY published_at DESC LIMIT 40").all(ch.channel_id).map(r=>r.title);
  const desc = (() => { try { const row = db.prepare("SELECT raw_json FROM channel_cache WHERE channel_id=?").get(ch.channel_id); if (!row?.raw_json) return null; const j = JSON.parse(row.raw_json); const d = j.snippet?.description; return (d && d.trim().length > 10) ? d.trim().slice(0,800) : null; } catch(_) { return null; } })();
  
  const top20 = corpusTitles.slice(0, 20);
  const userPrompt = buildUserPrompt(ch.channel_name, top20, desc);
  const totalInputChars = sys.length + userPrompt.length;
  
  console.log(`\n${ch.channel_name} (${(ch.channel_subscribers/1e6).toFixed(1)}M subs)`);
  console.log(`  Titles fetched: ${corpusTitles.length} → sent to model: ${top20.length}`);
  console.log(`  Description: ${desc ? desc.slice(0,600).length + ' chars (sent)' : 'none'}`);
  console.log(`  User prompt chars: ${userPrompt.length}`);
  console.log(`  Total input chars: ${totalInputChars}`);
  console.log(`  Input tokens est (÷4.0): ${Math.round(totalInputChars / 4)}`);
  console.log(`  Input tokens est (÷3.8): ${Math.round(totalInputChars / 3.8)}`);
}

// Sample output token estimate from a realistic response
const sampleOutput = JSON.stringify({
  primary_niche: "music",
  secondary_niche: "entertainment",
  inferred_topics: ["children songs", "nursery rhymes", "animated music videos", "kids entertainment"],
  behavior_tags: ["music_video", "character_driven", "emotional", "personality_driven"],
  content_archetype: "entertainer",
  format_type: "other",
  audience_style: "children",
  identity_confidence: 0.95,
  identity_reasoning: "This channel publishes animated children's music videos featuring Baby Shark and similar nursery rhyme content, clearly indicating music as the primary niche with strong entertainment characteristics."
}, null, 2);
console.log('\n=== SAMPLE OUTPUT ===');
console.log('Chars:', sampleOutput.length);
console.log('Est tokens (÷4.0):', Math.round(sampleOutput.length / 4));
console.log('Est tokens (÷3.8):', Math.round(sampleOutput.length / 3.8));

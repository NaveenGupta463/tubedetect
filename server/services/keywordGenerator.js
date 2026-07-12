'use strict';

const Anthropic = require('@anthropic-ai/sdk');

const MODEL = 'claude-haiku-4-5-20251001'; // fast + cheap for this task

let _client = null;
function getClient() {
  if (_client) return _client;
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('[keywordGenerator] Missing ANTHROPIC_API_KEY');
  _client = new Anthropic({ apiKey: key });
  return _client;
}

const LANG_LABELS = {
  en: 'English',
  hi: 'Hindi (romanised or Devanagari)',
  ta: 'Tamil',
  te: 'Telugu',
  bn: 'Bengali',
  kn: 'Kannada',
  ml: 'Malayalam',
  es: 'Spanish (Latin America)',
  pt: 'Portuguese (Brazil)',
  id: 'Indonesian',
  ar: 'Arabic',
  pa: 'Punjabi',
};

// How many new channels from each niche×lang pair in last 7 days
function getUnderperformingNiches(db) {
  const rows = db.all(`
    SELECT niche, language AS lang, COUNT(*) AS recent
    FROM corpus_channels
    WHERE created_at >= datetime('now', '-7 days')
      AND niche IS NOT NULL
    GROUP BY niche, language
  `);

  // Build a map of what's been discovered recently
  const recentMap = new Map();
  for (const r of rows) {
    recentMap.set(`${r.niche}:${r.lang || 'en'}`, r.recent);
  }

  // Get all niche×lang combos we search for
  const niches = db.all(`SELECT DISTINCT niche FROM corpus_channels WHERE niche IS NOT NULL`).map(r => r.niche);
  const langs  = ['en', 'hi', 'ta', 'te', 'bn', 'kn', 'ml', 'es', 'pt', 'id', 'ar', 'pa'];

  const underperforming = [];
  for (const niche of niches) {
    for (const lang of langs) {
      const recent = recentMap.get(`${niche}:${lang}`) || 0;
      if (recent < 3) underperforming.push({ niche, lang, recent });
    }
  }

  // Prioritise by fewest recent discoveries; cap at 10 pairs per run to control cost
  underperforming.sort((a, b) => a.recent - b.recent);
  return underperforming.slice(0, 10);
}

async function generateKeywordsForPair(niche, lang) {
  const langLabel = LANG_LABELS[lang] || lang;
  const client    = getClient();

  const prompt = `You are helping a YouTube channel discovery system find fresh, undiscovered creators.

Generate 10 YouTube search queries to find NEW, SMALLER, or EMERGING ${langLabel} channels in the "${niche}" niche.

Rules:
- Queries must be in ${langLabel} (or romanised if script-based)
- Be SPECIFIC and LONG-TAIL — avoid generic terms already exhausted (e.g. "finance tips", "tech review")
- Focus on sub-topics, specific formats, emerging trends, underserved angles
- Mix: how-to guides, case studies, specific sub-niches, regional topics, beginner vs advanced
- Each query should be 3-6 words
- Do NOT repeat obvious/common queries

Return ONLY a JSON array of 10 strings. No explanation, no markdown, no backticks.
Example format: ["query one here", "query two here", ...]`;

  const msg = await client.messages.create({
    model:      MODEL,
    max_tokens: 300,
    messages:   [{ role: 'user', content: prompt }],
  });

  const text = msg.content[0]?.text?.trim() || '[]';
  let keywords;
  try {
    keywords = JSON.parse(text);
  } catch (_) {
    // Try extracting array from response if Claude added any preamble
    const match = text.match(/\[[\s\S]*\]/);
    keywords = match ? JSON.parse(match[0]) : [];
  }

  return Array.isArray(keywords)
    ? keywords.filter(k => typeof k === 'string' && k.trim().length > 0).map(k => k.trim())
    : [];
}

async function generateFreshKeywords(db) {
  const pairs = getUnderperformingNiches(db);
  if (!pairs.length) {
    console.log('[keyword-gen] All niches performing well — skipping generation');
    return { generated: 0, pairs: 0 };
  }

  console.log(`[keyword-gen] Generating keywords for ${pairs.length} underperforming niche×lang pairs`);
  let totalGenerated = 0;

  for (const { niche, lang, recent } of pairs) {
    try {
      const keywords = await generateKeywordsForPair(niche, lang);
      if (!keywords.length) continue;

      let inserted = 0;
      for (const keyword of keywords) {
        try {
          db.run(
            `INSERT OR IGNORE INTO ai_generated_keywords (niche, lang, keyword) VALUES (?, ?, ?)`,
            [niche, lang, keyword],
          );
          inserted++;
        } catch (_) {}
      }
      totalGenerated += inserted;
      console.log(`[keyword-gen] ${niche}/${lang} (recent=${recent}): +${inserted} keywords`);
    } catch (e) {
      console.warn(`[keyword-gen] Failed for ${niche}/${lang}:`, e.message);
    }
  }

  console.log(`[keyword-gen] Done — ${totalGenerated} new keywords stored across ${pairs.length} pairs`);
  return { generated: totalGenerated, pairs: pairs.length };
}

// Returns the best AI keyword for a niche×lang pair, or null if none available.
// Marks the keyword as used so it rotates to the next one on subsequent calls.
function pickAIKeyword(db, niche, lang) {
  const row = db.get(
    `SELECT id, keyword FROM ai_generated_keywords
     WHERE niche = ? AND lang = ?
     ORDER BY used_count ASC, generated_at DESC
     LIMIT 1`,
    [niche, lang],
  );
  if (!row) return null;

  db.run(
    `UPDATE ai_generated_keywords
     SET used_count = used_count + 1, last_used_at = datetime('now')
     WHERE id = ?`,
    [row.id],
  );
  return row.keyword;
}

module.exports = { generateFreshKeywords, pickAIKeyword };

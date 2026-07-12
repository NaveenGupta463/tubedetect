'use strict';

// Real academic-paper grounding via the Semantic Scholar Graph API — free, official, no key
// required for basic use. Google Scholar has no public API and blocks scraping, so this is the
// practical substitute for the same job (grounding creator content in real research).
// Mirrors server/services/webSearch.js's never-throw contract: every failure path logs a warning
// and returns null, never throws.

const crypto = require('crypto');

const SS_API   = 'https://api.semanticscholar.org/graph/v1/paper/search';
const FIELDS   = 'title,abstract,year,citationCount,authors,venue,openAccessPdf,url';
const CACHE_TTL_MS         = 18 * 24 * 60 * 60 * 1000; // papers don't change; 18 days is plenty
const MIN_CALL_INTERVAL_MS = 1100;                      // stay under the unauthenticated rate limit
const FETCH_TIMEOUT_MS     = 6000;

let _lastCallAt = 0;

function ensureCache(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS research_paper_cache (
    query_key TEXT PRIMARY KEY, results_json TEXT NOT NULL, fetched_at TEXT NOT NULL)`);
}

function cacheKeyFor(topic, limit) {
  return crypto.createHash('sha256').update(`${topic.toLowerCase().trim()}||${limit}`).digest('hex').slice(0, 32);
}

// Keyword-substring relevance — works across touchpoints with different niche vocabularies (the
// trend engine's ~18-29 standard niches vs Copilot's KNOWN_NICHES) since it's a substring test, not
// an exact-match enum.
const RESEARCH_KEYWORDS = [
  'science', 'health', 'fitness', 'education', 'tech_explainer', 'tech_review',
  'psych', 'medic', 'nutrition', 'biology', 'physics', 'chemistry', 'neuro', 'cogniti', 'research',
];

function isResearchRelevantNiche(nicheStr) {
  if (!nicheStr) return false;
  const s = String(nicheStr).toLowerCase();
  return RESEARCH_KEYWORDS.some(k => s.includes(k));
}

// PrePublish has no niche classifier — only a closed 10-value category dropdown. Gate on category
// membership OR a keyword sniff over title/description, since creators often mis-categorize
// health/science content as Entertainment/Lifestyle.
const RESEARCH_CATEGORIES = new Set(['Education', 'Tech']);
const RESEARCH_TEXT_RE = /\b(stud(y|ies)|research|scientis|scientific|clinical|experiment|psycholog|neuroscien|nutrition|biology|physics|chemistry|medical|academic)\b/i;

function isResearchRelevantPrepublish({ category, text } = {}) {
  if (category && RESEARCH_CATEGORIES.has(category)) return true;
  return !!(text && RESEARCH_TEXT_RE.test(text));
}

async function searchPapers(topic, { db, limit = 5 } = {}) {
  const query = String(topic || '').trim().slice(0, 300);
  if (!query) return null;

  if (db) {
    ensureCache(db);
    try {
      const key = cacheKeyFor(query, limit);
      const cached = db.get(`SELECT results_json, fetched_at FROM research_paper_cache WHERE query_key=?`, [key]);
      if (cached && (Date.now() - new Date(cached.fetched_at).getTime()) < CACHE_TTL_MS) {
        try { return JSON.parse(cached.results_json); } catch (_) {}
      }
    } catch (_) {}
  }

  const wait = MIN_CALL_INTERVAL_MS - (Date.now() - _lastCallAt);
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  _lastCallAt = Date.now();

  const url = `${SS_API}?query=${encodeURIComponent(query)}&fields=${FIELDS}&limit=${limit}`;
  // Optional API key (free to request from Semantic Scholar) — the unauthenticated pool is shared
  // globally and easily saturated (observed 429s in testing even with self-throttling). Works without
  // a key, more reliable with one — same optional-key pattern as _ai() elsewhere in this codebase.
  const apiKey = process.env.SEMANTIC_SCHOLAR_API_KEY;
  const headers = apiKey ? { 'x-api-key': apiKey } : {};
  let response;
  try {
    response = await Promise.race([
      fetch(url, { headers }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), FETCH_TIMEOUT_MS)),
    ]);
  } catch (err) {
    console.warn('[researchGrounding] fetch failed:', err.message);
    return null;
  }
  if (!response.ok) {
    console.warn(`[researchGrounding] Semantic Scholar ${response.status}`);
    return null;
  }
  let data;
  try { data = await response.json(); } catch (err) {
    console.warn('[researchGrounding] JSON parse failed:', err.message);
    return null;
  }

  const papers = (data.data || [])
    .map(p => ({
      title: p.title, abstract: p.abstract || null, year: p.year || null,
      citationCount: p.citationCount ?? 0,
      authors: (p.authors || []).map(a => a.name).slice(0, 3),
      venue: p.venue || null,
      url: p.url || p.openAccessPdf?.url || null,
    }))
    .filter(p => p.title && p.url);

  if (!papers.length) { console.warn('[researchGrounding] no usable results'); return null; }

  console.log(`[researchGrounding] topic="${query}" papers=${papers.length}`);

  if (db) {
    try {
      db.run(`INSERT OR REPLACE INTO research_paper_cache (query_key, results_json, fetched_at) VALUES (?,?,?)`,
        [cacheKeyFor(query, limit), JSON.stringify(papers), new Date().toISOString()]);
    } catch (_) {}
  }
  return papers;
}

module.exports = { searchPapers, isResearchRelevantNiche, isResearchRelevantPrepublish };

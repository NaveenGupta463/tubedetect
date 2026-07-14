// Tavily-powered web search for verified facts.
// Used before generation when compiledPolicy.config.needsWeb === true, and by the searchWeb tool.
// Returns { answer, sources } or null on failure.
// Free tier: 1,000 credits/month at tavily.com. search_depth 'basic' = 1 credit/query, 'advanced' =
// 2 credits/query — use 'basic' unless a specific caller genuinely needs deeper research, since the
// searchWeb tool can call this many times per request and cost multiplies fast.

const TAVILY_API = 'https://api.tavily.com/search';

async function search(query, niche = 'general', opts = {}) {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) {
    console.warn('[webSearch] TAVILY_API_KEY not set — skipping web search');
    return null;
  }

  let response;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 8000);
  try {
    response = await fetch(TAVILY_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: ac.signal,
      body: JSON.stringify({
        api_key:        apiKey,
        query:          query,
        search_depth:   'basic',
        include_answer: true,
        max_results:    5,
        ...(Array.isArray(opts.includeDomains) && opts.includeDomains.length ? { include_domains: opts.includeDomains } : {}),
      }),
    });
  } catch (err) {
    console.warn('[webSearch] fetch failed:', err.message);
    return null;
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    console.warn(`[webSearch] Tavily ${response.status}:`, body.slice(0, 120));
    return null;
  }

  let data;
  try {
    data = await response.json();
  } catch (err) {
    console.warn('[webSearch] JSON parse failed:', err.message);
    return null;
  }

  // Tavily returns data.answer (synthesized) + data.results (page snippets)
  const answer  = (data.answer || '').trim();
  const sources = (data.results || []).map(r => ({ url: r.url, title: r.title }));

  if (!answer) {
    console.warn('[webSearch] empty answer returned');
    return null;
  }

  console.log(`[webSearch] niche=${niche} sources=${sources.length} answer_len=${answer.length}`);
  return { answer, sources };
}

module.exports = { search };

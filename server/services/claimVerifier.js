'use strict';

// Dedicated claim-vs-source verification pass — deliberately SEPARATE from the creative generation
// call. A model juggling "write a compelling script" and "rigorously audit your own citations" at
// the same time tends to let the narrative win (observed: a real article got cited for a figure it
// never mentioned). Splitting verification into its own narrow, mechanical task — with no creative
// stakes — makes it actually check rather than rationalize. Batches all claims into ONE call.

const OpenAI = require('openai');
const MODEL = process.env.WTP_REFINER_MODEL || 'gpt-4.1-mini';
let _client = null;
function _ai() { if (_client) return _client; const k = process.env.OPENAI_API_KEY; if (!k) return null; _client = new OpenAI({ apiKey: k }); return _client; }

const SYS = `You verify factual claims against source text. You will get a numbered list of CLAIM + SOURCE TEXT pairs.
For each pair, decide if the source text actually, explicitly supports the claim.
Be strict: "supported" only if the source states this directly — not if it's merely related, plausible, or about the same topic. A source that doesn't mention the specific figure/fact in the claim does NOT support it.
Return ONLY JSON: {"results":[{"supported":true|false,"quote":"<exact sentence copied from the source text that supports it, or null if not supported>"}]} — one result per pair, in the SAME ORDER given. The quote must be copied verbatim from the source text, never paraphrased or invented.`;

async function verifyClaims(items) {
  const client = _ai();
  if (!client || !items?.length) return null;
  const user = items.map((it, i) =>
    `${i + 1}. CLAIM: "${it.claim}"\n   SOURCE TEXT: "${String(it.sourceText || '').slice(0, 1000)}"`
  ).join('\n\n');
  let resp;
  try {
    resp = await Promise.race([
      client.chat.completions.create({ model: MODEL, max_tokens: 2000, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: SYS }, { role: 'user', content: user }] }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 20000)),
    ]);
  } catch (e) { console.warn('[claimVerifier] failed:', e.message); return null; }
  const raw = resp.choices?.[0]?.message?.content || '';
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) { console.warn('[claimVerifier] no JSON in response'); return null; }
  let parsed; try { parsed = JSON.parse(m[0]); } catch (e) { console.warn('[claimVerifier] parse failed:', e.message); return null; }
  const results = Array.isArray(parsed.results) ? parsed.results : null;
  if (!results || results.length !== items.length) { console.warn('[claimVerifier] malformed or length-mismatched response'); return null; }
  return results;
}

module.exports = { verifyClaims };

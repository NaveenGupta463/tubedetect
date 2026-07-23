'use strict';

// PERSONALIZED trends — turns the global trend feed into "what should YOU make right now", in two
// modes:
//   • DIRECT   — a trend in the creator's own niche → their fresh take on it.
//   • CROSS-OVER — a big cultural trend OUTSIDE their niche that can be ANGLED into it (World Cup →
//                  a science channel: "the physics of a curving free kick"; a finance channel:
//                  "the economics of hosting a World Cup").
// The AI bridge both FILTERS (declines forced angles) and GENERATES the on-brand, format- and
// language-matched video idea. Seeded by the video-grounded trend engine (video_trend_signals) +
// its niche_spread signal (how culturally broad a trend is = how angle-able). 24h-cached per creator.

const OpenAI = require('openai');
const { searchPapers, isResearchRelevantNiche } = require('./researchGrounding');
const { mapAudienceGeoToCountry } = require('./countryContext');
const MODEL = process.env.WTP_REFINER_MODEL || 'gpt-4.1-mini';
const TTL_MS = 24 * 60 * 60 * 1000;
let _client = null;
function _ai() { if (_client) return _client; const k = process.env.OPENAI_API_KEY; if (!k) return null; _client = new OpenAI({ apiKey: k }); return _client; }

function ensureCache(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS personalized_trends_cache (
    channel_id TEXT PRIMARY KEY, payload_json TEXT NOT NULL, expires_at TEXT NOT NULL)`);
}

const SYS = `You turn TRENDING YouTube topics into specific, on-brand video ideas a creator should make NOW.
- DIRECT trend (in the creator's niche): propose their fresh, specific take on it.
- CROSS-OVER trend (outside their niche, but a big cultural moment): this is the MOST VALUABLE output. A big cultural trend (a World Cup, a festival, a blockbuster, a viral moment) can almost ALWAYS be angled into ANY niche through that niche's lens. ACTIVELY find that angle — do not be shy. Examples for "World Cup":
    • SCIENCE channel → "The Magnus effect: the physics of a curving free kick" / "How VAR & goal-line tech actually work"
    • FINANCE channel → "What hosting a World Cup actually costs a country" / "How much a footballer earns per goal"
    • FOOD channel → "What elite footballers eat during a tournament" / "World Cup game-day snacks"
    • EDUCATION channel → "The geography & history of this year's host nation"
  So for a SCIENCE creator, DO propose the physics/tech angle on a sports or news trend. For a FINANCE creator, the money angle. Etc.
- HEAD-START trend (trending UPSTREAM on TikTok in the West and/or on Indian Instagram, but NOT on YouTube yet): the HIGHEST-UPSIDE output — the trend is proven to travel West→India and hasn't reached YouTube, so propose a video to make NOW for first-mover advantage. Angle it into the creator's niche if there's an honest bridge (same discipline as cross-over); skip only if no genuine fit.
RULES:
- For each CROSS-OVER trend, genuinely try to find the creator-niche angle first. Skip a cross-over ONLY if there is truly no honest bridge (rare for big cultural trends). Aim to return at least 2-3 cross-over ideas when strong cultural trends are present.
- Do NOT force weird angles onto tiny/hyper-local trends — those can be skipped.
- Write the title in the creator's LANGUAGE/script and match their FORMAT (shorts = one punchy hook; long-form = a fuller concept).
- Never invent a trend not in the lists. Use the exact trend topic string.
- YEARS: today's date is given below. Do NOT write any year in a title unless it exactly matches the CURRENT year given, or literally appears in that trend's own sample title. Do not default to a year from memory/training (e.g. writing "2024" for a trend that is actually happening in the current year) — if unsure, omit the year entirely; a title with no year is always safe.
Return ONLY a JSON array: [{"trend":"<exact trend topic>","mode":"direct"|"crossover"|"headstart","title":"<the video title>","why":"<one line: why it fits this creator AND rides the trend>"}]`;

// The model reliably hallucinates a training-data year (e.g. "2024") into generated titles even
// when the real trend samples explicitly show the current year — a prompt instruction alone wasn't
// trusted to fix this consistently (same lesson learned elsewhere this session), so strip any year
// token that isn't the actual current year and doesn't literally appear in the trend's own sample title.
function _stripWrongYear(title, sampleTitle) {
  const curYear = String(new Date().getFullYear());
  return String(title || '').replace(/\b(19|20)\d{2}\b/g, (yr) => {
    if (yr === curYear) return yr;
    if (sampleTitle && String(sampleTitle).includes(yr)) return yr;
    return '';
  }).replace(/\s{2,}/g, ' ').replace(/\s+([.,!?])/g, '$1').trim();
}

async function _bridge(me, recent, direct, cross, head = []) {
  const client = _ai();
  if (!client) return null;
  const fmt = t => `- ${t.topic}${(() => { try { const s = JSON.parse(t.samples_json || '[]')[0]; return s ? ` (e.g. "${String(s.title).slice(0, 70)}")` : ''; } catch { return ''; } })()}`;
  const fmtHead = t => `- ${t.topic} [${t.status === 'coming_from_tiktok' ? 'US/UK TikTok' : t.status === 'coming_from_tiktok_and_ig' ? 'TikTok + Indian IG' : 'Indian Instagram'}, niche: ${t.niche}]`;
  const user = `TODAY'S DATE: ${new Date().toISOString().slice(0, 10)} (current year: ${new Date().getFullYear()})
CREATOR: ${me.channel_name} | niche=${me.niche} | format=${me.format_profile || '?'} | language=${me.primary_language || '?'} | region=${me.region || '?'}
RECENT VIDEOS (their voice/style — match it):
${recent.slice(0, 8).map(t => `- ${t}`).join('\n')}

DIRECT TRENDS (in this creator's niche — propose their take):
${direct.length ? direct.map(fmt).join('\n') : '(none)'}

CROSS-OVER TRENDS (big cultural trends OUTSIDE their niche — angle into their lane ONLY if genuine):
${cross.length ? cross.map(t => `${fmt(t)} [trending in: ${t.niche}]`).join('\n') : '(none)'}

HEAD-START TRENDS (hot UPSTREAM on TikTok/Instagram, NOT on YouTube yet — first-mover ideas; angle into their lane if genuine):
${head.length ? head.map(fmtHead).join('\n') : '(none)'}`;
  let resp;
  try {
    resp = await Promise.race([
      client.chat.completions.create({ model: MODEL, max_tokens: 2000, messages: [{ role: 'system', content: SYS }, { role: 'user', content: user }] }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 30000)),
    ]);
  } catch (e) { return null; }
  const raw = resp.choices?.[0]?.message?.content || '';
  const m = raw.match(/\[[\s\S]*\]/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

async function getPersonalizedTrends(db, channelId, { force = false } = {}) {
  if (!channelId) return { direct: [], crossover: [] };
  ensureCache(db);
  if (!force) {
    try { const c = db.get(`SELECT payload_json FROM personalized_trends_cache WHERE channel_id=? AND expires_at>datetime('now')`, [channelId]); if (c) return JSON.parse(c.payload_json); } catch (_) {}
  }
  const me = db.get(`SELECT channel_name, COALESCE(primary_niche,niche) niche, creator_mode, format_profile, primary_language, region, audience_geo FROM ingested_channels WHERE channel_id=?`, [channelId]);
  if (!me || !me.niche) return { direct: [], crossover: [] };
  const myNiche = String(me.niche).toLowerCase();
  // No hardcoded India fallback: an undetected region means "don't know", not "assume India".
  // video_trend_signals has zero region-agnostic rows, so filtering to a guessed region would
  // silently return nothing — instead, skip the region filter entirely (all regions, same as
  // the main Rising/Emerging tabs' default behavior) until a real region signal is known.
  const myRegion = mapAudienceGeoToCountry(me.audience_geo) || me.region || null;
  let recent = db.all(`SELECT title FROM ingested_videos WHERE channel_id=? AND COALESCE(is_short,0)=0 ORDER BY published_at DESC LIMIT 10`, [channelId]).map(r => r.title).filter(Boolean);
  if (recent.length < 4) recent = db.all(`SELECT title FROM ingested_videos WHERE channel_id=? ORDER BY published_at DESC LIMIT 10`, [channelId]).map(r => r.title).filter(Boolean);

  // Candidate trends (region-relevant). Direct = my niche is among the covering niches; cross-over =
  // a culturally-broad trend (niche_spread>=3) that is NOT in my niche.
  let trends = [];
  try {
    trends = myRegion
      ? db.all(`SELECT topic, niche, region, niche_spread, niches_json, channel_count_now, signal_score, samples_json FROM video_trend_signals WHERE signal_tier IN ('rising','emerging') AND (region=? OR region IS NULL) ORDER BY signal_score DESC, channel_count_now DESC LIMIT 500`, [myRegion])
      : db.all(`SELECT topic, niche, region, niche_spread, niches_json, channel_count_now, signal_score, samples_json FROM video_trend_signals WHERE signal_tier IN ('rising','emerging') ORDER BY signal_score DESC, channel_count_now DESC LIMIT 500`);
  } catch (_) { return { direct: [], crossover: [] }; }
  const directCand = [], crossCand = [];
  for (const t of trends) {
    let niches = []; try { niches = JSON.parse(t.niches_json || '[]').map(x => String(x.niche).toLowerCase()); } catch (_) {}
    const inMyNiche = String(t.niche).toLowerCase() === myNiche || niches.includes(myNiche);
    if (inMyNiche) { if (directCand.length < 10) directCand.push(t); }
    else if ((t.niche_spread || 0) >= 3) crossCand.push(t);
  }
  crossCand.sort((a, b) => (b.niche_spread - a.niche_spread) || (b.channel_count_now - a.channel_count_now));
  const cross = crossCand.slice(0, 12);

  // HEAD-START candidates: topics hot upstream (US/UK TikTok, Indian Instagram) but NOT yet on YouTube.
  // From the cross-platform lead job. Prioritize the longest lead (TikTok→ then TikTok+IG→ then IG) and
  // keep niche-relevant + broadly-relevant ones. Best-effort — table may not exist if IG/TikTok unwired.
  let head = [];
  try {
    const leads = db.all(`SELECT topic, niche, status, source, upstream_strength FROM platform_lead_signals
      WHERE status IN ('coming_from_tiktok','coming_from_tiktok_and_ig','early_on_instagram')
      ORDER BY CASE status WHEN 'coming_from_tiktok_and_ig' THEN 0 WHEN 'coming_from_tiktok' THEN 1 ELSE 2 END, upstream_strength DESC LIMIT 40`);
    head = leads.filter(t => String(t.niche).toLowerCase() === myNiche || ['general', 'news', 'lifestyle'].includes(String(t.niche).toLowerCase())).slice(0, 8);
    if (head.length < 4) for (const t of leads) { if (head.length >= 8) break; if (!head.includes(t)) head.push(t); } // top up with any strong leads
  } catch (_) {}

  const headMeta = new Map(head.map(t => [t.topic, t]));
  const meta = new Map([...directCand, ...cross].map(t => [t.topic, t]));
  const bridged = await _bridge(me, recent, directCand, cross, head);
  const out = { direct: [], crossover: [], headstart: [], computed_at: new Date().toISOString() };
  if (Array.isArray(bridged)) {
    for (const b of bridged) {
      if (!b.title) continue;
      // head-start ideas resolve against the lead table (no YouTube sample — they aren't on YouTube yet).
      if (b.mode === 'headstart') {
        const h = headMeta.get(b.trend); if (!h) continue;
        const title = _stripWrongYear(b.title, null);
        if (!title) continue;
        out.headstart.push({ title, why: b.why || null, trend: h.topic, trend_niche: h.niche, source: h.source, status: h.status });
        continue;
      }
      const t = meta.get(b.trend); if (!t) continue;
      let sample = null; try { sample = JSON.parse(t.samples_json || '[]')[0] || null; } catch (_) {}
      const title = _stripWrongYear(b.title, sample?.title);
      if (!title) continue;
      const item = { title, why: b.why || null, trend: t.topic, trend_niche: t.niche, trend_score: t.signal_score, sample };
      if (b.mode === 'crossover') out.crossover.push(item); else out.direct.push(item);
    }
  }

  // Research grounding: attach REAL fetched papers to each idea's trend topic — never trusted from
  // the LLM (_bridge never sees paper data at all, so there's zero hallucination surface here).
  // Gate once on the creator's own niche; a comedy/gaming creator doesn't need citations.
  const allItems = [...out.direct, ...out.crossover, ...out.headstart];
  if (isResearchRelevantNiche(myNiche) && allItems.length) {
    const topicsSeen = new Map();
    for (const item of allItems) {
      if (topicsSeen.size >= 8) break;
      if (!topicsSeen.has(item.trend)) topicsSeen.set(item.trend, null);
    }
    for (const trendTopic of topicsSeen.keys()) {
      const papers = await searchPapers(trendTopic, { db, limit: 3 }).catch(() => null);
      topicsSeen.set(trendTopic, papers || []);
    }
    for (const item of allItems) item.citations = topicsSeen.get(item.trend) || [];
  } else {
    for (const item of allItems) item.citations = [];
  }

  try { db.run(`INSERT OR REPLACE INTO personalized_trends_cache (channel_id, payload_json, expires_at) VALUES (?,?,?)`, [channelId, JSON.stringify(out), new Date(Date.now() + TTL_MS).toISOString()]); } catch (_) {}
  return out;
}

module.exports = { getPersonalizedTrends };

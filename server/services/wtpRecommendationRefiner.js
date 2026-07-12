'use strict';

const crypto = require('crypto');
const OpenAI = require('openai');
const { readCreatorIdeaDna } = require('./creatorIdeaDna');

// Synthesis layer: WRITES creator-fitted, filmable titles from (creator DNA + candidate
// topic). Proven on the pinned audit to lift recs from 1.56/5 (template passthrough) to
// 3.45/5, 52% useful, 12% Excellent — the ceiling-breaker. Replaces the old "enricher".
const REFINER_MODEL  = process.env.WTP_REFINER_MODEL || 'gpt-4.1-mini';
const REFINER_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_PER_STREAM = 8;       // candidates synthesized per stream (original_bets + ideas)
const TIMEOUT_MS     = 20_000;

let _client = null;
function getClient() {
  if (_client) return _client;
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('[wtpRefiner] Missing OPENAI_API_KEY');
  _client = new OpenAI({ apiKey: key });
  return _client;
}

// ── Cache ────────────────────────────────────────────────────────────────────
function ensureTable(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS wtp_refiner_cache (
    cache_key TEXT PRIMARY KEY, channel_id TEXT NOT NULL,
    payload_json TEXT NOT NULL, computed_at TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at TEXT NOT NULL)`);
}
function readCache(db, key) {
  try { ensureTable(db);
    const row = db.get(`SELECT payload_json FROM wtp_refiner_cache WHERE cache_key=? AND expires_at>datetime('now')`, [key]);
    return row ? JSON.parse(row.payload_json) : null;
  } catch (_) { return null; }
}
function writeCache(db, key, channelId, payload) {
  try { ensureTable(db);
    db.run(`INSERT INTO wtp_refiner_cache (cache_key, channel_id, payload_json, computed_at, expires_at)
            VALUES (?,?,?,datetime('now'),?)
            ON CONFLICT(cache_key) DO UPDATE SET payload_json=excluded.payload_json, computed_at=excluded.computed_at, expires_at=excluded.expires_at`,
      [key, channelId, JSON.stringify(payload), new Date(Date.now() + REFINER_TTL_MS).toISOString()]);
  } catch (_) {}
}

// ── Audience safety guard ────────────────────────────────────────────────────
// Kids channels were getting adult/off-domain recs (a toddler nursery channel rec'd
// "Creepiest Fact About The Human Body"; a kids channel rec'd a skincare "neck remedy").
// The model can't be trusted alone for child-safety, so we also guard deterministically:
// detect a children's audience, then drop any seed/synth-title carrying an adult subject.
const KIDS_RE = /\b(kids?|child(?:ren)?|nursery|rhymes?|toddlers?|preschool|kindergarten|cartoons?|toons?|babies|baby)\b|للأطفال|बच्चों|குழந்தை|పిల్లల|শিশু/i;
const ADULT_TOPICS = /\b(remed(?:y|ies)|skin\s?care|acne|wrinkles?|anti[\s-]?aging|weight\s?loss|fat\s?loss|belly\s?fat|longevity|live\s+(?:so\s+|super\s+|much\s+|way\s+)?long\w*|long\w*\s+(?:life|lives)|life\s+expectancy|diabetes|cholesterol|blood\s?pressure|detox|botox|dating|girlfriend|boyfriend|romance|alcohol|whiskey|beer|wine|gambling|casino|mortgage|investing|crypto|stock\s?market|murder|crime\s?scene|autopsy|creep(?:y|iest)|horror|nsfw|sex)\b/i;

function detectKidsAudience(db, channelId, params, payload) {
  const name = String(payload.channel_name || params.channel_name || '');
  if (KIDS_RE.test(name)) return true;
  let titles = [];
  try { titles = db.all(`SELECT title FROM ingested_videos WHERE channel_id=? AND title IS NOT NULL ORDER BY published_at DESC LIMIT 15`, [channelId]).map(r => r.title); } catch (_) {}
  if (titles.length < 5) return false;
  const hits = titles.filter(t => KIDS_RE.test(t)).length;
  return hits >= Math.max(2, Math.ceil(titles.length * 0.2));
}

// ── Language-consistency guard ───────────────────────────────────────────────
// Regional channels (esp. music) were getting cross-language recs: a Hindi channel rec'd
// "Tamil Evergreen Hits", a Kannada channel rec'd Tamil + Marathi titles — bleed from the
// null-language peer slice. For a creator with a KNOWN regional language, drop any rec whose
// script differs from theirs, or that explicitly names a DIFFERENT language. (en/null creators
// are unconstrained — they include legit multi-regional labels we can't second-guess.)
const LANG_SCRIPT = {
  hi: /[ऀ-ॿ]/, mr: /[ऀ-ॿ]/, bn: /[ঀ-৿]/, as: /[ঀ-৿]/, pa: /[਀-੿]/, gu: /[઀-૿]/,
  or: /[଀-୿]/, ta: /[஀-௿]/, te: /[ఀ-౿]/, kn: /[ಀ-೿]/, ml: /[ഀ-ൿ]/,
  ar: /[؀-ۿ]/, ur: /[؀-ۿ]/, th: /[฀-๿]/, ja: /[぀-ヿ]/, ko: /[가-힣]/, zh: /[一-鿿]/,
};
const ANY_NATIVE_SCRIPT = /[ऀ-ॿঀ-৿਀-੿઀-૿଀-୿஀-௿ఀ-౿ಀ-೿ഀ-ൿ฀-๿؀-ۿ぀-ヿ가-힣一-鿿]/;
const LANG_NAMES = {
  hi: /\bhindi\b|हिंदी|हिन्दी/i, mr: /\bmarathi\b|मराठी/i, ta: /\btamil\b|தமிழ்/i,
  te: /\btelugu\b|తెలుగు/i, kn: /\bkannada\b|ಕನ್ನಡ/i, ml: /\bmalayalam\b|മലയാളം/i,
  bn: /\b(bengali|bangla)\b|বাংলা/i, pa: /\bpunjabi\b|ਪੰਜਾਬੀ|पंजाबी/i,
  gu: /\bgujarati\b|ગુજરાતી/i, bho: /\bbhojpuri\b|भोजपुरी/i,
};
function titleLangMismatch(title, lang) {
  const expected = LANG_SCRIPT[lang];
  if (!expected) return false;                       // creator lang Latin/unknown → no constraint
  const t = String(title || '');
  // (a) script mismatch: title carries native script, but NOT the creator's script
  if (ANY_NATIVE_SCRIPT.test(t) && !expected.test(t)) return true;
  // (b) explicit foreign-language mention (catches same-script cases, e.g. "मराठी" on a Hindi channel)
  for (const [code, re] of Object.entries(LANG_NAMES)) {
    if (code === lang) continue;
    if (re.test(t)) return true;
  }
  return false;
}

// ── Creator context ────────────────────────────────────────────────────────────
function safeJson(s, fb) { try { return s ? JSON.parse(s) : fb; } catch (_) { return fb; } }
function listLabels(j, k) { return (safeJson(j, []) || []).slice(0, k).map(x => typeof x === 'string' ? x : x.label || x.id).filter(Boolean); }

function buildCreatorContext(db, channelId, params, payload, kids = false) {
  let dna = null;
  try { dna = readCreatorIdeaDna(db, channelId); } catch (_) {}
  const stable = dna?.stable_dna || safeJson(dna?.stable_dna_json, {}) || {};
  const c = stable?.creator_constraints || {};
  const lines = [];
  const niche = params.niche || payload.resolved_niche || c.niche || null;
  if (niche) lines.push(`Niche: ${niche}`);
  if (kids) lines.push(`Audience: CHILDREN — every title must be child-appropriate; never adult/health/beauty/scary/finance themes.`);
  if (c.csp) lines.push(`Content style: ${c.csp}`);
  if (c.content_archetype) lines.push(`Archetype: ${c.content_archetype}`);
  if (c.format_type) lines.push(`Format: ${c.format_type}`);
  if (c.language || c.region) lines.push(`Language/Region: ${c.language || params.language || '?'}/${c.region || params.region || '?'}`);
  const dom = listLabels(dna?.domain_tags_json, 8); if (dom.length) lines.push(`Domains: ${dom.join(', ')}`);
  const mic = listLabels(dna?.micro_topics_json, 10); if (mic.length) lines.push(`Topics they cover: ${mic.join(', ')}`);
  const hooks = listLabels(dna?.hook_templates_json, 4); if (hooks.length) lines.push(`Hook style: ${hooks.join(', ')}`);

  let recentTitles = [];
  try {
    recentTitles = db.all(`SELECT title FROM ingested_videos WHERE channel_id=? AND title IS NOT NULL ORDER BY published_at DESC LIMIT 10`, [channelId]).map(r => r.title);
  } catch (_) {}
  return { summary: lines.join('\n') || `Niche: ${niche || 'unknown'}`, recentTitles, channelName: payload.channel_name || params.channel_name || channelId };
}

// ── Synthesis prompt (proven on pinned audit) ────────────────────────────────────
const SYNTH_SYSTEM = `You are a senior YouTube content strategist who writes video concepts FOR a specific creator.

You are given the creator's identity (their niche, the topics they actually cover, their style, recent uploads) and a list of raw candidate topics (rough phrases extracted from their content and their peers' content). The raw candidates are often generic, fragmentary, or template-shaped.

For EACH candidate, write ONE genuinely good, specific, FILMABLE YouTube title that THIS creator would actually make — good enough they'd add it to their content calendar.

Rules:
- WRITE A REAL TITLE, don't just rephrase the fragment. Use the candidate as a SEED for the subject; add the specific angle, hook, stakes, or framing the creator would use.
- Unmistakably on-brand for this creator (their domain, format, audience, and LANGUAGE — if their uploads are in Hindi/another language, write the title in that language/style).
- Concrete and specific: name the real thing, the real tension, the real payoff. No vague "tips/secrets/guide to X" filler.
- DECLINE off-domain candidates. If the candidate's core SUBJECT is not something THIS creator actually covers (judge by their niche and recent uploads), set "title" to null. A polished title about the WRONG subject is worse than nothing — never rescue an off-topic fragment by inventing a plausible-sounding title around it.
- AUDIENCE SAFETY: if the creator makes content for children, EVERY title must be appropriate for young children. Never introduce adult or off-domain themes — health/medical remedies, skincare/beauty, weight loss, longevity, dating/romance, crime, horror/scary, gambling, or finance. Return null for any such candidate rather than softening it.
- Prefer a clear hook: a tension, surprise, stake, transformation, or specific number/object.

Return ONLY a JSON array, same length and order as the candidates:
[{ "i": <index>, "title": "<new title>" | null }]`;

function buildSynthUser(ctx, candidates) {
  return `CREATOR: ${ctx.channelName}
${ctx.summary}

Recent uploads:
${ctx.recentTitles.slice(0, 10).map((t, i) => `${i + 1}. ${t}`).join('\n') || '(none)'}

CANDIDATE TOPICS to turn into real titles (${candidates.length}):
${candidates.map((c, i) => `${i}. ${c.seed}${c.concept ? `  (concept: ${c.concept})` : ''}${c.cold ? '  (this is one of the creator\'s OWN recent uploads — propose a FRESH next video or related angle in the SAME language, NOT a copy)' : ''}`).join('\n')}

Return a JSON array of ${candidates.length} objects, one per candidate index.`;
}

async function callSynthAI(ctx, candidates) {
  const client = getClient();
  const resp = await Promise.race([
    client.chat.completions.create({
      model: REFINER_MODEL, max_tokens: 3000,
      messages: [
        { role: 'system', content: SYNTH_SYSTEM },
        { role: 'user', content: buildSynthUser(ctx, candidates) },
      ],
    }),
    new Promise((_, rej) => setTimeout(() => rej(new Error('[wtpRefiner] timeout')), TIMEOUT_MS)),
  ]);
  const raw = resp.choices?.[0]?.message?.content?.trim();
  if (!raw) throw new Error('[wtpRefiner] empty');
  const m = raw.match(/\[[\s\S]*\]/);
  if (!m) throw new Error('[wtpRefiner] non-JSON');
  return JSON.parse(m[0]);
}

// ── Title validation ─────────────────────────────────────────────────────────
// Sponsored / community-post / ad copy that leaks in from the peer pool (e.g. an Amazon
// "#ad" community post regurgitated verbatim as a "suggestion"). Never a video concept.
const AD_PROMO_RE = /#ad\b|\bsponsored\b|\bpaid partnership\b|\bpromo code\b|\buse code\b|\blink in (?:bio|description)\b|\bwith @\w+|\bgiveaway\b|\bswipe up\b|\bshop now\b|\bdiscount code\b/i;
function isAdLikeTitle(t) {
  return AD_PROMO_RE.test(String(t || ''));
}
function isValidTitle(t) {
  if (!t || typeof t !== 'string') return false;
  const s = t.trim();
  if (s.length < 10) return false;
  if (/\b(changes how you play|beginner settings|strategy most players? miss)\b/i.test(s)) return false;
  if (isAdLikeTitle(s)) return false;
  return true;
}

const renderedSeed = i => i.recommendation_title || i.ai_title || i.angle_title || i.action_title || i.title || i.topic || i.raw_subject || '';
// Unicode-aware: keep letters/numbers of ANY script so native-script seeds (Arabic,
// Bengali, Kannada, Devanagari) get distinct keys instead of collapsing to '' and colliding.
const seedKey = s => String(s || '').toLowerCase().replace(/[^\p{L}\p{N} ]/gu, ' ').replace(/\s+/g, ' ').trim();

// ── #(b) Topic-diversity reorder ────────────────────────────────────────────────
// A channel's top seeds often cluster on one subject (Preity → all "hair"), so every
// synthesized rec is that subject. Reorder each stream so distinct topic clusters
// interleave (best-of-each-cluster first) — keeps all recs, surfaces spread at the top.
const _FILLER = new Set(['mistake','hidden','cost','beginner','common','practical','guide','approach','change','changes','behind','status','trap','people','nobody','explains','clearly','simple','checklist','worth','overhyped','risk','returns','miss','benefits','loses','most','your','this','that','with','what','really','about','before','after','every','make','makes','using','only','more','best','need','should','could','would','video','shorts','part']);
function _sigWords(idea) {
  const s = String(idea.topic || idea.template_title || idea.title || '').toLowerCase();
  return [...new Set(s.replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length >= 4 && !_FILLER.has(w)))];
}
function _reorderByDiversity(arr) {
  if (!Array.isArray(arr) || arr.length <= 2) return arr;
  // Greedy cluster by shared significant word (transitive), preserving score order within.
  const wordToCluster = {}; const clusters = [];
  for (const idea of arr) {
    const words = _sigWords(idea);
    let cid = null;
    for (const w of words) if (w in wordToCluster) { cid = wordToCluster[w]; break; }
    if (cid == null) { cid = clusters.length; clusters.push([]); }
    clusters[cid].push(idea);
    for (const w of words) if (!(w in wordToCluster)) wordToCluster[w] = cid;
  }
  if (clusters.length <= 1) return arr;
  // Round-robin: best of each cluster, then 2nd of each, ... (high-score AND diverse).
  const out = [];
  for (let i = 0; out.length < arr.length; i++) {
    let any = false;
    for (const c of clusters) if (c[i] !== undefined) { out.push(c[i]); any = true; }
    if (!any) break;
  }
  return out;
}

function collectCandidates(payload) {
  const streamA = Array.isArray(payload.original_bets?.ideas) ? payload.original_bets.ideas
    : (Array.isArray(payload.original_bets) ? payload.original_bets : []);
  const streamB = Array.isArray(payload.ideas) ? payload.ideas : [];
  const out = [];
  // Stream A is now AI-generated upstream (wtpIdeaGenerator) — already final titles; don't re-polish.
  for (const idea of streamA.slice(0, MAX_PER_STREAM)) { if (idea.source === 'ai_generated') continue; out.push({ idea, seed: renderedSeed(idea), concept: idea.concept?.label || idea.concept_label || null }); }
  for (const idea of streamB.slice(0, MAX_PER_STREAM)) out.push({ idea, seed: renderedSeed(idea), concept: idea.concept?.label || idea.concept_label || idea.peer_concept_label || null });
  return out.filter(c => c.seed);
}

function applyTitleMap(payload, titleMap, candidateKeys, kids = false, lang = null) {
  // For each idea: if synth wrote a valid title → use it (✦). If the seed was SENT to
  // synth but it declined (no title) → DROP it — showing the raw template is exactly the
  // low-quality residue we want gone. Ideas never sent to synth → keep template.
  const mapDrop = arr => arr.map(idea => {
    const k = seedKey(renderedSeed(idea));
    const t = titleMap[k];
    let result;
    if (t && isValidTitle(t)) {
      // Cold-start echo guard: if synth just returned the creator's own title unchanged, drop it
      // rather than recommend an upload they already made.
      if (idea.source === 'cold_start' && seedKey(t) === k) return null;
      result = { ...idea, ai_title: t.trim(), recommendation_title: t.trim(), template_title: idea.template_title || idea.topic };
    } else if (candidateKeys && candidateKeys.has(k)) {
      return null; // synth asked + declined → drop
    } else {
      result = idea; // pass-through template idea (never sent to synth)
    }
    // Backstops on the FINAL title (covers synth output AND pass-through peer-bleed ideas):
    const finalText = result.ai_title || result.recommendation_title || result.title || result.template_title || result.topic || '';
    if (kids && ADULT_TOPICS.test(finalText)) return null;       // child-safety
    if (lang && titleLangMismatch(finalText, lang)) return null; // wrong-language / cross-script
    if (isAdLikeTitle(finalText)) return null;                   // sponsored / #ad / community-post bleed
    return result;
  }).filter(Boolean);
  const next = { ...payload };
  if (Array.isArray(payload.ideas)) next.ideas = _reorderByDiversity(mapDrop(payload.ideas));
  if (Array.isArray(payload.original_bets?.ideas)) next.original_bets = { ...payload.original_bets, ideas: _reorderByDiversity(mapDrop(payload.original_bets.ideas)) };
  else if (Array.isArray(payload.original_bets)) next.original_bets = _reorderByDiversity(mapDrop(payload.original_bets));
  return next;
}

// ── Public API ─────────────────────────────────────────────────────────────────
async function refineWtpRecommendations(db, wtpPayload, params) {
  const channelId = String(params?.channel_id || params?.channelId || '').trim();
  if (!channelId) return wtpPayload;
  const kids = detectKidsAudience(db, channelId, params, wtpPayload);
  const lang = (() => {
    try { return (db.get('SELECT primary_language FROM ingested_channels WHERE channel_id=?', [channelId]) || {}).primary_language || null; }
    catch (_) { return null; }
  })();
  let candidates = collectCandidates(wtpPayload);
  // Drop peer-bleed seeds carrying an adult subject before they ever reach the synth
  // (a kids channel should never be handed a "skincare remedy" / "longevity" seed).
  if (kids) candidates = candidates.filter(c => !ADULT_TOPICS.test(c.seed));

  // #2 COLD-START: regional/native-script & sparse channels yield ~0 extractable seeds
  // (Arabic/Bengali/Kannada titles → empty micro_topics → 0 original_bets), so they get
  // 0 usable recs. Seed the synth from the channel's OWN recent uploads — language-agnostic;
  // the synth writes fresh in-language ideas from them.
  if (candidates.length < 8) {
    const niche = String(params.niche || wtpPayload.resolved_niche
      || (db.get('SELECT COALESCE(primary_niche,niche) n FROM ingested_channels WHERE channel_id=?', [channelId]) || {}).n || '').toLowerCase();
    const isMusic = /music|song|singer|devotional/.test(niche);
    // Music: existing song-fragment candidates almost always get declined (can't recommend
    // song subjects), so trigger up to 8. Others: only when genuinely thin (<4).
    // Non-music cold-start seeds from the creator's OWN recent uploads, so only fire it when
    // there is GENUINELY nothing else (0 real candidates) — never pad a channel that already
    // has real recommendations with its own titles. Music uses generic format templates (not
    // own uploads), so it keeps the wider threshold.
    const coldThreshold = isMusic ? 8 : 1;
    if (candidates.length < coldThreshold) {
    const seen = new Set(candidates.map(c => seedKey(c.seed)));
    const coldIdeas = [];
    const addSeed = clean => {
      const k = seedKey(clean);
      if (!clean || clean.length < 8 || !k || seen.has(k)) return;
      seen.add(k);
      const idea = { topic: clean, source: 'cold_start', score: 28 };
      coldIdeas.push(idea);
      candidates.push({ idea, seed: clean, concept: null, cold: true });
    };
    if (isMusic) {
      // Musicians can't be told what to SING — seed FORMAT/packaging/occasion moves around
      // their existing catalog. Synth localizes these into the creator's language/style.
      [
        'A lyric video with on-screen lyrics for your most-loved recent song',
        'An acoustic / stripped-back version of your best-performing track',
        'Behind-the-song: the story and meaning of a recent release',
        'A 1-hour continuous loop of your most popular track',
        'A short Reel of the catchiest 15 seconds of a recent song',
        'A festival/occasion special performance with on-screen lyrics',
      ].forEach(addSeed);
    } else {
      let recent = [];
      try { recent = db.all(`SELECT title FROM ingested_videos WHERE channel_id=? AND title IS NOT NULL ORDER BY published_at DESC LIMIT 15`, [channelId]).map(r => r.title); } catch (_) {}
      for (const t of recent) {
        if (candidates.length >= 8) break;
        addSeed(String(t).replace(/#[^\s#]+/g, '').replace(/\s*\|\s*/g, ' ').replace(/\s+/g, ' ').trim());
      }
    }
    if (coldIdeas.length) wtpPayload = { ...wtpPayload, ideas: [...(Array.isArray(wtpPayload.ideas) ? wtpPayload.ideas : []), ...coldIdeas] };
    }
  }

  if (!candidates.length) return wtpPayload;
  const candidateKeys = new Set(candidates.map(c => seedKey(c.seed)));

  const fp = crypto.createHash('sha1').update(channelId + '::' + candidates.map(c => c.seed).join('|')).digest('hex');
  const cacheKey = `synth:${fp}`;

  const cached = readCache(db, cacheKey);
  if (cached) return { ...applyTitleMap(wtpPayload, cached, candidateKeys, kids, lang), ai_refined: true, ai_refined_source: 'cache' };

  try {
    const ctx = buildCreatorContext(db, channelId, params, wtpPayload, kids);
    const arr = await callSynthAI(ctx, candidates);
    const titleMap = {};
    for (const r of arr) {
      const idx = Number(r?.i);
      if (Number.isInteger(idx) && candidates[idx] && r.title) titleMap[seedKey(candidates[idx].seed)] = String(r.title);
    }
    writeCache(db, cacheKey, channelId, titleMap);
    return { ...applyTitleMap(wtpPayload, titleMap, candidateKeys, kids, lang), ai_refined: true, ai_refined_source: 'live' };
  } catch (err) {
    console.warn('[wtpRefiner] fallback:', err.message);
    // Never surface raw cold-start seeds (the creator's own uploads) when synth didn't run —
    // drop them rather than echo the channel's own titles back as "recommendations".
    const next = { ...wtpPayload, ai_refined: false, ai_refine_error: err.message };
    if (Array.isArray(next.ideas)) next.ideas = next.ideas.filter(i => i.source !== 'cold_start');
    return next;
  }
}

module.exports = { refineWtpRecommendations };

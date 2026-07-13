'use strict';

// AI GENERATOR for DNA Original Bets — replaces the template "mad-libs" engine
// (`How ${subject} can change your approach`) with genuinely NEW, on-brand, timely video
// concepts. Validated across talk/food/gaming/tech/beauty/podcast/comedy (see memory).
//
// Method: channel DNA (format + proven franchises, with a recent-event SPIKE auto-down-weighted)
//   × region-correct external signal (peer ecosystem + TMDB trending/upcoming where the channel
//   books guests) × novelty gate (never re-propose an existing upload). Robust: retry on parse
//   failure, 24h cache, and returns null on any failure so the caller keeps the template bets.

const crypto = require('crypto');
const OpenAI = require('openai');
const { resolveCreatorPeerContext } = require('./creatorPeerContext');
const { fetchTmdbSignals } = require('./externalSignals');
const { rerankBySemantic } = require('./channelEmbeddings');

const MODEL = process.env.WTP_REFINER_MODEL || 'gpt-4.1-mini';
const TTL_MS = 24 * 60 * 60 * 1000;
const TIMEOUT_MS = 20_000;

let _client = null;
function getClient() {
  if (_client) return _client;
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('[wtpGen] missing OPENAI_API_KEY');
  _client = new OpenAI({ apiKey: key });
  return _client;
}

// ── cache ──────────────────────────────────────────────────────────────────────
function ensureTable(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS wtp_generated_bets (
    cache_key TEXT PRIMARY KEY, channel_id TEXT NOT NULL,
    payload_json TEXT NOT NULL, computed_at TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at TEXT NOT NULL)`);
}
function readCache(db, key) {
  try { ensureTable(db); const r = db.get(`SELECT payload_json FROM wtp_generated_bets WHERE cache_key=? AND expires_at>datetime('now')`, [key]); return r ? JSON.parse(r.payload_json) : null; } catch (_) { return null; }
}
function writeCache(db, key, channelId, payload) {
  try { ensureTable(db); db.run(`INSERT INTO wtp_generated_bets (cache_key,channel_id,payload_json,computed_at,expires_at) VALUES (?,?,?,datetime('now'),?) ON CONFLICT(cache_key) DO UPDATE SET payload_json=excluded.payload_json, computed_at=excluded.computed_at, expires_at=excluded.expires_at`, [key, channelId, JSON.stringify(payload), new Date(Date.now() + TTL_MS).toISOString()]); } catch (_) {}
}

// ── helpers (validated in the _genV3 prototype) ─────────────────────────────────
const WESTERN = new Set(['US', 'CA', 'GB', 'EN', 'AU', 'IE', 'NZ']);
const STOP = new Set('the a an and or of to in on for with at by from is are how why what when this that your you our we my their his her its official video full live shorts feat episode part season new latest watch talk talks into just gets off out who will best top day'.split(' '));
// Unicode-aware: keep letters/numbers of ANY script (Devanagari/Tamil/Telugu/Bengali/Arabic/…) so
// non-English channels' words are counted by novelty/anchor/franchise logic instead of being
// stripped to nothing (which silently dropped their in-language bets).
const _clean = s => String(s).toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ');
const sig = s => new Set(_clean(s).split(/\s+/).filter(w => w.length >= 4 && !STOP.has(w)));
const tok = s => [...new Set(_clean(s).split(/\s+/).filter(w => w.length >= 4 && !STOP.has(w)))];
function entitiesOf(title, nameTok) {
  return (String(title).match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2}\b/g) || []).filter(e => !e.toLowerCase().split(/\s+/).every(w => nameTok.has(w)));
}
// Detect the channel's dominant non-Latin script from its own titles so we can tell the model to
// generate bets in that language (Hindi channel → Hindi bets, etc.).
const SCRIPT_RANGES = [
  ['Hindi/Marathi (Devanagari script)', /[ऀ-ॿ]/g],
  ['Bengali (Bangla script)',           /[ঀ-৿]/g],
  ['Odia (Odia script)',                /[଀-୿]/g],
  ['Punjabi (Gurmukhi script)',         /[਀-੿]/g],
  ['Gujarati script',                   /[઀-૿]/g],
  ['Tamil script',                      /[஀-௿]/g],
  ['Telugu script',                     /[ఀ-౿]/g],
  ['Kannada script',                    /[ಀ-೿]/g],
  ['Malayalam script',                  /[ഀ-ൿ]/g],
  ['Arabic/Urdu script',                /[؀-ۿ]/g],
];
function dominantScriptHint(titles) {
  const sample = titles.slice(0, 40);
  if (sample.length < 5) return '';
  for (const [name, re] of SCRIPT_RANGES) {
    const hits = sample.filter(t => (String(t).match(re) || []).length >= 3).length;
    if (hits >= Math.max(3, Math.ceil(sample.length * 0.25))) return name;
  }
  return '';
}
function recurringPhrases(titles, nameTok, hasSpike) {
  const c = {};
  for (const t of titles) {
    const w = _clean(t).split(/\s+/).filter(x => x.length > 2 && !/^\d+$/.test(x));
    for (let n = 2; n <= 4; n++) for (let i = 0; i + n <= w.length; i++) { const g = w.slice(i, i + n); if (g.every(x => STOP.has(x) || nameTok.has(x))) continue; const k = g.join(' '); c[k] = (c[k] || 0) + 1; }
  }
  return Object.entries(c).filter(([p, n]) => n >= 2 && !hasSpike(p)).sort((a, b) => b[1] - a[1]).slice(0, 14).map(([p]) => p);
}
// `ignore` = the channel's recurring FORMAT/brand words (e.g. "english","speaking","common" for a
// teaching channel). Excluding them makes novelty judge the TOPIC, so a fresh topic in a familiar
// format ("Say vs Tell" on an English channel) isn't wrongly killed as a duplicate.
function noveltyDup(title, ownSigs, ignore = null) {
  let a = sig(title);
  if (ignore && ignore.size) a = new Set([...a].filter(w => !ignore.has(w)));
  if (!a.size) return false;
  // A real re-proposal shares ≥2 distinctive words AND ≥50% overlap. Requiring ≥2 (not just a 50%
  // ratio) stops teaching/lesson channels — whose titles have only 1-2 topic words after format-word
  // removal ("Since vs For") — from being killed as dupes over a single shared word.
  for (const s of ownSigs) {
    let n = 0; for (const w of a) if (s.has(w)) n++;
    if (n >= 2 && n / a.size >= 0.5) return true;
  }
  return false;
}
const INTERVIEW = /\b(interview|talks?|reveal(s|ed)?|react(s|ed)?|sits? down|in conversation|opens? up|monologue|talk show|tonight show|late night|late show|explains?|addresses|breaks? down|shares?|discuss(es|ed)?|carpool|sketch|stand[- ]?up)\b/i;

// Guest-name provenance guard. The "DNA original bets" panel must stay on the creator's OWN
// roster — it was leaking peer-pool / invented guests ("ft. Virad Dubey", "with Prashant Kirad").
// Extract names introduced as guests; "ft./feat./featuring/w/" is a strong guest signal (allow
// 1–3 words), "with" needs 2–3 words to avoid concept false-positives ("with Anxiety").
function namedGuests(title) {
  const out = [];
  const strong = /\b(?:ft|feat|featuring|w\/)\.?\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})/g;
  const weak = /\bwith\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2})/g;
  let m;
  while ((m = strong.exec(title))) out.push(m[1]);
  while ((m = weak.exec(title))) out.push(m[1]);
  return out;
}
const isBrandOrChannel = (e, CN, MEDIA) => { const k = String(e).toLowerCase(); return CN.has(k) || CN.has(k.replace(/\s+/g, '')) || MEDIA.test(e); };
const MEDIA_RE = /\b(news|tv|official|prime video|netflix|youtube|tube|media|studios?|productions?|network|times|express|vevo|records?|entertainment|gamerz?|gaming|vlogs?)\b/i;

const SYS = `You are a senior YouTube content strategist proposing NEW video ideas a channel has NOT made yet.
Given the channel's format & franchises, a sample of what they've ALREADY made (never repeat/trivially re-word these), and FRESH OPPORTUNITIES (topics of interest in this market), propose genuinely new, specific, filmable concepts.
Rules: build on the channel's PROVEN franchises but with a NEW topic/angle/occasion; lean on the fresh opportunities ONLY where they naturally fit this channel's format; never propose anything in ALREADY MADE; no generic templates; if a "trending topic" does NOT fit what this channel actually does, IGNORE it.
GUEST SHOWS: when RECURRING GUESTS are listed, build MOST ideas by bringing back one of those guests for a genuinely NEW topic they have not covered (an old guest + a fresh angle is exactly what we want — e.g. a culture expert for a new cultural deep-dive). NAME the guest in the title. Do NOT invent new guest names. Avoid guestless generic essays.
GUEST-TOPIC FIT IS MANDATORY: the new topic MUST sit inside that guest's OWN domain (judge it from their "past topics"). A defence/geopolitics analyst gets a defence/geopolitics angle — NOT a wellness/masculinity/relationships topic; a singer gets a music angle; a finance founder gets a money/startup angle. Never assign the channel's generic self-improvement theme to a guest whose expertise is elsewhere.
NAMES: NEVER invent a guest or borrow a specific person's name from the FRESH OPPORTUNITIES list — those names are evidence of TOPIC interest, NOT bookable guests for this channel. You may name a specific person ONLY if that exact person already appears in ALREADY MADE (a proven guest of THIS channel). Otherwise, build the idea on the TOPIC/franchise, or refer to a guest generically by role (e.g. "a wellness coach", "a cricketer") — do not attach a real name.
NO FILLER: ban vague motivational shells — no "Secrets to…", "The Power of…", "Magic of…", "Powerful Life Lessons", "How X Shapes Success", "Mindset/Resilience" wrappers with no concrete subject. Name the real thing, tension, or payoff.
LANGUAGE: Write EVERY title in the SAME language and script as the channel's own recent uploads. If their titles are in Hindi/Devanagari, Tamil, Telugu, Bengali, Punjabi, etc., write the titles in THAT language and script (keep the English loanwords they themselves use). Do NOT translate their content into English.
DIVERSITY: (a) if the channel's recent uploads are dominated by ONE current event (championship/award/release/news cycle), treat that ENTIRE event as a SINGLE theme — AT MOST 2 of your ideas may relate to it; the rest MUST come from the channel's OTHER, evergreen franchises. (b) OUTPUT SPREAD (critical): your ideas must cover the channel's DIFFERENT proven franchises/formats — look at its recurring words/franchises and span a VARIETY. AT MOST 2 ideas may share the same core subject or recurring noun (e.g. do NOT make most ideas about "animals" if that is only one of many themes). Each idea should read like a different video, not a variation of the same one.
Return ONLY a JSON array: [{"title":"...","why":"one sentence"}]`;

// Per-format-group guidance injected into the prompt so each format gets format-appropriate
// ideas (shorts ≠ long-form; teaching ≠ vlog). Keyed by format_profile. guest_interview is
// handled separately by the RECURRING GUESTS rules above.
const FORMAT_BET_GUIDANCE = {
  shorts:                'FORMAT = SHORTS (<60s vertical). Every idea must be ONE punchy hook — a quick tip, surprising fact, myth-bust, POV, fast list ("3 things…"), or challenge — tight enough to shoot in under a minute. No long-form, interview, or multi-segment framing.',
  vlog:                  'FORMAT = VLOG. Propose day-in-the-life, behind-the-scenes, "a day doing X", routine, or experiential concepts rooted in the creator\'s real life/work — not abstract explainers or lists.',
  news_bulletin:         'FORMAT = NEWS ANALYSIS. Propose EVERGREEN analytical/explainer angles on the creator\'s beat (who benefits, the timeline, the real-world impact, what changes now). Do NOT propose specific breaking-news headlines or anything needing live/just-happened data.',
  solo_teaching:         'FORMAT = TEACHING. Propose specific lessons, how-tos, common-mistake breakdowns, comparisons ("X vs Y"), and skill modules within the creator\'s subject — concrete and immediately teachable.',
  lecture:               'FORMAT = LECTURE / EXAM-PREP. Propose syllabus topics, concept explainers, PYQ/question breakdowns, revision sessions, and high-yield practice for the creator\'s exam/subject.',
  curiosity_explainer:   'FORMAT = EXPLAINER. Propose question-led "why/how does X work" deep-dives into systems, products, money, or society that the creator can break down.',
  documentary:           'FORMAT = DOCUMENTARY. Propose investigative/story-driven deep-dives (the untold story, inside X, how Y really happened) in the creator\'s domain.',
  essay:                 'FORMAT = VIDEO ESSAY. Propose opinion/analysis angles ("why X", "the problem with Y", "what nobody tells you about Z") in the creator\'s domain.',
  podcast_like_longform: 'FORMAT = SOLO LONGFORM. Propose solo episode/monologue topics and deep-dive discussions the host can carry alone (no guest required).',
  reaction:              'FORMAT = REACTION/COMMENTARY. Propose react/breakdown concepts on relevant new material in the creator\'s lane.',
};

async function callAI(user) {
  const client = getClient();
  const resp = await Promise.race([
    client.chat.completions.create({ model: MODEL, max_tokens: 2600, messages: [{ role: 'system', content: SYS }, { role: 'user', content: user }] }),
    new Promise((_, rej) => setTimeout(() => rej(new Error('[wtpGen] timeout')), TIMEOUT_MS)),
  ]);
  const raw = resp.choices?.[0]?.message?.content?.trim() || '';
  const m = raw.match(/\[[\s\S]*\]/);
  if (!m) throw new Error('[wtpGen] non-JSON');
  return JSON.parse(m[0]);
}

// Returns array of { title, why } or null. Pure generation — caller builds idea objects.
async function generateBetTitles(db, channelId, meta = {}) {
  if (!channelId) return null;
  const niche = String(meta.niche || '').toLowerCase();
  if (/\bmusic\b/.test(niche)) return null;    // music = song-release channels → not this engine
  const fmtProfile  = String(meta.format_profile || '').toLowerCase();
  const fmtGuidance = FORMAT_BET_GUIDANCE[fmtProfile] || '';
  const allOwn = db.all(`SELECT title FROM ingested_videos WHERE channel_id=? AND title IS NOT NULL ORDER BY published_at DESC`, [channelId]).map(r => r.title);
  const scriptHint = dominantScriptHint(allOwn);
  if (allOwn.length < 8) return null;

  const cacheKey = 'gen:' + crypto.createHash('sha1').update(channelId + '::' + allOwn.slice(0, 30).join('|')).digest('hex');
  const cached = readCache(db, cacheKey);
  if (cached) return cached;

  const nameTok = new Set(String(meta.channel_name || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean));
  const ownSigs = allOwn.map(sig);
  const ownEnt = new Set(allOwn.flatMap(t => entitiesOf(t, nameTok)).map(e => e.toLowerCase()));
  // Recurring-word frequency across own titles → an "original bet" must anchor to a theme/guest
  // the channel actually recurs on (≥2 titles). Catches metaphor-stretch drift like "magic tricks
  // teach focus" where a one-off shared word ("magic" in "Culture Is Magic") is the only overlap.
  const ownFreq = {};
  for (const t of allOwn) for (const w of tok(t)) ownFreq[w] = (ownFreq[w] || 0) + 1;
  // FORMAT/brand words = appear in ≥20% of own titles (the repeating series/show vocabulary).
  // Excluded from the novelty check so fresh topics in a familiar format aren't dropped as dupes.
  const _formatWordCut = Math.max(4, Math.floor(allOwn.length * 0.20));
  const formatWords = new Set(Object.entries(ownFreq).filter(([, c]) => c >= _formatWordCut).map(([w]) => w));
  // Recurring GUESTS = proper-noun entities the channel has featured in ≥2 titles. For a
  // guest/interview show, the best original bets bring a recurring guest back for a NEW topic
  // (e.g. "Northeast tattoos ft. Rami Niranjan Desai" — old guest, fresh angle). Guestless
  // drift ("True Line Status", "Magic Tricks", "Demo Day") is exactly what we want to exclude.
  const ownEntFreq = {};
  for (const t of allOwn) for (const e of entitiesOf(t, nameTok)) { const k = e.toLowerCase(); if (!ownEntFreq[k]) ownEntFreq[k] = { display: e, n: 0 }; ownEntFreq[k].n++; }
  const recurringGuests = Object.values(ownEntFreq).filter(x => x.n >= 2).sort((a, b) => b.n - a.n).slice(0, 24).map(x => x.display);
  // Guest-anchoring is a PODCAST concept. Only apply it to guest_interview channels — for teaching/
  // tech/etc. the recurring TitleCase "entities" are TOPIC phrases ("Chain Rule", "Moving Average"),
  // not people; treating them as guests produced "with the Chain Rule Guest" artifacts.
  const guestDriven = fmtProfile === 'guest_interview' && recurringGuests.length >= 5;
  const _titleHasGuest = (title, parts) => {
    const lt = ' ' + String(title).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim() + ' ';
    return parts.every(p => lt.includes(' ' + p + ' '));
  };
  const namesRecurringGuest = (title) => recurringGuests.some(g => _titleHasGuest(title, g.toLowerCase().split(' ').filter(Boolean)));
  // Per-guest DOMAIN context: the channel's own past titles featuring each guest. Without this the
  // model puts every guest on the channel's dominant theme (a defence analyst → "modern masculinity").
  const guestContext = recurringGuests.slice(0, 14).map(g => {
    const parts = g.toLowerCase().split(' ').filter(Boolean);
    const ex = allOwn.filter(t => _titleHasGuest(t, parts)).slice(0, 2).map(e => e.replace(/[|#].*$/, '').trim());
    return `- ${g}${ex.length ? ` — past topics: ${ex.join(' / ')}` : ''}`;
  }).join('\n');
  const top = db.all(`SELECT title FROM ingested_videos WHERE channel_id=? ORDER BY views DESC LIMIT 12`, [channelId]).map(r => r.title);
  const step = Math.max(1, Math.floor(allOwn.length / 20));
  const spread = allOwn.filter((_, i) => i % step === 0).slice(0, 20);

  // recent-event spike → down-weight
  const rec40 = allOwn.slice(0, 40); const recF = {}, allF = {};
  for (const t of rec40) for (const w of tok(t)) recF[w] = (recF[w] || 0) + 1;
  for (const t of allOwn) for (const w of tok(t)) allF[w] = (allF[w] || 0) + 1;
  const spike = new Set();
  for (const [w, c] of Object.entries(recF)) { const rs = c / rec40.length, as = (allF[w] || 0) / allOwn.length; if (rs >= 0.2 && as < 0.8 * rs) spike.add(w); }
  const hasSpike = s => tok(s).some(w => spike.has(w));
  const franchises = recurringPhrases(allOwn, nameTok, hasSpike);
  let su = 0; const recent = allOwn.filter(t => { if (hasSpike(t)) { if (su >= 3) return false; su++; } return true; }).slice(0, 12);

  // region-aware peer opportunity signal (brand/channel names filtered out)
  const region = meta.region || null;
  const family = WESTERN.has(region) ? WESTERN : new Set([region].filter(Boolean));
  const CN = new Set(); try { for (const r of db.all('SELECT LOWER(channel_name) n FROM ingested_channels WHERE channel_name IS NOT NULL')) { CN.add(r.n); CN.add(r.n.replace(/\s+/g, '')); } } catch (_) {}
  let peerOpps = [];
  try {
    let pids = resolveCreatorPeerContext(db, channelId, {}).peerIds || [];
    if (family.size && pids.length) { const aph = pids.map(() => '?').join(','); const reg = {}; for (const r of db.all(`SELECT channel_id,region FROM ingested_channels WHERE channel_id IN (${aph})`, pids)) reg[r.channel_id] = r.region; pids = pids.filter(p => family.has(reg[p])); }
    // Layer 3: re-rank peers by SEMANTIC similarity so the fresh-opportunity signal comes from the
    // most genuinely-similar channels, not whoever shares the most words. No key/failure → no-op.
    try { pids = await rerankBySemantic(db, channelId, pids, { limit: 80 }); } catch (_) {}
    pids = pids.slice(0, 40);
    if (pids.length) {
      const ph = pids.map(() => '?').join(',');
      const pt = db.all(`SELECT title FROM (SELECT channel_id,title,ROW_NUMBER() OVER (PARTITION BY channel_id ORDER BY published_at DESC) rn FROM ingested_videos WHERE channel_id IN (${ph}) AND title IS NOT NULL) WHERE rn<=10`, pids).map(r => r.title);
      const f = {}; for (const t of pt) for (const e of entitiesOf(t, nameTok)) { const k = e.toLowerCase(); if (ownEnt.has(k) || isBrandOrChannel(e, CN, MEDIA_RE)) continue; f[k] = f[k] || { label: e, n: 0 }; f[k].n++; }
      peerOpps = Object.values(f).filter(x => x.n >= 2).sort((a, b) => b.n - a.n).slice(0, 14).map(x => x.label);
    }
  } catch (_) {}

  // external movie feed — only talk/interview formats, only when a real TMDB key is set
  let fresh = '';
  const freshPeople = new Set();   // genuine bookable public figures (TMDB) — exempt from the guest guard
  const useMovie = ['entertainment', 'comedy', 'talk'].includes(niche) && (rec40.filter(t => INTERVIEW.test(t)).length / Math.max(1, rec40.length)) >= 0.25;
  if (useMovie) {
    let tmdb = null; try { tmdb = await fetchTmdbSignals({ region, limit: 8 }); } catch (_) {}
    if (tmdb) { fresh += `TRENDING PEOPLE (book if they fit): ${tmdb.trendingPeople.map(p => p.name).join(', ')}\nUPCOMING RELEASES (tie a bit to these): ${tmdb.upcomingReleases.map(r => `${r.title} (${r.date})`).join(', ')}\n`; for (const p of tmdb.trendingPeople) freshPeople.add(String(p.name).toLowerCase()); }
  }
  // DNA Original Bets are PURE own-DNA (the panel says "not the peer pool"). Peer entities
  // were leaking in here as fake topics/guests ("True Line Status", "Indo-Canada Chamber") —
  // peers now have their own panels (Guests-to-invite, Community-hot, Themes). So we do NOT
  // inject peerOpps; the model builds only on the channel's franchises + already-made.
  void peerOpps;
  if (!fresh) fresh = '(none — build strictly from this channel\'s own franchises and recurring guests below)';

  const header = `CHANNEL: ${meta.channel_name} | niche=${niche} format=${meta.format_type || '?'} archetype=${meta.content_archetype || '?'} lang=${meta.primary_language || '?'}
${scriptHint ? `LANGUAGE: this channel posts in ${scriptHint} — write ALL titles in ${scriptHint}, matching their style.\n` : ''}${fmtGuidance ? fmtGuidance + '\n' : ''}FRANCHISES (recurring): ${franchises.join(', ') || '(none detected)'}
${guestDriven ? `RECURRING GUESTS — bring one back for a NEW topic that stays WITHIN their established area (do NOT move a guest onto an unrelated subject):\n${guestContext}` : ''}

ALREADY MADE (do NOT repeat):
${[...new Set([...recent, ...top, ...spread])].slice(0, 34).map(t => `- ${t}`).join('\n')}

FRESH OPPORTUNITIES:
${fresh}
`;

  // generate with one retry on parse failure (the model intermittently returns non-JSON)
  async function callAIWithRetry(user) {
    let a = null;
    for (let attempt = 0; attempt < 2 && !a; attempt++) {
      try { a = await callAI(user); } catch (_) { a = null; }
    }
    return a;
  }

  const total = meta.limit || 6;
  const hasAud = Array.isArray(meta.audienceRequests) && meta.audienceRequests.length;
  const hasReddit = !!meta.redditDiscussion;

  let arr;
  if (!hasAud && !hasReddit) {
    arr = await callAIWithRetry(header + `Propose ${total} NEW concepts as JSON.`) || [];
  } else {
    // Prompt-only steering (soft AND hard "mandatory split" instructions) proved unreliable — the
    // model kept drawing every idea from whichever source dominated, ignoring explicit quotas. So the
    // split is enforced in CODE instead: two independent calls, each asked for an exact count from
    // ONE source only, merged before the shared quality-gate filters (below) run on the combined set.
    const half = Math.ceil(total / 2);
    const audienceBlock = `${hasAud ? `\nAUDIENCE IS ASKING (real requests pulled from this channel's own comment sections — treat these as genuine signal):\n${meta.audienceRequests.map(r => `- ${r.phrase} (asked across ${r.video_count} videos, e.g. "${r.sample_quote}")`).join('\n')}\n` : ''}${hasReddit ? `\nWHAT PEOPLE DISCUSS ELSEWHERE (community signal, live web search):\n${meta.redditDiscussion}\n` : ''}`;
    const userFranchise = header + `Propose EXACTLY ${half} NEW concepts as JSON, built strictly from this channel's own FRANCHISES / RECURRING GUESTS / FRESH OPPORTUNITIES above. Spread across DIFFERENT franchises — do not fixate on one theme.`;
    const userAudience = header + audienceBlock + `Propose EXACTLY ${total - half} NEW concepts as JSON, each grounded in a DIFFERENT item from AUDIENCE IS ASKING / WHAT PEOPLE DISCUSS ELSEWHERE above — spread across distinct requests, at most 2 concepts may share the same underlying issue. Ignore FRANCHISES/RECURRING GUESTS for this batch.`;
    const [arrF, arrA] = await Promise.all([callAIWithRetry(userFranchise), callAIWithRetry(userAudience)]);
    arr = [...(arrF || []), ...(arrA || [])];
  }
  if (!Array.isArray(arr) || !arr.length) return null;

  const out = [];
  const seen = new Set();
  const topicCount = {};   // non-guest channels: cap bets sharing the same TOPIC word (spread franchises)
  const _drop = { short: 0, annc: 0, dup: 0, novelty: 0, foreign: 0, anchor: 0, topic: 0 };
  for (const it of arr) {
    const title = String(it?.title || '').trim();
    if (title.length < 10) { _drop.short++; continue; }
    // Announcement / promo titles are not new video IDEAS (e.g. Raj Shamani's "Podcast Out Now: …").
    if (/\b(out now|out tomorrow|out today|streaming now|now streaming|coming soon|new episode|full episode out|link in (?:bio|desc)|premieres?|watch now|releasing (?:now|today|tomorrow))\b/i.test(title)) { _drop.annc++; continue; }
    // Breaking/live-news leaks — news_bulletin bets must be EVERGREEN analysis, not a live headline.
    if (/\bbreaking\s*news\b|\bbreaking:|\blive\s*(?:news|update|coverage|:)|\bjust\s+in\b/i.test(title)) { _drop.annc++; continue; }
    const k = sig(title); const kk = [...k].sort().join(' ');
    if (seen.has(kk)) { _drop.dup++; continue; }
    // Skip the cross-history novelty guard for news_bulletin: news revisits topics with fresh angles,
    // and a 700+-title news pool makes ≥50% overlap near-certain (false dups). Intra-batch dedup (seen) still applies.
    if (fmtProfile !== 'news_bulletin' && noveltyDup(title, ownSigs, formatWords)) { _drop.novelty++; continue; }
    // DNA-only provenance: drop any title naming a guest who isn't a proven guest of THIS
    // channel (or a genuine TMDB trending figure). Kills peer-pool / hallucinated names.
    const foreignGuest = namedGuests(title).some(g => {
      const gk = g.toLowerCase();
      if (ownEnt.has(gk) || freshPeople.has(gk)) return false;
      if (isBrandOrChannel(g, CN, MEDIA_RE)) return false;
      return true;
    });
    if (foreignGuest) { _drop.foreign++; continue; }
    // Anchor gate. Guest/interview shows: each bet MUST bring back a recurring guest (new topic) —
    // this kills guestless drift while allowing "same guest, fresh angle". Other channels: the bet
    // must build on a recurring own-content word (theme).
    // news_bulletin has highly diverse vocabulary (every story is new) so the recurring-word anchor
    // wrongly drops everything — skip it there (format+niche guidance keeps it on-beat).
    const anchorFail = guestDriven ? !namesRecurringGuest(title)
      : (fmtProfile !== 'news_bulletin' && !tok(title).some(w => (ownFreq[w] || 0) >= 2));
    if (anchorFail) { _drop.anchor++; continue; }
    // Topic-spread cap (non-guest shows): ≤2 kept bets may share the same TOPIC word (excluding the
    // channel's own format words). Stops the model fixating on one minor theme (e.g. 8 "animal" bets
    // for MrBeast whose franchises are diverse). Guest shows are spread by guest variety instead.
    if (!guestDriven) {
      const topicWords = tok(title).filter(w => !formatWords.has(w));
      if (topicWords.some(w => (topicCount[w] || 0) >= 3)) { _drop.topic++; continue; }
      for (const w of topicWords) topicCount[w] = (topicCount[w] || 0) + 1;
    }
    seen.add(kk);
    out.push({ title, why: String(it?.why || '').trim() });
  }
  if (process.env.WTP_GEN_DEBUG) console.error(`[wtpGen] ${meta.channel_name}: proposed=${arr.length} kept=${out.length} guestDriven=${guestDriven} drops=${JSON.stringify(_drop)}`);
  if (!out.length) return null;
  writeCache(db, cacheKey, channelId, out);
  return out;
}

// Best-matching own video for a generated title (so the "source" evidence stays relevant).
function bestEvidence(title, ownVideos) {
  const a = sig(title); if (!a.size) return null;
  let best = 0, bestV = null;
  for (const v of ownVideos) { const s = sig(v.title); let n = 0; for (const w of a) if (s.has(w)) n++; const r = n / a.size; if (r > best) { best = r; bestV = v; } }
  return best >= 0.2 ? bestV : null; // require a real overlap, else show no (mismatched) evidence
}

// Public: returns a NEW original_bets.ideas array (generated), or null to keep the template bets.
// Reuses the template bet objects as scaffolds so the UI schema is preserved; swaps the title +
// attaches the most relevant own video as evidence.
async function generateOriginalBets(db, channelId, scaffoldIdeas, meta = {}) {
  let titles = null;
  try { titles = await generateBetTitles(db, channelId, meta); } catch (_) { return null; }
  if (!titles || !titles.length) return null;

  const ownVideos = db.all(`SELECT title, views FROM ingested_videos WHERE channel_id=? AND title IS NOT NULL ORDER BY views DESC LIMIT 200`, [channelId]);
  const scaffolds = Array.isArray(scaffoldIdeas) && scaffoldIdeas.length ? scaffoldIdeas : null;
  // Cap by the requested limit (a reserve pool for dismiss-backfill), NOT by scaffold count —
  // scaffolds are reused cyclically (scaffolds[i % len]) so n may safely exceed scaffolds.length.
  const n = Math.min(titles.length, meta.limit || (scaffolds ? Math.max(scaffolds.length, 6) : 6));

  const ideas = [];
  for (let i = 0; i < n; i++) {
    const t = titles[i]; if (!t) break;
    const base = scaffolds ? { ...scaffolds[i % scaffolds.length] } : { score: 70, opportunity_band: 'evergreen', wtp_score: 70 };
    const ev = bestEvidence(t.title, ownVideos);
    ideas.push({
      ...base,
      topic: t.title,
      recommendation_title: t.title,
      ai_title: t.title,
      template_title: base.topic || base.template_title || null,
      rationale: t.why || base.rationale || null,
      source: 'ai_generated',
      evidence: ev ? [{ title: ev.title, views: ev.views }] : (base.evidence || []),
      idea_key: crypto.createHash('sha1').update(channelId + '::gen::' + t.title).digest('hex').slice(0, 16),
    });
  }
  return ideas.length ? ideas : null;
}

// ── Guest pitches ────────────────────────────────────────────────────────────
// For guests rival podcasts feature but THIS channel never has, write a specific,
// channel-fitted topic to discuss + one line on fit. Batched, 24h-cached. Returns a
// map name→{topic,fit} (only for guests the model judged a genuine person + good fit).
const GUEST_SYS = `You are a senior YouTube podcast strategist. You are given a host channel (its themes + recent episodes) and a list of CANDIDATE GUESTS that rival podcasts have featured but this host has NOT.
For each candidate, decide if they are a real person who would genuinely fit this host's show. If yes, write:
- "topic": ONE specific, fresh conversation this host should have with them — fitted to the host's themes and the guest's domain (use the evidence titles as a hint for what the guest is known for). Be concrete, not "discuss their journey".
- "fit": ONE short line on why this guest fits this host's audience.
If the candidate is NOT a real, nameable person (a show/segment/brand/series name, an abstract concept or emotion like "Anger Issues", or a generic phrase), or would not fit the host, return null for that candidate.
Return ONLY a JSON array, same length and order as the input: [{ "i": <index>, "topic": "<...>"|null, "fit": "<...>"|null }]`;

async function generateGuestPitches(db, channelId, guests, meta = {}) {
  if (!channelId || !Array.isArray(guests) || !guests.length) return null;
  const slate = guests.slice(0, 12);
  const recent = db.all(`SELECT title FROM ingested_videos WHERE channel_id=? AND title IS NOT NULL ORDER BY published_at DESC LIMIT 12`, [channelId]).map(r => r.title);

  const cacheKey = 'guests:' + crypto.createHash('sha1').update(channelId + '::' + slate.map(g => g.name).join('|')).digest('hex');
  const cached = readCache(db, cacheKey);
  if (cached) return cached;

  const user = `HOST CHANNEL: ${meta.channel_name || channelId} | niche=${meta.niche || '?'} | themes=${(meta.target_lanes || []).join(', ') || '?'}
RECENT EPISODES:
${recent.map(t => `- ${t}`).join('\n') || '(none)'}

CANDIDATE GUESTS (rivals feature them; this host hasn't):
${slate.map((g, i) => `${i}. ${g.name}${g.matched_lane ? ` [lane: ${g.matched_lane}]` : ''} — peers discussed: ${(g.evidence_titles || []).slice(0, 3).join(' | ') || '(no evidence)'}`).join('\n')}

Return a JSON array of ${slate.length} objects, one per candidate index.`;

  let arr = null;
  for (let attempt = 0; attempt < 2 && !arr; attempt++) {
    try {
      const client = getClient();
      const resp = await Promise.race([
        client.chat.completions.create({ model: MODEL, max_tokens: 1200, messages: [{ role: 'system', content: GUEST_SYS }, { role: 'user', content: user }] }),
        new Promise((_, rej) => setTimeout(() => rej(new Error('[wtpGen] guest timeout')), TIMEOUT_MS)),
      ]);
      const raw = resp.choices?.[0]?.message?.content?.trim() || '';
      const m = raw.match(/\[[\s\S]*\]/);
      if (m) arr = JSON.parse(m[0]);
    } catch (_) { arr = null; }
  }
  if (!Array.isArray(arr)) return null;

  const out = {};
  for (const r of arr) {
    const idx = Number(r?.i);
    if (!Number.isInteger(idx) || idx < 0 || idx >= slate.length) continue;
    const topic = String(r?.topic || '').trim();
    if (!topic) continue;                       // model declined (not a person / bad fit)
    out[slate[idx].name] = { topic, fit: String(r?.fit || '').trim() || null };
  }
  writeCache(db, cacheKey, channelId, out);
  return out;
}

module.exports = { generateOriginalBets, generateBetTitles, generateGuestPitches };

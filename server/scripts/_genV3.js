'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const OpenAI = require('openai');
const { getDb } = require('../db/init');
const { resolveCreatorPeerContext } = require('../services/creatorPeerContext');
const { fetchTmdbSignals } = require('../services/externalSignals');
const db = getDb();
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = process.env.WTP_REFINER_MODEL || 'gpt-4.1-mini';

const MOCK_TMDB = {
  market: 'US (ILLUSTRATIVE — add TMDB_API_KEY for live)',
  trendingPeople: [
    { name: 'Glen Powell', knownFor: ['Twisters'] }, { name: 'Sydney Sweeney', knownFor: ['Euphoria'] },
    { name: 'Pedro Pascal', knownFor: ['The Last of Us'] }, { name: 'Zendaya', knownFor: ['Dune'] }, { name: 'Jenna Ortega', knownFor: ['Wednesday'] },
  ],
  upcomingReleases: [
    { title: 'Spider-Man: Brand New Day', date: '2026-07-31' }, { title: 'The Mandalorian and Grogu', date: '2026-05-22' },
  ],
};

const WESTERN = new Set(['US', 'CA', 'GB', 'EN', 'AU', 'IE', 'NZ']);
// Fix 2: peer entities that are actually CHANNELS / media brands (not bookable guests/topics).
const CN = new Set();
for (const r of db.all('SELECT LOWER(channel_name) n FROM ingested_channels WHERE channel_name IS NOT NULL')) { CN.add(r.n); CN.add(r.n.replace(/\s+/g, '')); }
const MEDIA = /\b(news|tv|official|prime video|netflix|youtube|tube|media|studios?|productions?|network|times|express|vevo|records?|entertainment|gamerz?|gaming|vlogs?)\b/i;
const isBrandOrChannel = e => { const k = String(e).toLowerCase(); return CN.has(k) || CN.has(k.replace(/\s+/g, '')) || MEDIA.test(e); };
const STOP = new Set('the a an and or of to in on for with at by from is are how why what when this that your you our we my their his her its official video full live shorts feat episode part season new latest watch talk talks into just gets off out who will best top day'.split(' '));
const sig = s => new Set(String(s).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length >= 4 && !STOP.has(w)));
function entitiesOf(title, nameTok) {
  return (String(title).match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2}\b/g) || [])
    .filter(e => !e.toLowerCase().split(/\s+/).every(w => nameTok.has(w)));
}
function recurringPhrases(titles, nameTok) {
  const c = {};
  for (const t of titles) {
    const w = String(t).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(x => x.length > 2 && !/^\d+$/.test(x));
    for (let n = 2; n <= 4; n++) for (let i = 0; i + n <= w.length; i++) {
      const g = w.slice(i, i + n);
      if (g.every(x => STOP.has(x) || nameTok.has(x))) continue;
      const k = g.join(' '); c[k] = (c[k] || 0) + 1;
    }
  }
  return Object.entries(c).filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).slice(0, 14).map(([p]) => p);
}
function noveltyDup(title, ownSigs) {
  const a = sig(title); if (!a.size) return null;
  let best = 0, bestT = null;
  for (const o of ownSigs) { let n = 0; for (const w of a) if (o.set.has(w)) n++; const r = n / a.size; if (r > best) { best = r; bestT = o.title; } }
  return best >= 0.5 ? { ratio: best, title: bestT } : null;
}

const SYS = `You are a senior YouTube content strategist proposing NEW video ideas a channel has NOT made yet.
Given the channel's format & franchises, a sample of what they've ALREADY made (never repeat/trivially re-word these), FRESH OPPORTUNITIES (timely people/topics), propose 8 genuinely new, specific, filmable concepts.
Rules: build on the channel's PROVEN franchises but with a NEW guest/topic/angle/occasion; lean on the fresh opportunities ONLY where they naturally fit this channel's format; never propose anything in ALREADY MADE; no generic templates. If a "trending person / upcoming release" does NOT fit what this channel actually does, IGNORE it.
DIVERSITY: if the channel's recent uploads are dominated by ONE current event (a championship/award/release/news cycle), treat that ENTIRE event as a SINGLE theme — AT MOST 2 of your 8 ideas may relate to it; the majority MUST come from the channel's OTHER, evergreen franchises.
Return ONLY JSON: [{"title":"...","theme":"...","new_element":"the fresh guest/topic/angle this introduces","why":"one sentence"}]`;

async function runChannel(name) {
  const ch = db.get(`SELECT channel_id, channel_name, region, COALESCE(primary_niche,niche) niche, format_type, content_archetype, primary_language FROM ingested_channels WHERE channel_name LIKE ? ORDER BY channel_subscribers DESC LIMIT 1`, [`%${name}%`]);
  if (!ch) { console.log(`\n##### ${name}: NOT FOUND`); return; }
  const id = ch.channel_id;
  const nameTok = new Set(String(ch.channel_name).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean));
  const allOwn = db.all(`SELECT title FROM ingested_videos WHERE channel_id=? AND title IS NOT NULL ORDER BY published_at DESC`, [id]).map(r => r.title);
  if (allOwn.length < 8) { console.log(`\n##### ${ch.channel_name}: only ${allOwn.length} videos — skip`); return; }
  // Fix 3: news/politics is event-driven — DNA recombination just duplicates past coverage.
  if (/\bnews\b|politic/i.test(ch.niche)) { console.log(`\n##### ${ch.channel_name} [${ch.niche}] — SKIPPED (event-driven; needs a real-time news feed, not the DNA generator)`); return; }
  const ownSigs = allOwn.map(t => ({ title: t, set: sig(t) }));
  const ownEnt = new Set(allOwn.flatMap(t => entitiesOf(t, nameTok)).map(e => e.toLowerCase()));
  const top = db.all(`SELECT title FROM ingested_videos WHERE channel_id=? ORDER BY views DESC LIMIT 12`, [id]).map(r => r.title);
  const step = Math.max(1, Math.floor(allOwn.length / 20));
  const spread = allOwn.filter((_, i) => i % step === 0).slice(0, 20);

  // Detect a recent-event SPIKE: tokens that dominate RECENT uploads but are rare ALL-TIME
  // (e.g. a championship week). Auto down-weight so it can't hijack every idea — generalizes
  // the per-channel NBA hack.
  const tok = s => [...new Set(String(s).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length >= 4 && !STOP.has(w)))];
  const rec40 = allOwn.slice(0, 40);
  const recF = {}, allF = {};
  for (const t of rec40) for (const w of tok(t)) recF[w] = (recF[w] || 0) + 1;
  for (const t of allOwn) for (const w of tok(t)) allF[w] = (allF[w] || 0) + 1;
  const spike = new Set();
  for (const [w, c] of Object.entries(recF)) {
    const rs = c / rec40.length, as = (allF[w] || 0) / allOwn.length;
    if (rs >= 0.2 && as < 0.8 * rs) spike.add(w); // recent rate notably exceeds historical rate
  }
  const hasSpike = s => tok(s).some(w => spike.has(w));
  // franchises minus the spike; recent capped so the spike contributes ≤3 sample titles
  const franchises = recurringPhrases(allOwn, nameTok).filter(p => !hasSpike(p));
  let spikeUsed = 0;
  const recent = allOwn.filter(t => { if (hasSpike(t)) { if (spikeUsed >= 3) return false; spikeUsed++; } return true; }).slice(0, 12);

  // region-aware peer opportunity signal
  const family = WESTERN.has(ch.region) ? WESTERN : new Set([ch.region].filter(Boolean));
  let peerOpps = [];
  try {
    let pids = resolveCreatorPeerContext(db, id, {}).peerIds || [];
    if (family.size && pids.length) {
      const aph = pids.map(() => '?').join(',');
      const reg = {}; for (const r of db.all(`SELECT channel_id, region FROM ingested_channels WHERE channel_id IN (${aph})`, pids)) reg[r.channel_id] = r.region;
      pids = pids.filter(p => family.has(reg[p]));
    }
    pids = pids.slice(0, 40);
    if (pids.length) {
      const ph = pids.map(() => '?').join(',');
      const pt = db.all(`SELECT title FROM (SELECT channel_id,title,ROW_NUMBER() OVER (PARTITION BY channel_id ORDER BY published_at DESC) rn FROM ingested_videos WHERE channel_id IN (${ph}) AND title IS NOT NULL) WHERE rn<=10`, pids).map(r => r.title);
      const f = {};
      for (const t of pt) for (const e of entitiesOf(t, nameTok)) { const k = e.toLowerCase(); if (ownEnt.has(k) || isBrandOrChannel(e)) continue; f[k] = f[k] || { label: e, n: 0 }; f[k].n++; }
      peerOpps = Object.values(f).filter(x => x.n >= 2).sort((a, b) => b.n - a.n).slice(0, 14).map(x => x.label);
    }
  } catch (_) {}

  // Fix 1 (v2): movie/guest feed ONLY for talk/interview shows. Title-Case proper-noun counting
  // was unreliable (MrBeast/Kabita are Title-Case-heavy → false positives → Spider-Man recipes).
  // Use INTERVIEW-action markers instead (talk shows: "talks/reveals/reacts/monologue/sits down"),
  // gated to entertainment/comedy niches.
  const recent40 = allOwn.slice(0, 40);
  const INTERVIEW = /\b(interview|talks?|reveal(s|ed)?|react(s|ed)?|sits? down|in conversation|opens? up|monologue|talk show|tonight show|late night|late show|explains?|addresses|breaks? down|shares?|discuss(es|ed)?|carpool|sketch|stand[- ]?up)\b/i;
  const interviewRatio = recent40.length ? recent40.filter(t => INTERVIEW.test(t)).length / recent40.length : 0;
  const useMovie = ['entertainment', 'comedy', 'talk'].includes(ch.niche) && interviewRatio >= 0.25;
  let tmdb = null, tmdbLive = false;
  if (useMovie) { try { tmdb = await fetchTmdbSignals({ region: ch.region, limit: 8 }); tmdbLive = !!tmdb; } catch (_) {} if (!tmdb) tmdb = MOCK_TMDB; }

  let fresh = '';
  if (tmdb) fresh += `TRENDING PEOPLE (book if they fit): ${tmdb.trendingPeople.map(p => p.name).join(', ')}\nUPCOMING RELEASES (tie a bit to these): ${tmdb.upcomingReleases.map(r => `${r.title} (${r.date})`).join(', ')}\n`;
  fresh += `FROM SAME-MARKET PEERS (topics/guests rivals feature, this channel hasn't): ${peerOpps.join(', ') || '(none)'}`;

  const user = `CHANNEL: ${ch.channel_name} | niche=${ch.niche} format=${ch.format_type} archetype=${ch.content_archetype} lang=${ch.primary_language} region=${ch.region}
FRANCHISES (recurring): ${franchises.join(', ') || '(none detected)'}

ALREADY MADE (do NOT repeat):
${(() => { const mg = [...new Set([...recent, ...top, ...spread])]; let su = 0; return mg.filter(t => { if (hasSpike(t)) { if (su >= 3) return false; su++; } return true; }).slice(0, 34); })().map(t => `- ${t}`).join('\n')}

FRESH OPPORTUNITIES:
${fresh}

Propose 8 NEW concepts as JSON.`;

  console.log(`\n##### ${ch.channel_name}  [${ch.primary_language}/${ch.niche}/${ch.content_archetype}] — interviewRatio=${interviewRatio.toFixed(2)} movieFeed=${useMovie ? (tmdbLive ? 'live' : 'mock') : 'OFF'} peerOpps=${peerOpps.length}`);
  console.log(`   franchises: ${franchises.slice(0, 8).join(' | ') || '-'}`);
  const resp = await client.chat.completions.create({ model: MODEL, max_tokens: 1500, messages: [{ role: 'system', content: SYS }, { role: 'user', content: user }] });
  const raw = resp.choices?.[0]?.message?.content?.trim() || '';
  const m = raw.match(/\[[\s\S]*\]/);
  let ideas = []; try { ideas = JSON.parse(m ? m[0] : raw); } catch (_) { console.log('   parse fail'); return; }
  ideas.forEach((i, n) => {
    const dup = noveltyDup(i.title, ownSigs);
    console.log(`   ${n + 1}. ${dup ? '❌DUP' : '✅'} ${i.title}`);
    console.log(`        +${i.new_element || '-'}`);
  });
}

(async () => {
  const arg = process.argv.slice(2).join(' ');
  const list = arg ? arg.split('|') : ['MrBeast', 'Aaj Tak', 'Kabita', 'Total Gaming', 'Mark Rober'];
  for (const nm of list) { try { await runChannel(nm.trim()); } catch (e) { console.log(nm, 'ERR', e.message); } }
  db.close();
})();

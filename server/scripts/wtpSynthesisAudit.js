'use strict';

/**
 * WTP Synthesis Audit
 *
 * Tests the ONE lever left after ranking/gating/affinity were proven flat (all ~1.56/5):
 * an AI SYNTHESIS layer that WRITES a specific, creator-fitted, filmable title from
 * (creator DNA + candidate topic + concept + peer evidence) — instead of passing through
 * template-fills / raw peer titles.
 *
 * For each pinned channel:
 *   1. computeWhatToPost → top-N rec union (original_bets + ideas), deduped.
 *   2. SYNTHESIS call (generator): rewrite each candidate into a real title in the
 *      creator's voice/domain, allowed to add specificity the raw topic lacks.
 *   3. GRADE call (independent advisor): same rubric as wtpLiveOutputAudit.
 *   4. Report synthesis grade vs the 1.56 template baseline.
 *
 * Usage: node scripts/wtpSynthesisAudit.js [--dry-run]
 */

const path = require('path');
const fs   = require('fs');
try { require('dotenv').config({ path: path.resolve(__dirname, '../.env') }); } catch (_) {}

const { getDb }                  = require('../db/init');
const { computeWhatToPost }      = require('../services/whatToPost');
const { buildWhatToPostContext } = require('../services/whatToPostContext');
const OpenAI = require('openai');

const DRY_RUN = process.argv.includes('--dry-run');
const RECS_PER_CHANNEL = 8;
const API_DELAY_MS = 1000;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const SYNTH_MODEL = 'claude-sonnet-4-6';        // writer (Claude)
const GRADE_MODEL = 'gpt-4.1';                  // INDEPENDENT grader (OpenAI) — no self-preference
const REPORT_PATH = path.resolve(__dirname, 'wtp_synthesis_report.md');

let _openai = null;
function openaiClient() {
  if (_openai) return _openai;
  _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return _openai;
}
async function callOpenAI(system, user, maxTokens = 3000) {
  const r = await openaiClient().chat.completions.create({
    model: GRADE_MODEL, max_tokens: maxTokens,
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
  });
  return r.choices[0].message.content;
}

function safeJson(s, fb = null) { try { return s ? JSON.parse(s) : fb; } catch (_) { return fb; } }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function avg(a) { return a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0; }
function pct(n, t) { return t ? Math.round(n / t * 100) : 0; }
function gradeScore(g) { return { Excellent: 5, Good: 4, Average: 3, Poor: 2, Garbage: 1 }[g] || 0; }

function dnaContext(dnaRow) {
  if (!dnaRow) return { summary: 'No DNA.', recentTitles: [] };
  const stable = safeJson(dnaRow.stable_dna_json, {});
  const c = stable?.creator_constraints || {};
  const list = (j, k = 8) => (safeJson(j, []) || []).slice(0, k).map(x => typeof x === 'string' ? x : x.label || x.id).filter(Boolean);
  const lines = [];
  if (c.csp) lines.push(`Content style: ${c.csp}`);
  if (c.content_archetype) lines.push(`Archetype: ${c.content_archetype}`);
  if (c.format_type) lines.push(`Format: ${c.format_type}`);
  if (c.language || c.region) lines.push(`Language/Region: ${c.language || '?'}/${c.region || '?'}`);
  const dom = list(dnaRow.domain_tags_json); if (dom.length) lines.push(`Domains: ${dom.join(', ')}`);
  const mic = list(dnaRow.micro_topics_json, 10); if (mic.length) lines.push(`Topics they cover: ${mic.join(', ')}`);
  const hooks = list(dnaRow.hook_templates_json, 4); if (hooks.length) lines.push(`Hook style: ${hooks.join(', ')}`);
  return { summary: lines.join('\n') || 'Minimal DNA.', };
}

function normTitle(t) { return String(t || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim(); }
function pickTitle(i) { return i.recommendation_title || i.ai_title || i.angle_title || i.action_title || i.title || i.topic || i.raw_subject || ''; }

function getRecs(db, channelId, niche, ctx) {
  let r;
  try { r = computeWhatToPost(db, { channel_id: channelId, niche }, ctx); } catch (e) { return { error: e.message, recs: [] }; }
  const A = (r?.original_bets?.ideas || r?.original_bets || []);
  const B = (r?.ideas || []);
  const all = [...(Array.isArray(A) ? A : []), ...(Array.isArray(B) ? B : [])];
  const seen = new Set(); const recs = [];
  for (const i of all) {
    const t = pickTitle(i); const k = normTitle(t);
    if (!t || !k || seen.has(k)) continue; seen.add(k);
    recs.push({ template_title: t, score: Number(i.score ?? 0), source: i.source || i.rec_source || 'unknown',
                concept: i.concept?.label || i.concept_label || i.peer_concept_label || null });
  }
  recs.sort((a, b) => b.score - a.score);
  return { recs: recs.slice(0, RECS_PER_CHANNEL) };
}

async function callClaude(model, system, user, maxTokens = 3000) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model, max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] }),
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const d = await res.json();
  return d.content[0].text;
}

const SYNTH_SYSTEM = `You are a senior YouTube content strategist who writes video concepts FOR a specific creator.

You are given the creator's identity (their niche, the topics they actually cover, their style) and a list of raw candidate topics (rough phrases extracted from their content and their peers' content). The raw candidates are often generic, fragmentary, or template-shaped.

Your job: for EACH candidate, write ONE genuinely good, specific, FILMABLE YouTube title that THIS creator would actually make — a title good enough they'd add it to their content calendar.

Rules:
- WRITE A REAL TITLE, don't rephrase the fragment. Use the candidate only as a seed for the SUBJECT; you may add the specific angle, hook, stakes, or framing the creator would use.
- It must be unmistakably on-brand for this creator (their domain, format, audience). A fitness creator gets a fitness title; a kids-music channel gets a kids-music concept.
- Be concrete and specific: name the real thing, the real tension, the real payoff. No vague "tips/secrets/guide to X" filler.
- If a candidate is hopeless for this creator (wrong domain, nonsense fragment), set "title" to null and "skip_reason" to a short phrase — do NOT force a bad title.
- Prefer titles with a clear hook (a tension, a surprise, a stake, a transformation, a specific number/object).

Return ONLY a JSON array, same length and order as the candidates:
[{ "candidate": "<exact input>", "title": "<new title>" | null, "skip_reason": "<only if null>" }]`;

function buildSynthUser(ch, recs) {
  const block = recs.map((r, i) => `${i + 1}. ${r.template_title}${r.concept ? `  (concept: ${r.concept})` : ''}`).join('\n');
  return `CREATOR: ${ch.channelName}
Niche: ${ch.niche}  |  Subscribers: ${(ch.subscribers || 0).toLocaleString()}

Creator identity (from their upload history):
${ch.dna}

Recent uploads:
${ch.recentTitles.slice(0, 10).map((t, i) => `${i + 1}. ${t}`).join('\n')}

CANDIDATE TOPICS to turn into real titles (${recs.length}):
${block}

Return a JSON array of ${recs.length} objects.`;
}

const GRADE_SYSTEM = `You are an experienced creator advisor. Grade each recommended YouTube title as the creator themselves would — would they save it or delete it? Be critical; most AI titles are mediocre.

Score each 1-5 on: creator_relevance, filmability, novelty, human_usefulness. Then overall_grade: Excellent | Good | Average | Poor | Garbage.

Return ONLY a JSON array (same order, same length):
[{ "rank": 1, "title": "<exact>", "overall_grade": "Good", "human_usefulness": 3 }]`;

function buildGradeUser(ch, titles) {
  return `Channel: ${ch.channelName}  |  Niche: ${ch.niche}
Creator identity:
${ch.dna}
Recent uploads:
${ch.recentTitles.slice(0, 8).map((t, i) => `${i + 1}. ${t}`).join('\n')}

TITLES TO GRADE (${titles.length}):
${titles.map((t, i) => `${i + 1}. "${t}"`).join('\n')}

Return a JSON array of ${titles.length} grade objects.`;
}

function parseArr(raw) {
  const m = raw.match(/\[[\s\S]*\]/); if (!m) throw new Error('no array');
  return JSON.parse(m[0]);
}

async function main() {
  if (!DRY_RUN && (!ANTHROPIC_API_KEY || !process.env.OPENAI_API_KEY)) { console.error('Need ANTHROPIC_API_KEY (writer) + OPENAI_API_KEY (grader)'); process.exit(1); }
  const db = getDb();
  const ctx = buildWhatToPostContext();
  const pinned = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'audit_pinned_channels.json'), 'utf8'));

  const channels = [];
  for (const p of pinned) {
    const row = db.get('SELECT * FROM ingested_channels WHERE channel_id = ?', [p.channel_id]);
    if (!row) continue;
    const dna = db.get('SELECT * FROM creator_idea_dna WHERE channel_id = ?', [p.channel_id]);
    const recentTitles = db.all('SELECT title FROM ingested_videos WHERE channel_id=? AND title IS NOT NULL ORDER BY published_at DESC LIMIT 12', [p.channel_id]).map(r => r.title);
    const { recs, error } = getRecs(db, p.channel_id, p.target_niche, ctx);
    channels.push({
      channelName: row.channel_name, niche: row.niche || p.target_niche, subscribers: row.channel_subscribers,
      dna: dnaContext(dna).summary, recentTitles, recs: recs || [], genError: error || null,
    });
  }

  if (DRY_RUN) {
    for (const c of channels) console.log(`\n[${c.niche}] ${c.channelName}: ${c.recs.length} recs\n  ` + c.recs.map(r => r.template_title).join('\n  '));
    console.log('\nDry-run: no API calls.'); return;
  }

  const allTemplate = [], allSynth = [];
  const perChannel = [];
  for (const [i, c] of channels.entries()) {
    if (!c.recs.length) { console.log(`(${i+1}/${channels.length}) ${c.channelName}: 0 recs, skip`); continue; }
    process.stdout.write(`(${i+1}/${channels.length}) ${c.channelName} ... `);
    try {
      // 1. Synthesize
      const synthRaw = await callClaude(SYNTH_MODEL, SYNTH_SYSTEM, buildSynthUser(c, c.recs));
      const synth = parseArr(synthRaw);
      const synthTitles = c.recs.map((r, idx) => (synth[idx] && synth[idx].title) ? String(synth[idx].title) : null);
      const valid = synthTitles.map((t, idx) => ({ t, template: c.recs[idx].template_title })).filter(x => x.t);
      await sleep(API_DELAY_MS);
      // 2. Grade BOTH synth and template on the SAME candidates with the SAME independent
      //    grader (OpenAI) — isolates the synthesis effect, removes self-preference bias.
      const synthGrades = parseArr(await callOpenAI(GRADE_SYSTEM, buildGradeUser(c, valid.map(v => v.t))));
      await sleep(API_DELAY_MS);
      const tmplGrades  = parseArr(await callOpenAI(GRADE_SYSTEM, buildGradeUser(c, valid.map(v => v.template))));
      const gsS = synthGrades.map(g => gradeScore(g.overall_grade));
      const gsT = tmplGrades.map(g => gradeScore(g.overall_grade));
      allSynth.push(...gsS);
      allTemplate.push(...gsT);
      perChannel.push({ name: c.channelName, niche: c.niche, n: valid.length, skipped: c.recs.length - valid.length,
                        avgS: avg(gsS), avgT: avg(gsT),
                        grades: synthGrades.map((g, idx) => ({ grade: g.overall_grade, title: valid[idx]?.t, tmplGrade: tmplGrades[idx]?.overall_grade, tmpl: valid[idx]?.template })) });
      console.log(`synth=${avg(gsS).toFixed(1)} tmpl=${avg(gsT).toFixed(1)}  ${synthGrades.map(g => (g.overall_grade||'?')[0]).join('')} (${valid.length}/${c.recs.length})`);
      await sleep(API_DELAY_MS);
    } catch (e) { console.log(`ERR: ${e.message}`); }
  }

  const cS = { Excellent: 0, Good: 0, Average: 0, Poor: 0, Garbage: 0 };
  const cT = { Excellent: 0, Good: 0, Average: 0, Poor: 0, Garbage: 0 };
  for (const ch of perChannel) for (const g of ch.grades) { if (g.grade in cS) cS[g.grade]++; if (g.tmplGrade in cT) cT[g.tmplGrade]++; }
  const total = allSynth.length;
  const u = c => pct(c.Excellent + c.Good, total);

  const lines = ['# WTP Synthesis Audit (paired, independent OpenAI grader)', '',
    `Writer: ${SYNTH_MODEL}  |  Grader: ${GRADE_MODEL} (independent)  |  pinned ${channels.length} channels  |  paired on ${total} candidates`, '',
    `| Variant | Avg | Useful | Excellent | Garbage |`, `|---|---:|---:|---:|---:|`,
    `| Template (same candidates) | ${avg(allTemplate).toFixed(2)} | ${u(cT)}% | ${pct(cT.Excellent,total)}% | ${pct(cT.Garbage,total)}% |`,
    `| **AI Synthesis** | **${avg(allSynth).toFixed(2)}** | **${u(cS)}%** | **${pct(cS.Excellent,total)}%** | **${pct(cS.Garbage,total)}%** |`,
    `| Delta | +${(avg(allSynth)-avg(allTemplate)).toFixed(2)} | +${u(cS)-u(cT)}pp | +${pct(cS.Excellent,total)-pct(cT.Excellent,total)}pp | ${pct(cS.Garbage,total)-pct(cT.Garbage,total)}pp |`,
    '', '## Per-channel (synth vs template)', ''];
  for (const ch of perChannel) {
    lines.push(`### [${ch.niche}] ${ch.name} — synth ${ch.avgS.toFixed(2)} vs tmpl ${ch.avgT.toFixed(2)} (${ch.n} synth, ${ch.skipped} skipped)`);
    for (const g of ch.grades) lines.push(`- **${g.grade}** (was ${g.tmplGrade}) — ${g.title}`);
    lines.push('');
  }
  fs.writeFileSync(REPORT_PATH, lines.join('\n'));

  console.log('\n════════ WTP Synthesis Audit (independent OpenAI grader, paired) ════════');
  console.log(`  Paired candidates: ${total}`);
  console.log(`  Template  : avg ${avg(allTemplate).toFixed(2)}  useful ${u(cT)}%  excellent ${pct(cT.Excellent,total)}%  garbage ${pct(cT.Garbage,total)}%`);
  console.log(`  Synthesis : avg ${avg(allSynth).toFixed(2)}  useful ${u(cS)}%  excellent ${pct(cS.Excellent,total)}%  garbage ${pct(cS.Garbage,total)}%`);
  console.log(`  Delta     : +${(avg(allSynth)-avg(allTemplate)).toFixed(2)} avg, +${u(cS)-u(cT)}pp useful`);
  console.log(`  Report: ${REPORT_PATH}`);
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });

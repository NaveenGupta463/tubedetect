'use strict';

/**
 * WTP LIVE OUTPUT Audit
 *
 * Companion to wtpHumanUsefulnessAudit.js — but grades EXACTLY what the API
 * returns to a creator, not the raw wtp_generation_traces research table.
 *
 * Why this exists:
 *   wtpHumanUsefulnessAudit.js reads recommendations straight from
 *   wtp_generation_traces (ORDER BY wtp_score DESC, created_at DESC). That table:
 *     - still contains `angle_gap` (excluded from the live API in Generator V2 Phase 6)
 *     - has wtp_score NULL on ~99.7% of rows, so the sort silently degrades to
 *       "most recent traces" — including pre-fix generations
 *     - is not deduped / creator-fit-sorted / specificity-sorted like the API path
 *   Result: it grades recommendations users never see, which is why the
 *   human-usefulness number stayed flat at ~5% while every pipeline proxy improved.
 *
 * This script instead calls the SAME generation path as whatToPostHandler:
 *   computeWhatToPost(db, { channel_id }, buildWhatToPostContext())
 * and grades the union of result.original_bets (Stream A, DNA bets) and
 * result.ideas (Stream B, peer/territory — angle_gap already excluded, deduped).
 * It generates fresh (cache-miss equivalent) so it measures the CURRENT engine.
 *
 * Usage:
 *   node wtpLiveOutputAudit.js              # full run (grades with Claude)
 *   node wtpLiveOutputAudit.js --dry-run    # show live recs per channel, no API calls / no cost
 *   node wtpLiveOutputAudit.js --channel=UCXXXX
 */

const path = require('path');
const fs   = require('fs');

try { require('dotenv').config({ path: path.resolve(__dirname, '../.env') }); } catch (_) {}

const { getDb }                  = require('../db/init');
const { computeWhatToPost }      = require('../services/whatToPost');
const { buildWhatToPostContext } = require('../services/whatToPostContext');

const REPORT_PATH = path.resolve(__dirname, 'wtp_live_output_report.md');
const JSON_PATH   = path.resolve(__dirname, 'wtp_live_output_results.json');

const DRY_RUN        = process.argv.includes('--dry-run');
const SINGLE_CHANNEL = (process.argv.find(a => a.startsWith('--channel=')) || '').replace('--channel=', '') || null;
const RECS_PER_CHANNEL   = 10;
const RECENT_VIDEO_COUNT = 20;
const API_DELAY_MS       = 1200;

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = 'claude-sonnet-4-6';

// Same niche map as wtpHumanUsefulnessAudit.js so the two runs are comparable.
const NICHE_MAP = {
  finance:       ['finance', 'personal finance', 'stock market analysis', 'stock market investing',
                  'stock market trading', 'indian stock market', 'investment strategies',
                  'intraday trading', 'ipo analysis', 'cryptocurrency market analysis', 'bitcoin'],
  food:          ['food', 'indian street food', 'street food', 'street food tours', 'cooking',
                  'viral recipes', 'food challenges', 'indian recipes', 'indian cuisine',
                  'food hacks', 'food facts', 'traditional recipes', 'traditional cooking',
                  'healthy recipes', 'home cooking', 'bangla food', 'traditional village cooking',
                  'affordable indian street food', 'daily meals', 'daily food consumption'],
  fitness:       ['fitness', 'weight loss', 'workout routines', 'home workouts', 'bodybuilding',
                  'weight loss exercises', 'weight loss diets', 'daily fitness routines',
                  'health', 'nutrition', 'belly fat loss exercises', "women's health", 'meditation'],
  education:     ['education', 'science education', 'early childhood education', 'science',
                  'popular science', 'space science', 'science explanations', 'science experiments',
                  'upsc exam preparation', 'neet exam preparation', 'career development',
                  'higher education courses'],
  business:      ['business', 'small business ideas', 'startup culture', 'entrepreneurship',
                  'startup ecosystem', 'small business startups', 'business ideas',
                  'startup success stories', 'startup journey', 'amazon fba', 'digital marketing',
                  'brand marketing', 'artificial intelligence in business', 'ai tools for business',
                  'new business ideas'],
  news:          ['news', 'geopolitics', 'india geopolitics', 'indian politics', 'indian current affairs',
                  'indian current events', 'breaking news', 'geopolitical what-if scenarios',
                  'india-pakistan relations', 'middle east conflicts', 'middle east conflict',
                  'international relations', 'international diplomacy'],
  technology:    ['technology', 'smartphone reviews', 'artificial intelligence', 'ai video generation',
                  'consumer technology reviews', 'ai tools tutorials', 'diy electronics',
                  'diy electronics projects', 'budget tech gadgets', 'budget electronics shopping',
                  'artificial intelligence tools'],
  entertainment: ['entertainment', 'comedy', 'comedy sketches', 'short comedy sketches',
                  'school life comedy', 'prank videos', 'funny pranks', 'funny clips',
                  'funny sketches', 'standup comedy', 'stand-up comedy', 'television shows',
                  'bollywood movies', 'pop culture'],
  travel:        ['travel vlogs', 'travel', 'travel experiences in china', 'street walking tours',
                  'american travel destinations'],
  lifestyle:     ['selfimprovement', 'family life', 'daily life vlogs', 'personal development',
                  'motivation', 'family humor', 'family comedy', 'career development',
                  'daily routines', 'daily life in india', 'nostalgia', 'middle class life'],
};

function safeJson(s, fb = null) { try { return s ? JSON.parse(s) : fb; } catch (_) { return fb; } }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function avg(arr) { return arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0; }
function pct(n, total) { return total ? Math.round((n / total) * 100) : 0; }

function buildDnaSummary(dnaRow) {
  if (!dnaRow) return 'No DNA available.';
  const stable      = safeJson(dnaRow.stable_dna_json, {});
  const domainTags  = safeJson(dnaRow.domain_tags_json, []);
  const microTopics = safeJson(dnaRow.micro_topics_json, []);
  const hooks       = safeJson(dnaRow.hook_templates_json, []);
  const thesis      = safeJson(dnaRow.thesis_patterns_json, []);
  const entities    = safeJson(dnaRow.entities_json, []);
  const constraints = stable?.creator_constraints || {};
  const signature   = stable?.signature || {};
  const lines = [];
  if (constraints.csp)               lines.push(`Content style: ${constraints.csp}`);
  if (constraints.content_archetype) lines.push(`Archetype: ${constraints.content_archetype}`);
  if (constraints.creator_mode)      lines.push(`Creator mode: ${constraints.creator_mode}`);
  if (constraints.format_type)       lines.push(`Format: ${constraints.format_type} (${constraints.dominant_duration_bucket || ''})`);
  if (constraints.language)          lines.push(`Language: ${constraints.language}  Region: ${constraints.region || '?'}`);
  const topDomains = (Array.isArray(domainTags) ? domainTags : []).slice(0, 6).map(d => typeof d === 'string' ? d : d.label || d.id).filter(Boolean);
  if (topDomains.length) lines.push(`Domain tags: ${topDomains.join(', ')}`);
  const topTopics = (Array.isArray(microTopics) ? microTopics : []).slice(0, 6).map(t => typeof t === 'string' ? t : t.label || t.id).filter(Boolean);
  if (topTopics.length) lines.push(`Micro-topics: ${topTopics.join(', ')}`);
  const topEntities = (Array.isArray(entities) ? entities : []).slice(0, 6).map(e => typeof e === 'string' ? e : e.label || e.id).filter(Boolean);
  if (topEntities.length) lines.push(`Key entities: ${topEntities.join(', ')}`);
  const topHooks = (Array.isArray(hooks) ? hooks : []).slice(0, 3).map(h => {
    const label = typeof h === 'string' ? h : h.label || h.id || '';
    const ex    = (h.examples || [])[0] || '';
    return ex ? `${label} (e.g. "${ex}")` : label;
  }).filter(Boolean);
  if (topHooks.length) lines.push(`Hook style: ${topHooks.join(' | ')}`);
  const topThesis = (Array.isArray(thesis) ? thesis : []).slice(0, 3).map(t => typeof t === 'string' ? t : t.label || t.id).filter(Boolean);
  if (topThesis.length) lines.push(`Thesis patterns: ${topThesis.join(' | ')}`);
  const sigTopics = (signature.micro_topics || []).slice(0, 4).join(', ');
  if (sigTopics) lines.push(`Signature topics: ${sigTopics}`);
  if (dnaRow.creator_style_type) lines.push(`Style type: ${dnaRow.creator_style_type}`);
  if (dnaRow.confidence)         lines.push(`DNA confidence: ${dnaRow.confidence} (score: ${dnaRow.confidence_score ?? '?'})`);
  return lines.length ? lines.join('\n') : 'Minimal DNA data available.';
}

// --------------------------------------------------
// Channel selection — channels with DNA (no trace dependency)
// --------------------------------------------------
function selectChannels(db) {
  const selected = [];
  for (const [nicheLabel, nicheValues] of Object.entries(NICHE_MAP)) {
    const placeholders = nicheValues.map(() => '?').join(',');
    const rows = db.all(`
      SELECT ic.channel_id, ic.channel_name, ic.niche, ic.channel_subscribers
      FROM ingested_channels ic
      JOIN creator_idea_dna dna ON dna.channel_id = ic.channel_id
      WHERE ic.ingest_enabled = 1
        AND ic.niche IN (${placeholders})
      GROUP BY ic.channel_id
      ORDER BY ic.channel_subscribers DESC
      LIMIT 2
    `, nicheValues);
    if (!rows.length) { console.warn(`[select] No eligible channels for niche: ${nicheLabel}`); continue; }
    for (const row of rows) selected.push({ ...row, target_niche: nicheLabel });
  }
  return selected;
}

// --------------------------------------------------
// LIVE recommendation extraction — the heart of the fix
// --------------------------------------------------
function normTitle(t) {
  return String(t || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

function pickTitle(idea) {
  return idea.recommendation_title || idea.ai_title || idea.title || idea.topic || idea.raw_subject || '';
}

function extractLiveRecs(db, channelId, targetNiche, ctx) {
  let result;
  try {
    result = computeWhatToPost(db, { channel_id: channelId, niche: targetNiche }, ctx);
  } catch (e) {
    return { error: `computeWhatToPost failed: ${e.message}`, recs: [] };
  }

  const streamA = (result?.original_bets?.ideas || result?.original_bets || []);
  const streamB = (result?.ideas || []);

  const rawA = Array.isArray(streamA) ? streamA : [];
  const rawB = Array.isArray(streamB) ? streamB : [];

  const all = [
    ...rawA.map(i => ({ idea: i, source: i.source || i.rec_source || 'dna_original_bets' })),
    ...rawB.map(i => ({ idea: i, source: i.source || i.rec_source || 'unknown' })),
  ];

  // Dedup by normalized title (mirrors the live pipeline's intent)
  const seen = new Set();
  const deduped = [];
  for (const { idea, source } of all) {
    const title = pickTitle(idea);
    const key = normTitle(title);
    if (!title || !key || seen.has(key)) continue;
    seen.add(key);
    deduped.push({
      title,
      source,
      score:       Number(idea.score ?? idea.wtp_score ?? 0),
      opportunity: idea.opportunity_label || idea.opportunity || idea.recommendation_type || null,
      archetype:   idea.archetype || null,
    });
  }

  // Rank by score desc, take top N — what the creator sees first
  deduped.sort((a, b) => b.score - a.score);
  const recs = deduped.slice(0, RECS_PER_CHANNEL).map((r, i) => ({ rank: i + 1, ...r }));
  return { recs, totalGenerated: all.length, afterDedup: deduped.length };
}

function getChannelData(db, channelId, targetNiche, ctx) {
  const channel = db.get('SELECT * FROM ingested_channels WHERE channel_id = ?', [channelId]);
  const dna     = db.get('SELECT * FROM creator_idea_dna WHERE channel_id = ?', [channelId]);
  const recentVideos = db.all(`
    SELECT title, published_at, views, format_type
    FROM ingested_videos WHERE channel_id = ?
    ORDER BY published_at DESC LIMIT ?
  `, [channelId, RECENT_VIDEO_COUNT]);

  const live = extractLiveRecs(db, channelId, targetNiche, ctx);

  return {
    channelId,
    channelName:  channel?.channel_name || channelId,
    niche:        channel?.niche || targetNiche,
    targetNiche,
    subscribers:  channel?.channel_subscribers || 0,
    dnaSummary:   buildDnaSummary(dna),
    recentVideos: recentVideos.map(v => `${v.title} [${v.views != null ? v.views.toLocaleString() : '?'} views, ${v.format_type || 'standard'}]`),
    recs:         live.recs || [],
    genStats:     { totalGenerated: live.totalGenerated, afterDedup: live.afterDedup },
    genError:     live.error || null,
  };
}

// --------------------------------------------------
// Claude grading — identical rubric to wtpHumanUsefulnessAudit.js
// --------------------------------------------------
async function callClaude(prompt) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: MODEL, max_tokens: 4000, messages: [{ role: 'user', content: prompt }] }),
  });
  if (!response.ok) { const t = await response.text(); throw new Error(`Anthropic API ${response.status}: ${t.slice(0, 300)}`); }
  const data = await response.json();
  return data.content[0].text;
}

async function gradeChannelRecs(channelData) {
  const { channelName, niche, subscribers, dnaSummary, recentVideos, recs } = channelData;
  const recsBlock = recs.map(r =>
    `${r.rank}. "${r.title}"\n   Source: ${r.source || 'unknown'}  |  Opportunity: ${r.opportunity || 'none'}  |  Archetype: ${r.archetype || 'none'}`
  ).join('\n\n');
  const videosBlock = recentVideos.map((v, i) => `${i + 1}. ${v}`).join('\n');

  const prompt = `You are evaluating YouTube video recommendations for a specific creator. Your role is that of an experienced creator advisor — assessing each idea as the creator themselves would, deciding whether to save it or discard it.

Do NOT use generic enthusiasm. Be critical. Most AI-generated recommendations are mediocre. Identify what actually works.

═══ CREATOR CONTEXT ═══

Channel: ${channelName}
Niche: ${niche}
Subscribers: ${(subscribers || 0).toLocaleString()}

Creator DNA (derived from their actual upload history):
${dnaSummary}

Recent videos (last ${recentVideos.length} uploads):
${videosBlock}

═══ RECOMMENDATIONS TO EVALUATE ═══

${recsBlock}

═══ EVALUATION CRITERIA ═══

For each recommendation, score 1-5 and give ONE sentence justification:

1. Creator Relevance (1-5): Does this fit who this creator actually is? Their voice, format, established identity? 5 = perfect fit; 1 = completely wrong creator for this topic
2. Filmability (1-5): Is the subject concrete and executable as a YouTube video right now? 5 = clear, filmable, specific; 1 = vague/abstract/impossible
3. Novelty (1-5): Is this a genuinely fresh angle this creator hasn't covered? 5 = original; 1 = obvious/saturated/already covered
4. Human Usefulness (1-5): Would a real creator feel "yes, I could make this tomorrow"? 5 = immediately add to calendar; 1 = roll their eyes and delete

Overall Grade: Excellent | Good | Average | Poor | Garbage

GHOST FLAG (passes_scoring_never_used: true/false): Mark true if it would score well on technical metrics but NO creator would realistically ever produce it.

═══ RESPONSE FORMAT ═══

Return ONLY a valid JSON array. No text before or after.

[
  {
    "rank": 1,
    "title": "exact title from input",
    "creator_relevance": { "score": 4, "reason": "one sentence" },
    "filmability": { "score": 3, "reason": "one sentence" },
    "novelty": { "score": 4, "reason": "one sentence" },
    "human_usefulness": { "score": 3, "reason": "one sentence" },
    "overall_grade": "Good",
    "justification": "one to two sentences",
    "passes_scoring_never_used": false
  }
]`;

  const rawText = await callClaude(prompt);
  const jsonMatch = rawText.match(/\[[\s\S]*\]/);
  if (!jsonMatch) throw new Error(`No JSON array in response: ${rawText.slice(0, 300)}`);
  return JSON.parse(jsonMatch[0]);
}

// --------------------------------------------------
// Report
// --------------------------------------------------
function gradeScore(g) { return { Excellent: 5, Good: 4, Average: 3, Poor: 2, Garbage: 1 }[g] || 0; }

function buildReport(allResults) {
  const lines = [];
  const allGrades = allResults.flatMap(r => r.grades || []);
  const gradeCounts = { Excellent: 0, Good: 0, Average: 0, Poor: 0, Garbage: 0 };
  allGrades.forEach(g => { if (g.overall_grade in gradeCounts) gradeCounts[g.overall_grade]++; });
  const total  = allGrades.length;
  const ghosts = allGrades.filter(g => g.passes_scoring_never_used);

  lines.push('# WTP Live Output Audit');
  lines.push('');
  lines.push(`**Generated:** ${new Date().toISOString().slice(0, 10)}`);
  lines.push(`**Model:** ${MODEL}  |  **Channels:** ${allResults.length}  |  **Recs evaluated:** ${total}`);
  lines.push('**Source:** live `computeWhatToPost()` output (original_bets + ideas), deduped — NOT the wtp_generation_traces table.');
  lines.push('');
  lines.push('## Overall Results');
  lines.push('');
  lines.push('| Grade | Count | % |');
  lines.push('|---|---:|---:|');
  for (const [grade, count] of Object.entries(gradeCounts)) lines.push(`| ${grade} | ${count} | ${pct(count, total)}% |`);
  lines.push('');
  lines.push(`**Average grade score:** ${avg(allGrades.map(g => gradeScore(g.overall_grade))).toFixed(2)}/5`);
  lines.push(`**Useful (Excellent + Good):** ${pct(gradeCounts.Excellent + gradeCounts.Good, total)}%`);
  lines.push(`**Subpar (Poor + Garbage):** ${pct(gradeCounts.Poor + gradeCounts.Garbage, total)}%`);
  lines.push(`**Ghost recommendations:** ${ghosts.length} / ${total} (${pct(ghosts.length, total)}%)`);
  lines.push('');

  // Source breakdown — proves angle_gap is gone
  lines.push('## Live Source Distribution');
  lines.push('');
  lines.push('| Source | Count | Avg Score |');
  lines.push('|---|---:|---:|');
  const bySource = {};
  for (const r of allResults) {
    for (const rec of (r.recs || [])) {
      const grade = (r.grades || []).find(g => g.rank === rec.rank);
      const src = rec.source || 'unknown';
      if (!bySource[src]) bySource[src] = [];
      if (grade) bySource[src].push(gradeScore(grade.overall_grade));
      else bySource[src].push(null);
    }
  }
  for (const [src, scores] of Object.entries(bySource).sort((a, b) => b[1].length - a[1].length)) {
    const real = scores.filter(s => s != null);
    lines.push(`| ${src} | ${scores.length} | ${real.length ? avg(real).toFixed(2) : 'n/a'}/5 |`);
  }
  lines.push('');

  // Per-channel
  lines.push('## Per-Channel Results');
  lines.push('');
  for (const result of allResults) {
    const { channelName, niche, targetNiche, subscribers, recs, grades, genStats, genError } = result;
    lines.push(`### [${targetNiche}] ${channelName}`);
    lines.push(`**Niche:** ${niche}  |  **Subscribers:** ${(subscribers || 0).toLocaleString()}  |  **Generated:** ${genStats?.totalGenerated ?? '?'} → ${genStats?.afterDedup ?? '?'} after dedup`);
    if (genError) { lines.push(`> ⚠️ Generation error: ${genError}`); lines.push(''); continue; }
    if (!recs.length) { lines.push('> ⚠️ Engine produced 0 recommendations for this channel.'); lines.push(''); continue; }
    lines.push('');
    lines.push('| # | Title | Source | Grade | Rel | Film | Novel | Useful |');
    lines.push('|---|---|---|---|---:|---:|---:|---:|');
    for (const rec of recs) {
      const g = (grades || []).find(x => x.rank === rec.rank) || {};
      const title = (rec.title || '').length > 55 ? rec.title.slice(0, 52) + '...' : rec.title;
      lines.push(`| ${rec.rank} | ${title} | ${rec.source} | **${g.overall_grade || '?'}** | ${g.creator_relevance?.score ?? '-'} | ${g.filmability?.score ?? '-'} | ${g.novelty?.score ?? '-'} | ${g.human_usefulness?.score ?? '-'} |`);
    }
    lines.push('');
  }
  lines.push('---');
  lines.push('*End of report*');
  return lines.join('\n');
}

// --------------------------------------------------
// Main
// --------------------------------------------------
async function main() {
  console.log('[live-audit] WTP Live Output Audit');
  console.log('[live-audit] Model:', MODEL, ' | Dry-run:', DRY_RUN);
  if (!DRY_RUN && !ANTHROPIC_API_KEY) {
    console.error('[live-audit] ANTHROPIC_API_KEY not set. Add it to server/.env.');
    process.exit(1);
  }

  const db  = getDb();
  const ctx = buildWhatToPostContext();

  let channels;
  const PINNED_PATH = path.resolve(__dirname, 'audit_pinned_channels.json');
  if (SINGLE_CHANNEL) {
    const row = db.get('SELECT channel_id, channel_name, niche, channel_subscribers FROM ingested_channels WHERE channel_id = ?', [SINGLE_CHANNEL]);
    if (!row) { console.error('[live-audit] Channel not found:', SINGLE_CHANNEL); process.exit(1); }
    channels = [{ ...row, target_niche: row.niche || 'unknown' }];
  } else if (fs.existsSync(PINNED_PATH)) {
    // Pinned set: fixed channel IDs so reclassification can't drift the selection
    // (required for stable before/after measurement across niche changes).
    const pinned = JSON.parse(fs.readFileSync(PINNED_PATH, 'utf8'));
    channels = pinned.map(p => {
      const row = db.get('SELECT channel_id, channel_name, niche, channel_subscribers FROM ingested_channels WHERE channel_id = ?', [p.channel_id]);
      return row ? { ...row, target_niche: p.target_niche || row.niche || 'unknown' } : null;
    }).filter(Boolean);
    console.log(`[live-audit] Using PINNED channel set (${channels.length} channels from audit_pinned_channels.json)`);
  } else {
    channels = selectChannels(db);
  }

  console.log(`[live-audit] Selected ${channels.length} channels`);

  const allData = channels.map(ch => {
    const data = getChannelData(db, ch.channel_id, ch.target_niche, ctx);
    if (DRY_RUN) {
      console.log(`\n── [${data.targetNiche}] ${data.channelName} (${(data.subscribers||0).toLocaleString()} subs) ──`);
      if (data.genError) { console.log('  ⚠️ ', data.genError); return data; }
      console.log(`  generated ${data.genStats.totalGenerated} → ${data.genStats.afterDedup} deduped → top ${data.recs.length}`);
      data.recs.forEach(r => console.log(`    ${r.rank}. [${r.source}] (${r.score}) ${r.title}`));
    }
    return data;
  });

  if (DRY_RUN) {
    // Print live source histogram so we can confirm angle_gap is absent
    const hist = {};
    for (const d of allData) for (const r of d.recs) hist[r.source] = (hist[r.source] || 0) + 1;
    console.log('\n[live-audit] Live source distribution (what users actually see):');
    Object.entries(hist).sort((a,b)=>b[1]-a[1]).forEach(([s,n]) => console.log(`  ${s.padEnd(22)} ${n}`));
    console.log('\n[live-audit] Dry-run complete — no Claude API calls made.');
    return;
  }

  const results = [];
  for (const [i, channelData] of allData.entries()) {
    if (!channelData.recs.length) {
      console.warn(`[live-audit] Skipping ${channelData.channelName} — engine produced 0 recs`);
      results.push({ ...channelData, grades: [], error: channelData.genError || 'No recommendations produced' });
      continue;
    }
    process.stdout.write(`[live-audit] (${i + 1}/${allData.length}) Grading: ${channelData.channelName} ... `);
    try {
      const grades = await gradeChannelRecs(channelData);
      results.push({ ...channelData, grades });
      console.log(`${grades.map(g => g.overall_grade[0]).join('')}  avg=${avg(grades.map(g => gradeScore(g.overall_grade))).toFixed(1)}`);
    } catch (e) {
      console.log(`ERROR: ${e.message}`);
      results.push({ ...channelData, grades: [], error: e.message });
    }
    if (i < allData.length - 1) await sleep(API_DELAY_MS);
  }

  fs.writeFileSync(JSON_PATH, JSON.stringify(results, null, 2));
  fs.writeFileSync(REPORT_PATH, buildReport(results));
  console.log(`\n[live-audit] JSON:   ${JSON_PATH}`);
  console.log(`[live-audit] Report: ${REPORT_PATH}`);

  const allGrades = results.flatMap(r => r.grades || []);
  const total = allGrades.length;
  const gc = { Excellent: 0, Good: 0, Average: 0, Poor: 0, Garbage: 0 };
  allGrades.forEach(g => { if (g.overall_grade in gc) gc[g.overall_grade]++; });
  console.log('\n════════════ WTP Live Output Audit — Final ════════════');
  console.log(`  Recommendations: ${total}  |  Avg: ${avg(allGrades.map(g => gradeScore(g.overall_grade))).toFixed(2)}/5`);
  for (const [grade, count] of Object.entries(gc)) console.log(`  ${grade.padEnd(10)} ${count} (${pct(count, total)}%)`);
  console.log(`  Useful (Exc+Good): ${pct(gc.Excellent + gc.Good, total)}%`);
  console.log('═══════════════════════════════════════════════════════');
}

main().catch(e => { console.error('[live-audit] FATAL:', e); process.exit(1); });

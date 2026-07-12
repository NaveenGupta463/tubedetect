'use strict';

/**
 * WTP Human Usefulness Audit
 *
 * Evaluates whether TubeIntel recommendations are genuinely useful to creators,
 * independent of all existing scoring, affinity, and ranking systems.
 *
 * Uses Claude to grade each recommendation on:
 *   1. Creator Relevance   — would this creator realistically publish it?
 *   2. Filmability         — can it become a real video?
 *   3. Novelty             — is it a fresh angle?
 *   4. Human Usefulness    — would a creator save this idea?
 *
 * Usage:
 *   node wtpHumanUsefulnessAudit.js              # full run
 *   node wtpHumanUsefulnessAudit.js --dry-run    # select channels + show data, no API calls
 *   node wtpHumanUsefulnessAudit.js --channel=UCXXXXXX  # single channel debug
 */

const path = require('path');
const fs   = require('fs');

try { require('dotenv').config({ path: path.resolve(__dirname, '../.env') }); } catch (_) {}

const Database = require('../node_modules/better-sqlite3');

const DB_PATH     = path.resolve(__dirname, '../data/scoring.db');
const REPORT_PATH = path.resolve(__dirname, 'wtp_human_usefulness_report.md');
const JSON_PATH   = path.resolve(__dirname, 'wtp_human_usefulness_results.json');

const DRY_RUN         = process.argv.includes('--dry-run');
const SINGLE_CHANNEL  = (process.argv.find(a => a.startsWith('--channel=')) || '').replace('--channel=', '') || null;
const RECS_PER_CHANNEL   = 10;
const RECENT_VIDEO_COUNT = 20;
const API_DELAY_MS       = 1200;

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = 'claude-sonnet-4-6';

// --------------------------------------------------
// Niche mapping: target label → actual DB niche values
// --------------------------------------------------
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
                  'health', 'nutrition', 'belly fat loss exercises', 'women\'s health', 'meditation'],
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

// --------------------------------------------------
// Utilities
// --------------------------------------------------
function safeJson(s, fb = null) {
  try { return s ? JSON.parse(s) : fb; } catch (_) { return fb; }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

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
// DB queries
// --------------------------------------------------
function selectChannels(db) {
  const selected = [];

  for (const [nicheLabel, nicheValues] of Object.entries(NICHE_MAP)) {
    const placeholders = nicheValues.map(() => '?').join(',');
    const rows = db.prepare(`
      SELECT ic.channel_id, ic.channel_name, ic.niche, ic.channel_subscribers,
             COUNT(DISTINCT t.id) AS trace_count
      FROM ingested_channels ic
      JOIN creator_idea_dna dna ON dna.channel_id = ic.channel_id
      JOIN wtp_generation_traces t ON t.channel_id = ic.channel_id
      WHERE ic.ingest_enabled = 1
        AND ic.niche IN (${placeholders})
      GROUP BY ic.channel_id
      ORDER BY trace_count DESC, ic.channel_subscribers DESC
      LIMIT 2
    `).all(...nicheValues);

    if (!rows.length) {
      console.warn(`[select] No eligible channels for niche: ${nicheLabel}`);
      continue;
    }
    for (const row of rows) {
      selected.push({ ...row, target_niche: nicheLabel });
    }
  }
  return selected;
}

function getChannelData(db, channelId, targetNiche) {
  const channel = db.prepare('SELECT * FROM ingested_channels WHERE channel_id = ?').get(channelId);
  const dna     = db.prepare('SELECT * FROM creator_idea_dna WHERE channel_id = ?').get(channelId);

  const recentVideos = db.prepare(`
    SELECT title, published_at, views, format_type
    FROM ingested_videos
    WHERE channel_id = ?
    ORDER BY published_at DESC
    LIMIT ?
  `).all(channelId, RECENT_VIDEO_COUNT);

  const recs = db.prepare(`
    SELECT id, idea_key,
           COALESCE(recommendation_title, generated_title) AS title,
           rec_source, opportunity_label, dna_affinity_score,
           wtp_score, archetype, concept_label, peer_concept_label,
           raw_subject
    FROM wtp_generation_traces
    WHERE channel_id = ?
    ORDER BY wtp_score DESC, created_at DESC
    LIMIT ?
  `).all(channelId, RECS_PER_CHANNEL);

  return {
    channelId,
    channelName:  channel?.channel_name || channelId,
    niche:        channel?.niche || targetNiche,
    targetNiche,
    subscribers:  channel?.channel_subscribers || 0,
    dnaSummary:   buildDnaSummary(dna),
    recentVideos: recentVideos.map(v => {
      const views = v.views != null ? v.views.toLocaleString() : '?';
      return `${v.title} [${views} views, ${v.format_type || 'standard'}]`;
    }),
    recs: recs.map((r, i) => ({
      rank:         i + 1,
      ideaKey:      r.idea_key,
      title:        r.title || r.raw_subject || '(no title)',
      recSource:    r.rec_source,
      opportunity:  r.opportunity_label,
      archetype:    r.archetype,
      conceptLabel: r.concept_label || r.peer_concept_label,
      wtpScore:     r.wtp_score,
    })),
  };
}

// --------------------------------------------------
// Claude API
// --------------------------------------------------
async function callClaude(prompt) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model:      MODEL,
      max_tokens: 4000,
      messages:   [{ role: 'user', content: prompt }],
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Anthropic API ${response.status}: ${errText.slice(0, 300)}`);
  }

  const data = await response.json();
  return data.content[0].text;
}

async function gradeChannelRecs(channelData) {
  const { channelName, niche, subscribers, dnaSummary, recentVideos, recs } = channelData;

  const recsBlock = recs.map(r =>
    `${r.rank}. "${r.title}"\n   Source: ${r.recSource || 'unknown'}  |  Opportunity: ${r.opportunity || 'none'}  |  Archetype: ${r.archetype || 'none'}`
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

1. Creator Relevance (1-5)
   Does this fit who this creator actually is? Their voice, format, established identity?
   5 = perfect fit for this specific creator
   1 = completely wrong creator for this topic

2. Filmability (1-5)
   Is the subject concrete and executable as a YouTube video right now?
   5 = clear, filmable, specific
   1 = vague/abstract/impossible to execute interestingly

3. Novelty (1-5)
   Is this a genuinely fresh angle this creator hasn't covered?
   5 = original and surprising
   1 = obvious, saturated, or already covered by this creator

4. Human Usefulness (1-5)
   Would a real creator feel "yes, I could make this tomorrow"?
   5 = they'd immediately add it to their content calendar
   1 = they'd roll their eyes and delete the suggestion

Overall Grade:
   Excellent — would genuinely improve their channel
   Good      — useful, would seriously consider it
   Average   — might use it but nothing special
   Poor      — unlikely to use, significant problems
   Garbage   — would actively harm their credibility or makes no sense

GHOST FLAG (passes_scoring_never_used: true/false):
Mark true if this recommendation would score well on technical/algorithmic metrics
but NO creator would realistically ever produce this video.
Examples: wrong voice for the channel, technically on-topic but creatively dead,
looks relevant on paper but misses the actual creator's craft entirely.

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
    "justification": "one to two sentences explaining overall assessment",
    "passes_scoring_never_used": false
  }
]`;

  const rawText = await callClaude(prompt);

  const jsonMatch = rawText.match(/\[[\s\S]*\]/);
  if (!jsonMatch) throw new Error(`No JSON array in response: ${rawText.slice(0, 300)}`);
  return JSON.parse(jsonMatch[0]);
}

// --------------------------------------------------
// Report generation
// --------------------------------------------------
function gradeScore(g) {
  return { Excellent: 5, Good: 4, Average: 3, Poor: 2, Garbage: 1 }[g] || 0;
}
function avg(arr) { return arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0; }
function pct(n, total) { return total ? Math.round((n / total) * 100) : 0; }

function buildReport(allResults) {
  const lines = [];
  const allGrades = allResults.flatMap(r => r.grades || []);

  const gradeCounts = { Excellent: 0, Good: 0, Average: 0, Poor: 0, Garbage: 0 };
  allGrades.forEach(g => { if (g.overall_grade in gradeCounts) gradeCounts[g.overall_grade]++; });
  const total  = allGrades.length;
  const ghosts = allGrades.filter(g => g.passes_scoring_never_used);

  lines.push('# WTP Human Usefulness Audit');
  lines.push('');
  lines.push(`**Generated:** ${new Date().toISOString().slice(0, 10)}`);
  lines.push(`**Model:** ${MODEL}  |  **Channels:** ${allResults.length}  |  **Recs evaluated:** ${total}`);
  lines.push(`**Question:** Would a creator actually use these recommendations?`);
  lines.push('');

  // ── Overall summary ──
  lines.push('---');
  lines.push('');
  lines.push('## Overall Results');
  lines.push('');
  lines.push('| Grade | Count | % |');
  lines.push('|---|---:|---:|');
  for (const [grade, count] of Object.entries(gradeCounts)) {
    lines.push(`| ${grade} | ${count} | ${pct(count, total)}% |`);
  }
  lines.push('');

  const overallAvg = avg(allGrades.map(g => gradeScore(g.overall_grade))).toFixed(2);
  const usefulPct  = pct(gradeCounts.Excellent + gradeCounts.Good, total);
  const badPct     = pct(gradeCounts.Poor + gradeCounts.Garbage, total);

  lines.push(`**Average grade score:** ${overallAvg}/5`);
  lines.push(`**Useful (Excellent + Good):** ${usefulPct}%`);
  lines.push(`**Subpar (Poor + Garbage):** ${badPct}%`);
  lines.push(`**Ghost recommendations (passes scoring, would never be used):** ${ghosts.length} / ${total} (${pct(ghosts.length, total)}%)`);
  lines.push('');

  // ── Per-niche averages ──
  lines.push('---');
  lines.push('');
  lines.push('## Per-Niche Performance');
  lines.push('');
  lines.push('| Niche | Channels | Avg Score | Excellent% | Garbage% | Ghost% |');
  lines.push('|---|---:|---:|---:|---:|---:|');

  const byNiche = {};
  for (const r of allResults) {
    if (!byNiche[r.targetNiche]) byNiche[r.targetNiche] = [];
    byNiche[r.targetNiche].push(...(r.grades || []));
  }
  for (const [niche, grades] of Object.entries(byNiche)) {
    const chCount  = allResults.filter(r => r.targetNiche === niche).length;
    const avgScore = avg(grades.map(g => gradeScore(g.overall_grade))).toFixed(2);
    const excPct   = pct(grades.filter(g => g.overall_grade === 'Excellent').length, grades.length);
    const garbPct  = pct(grades.filter(g => g.overall_grade === 'Garbage').length, grades.length);
    const ghostPct = pct(grades.filter(g => g.passes_scoring_never_used).length, grades.length);
    lines.push(`| ${niche} | ${chCount} | ${avgScore}/5 | ${excPct}% | ${garbPct}% | ${ghostPct}% |`);
  }
  lines.push('');

  // ── Per-channel results ──
  lines.push('---');
  lines.push('');
  lines.push('## Per-Channel Results');
  lines.push('');

  for (const result of allResults) {
    const { channelName, niche, targetNiche, subscribers, dnaSummary, recentVideos, grades, error } = result;
    lines.push(`### [${targetNiche}] ${channelName}`);
    lines.push('');
    lines.push(`**Niche:** ${niche}  |  **Subscribers:** ${(subscribers || 0).toLocaleString()}`);
    lines.push('');
    lines.push('<details><summary>Creator DNA</summary>');
    lines.push('');
    lines.push('```');
    lines.push(dnaSummary);
    lines.push('```');
    lines.push('');
    if (recentVideos.length) {
      lines.push('Recent uploads:');
      recentVideos.slice(0, 10).forEach(v => lines.push(`- ${v}`));
    }
    lines.push('</details>');
    lines.push('');

    if (error) {
      lines.push(`> ⚠️ Error: ${error}`);
      lines.push('');
      continue;
    }

    const chGrades    = grades || [];
    const chCounts    = { Excellent: 0, Good: 0, Average: 0, Poor: 0, Garbage: 0 };
    chGrades.forEach(g => { if (g.overall_grade in chCounts) chCounts[g.overall_grade]++; });
    const chAvg       = avg(chGrades.map(g => gradeScore(g.overall_grade))).toFixed(2);
    const chGhostCount = chGrades.filter(g => g.passes_scoring_never_used).length;

    lines.push(`**Score:** ${chAvg}/5  |  ` + Object.entries(chCounts).filter(([,v]) => v > 0).map(([k, v]) => `${k}: ${v}`).join('  |  ') + (chGhostCount ? `  |  ⚠️ ${chGhostCount} ghost` : ''));
    lines.push('');
    lines.push('| # | Title | Grade | Rel | Film | Novel | Useful | Flag |');
    lines.push('|---|---|---|---:|---:|---:|---:|---|');
    for (const g of chGrades) {
      const flag = g.passes_scoring_never_used ? '⚠️ GHOST' : '';
      const title = (g.title || '').length > 60 ? g.title.slice(0, 57) + '...' : (g.title || '');
      lines.push(`| ${g.rank} | ${title} | **${g.overall_grade}** | ${g.creator_relevance?.score ?? '?'} | ${g.filmability?.score ?? '?'} | ${g.novelty?.score ?? '?'} | ${g.human_usefulness?.score ?? '?'} | ${flag} |`);
    }
    lines.push('');

    for (const g of chGrades) {
      lines.push(`**${g.rank}. ${g.title}**  *(${g.overall_grade})*`);
      lines.push(`> ${g.justification}`);
      lines.push(`- **Relevance ${g.creator_relevance?.score}/5:** ${g.creator_relevance?.reason}`);
      lines.push(`- **Filmability ${g.filmability?.score}/5:** ${g.filmability?.reason}`);
      lines.push(`- **Novelty ${g.novelty?.score}/5:** ${g.novelty?.reason}`);
      lines.push(`- **Usefulness ${g.human_usefulness?.score}/5:** ${g.human_usefulness?.reason}`);
      if (g.passes_scoring_never_used) lines.push(`- ⚠️ **GHOST REC:** Technically passes scoring but would never realistically be produced.`);
      lines.push('');
    }
  }

  // ── Best recommendations ──
  lines.push('---');
  lines.push('');
  lines.push('## Best Recommendations (Excellent)');
  lines.push('');
  const excellent = allResults.flatMap(r =>
    (r.grades || []).filter(g => g.overall_grade === 'Excellent').map(g => ({ ...g, channelName: r.channelName, targetNiche: r.targetNiche }))
  );
  if (!excellent.length) {
    lines.push('No recommendations rated Excellent.');
  } else {
    for (const g of excellent) {
      lines.push(`**[${g.targetNiche}] ${g.channelName}**`);
      lines.push(`> "${g.title}"`);
      lines.push(`${g.justification}`);
      lines.push('');
    }
  }

  // ── Worst recommendations ──
  lines.push('---');
  lines.push('');
  lines.push('## Worst Recommendations (Garbage)');
  lines.push('');
  const garbage = allResults.flatMap(r =>
    (r.grades || []).filter(g => g.overall_grade === 'Garbage').map(g => ({ ...g, channelName: r.channelName, targetNiche: r.targetNiche }))
  );
  if (!garbage.length) {
    lines.push('No recommendations rated Garbage.');
  } else {
    for (const g of garbage) {
      lines.push(`**[${g.targetNiche}] ${g.channelName}**`);
      lines.push(`> "${g.title}"`);
      lines.push(`${g.justification}`);
      lines.push('');
    }
  }

  // ── Ghost recommendations ──
  lines.push('---');
  lines.push('');
  lines.push('## Ghost Recommendations — Passes Scoring, Would Never Be Used');
  lines.push('');
  lines.push('These are the highest-value failures: recommendations that look good to algorithmic scoring');
  lines.push('but that no creator would realistically produce. These expose blind spots in the scoring system.');
  lines.push('');
  if (!ghosts.length) {
    lines.push('No ghost recommendations detected.');
  } else {
    for (const g of ghosts) {
      const result = allResults.find(r => (r.grades || []).includes(g)) || {};
      lines.push(`**[${result.targetNiche || '?'}] ${result.channelName || '?'}** — *${g.overall_grade}*`);
      lines.push(`> "${g.title}"`);
      lines.push(`${g.justification}`);
      lines.push(`- Creator Relevance: ${g.creator_relevance?.reason}`);
      lines.push('');
    }
  }

  // ── Failure patterns ──
  lines.push('---');
  lines.push('');
  lines.push('## Recurring Failure Patterns');
  lines.push('');

  const lowGrades  = allGrades.filter(g => ['Poor', 'Garbage'].includes(g.overall_grade));
  const highGrades = allGrades.filter(g => ['Excellent', 'Good'].includes(g.overall_grade));

  if (lowGrades.length) {
    lines.push(`### What makes recommendations fail (${lowGrades.length} Poor/Garbage)`);
    lines.push('');
    lines.push('Average dimension scores for Poor/Garbage:');
    lines.push(`- Creator Relevance: **${avg(lowGrades.map(g => g.creator_relevance?.score || 0)).toFixed(2)}/5**`);
    lines.push(`- Filmability:       **${avg(lowGrades.map(g => g.filmability?.score || 0)).toFixed(2)}/5**`);
    lines.push(`- Novelty:           **${avg(lowGrades.map(g => g.novelty?.score || 0)).toFixed(2)}/5**`);
    lines.push(`- Human Usefulness:  **${avg(lowGrades.map(g => g.human_usefulness?.score || 0)).toFixed(2)}/5**`);
    lines.push('');
    lines.push('*(The lowest-scoring dimension is the primary failure mode)*');
    lines.push('');
  }

  if (highGrades.length) {
    lines.push(`### What makes recommendations succeed (${highGrades.length} Excellent/Good)`);
    lines.push('');
    lines.push('Average dimension scores for Excellent/Good:');
    lines.push(`- Creator Relevance: **${avg(highGrades.map(g => g.creator_relevance?.score || 0)).toFixed(2)}/5**`);
    lines.push(`- Filmability:       **${avg(highGrades.map(g => g.filmability?.score || 0)).toFixed(2)}/5**`);
    lines.push(`- Novelty:           **${avg(highGrades.map(g => g.novelty?.score || 0)).toFixed(2)}/5**`);
    lines.push(`- Human Usefulness:  **${avg(highGrades.map(g => g.human_usefulness?.score || 0)).toFixed(2)}/5**`);
    lines.push('');
  }

  // ── Success patterns ──
  lines.push('---');
  lines.push('');
  lines.push('## Recurring Success Patterns');
  lines.push('');

  const goodRecs = allResults.flatMap(r =>
    (r.grades || []).filter(g => ['Excellent', 'Good'].includes(g.overall_grade)).map(g => ({
      ...g, channelName: r.channelName, targetNiche: r.targetNiche
    }))
  );
  if (!goodRecs.length) {
    lines.push('Insufficient data for pattern analysis.');
  } else {
    // Group by rec_source
    const bySource = {};
    for (const r of allResults) {
      for (const rec of (r.recs || [])) {
        const grade = (r.grades || []).find(g => g.rank === rec.rank);
        if (!grade) continue;
        const src = rec.recSource || 'unknown';
        if (!bySource[src]) bySource[src] = [];
        bySource[src].push(gradeScore(grade.overall_grade));
      }
    }
    lines.push('**Average grade score by recommendation source:**');
    lines.push('');
    lines.push('| Source | Count | Avg Score |');
    lines.push('|---|---:|---:|');
    for (const [src, scores] of Object.entries(bySource).sort((a, b) => avg(b[1]) - avg(a[1]))) {
      lines.push(`| ${src} | ${scores.length} | ${avg(scores).toFixed(2)}/5 |`);
    }
    lines.push('');
  }

  lines.push('---');
  lines.push('');
  lines.push('*End of report*');
  lines.push('');

  return lines.join('\n');
}

// --------------------------------------------------
// Ghost search helper (for report — references by object identity won't work)
// --------------------------------------------------
function buildGhostList(allResults) {
  return allResults.flatMap(r =>
    (r.grades || []).filter(g => g.passes_scoring_never_used).map(g => ({
      ...g, channelName: r.channelName, targetNiche: r.targetNiche,
    }))
  );
}

// --------------------------------------------------
// Main
// --------------------------------------------------
async function main() {
  console.log('[audit] WTP Human Usefulness Audit');
  console.log('[audit] Model:', MODEL, ' | Dry-run:', DRY_RUN);

  if (!DRY_RUN && !ANTHROPIC_API_KEY) {
    console.error('[audit] ANTHROPIC_API_KEY not set. Add it to server/.env or pass it in the environment.');
    process.exit(1);
  }

  const db = new Database(DB_PATH, { readonly: true, timeout: 30000 });

  let channels;
  if (SINGLE_CHANNEL) {
    const row = db.prepare('SELECT channel_id, channel_name, niche, channel_subscribers FROM ingested_channels WHERE channel_id = ?').get(SINGLE_CHANNEL);
    if (!row) { console.error('[audit] Channel not found:', SINGLE_CHANNEL); db.close(); process.exit(1); }
    channels = [{ ...row, target_niche: row.niche || 'unknown', trace_count: 0 }];
  } else {
    channels = selectChannels(db);
  }

  console.log(`[audit] Selected ${channels.length} channels:`);
  channels.forEach(ch => console.log(`  [${ch.target_niche}] ${ch.channel_name} (${ch.trace_count} traces)`));

  const allData = channels.map(ch => {
    const data = getChannelData(db, ch.channel_id, ch.target_niche);
    if (DRY_RUN) {
      console.log(`\n── [${data.targetNiche}] ${data.channelName} ──`);
      console.log('  DNA:', data.dnaSummary.split('\n')[0]);
      console.log('  Recent videos:', data.recentVideos.length);
      console.log('  Recs:');
      data.recs.forEach(r => console.log(`    ${r.rank}. ${r.title} [${r.recSource}]`));
    }
    return data;
  });

  db.close();

  if (DRY_RUN) {
    console.log('\n[audit] Dry-run complete — no Claude API calls made.');
    return;
  }

  // Grade each channel
  const results = [];
  for (const [i, channelData] of allData.entries()) {
    if (!channelData.recs.length) {
      console.warn(`[audit] Skipping ${channelData.channelName} — no recommendations in DB`);
      results.push({ ...channelData, grades: [], error: 'No recommendations found' });
      continue;
    }

    process.stdout.write(`[audit] (${i + 1}/${allData.length}) Grading: ${channelData.channelName} ... `);
    try {
      const grades = await gradeChannelRecs(channelData);
      results.push({ ...channelData, grades });
      const summary = grades.map(g => g.overall_grade[0]).join('');
      console.log(`${summary}  avg=${avg(grades.map(g => gradeScore(g.overall_grade))).toFixed(1)}`);
    } catch (e) {
      console.log(`ERROR: ${e.message}`);
      results.push({ ...channelData, grades: [], error: e.message });
    }

    if (i < allData.length - 1) await sleep(API_DELAY_MS);
  }

  // Fix ghost references in buildReport (it uses .includes on grade objects which needs identity)
  // Rebuild ghost list by matching on (channelId + rank)
  const ghostSet = new Set(
    results.flatMap(r => (r.grades || []).filter(g => g.passes_scoring_never_used).map(g => `${r.channelId}:${g.rank}`))
  );

  // Save JSON
  fs.writeFileSync(JSON_PATH, JSON.stringify(results, null, 2));
  console.log(`\n[audit] JSON: ${JSON_PATH}`);

  // Build and save report
  const report = buildReport(results);
  fs.writeFileSync(REPORT_PATH, report);
  console.log(`[audit] Report: ${REPORT_PATH}`);

  // Final summary
  const allGrades = results.flatMap(r => r.grades || []);
  const total     = allGrades.length;
  const gradeCounts = { Excellent: 0, Good: 0, Average: 0, Poor: 0, Garbage: 0 };
  allGrades.forEach(g => { if (g.overall_grade in gradeCounts) gradeCounts[g.overall_grade]++; });
  const ghosts    = allGrades.filter(g => g.passes_scoring_never_used).length;
  const overallAvg = avg(allGrades.map(g => gradeScore(g.overall_grade))).toFixed(2);

  console.log('\n════════════════════════════════════════════');
  console.log('  WTP Human Usefulness Audit — Final Results');
  console.log('════════════════════════════════════════════');
  console.log(`  Channels evaluated: ${results.length}`);
  console.log(`  Recommendations:    ${total}`);
  console.log(`  Average score:      ${overallAvg}/5`);
  console.log('');
  for (const [grade, count] of Object.entries(gradeCounts)) {
    const bar = '█'.repeat(count) + '░'.repeat(Math.max(0, 10 - count));
    console.log(`  ${grade.padEnd(10)} ${bar} ${count} (${pct(count, total)}%)`);
  }
  console.log('');
  console.log(`  Ghost recs (passes scoring, never used): ${ghosts}/${total} (${pct(ghosts, total)}%)`);
  console.log(`  Useful (Excellent+Good): ${pct((gradeCounts.Excellent + gradeCounts.Good), total)}%`);
  console.log('════════════════════════════════════════════');
}

main().catch(e => { console.error('[audit] FATAL:', e); process.exit(1); });

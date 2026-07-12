'use strict';

/**
 * Phase 4 — Creator Style Type
 *
 * Computes creator_style_type for creator_idea_dna rows.
 * Two values only: personality_driven | topic_driven
 *
 * Inputs used:
 *   vocabulary_json       — style markers (swear, slang, informal register)
 *   hook_templates_json   — statement_frame, hidden_secret_hook, this_x = personality
 *                           how_x, why_x, what_is_x, comparison_hook, question_hook = topic
 *   thesis_patterns_json  — density signals educational/explanatory content
 *   stable_dna_json       — sample_count (data quality gate)
 *
 * Decision rule:
 *   personality_score = statement_frame_count + personality_hook_count + style_marker_count
 *   topic_score       = edu_hook_count + thesis_count + comparison_count
 *
 *   If personality_score > topic_score  → personality_driven
 *   Else                                → topic_driven
 *
 * Usage:
 *   node computeCreatorStyleType.js [--limit=N] [--dry-run]
 */

const path = require('path');
const BetterSqlite3 = require('../node_modules/better-sqlite3');

const DRY_RUN = process.argv.includes('--dry-run');
const LIMIT   = parseInt((process.argv.find(a => a.startsWith('--limit=')) || '--limit=1000').split('=')[1], 10) || 1000;

function openDb() {
  return new BetterSqlite3(path.resolve(__dirname, '../data/scoring.db'), {
    readonly: DRY_RUN,
    timeout:  60000,
  });
}

function parseJson(val) {
  if (!val || val === 'null') return null;
  try { return JSON.parse(val); } catch { return null; }
}

// Personality hooks — creator-first, stance-driven
const PERSONALITY_HOOK_IDS = new Set([
  'statement_frame', 'hidden_secret_hook', 'this_x',
  'personal_story', 'confession_hook', 'opinion_hook', 'rant_hook',
  'journey_hook', 'storytime_hook', 'roast_hook', 'commentary_hook',
]);

// Topic hooks — content/information-first
const TOPIC_HOOK_IDS = new Set([
  'how_x', 'why_x', 'what_is_x', 'comparison_hook', 'question_hook',
  'explainer_hook', 'analysis_hook', 'breakdown_hook',
  'money_number_hook',  // data-driven, not personality
]);

// Personality vocabulary markers
const PERSONALITY_VOCAB_RE = /\b(i\s+(think|feel|believe|hate|love|wish|mean)|honestly|literally|okay\s+so|let'?s\s+be\s+real|this\s+is\s+crazy|not\s+gonna\s+lie|bro\s+|dude\s+|yo\s+|tbh|lol|omg|wtf|seriously|legit|iconic|vibe|slay|goat|sus|lowkey|highkey|based|cringe)\b/i;

function computeStyleType(row) {
  const hooks  = parseJson(row.hook_templates_json) || [];
  const thesis = parseJson(row.thesis_patterns_json) || [];
  const vocab  = parseJson(row.vocabulary_json) || [];
  const stable = parseJson(row.stable_dna_json) || {};

  // Data quality gate — need at least 5 video samples
  const sampleCount = stable.sample_count || 0;
  if (sampleCount < 3 && hooks.length === 0) return null;

  // Reliable hooks only (score > 1.0)
  const reliableHooks = hooks.filter(h => (h.score || 0) > 1.0);

  // Statement_frame is universal but when it's the ONLY strong hook → topic_driven
  const hasOnlyStatementFrame = reliableHooks.length > 0 &&
    reliableHooks.every(h => h.id === 'statement_frame');

  // Personality score
  const personalityHookScore = reliableHooks
    .filter(h => PERSONALITY_HOOK_IDS.has(h.id) && h.id !== 'statement_frame')
    .reduce((s, h) => s + Math.min(2, h.score || 1), 0);

  // statement_frame contributes 0.5 (ambiguous signal)
  const statementFrameScore = reliableHooks.some(h => h.id === 'statement_frame') ? 0.5 : 0;

  // Vocabulary style marker score
  const vocabStyleScore = vocab
    .filter(v => PERSONALITY_VOCAB_RE.test(v.label || '') && (v.score || 0) > 1.0)
    .reduce((s, v) => s + Math.min(1, v.score || 0.5), 0);

  const personalityTotal = personalityHookScore + statementFrameScore + vocabStyleScore;

  // Topic score
  const topicHookScore = reliableHooks
    .filter(h => TOPIC_HOOK_IDS.has(h.id))
    .reduce((s, h) => s + Math.min(2, h.score || 1), 0);

  const thesisScore = Math.min(3, thesis.filter(t => (t.score || 0) > 1.0).length * 0.5);

  const topicTotal = topicHookScore + thesisScore;

  // Decision
  const styleType = personalityTotal > topicTotal ? 'personality_driven' : 'topic_driven';

  return {
    styleType,
    personalityTotal: +personalityTotal.toFixed(2),
    topicTotal:       +topicTotal.toFixed(2),
    hookCount:        reliableHooks.length,
    hasOnlyStatementFrame,
  };
}

function main() {
  const db = openDb();

  const rows = db.prepare(`
    SELECT channel_id, hook_templates_json, thesis_patterns_json,
           vocabulary_json, stable_dna_json
    FROM creator_idea_dna
    WHERE hook_templates_json IS NOT NULL
      AND hook_templates_json != 'null'
    ORDER BY RANDOM()
    LIMIT ?
  `).all([LIMIT]);

  console.log('\n══════════════════════════════════════════════════════════════');
  console.log('  Phase 4 — Creator Style Type');
  console.log(`  Processing: ${rows.length} creators   Mode: ${DRY_RUN ? 'DRY RUN' : 'WRITE'}`);
  console.log('══════════════════════════════════════════════════════════════\n');

  const results = rows.map(row => {
    const result = computeStyleType(row);
    return { channel_id: row.channel_id, result };
  }).filter(r => r.result !== null);

  // Distribution
  const personality = results.filter(r => r.result.styleType === 'personality_driven');
  const topic       = results.filter(r => r.result.styleType === 'topic_driven');
  const pct = (n, d) => d > 0 ? (n / d * 100).toFixed(1) : '0.0';

  console.log(`  Results: ${results.length} / ${rows.length} classifiable`);
  console.log(`  personality_driven: ${personality.length} (${pct(personality.length, results.length)}%)`);
  console.log(`  topic_driven:       ${topic.length} (${pct(topic.length, results.length)}%)`);

  // Score distribution
  const pScores = personality.map(r => r.result.personalityTotal);
  const tScores = topic.map(r => r.result.topicTotal);
  const mean = arr => arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0;
  console.log(`\n  Avg personality score (personality_driven): ${mean(pScores).toFixed(2)}`);
  console.log(`  Avg topic score (topic_driven):             ${mean(tScores).toFixed(2)}`);

  // Margin analysis — how decisive is the classification?
  const margins = results.map(r => Math.abs(r.result.personalityTotal - r.result.topicTotal));
  const toss    = results.filter(r => Math.abs(r.result.personalityTotal - r.result.topicTotal) < 0.5);
  console.log(`  Toss-up (margin < 0.5):  ${toss.length} (${pct(toss.length, results.length)}%)`);
  console.log(`  Avg margin:              ${mean(margins).toFixed(2)}`);

  // Sample
  console.log('\n  Sample personality_driven:');
  personality.slice(0, 5).forEach(r => {
    console.log(`    ${r.channel_id.slice(0, 24)}  p=${r.result.personalityTotal.toFixed(2)} t=${r.result.topicTotal.toFixed(2)}`);
  });
  console.log('  Sample topic_driven:');
  topic.slice(0, 5).forEach(r => {
    console.log(`    ${r.channel_id.slice(0, 24)}  p=${r.result.personalityTotal.toFixed(2)} t=${r.result.topicTotal.toFixed(2)}`);
  });

  if (DRY_RUN) {
    console.log('\n  [DRY RUN — no writes]\n');
    return;
  }

  // Write back to DB
  const stmt = db.prepare(`
    UPDATE creator_idea_dna SET creator_style_type = ? WHERE channel_id = ?
  `);
  const writeAll = db.transaction(() => {
    for (const r of results) {
      stmt.run(r.result.styleType, r.channel_id);
    }
  });
  writeAll();

  // Verify
  const written = db.prepare(`
    SELECT creator_style_type, COUNT(*) as n
    FROM creator_idea_dna
    WHERE creator_style_type IS NOT NULL
    GROUP BY creator_style_type
  `).all();
  console.log('\n  Written to DB:');
  written.forEach(r => console.log(`    ${r.creator_style_type}: ${r.n}`));

  // Correlation check with gold labels
  const goldCorr = db.prepare(`
    SELECT r.human_label, d.creator_style_type, COUNT(*) as n
    FROM wtp_human_quality_reviews r
    JOIN creator_idea_dna d ON d.channel_id = r.channel_id
    WHERE r.human_label IS NOT NULL AND d.creator_style_type IS NOT NULL
    GROUP BY r.human_label, d.creator_style_type
    ORDER BY r.human_label, d.creator_style_type
  `).all();

  if (goldCorr.length > 0) {
    console.log('\n── GOLD LABEL CORRELATION ────────────────────────────────────');
    const byType = {};
    for (const row of goldCorr) {
      const t = row.creator_style_type;
      if (!byType[t]) byType[t] = {};
      byType[t][row.human_label] = (byType[t][row.human_label] || 0) + row.n;
    }
    for (const [styleType, counts] of Object.entries(byType)) {
      const total    = Object.values(counts).reduce((s, v) => s + v, 0);
      const positive = (counts.Excellent || 0) + (counts.Good || 0);
      const parts    = ['Excellent', 'Good', 'Average', 'Poor', 'Garbage']
        .filter(l => counts[l])
        .map(l => `${l}:${counts[l]}`).join(' ');
      console.log(`  ${styleType.padEnd(22)} n=${total}  pos=${pct(positive, total)}%  ${parts}`);
    }
    const pTypePos = byType.personality_driven ? ((byType.personality_driven.Excellent || 0) + (byType.personality_driven.Good || 0)) : 0;
    const pTypeTotal = byType.personality_driven ? Object.values(byType.personality_driven).reduce((s, v) => s + v, 0) : 0;
    const tTypePos = byType.topic_driven ? ((byType.topic_driven.Excellent || 0) + (byType.topic_driven.Good || 0)) : 0;
    const tTypeTotal = byType.topic_driven ? Object.values(byType.topic_driven).reduce((s, v) => s + v, 0) : 0;

    if (pTypeTotal > 0 && tTypeTotal > 0) {
      const diff = pct(pTypePos, pTypeTotal) - pct(tTypePos, tTypeTotal);
      console.log(`\n  Correlation: personality_driven pos=${pct(pTypePos, pTypeTotal)}%  topic_driven pos=${pct(tTypePos, tTypeTotal)}%`);
      if (Math.abs(diff) < 5) {
        console.log('  ⚠ No meaningful correlation — personality_type does not predict recommendation quality.');
        console.log('  → Do NOT expand personality voice profiling based on this data.');
      } else {
        console.log(`  ✓ ${diff > 0 ? 'personality_driven' : 'topic_driven'} channels produce better quality recommendations (+${Math.abs(diff).toFixed(1)}pp)`);
      }
    }
  } else {
    console.log('\n  No gold label rows matched channel_id in creator_idea_dna.');
    console.log('  (Gold set uses channels whose DNA may not have been sampled)');
  }

  console.log('\n══════════════════════════════════════════════════════════════\n');
  db.close();
}

main();

'use strict';

/**
 * Creator Voice Feasibility Audit — Phase 5
 *
 * Audits creator_idea_dna fields to determine whether sufficient signal exists
 * to compute four voice-profile dimensions:
 *
 *   education_level   — how much the creator explains/teaches vs. entertains
 *   spectacle_level   — reliance on visual drama, scale, shock, or action
 *   personality_level — creator-persona vs. topic-first content
 *   challenge_level   — difficulty, adversity, competition in content
 *
 * Measures per field:
 *   - hook density       hook_templates_json items with score > 1.0
 *   - thesis density     thesis_patterns_json items per creator
 *   - micro-topic density micro_topics_json items per creator
 *   - domain_tags        domain_tags_json items per creator
 *   - CSP coverage       whether stable_dna_json has full content-style data
 *
 * Outputs:
 *   - Coverage per field (% of creators with enough signal)
 *   - Feasibility verdict per voice dimension (FEASIBLE / PARTIAL / NOT_FEASIBLE)
 *   - Sample derivation examples for each dimension
 *
 * Usage:
 *   node creatorVoiceFeasibilityAudit.js [--sample=N] [--verbose]
 */

const path = require('path');
const BetterSqlite3 = require('../node_modules/better-sqlite3');

function openDb() {
  return new BetterSqlite3(path.resolve(__dirname, '../data/scoring.db'), {
    readonly: true,
    timeout:  60000,
  });
}

function pct(n, d) { return d > 0 ? (n / d * 100).toFixed(1) : '0.0'; }
function mean(arr) { return arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0; }
function median(arr) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

// ── Hook type classifiers for voice dimensions ─────────────────────────────────

// education_level: hooks that explain, teach, or provide information
// Includes both the canonical expected IDs and the actual IDs found in the corpus
const EDUCATION_HOOKS = new Set([
  // actual IDs found in corpus
  'question_hook', 'how_x', 'why_x', 'what_is_x', 'comparison_hook',
  // canonical / additional expected IDs
  'explainer_hook', 'lesson_hook', 'fact_hook', 'myth_bust',
  'mistake_hook', 'warning_hook', 'guide_hook', 'tutorial_hook', 'how_to_hook',
  'insight_hook', 'breakdown_hook', 'deep_dive', 'analysis_hook',
]);

// spectacle_level: hooks driven by scale, drama, shock, or investigation
const SPECTACLE_HOOKS = new Set([
  // actual IDs found in corpus
  'money_number_hook', 'investigation_hook', 'future_threat_hook',
  // canonical / additional expected IDs
  'shock_hook', 'visual_hook', 'reaction_hook', 'scale_hook', 'stunt_hook',
  'transformation_hook', 'reveal_hook', 'spectacle_hook', 'viral_hook',
  'dramatic_hook', 'extreme_hook', 'challenge_hook',
]);

// personality_level: hooks anchored to creator stance, persona, or intrigue reveal
const PERSONALITY_HOOKS = new Set([
  // actual IDs found in corpus
  'hidden_secret_hook', 'this_x',
  // canonical / additional expected IDs
  'personal_story', 'confession_hook', 'opinion_hook', 'rant_hook',
  'journey_hook', 'storytime_hook', 'roast_hook', 'commentary_hook',
  'lifestyle_hook', 'day_in_life', 'reaction_personal',
]);

// challenge_level: hooks involving difficulty, competition, or adversity
// No corpus hook IDs map here — feasibility driven by micro_topics patterns
const CHALLENGE_HOOKS = new Set([
  'challenge_hook', 'competition_hook', 'vs_hook', 'obstacle_hook',
  'survival_hook', 'record_hook', 'bet_hook', 'dare_hook', 'impossible_hook',
]);

// Domain tags associated with education
const EDUCATION_TAGS = new Set([
  'education', 'tech_ai', 'finance_business', 'science', 'history', 'legal',
  'exam_prep', 'learning', 'how_to', 'explainer',
]);

// ── Per-creator signal extraction ─────────────────────────────────────────────

function parseJson(val) {
  if (!val || val === 'null') return null;
  try { return JSON.parse(val); } catch { return null; }
}

function analyzeCreator(row) {
  const hooks      = parseJson(row.hook_templates_json) || [];
  const thesis     = parseJson(row.thesis_patterns_json) || [];
  const microTopics= parseJson(row.micro_topics_json) || [];
  const domainTags = parseJson(row.domain_tags_json) || [];
  const stableDna  = parseJson(row.stable_dna_json) || {};
  const vocab      = parseJson(row.vocabulary_json) || [];
  const entities   = parseJson(row.entities_json) || [];

  // Raw counts
  const hookCount   = hooks.length;
  const thesisCount = thesis.length;
  const topicCount  = microTopics.length;
  const tagCount    = domainTags.length;

  // Hook density (score-weighted — only hooks with score > 1.0 are reliable signals)
  const reliableHooks = hooks.filter(h => (h.score || 0) > 1.0);

  // Voice signal scores (0–1)
  const educationHookScore   = reliableHooks.filter(h => EDUCATION_HOOKS.has(h.id)).length;
  const spectacleHookScore   = reliableHooks.filter(h => SPECTACLE_HOOKS.has(h.id)).length;
  const personalityHookScore = reliableHooks.filter(h => PERSONALITY_HOOKS.has(h.id)).length;
  const challengeHookScore   = reliableHooks.filter(h => CHALLENGE_HOOKS.has(h.id)).length;

  const educationTagScore    = domainTags.filter(t => EDUCATION_TAGS.has(t.id)).length;

  // statement_frame hook signals personality (not in the exact PERSONALITY_HOOKS set above)
  const statementFrame = reliableHooks.filter(h => h.id === 'statement_frame').length;

  // Feasibility flags per dimension
  const hasEnoughHooks   = reliableHooks.length >= 2;
  const hasThesis        = thesisCount >= 1;
  const hasMicroTopics   = topicCount >= 3;
  const hasDomainTags    = tagCount >= 1;
  const hasStableDna     = !!(stableDna.sample_count && stableDna.sample_count >= 5);
  const hasVocab         = vocab.length >= 3;

  // Per-dimension feasibility score (0 = no signal, 1 = partial, 2 = strong signal)
  const educationFeasibility = (
    (educationHookScore > 0 ? 1 : 0) +
    (educationTagScore > 0 ? 1 : 0) +
    (thesisCount >= 2 ? 1 : 0)
  ); // 0-3

  const spectacleFeasibility = (
    (spectacleHookScore > 0 ? 1 : 0) +
    (reliableHooks.some(h => h.examples && h.examples.some(e => /\d+/.test(e))) ? 1 : 0)
  ); // 0-2

  const personalityFeasibility = (
    (personalityHookScore > 0 ? 1 : 0) +
    (statementFrame > 0 ? 1 : 0) +
    (hasVocab ? 1 : 0)
  ); // 0-3

  const challengeFeasibility = (
    (challengeHookScore > 0 ? 1 : 0) +
    (microTopics.some(t => /challenge|compet|vs\.|battle|record/i.test(t.label || '')) ? 1 : 0)
  ); // 0-2

  return {
    hookCount,
    thesisCount,
    topicCount,
    tagCount,
    reliableHookCount:    reliableHooks.length,
    hasEnoughHooks,
    hasThesis,
    hasMicroTopics,
    hasDomainTags,
    hasStableDna,
    hasVocab,
    educationFeasibility,
    spectacleFeasibility,
    personalityFeasibility,
    challengeFeasibility,
    // Hook type breakdown
    educationHooks:   educationHookScore,
    spectacleHooks:   spectacleHookScore,
    personalityHooks: personalityHookScore,
    challengeHooks:   challengeHookScore,
    sampleCount:      stableDna.sample_count || 0,
    topHookTypes:     reliableHooks.slice(0, 3).map(h => h.id),
    topDomainTags:    domainTags.slice(0, 3).map(t => t.id),
  };
}

// ── Main ───────────────────────────────────────────────────────────────────────

function main() {
  const args    = process.argv.slice(2);
  const sample  = parseInt((args.find(a => a.startsWith('--sample=')) || '--sample=1000').split('=')[1], 10) || 1000;
  const verbose = args.includes('--verbose');

  const db = openDb();

  try {
    const totalCreators = db.prepare(`SELECT COUNT(*) as n FROM creator_idea_dna`).get().n;

    // Sample creators with at least some signal
    const creators = db.prepare(`
      SELECT channel_id, hook_templates_json, thesis_patterns_json, micro_topics_json,
             domain_tags_json, stable_dna_json, vocabulary_json, entities_json,
             confidence_score, drift_status, sample_count
      FROM creator_idea_dna
      WHERE hook_templates_json IS NOT NULL
        AND hook_templates_json != 'null'
        AND hook_templates_json != '[]'
      ORDER BY RANDOM()
      LIMIT ?
    `).all([sample]);

    console.log('\n══════════════════════════════════════════════════════════════');
    console.log('  Creator Voice Feasibility Audit');
    console.log(`  Sample: ${creators.length.toLocaleString()} / ${totalCreators.toLocaleString()} creators`);
    console.log('══════════════════════════════════════════════════════════════\n');

    // Analyse all sampled creators
    const analyses = creators.map(row => analyzeCreator(row));

    const n = analyses.length;

    // ── 1. Field Coverage ────────────────────────────────────────────────────
    const withEnoughHooks  = analyses.filter(a => a.hasEnoughHooks).length;
    const withThesis       = analyses.filter(a => a.hasThesis).length;
    const withMicroTopics  = analyses.filter(a => a.hasMicroTopics).length;
    const withDomainTags   = analyses.filter(a => a.hasDomainTags).length;
    const withStableDna    = analyses.filter(a => a.hasStableDna).length;
    const withVocab        = analyses.filter(a => a.hasVocab).length;

    const avgHooks   = mean(analyses.map(a => a.hookCount));
    const avgThesis  = mean(analyses.map(a => a.thesisCount));
    const avgTopics  = mean(analyses.map(a => a.topicCount));
    const avgTags    = mean(analyses.map(a => a.tagCount));
    const medSample  = median(analyses.map(a => a.sampleCount));

    console.log('── 1. FIELD COVERAGE ─────────────────────────────────────────');
    console.log('  Field                     Coverage    Avg per creator');
    console.log(`  hook_templates_json       ${pct(withEnoughHooks, n).padStart(6)}%    ${avgHooks.toFixed(1)} hooks (${pct(analyses.filter(a => a.reliableHookCount >= 2).length, n)}% have ≥2 reliable)`);
    console.log(`  thesis_patterns_json      ${pct(withThesis, n).padStart(6)}%    ${avgThesis.toFixed(1)} patterns`);
    console.log(`  micro_topics_json         ${pct(withMicroTopics, n).padStart(6)}%    ${avgTopics.toFixed(1)} topics`);
    console.log(`  domain_tags_json          ${pct(withDomainTags, n).padStart(6)}%    ${avgTags.toFixed(1)} tags`);
    console.log(`  stable_dna_json (≥5 vids) ${pct(withStableDna, n).padStart(6)}%    median sample=${medSample}`);
    console.log(`  vocabulary_json (≥3 words) ${pct(withVocab, n).padStart(6)}%`);

    // ── 2. Voice Dimension Feasibility ───────────────────────────────────────
    // Strong = score >= 2, Partial = score == 1, None = 0
    const eduStrong   = analyses.filter(a => a.educationFeasibility >= 2).length;
    const eduPartial  = analyses.filter(a => a.educationFeasibility === 1).length;
    const eduNone     = analyses.filter(a => a.educationFeasibility === 0).length;

    const spcStrong   = analyses.filter(a => a.spectacleFeasibility >= 2).length;
    const spcPartial  = analyses.filter(a => a.spectacleFeasibility === 1).length;
    const spcNone     = analyses.filter(a => a.spectacleFeasibility === 0).length;

    const prsStrong   = analyses.filter(a => a.personalityFeasibility >= 2).length;
    const prsPartial  = analyses.filter(a => a.personalityFeasibility === 1).length;
    const prsNone     = analyses.filter(a => a.personalityFeasibility === 0).length;

    const chlStrong   = analyses.filter(a => a.challengeFeasibility >= 2).length;
    const chlPartial  = analyses.filter(a => a.challengeFeasibility === 1).length;
    const chlNone     = analyses.filter(a => a.challengeFeasibility === 0).length;

    function feasVerdict(strong, partial, total) {
      const strongPct = strong / total;
      const partialPct = (strong + partial) / total;
      if (strongPct >= 0.50) return 'FEASIBLE     — strong signal in >50% of creators';
      if (partialPct >= 0.60) return 'PARTIAL      — usable signal in >60%, but noisy';
      return 'NOT_FEASIBLE — insufficient signal coverage';
    }

    console.log('\n── 2. VOICE DIMENSION FEASIBILITY ────────────────────────────');
    console.log('  Dimension          Strong     Partial    None       Verdict');
    console.log('  ─────────────────────────────────────────────────────────────────────');

    console.log(
      `  education_level    ${pct(eduStrong, n).padStart(5)}%    ${pct(eduPartial, n).padStart(5)}%    ${pct(eduNone, n).padStart(5)}%    ` +
      feasVerdict(eduStrong, eduPartial, n)
    );
    console.log(
      `  spectacle_level    ${pct(spcStrong, n).padStart(5)}%    ${pct(spcPartial, n).padStart(5)}%    ${pct(spcNone, n).padStart(5)}%    ` +
      feasVerdict(spcStrong, spcPartial, n)
    );
    console.log(
      `  personality_level  ${pct(prsStrong, n).padStart(5)}%    ${pct(prsPartial, n).padStart(5)}%    ${pct(prsNone, n).padStart(5)}%    ` +
      feasVerdict(prsStrong, prsPartial, n)
    );
    console.log(
      `  challenge_level    ${pct(chlStrong, n).padStart(5)}%    ${pct(chlPartial, n).padStart(5)}%    ${pct(chlNone, n).padStart(5)}%    ` +
      feasVerdict(chlStrong, chlPartial, n)
    );

    // ── 3. Signal availability per dimension ─────────────────────────────────
    const withEducationHooks   = analyses.filter(a => a.educationHooks > 0).length;
    const withSpectacleHooks   = analyses.filter(a => a.spectacleHooks > 0).length;
    const withPersonalityHooks = analyses.filter(a => a.personalityHooks > 0).length;
    const withChallengeHooks   = analyses.filter(a => a.challengeHooks > 0).length;
    const withEducationTags    = analyses.filter(a => a.educationHooks > 0 || a.topDomainTags.some(t => EDUCATION_TAGS.has(t))).length;

    console.log('\n── 3. RAW SIGNAL AVAILABILITY ────────────────────────────────');
    console.log('  education_level sources:');
    console.log(`    education-type hooks:      ${withEducationHooks.toLocaleString()} / ${n} (${pct(withEducationHooks, n)}%)`);
    console.log(`    education domain tags:     ${withEducationTags.toLocaleString()} / ${n} (${pct(withEducationTags, n)}%)`);
    console.log(`    thesis patterns (any):     ${withThesis.toLocaleString()} / ${n} (${pct(withThesis, n)}%)`);

    console.log('  spectacle_level sources:');
    console.log(`    spectacle/visual hooks:    ${withSpectacleHooks.toLocaleString()} / ${n} (${pct(withSpectacleHooks, n)}%)`);
    console.log(`    → Derived from hook_templates_json only`);

    console.log('  personality_level sources:');
    console.log(`    personality/opinion hooks: ${withPersonalityHooks.toLocaleString()} / ${n} (${pct(withPersonalityHooks, n)}%)`);
    console.log(`    vocabulary signal:         ${withVocab.toLocaleString()} / ${n} (${pct(withVocab, n)}%)`);

    console.log('  challenge_level sources:');
    console.log(`    challenge-type hooks:      ${withChallengeHooks.toLocaleString()} / ${n} (${pct(withChallengeHooks, n)}%)`);
    console.log(`    micro-topic patterns:      ${withMicroTopics.toLocaleString()} / ${n} (${pct(withMicroTopics, n)}%)`);

    // ── 4. Hook type distribution ─────────────────────────────────────────────
    const hookTypeCounts = {};
    for (const a of analyses) {
      for (const ht of a.topHookTypes) {
        hookTypeCounts[ht] = (hookTypeCounts[ht] || 0) + 1;
      }
    }
    const topHookTypes = Object.entries(hookTypeCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12);

    console.log('\n── 4. TOP HOOK TYPES IN CORPUS ───────────────────────────────');
    topHookTypes.forEach(([id, count]) => {
      const dim = EDUCATION_HOOKS.has(id) ? '[edu]'
                : SPECTACLE_HOOKS.has(id) ? '[spc]'
                : PERSONALITY_HOOKS.has(id) ? '[prs]'
                : CHALLENGE_HOOKS.has(id) ? '[chl]'
                : '[unk]';
      console.log(`  ${dim} ${id.padEnd(28)} ${count.toLocaleString()} creators (${pct(count, n)}%)`);
    });

    // ── 5. CSP (Content Style Profile) coverage ──────────────────────────────
    const cspFields = ['hooks', 'thesis', 'microTopics', 'domainTags', 'vocab', 'entities'];
    const cspCoverage = {
      hooks:       analyses.filter(a => a.hookCount > 0).length,
      thesis:      analyses.filter(a => a.thesisCount > 0).length,
      microTopics: analyses.filter(a => a.topicCount > 0).length,
      domainTags:  analyses.filter(a => a.tagCount > 0).length,
      vocab:       analyses.filter(a => a.hasVocab).length,
      stableDna:   analyses.filter(a => a.hasStableDna).length,
    };
    const fullCsp = analyses.filter(a =>
      a.hookCount > 0 && a.thesisCount > 0 && a.topicCount > 0 && a.tagCount > 0
    ).length;

    console.log('\n── 5. CSP (CONTENT STYLE PROFILE) COVERAGE ──────────────────');
    Object.entries(cspCoverage).forEach(([k, v]) =>
      console.log(`  ${k.padEnd(20)} ${v.toLocaleString()} / ${n} (${pct(v, n)}%)`)
    );
    console.log(`  All 4 core fields:      ${fullCsp.toLocaleString()} / ${n} (${pct(fullCsp, n)}%) — full CSP available`);

    // ── 6. Sample derivation examples ────────────────────────────────────────
    if (verbose) {
      console.log('\n── 6. SAMPLE DERIVATION EXAMPLES ────────────────────────────');
      const samples = creators.slice(0, 5);
      for (const creator of samples) {
        const a = analyzeCreator(creator);
        const hooks = parseJson(creator.hook_templates_json) || [];
        const topHook = hooks.sort((a, b) => (b.score || 0) - (a.score || 0))[0];
        const thesis  = (parseJson(creator.thesis_patterns_json) || [])[0];
        console.log(`\n  Channel: ${creator.channel_id}`);
        console.log(`    hooks=${a.hookCount} thesis=${a.thesisCount} topics=${a.topicCount} tags=${a.tagCount}`);
        console.log(`    edu=${a.educationFeasibility} spc=${a.spectacleFeasibility} prs=${a.personalityFeasibility} chl=${a.challengeFeasibility}`);
        if (topHook) console.log(`    top hook: ${topHook.id} (score=${topHook.score?.toFixed(2)}) ex: "${(topHook.examples || [''])[0]?.slice(0,60)}"`);
        if (thesis)  console.log(`    top thesis: ${thesis.id} ex: "${(thesis.examples || [''])[0]?.slice(0,60)}"`);
      }
    }

    // ── Overall verdict ────────────────────────────────────────────────────────
    console.log('\n══════════════════════════════════════════════════════════════');
    console.log('  VOICE PROFILE FEASIBILITY VERDICT\n');

    const dimensions = [
      { name: 'education_level',  strong: eduStrong,  partial: eduPartial,  note: 'hook_templates + thesis_patterns + domain_tags' },
      { name: 'spectacle_level',  strong: spcStrong,  partial: spcPartial,  note: 'hook_templates only — limited hook-type vocabulary in current DNA' },
      { name: 'personality_level',strong: prsStrong,  partial: prsPartial,  note: 'hook_templates (statement_frame, opinion) + vocabulary_json' },
      { name: 'challenge_level',  strong: chlStrong,  partial: chlPartial,  note: 'hook_templates + micro_topics_json patterns' },
    ];

    for (const d of dimensions) {
      const strongPct  = d.strong / n;
      const partialPct = (d.strong + d.partial) / n;
      let verdict, action;
      if (strongPct >= 0.50) {
        verdict = 'FEASIBLE';
        action  = 'Can compute reliably from current DNA fields';
      } else if (partialPct >= 0.60) {
        verdict = 'PARTIAL';
        action  = 'Can compute with caveats — null-fill creators below threshold';
      } else {
        verdict = 'NOT_FEASIBLE';
        action  = 'Insufficient signal — expand DNA collection before implementing';
      }
      console.log(`  ${d.name.padEnd(20)} ${verdict.padEnd(14)} ${action}`);
      console.log(`    Signal: ${d.note}`);
      console.log(`    Coverage: ${pct(d.strong, n)}% strong, ${pct(d.partial, n)}% partial`);
    }

    console.log('\n  RECOMMENDATION:');
    const allFeasible = [eduStrong, prsStrong, chlStrong, spcStrong]
      .every(v => v / n >= 0.50);
    if (allFeasible) {
      console.log('  ✓ All 4 dimensions feasible. Proceed to voice profile implementation.');
    } else {
      const feasible = [
        [eduStrong, 'education_level'],
        [spcStrong, 'spectacle_level'],
        [prsStrong, 'personality_level'],
        [chlStrong, 'challenge_level'],
      ].filter(([v]) => v / n >= 0.50).map(([, name]) => name);

      const notFeasible = [
        [eduStrong, 'education_level'],
        [spcStrong, 'spectacle_level'],
        [prsStrong, 'personality_level'],
        [chlStrong, 'challenge_level'],
      ].filter(([v]) => v / n < 0.50).map(([, name]) => name);

      if (feasible.length) console.log(`  ✓ Implement these first: ${feasible.join(', ')}`);
      if (notFeasible.length) console.log(`  ✗ Defer until signal improved: ${notFeasible.join(', ')}`);
      console.log('    Action: Expand hook type vocabulary in DNA extraction to improve coverage.');
    }

    console.log('══════════════════════════════════════════════════════════════\n');

  } finally {
    db.close();
  }
}

// Export hook classifiers for use by voice profile scorer (when implemented)
module.exports = { EDUCATION_HOOKS, SPECTACLE_HOOKS, PERSONALITY_HOOKS, CHALLENGE_HOOKS };

main();

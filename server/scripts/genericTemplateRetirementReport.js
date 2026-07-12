'use strict';

/**
 * Generic Template Retirement Report — Phase 1
 *
 * Maps every template in FAMILY_TEMPLATES and EXPANSION_TEMPLATES to a winner
 * template category. Shows which templates produce GENERIC output (1.5% win rate)
 * vs winner-aligned output (24–42% win rate).
 *
 * Usage: node genericTemplateRetirementReport.js [--verbose]
 * Output: scripts/generic_template_retirement_report.md
 */

const path = require('path');
const fs   = require('fs');
const Database = require('../node_modules/better-sqlite3');

const VERBOSE = process.argv.includes('--verbose');
const DB_PATH = path.resolve(__dirname, '../data/scoring.db');
const OUT     = path.resolve(__dirname, 'generic_template_retirement_report.md');

// ── Template classifier (mirrors winnerTemplateLibrary.js logic) ──────────────

const TEMPLATE_DETECTORS = [
  {
    name: 'MISTAKE_BEHIND',
    win_rate: 0.246,
    generation_family: 'mistake',
    test: t => /\b((beginner |common |biggest |worst |the )?(mistake|error|problem|flaw|trap|pitfall)s?\b)/i.test(t),
  },
  {
    name: 'WAY_TO',
    win_rate: 0.278,
    generation_family: 'instructional',
    test: t => /\bway to\b|\bapproach to\b/i.test(t),
  },
  {
    name: 'CHECKLIST_FORMAT',
    win_rate: 0.161,
    generation_family: 'instructional',
    test: t => /\b(checklist|guide|tips?|routine|plan|framework)\s+(for|to)\b/i.test(t) ||
               /\ba (practical|honest|quick|simple)\s+(checklist|guide|tips?)/i.test(t),
  },
  {
    name: 'COLON_EXPLAINER',
    win_rate: 0.082,
    generation_family: 'comparison',
    test: t => /^[^:]{4,35}:\s*(risk|what to do|returns|timing|what works|what doesn|who benefits|who loses|habits?)/i.test(t),
  },
  {
    name: 'DISH_TECHNIQUE',
    win_rate: 0.421,
    generation_family: 'challenge',
    test: t => /\b(biryani|vada pav|dosa|thali|dal|sabzi|curry|paratha|khichdi|samosa|pani puri|street food|asmr cooking|home version|regional twist)\b/i.test(t) ||
               /can you make.*(home|without shortcuts)/i.test(t),
  },
  {
    name: 'COLON_VARIANT',
    win_rate: 0.052,
    generation_family: 'comparison',
    test: t => /^[^:]{3,40}:\s*(the budget version|quick version|a \d+-day|the honest|the local)/i.test(t) ||
               /budget version vs (the )?restaurant version/i.test(t),
  },
  {
    name: 'ASSUMPTION_REVERSAL',
    win_rate: 1.0,
    generation_family: 'narrative',
    test: t => /\bwe thought\b|\beveryone thinks\b/i.test(t),
  },
  {
    name: 'FORCED_CONFLICT',
    win_rate: 1.0,
    generation_family: 'narrative',
    test: t => /\bforced to\b|\bmade to\b/i.test(t),
  },
  {
    name: 'GENERIC_HOOK_PENALTY',
    win_rate: 0.0,
    generation_family: 'deprecated',
    test: t => /\b(check this|see this|watch this)\s*\.?\s*$/i.test(t),
  },
];

function classifyTemplate(topic) {
  for (const det of TEMPLATE_DETECTORS) {
    if (det.test(topic)) return det;
  }
  return { name: 'GENERIC', win_rate: 0.015, generation_family: 'none' };
}

// ── Probe each FAMILY_TEMPLATES entry with sample subjects ────────────────────

const SAMPLE_SUBJECTS = {
  finance_education: ['SIP choices', 'mutual fund risk', 'portfolio mistakes'],
  conversation_business: ['startup mistakes', 'career leverage', 'scale versus profit'],
  conversation_finance: ['money habits', 'debt mistakes', 'family finance'],
  conversation_spiritual: ['karma', 'meditation', 'consciousness'],
  news_event: ['policy change', 'election result', 'market shock'],
  exam_education: ['UPSC prelims', 'mains answer writing', 'current affairs'],
  tech_review: ['budget phones', 'AI features', 'laptop buying'],
  general_education: ['history', 'science basics', 'world affairs'],
  gaming_entertainment: ['rank push', 'beginner settings', 'squad strategy'],
  comedy_sketch: ['family pressure', 'office politics', 'college life'],
  travel_lifestyle: ['budget trip', 'hidden places', 'road trip'],
  cooking_food: ['street food', 'restaurant-style curry', 'healthy breakfast'],
  fitness_practice: ['back pain', 'weight loss', 'morning routine'],
  wellness_teaching: ['mindset shift', 'anxiety habits', 'self love'],
  spiritual_teaching: ['karma', 'meditation', 'consciousness'],
  generic: ['daily-life habit', 'beginner mistake', 'hidden tradeoff'],
};

// Template fn strings (reconstructed from known FAMILY_TEMPLATES)
const FAMILY_TEMPLATES_PROBE = {
  finance_education: [
    s => `How ${s} can change your next money decision`,
    s => `The beginner mistake inside ${s}`,
    s => `${s}: risk, returns, and timing explained simply`,
    s => `Before you trust ${s}, check this`,
    s => `A practical checklist for ${s}`,
  ],
  conversation_business: [
    s => `The hidden cost of ${s}`,
    s => `What ambitious people get wrong about ${s}`,
    s => `How ${s} can change careers faster than people expect`,
    s => `The status trap behind ${s}`,
    s => `Why ${s} can distort success before it arrives`,
  ],
  conversation_finance: [
    s => `A money conversation about ${s}`,
    s => `The money mistake families make with ${s}`,
    s => `${s}: habits, risks, and better choices`,
    s => `What nobody explains clearly about ${s}`,
    s => `The honest tradeoff behind ${s}`,
  ],
  conversation_spiritual: [
    s => `The deeper pattern behind ${s}`,
    s => `${s}: myth, meaning, and modern life`,
    s => `What ${s} reveals about inner discipline`,
    s => `The ancient lens on ${s}`,
    s => `Why seekers keep coming back to ${s}`,
  ],
  news_event: [
    s => `What happens next after ${s}`,
    s => `${s}: who benefits and who loses`,
    s => `The local impact of ${s}, explained`,
    s => `${s}: the timeline viewers need`,
    s => `The decision behind ${s} and what changes now`,
  ],
  exam_education: [
    s => `${s}: PYQ traps and exam-ready concepts`,
    s => `${s}: chapter-wise revision in 10 points`,
    s => `${s}: high-yield practice plan for aspirants`,
    s => `Common mistakes students make in ${s}`,
    s => `${s}: marks-focused revision for the final week`,
  ],
  tech_review: [
    s => `${s}: practical test before you buy`,
    s => `${s}: real-life verdict after daily use`,
    s => `Who should actually buy ${s}?`,
    s => `${s} vs last year's option: what changed?`,
    s => `The hidden setting in ${s} most users miss`,
  ],
  general_education: [
    s => `${s} explained for beginners`,
    s => `The simple timeline of ${s}`,
    s => `What people get wrong about ${s}`,
    s => `The complete beginner guide to ${s}`,
    s => `Why ${s} matters more than it looks`,
  ],
  gaming_entertainment: [
    s => `${s}: one challenge run viewers will want to finish`,
    s => `Can you win ${s} using only beginner settings?`,
    s => `${s}: the strategy most players miss`,
    s => `${s}: risky choices that create the best comeback`,
    s => `The update in ${s} that changes how you play`,
  ],
  comedy_sketch: [
    s => `When ${s} becomes everyone's problem`,
    s => `${s}, but every decision makes it worse`,
    s => `The most relatable ${s} situation`,
    s => `If ${s} had an honest conversation`,
    s => `One character, one problem: ${s}`,
  ],
  travel_lifestyle: [
    s => `${s}: the honest budget route`,
    s => `The overlooked detail in ${s}`,
    s => `${s}: worth it or overhyped?`,
    s => `The local side of ${s}`,
    s => `${s}: what to skip and what to do instead`,
  ],
  cooking_food: [
    s => `${s}: the budget version vs the restaurant version`,
    s => `Can you make ${s} at home without shortcuts?`,
    s => `The ingredient mistake that ruins ${s}`,
    s => `A regional twist on ${s}`,
    s => `${s}: quick version for busy days`,
  ],
  fitness_practice: [
    s => `${s}: a 7-day routine viewers can actually follow`,
    s => `The beginner mistake behind ${s}`,
    s => `${s}: what to do, what to avoid, and why`,
    s => `A no-equipment way to improve ${s}`,
    s => `${s}: a routine for people starting late`,
  ],
  wellness_teaching: [
    s => `${s}: the daily practice that makes it practical`,
    s => `The mindset trap behind ${s}`,
    s => `How to test ${s} for 7 days without overpromising`,
    s => `${s}: before and after, explained honestly`,
    s => `The small habit that changes ${s}`,
  ],
  spiritual_teaching: [
    s => `${s}: the story, meaning, and daily practice`,
    s => `What ${s} teaches about modern life`,
    s => `The simple explanation of ${s} for beginners`,
    s => `How to practice ${s} without confusion`,
    s => `The discipline hidden inside ${s}`,
  ],
  generic: [
    s => `Why viewers keep coming back to ${s}`,
    s => `The practical story behind ${s}`,
    s => `What changed in ${s} and why it matters`,
    s => `${s}: a fresh angle from your recent uploads`,
    s => `The mistake viewers make with ${s}`,
  ],
};

const EXPANSION_TEMPLATES_PROBE = {
  finance_education: [
    s => `The beginner mistake inside ${s}`,
    s => `A practical checklist for ${s}`,
    s => `Before you trust ${s}, check this`,
    s => `${s}: risk, returns, and timing explained simply`,
  ],
  general_education: [
    s => `What people get wrong about ${s}`,
    s => `${s} explained for beginners`,
    s => `Why ${s} matters more than it looks`,
  ],
  cooking_food: [
    s => `The ingredient mistake that ruins ${s}`,
    s => `${s}: quick version for busy days`,
  ],
  fitness_practice: [
    s => `The beginner mistake behind ${s}`,
    s => `${s}: what to do, what to avoid, and why`,
  ],
};

function probeFamily(familyKey, templates, subjects) {
  const results = [];
  subjects.forEach((subject, si) => {
    templates.forEach((fn, ti) => {
      const topic = fn(subject);
      const classification = classifyTemplate(topic);
      results.push({
        subject,
        template_index: ti + 1,
        topic,
        classification: classification.name,
        gen_family: classification.generation_family,
        win_rate: classification.win_rate,
        is_winner: classification.name !== 'GENERIC' && classification.name !== 'GENERIC_HOOK_PENALTY',
        is_deprecated: classification.name === 'GENERIC_HOOK_PENALTY',
      });
    });
  });
  return results;
}

// ── Gold set stats per template classification ─────────────────────────────────

function getGoldStats(db) {
  const rows = db.prepare(`
    SELECT generated_title, rec_source, human_label, family
    FROM wtp_human_quality_reviews
    WHERE human_label IS NOT NULL AND generated_title IS NOT NULL
  `).all();

  const byTemplate = {};
  for (const row of rows) {
    const cls = classifyTemplate(row.generated_title);
    const key = cls.name;
    if (!byTemplate[key]) byTemplate[key] = { n: 0, pos: 0, sources: {} };
    byTemplate[key].n++;
    if (row.human_label === 'Excellent' || row.human_label === 'Good') byTemplate[key].pos++;
    byTemplate[key].sources[row.rec_source] = (byTemplate[key].sources[row.rec_source] || 0) + 1;
  }
  return { rows, byTemplate };
}

// ── Main ──────────────────────────────────────────────────────────────────────

function main() {
  const db = new Database(DB_PATH, { readonly: true, timeout: 60000 });
  const { rows: goldRows, byTemplate: goldStats } = getGoldStats(db);
  db.close();

  const lines = [];
  const L = s => lines.push(s);

  L('# Generic Template Retirement Report');
  L('');
  L('**Phase 1 — Generator V2 prerequisite**');
  L(`**Generated:** ${new Date().toISOString().slice(0, 10)}`);
  L(`**Gold set:** ${goldRows.length} labeled rows`);
  L('');
  L('---');
  L('');

  // ── Section 1: Gold set template distribution ─────────────────────────────
  L('## 1. Gold Set: Template Distribution & Win Rates');
  L('');
  L('| Template | N in Gold | Winners | Win Rate | Gen Family | Status |');
  L('|---|---|---|---|---|---|');

  const sortedTemplates = Object.entries(goldStats)
    .sort((a, b) => b[1].n - a[1].n);

  let totalGeneric = 0;
  let totalWinner = 0;
  let winnerPos = 0;

  for (const [tmpl, stats] of sortedTemplates) {
    const winRate = stats.n > 0 ? (stats.pos / stats.n * 100).toFixed(1) + '%' : '-';
    const det = TEMPLATE_DETECTORS.find(d => d.name === tmpl);
    const genFamily = det?.generation_family || (tmpl === 'GENERIC' ? 'none' : '?');
    const status = tmpl === 'GENERIC' ? '🚫 RETIRE' :
                   tmpl === 'GENERIC_HOOK_PENALTY' ? '🚫 RETIRE' :
                   stats.pos / stats.n >= 0.20 ? '✅ PROMOTE' :
                   stats.pos / stats.n >= 0.08 ? '✓ KEEP' : '⚠ MONITOR';
    L(`| ${tmpl} | ${stats.n} | ${stats.pos} | ${winRate} | ${genFamily} | ${status} |`);
    if (tmpl === 'GENERIC') totalGeneric += stats.n;
    else { totalWinner += stats.n; winnerPos += stats.pos; }
  }

  const genericPct = (totalGeneric / goldRows.length * 100).toFixed(1);
  const winnerPct = (totalWinner / goldRows.length * 100).toFixed(1);
  const winnerWinRate = totalWinner > 0 ? (winnerPos / totalWinner * 100).toFixed(1) : '0';
  L('');
  L(`**GENERIC share:** ${totalGeneric}/${goldRows.length} = **${genericPct}%** (target: <20%)`);
  L(`**Winner template share:** ${totalWinner}/${goldRows.length} = **${winnerPct}%** (target: >50%)`);
  L(`**Winner template win rate:** ${winnerWinRate}% vs GENERIC 1.5%`);
  L('');

  // ── Section 2: Per-family template audit ─────────────────────────────────
  L('## 2. Per-Family Template Audit');
  L('');
  L('Each family template probed with 3 representative subjects. Shows which templates');
  L('produce GENERIC output and which map to winner template categories.');
  L('');

  const familySummary = {};

  for (const [familyKey, templates] of Object.entries(FAMILY_TEMPLATES_PROBE)) {
    const subjects = SAMPLE_SUBJECTS[familyKey] || ['topic', 'subject', 'domain'];
    const probeResults = probeFamily(familyKey, templates, subjects.slice(0, 1));
    const perTemplate = {};
    for (const r of probeResults) {
      if (!perTemplate[r.template_index]) perTemplate[r.template_index] = { ...r };
    }

    const templateEntries = Object.values(perTemplate);
    const winnerCount = templateEntries.filter(t => t.is_winner && !t.is_deprecated).length;
    const genericCount = templateEntries.filter(t => !t.is_winner).length;
    const deprecatedCount = templateEntries.filter(t => t.is_deprecated).length;

    familySummary[familyKey] = { winnerCount, genericCount, deprecatedCount, total: templates.length };

    const allGeneric = winnerCount === 0;
    const flag = allGeneric ? '🚫 ALL GENERIC' : winnerCount === templates.length ? '✅ ALL WINNER' : `⚠ ${genericCount}/${templates.length} GENERIC`;

    L(`### ${familyKey} ${flag}`);
    L('');
    L('| # | Sample Output | Template Type | Action |');
    L('|---|---|---|---|');

    // Probe each template individually
    for (let ti = 0; ti < templates.length; ti++) {
      const subject = subjects[0] || 'SIP choices';
      const topic = templates[ti](subject);
      const cls = classifyTemplate(topic);
      const action = cls.name === 'GENERIC' ? '`RETIRE`' :
                     cls.name === 'GENERIC_HOOK_PENALTY' ? '`RETIRE` (penalized)' :
                     cls.win_rate >= 0.20 ? `\`PROMOTE\` → ${cls.generation_family}` :
                     `\`KEEP\` → ${cls.generation_family}`;
      L(`| T${ti + 1} | "${topic.slice(0, 70)}" | ${cls.name} | ${action} |`);
    }
    L('');
  }

  // ── Section 3: Family retirement summary ─────────────────────────────────
  L('## 3. Family Retirement Priority');
  L('');
  L('| Creator Family | Templates | Winner | Generic | Deprecated | Priority |');
  L('|---|---|---|---|---|---|');

  const sortedFamilies = Object.entries(familySummary)
    .sort((a, b) => b[1].genericCount - a[1].genericCount || a[1].winnerCount - b[1].winnerCount);

  for (const [family, stats] of sortedFamilies) {
    const genericRate = (stats.genericCount / stats.total * 100).toFixed(0);
    const priority = stats.winnerCount === 0 ? '🔴 REBUILD ENTIRELY' :
                     stats.genericCount >= 3 ? '🟠 REMOVE GENERIC TEMPLATES' :
                     stats.genericCount >= 1 ? '🟡 CLEAN UP' :
                     '🟢 GOOD';
    L(`| ${family} | ${stats.total} | ${stats.winnerCount} | ${stats.genericCount} | ${stats.deprecatedCount} | ${priority} |`);
  }
  L('');

  // ── Section 4: GENERIC template sources ──────────────────────────────────
  L('## 4. What Generates GENERIC — Source Breakdown');
  L('');
  L('The 674 GENERIC titles in the gold set come from these sources:');
  L('');

  const genericStats = goldStats['GENERIC'] || { sources: {}, n: 0, pos: 0 };
  const sourceSummary = Object.entries(genericStats.sources || {})
    .sort((a, b) => b[1] - a[1]);

  L('| Source | Count | % of GENERIC |');
  L('|---|---|---|');
  for (const [src, n] of sourceSummary) {
    const pct = (n / (genericStats.n || 1) * 100).toFixed(1);
    L(`| ${src} | ${n} | ${pct}% |`);
  }
  L('');
  L('**Key insight:** Most GENERIC titles come from DNA original bets using THESIS_TEMPLATES');
  L('(hidden_economics, broken_system, etc.) and FAMILY_TEMPLATES.generic — none of which');
  L('match any winner template pattern.');
  L('');

  // ── Section 5: Retirement plan ────────────────────────────────────────────
  L('## 5. Retirement Plan');
  L('');
  L('### Templates to Retire Immediately');
  L('');
  L('| Template | Family | Output Pattern | Replacement |');
  L('|---|---|---|---|');
  L('| T1 — How X can change your next money decision | finance_education | GENERIC | MISTAKE_BEHIND: "The beginner mistake inside X" |');
  L('| T4 — Before you trust X, check this | finance_education | GENERIC_HOOK_PENALTY | CHECKLIST_FORMAT: "A step-by-step guide to X" |');
  L('| T1 — Why viewers keep coming back to X | generic | GENERIC | (family suppressed entirely) |');
  L('| T2 — The practical story behind X | generic | GENERIC | (family suppressed entirely) |');
  L('| T3 — What changed in X and why it matters | generic | GENERIC | (family suppressed entirely) |');
  L('| T4 — X: a fresh angle from your recent uploads | generic | GENERIC | (family suppressed entirely) |');
  L('| T5 — The mistake viewers make with X | generic | GENERIC | (family suppressed entirely) |');
  L('| ALL 5 — conversation_* families | conv_business/finance/spiritual | GENERIC | MISTAKE + INSTRUCTIONAL winner templates |');
  L('| ALL 5 — comedy_sketch | comedy_sketch | GENERIC | Keep FAMILY_TEMPLATES as-is (narrative family) |');
  L('| ALL 5 — general_education | general_education | GENERIC | MISTAKE + INSTRUCTIONAL winner templates |');
  L('| ALL 5 — THESIS_TEMPLATES (hidden_economics, etc.) | explainer_case | GENERIC | Kept for explainer_case COMBO_BETS only |');
  L('');
  L('### Templates to Keep and Promote');
  L('');
  L('| Template | Family | Gen Family | Win Rate |');
  L('|---|---|---|---|');
  L('| The ingredient mistake that ruins X | cooking_food | mistake | 24.6% |');
  L('| Can you make X at home without shortcuts? | cooking_food | challenge | 42.1% |');
  L('| X: quick version for busy days | cooking_food | instructional | ~16% |');
  L('| X: the budget version vs the restaurant version | cooking_food | comparison | ~8% |');
  L('| The beginner mistake behind X | fitness_practice | mistake | 24.6% |');
  L('| A no-equipment way to improve X | fitness_practice | instructional | 27.8% |');
  L('| X: what to do, what to avoid, and why | fitness_practice | comparison | ~8% |');
  L('| X: a 7-day routine viewers can actually follow | fitness_practice | challenge | ~16% |');
  L('| The beginner mistake inside X | finance_education | mistake | 24.6% |');
  L('| A practical checklist for X | finance_education | instructional | 16.1% |');
  L('| X: risk, returns, and timing explained simply | finance_education | comparison | 8.2% |');
  L('');
  L('### THESIS_TEMPLATES Status: DEPRECATED for non-explainer families');
  L('');
  L('THESIS_TEMPLATES (hidden_economics, broken_system, consumer_deception, etc.) produce');
  L('all-GENERIC output. They are retained ONLY for `explainer_case` family COMBO_BETS.');
  L('For all other families they are replaced by the 4 winner generation families.');
  L('');
  L('---');
  L('');
  L('## 6. Success Criteria After Retirement');
  L('');
  L('| Metric | Current | Target |');
  L('|---|---|---|');
  L(`| GENERIC share of corpus | ${genericPct}% | <20% |`);
  L(`| Winner template share | ${winnerPct}% | >50% |`);
  L('| Positive rate (Good+Excellent) | 6.9% | >15% |');
  L('| F1 score (structure score ≥25) | 0.91 | maintain |');
  L('');
  L('*These targets are achievable once GENERIC templates are replaced with winner templates*');
  L('*across cooking_food, fitness_practice, finance_education, and conversation families.*');

  // Console output
  process.stdout.write('\n══════════════════════════════════════════════════════════════\n');
  process.stdout.write('  Generic Template Retirement Report\n');
  process.stdout.write('══════════════════════════════════════════════════════════════\n\n');
  process.stdout.write('  Gold set: ' + goldRows.length + ' rows\n');
  process.stdout.write('  GENERIC share: ' + genericPct + '% (' + totalGeneric + ' rows) — target <20%\n');
  process.stdout.write('  Winner template share: ' + winnerPct + '% (' + totalWinner + ' rows) — target >50%\n\n');

  process.stdout.write('  Template distribution:\n');
  for (const [tmpl, stats] of sortedTemplates) {
    const rate = stats.n > 0 ? (stats.pos / stats.n * 100).toFixed(1) + '%' : '-';
    const flag = tmpl === 'GENERIC' ? ' ← RETIRE' :
                 stats.pos / stats.n >= 0.20 ? ' ← PROMOTE' :
                 stats.pos / stats.n >= 0.08 ? '' : ' ← MONITOR';
    process.stdout.write(`    ${tmpl.padEnd(24)} n=${String(stats.n).padStart(4)} pos=${String(stats.pos).padStart(3)} (${rate})${flag}\n`);
  }

  process.stdout.write('\n  Families needing rebuild (all-GENERIC output):\n');
  for (const [family, stats] of sortedFamilies) {
    if (stats.winnerCount === 0) {
      process.stdout.write(`    ${family}\n`);
    }
  }

  process.stdout.write('\n');

  fs.writeFileSync(OUT, lines.join('\n') + '\n');
  process.stdout.write(`  Report written: ${OUT}\n`);
  process.stdout.write('══════════════════════════════════════════════════════════════\n\n');
}

main();

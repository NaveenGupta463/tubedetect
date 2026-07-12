'use strict';

/**
 * Recommendation Truth Audit (Phase 2)
 *
 * Automated scoring per recommendation from wtp_generation_traces:
 *   - semantic_validity  (0–1): title is grammatically coherent and artifact-free
 *   - creator_fit        (0–1): topic plausibly fits the creator's DNA / niche
 *   - specificity        (0–1): title is specific enough to be actionable
 *
 * Human-reviewed (not automated here):
 *   - filmability: generated as a review queue for manual annotation
 *   - opportunity_validity: generated as a review queue for manual annotation
 *
 * Usage:
 *   node recommendationTruthAudit.js [--days=N] [--source=X] [--limit=N] [--verbose]
 *   node recommendationTruthAudit.js --review-queue     # write worst/random/best 50 for human review
 *   node recommendationTruthAudit.js --export=FILE.json # export full scored results to JSON
 *
 * PASS targets (from spec):
 *   semantic_validity  ≥ 0.90
 *   specificity        ≥ 0.75
 *   creator_fit        no hard target yet — record distribution for Phase 5 threshold derivation
 */

const path = require('path');
const BetterSqlite3 = require('../node_modules/better-sqlite3');
const fs = require('fs');

// ── Semantic validity: hard-reject pattern set ─────────────────────────────────
// Mirrors originalBets.js + wtpRecommendationRefiner.js artifact blockers.

const HARD_REJECT_PATTERNS = [
  // Gaming template artifacts
  /\bchanges how you play\b/i,
  /\busing only beginner settings\b/i,
  /\bstrategy most players? miss\b/i,
  /\bone challenge run viewers? will want to finish\b/i,
  /\brisky choices that create the best comeback\b/i,
  /\bthe update in\b.*\bthat changes\b/i,
  // Contraction-collapse fragments (subject artifacts only — valid "Don't X" titles pass through)
  /\b(dont)\s+(eat|try|watch|play|read)\b/i,
  // Preposition-collapse
  /\b\w+\s+(earth|world|globe)\s*$/i,
  // Title-prefix collapse
  /\b(games?|shows?|series)\s+(season|episode|part|round)\s*\d*$/i,
  // Template placeholders not filled in
  /\[your niche\]|\[topic\]|\[subject\]/i,
];

const SOFT_REJECT_PATTERNS = [
  // Pure generic evergreen with no substance
  /^(day in my life|morning routine|life update|weekly vlog)\s*$/i,
  /^(top|best)\s+\d+\s+(tips|ways|things|ideas)\s*$/i,
  /most common mistake in .{1,30}$/i,
  /behind the scenes: how i actually make/i,
];

// ── Specificity scoring heuristics ────────────────────────────────────────────

const SPECIFIC_SIGNALS = [
  // Named entities, numbers, years
  /\b(20\d{2}|₹|\$|%|crore|lakh|million|billion|trillion)\b/i,
  /\b(india|china|us|pakistan|israel|iran|russia|ukraine|uk|japan|korea|saudi)\b/i,
  // Indian named entities: politicians, institutions, sports bodies
  /\b(trump|modi|rbi|sebi|ipl|bcci|icc|nato|un|imf|cji)\b/i,
  // Indian economic/financial signals
  /\b(budget|gdp|inflation|repo\s*rate|fiscal|nifty|sensex|rupee|inr)\b/i,
  // High-specificity event verbs that appear in news/documentary titles
  /\b(war|attack|crash|ban|strike|protest|arrested|sentenced|exposed|banned|collapsed)\b/i,
  // Domain topic words that make a DNA template title concrete (finance, food, fitness, tech)
  /\b(stock|stocks|equity|mutual\s*fund|sip|emi|salary|recipe|cooking|biryani|dosa|thali|workout|meditation|yoga|protein|supplement|tutorial|coding|programming|python|startup|entrepreneur|cricket|gaming|gamer)\b/i,
  // Domain-adjective and sector signals that indicate concrete subject area
  /\b(indian|financial|finance|health|healthy|digital|medical|mental\s*health|environmental|agricultural)\b/i,
  // Specific format indicators
  /\b(vs|versus|v\/s|challenge|experiment|reaction|review|explained|breakdown|case study|analysis)\b/i,
  // Scale indicators
  /\b(world('s)?|record|first|every|all|none|zero|100|1000)\b/i,
  // Concrete action/scenario
  /\b(spent|tried|ate|built|made|won|lost|survived|quit|started|failed|earned)\b/i,
];

const GENERIC_SIGNALS = [
  /^(my|the)?\s*(journey|story|experience|thoughts|opinion)\s*$/i,
  /^(tips|tricks|hacks|advice|guide)\s*(for|on|about)?\s*\w*\s*$/i,
  /^(what|how|why)\s+you\s+(need|should|must)\s+know\s*$/i,
  /^(everything|all)\s+you\s+need\s+to\s+know\s*$/i,
];

const STOPWORDS = new Set([
  'the','a','an','and','or','but','in','on','at','to','for','of','with',
  'by','from','up','about','into','through','during','is','are','was','were',
  'be','been','being','have','has','had','do','does','did','will','would',
  'could','should','may','might','must','shall','can','need','dare','ought',
  'i','my','you','your','we','our','they','their','it','its','this','that',
  'these','those','how','what','why','when','where','who','which',
]);

function meaningfulWords(title) {
  return String(title || '')
    .toLowerCase()
    .replace(/[^a-z0-9₹$\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOPWORDS.has(w));
}

// Peer-signal generates compact topic phrases; DNA generates full template titles.
const PEER_SIGNAL_SOURCES = new Set(['angle_gap','territory_expansion','peer_video_signal','fallback_evergreen','defence_signal']);

function scoreSemanticValidity(title, rec_source) {
  if (!title || title.trim().length < 2) return 0;

  // Hard reject — applies to all sources
  for (const p of HARD_REJECT_PATTERNS) {
    if (p.test(title)) return 0;
  }

  const words = title.trim().split(/\s+/);
  const mw    = meaningfulWords(title);

  // Peer-signal: 1–3 word topic phrases are normal and valid
  if (PEER_SIGNAL_SOURCES.has(rec_source)) {
    if (words.length < 1 || mw.length < 1) return 0;
    for (const p of SOFT_REJECT_PATTERNS) { if (p.test(title)) return 0.45; }
    return 1.0;
  }

  // DNA bets: full template titles expected
  if (words.length < 3) return 0.1;
  if (mw.length < 2)    return 0.2;
  for (const p of SOFT_REJECT_PATTERNS) { if (p.test(title)) return 0.45; }
  if (words.length < 4) return 0.65;
  if (mw.length < 3)    return 0.70;
  return 1.0;
}

function scoreSpecificity(title) {
  if (!title || title.trim().length < 5) return 0;

  const mw = meaningfulWords(title);
  if (mw.length < 2) return 0;

  // Generic patterns → hard low
  for (const p of GENERIC_SIGNALS) {
    if (p.test(title)) return 0.10;
  }

  let score = 0.40; // base

  // Meaningful word density
  const wordCount = title.trim().split(/\s+/).length;
  if (mw.length / Math.max(1, wordCount) >= 0.5) score += 0.10;

  // Specific signals add value.
  // 0.15 per hit means exactly 1 signal + density + length = 0.75 (the DNA pass threshold).
  let signalHits = 0;
  for (const p of SPECIFIC_SIGNALS) {
    if (p.test(title)) signalHits++;
  }
  score += Math.min(0.40, signalHits * 0.15);

  // Length sweet spot: 5–12 words
  if (wordCount >= 5 && wordCount <= 12) score += 0.10;
  else if (wordCount > 12)               score -= 0.05;
  else if (wordCount < 4)                score -= 0.10;

  return Math.max(0, Math.min(1, +score.toFixed(3)));
}

function scoreCreatorFit(trace) {
  // For DNA bets: use dna_affinity_score as primary signal
  // For peer-signal: use dna_affinity_score which maps to creator_fit_score
  if (trace.dna_affinity_score != null) {
    return +Math.min(1, Math.max(0, trace.dna_affinity_score)).toFixed(3);
  }
  // No signal: neutral (insufficient data, not wrong)
  return null;
}

// ── Overall pass/fail ─────────────────────────────────────────────────────────

const PASS_THRESHOLDS = {
  semantic_validity: 0.90,
  // specificity is source-aware — see specificityThreshold()
};

// Peer-signal titles are short (2–6 words); named-entity specificity is not
// captured by the length or pattern bonuses in scoreSpecificity(). Lower bar.
function specificityThreshold(rec_source) {
  if (PEER_SIGNAL_SOURCES.has(rec_source)) return 0.55;
  return 0.75;
}

function assessIdea(trace) {
  const semantic     = scoreSemanticValidity(trace.generated_title, trace.rec_source);
  const specific     = scoreSpecificity(trace.generated_title);
  const fit          = scoreCreatorFit(trace);
  const overall      = (semantic + specific + (fit ?? 0.5)) / 3;
  const spc_threshold = specificityThreshold(trace.rec_source);

  return {
    id:               trace.id,
    idea_key:         trace.idea_key,
    channel_id:       trace.channel_id,
    rec_source:       trace.rec_source || 'unknown',
    title:            trace.generated_title,
    concept_id:       trace.concept_id || null,
    concept_label:    trace.concept_label || null,
    family:           trace.family || null,
    semantic_validity: +semantic.toFixed(3),
    specificity:       +specific.toFixed(3),
    spc_threshold,
    creator_fit:       fit,
    overall_score:     +overall.toFixed(3),
    semantic_pass:     semantic >= PASS_THRESHOLDS.semantic_validity,
    specificity_pass:  specific >= spc_threshold,
    overall_pass:      semantic >= PASS_THRESHOLDS.semantic_validity && specific >= spc_threshold,
  };
}

// ── DB ────────────────────────────────────────────────────────────────────────

function openDb() {
  const raw = new BetterSqlite3(path.resolve(__dirname, '../data/scoring.db'), {
    readonly: true,
    fileMustExist: true,
    timeout: 60000,
  });
  raw.pragma('query_only = ON');
  raw.pragma('busy_timeout = 60000');
  const cache = new Map();
  const stmt = sql => { if (!cache.has(sql)) cache.set(sql, raw.prepare(sql)); return cache.get(sql); };
  return {
    all: (sql, p = []) => stmt(sql).all(Array.isArray(p) ? p : [p]),
    get: (sql, p = []) => stmt(sql).get(Array.isArray(p) ? p : [p]),
    close: () => { cache.clear(); raw.close(); },
  };
}

// ── Args ──────────────────────────────────────────────────────────────────────

function parseArgs() {
  const args        = process.argv.slice(2);
  const days        = parseInt((args.find(a => a.startsWith('--days='))   || '--days=30').split('=')[1], 10) || 30;
  const limit       = parseInt((args.find(a => a.startsWith('--limit='))  || '--limit=2000').split('=')[1], 10) || 2000;
  const source      = (args.find(a => a.startsWith('--source=')) || '').split('=')[1] || null;
  const exportFile  = (args.find(a => a.startsWith('--export=')) || '').split('=')[1] || null;
  const reviewQueue = args.includes('--review-queue');
  const verbose     = args.includes('--verbose');
  return { days, limit, source, exportFile, reviewQueue, verbose };
}

// ── Review queue output ───────────────────────────────────────────────────────

function printReviewQueue(scored) {
  // Sort by overall score
  const sorted = [...scored].sort((a, b) => a.overall_score - b.overall_score);
  const total  = sorted.length;

  const worst  = sorted.slice(0, 50);
  const best   = sorted.slice(-50).reverse();
  const mid    = (() => {
    // Random 50 from the middle third
    const midStart = Math.floor(total * 0.33);
    const midEnd   = Math.floor(total * 0.66);
    const pool     = sorted.slice(midStart, midEnd);
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    return pool.slice(0, 50);
  })();

  function printSection(label, items) {
    console.log(`\n── ${label} (${items.length}) ──────────────────────────────────────`);
    console.log('Format: [id] [source] sem=X.XX spc=X.XX fit=X.XX | TITLE');
    for (const s of items) {
      const fit = s.creator_fit != null ? s.creator_fit.toFixed(2) : 'n/a';
      const pass = s.overall_pass ? '✓' : '✗';
      console.log(
        `  ${pass} [${String(s.id).padEnd(5)}] [${(s.rec_source || '?').slice(0,18).padEnd(18)}]` +
        ` sem=${s.semantic_validity.toFixed(2)} spc=${s.specificity.toFixed(2)} fit=${fit}` +
        ` | ${(s.title || '(no title)').slice(0, 80)}`
      );
    }
  }

  console.log('\n=== Human Review Queue ===');
  console.log('Review each title and annotate: excellent | average | poor');
  console.log('Also note: filmability (can a creator film this?) and opportunity_validity (real opportunity?)');
  printSection('WORST 50 (lowest automated score)', worst);
  printSection('RANDOM 50 (middle range)', mid);
  printSection('BEST 50 (highest automated score)', best);
}

// ── Main ──────────────────────────────────────────────────────────────────────

function main() {
  const { days, limit, source, exportFile, reviewQueue, verbose } = parseArgs();
  const db = openDb();

  try {
    const tableCheck = db.get(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='wtp_generation_traces'`, [],
    );
    if (!tableCheck) {
      console.log('wtp_generation_traces does not exist. Run the server once to create it.');
      return;
    }

    const since = new Date(Date.now() - days * 86400_000).toISOString();
    const traces = source
      ? db.all(
          `SELECT id, idea_key, channel_id, rec_source, generated_title, concept_id,
                  concept_label, family, dna_affinity_score
           FROM wtp_generation_traces
           WHERE created_at >= ? AND rec_source = ?
           ORDER BY RANDOM() LIMIT ?`,
          [since, source, limit],
        )
      : db.all(
          `SELECT id, idea_key, channel_id, rec_source, generated_title, concept_id,
                  concept_label, family, dna_affinity_score
           FROM wtp_generation_traces
           WHERE created_at >= ?
           ORDER BY RANDOM() LIMIT ?`,
          [since, limit],
        );

    if (!traces.length) {
      console.log('No traces found. Run seedRecommendationTraces.js first.');
      return;
    }

    // ── Score every trace ────────────────────────────────────────────────────
    const scored = traces.map(assessIdea);

    // ── Aggregate metrics ────────────────────────────────────────────────────
    const total = scored.length;

    function agg(key) {
      const vals = scored.map(s => s[key]).filter(v => v != null);
      if (!vals.length) return { mean: null, p25: null, p50: null, p75: null };
      vals.sort((a, b) => a - b);
      const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
      const p = pct => vals[Math.floor(vals.length * pct)];
      return { mean: +mean.toFixed(3), p25: p(0.25), p50: p(0.50), p75: p(0.75) };
    }

    const semStats  = agg('semantic_validity');
    const spcStats  = agg('specificity');
    const fitStats  = agg('creator_fit');

    const semPassPct = +(scored.filter(s => s.semantic_pass).length / total * 100).toFixed(1);
    const spcPassPct = +(scored.filter(s => s.specificity_pass).length / total * 100).toFixed(1);
    const overallPassPct = +(scored.filter(s => s.overall_pass).length / total * 100).toFixed(1);

    // ── Per-source breakdown ─────────────────────────────────────────────────
    const bySource = {};
    for (const s of scored) {
      const src = s.rec_source || 'unknown';
      if (!bySource[src]) bySource[src] = { total: 0, sem_sum: 0, spc_sum: 0, fit_sum: 0, fit_n: 0, pass: 0 };
      bySource[src].total++;
      bySource[src].sem_sum += s.semantic_validity;
      bySource[src].spc_sum += s.specificity;
      if (s.creator_fit != null) { bySource[src].fit_sum += s.creator_fit; bySource[src].fit_n++; }
      if (s.overall_pass) bySource[src].pass++;
    }

    // ── Failure mode breakdown ───────────────────────────────────────────────
    const failureModes = {
      hard_artifact:   scored.filter(s => s.semantic_validity === 0).length,
      soft_generic:    scored.filter(s => s.semantic_validity > 0 && s.semantic_validity < 0.6).length,
      low_specificity: scored.filter(s => !s.specificity_pass && s.semantic_validity >= 0.9).length,
      low_fit:         scored.filter(s => s.creator_fit != null && s.creator_fit < 0.3).length,
      passing:         scored.filter(s => s.overall_pass).length,
    };

    // ── Target assessment ────────────────────────────────────────────────────
    const targets = {
      semantic_validity: `${semPassPct}% pass (target ≥90%) → ${semPassPct >= 90 ? 'PASS' : 'FAIL'}`,
      specificity:       `${spcPassPct}% pass (dna_bets ≥0.75, peer_signal ≥0.55, target >30%) → ${spcPassPct >= 30 ? 'PASS' : 'FAIL'}`,
      overall:           `${overallPassPct}% pass both targets`,
    };

    // ── Output ───────────────────────────────────────────────────────────────
    const report = {
      sampled:           total,
      window_days:       days,
      source_filter:     source || 'all',
      metrics: {
        semantic_validity: { ...semStats, pass_pct: semPassPct },
        specificity:       { ...spcStats, pass_pct: spcPassPct },
        creator_fit:       { ...fitStats },
        overall_pass_pct:  overallPassPct,
      },
      targets,
      failure_modes:     failureModes,
      by_source:         Object.fromEntries(
        Object.entries(bySource).map(([src, c]) => [src, {
          total:         c.total,
          pass_pct:      +(c.pass / c.total * 100).toFixed(1),
          sem_avg:       +(c.sem_sum / c.total).toFixed(3),
          spc_avg:       +(c.spc_sum / c.total).toFixed(3),
          spc_threshold: specificityThreshold(src),
          fit_avg:       c.fit_n > 0 ? +(c.fit_sum / c.fit_n).toFixed(3) : null,
        }]),
      ),
    };

    console.log('\n=== Recommendation Truth Audit ===');
    console.log(JSON.stringify(report, null, 2));

    if (verbose) {
      // Print worst 20 by overall score
      const worst20 = [...scored].sort((a, b) => a.overall_score - b.overall_score).slice(0, 20);
      console.log('\nWorst 20 by overall score:');
      for (const s of worst20) {
        const fit = s.creator_fit != null ? s.creator_fit.toFixed(2) : 'n/a';
        console.log(
          `  sem=${s.semantic_validity.toFixed(2)} spc=${s.specificity.toFixed(2)} fit=${fit}` +
          ` [${s.rec_source}] ${(s.title || '').slice(0, 80)}`,
        );
      }
    }

    if (reviewQueue) {
      printReviewQueue(scored);
    }

    if (exportFile) {
      fs.writeFileSync(exportFile, JSON.stringify(scored, null, 2), 'utf8');
      console.log(`\nFull scored results exported to: ${exportFile}`);
    }
  } finally {
    db.close();
  }
}

main();

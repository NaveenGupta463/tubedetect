'use strict';

/**
 * Recommendation Corpus Audit (Phase 0C)
 *
 * Samples recommendations from wtp_generation_traces and classifies each as:
 *   Useful | Generic | Nonsense | Wrong_Creator | Wrong_Opportunity
 *
 * Usage:
 *   node recommendationCorpusAudit.js [--days=N] [--limit=N] [--verbose] [--source=X]
 *
 * Outputs: distribution by rec_source + failure mode breakdown.
 */

const path = require('path');
const BetterSqlite3 = require('../node_modules/better-sqlite3');

// ── Classification patterns ────────────────────────────────────────────────────

// Nonsense: title contains hard-reject artifacts from the artifact audit
const NONSENSE_PATTERNS = [
  /\bchanges how you play\b/i,
  /\busing only beginner settings\b/i,
  /\bstrategy most players? miss\b/i,
  /\bone challenge run viewers? will want to finish\b/i,
  /\brisky choices that create the best comeback\b/i,
  /\b(don|dont)\s+(eat|try|watch|play|read)\b/i,
  /\bthe update in\b.*\bthat changes\b/i,
  /\bwin\s+\w+\s+\w+\s+using\b/i,
  /\b\w+\s+(earth|world|globe)\s*$/i,
  /\b(games?|shows?|series)\s+(season|episode|part|round|chapter)\s*\d*$/i,
];

// Generic: title is semantically correct but too vague to be actionable
const GENERIC_PATTERNS = [
  /^(my\s+)?(day in my life|morning routine|productivity tips|life update|vlog)\s*$/i,
  /^(top|best)\s+\d+\s+(tips|ways|things|ideas|hacks)\s*$/i,
  /^(what|how|why)\s+you\s+(need|should|must)\s+know\s*$/i,
  /\[your niche\]/i,
  /\[topic\]/i,
  /most common mistake in/i,
  /behind the scenes: how i actually make my videos/i,
];

// Minimum token count to be specific enough
const MIN_MEANINGFUL_WORDS = 3;
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
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOPWORDS.has(w));
}

// Peer-signal sources generate compact topic phrases (1–3 words is normal).
// DNA bets generate full template-based titles (5+ words expected).
const PEER_SIGNAL_SOURCES = new Set(['angle_gap', 'territory_expansion', 'peer_video_signal', 'fallback_evergreen']);

function classifyTitle(title, rec_source) {
  if (!title || title.length < 3) return 'nonsense';

  // Artifact patterns always nonsense regardless of source
  for (const p of NONSENSE_PATTERNS) {
    if (p.test(title)) return 'nonsense';
  }

  // Generic: template boilerplate
  for (const p of GENERIC_PATTERNS) {
    if (p.test(title)) return 'generic';
  }

  const words = title.trim().split(/\s+/);
  const mw    = meaningfulWords(title);

  if (PEER_SIGNAL_SOURCES.has(rec_source)) {
    // Peer-signal: compact phrases are valid. Only reject empty or single stopword.
    if (words.length < 1 || mw.length < 1) return 'nonsense';
    if (mw.length < 2) return 'generic'; // single meaningful word: too vague
    return 'useful';
  }

  // DNA bets: full template titles expected
  if (words.length < 3) return 'nonsense';
  if (mw.length < MIN_MEANINGFUL_WORDS) return 'generic';

  return 'useful';
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
  const args    = process.argv.slice(2);
  const days    = parseInt((args.find(a => a.startsWith('--days='))   || '--days=30').split('=')[1], 10) || 30;
  const limit   = parseInt((args.find(a => a.startsWith('--limit='))  || '--limit=1000').split('=')[1], 10) || 1000;
  const source  = (args.find(a => a.startsWith('--source=')) || '').split('=')[1] || null;
  const verbose = args.includes('--verbose');
  return { days, limit, source, verbose };
}

// ── Sampling — balanced across rec_source ─────────────────────────────────────

function sampleTraces(db, { days, limit, source }) {
  const since = new Date(Date.now() - days * 86400_000).toISOString();
  const perSource = Math.ceil(limit / 3);

  if (source) {
    return db.all(
      `SELECT id, idea_key, channel_id, rec_source, generated_title, concept_id,
              concept_label, family, dna_affinity_score, created_at
       FROM wtp_generation_traces
       WHERE created_at >= ? AND rec_source = ?
       ORDER BY RANDOM()
       LIMIT ?`,
      [since, source, limit],
    );
  }

  // Balanced sample across all three source buckets
  const sources = ['dna_original_bets', 'angle_gap', 'territory_expansion',
                   'peer_video_signal', 'defence_signal', 'fallback_evergreen'];
  const rows = [];
  for (const src of sources) {
    const chunk = db.all(
      `SELECT id, idea_key, channel_id, rec_source, generated_title, concept_id,
              concept_label, family, dna_affinity_score, created_at
       FROM wtp_generation_traces
       WHERE created_at >= ? AND rec_source = ?
       ORDER BY RANDOM()
       LIMIT ?`,
      [since, src, perSource],
    );
    rows.push(...chunk);
  }
  return rows;
}

// ── Main ──────────────────────────────────────────────────────────────────────

function main() {
  const { days, limit, source, verbose } = parseArgs();
  const db = openDb();

  try {
    const tableCheck = db.get(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='wtp_generation_traces'`,
      [],
    );
    if (!tableCheck) {
      console.log('wtp_generation_traces does not exist. Run the server once to create it.');
      return;
    }

    const totalRows = db.get(`SELECT COUNT(*) AS n FROM wtp_generation_traces`, [])?.n || 0;
    if (totalRows === 0) {
      console.log('No traces found. Run seedRecommendationTraces.js first.');
      return;
    }

    const traces = sampleTraces(db, { days, limit, source });
    if (traces.length === 0) {
      console.log(`No traces found for the last ${days} days${source ? ` (source: ${source})` : ''}.`);
      return;
    }

    // Classify each trace
    const results = [];
    const bySource = {};
    const byLabel  = { useful: 0, generic: 0, nonsense: 0 };

    for (const t of traces) {
      const label = classifyTitle(t.generated_title, t.rec_source);
      results.push({ ...t, auto_label: label });

      const src = t.rec_source || 'unknown';
      if (!bySource[src]) bySource[src] = { total: 0, useful: 0, generic: 0, nonsense: 0 };
      bySource[src].total++;
      bySource[src][label]++;
      byLabel[label]++;
    }

    const total = results.length;
    const usefulPct   = +((byLabel.useful   / total) * 100).toFixed(1);
    const genericPct  = +((byLabel.generic  / total) * 100).toFixed(1);
    const nonsensePct = +((byLabel.nonsense / total) * 100).toFixed(1);

    // Source breakdown with quality rates
    const sourceReport = {};
    for (const [src, counts] of Object.entries(bySource)) {
      sourceReport[src] = {
        total:        counts.total,
        useful_pct:   +((counts.useful   / counts.total) * 100).toFixed(1),
        generic_pct:  +((counts.generic  / counts.total) * 100).toFixed(1),
        nonsense_pct: +((counts.nonsense / counts.total) * 100).toFixed(1),
      };
    }

    // Concept coverage (DNA bets only — peer-signal has null concept_id by design)
    const dnaRows = results.filter(r => r.rec_source === 'dna_original_bets');
    const dnaWithConcept = dnaRows.filter(r => r.concept_id).length;
    const conceptCoverage = dnaRows.length > 0
      ? +((dnaWithConcept / dnaRows.length) * 100).toFixed(1)
      : null;

    // Nonsense sample for review
    const nonsenseSample = verbose
      ? results.filter(r => r.auto_label === 'nonsense').slice(0, 20).map(r => ({
          title:  r.generated_title,
          source: r.rec_source,
          family: r.family || null,
        }))
      : [];

    const genericSample = verbose
      ? results.filter(r => r.auto_label === 'generic').slice(0, 20).map(r => ({
          title:  r.generated_title,
          source: r.rec_source,
        }))
      : [];

    console.log('\n=== Recommendation Corpus Audit ===');
    console.log(`Sampled: ${total} traces | Window: last ${days} days | Total in DB: ${totalRows}`);
    if (source) console.log(`Source filter: ${source}`);
    console.log();
    console.log(`Overall:  useful=${usefulPct}%  generic=${genericPct}%  nonsense=${nonsensePct}%`);
    console.log();
    console.log('By source:');
    for (const [src, stats] of Object.entries(sourceReport)) {
      console.log(`  ${src.padEnd(22)} total=${stats.total}  useful=${stats.useful_pct}%  generic=${stats.generic_pct}%  nonsense=${stats.nonsense_pct}%`);
    }
    if (conceptCoverage !== null) {
      console.log(`\nDNA concept coverage: ${conceptCoverage}% (${dnaWithConcept}/${dnaRows.length} bets have concept_id)`);
    }
    if (verbose && nonsenseSample.length) {
      console.log('\nNonsense sample:');
      for (const s of nonsenseSample) console.log(`  [${s.source}] ${s.title}`);
    }
    if (verbose && genericSample.length) {
      console.log('\nGeneric sample:');
      for (const s of genericSample) console.log(`  [${s.source}] ${s.title}`);
    }
    console.log();
  } finally {
    db.close();
  }
}

main();

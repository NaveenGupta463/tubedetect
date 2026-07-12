'use strict';

const { getDb } = require('../db/init');

function fmt(n, dec = 1) {
  if (n == null) return '—';
  return Number(n).toFixed(dec);
}

function pct(n) {
  if (n == null) return '—';
  return `${fmt(n * 100, 1)}%`;
}

const db = getDb();

// ── 1. Total rows ─────────────────────────────────────────────────────────────
const total = db.get('SELECT COUNT(*) AS n FROM prepublish_shadow_log');
console.log(`\n=== PrePublish Shadow Calibration Inspection ===`);
console.log(`Total shadow log rows : ${total?.n ?? 0}`);

if (!total?.n) {
  console.log('No rows yet. Run some PrePublish requests first.');
  process.exit(0);
}

// ── 2. Empirical adj distribution ─────────────────────────────────────────────
const adjDist = db.all(`
  SELECT
    CASE
      WHEN empirical_adjustment > 0  THEN 'positive'
      WHEN empirical_adjustment < 0  THEN 'negative'
      ELSE                                'neutral (0)'
    END AS bucket,
    COUNT(*) AS n
  FROM prepublish_shadow_log
  GROUP BY bucket
  ORDER BY n DESC
`);
console.log('\n--- Empirical Adjustment Distribution ---');
adjDist.forEach(r => console.log(`  ${r.bucket.padEnd(14)}: ${r.n}`));

// ── 3. Top calibration cells used ─────────────────────────────────────────────
const topCells = db.all(`
  SELECT
    calibration_cell_used,
    calibration_confidence,
    empirical_adjustment,
    COUNT(*) AS n
  FROM prepublish_shadow_log
  WHERE calibration_cell_used IS NOT NULL
  GROUP BY calibration_cell_used
  ORDER BY n DESC
  LIMIT 15
`);
console.log('\n--- Top Calibration Cells Used (top 15) ---');
if (!topCells.length) {
  console.log('  No cells matched yet (all fell through to level 7).');
} else {
  topCells.forEach(r => {
    const adj = r.empirical_adjustment >= 0 ? `+${r.empirical_adjustment}` : `${r.empirical_adjustment}`;
    console.log(`  [n=${String(r.n).padStart(4)}] [${r.calibration_confidence ?? '—'}, adj=${adj}] ${r.calibration_cell_used}`);
  });
}

// ── 4. Negative adj count ──────────────────────────────────────────────────────
const negCount = db.get(`SELECT COUNT(*) AS n FROM prepublish_shadow_log WHERE empirical_adjustment < 0`);
console.log(`\n--- Negative Empirical Adjustments ---`);
console.log(`  Rows with empirical_adjustment < 0: ${negCount?.n ?? 0}`);

const negCells = db.all(`
  SELECT calibration_cell_used, empirical_adjustment, COUNT(*) AS n
  FROM prepublish_shadow_log
  WHERE empirical_adjustment < 0
  GROUP BY calibration_cell_used
  ORDER BY n DESC
  LIMIT 10
`);
if (negCells.length) {
  console.log('  Top negative cells:');
  negCells.forEach(r => console.log(`    [n=${r.n}] adj=${r.empirical_adjustment}  ${r.calibration_cell_used}`));
}

// ── 5. Calibration confidence distribution ────────────────────────────────────
const confDist = db.all(`
  SELECT
    COALESCE(calibration_confidence, 'none (no cell)') AS conf,
    COUNT(*) AS n
  FROM prepublish_shadow_log
  GROUP BY conf
  ORDER BY n DESC
`);
console.log('\n--- Calibration Confidence Distribution ---');
confDist.forEach(r => console.log(`  ${r.conf.padEnd(20)}: ${r.n}`));

// ── 6. Cell level fallback distribution ───────────────────────────────────────
const levelDist = db.all(`
  SELECT cell_level, COUNT(*) AS n
  FROM prepublish_shadow_log
  GROUP BY cell_level
  ORDER BY cell_level
`);
console.log('\n--- Cell Level Fallback Distribution ---');
levelDist.forEach(r => {
  const label = r.cell_level == null ? 'null'
    : r.cell_level <= 6 ? `Level ${r.cell_level}`
    : 'Level 7 (no cell)';
  const bar = '█'.repeat(Math.round((r.n / total.n) * 30));
  console.log(`  ${label.padEnd(16)}: ${String(r.n).padStart(6)}  ${bar}`);
});

// ── 7. Legacy vs empirical comparison ─────────────────────────────────────────
const comparison = db.get(`
  SELECT
    AVG(legacy_data_adjustment)  AS avg_legacy,
    AVG(empirical_adjustment)    AS avg_empirical,
    SUM(CASE WHEN legacy_data_adjustment > 0 THEN 1 ELSE 0 END)  AS legacy_pos,
    SUM(CASE WHEN legacy_data_adjustment < 0 THEN 1 ELSE 0 END)  AS legacy_neg,
    SUM(CASE WHEN empirical_adjustment   > 0 THEN 1 ELSE 0 END)  AS emp_pos,
    SUM(CASE WHEN empirical_adjustment   < 0 THEN 1 ELSE 0 END)  AS emp_neg,
    SUM(CASE WHEN legacy_data_adjustment != 0 AND empirical_adjustment = 0 THEN 1 ELSE 0 END) AS legacy_only,
    SUM(CASE WHEN legacy_data_adjustment  = 0 AND empirical_adjustment != 0 THEN 1 ELSE 0 END) AS emp_only,
    SUM(CASE WHEN legacy_data_adjustment != 0 AND empirical_adjustment != 0
              AND SIGN(legacy_data_adjustment) = SIGN(empirical_adjustment) THEN 1 ELSE 0 END) AS agree,
    SUM(CASE WHEN legacy_data_adjustment != 0 AND empirical_adjustment != 0
              AND SIGN(legacy_data_adjustment) != SIGN(empirical_adjustment) THEN 1 ELSE 0 END) AS disagree
  FROM prepublish_shadow_log
`);
console.log('\n--- Legacy vs Empirical Comparison ---');
console.log(`  Avg legacy adj   : ${fmt(comparison?.avg_legacy, 2)}`);
console.log(`  Avg empirical adj: ${fmt(comparison?.avg_empirical, 2)}`);
console.log(`  Legacy  pos/neg  : ${comparison?.legacy_pos ?? 0} / ${comparison?.legacy_neg ?? 0}`);
console.log(`  Empirical pos/neg: ${comparison?.emp_pos ?? 0} / ${comparison?.emp_neg ?? 0}`);
console.log(`  Legacy-only adj  : ${comparison?.legacy_only ?? 0}  (legacy ≠ 0 but empirical = 0)`);
console.log(`  Empirical-only   : ${comparison?.emp_only ?? 0}  (empirical ≠ 0 but legacy = 0)`);
console.log(`  Both agree dir   : ${comparison?.agree ?? 0}`);
console.log(`  Disagree dir     : ${comparison?.disagree ?? 0}`);

// ── 8. Recent rows ─────────────────────────────────────────────────────────────
const recent = db.all(`
  SELECT created_at, title, empirical_adjustment, calibration_confidence, cell_level
  FROM prepublish_shadow_log
  ORDER BY created_at DESC
  LIMIT 10
`);
console.log('\n--- 10 Most Recent Shadow Logs ---');
recent.forEach(r => {
  const adj = r.empirical_adjustment >= 0 ? `+${r.empirical_adjustment}` : `${r.empirical_adjustment}`;
  const conf = r.calibration_confidence ?? 'none';
  const lvl  = r.cell_level != null ? `L${r.cell_level}` : '—';
  const title = (r.title ?? '').slice(0, 50);
  console.log(`  ${r.created_at}  [adj=${adj}, ${conf}, ${lvl}]  ${title}`);
});

console.log('');

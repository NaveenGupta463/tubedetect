'use strict';
const path = require('path');
const Database = require('../node_modules/better-sqlite3');
const db = new Database(path.resolve(__dirname, '../data/scoring.db'), { readonly: true, timeout: 60000 });

// Family breakdown in gold set
const byFamily = db.prepare(`
  SELECT family, COUNT(*) as n,
    SUM(CASE WHEN human_label IN ('Excellent','Good') THEN 1 ELSE 0 END) as pos,
    SUM(CASE WHEN human_label IS NOT NULL THEN 1 ELSE 0 END) as labeled
  FROM wtp_human_quality_reviews
  GROUP BY family ORDER BY n DESC
`).all();

process.stdout.write('\n=== Gold set by family ===\n');
byFamily.forEach(r => {
  const rate = r.labeled > 0 ? (r.pos / r.labeled * 100).toFixed(1) + '%' : 'N/A';
  process.stdout.write('  ' + (r.family || '(none)').padEnd(30) + ' n=' + r.n + ' pos=' + r.pos + ' (' + rate + ')\n');
});

// Unlabeled traces by family - high value niches
const unlabeledByFamily = db.prepare(`
  SELECT t.family, COUNT(*) as n,
    COUNT(CASE WHEN t.wtp_score >= 70 THEN 1 END) as high_score
  FROM wtp_generation_traces t
  LEFT JOIN wtp_human_quality_reviews r ON t.id = r.trace_id
  WHERE r.trace_id IS NULL AND t.generated_title IS NOT NULL AND t.generated_title != ''
  GROUP BY t.family ORDER BY high_score DESC, n DESC
  LIMIT 20
`).all();

process.stdout.write('\n=== Unlabeled traces by family (high_score = wtp_score>=70) ===\n');
unlabeledByFamily.forEach(r => {
  process.stdout.write('  ' + (r.family || '(none)').padEnd(30) + ' total=' + r.n + ' high_score=' + r.high_score + '\n');
});

// Sample of unlabeled cooking/fitness traces
const cookingPeek = db.prepare(`
  SELECT t.rec_source, t.family, t.generated_title, t.wtp_score, t.concept_label
  FROM wtp_generation_traces t
  LEFT JOIN wtp_human_quality_reviews r ON t.id = r.trace_id
  WHERE r.trace_id IS NULL
    AND (LOWER(t.family) LIKE '%cooking%' OR LOWER(t.family) LIKE '%food%'
         OR LOWER(t.family) LIKE '%fitness%' OR LOWER(t.family) LIKE '%health%')
    AND t.generated_title IS NOT NULL AND t.generated_title != ''
    AND t.wtp_score >= 60
  ORDER BY t.wtp_score DESC
  LIMIT 20
`).all();

process.stdout.write('\n=== Sample unlabeled cooking/fitness/health (wtp_score>=60) ===\n');
cookingPeek.forEach(r => {
  process.stdout.write('  [' + r.wtp_score + '] ' + r.rec_source + ' | ' + r.generated_title + '\n');
});

// How many total unlabeled with wtp_score >= 60 (best candidates)
const highValueCount = db.prepare(`
  SELECT COUNT(*) as n
  FROM wtp_generation_traces t
  LEFT JOIN wtp_human_quality_reviews r ON t.id = r.trace_id
  WHERE r.trace_id IS NULL AND t.wtp_score >= 60
    AND t.generated_title IS NOT NULL AND t.generated_title != ''
`).get();

process.stdout.write('\n=== Total unlabeled with wtp_score>=60: ' + highValueCount.n + ' ===\n');

db.close();

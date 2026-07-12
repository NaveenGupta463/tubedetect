'use strict';
const path = require('path');
const Database = require('../node_modules/better-sqlite3');
const db = new Database(path.resolve(__dirname, '../data/scoring.db'), { readonly: true, timeout: 60000 });

// Schema
const cols = db.prepare("PRAGMA table_info(wtp_human_quality_reviews)").all();
console.log('=== wtp_human_quality_reviews columns ===');
cols.forEach(c => process.stdout.write('  ' + c.name + ' (' + c.type + ')\n'));

const total = db.prepare('SELECT COUNT(*) as n FROM wtp_human_quality_reviews WHERE human_label IS NOT NULL').get().n;
const totalRows = db.prepare('SELECT COUNT(*) as n FROM wtp_human_quality_reviews').get().n;
const byLabel = db.prepare(`
  SELECT human_label as label, COUNT(*) as n
  FROM wtp_human_quality_reviews
  WHERE human_label IS NOT NULL
  GROUP BY human_label ORDER BY n DESC
`).all();
const bySrc = db.prepare(`
  SELECT rec_source as source, COUNT(*) as n
  FROM wtp_human_quality_reviews
  WHERE human_label IS NOT NULL
  GROUP BY rec_source ORDER BY n DESC
`).all();

process.stdout.write('\n=== wtp_human_quality_reviews: ' + totalRows + ' total, ' + total + ' labeled ===\n');
byLabel.forEach(r => process.stdout.write('  ' + r.label + ': ' + r.n + '\n'));
process.stdout.write('\n=== By rec_source (labeled only) ===\n');
bySrc.forEach(r => process.stdout.write('  ' + r.source + ': ' + r.n + '\n'));

// Unlabeled rows in reviews table
const unlabeledReviews = db.prepare('SELECT COUNT(*) as n FROM wtp_human_quality_reviews WHERE human_label IS NULL').get().n;
process.stdout.write('\n=== Unlabeled in wtp_human_quality_reviews: ' + unlabeledReviews + ' ===\n');

// Total traces
const totalTraces = db.prepare('SELECT COUNT(*) as n FROM wtp_generation_traces').get().n;
const tracesCols = db.prepare("PRAGMA table_info(wtp_generation_traces)").all();
process.stdout.write('\n=== wtp_generation_traces: ' + totalTraces + ' total ===\n');
process.stdout.write('columns: ' + tracesCols.map(c=>c.name).join(', ') + '\n');

// Traces not yet in reviews
const unlabeledTraces = db.prepare(`
  SELECT t.source, COUNT(*) as n
  FROM wtp_generation_traces t
  LEFT JOIN wtp_human_quality_reviews r ON t.id = r.trace_id
  WHERE r.trace_id IS NULL
  GROUP BY t.source
  ORDER BY n DESC
`).all();
process.stdout.write('\n=== Traces not yet in wtp_human_quality_reviews ===\n');
unlabeledTraces.forEach(r => process.stdout.write('  ' + r.source + ': ' + r.n + '\n'));

// Score distribution for unlabeled traces
const scoreInfo = db.prepare(`
  SELECT
    COUNT(CASE WHEN t.wtp_score >= 70 THEN 1 END) as high,
    COUNT(CASE WHEN t.wtp_score >= 50 AND t.wtp_score < 70 THEN 1 END) as mid,
    COUNT(CASE WHEN t.wtp_score < 50 OR t.wtp_score IS NULL THEN 1 END) as low
  FROM wtp_generation_traces t
  LEFT JOIN wtp_human_quality_reviews r ON t.id = r.trace_id
  WHERE r.trace_id IS NULL
`).get();
process.stdout.write('\n=== Unlabeled traces wtp_score distribution ===\n');
process.stdout.write('  high (>=70): ' + scoreInfo.high + '\n');
process.stdout.write('  mid  (50-69): ' + scoreInfo.mid + '\n');
process.stdout.write('  low  (<50/null): ' + scoreInfo.low + '\n');

db.close();

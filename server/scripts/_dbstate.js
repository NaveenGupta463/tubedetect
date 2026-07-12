'use strict';
const path = require('path');
const Database = require('../node_modules/better-sqlite3');
const db = new Database(path.resolve(__dirname, '../data/scoring.db'), { readonly: true, timeout: 60000 });

const dates = db.prepare("SELECT MIN(created_at) as oldest, MAX(created_at) as newest, COUNT(*) as n FROM wtp_generation_traces WHERE rec_source = 'dna_original_bets'").get();
process.stdout.write('DNA traces: ' + dates.n + '  oldest=' + dates.oldest + '  newest=' + dates.newest + '\n');

const gold = db.prepare("SELECT human_label, COUNT(*) as n FROM wtp_human_quality_reviews WHERE human_label IS NOT NULL GROUP BY human_label ORDER BY n DESC").all();
process.stdout.write('Gold set: ');
gold.forEach(r => process.stdout.write(r.human_label + '=' + r.n + ' '));
process.stdout.write('\n');

const exc = db.prepare("SELECT generated_title, rec_source, family, concept_label, concept_confidence, score FROM wtp_human_quality_reviews WHERE human_label = 'Excellent' ORDER BY id").all();
process.stdout.write('\nExcellent rows (' + exc.length + '):\n');
exc.forEach(r => process.stdout.write('  [' + r.rec_source + '] ' + r.generated_title + '\n'));

const byDate = db.prepare("SELECT DATE(created_at) as d, rec_source, COUNT(*) as n FROM wtp_generation_traces WHERE DATE(created_at) >= DATE('now', '-7 days') GROUP BY DATE(created_at), rec_source ORDER BY d DESC, n DESC").all();
process.stdout.write('\nNew traces last 7 days:\n');
byDate.forEach(r => process.stdout.write('  ' + r.d + ' ' + r.rec_source + ' n=' + r.n + '\n'));

const patterns = db.prepare("SELECT family, concept_label, rec_source, COUNT(*) as n, SUM(CASE WHEN human_label IN ('Excellent','Good') THEN 1 ELSE 0 END) as pos FROM wtp_human_quality_reviews WHERE human_label IS NOT NULL GROUP BY family, concept_label, rec_source ORDER BY pos DESC, n DESC LIMIT 20").all();
process.stdout.write('\nTop family x concept x source by positive count:\n');
patterns.forEach(r => process.stdout.write('  ' + (r.family||'?').padEnd(22) + ' ' + (r.concept_label||'?').padEnd(28) + ' ' + (r.rec_source||'?').padEnd(20) + ' pos=' + r.pos + '/n=' + r.n + '\n'));

db.close();

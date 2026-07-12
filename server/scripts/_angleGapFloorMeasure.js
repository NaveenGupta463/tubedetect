'use strict';
const BetterSqlite3 = require('../node_modules/better-sqlite3');
const path = require('path');

const db = new BetterSqlite3(path.resolve(__dirname, '../data/scoring.db'), { readonly: true });

// Named entities: specific proper nouns that make a short topic filmable.
// "India" excluded intentionally — it's the default topic domain, not a distinguishing entity.
// The list covers common entities in the Indian YouTube corpus.
const PROPER_NOUNS = new Set([
  // World leaders / politicians
  'trump', 'modi', 'biden', 'putin', 'xi', 'zelensky', 'netanyahu', 'khamenei',
  'macron', 'sunak', 'erdogan', 'johnson', 'obama', 'clinton', 'bush', 'reagan',
  'kejriwal', 'rahul', 'gandhi', 'yogi', 'shah', 'jaishankar', 'sitharaman',
  'nitish', 'mamata', 'abe', 'kim', 'scholz', 'zelensky',
  // Countries (specific geopolitical actors, not just topic domains)
  'china', 'chinese', 'pakistan', 'pakistani', 'russia', 'russian', 'ukraine',
  'ukrainian', 'iran', 'iranian', 'israel', 'israeli', 'america', 'american',
  'usa', 'us', 'uk', 'britain', 'british', 'france', 'french', 'germany', 'german',
  'japan', 'japanese', 'bangladesh', 'myanmar', 'afghanistan', 'nepal', 'taiwan',
  'north', 'south', 'korea', 'saudi', 'arabia', 'turkey', 'brazil', 'canada',
  // Major organizations
  'rbi', 'sebi', 'bcci', 'ipl', 'icc', 'nato', 'imf', 'isro', 'nasa', 'who',
  'bjp', 'congress', 'aap', 'inc', 'sp', 'bsp', 'tmc', 'nda', 'upa', 'unsc',
  'apple', 'google', 'microsoft', 'amazon', 'tesla', 'openai', 'anthropic',
  'adani', 'ambani', 'tata', 'reliance', 'infosys', 'wipro',
  // Indian cities / courts
  'delhi', 'mumbai', 'hyderabad', 'bangalore', 'bengaluru', 'chennai', 'kolkata',
  'ahmedabad', 'pune', 'jaipur', 'lucknow', 'patna', 'bhopal', 'chandigarh',
  'supreme', 'court', 'parliament', 'lok', 'rajya', 'sabha', 'election',
  // International cities
  'washington', 'moscow', 'beijing', 'london', 'paris', 'berlin', 'tokyo',
  'islamabad', 'lahore', 'karachi', 'dhaka', 'kathmandu', 'kabul', 'tehran',
  'jerusalem', 'kyiv', 'ankara', 'riyadh',
  // Common proper nouns in Indian financial/business context
  'sensex', 'nifty', 'nse', 'bse', 'ipo', 'fii', 'dii', 'gdp', 'cpi', 'wpi',
  'rupee', 'dollar', 'euro', 'yuan',
  // Sports entities
  'ipl', 'cricket', 'virat', 'kohli', 'sachin', 'dhoni', 'rohit', 'bumrah',
  'fifa', 'isl', 'nba',
]);

function hasNamedEntity(topic) {
  const words = String(topic || '').toLowerCase().split(/\s+/);
  return words.some(w =>
    /\d/.test(w) ||                   // contains a digit
    /^[a-z]{2,5}$/.test(w) && w === w.toUpperCase().toLowerCase() && PROPER_NOUNS.has(w) ||
    PROPER_NOUNS.has(w) ||            // known proper noun
    /^\d{1,3}(cr|lakh|k|m|b|%|\+)$/i.test(w) // currency/percentage shorthand
  );
}
function wordCount(t) { return String(t || '').trim().split(/\s+/).filter(Boolean).length; }
function passes(title) {
  const wc = wordCount(title);
  return wc >= 6 || hasNamedEntity(title);
}

// ── Gold set analysis ─────────────────────────────────────────────────────────
const goldRows = db.prepare(
  `SELECT generated_title, rec_source, human_label FROM wtp_human_quality_reviews WHERE rec_source = 'angle_gap'`
).all();

const gTotal = goldRows.length;
let gKept = 0, gRej = 0;
const gLabelKept = {}, gLabelRej = {};
const rejectedExamples = [], keptExamples = [];

for (const r of goldRows) {
  const pass = passes(r.generated_title);
  if (pass) {
    gKept++;
    gLabelKept[r.human_label] = (gLabelKept[r.human_label] || 0) + 1;
    if (keptExamples.length < 10) keptExamples.push({ label: r.human_label, title: r.generated_title, wc: wordCount(r.generated_title), entity: hasNamedEntity(r.generated_title) });
  } else {
    gRej++;
    gLabelRej[r.human_label] = (gLabelRej[r.human_label] || 0) + 1;
    if (rejectedExamples.length < 10) rejectedExamples.push({ label: r.human_label, title: r.generated_title, wc: wordCount(r.generated_title) });
  }
}

console.log('\n══════════════════════════════════════════════════════════════');
console.log('  P1 Angle Gap Quality Floor — Measurement (curated entity list)');
console.log('══════════════════════════════════════════════════════════════\n');
console.log(`── Gold Set (angle_gap rows, n=${gTotal}) ──────────────────────`);
console.log(`  Kept:     ${gKept}/${gTotal} (${(gKept/gTotal*100).toFixed(1)}%)`);
console.log(`  Rejected: ${gRej}/${gTotal} (${(gRej/gTotal*100).toFixed(1)}%)`);
console.log('\n  Rejected by label (should mostly be Garbage/Poor):');
const ORDER = ['Garbage', 'Poor', 'Average', 'Good', 'Excellent'];
for (const lbl of ORDER) {
  const r = gLabelRej[lbl] || 0;
  if (!r) continue;
  const total = goldRows.filter(x => x.human_label === lbl).length;
  console.log(`    ${lbl.padEnd(10)} ${r}/${total} (${(r/total*100).toFixed(1)}% of ${lbl} rejected)`);
}
console.log('\n  Kept by label:');
for (const lbl of ORDER) {
  const k = gLabelKept[lbl] || 0;
  if (!k) continue;
  const total = goldRows.filter(x => x.human_label === lbl).length;
  console.log(`    ${lbl.padEnd(10)} ${k}/${total} (${(k/total*100).toFixed(1)}% of ${lbl} kept)`);
}

console.log('\n  Rejected examples:');
for (const e of rejectedExamples) console.log(`    [${e.label}][${e.wc}w] "${e.title}"`);
console.log('\n  Kept examples (sample):');
for (const e of keptExamples) console.log(`    [${e.label}][${e.wc}w][ent=${e.entity}] "${e.title}"`);

// ── Full corpus analysis ──────────────────────────────────────────────────────
const corpusTotal = db.prepare(`SELECT COUNT(*) as n FROM wtp_generation_traces WHERE rec_source='angle_gap'`).get().n;
const corpusRows = db.prepare(`SELECT generated_title FROM wtp_generation_traces WHERE rec_source='angle_gap' LIMIT 5000`).all();
let cKept = 0, cRej = 0;
const rejectedCorpusExamples = [];
for (const r of corpusRows) {
  if (passes(r.generated_title)) {
    cKept++;
  } else {
    cRej++;
    if (rejectedCorpusExamples.length < 15) rejectedCorpusExamples.push(`[${wordCount(r.generated_title)}w] "${r.generated_title}"`);
  }
}
const cSample = corpusRows.length;
console.log(`\n── Full Trace Corpus (sample ${cSample}/${corpusTotal}) ──────────────────`);
console.log(`  Would keep:   ${cKept}/${cSample} (${(cKept/cSample*100).toFixed(1)}%)`);
console.log(`  Would reject: ${cRej}/${cSample} (${(cRej/cSample*100).toFixed(1)}%)`);

if (rejectedCorpusExamples.length) {
  console.log('\n  Corpus rejected examples:');
  for (const e of rejectedCorpusExamples) console.log(`    ${e}`);
}

console.log('\n══════════════════════════════════════════════════════════════\n');
db.close();

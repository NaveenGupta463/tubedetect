'use strict';

/**
 * Winner Pattern Audit — Phases 1 + 2
 *
 * Phase 1: Characterize Excellent+Good recommendations (what makes a winner).
 * Phase 2: Delta comparison — winners vs losers (Poor+Garbage).
 *
 * Outputs:
 *   scripts/winner_pattern_report.md     (Phase 1)
 *   scripts/winner_vs_loser_report.md    (Phase 2)
 *
 * Usage:
 *   node winnerPatternAudit.js [--verbose]
 */

const path = require('path');
const fs   = require('fs');
const BetterSqlite3 = require('../node_modules/better-sqlite3');

// ── Named entity detection (same curated list as P1 quality floor) ────────────
const _PROPER_NOUNS = new Set([
  'trump','modi','biden','putin','xi','zelensky','netanyahu','khamenei','macron',
  'sunak','erdogan','johnson','obama','clinton','bush','kejriwal','rahul','gandhi',
  'yogi','shah','jaishankar','sitharaman','nitish','mamata','abe','kim','scholz',
  'china','chinese','pakistan','pakistani','russia','russian','ukraine','ukrainian',
  'iran','iranian','israel','israeli','america','american','usa','us','uk',
  'britain','british','france','french','germany','german','japan','japanese',
  'bangladesh','myanmar','afghanistan','nepal','taiwan','korea','turkish','saudi',
  'rbi','sebi','bcci','ipl','icc','nato','imf','isro','nasa','who','wto',
  'bjp','congress','aap','inc','sp','bsp','tmc','nda','upa','unsc',
  'apple','google','microsoft','amazon','tesla','openai','anthropic','meta','samsung',
  'adani','ambani','tata','reliance','infosys','wipro','hdfc','sbi','icici',
  'delhi','mumbai','hyderabad','bangalore','bengaluru','chennai','kolkata',
  'ahmedabad','pune','jaipur','lucknow','patna','bhopal','chandigarh','bengal',
  'washington','moscow','beijing','london','paris','berlin','tokyo',
  'islamabad','lahore','karachi','dhaka','kathmandu','kabul','tehran',
  'jerusalem','kyiv','ankara','riyadh','dubai',
  'sensex','nifty','nse','bse','ipo','gdp','cpi','wpi','rupee','dollar','euro','yuan',
  'cricket','virat','kohli','sachin','dhoni','rohit','bumrah','fifa','isl','nba',
  'election','elections','parliament','supreme','court','lok','rajya','sabha',
  'budget','inflation','recession','pandemic','covid','vaccine',
]);

function wordCount(title) {
  return String(title || '').trim().split(/\s+/).filter(Boolean).length;
}

function namedEntityCount(title) {
  return String(title || '').toLowerCase().split(/\s+/).filter(w =>
    /\d/.test(w) ||
    /^\d{1,4}(cr|lakh|k|m|b|%|\+)$/i.test(w) ||
    _PROPER_NOUNS.has(w)
  ).length;
}

function normScore(row) {
  if (row.wtp_score != null) return row.wtp_score;
  const s = row.dna_affinity_score;
  if (s == null) return null;
  return s > 2 ? Math.round(s) : Math.round(s * 100);
}

// ── Stats helpers ─────────────────────────────────────────────────────────────
function mean(arr)   { return arr.length ? arr.reduce((s,v)=>s+v,0)/arr.length : 0; }
function median(arr) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a,b)=>a-b);
  const m = Math.floor(s.length/2);
  return s.length % 2 ? s[m] : (s[m-1]+s[m])/2;
}
function pct(n,d)    { return d>0 ? (n/d*100).toFixed(1)+'%' : '0.0%'; }
function fmt(n)      { return typeof n === 'number' ? n.toFixed(2) : 'n/a'; }

function topN(map, n=8) {
  return Object.entries(map)
    .sort((a,b)=>b[1]-a[1])
    .slice(0, n);
}

function freqMap(rows, key) {
  const m = {};
  for (const r of rows) {
    const v = r[key] || '(none)';
    m[v] = (m[v]||0) + 1;
  }
  return m;
}

// ── Database ──────────────────────────────────────────────────────────────────
function openDb() {
  return new BetterSqlite3(
    path.resolve(__dirname, '../data/scoring.db'),
    { readonly: true, timeout: 60000 }
  );
}

function loadRows(db) {
  return db.prepare(`
    SELECT
      r.id,
      r.rec_source,
      r.family,
      r.archetype,
      r.generated_title,
      r.concept_id,
      r.concept_label,
      r.concept_confidence,
      r.dna_affinity_score,
      r.score         AS raw_score,
      r.human_label,
      r.reviewer_notes,
      t.opportunity_id,
      t.opportunity_label,
      t.opportunity_confidence,
      t.wtp_score,
      c.primary_niche
    FROM wtp_human_quality_reviews r
    LEFT JOIN wtp_generation_traces t ON t.id = r.trace_id
    LEFT JOIN ingested_channels     c ON c.id = r.channel_id
    WHERE r.human_label IS NOT NULL
    ORDER BY r.human_label, r.id
  `).all();
}

// ── Augment rows with computed fields ─────────────────────────────────────────
function augment(rows) {
  return rows.map(r => ({
    ...r,
    wc:       wordCount(r.generated_title),
    entities: namedEntityCount(r.generated_title),
    norm:     normScore(r),
  }));
}

const LABEL_SCORE = { Excellent:5, Good:4, Average:3, Poor:2, Garbage:1 };
const isWinner = r => r.human_label === 'Excellent' || r.human_label === 'Good';
const isLoser  = r => r.human_label === 'Poor'      || r.human_label === 'Garbage';

// ── Numeric comparison table ──────────────────────────────────────────────────
function numStats(rows) {
  const wcs   = rows.map(r=>r.wc).filter(v=>v!=null);
  const ents  = rows.map(r=>r.entities).filter(v=>v!=null);
  const norms = rows.map(r=>r.norm).filter(v=>v!=null);
  const dnas  = rows.map(r=>r.dna_affinity_score).filter(v=>v!=null);
  const confs = rows.map(r=>r.concept_confidence).filter(v=>v!=null);
  return { wcs, ents, norms, dnas, confs };
}

// ── Build Phase 1 report ──────────────────────────────────────────────────────
function buildWinnerReport(winners, allRows) {
  const n     = winners.length;
  const stats = numStats(winners);

  const lines = [];
  const L = s => lines.push(s);

  L('# Winner Pattern Report');
  L('');
  L(`**Generated:** ${new Date().toISOString().slice(0,10)}`);
  L(`**Winner rows (Excellent + Good):** ${n} / ${allRows.length} total labeled`);
  L(`**Positive rate:** ${pct(n, allRows.length)}`);
  L('');
  L('---');
  L('');

  // ── Label breakdown of winners ────────────────────────────────────────────
  L('## 1. Label Distribution');
  L('');
  const byLabel = {};
  for (const r of winners) byLabel[r.human_label] = (byLabel[r.human_label]||0)+1;
  for (const lbl of ['Excellent','Good']) {
    L(`- **${lbl}**: ${byLabel[lbl]||0} (${pct(byLabel[lbl]||0, n)})`);
  }
  L('');

  // ── Source distribution ───────────────────────────────────────────────────
  L('## 2. Source Distribution');
  L('');
  L('| Source | Winners | % of winners | Total in gold | Win rate |');
  L('|---|---|---|---|---|');
  const srcAll = freqMap(allRows, 'rec_source');
  const srcWin = freqMap(winners, 'rec_source');
  for (const [src, wn] of topN(srcWin, 10)) {
    const tot = srcAll[src] || 0;
    L(`| ${src} | ${wn} | ${pct(wn,n)} | ${tot} | ${pct(wn,tot)} |`);
  }
  L('');

  // ── Family distribution ───────────────────────────────────────────────────
  L('## 3. Family Distribution');
  L('');
  L('| Family | Winners | % | Total in gold | Win rate |');
  L('|---|---|---|---|---|');
  const famAll = freqMap(allRows, 'family');
  const famWin = freqMap(winners, 'family');
  for (const [fam, wn] of topN(famWin, 12)) {
    const tot = famAll[fam] || 0;
    L(`| ${fam} | ${wn} | ${pct(wn,n)} | ${tot} | ${pct(wn,tot)} |`);
  }
  L('');

  // ── Concept distribution ──────────────────────────────────────────────────
  L('## 4. Concept Distribution');
  L('');
  L('| Concept | Winners | % | Total in gold | Win rate |');
  L('|---|---|---|---|---|');
  const conAll = freqMap(allRows, 'concept_label');
  const conWin = freqMap(winners, 'concept_label');
  for (const [con, wn] of topN(conWin, 12)) {
    const tot = conAll[con] || 0;
    L(`| ${con} | ${wn} | ${pct(wn,n)} | ${tot} | ${pct(wn,tot)} |`);
  }
  L('');

  // ── Opportunity distribution ──────────────────────────────────────────────
  L('## 5. Opportunity Distribution');
  L('');
  L('| Opportunity | Winners | % | Total in gold | Win rate |');
  L('|---|---|---|---|---|');
  const oppAll = freqMap(allRows, 'opportunity_label');
  const oppWin = freqMap(winners, 'opportunity_label');
  for (const [opp, wn] of topN(oppWin, 12)) {
    const tot = oppAll[opp] || 0;
    L(`| ${opp} | ${wn} | ${pct(wn,n)} | ${tot} | ${pct(wn,tot)} |`);
  }
  L('');

  // ── Creator niche distribution ────────────────────────────────────────────
  L('## 6. Creator Niche Distribution');
  L('');
  L('| Niche | Winners | % | Total in gold | Win rate |');
  L('|---|---|---|---|---|');
  const nichAll = freqMap(allRows, 'primary_niche');
  const nichWin = freqMap(winners, 'primary_niche');
  for (const [n_, wn] of topN(nichWin, 12)) {
    const tot = nichAll[n_] || 0;
    L(`| ${n_} | ${wn} | ${pct(wn,n)} | ${tot} | ${pct(wn,tot)} |`);
  }
  L('');

  // ── Numeric stats ─────────────────────────────────────────────────────────
  L('## 7. Numeric Characteristics of Winners');
  L('');
  L('| Metric | Mean | Median | Min | Max |');
  L('|---|---|---|---|---|');
  const numRow = (label, arr) => {
    if (!arr.length) return `| ${label} | n/a | n/a | n/a | n/a |`;
    const s = [...arr].sort((a,b)=>a-b);
    return `| ${label} | ${fmt(mean(arr))} | ${fmt(median(arr))} | ${s[0].toFixed(2)} | ${s[s.length-1].toFixed(2)} |`;
  };
  L(numRow('Word count',           stats.wcs));
  L(numRow('Named entity count',   stats.ents));
  L(numRow('Normalized score',     stats.norms));
  L(numRow('DNA affinity (raw)',   stats.dnas));
  L(numRow('Concept confidence',   stats.confs));
  L('');

  // ── Word count buckets ────────────────────────────────────────────────────
  L('## 8. Word Count Distribution (winners)');
  L('');
  const wcBuckets = { '1-4':0,'5-7':0,'8-10':0,'11-14':0,'15+':0 };
  for (const r of winners) {
    if      (r.wc <= 4)  wcBuckets['1-4']++;
    else if (r.wc <= 7)  wcBuckets['5-7']++;
    else if (r.wc <= 10) wcBuckets['8-10']++;
    else if (r.wc <= 14) wcBuckets['11-14']++;
    else                  wcBuckets['15+']++;
  }
  for (const [b, cnt] of Object.entries(wcBuckets)) {
    L(`- **${b} words**: ${cnt} (${pct(cnt,n)})`);
  }
  L('');

  // ── Example titles ────────────────────────────────────────────────────────
  L('## 9. Example Winner Titles');
  L('');
  L('### Excellent (all)');
  for (const r of winners.filter(r=>r.human_label==='Excellent')) {
    L(`- [${r.rec_source} / ${r.family||'?'}] "${r.generated_title}"`);
    if (r.reviewer_notes) L(`  > ${r.reviewer_notes}`);
  }
  L('');
  L('### Good (sample — up to 20)');
  for (const r of winners.filter(r=>r.human_label==='Good').slice(0,20)) {
    L(`- [${r.rec_source} / ${r.family||'?'}] "${r.generated_title}"`);
  }
  L('');

  // ── Key patterns summary ──────────────────────────────────────────────────
  L('## 10. Key Patterns (synthesized)');
  L('');
  const topSrc  = topN(srcWin,1)[0];
  const topFam  = topN(famWin,1)[0];
  const topCon  = topN(conWin,1)[0];
  const avgWC   = mean(stats.wcs);
  const avgEnt  = mean(stats.ents);
  L(`- **Dominant source**: ${topSrc?.[0]} (${topSrc?.[1]} winners)`);
  L(`- **Dominant family**: ${topFam?.[0]} (${topFam?.[1]} winners)`);
  L(`- **Dominant concept**: ${topCon?.[0]} (${topCon?.[1]} winners)`);
  L(`- **Average word count**: ${avgWC.toFixed(1)} words`);
  L(`- **Average named entities**: ${avgEnt.toFixed(1)} per title`);
  L('');

  return lines.join('\n');
}

// ── Build Phase 2 report ──────────────────────────────────────────────────────
function buildDeltaReport(winners, losers, allRows) {
  const lines = [];
  const L = s => lines.push(s);

  L('# Winner vs Loser Comparison Report');
  L('');
  L(`**Generated:** ${new Date().toISOString().slice(0,10)}`);
  L(`**Winners (Excellent+Good):** ${winners.length} rows`);
  L(`**Losers (Poor+Garbage):** ${losers.length} rows`);
  L(`**Excluded from comparison:** Average (${allRows.filter(r=>r.human_label==='Average').length} rows)`);
  L('');
  L('---');
  L('');

  // ── Numeric deltas ────────────────────────────────────────────────────────
  L('## 1. Numeric Deltas');
  L('');
  L('| Metric | Winners avg | Losers avg | Delta | Winner advantage? |');
  L('|---|---|---|---|---|');
  const numDelta = (label, wArr, lArr) => {
    const wm = mean(wArr); const lm = mean(lArr);
    const d  = wm - lm;
    const adv = d > 0.5 ? '✓ YES' : d < -0.5 ? '✗ NO' : '~ neutral';
    L(`| ${label} | ${fmt(wm)} | ${fmt(lm)} | ${d>=0?'+':''}${fmt(d)} | ${adv} |`);
  };
  numDelta('Word count',         winners.map(r=>r.wc),       losers.map(r=>r.wc));
  numDelta('Named entity count', winners.map(r=>r.entities), losers.map(r=>r.entities));
  numDelta('Norm score (0–100)', winners.map(r=>r.norm).filter(v=>v!=null), losers.map(r=>r.norm).filter(v=>v!=null));
  numDelta('DNA affinity (raw)', winners.map(r=>r.dna_affinity_score).filter(v=>v!=null), losers.map(r=>r.dna_affinity_score).filter(v=>v!=null));
  numDelta('Concept confidence', winners.map(r=>r.concept_confidence).filter(v=>v!=null), losers.map(r=>r.concept_confidence).filter(v=>v!=null));
  numDelta('Opp confidence',     winners.map(r=>r.opportunity_confidence).filter(v=>v!=null), losers.map(r=>r.opportunity_confidence).filter(v=>v!=null));
  L('');

  // ── Source delta ──────────────────────────────────────────────────────────
  L('## 2. Source Distribution Delta');
  L('');
  L('| Source | Winners % | Losers % | Delta |');
  L('|---|---|---|---|');
  const allSrcs = [...new Set([...winners, ...losers].map(r=>r.rec_source||'(none)'))].sort();
  for (const src of allSrcs) {
    const wn = winners.filter(r=>(r.rec_source||'(none)')===src).length;
    const ln = losers.filter(r=>(r.rec_source||'(none)')===src).length;
    const wp = wn/winners.length*100; const lp = ln/losers.length*100;
    const d  = wp - lp;
    L(`| ${src} | ${wp.toFixed(1)}% | ${lp.toFixed(1)}% | ${d>=0?'+':''}${d.toFixed(1)}pp |`);
  }
  L('');

  // ── Family delta ──────────────────────────────────────────────────────────
  L('## 3. Family Distribution Delta (top 12 by winner count)');
  L('');
  L('| Family | Winners % | Losers % | Delta |');
  L('|---|---|---|---|');
  const allFams = [...new Set([...winners, ...losers].map(r=>r.family||'(none)'))];
  const winFamCnt = f => winners.filter(r=>(r.family||'(none)')===f).length;
  const losFamCnt = f => losers.filter(r=>(r.family||'(none)')===f).length;
  allFams.sort((a,b)=>winFamCnt(b)-winFamCnt(a)).slice(0,12).forEach(fam=>{
    const wn = winFamCnt(fam); const ln = losFamCnt(fam);
    const wp = wn/winners.length*100; const lp = ln/losers.length*100;
    const d  = wp - lp;
    L(`| ${fam} | ${wp.toFixed(1)}% | ${lp.toFixed(1)}% | ${d>=0?'+':''}${d.toFixed(1)}pp |`);
  });
  L('');

  // ── Concept delta ─────────────────────────────────────────────────────────
  L('## 4. Concept Distribution Delta (top 12 by winner count)');
  L('');
  L('| Concept | Win rate | # winners | # losers | Winner advantage |');
  L('|---|---|---|---|---|');
  const allCons = [...new Set([...winners,...losers].map(r=>r.concept_label||'(none)'))];
  allCons
    .map(con => {
      const wn = winners.filter(r=>(r.concept_label||'(none)')===con).length;
      const ln = losers.filter(r=>(r.concept_label||'(none)')===con).length;
      const tot = wn + ln;
      return { con, wn, ln, tot, rate: tot>0 ? wn/tot : 0 };
    })
    .sort((a,b)=>b.wn-a.wn)
    .slice(0,12)
    .forEach(({ con, wn, ln, tot, rate }) => {
      L(`| ${con} | ${pct(wn,tot)} | ${wn} | ${ln} | ${rate>=0.3?'✓':'✗'} |`);
    });
  L('');

  // ── Word count distribution delta ─────────────────────────────────────────
  L('## 5. Word Count Distribution Delta');
  L('');
  L('| Words | Winners % | Losers % | Delta |');
  L('|---|---|---|---|');
  const buckets = [
    { label:'1–3',  test: w => w<=3  },
    { label:'4–5',  test: w => w<=5  },
    { label:'6–8',  test: w => w<=8  },
    { label:'9–11', test: w => w<=11 },
    { label:'12+',  test: w => w>=12 },
  ];
  for (const { label, test } of buckets) {
    const wn = winners.filter(r=>test(r.wc)).length;
    const ln = losers.filter(r=>test(r.wc)).length;
    const wp = wn/winners.length*100; const lp = ln/losers.length*100;
    const d = wp-lp;
    L(`| ${label} | ${wp.toFixed(1)}% | ${lp.toFixed(1)}% | ${d>=0?'+':''}${d.toFixed(1)}pp |`);
  }
  L('');

  // ── Named entity distribution delta ───────────────────────────────────────
  L('## 6. Named Entity Count Delta');
  L('');
  L('| Entities | Winners % | Losers % | Delta |');
  L('|---|---|---|---|');
  for (const cnt of [0,1,2,3,4]) {
    const pred = r => cnt < 4 ? r.entities === cnt : r.entities >= 4;
    const label = cnt < 4 ? `${cnt}` : '4+';
    const wn = winners.filter(pred).length; const ln = losers.filter(pred).length;
    const wp = wn/winners.length*100; const lp = ln/losers.length*100;
    L(`| ${label} entities | ${wp.toFixed(1)}% | ${lp.toFixed(1)}% | ${(wp-lp)>=0?'+':''}${(wp-lp).toFixed(1)}pp |`);
  }
  L('');

  // ── Strongest predictors summary ──────────────────────────────────────────
  L('## 7. Strongest Predictors of Recommendation Success');
  L('');
  L('Ranked by discriminating power (winner advantage):');
  L('');

  const wWC   = mean(winners.map(r=>r.wc));
  const lWC   = mean(losers.map(r=>r.wc));
  const wEnt  = mean(winners.map(r=>r.entities));
  const lEnt  = mean(losers.map(r=>r.entities));
  const wDNA  = winners.filter(r=>r.rec_source==='dna_original_bets').length/winners.length;
  const lDNA  = losers.filter(r=>r.rec_source==='dna_original_bets').length/losers.length;
  const wAng  = winners.filter(r=>r.rec_source==='angle_gap').length/winners.length;
  const lAng  = losers.filter(r=>r.rec_source==='angle_gap').length/losers.length;
  const wPeer = winners.filter(r=>r.rec_source==='peer_video_signal').length/winners.length;
  const lPeer = losers.filter(r=>r.rec_source==='peer_video_signal').length/losers.length;

  const predictors = [
    { name: 'Is NOT angle_gap source', delta: (1-wAng) - (1-lAng), unit:'rate' },
    { name: 'Word count ≥ 8',          delta: winners.filter(r=>r.wc>=8).length/winners.length - losers.filter(r=>r.wc>=8).length/losers.length, unit:'rate' },
    { name: 'Named entities ≥ 2',      delta: winners.filter(r=>r.entities>=2).length/winners.length - losers.filter(r=>r.entities>=2).length/losers.length, unit:'rate' },
    { name: 'Is peer_video_signal',    delta: wPeer - lPeer, unit:'rate' },
    { name: 'Is dna_original_bets',    delta: wDNA  - lDNA,  unit:'rate' },
    { name: 'Avg word count (raw)',    delta: wWC   - lWC,   unit:'words' },
    { name: 'Avg entity count (raw)',  delta: wEnt  - lEnt,  unit:'entities' },
  ].sort((a,b)=>Math.abs(b.delta)-Math.abs(a.delta));

  for (const p of predictors) {
    const sign = p.delta > 0 ? '+' : '';
    const val  = p.unit === 'rate'
      ? `${sign}${(p.delta*100).toFixed(1)}pp`
      : `${sign}${p.delta.toFixed(2)} ${p.unit}`;
    const dir = p.delta > 0.05 ? '✓ predicts winner' : p.delta < -0.05 ? '✗ predicts loser' : '~ neutral';
    L(`- **${p.name}**: ${val} — ${dir}`);
  }
  L('');

  // ── Reviewer notes mining ─────────────────────────────────────────────────
  const winNotes = winners.filter(r=>r.reviewer_notes).map(r=>r.reviewer_notes);
  if (winNotes.length) {
    L('## 8. Reviewer Notes on Winners');
    L('');
    for (const n of winNotes.slice(0,20)) L(`- "${n}"`);
    L('');
  }

  return lines.join('\n');
}

// ── Main ──────────────────────────────────────────────────────────────────────
function main() {
  const db      = openDb();
  const verbose = process.argv.includes('--verbose');

  const raw     = loadRows(db);
  db.close();

  const rows    = augment(raw);
  const winners = rows.filter(isWinner);
  const losers  = rows.filter(isLoser);

  console.log(`\nLoaded ${rows.length} labeled rows`);
  console.log(`Winners (Excellent+Good): ${winners.length}`);
  console.log(`Losers  (Poor+Garbage):   ${losers.length}`);
  console.log(`Excluded (Average):       ${rows.filter(r=>r.human_label==='Average').length}`);

  if (winners.length === 0) {
    console.error('No winner rows found. Check that human labels are set.');
    process.exit(1);
  }

  // ── Phase 1 output ────────────────────────────────────────────────────────
  const phase1 = buildWinnerReport(winners, rows);
  const p1Path = path.resolve(__dirname, 'winner_pattern_report.md');
  fs.writeFileSync(p1Path, phase1, 'utf8');
  console.log(`\nPhase 1 report: ${p1Path}`);

  // ── Phase 2 output ────────────────────────────────────────────────────────
  const phase2 = buildDeltaReport(winners, losers, rows);
  const p2Path = path.resolve(__dirname, 'winner_vs_loser_report.md');
  fs.writeFileSync(p2Path, phase2, 'utf8');
  console.log(`Phase 2 report: ${p2Path}`);

  if (verbose) {
    console.log('\n─── WINNER PATTERN REPORT ───────────────────────────────────\n');
    console.log(phase1);
    console.log('\n─── WINNER VS LOSER REPORT ──────────────────────────────────\n');
    console.log(phase2);
  } else {
    // Print condensed summary to stdout
    console.log('\n══ WINNER PATTERNS (condensed) ══════════════════════════════');
    const srcWin  = freqMap(winners, 'rec_source');
    const famWin  = freqMap(winners, 'family');
    const conWin  = freqMap(winners, 'concept_label');
    const avgWC   = mean(winners.map(r=>r.wc));
    const avgEnt  = mean(winners.map(r=>r.entities));
    console.log(`  Sources:   ${topN(srcWin,3).map(([s,n])=>`${s}(${n})`).join(', ')}`);
    console.log(`  Families:  ${topN(famWin,3).map(([f,n])=>`${f}(${n})`).join(', ')}`);
    console.log(`  Concepts:  ${topN(conWin,3).map(([c,n])=>`${c}(${n})`).join(', ')}`);
    console.log(`  Avg words: ${avgWC.toFixed(1)},  avg entities: ${avgEnt.toFixed(1)}`);

    console.log('\n══ STRONGEST PREDICTORS ═════════════════════════════════════');
    const wWC  = mean(winners.map(r=>r.wc));  const lWC  = mean(losers.map(r=>r.wc));
    const wEnt = mean(winners.map(r=>r.entities)); const lEnt = mean(losers.map(r=>r.entities));
    console.log(`  Word count:     winners ${wWC.toFixed(1)}  losers ${lWC.toFixed(1)}  Δ=${(wWC-lWC>=0?'+':'')}${(wWC-lWC).toFixed(1)}`);
    console.log(`  Entity count:   winners ${wEnt.toFixed(1)} losers ${lEnt.toFixed(1)}  Δ=${(wEnt-lEnt>=0?'+':'')}${(wEnt-lEnt).toFixed(1)}`);

    const wAngRate = winners.filter(r=>r.rec_source==='angle_gap').length/winners.length;
    const lAngRate = losers.filter(r=>r.rec_source==='angle_gap').length/losers.length;
    console.log(`  angle_gap rate: winners ${(wAngRate*100).toFixed(1)}%  losers ${(lAngRate*100).toFixed(1)}%  Δ=${((wAngRate-lAngRate)*100>=0?'+':'')}${((wAngRate-lAngRate)*100).toFixed(1)}pp`);

    const wPeerRate = winners.filter(r=>r.rec_source==='peer_video_signal').length/winners.length;
    const lPeerRate = losers.filter(r=>r.rec_source==='peer_video_signal').length/losers.length;
    console.log(`  peer rate:      winners ${(wPeerRate*100).toFixed(1)}%  losers ${(lPeerRate*100).toFixed(1)}%  Δ=${((wPeerRate-lPeerRate)*100>=0?'+':'')}${((wPeerRate-lPeerRate)*100).toFixed(1)}pp`);
    console.log('');
  }
}

main();

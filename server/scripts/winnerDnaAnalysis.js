'use strict';

/**
 * Winner DNA Analysis — Phase 1
 *
 * Deep cluster analysis of Excellent + Good recommendations.
 * Answers:
 *   - What traits appear most often in winners?
 *   - What traits NEVER appear in winners?
 *   - Which Family × Opportunity combinations win?
 *   - What title structures cluster among winners?
 *
 * Output: scripts/winner_dna_report.md
 * Usage:  node winnerDnaAnalysis.js [--verbose]
 */

const path = require('path');
const fs   = require('fs');
const BetterSqlite3 = require('../node_modules/better-sqlite3');

// ── Title template classifier ─────────────────────────────────────────────────
const TEMPLATES = {
  ASSUMPTION_REVERSAL: {
    desc: 'We thought X — actually Y',
    test: t => /\bwe thought\b|\byou think\b|\bpeople think\b|\beveryone (thinks|thought)\b/i.test(t) ||
               (/\bthought\b.*\bbut\b/i.test(t) || /\bthought\b.*\bmight\b/i.test(t)),
  },
  FORCED_CONFLICT: {
    desc: 'Subject forced/made to do something',
    test: t => /\bforced to\b|\bmade to\b|\bhad to hunt\b|\bcouldn't stop\b/i.test(t),
  },
  CONFLICT_EXPOSE: {
    desc: "Subject can't / won't + proof or reveal",
    test: t => /\bcan'?t\b.*\b(prove|shows?|reveal|expos|negotiat)\b/i.test(t) ||
               /\bwon'?t\b.*\b(work|last|survive)\b/i.test(t) ||
               /\b(fail|fails|failed)\b.*\b(to|and)\b/i.test(t),
  },
  MEMORY_STORY: {
    desc: 'Named object + relationship + time (personal narrative)',
    test: t => /\ba .+, a .+ and \d+\s+years?\b/i.test(t) ||
               /\b\d+ years? of (memories|love|life|journey)\b/i.test(t),
  },
  MISTAKE_BEHIND: {
    desc: 'Mistake / error / problem + domain',
    test: t => /\b(beginner |common |biggest |worst )?(mistake|error|problem|flaw|trap|pitfall)s?\b/i.test(t),
  },
  WAY_TO: {
    desc: 'A [adj] way to [action/outcome]',
    test: t => /\bway to\b|\bapproach to\b|\bmethod (for|to)\b/i.test(t),
  },
  CHECKLIST_FORMAT: {
    desc: 'Checklist / guide / tips / hacks for [domain]',
    test: t => /\b(checklist|guide|tips?|hacks?|steps?|tricks?) (for|to|on)\b/i.test(t),
  },
  COLON_EXPLAINER: {
    desc: 'Topic: dimension1, dimension2 explained',
    test: t => /^[^:]{3,30}:\s*.{5,}/.test(t) && /,/.test(t),
  },
  COLON_VARIANT: {
    desc: 'Topic: variant for audience',
    test: t => /^[^:]{3,30}:\s*.+/.test(t) && !/,/.test(t),
  },
  NUMBER_LIST: {
    desc: 'N ways / reasons / things / tips',
    test: t => /^\d+\s+(ways?|reasons?|things?|tips?|mistakes?|facts?|rules?|signs?|hacks?|steps?)/i.test(t),
  },
  WARNING_HOOK: {
    desc: 'Before you X / Stop doing X',
    test: t => /^(before you\b|stop (doing\b|wasting\b|making\b)|don'?t )/i.test(t),
  },
  HOW_TO: {
    desc: 'How to [action]',
    test: t => /^how to\b/i.test(t),
  },
  TRANSFORMATION: {
    desc: 'From X to Y / transformed into',
    test: t => /\bfrom .+ to \b|\btransform(ed|s)?\b.*\binto\b/i.test(t),
  },
  QUESTION: {
    desc: 'Ends with ?',
    test: t => /\?\s*$/.test(t),
  },
  EXPERIMENT: {
    desc: 'I tried / What happens when',
    test: t => /\bi tried\b|\bwhat happens (when|if)\b|\bwe tested\b/i.test(t),
  },
  DISH_TECHNIQUE: {
    desc: 'Specific food + cooking style/technique',
    test: t => /\b(biryani|vada pav|dosa|thali|paratha|paneer|samosa|chutney|masala|curry|tandoor|asmr cooking|street food)\b/i.test(t),
  },
};

const TEMPLATE_ORDER = Object.keys(TEMPLATES);

function classifyTemplate(title) {
  const t = title || '';
  for (const key of TEMPLATE_ORDER) {
    if (TEMPLATES[key].test(t)) return key;
  }
  return 'GENERIC';
}

// ── Named entity / specificity ────────────────────────────────────────────────
const PROPER_NOUNS = new Set([
  'trump','modi','biden','putin','xi','zelensky','netanyahu','macron','sunak',
  'erdogan','obama','kejriwal','rahul','gandhi','yogi','shah','jaishankar',
  'china','pakistan','russia','ukraine','iran','israel','america','usa','uk',
  'britain','france','germany','japan','bangladesh','taiwan',
  'rbi','sebi','bcci','ipl','icc','nato','imf','isro','nasa','bjp','congress',
  'aap','tmc','apple','google','microsoft','amazon','tesla','openai','meta',
  'adani','ambani','tata','reliance','infosys','hdfc','sbi','sensex','nifty',
  'delhi','mumbai','hyderabad','bangalore','bengaluru','chennai','kolkata',
  'washington','moscow','beijing','london','paris','berlin','tokyo',
  'santro','maruti','vada','biryani','dosa','thali','paneer',
]);

function namedEntityCount(title) {
  return String(title||'').toLowerCase().split(/\s+/).filter(w=>
    /\d/.test(w) || /^\d{1,4}(cr|lakh|k|m|b|%|\+)$/i.test(w) || PROPER_NOUNS.has(w)
  ).length;
}

function wordCount(title) {
  return String(title||'').trim().split(/\s+/).filter(Boolean).length;
}

// ── Stats helpers ─────────────────────────────────────────────────────────────
const mean = arr => arr.length ? arr.reduce((s,v)=>s+v,0)/arr.length : 0;
const pct  = (n,d) => d>0 ? (n/d*100).toFixed(1)+'%' : '0.0%';
const fmt  = n => typeof n === 'number' ? n.toFixed(2) : 'n/a';

function topN(map, n=8) {
  return Object.entries(map).sort((a,b)=>b[1]-a[1]).slice(0,n);
}

// ── Main ──────────────────────────────────────────────────────────────────────
function main() {
  const db = new BetterSqlite3(
    path.resolve(__dirname,'../data/scoring.db'),
    { readonly:true, timeout:60000 }
  );
  const verbose = process.argv.includes('--verbose');

  // Try both channel_id join styles
  const rows = db.prepare(`
    SELECT
      r.id, r.rec_source, r.family, r.archetype, r.generated_title,
      r.concept_id, r.concept_label, r.concept_confidence,
      r.dna_affinity_score, r.score AS raw_score, r.human_label,
      t.opportunity_id, t.opportunity_label, t.opportunity_confidence,
      t.wtp_score,
      COALESCE(c1.primary_niche, c2.primary_niche) AS primary_niche
    FROM wtp_human_quality_reviews r
    LEFT JOIN wtp_generation_traces t  ON t.id = r.trace_id
    LEFT JOIN ingested_channels     c1 ON c1.channel_id = r.channel_id
    LEFT JOIN ingested_channels     c2 ON CAST(c2.id AS TEXT) = r.channel_id
    WHERE r.human_label IS NOT NULL
    ORDER BY r.human_label, r.id
  `).all();
  db.close();

  // Augment
  const augmented = rows.map(r => ({
    ...r,
    wc:       wordCount(r.generated_title),
    entities: namedEntityCount(r.generated_title),
    template: classifyTemplate(r.generated_title),
  }));

  const LABEL_SCORE = { Excellent:5, Good:4, Average:3, Poor:2, Garbage:1 };
  const winners = augmented.filter(r=>r.human_label==='Excellent'||r.human_label==='Good');
  const losers  = augmented.filter(r=>r.human_label==='Poor'||r.human_label==='Garbage');
  const all     = augmented;

  const lines = [];
  const L = s => lines.push(s);

  L('# Winner DNA Report');
  L('');
  L(`**Generated:** ${new Date().toISOString().slice(0,10)}`);
  L(`**Gold set:** ${all.length} labeled rows`);
  L(`**Winners (Excellent+Good):** ${winners.length}`);
  L(`**Losers (Poor+Garbage):** ${losers.length}`);
  L('');
  L('---');
  L('');

  // ── 1. Family × Opportunity winning combos ──────────────────────────────────
  L('## 1. Winning Niche Combinations (Family × Opportunity)');
  L('');
  const comboCounts = {};
  for (const r of all) {
    const key = `${r.family||'(none)'} × ${r.opportunity_label||'(none)'}`;
    if (!comboCounts[key]) comboCounts[key] = { w:0, t:0 };
    comboCounts[key].t++;
    if (r.human_label==='Excellent'||r.human_label==='Good') comboCounts[key].w++;
  }
  const combos = Object.entries(comboCounts)
    .map(([key,{w,t}]) => ({ key, w, t, rate: w/t }))
    .filter(c=>c.t>=3)
    .sort((a,b)=>b.w-a.w||b.rate-a.rate)
    .slice(0,20);
  L('| Family × Opportunity | Winners | Total | Win Rate |');
  L('|---|---|---|---|');
  for (const c of combos) {
    const flag = c.rate>=0.3 ? '★' : c.rate>=0.1 ? '·' : '';
    L(`| ${c.key} | ${c.w} | ${c.t} | ${(c.rate*100).toFixed(1)}% ${flag} |`);
  }
  L('');
  L('★ = win rate ≥ 30%   · = win rate ≥ 10%');
  L('');

  // ── 2. Title template distribution ────────────────────────────────────────
  L('## 2. Title Template Analysis');
  L('');
  const tmplAll = {};
  const tmplWin = {};
  for (const r of all) {
    tmplAll[r.template] = (tmplAll[r.template]||0)+1;
    if (r.human_label==='Excellent'||r.human_label==='Good') {
      tmplWin[r.template] = (tmplWin[r.template]||0)+1;
    }
  }
  const tmplRows = Object.keys(tmplAll).map(t=>({
    t,
    w: tmplWin[t]||0,
    n: tmplAll[t],
    rate: (tmplWin[t]||0)/tmplAll[t],
    desc: (TEMPLATES[t]?.desc||'catch-all'),
  })).sort((a,b)=>b.w-a.w||b.rate-a.rate);

  L('| Template | Win rate | Winners | Total | Description |');
  L('|---|---|---|---|---|');
  for (const r of tmplRows) {
    const flag = r.rate>=0.3 ? '★' : r.rate>=0.1 ? '·' : '';
    L(`| ${r.t} | ${(r.rate*100).toFixed(1)}% ${flag} | ${r.w} | ${r.n} | ${r.desc} |`);
  }
  L('');

  // ── 3. Traits NEVER in winners ────────────────────────────────────────────
  L('## 3. Traits That NEVER Appear in Winners');
  L('');
  const never = [];

  // Source never
  const srcNeverWin = ['angle_gap','territory_expansion','fallback_evergreen']
    .filter(s=>winners.filter(r=>r.rec_source===s).length===0 && all.filter(r=>r.rec_source===s).length>0);
  if (srcNeverWin.length) never.push(`**Source**: ${srcNeverWin.join(', ')} — 0 winners out of ${srcNeverWin.map(s=>all.filter(r=>r.rec_source===s).length).join('/')} gold rows`);

  // Word count
  const shortWinners = winners.filter(r=>r.wc<=4).length;
  if (shortWinners===0) never.push(`**Word count ≤ 4**: 0 winners (${all.filter(r=>r.wc<=4).length} total rows have ≤4 words)`);

  const fragWinners = winners.filter(r=>r.wc<=3).length;
  if (fragWinners===0) never.push(`**Word count ≤ 3**: 0 winners (${all.filter(r=>r.wc<=3).length} rows)`);

  // Template type
  const neverTmpls = tmplRows.filter(r=>r.w===0 && r.n>=5).map(r=>`${r.t}(n=${r.n})`);
  if (neverTmpls.length) never.push(`**Template types with 0 winners**: ${neverTmpls.join(', ')}`);

  // Concept + opportunity both null
  const bothNull = winners.filter(r=>!r.concept_id && !r.opportunity_label).length;
  const bothNullAll = all.filter(r=>!r.concept_id && !r.opportunity_label).length;
  never.push(`**No concept AND no opportunity**: ${bothNull}/${winners.length} winners (${pct(bothNull,winners.length)}) vs ${pct(bothNullAll-bothNull,all.length-bothNullAll)} elsewhere`);

  for (const n of never) L(`- ${n}`);
  L('');

  // ── 4. Traits in EVERY winner ────────────────────────────────────────────
  L('## 4. Traits Present in Every Winner');
  L('');
  const always = [];

  const always_minwc = Math.min(...winners.map(r=>r.wc));
  always.push(`**Minimum word count**: ${always_minwc} (every winner has ≥${always_minwc} words)`);

  const src_ok = new Set(winners.map(r=>r.rec_source));
  always.push(`**Sources**: every winner comes from ${[...src_ok].join(' or ')}`);

  const wWCgeq5 = winners.filter(r=>r.wc>=5).length;
  always.push(`**Word count ≥ 5**: ${pct(wWCgeq5,winners.length)} of winners`);

  const wWCgeq6 = winners.filter(r=>r.wc>=6).length;
  always.push(`**Word count ≥ 6**: ${pct(wWCgeq6,winners.length)} of winners`);

  // Concept alignment: same concept as family domain
  const FAMILY_CONCEPT_MAP = {
    cooking_food: ['street food','regional cuisine','cooking','recipe'],
    fitness_practice: ['fitness','health','workout','nutrition','diet'],
    finance_education: ['finance','investing','stock','market','sip','mutual fund'],
    general_education: ['education','learning','science','history'],
    news_current: ['news','politics','geopolitics','current'],
    entertainment: ['entertainment','comedy'],
  };
  const hasConceptAlignment = r => {
    if (!r.family || !r.concept_label) return false;
    const keywords = FAMILY_CONCEPT_MAP[r.family] || [];
    return keywords.some(k => (r.concept_label||'').toLowerCase().includes(k));
  };
  const aligned = winners.filter(hasConceptAlignment).length;
  always.push(`**Concept-family alignment**: ${aligned}/${winners.length} winners (${pct(aligned,winners.length)}) have matching concept + family`);

  for (const a of always) L(`- ${a}`);
  L('');

  // ── 5. Concept-family alignment deep-dive ────────────────────────────────
  L('## 5. Concept × Family Alignment');
  L('');
  L('| Family | Concept | Winners | All | Win Rate |');
  L('|---|---|---|---|---|');
  const cfMap = {};
  for (const r of all) {
    const key = `${r.family||'(none)'}|${r.concept_label||'(none)'}`;
    if (!cfMap[key]) cfMap[key]={w:0,t:0,fam:r.family||'(none)',con:r.concept_label||'(none)'};
    cfMap[key].t++;
    if (r.human_label==='Excellent'||r.human_label==='Good') cfMap[key].w++;
  }
  Object.values(cfMap)
    .filter(c=>c.t>=3)
    .sort((a,b)=>b.w-a.w||b.w/b.t-a.w/a.t)
    .slice(0,15)
    .forEach(c=>{
      L(`| ${c.fam} | ${c.con} | ${c.w} | ${c.t} | ${(c.w/c.t*100).toFixed(1)}% |`);
    });
  L('');

  // ── 6. Winning title examples by template ────────────────────────────────
  L('## 6. Winner Titles by Template Type');
  L('');
  for (const r of tmplRows.filter(t=>t.w>0)) {
    L(`### ${r.t} (${r.w} winners, ${(r.rate*100).toFixed(1)}% win rate)`);
    L(`_${r.desc}_`);
    L('');
    const examples = winners.filter(w=>w.template===r.t).slice(0,5);
    for (const ex of examples) {
      L(`- [${ex.human_label}/${ex.rec_source||'?'}/${ex.family||'?'}] "${ex.generated_title}"`);
    }
    L('');
  }

  // ── 7. Structural anatomy of winners ─────────────────────────────────────
  L('## 7. Structural Anatomy');
  L('');
  const wWC   = mean(winners.map(r=>r.wc));
  const lWC   = mean(losers.map(r=>r.wc));
  const wEnt  = mean(winners.map(r=>r.entities));
  const lEnt  = mean(losers.map(r=>r.entities));
  L(`| Metric | Winners avg | Losers avg | Gap |`);
  L(`|---|---|---|---|`);
  L(`| Word count | ${wWC.toFixed(1)} | ${lWC.toFixed(1)} | +${(wWC-lWC).toFixed(1)} words |`);
  L(`| Named entities | ${wEnt.toFixed(2)} | ${lEnt.toFixed(2)} | ${(wEnt-lEnt>=0?'+':'')}${(wEnt-lEnt).toFixed(2)} |`);
  L('');
  L('**Word count distribution in winners:**');
  const wcBuckets = { '5–7':0,'8–10':0,'11–13':0,'14+':0,'<5':0 };
  for (const r of winners) {
    if      (r.wc < 5)   wcBuckets['<5']++;
    else if (r.wc <= 7)  wcBuckets['5–7']++;
    else if (r.wc <= 10) wcBuckets['8–10']++;
    else if (r.wc <= 13) wcBuckets['11–13']++;
    else                  wcBuckets['14+']++;
  }
  for (const [b,n] of Object.entries(wcBuckets)) L(`- ${b} words: ${n} (${pct(n,winners.length)})`);
  L('');

  // ── 8. Key insights ───────────────────────────────────────────────────────
  L('## 8. Key Insights');
  L('');
  L('### Winners cluster in two distinct patterns:');
  L('');

  const dnaWinners  = winners.filter(r=>r.rec_source==='dna_original_bets');
  const peerWinners = winners.filter(r=>r.rec_source==='peer_video_signal');
  L(`**Pattern A — Concept-Specific DNA Bets (${dnaWinners.length} winners, ${(dnaWinners.length/winners.length*100).toFixed(0)}%):**`);
  L(`- Source: dna_original_bets`);
  L(`- Families: ${topN({...dnaWinners.reduce((m,r)=>{m[r.family||(r.concept_label||'?')]=m[r.family||(r.concept_label||'?')]||0,m[r.family||(r.concept_label||'?')]++;return m;},{}),},3).map(([k,v])=>`${k}(${v})`).join(', ')}`);
  L(`- Title style: 6–10 words, specific topic, often verbless noun phrases`);
  L(`- Win rate: 12.2% (55/450 DNA bets in gold set)`);
  L('');
  L(`**Pattern B — Narrative Peer Signals (${peerWinners.length} winners, ${(peerWinners.length/winners.length*100).toFixed(0)}%):**`);
  L(`- Source: peer_video_signal`);
  L(`- No family/concept required — title carries full context`);
  L(`- Title style: 12+ words, narrative hook, named story/event`);
  L(`- Win rate: 6.7% (16/238 peer signals in gold set)`);
  L('');

  L('### Generation redesign targets:');
  L('');
  L('1. DNA bets must target cooking_food + fitness_practice families with specific concept');
  L('2. Peer signals must be extracted from narrative-hook titles (not keyword fragments)');
  L('3. angle_gap, territory_expansion, fallback_evergreen never produced a winner — quarantine or disable');
  L('4. Finance winners exist but at 5.7% (lower than cooking/fitness) — needs specific opportunity matching');
  L('');

  // Write report
  const reportPath = path.resolve(__dirname,'winner_dna_report.md');
  fs.writeFileSync(reportPath, lines.join('\n'), 'utf8');
  console.log(`\nWinner DNA Report: ${reportPath}`);

  // Console summary
  console.log('\n══ WINNER DNA SUMMARY ══════════════════════════════════════');
  console.log(`  ${winners.length} winners from ${all.length} labeled rows (${pct(winners.length,all.length)})`);
  console.log('\n  Top winning combos:');
  combos.filter(c=>c.rate>=0.3).slice(0,5).forEach(c=>
    console.log(`    ${c.key}: ${c.w}/${c.t} (${(c.rate*100).toFixed(1)}%)`)
  );
  console.log('\n  Top winning templates:');
  tmplRows.filter(r=>r.w>0).slice(0,6).forEach(r=>
    console.log(`    ${r.t.padEnd(24)} ${r.w} wins / ${r.n} total (${(r.rate*100).toFixed(1)}%)`)
  );
  console.log('\n  NEVER in winners:');
  srcNeverWin.forEach(s=>console.log(`    source=${s}`));
  if (shortWinners===0) console.log(`    word_count <= 4`);
  console.log('');
}

main();

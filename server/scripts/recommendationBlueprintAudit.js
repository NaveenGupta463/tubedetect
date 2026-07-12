'use strict';

/**
 * Recommendation Blueprint Audit — Phase 2
 *
 * For every labeled recommendation, scores 6 structural blueprint components:
 *   1. specific_action   — clear action the viewer can take or that happens
 *   2. specific_object   — concrete named thing at the center
 *   3. specific_outcome  — what the viewer gains / what results
 *   4. creator_relevance — concept matches channel's known domain
 *   5. audience_benefit  — explicitly states viewer benefit
 *   6. novelty_signal    — specific opportunity angle, not generic topic
 *
 * Then measures correlation of each component with human quality labels.
 *
 * Usage: node recommendationBlueprintAudit.js [--verbose]
 */

const path = require('path');
const fs   = require('fs');
const BetterSqlite3 = require('../node_modules/better-sqlite3');

// ── Blueprint component detectors ─────────────────────────────────────────────

// 1. specific_action — has a clear action described
const ACTION_VERBS = new Set([
  'make','makes','made','making','cook','cooks','cooked','cooking','bake','baked','baking',
  'build','builds','built','building','create','creates','created','creating',
  'learn','learns','learned','learning','understand','master','master','start','stop',
  'improve','improves','improved','improving','lose','loses','losing','gain','gains','gaining',
  'save','saves','saving','earn','earns','earning','invest','invests','investing',
  'avoid','avoids','avoiding','fix','fixes','fixed','fixing',
  'try','tries','tried','trying','test','tests','tested','testing',
  'explain','explains','explained','revealing','reveals','revealed',
  'prove','proves','proved','expose','exposes','exposed',
  'force','forces','forced','change','changes','changed','changing',
  'collapse','crash','crashes','crashed','rise','rises','fall','falls',
  'negotiate','negotiates','negotiate','attack','ban','arrest',
  'transform','transforms','transformed','survive','survives',
  'eat','eats','eaten','eating','fry','fries','fried','grill','grills','grilled',
  'serve','served','taste','tastes','exercise','train','trains','trained',
  'workout','workouts','buy','buys','sell','sells','sold',
]);
const IMPLIED_ACTION_RE = /\b(way to|guide to|tips? (for|on)|checklist for|steps? to|approach to|how to|method (for|to))\b/i;
const COPULA_RE         = /\b(is|are|was|were|'s|'re|n't)\b/i;

function hasSpecificAction(title) {
  const t = String(title||'').toLowerCase();
  if (IMPLIED_ACTION_RE.test(t)) return true;
  return t.split(/\s+/).some(w=>ACTION_VERBS.has(w));
}

// 2. specific_object — named thing at center (dish, product, person, concept, tool)
const FOOD_NOUNS = new Set([
  'biryani','vada','pav','dosa','thali','paratha','paneer','samosa','chutney',
  'masala','curry','tandoor','chapati','roti','idli','upma','poha','khichdi',
  'halwa','gulab','jamun','jalebi','lassi','chai','coffee','pizza','burger',
]);
const FITNESS_NOUNS = new Set([
  'protein','carbs','fat','calories','hiit','cardio','weights','squats',
  'pushups','pullups','deadlift','bench','creatine','supplements','yoga',
  'pilates','meditation','keto','intermittent','fasting','macros',
]);
const FINANCE_NOUNS = new Set([
  'sip','nifty','sensex','mutual','fund','stock','bonds','ipo','fii',
  'inflation','gdp','repo','rbi','sebi','budget','portfolio','demat','etf',
]);
const NAMED_ENTITIES = new Set([
  'trump','modi','biden','putin','xi','zelensky','netanyahu','macron',
  'china','pakistan','russia','ukraine','iran','israel','america','usa',
  'delhi','mumbai','hyderabad','bangalore','chennai','kolkata','london',
  'apple','google','microsoft','amazon','tesla','openai','adani','tata',
  'santro','maruti','honda','toyota','iphone','samsung',
]);

function hasSpecificObject(title) {
  const t = String(title||'').toLowerCase();
  const words = t.split(/\s+/);
  // Named entity → highly specific
  if (words.some(w=>NAMED_ENTITIES.has(w))) return true;
  // Domain-specific nouns
  if (words.some(w=>FOOD_NOUNS.has(w)||FITNESS_NOUNS.has(w)||FINANCE_NOUNS.has(w))) return true;
  // Number in title → specific quantity → specific thing
  if (/\d/.test(t)) return true;
  return false;
}

// 3. specific_outcome — what happens / what viewer gets
const OUTCOME_RE = /\b(explained|understand|understand|results?|proof|improve|improved|gain|lose|save|earn|avoid|without|at home|in \d+ (days?|weeks?|months?)|for beginners?|for busy|quick(ly)?|simple|simply|step by step|checklist|guide)\b/i;
const CONTRAST_RE = /\b(vs\.?|versus|compared|comparison|not .+ but|instead of)\b/i;
const REVEAL_RE   = /\b(secret|hidden|what nobody|truth about|real reason|why nobody|they don't want)\b/i;

function hasSpecificOutcome(title) {
  return OUTCOME_RE.test(title) || CONTRAST_RE.test(title) || REVEAL_RE.test(title);
}

// 4. creator_relevance — concept is assigned and non-null
// Proxy: concept_id present = the recommendation was matched to a creator with this domain
function hasCreatorRelevance(row) {
  return !!(row.concept_id && row.concept_label && row.concept_label !== '(none)');
}

// 5. audience_benefit — states benefit for the viewer
const AUDIENCE_RE = /\b(for (you|beginner|busy|starter|anyone|everyone|family|kids?|student|professional|investor|creator|fitness|diet|weight)|your (guide|checklist|plan|strategy|routine|way|path)|easy (way|guide|recipe|approach))\b/i;
const BENEFIT_RE  = /\b(save time|save money|grow faster|lose weight|build muscle|earn more|get fit|stay healthy|understand better|avoid mistakes?)\b/i;

function hasAudienceBenefit(title) {
  return AUDIENCE_RE.test(title) || BENEFIT_RE.test(title);
}

// 6. novelty_signal — specific enough to have a validated opportunity
function hasNoveltySignal(row) {
  if (!row.opportunity_label || row.opportunity_label === '(none)') return false;
  if (row.opportunity_confidence == null) return false;
  return row.opportunity_confidence >= 0.55;
}

// ── Blueprint scoring ─────────────────────────────────────────────────────────
function scoreBlueprint(row) {
  const title = row.generated_title || '';
  const components = {
    specific_action:    hasSpecificAction(title)   ? 1 : 0,
    specific_object:    hasSpecificObject(title)   ? 1 : 0,
    specific_outcome:   hasSpecificOutcome(title)  ? 1 : 0,
    creator_relevance:  hasCreatorRelevance(row)   ? 1 : 0,
    audience_benefit:   hasAudienceBenefit(title)  ? 1 : 0,
    novelty_signal:     hasNoveltySignal(row)      ? 1 : 0,
  };
  const total = Object.values(components).reduce((s,v)=>s+v,0);
  return { ...components, total, score: Math.round(total/6*100) };
}

// ── Stats ─────────────────────────────────────────────────────────────────────
const LABEL_SCORE = { Excellent:5, Good:4, Average:3, Poor:2, Garbage:1 };
const ORDER       = ['Excellent','Good','Average','Poor','Garbage'];
const COMPONENTS  = ['specific_action','specific_object','specific_outcome','creator_relevance','audience_benefit','novelty_signal'];

function pearsonR(xs, ys) {
  const n  = xs.length;
  const xm = xs.reduce((s,v)=>s+v,0)/n;
  const ym = ys.reduce((s,v)=>s+v,0)/n;
  const num  = xs.reduce((s,v,i)=>s+(v-xm)*(ys[i]-ym),0);
  const denX = Math.sqrt(xs.reduce((s,v)=>s+(v-xm)**2,0));
  const denY = Math.sqrt(ys.reduce((s,v)=>s+(v-ym)**2,0));
  return (denX&&denY) ? num/(denX*denY) : 0;
}

function main() {
  const db = new BetterSqlite3(
    path.resolve(__dirname,'../data/scoring.db'),
    { readonly:true, timeout:60000 }
  );
  const verbose = process.argv.includes('--verbose');

  const rows = db.prepare(`
    SELECT r.id, r.rec_source, r.family, r.generated_title,
           r.concept_id, r.concept_label, r.concept_confidence,
           r.human_label,
           t.opportunity_id, t.opportunity_label, t.opportunity_confidence,
           t.wtp_score
    FROM   wtp_human_quality_reviews r
    LEFT JOIN wtp_generation_traces t ON t.id = r.trace_id
    WHERE  r.human_label IS NOT NULL
    ORDER  BY r.human_label, r.id
  `).all();
  db.close();

  const scored = rows.map(r=>({ ...r, bp: scoreBlueprint(r), qs: LABEL_SCORE[r.human_label]||0 }));
  const winners = scored.filter(r=>r.human_label==='Excellent'||r.human_label==='Good');
  const losers  = scored.filter(r=>r.human_label==='Poor'||r.human_label==='Garbage');
  const n       = scored.length;

  console.log('\n══════════════════════════════════════════════════════════════');
  console.log('  Recommendation Blueprint Audit');
  console.log(`  ${n} labeled rows — Winners: ${winners.length}  Losers: ${losers.length}`);
  console.log('══════════════════════════════════════════════════════════════\n');

  // ── Section 1: Component avg by label ────────────────────────────────────
  console.log('── 1. COMPONENT AVERAGE BY LABEL ─────────────────────────────');
  const byLabel = {};
  for (const lbl of ORDER) {
    byLabel[lbl] = scored.filter(r=>r.human_label===lbl);
  }
  const header = 'Component             ' + ORDER.map(l=>l.slice(0,4).padStart(7)).join('');
  console.log('  ' + header);
  for (const comp of [...COMPONENTS,'total']) {
    const vals = ORDER.map(lbl=>{
      const g = byLabel[lbl];
      if (!g||!g.length) return '   n/a';
      const avg = g.reduce((s,r)=>s+(comp==='total'?r.bp.total:r.bp[comp]),0)/g.length;
      return (avg*100).toFixed(0).padStart(6)+'%';
    });
    console.log(`  ${comp.padEnd(22)}${vals.join('')}`);
  }
  console.log('');

  // ── Section 2: Pearson r per component ───────────────────────────────────
  console.log('── 2. PEARSON r (component vs human quality score) ───────────');
  const qs = scored.map(r=>r.qs);
  const allComponents = [...COMPONENTS,'total'];
  const rValues = allComponents.map(comp=>{
    const xs = scored.map(r=>comp==='total'?r.bp.total:r.bp[comp]);
    return { comp, r: pearsonR(xs, qs) };
  }).sort((a,b)=>b.r-a.r);
  for (const {comp,r} of rValues) {
    const bar = r>0 ? '▓'.repeat(Math.round(r*20)) : '░'.repeat(Math.round(-r*20));
    const dir = r>0.15 ? '↑ winner signal' : r<-0.15 ? '↓ loser signal' : '~ neutral';
    console.log(`  ${comp.padEnd(22)} r=${(r>=0?'+':'')+r.toFixed(3)}  ${bar}  ${dir}`);
  }
  console.log('');

  // ── Section 3: Winner vs Loser per component ─────────────────────────────
  console.log('── 3. WINNER vs LOSER DELTA PER COMPONENT ────────────────────');
  console.log('  Component             W%     L%    Delta');
  for (const comp of COMPONENTS) {
    const wPct = winners.filter(r=>r.bp[comp]===1).length / winners.length * 100;
    const lPct = losers.filter(r=>r.bp[comp]===1).length  / losers.length  * 100;
    const d    = wPct - lPct;
    const dir  = d>10 ? '↑' : d<-10 ? '↓' : '~';
    console.log(`  ${comp.padEnd(22)} ${wPct.toFixed(0).padStart(4)}%  ${lPct.toFixed(0).padStart(4)}%  ${(d>=0?'+':'')+d.toFixed(0).padStart(4)}pp  ${dir}`);
  }
  console.log('');

  // ── Section 4: Blueprint total distribution ───────────────────────────────
  console.log('── 4. BLUEPRINT TOTAL DISTRIBUTION (0–6) ─────────────────────');
  console.log('  Total  ' + ORDER.map(l=>l.slice(0,4).padStart(7)).join(''));
  for (let tot=0; tot<=6; tot++) {
    const vals = ORDER.map(lbl=>{
      const g = byLabel[lbl];
      if (!g||!g.length) return '   n/a';
      const n = g.filter(r=>r.bp.total===tot).length;
      return (n/g.length*100).toFixed(0).padStart(6)+'%';
    });
    console.log(`  ${String(tot).padStart(5)}  ${vals.join('')}`);
  }
  console.log('');

  // ── Section 5: Component co-occurrence in winners ─────────────────────────
  console.log('── 5. COMPONENT CO-OCCURRENCE IN WINNERS ─────────────────────');
  const coOccur = {};
  for (const c1 of COMPONENTS) {
    for (const c2 of COMPONENTS) {
      if (c1>=c2) continue;
      const key = `${c1}+${c2}`;
      const both = winners.filter(r=>r.bp[c1]===1&&r.bp[c2]===1).length;
      const rat  = both/winners.length;
      if (rat>=0.2) coOccur[key] = rat;
    }
  }
  Object.entries(coOccur).sort((a,b)=>b[1]-a[1]).slice(0,10).forEach(([key,rat])=>{
    console.log(`  ${key}: ${(rat*100).toFixed(0)}% of winners have both`);
  });
  console.log('');

  // ── Section 6: Missing component analysis ────────────────────────────────
  console.log('── 6. WHAT WINNERS LACK (missing component analysis) ─────────');
  for (const comp of COMPONENTS) {
    const missing = winners.filter(r=>r.bp[comp]===0);
    if (missing.length===0) {
      console.log(`  ${comp}: present in ALL ${winners.length} winners`);
    } else {
      console.log(`  ${comp}: missing in ${missing.length}/${winners.length} winners (${(missing.length/winners.length*100).toFixed(0)}%)`);
      if (verbose) {
        missing.slice(0,3).forEach(r=>console.log(`    [${r.human_label}] "${r.generated_title}"`));
      }
    }
  }
  console.log('');

  // ── Section 7: Highest-scoring losers ────────────────────────────────────
  const topScoreLosers = losers.filter(r=>r.bp.total>=4).sort((a,b)=>b.bp.total-a.bp.total);
  if (topScoreLosers.length) {
    console.log('── 7. HIGH-BLUEPRINT LOSERS (total ≥ 4) ─────────────────────');
    topScoreLosers.slice(0,8).forEach(r=>{
      const comps = COMPONENTS.filter(c=>r.bp[c]===1).join(',');
      console.log(`  [${r.human_label}] total=${r.bp.total} (${comps})`);
      console.log(`    "${r.generated_title}"`);
    });
    console.log('');
  }

  // ── Section 8: Blueprint total Pearson r ──────────────────────────────────
  const bpR = rValues.find(x=>x.comp==='total')?.r || 0;
  console.log('── 8. SUMMARY ────────────────────────────────────────────────');
  console.log(`  Blueprint total score (0–6) Pearson r: ${(bpR>=0?'+':'')+bpR.toFixed(3)}`);
  console.log(`  Best single predictor: ${rValues.filter(x=>x.comp!=='total')[0]?.comp} (r=${(rValues[0]?.r>=0?'+':'')+rValues[0]?.r.toFixed(3)})`);
  const bestThree = rValues.filter(x=>x.comp!=='total').slice(0,3).map(x=>x.comp);
  console.log(`  Top 3 components: ${bestThree.join(', ')}`);
  const combinedR = pearsonR(
    scored.map(r=>r.bp.specific_action+r.bp.specific_object+r.bp.specific_outcome),
    qs
  );
  console.log(`  Combined (action+object+outcome) r: ${(combinedR>=0?'+':'')+combinedR.toFixed(3)}`);
  console.log('');
  console.log('══════════════════════════════════════════════════════════════\n');

  if (verbose) {
    console.log('── VERBOSE: WINNER BLUEPRINT DETAILS ────────────────────────');
    for (const r of winners.slice(0,20)) {
      const comps = COMPONENTS.filter(c=>r.bp[c]===1).join(',');
      console.log(`  [${r.human_label}] total=${r.bp.total} (${comps||'none'})`);
      console.log(`    "${r.generated_title}"`);
    }
  }
}

main();

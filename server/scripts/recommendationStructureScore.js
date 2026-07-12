'use strict';

/**
 * recommendationStructureScore(title) → { score: 0–100, signals: string[] }
 *
 * V2 — Calibrated against 1023 human-labeled gold rows.
 *
 * V1 issues fixed:
 *   1. DNA concept titles ("A no-equipment way to improve fat loss") underscored
 *      → Added implied_action detection for WAY_TO / CHECKLIST / MISTAKE templates
 *   2. Garbled generic hooks ("Before you trust stock hits upper, check this") overscored
 *      → Added generic_hook_penalty for "check this" / "see this" empty-body endings
 *   3. Single entity on short title (≤5 words) was neutral-to-positive, now penalised
 *      → Entity bonus only when wc ≥ 6
 *   4. Generic adjectives ("best","easy","simple") counted as claim words — removed
 *
 * Reward components:
 *   +explicit_verb      action verb present
 *   +implied_action     way to / checklist for / guide to / mistake behind / tips for
 *   +hook_pattern       narrative hooks (forced, can't, we thought, etc.)
 *   +assumption_reversal "we thought X" + contrast word
 *   +dish_technique     specific food + cooking style
 *   +mistake_template   "mistake behind" / "beginner mistake" / "error in"
 *   +colon_structure    "topic: explanation" structure
 *   +genuine_claim      truth / exposed / hidden / proof / myth
 *   +concrete_outcome   "explained" / "without X" / "at home" / "in N days"
 *   +named_entity_long  entity present AND wc ≥ 6
 *   +multi_angle        X, Y and Z structure
 *
 * Penalty components:
 *   −no_action          no verb AND no implied action
 *   −fragment           ≤ 3 words
 *   −keyword_dump       short + no action (pure noun pile)
 *   −generic_hook       "check this" / "see this" at end (empty-body hook)
 *   −search_suffix      language / episode / update at end
 *   −entity_on_short    entity present but wc ≤ 5
 *
 * Calibration (v2 target):
 *   Pearson r vs human labels ≥ +0.60
 *   Winner avg ≥ 45, Loser avg ≤ 15
 *
 * Usage:
 *   const { score, signals } = recommendationStructureScore("title here");
 *
 * Standalone audit:
 *   node recommendationStructureScore.js [--verbose]
 */

// ── Action verbs ──────────────────────────────────────────────────────────────
const ACTION_VERBS = new Set([
  // Explanation
  'explained','explains','explain','understand','understanding',
  'learn','learns','learning','know','knows','discover','discovers','discovered',
  'master','build','builds','built','make','makes','making','create','creates',
  'start','stop','try','tries','tried',
  // Conflict
  'prove','proves','proved','expose','exposes','exposed',
  'reveal','reveals','revealed','fail','fails','failed',
  'win','wins','won','lose','loses','lost','force','forces','forced',
  'change','changes','changed','break','breaks','broke','end','ends',
  'collapse','crash','crashes','crashed','rise','rises','fall','falls',
  'fight','attack','attacks','attacked','ban','bans','banned',
  'arrest','arrested','negotiate','negotiates','negotiate',
  'destroy','destroys','destroyed','fix','fixes','fixed','avoid','avoids',
  'impact','impacts','impacted','impacting','trust','trusts','check','checks',
  'hurt','hurts','cost','costs','hit','hits','beat','beats','beats',
  // Cooking / food
  'cook','cooks','cooked','cooking','bake','bakes','baked','baking',
  'fry','fries','fried','frying','grill','grills','grilled','eat','eats',
  'taste','tastes','serve','serves','served','making',
  // Fitness
  'exercise','exercises','train','trains','trained','workout',
  'gain','gains','gained','save','saves','saving','earn','earns','invest',
  'transform','transforms','transformed','survive','improves','improved',
]);

// ── Implied action patterns (verbless but action-complete) ────────────────────
const IMPLIED_ACTION_RE = /\b(way to|approach to|method (for|to)|guide (to|for)|tips? (for|on|to)|tricks? for|hacks? for|checklist (for|to)|steps? (to|for)|how to|routine (for|to)|plan (for|to))\b/i;

// ── Template detectors ────────────────────────────────────────────────────────
const MISTAKE_RE  = /\b((beginner |common |biggest |worst |the )?(mistake|error|problem|flaw|trap|pitfall)s?\b)/i;
const DISH_NOUNS  = /\b(biryani|vada pav|vada|pav|dosa|thali|paratha|paneer|samosa|chutney|masala|curry|tandoor|chapati|roti|idli|upma|poha|khichdi|halwa|gulab jamun|jalebi|lassi|pizza|burger|momos|kebab|tikka|asmr cooking|street food)\b/i;
const ASSUMPTION_RE = /\b(we thought|you think|people think|everyone thinks|they thought|i thought)\b/i;
const CONTRAST_RE   = /\b(but|actually|might|could|instead|turns out)\b/i;
const COLON_RE      = /^[^:]{4,35}:\s*.{4,}$/;

// ── Hook patterns (narrative triggers) ───────────────────────────────────────
const HOOK_PATTERNS = [
  /\bforced to\b/i,
  /\bmade to\b/i,
  /\bcan'?t\b/i,
  /\bwon'?t\b/i,
  /\bdidn'?t\b/i,
  /\b\d+\s+(reasons?|ways?|things?|mistakes?|tips?|hacks?|steps?|signs?|facts?|rules?)\b/i,
  /\b(before you|after you)\b/i,
  /\bwhat happens\b/i,
  /\bturns out\b/i,
  /\bhere'?s why\b/i,
  /\bstop (doing|wasting|making)\b/i,
  /\bthe .+ (that|who|which)\b/i,
  /\ba .+, a .+ and\b/i,
];

// Generic hook penalty patterns — hooks with no substantive body
const GENERIC_HOOK_RE = /\b(check this|see this|watch this|click (here|now))\s*\.?\s*$/i;
const EMPTY_BODY_HOOK_RE = /^before you (trust|check|do|watch)\b.{0,30}(check this|see this)$/i;

// ── Genuine claim words (not generic adjectives) ──────────────────────────────
const GENUINE_CLAIMS = new Set([
  'truth','lie','lies','myth','myths','secret','secrets','hidden','exposed',
  'proof','evidence','fake','scam','real','honest','actually','never','only',
  'nobody','nobody\'s','impossible','wrong','broken','failure','crisis',
]);
// Weak claim words (smaller bonus)
const WEAK_CLAIMS = new Set([
  'why','how','what','which','who','because','reason','reasons',
  'warning','mistake','mistakes','mistake','avoid','dangerous','serious',
]);

// ── Concrete outcome patterns ─────────────────────────────────────────────────
const OUTCOME_RE = /\b(explained( simply)?|step by step|at home|in \d+ (days?|weeks?|months?|minutes?)|without [a-z]+|for (beginners?|starters?|busy)|quick(ly)?( version)?|simple approach|no-equipment|on a budget)\b/i;

// ── Named entities ────────────────────────────────────────────────────────────
const PROPER_NOUNS = new Set([
  'trump','modi','biden','putin','xi','zelensky','netanyahu','macron','sunak','erdogan',
  'obama','kejriwal','rahul','gandhi','yogi','shah','china','pakistan','russia','ukraine',
  'iran','israel','america','usa','uk','britain','france','germany','japan','bangladesh',
  'taiwan','rbi','sebi','bcci','ipl','icc','nato','imf','isro','nasa','bjp','congress',
  'aap','tmc','apple','google','microsoft','amazon','tesla','openai','meta',
  'adani','ambani','tata','reliance','infosys','hdfc','sbi','sensex','nifty','sip','ipo',
  'delhi','mumbai','hyderabad','bangalore','bengaluru','chennai','kolkata',
  'washington','moscow','beijing','london','paris','berlin','tokyo','santro',
  'virat','kohli','sachin','dhoni','rohit','bumrah',
]);

function namedEntityCount(title) {
  return String(title||'').toLowerCase().split(/\s+/).filter(w=>
    /\d/.test(w) || /^\d{1,4}(cr|lakh|k|m|b|%|\+)$/i.test(w) || PROPER_NOUNS.has(w)
  ).length;
}

// ── Search suffix patterns ────────────────────────────────────────────────────
const SEARCH_SUFFIX_RE = /\b(2023|2024|2025|2026|today|now|hindi|telugu|tamil|kannada|unboxing|all episodes?|part \d+|episode \d+|season \d+|full video|full movie|trailer|highlights?|live)\s*$/i;

// ── Filler words ──────────────────────────────────────────────────────────────
const FILLER = new Set([
  'and','or','the','a','an','in','on','at','to','of','for','with','from','by',
  'is','are','was','were','will','be','been','being','do','does','did',
  'has','have','had','this','that','these','those','it','its',
  'i','me','my','we','our','you','your','he','she','they','their',
  'india','indian','content','video','videos','things','people','world',
  'life','time','way','thing','news','latest','new','best','good','top',
  'all','more','great','big','small','full','high','low',
]);

// ── Core scorer ───────────────────────────────────────────────────────────────

function recommendationStructureScore(title) {
  if (!title || typeof title !== 'string') return { score: 0, signals: ['no_title'] };

  const t      = title.trim();
  const tLower = t.toLowerCase();
  const words  = t.split(/\s+/).filter(Boolean);
  const wc     = words.length;
  // Strip trailing punctuation before vocabulary lookups
  const wLower = words.map(w => w.toLowerCase().replace(/[^a-z0-9']/g, ''));
  const signals = [];
  let   score   = 0;

  // ── Length (0–20) ────────────────────────────────────────────────────────
  if (wc <= 2) {
    score -= 20; signals.push('fragment_2w');
  } else if (wc <= 3) {
    score -= 10; signals.push('fragment_3w');
  } else if (wc === 4) {
    score += 0;  signals.push('short_4w');
  } else if (wc <= 7) {
    score += 10; signals.push('length_5_7');
  } else if (wc <= 11) {
    score += 20; signals.push('length_8_11');
  } else if (wc <= 15) {
    score += 15; signals.push('length_12_15');
  } else {
    score += 8;  signals.push('length_16plus');
  }

  // ── Action type (mutually exclusive groups) ───────────────────────────────
  const hasVerb     = wLower.some(w => ACTION_VERBS.has(w));
  const hasImplied  = IMPLIED_ACTION_RE.test(tLower);
  const hasMistake  = MISTAKE_RE.test(tLower);
  const hasDish     = DISH_NOUNS.test(tLower);
  const hasAssume   = ASSUMPTION_RE.test(tLower) && CONTRAST_RE.test(tLower);
  const hasColon    = COLON_RE.test(t);

  // Template bonuses (stacking allowed)
  if (hasAssume) {
    score += 20; signals.push('assumption_reversal');
  }
  if (hasDish) {
    score += 20; signals.push('dish_technique');
  }
  if (hasMistake) {
    score += 12; signals.push('mistake_template');
  }
  if (hasColon && !hasMistake) {
    score += 8;  signals.push('colon_structure');
  }

  // Action verb hierarchy
  if (hasVerb) {
    score += 20; signals.push('explicit_verb');
  } else if (hasImplied || hasMistake) {
    score += 15; signals.push('implied_action');
  } else if (/\b(is|are|was|were|'s|'re|isn't|aren't)\b/i.test(tLower)) {
    score += 5;  signals.push('has_copula');
  } else if (hasDish) {
    // dish_technique already adds its own bonus — verbless cooking titles are structurally valid
    signals.push('dish_implicit');
  } else {
    score -= 10; signals.push('no_action');
  }

  // ── Hook patterns (narrative triggers) ───────────────────────────────────
  let hookHit = false;
  for (const re of HOOK_PATTERNS) {
    if (re.test(tLower)) { hookHit = true; break; }
  }
  if (hookHit) {
    // Generic hook penalty: "check this" / "see this" at end = empty body
    if (GENERIC_HOOK_RE.test(t) || EMPTY_BODY_HOOK_RE.test(tLower)) {
      score -= 15; signals.push('generic_hook_penalty');
    } else {
      score += 15; signals.push('hook_pattern');
    }
  }

  // ── Claim words ───────────────────────────────────────────────────────────
  const genuineClaimCount = wLower.filter(w => GENUINE_CLAIMS.has(w)).length;
  const weakClaimCount    = wLower.filter(w => WEAK_CLAIMS.has(w)).length;
  if (genuineClaimCount >= 1) {
    score += 10; signals.push('genuine_claim');
  } else if (weakClaimCount >= 1) {
    score += 5;  signals.push('weak_claim');
  }

  // ── Concrete outcome ──────────────────────────────────────────────────────
  if (OUTCOME_RE.test(tLower)) {
    score += 10; signals.push('concrete_outcome');
  }

  // ── Named entity (only positive when wc ≥ 6) ────────────────────────────
  const entityCount = namedEntityCount(t);
  if (entityCount >= 1 && wc >= 6) {
    score += (entityCount >= 3 ? 15 : 10);
    signals.push(entityCount >= 3 ? 'named_entity_3plus' : 'named_entity_long');
  } else if (entityCount >= 1 && wc <= 5) {
    score -= 5;  signals.push('entity_on_short');
  }

  // ── Multi-angle structure ─────────────────────────────────────────────────
  if (/\w+,\s*\w+.*\band\b/i.test(tLower) && wc >= 7) {
    score += 5; signals.push('multi_angle');
  }

  // ── Penalties ─────────────────────────────────────────────────────────────
  if (!hasVerb && !hasImplied && !hasMistake && wc <= 5) {
    score -= 15; signals.push('keyword_dump');
  }
  if (SEARCH_SUFFIX_RE.test(t)) {
    score -= 8; signals.push('search_suffix');
  }
  const nonFiller = wLower.filter(w => !FILLER.has(w) && !ACTION_VERBS.has(w)).length;
  if ((1 - nonFiller / Math.max(1, wc)) >= 0.6 && wc >= 5) {
    score -= 5; signals.push('high_filler');
  }

  return { score: Math.max(0, Math.min(100, score)), signals };
}

module.exports = { recommendationStructureScore };

// ── Standalone audit ──────────────────────────────────────────────────────────
if (require.main === module) {
  const path  = require('path');
  const BetterSqlite3 = require('../node_modules/better-sqlite3');
  const verbose = process.argv.includes('--verbose');

  const db = new BetterSqlite3(
    path.resolve(__dirname, '../data/scoring.db'),
    { readonly: true, timeout: 60000 },
  );
  const rows = db.prepare(`
    SELECT id, rec_source, generated_title, human_label
    FROM   wtp_human_quality_reviews
    WHERE  human_label IS NOT NULL
    ORDER  BY human_label, id
  `).all();
  db.close();

  const LABEL_SCORE = { Excellent:5, Good:4, Average:3, Poor:2, Garbage:1 };
  const ORDER       = ['Excellent','Good','Average','Poor','Garbage'];
  const scored      = rows.map(r => ({
    ...r,
    struct:    recommendationStructureScore(r.generated_title),
    qualScore: LABEL_SCORE[r.human_label] || 0,
  }));

  // Pearson r
  const xs  = scored.map(r => r.struct.score);
  const ys  = scored.map(r => r.qualScore);
  const n   = xs.length;
  const xm  = xs.reduce((s,v)=>s+v,0)/n;
  const ym  = ys.reduce((s,v)=>s+v,0)/n;
  const num  = xs.reduce((s,v,i)=>s+(v-xm)*(ys[i]-ym),0);
  const denX = Math.sqrt(xs.reduce((s,v)=>s+(v-xm)**2,0));
  const denY = Math.sqrt(ys.reduce((s,v)=>s+(v-ym)**2,0));
  const r    = (denX&&denY) ? num/(denX*denY) : 0;

  const byLabel = {};
  for (const lbl of ORDER) byLabel[lbl] = scored.filter(s=>s.human_label===lbl);

  const fmt = (n,d) => d>0 ? (n/d*100).toFixed(0)+'%' : '-';
  const mean = arr => arr.reduce((s,v)=>s+v,0)/arr.length;

  console.log('\n══════════════════════════════════════════════════════════════');
  console.log('  Structure Score V2 — Audit');
  console.log(`  ${rows.length} labeled rows`);
  console.log('══════════════════════════════════════════════════════════════\n');

  console.log('── 1. AVERAGE SCORE BY LABEL ─────────────────────────────────');
  for (const lbl of ORDER) {
    const g = byLabel[lbl]; if (!g?.length) continue;
    const avg = mean(g.map(s=>s.struct.score));
    const min = Math.min(...g.map(s=>s.struct.score));
    const max = Math.max(...g.map(s=>s.struct.score));
    console.log(`  ${lbl.padEnd(10)} n=${String(g.length).padStart(4)}  avg=${avg.toFixed(1).padStart(5)}  min=${min}  max=${max}`);
  }

  console.log(`\n  Pearson r: ${r>=0?'+':''}${r.toFixed(3)}  (V1 was +0.523, target ≥ +0.60)`);
  console.log(`  Status: ${r>=0.60 ? '✓ TARGET MET' : r>=0.50 ? '~ IMPROVED (not at target)' : '✗ REGRESSED'}`);

  const winners = scored.filter(s=>s.human_label==='Excellent'||s.human_label==='Good');
  const losers  = scored.filter(s=>s.human_label==='Poor'||s.human_label==='Garbage');
  const wAvg    = mean(winners.map(s=>s.struct.score));
  const lAvg    = mean(losers.map(s=>s.struct.score));
  console.log(`\n  Winner avg: ${wAvg.toFixed(1)}  Loser avg: ${lAvg.toFixed(1)}  Gap: +${(wAvg-lAvg).toFixed(1)}`);

  console.log('\n── 2. SCORE BUCKET BY LABEL ──────────────────────────────────');
  const buckets = [
    { label:'0–19',  test:s=>s<20  },
    { label:'20–39', test:s=>s<40  },
    { label:'40–59', test:s=>s<60  },
    { label:'60–79', test:s=>s<80  },
    { label:'80+',   test:s=>s<=100},
  ];
  console.log('  Bucket  ' + ORDER.map(l=>l.slice(0,4).padStart(7)).join(''));
  for (const b of buckets) {
    const vals = ORDER.map(lbl=>{
      const g=byLabel[lbl]; if(!g?.length) return '   n/a';
      return fmt(g.filter(s=>b.test(s.struct.score)).length,g.length).padStart(7);
    });
    console.log(`  ${b.label.padEnd(6)} ${vals.join('')}`);
  }

  console.log('\n── 3. SIGNAL FREQUENCY (winners vs losers) ───────────────────');
  const allSigs = [...new Set(scored.flatMap(s=>s.struct.signals))].sort();
  const sigW={}, sigL={};
  for (const s of winners) for (const sig of s.struct.signals) sigW[sig]=(sigW[sig]||0)+1;
  for (const s of losers)  for (const sig of s.struct.signals) sigL[sig]=(sigL[sig]||0)+1;
  const sigRows = allSigs.map(sig=>({
    sig,
    w: winners.length>0?(sigW[sig]||0)/winners.length:0,
    l: losers.length>0?(sigL[sig]||0)/losers.length:0,
  })).sort((a,b)=>(b.w-b.l)-(a.w-a.l));
  console.log('  Signal                  Win%  Los%  Delta');
  for (const {sig,w,l} of sigRows) {
    const d = (w-l)*100;
    const dir = d>10?'↑':d<-10?'↓':'~';
    console.log(`  ${sig.padEnd(24)} ${(w*100).toFixed(0).padStart(4)}% ${(l*100).toFixed(0).padStart(4)}%  ${(d>=0?'+':'')+d.toFixed(0).padStart(3)}pp ${dir}`);
  }

  console.log('\n── 4. THRESHOLD ANALYSIS ─────────────────────────────────────');
  for (const threshold of [25,35,45,55]) {
    const tp=winners.filter(s=>s.struct.score>=threshold).length;
    const fp=losers.filter(s=>s.struct.score>=threshold).length;
    const tn=losers.filter(s=>s.struct.score<threshold).length;
    const fn=winners.filter(s=>s.struct.score<threshold).length;
    const prec=tp+fp>0?tp/(tp+fp):0;
    const rec=tp+fn>0?tp/(tp+fn):0;
    const f1=prec+rec>0?2*prec*rec/(prec+rec):0;
    console.log(`  ≥${threshold}: prec=${(prec*100).toFixed(0)}% rec=${(rec*100).toFixed(0)}% F1=${f1.toFixed(2)} (TP=${tp} FP=${fp} TN=${tn} FN=${fn})`);
  }

  if (verbose) {
    console.log('\n── 5. KEY EXAMPLES ────────────────────────────────────────────');
    console.log('  HIGH-SCORING LOSERS (false positives):');
    losers.filter(s=>s.struct.score>=40).sort((a,b)=>b.struct.score-a.struct.score).slice(0,10).forEach(s=>{
      console.log(`  [${s.human_label}] ${s.struct.score} (${s.struct.signals.join(',')}) "${s.generated_title}"`);
    });
    console.log('  LOW-SCORING WINNERS (false negatives):');
    winners.filter(s=>s.struct.score<35).sort((a,b)=>a.struct.score-b.struct.score).slice(0,10).forEach(s=>{
      console.log(`  [${s.human_label}] ${s.struct.score} (${s.struct.signals.join(',')}) "${s.generated_title}"`);
    });
  }

  console.log('\n══════════════════════════════════════════════════════════════\n');
}

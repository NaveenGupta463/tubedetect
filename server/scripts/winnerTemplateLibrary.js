'use strict';

/**
 * Winner Template Library — Phase 4
 *
 * Extracts recurring title structures from Excellent + Good recommendations.
 * Classifies them into named template types and computes win rates.
 *
 * Each template has:
 *   - name / type
 *   - structural pattern (with [TOPIC], [AUDIENCE], [ENTITY] placeholders)
 *   - win rate in gold set
 *   - example winner titles
 *   - generation hints
 *
 * Output:
 *   scripts/winner_templates.json   (machine-readable library)
 *   Console report (human summary)
 *
 * Usage: node winnerTemplateLibrary.js [--verbose]
 */

const path = require('path');
const fs   = require('fs');
const BetterSqlite3 = require('../node_modules/better-sqlite3');

// ── Template type definitions ─────────────────────────────────────────────────
// Each template has: a test function (→ bool), a skeleton builder (→ string),
// and generation hints for the generation engine.
const TEMPLATES = {

  DISH_TECHNIQUE: {
    type:        'dish_technique',
    category:    'food',
    description: 'Specific dish + cooking style/technique/format',
    winRate:     null, // filled at runtime
    test: t =>
      /\b(biryani|vada pav|vada|pav|dosa|thali|paratha|paneer|samosa|chutney|masala|curry|tandoor|chapati|roti|idli|upma|poha|khichdi|halwa|gulab|jalebi|lassi|pizza|burger|momos|kebab|tikka|asmr cooking|street food combo)\b/i.test(t),
    skeleton: t => {
      return t
        .replace(/\b(mumbai|delhi|hyderabad|kolkata|pune|bangalore|thai|punjabi|goan|rajasthani|south indian)\s*/gi, '[PLACE] ')
        .replace(/\b(style|version|twist|combo)\b/gi, 'Style')
        .replace(/\b(asmr|mukbang|vlog|challenge|budget|restaurant)\s*(cooking|version|edition)?\b/gi, '[FORMAT]')
        .replace(/\b(garlic|ginger|masala|tadka|ghee|cheese|coriander|mint|tomato|onion)\s+(chutney|sauce|gravy)?\b/gi, '[INGREDIENT]')
        .replace(/\bbiryani|vada pav|vada|pav|dosa|thali|paratha|paneer|samosa|curry|kebab|tikka|momos\b/gi, '[DISH]')
        .replace(/\s+/g, ' ').trim();
    },
    hints: [
      'Pair a specific dish with a specific regional style or format',
      'Add a technique or cooking method (ASMR, home version, budget version)',
      'Include a specific ingredient twist to add novelty',
      'Examples: "[City] Style [Dish] With [Ingredient]", "[Dish] [Cooking Method]"',
    ],
  },

  MISTAKE_BEHIND: {
    type:        'mistake_behind',
    category:    'education',
    description: 'Common mistake / error / trap behind a domain',
    winRate:     null,
    test: t =>
      /\b((beginner |common |biggest |worst |the )?(mistake|error|problem|flaw|trap|pitfall)s?\b)/i.test(t),
    skeleton: t => {
      return t
        .replace(/\b(beginner|common|biggest|worst|classic|fatal|rookie|obvious)\b/gi, '[ADJ]')
        .replace(/\b(fitness|workout|gym|diet|nutrition|fat loss|weight loss|muscle)\b/gi, '[FITNESS_TOPIC]')
        .replace(/\b(stock|market|sip|mutual fund|investing|crypto|finance|budget|nifty)\b/gi, '[FINANCE_TOPIC]')
        .replace(/\b(cooking|food|recipe|kitchen|chef)\b/gi, '[FOOD_TOPIC]')
        .replace(/\b(mistake|error|problem|flaw|trap|pitfall)s?\b/gi, '[MISTAKE]')
        .replace(/\b(behind|in|when|with|during)\b/gi, '[PREP]')
        .replace(/\b(supplement|protein|creatine|carbs|calories|calorie)\b/gi, '[INGREDIENT]')
        .replace(/\s+/g, ' ').trim();
    },
    hints: [
      'Lead with the audience segment (beginner / common / biggest)',
      'Name the specific domain (not just "fitness" but "fat loss" or "SIP investing")',
      'The mistake should be counterintuitive — not obvious from the domain name alone',
      'Examples: "The beginner mistake behind [TOPIC]", "The [ADJ] [MISTAKE] in [TOPIC]"',
    ],
  },

  WAY_TO: {
    type:        'way_to',
    category:    'education',
    description: 'A [constraint] way to [action] [outcome]',
    winRate:     null,
    test: t =>
      /\b(way to|approach to|method (for|to))\b/i.test(t),
    skeleton: t => {
      return t
        .replace(/\b(no-equipment|no equipment|budget|quick|simple|easy|practical|straightforward|proven|effective)\b/gi, '[CONSTRAINT]')
        .replace(/\ba\b/gi, 'A')
        .replace(/\b(improve|build|lose|gain|master|understand|achieve|start|boost)\b/gi, '[ACTION]')
        .replace(/\b(fat loss|weight loss|muscle|fitness|carb plan|protein|endurance|strength)\b/gi, '[FITNESS_OUTCOME]')
        .replace(/\b(sip|portfolio|savings|income|wealth|investment|budget|expense)\b/gi, '[FINANCE_OUTCOME]')
        .replace(/\b(cooking|recipe|technique|flavor|dish)\b/gi, '[FOOD_OUTCOME]')
        .replace(/\s+/g, ' ').trim();
    },
    hints: [
      'The constraint makes the template specific: "no-equipment", "budget", "under 30 min"',
      'The action must be a real verb (improve, lose, build, master)',
      'The outcome must be a specific measurable domain term',
      'Examples: "A no-equipment way to improve [TOPIC]", "A [CONSTRAINT] way to [ACTION] [OUTCOME]"',
    ],
  },

  CHECKLIST_FORMAT: {
    type:        'checklist_format',
    category:    'education',
    description: 'A checklist / guide / tips for a specific domain',
    winRate:     null,
    test: t =>
      /\b(checklist|guide|tips?|hacks?|steps?|routine) (for|to|on)\b/i.test(t) &&
      !/\b(way to|approach to)\b/i.test(t),
    skeleton: t => {
      return t
        .replace(/\b(practical|quick|simple|complete|ultimate|honest|daily|weekly)\b/gi, '[ADJ]')
        .replace(/\b(checklist|guide|tips?|hacks?|steps?|routine)\b/gi, '[FORMAT]')
        .replace(/\b(for|to|on)\b/gi, 'for')
        .replace(/\b(sip|portfolio|savings|income|investment|stock|mutual fund)\b/gi, '[FINANCE_TOPIC]')
        .replace(/\b(fat loss|weight loss|muscle|fitness|diet|workout)\b/gi, '[FITNESS_TOPIC]')
        .replace(/\b(cooking|food|recipe|kitchen)\b/gi, '[FOOD_TOPIC]')
        .replace(/\s+/g, ' ').trim();
    },
    hints: [
      'Lead with a qualifying adjective (practical, honest, quick)',
      'Format word sets expectation (checklist = scannable, guide = narrative, tips = listicle)',
      'Domain must be specific — not "finance" but "SIP choices" or "stock market entry"',
      'Examples: "A practical checklist for [DOMAIN]", "An honest guide to [TOPIC]"',
    ],
  },

  COLON_EXPLAINER: {
    type:        'colon_explainer',
    category:    'education',
    description: 'Topic: dimension1, dimension2, dimension3 explained',
    winRate:     null,
    test: t =>
      /^[^:]{4,35}:\s*.{5,}/.test(t) && /,/.test(t),
    skeleton: t => {
      const [topic, rest] = t.split(':').map(s=>s.trim());
      const topicSkeleton = topic
        .replace(/\b(stock|market|sip|mutual fund|investing|nifty|sensex)\b/gi, '[FINANCE_TOPIC]')
        .replace(/\b(fat loss|weight loss|fitness|workout|diet|nutrition)\b/gi, '[FITNESS_TOPIC]')
        .replace(/\b(food|cooking|recipe|kitchen)\b/gi, '[FOOD_TOPIC]');
      return `[TOPIC]: [DIM1], [DIM2], and [DIM3] explained`;
    },
    hints: [
      'Topic before colon should be specific (not just "stocks" but "stock jumps")',
      'After colon: 2-4 dimensions or aspects of the topic',
      'End with "explained" or "explained simply" for clear educational signal',
      'Examples: "[EVENT]: risk, returns, and timing explained", "[TOPIC]: what works, what doesn\'t, and why"',
    ],
  },

  COLON_VARIANT: {
    type:        'colon_variant',
    category:    'food',
    description: 'Topic: a specific angle or variant for audience',
    winRate:     null,
    test: t =>
      /^[^:]{4,35}:\s*.{4,}/.test(t) && !/,/.test(t),
    skeleton: t => {
      return `[TOPIC]: [ADJ] version for [AUDIENCE]`;
    },
    hints: [
      'Topic before colon should be the core concept (desi food, street food)',
      'After colon: a specific angle that adds dimension (quick version, budget version, regional twist)',
      'Optional audience tag ("for busy days", "for beginners")',
      'Examples: "desi food: quick version for busy days", "street food: the budget challenge"',
    ],
  },

  ASSUMPTION_REVERSAL: {
    type:        'assumption_reversal',
    category:    'narrative',
    description: 'We thought X. Actually Y. (reveals wrong assumption)',
    winRate:     null,
    test: t =>
      /\b(we thought|you think|people think|everyone thinks|they thought|i thought)\b/i.test(t) &&
      /\b(but|actually|might|could|instead|turns out|however)\b/i.test(t),
    skeleton: t => `We Thought [ACCEPTED BELIEF]. They [Might/Actually] [SURPRISING TRUTH]`,
    hints: [
      'Lead with the widely-held belief (what everyone thinks is true)',
      'Pivot with "but", "actually", "turns out", "might"',
      'The surprising truth should be specific and counter-intuitive',
      'Best for science, finance, health — where conventional wisdom is wrong',
      'Examples: "We Thought X Ended in Y. They Might End in Z"',
    ],
  },

  FORCED_CONFLICT: {
    type:        'forced_conflict',
    category:    'narrative',
    description: 'Named subject forced / made to do something against its nature',
    winRate:     null,
    test: t => /\bforced to\b|\bmade to\b|\bhad to (hunt|kill|attack|flee|leave)\b/i.test(t),
    skeleton: t =>
      t.replace(/\b(tiger|lion|bear|wolf|animal|predator|man|woman|person)\b/gi, '[SUBJECT]')
       .replace(/\b(hunt|kill|attack|flee|leave|survive|fight)\b/gi, '[ACTION]')
       .replace(/\b(humans?|people|villages?|prey|enemy)\b/gi, '[OBJECT]'),
    hints: [
      'Named specific subject (the tiger, not "a tiger")',
      '"forced to" creates immediate tension and sympathy',
      'Action should be against the subject\'s nature or will',
      'Best for nature, history, human interest narratives',
    ],
  },

  NUMBER_LIST: {
    type:        'number_list',
    category:    'education',
    description: 'N ways / reasons / tips to [action] [domain]',
    winRate:     null,
    test: t => /^\d+\s+(ways?|reasons?|things?|tips?|mistakes?|facts?|rules?|signs?|hacks?|steps?)/i.test(t),
    skeleton: t => {
      const match = t.match(/^(\d+)\s+(\w+)/);
      const num  = match?.[1] || 'N';
      const fmt  = match?.[2] || 'ways';
      return `${num} ${fmt} to [ACTION] [TOPIC]`;
    },
    hints: [
      'Specific number signals concrete value (5 > "several")',
      'Format word sets expectation (mistakes = what not to do, ways = options)',
      'The action must follow directly (5 ways to LOSE fat, not just "5 fat loss things")',
      'Keep number ≤ 7 for credibility; odd numbers feel more genuine than even',
    ],
  },

  CONFLICT_EXPOSE: {
    type:        'conflict_expose',
    category:    'narrative',
    description: "Subject can't / won't / didn't + reveal or expose",
    winRate:     null,
    test: t =>
      /\b(can'?t|won'?t|didn'?t|couldn'?t)\b/i.test(t) &&
      !/\bcheck this\b/i.test(t),
    skeleton: t =>
      t.replace(/\b(trump|modi|biden|putin|zelensky|xi|netanyahu)\b/gi, '[NAMED_ENTITY]')
       .replace(/\b(negotiate|work|compete|handle|manage|survive)\b/gi, '[ACTION]')
       .replace(/\b(iran|china|russia|pakistan|ukraine|israel)\b/gi, '[COUNTRY]')
       .replace(/\b(prove|proves|proved|shows?|revealed?)\b/gi, '[REVEAL]'),
    hints: [
      'Name the specific actor (Trump, not "a politician")',
      '"Can\'t" creates immediate tension — establishes a failing',
      'Include the evidence source ("the Iran talks prove it")',
      'Avoid vague claims — specific named story + specific verdict',
    ],
  },

  HOW_TO: {
    type:        'how_to',
    category:    'education',
    description: 'How to [specific action] [specific topic]',
    winRate:     null,
    test: t => /^how to\s/i.test(t),
    skeleton: t => `How to [ACTION] [SPECIFIC_TOPIC]`,
    hints: [
      'The action must be specific (not just "understand" but "read" or "build")',
      'The topic must be domain-specific (not "finance" but "a SIP portfolio")',
      'Add constraint for specificity: "without", "on a budget", "in N days"',
    ],
  },
};

const TEMPLATE_KEYS = Object.keys(TEMPLATES);

function classifyTemplate(title) {
  const t = String(title || '');
  for (const key of TEMPLATE_KEYS) {
    if (TEMPLATES[key].test(t)) return key;
  }
  return 'GENERIC';
}

// ── Placeholder extraction ─────────────────────────────────────────────────────
function buildSkeleton(key, title) {
  if (key === 'GENERIC') return '(no pattern matched)';
  return TEMPLATES[key].skeleton(title);
}

// ── Main ──────────────────────────────────────────────────────────────────────
function main() {
  const db = new BetterSqlite3(
    path.resolve(__dirname,'../data/scoring.db'),
    { readonly:true, timeout:60000 }
  );
  const verbose = process.argv.includes('--verbose');

  const rows = db.prepare(`
    SELECT r.id, r.rec_source, r.family, r.generated_title, r.human_label,
           r.concept_label, t.opportunity_label
    FROM   wtp_human_quality_reviews r
    LEFT JOIN wtp_generation_traces t ON t.id = r.trace_id
    WHERE  r.human_label IS NOT NULL
    ORDER  BY r.human_label, r.id
  `).all();
  db.close();

  const all     = rows.map(r=>({...r, tmpl: classifyTemplate(r.generated_title)}));
  const winners = all.filter(r=>r.human_label==='Excellent'||r.human_label==='Good');

  // ── Compute win rates per template ─────────────────────────────────────────
  const library = {};
  for (const key of [...TEMPLATE_KEYS,'GENERIC']) {
    const allT = all.filter(r=>r.tmpl===key);
    const winT = allT.filter(r=>r.human_label==='Excellent'||r.human_label==='Good');
    const def  = TEMPLATES[key] || { type:'generic', category:'unknown', description:'No template matched', hints:[] };

    const skeletons = [...new Set(winT.map(r=>buildSkeleton(key, r.generated_title)).filter(s=>s!=='(no pattern matched)'))];

    library[key] = {
      type:         def.type || 'generic',
      category:     def.category || 'unknown',
      description:  def.description || 'No template matched',
      total_in_gold: allT.length,
      winners:      winT.length,
      losers:       allT.length - winT.length,
      win_rate:     allT.length > 0 ? winT.length / allT.length : 0,
      examples: winT.slice(0,5).map(r=>({
        label: r.human_label,
        source: r.rec_source,
        title: r.generated_title,
        skeleton: buildSkeleton(key, r.generated_title),
      })),
      loser_examples: allT.filter(r=>r.human_label==='Poor'||r.human_label==='Garbage').slice(0,3).map(r=>({
        label: r.human_label,
        title: r.generated_title,
      })),
      structural_patterns: skeletons.slice(0,5),
      generation_hints: def.hints || [],
    };
  }

  // ── Sort by winner count desc ──────────────────────────────────────────────
  const sorted = Object.entries(library).sort((a,b)=>b[1].winners-a[1].winners);

  // ── Console report ────────────────────────────────────────────────────────
  console.log('\n══════════════════════════════════════════════════════════════');
  console.log('  Winner Template Library');
  console.log(`  ${winners.length} winners analyzed across ${all.length} labeled rows`);
  console.log('══════════════════════════════════════════════════════════════\n');

  console.log('── TEMPLATE LEADERBOARD ──────────────────────────────────────');
  console.log('  Template            Winners  Total  Win%   Category');
  for (const [key, lib] of sorted) {
    const flag = lib.win_rate>=0.30?'★★':lib.win_rate>=0.10?'★':'';
    console.log(`  ${key.padEnd(20)} ${String(lib.winners).padStart(7)}  ${String(lib.total_in_gold).padStart(5)}  ${(lib.win_rate*100).toFixed(1).padStart(4)}%  ${lib.category} ${flag}`);
  }

  console.log('\n── WINNING TEMPLATES DETAIL ──────────────────────────────────');
  for (const [key, lib] of sorted.filter(([,l])=>l.winners>0)) {
    console.log(`\n  ┌─ ${key} (${lib.winners} winners, ${(lib.win_rate*100).toFixed(1)}% win rate)`);
    console.log(`  │  ${lib.description}`);
    console.log(`  │  Category: ${lib.category}`);
    if (lib.examples.length) {
      console.log(`  │  Winner examples:`);
      lib.examples.slice(0,3).forEach(e=>console.log(`  │    [${e.label}] "${e.title}"`));
    }
    if (verbose && lib.loser_examples.length) {
      console.log(`  │  Loser examples (same template, poor quality):`);
      lib.loser_examples.slice(0,2).forEach(e=>console.log(`  │    [${e.label}] "${e.title}"`));
    }
    if (lib.generation_hints.length) {
      console.log(`  │  Generation hints:`);
      lib.generation_hints.slice(0,2).forEach(h=>console.log(`  │    • ${h}`));
    }
    console.log(`  └────────────────────────────────────────`);
  }

  // ── Write JSON library ────────────────────────────────────────────────────
  const outputPath = path.resolve(__dirname, 'winner_templates.json');
  const output = {
    generated:   new Date().toISOString().slice(0,10),
    gold_set_size: all.length,
    total_winners: winners.length,
    overall_win_rate: winners.length / all.length,
    templates:   Object.fromEntries(sorted),
    generation_strategy: {
      primary_targets: sorted
        .filter(([,l])=>l.win_rate>=0.20 && l.winners>=3)
        .map(([key,l])=>({ template:key, win_rate:l.win_rate, category:l.category })),
      avoid: sorted
        .filter(([,l])=>l.win_rate<0.02 && l.total_in_gold>=20)
        .map(([key,l])=>({ template:key, win_rate:l.win_rate, reason:'<2% win rate in gold set' })),
    },
  };
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2), 'utf8');
  console.log(`\n  Library written: ${outputPath}`);
  console.log('');

  // ── Generation strategy summary ───────────────────────────────────────────
  console.log('── GENERATION STRATEGY ───────────────────────────────────────');
  console.log('  HIGH-PRIORITY templates (≥20% win rate, ≥3 winners):');
  output.generation_strategy.primary_targets.forEach(t=>
    console.log(`    ${t.template} (${(t.win_rate*100).toFixed(1)}%, ${t.category})`)
  );
  console.log('  AVOID templates (<2% win rate):');
  output.generation_strategy.avoid.forEach(t=>
    console.log(`    ${t.template} (${(t.win_rate*100).toFixed(1)}%, n=${library[t.template]?.total_in_gold})`)
  );
  console.log('\n══════════════════════════════════════════════════════════════\n');
}

main();

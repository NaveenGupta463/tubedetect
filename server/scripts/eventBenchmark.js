'use strict';

/**
 * Event awareness benchmark — validates the classifier against known historical
 * events. Run after the nightly job to check that dead/post-event topics are
 * correctly suppressed and living topics are not penalised.
 *
 * Usage:  node server/scripts/eventBenchmark.js
 */

const { getDb } = require('../db/init');
const {
  classifyTopicCategory,
  lookupCalendar,
  computeDeathScore,
  computeRuntimeEventStage,
  COMPLETION_KEYWORDS,
} = require('../lib/eventClassifier');

// ── Known ground-truth cases ──────────────────────────────────────────────────

const CASES = [
  // Dead / past events — should be suppressed (event_stage: 'dead' or 'post_event')
  { topic: 'west bengal election', expectCategory: 'event',      expectDeadOrPost: true  },
  { topic: 'tamil nadu election',  expectCategory: 'event',      expectDeadOrPost: true  },
  { topic: 'lok sabha election 2024', expectCategory: 'event',   expectDeadOrPost: true  },
  { topic: 'ipl final 2024',       expectCategory: 'event',      expectDeadOrPost: true  },
  { topic: 'budget 2025',          expectCategory: 'event',      expectDeadOrPost: false }, // Feb 2025 — recent, may still be post_event
  { topic: 'election result',      expectCategory: 'event',      expectDeadOrPost: true  },
  { topic: 'verdict',              expectCategory: 'event',      expectDeadOrPost: false }, // generic — no calendar

  // Ongoing / news events — should NOT be dead
  { topic: 'ukraine war',          expectCategory: 'news_event', expectDeadOrPost: false },
  { topic: 'earthquake relief',    expectCategory: 'news_event', expectDeadOrPost: false },
  { topic: 'israel iran tension',  expectCategory: 'news_event', expectDeadOrPost: false },

  // Seasonal — should be seasonal, not event
  { topic: 'diwali special',       expectCategory: 'seasonal',   expectDeadOrPost: false },
  { topic: 'holi celebration',     expectCategory: 'seasonal',   expectDeadOrPost: false },
  { topic: 'board exam tips',      expectCategory: 'seasonal',   expectDeadOrPost: false },
  { topic: 'monsoon skin care',    expectCategory: 'seasonal',   expectDeadOrPost: false },

  // Recurring — explicit pattern required
  { topic: 'ipl season 2025',      expectCategory: 'recurring',  expectDeadOrPost: false },
  { topic: 'quarterly results q3', expectCategory: 'recurring',  expectDeadOrPost: false },

  // Evergreen — should default
  { topic: 'home loan tips',       expectCategory: 'evergreen',  expectDeadOrPost: false },
  { topic: 'python tutorial',      expectCategory: 'evergreen',  expectDeadOrPost: false },
  { topic: 'morning routine',      expectCategory: 'evergreen',  expectDeadOrPost: false },
];

// ── Completion keyword smoke test ─────────────────────────────────────────────

const COMPLETION_TEST = [
  { title: 'West Bengal Election Results | Final Verdict', expectMatch: true  },
  { title: 'How to file ITR | Full Guide',                expectMatch: false },
  { title: 'IPL Final 2024 Highlights',                   expectMatch: true  },
  { title: 'Morning yoga routine',                        expectMatch: false },
];

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeMinimalBucket(overrides = {}) {
  return {
    cnt_0_14:  0,
    cnt_15_30: 0,
    cnt_31_60: 0,
    cnt_61_90: 0,
    channels:  new Set(),
    videos:    [],
    ...overrides,
  };
}

function isDeadOrPost(stage) {
  return stage === 'dead' || stage === 'post_event' || stage === 'decay';
}

// ── Run ────────────────────────────────────────────────────────────────────────

function run() {
  const db = getDb();

  console.log('\n=== Event Awareness Benchmark ===\n');

  // Pull DB rows for topics that were classified nightly
  const dbRows = new Map();
  try {
    db.all('SELECT topic, topic_category, event_stage, death_score, last_live_d0 FROM topic_event_metadata')
      .forEach(r => dbRows.set(r.topic, r));
    console.log(`DB rows loaded: ${dbRows.size} topics classified\n`);
  } catch (e) {
    console.warn(`Could not load topic_event_metadata: ${e.message} — will use runtime only\n`);
  }

  let pass = 0, fail = 0;

  for (const c of CASES) {
    const cat      = classifyTopicCategory(c.topic);
    const cal      = lookupCalendar(c.topic);
    const b        = makeMinimalBucket();  // no bucket data — calendar-driven only
    const dbRow    = dbRows.get(c.topic) || null;
    const { category, event_stage, death_score } = computeRuntimeEventStage(c.topic, b, dbRow);

    const catOk    = cat === c.expectCategory;
    const deadOk   = isDeadOrPost(event_stage) === c.expectDeadOrPost;
    const ok       = catOk && deadOk;

    if (ok) pass++; else fail++;

    const status = ok ? '✓ PASS' : '✗ FAIL';
    console.log(
      `${status}  [${c.topic.padEnd(30)}]  ` +
      `cat=${cat.padEnd(10)} stage=${String(event_stage).padEnd(12)} score=${String(Math.round(death_score || 0)).padStart(3)}` +
      `  cal=${cal ? cal.calendar_date : 'none'}` +
      (!catOk  ? `  EXPECTED_CAT=${c.expectCategory}` : '') +
      (!deadOk ? `  EXPECTED_DEAD_OR_POST=${c.expectDeadOrPost}` : ''),
    );
  }

  console.log('\n--- Completion keyword smoke test ---');
  for (const t of COMPLETION_TEST) {
    const lower   = t.title.toLowerCase();
    const matched = COMPLETION_KEYWORDS.some(k => lower.includes(k));
    const ok      = matched === t.expectMatch;
    if (ok) pass++; else fail++;
    console.log(`${ok ? '✓' : '✗'}  "${t.title}"  matched=${matched}`);
  }

  console.log(`\n=== Results: ${pass} pass, ${fail} fail ===\n`);

  // Show which topics in the DB are currently dead/post_event
  if (dbRows.size > 0) {
    console.log('--- Topics in DB marked dead or post_event ---');
    let shown = 0;
    for (const [topic, r] of dbRows) {
      if (isDeadOrPost(r.event_stage)) {
        console.log(`  [${r.event_stage.padEnd(12)}] score=${String(Math.round(r.death_score || 0)).padStart(3)}  ${topic}`);
        shown++;
        if (shown >= 30) { console.log('  ... (truncated)'); break; }
      }
    }
    if (shown === 0) console.log('  (none yet — run nightly job first)');
    console.log('');
  }
}

run();

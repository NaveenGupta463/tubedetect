'use strict';

/**
 * repairImpactAnalysis.js
 *
 * Measures downstream quality improvement from the 113 auto-repaired niche classifications.
 * Compares repaired channels against 100 randomly-selected controls across 6 metrics:
 *   1. Topic Precision  — % of peers whose niche matches the channel's niche (cluster-aware)
 *   2. Language Precision — % of peers with matching primary_language
 *   3. Audience Precision — % of peers within 10× subscriber range
 *   4. False Positive Rate — % of IN-region peers in EN-channel pools
 *   5. WTP Specificity — avg specificity_score of top-15 WTP ideas
 *   6. WTP Composite   — avg combined score of top-15 WTP ideas
 *
 * Before/after for community metrics:
 *   - topic_precision_before = % of current peers matching OLD niche (niche_override origin)
 *   - topic_precision_after  = % of current peers matching NEW niche (post-repair)
 *   - topic_lift = after − before  (controls always 0)
 *
 * Usage:
 *   node server/scripts/repairImpactAnalysis.js
 *   node server/scripts/repairImpactAnalysis.js --no-wtp
 *   node server/scripts/repairImpactAnalysis.js --controls=50
 *   node server/scripts/repairImpactAnalysis.js --repair-type=finance
 *   node server/scripts/repairImpactAnalysis.js --top=30
 */

require('dotenv').config({ path: __dirname + '/../.env' });

const path         = require('path');
const BetterSqlite = require('../node_modules/better-sqlite3');
const { resolveCreatorPeerContext } = require('../services/creatorPeerContext');
const { computeWhatToPost }         = require('../services/whatToPost');
const { buildWhatToPostContext }     = require('../services/whatToPostContext');

// ── CLI args ──────────────────────────────────────────────────────────────────
const args = Object.fromEntries(
  process.argv.slice(2)
    .filter(a => a.startsWith('--'))
    .map(a => {
      const [k, v] = a.slice(2).split('=');
      return [k, v === undefined ? true : isNaN(v) ? v : Number(v)];
    }),
);

const NO_WTP        = !!args['no-wtp'];
const CONTROLS      = Math.max(10, Math.min(300, Number(args.controls) || 100));
const TOP           = Math.max(5,  Math.min(100, Number(args.top)      || 20));
const REPAIR_FILTER = args['repair-type'] ? String(args['repair-type']).toLowerCase() : null;

// ── Niche cluster map (mirrors NICHE_CLUSTERS in creatorPeerContext.js) ───────
const NICHE_CLUSTER_MAP = {
  entertainment:    ['entertainment', 'comedy', 'comedy sketches'],
  comedy:           ['comedy', 'entertainment', 'comedy sketches'],
  'comedy sketches':['comedy', 'entertainment', 'comedy sketches'],
  finance:          ['finance', 'personal finance', 'investing', 'stock market', 'cryptocurrency'],
  'personal finance':['finance', 'personal finance', 'investing', 'stock market', 'cryptocurrency'],
  investing:        ['finance', 'personal finance', 'investing', 'stock market', 'cryptocurrency'],
  'stock market':   ['finance', 'personal finance', 'investing', 'stock market', 'cryptocurrency'],
  cryptocurrency:   ['finance', 'personal finance', 'investing', 'stock market', 'cryptocurrency'],
  news:             ['news', 'current affairs', 'breaking news'],
  'current affairs':['news', 'current affairs', 'breaking news'],
  'breaking news':  ['news', 'current affairs', 'breaking news'],
  politics:         ['politics'],
  geopolitics:      ['geopolitics'],
  science:          ['science', 'technology', 'education'],
  technology:       ['science', 'technology', 'education'],
  education:        ['education', 'science', 'technology'],
  music:            ['music'],
  selfimprovement:  ['selfimprovement', 'motivation', 'personal development'],
  motivation:       ['selfimprovement', 'motivation', 'personal development'],
  'personal development': ['selfimprovement', 'motivation', 'personal development'],
  gaming:           ['gaming'],
  travel:           ['travel', 'travel vlogs'],
  'travel vlogs':   ['travel', 'travel vlogs'],
  food:             ['food', 'cooking', 'street food'],
  cooking:          ['food', 'cooking', 'street food'],
  'street food':    ['food', 'cooking', 'street food'],
  fitness:          ['fitness', 'workout', 'bodybuilding', 'strength training'],
  workout:          ['fitness', 'workout', 'bodybuilding'],
  bodybuilding:     ['fitness', 'workout', 'bodybuilding'],
  health:           ['health', 'wellness', 'nutrition'],
  wellness:         ['health', 'wellness', 'nutrition'],
  lifestyle:        ['lifestyle', 'vlog', 'daily vlogs', 'personal vlogs'],
  vlog:             ['lifestyle', 'vlog', 'daily vlogs', 'personal vlogs'],
  'daily vlogs':    ['lifestyle', 'vlog', 'daily vlogs', 'personal vlogs'],
  business:         ['business', 'entrepreneurship', 'startup'],
  entrepreneurship: ['business', 'entrepreneurship', 'startup'],
  startup:          ['business', 'entrepreneurship', 'startup'],
  sports:           ['sports'],
  yoga:             ['yoga'],
  meditation:       ['meditation'],
  defence:          ['defence'],
};

function getNicheCluster(niche) {
  if (!niche) return [];
  return NICHE_CLUSTER_MAP[niche.toLowerCase()] || [niche.toLowerCase()];
}

function nicheMatches(peerNiche, channelNiche) {
  if (!peerNiche || !channelNiche) return false;
  const cluster = getNicheCluster(channelNiche);
  return cluster.includes(peerNiche.toLowerCase());
}

// ── DB helpers ────────────────────────────────────────────────────────────────
function openReadDb() {
  const raw = new BetterSqlite(path.resolve(__dirname, '../data/scoring.db'), {
    readonly: true, fileMustExist: true, timeout: 60000,
  });
  raw.pragma('journal_mode=WAL');
  raw.pragma('busy_timeout=30000');
  const cache = new Map();
  const stmt  = sql => { if (!cache.has(sql)) cache.set(sql, raw.prepare(sql)); return cache.get(sql); };
  return {
    all:         (sql, p = []) => stmt(sql).all(Array.isArray(p) ? p : [p]),
    get:         (sql, p = []) => stmt(sql).get(Array.isArray(p) ? p : [p]),
    run:         () => ({}),
    transaction: fn => fn,
    close:       () => { cache.clear(); raw.close(); },
  };
}

function openWriteDb() {
  const raw = new BetterSqlite(path.resolve(__dirname, '../data/scoring.db'), {
    readonly: false, fileMustExist: true, timeout: 60000,
  });
  raw.pragma('journal_mode=WAL');
  raw.pragma('busy_timeout=60000');
  raw.pragma('synchronous=NORMAL');
  const cache = new Map();
  const stmt  = sql => { if (!cache.has(sql)) cache.set(sql, raw.prepare(sql)); return cache.get(sql); };
  return {
    all:         (sql, p = []) => stmt(sql).all(Array.isArray(p) ? p : [p]),
    get:         (sql, p = []) => stmt(sql).get(Array.isArray(p) ? p : [p]),
    run:         (sql, p = []) => stmt(sql).run(Array.isArray(p) ? p : [p]),
    transaction: fn => raw.transaction(fn),
    close:       () => { cache.clear(); raw.close(); },
  };
}

// ── Metric computation ────────────────────────────────────────────────────────
function computeCommunityMetrics(peerIds, channelRow, peersMeta, oldNiche) {
  const n = peersMeta.length;
  if (n === 0) {
    return {
      topic_precision_after: 0, topic_precision_before: 0, topic_lift: 0,
      lang_precision: 0, audience_precision: 0, fp_rate: 0, peer_count: 0,
    };
  }

  const channelNiche = channelRow.primary_niche;
  const channelLang  = channelRow.primary_language;
  const channelSubs  = channelRow.channel_subscribers || 1;
  const isEnglish    = channelLang === 'en';

  let topicAfterCount = 0, topicBeforeCount = 0;
  let langCount = 0, audCount = 0, fpCount = 0;

  for (const peer of peersMeta) {
    if (nicheMatches(peer.primary_niche, channelNiche)) topicAfterCount++;
    if (oldNiche && nicheMatches(peer.primary_niche, oldNiche))  topicBeforeCount++;

    // Language: match if either side null OR languages equal
    if (!channelLang || !peer.primary_language || peer.primary_language === channelLang) langCount++;

    // Audience: within 10× subscriber range
    const pSubs = peer.channel_subscribers || 1;
    if (pSubs >= channelSubs / 10 && pSubs <= channelSubs * 10) audCount++;

    // False positive: IN-region peer in EN-language channel's pool
    if (isEnglish && peer.region === 'IN') fpCount++;
  }

  const topicAfter  = topicAfterCount / n;
  const topicBefore = oldNiche ? topicBeforeCount / n : topicAfter;

  return {
    topic_precision_after:  parseFloat((topicAfter  * 100).toFixed(1)),
    topic_precision_before: parseFloat((topicBefore * 100).toFixed(1)),
    topic_lift:             parseFloat(((topicAfter - topicBefore) * 100).toFixed(1)),
    lang_precision:         parseFloat((langCount / n * 100).toFixed(1)),
    audience_precision:     parseFloat((audCount  / n * 100).toFixed(1)),
    fp_rate:                parseFloat((fpCount   / n * 100).toFixed(1)),
    peer_count:             n,
  };
}

function computeWtpMetrics(result) {
  if (!result || !result.ok || !Array.isArray(result.ideas)) {
    return { wtp_specificity: null, wtp_composite: null, wtp_idea_count: 0, wtp_specific_count: 0, wtp_ok: false };
  }
  const ideas = result.ideas.slice(0, 15);
  if (ideas.length === 0) {
    return { wtp_specificity: 0, wtp_composite: 0, wtp_idea_count: 0, wtp_specific_count: 0, wtp_ok: true };
  }
  const avgSpec = ideas.reduce((s, i) => s + (i.specificity_score ?? 0), 0) / ideas.length;
  const avgComp = ideas.reduce((s, i) => s + (i.score ?? 0), 0) / ideas.length;
  return {
    wtp_specificity:    parseFloat(avgSpec.toFixed(1)),
    wtp_composite:      parseFloat(avgComp.toFixed(1)),
    wtp_idea_count:     ideas.length,
    wtp_specific_count: ideas.filter(i => (i.specificity_score ?? 0) >= 25).length,
    wtp_ok:             true,
  };
}

// ── Statistics helpers ────────────────────────────────────────────────────────
function avg(arr) {
  const v = arr.filter(x => x !== null && x !== undefined);
  return v.length ? v.reduce((s, x) => s + x, 0) / v.length : 0;
}
function median(arr) {
  const v = arr.filter(x => x !== null && x !== undefined).sort((a, b) => a - b);
  if (!v.length) return 0;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}
function groupBy(arr, key) {
  return arr.reduce((acc, item) => {
    const k = item[key] || '(none)';
    if (!acc[k]) acc[k] = [];
    acc[k].push(item);
    return acc;
  }, {});
}

// ── Formatting helpers ────────────────────────────────────────────────────────
function pad(s, w)   { return String(s ?? '').padEnd(w).slice(0, w); }
function rpad(s, w)  { return String(s ?? '').padStart(w).slice(-w); }
function pp(n)       { return (n >= 0 ? '+' : '') + n.toFixed(1) + 'pp'; }
function pct(n)      { return n == null ? '—' : n.toFixed(1) + '%'; }
function flt(n)      { return n == null ? '—' : n.toFixed(1); }
function num(n)      { return n == null ? '—' : String(n); }
function subs(n)     {
  if (!n) return '—';
  if (n >= 1e6)  return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(0) + 'K';
  return String(n);
}

// ── Main ──────────────────────────────────────────────────────────────────────
const db    = openReadDb();
const dbRw  = openWriteDb();
const wtCtx = buildWhatToPostContext();

// Load repaired channels
let repairedRows = db.all(
  `SELECT rc.channel_id, rc.channel_name, rc.current_niche, rc.suggested_niche,
          rc.repair_reason, rc.channel_subscribers,
          ic.primary_niche, ic.primary_language, ic.region, ic.content_archetype,
          ic.format_type, ic.identity_confidence
   FROM classification_repair_candidates rc
   JOIN ingested_channels ic ON ic.channel_id = rc.channel_id
   WHERE rc.status = 'auto_repaired'
   ORDER BY rc.channel_subscribers DESC`,
);

if (REPAIR_FILTER) {
  repairedRows = repairedRows.filter(r =>
    `${r.current_niche} ${r.suggested_niche}`.toLowerCase().includes(REPAIR_FILTER),
  );
}

// Load control channels (not in repair table, high confidence, varied niches)
const controlRows = db.all(
  `SELECT ic.channel_id, ic.channel_name, ic.primary_niche,
          ic.primary_language, ic.region, ic.content_archetype,
          ic.format_type, ic.channel_subscribers, ic.identity_confidence
   FROM ingested_channels ic
   WHERE ic.ingest_enabled = 1
     AND ic.identity_confidence >= 0.80
     AND ic.channel_subscribers >= 50000
     AND ic.channel_id NOT IN (
       SELECT channel_id FROM classification_repair_candidates
     )
   ORDER BY RANDOM()
   LIMIT ?`,
  [CONTROLS],
);

console.log('\n');
console.log('  ══════════════════════════════════════════════════════════════════════════════════════════════════════');
console.log('  REPAIR IMPACT ANALYSIS  —  ' + new Date().toISOString().slice(0, 16).replace('T', ' ') + '  UTC');
console.log('  ══════════════════════════════════════════════════════════════════════════════════════════════════════');
console.log(`\n  Repaired sample: ${repairedRows.length} channels (auto_repaired)` +
            `   Control sample: ${controlRows.length} channels (confidence ≥ 0.80)`);
console.log(`  WTP scoring: ${NO_WTP ? 'DISABLED (--no-wtp)' : 'ENABLED — all channels'}` +
            (REPAIR_FILTER ? `   Repair filter: "${REPAIR_FILTER}"` : ''));
console.log('\n  Community metrics: BEFORE = % of current peers matching OLD niche');
console.log('                     AFTER  = % of current peers matching NEW niche');
console.log('                     LIFT   = after − before (controls always 0)\n');

// ── Process channels ──────────────────────────────────────────────────────────
const results = [];
let processed = 0;
const allChannels = [
  ...repairedRows.map(r => ({ ...r, is_repaired: true,  old_niche: r.current_niche })),
  ...controlRows.map(r  => ({ ...r, is_repaired: false, old_niche: null })),
];

const startMs = Date.now();

for (const ch of allChannels) {
  processed++;
  if (processed === 1 || processed % 20 === 0 || processed === allChannels.length) {
    const elapsed = ((Date.now() - startMs) / 1000).toFixed(0);
    process.stdout.write(`\r  Processing ${processed}/${allChannels.length} channels... (${elapsed}s elapsed)   `);
  }

  let communityMetrics = null;
  let wtpMetrics       = { wtp_specificity: null, wtp_composite: null, wtp_idea_count: null, wtp_specific_count: null, wtp_ok: false };
  let peerCount        = 0;
  let errMsg           = null;

  try {
    // ── Peer resolution (read-only) ─────────────────────────────────────────
    const peerResult = resolveCreatorPeerContext(db, ch.channel_id);
    const peerIds    = peerResult.peerIds || [];
    peerCount = peerIds.length;

    let peersMeta = [];
    if (peerIds.length > 0) {
      const ph = peerIds.map(() => '?').join(',');
      peersMeta = db.all(
        `SELECT channel_id, primary_niche, primary_language, region, channel_subscribers
         FROM ingested_channels WHERE channel_id IN (${ph})`,
        peerIds,
      );
    }

    communityMetrics = computeCommunityMetrics(peerIds, ch, peersMeta, ch.old_niche);

    // ── WTP (writable handle for cache) ────────────────────────────────────
    if (!NO_WTP) {
      try {
        const wtpResult = computeWhatToPost(dbRw, { channel_id: ch.channel_id }, wtCtx);
        wtpMetrics      = computeWtpMetrics(wtpResult);
      } catch (wtpErr) {
        wtpMetrics = { wtp_specificity: null, wtp_composite: null, wtp_idea_count: null, wtp_specific_count: null, wtp_ok: false };
      }
    }
  } catch (e) {
    errMsg = e.message?.slice(0, 80);
    communityMetrics = {
      topic_precision_after: 0, topic_precision_before: 0, topic_lift: 0,
      lang_precision: 0, audience_precision: 0, fp_rate: 0, peer_count: 0,
    };
  }

  results.push({
    channel_id:           ch.channel_id,
    channel_name:         ch.channel_name,
    is_repaired:          ch.is_repaired,
    old_niche:            ch.old_niche,
    new_niche:            ch.primary_niche,
    repair_type:          ch.is_repaired ? `${ch.old_niche} → ${ch.primary_niche}` : null,
    channel_subscribers:  ch.channel_subscribers,
    content_archetype:    ch.content_archetype,
    identity_confidence:  ch.identity_confidence,
    ...communityMetrics,
    ...wtpMetrics,
    error: errMsg,
  });
}

console.log('\n');
const totalElapsed = ((Date.now() - startMs) / 1000).toFixed(1);
console.log(`  Completed in ${totalElapsed}s\n`);

// ── Aggregate ─────────────────────────────────────────────────────────────────
const repaired = results.filter(r => r.is_repaired && !r.error);
const controls = results.filter(r => !r.is_repaired && !r.error);
const errors   = results.filter(r => r.error);

// ── Overall comparison table ──────────────────────────────────────────────────
console.log('  ── OVERALL METRIC COMPARISON ──────────────────────────────────────────────────────────────────────');
console.log(`\n  ${pad('Metric', 26)} ${rpad('Rep-after', 11)} ${rpad('Rep-before', 11)} ${rpad('Control', 10)} ${rpad('Lift avg', 10)} ${rpad('Lift med', 10)}\n`);

const rTopicAfter  = repaired.map(r => r.topic_precision_after);
const rTopicBefore = repaired.map(r => r.topic_precision_before);
const rTopicLift   = repaired.map(r => r.topic_lift);
const cTopicAfter  = controls.map(r => r.topic_precision_after);

const rows_comparison = [
  {
    label:    'Topic Precision',
    rAfter:   avg(rTopicAfter),  rBefore: avg(rTopicBefore), ctrl: avg(cTopicAfter),
    liftAvg:  avg(rTopicLift),   liftMed: median(rTopicLift),
    hasBefore: true,
  },
  {
    label:  'Language Precision',
    rAfter: avg(repaired.map(r => r.lang_precision)),
    rBefore: null, ctrl: avg(controls.map(r => r.lang_precision)),
    liftAvg: null,
  },
  {
    label:  'Audience Precision',
    rAfter: avg(repaired.map(r => r.audience_precision)),
    rBefore: null, ctrl: avg(controls.map(r => r.audience_precision)),
    liftAvg: null,
  },
  {
    label:  'False Positive Rate',
    rAfter: avg(repaired.map(r => r.fp_rate)),
    rBefore: null, ctrl: avg(controls.map(r => r.fp_rate)),
    liftAvg: null, inverse: true,
  },
  {
    label:  'WTP Specificity',
    rAfter: NO_WTP ? null : avg(repaired.filter(r => r.wtp_ok).map(r => r.wtp_specificity)),
    rBefore: null, ctrl: NO_WTP ? null : avg(controls.filter(r => r.wtp_ok).map(r => r.wtp_specificity)),
    liftAvg: null,
  },
  {
    label:  'WTP Composite Score',
    rAfter: NO_WTP ? null : avg(repaired.filter(r => r.wtp_ok).map(r => r.wtp_composite)),
    rBefore: null, ctrl: NO_WTP ? null : avg(controls.filter(r => r.wtp_ok).map(r => r.wtp_composite)),
    liftAvg: null,
  },
];

for (const row of rows_comparison) {
  const afterStr   = row.rAfter  != null ? pct(row.rAfter)  : '—';
  const beforeStr  = row.hasBefore && row.rBefore != null ? pct(row.rBefore) : '—';
  const ctrlStr    = row.ctrl    != null ? pct(row.ctrl)    : '—';
  let   liftAvgStr = '—', liftMedStr = '—';

  if (row.hasBefore && row.liftAvg != null) {
    liftAvgStr = pp(row.liftAvg);
    liftMedStr = pp(row.liftMed);
  } else if (!row.hasBefore && row.rAfter != null && row.ctrl != null) {
    liftAvgStr = pp(row.rAfter - row.ctrl);
    liftMedStr = '(vs ctrl)';
  }

  console.log(`  ${pad(row.label, 26)} ${rpad(afterStr, 11)} ${rpad(beforeStr, 11)} ${rpad(ctrlStr, 10)} ${rpad(liftAvgStr, 10)} ${rpad(liftMedStr, 10)}`);
}

// ── Topic lift by repair type ─────────────────────────────────────────────────
console.log('\n  ── TOPIC LIFT BY REPAIR TYPE ───────────────────────────────────────────────────────────────────────\n');
console.log(`  ${pad('Repair type', 30)} ${rpad('N', 5)} ${rpad('Avg lift', 10)} ${rpad('Med lift', 10)} ${rpad('Min', 8)} ${rpad('Max', 8)} ${rpad('WTP spec', 10)}\n`);

const byType = groupBy(repaired, 'repair_type');
const typeEntries = Object.entries(byType)
  .map(([type, rows]) => ({
    type,
    n:        rows.length,
    avgLift:  avg(rows.map(r => r.topic_lift)),
    medLift:  median(rows.map(r => r.topic_lift)),
    minLift:  Math.min(...rows.map(r => r.topic_lift)),
    maxLift:  Math.max(...rows.map(r => r.topic_lift)),
    avgSpec:  NO_WTP ? null : avg(rows.filter(r => r.wtp_ok).map(r => r.wtp_specificity)),
  }))
  .sort((a, b) => b.avgLift - a.avgLift);

for (const t of typeEntries) {
  const specStr = t.avgSpec != null ? flt(t.avgSpec) : '—';
  console.log(
    `  ${pad(t.type, 30)} ${rpad(t.n, 5)} ` +
    `${rpad(pp(t.avgLift), 10)} ${rpad(pp(t.medLift), 10)} ` +
    `${rpad(pp(t.minLift), 8)} ${rpad(pp(t.maxLift), 8)} ` +
    `${rpad(specStr, 10)}`,
  );
}

// ── Top improvements ──────────────────────────────────────────────────────────
console.log(`\n  ── TOP ${TOP} IMPROVEMENTS (by topic_lift) ─────────────────────────────────────────────────────────\n`);
console.log(
  `  ${rpad('#', 3)}  ${pad('Channel', 32)} ${pad('Repair type', 28)} ` +
  `${rpad('Subs', 8)} ${rpad('Lift', 8)} ${rpad('Before', 7)} ${rpad('After', 7)} ` +
  `${rpad('Spec', 5)} ${rpad('Comp', 5)} ${rpad('FP%', 5)}\n`,
);

const topImprovements = [...repaired]
  .sort((a, b) => b.topic_lift - a.topic_lift)
  .slice(0, TOP);

topImprovements.forEach((r, i) => {
  const spec = r.wtp_ok && r.wtp_specificity != null ? r.wtp_specificity.toFixed(0) : '—';
  const comp = r.wtp_ok && r.wtp_composite != null   ? r.wtp_composite.toFixed(0)   : '—';
  console.log(
    `  ${rpad(i + 1, 3)}. ${pad(r.channel_name, 32)} ${pad(r.repair_type || '—', 28)} ` +
    `${rpad(subs(r.channel_subscribers), 8)} ${rpad(pp(r.topic_lift), 8)} ` +
    `${rpad(pct(r.topic_precision_before), 7)} ${rpad(pct(r.topic_precision_after), 7)} ` +
    `${rpad(spec, 5)} ${rpad(comp, 5)} ${rpad(pct(r.fp_rate), 5)}`,
  );
});

// ── Worst regressions ─────────────────────────────────────────────────────────
const regressions = repaired.filter(r => r.topic_lift < 0).sort((a, b) => a.topic_lift - b.topic_lift);
console.log(`\n  ── REGRESSIONS (topic_lift < 0)  ───────────────────────────────────────────────────────────────────\n`);
if (regressions.length === 0) {
  console.log('  ✓ No regressions — all repaired channels maintained or improved topic precision.\n');
} else {
  console.log(`  ${rpad('#', 3)}  ${pad('Channel', 32)} ${pad('Repair type', 28)} ${rpad('Lift', 8)} ${rpad('Before', 7)} ${rpad('After', 7)}\n`);
  regressions.slice(0, 10).forEach((r, i) => {
    console.log(
      `  ${rpad(i + 1, 3)}. ${pad(r.channel_name, 32)} ${pad(r.repair_type || '—', 28)} ` +
      `${rpad(pp(r.topic_lift), 8)} ${rpad(pct(r.topic_precision_before), 7)} ${rpad(pct(r.topic_precision_after), 7)}`,
    );
  });
  console.log('');
}

// ── WTP quality comparison ────────────────────────────────────────────────────
if (!NO_WTP) {
  const repWtpOk  = repaired.filter(r => r.wtp_ok);
  const ctrlWtpOk = controls.filter(r => r.wtp_ok);

  console.log('  ── WTP QUALITY (REPAIRED vs CONTROLS) ──────────────────────────────────────────────────────────────\n');
  console.log(`  ${pad('Metric', 26)} ${rpad('Repaired', 12)} ${rpad('Control', 12)} ${rpad('Delta', 12)}\n`);

  const wtpMetricsComp = [
    { label: 'Avg Specificity (0-100)', rVals: repWtpOk.map(r => r.wtp_specificity), cVals: ctrlWtpOk.map(r => r.wtp_specificity) },
    { label: 'Avg Composite Score',     rVals: repWtpOk.map(r => r.wtp_composite),   cVals: ctrlWtpOk.map(r => r.wtp_composite)   },
    { label: 'Avg Idea Count',          rVals: repWtpOk.map(r => r.wtp_idea_count),  cVals: ctrlWtpOk.map(r => r.wtp_idea_count)  },
    { label: 'Avg Specific Ideas (≥25)',rVals: repWtpOk.map(r => r.wtp_specific_count), cVals: ctrlWtpOk.map(r => r.wtp_specific_count) },
  ];

  for (const m of wtpMetricsComp) {
    const rAvg = avg(m.rVals);
    const cAvg = avg(m.cVals);
    const delta = rAvg - cAvg;
    console.log(
      `  ${pad(m.label, 26)} ${rpad(flt(rAvg), 12)} ${rpad(flt(cAvg), 12)} ` +
      `${rpad((delta >= 0 ? '+' : '') + flt(delta), 12)}`,
    );
  }

  // By repair type — WTP specificity
  console.log(`\n  WTP Specificity by repair type:\n`);
  for (const t of typeEntries) {
    const rows = byType[t.type].filter(r => r.wtp_ok && r.wtp_specificity != null);
    if (rows.length === 0) continue;
    const aSpec = avg(rows.map(r => r.wtp_specificity));
    const aComp = avg(rows.map(r => r.wtp_composite));
    console.log(`    ${pad(t.type, 30)}  n=${rows.length}  specificity=${flt(aSpec)}  composite=${flt(aComp)}`);
  }
  console.log('');
}

// ── Peer count distribution ───────────────────────────────────────────────────
const repPeerCounts = repaired.map(r => r.peer_count);
const ctrlPeerCounts = controls.map(r => r.peer_count);
console.log('  ── PEER POOL SIZES ─────────────────────────────────────────────────────────────────────────────────\n');
console.log(`  ${pad('Group', 12)} ${rpad('N', 5)} ${rpad('Avg peers', 12)} ${rpad('Med peers', 12)} ${rpad('P5', 8)} ${rpad('P95', 8)}\n`);

function pN(arr, p) {
  const s = [...arr].sort((a, b) => a - b);
  const idx = Math.floor(s.length * p / 100);
  return s[Math.min(idx, s.length - 1)] ?? 0;
}

console.log(`  ${pad('Repaired', 12)} ${rpad(repaired.length, 5)} ${rpad(flt(avg(repPeerCounts)), 12)} ${rpad(flt(median(repPeerCounts)), 12)} ${rpad(pN(repPeerCounts, 5), 8)} ${rpad(pN(repPeerCounts, 95), 8)}`);
console.log(`  ${pad('Control', 12)} ${rpad(controls.length, 5)} ${rpad(flt(avg(ctrlPeerCounts)), 12)} ${rpad(flt(median(ctrlPeerCounts)), 12)} ${rpad(pN(ctrlPeerCounts, 5), 8)} ${rpad(pN(ctrlPeerCounts, 95), 8)}`);

// ── Verdict ───────────────────────────────────────────────────────────────────
console.log('\n  ── VERDICT ──────────────────────────────────────────────────────────────────────────────────────────\n');

const avgLift    = avg(repaired.map(r => r.topic_lift));
const medLift    = median(repaired.map(r => r.topic_lift));
const regCount   = regressions.length;
const regRate    = repaired.length > 0 ? regCount / repaired.length : 0;
const ctrlSpec   = NO_WTP ? null : avg(controls.filter(r => r.wtp_ok).map(r => r.wtp_specificity));
const repSpec    = NO_WTP ? null : avg(repaired.filter(r => r.wtp_ok).map(r => r.wtp_specificity));

// Regression types for the verdict footnote
const regByType = {};
for (const r of regressions) {
  regByType[r.repair_type] = (regByType[r.repair_type] || 0) + 1;
}
const regNote = Object.entries(regByType)
  .sort((a, b) => b[1] - a[1])
  .map(([t, n]) => `${t} (${n})`)
  .join(', ');

const qualifies = avgLift >= 40 && regRate < 0.15;
const cautious  = avgLift >= 20 && regRate < 0.25;

if (qualifies) {
  console.log(`  ✅  PROCEED — Topic precision improved avg ${pp(avgLift)} (med ${pp(medLift)}).`);
  console.log(`      ${regCount}/${repaired.length} channels regressed (${(regRate * 100).toFixed(0)}%) — within acceptable threshold.`);
  if (regCount > 0) console.log(`      Regression types: ${regNote}`);
  if (repSpec != null && ctrlSpec != null) {
    const specDelta = repSpec - ctrlSpec;
    console.log(`      WTP specificity delta vs controls: ${(specDelta >= 0 ? '+' : '') + flt(specDelta)}.`);
  }
  console.log(`      → Recommend: proceed with reclassifying the 6,074 queued channels.`);
} else if (cautious) {
  console.log(`  ⚠️   CAUTIOUS — Topic precision improved avg ${pp(avgLift)} (med ${pp(medLift)}).`);
  console.log(`      ${regCount}/${repaired.length} channels regressed (${(regRate * 100).toFixed(0)}%). Review specific types before bulk run.`);
  if (regCount > 0) console.log(`      Regression types: ${regNote}`);
  console.log(`      → Recommend: exclude regression repair types from bulk reclassification, or review individually.`);
} else {
  console.log(`  ❌  REVIEW NEEDED — avg lift ${pp(avgLift)} (med ${pp(medLift)}), regression rate ${(regRate * 100).toFixed(0)}%.`);
  console.log(`      High regression rate or low lift. Investigate before proceeding.`);
  if (regCount > 0) console.log(`      Regression types: ${regNote}`);
}

if (errors.length > 0) {
  console.log(`\n  ⚠  ${errors.length} channel(s) failed peer resolution (excluded from metrics above):`);
  errors.slice(0, 5).forEach(r => console.log(`     - ${r.channel_name}: ${r.error}`));
}

console.log('\n  ══════════════════════════════════════════════════════════════════════════════════════════════════════\n');

// ── Cleanup ───────────────────────────────────────────────────────────────────
try { db.close(); }   catch (_) {}
try { dbRw.close(); } catch (_) {}

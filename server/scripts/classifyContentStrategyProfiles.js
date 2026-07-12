'use strict';

const { getDb } = require('../db/init');
const { classifyChannel, upsertCSP, CSP_PROFILE_VERSION } = require('../services/contentStrategyProfile');

const KNOWN_CHANNELS = [
  { name: 'Raj Shamani',          expected: 'indian_business_selfimprovement_podcast' },
  { name: 'BeerBiceps',           expected: 'spiritual_geopolitics_guest_show' },
  { name: 'Finance With Sharan',  expected: 'personal_finance_guest_show' },
  { name: 'Think School',         expected: 'business_case_study' },
  { name: 'Aevy TV',              expected: 'curiosity_explainer' },
  { name: 'Nikhil Kamath',        expected: 'founder_economy_conversation' },
  { name: 'Pranjal Kamra',        expected: 'finance_investment_education' },
  { name: 'Dr Amiett Kumar',      expected: 'wellness_transformation_teaching' },
  { name: 'UPSC Wallah',          expected: 'exam_demand_teaching' },
  { name: 'Aaj Tak',              expected: 'news_event_bulletin' },
  { name: 'Sadhguru',             expected: 'spiritual_teaching_solo' },
  { name: 'Technical Guruji',     expected: 'tech_review_gadget' },
  { name: 'Yoga With Adriene',    expected: 'yoga_fitness_practice' },
];

// CSPs for the top-10 deep-dive section
const DEEP_DIVE_CSPS = [
  'spiritual_teaching_solo',
  'indian_business_selfimprovement_podcast',
  'business_case_study',
  'curiosity_explainer',
  'finance_investment_education',
  'founder_economy_conversation',
  'personal_finance_guest_show',
  'spiritual_geopolitics_guest_show',
];

const BATCH_SIZE = 200;
const FORCE = process.argv.includes('--force');

function fmt(n, dec = 0) {
  if (n == null) return '—';
  return Number(n).toFixed(dec);
}

function lookupChannel(db, name) {
  return db.get(
    `SELECT channel_id, channel_name FROM ingested_channels
     WHERE lower(channel_name) LIKE ? ORDER BY channel_subscribers DESC LIMIT 1`,
    [`%${name.toLowerCase()}%`],
  );
}

function getCsp(db, channelId) {
  return db.get(
    `SELECT primary_csp, secondary_csp_1, secondary_csp_2, confidence,
            confidence_score, signal_source, guest_signal
     FROM channel_content_strategy_profiles WHERE channel_id = ?`,
    [channelId],
  );
}

function main() {
  const db = getDb();

  const tableReady = db.get(
    `SELECT 1 FROM sqlite_master WHERE type='table' AND name='channel_content_strategy_profiles'`,
  );
  if (!tableReady) {
    console.error('\nERROR: channel_content_strategy_profiles table does not exist.');
    console.error('Restart the server once to apply the DB migration, then re-run this script.\n');
    process.exit(1);
  }

  // ── Snapshot "before" state for known channels ─────────────────────────────
  const before = {};
  for (const { name } of KNOWN_CHANNELS) {
    const ch = lookupChannel(db, name);
    if (ch) before[name] = getCsp(db, ch.channel_id);
  }

  const allEnabled = db.get('SELECT COUNT(*) AS n FROM ingested_channels WHERE ingest_enabled = 1')?.n ?? 0;
  const targets = db.all(
    `SELECT ic.channel_id
     FROM ingested_channels ic
     LEFT JOIN channel_content_strategy_profiles ccsp ON ccsp.channel_id = ic.channel_id
     WHERE ic.ingest_enabled = 1
       ${FORCE ? '' : 'AND (ccsp.version IS NULL OR ccsp.version < ?)'}
     ORDER BY ic.channel_id`,
    FORCE ? [] : [CSP_PROFILE_VERSION],
  );
  const total = targets.length;
  console.log(`\n=== Content Strategy Profile Classification (v${CSP_PROFILE_VERSION}) ===`);
  console.log(`Channels to classify: ${total} / ${allEnabled} enabled  (force=${FORCE})`);

  let classified = 0;
  let skipped = 0;

  for (let offset = 0; offset < targets.length; offset += BATCH_SIZE) {
    const batch = targets.slice(offset, offset + BATCH_SIZE);
    for (const { channel_id } of batch) {
      try {
        const cspData = classifyChannel(db, channel_id);
        upsertCSP(db, channel_id, cspData);
        classified++;
      } catch (e) {
        skipped++;
        if (skipped <= 5) console.warn(`  [skip] ${channel_id}: ${e.message}`);
      }
    }

    if (offset % 2000 === 0) {
      process.stdout.write(`  ${offset} / ${total}  classified=${classified} skipped=${skipped}\r`);
    }
  }

  console.log(`\nDone. classified=${classified} skipped=${skipped}\n`);

  // ── Known-Channel Audit (before → after) ──────────────────────────────────
  console.log('=== Known-Channel Audit (before → after) ===');
  let pass = 0;
  let fail = 0;
  for (const { name, expected } of KNOWN_CHANNELS) {
    const ch = lookupChannel(db, name);
    if (!ch) { console.log(`  [MISSING] ${name}`); continue; }

    const prev = before[name];
    const csp  = getCsp(db, ch.channel_id);
    if (!csp) { console.log(`  [NO CSP]  ${name}`); fail++; continue; }

    const ok   = csp.primary_csp === expected;
    ok ? pass++ : fail++;
    const mark = ok ? '✓' : '✗';
    const sec  = [csp.secondary_csp_1, csp.secondary_csp_2].filter(Boolean).join(', ') || '—';
    const sigs = (() => { try { return JSON.parse(csp.signal_source || '[]').join(', ') || '—'; } catch { return '—'; } })();
    const prevLabel = prev?.primary_csp ?? '(new)';
    const changed   = prev && prev.primary_csp !== csp.primary_csp ? ` [was: ${prevLabel}]` : '';

    console.log(`  [${mark}] ${name.padEnd(26)} → ${csp.primary_csp}${changed}`);
    console.log(`       conf=${csp.confidence} (${fmt(csp.confidence_score * 100)}%)  guest=${fmt(csp.guest_signal * 100)}%  signals: ${sigs}`);
    if (!ok) console.log(`       EXPECTED: ${expected}`);
    if (sec !== '—') console.log(`       secondary: ${sec}`);
  }
  console.log(`\nAudit: ${pass} pass, ${fail} fail out of ${KNOWN_CHANNELS.length}\n`);

  // ── CSP Distribution ──────────────────────────────────────────────────────
  const dist = db.all(
    `SELECT ccsp.primary_csp, COUNT(*) AS n
     FROM channel_content_strategy_profiles ccsp
     JOIN ingested_channels ic ON ic.channel_id = ccsp.channel_id
     WHERE ic.ingest_enabled = 1
     GROUP BY ccsp.primary_csp
     ORDER BY n DESC`,
  );
  console.log('=== CSP Distribution ===');
  for (const { primary_csp, n } of dist) {
    const pct = allEnabled > 0 ? (n / allEnabled * 100).toFixed(1) : '0.0';
    const bar = '█'.repeat(Math.max(1, Math.round(n / Math.max(1, allEnabled) * 40)));
    console.log(`  ${primary_csp.padEnd(46)} ${String(n).padStart(5)} (${pct}%)  ${bar}`);
  }

  // ── Confidence Breakdown ──────────────────────────────────────────────────
  const confDist = db.all(
    `SELECT confidence, COUNT(*) AS n FROM channel_content_strategy_profiles GROUP BY confidence ORDER BY n DESC`,
  );
  console.log('\n=== Confidence Breakdown ===');
  for (const { confidence, n } of confDist) {
    console.log(`  ${confidence.padEnd(12)}: ${n}`);
  }

  // ── Top 10 per target CSP (by subscribers) ────────────────────────────────
  console.log('\n=== Top 10 Channels per Target CSP (by subscribers) ===');
  for (const csp of DEEP_DIVE_CSPS) {
    const top = db.all(
      `SELECT ic.channel_name, ic.channel_subscribers, ccsp.confidence
       FROM channel_content_strategy_profiles ccsp
       JOIN ingested_channels ic ON ic.channel_id = ccsp.channel_id
       WHERE ccsp.primary_csp = ?
       ORDER BY ic.channel_subscribers DESC LIMIT 10`,
      [csp],
    );
    const count = db.get(`SELECT COUNT(*) AS n FROM channel_content_strategy_profiles WHERE primary_csp = ?`, [csp]);
    console.log(`\n  ${csp} (total: ${count?.n ?? 0}):`);
    for (const r of top) {
      const subs = r.channel_subscribers ? `${(r.channel_subscribers / 1e6).toFixed(1)}M` : '?';
      console.log(`    ${(r.channel_name ?? '?').padEnd(34)} ${subs.padStart(7)}  ${r.confidence}`);
    }
  }

  // ── Suspicious secondaries ────────────────────────────────────────────────
  console.log('\n=== Suspicious Secondary CSPs ===');
  const suspicious = db.all(
    `SELECT ccsp.channel_id, ic.channel_name, ccsp.primary_csp, ccsp.secondary_csp_1, ccsp.secondary_csp_2
     FROM channel_content_strategy_profiles ccsp
     JOIN ingested_channels ic ON ic.channel_id = ccsp.channel_id
     WHERE
       (ccsp.primary_csp = 'news_event_bulletin'    AND (ccsp.secondary_csp_1 IN ('spiritual_teaching_solo','yoga_fitness_practice') OR ccsp.secondary_csp_2 IN ('spiritual_teaching_solo','yoga_fitness_practice')))
    OR (ccsp.primary_csp = 'tech_review_gadget'     AND (ccsp.secondary_csp_1 = 'yoga_fitness_practice' OR ccsp.secondary_csp_2 = 'yoga_fitness_practice'))
    OR (ccsp.primary_csp = 'exam_demand_teaching'   AND (ccsp.secondary_csp_1 IN ('spiritual_teaching_solo','yoga_fitness_practice') OR ccsp.secondary_csp_2 IN ('spiritual_teaching_solo','yoga_fitness_practice')))
    OR (ccsp.primary_csp = 'indian_business_selfimprovement_podcast' AND (ccsp.secondary_csp_1 = 'exam_demand_teaching' OR ccsp.secondary_csp_2 = 'exam_demand_teaching'))
     LIMIT 20`,
  );
  if (!suspicious.length) {
    console.log('  None found. Secondary suppression is working.');
  } else {
    for (const r of suspicious) {
      const sec = [r.secondary_csp_1, r.secondary_csp_2].filter(Boolean).join(', ');
      console.log(`  ${(r.channel_name ?? r.channel_id).padEnd(30)}  primary=${r.primary_csp}  secondary=${sec}`);
    }
  }

  // ── Low-confidence bottom 10 ──────────────────────────────────────────────
  const lowConf = db.all(
    `SELECT ccsp.channel_id, ic.channel_name, ccsp.primary_csp, ccsp.confidence_score
     FROM channel_content_strategy_profiles ccsp
     JOIN ingested_channels ic ON ic.channel_id = ccsp.channel_id
     WHERE ccsp.confidence = 'low'
     ORDER BY ccsp.confidence_score ASC LIMIT 10`,
  );
  if (lowConf.length) {
    console.log('\n=== Low-Confidence Channels (bottom 10) ===');
    for (const r of lowConf) {
      console.log(`  ${(r.channel_name ?? r.channel_id).slice(0, 35).padEnd(36)} → ${r.primary_csp} (${fmt(r.confidence_score * 100)}%)`);
    }
  }

  console.log('');
}

main();

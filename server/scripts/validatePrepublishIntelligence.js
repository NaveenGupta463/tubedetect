'use strict';

require('dotenv').config({ path: __dirname + '/../.env' });

const { getDb }                         = require('../db/init');
const { computePrepublishIntelligence } = require('../services/prepublishIntelligence');

// ── Sample titles ─────────────────────────────────────────────────────────────

const SAMPLES = [
  // Raj Shamani — business podcast
  { label: 'Raj Shamani',         title: 'How Zepto\'s Founder Built a ₹3000 Crore Startup in 2 Years',              niche: 'business',   channel: 'Raj Shamani',    duration_seconds: 3600 },
  { label: 'Raj Shamani',         title: 'Why Most Entrepreneurs Fail in Their First Business',                        niche: 'business',   channel: 'Raj Shamani',    duration_seconds: 3600 },

  // BeerBiceps — spirituality / self-improvement
  { label: 'BeerBiceps',          title: 'The Truth About Manifestation That Nobody Tells You',                        niche: 'lifestyle',  channel: 'BeerBiceps',     duration_seconds: 3000 },
  { label: 'BeerBiceps',          title: 'How to Unlock Your Higher Self — Ancient Wisdom Explained',                  niche: 'philosophy', channel: 'BeerBiceps',     duration_seconds: 3600 },

  // UPSC Wallah — exam
  { label: 'UPSC Wallah',         title: 'Complete Indian Polity in One Shot — UPSC 2025',                             niche: 'education',  channel: 'UPSC Wallah',    duration_seconds: 7200 },
  { label: 'UPSC Wallah',         title: 'Mains Answer Writing Mistakes Every Aspirant Makes',                         niche: 'education',  channel: 'UPSC Wallah',    duration_seconds: 2400 },

  // Aaj Tak — news
  { label: 'Aaj Tak',             title: 'Breaking News: Massive Earthquake Hits Himalayan Region',                    niche: 'news',       channel: 'Aaj Tak',        duration_seconds: 180 },
  { label: 'Aaj Tak',             title: 'Operation Sindoor — India\'s Military Response Explained',                   niche: 'news',       channel: 'Aaj Tak',        duration_seconds: 600 },

  // Finance
  { label: 'Finance',             title: '5 Mutual Funds That Beat Nifty Every Year Since 2015',                       niche: 'finance',    channel: null,             duration_seconds: 900 },
  { label: 'Finance',             title: 'Stock Market Crash Coming? Top Experts Warn of This Signal',                 niche: 'finance',    channel: null,             duration_seconds: 600 },

  // Tech / AI
  { label: 'Tech / AI',           title: 'GPT-5 Released — This Changes Everything About AI',                          niche: 'technology', channel: null,             duration_seconds: 600 },
  { label: 'Tech / AI',           title: '10 AI Tools That Will Replace Your Entire Workflow in 2025',                 niche: 'technology', channel: null,             duration_seconds: 900 },

  // Manifestation / healing
  { label: 'Manifestation',       title: '777 Method That Made My Dream Life Real in 30 Days',                         niche: 'lifestyle',  channel: null,             duration_seconds: 900 },
  { label: 'Manifestation',       title: 'Why Your Manifestations Are Not Working — The Hidden Block',                 niche: 'lifestyle',  channel: null,             duration_seconds: 600 },

  // Weak / random titles
  { label: 'Weak/random',         title: 'My Video About Things',                                                      niche: null,         channel: null,             duration_seconds: null },
  { label: 'Weak/random',         title: 'Today\'s Vlog June 2025',                                                    niche: null,         channel: null,             duration_seconds: null },
  { label: 'Weak/random (niche)', title: 'asjdkf lkjsdf hello world random xyz',                                       niche: 'education',  channel: null,             duration_seconds: 300 },
];

// ── Resolve channel IDs from DB ───────────────────────────────────────────────

function resolveChannelIds(db) {
  const map = {};
  for (const s of SAMPLES) {
    if (!s.channel || map[s.channel] !== undefined) continue;
    const row = db.get(
      `SELECT channel_id FROM ingested_channels WHERE channel_name LIKE ? LIMIT 1`,
      [`%${s.channel}%`],
    );
    map[s.channel] = row?.channel_id ?? null;
  }
  return map;
}

// ── Formatting helpers ─────────────────────────────────────────────────────────

function trunc(str, len) {
  if (!str) return '—';
  return str.length > len ? str.slice(0, len - 1) + '…' : str;
}

function pad(str, len) {
  const s = String(str ?? '—');
  return s.length >= len ? s.slice(0, len) : s + ' '.repeat(len - s.length);
}

function adjSign(n) {
  if (n == null) return '  —';
  if (n > 0) return `+${n} `.padStart(4);
  return String(n).padStart(4);
}

function confidenceChar(c) {
  return { high: 'H', medium: 'M', low: 'L', none: '—' }[c] ?? '?';
}

// ── Suspicious-case detector ───────────────────────────────────────────────────

function detectSuspicious(r, result) {
  const flags = [];
  const adj   = result.data_adjustment ?? 0;
  const conf  = result.data_confidence;
  const nb    = result.niche_benchmark;
  const cb    = result.cluster_avg_vph;
  const stage = result.lifecycle_stage;
  const tier  = result.topic_signals?.tier;

  if ((conf === 'none' || conf === 'low') && Math.abs(adj) > 3)
    flags.push(`low-conf(${conf}) but adj=${adj}`);

  if (!nb && !cb && Math.abs(adj) > 3)
    flags.push(`no benchmark but adj=${adj}`);

  if (r.label === 'Weak/random' && adj > 0)
    flags.push(`random title got positive adj=${adj}`);

  if (stage === 'saturated' && adj > 0)
    flags.push(`saturated lifecycle but adj=${adj}`);

  if ((tier === 'rising' || tier === 'emerging') && adj < 0)
    flags.push(`rising/emerging topic but adj=${adj}`);

  return flags;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const db         = getDb();
  const channelMap = resolveChannelIds(db);

  console.log('\n── Channel resolution ──────────────────────────────────────');
  for (const [name, id] of Object.entries(channelMap)) {
    console.log(`  ${id ? '✓' : '✗'} ${name}: ${id ?? 'not found in DB'}`);
  }

  console.log('\n── Results ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────');

  const HEADER = [
    pad('Label',         14),
    pad('Cluster',       14),
    pad('FitScore',       8),
    pad('Adj',            5),
    pad('Conf',           5),
    pad('Saturation',    11),
    pad('Stage',         10),
    pad('Topic / Tier',  22),
    'Reasons',
  ].join(' | ');
  console.log(HEADER);
  console.log('─'.repeat(HEADER.length));

  let suspiciousTotal = 0;
  const suspiciousLines = [];

  for (const s of SAMPLES) {
    const channel_id = s.channel ? (channelMap[s.channel] ?? null) : null;

    let result;
    try {
      result = await computePrepublishIntelligence(db, {
        title:            s.title,
        niche:            s.niche ?? null,
        channel_id,
        duration_seconds: s.duration_seconds ?? null,
      });
    } catch (err) {
      console.log(`  ✗ ERROR for "${s.title}": ${err.message}`);
      continue;
    }

    const topicStr = result.topic_signals
      ? `${trunc(result.topic_signals.topic, 14)} (${result.topic_signals.tier})`
      : '—';

    const reasonsStr = result.adjustment_reasons?.length
      ? result.adjustment_reasons.map(r => trunc(r, 55)).join(' / ')
      : '—';

    const row = [
      pad(s.label,                              14),
      pad(result.semantic_cluster,              14),
      pad(result.intelligence_fit_score,         8),
      pad(adjSign(result.data_adjustment),       5),
      pad(confidenceChar(result.data_confidence), 5),
      pad(result.saturation_level,              11),
      pad(result.lifecycle_stage,               10),
      pad(topicStr,                             22),
      reasonsStr,
    ].join(' | ');
    console.log(row);

    const flags = detectSuspicious(s, result);
    if (flags.length) {
      suspiciousTotal += flags.length;
      for (const f of flags) {
        const line = `  ⚠  ${s.label} — "${trunc(s.title, 60)}" → ${f}`;
        suspiciousLines.push(line);
      }
    }
  }

  console.log('\n── Detailed breakdown ──────────────────────────────────────');
  for (const s of SAMPLES) {
    const channel_id = s.channel ? (channelMap[s.channel] ?? null) : null;
    let result;
    try {
      result = await computePrepublishIntelligence(db, {
        title:            s.title,
        niche:            s.niche ?? null,
        channel_id,
        duration_seconds: s.duration_seconds ?? null,
      });
    } catch { continue; }

    console.log(`\n  [${s.label}] "${trunc(s.title, 72)}"`);
    console.log(`    niche=${result.niche_benchmark ? s.niche : '—'}  cluster=${result.semantic_cluster ?? '—'}  fit=${result.intelligence_fit_score}  adj=${adjSign(result.data_adjustment).trim()}  conf=${result.data_confidence}`);
    if (result.niche_benchmark) {
      console.log(`    niche_benchmark: median_vph=${result.niche_benchmark.median_vph}  p75=${result.niche_benchmark.p75_vph}  dur=${result.niche_benchmark.duration_bucket}  sample=${result.niche_benchmark.sample_size}`);
    }
    if (result.cluster_avg_vph != null) {
      console.log(`    cluster_avg_vph=${result.cluster_avg_vph}  cohesion=${result.cluster_cohesion_tier ?? '—'}  sample=${result.cluster_sample_size ?? '—'}`);
    }
    if (result.topic_signals) {
      console.log(`    topic="${result.topic_signals.topic}"  tier=${result.topic_signals.tier}  score=${result.topic_signals.score}  direction=${result.topic_signals.direction ?? '—'}`);
    }
    if (result.lifecycle_stage) {
      console.log(`    lifecycle_stage=${result.lifecycle_stage}  saturation=${result.saturation_level}`);
    }
    if (result.nearest_peers?.length) {
      console.log(`    nearest_peers (${result.nearest_peers.length}): ${result.nearest_peers.map(p => `"${trunc(p.title, 30)}"(${p.vph_7d ?? '—'} vph)`).join(', ')}`);
    }
    if (result.adjustment_reasons?.length) {
      for (const r of result.adjustment_reasons) console.log(`    · ${r}`);
    }
  }

  console.log('\n── Suspicious flags ────────────────────────────────────────');
  if (suspiciousLines.length === 0) {
    console.log('  ✓ No suspicious cases detected');
  } else {
    for (const line of suspiciousLines) console.log(line);
    console.log(`\n  Total suspicious flags: ${suspiciousTotal}`);
  }

  console.log('\n── Summary ──────────────────────────────────────────────────');
  console.log(`  Samples run : ${SAMPLES.length}`);
  console.log(`  Suspicious  : ${suspiciousTotal}`);
  console.log(suspiciousTotal === 0 ? '  Result: PASS' : '  Result: REVIEW NEEDED');
  console.log('');
}

main().catch(err => {
  console.error('FATAL:', err.message);
  process.exit(1);
});

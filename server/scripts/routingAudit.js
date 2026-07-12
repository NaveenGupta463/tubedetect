'use strict';

/**
 * Routing Audit — Empirical weight discovery for multi-dimensional peer scoring.
 *
 * Opens DB read-only so it can run alongside the server without lock conflicts.
 * Measures which dimension (topic, format, style, language, identity) best predicts
 * actual content phrase overlap (Jaccard similarity) between channel pairs.
 *
 * Run from server/: node scripts/routingAudit.js
 */

const BetterSqlite3 = require('better-sqlite3');
const path = require('path');
const DB_PATH = path.resolve(__dirname, '../data/scoring.db');
const rawDb = new BetterSqlite3(DB_PATH, { readonly: true });

const db = {
  all: (sql, params) => rawDb.prepare(sql).all(params ?? []),
  get: (sql, params) => rawDb.prepare(sql).get(params ?? []),
};

// ─── Phrase parsing ───────────────────────────────────────────────────────────
function parsePhrases(raw) {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) return arr.map(e => (typeof e === 'object' ? e.phrase || '' : String(e))).filter(Boolean);
  } catch (_) {}
  return raw.split('|').map(s => s.trim()).filter(Boolean);
}

function jaccardPhrases(phrasesA, phrasesB) {
  if (!phrasesA.length || !phrasesB.length) return 0;
  const setA = new Set(phrasesA);
  const setB = new Set(phrasesB);
  let intersection = 0;
  for (const p of setA) { if (setB.has(p)) intersection++; }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

// ─── Load channels — all classification data from ingested_channels ───────────
function loadChannels() {
  return db.all(`
    SELECT
      ic.channel_id,
      ic.channel_name,
      ic.channel_subscribers,
      ic.niche,
      ic.primary_niche,
      ic.secondary_niche,
      ic.format_type,
      ic.content_archetype,
      ic.primary_language,
      ci.identity_type,
      ic.inferred_topics,
      ic.behavior_tags,
      ci.content_phrases,
      ic.content_fingerprint
    FROM ingested_channels ic
    LEFT JOIN channel_identity ci ON ci.channel_id = ic.channel_id
    WHERE ic.content_fingerprint IS NOT NULL
      AND ic.primary_niche IS NOT NULL
      AND ic.format_type IS NOT NULL
      AND ic.content_archetype IS NOT NULL
    LIMIT 8000
  `);
}

// ─── Build sample pairs ───────────────────────────────────────────────────────
function buildSamplePairs(channels, sampleSize = 5000) {
  const results = [];
  const n = channels.length;
  const seen = new Set();

  let attempts = 0;
  while (results.length < sampleSize && attempts < sampleSize * 30) {
    attempts++;
    const i = Math.floor(Math.random() * n);
    const j = Math.floor(Math.random() * n);
    if (i === j) continue;
    const key = i < j ? `${i}:${j}` : `${j}:${i}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const a = channels[i];
    const b = channels[j];

    const phrasesA = parsePhrases(a.content_phrases || a.content_fingerprint);
    const phrasesB = parsePhrases(b.content_phrases || b.content_fingerprint);
    if (phrasesA.length < 3 || phrasesB.length < 3) continue;

    const sim = jaccardPhrases(phrasesA, phrasesB);

    const nicheA = a.primary_niche || a.niche;
    const nicheB = b.primary_niche || b.niche;

    const sameNiche    = nicheA === nicheB ? 1 : 0;
    const sameFormat   = (a.format_type && b.format_type && a.format_type !== 'other' && a.format_type === b.format_type) ? 1 : 0;
    const sameArch     = (a.content_archetype && b.content_archetype && a.content_archetype === b.content_archetype) ? 1 : 0;
    const sameLang     = (a.primary_language && b.primary_language && a.primary_language === b.primary_language) ? 1 : 0;
    const sameSecondary = (a.secondary_niche && b.secondary_niche && a.secondary_niche === b.secondary_niche) ? 1 : 0;
    const sameIdentity = (a.identity_type && b.identity_type && a.identity_type === b.identity_type) ? 1 : 0;

    results.push({
      sim,
      sameNiche, sameFormat, sameArch, sameLang, sameSecondary, sameIdentity,
      nicheAndFormat: sameNiche && sameFormat,
      nicheAndArch:   sameNiche && sameArch,
      formatAndArch:  sameFormat && sameArch,
      allThree:       sameNiche && sameFormat && sameArch,
      allThreePlusLang: sameNiche && sameFormat && sameArch && sameLang,
    });
  }
  return results;
}

// ─── Group means ──────────────────────────────────────────────────────────────
function computeGroupMeans(pairs, field) {
  const match   = pairs.filter(p => p[field] === 1);
  const noMatch = pairs.filter(p => p[field] === 0);
  const mean = arr => arr.length ? arr.reduce((s, p) => s + p.sim, 0) / arr.length : 0;
  return {
    matchCount:   match.length,
    matchMean:    mean(match),
    noMatchMean:  mean(noMatch),
    lift:         mean(match) - mean(noMatch),
  };
}

// ─── Point-biserial correlation (effect size) ─────────────────────────────────
function pointBiserial(pairs, field) {
  const n        = pairs.length;
  const totalMean = pairs.reduce((s, p) => s + p.sim, 0) / n;
  const totalStd  = Math.sqrt(pairs.reduce((s, p) => s + Math.pow(p.sim - totalMean, 2), 0) / n);
  if (totalStd === 0) return 0;
  const match = pairs.filter(p => p[field] === 1);
  const meanM = match.length ? match.reduce((s, p) => s + p.sim, 0) / match.length : 0;
  const prop  = match.length / n;
  return ((meanM - totalMean) / totalStd) * Math.sqrt(prop * (1 - prop));
}

// ─── Corpus distribution ──────────────────────────────────────────────────────
function corpusDistribution() {
  const byFormat = db.all(`
    SELECT format_type, COUNT(*) as cnt
    FROM ingested_channels
    WHERE format_type IS NOT NULL AND content_fingerprint IS NOT NULL
    GROUP BY format_type ORDER BY cnt DESC
  `);
  const byArch = db.all(`
    SELECT content_archetype, COUNT(*) as cnt
    FROM ingested_channels
    WHERE content_archetype IS NOT NULL AND content_fingerprint IS NOT NULL
    GROUP BY content_archetype ORDER BY cnt DESC
  `);
  const byNiche = db.all(`
    SELECT primary_niche, COUNT(*) as cnt
    FROM ingested_channels
    WHERE primary_niche IS NOT NULL AND content_fingerprint IS NOT NULL
    GROUP BY primary_niche ORDER BY cnt DESC LIMIT 15
  `);
  return { byFormat, byArch, byNiche };
}

// ─── Named channel simulation ─────────────────────────────────────────────────
function simulateChannel(name, allChannels) {
  const lower = name.toLowerCase();
  const target = allChannels.find(c =>
    c.channel_name && c.channel_name.toLowerCase().includes(lower)
  );
  if (!target) return null;

  const targetPhrases = parsePhrases(target.content_phrases || target.content_fingerprint);

  const scored = allChannels
    .filter(c => c.channel_id !== target.channel_id && (c.content_phrases || c.content_fingerprint))
    .map(c => {
      const phrases = parsePhrases(c.content_phrases || c.content_fingerprint);
      const sim = jaccardPhrases(targetPhrases, phrases);

      const sameNiche  = (c.primary_niche || c.niche) === (target.primary_niche || target.niche) ? 1 : 0;
      const sameFormat = (c.format_type && target.format_type && c.format_type !== 'other' && c.format_type === target.format_type) ? 1 : 0;
      const sameArch   = (c.content_archetype && target.content_archetype && c.content_archetype === target.content_archetype) ? 1 : 0;
      const sameLang   = (c.primary_language === target.primary_language) ? 1 : 0;

      return { channel_name: c.channel_name, subscribers: c.channel_subscribers, niche: c.primary_niche || c.niche, format_type: c.format_type, archetype: c.content_archetype, sim, sameNiche, sameFormat, sameArch, sameLang };
    })
    .sort((a, b) => b.sim - a.sim)
    .slice(0, 12);

  return {
    name:      target.channel_name,
    niche:     target.primary_niche || target.niche,
    format:    target.format_type,
    archetype: target.content_archetype,
    identity:  target.identity_type,
    lang:      target.primary_language,
    subs:      target.channel_subscribers,
    phrases:   targetPhrases.slice(0, 8),
    peers:     scored,
  };
}

// ─── Contamination counts ─────────────────────────────────────────────────────
function contaminationCounts() {
  // Channels classified as podcasts that would get routed to wrong niche
  const podcastChannels = db.get(`SELECT COUNT(*) as n FROM ingested_channels WHERE format_type = 'podcast' AND content_fingerprint IS NOT NULL`);
  const interviewerChannels = db.get(`SELECT COUNT(*) as n FROM ingested_channels WHERE content_archetype = 'interviewer' AND content_fingerprint IS NOT NULL`);

  // How many podcast channels are in niches that have many non-podcast channels (contamination risk)
  const podcastNicheMix = db.all(`
    SELECT primary_niche,
           SUM(CASE WHEN format_type='podcast' THEN 1 ELSE 0 END) as podcast_cnt,
           SUM(CASE WHEN format_type!='podcast' THEN 1 ELSE 0 END) as non_podcast_cnt,
           COUNT(*) as total
    FROM ingested_channels
    WHERE primary_niche IS NOT NULL AND content_fingerprint IS NOT NULL
    GROUP BY primary_niche
    HAVING podcast_cnt > 0 AND non_podcast_cnt > 0
    ORDER BY podcast_cnt DESC
    LIMIT 10
  `);

  // Channels with no format_type set — currently using niche-only routing
  const noFormat = db.get(`SELECT COUNT(*) as n FROM ingested_channels WHERE format_type IS NULL AND content_fingerprint IS NOT NULL`);
  const noArch   = db.get(`SELECT COUNT(*) as n FROM ingested_channels WHERE content_archetype IS NULL AND content_fingerprint IS NOT NULL`);

  return { podcastChannels, interviewerChannels, podcastNicheMix, noFormat, noArch };
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n══════════════════════════════════════════════════════════════');
  console.log('  ROUTING AUDIT — Empirical Weight Discovery');
  console.log('  Read-only mode — safe to run alongside server');
  console.log('══════════════════════════════════════════════════════════════\n');

  // 1. Corpus distribution
  console.log('── SECTION 1: Corpus Distribution ────────────────────────────\n');
  const dist = corpusDistribution();
  console.log('  Format types in corpus:');
  for (const r of dist.byFormat) console.log(`    ${String(r.format_type).padEnd(20)} ${String(r.cnt).padStart(6)}`);
  console.log('\n  Content archetypes in corpus:');
  for (const r of dist.byArch)   console.log(`    ${String(r.content_archetype).padEnd(20)} ${String(r.cnt).padStart(6)}`);
  console.log('\n  Top niches (primary_niche):');
  for (const r of dist.byNiche)  console.log(`    ${String(r.primary_niche).padEnd(20)} ${String(r.cnt).padStart(6)}`);

  // 2. Load channels
  console.log('\n── SECTION 2: Empirical Weight Measurement ───────────────────\n');
  process.stdout.write('  Loading channels...');
  const channels = loadChannels();
  process.stdout.write(` ${channels.length.toLocaleString()} loaded\n`);

  process.stdout.write('  Building sample pairs...');
  const pairs = buildSamplePairs(channels, 6000);
  process.stdout.write(` ${pairs.length.toLocaleString()} pairs built\n\n`);

  const dims = [
    { key: 'sameNiche',         label: 'Same primary_niche' },
    { key: 'sameFormat',        label: 'Same format_type' },
    { key: 'sameArch',          label: 'Same content_archetype' },
    { key: 'sameLang',          label: 'Same language' },
    { key: 'sameIdentity',      label: 'Same identity_type' },
    { key: 'sameSecondary',     label: 'Same secondary_niche' },
    { key: 'nicheAndFormat',    label: 'Niche + Format' },
    { key: 'nicheAndArch',      label: 'Niche + Archetype' },
    { key: 'formatAndArch',     label: 'Format + Archetype' },
    { key: 'allThree',          label: 'Niche + Format + Arch' },
    { key: 'allThreePlusLang',  label: 'N + F + A + Lang' },
  ];

  const table = dims.map(d => ({
    label: d.label,
    ...computeGroupMeans(pairs, d.key),
    r: pointBiserial(pairs, d.key),
  })).sort((a, b) => b.lift - a.lift);

  console.log(`  ${'Dimension'.padEnd(24)} ${'Lift'.padEnd(8)} ${'r_pb'.padEnd(8)} ${'Match avg'.padEnd(11)} ${'Base avg'.padEnd(11)} Pairs`);
  console.log(`  ${'─'.repeat(75)}`);
  for (const row of table) {
    const matchPct = (row.matchCount / pairs.length * 100).toFixed(0);
    console.log(
      `  ${row.label.padEnd(24)}` +
      ` ${row.lift.toFixed(4).padEnd(8)}` +
      ` ${row.r.toFixed(4).padEnd(8)}` +
      ` ${row.matchMean.toFixed(4).padEnd(11)}` +
      ` ${row.noMatchMean.toFixed(4).padEnd(11)}` +
      ` ${row.matchCount} (${matchPct}%)`
    );
  }

  // 3. Derive weights
  console.log('\n── SECTION 3: Suggested Weight Formula ───────────────────────\n');
  const single = table.filter(r => ['Same primary_niche','Same format_type','Same content_archetype','Same language'].includes(r.label));
  const totalLift = single.reduce((s, r) => s + Math.max(0, r.lift), 0);
  console.log('  Raw dimension lifts → normalised weights:\n');
  for (const r of single) {
    const w = totalLift > 0 ? Math.max(0, r.lift) / totalLift : 0;
    console.log(`    ${r.label.padEnd(24)} lift=${r.lift.toFixed(4)}  weight=${(w*100).toFixed(1)}%`);
  }

  const nicheLift  = single.find(r => r.label === 'Same primary_niche')?.lift  || 0;
  const formatLift = single.find(r => r.label === 'Same format_type')?.lift    || 0;
  const archLift   = single.find(r => r.label === 'Same content_archetype')?.lift || 0;
  const langLift   = single.find(r => r.label === 'Same language')?.lift       || 0;

  const tl = nicheLift + formatLift + archLift + langLift;
  const wN = (nicheLift / tl).toFixed(2);
  const wF = (formatLift / tl).toFixed(2);
  const wA = (archLift / tl).toFixed(2);
  const wL = (langLift / tl).toFixed(2);

  console.log(`
  PROPOSED FORMULA:

    peer_score(A, B) =
        ${wN} × [same_niche]
      + ${wF} × [same_format]
      + ${wA} × [same_archetype]
      + ${wL} × [same_language]
      + phrase_jaccard(A, B) × 0.5     ← existing content overlap

  Combined bonus: same_niche + same_format + same_archetype = max routing purity
  `);

  // 4. Which dimension dominates?
  const topSingle = single.sort((a, b) => b.lift - a.lift)[0];
  console.log(`  FINDING: "${topSingle.label}" is the strongest single predictor (lift=${topSingle.lift.toFixed(4)})`);
  const comboTop = table.find(r => ['Niche + Format','Niche + Archetype','Format + Archetype','Niche + Format + Arch'].includes(r.label) && r.lift > topSingle.lift);
  if (comboTop) {
    console.log(`  FINDING: "${comboTop.label}" beats the best single dimension (lift=${comboTop.lift.toFixed(4)})`);
    console.log(`  CONCLUSION: Combinations outperform single-dimension routing — multi-dim gating is justified.`);
  } else {
    console.log(`  FINDING: No combo outperforms the best single dimension in this corpus.`);
    console.log(`  CONCLUSION: Adding format/archetype gates still improves purity even if the lift delta is small.`);
  }

  // 5. Named channel simulations
  const targets = [
    'Raj Shamani', 'Nikhil Kamath', 'BeerBiceps', 'Warikoo',
    'Josh Talks', 'Zerodha', 'TechBurner', 'NDTV',
  ];

  console.log('\n── SECTION 4: Named Channel Peer Simulations ─────────────────\n');
  for (const name of targets) {
    const result = simulateChannel(name, channels);
    if (!result) {
      console.log(`  [${name}] — NOT FOUND in corpus (not ingested or no fingerprint)\n`);
      continue;
    }
    const subs = result.subs ? `${(result.subs/1000).toFixed(0)}K` : '?';
    console.log(`  ┌─ ${result.name} (${subs} subs)`);
    console.log(`  │  niche=${result.niche} | format=${result.format} | archetype=${result.archetype} | lang=${result.lang}`);
    console.log(`  │  Top phrases: ${result.phrases.join(', ')}`);
    console.log(`  │`);
    console.log(`  │  Top 10 peers by content Jaccard:`);
    for (const p of result.peers.slice(0, 10)) {
      const flags = [
        p.sameNiche  ? 'N✓' : 'N✗',
        p.sameFormat ? 'F✓' : 'F✗',
        p.sameArch   ? 'A✓' : 'A✗',
        p.sameLang   ? 'L✓' : 'L✗',
      ].join(' ');
      const pSubs = p.subscribers ? `${(p.subscribers/1000).toFixed(0)}K` : '?';
      const contaminated = !p.sameFormat && !p.sameArch ? ' ← CONTAMINATED' : '';
      console.log(`  │    ${String(p.channel_name).slice(0,28).padEnd(29)} sim=${p.sim.toFixed(4)} ${flags} ${p.niche}/${p.format_type} [${pSubs}]${contaminated}`);
    }

    // Format-filtered top peers
    const formatFiltered = result.peers.filter(p => p.sameFormat || p.sameArch).slice(0, 5);
    if (formatFiltered.length > 0) {
      console.log(`  │`);
      console.log(`  │  With format/archetype gate (expected after fix):`);
      for (const p of formatFiltered) {
        const flags = [p.sameNiche?'N✓':'N✗', p.sameFormat?'F✓':'F✗', p.sameArch?'A✓':'A✗'].join(' ');
        const pSubs = p.subscribers ? `${(p.subscribers/1000).toFixed(0)}K` : '?';
        console.log(`  │    ${String(p.channel_name).slice(0,28).padEnd(29)} sim=${p.sim.toFixed(4)} ${flags} ${p.niche}/${p.format_type} [${pSubs}]`);
      }
    }
    console.log(`  └${'─'.repeat(60)}\n`);
  }

  // 6. Contamination counts
  console.log('── SECTION 5: Contamination Estimate ────────────────────────\n');
  const cont = contaminationCounts();
  console.log(`  Total podcast channels in corpus     : ${cont.podcastChannels.n}`);
  console.log(`  Total interviewer archetype channels : ${cont.interviewerChannels.n}`);
  console.log(`  Channels with no format_type (niche-only routing) : ${cont.noFormat.n}`);
  console.log(`  Channels with no content_archetype                : ${cont.noArch.n}`);
  console.log('\n  Podcast/non-podcast mix per niche (contamination sources):');
  console.log(`  ${'Niche'.padEnd(20)} ${'Podcast'.padEnd(10)} ${'Non-podcast'.padEnd(13)} Mix ratio`);
  console.log(`  ${'─'.repeat(60)}`);
  for (const r of cont.podcastNicheMix) {
    const ratio = (r.podcast_cnt / r.total * 100).toFixed(0);
    console.log(`  ${String(r.primary_niche).padEnd(20)} ${String(r.podcast_cnt).padEnd(10)} ${String(r.non_podcast_cnt).padEnd(13)} ${ratio}% podcast`);
  }

  console.log('\n══════════════════════════════════════════════════════════════');
  console.log('  AUDIT COMPLETE');
  console.log('══════════════════════════════════════════════════════════════\n');
  rawDb.close();
}

main().catch(e => {
  console.error('FATAL:', e.message, '\n', e.stack);
  rawDb.close();
  process.exit(1);
});

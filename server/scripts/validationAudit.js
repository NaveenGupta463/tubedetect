'use strict';

/**
 * Post-upgrade validation audit — multi-dimensional peer routing.
 * Readonly mode. Run alongside server: node scripts/validationAudit.js
 */

const BetterSqlite3 = require('better-sqlite3');
const path = require('path');
const rawDb = new BetterSqlite3(path.resolve(__dirname, '../data/scoring.db'), { readonly: true });
const db = {
  all: (sql, p) => rawDb.prepare(sql).all(p ?? []),
  get:  (sql, p) => rawDb.prepare(sql).get(p ?? []),
};
const PEER_WEIGHTS = require('../config/peerScoreWeights');

// ── Phrase parsing ────────────────────────────────────────────────────────────
function parsePhrases(raw) {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) return arr.map(e => (typeof e === 'object' ? (e.phrase || '') : String(e))).filter(Boolean);
  } catch (_) {}
  return raw.split('|').map(s => s.trim()).filter(Boolean);
}

function jaccard(a, b) {
  const A = new Set(a), B = new Set(b);
  let shared = 0;
  for (const p of A) if (B.has(p)) shared++;
  const u = A.size + B.size - shared;
  return u > 0 ? shared / u : 0;
}

// ── Scoring engines ───────────────────────────────────────────────────────────

function scoreMultiDim(user, peer, userPhrases, peerPhrases) {
  const topicMatch    = (user.niche && peer.niche && user.niche === peer.niche) ? 1 : 0;
  const formatMatch   = (user.format_type && peer.format_type &&
                         user.format_type !== 'other' && peer.format_type !== 'other' &&
                         user.format_type === peer.format_type) ? 1 : 0;
  const styleMatch    = (user.content_archetype && peer.content_archetype &&
                         user.content_archetype === peer.content_archetype) ? 1 : 0;
  const languageMatch = (user.primary_language && peer.primary_language &&
                         user.primary_language === peer.primary_language) ? 1 : 0;
  const phraseSim     = jaccard(userPhrases, peerPhrases);
  const score =
    PEER_WEIGHTS.topic    * topicMatch    +
    PEER_WEIGHTS.format   * formatMatch   +
    PEER_WEIGHTS.style    * styleMatch    +
    PEER_WEIGHTS.language * languageMatch +
    PEER_WEIGHTS.phrase   * phraseSim;
  return { score, topicMatch, formatMatch, styleMatch, languageMatch, phraseSim };
}

function scoreLegacy(user, peer, userPhrases, peerPhrases) {
  const overlap    = userPhrases.filter(p => peerPhrases.includes(p)).length;
  const pureScore  = userPhrases.length > 0 ? overlap / userPhrases.length : 0;
  const niche_ok   = !user.niche || !peer.niche || user.niche === peer.niche || pureScore >= 0.4;
  return { score: niche_ok ? overlap : -1, overlap, pureScore };
}

// ── Load candidate pool for a channel ────────────────────────────────────────
function loadCandidates(channelId, userPhrases) {
  if (!userPhrases.length) return [];
  const cond = userPhrases.slice(0, 15).map(() => 'content_fingerprint LIKE ?').join(' OR ');
  return db.all(
    `SELECT channel_id, channel_name, content_fingerprint,
            COALESCE(primary_niche, niche) AS niche, channel_subscribers,
            format_type, content_archetype, primary_language
     FROM ingested_channels
     WHERE content_fingerprint IS NOT NULL AND (${cond}) AND channel_id != ? AND ingest_enabled = 1
     LIMIT 500`,
    [...userPhrases.slice(0, 15).map(p => `%${p}%`), channelId],
  );
}

// ── Build top-N peer lists for both engines ───────────────────────────────────
function getPeers(channelRow, topN = 10) {
  const fingerprint = db.get(
    `SELECT content_phrases, confidence_tier FROM channel_identity WHERE channel_id = ?`,
    [channelRow.channel_id],
  );
  const raw = (fingerprint?.content_phrases && fingerprint?.confidence_tier !== 'none')
    ? fingerprint.content_phrases
    : channelRow.content_fingerprint;
  const userPhrases = parsePhrases(raw).slice(0, 15);
  if (!userPhrases.length) return null;

  const candidates = loadCandidates(channelRow.channel_id, userPhrases);
  if (!candidates.length) return null;

  const minOverlap = 2;
  const mdPeers = [], lgPeers = [];

  for (const r of candidates) {
    const peerPhrases = parsePhrases(r.content_fingerprint);
    const overlap     = userPhrases.filter(p => peerPhrases.includes(p)).length;
    if (overlap < minOverlap) continue;

    // Multi-dim
    const md = scoreMultiDim(channelRow, r, userPhrases, peerPhrases);
    mdPeers.push({ ...r, ...md });

    // Legacy
    const lg = scoreLegacy(channelRow, r, userPhrases, peerPhrases);
    if (lg.score >= 0) lgPeers.push({ ...r, legacy_score: lg.score });
  }

  return {
    userPhrases,
    multiDim: mdPeers.sort((a, b) => b.score - a.score).slice(0, topN),
    legacy:   lgPeers.sort((a, b) => b.legacy_score - a.legacy_score).slice(0, topN),
  };
}

// ── Metrics ───────────────────────────────────────────────────────────────────

// EAR: % of top-N peers matching user's primary niche
function computeEAR(user, peers) {
  if (!peers.length || !user.niche) return null;
  const match = peers.filter(p => p.niche === user.niche).length;
  return parseFloat((match / peers.length * 100).toFixed(1));
}

// POR: % of top-N peers matching user's format_type (excluding 'other')
function computePOR(user, peers) {
  if (!peers.length || !user.format_type || user.format_type === 'other') return null;
  const eligible = peers.filter(p => p.format_type && p.format_type !== 'other');
  if (!eligible.length) return null;
  const match = eligible.filter(p => p.format_type === user.format_type).length;
  return parseFloat((match / peers.length * 100).toFixed(1));
}

// RP@5: precision — % of top-5 peers that match BOTH niche AND format
function computeRPat5(user, peers) {
  const top5 = peers.slice(0, 5);
  if (!top5.length) return null;
  const correct = top5.filter(p =>
    (!user.niche || p.niche === user.niche) &&
    (!user.format_type || user.format_type === 'other' || p.format_type === user.format_type)
  ).length;
  return parseFloat((correct / top5.length * 100).toFixed(1));
}

// Contamination: % of top-N peers with WRONG niche AND WRONG format (completely off)
function computeContamination(user, peers) {
  if (!peers.length) return null;
  const contam = peers.filter(p => {
    const nicheMiss  = user.niche && p.niche && p.niche !== user.niche;
    const formatMiss = user.format_type && user.format_type !== 'other' && p.format_type && p.format_type !== 'other' && p.format_type !== user.format_type;
    return nicheMiss && formatMiss;
  }).length;
  return parseFloat((contam / peers.length * 100).toFixed(1));
}

// ── 20-channel validation sample ─────────────────────────────────────────────
function loadValidationSample() {
  // Pick channels with good classification data across diverse niches/formats
  return db.all(`
    SELECT channel_id, channel_name,
           COALESCE(primary_niche, niche) AS niche,
           format_type, content_archetype, primary_language,
           channel_subscribers, content_fingerprint
    FROM ingested_channels
    WHERE format_type IS NOT NULL AND format_type != 'other'
      AND content_archetype IS NOT NULL
      AND primary_niche IS NOT NULL
      AND content_fingerprint IS NOT NULL
      AND channel_subscribers > 10000
    GROUP BY niche, format_type
    HAVING COUNT(*) >= 2
    ORDER BY channel_subscribers DESC
    LIMIT 20
  `);
}

// ── Named channel lookup ──────────────────────────────────────────────────────
function lookupNamedChannels() {
  const names = ['Raj Shamani', 'Nikhil Kamath', 'BeerBiceps', 'Josh Talks', 'warikoo', 'TechBurner'];
  const results = [];
  for (const name of names) {
    const rows = db.all(
      `SELECT channel_id, channel_name,
              COALESCE(primary_niche, niche) AS niche,
              format_type, content_archetype, primary_language,
              channel_subscribers, content_fingerprint
       FROM ingested_channels
       WHERE channel_name LIKE ? AND content_fingerprint IS NOT NULL
       LIMIT 2`,
      [`%${name}%`],
    );
    if (rows.length) results.push(...rows.slice(0, 1));
    else results.push({ channel_name: name, _not_found: true });
  }
  return results;
}

// ── Contamination comparison: 1-dim vs multi-dim ─────────────────────────────
function measureContaminationReduction(sampleChannels) {
  let totalMD = 0, totalLG = 0, countMD = 0, countLG = 0;
  const details = [];

  for (const ch of sampleChannels) {
    const result = getPeers(ch, 10);
    if (!result) continue;

    const contamMD = computeContamination(ch, result.multiDim);
    const contamLG = computeContamination(ch, result.legacy);
    if (contamMD !== null) { totalMD += contamMD; countMD++; }
    if (contamLG !== null) { totalLG += contamLG; countLG++; }

    details.push({
      name:   (ch.channel_name || ch.channel_id).slice(0, 25),
      niche:  ch.niche,
      format: ch.format_type,
      md_contam:  contamMD,
      lg_contam:  contamLG,
      md_ear: computeEAR(ch, result.multiDim),
      lg_ear: computeEAR(ch, result.legacy),
    });
  }

  return {
    details,
    avg_md_contamination: countMD ? parseFloat((totalMD / countMD).toFixed(1)) : null,
    avg_lg_contamination: countLG ? parseFloat((totalLG / countLG).toFixed(1)) : null,
  };
}

// ── Main ──────────────────────────────────────────────────────────────────────
function main() {
  console.log('\n══════════════════════════════════════════════════════════════');
  console.log('  POST-UPGRADE VALIDATION AUDIT — Multi-Dimensional Routing');
  console.log('══════════════════════════════════════════════════════════════\n');

  // ── SECTION 1: 20-Channel Validation ─────────────────────────────────────
  console.log('── SECTION 1: 20-Channel Validation ─────────────────────────\n');
  const sample = loadValidationSample();
  console.log(`  Sample size: ${sample.length} channels\n`);

  let mdEAR_sum = 0, mdPOR_sum = 0, mdRP5_sum = 0, mdContam_sum = 0, n_md = 0;
  let lgEAR_sum = 0, lgPOR_sum = 0, lgRP5_sum = 0, lgContam_sum = 0, n_lg = 0;

  const channelResults = [];

  for (const ch of sample) {
    const result = getPeers(ch, 10);
    if (!result) continue;

    const mdEAR    = computeEAR(ch, result.multiDim);
    const mdPOR    = computePOR(ch, result.multiDim);
    const mdRP5    = computeRPat5(ch, result.multiDim);
    const mdContam = computeContamination(ch, result.multiDim);

    const lgEAR    = computeEAR(ch, result.legacy);
    const lgPOR    = computePOR(ch, result.legacy);
    const lgRP5    = computeRPat5(ch, result.legacy);
    const lgContam = computeContamination(ch, result.legacy);

    if (mdEAR    !== null) { mdEAR_sum    += mdEAR;    n_md++; }
    if (mdPOR    !== null)   mdPOR_sum    += mdPOR;
    if (mdRP5    !== null)   mdRP5_sum    += mdRP5;
    if (mdContam !== null)   mdContam_sum += mdContam;

    if (lgEAR    !== null) { lgEAR_sum    += lgEAR;    n_lg++; }
    if (lgPOR    !== null)   lgPOR_sum    += lgPOR;
    if (lgRP5    !== null)   lgRP5_sum    += lgRP5;
    if (lgContam !== null)   lgContam_sum += lgContam;

    channelResults.push({ ch, mdEAR, mdPOR, mdRP5, mdContam, lgEAR, lgPOR, lgRP5, lgContam, peers: result });
  }

  // Per-channel table
  console.log(`  ${'Channel'.padEnd(26)} ${'Niche'.padEnd(16)} ${'Fmt'.padEnd(12)}` +
    ` ${'EAR-MD'.padEnd(8)} ${'EAR-LG'.padEnd(8)} ${'POR-MD'.padEnd(8)} ${'RP@5-MD'.padEnd(8)} ${'Contam-MD'.padEnd(10)} ${'Contam-LG'}`);
  console.log(`  ${'─'.repeat(115)}`);

  for (const { ch, mdEAR, mdPOR, mdRP5, mdContam, lgEAR, lgContam } of channelResults) {
    const name = (ch.channel_name || '?').slice(0, 25).padEnd(26);
    const fmt  = fmt => (fmt !== null && fmt !== undefined ? fmt + '%' : '—').padEnd(8);
    console.log(`  ${name} ${(ch.niche||'?').padEnd(16)} ${(ch.format_type||'?').padEnd(12)}` +
      ` ${fmt(mdEAR)}${fmt(lgEAR)}${fmt(mdPOR)}${fmt(mdRP5)}${fmt(mdContam)}${fmt(lgContam)}`);
  }

  const nn = Math.max(n_md, 1);
  console.log(`\n  ${'─'.repeat(115)}`);
  console.log(`  ${'AVERAGE'.padEnd(26)} ${''.padEnd(16)} ${''.padEnd(12)}` +
    ` ${(mdEAR_sum/nn).toFixed(1).padEnd(7)}% ${(lgEAR_sum/Math.max(n_lg,1)).toFixed(1).padEnd(7)}% ${(mdPOR_sum/nn).toFixed(1).padEnd(7)}% ${(mdRP5_sum/nn).toFixed(1).padEnd(7)}% ${(mdContam_sum/nn).toFixed(1).padEnd(9)}% ${(lgContam_sum/Math.max(n_lg,1)).toFixed(1)}%`);

  // ── SECTION 2: Contamination Reduction Breakdown ──────────────────────────
  console.log('\n── SECTION 2: Same-Topic-Only vs Topic+Format+Style ─────────\n');
  console.log('  Measures % of top-10 peers that are WRONG niche AND WRONG format (fully contaminated)\n');
  console.log(`  ${'Channel'.padEnd(26)} ${'Niche/Format'.padEnd(20)} ${'Legacy %'.padEnd(12)} ${'Multi-dim %'.padEnd(14)} Delta`);
  console.log(`  ${'─'.repeat(80)}`);

  let totalDelta = 0, deltaCount = 0;
  for (const { ch, mdContam, lgContam } of channelResults) {
    if (mdContam === null || lgContam === null) continue;
    const delta = lgContam - mdContam;
    totalDelta += delta;
    deltaCount++;
    const arrow = delta > 5 ? '↓ BETTER' : delta < -5 ? '↑ WORSE' : '≈ same';
    console.log(`  ${(ch.channel_name||'?').slice(0,25).padEnd(26)} ${(ch.niche+'/'+ch.format_type).slice(0,19).padEnd(20)} ${String(lgContam+'%').padEnd(12)} ${String(mdContam+'%').padEnd(14)} ${delta>0?'+':''}${delta.toFixed(1)}% ${arrow}`);
  }

  if (deltaCount > 0) {
    const avgDelta = totalDelta / deltaCount;
    console.log(`\n  Average contamination reduction: ${avgDelta > 0 ? '+' : ''}${avgDelta.toFixed(1)}% (positive = multi-dim is better)`);
  }

  // ── SECTION 3: Podcast routing check ──────────────────────────────────────
  console.log('\n── SECTION 3: Podcast Routing Check ─────────────────────────\n');
  const podcastChannels = db.all(`
    SELECT channel_id, channel_name, COALESCE(primary_niche,niche) AS niche,
           format_type, content_archetype, primary_language,
           channel_subscribers, content_fingerprint
    FROM ingested_channels
    WHERE format_type = 'podcast' AND content_fingerprint IS NOT NULL
    ORDER BY channel_subscribers DESC LIMIT 10
  `);
  console.log(`  Podcast channels in corpus: ${podcastChannels.length} (showing top 10 by subscribers)\n`);

  for (const ch of podcastChannels.slice(0, 5)) {
    const result = getPeers(ch, 8);
    const mdPodcast = result
      ? result.multiDim.filter(p => p.format_type === 'podcast').length
      : 0;
    const lgPodcast = result
      ? result.legacy.filter(p => p.format_type === 'podcast').length
      : 0;
    const subs = ch.channel_subscribers ? `${(ch.channel_subscribers/1000).toFixed(0)}K` : '?';
    console.log(`  ${(ch.channel_name||'?').slice(0,30).padEnd(31)} [${subs}] niche=${ch.niche}`);
    if (result) {
      console.log(`    Multi-dim top-8: podcast peers=${mdPodcast}/8  |  Legacy top-8: podcast peers=${lgPodcast}/8`);
      const topMD = result.multiDim.slice(0, 5).map(p => `${(p.channel_name||'?').slice(0,18)}(${p.format_type||'?'})`).join(', ');
      console.log(`    Top-5 multi-dim: ${topMD}`);
    } else {
      console.log(`    No peers found (sparse fingerprint)`);
    }
    console.log();
  }

  // ── SECTION 4: Named Channel Validation ───────────────────────────────────
  console.log('── SECTION 4: Named Channel Validation ──────────────────────\n');
  const namedChannels = lookupNamedChannels();

  for (const ch of namedChannels) {
    if (ch._not_found) {
      console.log(`  [${ch.channel_name}] — NOT IN CORPUS\n`);
      continue;
    }

    const subs = ch.channel_subscribers ? `${(ch.channel_subscribers/1000).toFixed(0)}K` : '?';
    console.log(`  ┌─ ${ch.channel_name} [${subs}]`);
    console.log(`  │  niche=${ch.niche} | format=${ch.format_type} | arch=${ch.content_archetype} | lang=${ch.primary_language}`);

    const result = getPeers(ch, 10);
    if (!result) {
      console.log(`  │  NO PEERS (no fingerprint or no candidates)\n  └${'─'.repeat(60)}\n`);
      continue;
    }

    const mdEAR    = computeEAR(ch, result.multiDim);
    const mdPOR    = computePOR(ch, result.multiDim);
    const mdContam = computeContamination(ch, result.multiDim);
    const lgEAR    = computeEAR(ch, result.legacy);
    const lgContam = computeContamination(ch, result.legacy);

    console.log(`  │  EAR: ${mdEAR}% (MD) vs ${lgEAR}% (legacy) | POR: ${mdPOR}% | Contam: ${mdContam}% (MD) vs ${lgContam}% (legacy)`);
    console.log(`  │`);
    console.log(`  │  Top-8 multi-dim peers:`);
    for (const p of result.multiDim.slice(0, 8)) {
      const flags = [
        p.topicMatch  ? 'N✓' : 'N✗',
        p.formatMatch ? 'F✓' : 'F✗',
        p.styleMatch  ? 'S✓' : 'S✗',
        p.languageMatch ? 'L✓' : 'L✗',
      ].join(' ');
      const pSubs = p.channel_subscribers ? `${(p.channel_subscribers/1000).toFixed(0)}K` : '?';
      const contam = (!p.topicMatch && !p.formatMatch) ? ' ←CONTAM' : '';
      console.log(`  │    ${(p.channel_name||'?').slice(0,28).padEnd(29)} score=${p.score.toFixed(3)} ${flags} ${p.niche}/${p.format_type} [${pSubs}]${contam}`);
    }

    if (result.multiDim.length !== result.legacy.length || JSON.stringify(result.multiDim.map(p=>p.channel_id)) !== JSON.stringify(result.legacy.map(p=>p.channel_id))) {
      const lgContamPeers = result.legacy.filter(p => p.niche !== ch.niche).slice(0,3);
      if (lgContamPeers.length) {
        console.log(`  │`);
        console.log(`  │  Legacy routing would have included (now demoted):`);
        for (const p of lgContamPeers) {
          console.log(`  │    ${(p.channel_name||'?').slice(0,28).padEnd(29)} ${p.niche}/${p.format_type}`);
        }
      }
    }
    console.log(`  └${'─'.repeat(60)}\n`);
  }

  // ── SECTION 5: Benchmark Summary ──────────────────────────────────────────
  console.log('── SECTION 5: Benchmark Summary (Before vs After) ───────────\n');
  const fmt1 = v => v !== null ? v.toFixed(1) + '%' : '—';
  const mdAvgEAR    = (mdEAR_sum    / nn).toFixed(1);
  const lgAvgEAR    = (lgEAR_sum    / Math.max(n_lg, 1)).toFixed(1);
  const mdAvgPOR    = (mdPOR_sum    / nn).toFixed(1);
  const mdAvgRP5    = (mdRP5_sum    / nn).toFixed(1);
  const mdAvgContam = (mdContam_sum / nn).toFixed(1);
  const lgAvgContam = (lgContam_sum / Math.max(n_lg, 1)).toFixed(1);

  console.log(`  Metric          Legacy (before)   Multi-dim (after)   Delta`);
  console.log(`  ${'─'.repeat(65)}`);
  console.log(`  EAR (niche acc) ${lgAvgEAR.padEnd(19)} ${mdAvgEAR.padEnd(19)} ${(parseFloat(mdAvgEAR)-parseFloat(lgAvgEAR)).toFixed(1)}%`);
  console.log(`  POR (fmt acc)   ${'n/a'.padEnd(19)} ${mdAvgPOR.padEnd(19)} new metric`);
  console.log(`  RP@5            ${'n/a'.padEnd(19)} ${mdAvgRP5.padEnd(19)} new metric`);
  console.log(`  Contamination   ${lgAvgContam.padEnd(19)} ${mdAvgContam.padEnd(19)} ${(parseFloat(lgAvgContam)-parseFloat(mdAvgContam)).toFixed(1)}% reduction`);

  console.log('\n══════════════════════════════════════════════════════════════');
  console.log('  VALIDATION COMPLETE');
  console.log('══════════════════════════════════════════════════════════════\n');
  rawDb.close();
}

main();

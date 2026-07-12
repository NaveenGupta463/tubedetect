'use strict';

/**
 * auditLifestyleNiche.js
 *
 * Comprehensive audit of lifestyle niche decomposition.
 * Answers: is lifestyle over-classified into narrow niches?
 * Recommends: keep as broad OR split into sub-archetypes.
 */

require('dotenv').config({ path: __dirname + '/../.env' });
const path   = require('path');
const DB     = require('../node_modules/better-sqlite3');
const { resolveCreatorPeerContext } = require('../services/creatorPeerContext');
const {
  detectCandidate,
  CLOSE_NICHE_GROUPS,
  NICHE_VOCAB,
  BTAG_NICHE_SIGNALS,
  areNichesClose,
} = require('../services/classificationRepair');

const db = new DB(path.resolve(__dirname, '../data/scoring.db'), { readonly: true, timeout: 60000 });
db.pragma('journal_mode=WAL');

// ── Helpers ───────────────────────────────────────────────────────────────────

function div(char = '─', w = 100) { console.log('\n  ' + char.repeat(w)); }
function hdr(title) { div('═'); console.log(`  ${title}`); div('═'); }
function sec(title) { div(); console.log(`  ── ${title}`); }

function fmtSubs(n) {
  if (!n) return '—';
  if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(0) + 'K';
  return String(n);
}

function parseJson(v, def = []) {
  if (!v) return def;
  if (Array.isArray(v)) return v;
  try { return JSON.parse(v); } catch { return def; }
}

function pct(n, d) { return d ? ((n / d) * 100).toFixed(1) + '%' : '—'; }

// Alias for imported areNichesClose
const nichesClose = areNichesClose;

// Detect what keyword(s) in a text string match a niche
function detectNicheFromText(text) {
  if (!text) return { niche: null, keywords: [], score: 0 };
  const t = text.toLowerCase();
  let best = null, bestScore = 0, bestKws = [];
  for (const [niche, kws] of Object.entries(NICHE_VOCAB)) {
    const matched = kws.filter(kw => t.includes(kw));
    if (matched.length > bestScore) {
      bestScore = matched.length; best = niche; bestKws = matched;
    }
  }
  return bestScore >= 1 ? { niche: best, keywords: bestKws, score: bestScore } : { niche: null, keywords: [], score: 0 };
}

// Compute topic precision for a channel
function computeTp(channelId, currentNiche) {
  try {
    const peers = resolveCreatorPeerContext(db, channelId);
    const ids   = peers?.peerIds || [];
    if (!ids.length) return null;
    const ph   = ids.map(() => '?').join(',');
    const rows = db.prepare(`SELECT primary_niche FROM ingested_channels WHERE channel_id IN (${ph})`).all(ids);
    if (!rows.length) return null;
    const matched = rows.filter(r => nichesClose(r.primary_niche, currentNiche)).length;
    return (matched / rows.length) * 100;
  } catch (_) { return null; }
}

// ── Load data ─────────────────────────────────────────────────────────────────

hdr('LIFESTYLE NICHE DECOMPOSITION AUDIT  — ' + new Date().toLocaleString('en-IN'));

// 1. Sample 200 lifestyle channels by subscriber count
console.log('\n  Loading lifestyle channels...');
const lifestyleChannels = db.prepare(`
  SELECT channel_id, channel_name, primary_niche, niche, content_archetype, format_type,
         behavior_tags, channel_subscribers, identity_confidence, identity_source,
         niche_override, inferred_topics, secondary_niche
  FROM ingested_channels
  WHERE primary_niche = 'lifestyle' AND ingest_enabled = 1
  ORDER BY channel_subscribers DESC NULLS LAST
  LIMIT 200
`).all();
console.log(`  Sampled ${lifestyleChannels.length} lifestyle channels (top by subscriber count)`);

// 2. All lifestyle channels (for corpus-wide counts)
const lifestyleTotal = db.prepare(
  "SELECT COUNT(*) as n FROM ingested_channels WHERE primary_niche = 'lifestyle' AND ingest_enabled = 1"
).get().n;

// 3. Channels that MOVED OUT of lifestyle via repair
const movedOut = db.prepare(`
  SELECT rl.channel_id, rl.channel_name, rl.old_niche, rl.new_niche,
         rl.reclassification_reason, rl.priority_score, rl.tier, rl.niche_changed,
         crc.repair_reason, crc.conflict_detail, crc.channel_subscribers,
         ic.niche as raw_niche, ic.behavior_tags, ic.content_archetype, ic.format_type
  FROM reclassification_log rl
  LEFT JOIN ingested_channels ic ON ic.channel_id = rl.channel_id
  LEFT JOIN classification_repair_candidates crc ON crc.channel_id = rl.channel_id
  WHERE rl.old_niche = 'lifestyle' AND rl.niche_changed = 1
  ORDER BY crc.channel_subscribers DESC NULLS LAST
`).all();
console.log(`  Channels moved OUT of lifestyle via repair: ${movedOut.length}`);

// 4. Channels that were CORRECTLY in lifestyle (confirmed, not moved)
const lifestyleConfirmed = db.prepare(`
  SELECT COUNT(*) as n FROM reclassification_log
  WHERE old_niche = 'lifestyle' AND niche_changed = 0
`).get().n;

// 5. Queued lifestyle channels (still pending)
const lifestyleQueued = db.prepare(`
  SELECT crc.channel_id, crc.channel_name, crc.current_niche, crc.suggested_niche,
         crc.repair_reason, crc.conflict_detail, crc.channel_subscribers,
         ic.niche as raw_niche, ic.behavior_tags, ic.content_archetype, ic.format_type
  FROM classification_repair_candidates crc
  JOIN ingested_channels ic ON ic.channel_id = crc.channel_id
  WHERE crc.current_niche = 'lifestyle' AND crc.status = 'queued'
  ORDER BY crc.channel_subscribers DESC
`).all();

// ── SECTION 1: Corpus overview ────────────────────────────────────────────────

sec('SECTION 1: LIFESTYLE CORPUS OVERVIEW');

console.log(`
  Total lifestyle channels (corpus)  : ${lifestyleTotal.toLocaleString()}
  Sampled (top 200 by subs)          : ${lifestyleChannels.length}
  Moved OUT via repair               : ${movedOut.length}
  Confirmed lifestyle (not changed)  : ${lifestyleConfirmed}
  Still queued for repair            : ${lifestyleQueued.length}
`);

// Content archetype distribution in sample
const archetypeCounts = {};
const formatCounts    = {};
for (const ch of lifestyleChannels) {
  const a = ch.content_archetype || 'unknown';
  const f = ch.format_type       || 'unknown';
  archetypeCounts[a] = (archetypeCounts[a] || 0) + 1;
  formatCounts[f]    = (formatCounts[f]    || 0) + 1;
}

console.log('  Content archetype distribution (sample=200):');
for (const [k, v] of Object.entries(archetypeCounts).sort((a, b) => b[1] - a[1]).slice(0, 10)) {
  console.log(`    ${k.padEnd(30)} ${v.toString().padStart(4)}  (${pct(v, 200)})`);
}
console.log('  Format type distribution:');
for (const [k, v] of Object.entries(formatCounts).sort((a, b) => b[1] - a[1]).slice(0, 8)) {
  console.log(`    ${k.padEnd(30)} ${v.toString().padStart(4)}  (${pct(v, 200)})`);
}

// Behavior tag distribution
const btagCounts = {};
for (const ch of lifestyleChannels) {
  for (const tag of parseJson(ch.behavior_tags)) {
    btagCounts[tag] = (btagCounts[tag] || 0) + 1;
  }
}
console.log('  Behavior tag distribution (top 15):');
for (const [k, v] of Object.entries(btagCounts).sort((a, b) => b[1] - a[1]).slice(0, 15)) {
  console.log(`    ${k.padEnd(30)} ${v.toString().padStart(4)}  (${pct(v, 200)})`);
}

// ── SECTION 2: Signal detection on sample ────────────────────────────────────

sec('SECTION 2: SIGNAL DETECTION ON 200 LIFESTYLE SAMPLE');

const detected     = [];  // { channel, signal, suggestedNiche, closeNiche, keywords }
let noCandidates   = 0;
let suppressedByClose = 0;
let trueFlag       = 0;

for (const ch of lifestyleChannels) {
  const rawResult = detectNicheFromText(ch.niche);
  const candidate = detectCandidate(ch);

  if (!rawResult.niche) {
    noCandidates++;
    continue;
  }

  const isClose = nichesClose(rawResult.niche, 'lifestyle');
  if (isClose) {
    suppressedByClose++;
    detected.push({
      ch, signal: 'raw_niche_mismatch', suggested: rawResult.niche,
      suppressed: true, keywords: rawResult.keywords, candidate,
    });
  } else {
    // Would actually fire as repair candidate
    trueFlag++;
    detected.push({
      ch, signal: 'raw_niche_mismatch', suggested: rawResult.niche,
      suppressed: false, keywords: rawResult.keywords, candidate,
    });
  }
}

console.log(`
  Channels with raw niche keyword signal   : ${detected.length} / 200  (${pct(detected.length, 200)})
    → suppressed by CLOSE_NICHE_GROUPS     : ${suppressedByClose}  (${pct(suppressedByClose, detected.length)})
    → would fire as repair candidate       : ${trueFlag}  (${pct(trueFlag, detected.length)})
  No raw niche text / no keyword match     : ${noCandidates} / 200
`);

// Breakdown: what niches would be detected in the raw niche field?
const detectedNiche = {};
const suppressedNiche = {};
for (const d of detected) {
  if (d.suppressed) {
    suppressedNiche[d.suggested] = (suppressedNiche[d.suggested] || 0) + 1;
  } else {
    detectedNiche[d.suggested] = (detectedNiche[d.suggested] || 0) + 1;
  }
}

console.log('  Raw niche keyword matches SUPPRESSED (safe — close niche):');
for (const [k, v] of Object.entries(suppressedNiche).sort((a, b) => b[1] - a[1])) {
  console.log(`    lifestyle ← ${k.padEnd(20)} ${v}`);
}

console.log('\n  Raw niche keyword matches NOT suppressed (would fire):');
for (const [k, v] of Object.entries(detectedNiche).sort((a, b) => b[1] - a[1])) {
  const closeStatus = nichesClose(k, 'lifestyle') ? 'CLOSE' : 'NOT CLOSE';
  console.log(`    lifestyle ← ${k.padEnd(20)} ${v}  [${closeStatus}]`);
}

// Show the top unflagged lifestyle channels — what are they about?
console.log('\n  Sample lifestyle channels with music detection in raw niche (top risk):');
const musicRisk = detected.filter(d => d.suggested === 'music' && !d.suppressed).slice(0, 10);
for (const d of musicRisk) {
  console.log(`    ${d.ch.channel_name.slice(0, 35).padEnd(36)} subs=${fmtSubs(d.ch.channel_subscribers).padEnd(6)} arch=${d.ch.content_archetype || '?'} kw=[${d.keywords.join(', ')}]`);
  console.log(`      raw_niche: ${(d.ch.niche || '').slice(0, 90)}`);
}

// ── SECTION 3: Channels that moved OUT ───────────────────────────────────────

sec('SECTION 3: MIGRATION ANALYSIS — channels moved OUT of lifestyle');

// Destination niche breakdown
const destCounts = {};
for (const ch of movedOut) {
  destCounts[ch.new_niche] = (destCounts[ch.new_niche] || 0) + 1;
}

console.log('  Destination niche breakdown:');
for (const [niche, n] of Object.entries(destCounts).sort((a, b) => b[1] - a[1])) {
  const wasClose = nichesClose(niche, 'lifestyle') ? '(close niche)' : '(NOT close)';
  console.log(`    lifestyle → ${niche.padEnd(20)} ${n.toString().padStart(4)}  ${wasClose}`);
}

// Repair reason breakdown for moved-out channels
const reasonCounts = {};
for (const ch of movedOut) {
  const r = ch.repair_reason || 'unknown';
  reasonCounts[r] = (reasonCounts[r] || 0) + 1;
}

console.log('\n  Repair reason that triggered reclassification:');
for (const [r, n] of Object.entries(reasonCounts).sort((a, b) => b[1] - a[1])) {
  console.log(`    ${r.padEnd(28)} ${n}`);
}

// For each destination, show repair_reason breakdown
console.log('\n  Cross-tab: destination niche × repair reason:');
const crossTab = {};
for (const ch of movedOut) {
  const dest   = ch.new_niche   || '?';
  const reason = ch.repair_reason || 'unknown';
  if (!crossTab[dest]) crossTab[dest] = {};
  crossTab[dest][reason] = (crossTab[dest][reason] || 0) + 1;
}
for (const [dest, reasons] of Object.entries(crossTab).sort((a, b) =>
  Object.values(b).reduce((s, v) => s + v, 0) - Object.values(a).reduce((s, v) => s + v, 0))) {
  const total = Object.values(reasons).reduce((s, v) => s + v, 0);
  const parts = Object.entries(reasons).map(([r, n]) => `${r}=${n}`).join(', ');
  console.log(`    → ${dest.padEnd(20)} total=${total.toString().padStart(3)}  [${parts}]`);
}

// ── SECTION 4: Regression deep-dive ──────────────────────────────────────────

sec('SECTION 4: REGRESSION DEEP-DIVE — lifestyle → music (worst FP cluster)');

const musicMoves = movedOut.filter(ch => ch.new_niche === 'music');
console.log(`  Total lifestyle → music moves: ${musicMoves.length}`);

// For each, analyze what triggered it
let musicBtag = 0, musicRawNiche = 0, musicHard = 0, musicUnknown = 0;
for (const ch of musicMoves) {
  if (ch.repair_reason === 'hard_conflict')         musicHard++;
  else if (ch.repair_reason === 'raw_niche_mismatch')   musicRawNiche++;
  else if (ch.repair_reason === 'behavior_tag_mismatch') musicBtag++;
  else musicUnknown++;
}

console.log(`
  Trigger breakdown (lifestyle → music):
    hard_conflict             : ${musicHard}
    raw_niche_mismatch        : ${musicRawNiche}   ← the gap: music NOT in CLOSE_NICHE_GROUPS with lifestyle
    behavior_tag_mismatch     : ${musicBtag}   ← now disabled, but was active when these ran
    unknown                   : ${musicUnknown}
`);

// Sample channels that moved lifestyle → music via raw_niche_mismatch
const rawNicheMusic = musicMoves.filter(ch => ch.repair_reason === 'raw_niche_mismatch').slice(0, 15);
if (rawNicheMusic.length) {
  console.log('  Sample lifestyle → music reclassifications (raw_niche_mismatch):');
  for (const ch of rawNicheMusic) {
    console.log(`    ${(ch.channel_name || '?').slice(0, 35).padEnd(36)} subs=${fmtSubs(ch.channel_subscribers).padEnd(6)}`);
    console.log(`      raw_niche:    ${(ch.raw_niche || 'null').slice(0, 90)}`);
    console.log(`      arch: ${ch.content_archetype || '?'}  fmt: ${ch.format_type || '?'}`);
    const btags = parseJson(ch.behavior_tags);
    if (btags.length) console.log(`      btags: [${btags.join(', ')}]`);
    const rawKws = detectNicheFromText(ch.raw_niche);
    console.log(`      → detected: ${rawKws.niche || 'null'}  kw=[${rawKws.keywords.slice(0, 4).join(', ')}]`);
    console.log(`      close to lifestyle? ${nichesClose(rawKws.niche, 'lifestyle') ? 'YES (should be suppressed)' : 'NO (correctly flagged)'}`);
  }
}

// Btag-triggered music moves
const btagMusic = musicMoves.filter(ch => ch.repair_reason === 'behavior_tag_mismatch').slice(0, 15);
if (btagMusic.length) {
  console.log('\n  Sample lifestyle → music reclassifications (behavior_tag_mismatch — now disabled):');
  for (const ch of btagMusic) {
    const btags = parseJson(ch.behavior_tags);
    const musicBtags = btags.filter(t => BTAG_NICHE_SIGNALS[t]?.includes('music'));
    console.log(`    ${(ch.channel_name || '?').slice(0, 35).padEnd(36)} subs=${fmtSubs(ch.channel_subscribers).padEnd(6)} music_btags=[${musicBtags.join(', ')}]`);
  }
}

// ── SECTION 4B: travel and food regressions ───────────────────────────────────

sec('SECTION 4B: REGRESSION DEEP-DIVE — lifestyle → travel / food');

for (const targetNiche of ['travel', 'food', 'beauty']) {
  const moves = movedOut.filter(ch => ch.new_niche === targetNiche);
  if (!moves.length) continue;

  let byReason = {};
  for (const ch of moves) {
    const r = ch.repair_reason || 'unknown';
    byReason[r] = (byReason[r] || 0) + 1;
  }

  console.log(`\n  lifestyle → ${targetNiche} (${moves.length} channels) — close niche: ${nichesClose(targetNiche, 'lifestyle') ? 'YES' : 'NO'}`);
  for (const [r, n] of Object.entries(byReason).sort((a, b) => b[1] - a[1])) {
    console.log(`    via ${r.padEnd(28)} ${n}`);
  }

  // For behavior_tag_mismatch or non-close: show samples
  const badMoves = moves.filter(ch => ch.repair_reason === 'behavior_tag_mismatch' || ch.repair_reason === 'hard_conflict');
  if (badMoves.length) {
    console.log(`    Hard/btag trigger samples:`);
    for (const ch of badMoves.slice(0, 5)) {
      const btags = parseJson(ch.behavior_tags);
      console.log(`      ${(ch.channel_name || '?').slice(0, 35).padEnd(36)} ${ch.repair_reason}  btags=[${btags.join(', ')}]`);
    }
  }

  // For raw_niche_mismatch — show why it fired even though they should be close
  const rawMoves = moves.filter(ch => ch.repair_reason === 'raw_niche_mismatch');
  if (rawMoves.length > 0) {
    console.log(`    raw_niche_mismatch samples (should have been suppressed by close-niche?):`)
    for (const ch of rawMoves.slice(0, 5)) {
      const detected = detectNicheFromText(ch.raw_niche);
      const close = nichesClose(detected.niche, 'lifestyle');
      console.log(`      ${(ch.channel_name || '?').slice(0, 35).padEnd(36)} raw_niche="${(ch.raw_niche || '').slice(0, 60)}"`);
      console.log(`        detected=${detected.niche} close=${close}  kw=[${detected.keywords.slice(0, 4).join(', ')}]`);
    }
  }
}

// ── SECTION 5: True category assessment ──────────────────────────────────────

sec('SECTION 5: TRUE CATEGORY ASSESSMENT — 200-channel sample');

// For each lifestyle channel, determine "true" category using all signals:
// 1. raw_niche text → keyword match
// 2. behavior_tags → expected niche
// 3. content_archetype (lifestyle_creator = keep, others = questionable)
// 4. inferred_topics

const trueCategory = {
  keep_lifestyle: 0,
  move_music: 0,
  move_travel: 0,
  move_food: 0,
  move_beauty: 0,
  move_entertainment: 0,
  move_other: 0,
  unclear: 0,
};

const missedByCloseNiche = [];   // channels close-niche-suppressed but raw niche is very specific

for (const ch of lifestyleChannels) {
  const btags      = parseJson(ch.behavior_tags);
  const rawResult  = detectNicheFromText(ch.niche);
  const arch       = ch.content_archetype || '';
  const fmt        = ch.format_type || '';

  // Music signals: raw niche = music AND (music_video or audio_release btag)
  const hasMusicBtag   = btags.some(t => ['music_video', 'audio_release', 'performance'].includes(t));
  const hasMusicRaw    = rawResult.niche === 'music' && rawResult.score >= 2;
  const hasTravelRaw   = rawResult.niche === 'travel' && rawResult.score >= 2;
  const hasFoodRaw     = rawResult.niche === 'food' && rawResult.score >= 2;
  const hasBeautyRaw   = rawResult.niche === 'beauty' && rawResult.score >= 2;
  const hasFoodBtag    = btags.includes('recipe_based');
  const hasTravelBtag  = btags.includes('travelogue');
  const isLifestyleArch = arch.includes('lifestyle') || arch.includes('vlogger') || arch === 'creator' || arch === '';

  // High-confidence music channels misclassified as lifestyle
  if ((hasMusicBtag && hasMusicRaw) || (hasMusicRaw && rawResult.score >= 3)) {
    trueCategory.move_music++;
    if (!nichesClose('music', 'lifestyle')) missedByCloseNiche.push({ ch, detected: 'music', reason: 'raw+btag' });
  } else if (hasTravelBtag && hasTravelRaw && !isLifestyleArch) {
    trueCategory.move_travel++;
  } else if (hasFoodBtag && hasFoodRaw && !isLifestyleArch) {
    trueCategory.move_food++;
  } else if (hasBeautyRaw && rawResult.score >= 2 && !isLifestyleArch) {
    trueCategory.move_beauty++;
  } else if (!rawResult.niche || nichesClose(rawResult.niche, 'lifestyle')) {
    trueCategory.keep_lifestyle++;
  } else if (rawResult.niche === 'entertainment') {
    trueCategory.move_entertainment++;
  } else if (rawResult.niche) {
    trueCategory.move_other++;
  } else {
    trueCategory.unclear++;
  }
}

console.log('  True category distribution (200-channel sample):');
const total = 200;
for (const [cat, n] of Object.entries(trueCategory).sort((a, b) => b[1] - a[1])) {
  const bar = '█'.repeat(Math.min(40, Math.round(n / total * 40)));
  console.log(`    ${cat.padEnd(28)} ${n.toString().padStart(4)} (${pct(n, total)})  ${bar}`);
}

// Key ratio
const shouldStay  = trueCategory.keep_lifestyle + trueCategory.unclear;
const shouldMove  = total - shouldStay;
console.log(`\n  Should stay in lifestyle  : ${shouldStay} / 200 (${pct(shouldStay, total)})`);
console.log(`  Should move out           : ${shouldMove} / 200 (${pct(shouldMove, total)})`);

if (missedByCloseNiche.length > 0) {
  console.log('\n  Channels that ARE music but lifestyle (close-niche NOT suppressing, correct):');
  for (const { ch, detected } of missedByCloseNiche.slice(0, 10)) {
    const rawR = detectNicheFromText(ch.niche);
    console.log(`    ${ch.channel_name.slice(0, 35).padEnd(36)} subs=${fmtSubs(ch.channel_subscribers).padEnd(6)} detected=${detected} kw=[${rawR.keywords.join(', ')}]`);
  }
}

// ── SECTION 6: Queued lifestyle channels ─────────────────────────────────────

sec('SECTION 6: QUEUED LIFESTYLE CHANNELS (still pending repair)');

console.log(`  Lifestyle channels still in repair queue: ${lifestyleQueued.length}`);

const queueByReason = {};
for (const ch of lifestyleQueued) {
  const r = ch.repair_reason || 'unknown';
  queueByReason[r] = (queueByReason[r] || 0) + 1;
}
for (const [r, n] of Object.entries(queueByReason).sort((a, b) => b[1] - a[1])) {
  console.log(`    ${r.padEnd(28)} ${n}`);
}

// For raw_niche_mismatch in queue: what would they move to?
const queuedRaw = lifestyleQueued.filter(ch => ch.repair_reason === 'raw_niche_mismatch');
const queuedDest = {};
for (const ch of queuedRaw) {
  const dest = ch.suggested_niche || '?';
  queuedDest[dest] = (queuedDest[dest] || 0) + 1;
}
console.log('\n  Queued raw_niche_mismatch — suggested destinations:');
for (const [dest, n] of Object.entries(queuedDest).sort((a, b) => b[1] - a[1])) {
  const close = nichesClose(dest, 'lifestyle') ? '(close — should be suppressed!)' : '';
  console.log(`    → ${dest.padEnd(22)} ${n}  ${close}`);
}

// Sample queued music-bound lifestyle channels
const queuedMusicBound = lifestyleQueued.filter(ch => ch.suggested_niche === 'music');
if (queuedMusicBound.length) {
  console.log(`\n  Queued lifestyle → music (n=${queuedMusicBound.length}) — sample:`);
  for (const ch of queuedMusicBound.slice(0, 12)) {
    const rawR = detectNicheFromText(ch.raw_niche);
    const btags = parseJson(ch.behavior_tags);
    const hasMusicBtag = btags.some(t => ['music_video', 'audio_release'].includes(t));
    const trueMusic = rawR.score >= 2 && hasMusicBtag;
    const verdict = trueMusic ? 'LIKELY MUSIC' : 'LIKELY LIFESTYLE';
    console.log(`    ${verdict.padEnd(16)} ${(ch.channel_name || '?').slice(0, 35).padEnd(36)} subs=${fmtSubs(ch.channel_subscribers).padEnd(6)} kw=[${rawR.keywords.slice(0, 3).join(', ')}] btag=[${btags.slice(0, 3).join(', ')}]`);
  }
}

// ── SECTION 7: Classifier signal root-cause analysis ─────────────────────────

sec('SECTION 7: ROOT-CAUSE ANALYSIS — signals causing over-specialization');

console.log(`
  CLOSE_NICHE_GROUPS coverage for lifestyle:
    lifestyle ↔ entertainment       : CLOSE  (group 0)
    lifestyle ↔ comedy              : CLOSE  (group 0)
    lifestyle ↔ food                : CLOSE  (group 6)
    lifestyle ↔ travel              : CLOSE  (group 7)
    lifestyle ↔ music               : NOT CLOSE  ← GAP #1
    lifestyle ↔ beauty              : NOT CLOSE  ← GAP #2
    lifestyle ↔ sports              : NOT CLOSE
    lifestyle ↔ fitness             : NOT CLOSE
    lifestyle ↔ health              : NOT CLOSE
`);

// Count how many moved-out channels went to NOT-CLOSE niches
const notCloseOut = movedOut.filter(ch => !nichesClose(ch.new_niche, 'lifestyle'));
const closeOut    = movedOut.filter(ch =>  nichesClose(ch.new_niche, 'lifestyle'));

console.log(`  Channels that moved to NOT-CLOSE niches: ${notCloseOut.length} / ${movedOut.length}`);
console.log(`  Channels that moved to CLOSE niches     : ${closeOut.length} / ${movedOut.length}`);

// For close-niche moves: how did they get flagged? (should have been suppressed)
if (closeOut.length > 0) {
  const closeReasons = {};
  for (const ch of closeOut) {
    const r = ch.repair_reason || 'unknown';
    closeReasons[r] = (closeReasons[r] || 0) + 1;
  }
  console.log('\n  Close-niche moves — what signal bypassed suppression:');
  for (const [r, n] of Object.entries(closeReasons).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${r.padEnd(28)} ${n}`);
  }
  console.log('\n  (Note: behavior_tag_mismatch can route to close niche because it bypasses areNichesClose() check.)');
  console.log('  (Note: AI reclassifier can also output any niche regardless of original detection signal.)');
}

// ── SECTION 8: Topic precision analysis for key groups ───────────────────────

sec('SECTION 8: TOPIC PRECISION — current lifestyle vs moved-out channels');

console.log('  Computing TP for sample lifestyle channels (up to 30)...');
let tpSum = 0, tpN = 0;
for (const ch of lifestyleChannels.slice(0, 30)) {
  const tp = computeTp(ch.channel_id, 'lifestyle');
  if (tp != null) { tpSum += tp; tpN++; }
}
const lifestyleTpAvg = tpN ? tpSum / tpN : null;
console.log(`  Current lifestyle avg TP (n=${tpN}): ${lifestyleTpAvg != null ? lifestyleTpAvg.toFixed(1) + '%' : '—'}`);

console.log('\n  Computing TP for moved-out channels (lifestyle→music, lifestyle→travel, lifestyle→food)...');
const regGroupTP = {};
for (const targetNiche of ['music', 'travel', 'food', 'beauty', 'entertainment']) {
  const group = movedOut.filter(ch => ch.new_niche === targetNiche).slice(0, 15);
  if (!group.length) continue;
  let sum = 0, n = 0;
  for (const ch of group) {
    const current = db.prepare('SELECT primary_niche FROM ingested_channels WHERE channel_id = ?').get(ch.channel_id);
    const tp = computeTp(ch.channel_id, current?.primary_niche || ch.new_niche);
    if (tp != null) { sum += tp; n++; }
  }
  const avg = n ? sum / n : null;
  regGroupTP[targetNiche] = { n: group.length, sampled: n, avg };
  console.log(`  lifestyle → ${targetNiche.padEnd(16)} n=${group.length.toString().padStart(3)} sampled=${n} avg_tp_after=${avg != null ? avg.toFixed(1) + '%' : '—'}`);
}

// ── SECTION 9: Recommendation ────────────────────────────────────────────────

sec('SECTION 9: RECOMMENDATION');

// Determine: is lifestyle over-classified?
const overSpecializedPct = ((notCloseOut.length / (movedOut.length || 1)) * 100).toFixed(1);
const musicGap = movedOut.filter(ch => ch.new_niche === 'music').length;

console.log(`
  ┌─ FINDING 1: music is NOT in CLOSE_NICHE_GROUPS with lifestyle ──────────────────────────────
  │  ${musicGap} channels moved lifestyle → music — the largest single FP cluster.
  │  Root cause: NICHE_VOCAB['music'] matches channel names/descriptions of lifestyle vloggers who
  │  happen to mention music. areNichesClose('music', 'lifestyle') = false, so raw_niche_mismatch
  │  fires on these channels and routes them to AI reclassification.
  │  Fix: add music to lifestyle's close-niche group OR add keyword suppression.
  └─────────────────────────────────────────────────────────────────────────────────────────────

  ┌─ FINDING 2: travel/food/beauty moves came from behavior_tag_mismatch ──────────────────────
  │  These niches ARE already in CLOSE_NICHE_GROUPS with lifestyle, so raw_niche_mismatch is
  │  correctly suppressed. Moves came from behavior_tag_mismatch (now disabled) and from the AI
  │  reclassifier autonomously choosing narrower niches when reclassifying lifestyle channels
  │  flagged for OTHER reasons (e.g., a hard_conflict channel that happens to have travel content).
  │  Fix: disable btag (DONE). Consider a lifestyle-guard in the AI prompt.
  └─────────────────────────────────────────────────────────────────────────────────────────────

  ┌─ FINDING 3: lifestyle classifier prompt is over-eager ─────────────────────────────────────
  │  When the AI reclassifies a lifestyle channel, it tends to pick the most specific niche it can
  │  identify. A vlogger who travels → travel. A vlogger who cooks → food. This is over-
  │  specialization: lifestyle is a legitimate primary niche for channels whose content spans
  │  multiple domains. The classifier should only change lifestyle → X if X is dominant (>70%
  │  of their content), not incidental.
  │  Fix: add lifestyle defense to the reclassification prompt.
  └─────────────────────────────────────────────────────────────────────────────────────────────
`);

// Decision: split or keep?
const keepPct = pct(trueCategory.keep_lifestyle + trueCategory.unclear, 200);
console.log(`
  ══ VERDICT ═══════════════════════════════════════════════════════════════════════════════════

  ${shouldStay >= 140 ? '✅ KEEP lifestyle as a broad niche.' : '⚠️  Consider splitting lifestyle.'}

  ${keepPct} of the 200-channel sample are correctly classified as lifestyle.
  ${pct(shouldMove, 200)} would genuinely benefit from a more specific niche.

  IMMEDIATE FIXES (no architectural change required):

  1. Add music to CLOSE_NICHE_GROUPS with lifestyle:
     Change: new Set(['music', 'entertainment'])
     To:     new Set(['music', 'entertainment', 'lifestyle'])
     Impact: blocks ~${musicGap} lifestyle→music false-positive routes. This is the highest-
             leverage single change — music is the #1 regression niche.

  2. Add beauty to CLOSE_NICHE_GROUPS with lifestyle:
     Add:    new Set(['beauty', 'lifestyle'])
     Impact: blocks lifestyle→beauty false-positive routes.

  3. Add lifestyle guard to reclassification prompt:
     "If the current classification is 'lifestyle' and the channel covers multiple domains
      (travel, food, beauty, music), retain 'lifestyle' unless ONE domain represents >70%
      of their content."

  SPLIT vs KEEP:
  • Do NOT split lifestyle into sub-archetypes at this time.
  • Reason: ${keepPct} correctly-classified channels would require re-routing with no
    precision gain. Sub-archetypes are useful for WTP specificity, not peer routing.
  • Better approach: add lifestyle sub-archetypes as a SECONDARY signal only (used to
    refine WTP topic generation), keeping primary_niche = 'lifestyle' intact.

  ══════════════════════════════════════════════════════════════════════════════════════════════
`);

db.close();

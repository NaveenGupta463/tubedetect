'use strict';

// ── Stabilization check — read-only diagnostics, do NOT commit ────────────────
// Calls resolveCreatorPeerContext + computeWhatToPost directly for 8 channels
// and prints a structured per-channel report.

const { getDb }                       = require('../db/init');
const { resolveCreatorPeerContext }   = require('../services/creatorPeerContext');
const { computeWhatToPost }           = require('../services/whatToPost');
const { STOPWORDS, HOOK_PHRASES, SOUTH_SCRIPT_RE, DEVANAGARI_RE, extractPhrases } = require('../lib/phrases');
const { PODCAST_META_TOKENS }         = require('../lib/creatorMode');

// ── Inline helpers copied from server/routes/creatorIntel.js ─────────────────

function classifyTrend(b) {
  const d0 = b.cnt_0_14  / 14;
  const d1 = b.cnt_15_30 / 16;
  const d2 = b.cnt_31_60 / 30;
  const d3 = b.cnt_61_90 / 30;
  if (d0 > 0 && d0 >= d1 * 1.8 && d0 >= d2 * 0.7)       return 'rising';
  const vals = [d0, d1, d2, d3];
  const mean = vals.reduce((s, v) => s + v, 0) / 4;
  if (mean > 0.02 && Math.max(...vals.map(v => Math.abs(v - mean))) / (mean || 1) < 0.6)
    return 'evergreen';
  if (d0 > 0 && d0 >= d1 * 0.5)                          return 'peaking';
  if (d3 > 0 && d0 < d3 * 0.4) {
    if (b.vel_pairs && b.vel_pairs.length >= 2) {
      const avgRatio = b.vel_pairs.reduce((s, p) => s + p.v30 / Math.max(1, p.v7), 0) / b.vel_pairs.length;
      if (avgRatio >= 2) return 'peaking';
    }
    return 'fading';
  }
  return 'dormant';
}

const FORMAT_LABELS = { shorts: 'Shorts', quick: '1-5 min', mid: '8-15 min', long: '15+ min' };

function getFormatWinner(formats, totalVids) {
  if (totalVids < 3) return null;
  let best = null, bestAvg = 0;
  for (const [key, f] of Object.entries(formats)) {
    if (f.count > 0) {
      const avg = f.totalViews / f.count;
      if (avg > bestAvg) { bestAvg = avg; best = key; }
    }
  }
  if (!best) return null;
  return {
    key:       best,
    label:     FORMAT_LABELS[best],
    pct:       Math.round(formats[best].count / totalVids * 100),
    avg_views: Math.round(bestAvg),
  };
}

function getVelocity(pairs) {
  if (pairs.length < 2) return null;
  const avg = pairs.reduce((s, p) => s + p.v30 / p.v7, 0) / pairs.length;
  return {
    status: avg >= 3 ? 'fast' : avg >= 1.5 ? 'growing' : 'peaked',
    ratio:  parseFloat(avg.toFixed(1)),
  };
}

// ── Context bundle passed to computeWhatToPost ───────────────────────────────

const ctx = {
  resolveCreatorPeerContext,
  extractPhrases,
  getVelocity,
  classifyTrend,
  getFormatWinner,
  PODCAST_META_TOKENS,
  STOPWORDS,
  HOOK_PHRASES,
  SOUTH_SCRIPT_RE,
  DEVANAGARI_RE,
};

// ── Channel list ─────────────────────────────────────────────────────────────

const CHANNELS = [
  { channel_id: 'UCzwCEE_PchiBULMnAJqhGVg', channel_name: 'Raj Shamani' },
  { channel_id: 'UCPxMZIFE856tbTfdkdjzTSQ', channel_name: 'BeerBiceps' },
  { channel_id: 'UCKZozRVHRYsYHGEyNKuhhdA', channel_name: 'Think School' },
  { channel_id: 'UCS6krtC5Nq0sUe7sTi3tQAw', channel_name: 'Dr Amiett Kumar' },
  { channel_id: 'UCqOy6oOu6RPJNHYQ8f_Ybvg', channel_name: 'UPSC Wallah' },
  { channel_id: 'UCt4t-jeY85JegMlZ-E5UWtA', channel_name: 'Aaj Tak' },
  { channel_id: 'UCnC8SAZzQiBGYVSKZ_S3y4Q', channel_name: 'Nikhil Kamath' },
  { channel_id: 'UCwVEhEzsjLym_u1he4XWFkg', channel_name: 'Finance With Sharan' },
];

// ── Run ───────────────────────────────────────────────────────────────────────

const db = getDb();

console.log('\n' + '='.repeat(80));
console.log('  TUBEINTEL STABILIZATION CHECK');
console.log('  ' + new Date().toISOString());
console.log('='.repeat(80));

for (const { channel_id, channel_name } of CHANNELS) {
  console.log('\n' + '-'.repeat(80));
  console.log(`CHANNEL: ${channel_name} (${channel_id})`);
  console.log('-'.repeat(80));

  // Verify channel exists
  const row = db.get('SELECT channel_id, channel_name FROM ingested_channels WHERE channel_id = ?', [channel_id]);
  if (!row) {
    console.log('  STATUS: MISSING — not found in ingested_channels, skipping');
    continue;
  }

  // ── Step 1: resolveCreatorPeerContext ──────────────────────────────────────
  let peerCtx;
  try {
    peerCtx = resolveCreatorPeerContext(db, channel_id, {});
  } catch (err) {
    console.log('  resolveCreatorPeerContext ERROR:', err.message);
    continue;
  }

  console.log('\n  [PEER CONTEXT]');
  console.log(`  creator_mode                  : ${peerCtx.creator_mode ?? 'null'}`);
  console.log(`  routing_profile               : ${peerCtx.rp_result?.profile ?? 'null'}`);
  console.log(`  routing_profile_confidence    : ${peerCtx.rp_result?.confidence ?? 'null'}`);
  console.log(`  routing_profile_active        : ${peerCtx.routing_profile_active ?? 'null'}`);
  console.log(`  format_profile                : ${peerCtx.fp_result?.format_profile ?? 'null'}`);
  console.log(`  format_profile_confidence     : ${peerCtx.fp_result?.confidence ?? 'null'}`);
  console.log(`  guest_intel_active            : ${peerCtx.guest_intel_active ?? 'null'}`);
  console.log(`  peer_ids_count                : ${Array.isArray(peerCtx.peerIds) ? peerCtx.peerIds.length : 'null'}`);
  console.log(`  resolved_niche                : ${peerCtx.resolved_niche ?? 'null'}`);
  console.log(`  user_region                   : ${peerCtx.user_region ?? 'null'}`);

  // ── Step 2: computeWhatToPost ──────────────────────────────────────────────
  let result;
  try {
    result = computeWhatToPost(db, { channel_id }, ctx);
  } catch (err) {
    console.log('\n  computeWhatToPost ERROR:', err.message);
    console.log('  Stack:', err.stack?.split('\n').slice(0, 5).join('\n  '));
    continue;
  }

  console.log('\n  [WHAT-TO-POST RESULT]');
  console.log(`  ok                            : ${result.ok ?? 'null'}`);
  console.log(`  channel_count                 : ${result.channel_count ?? 'null'}`);
  console.log(`  video_count                   : ${result.video_count ?? 'null'}`);
  console.log(`  creator_mode                  : ${result.creator_mode ?? 'null'}`);
  console.log(`  routing_profile               : ${result.routing_profile ?? 'null'}`);
  console.log(`  routing_profile_confidence    : ${result.routing_profile_confidence ?? 'null'}`);
  console.log(`  format_profile                : ${result.format_profile ?? 'null'}`);
  console.log(`  format_profile_confidence     : ${result.format_profile_confidence ?? 'null'}`);
  console.log(`  guest_intel_active            : ${result.guest_intel_active ?? 'null'}`);
  console.log(`  output_engine.engine_id       : ${result.output_engine?.engine_id ?? 'null'}`);
  console.log(`  ideas.length                  : ${result.ideas?.length ?? 'null'}`);
  console.log(`  podcast_intel.peer_source     : ${result.podcast_intel?.peer_source ?? 'null'}`);
  console.log(`  podcast_intel.peer_count      : ${result.podcast_intel?.peer_count ?? 'null'}`);
  console.log(`  podcast_intel.guests.length   : ${result.podcast_intel?.guests?.length ?? 'null'}`);
  console.log(`  podcast_intel.themes.length   : ${result.podcast_intel?.themes?.length ?? 'null'}`);

  // First 5 idea topics
  const ideaTopics = result.ideas?.slice(0, 5).map(i => i.topic || i.phrase || i.anchor || '(no label)') ?? [];
  console.log(`\n  [FIRST 5 IDEA TOPICS]`);
  if (ideaTopics.length === 0) {
    console.log('  (none)');
  } else {
    ideaTopics.forEach((t, i) => console.log(`  ${i + 1}. ${t}`));
  }

  // First 5 guest names
  const guestNames = result.podcast_intel?.guests?.slice(0, 5).map(g => g.name || '(no name)') ?? [];
  console.log(`\n  [FIRST 5 PODCAST GUESTS]`);
  if (guestNames.length === 0) {
    console.log('  (none)');
  } else {
    guestNames.forEach((g, i) => console.log(`  ${i + 1}. ${g}`));
  }

  // First 5 theme names
  const themeNames = result.podcast_intel?.themes?.slice(0, 5).map(t => t.theme || '(no theme)') ?? [];
  console.log(`\n  [FIRST 5 PODCAST THEMES]`);
  if (themeNames.length === 0) {
    console.log('  (none)');
  } else {
    themeNames.forEach((t, i) => console.log(`  ${i + 1}. ${t}`));
  }

  // ── Quick sanity checks ────────────────────────────────────────────────────
  console.log(`\n  [SANITY FLAGS]`);
  const flags = [];

  if (!result.ok)                              flags.push('WARN: ok=false');
  if ((result.channel_count ?? 0) === 0)       flags.push('WARN: channel_count=0 (no peer community found)');
  if ((result.video_count ?? 0) === 0)         flags.push('WARN: video_count=0 (no community videos found)');
  if ((result.ideas?.length ?? 0) === 0)       flags.push('WARN: ideas array is empty');

  // Podcast mode with no guests
  if (result.format_profile === 'guest_interview' && result.guest_intel_active &&
      (result.podcast_intel?.guests?.length ?? 0) === 0) {
    flags.push('REGRESSION: guest_interview active but 0 guests in podcast_intel');
  }

  // News channel leaking exam content
  if (result.creator_mode === 'news' || result.routing_profile === 'news') {
    const ideaText = (result.ideas || []).map(i => (i.topic || i.phrase || i.anchor || '').toLowerCase()).join(' ');
    if (/upsc|ias|prelims|mains|neet|jee|ssc/.test(ideaText)) {
      flags.push('REGRESSION: news channel has exam-related content in ideas');
    }
  }

  // UPSC channel leaking unrelated news
  if (result.routing_profile === 'upsc_exam' || result.creator_mode === 'upsc') {
    const ideaText = (result.ideas || []).map(i => (i.topic || i.phrase || i.anchor || '').toLowerCase()).join(' ');
    if (/(cricket|ipl|bollywood|movie|actor|actress|entertainment)/.test(ideaText)) {
      flags.push('REGRESSION: UPSC/exam channel has entertainment content leaking in ideas');
    }
  }

  if (flags.length === 0) {
    console.log('  PASS — no issues detected');
  } else {
    for (const f of flags) console.log('  ' + f);
  }
}

console.log('\n' + '='.repeat(80));
console.log('  END OF STABILIZATION CHECK');
console.log('='.repeat(80) + '\n');

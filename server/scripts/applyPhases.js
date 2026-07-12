'use strict';
// Applies phases 1a-1d + Phase 2 to creatorIntel.js.
// Six non-overlapping ranges, applied bottom-to-top so no removal shifts another.

const fs   = require('fs');
const path = require('path');
const FILE = path.join(__dirname, '../routes/creatorIntel.js');

let src = fs.readFileSync(FILE, 'utf8');

// ── Anchor map ───────────────────────────────────────────────────────────────
const ANCHORS = {
  // R1: Topic hierarchy section → VERB_STOPWORDS
  r1S: '// ── Topic hierarchy',
  r1E: 'function extractPhrases(',
  // R2: _fmtV
  r2S: 'function _fmtV(n)',
  r2E: '// ── Trend classifier',
  // R3: CONTENT_MODIFIERS..buildWhyText
  r3S: '// ── Semantic canonicalization',
  r3E: '// ── Niche → recommendation category',
  // R4: computeNarrativeSignalsInline + guest extract + lanes + computePodcastIntel
  //     + podcast themes + mode-pure header + podcast constants (up to but NOT including
  //     the routing profile peer resolver section, which stays for resolveCreatorPeerContext)
  r4S: '// Inline narrative lifecycle signals',
  r4E: '// ── Routing profile peer resolver',
  // R5: computePodcastModePeers (the resolver section between R4 and R5 stays)
  r5S: 'function computePodcastModePeers(',
  r5E: '// ── Shared peer context resolver',
  // R6: computeWhatToPost function only
  r6S: 'function computeWhatToPost(',
  r6E: '// ── Topic search',
  // call site and exports
  callSite:    'res.json(computeWhatToPost(getDb(), req.query));',
  exportsLine: 'module.exports.computeWhatToPost = computeWhatToPost;\n',
  insertAfter: "require('../services/channelClassifier');",
};

for (const [key, anchor] of Object.entries(ANCHORS)) {
  if (src.indexOf(anchor) === -1) throw new Error(`Anchor missing: ${key} = ${JSON.stringify(anchor)}`);
}
console.log('All anchors verified.');

// ── Validate ranges are non-overlapping and in correct order ─────────────────
const rawRanges = [
  ['R1', src.indexOf(ANCHORS.r1S), src.indexOf(ANCHORS.r1E)],
  ['R2', src.indexOf(ANCHORS.r2S), src.indexOf(ANCHORS.r2E)],
  ['R3', src.indexOf(ANCHORS.r3S), src.indexOf(ANCHORS.r3E)],
  ['R4', src.indexOf(ANCHORS.r4S), src.indexOf(ANCHORS.r4E)],
  ['R5', src.indexOf(ANCHORS.r5S), src.indexOf(ANCHORS.r5E)],
  ['R6', src.indexOf(ANCHORS.r6S), src.indexOf(ANCHORS.r6E)],
];
rawRanges.sort((a, b) => a[1] - b[1]);
for (let i = 0; i < rawRanges.length - 1; i++) {
  if (rawRanges[i][2] > rawRanges[i + 1][1]) {
    throw new Error(`Overlap: ${rawRanges[i][0]} ends ${rawRanges[i][2]} > ${rawRanges[i+1][0]} starts ${rawRanges[i+1][1]}`);
  }
}
rawRanges.forEach(([n, s, e]) => console.log(`  ${n}: ${s}->${e} (${e - s} bytes)`));

// ── Apply removals bottom-to-top ─────────────────────────────────────────────
function removeRange(label, startAnchor, endAnchor) {
  const s = src.indexOf(startAnchor);
  const e = src.indexOf(endAnchor);
  if (s === -1 || e === -1 || e <= s) throw new Error(`Bad range for ${label}: s=${s} e=${e}`);
  console.log(`Removing ${label}: ${s}->${e} (${e - s} bytes)`);
  src = src.slice(0, s) + src.slice(e);
}

removeRange('R6 (computeWhatToPost)', ANCHORS.r6S, ANCHORS.r6E);
removeRange('R5 (computePodcastModePeers)', ANCHORS.r5S, ANCHORS.r5E);
removeRange('R4 (computeNarrativeSignalsInline + podcast phases 1a-1d)', ANCHORS.r4S, ANCHORS.r4E);
removeRange('R3 (CONTENT_MODIFIERS..buildWhyText)', ANCHORS.r3S, ANCHORS.r3E);
removeRange('R2 (_fmtV)', ANCHORS.r2S, ANCHORS.r2E);
removeRange('R1 (Topic hierarchy..VERB_STOPWORDS)', ANCHORS.r1S, ANCHORS.r1E);

// ── Remove module.exports.computeWhatToPost ──────────────────────────────────
if (src.includes(ANCHORS.exportsLine)) {
  src = src.replace(ANCHORS.exportsLine, '');
  console.log('Removed module.exports.computeWhatToPost.');
} else {
  console.warn('WARNING: module.exports.computeWhatToPost line not found.');
}

// ── Update computeWhatToPost call site ───────────────────────────────────────
const OLD_CALL = ANCHORS.callSite;
const NEW_CALL = `res.json(computeWhatToPost(getDb(), req.query, {
    resolveCreatorPeerContext, extractPhrases, getVelocity, classifyTrend, getFormatWinner,
    PODCAST_META_TOKENS, STOPWORDS, HOOK_PHRASES, SOUTH_SCRIPT_RE, DEVANAGARI_RE,
  }));`;

if (src.includes(OLD_CALL)) {
  src = src.replace(OLD_CALL, NEW_CALL);
  console.log('Updated computeWhatToPost call site.');
} else {
  throw new Error('computeWhatToPost call site not found!');
}

// ── Add imports after channelClassifier require ───────────────────────────────
const insertAt = src.indexOf(ANCHORS.insertAfter) + ANCHORS.insertAfter.length;
const IMPORTS = `
const { PODCAST_LANE_FAMILIES, computeTargetLanes, detectItemLane } = require('../services/podcastLanes');
const { GUEST_STOPSET, GUEST_REJECT_TERMS, INSTITUTION_GUEST_TERMS, GUEST_REJECT_PHRASE_RE, GUEST_MARKER_RE, isPersonLikeName, extractGuestCandidates } = require('../services/podcastGuestExtract');
const { PODCAST_THEME_WEAK_TRAILING, PODCAST_NEWS_TERMS, PODCAST_POLITICAL_PHRASE_RE, PODCAST_BUSINESS_CONTEXT_RE, PODCAST_THEME_EXPLICIT_REJECT, PODCAST_THEME_CLICKBAIT_RE, THEME_SOCIAL_STOP, isPersonNamePhrase, computePodcastThemes } = require('../services/podcastThemes');
const { computePodcastIntel, computePodcastModePeers, PODCAST_TOKEN_STOP, STRONG_TOPIC_TOKENS, NICHE_CLUSTER_MAP, CLUSTER_QUALIFY_TOKENS, ENTERTAINMENT_SPORTS_NICHES } = require('../services/podcastIntel');
const { computeWhatToPost } = require('../services/whatToPost');`;

src = src.slice(0, insertAt) + IMPORTS + src.slice(insertAt);
console.log('Added 5 service imports.');

// ── Write & verify ────────────────────────────────────────────────────────────
fs.writeFileSync(FILE, src, 'utf8');
const lineCount = src.split('\n').length;
console.log(`\nWrote ${lineCount} lines (${src.length} bytes) to ${FILE}`);

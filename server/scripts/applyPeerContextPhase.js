'use strict';
// Applies the creatorPeerContext extraction to creatorIntel.js.
// Five non-overlapping anchor-delimited removals + import additions.
// Applied bottom-to-top to avoid position drift.

const fs   = require('fs');
const path = require('path');
const FILE = path.join(__dirname, '../routes/creatorIntel.js');

let src = fs.readFileSync(FILE, 'utf8');
const origLen = src.length;

// ── Anchors ───────────────────────────────────────────────────────────────────
const ANCHORS = {
  // A: NICHE_CLUSTERS + getNicheCluster (stop before UNIVERSAL_NICHES)
  aS: '// ── Niche clusters',
  aE: '// Niches where foreign',

  // BC (merged): STOPWORDS + HOOK_PHRASES + SOUTH_SCRIPT_RE + DEVANAGARI_RE
  //   + extractPhrases + computeFingerprint + computeFingerprintConfidence
  //   + computeSubWeight + parseFingerprintPhrases + computePeerScore
  //   + buildPeersByContent
  //   → replaced by a single require line
  bcS: '// ── What to Post ',
  bcE: '// ── Trend classifier',

  // D: NICHE_CATEGORY constants + getNicheCategory + resolvePeers
  dS: '// ── Niche → recommendation category',
  dE: '\n// ── GET /community-hot',

  // E: RESOLVER constants + resolvePeersByRoutingProfile + _NULL_CTX + resolveCreatorPeerContext
  eS: '// ── Routing profile peer resolver',
  eE: '// ── Topic search',

  // Import insertion point
  insertAfter: "require('../services/communityHot');",
};

// Verify all anchors are present
for (const [key, val] of Object.entries(ANCHORS)) {
  if (key === 'insertAfter') continue;
  if (src.indexOf(val) === -1) {
    throw new Error(`Anchor missing: ${key} = ${JSON.stringify(val)}`);
  }
}
console.log('All anchors verified.');

// ── Validate ranges are non-overlapping and in order ─────────────────────────
const ranges = [
  ['A',  src.indexOf(ANCHORS.aS),  src.indexOf(ANCHORS.aE)],
  ['BC', src.indexOf(ANCHORS.bcS), src.indexOf(ANCHORS.bcE)],
  ['D',  src.indexOf(ANCHORS.dS),  src.indexOf(ANCHORS.dE)],
  ['E',  src.indexOf(ANCHORS.eS),  src.indexOf(ANCHORS.eE)],
];
ranges.sort((a, b) => a[1] - b[1]);
for (let i = 0; i < ranges.length - 1; i++) {
  if (ranges[i][2] > ranges[i + 1][1]) {
    throw new Error(`Overlap: ${ranges[i][0]} ends ${ranges[i][2]} > ${ranges[i+1][0]} starts ${ranges[i+1][1]}`);
  }
}
ranges.forEach(([n, s, e]) => console.log(`  ${n}: ${s}->${e} (${e - s} bytes)`));

// ── Apply removals bottom-to-top ─────────────────────────────────────────────
function removeRange(label, startAnchor, endAnchor) {
  const s = src.indexOf(startAnchor);
  const e = src.indexOf(endAnchor);
  if (s === -1 || e === -1 || e <= s) throw new Error(`Bad range for ${label}: s=${s} e=${e}`);
  console.log(`Removing ${label}: ${s}->${e} (${e - s} bytes)`);
  src = src.slice(0, s) + src.slice(e);
}

// Apply in reverse order (highest position first)
removeRange('E (resolver + resolveCreatorPeerContext)', ANCHORS.eS, ANCHORS.eE);
removeRange('D (niche→cat + resolvePeers)', ANCHORS.dS, ANCHORS.dE);

// BC: replace STOPWORDS..buildPeersByContent section with a single require
{
  const s = src.indexOf(ANCHORS.bcS);
  const e = src.indexOf(ANCHORS.bcE);
  if (s === -1 || e === -1 || e <= s) throw new Error(`Bad range for BC: s=${s} e=${e}`);
  const REPLACEMENT = `const { STOPWORDS, HOOK_PHRASES, SOUTH_SCRIPT_RE, DEVANAGARI_RE, extractPhrases } = require('../lib/phrases');\n\n`;
  console.log(`Replacing BC (STOPWORDS..buildPeersByContent): ${s}->${e} (${e - s} bytes) → ${REPLACEMENT.length} bytes`);
  src = src.slice(0, s) + REPLACEMENT + src.slice(e);
}

removeRange('A (NICHE_CLUSTERS + getNicheCluster)', ANCHORS.aS, ANCHORS.aE);

// ── Add imports after communityHot require ────────────────────────────────────
const insertPos = src.indexOf(ANCHORS.insertAfter) + ANCHORS.insertAfter.length;
if (insertPos < ANCHORS.insertAfter.length) throw new Error('insertAfter anchor not found');
const IMPORTS = `
const { resolveCreatorPeerContext } = require('../services/creatorPeerContext');`;
src = src.slice(0, insertPos) + IMPORTS + src.slice(insertPos);
console.log('Added creatorPeerContext import.');

// ── Write & verify ────────────────────────────────────────────────────────────
fs.writeFileSync(FILE, src, 'utf8');
const lineCount = src.split('\n').length;
console.log(`\nWrote ${lineCount} lines (${src.length} bytes, was ${origLen} bytes) to ${FILE}`);
console.log(`Reduced by ${origLen - src.length} bytes.`);

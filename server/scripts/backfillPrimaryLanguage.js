'use strict';

// One-shot backfill for ingested_channels.primary_language.
// Mirrors the region detector (jobs/languageDetectionJob.js) but maps the same
// signals to LANGUAGE (en/hi/ta/ar…) instead of COUNTRY (region).
//
// Deterministic, free cascade (per channel, no API/LLM):
//   1. Non-Latin SCRIPT in titles  → exact language (Devanagari→hi, Tamil→ta, Arabic→ar…)
//   2. Indian language keyword in channel name ("Telugu Vlogs" → te)
//   3. Roman-script word density   → Hinglish→hi, Spanish→es
//   4. Region uniquely implies language (ES→es, JP→ja, Arab regions→ar, PK→ur…)
//   5. English region (US/GB/CA/AU…) with no regional signal → en
//   else → leave NULL (genuinely ambiguous: clean-English titles from IN / no region).
//          These are handled on-demand later — never guessed here.
//
// Also normalizes the ~250 dirty region-codes already sitting in the column
// (ae→ar, jp→ja, kr→ko, cn→zh) and lowercases everything.
//
// Usage:
//   node source/server/scripts/backfillPrimaryLanguage.js            (DRY RUN — no writes)
//   node source/server/scripts/backfillPrimaryLanguage.js --commit   (writes + clears WTP cache)

const path = require('path');
const Database = require('better-sqlite3');
const { hinglishScore, spanishScore } = require('../jobs/languageDetectionJob');

const COMMIT = process.argv.includes('--commit');
const DB_PATH = path.join(__dirname, '..', 'data', 'scoring.db');
const db = new Database(DB_PATH, COMMIT ? {} : { readonly: true });

// ── script → ISO language (order matters: Japanese kana before generic CJK) ────
const SCRIPT_LANG = [
  ['ja', /[぀-ヿ]/],   // Hiragana / Katakana
  ['ko', /[가-힣]/],   // Hangul
  ['hi', /[ऀ-ॿ]/],   // Devanagari  (Hindi/Marathi/Nepali → hi)
  ['bn', /[ঀ-৿]/],   // Bengali
  ['pa', /[਀-੿]/],   // Gurmukhi
  ['gu', /[઀-૿]/],   // Gujarati
  ['or', /[଀-୿]/],   // Odia
  ['ta', /[஀-௿]/],   // Tamil
  ['te', /[ఀ-౿]/],   // Telugu
  ['kn', /[ಀ-೿]/],   // Kannada
  ['ml', /[ഀ-ൿ]/],   // Malayalam
  ['th', /[฀-๿]/],   // Thai
  ['ar', /[؀-ۿ]/],   // Arabic
  ['he', /[֐-׿]/],   // Hebrew
  ['ru', /[Ѐ-ӿ]/],   // Cyrillic → Russian (dominant)
  ['el', /[Ͱ-Ͽ]/],   // Greek
  ['zh', /[一-鿿]/],   // CJK (after Japanese kana) → Chinese
];

function detectScriptLang(titles) {
  const tally = {};
  for (const t of titles) {
    for (const [lang, re] of SCRIPT_LANG) { if (re.test(t)) { tally[lang] = (tally[lang] || 0) + 1; break; } }
  }
  const top = Object.entries(tally).sort((a, b) => b[1] - a[1])[0];
  if (!top) return null;
  // Non-Latin script is rarely accidental; require 2 hits once we have enough titles.
  const need = titles.length >= 10 ? 2 : 1;
  return top[1] >= need ? top[0] : null;
}

// ── Indian language name keyword → language ───────────────────────────────────
const NAME_LANG = [
  [/\btelugu\b/i, 'te'], [/\btamil\b/i, 'ta'], [/\bmalayalam\b/i, 'ml'], [/\bkannada\b/i, 'kn'],
  [/\bmarathi\b/i, 'mr'], [/\bpunjabi\b/i, 'pa'], [/\bgujarati\b/i, 'gu'], [/\bodia\b/i, 'or'],
  [/\b(bangla|bengali)\b/i, 'bn'], [/\bassamese\b/i, 'as'], [/\burdu\b/i, 'ur'],
  // Hindi-belt regional languages → pool with hi for peer matching
  [/\b(bhojpuri|haryanvi|rajasthani|bihari|maithili)\b/i, 'hi'],
];
function nameLang(name) {
  if (!name) return null;
  for (const [re, lang] of NAME_LANG) if (re.test(name)) return lang;
  return null;
}

// ── region uniquely implies language ──────────────────────────────────────────
const REGION_LANG = {
  ES: 'es', MX: 'es', AR: 'es', CO: 'es', CL: 'es', PE: 'es', VE: 'es',
  JP: 'ja', KR: 'ko', TH: 'th', CN: 'zh', TW: 'zh', HK: 'zh', VN: 'vi', ID: 'id',
  BR: 'pt', PT: 'pt', DE: 'de', AT: 'de', FR: 'fr', IT: 'it', RU: 'ru', TR: 'tr',
  NL: 'nl', PL: 'pl', GR: 'el', IL: 'he', IR: 'fa', PK: 'ur', BD: 'bn', NP: 'hi',
  SA: 'ar', AE: 'ar', EG: 'ar', DZ: 'ar', MA: 'ar', IQ: 'ar', JO: 'ar', LB: 'ar',
  KW: 'ar', YE: 'ar', QA: 'ar', BH: 'ar', OM: 'ar', TN: 'ar', LY: 'ar', SY: 'ar', SD: 'ar',
};
const EN_REGIONS = new Set(['US', 'GB', 'CA', 'AU', 'IE', 'NZ', 'EN', 'ZA', 'SG']);

function computeProposed(row, titles) {
  if (titles.length < 3) return null;                                // too thin → ambiguous
  const sl = detectScriptLang(titles);
  if (sl) return { lang: sl, method: 'script' };
  const nm = nameLang(row.channel_name);
  if (nm) return { lang: nm, method: 'name_keyword' };
  const n = titles.length;
  const hi = titles.reduce((s, t) => s + hinglishScore(t), 0) / n;
  const sp = titles.reduce((s, t) => s + spanishScore(t), 0) / n;
  if (hi >= 0.25) return { lang: 'hi', method: 'hinglish_density' };
  if (sp >= 0.25) return { lang: 'es', method: 'spanish_density' };
  const reg = (row.region || '').toUpperCase();
  if (REGION_LANG[reg]) return { lang: REGION_LANG[reg], method: 'region_implies' };
  if (EN_REGIONS.has(reg)) return { lang: 'en', method: 'english_region' };
  return null;                                                        // genuinely ambiguous
}

// ── normalize dirty existing values (region-codes in the language column) ──────
const NORMALIZE = { ae: 'ar', jp: 'ja', kr: 'ko', cn: 'zh' };

// ── run ───────────────────────────────────────────────────────────────────────
console.log(`\n=== primary_language backfill  (${COMMIT ? 'COMMIT' : 'DRY RUN'}) ===\n`);

const titleStmt = db.prepare(
  `SELECT title FROM ingested_videos WHERE channel_id=? AND title IS NOT NULL ORDER BY published_at DESC LIMIT 30`);

const nulls = db.prepare(
  `SELECT channel_id, channel_name, region FROM ingested_channels
   WHERE ingest_enabled=1 AND primary_language IS NULL`).all();
console.log(`null-language channels to evaluate: ${nulls.length}`);

const byMethod = {}, byLang = {}, sample = [];
const updates = [];      // { channel_id, lang }
let ambiguous = 0;
for (const row of nulls) {
  const titles = titleStmt.all(row.channel_id).map(r => r.title);
  const p = computeProposed(row, titles);
  if (!p) { ambiguous++; continue; }
  byMethod[p.method] = (byMethod[p.method] || 0) + 1;
  byLang[p.lang] = (byLang[p.lang] || 0) + 1;
  updates.push({ channel_id: row.channel_id, lang: p.lang });
  if (sample.length < 30) sample.push({ name: (row.channel_name || '').slice(0, 32), region: row.region || '-', '→': p.lang, via: p.method });
}

console.log(`\nresolved: ${updates.length}  (${(updates.length / nulls.length * 100).toFixed(1)}%)`);
console.log(`left NULL (ambiguous, on-demand later): ${ambiguous}  (${(ambiguous / nulls.length * 100).toFixed(1)}%)\n`);
console.log('by method:'); console.table(Object.entries(byMethod).sort((a, b) => b[1] - a[1]).map(([m, n]) => ({ method: m, n })));
console.log('by language:'); console.table(Object.entries(byLang).sort((a, b) => b[1] - a[1]).map(([l, n]) => ({ lang: l, n })));
console.log('sample (first 30):'); console.table(sample);

// normalization preview
const dirty = db.prepare(
  `SELECT channel_id, primary_language AS cur FROM ingested_channels
   WHERE ingest_enabled=1 AND primary_language IS NOT NULL
     AND (primary_language != LOWER(primary_language) OR primary_language IN ('ae','jp','kr','cn'))`).all();
const norms = dirty.map(r => ({ channel_id: r.channel_id, lang: NORMALIZE[r.cur.toLowerCase()] || r.cur.toLowerCase() }))
  .filter(r => r.lang !== dirty.find(d => d.channel_id === r.channel_id).cur);
console.log(`\ndirty existing values to normalize: ${norms.length}`);

if (!COMMIT) {
  console.log('\nDRY RUN — no writes. Re-run with --commit to apply.\n');
  db.close();
  process.exit(0);
}

// ── commit ────────────────────────────────────────────────────────────────────
const setLang = db.prepare(`UPDATE ingested_channels SET primary_language=? WHERE channel_id=?`);
const clearCache = db.prepare(`DELETE FROM channel_wtp_cache WHERE channel_id=?`);
const all = updates.concat(norms);
const apply = db.transaction(() => {
  for (const u of all) { setLang.run(u.lang, u.channel_id); clearCache.run(u.channel_id); }
});
apply();
console.log(`\nCOMMITTED — set ${updates.length} new + normalized ${norms.length}; cleared WTP cache for ${all.length} channels.\n`);
db.close();

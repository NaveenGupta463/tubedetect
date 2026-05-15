'use strict';

/**
 * Language Detector — Phase XI Multilingual Intelligence
 *
 * Four-signal detection stack (in priority order):
 *   1. YouTube API fields — yt_default_language / yt_default_audio_language (highest trust)
 *   2. Unicode block analysis — identifies non-Latin scripts with high certainty
 *   3. Romanized Indian language lexicon — catches Hindi/Tamil/Telugu written in Latin script
 *   4. franc npm package — statistical detection for other Latin-script languages
 *
 * Output stored as JSON in corpus_channels.language_profile.
 */

const franc = require('franc');
const {
  updateCorpusChannelLanguageProfile,
  logChannelEvent,
} = require('../db/corpusQueries');

// ── ISO 639-3 → ISO 639-1 mapping (franc returns 639-3) ──────────────────────

const ISO3_TO_1 = {
  hin: 'hi', tam: 'ta', tel: 'te', mal: 'ml', kan: 'kn',
  ben: 'bn', mar: 'mr', guj: 'gu', pan: 'pa', nep: 'ne', urd: 'ur', ori: 'or',
  eng: 'en', spa: 'es', por: 'pt', fra: 'fr', deu: 'de', ita: 'it',
  nld: 'nl', pol: 'pl', rus: 'ru', ukr: 'uk', ces: 'cs', slk: 'sk',
  ron: 'ro', hun: 'hu', tur: 'tr', vie: 'vi', ind: 'id', msa: 'ms',
  jpn: 'ja', kor: 'ko', zho: 'zh', cmn: 'zh', yue: 'zh',
  ara: 'ar', heb: 'he', fas: 'fa',
  tha: 'th', khm: 'km', mya: 'my',
  swa: 'sw', amh: 'am', hau: 'ha', yor: 'yo', ibo: 'ig',
  bho: 'bho', awa: 'awa', mai: 'mai', // Bhojpuri, Awadhi, Maithili (Devanagari variants)
};

function toISO1(code639_3) {
  return ISO3_TO_1[code639_3] ?? code639_3;
}

// ── Romanized Indian language word banks ─────────────────────────────────────
// Words confirmed from corpus mining + curated linguistic knowledge.
// These are function words and common terms that almost never appear in English.
// Run server/scripts/mineRomanizedWords.js after ingesting Hindi seed channels
// to expand these banks with corpus-derived terms.

const ROMANIZED_BANKS = {
  hi: new Set([
    // Confirmed from corpus mining (real Hindi channel titles)
    'hai', 'hain', 'baat', 'bhai', 'didi', 'batata', 'batati',
    // Question words — appear nowhere in English
    'kya', 'kaise', 'kyun', 'kyunki', 'kab', 'kahan', 'kaun', 'kitna', 'kitne', 'kitni',
    // Pronouns / address forms
    'aap', 'aapko', 'aapke', 'aapki', 'aapse', 'humko', 'humne', 'hume', 'unhe',
    'unka', 'unke', 'unki', 'mujhe', 'mera', 'mere', 'meri', 'tumhe', 'tumhara',
    'apna', 'apne', 'apni',
    // Particles and conjunctions
    'aur', 'toh', 'phir', 'lekin', 'magar', 'parantu', 'agar', 'isliye', 'tabhi',
    'warna', 'jabki', 'jaise', 'waisa', 'jab', 'tab', 'abhi', 'kabhi',
    // Common verbs (imperative / infinitive used in titles)
    'karein', 'karo', 'karna', 'karta', 'karti', 'karte', 'kiya', 'kiye', 'karke',
    'batao', 'bataye', 'batayenge', 'bataiye', 'bataunga',
    'dekhiye', 'dekho', 'dekhna', 'dekha', 'dekhen',
    'samjhiye', 'samjho', 'samjna', 'samjha', 'samjhen',
    'janiye', 'jano', 'jaanna', 'jaane', 'janta', 'janti', 'jaaniye',
    'seekhiye', 'seekho', 'seekhna', 'seekha', 'seekhen',
    'sikhiye', 'sikho', 'sikhna', 'sikhe', 'sikha', 'sikhein', // alt spelling of seekhna
    'suniye', 'suno', 'suna', 'sunen',
    'miliye', 'milo', 'milna', 'mila', 'milenge',
    'banaiye', 'banao', 'banana', 'bana', 'banaenge',
    'paiye', 'pao', 'pana', 'paya', 'payenge',
    'aaye', 'aana', 'aaiye', 'aao',
    'chaliye', 'chalo', 'chalna',
    'likhiye', 'likho', 'likhna', 'likha',
    'puchiye', 'pucho', 'puchna', 'poocho',
    'rakhiye', 'rakho', 'rakhna',
    'dena', 'denge', 'diya', 'dijiye', 'dedo',
    'lena', 'lenge', 'liya', 'lijiye', 'lelo',
    'padhiye', 'padho', 'padhna', 'padhai', 'padhein', // study (padhai = studying)
    'shuru', 'shuruaat', 'shuruat',                    // start/beginning
    // Temporal words
    'aaj', 'kal', 'parso', 'pehle', 'baad', 'abhi', 'phir',
    // Common nouns
    'paisa', 'paise', 'rupaye', 'lakh', 'crore', 'hazaar',
    'kaam', 'ghar', 'desh', 'log', 'dost', 'yaar', 'sahab', 'sahib', 'jii',
    'sach', 'jhooth', 'galat', 'sahi', 'cheez', 'cheezen', 'tarika', 'tarike',
    'baar', 'jagah', 'waqt', 'samay', 'saal', 'mahina',
    'nivesh', 'bachat', 'kamai', 'kamao', 'kharch', 'udhar', 'karz', 'byaj',
    'gyan', 'gyaan', 'jankari',                        // knowledge/information
    'naukri', 'rojgar', 'vyapar', 'vyapaar',           // job/employment/business
    'dhan', 'sampatti', 'ameer', 'garib',              // wealth/rich/poor
    'jugaad', 'nuskha', 'nuskhe',                      // hack/remedy
    'wala', 'wali', 'waale', 'waali', 'waala',         // very common Hindi suffix
    'sarkari', 'sarkar',                               // government
    // Common adjectives
    'achha', 'accha', 'bura', 'naya', 'nayi', 'purana', 'bada', 'chota', 'lamba', 'chhota',
    'mushkil', 'aasaan', 'asaan', 'zaruri', 'zaroor', 'bilkul', 'bahut', 'sirf', 'bhi',
    'seedha', 'seedhi', 'pura', 'poora', 'poori', 'jaldi', 'dhire',
    'mast', 'zabardast', 'behtareen', 'shandar',       // great/awesome
    // Negation
    'nahi', 'nahin', 'mat',
    // Common phrases mined / known
    'doston', 'pyaro', 'namaste', 'shukriya', 'dhanyavaad', 'alvida',
    // Confirmed from corpus mining (news + cooking + education channels)
    'vaapas', 'katha', 'kavi', 'sanskar', 'amritvela', 'kavisammelan',
  ]),

  ta: new Set([
    // Question and common function words
    'enna', 'eppo', 'eppadi', 'ethu', 'yaar', 'yenge', 'yen',
    // Pronouns
    'naan', 'nee', 'avan', 'aval', 'naama', 'namba', 'ungal', 'ungalukku',
    // Common verbs
    'pannunga', 'pannanum', 'parunga', 'kelunga', 'sollunga', 'vaango', 'varinga',
    'paaru', 'sollu', 'keluu', 'vaango',
    // Common words
    'romba', 'konjam', 'ellam', 'onnum', 'oru', 'rendu', 'moonu',
    'nalla', 'nandri', 'vanakkam', 'seri', 'illai', 'irukku', 'irukka',
    'theriyuma', 'theriyum', 'therila',
    'mudiyuma', 'mudiyum', 'mudila',
    'solluven', 'sonnean', 'sonna',
    'seiyunga', 'seiyanum', 'seiyungal',
  ]),

  te: new Set([
    // Question words
    'ela', 'enduku', 'emito', 'evaru', 'ekkada', 'eppudu', 'entha', 'emi',
    // Pronouns
    'meeru', 'nenu', 'manam', 'memu', 'vallaru', 'naaku', 'meeku', 'vaallaki',
    'naa', 'maa', 'vaallu',
    // Common verbs (imperative / infinitive used in titles)
    'cheyandi', 'cheyyandi', 'chudandi', 'cheppandi', 'randi', 'velandi',
    'cheyagalaru', 'cheyaledhu', 'cheyyaleru',
    'telusukondaam', 'nerchukondaam', 'chustaam', 'cheppistaam',
    'cheyyadam', 'cheyyadaniki', 'chudadam', 'cheppukodam',
    'start', 'cheyyaali', 'chestunam', 'chesaanu',
    'kaligisthundi', 'vachindi', 'poyindi', 'ayyindi',
    // Common particles / conjunctions
    'ante', 'ayina', 'kaadu', 'kooda', 'kani', 'kaaни',
    'aina', 'undi', 'ledhu', 'ledu', 'okka', 'anni',
    'gurinchi', 'tarvata', 'mundhu', 'taruvata',
    'inka', 'inko', 'malli', 'maatram',
    // Common nouns
    'vyaaparam', 'vyaparam', 'paniki', 'pani', 'vellu',
    'nalupu', 'arogya', 'vanta', 'samayal',
    'paisa', 'paisalu', 'rupayi', 'laksha', 'kotlu',
    'nela', 'samvatsaram', 'rojulu', 'roju', 'gante',
    'manishi', 'janam', 'prajalu', 'pillalu',
    'vidya', 'chaduvulu', 'chaduvukodam',
    // Common adjectives
    'chaala', 'koncham', 'manchidi', 'cheddudi', 'pedda', 'chinna',
    'kotha', 'paata', 'tvaraga', 'nidhananga',
    'easy', 'kashtam', 'important', 'best',
    // Negation
    'kaadu', 'ledu', 'aavadhu', 'cheyyakoodadhu',
    // Greetings / common phrases
    'namaskaaram', 'dhanyavaadaalu', 'baavundi', 'bagundi',
    'telugulo', 'telugu', 'andhrulo',
    // High-frequency channel title words
    'tho', 'lo', 'ki', 'ko', 'ni',
  ]),
};

function detectRomanizedIndian(text) {
  if (!text || text.length < 10) return null;
  const words = new Set(
    text.toLowerCase().match(/\b[a-z]{3,}\b/g) ?? [],
  );

  // Short text (channel name only, no video titles) → lower bar to 2 hits.
  // Longer text (video titles present) → require 3 to avoid false positives.
  const threshold = words.size < 15 ? 2 : 3;

  const scores = {};
  for (const [lang, bank] of Object.entries(ROMANIZED_BANKS)) {
    let hits = 0;
    const matched = [];
    for (const w of words) {
      if (bank.has(w)) { hits++; matched.push(w); }
    }
    if (hits >= threshold) scores[lang] = { hits, matched };
  }

  if (!Object.keys(scores).length) return null;

  const [bestLang, best] = Object.entries(scores)
    .sort((a, b) => b[1].hits - a[1].hits)[0];

  // Confidence scales with hits: 2 hits → 0.60, 3 hits → 0.65, 6 hits → 0.75, 10+ hits → 0.80
  const confidence = Math.min(0.80, 0.50 + best.hits * 0.025);

  return { lang: bestLang, confidence, hits: best.hits, matched: best.matched };
}

// ── Unicode block analysis ────────────────────────────────────────────────────

const SCRIPT_RANGES = [
  { name: 'devanagari', range: /[ऀ-ॿ]/g,  langs: ['hi', 'mr', 'ne'] },
  { name: 'tamil',      range: /[஀-௿]/g,  langs: ['ta'] },
  { name: 'telugu',     range: /[ఀ-౿]/g,  langs: ['te'] },
  { name: 'kannada',    range: /[ಀ-೿]/g,  langs: ['kn'] },
  { name: 'malayalam',  range: /[ഀ-ൿ]/g,  langs: ['ml'] },
  { name: 'bengali',    range: /[ঀ-৿]/g,  langs: ['bn'] },
  { name: 'gurmukhi',   range: /[਀-੿]/g,  langs: ['pa'] },
  { name: 'gujarati',   range: /[઀-૿]/g,  langs: ['gu'] },
  { name: 'arabic',     range: /[؀-ۿ]/g,  langs: ['ar', 'ur', 'fa'] },
  { name: 'cyrillic',   range: /[Ѐ-ӿ]/g,  langs: ['ru', 'uk'] },
  { name: 'cjk',        range: /[一-鿿]/g,  langs: ['zh'] },
  { name: 'hiragana',   range: /[぀-ヿ]/g,  langs: ['ja'] },
  { name: 'hangul',     range: /[가-힯]/g,  langs: ['ko'] },
  { name: 'thai',       range: /[฀-๿]/g,  langs: ['th'] },
];

function analyzeScript(text) {
  if (!text) return null;
  const nonSpace = text.replace(/\s/g, '').length;
  if (nonSpace === 0) return null;

  const scriptCounts = {};
  for (const s of SCRIPT_RANGES) {
    const matches = text.match(new RegExp(s.range.source, 'g')) ?? [];
    if (matches.length > 0) scriptCounts[s.name] = { count: matches.length, langs: s.langs };
  }

  if (!Object.keys(scriptCounts).length) return null;

  const dominant = Object.entries(scriptCounts)
    .sort((a, b) => b[1].count - a[1].count)[0];

  const ratio = dominant[1].count / nonSpace;
  if (ratio < 0.05) return null; // Too sparse to be meaningful

  return {
    script:     dominant[0],
    langs:      dominant[1].langs,
    ratio,
    confidence: Math.min(0.95, 0.6 + ratio * 0.4),
  };
}

// ── franc wrapper ─────────────────────────────────────────────────────────────

function runFranc(text) {
  if (!text || text.trim().length < 20) return null;
  const results = franc.all(text, { minLength: 3 }).slice(0, 5);
  if (!results.length || results[0][1] === 0) return null;
  return results.map(([code, score]) => [toISO1(code), score]);
}

function buildDistribution(francResults) {
  const dist = {};
  const total = francResults.reduce((s, [, score]) => s + score, 0);
  if (total === 0) return dist;
  for (const [lang, score] of francResults) {
    dist[lang] = Math.round((score / total) * 100) / 100;
  }
  return dist;
}

// ── Devanagari disambiguation ─────────────────────────────────────────────────
// Devanagari is shared by Hindi, Marathi, Nepali, Bhojpuri, etc.
// Use franc on the Devanagari text to pick the most likely one.

function disambiguateDevanagari(text) {
  const francResults = franc.all(text, { minLength: 3 }).slice(0, 5);
  const mapped = francResults.map(([code, score]) => [toISO1(code), score]);
  // If hin is anywhere in the top 5, prefer Hindi — it has far more channels
  // than Nepali/Maithili/Bhojpuri and franc struggles to distinguish them on short text.
  const hindiEntry = mapped.find(([lang]) => lang === 'hi');
  if (hindiEntry) return 'hi';
  // Otherwise fall back to the top Devanagari-family language
  const devanagariLangs = new Set(['hi', 'mr', 'ne', 'bho', 'awa', 'mai']);
  const topDevanagari = mapped.find(([lang]) => devanagariLangs.has(lang));
  return topDevanagari?.[0] ?? 'hi';
}

// ── Indian origin check ───────────────────────────────────────────────────────
// Returns true if the channel is likely India-based based on YouTube metadata.
function isIndianChannel(channel) {
  if (channel.yt_country === 'IN') return true;
  // Some Indian channels set regionCode or have IN in their custom URL
  return false;
}

// ── Main detection function ───────────────────────────────────────────────────

function detectLanguage(channel, videoTitles = []) {
  // ── Signal 1: YouTube API fields (highest trust) ──────────────────────────
  const ytLang = channel.yt_default_language || channel.yt_default_audio_language;
  if (ytLang && ytLang !== 'und') {
    const primary = ytLang.split('-')[0].toLowerCase(); // strip region: 'en-US' → 'en'
    return {
      primary,
      confidence:  0.95,
      method:      'youtube_api',
      script:      null,
      distribution: { [primary]: 1.0 },
      detected_at: new Date().toISOString(),
    };
  }

  // Build text corpus: channel title + recent video titles
  const allText = [channel.title ?? '', ...videoTitles].join(' ').trim();

  if (allText.length < 10) {
    return {
      primary:      'und',
      confidence:   0.0,
      method:       'insufficient_data',
      script:       null,
      distribution: {},
      detected_at:  new Date().toISOString(),
    };
  }

  // ── Signal 2: Unicode block analysis ─────────────────────────────────────
  const scriptResult = analyzeScript(allText);

  if (scriptResult && scriptResult.confidence >= 0.65) {
    let primary = scriptResult.langs[0];

    // Devanagari is ambiguous — disambiguate with franc
    if (scriptResult.script === 'devanagari') {
      primary = disambiguateDevanagari(allText);
    }
    // Arabic script is ambiguous — use franc to pick Arabic vs Urdu vs Farsi
    if (scriptResult.script === 'arabic') {
      const francTop = runFranc(allText);
      if (francTop) {
        const arabicFamily = new Set(['ar', 'ur', 'fa']);
        const topArabic = francTop.find(([lang]) => arabicFamily.has(lang));
        if (topArabic) primary = topArabic[0];
      }
    }
    // Cyrillic is ambiguous — use franc to pick Russian vs Ukrainian etc.
    if (scriptResult.script === 'cyrillic') {
      const francTop = runFranc(allText);
      if (francTop) {
        const cyrillicFamily = new Set(['ru', 'uk', 'bg', 'sr']);
        const topCyrillic = francTop.find(([lang]) => cyrillicFamily.has(lang));
        if (topCyrillic) primary = topCyrillic[0];
      }
    }

    // Build distribution: dominant script lang + english remainder
    const latinRatio = 1 - scriptResult.ratio;
    const dist = { [primary]: Math.round(scriptResult.ratio * 100) / 100 };
    if (latinRatio > 0.05) dist['en'] = Math.round(latinRatio * 100) / 100;

    return {
      primary,
      confidence:  scriptResult.confidence,
      method:      'unicode_block',
      script:      scriptResult.script,
      distribution: dist,
      detected_at: new Date().toISOString(),
    };
  }

  // ── Signal 3: Romanized Indian language lexicon ───────────────────────────
  const romanized = detectRomanizedIndian(allText);
  if (romanized) {
    const latinRemainder = Math.round((1 - romanized.confidence) * 100) / 100;
    const dist = { [romanized.lang]: romanized.confidence };
    if (latinRemainder > 0.1) dist['en'] = latinRemainder;
    return {
      primary:      romanized.lang,
      confidence:   romanized.confidence,
      method:       'romanized_lexicon',
      script:       'latin_romanized',
      register:     'romanized',
      distribution: dist,
      detected_at:  new Date().toISOString(),
    };
  }

  // ── Signal 4: franc statistical detection (Latin-script) ──────────────────
  const francResults = runFranc(allText);
  const indian       = isIndianChannel(channel);

  if (!francResults) {
    return {
      primary:      'en',
      confidence:   0.4,
      method:       'fallback_english',
      script:       'latin',
      uncertain:    indian,
      distribution: { en: 1.0 },
      detected_at:  new Date().toISOString(),
    };
  }

  const [primary, topScore] = francResults[0];

  // Indian channel where franc returns English with no stronger signal:
  // Very likely Hindi content with English-written titles (extremely common pattern).
  // Lower confidence and flag as uncertain so the promotion gate can apply extra scrutiny.
  // Indian channel where franc returns English with no stronger signal:
  // Very common — Hindi creators write English titles for SEO but speak Hindi.
  // Keep primary='en' so the channel isn't misclassified, but flag uncertain=true
  // so the promotion gate can treat it as a language-ambiguous channel and set
  // ignore_from_benchmarks=1 rather than letting it corrupt English VPH benchmarks.
  if (indian && (primary === 'en' || primary === 'en-US' || primary === 'en-GB')) {
    return {
      primary:      'en',
      confidence:   0.5,
      method:       'franc',
      script:       'latin',
      uncertain:    true,
      distribution: buildDistribution(francResults),
      detected_at:  new Date().toISOString(),
    };
  }

  return {
    primary,
    confidence:  Math.min(0.85, topScore),
    method:      'franc',
    script:      'latin',
    distribution: buildDistribution(francResults),
    detected_at: new Date().toISOString(),
  };
}

// ── DB-integrated: detect and store for one channel ───────────────────────────

function detectAndStoreLanguage(db, channel, videoTitles = []) {
  const profile = detectLanguage(channel, videoTitles);
  updateCorpusChannelLanguageProfile(db, channel.channel_id, profile);
  logChannelEvent(db, channel.channel_id, 'language_detected', {
    primary:    profile.primary,
    confidence: profile.confidence,
    method:     profile.method,
  });
  return profile;
}

// ── Batch: fetch video titles and detect for a channel by ID ──────────────────

function detectLanguageForChannel(db, channelId) {
  const channel = db.get('SELECT * FROM corpus_channels WHERE channel_id = ?', [channelId]);
  if (!channel) return null;

  // Parse stored language fields if they came through as JSON
  if (channel.language_profile) {
    try { channel.language_profile = JSON.parse(channel.language_profile); } catch (_) {}
  }

  const videoRows = db.all(
    `SELECT title FROM corpus_videos WHERE channel_id = ? AND title IS NOT NULL
     ORDER BY published_at DESC LIMIT 50`,
    [channelId],
  );
  const videoTitles = videoRows.map(r => r.title).filter(Boolean);

  return detectAndStoreLanguage(db, channel, videoTitles);
}

module.exports = {
  detectLanguage,
  detectAndStoreLanguage,
  detectLanguageForChannel,
};

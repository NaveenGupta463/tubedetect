'use strict';

// Country detection pipeline for ingested channels.
// Stores result in ingested_channels.region — one-time per channel, cached forever.
//
// Detection order:
//   1. Already in DB → instant
//   2. YouTube snippet.country from channel_cache (creator's own setting)
//   3. Channel bio/description — Indian city/country keyword match
//   4. corpus_channels metadata
//   5. Non-Latin script in video titles (Devanagari→IN, Hangul→KR, etc.)
//   6. Hinglish word density in video titles
//   7. Comment analysis — aggregate 100 comments × 5-6 videos, very lenient threshold

const { getDb } = require('../db/init');

// ── Script detectors ──────────────────────────────────────────────────────────

const SCRIPTS = [
  { re: /[ऀ-ॿ਀-੿ঀ-৿]/,              country: 'IN' }, // Devanagari / Gurmukhi / Bengali
  { re: /[ఀ-౿]/,            country: 'IN' }, // Telugu
  { re: /[஀-௿]/,            country: 'IN' }, // Tamil
  { re: /[ಀ-೿]/,            country: 'IN' }, // Kannada
  { re: /[ഀ-ൿ]/,            country: 'IN' }, // Malayalam
  { re: /[가-힣]/,                     country: 'KR' }, // Hangul
  { re: /[ぁ-んァ-ン]/,               country: 'JP' }, // Hiragana / Katakana
  { re: /[一-鿿]/,                    country: 'CN' }, // CJK
  { re: /[؀-ۿ]/,                      country: 'AE' }, // Arabic script
  { re: /[ก-๙]/,                      country: 'TH' }, // Thai
];

function detectScript(text) {
  for (const { re, country } of SCRIPTS) {
    if (re.test(text)) return country;
  }
  return null;
}

// ── Hinglish (Roman-script Hindi) ────────────────────────────────────────────

const HINGLISH = new Set([
  'bhai','yaar','kya','kaise','kyun','kyunki','bahut','zyada','accha','sahi',
  'nahi','nahin','haan','toh','matlab','zaroor','bilkul','ekdum',
  'crore','lakh','kaafi','thoda','poora','pura','seedha',
  'namaste','bhaiya','didi','dost',
  'aur','lekin','magar','isliye','warna',
  'hain','hoga','hogi','thi','raha','rahe',
  'mein','hum','aap','woh','yeh','inhe','unhe',
  'desh','bharat','sarkar','sarkaar',
  'rupaye','paisa','duniya','zindagi',
]);

function hinglishScore(text) {
  if (!text) return 0;
  const words = text.toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/);
  let hits = 0;
  for (const w of words) if (HINGLISH.has(w)) hits++;
  return hits;
}

// ── Roman-script South Indian languages ──────────────────────────────────────
// Common words from Tamil, Telugu, Kannada, Malayalam written in English letters.
// "da", "na", "ra" are too short/ambiguous — intentionally excluded.

const SOUTH_INDIAN_ROMAN = new Set([
  // Tamil
  'machan','machaan','macha','anna','akka','amma','appa','thambi','thangachi',
  'nalla','nallaa','super','superaa','romba','oru','illa','illai','seri','sari',
  'enna','ennoda','sollu','paaru','paarunga','vanakkam','ayya','aiya',
  'irukku','irukkanga','pannunga','pannrom','solren','theriyum','therium',
  // Telugu
  'anna','baaga','bagundi','chala','cheyyi','chudandi','manchidi','nenu','memu',
  'meeru','miru','kaadu','kaadhu','ledu','ayya','abba','arre','anduke','ante',
  'cheppandi','cheppadu','chestaru','chusthunnaru','vintunnaru','undandi',
  // Kannada
  'yella','yellaru','yen','yenu','hege','hagide','hogbeku','nodri','sullu',
  'tumba','tumba','chennaagide','channagide','gottu','gotte','illi','alli',
  // Malayalam
  'eda','edo','athe','athu','anu','alle','alla','enthaa','enthu','ingane',
  'angane','parayoo','nokku','kanoo','kando','chetta','chechi','molae',
  'sheriyaa','adipoli','kidu','kidilan','mone','mole','enthokke',
]);

function southIndianRomanScore(text) {
  if (!text) return 0;
  const words = text.toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/);
  let hits = 0;
  for (const w of words) if (SOUTH_INDIAN_ROMAN.has(w)) hits++;
  return hits;
}

// ── Spanish (Roman-script) ────────────────────────────────────────────────────
// High-frequency Spanish words that don't overlap with English.
// Short ambiguous words (es, el, la, un) intentionally excluded.

const SPANISH = new Set([
  'para','pero','como','más','también','porque','todo','toda','todos','todas',
  'este','esta','estos','estas','cuando','donde','quien','mientras','aunque',
  'hacer','tener','poder','querer','saber','llevar','volver','seguir','pasar',
  'nuevo','nueva','tiempo','muy','bien','aquí','allá','ahora','siempre','nunca',
  'hola','gracias','bueno','buena','amor','vida','año','hoy','ayer','mañana',
  'queso','recién','hecho','jugo','compras','comida','cocina','receta','migas',
  'vamos','estoy','estamos','somos','tengo','tenemos','pues','buenas','chicos',
  'nuestro','vuestra','vosotros','nosotros','ellos','ellas','ustedes',
  'español','español','méxico','colombia','argentina','venezuela','chile',
]);

function spanishScore(text) {
  if (!text) return 0;
  const words = text.toLowerCase().replace(/[^a-záéíóúüñ\s]/gi, ' ').split(/\s+/);
  let hits = 0;
  for (const w of words) if (SPANISH.has(w)) hits++;
  return hits;
}

// ── Indian bio keywords ───────────────────────────────────────────────────────
// Match on word boundaries so "Indiana" doesn't trigger "india".

const INDIA_BIO_RE = /\b(india|indian|bharat|hindustan|mumbai|delhi|bangalore|bengaluru|hyderabad|chennai|kolkata|calcutta|pune|ahmedabad|jaipur|surat|lucknow|nagpur|noida|gurgaon|gurugram|chandigarh|bhopal|patna|indore|visakhapatnam|vizag)\b/i;

// ── Indian language name keywords ─────────────────────────────────────────────
// Channels that explicitly name their language in the channel name or bio.
// Strong signal even when titles are in Roman script ("Telugu Travel Vlogger").

const INDIAN_LANG_NAME_RE = /\b(telugu|tamil|malayalam|kannada|marathi|punjabi|gujarati|odia|bhojpuri|bangla|bengali|assamese|urdu|rajasthani|haryanvi|bihari|maithili)\b/i;

// ── Core detector ─────────────────────────────────────────────────────────────

async function detectChannelCountry(channelId) {
  const db = getDb();

  // ── 1. Already stored ──────────────────────────────────────────────────────
  const cached = db.get(
    'SELECT region, channel_name FROM ingested_channels WHERE channel_id = ?', [channelId],
  );

  // save() — writes to DB. force=true overrides an existing EN tag (EN is a soft
  // fallback meaning "no regional signal found", not "confirmed Western").
  function save(country, force = false) {
    try {
      if (force) {
        db.run(`UPDATE ingested_channels SET region = ? WHERE channel_id = ?`, [country, channelId]);
      } else {
        db.run(`UPDATE ingested_channels SET region = ? WHERE channel_id = ? AND region IS NULL`, [country, channelId]);
      }
    } catch (_) {}
    console.log(`[country] ${channelId} → ${country}`);
    return country;
  }

  // ── 1a. Channel name contains Indian language keyword ──────────────────────
  // Checked before the early return so it can override an existing EN tag.
  // "EN" means "no regional signal found" — it's a soft fallback, not a confirmed
  // Western origin. An English-titled Telugu/Tamil channel should be tagged IN.
  if (INDIAN_LANG_NAME_RE.test(cached?.channel_name || '')) {
    return save('IN', true); // force=true to override EN
  }

  // Return any confidently-detected region (everything except EN, which is soft)
  if (cached?.region && cached.region !== 'EN') return cached.region;
  // EN channels fall through to re-evaluate via bio, script, Hinglish below

  // ── 2. YouTube snippet.country (creator's self-declared country) ───────────
  const cacheRow = db.get('SELECT raw_json FROM channel_cache WHERE channel_id = ?', [channelId]);
  let channelDescription = '';
  if (cacheRow?.raw_json) {
    try {
      const parsed = JSON.parse(cacheRow.raw_json);
      const apiCountry = parsed?.snippet?.country;
      if (apiCountry) return save(apiCountry.toUpperCase());
      channelDescription = parsed?.snippet?.description || '';
    } catch (_) {}
  }

  // ── 3. Channel bio/description — Indian location keyword match ─────────────
  if (INDIA_BIO_RE.test(channelDescription)) return save('IN');

  // Also check corpus_channels.raw_json description if richer data is there
  const corpusCache = db.get('SELECT raw_json, yt_country, country FROM corpus_channels WHERE channel_id = ?', [channelId]);
  if (corpusCache?.raw_json) {
    try {
      const desc = JSON.parse(corpusCache.raw_json)?.snippet?.description || '';
      if (INDIA_BIO_RE.test(desc)) return save('IN');
    } catch (_) {}
  }

  // ── 4. corpus_channels metadata ────────────────────────────────────────────
  const corpusCountry = corpusCache
    ? (corpusCache.yt_country || corpusCache.country || null)
    : null;
  if (corpusCountry) return save(corpusCountry.toUpperCase());

  // ── 5. Non-Latin script in video titles ────────────────────────────────────
  const titleRows = db.all(
    `SELECT title FROM ingested_videos WHERE channel_id = ? AND title IS NOT NULL LIMIT 30`,
    [channelId],
  );
  for (const { title } of titleRows) {
    const c = detectScript(title);
    if (c) return save(c);
  }

  // ── 6. Word density in titles — Hinglish / South Indian Roman / Spanish ──────
  if (titleRows.length >= 5) {
    const hinglishTotal    = titleRows.reduce((s, { title }) => s + hinglishScore(title), 0);
    const southIndianTotal = titleRows.reduce((s, { title }) => s + southIndianRomanScore(title), 0);
    const spanishTotal     = titleRows.reduce((s, { title }) => s + spanishScore(title), 0);
    if (hinglishTotal / titleRows.length >= 0.25 || southIndianTotal / titleRows.length >= 0.25) return save('IN');
    if (spanishTotal  / titleRows.length >= 0.25) return save('ES');
  }

  // ── 7. Comment analysis — aggregate across 5-6 videos ─────────────────────
  const apiKey = process.env.YT_API_KEY || process.env.YOUTUBE_API_KEY;
  if (!apiKey) return null;

  const videos = db.all(
    `SELECT youtube_video_id FROM ingested_videos
     WHERE channel_id = ? AND views > 1000
     ORDER BY views DESC LIMIT 6`,
    [channelId],
  );

  // ── 8. Direct YouTube channels API — for channels with no local video data ─
  if (!videos.length) {
    try {
      const resp = await fetch(
        `https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&id=${channelId}&key=${apiKey}`,
      );
      if (resp.ok) {
        const data = await resp.json();
        const item = data.items?.[0];
        if (item) {
          // Cache in channel_cache so future runs hit step 2
          try {
            db.run(
              `INSERT INTO channel_cache (channel_id, raw_json, cached_at)
               VALUES (?, ?, ?)
               ON CONFLICT(channel_id) DO UPDATE SET raw_json = excluded.raw_json, cached_at = excluded.cached_at`,
              [channelId, JSON.stringify(item), new Date().toISOString()],
            );
          } catch (_) {}

          // Update subscriber count if the stored value looks wrong (< 1000)
          const ytSubs = parseInt(item.statistics?.subscriberCount || '0', 10);
          if (ytSubs > 1000) {
            try {
              db.run(
                `UPDATE ingested_channels SET channel_subscribers = ? WHERE channel_id = ? AND channel_subscribers < 1000`,
                [ytSubs, channelId],
              );
              db.run(
                `UPDATE corpus_channels SET subscriber_count = ? WHERE channel_id = ? AND subscriber_count < 1000`,
                [ytSubs, channelId],
              );
            } catch (_) {}
          }

          const ytCountry = item.snippet?.country;
          if (ytCountry) return save(ytCountry.toUpperCase());

          const desc = item.snippet?.description || '';
          if (INDIA_BIO_RE.test(desc)) return save('IN');
          const titles8 = desc.toLowerCase().split(/\s+/);
          if (titles8.some(w => HINGLISH.has(w))) return save('IN');
        }
      }
    } catch (e) {
      console.warn(`[country] ${channelId} channels API error:`, e.message);
    }
    return null;
  }

  let totalComments = 0, hinglishTotal = 0, southIndianTotal = 0, spanishTotal = 0, nonLatinCount = 0;
  const scriptTally = {};

  for (const { youtube_video_id: vid } of videos) {
    try {
      const resp = await fetch(
        `https://www.googleapis.com/youtube/v3/commentThreads?part=snippet&videoId=${vid}&maxResults=100&key=${apiKey}`,
      );
      if (!resp.ok) continue;
      const data  = await resp.json();
      const items = data.items || [];

      for (const item of items) {
        const text = item.snippet?.topLevelComment?.snippet?.textOriginal || '';
        hinglishTotal    += hinglishScore(text);
        southIndianTotal += southIndianRomanScore(text);
        spanishTotal     += spanishScore(text);
        const c = detectScript(text);
        if (c) {
          nonLatinCount++;
          scriptTally[c] = (scriptTally[c] || 0) + 1;
        }
      }
      totalComments += items.length;
    } catch (e) {
      console.warn(`[country] ${channelId} comment error (${vid}):`, e.message);
    }
  }

  if (totalComments < 5) return null;

  const avgHinglish    = hinglishTotal    / totalComments;
  const avgSouthIndian = southIndianTotal / totalComments;
  const avgSpanish     = spanishTotal     / totalComments;
  const nonLatinRatio  = nonLatinCount    / totalComments;
  const topScript      = Object.entries(scriptTally).sort((a, b) => b[1] - a[1])[0];
  const topRatio       = topScript ? topScript[1] / totalComments : 0;

  console.log(
    `[country] ${channelId} comments: total=${totalComments} ` +
    `avgHinglish=${avgHinglish.toFixed(3)} avgSouthIndian=${avgSouthIndian.toFixed(3)} ` +
    `avgSpanish=${avgSpanish.toFixed(3)} nonLatinRatio=${nonLatinRatio.toFixed(3)} ` +
    `topScript=${topScript?.[0]}@${topRatio.toFixed(3)}`,
  );

  // Non-Latin script: even 3% of comments is a strong signal
  if (topRatio >= 0.03) return save(topScript[0]);

  // Roman-script Indian or Spanish: small density across many comments is a clear signal
  if (avgHinglish >= 0.06 || avgSouthIndian >= 0.06) return save('IN');
  if (avgSpanish  >= 0.06) return save('ES');

  // Clear English-speaking community — no meaningful regional signal
  return save('EN');
}

// ── Background batch job ──────────────────────────────────────────────────────

let batchRunning = false;

async function runBatchDetection(limit = 5) {
  if (batchRunning) return;
  batchRunning = true;
  try {
    const db   = getDb();
    const rows = db.all(
      `SELECT channel_id FROM ingested_channels
       WHERE ingest_enabled = 1 AND region IS NULL
       ORDER BY channel_subscribers DESC
       LIMIT ?`,
      [limit],
    );
    if (!rows.length) { console.log('[country] batch: all channels tagged'); return; }
    console.log(`[country] batch: tagging ${rows.length} channels`);
    for (const { channel_id } of rows) {
      await detectChannelCountry(channel_id);
      await new Promise(r => setTimeout(r, 300));
    }
  } catch (e) {
    console.warn('[country] batch error:', e.message);
  } finally {
    batchRunning = false;
  }
}

function startLanguageDetectionCron() {
  // Top 15 by subscriber count at startup — free fast-paths (steps 2-6) cover most
  runBatchDetection(15).catch(() => {});
  // Every 30 min: 5 more channels (240 comment API calls/day max, well within 10K quota)
  setInterval(() => runBatchDetection(5).catch(() => {}), 30 * 60 * 1000);
  console.log('[country] country detection cron started (15 now, 5 per 30 min)');
}

// ── Bulk name fix ─────────────────────────────────────────────────────────────
// One-shot pass: find channels whose name contains an Indian language keyword
// and tag them IN, overriding any existing EN tag.
// Safe to run multiple times — only changes channels that match the pattern.

function fixIndianNamedChannels(db) {
  const rows = db.all(
    `SELECT channel_id, channel_name, region FROM ingested_channels
     WHERE channel_name IS NOT NULL AND (region IS NULL OR region = 'EN')`,
  );
  let fixed = 0;
  for (const { channel_id, channel_name, region } of rows) {
    if (INDIAN_LANG_NAME_RE.test(channel_name)) {
      db.run(`UPDATE ingested_channels SET region = 'IN' WHERE channel_id = ?`, [channel_id]);
      console.log(`[country] name-fix: ${channel_name} (was ${region || 'null'}) → IN`);
      fixed++;
    }
  }
  console.log(`[country] name-fix complete — ${fixed} channels updated`);
  return fixed;
}

// One-shot pass: find EN/null channels whose video titles are predominantly Spanish
// and tag them ES. Safe to run multiple times.

function fixSpanishChannels(db) {
  const rows = db.all(
    `SELECT channel_id FROM ingested_channels
     WHERE ingest_enabled = 1 AND (region IS NULL OR region = 'EN')`,
  );
  let fixed = 0;
  for (const { channel_id } of rows) {
    const titles = db.all(
      `SELECT title FROM ingested_videos WHERE channel_id = ? AND title IS NOT NULL LIMIT 30`,
      [channel_id],
    );
    if (titles.length < 5) continue;
    const total = titles.reduce((s, { title }) => s + spanishScore(title), 0);
    if (total / titles.length >= 0.25) {
      db.run(`UPDATE ingested_channels SET region = 'ES' WHERE channel_id = ?`, [channel_id]);
      console.log(`[country] spanish-fix: ${channel_id} → ES`);
      fixed++;
    }
  }
  console.log(`[country] spanish-fix complete — ${fixed} channels updated`);
  return fixed;
}

// One-shot pass: reclassify channels tagged 'politics' whose titles are
// predominantly geopolitics or defence content.
// Safe to run multiple times — only updates channels that clearly match.

const GEOPOLITICS_KW = [
  'geopolitics','foreign policy','international relations','diplomacy','nato','sanctions',
  'strait of hormuz','middle east','indo-pacific','nuclear deal','ceasefire','iran',
  'ukraine war','taiwan strait','world war','global order','strategic affairs',
  'major gaurav','chanakya','proxy war','cold war','trade war','hegemony',
  'superpower','regime change','coup','g20','g7','brics','quad','sco',
  'un security council','south china sea','border dispute','lac','loc',
  'surgical strike','cross border','terror attack','insurgency','buffer zone',
  'geopolitical','alliance','nuclear','american foreign','usa policy',
  'china','russia','pakistan','israel','palestine','north korea','taiwan',
  'ukraine','saudi arabia','turkey',
];
const DEFENCE_KW = [
  'defence','defense','military','army','navy','air force','missile','hypersonic','drdo',
  'war strategy','fighter jet','warship','ammunition','soldier','combat','pentagon',
  'tank','submarine','aircraft carrier','drone warfare','special forces','commando',
  'artillery','brahmos','rafale','tejas','agni','s-400','f-35','iaf',
  'indian army','indian navy','coast guard','defence budget','make in india defence',
  'nuclear submarine','border patrol','armed forces','weapons system','regiment','battalion',
];

function _kwHits(title, kwList) {
  const t = title.toLowerCase();
  return kwList.filter(kw => t.includes(kw)).length;
}

function reclassifyPoliticsChannels(db) {
  const rows = db.all(
    `SELECT ic.channel_id, ic.channel_name
     FROM ingested_channels ic
     WHERE ic.niche = 'politics' AND ic.ingest_enabled = 1`,
  );
  let fixed = 0;
  for (const { channel_id, channel_name } of rows) {
    const titles = db.all(
      `SELECT title FROM ingested_videos
       WHERE channel_id = ? AND title IS NOT NULL ORDER BY published_at DESC LIMIT 30`,
      [channel_id],
    );
    if (titles.length < 5) continue;
    const geoHits  = titles.reduce((s, { title }) => s + _kwHits(title, GEOPOLITICS_KW), 0);
    const defHits  = titles.reduce((s, { title }) => s + _kwHits(title, DEFENCE_KW), 0);
    const polTotal = titles.length;
    const newNiche = geoHits / polTotal >= 0.3 ? 'geopolitics'
                   : defHits / polTotal >= 0.3 ? 'defence'
                   : null;
    if (!newNiche) continue;
    db.run(`UPDATE ingested_channels SET niche = ?, community_id = NULL WHERE channel_id = ?`, [newNiche, channel_id]);
    db.run(`UPDATE corpus_channels   SET niche = ?, community_id = NULL WHERE channel_id = ?`, [newNiche, channel_id]);
    console.log(`[niche] reclassify: ${channel_name} politics → ${newNiche}`);
    fixed++;
  }
  console.log(`[niche] reclassify complete — ${fixed} channels updated`);
  return fixed;
}

// One-shot pass: reclassify channels tagged lifestyle/health/philosophy whose titles
// are predominantly self-improvement / mental health content.
// Safe to run multiple times — only updates channels that clearly match.

const SELFIMPROVEMENT_KW = [
  'self improvement','self help','personal development','motivation','productivity',
  'discipline','habits','confidence','mindset','success mindset','growth mindset',
  'mental health','therapy','anxiety','depression','psychology','wellbeing',
  'life coach','morning routine','atomic habits','sandeep maheshwari','vivek bindra',
  'overthinking','stress','emotional intelligence','self awareness','journaling',
  'manifestation','positive thinking','inner peace','healing','subconscious',
  'personality','social skills','communication skills','imposter syndrome',
  'burnout','resilience','purpose','ikigai','self discipline',
];

function reclassifySelfImprovementChannels(db) {
  const rows = db.all(
    `SELECT channel_id, channel_name FROM ingested_channels
     WHERE niche IN ('lifestyle','health','philosophy','other') AND ingest_enabled = 1`,
  );
  let fixed = 0;
  for (const { channel_id, channel_name } of rows) {
    const titles = db.all(
      `SELECT title FROM ingested_videos
       WHERE channel_id = ? AND title IS NOT NULL ORDER BY published_at DESC LIMIT 30`,
      [channel_id],
    );
    if (titles.length < 5) continue;
    const siHits = titles.reduce((s, { title }) => s + _kwHits(title, SELFIMPROVEMENT_KW), 0);
    if (siHits / titles.length < 0.3) continue;
    db.run(`UPDATE ingested_channels SET niche = 'selfimprovement', community_id = NULL WHERE channel_id = ?`, [channel_id]);
    db.run(`UPDATE corpus_channels   SET niche = 'selfimprovement', community_id = NULL WHERE channel_id = ?`, [channel_id]);
    console.log(`[niche] reclassify: ${channel_name} → selfimprovement`);
    fixed++;
  }
  console.log(`[niche] selfimprovement reclassify complete — ${fixed} channels updated`);
  return fixed;
}

// Full bulk run — called by admin trigger.
// No delay between channels that hit fast paths (steps 2-6); only API-bound channels
// (steps 7-8) keep the 300ms pause to avoid hammering YouTube quota.
async function runFullBatchDetection() {
  if (batchRunning) {
    console.warn('[country] Full batch skipped — batch already running');
    return { skipped: true };
  }
  batchRunning = true;
  let tagged = 0, skipped = 0, errors = 0;
  try {
    const db = getDb();
    const nameFixed    = fixIndianNamedChannels(db);
    const spanishFixed = fixSpanishChannels(db);
    const nicheFixed   = reclassifyPoliticsChannels(db) + reclassifySelfImprovementChannels(db);
    const rows = db.all(
      `SELECT channel_id FROM ingested_channels
       WHERE ingest_enabled = 1 AND region IS NULL
       ORDER BY channel_subscribers DESC`,
    );
    console.log(`[country] Full batch started — ${rows.length} null-region channels`);
    for (const { channel_id } of rows) {
      try {
        const result = await detectChannelCountry(channel_id);
        if (result) tagged++; else skipped++;
      } catch (e) {
        errors++;
        console.warn(`[country] ${channel_id} error:`, e.message);
      }
      await new Promise(r => setTimeout(r, 100));
    }
    console.log(`[country] Full batch complete — name_fixed=${nameFixed} spanish_fixed=${spanishFixed} niche_fixed=${nicheFixed} tagged=${tagged} skipped=${skipped} errors=${errors}`);
    return { total: rows.length, name_fixed: nameFixed, spanish_fixed: spanishFixed, niche_fixed: nicheFixed, tagged, skipped, errors };
  } finally {
    batchRunning = false;
  }
}

module.exports = { detectChannelCountry, detectScript, hinglishScore, spanishScore, startLanguageDetectionCron, runFullBatchDetection };

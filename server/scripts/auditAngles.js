'use strict';
require('dotenv').config({ path: __dirname + '/../.env' });
const { getDb } = require('../db/init');
const {
  getNarrativeType,
  computeExpiry,
  classifyStage,
  computeWindowScore,
  computeActNowConf,
} = require('../lib/narrativeLifecycle');
const db = getDb();

const STOPWORDS = new Set([
  'the','a','an','and','or','but','in','on','at','to','for','of','with','by','from',
  'is','are','was','were','be','been','being','have','has','had','do','does','did',
  'will','would','could','should','may','might','shall','can','need',
  'this','that','these','those','it','its','he','she','they','we','you','i','me',
  'him','her','them','us','my','your','his','our','their','who','what','which',
  'when','where','how','why','all','any','both','each','few','more','most','other',
  'some','such','no','not','only','own','same','so','than','too','very','just','now',
  'new','old','big','great','good','best','top','first','last','one','two','three',
  'news','latest','breaking','live','update','updates',
  'today','yesterday','tomorrow','tonight',
  'daily','weekly','monthly','annual','yearly','month','months','week','weeks','year','years',
  'important','special','exclusive','official','major',
  'watch','full','video','channel','episode','part','series','season',
  'hindi','india','indian',
]);
const DEVANAGARI_RE = /[ऀ-ॿ]/;
const SOUTH_SCRIPT_RE = /[ঀ-ൿ]/;

const ANGLE_STOPWORDS = new Set([
  'viral','marathon','shorts','clip','recap','episode','highlights','highlight',
  'ncert','class','part',
  'sir','mam','madam',
  'cse','chief',
  'tamil','kerala','bengal','punjab','gujarat','maharashtra','rajasthan',
  'karnataka','andhra','odisha','bihar','assam','uttarakhand','himachal',
  'goa','manipur','nagaland','meghalaya','arunachal','sikkim','tripura',
  'mizoram','haryana','jharkhand','telangana','chhattisgarh','pradesh',
  'desh','nadu',
]);

const VERB_STOPWORDS = new Set([
  'uses','used','using',
  'says','said',
  'calls','called',
  'gets','got',
  'hits','hit',
  'warns','warning',
  'attacks','attack',
  'strikes','strike',
  'meets','meeting',
  'visits','visit',
  'arrives','arrival',
  'announces','announce',
  'responds','response',
]);

// Niche-aware qualifier sets — built inside the per-channel loop using NICHE_QUALIFIERS().
const _CORE_QUALIFIERS = new Set([
  'reaction','response','impact','strikes','attack','offensive','retaliation',
  'sanctions','ceasefire','deal','talks','invasion','withdrawal','defeat','victory',
  'conflict','crisis','threat','warning','policy','reform','agreement','demand',
  'protest','vote','war','nuclear','missile','drone','blockade','evacuation',
  'prices','trade','deficit','growth','recession','crash','rally','inflation',
  'tariff','embargo','investment',
  'verdict','campaign','debate','resignation','arrest','bail','scandal',
  'visit','meeting','summit','statement','announcement',
  'interview',
]);
const _EXAM_QUALIFIERS = new Set([..._CORE_QUALIFIERS, 'paper','cutoff','analysis','pattern']);
function NICHE_QUALIFIERS(niche) {
  return /upsc|exam|neet|ssc|jee|preparation|ias/.test(niche) ? _EXAM_QUALIFIERS : _CORE_QUALIFIERS;
}

// ── Classification ─────────────────────────────────────────────────────────────
// Words that are exam-specific editorial signals rather than story actions.
// A narrative whose only qualifiers are from this set is classified as metadata.
const _EXAM_ONLY_QUALIFIERS = new Set(['paper','cutoff','analysis','pattern']);

function classifyNarrative(narrative, channelNameTokens, activeQualifiers) {
  const words = narrative.split(' ');
  if (words.some(w => channelNameTokens.has(w))) return 'brand';
  const qualifiers = words.filter(w => activeQualifiers.has(w));
  if (qualifiers.length === 0) return 'entity-only';
  const allExamOnly = qualifiers.every(w => _EXAM_ONLY_QUALIFIERS.has(w));
  return allExamOnly ? 'metadata' : 'story-ready';
}

const TOPIC_PARENTS = [
  { parent: 'Geopolitics',       keywords: ['iran','israel','pakistan','russia','ukraine','china','nato','war','conflict','border','military','army','defence','defense','missile','nuclear','sanctions','ceasefire','diplomacy','treaty','bilateral','hamas','hezbollah','gaza'] },
  { parent: 'Judiciary & Law',   keywords: ['supreme court','high court','verdict','judgment','constitution','article','bail','arrest','crime','murder','rape','scam','fraud','fir','custody','tribunal'] },
  { parent: 'Competitive Exams', keywords: ['upsc','ssc','ias','ips','prelims','mains','neet','jee','exam','syllabus','cutoff','answer key','mock test','preparation','crack','study'] },
  { parent: 'Economy & Finance', keywords: ['budget','rbi','inflation','gdp','gst','market','stock','sensex','nifty','bank','recession','investment','rupee','dollar','trade','tariff','imf','world bank','economy','economic'] },
  { parent: 'Politics',          keywords: ['election','modi','congress','bjp','government','minister','parliament','lok sabha','rajya sabha','party','vote','cm','chief minister','governor','president','coalition'] },
  { parent: 'Sports',            keywords: ['ipl','cricket','match','tournament','world cup','player','team','final','league','championship','hockey','football','kabaddi','olympics','medal'] },
  { parent: 'Science & Tech',    keywords: ['artificial intelligence','robot','space','isro','nasa','satellite','moon','mars','technology','startup','innovation','climate','environment','renewable','solar'] },
  { parent: 'Society & Health',  keywords: ['health','hospital','doctor','medicine','disease','cancer','covid','diabetes','mental health','education','school','university','women','child','poverty','farmer','protest'] },
];

const _TOPIC_FLAT_KEYWORDS = new Set(
  TOPIC_PARENTS.flatMap(({ keywords }) => keywords.filter(k => !k.includes(' ')))
);

function inferParentTopic(phrase) {
  const lower = phrase.toLowerCase();
  for (const { parent, keywords } of TOPIC_PARENTS) {
    for (const k of keywords) {
      const hit = k.includes(' ')
        ? lower.includes(k)
        : new RegExp('(?:^|\\b)' + k + '(?:\\b|$)').test(lower);
      if (hit) return parent;
    }
  }
  return null;
}

function tokenize(title) {
  return (title || '')
    .replace(/#\w+/g, ' ')
    .replace(/\|{2}[^|]+\|{2}/g, ' ')
    .toLowerCase()
    .replace(/[|()[\]{}#@!?,।॥।\-''':]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(w => w.length > 2 && !STOPWORDS.has(w) && !/^\d+$/.test(w) && !/^\d{4}$/.test(w)
              && !DEVANAGARI_RE.test(w) && !SOUTH_SCRIPT_RE.test(w));
}

const CLASS_LABEL = {
  'story-ready': '✓ story-ready',
  'metadata':    '~ metadata   ',
  'entity-only': '✗ entity-only',
  'brand':       '✗ brand      ',
};

const STAGE_LABEL = {
  seed:      '🌱 seed     ',
  emerging:  '📈 emerging ',
  peak:      '🔥 peak     ',
  saturated: '🟡 saturated',
  decay:     '📉 decay    ',
  revived:   '⚡ revived  ',
  dead:      '💀 dead     ',
};

// Inline lifecycle computation for the audit (serves from live data, not the batch table).
function computeNarrativeLifecycle(anchor, narrative, niche, peerIds, parentTopic) {
  const ph     = peerIds.map(() => '?').join(',');
  const tokens = [...anchor.split(' '), ...narrative.split(' ')].filter(w => w.length > 1);
  const conds  = tokens.map(() => "LOWER(title) LIKE ?").join(' AND ');
  const params = tokens.map(t => `%${t}%`);

  const rows = db.all(`
    SELECT
      CAST((julianday('now') - julianday(published_at)) AS INTEGER) AS day_bucket,
      COUNT(*)                                    AS cnt,
      COUNT(DISTINCT channel_id)                  AS ch_count,
      MIN(published_at)                           AS earliest
    FROM ingested_videos
    WHERE channel_id IN (${ph})
      AND ${conds}
      AND published_at >= date('now', '-14 days')
      AND title IS NOT NULL
    GROUP BY day_bucket
    ORDER BY day_bucket
  `, [...peerIds, ...params]);

  if (!rows.length) return null;

  const bucket0      = rows.find(r => r.day_bucket === 0) || { cnt: 0, ch_count: 0 };
  const bucket1      = rows.find(r => r.day_bucket === 1) || { cnt: 0, ch_count: 0 };
  const first_seen   = rows.reduce((m, r) => (!m || r.earliest < m ? r.earliest : m), null);
  const age_hours    = first_seen ? Math.round((Date.now() - new Date(first_seen).getTime()) / 3600000) : 0;

  const totalRow = db.get(`
    SELECT COUNT(DISTINCT channel_id) AS total_ch
    FROM ingested_videos
    WHERE channel_id IN (${ph})
      AND ${conds}
      AND published_at >= date('now', '-14 days')
      AND title IS NOT NULL
  `, [...peerIds, ...params]);

  const current_channels = totalRow?.total_ch || 0;
  const saturation_pct   = peerIds.length ? Math.min(100, Math.round((current_channels / peerIds.length) * 100)) : 0;
  const velocity         = bucket0.ch_count - bucket1.ch_count;

  const narrativeType = getNarrativeType(niche);
  const signals = { age_hours, channel_count: current_channels, velocity, pub_rate_recent: bucket0.cnt, pub_rate_prior: bucket1.cnt, saturation_pct };
  const stage       = classifyStage(signals, null, narrativeType);
  const window_score = computeWindowScore(stage, saturation_pct, velocity);
  const act_now_conf = computeActNowConf(stage, window_score, saturation_pct, velocity, age_hours);
  const expiry       = computeExpiry(first_seen?.split('T')[0], parentTopic, narrativeType);

  return { stage, window_score, act_now_conf, expiry, age_hours, pub_rate_recent: bucket0.cnt, pub_rate_prior: bucket1.cnt, velocity };
}

const TEST_CHANNELS = [
  { name: 'Aaj Tak',       id: 'UCt4t-jeY85JegMlZ-E5UWtA', niche: 'news' },
  { name: 'NDTV India',    id: 'UC9CYT9gSNLevX5ey2_6CK0Q', niche: 'news' },
  { name: 'UPSC Wallah',   id: 'UCqOy6oOu6RPJNHYQ8f_Ybvg', niche: 'upsc exam preparation' },
  { name: 'Republic World', id: 'UCwqusr8YDwM-3mEYTDeJHzw', niche: 'news' },
];

for (const { name, id, niche } of TEST_CHANNELS) {
  const peers = db.all(
    'SELECT channel_id FROM ingested_channels WHERE niche = ? AND channel_id != ? LIMIT 60',
    [niche, id],
  );
  const peerIds = [id, ...peers.map(p => p.channel_id)];
  const ph = peerIds.map(() => '?').join(',');
  const since = new Date(Date.now() - 90 * 86400000).toISOString().split('T')[0];

  const videos = db.all(`
    SELECT iv.youtube_video_id, iv.title, iv.views, iv.channel_id, iv.published_at, ic.channel_name
    FROM (
      SELECT youtube_video_id, title, views, channel_id, published_at,
             ROW_NUMBER() OVER (PARTITION BY channel_id ORDER BY views DESC) AS rn
      FROM ingested_videos
      WHERE channel_id IN (${ph}) AND published_at >= ? AND title IS NOT NULL AND views > 0
    ) iv
    LEFT JOIN ingested_channels ic ON ic.channel_id = iv.channel_id
    WHERE rn <= 10
  `, [...peerIds, since]);

  // Niche-aware qualifier set for this channel
  const NARRATIVE_QUALIFIERS = NICHE_QUALIFIERS(niche);

  // Channel-name token blocklist
  const channelNameTokens = new Set();
  for (const v of videos) {
    if (!v.channel_name) continue;
    v.channel_name.toLowerCase().split(/[\s\-_|.]+/).forEach(w => {
      if (w.length > 3 && !STOPWORDS.has(w)) channelNameTokens.add(w);
    });
  }

  // Build topicMap (bigrams + trigrams only)
  const topicMap = new Map();
  const HOOK_PHRASES = new Set(['current affairs','affairs today','live coverage','live streaming','full episode','good morning']);
  for (const video of videos) {
    const tokens = tokenize(video.title);
    const seenPhrases = new Set();
    const addPhrase = (p) => {
      if (seenPhrases.has(p)) return; seenPhrases.add(p);
      if (!topicMap.has(p)) topicMap.set(p, { channels: new Set(), views: [] });
      topicMap.get(p).channels.add(video.channel_id);
      topicMap.get(p).views.push(video.views || 0);
    };
    for (let i = 0; i < tokens.length - 1; i++) {
      const bg = tokens[i] + ' ' + tokens[i+1];
      if (!HOOK_PHRASES.has(bg)) addPhrase(bg);
    }
    for (let i = 0; i < tokens.length - 2; i++) {
      addPhrase(tokens[i] + ' ' + tokens[i+1] + ' ' + tokens[i+2]);
    }
  }

  const minCh = peerIds.length <= 3 ? 1 : peerIds.length <= 9 ? 2 : peerIds.length <= 29 ? 3 : peerIds.length <= 99 ? 4 : 5;
  const angleThreshold = Math.max(2, Math.ceil(minCh / 2));
  const anchorMinCh = new Set(['news','politics','sports']).has(niche) ? angleThreshold : minCh;

  // Anchor set — trim trailing verb tokens, dedup to same cleaned form.
  const anchorOriginalMap = new Map(); // cleanedAnchor → original topicMap key
  for (const [phrase, b] of topicMap.entries()) {
    if (b.channels.size < anchorMinCh || inferParentTopic(phrase) === null) continue;
    const words = phrase.split(' ');
    if (new Set(words).size !== words.length) continue;
    const trimmed = [...words];
    while (trimmed.length > 1 && VERB_STOPWORDS.has(trimmed[trimmed.length - 1])) trimmed.pop();
    if (trimmed.length > 1 && _CORE_QUALIFIERS.has(trimmed[0])) {
      const rest = trimmed.slice(1);
      if (rest.every(w => !_TOPIC_FLAT_KEYWORDS.has(w))) trimmed.splice(0, 1);
    }
    const cleaned = trimmed.join(' ');
    if (anchorOriginalMap.has(cleaned)) {
      const prevB = topicMap.get(anchorOriginalMap.get(cleaned));
      if (prevB && prevB.channels.size >= b.channels.size) continue;
    }
    anchorOriginalMap.set(cleaned, phrase);
  }
  const anchorSet = new Set(anchorOriginalMap.keys());

  // Raw narrative bigrams
  const rawNarrativeMap = new Map();
  for (const video of videos) {
    const tokens = tokenize(video.title);
    const titleTokenSet = new Set(tokens);

    const titleAnchors = [...anchorSet].filter(a => a.split(' ').every(w => titleTokenSet.has(w)));
    if (!titleAnchors.length) continue;

    for (const anchor of titleAnchors) {
      if (!rawNarrativeMap.has(anchor)) rawNarrativeMap.set(anchor, new Map());
      const sub = rawNarrativeMap.get(anchor);
      const anchorWds = new Set(anchor.split(' '));

      for (let i = 0; i < tokens.length - 1; i++) {
        const bg = tokens[i] + ' ' + tokens[i+1];
        const bgWords = bg.split(' ');
        if (!bgWords.some(w => NARRATIVE_QUALIFIERS.has(w))) continue;
        if (bgWords.some(w => ANGLE_STOPWORDS.has(w))) continue;
        if (bgWords.some(w => anchorWds.has(w))) continue;
        if (bgWords.some(w => channelNameTokens.has(w))) continue;
        if (!sub.has(bg)) sub.set(bg, { channels: new Set(), examples: [] });
        sub.get(bg).channels.add(video.channel_id);
        if (sub.get(bg).examples.length < 2) sub.get(bg).examples.push(video.title.slice(0, 80));
      }
    }
  }

  // Qualify
  const qualified = [];
  for (const [anchor, sub] of rawNarrativeMap.entries()) {
    const ab = topicMap.get(anchorOriginalMap.get(anchor) || anchor);
    for (const [bg, data] of sub.entries()) {
      if (data.channels.size < angleThreshold) continue;
      const satPct = ab ? Math.min(100, Math.round(data.channels.size / ab.channels.size * 100)) : '?';
      const cls = classifyNarrative(bg, channelNameTokens, NARRATIVE_QUALIFIERS);
      // Simple heuristic score: channel coverage + saturation gap
      const score = Math.min(99, data.channels.size * 20 + (satPct < 30 ? 15 : 0));
      const rawAnchor = anchorOriginalMap.get(anchor) || anchor;
      qualified.push({
        anchor,
        rawAnchor,
        cleaned: rawAnchor !== anchor,
        narrative: bg,
        fullNarrative: anchor.replace(/\b\w/g,c=>c.toUpperCase()) + ': ' + bg.replace(/\b\w/g,c=>c.toUpperCase()),
        angleCh: data.channels.size,
        anchorCh: ab ? ab.channels.size : '?',
        satPct,
        parent: inferParentTopic(anchor) || inferParentTopic(anchorOriginalMap.get(anchor) || anchor) || '?',
        cls,
        score,
        examples: data.examples,
      });
    }
  }
  qualified.sort((a, b) => b.angleCh - a.angleCh || b.score - a.score);

  // Dedup
  const seenNarKey = new Set();
  const seenNarrativePhrase = new Set();
  const deduped = qualified.filter(r => {
    const key = r.anchor.split(' ').sort().join(' ') + '\x00' + r.narrative;
    if (seenNarKey.has(key)) return false;
    seenNarKey.add(key);
    if (seenNarrativePhrase.has(r.narrative)) return false;
    seenNarrativePhrase.add(r.narrative);
    return true;
  });

  // Lifecycle enrichment — computed inline for audit (batch job serves production)
  for (const r of deduped) {
    r.lifecycle = computeNarrativeLifecycle(r.anchor, r.narrative, niche, peerIds, r.parent);
  }

  // Precision stats
  const counts = { 'story-ready': 0, 'metadata': 0, 'entity-only': 0, 'brand': 0 };
  deduped.forEach(r => counts[r.cls]++);
  const total = deduped.length;
  const precisionPct = total ? Math.round(counts['story-ready'] / total * 100) : 0;

  console.log('\n' + '═'.repeat(72));
  console.log(`  ${name}  (pool=${peerIds.length}, videos=${videos.length}, anchors=${anchorSet.size})`);
  console.log(`  narratives=${total}  |  story-ready=${counts['story-ready']}  metadata=${counts['metadata']}  entity=${counts['entity-only']}  brand=${counts['brand']}`);
  console.log(`  PRECISION: ${precisionPct}%`);
  console.log('═'.repeat(72));

  deduped.forEach((r, i) => {
    const lc  = r.lifecycle;
    const stageStr = lc ? (STAGE_LABEL[lc.stage] || lc.stage) : '? unknown';
    const dead = lc?.stage === 'dead';
    console.log(`\n[${i+1}] [${CLASS_LABEL[r.cls]}]  score=${r.score}  ${dead ? '[💀 dead — hidden in production]' : ''}`);
    if (r.cleaned) {
      console.log(`     ANCHOR : ${r.anchor.toUpperCase()}  (${r.parent}, ch=${r.anchorCh})  ← cleaned from "${r.rawAnchor.toUpperCase()}"`);
    } else {
      console.log(`     ANCHOR : ${r.anchor.toUpperCase()}  (${r.parent}, ch=${r.anchorCh})`);
    }
    console.log(`     ANGLE  : "${r.narrative}"  (ch=${r.angleCh}, sat=${r.satPct}%)`);
    console.log(`     FULL   : "${r.fullNarrative}"`);
    if (lc) {
      console.log(`     STAGE  : ${stageStr}  window=${lc.window_score}  act_now=${lc.act_now_conf > 0 ? 'YES conf=' + lc.act_now_conf : 'NO'}`);
      console.log(`     TIMING : age=${lc.age_hours}h  pub_today=${lc.pub_rate_recent}  pub_yesterday=${lc.pub_rate_prior}  vel=${lc.velocity >= 0 ? '+' : ''}${lc.velocity}ch`);
      if (lc.expiry) console.log(`     EXPIRY : ~${lc.expiry}`);
    }
    r.examples.forEach(e => console.log(`     ex: "${e}"`));
  });

  if (total === 0) {
    console.log('  (no narratives — niche may not map to TOPIC_PARENTS)');
  }
}

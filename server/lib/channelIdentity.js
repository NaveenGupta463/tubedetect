'use strict';

const STOPWORDS = new Set([
  'a','an','the','in','on','of','for','to','and','or','is','are','was','were',
  'be','been','how','why','when','what','which','this','that','these','those',
  'my','your','his','her','our','its','with','by','at','from','will','can',
  'did','do','does','has','have','had','get','got','not','no','all','but',
  'so','if','as','up','out','now','just','only','also','even','than','then',
  'new','top','best','review','video','part','full','episode',
  'you','he','she','they','we','it','me','him','them','us',
  'must','should','could','would','may','might','shall',
  'old','hello','namaskar','namaste','blowing','doing','tells','about',
  'january','february','march','april','may','june','july','august',
  'september','october','november','december',
  'hai','hain','hoga','kya','kaise','mera','meri','mere','aap','main',
  'yeh','woh','ek','nahi','aur','se','ko','ka','ki','ke','mein','hum',
  'bhi','toh','koi','kuch','sirf','sab','tha','thi','the','raha','rahi',
  'karo','karna','karte','karke','rehe','rahe','gaye','gaya',
  'love','like','life','time','come','know','feel','want','need',
  'shorts','viral','trending','subscribe','comment','share','follow',
]);

const HOOK_PHRASES = new Set([
  'year old','years old',
  'you must','must do','must watch','must know',
  'no one','one tells',
  'mind blowing','mind blown',
  'about money','about life','about this',
  'hello namaskar','hello namaste',
  'real reason','real talk',
  'stop doing','stop this',
]);

const GUEST_TOKENS   = new Set(['ft', 'feat', 'featuring']);
const EPISODE_NUM_RE = /(?:^|\s)(?:ep|pt)\.?\s*\d/i;

function isGuestPhrase(phrase) {
  // Token-based: catches "ft.", "feat.", "featuring" anywhere in phrase at any position
  for (const t of phrase.split(' ')) {
    if (GUEST_TOKENS.has(t.replace(/\.$/, '').toLowerCase())) return true;
  }
  return EPISODE_NUM_RE.test(phrase);
}

const SOUTH_SCRIPT_RE = /[஀-௿ఀ-౿ಀ-೿ഀ-ൿ]/;
const DEVANAGARI_RE   = /[ऀ-ॿ]/;
const ARABIC_RE       = /[؀-ۿ]/;
const KOREAN_RE       = /[가-힯ᄀ-ᇿ]/;
const CJK_RE          = /[一-鿿぀-ゟ゠-ヿ]/;

function extractIdentityPhrases(title) {
  if (!title) return [];
  if (SOUTH_SCRIPT_RE.test(title)) return [];
  const tokens = title
    .replace(/#\w+/g, ' ')
    .replace(/\|{2}[^|]+\|{2}/g, ' ')
    .toLowerCase()
    .replace(/[.|()[\]{}#@!?,।॥।\-''']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(w => w.length > 2 && !STOPWORDS.has(w) && !/^\d+$/.test(w) && !/^\d{4}$/.test(w) && !DEVANAGARI_RE.test(w));

  const phrases = [];
  for (let i = 0; i < tokens.length - 1; i++) {
    const bigram = `${tokens[i]} ${tokens[i + 1]}`;
    if (!HOOK_PHRASES.has(bigram)) phrases.push(bigram);
  }
  for (let i = 0; i < tokens.length - 2; i++) {
    phrases.push(`${tokens[i]} ${tokens[i + 1]} ${tokens[i + 2]}`);
  }
  return phrases;
}

function detectTitleScript(title) {
  if (!title) return 'latin';
  if (SOUTH_SCRIPT_RE.test(title)) return 'south_indian';
  if (DEVANAGARI_RE.test(title))   return 'devanagari';
  if (ARABIC_RE.test(title))       return 'arabic';
  if (KOREAN_RE.test(title))       return 'korean';
  if (CJK_RE.test(title))          return 'cjk';
  return 'latin';
}

function isBrandPhrase(phrase, nameTokens, db, corpusIndex = null) {
  const phTokens = phrase.split(' ');

  // Rule 0: ≥2 tokens are name tokens, OR >50% of tokens are name tokens
  const nameMatchCount = phTokens.filter(t => nameTokens.has(t)).length;
  if (nameMatchCount >= 2) return true;
  if (nameMatchCount > 0 && nameMatchCount / phTokens.length > 0.5) return true;

  // Rule 1: phrase consists entirely of consecutive channel name tokens
  let allNameTokens = true;
  for (const t of phTokens) {
    if (!nameTokens.has(t)) { allNameTokens = false; break; }
  }
  if (allNameTokens && phTokens.length >= 2) return true;

  // Rule 2: single long token that is a name token (>= 5 chars, not a common word)
  if (phTokens.length === 2) {
    for (const t of phTokens) {
      if (nameTokens.has(t) && t.length >= 5) return true;
    }
  }

  // Rule 3: phrase is unique to this channel (fewer than 3 corpus channels use it)
  const corpusCount = corpusIndex
    ? (corpusIndex.phraseCount.get(phrase) || 0)
    : db.get(
        'SELECT COUNT(*) AS n FROM ingested_channels WHERE content_fingerprint LIKE ? AND ingest_enabled = 1',
        [`%${phrase}%`],
      )?.n || 0;
  if (corpusCount < 3) return true;
  if (corpusCount > 20) return false;

  return false;
}

function detectHybridClusters(contentPhrases, titleFreq, totalTitles) {
  if (contentPhrases.length < 8) return { is_hybrid: false, topic_clusters: [] };

  // Build co-occurrence map: which phrases appear in the same title?
  const phSet   = new Set(contentPhrases);
  const coMatrix = new Map();
  for (const p of contentPhrases) coMatrix.set(p, new Map());

  for (const [titleKey, phraseList] of Object.entries(titleFreq)) {
    if (!Array.isArray(phraseList)) continue;
    const inTitle = phraseList.filter(p => phSet.has(p));
    for (let i = 0; i < inTitle.length; i++) {
      for (let j = i + 1; j < inTitle.length; j++) {
        const a = inTitle[i], b = inTitle[j];
        coMatrix.get(a).set(b, (coMatrix.get(a).get(b) || 0) + 1);
        coMatrix.get(b).set(a, (coMatrix.get(b).get(a) || 0) + 1);
      }
    }
  }

  // Simple greedy clustering: seed from highest-frequency phrase
  const clusters = [];
  const assigned = new Set();
  const sorted   = [...contentPhrases].sort((a, b) => (titleFreq._freq?.[b] || 0) - (titleFreq._freq?.[a] || 0));

  for (const seed of sorted) {
    if (assigned.has(seed)) continue;
    const cluster = [seed];
    assigned.add(seed);
    const neighbors = coMatrix.get(seed) || new Map();
    for (const [neighbor, coCount] of neighbors) {
      if (!assigned.has(neighbor) && coCount >= 2) {
        cluster.push(neighbor);
        assigned.add(neighbor);
      }
    }
    if (cluster.length >= 2) clusters.push(cluster.slice(0, 5));
    if (clusters.length >= 4) break;
  }

  const is_hybrid = clusters.length >= 2 && clusters.every(c => {
    const clusterWords = new Set(c.flatMap(p => p.split(' ')));
    return clusters.filter(other => other !== c).every(other => {
      const otherWords = new Set(other.flatMap(p => p.split(' ')));
      const overlap    = [...clusterWords].filter(w => otherWords.has(w)).length;
      return overlap / clusterWords.size < 0.4;
    });
  });

  return { is_hybrid, topic_clusters: clusters };
}

function buildThinIdentity(channelId, videoCount, flag) {
  return {
    channel_id:              channelId,
    content_phrases:         null,
    content_phrase_count:    0,
    brand_phrases:           null,
    brand_contamination_pct: 0,
    script_type:             'unknown',
    primary_script_pct:      0,
    confidence_score:        0,
    confidence_tier:         'none',
    health_flags:            JSON.stringify([flag]),
    peer_source_recommended: 'niche_fallback',
    identity_type:           'thin',
    is_hybrid:               0,
    topic_clusters:          null,
    video_count_used:        videoCount,
    latest_video_date:       null,
    previous_content_phrases:null,
    phrase_churn_pct:        null,
  };
}

function buildCorpusIndex(db) {
  const rows = db.all(
    'SELECT content_fingerprint FROM ingested_channels WHERE ingest_enabled = 1 AND content_fingerprint IS NOT NULL',
  );
  const phraseCount = new Map();
  for (const { content_fingerprint } of rows) {
    for (const phrase of content_fingerprint.split('|')) {
      if (phrase) phraseCount.set(phrase, (phraseCount.get(phrase) || 0) + 1);
    }
  }
  return { phraseCount, size: rows.length };
}

function computeChannelIdentity(db, channelId, corpusIndex = null) {
  // Step 1: fetch channel name for brand detection
  const chanRow = db.get(
    'SELECT channel_name, channel_subscribers FROM ingested_channels WHERE channel_id = ?',
    [channelId],
  );
  const rawName   = chanRow?.channel_name || '';
  const nameTokens = new Set(
    rawName.toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(t => t.length >= 3 && !STOPWORDS.has(t)),
  );

  // Step 2: fetch last 100 video titles
  const rows = db.all(
    `SELECT title, published_at FROM ingested_videos
     WHERE channel_id = ? AND title IS NOT NULL
     ORDER BY published_at DESC LIMIT 100`,
    [channelId],
  );
  if (rows.length < 5) return buildThinIdentity(channelId, rows.length, 'insufficient_videos');

  const totalTitles     = rows.length;
  const latestVideoDate = rows[0]?.published_at || null;

  // Step 3: script classification
  const scriptCounts = {};
  for (const { title } of rows) {
    const s = detectTitleScript(title);
    scriptCounts[s] = (scriptCounts[s] || 0) + 1;
  }
  const primaryScript    = Object.entries(scriptCounts).sort((a, b) => b[1] - a[1])[0][0];
  const primaryScriptPct = scriptCounts[primaryScript] / totalTitles;

  // Non-latin channels can't produce phrase fingerprints
  if (primaryScript !== 'latin' && primaryScript !== 'devanagari' && primaryScriptPct >= 0.5) {
    const identity = buildThinIdentity(channelId, totalTitles, 'non_latin_primary');
    identity.script_type        = primaryScript;
    identity.primary_script_pct = Math.round(primaryScriptPct * 100) / 100;
    identity.peer_source_recommended = 'niche_fallback';
    return identity;
  }

  // Step 4: phrase extraction with per-title tracking (for co-occurrence)
  const phraseFreq    = {};
  const titlePhrases  = {};
  const titleFreqMeta = { _freq: phraseFreq };

  for (let i = 0; i < rows.length; i++) {
    const { title } = rows[i];
    const phrases   = extractIdentityPhrases(title);
    titlePhrases[i] = phrases;
    titleFreqMeta[i] = phrases;
    for (const p of phrases) phraseFreq[p] = (phraseFreq[p] || 0) + 1;
  }

  // Keep phrases appearing in ≥2 distinct titles
  const candidatePhrases = Object.entries(phraseFreq)
    .filter(([, cnt]) => cnt >= 2)
    .map(([phrase]) => phrase);

  if (candidatePhrases.length === 0) return buildThinIdentity(channelId, totalTitles, 'no_recurring_phrases');

  // Step 5: guest phrase detection, then brand phrase detection
  const excludedGuestPhrases = [];
  const afterGuestFilter     = [];
  for (const phrase of candidatePhrases) {
    if (isGuestPhrase(phrase)) excludedGuestPhrases.push(phrase);
    else afterGuestFilter.push(phrase);
  }

  const brandPhrases   = [];
  const contentPhrases = [];
  for (const phrase of afterGuestFilter) {
    if (isBrandPhrase(phrase, nameTokens, db, corpusIndex)) brandPhrases.push(phrase);
    else contentPhrases.push(phrase);
  }

  const guestContaminationPct = candidatePhrases.length > 0
    ? excludedGuestPhrases.length / candidatePhrases.length : 0;
  const brandContaminationPct = candidatePhrases.length > 0
    ? (brandPhrases.length + excludedGuestPhrases.length) / candidatePhrases.length : 0;

  // Step 6: fragment filter — drop 2-word phrases whose words are subsumed by a 3-gram
  const trigramWords = new Set(
    contentPhrases.filter(p => p.split(' ').length === 3).flatMap(p => p.split(' ')),
  );
  const filteredContent = contentPhrases.filter(p => {
    if (p.split(' ').length !== 2) return true;
    const [w1, w2] = p.split(' ');
    return !(trigramWords.has(w1) && trigramWords.has(w2));
  });

  // Step 7: IDF weighting — score = (own_freq / total_titles) * log(corpus_size / corpus_channels_using)
  const corpusSize = corpusIndex
    ? corpusIndex.size
    : db.get('SELECT COUNT(*) AS n FROM ingested_channels WHERE ingest_enabled = 1 AND content_fingerprint IS NOT NULL')?.n || 1;

  const scored = [];
  for (const phrase of filteredContent) {
    const ownFreq     = phraseFreq[phrase] || 0;
    const corpusCount = corpusIndex
      ? (corpusIndex.phraseCount.get(phrase) || 1)
      : db.get(
          'SELECT COUNT(*) AS n FROM ingested_channels WHERE content_fingerprint LIKE ? AND ingest_enabled = 1',
          [`%${phrase}%`],
        )?.n || 1;
    const idf   = Math.log(corpusSize / corpusCount);
    const score = (ownFreq / totalTitles) * idf;
    scored.push({ phrase, score, freq: ownFreq });
  }
  scored.sort((a, b) => b.score - a.score);
  const top20 = scored.slice(0, 20).map(s => s.phrase);

  if (top20.length === 0) return buildThinIdentity(channelId, totalTitles, 'all_phrases_filtered');

  // Step 8: hybrid cluster detection
  const { is_hybrid, topic_clusters } = detectHybridClusters(top20, titleFreqMeta, totalTitles);

  // Step 9: confidence scoring
  let confidenceScore = 1.0;
  if (brandContaminationPct > 0.50)      confidenceScore -= 0.30;
  else if (brandContaminationPct > 0.25) confidenceScore -= 0.15;
  if (primaryScriptPct < 0.50 && primaryScript !== 'latin') confidenceScore -= 0.20;
  if (top20.length < 5)                  confidenceScore -= 0.20;
  if (is_hybrid)                         confidenceScore -= 0.10;
  confidenceScore = Math.max(0, Math.min(1, confidenceScore));

  const confidenceTier = confidenceScore >= 0.80 ? 'high'
    : confidenceScore >= 0.55 ? 'medium'
    : confidenceScore >= 0.30 ? 'low'
    : 'none';

  // Health flags
  const healthFlags = [];
  if (brandContaminationPct > 0.40) healthFlags.push('brand_contaminated');
  if (guestContaminationPct > 0.40) healthFlags.push('guest_contaminated');
  if (top20.length < 5)             healthFlags.push('sparse_phrases');
  if (is_hybrid)                    healthFlags.push('hybrid_niche');
  if (totalTitles < 20)             healthFlags.push('small_video_set');

  // peer_source_recommended
  const peerSource = confidenceTier === 'none' ? 'niche_fallback'
    : is_hybrid                                 ? 'hybrid_cluster'
    : 'content_phrases';

  // identity_type
  const identityType = is_hybrid          ? 'hybrid'
    : top20.length >= 10                  ? 'clear'
    : top20.length >= 5                   ? 'partial'
    : 'thin';

  // Phrase churn vs previous
  let previousContentPhrases = null;
  let phraseChurnPct         = null;
  const prev = db.get('SELECT content_phrases FROM channel_identity WHERE channel_id = ?', [channelId]);
  if (prev?.content_phrases) {
    previousContentPhrases = prev.content_phrases;
    const prevSet     = new Set(prev.content_phrases.split('|'));
    const newSet      = new Set(top20);
    const removed     = [...prevSet].filter(p => !newSet.has(p)).length;
    phraseChurnPct    = Math.round((removed / Math.max(1, prevSet.size)) * 100) / 100;
  }

  return {
    channel_id:              channelId,
    content_phrases:         top20.join('|'),
    content_phrase_count:    top20.length,
    brand_phrases:           brandPhrases.length > 0 ? brandPhrases.slice(0, 20).join('|') : null,
    excluded_guest_phrases:  excludedGuestPhrases.length > 0 ? excludedGuestPhrases.slice(0, 20) : null,
    brand_contamination_pct: Math.round(brandContaminationPct * 100) / 100,
    script_type:             primaryScript,
    primary_script_pct:      Math.round(primaryScriptPct * 100) / 100,
    confidence_score:        Math.round(confidenceScore * 100) / 100,
    confidence_tier:         confidenceTier,
    health_flags:            healthFlags.length > 0 ? JSON.stringify(healthFlags) : null,
    peer_source_recommended: peerSource,
    identity_type:           identityType,
    is_hybrid:               is_hybrid ? 1 : 0,
    topic_clusters:          topic_clusters.length > 0 ? JSON.stringify(topic_clusters) : null,
    video_count_used:        totalTitles,
    latest_video_date:       latestVideoDate,
    previous_content_phrases:previousContentPhrases,
    phrase_churn_pct:        phraseChurnPct,
  };
}

function upsertChannelIdentity(db, identity) {
  db.run(
    `INSERT OR REPLACE INTO channel_identity
       (channel_id, content_phrases, content_phrase_count, brand_phrases, brand_contamination_pct,
        script_type, primary_script_pct, confidence_score, confidence_tier, health_flags,
        peer_source_recommended, identity_type, is_hybrid, topic_clusters, video_count_used,
        latest_video_date, computed_at, previous_content_phrases, phrase_churn_pct)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'),?,?)`,
    [
      identity.channel_id,
      identity.content_phrases,
      identity.content_phrase_count,
      identity.brand_phrases,
      identity.brand_contamination_pct,
      identity.script_type,
      identity.primary_script_pct,
      identity.confidence_score,
      identity.confidence_tier,
      identity.health_flags,
      identity.peer_source_recommended,
      identity.identity_type,
      identity.is_hybrid,
      identity.topic_clusters,
      identity.video_count_used,
      identity.latest_video_date,
      identity.previous_content_phrases,
      identity.phrase_churn_pct,
    ],
  );
  // Bump identity_version on ingested_channels
  try {
    db.run(
      `UPDATE ingested_channels SET identity_version = COALESCE(identity_version, 0) + 1 WHERE channel_id = ?`,
      [identity.channel_id],
    );
  } catch (_) {}
}

function loadChannelIdentity(db, channelId) {
  const row = db.get('SELECT * FROM channel_identity WHERE channel_id = ?', [channelId]);
  if (!row) return null;
  if (row.health_flags)   { try { row.health_flags   = JSON.parse(row.health_flags);   } catch (_) { row.health_flags   = []; } }
  if (row.topic_clusters) { try { row.topic_clusters = JSON.parse(row.topic_clusters); } catch (_) { row.topic_clusters = []; } }
  return row;
}

module.exports = { buildCorpusIndex, computeChannelIdentity, upsertChannelIdentity, loadChannelIdentity };

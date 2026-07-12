'use strict';

/**
 * Layer 2 niche reclassification.
 *
 * Problem: channels are labeled at ingestion time and never updated.
 * A channel like Rich Baba gets labeled "finance" from early content but
 * accumulates 99% of its views from gadget Shorts. It then pollutes every
 * finance community's peer list and benchmarks.
 *
 * Strategy: for each channel, score its top 30 videos (by views) against a
 * rich keyword bank for every niche. If the dominant-by-views niche scores
 * ≥5× the labeled niche, reclassify primary_niche.
 *
 * Run: node server/scripts/reclassifyChannelNiches.js [--dry-run]
 */

const path     = require('path');
const Database = require(path.join(__dirname, '../node_modules/better-sqlite3'));
const { shouldAllowNicheRewrite } = require('../lib/channelIdentityGuard');
const DB_PATH  = path.join(__dirname, '../data/scoring.db');
const db       = new Database(DB_PATH);

const DRY_RUN = process.argv.includes('--dry-run');

// ── Niche keyword bank ────────────────────────────────────────────────────────
// Each entry lists distinctive content keywords — NOT just the niche name.
// Goal: score what a video IS ABOUT, not what it says it is.
const NICHE_KEYWORDS = {
  finance:        ['invest', 'stock', 'mutual fund', 'sip ', 'trading', 'crypto', 'bitcoin', 'ethereum', 'nifty', 'sensex', 'ipo', 'dividend', 'portfolio', 'tax ', 'loan', 'insurance', 'saving', 'budget', 'wealth', 'income tax', 'profit', 'financial', 'bank', 'interest rate', 'share market', 'demat', 'zerodha', 'groww', 'paytm money', 'inflation', 'recession'],
  gadgets:        ['gadget', 'invention', 'satisfying', 'amazing product', 'amazing gadget', 'amazing invention', 'chinese gadget', 'japan gadget', 'amazing tool', 'unique gadget', 'cool gadget', 'best gadget', 'amazon gadget', 'kitchen gadget', 'home gadget', 'school gadget', 'prank gadget', 'amazing machine', 'amazing device', 'amazing thing', 'top gadget'],
  technology:     ['phone review', 'smartphone', 'laptop review', 'iphone', 'android', 'camera review', 'processor', 'gaming laptop', 'monitor review', 'keyboard', 'coding', 'programming', 'software', 'app review', 'tech review', 'unboxing', 'specs', 'benchmark', 'vs iphone', 'vs samsung', 'macbook', 'best phone', 'best laptop'],
  fitness:        ['workout', 'exercise', 'hiit', 'training', 'squat', 'cardio', 'muscle', 'gym', 'abs', 'plank', 'weight loss', 'fat loss', 'bodybuilding', 'strength', 'pushup', 'pull up', 'deadlift', 'bench press', 'lose weight', 'home workout', 'full body', 'bicep', 'tricep', 'shoulder workout', 'leg day', 'calorie burn', 'shredded', 'bulk'],
  health:         ['health tips', 'doctor', 'medicine', 'disease', 'symptoms', 'treatment', 'ayurved', 'nutrition', 'vitamin', 'supplement', 'immunity', 'blood sugar', 'blood pressure', 'diabetes', 'cancer', 'thyroid', 'gut health', 'mental health', 'anxiety', 'stress relief', 'home remedy', 'natural cure', 'immune system', 'detox'],
  food:           ['recipe', 'how to cook', 'street food', 'restaurant review', 'food review', 'biryani', 'chef', 'taste test', 'food challenge', 'mukbang', 'cooking tutorial', 'dinner recipe', 'breakfast recipe', 'snack recipe', 'dal', 'roti', 'curry', 'thali', 'dosa', 'samosa', 'chaat', 'dessert', 'baking', 'cake recipe'],
  travel:         ['travel vlog', 'trip to', 'visiting', 'travel guide', 'destination', 'flight', 'hotel review', 'backpacking', 'solo travel', 'road trip', 'itinerary', 'things to do in', 'travel tips', 'budget travel', 'travel india', 'travel europe', 'travel japan', 'travel usa', 'tourist', 'hidden gem'],
  gaming:         ['gameplay', 'pubg', 'free fire', 'minecraft', 'gta', 'fortnite', 'valorant', 'esport', 'game review', 'let\'s play', 'speedrun', 'walkthrough', 'game tips', 'best gaming', 'gaming setup', 'gaming chair', 'fps game', 'mobile gaming', 'cod mobile', 'bgmi'],
  education:      ['history of', 'how does', 'why did', 'science explained', 'documentary', 'facts about', 'what is ', 'explained simply', 'universe', 'physics', 'biology', 'chemistry', 'math', 'engineering', 'psychology', 'philosophy', 'economics explained', 'ancient', 'world war', 'geography', 'political science', 'how it works'],
  comedy:         ['comedy', 'funny', 'prank', 'roast', 'stand up', 'meme', 'joke', 'parody', 'trolling', 'reaction video', 'try not to laugh', 'fails', 'bloopers', 'funny moments', 'comedy sketch'],
  news:           ['news', 'current affairs', 'politics', 'government', 'election', 'controversy', 'exposed', 'debate', 'policy', 'minister', 'parliament', 'modi', 'bjp', 'congress', 'supreme court', 'breaking news', 'scam', 'corruption', 'protest'],
  business:       ['business idea', 'entrepreneur', 'startup', 'marketing strategy', 'how to start', 'ecommerce', 'dropshipping', 'shopify', 'freelancing', 'side hustle', 'make money online', 'passive income', 'digital marketing', 'social media marketing', 'brand building'],
  lifestyle:      ['morning routine', 'night routine', 'day in my life', 'room tour', 'apartment tour', 'what i eat', 'get ready with me', 'productive day', 'weekly vlog', 'study with me', 'minimalist', 'aesthetic room', 'desk setup'],
  motivation:     ['motivation', 'success mindset', 'discipline', 'self improvement', 'stoicism', 'goal setting', 'never give up', 'hard work', 'success story', 'life lesson', 'inspirational', 'overcoming failure', 'mental strength', 'positive thinking'],
  music:          ['music video', 'song', 'singing', 'guitar tutorial', 'piano', 'album', 'concert', 'music cover', 'beats', 'music production', 'rap', 'hip hop', 'classical music', 'music theory', 'new song', 'official video', 'music reaction'],
  sports:         ['cricket', 'ipl', 'football', 'sports analysis', 'match highlights', 'player profile', 'team', 'league', 'tournament', 'world cup', 'test match', 'odi', 't20', 'premier league', 'la liga', 'fifa'],
  beauty:         ['makeup tutorial', 'skincare routine', 'beauty hacks', 'fashion', 'outfit', 'haul', 'foundation', 'lipstick', 'eyeshadow', 'beauty tips', 'skin glow', 'haircare', 'hair tutorial', 'nail art', 'get ready'],
  yoga:           ['yoga', 'meditation', 'mindfulness', 'breathing exercise', 'asana', 'pranayama', 'chakra', 'guided meditation', 'stress relief', 'flexibility', 'yoga for beginners', 'morning yoga', 'yoga flow', 'yin yoga'],
  entertainment:  ['react', 'reaction', 'review movie', 'movie review', 'web series review', 'bollywood', 'netflix', 'amazon prime', 'trailer reaction', 'celebrity', 'award', 'interview', 'talk show', 'behind the scenes'],
  automotive:     ['car review', 'car test', 'car drive', 'suv review', 'sedan', 'sports car', 'electric car', 'ev review', 'tesla', 'mercedes', 'bmw review', 'toyota review', 'ford review', 'track test', 'drag race', 'quarter mile', 'horsepower', 'torque', 'exhaust sound', 'supercar', 'hypercar', 'motorcycle review', 'bike review', 'motorbike', 'bicycle review', 'cycling', 'mountain bike', 'road bike', 'gravel bike', 'ebike'],
};

// Niche clusters — niches within the same group are considered equivalent content.
// Reclassifying between them is meaningless and can break community assignments.
const SAME_CLUSTER_GROUPS = [
  new Set(['finance', 'personal finance', 'investing', 'stock market', 'cryptocurrency']),
  new Set(['fitness', 'workout', 'bodybuilding', 'strength training', 'muscle building', 'gym']),
  new Set(['selfimprovement', 'motivation', 'personal development', 'personal growth', 'mindset', 'leadership lessons', 'motivational speaking']),
  new Set(['news', 'current affairs', 'politics', 'geopolitics', 'breaking news', 'journalism']),
  new Set(['business', 'entrepreneurship', 'startup', 'marketing']),
  new Set(['food', 'cooking', 'street food', 'recipes']),
  new Set(['travel', 'travel vlogs']),
  new Set(['technology', 'gadgets', 'tech review', 'programming tutorials']),
  new Set(['automotive', 'cars', 'motorcycles', 'cycling', 'bicycle']),
  new Set(['education', 'science', 'history', 'learning']),
  new Set(['health', 'nutrition', 'wellness', 'ayurved']),
  new Set(['yoga', 'meditation', 'mindfulness']),
  new Set(['lifestyle', 'daily vlogs', 'vlog', 'personal vlogs']),
  new Set(['comedy', 'entertainment', 'comedy sketches']),
  new Set(['music', 'songs', 'singing']),
  new Set(['beauty', 'makeup', 'fashion', 'skincare']),
];

function areSameCluster(nicheA, nicheB) {
  const a = nicheA?.toLowerCase();
  const b = nicheB?.toLowerCase();
  return SAME_CLUSTER_GROUPS.some(group => group.has(a) && group.has(b));
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function scoreTitle(title, keywords) {
  const t = ` ${title.toLowerCase()} `;
  let score = 0;
  for (const kw of keywords) {
    if (t.includes(kw)) score++;
  }
  return score;
}

function dominantNiche(videos) {
  const viewScore = {};
  for (const niche of Object.keys(NICHE_KEYWORDS)) viewScore[niche] = 0;

  for (const v of videos) {
    for (const [niche, keywords] of Object.entries(NICHE_KEYWORDS)) {
      const s = scoreTitle(v.title || '', keywords);
      if (s > 0) viewScore[niche] += v.views * s;
    }
  }

  let bestNiche = null;
  let bestScore = 0;
  for (const [niche, score] of Object.entries(viewScore)) {
    if (score > bestScore) { bestScore = score; bestNiche = niche; }
  }
  return { niche: bestNiche, score: bestScore, allScores: viewScore };
}

// ── Main ──────────────────────────────────────────────────────────────────────

console.log(`\nNiche reclassification — ${DRY_RUN ? 'DRY RUN' : 'LIVE'}`);
console.log('Loading top videos per channel...\n');

// One query: top 30 videos per channel, view-ordered
const topVideos = db.prepare(`
  WITH ranked AS (
    SELECT channel_id, title, views,
           ROW_NUMBER() OVER (PARTITION BY channel_id ORDER BY views DESC) AS rn
    FROM ingested_videos
    WHERE views > 0 AND title IS NOT NULL
  )
  SELECT channel_id, title, views FROM ranked WHERE rn <= 30
`).all();

// Group by channel
const videosByChannel = {};
for (const v of topVideos) {
  (videosByChannel[v.channel_id] = videosByChannel[v.channel_id] || []).push(v);
}

// Load all channels with a labeled niche
const channels = db.prepare(`
  SELECT channel_id, channel_name, primary_niche, niche, channel_subscribers, identity_source
  FROM ingested_channels
  WHERE (primary_niche IS NOT NULL OR niche IS NOT NULL)
    AND ingest_enabled = 1
    AND (ignore_from_benchmarks IS NULL OR ignore_from_benchmarks = 0)
`).all();

console.log(`Channels to evaluate: ${channels.length}`);
console.log(`Video samples loaded: ${topVideos.length}\n`);

const changes = [];
const blocked = [];
// Broad catch-all labels with no clear keyword signal.
// Only reclassify these when dominant is overwhelming (higher bar).
const CATCHALL_NICHES = new Set(['entertainment', 'lifestyle', 'other', 'variety']);

const RECLASSIFY_RATIO          = 10;  // dominant must score 10× labeled to reclassify specific niches
const RECLASSIFY_RATIO_CATCHALL = 25;  // higher bar for catch-all labels (entertainment, lifestyle)
const MIN_VIDEOS                = 10;  // skip channels with too few videos
const MIN_DOMINANT_VIDEOS       = 5;   // dominant niche must match at least 5 videos

for (const ch of channels) {
  if (/operator_(override|locked|modified)/i.test(String(ch.identity_source || ''))) {
    blocked.push({
      channel_id: ch.channel_id,
      channel_name: ch.channel_name,
      old_niche: ch.primary_niche || ch.niche,
      new_niche: '(skipped)',
      reason: 'operator_locked_identity',
    });
    continue;
  }

  const videos = videosByChannel[ch.channel_id] || [];
  if (videos.length < MIN_VIDEOS) continue;

  const labeled = (ch.primary_niche || ch.niche || '').toLowerCase().trim();
  if (!labeled) continue;

  const { niche: dominant, allScores } = dominantNiche(videos);
  if (!dominant || dominant === labeled) continue;

  // Skip if old and new are in the same niche cluster — not a real mismatch
  if (areSameCluster(labeled, dominant)) continue;

  const dominantScore = allScores[dominant] || 0;
  const labeledScore  = allScores[labeled]  || 0;

  if (dominantScore === 0) continue;

  // Require dominant niche to match at least MIN_DOMINANT_VIDEOS titles
  const domKeywords = NICHE_KEYWORDS[dominant] || [];
  const matchCount  = videos.filter(v => domKeywords.some(kw => (v.title || '').toLowerCase().includes(kw))).length;
  if (matchCount < MIN_DOMINANT_VIDEOS) continue;

  const isCatchall = CATCHALL_NICHES.has(labeled);
  const threshold  = isCatchall ? RECLASSIFY_RATIO_CATCHALL : RECLASSIFY_RATIO;

  // For catch-all niches with no labeled keywords (labeledScore=0), use absolute view threshold
  // instead of ratio to avoid infinite-ratio false positives
  if (isCatchall && labeledScore === 0) {
    const totalAvgViews = videos.reduce((s, v) => s + v.views, 0) / videos.length;
    // Only reclassify catch-all if dominant score is enormous AND avg views are high
    // This catches viral channels (Rich Baba-type) with catch-all labels
    if (dominantScore < 1e11 || totalAvgViews < 1_000_000) continue;
  }

  const ratio = labeledScore > 0 ? dominantScore / labeledScore : Infinity;
  if (ratio < threshold) continue;

  const totalAvg = videos.reduce((s, v) => s + v.views, 0) / videos.length;
  const guard = shouldAllowNicheRewrite({
    currentNiche: labeled,
    proposedNiche: dominant,
    channelName: ch.channel_name,
    titles: videos.map(v => v.title),
    identitySource: ch.identity_source,
  });
  if (!guard.allow) {
    blocked.push({
      channel_id: ch.channel_id,
      channel_name: ch.channel_name,
      old_niche: labeled,
      new_niche: dominant,
      reason: guard.reason,
      protected: guard.protected_identity?.primary_niche || null,
      evidence: guard.protected_identity?.evidence?.join(', ') || '',
    });
    continue;
  }

  changes.push({
    channel_id:    ch.channel_id,
    channel_name:  ch.channel_name,
    subs:          ch.channel_subscribers,
    old_niche:     labeled,
    new_niche:     dominant,
    ratio:         ratio === Infinity ? '∞' : ratio.toFixed(1),
    total_avg:     Math.round(totalAvg),
    match_count:   matchCount,
  });
}

// Sort by total_avg descending so biggest misclassified channels show first
changes.sort((a, b) => b.total_avg - a.total_avg);

console.log(`Channels flagged for reclassification: ${changes.length}\n`);
if (blocked.length) {
  console.log(`Channels blocked by identity guard/operator lock: ${blocked.length}`);
  for (const b of blocked.slice(0, 20)) {
    console.log(`  BLOCK ${String(b.channel_name || '').slice(0, 34)} | ${b.old_niche} -> ${b.new_niche} | ${b.reason}${b.evidence ? ' | ' + b.evidence : ''}`);
  }
  if (blocked.length > 20) console.log(`  ... ${blocked.length - 20} more blocked`);
  console.log('');
}
console.log('─'.repeat(95));
console.log(`${'Channel'.padEnd(35)} ${'Old niche'.padEnd(18)} ${'New niche'.padEnd(18)} ${'Ratio'.padStart(7)} ${'Avg views'.padStart(10)} ${'Vids'.padStart(5)}`);
console.log('─'.repeat(95));
for (const c of changes) {
  console.log(
    (c.channel_name || '').slice(0, 34).padEnd(35),
    c.old_niche.padEnd(18),
    c.new_niche.padEnd(18),
    String(c.ratio).padStart(7),
    Math.round(c.total_avg).toLocaleString().padStart(10),
    String(c.match_count).padStart(5),
  );
}
console.log('─'.repeat(95));

if (DRY_RUN) {
  console.log('\nRe-run without --dry-run to apply.');
  db.close();
  process.exit(0);
}

if (!changes.length) {
  console.log('\nNothing to reclassify.');
  db.close();
  process.exit(0);
}

// Apply all changes in one transaction
const updateIngested = db.prepare(
  'UPDATE ingested_channels SET primary_niche = ? WHERE channel_id = ?'
);
const updateCorpus = db.prepare(
  'UPDATE corpus_channels SET niche = ? WHERE channel_id = ?'
);

const apply = db.transaction(() => {
  for (const c of changes) {
    updateIngested.run(c.new_niche, c.channel_id);
    updateCorpus.run(c.new_niche, c.channel_id);
  }
});

apply();

console.log(`\nDone. ${changes.length} channels reclassified.`);
console.log('Re-run Louvain after this to rebuild communities with corrected niches.');

db.close();

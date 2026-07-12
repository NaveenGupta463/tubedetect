'use strict';

const STOPWORDS = new Set([
  'a','an','the','in','on','of','for','to','and','or','is','are','was','were',
  'be','been','how','why','when','what','which','this','that','these','those',
  'my','your','his','her','our','its','with','by','at','from','will','can',
  'did','do','does','has','have','had','get','got','not','no','all','but',
  'so','if','as','up','out','now','just','only','also','even','than','then',
  'new','top','best','review','video','part','full','episode',
  // Pronouns missing from original set
  'you','he','she','they','we','it','me','him','them','us',
  // Modal verbs — never stand alone as topics
  'must','should','could','would','may','might','shall',
  // Imperative/hook fragments — "year old", "hello namaskar", "mind blowing"
  'old','hello','namaskar','namaste','blowing','doing','tells','about',
  // Month names — filter date phrases like "april 2026"
  'january','february','march','april','may','june','july','august',
  'september','october','november','december',
  // Romanised Hindi function words
  'hai','hain','hoga','kya','kaise','mera','meri','mere','aap','main',
  'yeh','woh','ek','nahi','aur','se','ko','ka','ki','ke','mein','hum',
  'bhi','toh','koi','kuch','sirf','sab','tha','thi','the','raha','rahi',
  'karo','karna','karte','karke','rehe','rahe','gaye','gaya','gaye',
  // Devanagari Hindi function words / verb fragments (not content topics)
  'रहे','हैं','है','हो','ने','भी','जो','तो','बहुत','कभी','सकते','करते',
  'आज','कल','यहां','वहां','इसे','उसे','हमें','आपको','उनका','इनका',
  'बनाए','जाते','करेंगे','होगा','मिलेगा','देगा','लेगा','बताया',
  // Marathi function words / verb fragments
  'करू','नका','आहे','आणि','हे','ते','मी','तू','तुम्ही','आम्ही','त्यांना',
  'करणे','केले','केली','करतो','करती','असेल','नाही','पण','किंवा','म्हणजे',
  // Hindi question/negation words
  'क्यों','नहीं','क्या','कैसे','कौन','कहाँ','कब',
  'देगी','देनी','छोड़ो','बनाओ','करोगे',
  'marathi','hindi',
  // Indonesian / Malay noise words (from unclassified channels in the pool)
  'kata','ibu','doa','untuk','bijak','mutiara','kekuatan',
  // Common hashtag-driven social words (not content topics)
  'love','like','life','time','come','know','feel','want','need',
  // Platform mechanics — not content topics
  'shorts','viral','trending','ytshorts','minivlog','youtubeshorts',
  'viralvideo','shortsfeed','ashortaday','shortvideo','reels','tiktok',
  'subscribe','comment','share','follow','notification','bell','click',
  'trend','trendy','explore','fyp','foryou','foryoupage',
  // News/media container words — describe packaging, not content
  'news','latest','breaking','live','update','updates',
  // Time qualifiers — relative dates are never topics
  'today','yesterday','tomorrow','tonight',
  'daily','weekly','monthly','annual','yearly',
  'month','months','week','weeks','year','years',
  // Generic quality/importance markers
  'important','special','exclusive','official','major','top',
  // Day names — never a content topic, only form fragments ("crash monday")
  'monday','tuesday','wednesday','thursday','friday','saturday','sunday',
  // Continuation adverb — phrase-extraction artifact ("again stock")
  'again','anymore','nowadays',
]);

// Phrases that slip through word-level filtering but are hooks, not topics.
// "year old" spans "6 year old" / "35 year old" — completely different contexts.
const HOOK_PHRASES = new Set([
  'year old','years old',
  'you must','must do','must watch','must know',
  'no one','one tells',
  'mind blowing','mind blown',
  'about money','about life','about this',
  'hello namaskar','hello namaste',
  'real reason','real talk',
  'stop doing','stop this',
  // Current affairs containers (both tokens survive STOPWORDS, so block as bigrams)
  // 'affairs current' is the reversed seam bigram formed when titles repeat the phrase
  // in opposite order: "Current Affairs Today | Today Current Affairs" → token boundary
  // produces [affairs, current] which is not in HOOK_PHRASES without this entry.
  'current affairs','affairs today','affairs live','affairs current',
  // Time-range phrases ('month'/'week'/'year' are now STOPWORDS but these still
  // appear as Romanised forms or when stopwords are partially matched)
  'last months','this month','last week','this week','next week','last year','next year',
  // Live/broadcast containers
  'live coverage','live streaming','live broadcast','live show','live debate',
  // Generic catch-alls that slip through
  'full episode','complete episode','full series',
  'good morning','good evening','good night',
]);

// U+0980–0D7F: Bengali, Gurmukhi, Gujarati, Odia, Tamil, Telugu, Kannada, Malayalam.
// Titles dominated by any of these scripts return [] from extractPhrases.
// Devanagari (0900–097F) is handled separately by DEVANAGARI_RE (token-level).
const SOUTH_SCRIPT_RE  = /[ঀ-ൿ]/;
const DEVANAGARI_RE    = /[ऀ-ॿ]/;

// Hard delimiters that separate distinct title segments. n-grams must NOT span
// these, or the extractor manufactures cross-boundary salad: "Stock Crash | US100
// Crash" → "crash us100". Splitting first is the single biggest subject-quality fix.
const SEGMENT_DELIM_RE = /[|•·–—:;/]+|\s-\s|[।॥]+/;

function extractPhrases(title) {
  if (!title) return [];
  if (SOUTH_SCRIPT_RE.test(title)) return [];
  const cleaned = title
    .replace(/#\w+/g, ' ')                        // strip hashtag compounds: #studymotivation
    .replace(/\|{2}[^|]+\|{2}/g, ' ')            // strip credit patterns: ||Prashant Kirad||
    .toLowerCase();

  const phrases = [];
  // Generate n-grams WITHIN each delimiter-bounded segment only.
  for (const segment of cleaned.split(SEGMENT_DELIM_RE)) {
    const tokens = segment
      .replace(/[()[\]{}#@!?,।॥।\-''':]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .split(' ')
      .filter(w => w.length > 2 && !STOPWORDS.has(w) && !/^\d+$/.test(w) && !/^\d{4}$/.test(w) && !DEVANAGARI_RE.test(w));

    for (let i = 0; i < tokens.length - 1; i++) {
      const bigram = `${tokens[i]} ${tokens[i + 1]}`;
      if (!HOOK_PHRASES.has(bigram)) phrases.push(bigram);
    }
    for (let i = 0; i < tokens.length - 2; i++) {
      if (!HOOK_PHRASES.has(tokens[i] + ' ' + tokens[i + 1]) &&
          !HOOK_PHRASES.has(tokens[i + 1] + ' ' + tokens[i + 2])) {
        phrases.push(`${tokens[i]} ${tokens[i + 1]} ${tokens[i + 2]}`);
      }
    }
    for (let i = 0; i < tokens.length - 3; i++) {
      if (!HOOK_PHRASES.has(tokens[i] + ' ' + tokens[i + 1]) &&
          !HOOK_PHRASES.has(tokens[i + 1] + ' ' + tokens[i + 2]) &&
          !HOOK_PHRASES.has(tokens[i + 2] + ' ' + tokens[i + 3])) {
        phrases.push(`${tokens[i]} ${tokens[i + 1]} ${tokens[i + 2]} ${tokens[i + 3]}`);
      }
    }
  }
  return phrases;
}

module.exports = { STOPWORDS, HOOK_PHRASES, SOUTH_SCRIPT_RE, DEVANAGARI_RE, extractPhrases };

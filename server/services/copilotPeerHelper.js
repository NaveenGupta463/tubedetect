// Shared peer-resolution logic used by both creatorIntel routes and copilotTools.
// Extracted here to avoid circular require() between routes/ and services/.

const NICHE_CLUSTERS = {
  'selfimprovement':    ['selfimprovement', 'motivation', 'personal development', 'personal growth', 'leadership lessons', 'motivational speaking', 'mindset'],
  'motivation':         ['selfimprovement', 'motivation', 'personal development', 'personal growth', 'leadership lessons', 'motivational speaking', 'mindset'],
  'personal development': ['selfimprovement', 'motivation', 'personal development', 'personal growth', 'leadership lessons', 'motivational speaking', 'mindset'],
  'personal growth':    ['selfimprovement', 'motivation', 'personal development', 'personal growth', 'leadership lessons', 'motivational speaking', 'mindset'],
  'leadership lessons': ['selfimprovement', 'motivation', 'personal development', 'personal growth', 'leadership lessons', 'motivational speaking', 'mindset'],
  'motivational speaking': ['selfimprovement', 'motivation', 'personal development', 'personal growth', 'leadership lessons', 'motivational speaking', 'mindset'],
  'mindset':            ['selfimprovement', 'motivation', 'personal development', 'personal growth', 'leadership lessons', 'motivational speaking', 'mindset'],

  'finance':            ['finance', 'personal finance', 'investing', 'stock market', 'cryptocurrency'],
  'personal finance':   ['finance', 'personal finance', 'investing', 'stock market', 'cryptocurrency'],
  'investing':          ['finance', 'personal finance', 'investing', 'stock market', 'cryptocurrency'],
  'stock market':       ['finance', 'personal finance', 'investing', 'stock market', 'cryptocurrency'],
  'cryptocurrency':     ['finance', 'personal finance', 'investing', 'stock market', 'cryptocurrency'],

  'fitness':            ['fitness', 'workout', 'bodybuilding', 'strength training', 'muscle building', 'calisthenics', 'powerlifting', 'weightlifting', 'home workouts', 'gym workouts', 'gym motivation', 'workout routines'],
  'workout':            ['fitness', 'workout', 'bodybuilding', 'strength training', 'home workouts', 'gym workouts', 'workout routines'],
  'bodybuilding':       ['fitness', 'bodybuilding', 'workout', 'strength training', 'muscle building', 'powerlifting'],
  'strength training':  ['fitness', 'workout', 'bodybuilding', 'strength training', 'muscle building'],
  'muscle building':    ['fitness', 'workout', 'bodybuilding', 'strength training', 'muscle building'],

  'yoga':               ['yoga', 'somatic yoga', 'yin yoga', 'vinyasa yoga', 'yoga practice', 'yoga poses', 'yoga routines', 'yoga therapy', 'yoga for weight loss', 'yoga exercises', 'somatic movement', 'somatic healing', 'power yoga', 'pranayama techniques', 'yoga asanas'],
  'health':             ['health', 'nutrition', 'wellness', 'holistic health', 'natural remedies', 'ayurvedic medicine', 'health tips', 'healthy habits', 'healthy eating', 'gut health', 'heart health', 'nutrition tips', 'healthy recipes', 'longevity', 'anti-aging'],
  'meditation':         ['meditation', 'guided meditation', 'mindfulness', 'mindfulness meditation', 'sleep meditation', 'guided sleep meditation', 'somatic meditation', 'breathwork techniques', 'chakra healing', 'deep sleep', 'insomnia relief'],

  'business':           ['business', 'entrepreneurship', 'startup'],
  'entrepreneurship':   ['business', 'entrepreneurship', 'startup'],
  'startup':            ['business', 'entrepreneurship', 'startup'],

  'news':               ['news', 'current affairs', 'breaking news'],
  'current affairs':    ['news', 'current affairs', 'breaking news'],

  'lifestyle':          ['lifestyle', 'daily vlogs', 'daily life vlogs', 'personal vlogs', 'vlog'],
  'daily vlogs':        ['lifestyle', 'daily vlogs', 'daily life vlogs', 'personal vlogs', 'vlog'],
  'vlog':               ['lifestyle', 'daily vlogs', 'daily life vlogs', 'personal vlogs', 'vlog'],

  'family vlogs':       ['family vlogs', 'family life'],
  'family life':        ['family vlogs', 'family life'],

  'food':               ['food', 'street food', 'cooking'],
  'street food':        ['food', 'street food', 'cooking'],
  'cooking':            ['food', 'street food', 'cooking'],

  'travel':             ['travel', 'travel vlogs'],
  'travel vlogs':       ['travel', 'travel vlogs'],

  'comedy':             ['comedy', 'entertainment', 'comedy sketches'],
  'comedy sketches':    ['comedy', 'entertainment', 'comedy sketches'],
  'entertainment':      ['comedy', 'entertainment', 'comedy sketches'],
};

function resolvePeers(db, channel, { exclude_channel_id, minSize = 20, limit = 200 } = {}) {
  const results = [];

  const primaryNiche = channel.primary_niche || channel.niche;
  const clusterNiches = NICHE_CLUSTERS[primaryNiche] || [primaryNiche];

  let topics = [];
  try { topics = JSON.parse(channel.inferred_topics || '[]'); } catch (_) {}
  const primaryTopic = topics[0] || null;

  // Level 1: same primary inferred topic
  if (primaryTopic) {
    const rows = db.all(
      `SELECT channel_id FROM ingested_channels
       WHERE json_extract(inferred_topics, '$[0]') = ?
         AND channel_id != ? AND ingest_enabled = 1 LIMIT ?`,
      [primaryTopic, exclude_channel_id, limit],
    );
    for (const r of rows) if (!results.includes(r.channel_id)) results.push(r.channel_id);
  }
  if (results.length >= minSize) return applyFilters(db, channel, results, limit);

  // Level 2: shared inferred_topic within same niche cluster
  if (topics.length > 0 && clusterNiches.length > 0) {
    const phTopics = topics.map(() => '?').join(',');
    const phNiches = clusterNiches.map(() => '?').join(',');
    const rows = db.all(
      `SELECT DISTINCT ic.channel_id
       FROM ingested_channels ic, json_each(ic.inferred_topics) jt
       WHERE jt.value IN (${phTopics})
         AND (ic.primary_niche IN (${phNiches}) OR ic.niche IN (${phNiches}))
         AND ic.channel_id != ? AND ic.ingest_enabled = 1
       LIMIT ?`,
      [...topics, ...clusterNiches, ...clusterNiches, exclude_channel_id, limit],
    );
    for (const r of rows) if (!results.includes(r.channel_id)) results.push(r.channel_id);
  }

  // Level 3: full niche cluster
  if (clusterNiches.length > 0) {
    const ph = clusterNiches.map(() => '?').join(',');
    const rows = db.all(
      `SELECT channel_id FROM ingested_channels
       WHERE (niche IN (${ph}) OR primary_niche IN (${ph}))
         AND channel_id != ? AND ingest_enabled = 1 LIMIT ?`,
      [...clusterNiches, ...clusterNiches, exclude_channel_id, limit],
    );
    for (const r of rows) if (!results.includes(r.channel_id)) results.push(r.channel_id);
  }

  return applyFilters(db, channel, results, limit);
}

function applyFilters(db, channel, results, limit) {
  if (!results.length) return results;

  // Drop channels explicitly tagged EN when target is IN
  const targetRegion = channel.region || null;
  if (targetRegion === 'IN') {
    const ph = results.map(() => '?').join(',');
    const excluded = new Set(
      db.all(
        `SELECT channel_id FROM ingested_channels WHERE channel_id IN (${ph}) AND region = 'EN'`,
        results,
      ).map(r => r.channel_id),
    );
    if (excluded.size > 0) results.splice(0, results.length, ...results.filter(id => !excluded.has(id)));
  }

  // Drop non-Indian-language channels when target is English
  const targetLang = channel.primary_language || null;
  if (targetLang === 'en') {
    const ph = results.map(() => '?').join(',');
    const excluded = new Set(
      db.all(
        `SELECT channel_id FROM ingested_channels
         WHERE channel_id IN (${ph})
           AND primary_language IS NOT NULL AND primary_language NOT IN ('en','hi')`,
        results,
      ).map(r => r.channel_id),
    );
    if (excluded.size > 0) results.splice(0, results.length, ...results.filter(id => !excluded.has(id)));
  }

  return results.slice(0, limit);
}

module.exports = { resolvePeers };

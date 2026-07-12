'use strict';

const path = require('path');
const BetterSqlite3 = require('../node_modules/better-sqlite3');
const { computeWhatToPost } = require('../services/whatToPost');
const { resolveCreatorPeerContext } = require('../services/creatorPeerContext');
const {
  STOPWORDS,
  HOOK_PHRASES,
  DEVANAGARI_RE,
  SOUTH_SCRIPT_RE,
  extractPhrases,
} = require('../lib/phrases');
const { PODCAST_META_TOKENS } = require('../lib/creatorMode');
const { classifyTrend, getVelocity, getFormatWinner } = require('../services/topicAnalysis');

function openReadonlyDb() {
  const raw = new BetterSqlite3(path.resolve(__dirname, '../data/scoring.db'), {
    readonly: true,
    fileMustExist: true,
    timeout: 60000,
  });
  raw.pragma('query_only = ON');
  raw.pragma('busy_timeout = 60000');
  const cache = new Map();
  const stmt = (sql) => {
    if (!cache.has(sql)) cache.set(sql, raw.prepare(sql));
    return cache.get(sql);
  };
  return {
    all: (sql, params = []) => stmt(sql).all(Array.isArray(params) ? params : [params]),
    get: (sql, params = []) => stmt(sql).get(Array.isArray(params) ? params : [params]),
    run: () => ({ changes: 0 }),
    exec: () => undefined,
    close: () => { cache.clear(); raw.close(); },
  };
}

const db = openReadonlyDb();
const ctx = {
  resolveCreatorPeerContext,
  extractPhrases,
  getVelocity,
  classifyTrend,
  getFormatWinner,
  PODCAST_META_TOKENS,
  STOPWORDS,
  HOOK_PHRASES,
  SOUTH_SCRIPT_RE,
  DEVANAGARI_RE,
};

const limit = Math.max(1, Math.min(parseInt(process.argv[2] || '100', 10), 500));
const topN = Math.max(1, Math.min(parseInt(process.argv[3] || '20', 10), 50));
const fastMode = process.argv.includes('--fast');
const progress = process.argv.includes('--progress');

const genericPatterns = [
  /behind the scenes: how i actually make my videos/i,
  /most common mistake in \[your niche\]/i,
  /beginner guide: the first 5 things i wish i knew/i,
  /before and after: what changed when i tried \[method\]/i,
  /reacting to common myths in my niche/i,
  /one mistake i see everywhere in this niche/i,
  /full process breakdown from start to finish/i,
];

const rows = db.all(
  `SELECT channel_id, channel_name, COALESCE(primary_niche, niche) AS niche, channel_subscribers
   FROM ingested_channels
   WHERE ingest_enabled = 1
     AND channel_id IS NOT NULL
     AND COALESCE(primary_niche, niche) IS NOT NULL
     ${fastMode ? "AND channel_subscribers BETWEEN 1000 AND 20000000" : ''}
     ${fastMode ? "AND EXISTS (SELECT 1 FROM ingested_videos iv WHERE iv.channel_id = ingested_channels.channel_id AND iv.published_at > datetime('now', '-180 days') LIMIT 1)" : ''}
   ORDER BY random()
   LIMIT ?`,
  [limit],
);

let errors = 0;
let zero = 0;
let low = 0;
let fallbackChannels = 0;
let genericFallbackChannels = 0;
let totalIdeas = 0;
let totalFallback = 0;
const samples = [];
const byNiche = new Map();
const byCategory = new Map();

function getGroup(map, key) {
  const k = key || 'unknown';
  if (!map.has(k)) {
    map.set(k, {
      key: k,
      channels: 0,
      errors: 0,
      zero: 0,
      low: 0,
      fallbackChannels: 0,
      genericFallbackChannels: 0,
      totalIdeas: 0,
      totalFallback: 0,
      creativeChannels: 0,
      dataBackedChannels: 0,
      sampleChannels: [],
      sampleFallback: [],
    });
  }
  return map.get(k);
}

function recordSample(group, ch, fallback) {
  if (group.sampleChannels.length < 4) group.sampleChannels.push(ch.channel_name || ch.channel_id);
  if (fallback.length && group.sampleFallback.length < 5) {
    for (const idea of fallback) {
      if (group.sampleFallback.length >= 5) break;
      const title = idea.topic || idea.title;
      if (title && !group.sampleFallback.includes(title)) group.sampleFallback.push(title);
    }
  }
}

let idx = 0;
for (const ch of rows) {
  idx++;
  if (progress) console.log(`[audit] ${idx}/${rows.length} ${ch.channel_name || ch.channel_id} (${ch.niche})`);
  let result;
  const nicheGroup = getGroup(byNiche, ch.niche);
  try {
    result = computeWhatToPost(
      db,
      {
        channel_id: ch.channel_id,
        subscriber_count: String(ch.channel_subscribers || 0),
      },
      ctx,
    );
  } catch (e) {
    errors++;
    nicheGroup.channels++;
    nicheGroup.errors++;
    if (samples.length < 20) {
      samples.push({ channel: ch.channel_name, niche: ch.niche, error: e.message });
    }
    continue;
  }

  const ideas = result?.ideas || [];
  const categoryGroup = getGroup(byCategory, result?.niche_category || 'unknown');
  nicheGroup.channels++;
  categoryGroup.channels++;
  totalIdeas += ideas.length;
  nicheGroup.totalIdeas += ideas.length;
  categoryGroup.totalIdeas += ideas.length;
  if (!ideas.length) { zero++; nicheGroup.zero++; categoryGroup.zero++; }
  if (ideas.length < 5) { low++; nicheGroup.low++; categoryGroup.low++; }

  const fallback = ideas.filter(i => i.source === 'fallback_evergreen');
  if (fallback.length) {
    fallbackChannels++;
    nicheGroup.fallbackChannels++;
    categoryGroup.fallbackChannels++;
  }
  totalFallback += fallback.length;
  nicheGroup.totalFallback += fallback.length;
  categoryGroup.totalFallback += fallback.length;

  if (ideas.some(i => i.idea_type === 'creative_package' && i.source !== 'fallback_evergreen')) {
    nicheGroup.creativeChannels++;
    categoryGroup.creativeChannels++;
  }
  if (ideas.some(i => i.source !== 'fallback_evergreen')) {
    nicheGroup.dataBackedChannels++;
    categoryGroup.dataBackedChannels++;
  }
  recordSample(nicheGroup, ch, fallback);
  recordSample(categoryGroup, ch, fallback);

  const generic = fallback.filter(i => genericPatterns.some(rx => rx.test(i.topic || i.title || '')));
  if (generic.length) {
    genericFallbackChannels++;
    nicheGroup.genericFallbackChannels++;
    categoryGroup.genericFallbackChannels++;
    if (samples.length < 20) {
      samples.push({
        channel: ch.channel_name,
        niche: ch.niche,
        fallback: fallback.map(i => i.topic || i.title).slice(0, 5),
        generic: generic.map(i => i.topic || i.title),
      });
    }
  }
}

console.log(JSON.stringify({
  sample: rows.length,
  errors,
  zero,
  low,
  fallbackChannels,
  genericFallbackChannels,
  totalFallback,
  avgIdeas: +(totalIdeas / Math.max(rows.length, 1)).toFixed(2),
  avgFallback: +(totalFallback / Math.max(rows.length, 1)).toFixed(2),
}, null, 2));

function summarizeGroup(g) {
  return {
    key: g.key,
    channels: g.channels,
    fallbackChannels: g.fallbackChannels,
    fallbackRate: +(g.fallbackChannels / Math.max(g.channels, 1)).toFixed(2),
    genericFallbackChannels: g.genericFallbackChannels,
    zero: g.zero,
    low: g.low,
    avgIdeas: +(g.totalIdeas / Math.max(g.channels, 1)).toFixed(2),
    avgFallback: +(g.totalFallback / Math.max(g.channels, 1)).toFixed(2),
    dataBackedChannels: g.dataBackedChannels,
    creativeChannels: g.creativeChannels,
    sampleChannels: g.sampleChannels,
    sampleFallback: g.sampleFallback,
  };
}

const categoryRows = [...byCategory.values()]
  .sort((a, b) => b.fallbackChannels - a.fallbackChannels || b.channels - a.channels)
  .map(summarizeGroup);

const nicheRows = [...byNiche.values()]
  .filter(g => g.channels >= 2 || g.fallbackChannels > 0)
  .sort((a, b) => b.fallbackChannels - a.fallbackChannels || b.channels - a.channels || b.totalFallback - a.totalFallback)
  .slice(0, topN)
  .map(summarizeGroup);

console.log('BY_CATEGORY');
console.log(JSON.stringify(categoryRows, null, 2));
console.log('TOP_FALLBACK_NICHES');
console.log(JSON.stringify(nicheRows, null, 2));

if (samples.length) {
  console.log('GENERIC_OR_ERROR_SAMPLES');
  for (const sample of samples) console.log(JSON.stringify(sample));
}

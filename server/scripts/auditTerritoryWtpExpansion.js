'use strict';

const { getDb, closeDb } = require('../db/init');
const { computeWhatToPost } = require('../services/whatToPost');
const { resolveCreatorPeerContext } = require('../services/creatorPeerContext');
const { extractPhrases, STOPWORDS, HOOK_PHRASES, DEVANAGARI_RE, SOUTH_SCRIPT_RE } = require('../lib/phrases');
const { PODCAST_META_TOKENS } = require('../lib/creatorMode');
const { classifyTrend, getVelocity, getFormatWinner } = require('../services/topicAnalysis');

const db = getDb();

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

function sampleChannels(limit = 20) {
  return db.all(
    `SELECT ic.channel_id, ic.channel_name, ic.niche,
            COUNT(*) AS accepted_territories
     FROM channel_territory_profiles ctp
     JOIN ingested_channels ic ON ic.channel_id = ctp.channel_id
     WHERE ctp.role IN ('core','accepted')
       AND COALESCE(ctp.view_lift, 0) >= 0.8
       AND ctp.video_count >= 3
       AND ic.ingest_enabled = 1
       AND LOWER(COALESCE(ic.niche, '')) NOT LIKE '%news%'
       AND LOWER(COALESCE(ic.niche, '')) NOT LIKE '%politic%'
       AND LOWER(COALESCE(ic.niche, '')) NOT LIKE '%crime%'
       AND LOWER(COALESCE(ic.niche, '')) NOT LIKE '%current affairs%'
       AND LOWER(COALESCE(ic.niche, '')) NOT LIKE '%live coverage%'
     GROUP BY ic.channel_id
     ORDER BY accepted_territories DESC, RANDOM()
     LIMIT ?`,
    [limit],
  );
}

function runOne(ch) {
  const res = computeWhatToPost(db, { channel_id: ch.channel_id, debug: process.argv.includes('--debug') }, ctx);
  const ideas = res.ideas || [];
  const territoryIdeas = ideas.filter(i => i.source === 'territory_expansion' || i.territory_source === 'territory_expansion');
  return {
    channel_id: ch.channel_id,
    channel_name: ch.channel_name,
    niche: ch.niche,
    accepted_territories: ch.accepted_territories,
    ok: res.ok,
    ideas: ideas.length,
    territory_ideas: territoryIdeas.length,
    territory_candidates: res.territory_expansion?.candidate_count || 0,
    territories_used: (res.territory_expansion?.territories_used || []).map(t => `${t.territory_id}:${t.ideas || 0}`).join(', '),
    top_territory_topics: territoryIdeas.slice(0, 3).map(i => i.angle_title || i.title || i.topic).join(' | '),
  };
}

function main() {
  const limit = Math.max(1, Number(process.argv[2] || 20));
  const channelArg = process.argv.find(a => a.startsWith('--channel='));
  const rows = channelArg
    ? channelArg.slice('--channel='.length).split(',').map(id => db.get(
      `SELECT ic.channel_id, ic.channel_name, ic.niche,
              COUNT(ctp.territory_id) AS accepted_territories
       FROM ingested_channels ic
       LEFT JOIN channel_territory_profiles ctp
         ON ctp.channel_id = ic.channel_id
        AND ctp.role IN ('core','accepted')
        AND COALESCE(ctp.view_lift, 0) >= 0.8
        AND ctp.video_count >= 3
       WHERE ic.channel_id = ?
       GROUP BY ic.channel_id`,
      [id],
    )).filter(Boolean)
    : sampleChannels(limit);
  const out = rows.map(runOne);
  console.table(out.map(r => ({
    channel_name: r.channel_name,
    niche: r.niche,
    accepted_territories: r.accepted_territories,
    ideas: r.ideas,
    territory_ideas: r.territory_ideas,
    territory_candidates: r.territory_candidates,
  })));
  console.log('\nDetails:');
  for (const r of out) {
    console.log(`\n${r.channel_name} (${r.niche})`);
    console.log(`  territories_used: ${r.territories_used || 'none'}`);
    console.log(`  top_territory_topics: ${r.top_territory_topics || 'none'}`);
  }
}

try {
  main();
} finally {
  closeDb();
}

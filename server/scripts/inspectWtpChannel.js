'use strict';

const { getDb, closeDb } = require('../db/init');
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

const q = process.argv.slice(2).join(' ').trim();
if (!q) {
  console.error('Usage: node server/scripts/inspectWtpChannel.js <channel id or name>');
  process.exit(1);
}

const db = getDb();
const channel = db.get(
  `SELECT channel_id, channel_name, channel_subscribers, primary_niche, niche,
          creator_mode, routing_profile, format_type, format_profile
   FROM ingested_channels
   WHERE channel_id = ?
      OR lower(channel_name) = lower(?)
      OR lower(channel_name) LIKE lower(?)
   ORDER BY CASE WHEN channel_id = ? OR lower(channel_name) = lower(?) THEN 0 ELSE 1 END,
            channel_subscribers DESC
   LIMIT 1`,
  [q, q, `${q}%`, q, q],
);

if (!channel) {
  console.error(`Channel not found: ${q}`);
  closeDb();
  process.exit(1);
}

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

const peerCtx = resolveCreatorPeerContext(db, channel.channel_id, {
  userSubs: channel.channel_subscribers || 0,
  debug: true,
});

const result = computeWhatToPost(
  db,
  {
    channel_id: channel.channel_id,
    subscriber_count: String(channel.channel_subscribers || 0),
    debug: true,
  },
  ctx,
);

const csp = db.get(
  `SELECT primary_csp, confidence, version
   FROM channel_content_strategy_profiles
   WHERE channel_id = ?`,
  [channel.channel_id],
);

console.log(JSON.stringify({
  channel,
  stored_csp: csp,
  wtp: {
    niche_category: result.niche_category,
    channel_count: result.channel_count,
    video_count: result.video_count,
    idea_count: result.ideas?.length || 0,
    guest_intel_active: result.guest_intel_active,
    routing_profile_active: result.routing_profile_active,
    csp_routing_active: result.csp_routing_active,
    csp_primary: result.csp_primary,
    csp_confidence: result.csp_confidence,
    csp_peer_count: result.csp_peer_count,
    format_profile: result.format_profile,
    format_profile_confidence: result.format_profile_confidence,
  },
  csp_top_peer_sample: result.csp_top_peer_sample || result.peer_routing?.csp_top_peer_sample || null,
  resolver_peer_sample: peerCtx.csp_top_peer_sample || null,
  resolver_peer_counts: {
    peer_count: peerCtx.peerIds?.length || 0,
    csp_peer_count: peerCtx.csp_peer_count,
    csp_candidates_total: peerCtx.csp_candidates_total,
    csp_candidates_admitted: peerCtx.csp_candidates_admitted,
    csp_rejected_family: peerCtx.csp_rejected_family,
    csp_target_family: peerCtx.csp_target_family,
  },
  ideas: (result.ideas || []).slice(0, 8).map(i => ({
    topic: i.topic,
    title: i.title || i.action_title || null,
    source: i.source || null,
    score: i.score,
    parent_topic: i.parent_topic || null,
    evidence_type: i.evidence_type || i.format_evidence?.evidence_type || null,
    examples: (i.examples || []).slice(0, 2).map(e => ({
      title: e.title,
      channel_name: e.channel_name,
      views: e.views,
    })),
  })),
}, null, 2));

closeDb();

'use strict';
// Validates Tasks 1-4 for: Raj Shamani, BeerBiceps, Warikoo, Nikhil Kamath
// Usage: node server/scripts/filterValidation.js
// Reads DB read-only — safe to run while server is running.

const path  = require('path');
const BetterSqlite3 = require(path.join(__dirname, '../node_modules/better-sqlite3'));
const DB_PATH = path.join(__dirname, '../data/scoring.db');

const db = new BetterSqlite3(DB_PATH, { readonly: true });
db.exec = undefined; // readonly guard

// Inline helpers (same as creatorIntel.js but without server dep)
const PEER_WEIGHTS = { topic: 0.51, format: 0.21, style: 0.18, language: 0.10, phrase: 0.50 };

function parseFingerprintPhrases(raw) {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    if (Array.isArray(arr))
      return arr.map(e => (typeof e === 'object' ? (e.phrase || '') : String(e))).filter(Boolean);
  } catch (_) {}
  return raw.split('|').map(s => s.trim()).filter(Boolean);
}

function computeSubWeight(userSubs, peerSubs) {
  if (!userSubs || !peerSubs) return 0.5;
  const ratio = peerSubs / userSubs;
  if (ratio < 0.05 || ratio > 20) return 0;
  if (ratio >= 0.2 && ratio <= 5)  return 1.0;
  return 0.6;
}

function computePeerScore(user, peer, uPhrases, pPhrases, w) {
  const topicMatch    = (user.niche && peer.niche && user.niche === peer.niche) ? 1 : 0;
  const formatMatch   = (user.format_type && peer.format_type &&
                         user.format_type !== 'other' && peer.format_type !== 'other' &&
                         user.format_type === peer.format_type) ? 1 : 0;
  const styleMatch    = (user.content_archetype && peer.content_archetype &&
                         user.content_archetype === peer.content_archetype) ? 1 : 0;
  const languageMatch = (user.primary_language && peer.primary_language &&
                         user.primary_language === peer.primary_language) ? 1 : 0;
  const setA = new Set(uPhrases), setB = new Set(pPhrases);
  let shared = 0;
  for (const p of setA) if (setB.has(p)) shared++;
  const union = setA.size + setB.size - shared;
  const phraseSim = union > 0 ? shared / union : 0;
  return {
    score: w.topic * topicMatch + w.format * formatMatch + w.style * styleMatch +
           w.language * languageMatch + w.phrase * phraseSim,
    topic_match: topicMatch, format_match: formatMatch, style_match: styleMatch,
    language_match: languageMatch, phrase_sim: +phraseSim.toFixed(4),
  };
}

const TARGETS = ['Raj Shamani','BeerBiceps','Warikoo','Nikhil Kamath'];

for (const name of TARGETS) {
  const chanRow = db.prepare(
    `SELECT channel_id, channel_name, channel_subscribers,
            COALESCE(primary_niche, niche) AS niche,
            format_type, content_archetype, primary_language, content_fingerprint
     FROM ingested_channels WHERE channel_name LIKE ? AND ingest_enabled = 1 LIMIT 1`,
  ).get(`%${name}%`);

  if (!chanRow) { console.log(`\n[${name}] NOT FOUND in ingested_channels`); continue; }

  const ciRow = db.prepare(
    `SELECT content_phrases, brand_phrases, brand_contamination_pct,
            confidence_tier, health_flags, peer_source_recommended
     FROM channel_identity WHERE channel_id = ?`,
  ).get(chanRow.channel_id);

  const fingerprint = ciRow?.content_phrases && ciRow.confidence_tier !== 'none'
    ? ciRow.content_phrases
    : chanRow.content_fingerprint;

  const userPhrases = parseFingerprintPhrases(fingerprint).slice(0, 15);
  const userMeta    = {
    niche:             chanRow.niche,
    format_type:       chanRow.format_type,
    content_archetype: chanRow.content_archetype,
    primary_language:  chanRow.primary_language,
  };
  const confTier    = ciRow?.confidence_tier || 'none';
  const hasMultiDim = !!(userMeta.format_type && userMeta.content_archetype);

  // --- Phrase pre-filter attempt ---
  let phrasePeers = 0;
  let routingMode = 'phrase';
  let peerFailureReason = null;

  if (userPhrases.length > 0) {
    const cond = userPhrases.map(() => `content_fingerprint LIKE ?`).join(' OR ');
    const phraseRows = db.prepare(
      `SELECT channel_id FROM ingested_channels
       WHERE content_fingerprint IS NOT NULL AND (${cond}) AND channel_id != ? AND ingest_enabled = 1`,
    ).all(...userPhrases.map(p => `%${p}%`), chanRow.channel_id);
    phrasePeers = phraseRows.length;
  }

  if (phrasePeers === 0) {
    peerFailureReason = (ciRow?.brand_contamination_pct > 0.5) ? 'brand_contamination' : 'zero_phrase_peers';
    if ((confTier === 'low' || confTier === 'none') && userMeta.format_type && userMeta.content_archetype) {
      routingMode = 'format_fallback';
      const langClause  = userMeta.primary_language ? `AND primary_language = ?` : '';
      const params = [
        userMeta.format_type, userMeta.content_archetype,
        ...(userMeta.primary_language ? [userMeta.primary_language] : []),
        chanRow.channel_id, 600,
      ];
      const fallbackRows = db.prepare(
        `SELECT channel_id, channel_name, channel_subscribers,
                COALESCE(primary_niche, niche) AS niche,
                format_type, content_archetype, primary_language
         FROM ingested_channels
         WHERE format_type = ? AND content_archetype = ? ${langClause}
           AND channel_id != ? AND ingest_enabled = 1 LIMIT ?`,
      ).all(...params);

      const scored = fallbackRows
        .map(r => {
          const sw = computeSubWeight(chanRow.channel_subscribers, r.channel_subscribers || 0);
          if (sw === 0) return null;
          const bd = computePeerScore(userMeta, r, [], [], PEER_WEIGHTS);
          return { ...r, score: bd.score * sw };
        })
        .filter(Boolean)
        .sort((a, b) => b.score - a.score);

      console.log(`\n══ ${chanRow.channel_name} (${chanRow.channel_id}) ══`);
      console.log(`  confidence_tier   : ${confTier}`);
      console.log(`  fingerprint_phrases: ${userPhrases.slice(0, 5).join(' | ')}`);
      console.log(`  phrase_peers      : 0  →  format_fallback triggered`);
      console.log(`  peer_failure_reason: ${peerFailureReason}`);
      console.log(`  routing_mode      : ${routingMode}`);
      console.log(`  format_type       : ${userMeta.format_type}`);
      console.log(`  content_archetype : ${userMeta.content_archetype}`);
      console.log(`  primary_language  : ${userMeta.primary_language || '(null)'}`);
      console.log(`  format_peers_raw  : ${fallbackRows.length}`);
      console.log(`  format_peers_after_sub_weight: ${scored.length}`);
      console.log(`  brand_phrases_stored: ${ciRow?.brand_phrases ? ciRow.brand_phrases.split('|').slice(0, 5).join(' | ') : '(none in DB yet)'}`);
      if (scored.length > 0) {
        console.log(`  top 5 peers:`);
        for (const p of scored.slice(0, 5)) {
          console.log(`    ${p.channel_name} (${p.channel_id})  score=${p.score.toFixed(3)}`);
        }
      } else {
        console.log(`  top 5 peers: NONE — no peers survived sub_weight filter`);
      }
    } else {
      console.log(`\n══ ${chanRow.channel_name} (${chanRow.channel_id}) ══`);
      console.log(`  confidence_tier   : ${confTier}`);
      console.log(`  phrase_peers      : 0`);
      console.log(`  peer_failure_reason: ${peerFailureReason}`);
      console.log(`  routing_mode      : no_fallback (format_type=${userMeta.format_type || '(null)'})`);
      console.log(`  RESULT: STILL ZERO PEERS — format metadata missing`);
    }
  } else {
    console.log(`\n══ ${chanRow.channel_name} (${chanRow.channel_id}) ══`);
    console.log(`  confidence_tier   : ${confTier}`);
    console.log(`  phrase_peers      : ${phrasePeers}`);
    console.log(`  routing_mode      : ${hasMultiDim ? 'multi_dim' : 'legacy'}`);
    console.log(`  RESULT: PHRASE ROUTING OK`);
  }
}

db.close();

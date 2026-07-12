'use strict';

/**
 * Phase 1: Creator graph candidate miner.
 * Scans ingested_videos descriptions + titles for @handle mentions and channel IDs.
 * No YouTube API calls. Local DB only.
 * Writes creator_discovery_candidates + creator_discovery_edges.
 *
 * Usage: node server/scripts/mineCreatorGraphCandidates.js [--dry-run] [--report-only]
 *   --dry-run     : mine and score but do not write to DB
 *   --report-only : print score report from existing candidates table
 */

const { getDb } = require('../db/init');

const BATCH_SIZE = 8000;
const MAX_EDGES_PER_CANDIDATE = 30;
const NINETY_DAYS_MS = 90 * 24 * 3600 * 1000;

const PLATFORM_BLOCKLIST = new Set([
  'youtube', 'youtubecreators', 'youtubepresents', 'youtubemusic', 'youtubegaming',
  'youtubeshorts', 'youtubeindiaofficial',
  'instagram', 'instagramindia', 'instagramreels', 'instagramforbusiness',
  'twitter', 'x', 'facebook', 'fb', 'meta', 'whatsapp', 'telegram',
  'tiktok', 'snapchat', 'discord', 'signal', 'linkedin',
  'spotify', 'spotifyindia', 'applemusic', 'gaana', 'jiosaavn', 'wynk',
  'amazon', 'amazonprimevideo', 'primevideo', 'flipkart', 'meesho', 'myntra', 'ajio',
  'google', 'gmail', 'googleplay', 'googlenews',
  'patreon', 'buymeacoffee', 'kofi',
  'razorpay', 'paytm', 'phonepe', 'gpay', 'paypal', 'bhimupi',
  'nordvpn', 'expressvpn', 'purevpn', 'surfshark',
  'squarespace', 'wix', 'shopify', 'hostinger', 'bluehost', 'godaddy',
  'hotstar', 'disneyplushotstar', 'netflix', 'zee5', 'sonyliv', 'mxplayer',
  'jiocinema', 'voot', 'altbalaji',
  'ndtv', 'aajtak', 'abpnews', 'zeenews', 'indiatvnews', 'republic',
  'republicworld', 'wionews', 'news18', 'timesnow',
  'thewire', 'theprint', 'scroll', 'thequint',
  'reels', 'shorts', 'live', 'official', 'india',
  'youtubeindia', 'youtubecreatorsindia', 'youtubetrending',
  // URL/link patterns that leak through @-extraction
  'https', 'http', 'www', 't.me', 'bit.ly', 'youtu.be', 'linktr.ee', 'linktree',
  'tele', 'wa.me',
  // Very short generic words that produce false positives
  'the', 'for', 'and', 'get', 'all', 'top', 'new', 'now', 'pro', 'big',
  'prince', 'queen', 'king', 'star', 'officialchannel', 'mainchannel',
]);

const BRAND_PATTERNS = [
  /official$/i,
  /^amazon/i, /^google/i, /^apple/i,
  /^samsung/i, /^oneplus/i, /^realme/i, /^xiaomi/i, /^oppo/i, /^vivo/i,
  /^motorola/i, /^sony/i, /^lg/i, /^nokia/i, /^jio/i, /^airtel/i,
  /^zee/i, /^star/i, /^sun/i,
  /news(channel|tv|live|official|hindi|english)?$/i,
  /^(bbc|cnn|nbc|abc|fox|sky)/i,
  /records?$/i,
  // FMCG / consumer brands
  /^loreal/i, /^garnier/i, /^dove/i, /^lakme/i, /^mamaearth/i, /^marico/i,
  /^hul$/i, /^hnm$/i, /^myntra/i, /^puma/i, /^nike/i, /^adidas/i, /^boat/i,
  /^colgate/i, /^nestle/i, /^amul/i, /^cadbury/i, /^fevicol/i,
  /^adobe/i, /^audible/i, /^statefarm/i, /^lovebeautyandplanet/i,
  /^reliance/i, /^rockstargames/i, /^minecraft/i, /^callofduty/i,
  /^nykaa/i, /^sephora/i, /^maybelline/i, /^swissbeauty/i,
  /(store|shop|mall|market|officialstore|support|help|care)$/i,
  /(insurance|foundation|beauty|cosmetics|skincare|fashion|apparel)/i,
];

const DOMAIN_SUFFIX = /\.(com|in|net|org|co|io|app|tv|me|us|uk|au|ca|edu|gov)(\.|$)/i;
const HANDLE_RE    = /^[a-zA-Z0-9][a-zA-Z0-9._-]{2,29}$/;
const CHANNEL_ID_RE = /\bUC[a-zA-Z0-9_-]{22}\b/g;
const CREATOR_HINT_RE = /(vlog|vlogs|gaming|gamer|music|films?|podcast|show|comedy|shorts|reacts?|recipes?|kitchen|fitness|academy|classes|study|travel|official)$/i;
const WEAK_GENERIC_HANDLE_RE = /^[a-z]{3,9}$/i;

function isBlockedHandle(norm) {
  if (!norm) return true;
  if (PLATFORM_BLOCKLIST.has(norm)) return true;
  if (DOMAIN_SUFFIX.test(norm)) return true;
  if (BRAND_PATTERNS.some(p => p.test(norm))) return true;
  if (/[._-]$/.test(norm)) return true;
  if (/^[0-9]+$/.test(norm)) return true;
  return false;
}

function extractHandles(text) {
  if (!text) return [];
  const raw = text.match(/@[a-zA-Z0-9][a-zA-Z0-9._-]{2,30}/g) || [];
  const out = [];
  for (const h of raw) {
    const bare = h.slice(1);
    const norm = bare.toLowerCase();
    if (isBlockedHandle(norm)) continue;
    if (!HANDLE_RE.test(bare)) continue;
    out.push(norm);
  }
  return [...new Set(out)];
}

function extractTitleCollabHandles(title) {
  if (!title) return [];
  const handles = [];
  const collabTrigger = /\b(ft\.?|feat\.?|with|vs\.?|collab(?:oration)?)\s+@/i;
  const pipeHandle   = /\|\s*@([a-zA-Z0-9][a-zA-Z0-9._-]{2,29})/g;

  if (collabTrigger.test(title)) {
    const found = title.match(/@[a-zA-Z0-9][a-zA-Z0-9._-]{2,29}/g) || [];
    for (const h of found) {
      const norm = h.slice(1).toLowerCase();
      if (!isBlockedHandle(norm)) {
        handles.push(norm);
      }
    }
  }

  let m;
  pipeHandle.lastIndex = 0;
  while ((m = pipeHandle.exec(title)) !== null) {
    const norm = m[1].toLowerCase();
    if (!isBlockedHandle(norm)) {
      handles.push(norm);
    }
  }
  return [...new Set(handles)];
}

function extractChannelIds(text) {
  if (!text) return [];
  const raw = text.match(CHANNEL_ID_RE) || [];
  return [...new Set(raw)];
}

function scoreCandidate(c) {
  // Cap total_mentions so bulk-mentions from a single parent channel don't dominate.
  const cappedMentions = Math.min(c.total_mentions, 60);
  let score = (
    c.distinct_source_channels * 15 +
    c.title_collab_count       * 15 +
    c.distinct_hq_sources      * 12 +
    c.distinct_recent_sources  *  8 +
    c.thin_pool_relevance      *  8 +
    cappedMentions             *  0.25
  );

  if (c.candidate_type === 'handle') {
    const h = c.candidate_key || c.handle || '';
    const weakEvidence = c.distinct_source_channels < 2 && c.title_collab_count < 2;
    const genericSingleWord = WEAK_GENERIC_HANDLE_RE.test(h) && !CREATOR_HINT_RE.test(h);
    if (weakEvidence) score -= 35;
    if (genericSingleWord) score -= 25;
    if (isBlockedHandle(h)) score -= 100;
  }

  return Math.max(score, 0);
}

async function main() {
  const args       = process.argv.slice(2);
  const dryRun     = args.includes('--dry-run');
  const reportOnly = args.includes('--report-only');

  const db = getDb();

  if (reportOnly) {
    printReport(db);
    return;
  }

  console.log('[mineCreatorGraph] Starting. dry_run=' + dryRun);
  const t0 = Date.now();

  console.log('[mineCreatorGraph] Loading reference sets...');

  const knownHandles = new Set();
  db.all(`SELECT lower(handle) AS h FROM corpus_channels WHERE handle IS NOT NULL AND handle != ''`)
    .forEach(r => r.h && knownHandles.add(r.h));

  const knownChannelIds = new Set();
  db.all(`SELECT channel_id FROM corpus_channels`).forEach(r => knownChannelIds.add(r.channel_id));
  db.all(`SELECT channel_id FROM ingested_channels`).forEach(r => knownChannelIds.add(r.channel_id));

  const highQualitySources = new Set();
  db.all(`SELECT channel_id FROM ingested_channels`).forEach(r => highQualitySources.add(r.channel_id));
  db.all(`SELECT channel_id FROM corpus_channels WHERE quality_score >= 70 AND training_eligible = 1`)
    .forEach(r => highQualitySources.add(r.channel_id));

  const thinNiches = new Set(
    db.all(`
      SELECT niche FROM corpus_channels
      WHERE training_eligible = 1 AND niche IS NOT NULL
      GROUP BY niche HAVING COUNT(*) < 25
    `).map(r => r.niche),
  );

  console.log('[mineCreatorGraph] thin_niches=' + thinNiches.size +
    ' | known_handles=' + knownHandles.size +
    ' | known_channel_ids=' + knownChannelIds.size +
    ' | high_quality_sources=' + highQualitySources.size);

  // In-memory accumulators
  const handleCandidates    = new Map(); // norm_handle → stats
  const channelIdCandidates = new Map(); // channelId → stats
  const edgeCounts          = new Map(); // candidateKey → count

  // Buffered edges (written at end in transaction to avoid per-row DB writes during scan)
  const edgeBuffer = [];

  function ensureHandle(norm) {
    if (!handleCandidates.has(norm)) {
      handleCandidates.set(norm, {
        candidate_key: norm,
        handle: norm,
        candidate_type: 'handle',
        total_mentions: 0,
        distinct_sources: new Set(),
        hq_sources: new Set(),
        recent_sources: new Set(),
        title_collab_count: 0,
        description_mention_count: 0,
        thin_pool_hits: 0,
      });
    }
    return handleCandidates.get(norm);
  }

  function ensureChannelId(cid) {
    if (!channelIdCandidates.has(cid)) {
      channelIdCandidates.set(cid, {
        candidate_key: 'cid:' + cid,
        handle: null,
        candidate_type: 'channel_id',
        resolved_channel_id: cid,
        total_mentions: 0,
        distinct_sources: new Set(),
        hq_sources: new Set(),
        recent_sources: new Set(),
        title_collab_count: 0,
        description_mention_count: 0,
        thin_pool_hits: 0,
      });
    }
    return channelIdCandidates.get(cid);
  }

  function bufferEdge(candidateKey, sourceChannelId, sourceVideoId, evidenceType, evidenceText, sourceNiche, observedAt) {
    const count = edgeCounts.get(candidateKey) || 0;
    if (count >= MAX_EDGES_PER_CANDIDATE) return;
    edgeCounts.set(candidateKey, count + 1);
    edgeBuffer.push([candidateKey, sourceChannelId, sourceVideoId, evidenceType,
      (evidenceText || '').slice(0, 300), sourceNiche, observedAt]);
  }

  const totalVideos = db.get('SELECT COUNT(*) AS n FROM ingested_videos').n;
  console.log('[mineCreatorGraph] Scanning ' + totalVideos + ' videos...');

  const ninetyDaysAgo = new Date(Date.now() - NINETY_DAYS_MS).toISOString().slice(0, 10);
  let offset = 0;
  let processed = 0;
  let skippedNoContent = 0;

  while (true) {
    const rows = db.all(
      `SELECT youtube_video_id, channel_id, niche, title, description, published_at
       FROM ingested_videos ORDER BY youtube_video_id LIMIT ? OFFSET ?`,
      [BATCH_SIZE, offset],
    );
    if (rows.length === 0) break;
    offset   += rows.length;
    processed += rows.length;

    for (const row of rows) {
      const hasDesc  = row.description && row.description.length > 20;
      const hasTitle = row.title && row.title.length > 3;
      if (!hasDesc && !hasTitle) { skippedNoContent++; continue; }

      const isRecent = row.published_at && row.published_at >= ninetyDaysAgo;
      const isHighQ  = highQualitySources.has(row.channel_id);
      const isThin   = row.niche && thinNiches.has(row.niche);

      const descHandles      = hasDesc  ? extractHandles(row.description)          : [];
      const descChannelIds   = hasDesc  ? extractChannelIds(row.description)       : [];
      const titleHandles     = hasTitle ? extractHandles(row.title)                : [];
      const titleCollabHandles = hasTitle ? extractTitleCollabHandles(row.title)   : [];

      const collabSet   = new Set(titleCollabHandles);
      const allHandles  = new Set([...descHandles, ...titleHandles, ...titleCollabHandles]);

      for (const h of allHandles) {
        if (knownHandles.has(h)) continue;
        const c           = ensureHandle(h);
        const isDescMention = descHandles.includes(h);
        const isCollab    = collabSet.has(h);

        c.total_mentions++;
        c.distinct_sources.add(row.channel_id);
        if (isHighQ)   c.hq_sources.add(row.channel_id);
        if (isRecent)  c.recent_sources.add(row.channel_id);
        if (isCollab)  c.title_collab_count++;
        if (isDescMention) c.description_mention_count++;
        if (isThin)    c.thin_pool_hits++;

        const evidenceType = isCollab ? 'title_handle' : isDescMention ? 'description_handle' : 'title_mention';
        bufferEdge(c.candidate_key, row.channel_id, row.youtube_video_id,
          evidenceType, isCollab ? row.title : row.description, row.niche, row.published_at);
      }

      for (const cid of descChannelIds) {
        if (knownChannelIds.has(cid) || cid === row.channel_id) continue;
        const c = ensureChannelId(cid);
        c.total_mentions++;
        c.distinct_sources.add(row.channel_id);
        if (isHighQ)  c.hq_sources.add(row.channel_id);
        if (isRecent) c.recent_sources.add(row.channel_id);
        c.description_mention_count++;
        if (isThin)   c.thin_pool_hits++;
        bufferEdge(c.candidate_key, row.channel_id, row.youtube_video_id,
          'description_channel_id', null, row.niche, row.published_at);
      }
    }

    if (processed % 80000 === 0 || rows.length < BATCH_SIZE) {
      const elapsed = Math.round((Date.now() - t0) / 1000);
      console.log(`[mineCreatorGraph] ${processed}/${totalVideos} | ` +
        `handles=${handleCandidates.size} | channel_ids=${channelIdCandidates.size} | ${elapsed}s`);
    }
  }

  // --- Score all candidates ---
  const allCandidates = [...handleCandidates.values(), ...channelIdCandidates.values()].map(c => {
    const thinRel = c.thin_pool_hits > 0 ? Math.min(c.thin_pool_hits / c.total_mentions, 1.0) : 0;
    const flat = {
      ...c,
      distinct_source_channels: c.distinct_sources.size,
      distinct_hq_sources: c.hq_sources.size,
      distinct_recent_sources: c.recent_sources.size,
      thin_pool_relevance: thinRel,
    };
    flat.score = scoreCandidate(flat);
    return flat;
  }).sort((a, b) => b.score - a.score);

  // --- Write to DB ---
  let candidatesWritten = 0;
  let edgesWritten = 0;

  if (!dryRun) {
    console.log('[mineCreatorGraph] Writing ' + allCandidates.length + ' candidates...');

    const writeCandidates = db.transaction((batch) => {
      for (const c of batch) {
        db.run(
          `INSERT INTO creator_discovery_candidates
             (candidate_key, handle, candidate_type, score, total_mentions,
              distinct_source_channels, recent_mention_count, title_collab_count,
              description_mention_count, high_quality_source_count, thin_pool_relevance,
              status, resolved_channel_id, updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,'pending',?,datetime('now'))
           ON CONFLICT(candidate_key) DO UPDATE SET
             score                     = excluded.score,
             total_mentions            = excluded.total_mentions,
             distinct_source_channels  = excluded.distinct_source_channels,
             recent_mention_count      = excluded.recent_mention_count,
             title_collab_count        = excluded.title_collab_count,
             description_mention_count = excluded.description_mention_count,
             high_quality_source_count = excluded.high_quality_source_count,
             thin_pool_relevance       = excluded.thin_pool_relevance,
             updated_at                = datetime('now')
           WHERE creator_discovery_candidates.status = 'pending'`,
          [c.candidate_key, c.handle, c.candidate_type, c.score, c.total_mentions,
           c.distinct_source_channels, c.distinct_recent_sources, c.title_collab_count,
           c.description_mention_count, c.distinct_hq_sources, c.thin_pool_relevance,
           c.resolved_channel_id || null],
        );
        candidatesWritten++;
      }
    });

    for (let i = 0; i < allCandidates.length; i += 2000) {
      writeCandidates(allCandidates.slice(i, i + 2000));
    }

    console.log('[mineCreatorGraph] Writing ' + edgeBuffer.length + ' edges...');
    const writeEdges = db.transaction((batch) => {
      for (const e of batch) {
        db.run(
          `INSERT OR IGNORE INTO creator_discovery_edges
             (candidate_key, source_channel_id, source_video_id, evidence_type,
              evidence_text, source_niche, observed_at)
           VALUES (?,?,?,?,?,?,?)`,
          e,
        );
        edgesWritten++;
      }
    });
    for (let i = 0; i < edgeBuffer.length; i += 5000) {
      writeEdges(edgeBuffer.slice(i, i + 5000));
    }
  }

  // --- Report ---
  const elapsed = Math.round((Date.now() - t0) / 1000);
  const highScore   = allCandidates.filter(c => c.score >= 100).length;
  const medScore    = allCandidates.filter(c => c.score >= 40 && c.score < 100).length;
  const lowScore    = allCandidates.filter(c => c.score < 40).length;
  const multiSource = allCandidates.filter(c => c.distinct_source_channels >= 3).length;
  const collabCands = allCandidates.filter(c => c.title_collab_count > 0).length;
  const hqCands     = allCandidates.filter(c => c.distinct_hq_sources >= 2).length;
  const cidCands    = allCandidates.filter(c => c.candidate_type === 'channel_id').length;

  console.log('\n========== CREATOR GRAPH MINING REPORT ==========');
  console.log('videos_scanned:           ', processed);
  console.log('skipped_no_content:       ', skippedNoContent);
  console.log('elapsed_seconds:          ', elapsed);
  console.log('');
  console.log('--- Candidate counts ---');
  console.log('handle_candidates:        ', handleCandidates.size);
  console.log('channel_id_candidates:    ', cidCands);
  console.log('total_novel_candidates:   ', allCandidates.length);
  console.log('');
  console.log('--- Score distribution ---');
  console.log('score >= 100 (high):      ', highScore);
  console.log('score 40-99  (medium):    ', medScore);
  console.log('score <  40  (low):       ', lowScore);
  console.log('');
  console.log('--- Signal quality ---');
  console.log('distinct_sources >= 3:    ', multiSource);
  console.log('has_title_collab:         ', collabCands);
  console.log('distinct_hq_sources >= 2: ', hqCands);
  console.log('');
  console.log('--- Top 50 candidates by score ---');
  console.log('rank | score  | type    | key                            | dsc | ttl | hq  | rec | col');
  console.log('-----|--------|---------|--------------------------------|-----|-----|-----|-----|----');
  allCandidates.slice(0, 50).forEach((c, i) => {
    const key   = c.candidate_key.slice(0, 32).padEnd(32);
    const score = String(Math.round(c.score)).padStart(6);
    const type  = (c.candidate_type || 'handle').slice(0, 7).padEnd(7);
    console.log(
      String(i + 1).padStart(4), '|', score, '|', type, '|', key, '|',
      String(c.distinct_source_channels).padStart(3), '|',
      String(c.total_mentions).padStart(3), '|',
      String(c.distinct_hq_sources).padStart(3), '|',
      String(c.distinct_recent_sources).padStart(3), '|',
      String(c.title_collab_count).padStart(3),
    );
  });

  if (!dryRun) {
    console.log('');
    console.log('candidates_written:       ', candidatesWritten);
    console.log('edges_written:            ', edgesWritten);
  } else {
    console.log('\n[DRY RUN] Nothing written to DB.');
  }
  console.log('=================================================\n');
}

function printReport(db) {
  const total = db.get(`SELECT COUNT(*) AS n FROM creator_discovery_candidates`)?.n || 0;
  if (total === 0) { console.log('No candidates in DB yet.'); return; }
  const rows = db.all(`
    SELECT candidate_key, candidate_type, score, distinct_source_channels,
           total_mentions, high_quality_source_count, recent_mention_count,
           title_collab_count, status
    FROM creator_discovery_candidates ORDER BY score DESC LIMIT 50
  `);
  console.log('total_candidates_in_db:', total);
  rows.forEach((r, i) => {
    console.log(String(i + 1).padStart(4), '|', String(Math.round(r.score)).padStart(6), '|',
      (r.candidate_type || 'handle').slice(0, 7).padEnd(7), '|',
      r.candidate_key.slice(0, 32).padEnd(32), '|',
      String(r.distinct_source_channels).padStart(3), '|',
      String(r.total_mentions).padStart(3), '|', r.status);
  });
}

main().catch(e => { console.error('[mineCreatorGraph] Fatal:', e); process.exit(1); });

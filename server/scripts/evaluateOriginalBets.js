'use strict';

// Phase DNA-5: evaluate Original Bets against held-out recent uploads.
//
// Usage:
//   node server/scripts/evaluateOriginalBets.js --limit 50
//   node server/scripts/evaluateOriginalBets.js --limit 100 --holdout 10 --train 40
//   node server/scripts/evaluateOriginalBets.js --dry-run --limit 20

const { getDb } = require('../db/init');
const {
  buildCreatorIdeaDnaFromVideos,
  extractVideoDnaSignal,
} = require('../services/creatorIdeaDna');
const {
  buildOriginalBetsFromDna,
  overlapRatio,
} = require('../services/originalBets');

const CONFIDENCE_RANK = { low: 0, medium: 1, high: 2 };

function argValue(name, fallback = null) {
  const exact = process.argv.indexOf(name);
  if (exact !== -1 && exact + 1 < process.argv.length) return process.argv[exact + 1];
  const prefix = `${name}=`;
  const found = process.argv.find(arg => arg.startsWith(prefix));
  if (found) return found.slice(prefix.length);
  return fallback;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function toInt(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function round(value, places = 3) {
  const factor = 10 ** places;
  return Math.round((Number(value) || 0) * factor) / factor;
}

function median(values) {
  const nums = values.map(Number).filter(v => Number.isFinite(v) && v > 0).sort((a, b) => a - b);
  if (!nums.length) return 0;
  const mid = Math.floor(nums.length / 2);
  return nums.length % 2 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2;
}

function setOverlapRatio(a, b) {
  const aSet = new Set((a || []).filter(Boolean));
  const bSet = new Set((b || []).filter(Boolean));
  if (!aSet.size || !bSet.size) return 0;
  let overlap = 0;
  for (const value of aSet) {
    if (bSet.has(value)) overlap++;
  }
  return overlap / Math.min(aSet.size, bSet.size);
}

function selectEvaluationChannels(db, options) {
  const minVideos = options.holdoutCount + options.trainCount;
  const rows = db.all(
    `SELECT ic.channel_id, ic.channel_name, ic.channel_subscribers,
            ic.niche, ic.primary_language, ic.region,
            cid.confidence AS cached_dna_confidence,
            cid.confidence_score AS cached_dna_confidence_score,
            ccsp.primary_csp, ccsp.confidence AS csp_confidence,
            cid.sample_count AS video_count
       FROM ingested_channels ic
       JOIN creator_idea_dna cid ON cid.channel_id = ic.channel_id
       LEFT JOIN channel_content_strategy_profiles ccsp ON ccsp.channel_id = ic.channel_id
      WHERE ic.ingest_enabled = 1
        AND cid.sample_count >= ?
      ORDER BY COALESCE(cid.confidence_score, 0) DESC, ic.channel_subscribers DESC
      LIMIT ?`,
    [minVideos, Math.max(options.channelLimit * 4, options.channelLimit)],
  );

  const minRank = CONFIDENCE_RANK[options.minConfidence] ?? CONFIDENCE_RANK.medium;
  return rows
    .filter(row => (CONFIDENCE_RANK[row.cached_dna_confidence] ?? 0) >= minRank)
    .slice(0, options.channelLimit);
}

function fetchVideos(db, channelId, limit) {
  return db.all(
    `SELECT youtube_video_id, channel_id, title, published_at, views,
            duration_seconds, is_short, format_type
       FROM ingested_videos
      WHERE channel_id = ?
        AND title IS NOT NULL
        AND title != ''
      ORDER BY datetime(published_at) DESC
      LIMIT ?`,
    [channelId, limit],
  );
}

function successfulHoldoutVideos(holdout, train) {
  const trainMedian = median(train.map(v => v.views));
  const withViews = holdout.filter(v => Number(v.views || 0) > 0);
  const winners = withViews.filter(v => {
    if (!trainMedian) return true;
    return Number(v.views || 0) >= trainMedian;
  });
  if (winners.length) return winners;
  return [...(withViews.length ? withViews : holdout)]
    .sort((a, b) => (Number(b.views || 0) - Number(a.views || 0)))
    .slice(0, Math.max(1, Math.ceil(holdout.length / 2)));
}

function bestHoldoutMatch(idea, holdout) {
  const ideaDomains = idea?.dna_evidence?.domains || [];
  let best = null;

  for (const video of holdout) {
    const lexical = overlapRatio(idea.topic, video.title);
    const signal = extractVideoDnaSignal(video);
    const domain = setOverlapRatio(ideaDomains, signal.domain_tags);
    const score = (lexical * 0.7) + (domain * 0.3);
    if (!best || score > best.score) {
      best = { video, lexical, domain, score };
    }
  }

  if (!best) {
    return {
      title: null,
      video_id: null,
      views: null,
      lexical_overlap: 0,
      domain_overlap: 0,
      hit: 0,
    };
  }

  const hit = best.lexical >= 0.28 || (best.lexical >= 0.16 && best.domain >= 0.34);
  return {
    title: best.video.title,
    video_id: best.video.youtube_video_id,
    views: Number(best.video.views || 0),
    lexical_overlap: round(best.lexical, 4),
    domain_overlap: round(best.domain, 4),
    hit: hit ? 1 : 0,
  };
}

function insertEvaluationItem(db, runId, channel, idea, match, metadata) {
  db.run(
    `INSERT INTO original_bet_evaluation_items (
       run_id, channel_id, channel_name, idea_key, topic,
       best_match_title, best_match_video_id, best_match_views,
       lexical_overlap, domain_overlap, hit, metadata_json, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
    [
      runId,
      channel.channel_id,
      channel.channel_name,
      idea.idea_key,
      idea.topic,
      match.title,
      match.video_id,
      match.views,
      match.lexical_overlap,
      match.domain_overlap,
      match.hit,
      JSON.stringify(metadata),
    ],
  );
}

function main() {
  const options = {
    channelLimit: toInt(argValue('--limit'), 50),
    holdoutCount: toInt(argValue('--holdout'), 10),
    trainCount: toInt(argValue('--train'), 40),
    ideasPerChannel: toInt(argValue('--ideas'), 6),
    minConfidence: String(argValue('--min-confidence', 'medium')).toLowerCase(),
    dryRun: hasFlag('--dry-run'),
  };

  const db = getDb();
  const channels = selectEvaluationChannels(db, options);
  const runLabel = `original_bets_eval_${new Date().toISOString()}`;
  const runInfo = options.dryRun ? null : db.run(
    `INSERT INTO original_bet_evaluation_runs (
       run_label, channel_limit, holdout_count, train_count, min_confidence, metrics_json, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`,
    [
      runLabel,
      options.channelLimit,
      options.holdoutCount,
      options.trainCount,
      options.minConfidence,
      JSON.stringify({ status: 'running' }),
    ],
  );
  const runId = runInfo?.lastInsertRowid || null;

  console.log('\n=== Original Bets Held-out Evaluation ===');
  console.log(`Run          : ${options.dryRun ? 'dry-run' : runId}`);
  console.log(`Channels     : ${channels.length}/${options.channelLimit}`);
  console.log(`Holdout/train: ${options.holdoutCount}/${options.trainCount}`);
  console.log(`Min confidence: ${options.minConfidence}`);

  const totals = {
    channels_considered: channels.length,
    channels_evaluated: 0,
    skipped_no_videos: 0,
    skipped_low_train_confidence: 0,
    skipped_no_ideas: 0,
    ideas: 0,
    hits: 0,
    lexical_sum: 0,
    domain_sum: 0,
  };

  for (const channel of channels) {
    const videos = fetchVideos(db, channel.channel_id, options.holdoutCount + options.trainCount);
    const holdout = videos.slice(0, options.holdoutCount);
    const train = videos.slice(options.holdoutCount, options.holdoutCount + options.trainCount);
    if (holdout.length < Math.max(3, Math.floor(options.holdoutCount / 2)) || train.length < 10) {
      totals.skipped_no_videos++;
      continue;
    }

    const dna = buildCreatorIdeaDnaFromVideos(channel, train, { limit: options.trainCount });
    const minRank = CONFIDENCE_RANK[options.minConfidence] ?? CONFIDENCE_RANK.medium;
    if ((CONFIDENCE_RANK[dna.confidence] ?? 0) < minRank) {
      totals.skipped_low_train_confidence++;
      continue;
    }

    const bets = buildOriginalBetsFromDna(db, channel.channel_id, dna, {
      limit: options.ideasPerChannel,
      ownTitles: train,
    });
    const ideas = bets.ideas || [];
    if (!ideas.length) {
      totals.skipped_no_ideas++;
      continue;
    }

    const successfulHoldout = successfulHoldoutVideos(holdout, train);
    totals.channels_evaluated++;

    for (const idea of ideas) {
      const match = bestHoldoutMatch(idea, successfulHoldout);
      totals.ideas++;
      totals.hits += match.hit;
      totals.lexical_sum += match.lexical_overlap;
      totals.domain_sum += match.domain_overlap;

      if (!options.dryRun) {
        insertEvaluationItem(db, runId, channel, idea, match, {
          generated_from: 'heldout_train_window',
          train_count: train.length,
          holdout_count: holdout.length,
          successful_holdout_count: successfulHoldout.length,
          dna_confidence: dna.confidence,
          dna_confidence_score: dna.confidence_score,
          idea_score: idea.score,
          idea_archetype: idea.dna_evidence?.archetype || null,
        });
      }
    }
  }

  const metrics = {
    ...totals,
    hit_rate: totals.ideas ? round(totals.hits / totals.ideas, 4) : 0,
    avg_lexical_overlap: totals.ideas ? round(totals.lexical_sum / totals.ideas, 4) : 0,
    avg_domain_overlap: totals.ideas ? round(totals.domain_sum / totals.ideas, 4) : 0,
    completed_at: new Date().toISOString(),
  };

  if (!options.dryRun) {
    db.run(
      `UPDATE original_bet_evaluation_runs SET metrics_json = ? WHERE id = ?`,
      [JSON.stringify(metrics), runId],
    );
  }

  console.log(`[done] evaluated_channels=${metrics.channels_evaluated} ideas=${metrics.ideas} hits=${metrics.hits}`);
  console.log(`[metrics] hit_rate=${metrics.hit_rate} avg_lexical=${metrics.avg_lexical_overlap} avg_domain=${metrics.avg_domain_overlap}`);
  console.log(`[skips] no_videos=${metrics.skipped_no_videos} low_train_conf=${metrics.skipped_low_train_confidence} no_ideas=${metrics.skipped_no_ideas}`);
}

try {
  main();
} catch (e) {
  console.error('[evaluate-original-bets] Fatal:', e.stack || e.message);
  process.exitCode = 1;
}

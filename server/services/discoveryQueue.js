const crypto = require('crypto');
const { getDb }               = require('../db/init');
const { discoverFromSeed, fetchChannelTitles } = require('./discoveryFetcher');
const quotaGuard = require('./quotaGuard');
const { getApiKey } = require('./apiKeyManager');
const { classifyChannel }     = require('./channelClassifier');
const { computeDiversityScore } = require('./diversityScorer');
const { assessDuplicateRisk } = require('./duplicateDetector');
const { insertDiscoveredChannel, getAllIngestedChannels } = require('../db/queries');

// In-memory job store: jobId → job object
const jobs = new Map();

function createJob(seedInput, options = {}) {
  const id = crypto.randomUUID();
  jobs.set(id, {
    id,
    seed_input:  seedInput,
    status:      'queued',
    progress:    { stage: 'queued', found: 0, classified: 0, saved: 0 },
    result:      null,
    error:       null,
    started_at:  new Date().toISOString(),
    finished_at: null,
    options,
  });
  return id;
}

function getJob(id) {
  return jobs.get(id) ?? null;
}

function getAllJobs() {
  return [...jobs.values()].sort((a, b) => b.started_at.localeCompare(a.started_at));
}

function updateJob(id, patch) {
  const job = jobs.get(id);
  if (job) jobs.set(id, { ...job, ...patch });
}

// Run a discovery job asynchronously
async function runDiscoveryJob(jobId) {
  const job = jobs.get(jobId);
  if (!job) return;

  updateJob(jobId, { status: 'running', progress: { stage: 'fetching', found: 0, classified: 0, saved: 0 } });

  try {
    const db = getDb();

    // 1. Fetch candidates from YouTube API
    const { seed, candidates, topics_used } = await discoverFromSeed(
      job.seed_input,
      { topicsOverride: job.options.topics ?? null },
    );

    updateJob(jobId, { progress: { stage: 'classifying', found: candidates.length, classified: 0, saved: 0 } });

    // 2. Get existing ingested channels for diversity scoring
    const ingestedChannels = getAllIngestedChannels(db);

    const runId    = crypto.randomUUID();
    let saved      = 0;
    let classified = 0;
    const skipped  = [];

    // 3. For each candidate: check duplicates, classify, score diversity, save
    for (const candidate of candidates) {
      const dupRisk = assessDuplicateRisk(db, candidate.channel_id);

      // Skip channels already in ingested_channels (high risk = already being used)
      if (dupRisk === 'high') {
        skipped.push({ channel_id: candidate.channel_id, reason: 'already_ingested' });
        continue;
      }
      // Still insert medium-risk ones so operator can see them with a warning badge
      // (they may have been previously rejected — operator can re-review)

      // Classify using existing semantic identity system
      // Featured channels get real title fetch; search results use name-based surrogate
      let identity = {};
      try {
        let titles = [];
        if (candidate.discovery_source === 'featured_channels' && quotaGuard.quotaAvailable()) {
          try {
            quotaGuard.recordUsage(1, 'ingest');
            const qs  = new URLSearchParams({ part: 'contentDetails', id: candidate.channel_id, key: getApiKey('discovery') }).toString();
            const res = await fetch(`https://www.googleapis.com/youtube/v3/channels?${qs}`);
            const chData = await res.json();
            const uploadsId = chData.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
            if (uploadsId) titles = await fetchChannelTitles(uploadsId, 20);
          } catch (_) {}
        }
        // Fall back to channel name as surrogate if no titles
        if (!titles.length) titles = [candidate.title, `${candidate.title} videos`, `${candidate.title} channel`];

        identity = await classifyChannel({ channelName: candidate.title, titles });
        classified++;
      } catch (_) {
        // Classification failure is non-fatal
      }

      const diversityScore = identity.primary_niche
        ? computeDiversityScore(
            { primary_niche: identity.primary_niche, content_archetype: identity.content_archetype },
            ingestedChannels,
          )
        : 0;

      // Confidence: higher for featured channels, lower for broad search
      const confidence = candidate.discovery_source === 'featured_channels' ? 0.8
        : candidate.discovery_source === 'topic_search' ? 0.55
        : 0.4;

      try {
        insertDiscoveredChannel(db, {
          id:                         crypto.randomUUID(),
          channel_id:                 candidate.channel_id,
          title:                      candidate.title,
          handle:                     candidate.handle,
          thumbnail_url:              candidate.thumbnail_url,
          subscriber_count:           candidate.subscriber_count,
          video_count:                candidate.video_count,
          discovery_source:           candidate.discovery_source,
          discovered_from_channel_id: candidate.discovered_from_channel_id,
          discovery_run_id:           runId,
          discovery_depth:            1,
          discovery_confidence:       confidence,
          duplicate_risk:             dupRisk,
          diversity_score:            diversityScore,
          titles_sample:              [],
          ...identity,
        });
        saved++;
      } catch (_) {}

      updateJob(jobId, {
        progress: { stage: 'classifying', found: candidates.length, classified, saved },
      });
    }

    updateJob(jobId, {
      status:      'complete',
      finished_at: new Date().toISOString(),
      progress:    { stage: 'complete', found: candidates.length, classified, saved },
      result: {
        run_id:       runId,
        seed_channel: seed,
        topics_used,
        found:        candidates.length,
        classified,
        saved,
        skipped:      skipped.length,
      },
    });
  } catch (e) {
    updateJob(jobId, {
      status:      'error',
      finished_at: new Date().toISOString(),
      error:       e.message,
    });
    console.error('[discovery] Job failed:', e.message);
  }
}

// Start a job and run it in the background (non-blocking)
function enqueueDiscovery(seedInput, options = {}) {
  const jobId = createJob(seedInput, options);
  setImmediate(() => runDiscoveryJob(jobId));
  return jobId;
}

// Prune jobs older than 2 hours to avoid unbounded memory growth
function pruneOldJobs() {
  const cutoff = Date.now() - 2 * 3600 * 1000;
  for (const [id, job] of jobs) {
    if (new Date(job.started_at).getTime() < cutoff) jobs.delete(id);
  }
}
setInterval(pruneOldJobs, 30 * 60 * 1000);

module.exports = { enqueueDiscovery, getJob, getAllJobs };

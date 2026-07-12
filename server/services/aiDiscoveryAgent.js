'use strict';

/**
 * AI Discovery Agent — Phase XIII Semantic Diversity Expansion
 *
 * Uses OpenAI gpt-4o-mini to suggest semantically diverse YouTube creators,
 * validates them via YouTube channels.list, evaluates recent semantic identity,
 * and admits qualifying channels to the corpus in probation state.
 *
 * GOVERNANCE PRINCIPLE:
 * AI suggests. Governance decides.
 * No AI-discovered channel influences recommendations, validator scoring,
 * or semantic priors until it passes quality + probation + trust gating.
 *
 * ARCHITECTURE:
 * Intentionally isolated from discoveryAgent.js.
 * Different economics, failure modes, observability, and governance.
 */

const crypto = require('crypto');
const {
  getArchetypeDensity,
  calculateSemanticNovelty,
} = require('./diversityPressureEngine');
const {
  upsertCorpusChannel,
  getCorpusChannel,
  upsertDiscoveryEdge,
} = require('../db/corpusQueries');
const quotaGuard = require('./quotaGuard');

const OPENAI_MODEL = 'gpt-4o-mini';
const YT_BASE      = 'https://www.googleapis.com/youtube/v3';

// ── Utilities ─────────────────────────────────────────────────────────────────

function getOpenAI() {
  const OpenAI = require('openai');
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

const { getApiKey, markExhausted, isQuotaError } = require('./apiKeyManager');

async function ytFetch(endpoint, params) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const key = getApiKey('discovery');
    if (!key) throw new Error('all_api_keys_exhausted');
    const url = new URL(`${YT_BASE}/${endpoint}`);
    url.searchParams.set('key', key);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    const resp = await fetch(url.toString());
    const data = await resp.json();
    if (!resp.ok) {
      const msg = data?.error?.message || `YouTube ${resp.status}`;
      if (isQuotaError(msg)) { markExhausted(key); continue; }
      throw new Error(msg);
    }
    return data;
  }
  throw new Error('all_api_keys_exhausted');
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Creator size classification ───────────────────────────────────────────────

function classifyCreatorSize(subscriberCount) {
  const s = subscriberCount ?? 0;
  if (s >= 10_000_000) return 'mega';
  if (s >= 1_000_000)  return 'large';
  if (s >= 100_000)    return 'medium';
  if (s >= 10_000)     return 'small';
  return 'emerging';
}

// ── Prompt construction ───────────────────────────────────────────────────────

function buildDiversityAwarePrompt(db, niche, { region, language, sizeFocus, temporalFocus } = {}) {
  // Inject current topology density so the model avoids amplifying dominant niches
  const density = getArchetypeDensity(db);
  const dominantNiches = Object.entries(density)
    .filter(([, v]) => v.density > 0.15)
    .sort(([, a], [, b]) => b.density - a.density)
    .slice(0, 5)
    .map(([n, v]) => `${n} (${Math.round(v.density * 100)}%)`)
    .join(', ');

  // Existing channels in this niche — tell the model to avoid repeating them
  const existingTitles = db.all(
    `SELECT title FROM corpus_channels WHERE niche = ? AND title IS NOT NULL LIMIT 15`,
    [niche],
  ).map(r => r.title).join(', ');

  const topologyContext = dominantNiches
    ? `\nThe corpus is currently overweight in: ${dominantNiches}.\nDo NOT amplify these archetypes further.\n`
    : '';

  const existingContext = existingTitles
    ? `\nAlready represented (avoid duplicating their style or audience overlap): ${existingTitles}.\n`
    : '';

  const regionalContext = region
    ? `\nFocus on creators from: ${region}.${language ? ` Prefer ${language}-language content.` : ''}`
    : '';

  const sizeContext = sizeFocus
    ? `\nPrioritize creator scale: ${{
        emerging: 'very new or small channels under 50K subscribers',
        small:    'small channels 10K–100K subscribers',
        medium:   'mid-sized channels 100K–1M subscribers',
        mixed:    'a mix of small, medium, and large creators',
      }[sizeFocus] ?? sizeFocus}.`
    : '';

  const temporalContext = temporalFocus === 'emerging'
    ? '\nFocus on: recently active or emerging creators from the last 2 years, not legacy channels.'
    : '';

  return `You are helping build a semantically diverse YouTube content research corpus.

Suggest exactly 15 YouTube channel handles (each starting with @) for the "${niche}" niche.
${topologyContext}${existingContext}${regionalContext}${sizeContext}${temporalContext}
Prioritize:
- Creators with distinct rhetorical styles not already represented
- Calm authority, reflective storytelling, analytical depth
- Emotionally nuanced, low-spectacle, non-viral-optimized formats
- Culturally diverse or internationally-based perspectives
- Underrepresented persuasion structures and pacing styles
- Mid-sized and emerging creators alongside established ones

Avoid:
- The most famous or algorithmically dominant creators in this niche
- Creators whose style is indistinguishable from mainstream viral content
- Channels primarily optimized for shock, outrage, or spectacle

Return ONLY 15 YouTube handles, one per line, starting with @.
No explanations, numbers, bullet points, or other text.`;
}

// ── AI suggestion ─────────────────────────────────────────────────────────────

async function suggestChannels(db, niche, opts = {}) {
  if (!process.env.OPENAI_API_KEY) {
    console.warn('[aiDiscovery] OPENAI_API_KEY not configured — skipping');
    return [];
  }

  const prompt = buildDiversityAwarePrompt(db, niche, opts);

  try {
    const openai = getOpenAI();
    const response = await openai.chat.completions.create({
      model:       OPENAI_MODEL,
      messages:    [{ role: 'user', content: prompt }],
      temperature: 0.8,
      max_tokens:  350,
    });

    const text = response.choices[0]?.message?.content ?? '';
    const handles = text
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.startsWith('@'))
      .map(line => line.split(/\s/)[0]) // strip anything after handle
      .filter(h => /^@[a-zA-Z0-9._-]{1,100}$/.test(h))
      .slice(0, 15);

    console.log(`[aiDiscovery] GPT suggested ${handles.length} handles for "${niche}"${opts.region ? ` (${opts.region})` : ''}`);
    return handles;
  } catch (e) {
    console.warn('[aiDiscovery] OpenAI call failed:', e.message);
    return [];
  }
}

// ── YouTube validation ────────────────────────────────────────────────────────

async function validateSuggestions(db, handles) {
  if (!handles.length || !getApiKey('discovery')) return [];

  const results = [];
  for (const handle of handles) {
    if (!quotaGuard.quotaAvailable(1)) break;

    try {
      quotaGuard.recordUsage(1, 'corpus_ai_discovery');
      const data = await ytFetch('channels', {
        part:      'snippet,statistics,contentDetails',
        forHandle: handle,
      });

      const item = data.items?.[0];
      if (!item) {
        results.push({ handle, valid: false, reason: 'not_found' });
      } else {
        results.push({
          handle,
          valid:              true,
          channel_id:         item.id,
          title:              item.snippet?.title ?? handle,
          subscriber_count:   parseInt(item.statistics?.subscriberCount   ?? '0', 10),
          video_count:        parseInt(item.statistics?.videoCount         ?? '0', 10),
          total_views:        parseInt(item.statistics?.viewCount          ?? '0', 10),
          uploads_playlist_id: item.contentDetails?.relatedPlaylists?.uploads ?? null,
          already_in_corpus:  !!getCorpusChannel(db, item.id),
          raw:                item,
        });
      }
    } catch (e) {
      results.push({ handle, valid: false, reason: e.message });
    }

    await sleep(120);
  }

  return results;
}

// ── Recent semantic identity check ────────────────────────────────────────────

async function evaluateRecentSemanticIdentity(uploadsPlaylistId) {
  if (!uploadsPlaylistId)          return { pass: false, reason: 'no_uploads_playlist' };
  if (!quotaGuard.quotaAvailable(1)) return { pass: false, reason: 'quota_exhausted' };

  try {
    quotaGuard.recordUsage(1, 'corpus_ai_discovery');
    const data = await ytFetch('playlistItems', {
      part:       'contentDetails,snippet',
      playlistId: uploadsPlaylistId,
      maxResults: 20,
    });

    const items = data.items ?? [];
    if (!items.length) return { pass: false, reason: 'no_videos' };

    // Recency gate: last upload within 90 days
    const lastPublished  = items[0]?.snippet?.publishedAt;
    const daysSinceLast  = lastPublished
      ? (Date.now() - new Date(lastPublished).getTime()) / 86_400_000
      : 999;
    if (daysSinceLast > 90) {
      return { pass: false, reason: 'abandoned', days_since_last_upload: Math.round(daysSinceLast) };
    }

    // Cadence gate: at least 5 uploads in last 6 months
    const sixMonthsAgo  = new Date(Date.now() - 180 * 86_400_000);
    const recentUploads = items.filter(i => {
      const pub = i.snippet?.publishedAt;
      return pub && new Date(pub) > sixMonthsAgo;
    });
    if (recentUploads.length < 5) {
      return { pass: false, reason: 'low_cadence', recent_uploads: recentUploads.length };
    }

    // Coherence gate: titles must not be garbage or chaotic
    const titles = items.map(i => i.snippet?.title ?? '').filter(Boolean);
    const avgLen = titles.reduce((s, t) => s + t.length, 0) / titles.length;
    if (avgLen < 5) return { pass: false, reason: 'garbage_titles' };

    // Title length coefficient of variation — extreme scatter = chaotic/spam
    const lens    = titles.map(t => t.length);
    const mean    = lens.reduce((a, b) => a + b, 0) / lens.length;
    const variance = lens.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / lens.length;
    const cv      = mean > 0 ? Math.sqrt(variance) / mean : 0;
    if (cv > 3.0) return { pass: false, reason: 'chaotic_titles', title_cv: +cv.toFixed(2) };

    const videoIds = items.map(i => i.contentDetails?.videoId).filter(Boolean);

    return {
      pass:                true,
      recent_uploads:      recentUploads.length,
      days_since_last_upload: Math.round(daysSinceLast),
      avg_title_length:    Math.round(avgLen),
      title_cv:            +cv.toFixed(2),
      recent_titles:       titles.slice(0, 10),
      video_ids:           videoIds.slice(0, 20),
    };
  } catch (e) {
    if (e.message === 'quota_exhausted') return { pass: false, reason: 'quota_exhausted' };
    return { pass: false, reason: e.message };
  }
}

// ── Corpus admission ──────────────────────────────────────────────────────────

function admitToCorpus(db, channel, { noveltyScore, sizeTier, niche }) {
  const snippet = channel.raw?.snippet ?? {};

  upsertCorpusChannel(db, {
    channel_id:          channel.channel_id,
    title:               channel.title,
    handle:              snippet.customUrl?.replace(/^@/, '').toLowerCase() ?? null,
    thumbnail_url:       snippet.thumbnails?.high?.url ?? snippet.thumbnails?.default?.url ?? null,
    uploads_playlist_id: channel.uploads_playlist_id ?? null,
    niche:               niche ?? null,
    language:            snippet.defaultLanguage ?? null,
    country:             snippet.country ?? null,
    subscriber_count:    channel.subscriber_count ?? 0,
    total_views:         channel.total_views ?? 0,
    video_count:         channel.video_count ?? 0,
    last_ingested_at:    new Date().toISOString(),
    ingest_depth:        0,
    discovery_source:    'ai_discovery',
    raw_json:            channel.raw,
  });

  // Set probation + governance scores
  db.run(
    `UPDATE corpus_channels
     SET probation_state        = 1,
         probation_started_at   = COALESCE(probation_started_at, datetime('now')),
         creator_size_tier      = ?,
         semantic_novelty_score = ?,
         updated_at             = datetime('now')
     WHERE channel_id = ?`,
    [sizeTier, noveltyScore, channel.channel_id],
  );

  upsertDiscoveryEdge(db, {
    source_channel_id: 'ai_discovery',
    target_channel_id: channel.channel_id,
    relationship_type: 'ai_suggested',
    confidence:        0.5,
    discovered_via:    'openai_gpt4o_mini',
  });
}

// ── Discovery log ─────────────────────────────────────────────────────────────

function logDiscovery(db, row) {
  try {
    db.run(
      `INSERT INTO ai_discovery_log
         (id, run_id, handle, channel_id, niche, region, suggestion_status,
          validation_status, admission_status, rejection_reason,
          novelty_score, creator_size_tier, hallucinated, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'))`,
      [
        crypto.randomUUID(), row.run_id, row.handle, row.channel_id ?? null,
        row.niche, row.region ?? null, row.suggestion_status,
        row.validation_status ?? null, row.admission_status ?? null,
        row.rejection_reason ?? null, row.novelty_score ?? null,
        row.creator_size_tier ?? null, row.hallucinated ? 1 : 0,
      ],
    );
  } catch (_) {}
}

// ── Niche selection ───────────────────────────────────────────────────────────

function getNichesNeedingDiversity(db, limit = 3) {
  // Prioritize niches with low novelty scores or sparse training coverage
  const rows = db.all(
    `SELECT niche,
            COUNT(*) AS total,
            AVG(COALESCE(semantic_novelty_score, 50)) AS avg_novelty,
            SUM(training_eligible) AS trained
     FROM corpus_channels
     WHERE niche IS NOT NULL
     GROUP BY niche
     ORDER BY avg_novelty ASC, trained ASC
     LIMIT ?`,
    [limit],
  );
  return rows.map(r => r.niche);
}

// ── Regional targets ──────────────────────────────────────────────────────────

const REGIONAL_EXPANSION_TARGETS = [
  { region: 'India',         language: 'Hindi',    niche: 'education' },
  { region: 'India',         language: 'English',  niche: 'technology' },
  { region: 'Japan',         language: 'Japanese', niche: 'technology' },
  { region: 'South Korea',   language: 'Korean',   niche: 'lifestyle' },
  { region: 'Latin America', language: 'Spanish',  niche: 'finance' },
  { region: 'Brazil',        language: 'Portuguese', niche: 'education' },
  { region: 'Middle East',   language: 'Arabic',   niche: 'education' },
  { region: 'Germany',       language: 'German',   niche: 'technology' },
];

// ── Main cycle ────────────────────────────────────────────────────────────────

async function runAIDiscoveryCycle(db, {
  niches             = null,
  maxNiches          = 3,
  sizeFocus          = null,
  temporalFocus      = null,
  allowCulturalExpansion = false,
  maxQuota           = 60,
} = {}) {
  if (!process.env.OPENAI_API_KEY) {
    return { skipped: true, reason: 'no_openai_key' };
  }
  if (!getApiKey('discovery')) {
    return { skipped: true, reason: 'no_yt_api_key' };
  }

  const run_id  = crypto.randomUUID();
  const summary = {
    run_id,
    niches_processed:  0,
    suggested:         0,
    validated:         0,
    already_in_corpus: 0,
    admitted:          0,
    rejected:          0,
    hallucinations:    0,
    quota_used:        0,
  };

  let quotaUsed = 0;
  function quotaLeft() { return maxQuota - quotaUsed; }
  function canSpend(n) { return quotaUsed + n <= maxQuota && quotaGuard.quotaAvailable(n); }

  // Build target list
  const targetNiches = niches ?? getNichesNeedingDiversity(db, maxNiches);
  const targets = targetNiches.map(niche => ({ niche, region: null, language: null, sizeFocus, temporalFocus }));

  if (allowCulturalExpansion) {
    // Pick one regional target per cycle (random rotation prevents pattern lock-in)
    const pick = REGIONAL_EXPANSION_TARGETS[Math.floor(Math.random() * REGIONAL_EXPANSION_TARGETS.length)];
    targets.push({ ...pick, sizeFocus: 'medium', temporalFocus: null });
  }

  for (const target of targets) {
    if (!canSpend(5)) break; // need headroom for at least one validation pass

    const { niche, region, language, sizeFocus: sf, temporalFocus: tf } = target;

    // ── 1. AI suggestion (no quota cost, just OpenAI tokens) ─────────────────
    const handles = await suggestChannels(db, niche, { region, language, sizeFocus: sf, temporalFocus: tf });
    summary.suggested += handles.length;
    summary.niches_processed++;

    if (!handles.length) continue;

    // ── 2. YouTube validation ─────────────────────────────────────────────────
    const validated = await validateSuggestions(db, handles);
    const validationQuota = validated.length;
    quotaUsed     += validationQuota;
    summary.quota_used += validationQuota;

    for (const v of validated) {
      if (!v.valid) {
        summary.hallucinations++;
        logDiscovery(db, {
          run_id, handle: v.handle, niche, region,
          suggestion_status: 'suggested', validation_status: 'invalid',
          rejection_reason: v.reason, hallucinated: true,
        });
        continue;
      }

      summary.validated++;

      if (v.already_in_corpus) {
        summary.already_in_corpus++;
        logDiscovery(db, {
          run_id, handle: v.handle, channel_id: v.channel_id, niche, region,
          suggestion_status: 'suggested', validation_status: 'valid',
          admission_status: 'skipped', rejection_reason: 'already_in_corpus',
          creator_size_tier: classifyCreatorSize(v.subscriber_count),
          hallucinated: false,
        });
        continue;
      }

      // ── 3. Recent semantic identity check ─────────────────────────────────
      if (!canSpend(1)) {
        logDiscovery(db, {
          run_id, handle: v.handle, channel_id: v.channel_id, niche, region,
          suggestion_status: 'suggested', validation_status: 'valid',
          admission_status: 'skipped', rejection_reason: 'quota_budget_exhausted',
          hallucinated: false,
        });
        continue;
      }

      const identity = await evaluateRecentSemanticIdentity(v.uploads_playlist_id);
      quotaUsed++;
      summary.quota_used++;

      if (!identity.pass) {
        summary.rejected++;
        logDiscovery(db, {
          run_id, handle: v.handle, channel_id: v.channel_id, niche, region,
          suggestion_status: 'suggested', validation_status: 'valid',
          admission_status: 'rejected', rejection_reason: identity.reason,
          creator_size_tier: classifyCreatorSize(v.subscriber_count),
          hallucinated: false,
        });
        continue;
      }

      // ── 4. Novelty evaluation ─────────────────────────────────────────────
      const noveltyScore = calculateSemanticNovelty(db, {
        channel_id:      v.channel_id,
        niche,
        semantic_status: 'pending',
      });

      // Soft novelty gate: very low novelty means this channel adds nothing new
      if (noveltyScore < 20) {
        summary.rejected++;
        logDiscovery(db, {
          run_id, handle: v.handle, channel_id: v.channel_id, niche, region,
          suggestion_status: 'suggested', validation_status: 'valid',
          admission_status: 'rejected', rejection_reason: 'low_novelty',
          novelty_score: noveltyScore,
          creator_size_tier: classifyCreatorSize(v.subscriber_count),
          hallucinated: false,
        });
        continue;
      }

      // ── 5. Corpus admission (probation state) ─────────────────────────────
      const sizeTier = classifyCreatorSize(v.subscriber_count);
      admitToCorpus(db, v, { noveltyScore, sizeTier, niche });
      summary.admitted++;

      logDiscovery(db, {
        run_id, handle: v.handle, channel_id: v.channel_id, niche, region,
        suggestion_status: 'suggested', validation_status: 'valid',
        admission_status: 'admitted',
        novelty_score: noveltyScore,
        creator_size_tier: sizeTier,
        hallucinated: false,
      });

      console.log(`[aiDiscovery] Admitted: ${v.handle} — "${v.title}" novelty=${noveltyScore} tier=${sizeTier}`);
    }

    await sleep(500);
  }

  summary.hallucination_rate = summary.suggested > 0
    ? +(summary.hallucinations / summary.suggested).toFixed(2) : 0;
  summary.validation_rate = summary.suggested > 0
    ? +(summary.validated / summary.suggested).toFixed(2) : 0;
  summary.admission_rate = summary.validated > 0
    ? +(summary.admitted / summary.validated).toFixed(2) : 0;

  console.log('[aiDiscovery] Cycle complete:', summary);
  return summary;
}

// ── Stats ─────────────────────────────────────────────────────────────────────

function getAIDiscoveryStats(db, { days = 30 } = {}) {
  const since = `datetime('now', '-${days} days')`;
  const overall = db.get(
    `SELECT
       COUNT(*)                                                         AS total_suggestions,
       SUM(hallucinated)                                               AS hallucinations,
       SUM(CASE WHEN validation_status = 'valid'    THEN 1 ELSE 0 END) AS validated,
       SUM(CASE WHEN admission_status  = 'admitted' THEN 1 ELSE 0 END) AS admitted,
       SUM(CASE WHEN admission_status  = 'rejected' THEN 1 ELSE 0 END) AS rejected,
       AVG(CASE WHEN novelty_score IS NOT NULL THEN novelty_score END)  AS avg_novelty
     FROM ai_discovery_log WHERE created_at > ${since}`,
  );

  const byNiche = db.all(
    `SELECT niche, COUNT(*) AS n,
            SUM(CASE WHEN admission_status='admitted' THEN 1 ELSE 0 END) AS admitted
     FROM ai_discovery_log WHERE created_at > ${since} AND niche IS NOT NULL
     GROUP BY niche ORDER BY admitted DESC`,
  );

  const byTier = db.all(
    `SELECT creator_size_tier, COUNT(*) AS n,
            SUM(CASE WHEN admission_status='admitted' THEN 1 ELSE 0 END) AS admitted
     FROM ai_discovery_log WHERE created_at > ${since} AND creator_size_tier IS NOT NULL
     GROUP BY creator_size_tier ORDER BY n DESC`,
  );

  const byRegion = db.all(
    `SELECT COALESCE(region, 'unspecified') AS region,
            COUNT(*) AS n,
            SUM(CASE WHEN admission_status='admitted' THEN 1 ELSE 0 END) AS admitted
     FROM ai_discovery_log WHERE created_at > ${since}
     GROUP BY region ORDER BY n DESC`,
  );

  const rejectionReasons = db.all(
    `SELECT rejection_reason, COUNT(*) AS n
     FROM ai_discovery_log WHERE created_at > ${since} AND rejection_reason IS NOT NULL
     GROUP BY rejection_reason ORDER BY n DESC`,
  );

  return { period_days: days, overall, by_niche: byNiche, by_tier: byTier, by_region: byRegion, rejection_reasons: rejectionReasons };
}

module.exports = {
  runAIDiscoveryCycle,
  suggestChannels,
  validateSuggestions,
  evaluateRecentSemanticIdentity,
  admitToCorpus,
  buildDiversityAwarePrompt,
  classifyCreatorSize,
  getAIDiscoveryStats,
  getNichesNeedingDiversity,
};

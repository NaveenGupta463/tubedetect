'use strict';

// Backend-only WTP + Original Bets quality audit.
//
// Usage:
//   node server/scripts/auditWtpOriginalBetsBackend.js --limit 100
//   node server/scripts/auditWtpOriginalBetsBackend.js --limit 100 --output tmp/audit.json
//   node server/scripts/auditWtpOriginalBetsBackend.js --limit 30 --prefer-unaudited --recent-days 2

const fs = require('fs');
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
const {
  classifyTrend,
  getVelocity,
  getFormatWinner,
} = require('../services/topicAnalysis');

function argValue(name, fallback = null) {
  const exact = process.argv.indexOf(name);
  if (exact !== -1 && exact + 1 < process.argv.length) return process.argv[exact + 1];
  const prefix = `${name}=`;
  const found = process.argv.find(arg => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function toInt(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

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

function quietCompute(fn) {
  if (hasFlag('--verbose')) return fn();
  const log = console.log;
  const warn = console.warn;
  console.log = () => {};
  console.warn = () => {};
  try {
    return fn();
  } finally {
    console.log = log;
    console.warn = warn;
  }
}

function normalizeTopic(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function topicText(idea) {
  return String(idea?.topic || idea?.title || idea?.action_title || '').trim();
}

function compactIdea(idea) {
  return {
    topic: topicText(idea),
    source: idea?.source || null,
    dna_family: idea?.dna_evidence?.family || null,
    score: idea?.score || null,
    original_quality: idea?.original_quality || null,
    channel_count: idea?.channel_count || 0,
    avg_views: idea?.avg_views || 0,
    examples: (idea?.examples || []).slice(0, 2).map(ex => ({
      title: ex.title,
      channel: ex.channel_name || null,
      views: ex.views || 0,
    })),
  };
}

function countBy(rows, key) {
  const out = {};
  for (const row of rows) {
    const value = row[key] || 'unknown';
    out[value] = (out[value] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(out).sort((a, b) => b[1] - a[1]));
}

function parseDateMs(value) {
  const ms = Date.parse(value || '');
  return Number.isFinite(ms) ? ms : 0;
}

function loadPriorAuditHistory() {
  const tmpDir = path.resolve('tmp');
  const history = new Map();
  if (!fs.existsSync(tmpDir)) return history;

  for (const name of fs.readdirSync(tmpDir)) {
    if (!/^wtp_original_bets_backend_audit.*\.json$/i.test(name)) continue;
    const filePath = path.join(tmpDir, name);
    let payload;
    try {
      payload = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch {
      continue;
    }
    const auditedAt = parseDateMs(payload.generated_at) || fs.statSync(filePath).mtimeMs;
    for (const row of payload.results || []) {
      if (!row?.channel_id) continue;
      const prior = history.get(row.channel_id);
      const count = (prior?.count || 0) + 1;
      if (!prior || auditedAt > prior.last_audited_at_ms) {
        history.set(row.channel_id, {
          count,
          last_audited_at_ms: auditedAt,
          last_audit_file: name,
        });
      } else {
        prior.count = count;
      }
    }
  }
  return history;
}

function isBroadIndia(topic) {
  return /\b(india|indian|indians|bharat)\b/i.test(topic);
}

function issueDetector(originalBets) {
  const issues = [];
  const topics = originalBets.map(topicText).filter(Boolean);
  const topicKeys = topics.map(normalizeTopic);
  const duplicateTopics = topicKeys.length - new Set(topicKeys).size;
  const topExamples = originalBets
    .map(idea => String(idea?.examples?.[0]?.title || '').trim())
    .filter(Boolean);
  const duplicateTopExamples = topExamples.length - new Set(topExamples.map(normalizeTopic)).size;
  const noEvidence = originalBets.filter(idea => !Array.isArray(idea.examples) || idea.examples.length === 0).length;
  const ftLeak = topics.filter(t => /\b(ft|feat|featuring)\.?\b/i.test(t)).length;
  const channelish = topics.filter(t => /\b(channel|official|watch now|today news|khabar|samachar)\b/i.test(t)).length;
  const questionish = topics.filter(t => /\b(question|questions|answer|answers)\b/i.test(t)).length;
  const genericPlaceholder = topics.filter(t =>
    /\b(your audience problem|recent upload theme|viewer confusion|fresh viewer question)\b/i.test(t)
  ).length;
  const noisyFragments = topics.filter(t =>
    /\b(game very|say goodbye|need this|hidden spot|next station|film kala|pinkyteluguchannel)\b/i.test(t) ||
    /^home$/i.test(t) ||
    /^(story|result|more|most|local|best|top)\b/i.test(t)
  ).length;
  const broadIndiaTitles = topics.filter(isBroadIndia).length;

  if (duplicateTopics > 0) issues.push({ type: 'duplicate_topics', count: duplicateTopics });
  if (duplicateTopExamples > 0) issues.push({ type: 'duplicate_top_examples', count: duplicateTopExamples });
  if (ftLeak > 0) issues.push({ type: 'ft_or_guest_fragment_leak', count: ftLeak });
  if (channelish > 0) issues.push({ type: 'channelish_title', count: channelish });
  if (questionish > 0) issues.push({ type: 'question_fragment', count: questionish });
  if (genericPlaceholder > 0) issues.push({ type: 'generic_placeholder', count: genericPlaceholder });
  if (noisyFragments > 0) issues.push({ type: 'noisy_fragment', count: noisyFragments });
  if (broadIndiaTitles > 1) issues.push({ type: 'broad_identity_overuse', count: broadIndiaTitles });
  if (originalBets.length > 0 && noEvidence === originalBets.length) issues.push({ type: 'all_original_bets_without_evidence', count: noEvidence });

  const penalty = issues.reduce((sum, issue) => {
    if (issue.type === 'all_original_bets_without_evidence') return sum + 10;
    if (issue.type === 'broad_identity_overuse') return sum + 8 + issue.count;
    if (issue.type === 'duplicate_top_examples') return sum + 12 * issue.count;
    if (issue.type === 'generic_placeholder') return sum + 12 * issue.count;
    if (issue.type === 'ft_or_guest_fragment_leak') return sum + 15 * issue.count;
    return sum + 8 * issue.count;
  }, 0);

  return {
    issues,
    metrics: {
      duplicate_topics: duplicateTopics,
      duplicate_top_examples: duplicateTopExamples,
      no_evidence: noEvidence,
      ft_leak: ftLeak,
      channelish,
      questionish,
      generic_placeholder: genericPlaceholder,
      noisy_fragments: noisyFragments,
      broad_india_titles: broadIndiaTitles,
    },
    quality_score: Math.max(0, 100 - penalty),
  };
}

function selectStratifiedRandomChannels(db, limit, options = {}) {
  const auditHistory = options.auditHistory || new Map();
  const recentCutoffMs = options.recentCutoffMs || 0;
  const preferUnaudited = !!options.preferUnaudited;
  const rows = db.all(
    `WITH eligible AS (
       SELECT ic.channel_id,
              ic.channel_name,
              COALESCE(ic.primary_niche, ic.niche, 'unknown') AS niche,
              ic.channel_subscribers,
              ic.creator_mode,
              ic.format_profile,
              cid.confidence AS dna_confidence,
              cid.confidence_score,
              cid.sample_count,
              cid.drift_status,
              ccsp.primary_csp,
              ROW_NUMBER() OVER (
                PARTITION BY COALESCE(ic.primary_niche, ic.niche, 'unknown')
                ORDER BY random()
              ) AS niche_rank
         FROM ingested_channels ic
         JOIN creator_idea_dna cid ON cid.channel_id = ic.channel_id
         LEFT JOIN channel_content_strategy_profiles ccsp ON ccsp.channel_id = ic.channel_id
        WHERE ic.ingest_enabled = 1
          AND ic.channel_id IS NOT NULL
          AND cid.confidence IN ('medium', 'high')
          AND cid.sample_count >= 20
      )
      SELECT *
        FROM eligible
       WHERE niche_rank <= 12
       ORDER BY niche_rank ASC, random()`,
  );

  const selected = [];
  const seen = new Set();
  const addRow = (row, auditStatus) => {
    if (selected.length >= limit) return;
    if (seen.has(row.channel_id)) return;
    seen.add(row.channel_id);
    selected.push({
      ...row,
      audit_selection: auditStatus,
    });
  };

  if (preferUnaudited) {
    for (const row of rows) {
      if (!auditHistory.has(row.channel_id)) addRow(row, 'never_audited');
    }
    const staleRows = rows
      .filter(row => {
        const prior = auditHistory.get(row.channel_id);
        return prior && prior.last_audited_at_ms < recentCutoffMs;
      })
      .sort((a, b) => auditHistory.get(a.channel_id).last_audited_at_ms - auditHistory.get(b.channel_id).last_audited_at_ms);
    for (const row of staleRows) addRow(row, 'stale_audited');
  }

  for (const row of rows) {
    const prior = auditHistory.get(row.channel_id);
    const auditStatus = !prior ? 'never_audited' : prior.last_audited_at_ms < recentCutoffMs ? 'stale_audited' : 'recently_audited';
    addRow(row, auditStatus);
  }
  return selected;
}

function run() {
  const started = Date.now();
  const limit = Math.max(1, Math.min(toInt(argValue('--limit'), 100), 250));
  const recentDays = Math.max(0, toInt(argValue('--recent-days'), 2));
  const preferUnaudited = hasFlag('--prefer-unaudited');
  const auditHistory = preferUnaudited ? loadPriorAuditHistory() : new Map();
  const recentCutoffMs = Date.now() - (recentDays * 24 * 60 * 60 * 1000);
  const outputPath = argValue('--output') || path.join(
    'tmp',
    `wtp_original_bets_backend_audit_${limit}_${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
  );
  const db = openReadonlyDb();
  const channels = selectStratifiedRandomChannels(db, limit, {
    auditHistory,
    recentCutoffMs,
    preferUnaudited,
  });
  const results = [];
  const summary = {
    requested: limit,
    tested: 0,
    errors: 0,
    channels_with_original_bets: 0,
    channels_without_original_bets: 0,
    channels_with_peer_ideas: 0,
    channels_without_peer_ideas: 0,
    channels_with_fallback_ideas: 0,
    total_peer_ideas: 0,
    total_original_bets: 0,
    total_fallback_ideas: 0,
    total_original_quality_issues: 0,
    original_selected_quality_tiers: {
      excellent: 0,
      usable: 0,
      weak: 0,
      rejected: 0,
      unknown: 0,
    },
    quality_gate: {
      evaluated: 0,
      accepted: 0,
      rejected: 0,
      selected: 0,
      candidate_tiers: {
        excellent: 0,
        usable: 0,
        weak: 0,
        rejected: 0,
      },
      selected_tiers: {
        excellent: 0,
        usable: 0,
        weak: 0,
        rejected: 0,
      },
      rejection_reasons: {},
      expansion_evaluated: 0,
      expansion_selected: 0,
      expansion_rejection_reasons: {},
    },
    issue_counts: {},
    audit_selection: {
      prefer_unaudited: preferUnaudited,
      prior_audit_channels: auditHistory.size,
      recent_days: recentDays,
      never_audited: 0,
      stale_audited: 0,
      recently_audited: 0,
    },
  };

  console.log(`[audit] selected=${channels.length} requested=${limit}`);

  for (let i = 0; i < channels.length; i++) {
    const ch = channels[i];
    const label = `${i + 1}/${channels.length} ${ch.channel_name || ch.channel_id} [${ch.niche}]`;
    let result;
    const t0 = Date.now();
    try {
      result = quietCompute(() => computeWhatToPost(db, {
        channel_id: ch.channel_id,
        subscriber_count: String(ch.channel_subscribers || 0),
        debug: true,
        use_creator_mode_peers: 'true',
      }, ctx));
    } catch (error) {
      summary.errors++;
      results.push({
        index: i + 1,
        channel_id: ch.channel_id,
        channel_name: ch.channel_name,
        niche: ch.niche,
        error: error.message,
      });
      console.log(`[audit] ERROR ${label}: ${error.message}`);
      continue;
    }

    const peerIdeas = result.ideas || [];
    const originalBets = result.original_bets?.ideas || [];
    const fallbackIdeas = peerIdeas.filter(idea => idea.source === 'fallback_evergreen');
    const quality = issueDetector(originalBets);
    const gate = result.original_bets?.quality_gate || null;
    for (const issue of quality.issues) {
      summary.issue_counts[issue.type] = (summary.issue_counts[issue.type] || 0) + issue.count;
    }
    for (const idea of originalBets) {
      const tier = idea?.original_quality?.tier || 'unknown';
      summary.original_selected_quality_tiers[tier] = (summary.original_selected_quality_tiers[tier] || 0) + 1;
    }
    if (gate) {
      summary.quality_gate.evaluated += Number(gate.evaluated || 0);
      summary.quality_gate.accepted += Number(gate.accepted || 0);
      summary.quality_gate.rejected += Number(gate.rejected || 0);
      summary.quality_gate.selected += Number(gate.selected || 0);
      for (const [tier, count] of Object.entries(gate.candidate_tiers || {})) {
        summary.quality_gate.candidate_tiers[tier] = (summary.quality_gate.candidate_tiers[tier] || 0) + Number(count || 0);
      }
      for (const [tier, count] of Object.entries(gate.selected_tiers || {})) {
        summary.quality_gate.selected_tiers[tier] = (summary.quality_gate.selected_tiers[tier] || 0) + Number(count || 0);
      }
      for (const [reason, count] of Object.entries(gate.rejection_reasons || {})) {
        summary.quality_gate.rejection_reasons[reason] = (summary.quality_gate.rejection_reasons[reason] || 0) + Number(count || 0);
      }
      summary.quality_gate.expansion_evaluated += Number(gate.expansion_evaluated || 0);
      summary.quality_gate.expansion_selected += Number(gate.expansion_selected || 0);
      for (const [reason, count] of Object.entries(gate.expansion_rejection_reasons || {})) {
        summary.quality_gate.expansion_rejection_reasons[reason] = (summary.quality_gate.expansion_rejection_reasons[reason] || 0) + Number(count || 0);
      }
    }

    summary.tested++;
    const auditStatus = ch.audit_selection || 'untracked';
    summary.audit_selection[auditStatus] = (summary.audit_selection[auditStatus] || 0) + 1;
    summary.total_peer_ideas += peerIdeas.length;
    summary.total_original_bets += originalBets.length;
    summary.total_fallback_ideas += fallbackIdeas.length;
    summary.total_original_quality_issues += quality.issues.reduce((sum, issue) => sum + issue.count, 0);
    if (peerIdeas.length) summary.channels_with_peer_ideas++;
    else summary.channels_without_peer_ideas++;
    if (originalBets.length) summary.channels_with_original_bets++;
    else summary.channels_without_original_bets++;
    if (fallbackIdeas.length) summary.channels_with_fallback_ideas++;

    results.push({
      index: i + 1,
      channel_id: ch.channel_id,
      channel_name: ch.channel_name,
      niche: ch.niche,
      subscribers: ch.channel_subscribers || 0,
      csp: result.csp_primary || ch.primary_csp || null,
      creator_mode: result.creator_mode || ch.creator_mode || null,
      format_profile: result.format_profile || ch.format_profile || null,
      dna: {
        confidence: ch.dna_confidence,
        confidence_score: ch.confidence_score,
        sample_count: ch.sample_count,
        drift_status: ch.drift_status,
      },
      audit_selection: {
        status: ch.audit_selection || null,
        prior: auditHistory.get(ch.channel_id) || null,
      },
      wtp: {
        niche_category: result.niche_category || null,
        peer_channels: result.channel_count || 0,
        peer_videos: result.video_count || 0,
        peer_ideas: peerIdeas.length,
        fallback_ideas: fallbackIdeas.length,
        original_status: result.original_bets?.status || null,
        original_ideas: originalBets.length,
        no_active_narratives: !!result.no_active_narratives,
        guest_intel_active: !!result.guest_intel_active,
      },
      original_family: result.original_bets?.family || originalBets[0]?.dna_evidence?.family || null,
      original_quality_gate: gate,
      original_quality: quality,
      original_bets: originalBets.slice(0, 6).map(compactIdea),
      peer_ideas: peerIdeas.slice(0, 5).map(compactIdea),
      elapsed_ms: Date.now() - t0,
    });

    const issueText = quality.issues.length
      ? quality.issues.map(issue => `${issue.type}:${issue.count}`).join(',')
      : 'clean';
    const tierText = gate?.selected_tiers
      ? `tiers=e${gate.selected_tiers.excellent || 0}/u${gate.selected_tiers.usable || 0}/w${gate.selected_tiers.weak || 0}`
      : 'tiers=n/a';
    console.log(`[audit] ${label} peer=${peerIdeas.length} original=${originalBets.length} q=${quality.quality_score} ${tierText} issues=${issueText}`);
  }

  summary.avg_peer_ideas = +(summary.total_peer_ideas / Math.max(summary.tested, 1)).toFixed(2);
  summary.avg_original_bets = +(summary.total_original_bets / Math.max(summary.tested, 1)).toFixed(2);
  summary.avg_fallback_ideas = +(summary.total_fallback_ideas / Math.max(summary.tested, 1)).toFixed(2);
  summary.original_bet_coverage = +(summary.channels_with_original_bets / Math.max(summary.tested, 1)).toFixed(2);
  summary.peer_idea_coverage = +(summary.channels_with_peer_ideas / Math.max(summary.tested, 1)).toFixed(2);
  summary.fallback_channel_rate = +(summary.channels_with_fallback_ideas / Math.max(summary.tested, 1)).toFixed(2);
  summary.niche_distribution = countBy(results.filter(r => !r.error), 'niche');
  summary.csp_distribution = countBy(results.filter(r => !r.error), 'csp');
  summary.original_family_distribution = countBy(results.filter(r => !r.error), 'original_family');
  summary.elapsed_ms = Date.now() - started;

  const flagged = results
    .filter(r => !r.error && r.original_quality?.issues?.length)
    .sort((a, b) => a.original_quality.quality_score - b.original_quality.quality_score)
    .slice(0, 30)
    .map(r => ({
      channel_id: r.channel_id,
      channel_name: r.channel_name,
      niche: r.niche,
      csp: r.csp,
      quality_score: r.original_quality.quality_score,
      issues: r.original_quality.issues,
      topics: r.original_bets.map(idea => idea.topic),
    }));

  const payload = {
    generated_at: new Date().toISOString(),
    audit_type: 'backend_wtp_original_bets_random_stratified',
    summary,
    flagged,
    results,
  };

  const absOutput = path.resolve(outputPath);
  fs.mkdirSync(path.dirname(absOutput), { recursive: true });
  fs.writeFileSync(absOutput, JSON.stringify(payload, null, 2));
  console.log(`[audit] wrote ${absOutput}`);
  console.log(JSON.stringify({ summary, output: absOutput, flagged: flagged.slice(0, 10) }, null, 2));
  db.close();
}

try {
  run();
} catch (error) {
  console.error('[audit-wtp-original-bets-backend] Fatal:', error.stack || error.message);
  process.exitCode = 1;
}

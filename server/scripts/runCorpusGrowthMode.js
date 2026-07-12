'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const quotaBudget = parseInt(process.argv[2] || process.env.CORPUS_GROWTH_QUOTA || '50000', 10);

// Growth mode spends quota on targeted search + creator graph resolution + light ingest,
// while leaving frontend, snapshot, RSS, and historical ingest budgets outside this run.
process.env.CREATOR_GRAPH_RESOLVE_QUOTA ??= '5000';
process.env.CREATOR_GRAPH_HANDLE_CAP ??= '1200';
process.env.CORPUS_LIGHT_INGEST_LIMIT ??= '3000';
process.env.CORPUS_SKIP_PRIORITY_RESCORE ??= '1';
process.env.CORPUS_GROWTH_ONLY ??= '1';
process.env.CORPUS_QUIET_GROWTH ??= '1';
process.env.CORPUS_NICHE_CLASSIFY_LIMIT ??= '3000';
process.env.CORPUS_QUALITY_EVAL_LIMIT ??= '5000';
process.env.CORPUS_DISCOVERY_SEARCH_FRACTION ??= '0.6';

const { runCorpusCycle } = require('../services/corpusScheduler');

function summarizeStep(entry) {
  const data = entry.data || {};
  const out = { ...data };

  if (Array.isArray(out.niche_gaps)) {
    out.niche_gaps_count = out.niche_gaps.length;
    out.niche_gaps_top = out.niche_gaps.slice(0, 5).map(g => ({
      niche: g.niche,
      count: g.count,
      trained: g.trained,
      gap_score: Math.round((g.gap_score || 0) * 10) / 10,
    }));
    delete out.niche_gaps;
  }

  if (Array.isArray(out.channels)) {
    const sourceCounts = {};
    const nicheCounts = {};
    for (const ch of out.channels) {
      const source = ch.discovery_source || 'unknown';
      const niche = ch.niche || 'unknown';
      sourceCounts[source] = (sourceCounts[source] || 0) + 1;
      nicheCounts[niche] = (nicheCounts[niche] || 0) + 1;
    }
    out.channels_count = out.channels.length;
    out.channel_sources = sourceCounts;
    out.channel_niches = Object.fromEntries(
      Object.entries(nicheCounts).sort((a, b) => b[1] - a[1]).slice(0, 12),
    );
    out.sample_channels = out.channels.slice(0, 10).map(ch => ({
      title: ch.title,
      niche: ch.niche,
      subscriber_count: ch.subscriber_count,
      discovery_source: ch.discovery_source,
      videos_ingested: ch.videos_ingested,
    }));
    delete out.channels;
  }

  return { step: entry.step, data: out };
}

async function main() {
  console.log('[growth] Starting corpus growth mode');
  console.log('[growth] quotaBudget:', quotaBudget);
  console.log('[growth] CREATOR_GRAPH_RESOLVE_QUOTA:', process.env.CREATOR_GRAPH_RESOLVE_QUOTA);
  console.log('[growth] CREATOR_GRAPH_HANDLE_CAP:', process.env.CREATOR_GRAPH_HANDLE_CAP);
  console.log('[growth] CORPUS_LIGHT_INGEST_LIMIT:', process.env.CORPUS_LIGHT_INGEST_LIMIT);
  console.log('[growth] CORPUS_DISCOVERY_SEARCH_FRACTION:', process.env.CORPUS_DISCOVERY_SEARCH_FRACTION);

  const result = await runCorpusCycle({
    quotaBudget,
    mode: 'full',
    allowSearch: true,
    allowAIDiscovery: true,
    allowVideoSearch: true,
    allowHindiSearch: true,
    allowTamilSearch: true,
    allowTeluguSearch: true,
    allowBengaliSearch: true,
    allowKannadaSearch: true,
    allowMalayalamSearch: true,
    allowSpanishSearch: false,
    allowPortugueseSearch: false,
    allowIndonesianSearch: false,
    allowArabicSearch: true,
    allowPunjabiSearch: true,
  });

  console.log('[growth] Result:', JSON.stringify({
    ok: result.ok,
    skipped: result.skipped,
    quota_used: result.quota_used,
    duration_ms: result.duration_ms,
    steps: (result.log || []).map(summarizeStep),
  }, null, 2));

  process.exit(result.ok ? 0 : 1);
}

main().catch(err => {
  console.error('[growth] Fatal:', err);
  process.exit(1);
});

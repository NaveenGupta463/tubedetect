'use strict';

// Finds channels whose own titles look like curiosity explainers but whose stored
// WTP metadata would route them through generic business/finance/news pools.
//
// Usage:
//   node server/scripts/auditWtpExplainerRouting.js
//   node server/scripts/auditWtpExplainerRouting.js --limit 100
//   node server/scripts/auditWtpExplainerRouting.js --json

const { getDb, closeDb } = require('../db/init');
const { computeCuriosityExplainerSignals } = require('../lib/explainerProfile');
const { classifyChannel } = require('../services/contentStrategyProfile');

const LIMIT = Math.max(1, parseInt(process.argv.find(a => a.startsWith('--limit='))?.split('=')[1] || '50', 10));
const JSON_MODE = process.argv.includes('--json');

function pct(n) {
  if (n == null || Number.isNaN(Number(n))) return '0%';
  return `${Math.round(Number(n) * 100)}%`;
}

function riskFor({ currentCsp, computedCsp, signals, row }) {
  const reasons = [];
  const wantsCuriosity = computedCsp?.primary_csp === 'curiosity_explainer';
  if (!wantsCuriosity) return reasons;

  if (currentCsp?.primary_csp !== 'curiosity_explainer') reasons.push('stored_csp_mismatch');
  if (['business_case_study', 'finance_investment_education', 'personal_finance_teaching'].includes(currentCsp?.primary_csp)) reasons.push('generic_business_finance_csp');
  if ((currentCsp?.confidence || '') === 'low') reasons.push('low_confidence_csp');
  return reasons;
}

function warningsFor({ computedCsp, row }) {
  const warnings = [];
  const wantsCuriosity = computedCsp?.primary_csp === 'curiosity_explainer';
  if (!wantsCuriosity) return warnings;

  if (row.format_profile !== 'curiosity_explainer') warnings.push('format_not_explainer');
  if (row.routing_profile === 'politics_news' && row.creator_mode !== 'news') warnings.push('politics_profile_on_non_news');
  if (row.creator_mode === 'finance' && !/finance|invest|stock|market|mutual fund|portfolio/i.test(row.title_text || '')) warnings.push('finance_mode_without_finance_titles');
  return warnings;
}

function main() {
  const db = getDb();
  const channels = db.all(
    `SELECT ic.channel_id, ic.channel_name, ic.niche, ic.primary_niche,
            ic.channel_subscribers, ic.creator_mode, ic.routing_profile,
            ic.format_profile, ic.format_profile_confidence,
            ccsp.primary_csp, ccsp.confidence, ccsp.version
     FROM ingested_channels ic
     LEFT JOIN channel_content_strategy_profiles ccsp ON ccsp.channel_id = ic.channel_id
     WHERE ic.ingest_enabled = 1
       AND EXISTS (SELECT 1 FROM ingested_videos iv WHERE iv.channel_id = ic.channel_id)
     ORDER BY ic.channel_subscribers DESC`,
  );

  const findings = [];

  for (const row of channels) {
    const titles = db.all(
      `SELECT title FROM ingested_videos
       WHERE channel_id = ? AND title IS NOT NULL AND title != ''
       ORDER BY published_at DESC LIMIT 60`,
      [row.channel_id],
    ).map(r => r.title);
    if (titles.length < 8) continue;

    const signals = computeCuriosityExplainerSignals(titles);
    if (!signals.active) continue;

    let computed = null;
    try {
      computed = classifyChannel(db, row.channel_id);
    } catch (_) {}

    const enriched = { ...row, title_text: titles.join(' ') };
    const reasons = riskFor({
      currentCsp: row.primary_csp ? { primary_csp: row.primary_csp, confidence: row.confidence } : null,
      computedCsp: computed,
      signals,
      row: enriched,
    });
    const warnings = warningsFor({ computedCsp: computed, row: enriched });

    if (!reasons.length && !warnings.length) continue;

    findings.push({
      channel_id: row.channel_id,
      channel_name: row.channel_name,
      subscribers: row.channel_subscribers || 0,
      niche: row.primary_niche || row.niche,
      creator_mode: row.creator_mode,
      routing_profile: row.routing_profile,
      format_profile: row.format_profile,
      stored_csp: row.primary_csp,
      stored_confidence: row.confidence,
      stored_version: row.version,
      computed_csp: computed?.primary_csp || null,
      computed_confidence: computed?.confidence || null,
      curiosity_ratio: signals.curiosity_ratio,
      curiosity_count: signals.curiosity_count,
      explainer_count: signals.explainer_count,
      everyday_count: signals.everyday_count,
      risk_reasons: reasons,
      metadata_warnings: warnings,
      sample_titles: titles.slice(0, 5),
    });
  }

  findings.sort((a, b) =>
    b.risk_reasons.length - a.risk_reasons.length ||
    b.curiosity_ratio - a.curiosity_ratio ||
    b.subscribers - a.subscribers,
  );

  const out = findings.slice(0, LIMIT);
  if (JSON_MODE) {
    console.log(JSON.stringify({ total_findings: findings.length, returned: out.length, findings: out }, null, 2));
    closeDb();
    return;
  }

  console.log('\n=== WTP Curiosity Explainer Routing Audit ===');
  const blocking = findings.filter(f => f.risk_reasons.length);
  const warningsOnly = findings.filter(f => !f.risk_reasons.length && f.metadata_warnings.length);
  console.log(`Blocking findings: ${blocking.length} | metadata warnings: ${warningsOnly.length} | showing ${out.length}\n`);
  for (const f of out) {
    const subs = f.subscribers >= 1_000_000 ? `${(f.subscribers / 1_000_000).toFixed(1)}M`
      : f.subscribers >= 1_000 ? `${Math.round(f.subscribers / 1_000)}K`
      : String(f.subscribers);
    console.log(`- ${f.channel_name} (${subs})`);
    console.log(`  niche=${f.niche} mode=${f.creator_mode || '-'} routing=${f.routing_profile || '-'} format=${f.format_profile || '-'}`);
    console.log(`  stored=${f.stored_csp || '-'}:${f.stored_confidence || '-'} v${f.stored_version || '-'} -> computed=${f.computed_csp || '-'}:${f.computed_confidence || '-'}`);
    console.log(`  explainer=${pct(f.curiosity_ratio)} (${f.curiosity_count} hits) reasons=${f.risk_reasons.join(', ') || '-'} warnings=${f.metadata_warnings.join(', ') || '-'}`);
    console.log(`  titles: ${f.sample_titles.join(' | ')}`);
  }
  console.log('');
  closeDb();
}

main();

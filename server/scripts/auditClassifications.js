'use strict';

// ── Classification Audit ──────────────────────────────────────────────────────
// Reads ingested_channels + ingested_videos, runs routing/format classifiers
// live (from titles), and reports activation vs metadata-only distributions.
//
// Usage:
//   node server/scripts/auditClassifications.js
//   node server/scripts/auditClassifications.js --profile upsc_exam
//   node server/scripts/auditClassifications.js --mode upsc
//   node server/scripts/auditClassifications.js --channel <channel_id>
//   node server/scripts/auditClassifications.js --suspicious   (top false-looking activations)

const { getDb } = require('../db/init');
const { computeRoutingProfile, computeRoutingProfileActivation, PROFILE_ACTIVATION_RULES } = require('../lib/routingProfiles');
const { computeFormatProfile, computeGuestIntelActivation } = require('../lib/formatProfile');

const PROFILE_FILTER  = process.argv.find(a => a.startsWith('--profile='))?.split('=')[1]
                     || (process.argv.includes('--profile') ? process.argv[process.argv.indexOf('--profile') + 1] : null);
const MODE_FILTER     = process.argv.find(a => a.startsWith('--mode='))?.split('=')[1]
                     || (process.argv.includes('--mode') ? process.argv[process.argv.indexOf('--mode') + 1] : null);
const CHANNEL_ID      = process.argv.find(a => a.startsWith('--channel='))?.split('=')[1]
                     || (process.argv.includes('--channel') ? process.argv[process.argv.indexOf('--channel') + 1] : null);
const SUSPICIOUS_ONLY = process.argv.includes('--suspicious');
const SAMPLE_LIMIT    = 2000; // channels to sample for full analysis

async function main() {
  const db = getDb();

  if (CHANNEL_ID) {
    auditChannel(db, CHANNEL_ID);
    return;
  }

  console.log('\nLoading channels...');
  let query = `SELECT channel_id, channel_name, creator_mode, format_type,
                      COALESCE(primary_niche, niche) AS niche,
                      routing_profile, routing_profile_confidence,
                      format_profile, format_profile_confidence
               FROM ingested_channels WHERE ingest_enabled = 1`;
  const args = [];
  if (MODE_FILTER) { query += ' AND creator_mode = ?'; args.push(MODE_FILTER); }
  query += ` ORDER BY channel_subscribers DESC LIMIT ${SAMPLE_LIMIT}`;

  const channels = db.all(query, args);
  console.log(`Analysing ${channels.length} channels...\n`);

  // ── Per-channel classification run ─────────────────────────────────────────
  const rows = [];
  for (const ch of channels) {
    const titles = db.all(
      `SELECT title FROM ingested_videos
       WHERE channel_id = ? AND title IS NOT NULL
       ORDER BY published_at DESC LIMIT 60`,
      [ch.channel_id],
    ).map(r => r.title);

    if (titles.length < 5) continue;

    const rp = computeRoutingProfile(titles);
    const fp = computeFormatProfile(titles, ch);

    // Activation flags
    const rpActivation = computeRoutingProfileActivation(rp, { resolverEligible: true });
    const giActivation = computeGuestIntelActivation(fp, ch.creator_mode || '');

    rows.push({
      channel_id:           ch.channel_id,
      channel_name:         ch.channel_name,
      creator_mode:         ch.creator_mode || '',
      format_type:          ch.format_type  || '',
      niche:                ch.niche        || '',
      // Routing profile classification
      rp_profile:           rp.profile,
      rp_confidence:        rp.confidence,
      rp_distinct_titles:   rp.distinct_title_hits,
      rp_strong_anchors:    rp.strong_anchor_hits,
      rp_blockers:          rp.blockers.join(','),
      rp_active:            rpActivation.active,
      rp_active_reason:     rpActivation.reason,
      // Format profile classification
      fp_profile:           fp.format_profile,
      fp_confidence:        fp.confidence,
      fp_distinct_guests:   fp.signals?.distinct_guests || 0,
      fp_guest_hits:        fp.signals?.guest_hits || 0,
      fp_n:                 fp.signals?.n || 0,
      // Guest intel activation
      gi_active:            giActivation.active,
      gi_reason:            giActivation.reason,
    });
  }

  if (PROFILE_FILTER) {
    printProfileDetail(rows, PROFILE_FILTER);
    return;
  }

  if (SUSPICIOUS_ONLY) {
    printSuspicious(rows);
    return;
  }

  // ── (a) Distribution by routing profile + confidence + active ──────────────
  console.log('═'.repeat(72));
  console.log('(a) ROUTING PROFILE — classification vs activation');
  console.log('═'.repeat(72));
  const rpDist = {};
  for (const r of rows) {
    const key = `${r.rp_profile || 'none'} | ${r.rp_confidence}`;
    if (!rpDist[key]) rpDist[key] = { total: 0, active: 0 };
    rpDist[key].total++;
    if (r.rp_active) rpDist[key].active++;
  }
  for (const [key, v] of Object.entries(rpDist).sort()) {
    const pct = v.total > 0 ? Math.round((v.active / v.total) * 100) : 0;
    console.log(`  ${key.padEnd(48)} total=${String(v.total).padStart(4)}  active=${String(v.active).padStart(4)}  (${pct}%)`);
  }

  // ── (b) creator_mode × routing_profile × active flag ──────────────────────
  console.log('\n' + '═'.repeat(72));
  console.log('(b) creator_mode × routing_profile × active');
  console.log('═'.repeat(72));
  const crossDist = {};
  for (const r of rows) {
    const key = `${r.creator_mode || 'general'} × ${r.rp_profile || 'none'}`;
    if (!crossDist[key]) crossDist[key] = { total: 0, active: 0 };
    crossDist[key].total++;
    if (r.rp_active) crossDist[key].active++;
  }
  const topCross = Object.entries(crossDist).sort((a, b) => b[1].total - a[1].total).slice(0, 30);
  for (const [key, v] of topCross) {
    console.log(`  ${key.padEnd(52)} total=${String(v.total).padStart(4)}  active=${String(v.active).padStart(4)}`);
  }

  // ── (c) format_type × format_profile × guest_intel_active ─────────────────
  console.log('\n' + '═'.repeat(72));
  console.log('(c) format_type × format_profile × guest_intel_active');
  console.log('═'.repeat(72));
  const fpDist = {};
  for (const r of rows) {
    const key = `${r.format_type || 'none'} × ${r.fp_profile}`;
    if (!fpDist[key]) fpDist[key] = { total: 0, gi_active: 0 };
    fpDist[key].total++;
    if (r.gi_active) fpDist[key].gi_active++;
  }
  const topFp = Object.entries(fpDist).sort((a, b) => b[1].total - a[1].total).slice(0, 25);
  for (const [key, v] of topFp) {
    console.log(`  ${key.padEnd(52)} total=${String(v.total).padStart(4)}  gi_active=${String(v.gi_active).padStart(4)}`);
  }

  // ── (d) Suspicious activations ─────────────────────────────────────────────
  // "Suspicious" = active=true but evidence is below the profile's own rule threshold.
  // Uses the profile's actual minStrongAnchors/minDistinctTitles, not a global constant.
  console.log('\n' + '═'.repeat(72));
  console.log('(d) SUSPICIOUS ACTIVATIONS — active=true but below own profile rule thresholds');
  console.log('═'.repeat(72));
  const suspicious = rows.filter(r => {
    if (!r.rp_active) return false;
    const rules = PROFILE_ACTIVATION_RULES[r.rp_profile] || PROFILE_ACTIVATION_RULES._default;
    return r.rp_distinct_titles < rules.minDistinctTitles
        || r.rp_strong_anchors  < rules.minStrongAnchors;
  }).slice(0, 20);
  if (!suspicious.length) {
    console.log('  (none found — activation rules are holding)');
  }
  for (const r of suspicious) {
    const rules = PROFILE_ACTIVATION_RULES[r.rp_profile] || PROFILE_ACTIVATION_RULES._default;
    console.log(`  [SUSPICIOUS] ${r.channel_name}`);
    console.log(`    mode=${r.creator_mode}  profile=${r.rp_profile}  conf=${r.rp_confidence}`);
    console.log(`    distinct_titles=${r.rp_distinct_titles}/${rules.minDistinctTitles}  strong_anchors=${r.rp_strong_anchors}/${rules.minStrongAnchors}`);
  }

  // ── (e) Metadata-only classifications (classified but not activated) ────────
  console.log('\n' + '═'.repeat(72));
  console.log('(e) METADATA-ONLY — routing profile assigned but activation=false');
  console.log('═'.repeat(72));
  const metaOnly = rows.filter(r => r.rp_profile && !r.rp_active);
  const metaDist = {};
  for (const r of metaOnly) {
    const key = r.rp_active_reason;
    metaDist[key] = (metaDist[key] || 0) + 1;
  }
  console.log(`  Total metadata-only: ${metaOnly.length} / ${rows.length}`);
  for (const [reason, n] of Object.entries(metaDist).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${reason.padEnd(56)} count=${n}`);
  }

  // ── Guest intel summary ─────────────────────────────────────────────────────
  console.log('\n' + '═'.repeat(72));
  console.log('(f) GUEST INTEL ACTIVATION breakdown');
  console.log('═'.repeat(72));
  const giRows = rows.filter(r => r.fp_profile === 'guest_interview');
  const giDist = {};
  for (const r of giRows) {
    const key = r.gi_reason;
    giDist[key] = (giDist[key] || 0) + 1;
  }
  console.log(`  guest_interview classified: ${giRows.length}  |  gi_active=true: ${giRows.filter(r => r.gi_active).length}`);
  for (const [reason, n] of Object.entries(giDist).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${reason.padEnd(56)} count=${n}`);
  }

  console.log('\n');
}

function auditChannel(db, channelId) {
  const ch = db.get(
    `SELECT channel_id, channel_name, creator_mode, format_type,
            COALESCE(primary_niche, niche) AS niche,
            routing_profile, routing_profile_confidence,
            format_profile, format_profile_confidence
     FROM ingested_channels WHERE channel_id = ?`,
    [channelId],
  );
  if (!ch) { console.log('Channel not found:', channelId); return; }

  const titles = db.all(
    `SELECT title FROM ingested_videos
     WHERE channel_id = ? AND title IS NOT NULL
     ORDER BY published_at DESC LIMIT 60`,
    [channelId],
  ).map(r => r.title);

  const rp = computeRoutingProfile(titles);
  const fp = computeFormatProfile(titles, ch);
  const rpAct = computeRoutingProfileActivation(rp, { resolverEligible: true });
  const giAct = computeGuestIntelActivation(fp, ch.creator_mode || '');

  console.log(`\nChannel: ${ch.channel_name}  (${ch.channel_id})`);
  console.log(`  creator_mode: ${ch.creator_mode || '—'}  niche: ${ch.niche || '—'}`);
  console.log(`\n  Routing profile:`);
  console.log(`    stored:   ${ch.routing_profile || '—'} / ${ch.routing_profile_confidence || '—'}`);
  console.log(`    computed: ${rp.profile || 'none'} / ${rp.confidence}`);
  console.log(`    evidence: pos=${rp.positive_hits}  neg=${rp.negative_hits}  strong=${rp.strong_anchor_hits}  distinct_titles=${rp.distinct_title_hits}  density=${(rp.density||0).toFixed(2)}`);
  console.log(`    blockers: ${rp.blockers.join(', ') || 'none'}`);
  console.log(`    reasons:  ${rp.reasons.join(', ') || '—'}`);
  console.log(`    ACTIVE:   ${rpAct.active}  (${rpAct.reason})`);

  console.log(`\n  Format profile:`);
  console.log(`    stored:   ${ch.format_profile || '—'} / ${ch.format_profile_confidence || '—'}`);
  console.log(`    computed: ${fp.format_profile} / ${fp.confidence}`);
  const s = fp.signals || {};
  console.log(`    signals:  guest_hits=${s.guest_hits}  distinct_guests=${s.distinct_guests}  ep=${s.episode_count}  shorts=${s.shorts_count}  essay=${s.essay_count}  doc=${s.doc_count}`);
  console.log(`    GUEST INTEL ACTIVE: ${giAct.active}  (${giAct.reason})`);

  console.log(`\n  Recent titles (${titles.length}):`);
  for (const t of titles.slice(0, 10)) console.log(`    • ${t}`);
}

function printProfileDetail(rows, profile) {
  const filtered = rows.filter(r => r.rp_profile === profile);
  console.log(`\nProfile: ${profile}  (${filtered.length} channels)`);
  const active = filtered.filter(r => r.rp_active);
  console.log(`Active: ${active.length}  Metadata-only: ${filtered.length - active.length}`);
  for (const r of filtered.slice(0, 20)) {
    const flag = r.rp_active ? '[ACTIVE]' : '[meta]  ';
    console.log(`  ${flag} ${r.channel_name}  mode=${r.creator_mode}  conf=${r.rp_confidence}  dist=${r.rp_distinct_titles}  anch=${r.rp_strong_anchors}  (${r.rp_active_reason})`);
  }
}

function printSuspicious(rows) {
  console.log('\nSuspicious activations (active=true but below own profile rule thresholds):');
  const s = rows.filter(r => {
    if (!r.rp_active) return false;
    const rules = PROFILE_ACTIVATION_RULES[r.rp_profile] || PROFILE_ACTIVATION_RULES._default;
    return r.rp_distinct_titles < rules.minDistinctTitles
        || r.rp_strong_anchors  < rules.minStrongAnchors;
  });
  if (!s.length) { console.log('  none — activation rules are holding'); return; }
  for (const r of s) {
    const rules = PROFILE_ACTIVATION_RULES[r.rp_profile] || PROFILE_ACTIVATION_RULES._default;
    console.log(`  ${r.channel_name}  profile=${r.rp_profile}  dist=${r.rp_distinct_titles}/${rules.minDistinctTitles}  anch=${r.rp_strong_anchors}/${rules.minStrongAnchors}`);
  }
}

main().catch(err => { console.error(err); process.exit(1); });

'use strict';
// Podcast Mode Validation — Phase 3D audit script.
//
// Usage:  node server/scripts/validatePodcastMode.js
// Requires: server running on port 3002  (node server/index.js)
//
// Reads DB read-only to resolve channel IDs, then calls the live API with
// debug=true&use_creator_mode_peers=true and prints a compact per-channel audit.
// Does NOT modify any production data or behavior.

const path          = require('path');
const http          = require('http');
const BetterSqlite3 = require(path.join(__dirname, '../node_modules/better-sqlite3'));

const DB_PATH    = path.join(__dirname, '../data/scoring.db');
const SERVER_URL = 'http://localhost:3002';

const rawDb = new BetterSqlite3(DB_PATH, { readonly: true });

// ── Channel list ──────────────────────────────────────────────────────────────
// Nikhil Kamath is included only when creator_mode='podcast' in the DB.
// The Ranveer Show is included only when present in the DB.
const TARGET_NAMES = [
  { name: 'Raj Shamani',       required: true },
  { name: 'BeerBiceps',        required: true },
  { name: 'Finance With Sharan', required: true },
  { name: 'The Ranveer Show',  required: false },
  { name: 'Nikhil Kamath',     required: false, mustBePodcast: true },
];

// ── Resolve channel IDs from DB ───────────────────────────────────────────────
const channels = [];
for (const target of TARGET_NAMES) {
  const row = rawDb.prepare(
    `SELECT channel_id, channel_name, creator_mode FROM ingested_channels WHERE channel_name LIKE ? LIMIT 1`,
  ).get(`%${target.name}%`);

  if (!row) {
    const tag = target.required ? '[MISSING]' : '[SKIP]';
    console.log(`${tag} ${target.name} — not found in DB`);
    continue;
  }

  if (target.mustBePodcast && row.creator_mode !== 'podcast') {
    console.log(`[SKIP] ${row.channel_name} — creator_mode=${row.creator_mode || 'null'} (not podcast)`);
    continue;
  }

  channels.push(row);
}

// ── HTTP helper ───────────────────────────────────────────────────────────────
function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch (e) { reject(new Error('JSON parse error — ' + body.slice(0, 120))); }
      });
    }).on('error', (e) => {
      if (e.code === 'ECONNREFUSED') {
        reject(new Error(`Server not running on ${SERVER_URL}. Start with: node server/index.js`));
      } else {
        reject(e);
      }
    });
  });
}

// ── Compact audit printer ─────────────────────────────────────────────────────
function printAudit(channelName, r) {
  const pi     = r.podcast_intel           || {};
  const shadow = r.podcast_mode_shadow     || {};
  const guests = pi.guests                 || [];
  const themes = pi.themes                 || [];
  const gd     = pi.guest_debug            || {};
  const td     = pi.theme_debug            || {};

  const warnings = [];
  if (r.podcast_intel_shadow_warning) warnings.push(r.podcast_intel_shadow_warning);
  if (!r.podcast_intel)               warnings.push('NO PODCAST_INTEL BLOCK');
  else if (guests.length === 0)       warnings.push('NO GUESTS');
  if (themes.length === 0)            warnings.push('NO THEMES');

  const SEP = '─'.repeat(62);
  console.log(`\n${SEP}`);
  console.log(`Channel      : ${channelName}`);
  console.log(`Mode         : ${r.creator_mode}`);
  console.log(`Peer source  : ${r.podcast_intel_peer_source  || '—'}`);
  console.log(`Peer count   : ${r.podcast_intel_peer_count   ?? '—'}`);
  console.log(`Shadow scored: ${shadow.scored_count           ?? '—'}`);
  console.log(`Shadow fall  : ${shadow.fallback_count         ?? '—'}`);
  console.log(`Shadow fmt   : ${JSON.stringify(shadow.format_counts ?? {})}`);

  console.log(`Guests (${guests.length}):`);
  if (guests.length === 0) {
    console.log(`  (none)`);
  } else {
    guests.slice(0, 5).forEach(g =>
      console.log(`  ${g.name.padEnd(24)} [${g.admission_reason}]`),
    );
    if (guests.length > 5) console.log(`  … +${guests.length - 5} more`);
  }

  console.log(`Themes (${themes.length}):`);
  if (themes.length === 0) {
    console.log(`  (none)`);
  } else {
    themes.slice(0, 5).forEach(t =>
      console.log(`  "${t.theme.padEnd(22)}" score=${t.score} peers=${t.peer_count}${t.already_covered ? ' [covered]' : ''}`),
    );
    if (themes.length > 5) console.log(`  … +${themes.length - 5} more`);
  }

  console.log(`Guest debug  : rejected=${gd.rejected_count ?? '—'} | single_cands=${gd.marker_single_peer_candidates ?? '—'} admitted=${gd.marker_single_peer_admitted ?? '—'} rejected_sp=${gd.marker_single_peer_rejected ?? '—'} | median_views=${gd.median_peer_video_views ?? '—'}`);
  console.log(`Theme debug  : guest_filter=${td.guest_filter_count ?? '—'} meta_filter=${td.meta_filter_count ?? '—'} brand_filter=${td.brand_filter_count ?? '—'} phrases=${td.phrases_extracted ?? '—'} after_filter=${td.phrases_after_filter ?? '—'}`);

  if (warnings.length) {
    console.log(`WARNINGS     : ${warnings.join(' | ')}`);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`Podcast Mode Validation  —  ${new Date().toISOString()}`);
  console.log(`Channels to audit: ${channels.map(c => c.channel_name).join(', ')}`);

  for (const ch of channels) {
    const url = `${SERVER_URL}/api/intel/what-to-post?channel_id=${ch.channel_id}&debug=true&use_creator_mode_peers=true`;
    let result;
    try {
      result = await fetchJSON(url);
    } catch (e) {
      console.log(`\n[ERROR] ${ch.channel_name}: ${e.message}`);
      continue;
    }

    if (!result.ok) {
      console.log(`\n[ERROR] ${ch.channel_name}: ${JSON.stringify(result).slice(0, 200)}`);
      continue;
    }

    printAudit(ch.channel_name, result);
  }

  console.log(`\n${'─'.repeat(62)}`);
  console.log('Done.\n');
  rawDb.close();
}

main().catch(e => {
  console.error('\nFatal:', e.message);
  process.exit(1);
});

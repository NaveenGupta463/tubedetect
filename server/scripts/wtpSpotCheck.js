'use strict';
// Raw WTP spot-check: runs the LIVE production path (computeWhatToPost + synthesis
// refiner) on a random spread of channels/niches and dumps the recommendations a user
// would actually see. No grading — just the data. Output: scripts/wtp_spotcheck.md
try { require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') }); } catch (_) {}
const path = require('path'); const fs = require('fs');
const { getDb } = require('../db/init');
const { computeWhatToPost } = require('../services/whatToPost');
const { buildWhatToPostContext } = require('../services/whatToPostContext');
const { refineWtpRecommendations } = require('../services/wtpRecommendationRefiner');

const TARGET_RECS = 100;
const PER_CHANNEL = 6;
const MAX_PER_NICHE = 2;
const OUT = path.resolve(__dirname, 'wtp_spotcheck.md');

const norm = t => String(t || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const sleep = ms => new Promise(r => setTimeout(r, ms));

function displayTitle(i) {
  return { title: i.ai_title || i.recommendation_title || i.angle_title || i.action_title || i.title || i.topic || i.raw_subject || '',
           synth: !!(i.ai_title), source: i.source || i.rec_source || (i.template_title ? 'dna_original_bet' : 'unknown') };
}

function collect(refined) {
  const A = Array.isArray(refined.original_bets?.ideas) ? refined.original_bets.ideas : (Array.isArray(refined.original_bets) ? refined.original_bets : []);
  const B = Array.isArray(refined.ideas) ? refined.ideas : [];
  const all = [...A, ...B].map(i => ({ ...displayTitle(i), score: Number(i.score ?? 0) }));
  const seen = new Set(); const out = [];
  for (const r of all.sort((a, b) => b.score - a.score)) {
    const k = norm(r.title); if (!r.title || !k || seen.has(k)) continue; seen.add(k); out.push(r);
  }
  return out.slice(0, PER_CHANNEL);
}

(async () => {
  const db = getDb();
  const ctx = buildWhatToPostContext();
  const westernOnly = process.argv.includes('--western');
  const regionClause = westernOnly ? `AND ic.region IN ('EN','US','GB','CA','AU','NZ','IE')` : '';
  const pool = db.all(`
    SELECT ic.channel_id, ic.channel_name, COALESCE(ic.primary_niche, ic.niche) AS niche, ic.channel_subscribers
    FROM ingested_channels ic JOIN creator_idea_dna dna ON dna.channel_id = ic.channel_id
    WHERE ic.ingest_enabled = 1 AND ic.channel_subscribers > 50000 AND ic.channel_name IS NOT NULL ${regionClause}
    ORDER BY RANDOM() LIMIT 120`);

  const nicheCount = {}; const picked = [];
  for (const ch of pool) {
    const n = ch.niche || 'unknown';
    if ((nicheCount[n] || 0) >= MAX_PER_NICHE) continue;
    nicheCount[n] = (nicheCount[n] || 0) + 1;
    picked.push(ch);
    if (picked.length >= 20) break;
  }

  const lines = ['# WTP Spot-Check — raw live recommendations (ungraded)', '',
    `Generated: ${new Date().toISOString().slice(0, 16).replace('T', ' ')} | live path: computeWhatToPost + synthesis refiner`,
    `Legend: ✦ = AI-synthesized title, · = template (synth declined)`, ''];
  let totalRecs = 0;
  for (const [i, ch] of picked.entries()) {
    if (totalRecs >= TARGET_RECS) break;
    let recs = [];
    try {
      const result = computeWhatToPost(db, { channel_id: ch.channel_id, niche: ch.niche }, ctx);
      const refined = await refineWtpRecommendations(db, result, { channel_id: ch.channel_id, niche: ch.niche });
      recs = collect(refined);
    } catch (e) { recs = [{ title: `(error: ${e.message})`, synth: false, source: 'error' }]; }
    const recent = db.all(`SELECT title FROM ingested_videos WHERE channel_id=? AND title IS NOT NULL ORDER BY published_at DESC LIMIT 6`, [ch.channel_id]).map(r => r.title);
    process.stdout.write(`(${i + 1}/${picked.length}) ${ch.channel_name} — ${recs.length} recs\n`);
    lines.push(`### [${ch.niche}] ${ch.channel_name}  ·  ${(ch.channel_subscribers || 0).toLocaleString()} subs`);
    lines.push('**Actually posts (recent uploads):**');
    recent.forEach(t => lines.push(`- ${t}`));
    lines.push('**WTP recommends:**');
    recs.forEach((r, n) => { lines.push(`${n + 1}. ${r.synth ? '✦' : '·'} ${r.title}  _(${r.source})_`); totalRecs++; });
    lines.push('');
    await sleep(800);
  }
  lines.splice(4, 0, `Channels: ${picked.length}  |  Recommendations: ${totalRecs}`, '');
  fs.writeFileSync(OUT, lines.join('\n'));
  console.log(`\nWrote ${totalRecs} recs across ${picked.length} channels → ${OUT}`);
})().catch(e => { console.error(e); process.exit(1); });

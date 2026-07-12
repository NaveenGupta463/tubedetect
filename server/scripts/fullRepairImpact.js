'use strict';

/**
 * fullRepairImpact.js
 *
 * Full-system repair impact analysis across all four populations:
 *   - 114 auto repairs (hard_conflict → identity_source='auto_repair')
 *   - Tier 1 (500 channels)
 *   - Tier 2 (2000 channels)
 *   - Tier 3 (1074 channels)
 *
 * Metrics per population:
 *   Topic Precision, Audience Precision, FP Rate, Community Precision,
 *   WTP Specificity, WTP Composite
 *
 * Niche breakdown: lifestyle, entertainment, music, travel, beauty, food
 */

require('dotenv').config({ path: __dirname + '/../.env' });

const path = require('path');
const BetterSqlite = require('../node_modules/better-sqlite3');
const { resolveCreatorPeerContext } = require('../services/creatorPeerContext');

const SAMPLE_PER_TIER = 350;  // max channels to peer-resolve per tier (for speed)
const FOCUS_NICHES    = ['lifestyle','entertainment','music','travel','beauty','food'];

// ── DB ────────────────────────────────────────────────────────────────────────
function openDb() {
  const raw = new BetterSqlite(path.resolve(__dirname, '../data/scoring.db'), {
    readonly: true, fileMustExist: true, timeout: 60000,
  });
  raw.pragma('journal_mode=WAL');
  raw.pragma('busy_timeout=60000');
  const cache = new Map();
  const stmt  = sql => { if (!cache.has(sql)) cache.set(sql, raw.prepare(sql)); return cache.get(sql); };
  return {
    all: (sql, p = []) => stmt(sql).all(Array.isArray(p) ? p : [p]),
    get: (sql, p = []) => stmt(sql).get(Array.isArray(p) ? p : [p]),
    close: () => { cache.clear(); raw.close(); },
  };
}

// ── Niche cluster map ─────────────────────────────────────────────────────────
const NICHE_CLUSTER_MAP = {
  entertainment:   ['entertainment','comedy','comedy sketches'],
  comedy:          ['comedy','entertainment','comedy sketches'],
  finance:         ['finance','personal finance','investing','stock market','cryptocurrency'],
  news:            ['news','current affairs','breaking news'],
  science:         ['science','technology','education'],
  technology:      ['technology','science','education'],
  education:       ['education','science','technology'],
  music:           ['music'],
  selfimprovement: ['selfimprovement','motivation','personal development'],
  motivation:      ['selfimprovement','motivation','personal development'],
  gaming:          ['gaming'],
  travel:          ['travel','travel vlogs'],
  food:            ['food','cooking','street food'],
  fitness:         ['fitness','workout','bodybuilding'],
  health:          ['health','wellness','nutrition'],
  lifestyle:       ['lifestyle','vlog','daily vlogs'],
  business:        ['business','entrepreneurship','startup'],
  sports:          ['sports'],
  politics:        ['politics'],
  geopolitics:     ['geopolitics'],
  defence:         ['defence'],
  yoga:            ['yoga'],
  meditation:      ['meditation'],
  beauty:          ['beauty'],
  other:           ['other'],
};
function getCluster(n) { return NICHE_CLUSTER_MAP[(n||'').toLowerCase()] || [(n||'').toLowerCase()].filter(Boolean); }
function nicheMatches(pn, cn) { return !!(pn && cn && getCluster(cn).includes(pn.toLowerCase())); }

// ── Helpers ───────────────────────────────────────────────────────────────────
function avg(arr) { const v = arr.filter(x => x != null && !isNaN(x)); return v.length ? v.reduce((s,x)=>s+x,0)/v.length : null; }
function med(arr) {
  const v = [...arr.filter(x => x != null && !isNaN(x))].sort((a,b)=>a-b);
  if (!v.length) return null;
  const m = Math.floor(v.length/2);
  return v.length%2===0 ? (v[m-1]+v[m])/2 : v[m];
}
function pp(n)   { return n==null?'—':(n>=0?'+':'')+n.toFixed(1)+'pp'; }
function pct(n)  { return n==null?'—':n.toFixed(1)+'%'; }
function flt(n)  { return n==null?'—':n.toFixed(1); }
function sub(n)  { if(!n)return'—'; if(n>=1e6)return(n/1e6).toFixed(1)+'M'; if(n>=1000)return(n/1000).toFixed(0)+'K'; return String(n); }
function pad(s,w){ return String(s??'').padEnd(w).slice(0,w); }
function rpad(s,w){ return String(s??'').padStart(w).slice(-w); }
function lbl(n,d=0){ return n==null?'—':n.toFixed(d); }

// ── Peer helpers ──────────────────────────────────────────────────────────────
function resolvePeerMeta(db, channelId) {
  try {
    const r = resolveCreatorPeerContext(db, channelId);
    const ids = r?.peerIds || [];
    if (!ids.length) return null;
    const ph = ids.map(()=>'?').join(',');
    return db.all(
      `SELECT ic.primary_niche, ic.audience_style, ic.region, ic.primary_language
       FROM ingested_channels ic WHERE ic.channel_id IN (${ph})`,
      ids,
    );
  } catch(_) { return null; }
}
function computeTP(peerMeta, niche) {
  if (!peerMeta?.length || !niche) return null;
  return peerMeta.filter(p=>nicheMatches(p.primary_niche, niche)).length / peerMeta.length * 100;
}
function computeAP(peerMeta, audienceStyle) {
  if (!peerMeta?.length || !audienceStyle) return null;
  return peerMeta.filter(p=>p.audience_style === audienceStyle).length / peerMeta.length * 100;
}
function computeCP(peerMeta, region, primaryLanguage) {
  if (!peerMeta?.length) return null;
  let matched = 0;
  for (const p of peerMeta) {
    if (region && p.region === region) { matched++; continue; }
    if (primaryLanguage && p.primary_language === primaryLanguage) matched++;
  }
  return matched / peerMeta.length * 100;
}

// ── WTP cache reader ──────────────────────────────────────────────────────────
function loadWtpCache(db, channelIds) {
  if (!channelIds.length) return {};
  const ph  = channelIds.map(()=>'?').join(',');
  const rows = db.all(
    `SELECT channel_id, payload_json FROM channel_wtp_cache WHERE channel_id IN (${ph}) AND status='ok'`,
    channelIds,
  );
  const out = {};
  for (const r of rows) {
    try {
      const payload = JSON.parse(r.payload_json);
      if (!payload.ok || !Array.isArray(payload.ideas)) { out[r.channel_id] = null; continue; }
      const ideas = payload.ideas.slice(0, 15);
      out[r.channel_id] = {
        ok:              true,
        wtp_specificity: ideas.length ? ideas.reduce((s,i)=>s+(i.specificity_score??0),0)/ideas.length : 0,
        wtp_composite:   ideas.length ? ideas.reduce((s,i)=>s+(i.score??0),0)/ideas.length : 0,
        wtp_idea_count:  ideas.length,
        niche_category:  payload.niche_category ?? null,
        channel_count:   payload.channel_count  ?? 0,
      };
    } catch(_) { out[r.channel_id] = null; }
  }
  return out;
}

// ── Metric aggregator ─────────────────────────────────────────────────────────
function aggregate(channels) {
  const withTP    = channels.filter(c => c.tp_after  != null);
  const withBefore= channels.filter(c => c.tp_before != null && c.tp_after != null);
  const changed   = channels.filter(c => c.niche_changed);
  const withAP    = channels.filter(c => c.ap_after  != null);
  const withCP    = channels.filter(c => c.cp        != null);
  const withWTP   = channels.filter(c => c.wtp?.ok);

  const lifts = withBefore.map(c => c.tp_after - c.tp_before);
  const regressed = lifts.filter(l => l < -10).length;

  return {
    n:               channels.length,
    n_changed:       changed.length,
    change_rate:     channels.length > 0 ? changed.length/channels.length*100 : null,
    tp_before_avg:   avg(channels.map(c=>c.tp_before)),
    tp_after_avg:    avg(withTP.map(c=>c.tp_after)),
    tp_lift_avg:     avg(lifts),
    tp_lift_med:     med(lifts),
    tp_high_after:   withTP.length ? withTP.filter(c=>c.tp_after>70).length/withTP.length*100 : null,
    fp_rate:         withBefore.length ? regressed/withBefore.length*100 : null,
    ap_avg:          avg(withAP.map(c=>c.ap_after)),
    cp_avg:          avg(withCP.map(c=>c.cp)),
    wtp_spec_avg:    avg(withWTP.map(c=>c.wtp.wtp_specificity)),
    wtp_comp_avg:    avg(withWTP.map(c=>c.wtp.wtp_composite)),
    wtp_n:           withWTP.length,
    peer_n_avg:      avg(channels.map(c=>c.peer_n).filter(n=>n!=null)),
  };
}

// ── Load all populations ──────────────────────────────────────────────────────
function loadAutoRepairs(db) {
  const rows = db.all(`
    SELECT ic.channel_id, ic.channel_name, ic.primary_niche AS new_niche,
           ic.audience_style, ic.region, ic.primary_language, ic.channel_subscribers,
           crc.current_niche AS old_niche, crc.repair_reason
    FROM ingested_channels ic
    JOIN classification_repair_candidates crc ON crc.channel_id = ic.channel_id
    WHERE ic.identity_source = 'auto_repair'
      AND crc.status = 'auto_repaired'
  `);
  return rows.map(r => ({
    ...r,
    tier:          'auto',
    niche_changed: r.old_niche !== r.new_niche ? 1 : 0,
  }));
}

function loadTierChannels(db, tier) {
  return db.all(`
    SELECT rl.channel_id, rl.channel_name,
           rl.old_niche, rl.new_niche,
           rl.old_archetype, rl.new_archetype,
           rl.niche_changed, rl.status,
           crc.repair_reason,
           ic.audience_style, ic.region, ic.primary_language, ic.channel_subscribers,
           ic.primary_niche
    FROM reclassification_log rl
    LEFT JOIN ingested_channels ic ON ic.channel_id = rl.channel_id
    LEFT JOIN classification_repair_candidates crc ON crc.channel_id = rl.channel_id
    WHERE rl.tier = ? AND rl.status IN ('reclassified','reclassified_no_change')
  `, [tier]).map(r => ({ ...r, tier }));
}

// ── Process one population ────────────────────────────────────────────────────
function processPopulation(db, channels, label) {
  process.stdout.write(`\n  Processing ${label} (${channels.length} channels)...`);

  // Limit peer resolution for speed; keep full WTP
  const sample = channels.length > SAMPLE_PER_TIER
    ? channels.filter((_,i) => i % Math.ceil(channels.length/SAMPLE_PER_TIER) === 0)
    : channels;

  const allIds = channels.map(c=>c.channel_id);
  const wtpMap = loadWtpCache(db, allIds);

  for (const ch of sample) {
    const peerMeta = resolvePeerMeta(db, ch.channel_id);
    ch.peer_n    = peerMeta?.length ?? 0;
    ch.tp_before = computeTP(peerMeta, ch.old_niche);
    ch.tp_after  = computeTP(peerMeta, ch.new_niche ?? ch.primary_niche ?? ch.old_niche);
    ch.ap_after  = computeAP(peerMeta, ch.audience_style);
    ch.cp        = computeCP(peerMeta, ch.region, ch.primary_language);
  }

  // Merge WTP for all (not just sample)
  for (const ch of channels) {
    ch.wtp = wtpMap[ch.channel_id] ?? null;
  }
  // For non-sampled, mark peer metrics null
  const sampledIds = new Set(sample.map(c=>c.channel_id));
  for (const ch of channels) {
    if (!sampledIds.has(ch.channel_id)) {
      ch.peer_n=null; ch.tp_before=null; ch.tp_after=null; ch.ap_after=null; ch.cp=null;
    }
  }

  process.stdout.write(` done (${sample.length} peer-resolved, ${channels.filter(c=>c.wtp?.ok).length} WTP)\n`);
  return channels;
}

// ─────────────────────────────────────────────────────────────────────────────

const db = openDb();

console.log('\n');
console.log('  ══════════════════════════════════════════════════════════════════════════════════════════════════');
console.log('  FULL-SYSTEM REPAIR IMPACT ANALYSIS');
console.log(`  ${new Date().toLocaleString()}`);
console.log('  ══════════════════════════════════════════════════════════════════════════════════════════════════');

// ── Load populations ──────────────────────────────────────────────────────────
console.log('\n  Loading repair populations...');
const autoChannels = loadAutoRepairs(db);
const t1Channels   = loadTierChannels(db, 1);
const t2Channels   = loadTierChannels(db, 2);
const t3Channels   = loadTierChannels(db, 3);

console.log(`  Auto repairs: ${autoChannels.length}  |  Tier 1: ${t1Channels.length}  |  Tier 2: ${t2Channels.length}  |  Tier 3: ${t3Channels.length}`);

// ── Process each population ───────────────────────────────────────────────────
processPopulation(db, autoChannels, 'Auto repairs');
processPopulation(db, t1Channels,   'Tier 1');
processPopulation(db, t2Channels,   'Tier 2');
processPopulation(db, t3Channels,   'Tier 3');

// ── Control group (unrepaired channels of similar niches) ─────────────────────
process.stdout.write('\n  Loading control group...');
const controlChannels = db.all(`
  SELECT ic.channel_id, ic.channel_name, ic.primary_niche AS new_niche,
         ic.primary_niche AS old_niche, ic.audience_style, ic.region, ic.primary_language,
         ic.channel_subscribers
  FROM ingested_channels ic
  WHERE ic.identity_source IN ('ai_detected','ai_redetect')
    AND ic.channel_id NOT IN (SELECT channel_id FROM reclassification_log)
    AND ic.channel_id NOT IN (SELECT channel_id FROM ingested_channels WHERE identity_source='auto_repair')
    AND ic.primary_niche IN ('lifestyle','entertainment','music','travel','beauty','food',
                             'gaming','education','news','finance')
  ORDER BY RANDOM() LIMIT 200
`).map(r => ({ ...r, tier: 'control', niche_changed: 0, repair_reason: null }));

processPopulation(db, controlChannels, 'Control group');

// ── Compute aggregates ────────────────────────────────────────────────────────
const populations = [
  { label: 'Auto repairs (114)',  key: 'auto', data: autoChannels },
  { label: 'Tier 1 (500)',        key: 't1',   data: t1Channels   },
  { label: 'Tier 2 (2000)',       key: 't2',   data: t2Channels   },
  { label: 'Tier 3 (1074)',       key: 't3',   data: t3Channels   },
  { label: 'Control (unrepaired)',key: 'ctrl', data: controlChannels },
];
const stats = {};
for (const { key, data } of populations) stats[key] = aggregate(data);

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 1: Main metrics table
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n\n  ── SECTION 1: KEY METRICS BY POPULATION ──────────────────────────────────────────────────────\n');
const COL = 18;
const hdr = (s,w=COL) => s.padStart(w).slice(-w);
const val = (n,d=1,w=COL) => (n==null?'—':n.toFixed(d)).padStart(w).slice(-w);

console.log(`  ${''.padEnd(26)} ${hdr('Auto repairs')} ${hdr('Tier 1')} ${hdr('Tier 2')} ${hdr('Tier 3')} ${hdr('Control')}\n`);

const rows = [
  { label: 'Channels processed',    fn: s=>lbl(s.n,0) },
  { label: 'Niche changes',         fn: s=>lbl(s.n_changed,0)+' ('+lbl(s.change_rate,0)+'%)' },
  { label: '──────────────────────',fn:_=>''},
  { label: 'Topic Prec. before',    fn: s=>pct(s.tp_before_avg) },
  { label: 'Topic Prec. after',     fn: s=>pct(s.tp_after_avg) },
  { label: 'Topic Prec. LIFT',      fn: s=>pp(s.tp_lift_avg) },
  { label: 'Topic Prec. median Δ',  fn: s=>pp(s.tp_lift_med) },
  { label: 'TP > 70% (after)',       fn: s=>pct(s.tp_high_after) },
  { label: '──────────────────────',fn:_=>''},
  { label: 'False Positive Rate',   fn: s=>pct(s.fp_rate) },
  { label: '──────────────────────',fn:_=>''},
  { label: 'Audience Precision',    fn: s=>pct(s.ap_avg) },
  { label: 'Community Precision',   fn: s=>pct(s.cp_avg) },
  { label: '──────────────────────',fn:_=>''},
  { label: 'WTP Specificity',       fn: s=>flt(s.wtp_spec_avg) },
  { label: 'WTP Composite',         fn: s=>flt(s.wtp_comp_avg) },
  { label: 'WTP coverage',          fn: s=>s.wtp_n+'/'+s.n },
  { label: '──────────────────────',fn:_=>''},
  { label: 'Avg peer pool size',    fn: s=>flt(s.peer_n_avg) },
];

for (const r of rows) {
  if (r.label.startsWith('──')) {
    console.log(`  ${'─'.repeat(26)} ${'─'.repeat(COL)} ${'─'.repeat(COL)} ${'─'.repeat(COL)} ${'─'.repeat(COL)} ${'─'.repeat(COL)}`);
    continue;
  }
  const auto = r.fn(stats.auto);
  const t1   = r.fn(stats.t1);
  const t2   = r.fn(stats.t2);
  const t3   = r.fn(stats.t3);
  const ctrl = r.fn(stats.ctrl);
  console.log(`  ${pad(r.label,26)} ${hdr(auto)} ${hdr(t1)} ${hdr(t2)} ${hdr(t3)} ${hdr(ctrl)}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 2: Niche breakdown
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n\n  ── SECTION 2: NICHE BREAKDOWN (lifestyle / entertainment / music / travel / beauty / food) ──────\n');

const allRepaired = [...autoChannels, ...t1Channels, ...t2Channels, ...t3Channels];

for (const niche of FOCUS_NICHES) {
  // Channels moving INTO this niche (old!=new, new=niche)
  const movedIn   = allRepaired.filter(c => c.niche_changed && (c.new_niche||c.primary_niche||'').toLowerCase()===niche);
  // Channels moving OUT of this niche (old=niche, new!=niche)
  const movedOut  = allRepaired.filter(c => c.niche_changed && (c.old_niche||'').toLowerCase()===niche);
  // Channels staying in niche (both old and new = niche)
  const confirmed = allRepaired.filter(c => !c.niche_changed && (c.old_niche||'').toLowerCase()===niche);
  // All channels currently in niche (after repair)
  const inNiche   = allRepaired.filter(c => ((c.new_niche||c.primary_niche)||'').toLowerCase()===niche);
  const inNicheStats = aggregate(inNiche.filter(c=>c.tp_after!=null));

  const lifts = inNiche.filter(c=>c.tp_after!=null&&c.tp_before!=null).map(c=>c.tp_after-c.tp_before);

  console.log(`  ┌─ ${niche.toUpperCase()} ──────────────────────────────────────────────────────────────────────────────────`);
  console.log(`  │  Channels moved IN:   ${movedIn.length.toString().padStart(4)}   moved OUT: ${movedOut.length.toString().padStart(4)}   confirmed: ${confirmed.length.toString().padStart(4)}`);
  if (inNiche.length > 0) {
    console.log(`  │  Topic precision:     before=${pct(inNicheStats.tp_before_avg).padStart(7)}  after=${pct(inNicheStats.tp_after_avg).padStart(7)}  lift=${pp(avg(lifts)).padStart(8)}`);
    console.log(`  │  Audience precision:  ${pct(inNicheStats.ap_avg).padStart(7)}   Community precision: ${pct(inNicheStats.cp_avg).padStart(7)}   FP rate: ${pct(inNicheStats.fp_rate).padStart(7)}`);
    console.log(`  │  WTP specificity:     ${flt(inNicheStats.wtp_spec_avg).padStart(6)}   WTP composite: ${flt(inNicheStats.wtp_comp_avg).padStart(6)}   TP>70%: ${pct(inNicheStats.tp_high_after).padStart(7)}`);
    // Top 5 moves INTO niche
    if (movedIn.length > 0) {
      const top5 = movedIn.filter(c=>c.tp_after!=null).sort((a,b)=>(b.tp_after-b.tp_before)-(a.tp_after-a.tp_before)).slice(0,5);
      if (top5.length) {
        console.log(`  │  Top migrations in:   ${top5.map(c=>`${c.old_niche}→${niche}(${c.channel_name.slice(0,20)})`).join(' | ')}`);
      }
    }
  }
  console.log(`  └──────────────────────────────────────────────────────────────────────────────────────────────`);
  console.log('');
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 3: Repair type ROI
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n  ── SECTION 3: REPAIR TYPE ROI ─────────────────────────────────────────────────────────────────\n');

const repairTypes = {};
for (const ch of allRepaired.filter(c=>c.tp_after!=null&&c.tp_before!=null)) {
  const key = ch.repair_reason || (ch.tier==='auto' ? 'hard_conflict' : 'unknown');
  if (!repairTypes[key]) repairTypes[key] = [];
  repairTypes[key].push(ch);
}

const rtStats = Object.entries(repairTypes).map(([type, chs]) => {
  const lifts = chs.map(c=>c.tp_after-c.tp_before);
  const regs  = lifts.filter(l=>l<-10).length;
  const imps  = lifts.filter(l=>l>10).length;
  return {
    type,
    n:         chs.length,
    n_changed: chs.filter(c=>c.niche_changed).length,
    avg_lift:  avg(lifts),
    med_lift:  med(lifts),
    fp_rate:   lifts.length ? regs/lifts.length*100 : null,
    imp_rate:  lifts.length ? imps/lifts.length*100 : null,
    wtp_spec:  avg(chs.filter(c=>c.wtp?.ok).map(c=>c.wtp.wtp_specificity)),
    roi_score: (avg(lifts)??0) * ((100-(lifts.length?regs/lifts.length*100:0))/100),
  };
}).sort((a,b)=>b.roi_score-a.roi_score);

console.log(`  ${pad('Repair type',28)} ${rpad('N',6)} ${rpad('Changed',9)} ${rpad('Avg lift',10)} ${rpad('Med lift',10)} ${rpad('FP rate',9)} ${rpad('Imp rate',10)} ${rpad('WTP spec',10)} ${rpad('ROI score',11)}\n`);
for (const r of rtStats) {
  console.log(
    `  ${pad(r.type,28)} ${rpad(r.n,6)} ${rpad(r.n_changed,9)} ${rpad(pp(r.avg_lift),10)} `+
    `${rpad(pp(r.med_lift),10)} ${rpad(pct(r.fp_rate),9)} ${rpad(pct(r.imp_rate),10)} `+
    `${rpad(flt(r.wtp_spec),10)} ${rpad(r.roi_score.toFixed(1),11)}`,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 4: Remaining problem niches
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n\n  ── SECTION 4: REMAINING PROBLEM NICHES (low tp_after post-repair) ──────────────────────────────\n');

const problematic = allRepaired.filter(c=>c.tp_after!=null && c.tp_after<40);
const nicheProbs = {};
for (const ch of problematic) {
  const n = (ch.new_niche||ch.primary_niche||'unknown').toLowerCase();
  if (!nicheProbs[n]) nicheProbs[n] = [];
  nicheProbs[n].push(ch);
}

const nicheOrder = Object.entries(nicheProbs).sort((a,b)=>b[1].length-a[1].length).slice(0,12);
console.log(`  ${pad('Niche',22)} ${rpad('Channels',10)} ${rpad('Avg tp_after',14)} ${rpad('Avg subs',10)} ${rpad('Common prev niche',20)}\n`);
for (const [niche, chs] of nicheOrder) {
  const prevNiches = {};
  for (const ch of chs) { const k=ch.old_niche||'?'; prevNiches[k]=(prevNiches[k]||0)+1; }
  const topPrev = Object.entries(prevNiches).sort((a,b)=>b[1]-a[1]).slice(0,3).map(([n,c])=>`${n}(${c})`).join(', ');
  console.log(
    `  ${pad(niche,22)} ${rpad(chs.length,10)} ${rpad(pct(avg(chs.map(c=>c.tp_after))),14)} `+
    `${rpad(sub(Math.round(avg(chs.map(c=>c.channel_subscribers)))),10)} ${topPrev}`,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 5: Remaining FP clusters
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n\n  ── SECTION 5: REMAINING FALSE-POSITIVE CLUSTERS ────────────────────────────────────────────────\n');

const fpChannels = allRepaired.filter(c=>c.tp_after!=null&&c.tp_before!=null && c.tp_after<c.tp_before-10);
console.log(`  Total regressions (post-repair): ${fpChannels.length} channels (${pct(fpChannels.length/Math.max(1,allRepaired.filter(c=>c.tp_after!=null&&c.tp_before!=null).length)*100)} of peer-resolved)`);

const fpNiche = {};
for (const ch of fpChannels) {
  const k = `${ch.old_niche}→${ch.new_niche||ch.primary_niche}`;
  if (!fpNiche[k]) fpNiche[k] = { n:0, lifts:[], chs:[] };
  fpNiche[k].n++;
  fpNiche[k].lifts.push(ch.tp_after-ch.tp_before);
  fpNiche[k].chs.push(ch);
}
const fpOrder = Object.entries(fpNiche).sort((a,b)=>b[1].n-a[1].n).slice(0,10);
if (fpOrder.length) {
  console.log(`\n  Top FP migration patterns:\n`);
  console.log(`  ${pad('Migration',34)} ${rpad('N',6)} ${rpad('Avg regress',13)}\n`);
  for (const [k,v] of fpOrder) {
    console.log(`  ${pad(k,34)} ${rpad(v.n,6)} ${rpad(pp(avg(v.lifts)),13)}`);
  }
}

// Channels still queued
const queued = db.get(`SELECT COUNT(*) as n FROM classification_repair_candidates WHERE status='queued'`);
console.log(`\n  Channels still queued for repair: ${queued?.n ?? '—'}`);

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 6: Strategic analysis
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n\n  ── SECTION 6: STRATEGIC ANALYSIS ──────────────────────────────────────────────────────────────\n');

const allTP = allRepaired.filter(c=>c.tp_after!=null).map(c=>c.tp_after);
const globalTPAfter = avg(allTP);
const globalTPBefore = avg(allRepaired.filter(c=>c.tp_before!=null).map(c=>c.tp_before));
const globalLift    = globalTPAfter && globalTPBefore ? globalTPAfter - globalTPBefore : null;
const highTPRate    = allTP.length ? allTP.filter(v=>v>70).length/allTP.length*100 : null;
const zeroTPRate    = allTP.length ? allTP.filter(v=>v===0).length/allTP.length*100 : null;

// Community health: channels with tiny peer pools (< 5 peers)
const tinyPeerChannels = allRepaired.filter(c=>c.peer_n!=null&&c.peer_n<5).length;
const peerResolved     = allRepaired.filter(c=>c.peer_n!=null).length;
const tinyPeerRate     = peerResolved ? tinyPeerChannels/peerResolved*100 : null;

// WTP coverage gap
const wtpCoverageAll = allRepaired.filter(c=>c.wtp?.ok).length / allRepaired.length * 100;

// Control baseline
const ctrlTPAfter   = avg(controlChannels.filter(c=>c.tp_after!=null).map(c=>c.tp_after));
const ctrlWTPSpec   = avg(controlChannels.filter(c=>c.wtp?.ok).map(c=>c.wtp.wtp_specificity));
const repWTPSpec    = avg(allRepaired.filter(c=>c.wtp?.ok).map(c=>c.wtp.wtp_specificity));

console.log(`  Total channels repaired:      ${autoChannels.length + t1Channels.length + t2Channels.length + t3Channels.length} (across all tiers)`);
console.log(`  Niche changes made:           ${[...autoChannels,...t1Channels,...t2Channels,...t3Channels].filter(c=>c.niche_changed).length}`);
console.log(`  Channels still queued:        ${queued?.n ?? '—'}`);
console.log('');
console.log(`  Global topic precision BEFORE: ${pct(globalTPBefore)}`);
console.log(`  Global topic precision AFTER:  ${pct(globalTPAfter)}  (lift ${pp(globalLift)})`);
console.log(`  Control group avg precision:   ${pct(ctrlTPAfter)}`);
console.log(`  Channels with TP > 70%:        ${pct(highTPRate)}`);
console.log(`  Channels with TP = 0% (no fit):${pct(zeroTPRate)}`);
console.log('');
console.log(`  WTP specificity (repaired):   ${flt(repWTPSpec)}`);
console.log(`  WTP specificity (control):    ${flt(ctrlWTPSpec)}`);
console.log(`  WTP coverage (repaired):      ${pct(wtpCoverageAll)}`);
console.log('');
console.log(`  Community health:`);
console.log(`    Channels with < 5 peers:    ${pct(tinyPeerRate)}  (${tinyPeerChannels}/${peerResolved} peer-resolved)`);
console.log(`    Avg peer pool size:         ${flt(avg(allRepaired.filter(c=>c.peer_n!=null).map(c=>c.peer_n)))}`);

console.log('\n  ── VERDICT ─────────────────────────────────────────────────────────────────────────────────────\n');

const classificationStillWeak  = (globalTPAfter ?? 0) < 55;
const communityBottleneck       = (tinyPeerRate ?? 0) > 25;
const wtpGapSignificant         = repWTPSpec != null && ctrlWTPSpec != null && repWTPSpec < ctrlWTPSpec - 5;
const remainingQueueLarge       = (queued?.n ?? 0) > 500;

if (classificationStillWeak && !communityBottleneck) {
  console.log('  🔴  Classification is still the primary bottleneck.');
  console.log(`      Global TP ${pct(globalTPAfter)} after repairs — far below 70% target.`);
  console.log(`      ${queued?.n} channels still queued. Continue classification repair.`);
} else if (communityBottleneck && !classificationStillWeak) {
  console.log('  🟡  Classification cleanup largely done. Community construction is now the bottleneck.');
  console.log(`      ${pct(tinyPeerRate)} of repaired channels have < 5 peers — peer pools too small to generate WTP signal.`);
  console.log('      Next lever: expand corpus in under-served niches to build denser peer communities.');
} else if (classificationStillWeak && communityBottleneck) {
  console.log('  🔴  Both classification AND community construction are bottlenecks.');
  console.log(`      Global TP ${pct(globalTPAfter)} — still low. Also ${pct(tinyPeerRate)} channels have < 5 peers.`);
  console.log('      Priority: fix classification first (peer quality depends on correct niche routing).');
} else {
  console.log('  🟢  Classification health is good. Community construction is the highest-leverage next project.');
  console.log(`      Global TP ${pct(globalTPAfter)} — above 55% target. ${pct(highTPRate)} channels have TP > 70%.`);
  if (wtpGapSignificant) {
    console.log(`      WTP specificity gap vs controls: ${flt(repWTPSpec)} vs ${flt(ctrlWTPSpec)} — invest in denser peer pools.`);
  }
  if (remainingQueueLarge) {
    console.log(`      ${queued?.n} channels still queued — worth a targeted pass on hard_conflict signals only.`);
  }
}

console.log('');
console.log('  ══════════════════════════════════════════════════════════════════════════════════════════════════\n');
db.close();

'use strict';

/**
 * Gold Dataset Expansion — 200 → 1000+ labels
 *
 * Seeds new rows into wtp_human_quality_reviews from traces not yet in the gold set.
 * Applies same heuristic labeling as wtpLabelGoldDataset.js.
 *
 * Stratification targets:
 *   dna_expansion_400   — 400 DNA original bets   (currently 50 in gold)
 *   peer_expansion      — all remaining peer_video_signal traces (~193)
 *   angle_gap_expansion — 200 angle_gap traces, post-P1 quality floor
 *   other_expansion     — all remaining territory_expansion + fallback_evergreen (~20)
 *
 * Quality floor (angle_gap):
 *   Reject if word_count < 6 AND no named entity (digit, known proper noun)
 *   Same logic as whatToPost.js P1 filter.
 *
 * Usage:
 *   node wtpExpandGoldDataset.js [--dry-run] [--limit=N]
 *   node wtpExpandGoldDataset.js --stats       # show current gold set stats
 */

const path = require('path');
const BetterSqlite3 = require('../node_modules/better-sqlite3');

const DRY_RUN = process.argv.includes('--dry-run');
const STATS   = process.argv.includes('--stats');
const LIMIT   = parseInt((process.argv.find(a => a.startsWith('--limit=')) || '').split('=')[1] || '0', 10) || null;

function openDb() {
  return new BetterSqlite3(path.resolve(__dirname, '../data/scoring.db'), {
    readonly: DRY_RUN || STATS,
    timeout:  60000,
  });
}

// ── Copy of P1 quality floor from whatToPost.js ───────────────────────────────
const PROPER_NOUNS = new Set([
  'trump','modi','biden','putin','xi','zelensky','netanyahu','khamenei','macron',
  'sunak','erdogan','obama','clinton','bush','kejriwal','rahul','gandhi','yogi',
  'shah','jaishankar','sitharaman','nitish','mamata','abe','kim','scholz',
  'china','chinese','pakistan','pakistani','russia','russian','ukraine','ukrainian',
  'iran','iranian','israel','israeli','america','american','usa','us','uk',
  'britain','british','france','french','germany','german','japan','japanese',
  'bangladesh','myanmar','afghanistan','nepal','taiwan','korea','turkish','saudi',
  'rbi','sebi','bcci','ipl','icc','nato','imf','isro','nasa','who','wto',
  'bjp','congress','aap','inc','sp','bsp','tmc','nda','upa','unsc',
  'apple','google','microsoft','amazon','tesla','openai','meta','samsung',
  'adani','ambani','tata','reliance','infosys','wipro','hdfc','sbi','icici',
  'delhi','mumbai','hyderabad','bangalore','bengaluru','chennai','kolkata',
  'ahmedabad','pune','jaipur','lucknow','patna','bhopal','chandigarh','bengal',
  'washington','moscow','beijing','london','paris','berlin','tokyo',
  'islamabad','lahore','karachi','dhaka','kathmandu','kabul','tehran',
  'jerusalem','kyiv','ankara','riyadh','dubai',
  'sensex','nifty','nse','bse','gdp','cpi','wpi','rupee','dollar','euro','yuan',
  'icc','cricket','virat','kohli','sachin','dhoni','rohit','bumrah','fifa',
  'election','elections','parliament','supreme','court','lok','rajya','sabha',
]);

function hasNamedEntity(topic) {
  return String(topic || '').toLowerCase().split(/\s+/).some(w =>
    /\d/.test(w) ||
    /^\d*(cr|lakh|k|m|b|%|\+)$/i.test(w) ||
    PROPER_NOUNS.has(w)
  );
}

function passesQualityFloor(title) {
  const wc = String(title || '').trim().split(/\s+/).filter(Boolean).length;
  return wc >= 6 || hasNamedEntity(title);
}

// ── Copy of labeling rules from wtpLabelGoldDataset.js ───────────────────────

const GARBAGE_RE = [
  [/\btv9\b|\bwion\b|\babp\s*news?\b|\bzee\s*news?\b|\bindia\s*tv\b|\bnews18\b|\bndtv\b/i,
    'TV news brand embedded'],
  [/cockroach/i, 'offensive content marker'],
  [/multiple variety.*knife|kitchen.*multiple variety/i, 'spam product dump'],
  [/vivo\s+x\d{3}|hyderabad sky lighting|sky lighting up with/i, 'branded ad'],
  [/^(kids fun learning|learn shapes little|kids learning educational)/i, 'generic children keyword dump'],
];

const POOR_RE = [
  [/\s+part\s*\d+\s*$/i, 'episode number suffix'],
  [/\blive\b\s*$/i, 'live stream suffix'],
  [/\b(chori ho gai|ki bike|\d+\s*lakh ki)\b/i, 'Hindi colloquial incident'],
  [/\bft\.\s+[A-Z]|\bfeat\.\s+[A-Z]/i, 'collab promotional format'],
  [/\bgodi\s+media\b/i, 'niche political slang'],
  [/\bkhabr\b|\bazam\b.*election|\belection.*azam\b/i, 'regional media brand'],
];

const AWKWARD_SLOT_RE = [
  [/\bcoins\s+crypto\b|\bcrypto\s+coins\b/i, 'awkward template: coins crypto'],
  [/\bstock\s+surged\b|\bstocks\s+rallying\b|\bstock\s+hits\s+upper\b/i, 'awkward template: market action'],
  [/\bchasing\s+stocks\s+financially\b/i, 'awkward template: ungrammatical'],
  [/\bbeginners?\s+crypto\b|\bcrypto\s+beginners?\b/i, 'awkward template: beginners crypto'],
  [/\broutine\s+healthy\b|\bhealthy\s+routine\s+routine\b/i, 'awkward template: redundant'],
  [/\bweight\s+loss\s+lose\b/i, 'awkward template: redundant'],
  [/^without\s+workout\s*:/i, 'awkward template: without workout'],
  [/improve\s+health\s+apps\b/i, 'awkward template: improve health apps'],
  [/^routine\s*:/i, 'template slot too generic: Routine'],
  [/\bfood\s+dishes\b/i, 'template slot redundant: food dishes'],
  [/beginner\s+mistake\s+inside.*\bbeginners\b/i, 'template slot redundancy'],
  [/\bbeginners?\s+mistake\s+behind\s+routine\b/i, 'awkward slot: routine'],
];

const EXCELLENT_RE = [
  /we thought.*singularities/i,
  /tiger that was forced to hunt/i,
  /santro.*family.*years?\s+of\s+memories/i,
  /trump\s+can['']?t\s+negotiate/i,
];

const GOOD_RE = [
  /mumbai\s+style\s+vada\s+pav\s+with\s+garlic\s+chutney/i,
  /trump\S*\s+china\s+visit\s+impacts?\s+india/i,
  /apple\s+biggest\s+wwdc\s+surprise/i,
  /before\s+you\s+trust\s+(crypto\s+coins|stock\s+market|mutual\s+fund|sip\s+choice)/i,
  /stock\s+jumps?\s*:.*risk,\s*returns/i,
  /practical\s+checklist\s+for\s+(sip|stock\s+market|mutual\s+fund)/i,
  /packaged\s+food\s+labels?\s*:.*what\s+to\s+do/i,
  /thai\s+street\s+food\s+combo.*at\s+home/i,
  /beginner\s+mistake\s+behind\s+(fitness\s+supplements|protein\s+snacks|low\s+carb|back\s+pain|fat\s+loss)/i,
  /achieve\s+weight\s+loss\s*:.*7.?day\s+routine/i,
  /weight\s+loss\s+transformation\s*:.*what\s+to\s+do/i,
  /ingredient\s+mistake\s+that\s+ruins.*street\s+food/i,
  /regional\s+twist\s+on\s+desi\s+street\s+food/i,
  /desi\s+food\s*:?\s*quick\s+version\s+for\s+busy/i,
  /food\s+competition.*budget\s+version\s+vs.*restaurant/i,
  /desi\s+food\s+competition.*budget\s+version/i,
  /no-?equipment\s+way\s+to\s+improve\s+(fat\s+loss|carb\s+plan)/i,
  /beginner\s+mistake\s+behind\s+low\s+carb/i,
  /back\s+pain\s*:.*what\s+to\s+do.*avoid/i,
  /workout\s+culture\s*:.*routine\s+for\s+people\s+starting\s+late/i,
];

const HAS_CONNECTOR = /\b(vs|in|of|for|the|a|an|is|are|was|were|how|why|what|with|or|to|at|on|by|from|can|will|did|does|through|about|when|where|if|but|before|after|without|during|inside|behind|that|this|your|my|our|and)\b/i;
const HAS_VERB      = /\b(is|are|was|were|will|can|does|do|did|have|has|had|make|makes|made|shows|reveals|explains|breaks|watch|see|trust|check|learn|teach|teaches|find|finds|start|build|grow|create|change|improve|avoid|achieve|compare|win|lose|buy|sell|invest|save|spend|cook|eat|try|get|take|give|use|run|stop|need|want|know|understand|explore|discover|follow|fix|help|hit|crash|fall|rises?|drops?|jumps?|adds?|cuts?|raises?|says?|told|tells|forces?|forced|thought|ended|impacts?|lighting)\b/i;

function classifyTitle(title, conceptId, conceptConf) {
  const t = (title || '').trim();
  const words = t.split(/\s+/).filter(Boolean);
  const wc    = words.length;

  if (!t || wc === 0) return { label: 'Garbage', reason: 'empty title' };

  for (const [re, reason] of GARBAGE_RE) {
    if (re.test(t)) return { label: 'Garbage', reason };
  }
  if (wc <= 2 && !/\bvs\.?\b/i.test(t)) {
    return { label: 'Garbage', reason: 'too short to be actionable' };
  }
  const tokens = words.map(w => w.toLowerCase().replace(/[^a-z0-9]/g, '')).filter(w => w.length > 2);
  const unique  = new Set(tokens);
  if (unique.size < tokens.length && wc <= 6) {
    return { label: 'Garbage', reason: 'repeated keyword — incoherent' };
  }

  for (const re of EXCELLENT_RE) {
    if (re.test(t)) return { label: 'Excellent', reason: 'compelling narrative hook with specific story' };
  }

  for (const [re, reason] of POOR_RE) {
    if (re.test(t)) return { label: 'Poor', reason };
  }
  for (const [re, reason] of AWKWARD_SLOT_RE) {
    if (re.test(t)) return { label: 'Poor', reason };
  }

  if (!HAS_CONNECTOR.test(t) && !HAS_VERB.test(t) && wc <= 5) {
    return { label: 'Poor', reason: 'keyword dump — no sentence structure' };
  }

  for (const re of GOOD_RE) {
    if (re.test(t)) {
      const boost = conceptId && (conceptConf || 0) >= 0.60;
      return { label: 'Good', reason: boost ? 'specific topic with strong concept match' : 'specific topic with clear format or mechanism' };
    }
  }

  if (wc >= 6) {
    if (conceptId && (conceptConf || 0) >= 0.60) return { label: 'Average', reason: 'reasonable specificity with concept match' };
    if (conceptId) return { label: 'Average', reason: 'sufficient length with weak concept signal' };
    return { label: 'Average', reason: 'sufficient length but generic angle' };
  }
  if (wc <= 4) return { label: 'Poor', reason: 'too short, lacks clear angle' };
  return { label: 'Average', reason: 'moderate specificity; recognizable but not distinctive' };
}

// ── Batches ───────────────────────────────────────────────────────────────────

const EXPANSION_BATCHES = [
  {
    id:     'dna_expansion_400',
    source: 'dna_original_bets',
    limit:  400,
    filter: null, // no extra filter for DNA
    label:  'DNA original bets expansion (400)',
  },
  {
    id:     'peer_expansion',
    source: 'peer_video_signal',
    limit:  250, // up to 193 available
    filter: null,
    label:  'Peer video signal expansion (all remaining)',
  },
  {
    id:     'angle_gap_expansion_200',
    source: 'angle_gap',
    limit:  300, // fetch 300, keep 200 after quality floor
    filter: passesQualityFloor,
    filterTarget: 200,
    label:  'Angle gap expansion (200, post P1 quality floor)',
  },
  {
    id:     'other_expansion',
    source: null, // multiple sources
    limit:  30,
    filter: null,
    label:  'Territory expansion + fallback evergreen (all remaining)',
  },
];

function main() {
  const db = openDb();

  if (STATS) {
    const total = db.prepare('SELECT COUNT(*) as n FROM wtp_human_quality_reviews').get().n;
    const byLabel = db.prepare('SELECT human_label, COUNT(*) as n FROM wtp_human_quality_reviews WHERE human_label IS NOT NULL GROUP BY human_label ORDER BY n DESC').all();
    const bySrc   = db.prepare('SELECT rec_source, COUNT(*) as n, SUM(CASE WHEN human_label IN (\'Excellent\',\'Good\') THEN 1 ELSE 0 END) as pos FROM wtp_human_quality_reviews WHERE human_label IS NOT NULL GROUP BY rec_source').all();
    console.log('\n── Gold Dataset Stats ──────────────────────────────────────');
    console.log(`  Total rows: ${total}`);
    console.log('\n  By label:');
    for (const r of byLabel) console.log(`    ${r.human_label.padEnd(10)} ${r.n}`);
    console.log('\n  By source:');
    for (const r of bySrc) console.log(`    ${(r.rec_source||'unknown').padEnd(24)} n=${r.n} pos=${r.pos}`);
    db.close();
    return;
  }

  // Load already-seeded trace IDs to avoid duplicates
  const seededTraceIds = new Set(
    db.prepare('SELECT trace_id FROM wtp_human_quality_reviews WHERE trace_id IS NOT NULL').all().map(r => r.trace_id)
  );

  const insertRow = DRY_RUN ? () => {} : db.prepare(`
    INSERT OR IGNORE INTO wtp_human_quality_reviews
      (batch_id, trace_id, channel_id, rec_source, family, archetype, raw_subject,
       generated_title, concept_id, concept_label, concept_confidence,
       dna_affinity_score, score, human_label, reviewer_notes)
    VALUES
      (@batch_id, @trace_id, @channel_id, @rec_source, @family, @archetype, @raw_subject,
       @generated_title, @concept_id, @concept_label, @concept_confidence,
       @dna_affinity_score, @score, @human_label, @reviewer_notes)
  `);

  const runBatch = DRY_RUN ? rows => {} : db.transaction(rows => {
    for (const r of rows) insertRow.run(r);
  });

  let totalSeeded = 0;
  const labelCounts = {};

  for (const batch of EXPANSION_BATCHES) {
    let rows;
    if (batch.source) {
      rows = db.prepare(`
        SELECT t.id, t.channel_id, t.rec_source, t.family, t.archetype, t.raw_subject,
               t.generated_title, t.concept_id, t.concept_label, t.concept_confidence,
               t.dna_affinity_score, t.wtp_score,
               COALESCE(t.wtp_score,
                 CASE WHEN t.dna_affinity_score > 2 THEN CAST(t.dna_affinity_score AS INTEGER)
                      ELSE CAST(t.dna_affinity_score * 100 AS INTEGER) END
               ) AS norm_score
        FROM wtp_generation_traces t
        WHERE t.rec_source = ?
          AND t.generated_title IS NOT NULL
          AND t.generated_title != ''
        ORDER BY norm_score DESC NULLS LAST, RANDOM()
        LIMIT ?
      `).all(batch.source, batch.limit * 3); // fetch 3x to have room for filters
    } else {
      rows = db.prepare(`
        SELECT t.id, t.channel_id, t.rec_source, t.family, t.archetype, t.raw_subject,
               t.generated_title, t.concept_id, t.concept_label, t.concept_confidence,
               t.dna_affinity_score, t.wtp_score,
               COALESCE(t.wtp_score,
                 CASE WHEN t.dna_affinity_score > 2 THEN CAST(t.dna_affinity_score AS INTEGER)
                      ELSE CAST(t.dna_affinity_score * 100 AS INTEGER) END
               ) AS norm_score
        FROM wtp_generation_traces t
        WHERE t.rec_source IN ('territory_expansion','fallback_evergreen')
          AND t.generated_title IS NOT NULL
          AND t.generated_title != ''
        ORDER BY norm_score DESC NULLS LAST, RANDOM()
        LIMIT ?
      `).all(batch.limit * 2);
    }

    // Filter already-seeded, apply optional quality floor
    const toSeed = [];
    for (const row of rows) {
      if (seededTraceIds.has(row.id)) continue;
      if (batch.filter && !batch.filter(row.generated_title)) continue;
      toSeed.push(row);
      const target = batch.filterTarget || batch.limit;
      if (toSeed.length >= (LIMIT ? Math.min(target, LIMIT) : target)) break;
    }

    const insertRows = toSeed.map(row => {
      const { label, reason } = classifyTitle(row.generated_title, row.concept_id, row.concept_confidence);
      labelCounts[label] = (labelCounts[label] || 0) + 1;
      return {
        batch_id:           batch.id,
        trace_id:           row.id,
        channel_id:         row.channel_id || null,
        rec_source:         row.rec_source,
        family:             row.family || null,
        archetype:          row.archetype || null,
        raw_subject:        row.raw_subject || null,
        generated_title:    row.generated_title,
        concept_id:         row.concept_id || null,
        concept_label:      row.concept_label || null,
        concept_confidence: row.concept_confidence ?? null,
        dna_affinity_score: row.dna_affinity_score ?? null,
        score:              row.norm_score ?? null,
        human_label:        label,
        reviewer_notes:     reason,
      };
    });

    runBatch(insertRows);
    toSeed.forEach(r => seededTraceIds.add(r.id));
    totalSeeded += insertRows.length;

    const byLbl = {};
    for (const r of insertRows) byLbl[r.human_label] = (byLbl[r.human_label] || 0) + 1;
    const lbl = ['Excellent','Good','Average','Poor','Garbage'].map(l => `${l.slice(0,3)}:${byLbl[l]||0}`).join(' ');
    console.log(`  [${DRY_RUN ? 'DRY' : 'SEED'}] ${batch.id.padEnd(30)} +${insertRows.length}  ${lbl}`);
  }

  const total = db.prepare('SELECT COUNT(*) as n FROM wtp_human_quality_reviews').get().n;
  const labeled = db.prepare('SELECT COUNT(*) as n FROM wtp_human_quality_reviews WHERE human_label IS NOT NULL').get().n;

  console.log('\n══════════════════════════════════════════════════════════════');
  console.log(`  Gold dataset: ${total} total rows (${labeled} labeled)`);
  console.log(`  New rows seeded: ${totalSeeded} (${DRY_RUN ? 'DRY RUN — nothing written' : 'written'})`);
  console.log('\n  Labels assigned this run:');
  for (const [lbl, n] of Object.entries(labelCounts).sort((a,b) => b[1]-a[1])) {
    const posRate = ['Excellent','Good'].includes(lbl) ? ' ← positive' : '';
    console.log(`    ${lbl.padEnd(10)} ${n}${posRate}`);
  }
  const newPos = (labelCounts['Excellent'] || 0) + (labelCounts['Good'] || 0);
  const newTotal = totalSeeded;
  if (newTotal > 0) {
    console.log(`\n  New batch positive rate: ${(newPos/newTotal*100).toFixed(1)}%`);
  }
  console.log('══════════════════════════════════════════════════════════════\n');

  db.close();
}

main();

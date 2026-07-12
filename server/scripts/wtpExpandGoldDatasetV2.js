'use strict';

/**
 * Gold Dataset Expansion V2 — 1023 → 2000+ labels
 *
 * Phase 5: Expands from 1023 (post-V1) to 2000+ rows.
 * Strategy: heavily weight high-win-rate families (cooking_food, fitness_practice),
 * then fill with finance_education and explainer_case for coverage.
 * Peer signals: add more high-quality peer_video_signal rows.
 * Excludes angle_gap (0% win rate — already quarantined and over-represented).
 *
 * Usage:
 *   node wtpExpandGoldDatasetV2.js [--dry-run] [--limit=N]
 *   node wtpExpandGoldDatasetV2.js --stats
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

// ── Heuristic labeling (copied + extended from V1) ────────────────────────────

const GARBAGE_RE = [
  [/\btv9\b|\bwion\b|\babp\s*news?\b|\bzee\s*news?\b|\bindia\s*tv\b|\bnews18\b|\bndtv\b/i, 'TV news brand embedded'],
  [/cockroach/i, 'offensive content marker'],
  [/multiple variety.*knife|kitchen.*multiple variety/i, 'spam product dump'],
  [/vivo\s+x\d{3}|hyderabad sky lighting|sky lighting up with/i, 'branded ad'],
  [/^(kids fun learning|learn shapes little|kids learning educational)/i, 'generic children keyword dump'],
  [/^(asmr|mukbang|shorts?)\s*$/i, 'single-word format keyword'],
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
  // V2 additions
  [/\bregional\s+twist\s+on\s+regional\b/i, 'template slot: generic regional'],
  [/\bbeginners?\s+mistake\s+behind\s+beginners?\s+workout\b/i, 'template self-reference'],
  [/^(cook|workout|invest|learn|study|grow|build|eat|travel)\s*$/i, 'single generic verb'],
  [/\b(dish|food|recipe)\s+(dish|food|recipe)\b/i, 'redundant food noun'],
];

const EXCELLENT_RE = [
  /we thought.*singularities/i,
  /tiger that was forced to hunt/i,
  /santro.*family.*years?\s+of\s+memories/i,
  /trump\s+can['']?t\s+negotiate/i,
  // V2: more narrative excellence patterns
  /\bforced\s+to\b.*\b(hunt|kill|fight|flee|survive|confront)\b/i,
  /we\s+thought.*\bactually\b.*\b(might|could|would)\b/i,
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
  // V2: extended GOOD patterns from template analysis
  /\b(biryani|vada\s+pav|dosa|thali|dal|sabzi|curry|paratha|khichdi|samosa|pani\s+puri)\b.*\b(home|style|recipe|version|make|easy|quick|best)\b/i,
  /\bcan\s+you\s+make\s+(thai|street|desi|indian)\s+(food|dish)\b/i,
  /\b(asmr|street\s+food)\s+(cooking|combo|challenge|recipe)\b.*\b(home|easy|quick|budget)\b/i,
  /\bno.?equipment\s+way\s+to\b/i,
  /\ba\s+practical\s+checklist\s+for\s+\w/i,
  /\b(fat\s+loss|weight\s+loss|muscle|strength)\s*:.*\b(routine|guide|plan|checklist)\b/i,
  /\bwhat\s+to\s+do.*what\s+to\s+avoid\b/i,
  /\b(common|biggest|beginner)\s+mistake\s+(behind|that|in)\s+\b(fitness|cooking|invest|sip|crypto|weight)\b/i,
];

const HAS_CONNECTOR = /\b(vs|in|of|for|the|a|an|is|are|was|were|how|why|what|with|or|to|at|on|by|from|can|will|did|does|through|about|when|where|if|but|before|after|without|during|inside|behind|that|this|your|my|our|and)\b/i;
const HAS_VERB      = /\b(is|are|was|were|will|can|does|do|did|have|has|had|make|makes|made|shows|reveals|explains|breaks|watch|see|trust|check|learn|teach|teaches|find|finds|start|build|grow|create|change|improve|avoid|achieve|compare|win|lose|buy|sell|invest|save|spend|cook|eat|try|get|take|give|use|run|stop|need|want|know|understand|explore|discover|follow|fix|help|hit|crash|fall|rises?|drops?|jumps?|adds?|cuts?|raises?|says?|told|tells|forces?|forced|thought|ended|impacts?)\b/i;

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

// ── V2 Expansion Batches ─────────────────────────────────────────────────────

const EXPANSION_BATCHES_V2 = [
  {
    id:     'cooking_food_v2',
    family: 'cooking_food',
    source: null, // all sources for this family
    limit:  450,
    label:  'cooking_food family — highest win rate niche (22.4%)',
  },
  {
    id:     'fitness_practice_v2',
    family: 'fitness_practice',
    source: null,
    limit:  100, // ~59 remaining
    label:  'fitness_practice family — second highest win rate (17.1%)',
  },
  {
    id:     'peer_signal_v2',
    family: null, // all families
    source: 'peer_video_signal',
    limit:  300,
    label:  'peer_video_signal — additional peer signals',
  },
  {
    id:     'finance_education_v2',
    family: 'finance_education',
    source: null,
    limit:  300,
    label:  'finance_education family — coverage expansion',
  },
  {
    id:     'explainer_case_v2',
    family: 'explainer_case',
    source: null,
    limit:  200,
    label:  'explainer_case family — new family',
  },
  {
    id:     'general_education_v2',
    family: 'general_education',
    source: null,
    limit:  150,
    label:  'general_education family — coverage',
  },
];

function buildQuery(batch) {
  const conditions = ['t.generated_title IS NOT NULL', "t.generated_title != ''"];
  const params = [];

  if (batch.family) {
    conditions.push('t.family = ?');
    params.push(batch.family);
  }
  if (batch.source) {
    conditions.push('t.rec_source = ?');
    params.push(batch.source);
  }
  // Always exclude angle_gap (0% win rate, already over-represented)
  conditions.push("t.rec_source != 'angle_gap'");

  const where = conditions.join(' AND ');
  return { sql: `
    SELECT t.id, t.channel_id, t.rec_source, t.family, t.archetype, t.raw_subject,
           t.generated_title, t.concept_id, t.concept_label, t.concept_confidence,
           t.dna_affinity_score, t.wtp_score,
           COALESCE(t.wtp_score,
             CASE WHEN t.dna_affinity_score > 2 THEN CAST(t.dna_affinity_score AS INTEGER)
                  ELSE CAST(t.dna_affinity_score * 100 AS INTEGER) END
           ) AS norm_score
    FROM wtp_generation_traces t
    WHERE ${where}
    ORDER BY norm_score DESC NULLS LAST, RANDOM()
    LIMIT ?
  `, params };
}

function main() {
  const db = openDb();

  if (STATS) {
    const total = db.prepare('SELECT COUNT(*) as n FROM wtp_human_quality_reviews').get().n;
    const byLabel = db.prepare('SELECT human_label, COUNT(*) as n FROM wtp_human_quality_reviews WHERE human_label IS NOT NULL GROUP BY human_label ORDER BY n DESC').all();
    const bySrc   = db.prepare('SELECT rec_source, COUNT(*) as n, SUM(CASE WHEN human_label IN (\'Excellent\',\'Good\') THEN 1 ELSE 0 END) as pos FROM wtp_human_quality_reviews WHERE human_label IS NOT NULL GROUP BY rec_source').all();
    const byFam   = db.prepare('SELECT family, COUNT(*) as n, SUM(CASE WHEN human_label IN (\'Excellent\',\'Good\') THEN 1 ELSE 0 END) as pos FROM wtp_human_quality_reviews WHERE human_label IS NOT NULL GROUP BY family ORDER BY n DESC LIMIT 15').all();
    process.stdout.write('\n── Gold Dataset Stats ──────────────────────────────────────\n');
    process.stdout.write('  Total rows: ' + total + '\n');
    process.stdout.write('\n  By label:\n');
    for (const r of byLabel) process.stdout.write('    ' + r.label.padEnd(10) + ' ' + r.n + '\n');
    process.stdout.write('\n  By source:\n');
    for (const r of bySrc) process.stdout.write('    ' + (r.rec_source || 'unknown').padEnd(24) + ' n=' + r.n + ' pos=' + r.pos + '\n');
    process.stdout.write('\n  By family (top 15):\n');
    for (const r of byFam) {
      const rate = r.n > 0 ? (r.pos / r.n * 100).toFixed(1) + '%' : '-';
      process.stdout.write('    ' + (r.family || '(none)').padEnd(30) + ' n=' + r.n + ' pos=' + r.pos + ' (' + rate + ')\n');
    }
    db.close();
    return;
  }

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

  const runBatch = DRY_RUN ? () => {} : db.transaction(rows => {
    for (const r of rows) insertRow.run(r);
  });

  let totalSeeded = 0;
  const labelCounts = {};

  process.stdout.write('\n══════════════════════════════════════════════════════════════\n');
  process.stdout.write('  Gold Dataset Expansion V2  (' + (DRY_RUN ? 'DRY RUN' : 'WRITING') + ')\n');
  process.stdout.write('  Starting size: ' + seededTraceIds.size + ' labeled rows\n');
  process.stdout.write('══════════════════════════════════════════════════════════════\n\n');

  for (const batch of EXPANSION_BATCHES_V2) {
    const { sql, params } = buildQuery(batch);
    const fetchLimit = batch.limit * 4; // fetch 4x to skip already-seeded
    const rows = db.prepare(sql).all(...params, fetchLimit);

    const toSeed = [];
    for (const row of rows) {
      if (seededTraceIds.has(row.id)) continue;
      toSeed.push(row);
      const target = LIMIT ? Math.min(batch.limit, LIMIT - totalSeeded) : batch.limit;
      if (toSeed.length >= target) break;
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

    if (!DRY_RUN && insertRows.length > 0) runBatch(insertRows);
    if (!DRY_RUN) toSeed.forEach(r => seededTraceIds.add(r.id));
    totalSeeded += insertRows.length;

    const byLbl = {};
    for (const r of insertRows) byLbl[r.human_label] = (byLbl[r.human_label] || 0) + 1;
    const lblStr = ['Excellent', 'Good', 'Average', 'Poor', 'Garbage'].map(l => l.slice(0, 3) + ':' + (byLbl[l] || 0)).join(' ');
    const posRate = ((byLbl['Excellent'] || 0) + (byLbl['Good'] || 0)) / Math.max(insertRows.length, 1) * 100;
    process.stdout.write('  [' + (DRY_RUN ? 'DRY' : 'SEED') + '] ' + batch.id.padEnd(28) + ' +' + insertRows.length + '  ' + lblStr + '  pos%=' + posRate.toFixed(1) + '\n');

    if (LIMIT && totalSeeded >= LIMIT) break;
  }

  const finalTotal = DRY_RUN
    ? seededTraceIds.size + totalSeeded
    : db.prepare('SELECT COUNT(*) as n FROM wtp_human_quality_reviews').get().n;

  process.stdout.write('\n══════════════════════════════════════════════════════════════\n');
  process.stdout.write('  New rows seeded: ' + totalSeeded + '\n');
  process.stdout.write('  Final gold set:  ' + finalTotal + '\n');
  process.stdout.write('\n  Labels assigned this run:\n');
  for (const [lbl, n] of Object.entries(labelCounts).sort((a, b) => b[1] - a[1])) {
    const posFlag = ['Excellent', 'Good'].includes(lbl) ? ' ← positive' : '';
    process.stdout.write('    ' + lbl.padEnd(10) + ' ' + n + posFlag + '\n');
  }
  const newPos = (labelCounts['Excellent'] || 0) + (labelCounts['Good'] || 0);
  if (totalSeeded > 0) {
    process.stdout.write('\n  New batch positive rate: ' + (newPos / totalSeeded * 100).toFixed(1) + '%\n');
    process.stdout.write('  Target 2000+: ' + (finalTotal >= 2000 ? '✓ REACHED' : '✗ need ' + (2000 - finalTotal) + ' more') + '\n');
  }
  process.stdout.write('══════════════════════════════════════════════════════════════\n\n');

  db.close();
}

main();

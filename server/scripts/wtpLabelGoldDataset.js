'use strict';

/**
 * Phase 1 — Gold Dataset Labeler
 *
 * Labels all 200 rows in wtp_human_quality_reviews based on title quality,
 * concept signal, and source type. Applies consistent heuristic rules so
 * the labeling criteria are transparent and reproducible.
 *
 * Label scale:
 *   Excellent  — compelling hook, specific story/angle, immediately actionable
 *   Good       — specific topic with clear format or mechanism
 *   Average    — recognizable topic, some structure, but generic angle
 *   Poor       — keyword dump, awkward template slot, incomplete phrase
 *   Garbage    — incoherent, brand-embedded, spam, or live-stream artifact
 *
 * Duplicates (same title seen ≥2 times) are labeled identically and noted.
 *
 * Usage:
 *   node wtpLabelGoldDataset.js [--dry-run]   (dry-run: print without writing)
 */

const path = require('path');
const BetterSqlite3 = require('../node_modules/better-sqlite3');

const DRY_RUN = process.argv.includes('--dry-run');

function openDb() {
  return new BetterSqlite3(path.resolve(__dirname, '../data/scoring.db'), {
    readonly: DRY_RUN,
    timeout: 60000,
  });
}

// ── Classification rules ──────────────────────────────────────────────────────

// Garbage: content that should never appear as a recommendation
const GARBAGE_RE = [
  [/\btv9\b|\bwion\b|\babp\s*news?\b|\bzee\s*news?\b|\bindia\s*tv\b|\bnews18\b|\bndtv\b/i,
    'TV news brand embedded — keyword extracted from broadcast, not a recommendation'],
  [/cockroach/i,
    'offensive political slang in title — not a valid recommendation'],
  [/multiple variety.*knife|kitchen.*multiple variety/i,
    'spam product dump — incoherent title'],
  [/vivo\s+x\d{3}|hyderabad sky lighting|sky lighting up with/i,
    'branded ad / sponsored content — not organic recommendation'],
  [/^(kids fun learning|learn shapes little|kids learning educational)/i,
    'generic children\'s keyword dump — no specificity or angle'],
];

// Poor: real content but not usable as a recommendation
const POOR_RE = [
  [/\s+part\s*\d+\s*$/i,
    'episode number suffix — series content, not a standalone recommendation'],
  [/\blive\b\s*$/i,
    'live stream title — not reusable as a recommendation'],
  [/\b(chori ho gai|ki bike|\d+\s*lakh ki)\b/i,
    'Hindi colloquial incident — not structured as a recommendation'],
  [/\bft\.\s+[A-Z]|\bfeat\.\s+[A-Z]/i,
    'collab promotional format — not a topic recommendation'],
  [/\bgodi\s+media\b/i,
    'niche political slang — not broadly actionable'],
  [/\bkhabr\b|\bazam\b.*election|\belection.*azam\b/i,
    'regional media brand in title — keyword extraction artifact'],
];

// Awkward DNA template slot fills → Poor
const AWKWARD_SLOT_RE = [
  [/\bcoins\s+crypto\b|\bcrypto\s+coins\b/i,
    'awkward template slot — "coins crypto" is unnatural'],
  [/\bstock\s+surged\b|\bstocks\s+rallying\b|\bstock\s+hits\s+upper\b/i,
    'awkward template slot — market action used as static subject'],
  [/\bchasing\s+stocks\s+financially\b/i,
    'awkward template slot — grammatically unnatural phrase'],
  [/\bbeginners?\s+crypto\b|\bcrypto\s+beginners?\b/i,
    'awkward template slot — "beginners crypto" is not a valid subject'],
  [/\broutine\s+healthy\b|\bhealthy\s+routine\s+routine\b/i,
    'awkward template slot — redundant or ungrammatical'],
  [/\bweight\s+loss\s+lose\b/i,
    'awkward template slot — "weight loss lose" is redundant'],
  [/^without\s+workout\s*:/i,
    'awkward template slot — "without workout" is not a natural title subject'],
  [/improve\s+health\s+apps\b/i,
    'awkward template slot — "improve health apps" doesn\'t match fitness context'],
  [/^routine\s*:/i,
    'template slot too generic — "Routine" alone provides no context'],
  [/\bfood\s+dishes\b/i,
    'template slot too generic — "food dishes" is redundant'],
  [/beginner\s+mistake\s+inside.*\bbeginners\b/i,
    'template slot redundancy — "beginner" and "beginners" in same title'],
  [/\bbeginners?\s+mistake\s+behind\s+routine\b/i,
    'awkward slot — "routine" alone is too generic as a subject'],
];

// Excellent hook patterns — specific narrative, specific angle, immediately compelling
// Use [’'] to match both curly and straight apostrophes in source data
const EXCELLENT_RE = [
  /we thought.*singularities/i,
  /tiger that was forced to hunt/i,
  /santro.*family.*years?\s+of\s+memories/i,
  /trump\s+can[’']?t\s+negotiate/i,
];

// Good signal patterns — specific topic + clear format or mechanism
const GOOD_RE = [
  // Peer signal titles with strong specificity
  /mumbai\s+style\s+vada\s+pav\s+with\s+garlic\s+chutney/i,
  /trump\S*\s+china\s+visit\s+impacts?\s+india/i,
  /apple\s+biggest\s+wwdc\s+surprise/i,
  // DNA templates with natural slot fills
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

// Connective words that indicate sentence structure (not keyword dump)
const HAS_CONNECTOR = /\b(vs|in|of|for|the|a|an|is|are|was|were|how|why|what|with|or|to|at|on|by|from|can|will|did|does|through|about|when|where|if|but|before|after|without|during|inside|behind|that|this|your|my|our|and)\b/i;
const HAS_VERB      = /\b(is|are|was|were|will|can|does|do|did|have|has|had|make|makes|made|shows|reveals|explains|breaks|watch|see|trust|check|learn|teach|teaches|find|finds|start|build|grow|create|change|improve|avoid|achieve|compare|win|lose|buy|sell|invest|save|spend|cook|eat|try|get|take|give|use|run|stop|need|want|know|understand|explore|discover|follow|fix|help|hit|crash|fall|rises?|drops?|jumps?|adds?|cuts?|raises?|says?|told|tells|forces?|forced|thought|ended|impacts?|lighting)\b/i;

function classifyTitle(title, conceptId, conceptConf) {
  const t = (title || '').trim();
  const words = t.split(/\s+/).filter(Boolean);
  const wc    = words.length;

  if (!t || wc === 0) return { label: 'Garbage', reason: 'empty title' };

  // ── Garbage ──────────────────────────────────────────────────────────────────
  for (const [re, reason] of GARBAGE_RE) {
    if (re.test(t)) return { label: 'Garbage', reason };
  }
  if (wc <= 2 && !/\bvs\.?\b/i.test(t)) {
    return { label: 'Garbage', reason: 'too short to be actionable as a recommendation' };
  }
  // Repeated content word in ≤ 6 words
  const tokens = words.map(w => w.toLowerCase().replace(/[^a-z0-9]/g, '')).filter(w => w.length > 2);
  const unique  = new Set(tokens);
  if (unique.size < tokens.length && wc <= 6) {
    return { label: 'Garbage', reason: 'repeated keyword — title is incoherent' };
  }

  // ── Excellent ────────────────────────────────────────────────────────────────
  for (const re of EXCELLENT_RE) {
    if (re.test(t)) {
      return { label: 'Excellent', reason: 'compelling narrative hook with specific story and immediately clear audience angle' };
    }
  }

  // ── Poor (pattern-based) ─────────────────────────────────────────────────────
  for (const [re, reason] of POOR_RE) {
    if (re.test(t)) return { label: 'Poor', reason };
  }

  // ── Poor (awkward DNA slot fills) ────────────────────────────────────────────
  for (const [re, reason] of AWKWARD_SLOT_RE) {
    if (re.test(t)) return { label: 'Poor', reason };
  }

  // ── Poor (keyword dump — no sentence structure, no concept) ─────────────────
  if (!HAS_CONNECTOR.test(t) && !HAS_VERB.test(t) && wc <= 5) {
    if (!conceptId) {
      return { label: 'Poor', reason: 'keyword dump — no sentence structure; no concept classification' };
    }
    return { label: 'Poor', reason: 'keyword dump — no sentence structure' };
  }

  // ── Good ─────────────────────────────────────────────────────────────────────
  for (const re of GOOD_RE) {
    if (re.test(t)) {
      const hasConceptBoost = conceptId && (conceptConf || 0) >= 0.60;
      return {
        label: 'Good',
        reason: hasConceptBoost
          ? 'specific topic with clear angle and strong concept match'
          : 'specific topic with clear format or mechanism',
      };
    }
  }

  // ── Average vs Poor fallback ─────────────────────────────────────────────────
  if (wc >= 6) {
    if (conceptId && (conceptConf || 0) >= 0.60) {
      return { label: 'Average', reason: 'reasonable specificity with concept match; template structure visible' };
    }
    if (conceptId) {
      return { label: 'Average', reason: 'sufficient length with weak concept signal; angle not sharp' };
    }
    return { label: 'Average', reason: 'sufficient length but generic angle; no concept classification' };
  }

  if (wc <= 4) {
    return { label: 'Poor', reason: 'too short and lacks a clear angle or mechanism' };
  }

  return { label: 'Average', reason: 'moderate specificity; recognizable topic but not distinctive' };
}

// ── Main ───────────────────────────────────────────────────────────────────────

function main() {
  const db   = openDb();
  const rows = db.prepare(`
    SELECT id, batch_id, rec_source, generated_title,
           concept_id, concept_confidence, dna_affinity_score, score
    FROM wtp_human_quality_reviews
    ORDER BY id
  `).all();

  // Track title → first label (for duplicate detection)
  const titleLabels = new Map();
  const updates     = [];

  for (const row of rows) {
    const { label, reason } = classifyTitle(
      row.generated_title,
      row.concept_id,
      row.concept_confidence,
    );

    const normTitle = (row.generated_title || '').trim().toLowerCase().slice(0, 80);
    const isDup     = titleLabels.has(normTitle);
    if (!isDup) titleLabels.set(normTitle, label);

    const notes = isDup ? `duplicate recommendation (same title seen earlier)` : null;

    updates.push({
      id:             row.id,
      human_label:    label,
      reviewer_notes: notes
        ? `${reason}; ${notes}`
        : reason,
      reviewed_at:    new Date().toISOString(),
    });
  }

  // ── Print distribution preview ───────────────────────────────────────────────
  const dist = {};
  for (const u of updates) {
    dist[u.human_label] = (dist[u.human_label] || 0) + 1;
  }

  console.log('\n══════════════════════════════════════════════════════════════');
  console.log('  Phase 1 — Gold Dataset Labeler');
  console.log(`  Rows: ${rows.length}   Mode: ${DRY_RUN ? 'DRY RUN' : 'WRITE'}`);
  console.log('══════════════════════════════════════════════════════════════\n');
  console.log('  Label distribution:');
  const ORDER = ['Excellent', 'Good', 'Average', 'Poor', 'Garbage'];
  for (const lbl of ORDER) {
    const n = dist[lbl] || 0;
    const pct = (n / rows.length * 100).toFixed(1);
    const bar = '█'.repeat(Math.round(n / rows.length * 30));
    console.log(`  ${lbl.padEnd(10)} ${String(n).padStart(3)}  ${pct.padStart(5)}%  ${bar}`);
  }

  // Per-batch breakdown
  const byBatch = {};
  for (const u of updates) {
    const row = rows.find(r => r.id === u.id);
    const b   = row.batch_id;
    if (!byBatch[b]) byBatch[b] = {};
    byBatch[b][u.human_label] = (byBatch[b][u.human_label] || 0) + 1;
  }
  console.log('\n  By batch:');
  for (const [batch, counts] of Object.entries(byBatch)) {
    const parts = ORDER.filter(l => counts[l]).map(l => `${l}:${counts[l]}`).join('  ');
    console.log(`  ${batch.padEnd(18)} ${parts}`);
  }

  if (DRY_RUN) {
    console.log('\n  [DRY RUN — no writes. Run without --dry-run to apply labels.]\n');
    // Print first 20 for inspection
    console.log('\n  Sample labels (first 20):');
    for (const u of updates.slice(0, 20)) {
      const row = rows.find(r => r.id === u.id);
      console.log(`  [${u.human_label.padEnd(9)}] ${(row.generated_title || '').slice(0, 55).padEnd(55)} | ${u.reviewer_notes.slice(0, 60)}`);
    }
    return;
  }

  // ── Write labels ─────────────────────────────────────────────────────────────
  const stmt = db.prepare(`
    UPDATE wtp_human_quality_reviews
    SET human_label     = ?,
        reviewer_notes  = ?,
        reviewed_at     = ?
    WHERE id = ?
  `);

  const applyAll = db.transaction(() => {
    for (const u of updates) {
      stmt.run(u.human_label, u.reviewer_notes, u.reviewed_at, u.id);
    }
  });

  applyAll();
  console.log(`\n  ✓ Applied labels to ${updates.length} rows.\n`);
}

main();

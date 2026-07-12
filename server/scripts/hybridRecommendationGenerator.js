'use strict';

/**
 * Hybrid Recommendation Generator — Phase 3
 *
 * Combines peer_video_signal patterns with creator DNA subjects to generate
 * creator-specific hybrid recommendations.
 *
 * Process:
 *   1. Load peer video titles → classify by template type (WAY_TO, CHECKLIST,
 *      MISTAKE_BEHIND, DISH_TECHNIQUE, COLON) — these are the PATTERNS
 *   2. Deduplicate by pattern type → identify which patterns are actively
 *      used in peer signals (reflecting real audience demand)
 *   3. For each creator with strong DNA traces: apply those peer patterns
 *      to the creator's concept-validated subjects
 *   4. Score each hybrid with structure score + creator relevance check
 *
 * Why not just use WINNER_TEMPLATE_SETS?
 *   buildWinnerTemplateCandidates() uses historical gold set win rates.
 *   Hybrid uses CURRENTLY ACTIVE peer signal patterns — what is working now.
 *   If peer signals show surge in CHECKLIST titles, hybrid reflects that.
 *
 * Output: scripts/hybrid_recommendations.json
 *         Console report with generation summary
 *
 * Usage: node hybridRecommendationGenerator.js [--limit=N] [--min-concept=0.55] [--verbose]
 */

const path = require('path');
const fs   = require('fs');
const Database = require('../node_modules/better-sqlite3');
const { recommendationStructureScore } = require('./recommendationStructureScore');

const DB_PATH  = path.resolve(__dirname, '../data/scoring.db');
const JSON_OUT = path.resolve(__dirname, 'hybrid_recommendations.json');

const ARGS = {};
for (const a of process.argv.slice(2)) {
  const [k, v] = a.split('=');
  ARGS[k.replace(/^--/, '')] = v || true;
}
const CHANNEL_LIMIT  = parseInt(ARGS.limit || '50', 10);
const MIN_CONCEPT    = parseFloat(ARGS['min-concept'] || '0.55');
const VERBOSE        = Boolean(ARGS.verbose);

// ── Pattern detectors for peer title classification ────────────────────────────
const PEER_PATTERN_DETECTORS = {
  WAY_TO:          t => /^(how |what nobody|the best way)/i.test(t) || /\b(how to|way to|the best way)\b/i.test(t),
  CHECKLIST_FORMAT:t => /\b(checklist|guide|tips?|routine|plan|framework)\s+(for|to)\b/i.test(t) || /\ba (practical|honest|quick|simple)\s+(checklist|guide|tips?)/i.test(t),
  MISTAKE_BEHIND:  t => /\b(mistake|trap|pitfall|wrong|hidden cost|beginner mistake|common mistake|get wrong)\b/i.test(t),
  DISH_TECHNIQUE:  t => /\b(biryani|vada pav|dosa|noodles|pasta|pizza|burger|sushi|curry|roti|naan|idli|samosa|paneer|chicken|mutton|fish|egg|cake|cookie|bread|coffee|biryani)\b/i.test(t) || /\bcan you make.*at home\b/i.test(t),
  COLON_EXPLAINER: t => /^[^:]+:\s+.{10,}$/i.test(t) && !/^(mistake|how|what|why|the trap|the beginner|can you make)\b/i.test(t),
};

// Peer patterns that CAN be adapted to creator context (excludes narrative)
const ADAPTABLE_PATTERNS = Object.keys(PEER_PATTERN_DETECTORS);

function classifyPeerTitle(title) {
  const t = String(title || '');
  for (const [name, fn] of Object.entries(PEER_PATTERN_DETECTORS)) {
    if (fn(t)) return name;
  }
  return null; // null = not adaptable (narrative, vlog, entertainment noise)
}

// ── Template application per pattern ─────────────────────────────────────────
// Maps pattern type → template function(subject) → hybrid title
const PATTERN_TEMPLATES = {
  WAY_TO: [
    subject => `How to get ${subject} right, step by step`,
    subject => `What nobody explains clearly about ${subject}`,
    subject => `How ${subject} can change your approach`,
  ],
  CHECKLIST_FORMAT: [
    subject => `A practical checklist for ${subject}`,
    subject => `${subject}: what to do, what to avoid, and why`,
    subject => `A simple guide to ${subject} for beginners`,
  ],
  MISTAKE_BEHIND: [
    subject => `The beginner mistake behind ${subject}`,
    subject => `What most people get wrong about ${subject}`,
    subject => `The most common mistake with ${subject}`,
  ],
  DISH_TECHNIQUE: [
    subject => `Can you make ${subject} at home without shortcuts?`,
    subject => `${subject}: the budget version vs the restaurant version`,
    subject => `The ingredient mistake that ruins ${subject}`,
  ],
  COLON_EXPLAINER: [
    subject => `${subject}: who benefits and who loses`,
    subject => `${subject}: risk, returns, and what most people miss`,
    subject => `${subject}: worth it or overhyped?`,
  ],
};

// ── Subject extraction from peer title ────────────────────────────────────────
// Extracts the core subject from a peer title for cross-niche pattern detection.
const PEER_SUBJECT_EXTRACTORS = {
  WAY_TO: t => {
    const m = t.match(/\b(how to|way to)\s+(.{5,40}?)(\s+(right|well|properly|step)\b|$)/i);
    return m ? m[2].trim() : null;
  },
  CHECKLIST_FORMAT: t => {
    const m = t.match(/(?:checklist|guide|tips?|routine|plan)\s+(?:for|to)\s+(.{4,40}?)(?:\s*$|[,:])/i) ||
              t.match(/^(.{4,40}?):\s+(?:what to|how to|checklist|guide)/i);
    return m ? m[1].trim() : null;
  },
  MISTAKE_BEHIND: t => {
    const m = t.match(/(?:mistake|trap|pitfall|get wrong)\s+(?:about|behind|with|in|for)\s+(.{4,40}?)(?:\s*$|[,?])/i) ||
              t.match(/what.*people.*get wrong about\s+(.{4,40}?)(?:\s*$|[,?])/i);
    return m ? m[1].trim() : null;
  },
  DISH_TECHNIQUE: t => {
    const m = t.match(/\b(biryani|vada pav|dosa|noodles|pasta|pizza|burger|sushi|curry|roti|naan|idli|samosa|paneer|chicken|mutton|fish|egg|cake|cookie|bread|coffee)\b/i);
    return m ? m[1] : null;
  },
  COLON_EXPLAINER: t => {
    const m = t.match(/^(.{4,40}?):\s+/);
    return m ? m[1].trim() : null;
  },
};

// ── Language filter ────────────────────────────────────────────────────────────
// Reject titles with significant non-Latin characters (Hindi, Bengali, etc.)
function isEnglishTitle(title) {
  const t = String(title || '');
  const nonLatin = (t.match(/[^\x00-\x7F]/g) || []).length;
  return nonLatin / Math.max(t.length, 1) < 0.15;
}

// ── Main ──────────────────────────────────────────────────────────────────────
function main() {
  const db = new Database(DB_PATH, { readonly: true, timeout: 60000 });

  // Load all peer signal titles
  const peerRows = db.prepare(
    "SELECT DISTINCT generated_title FROM wtp_generation_traces WHERE rec_source='peer_video_signal' AND generated_title IS NOT NULL AND generated_title != ''"
  ).all();

  // Classify each peer title
  const adaptedPatterns = { WAY_TO: 0, CHECKLIST_FORMAT: 0, MISTAKE_BEHIND: 0, DISH_TECHNIQUE: 0, COLON_EXPLAINER: 0 };
  const classifiedPeers = peerRows
    .filter(r => isEnglishTitle(r.generated_title))
    .map(r => {
      const pattern = classifyPeerTitle(r.generated_title);
      if (pattern) {
        adaptedPatterns[pattern] = (adaptedPatterns[pattern] || 0) + 1;
        const subject = PEER_SUBJECT_EXTRACTORS[pattern] ? PEER_SUBJECT_EXTRACTORS[pattern](r.generated_title) : null;
        return { title: r.generated_title, pattern, peer_subject: subject };
      }
      return null;
    })
    .filter(Boolean);

  // Load creator channels with strong DNA traces
  // Group by channel_id, pick channels with >= 5 DNA traces and concept_confidence > 0
  const channelRows = db.prepare(
    `SELECT channel_id, family,
       COUNT(*) as trace_count,
       AVG(CAST(concept_confidence AS REAL)) as avg_concept_conf
     FROM wtp_generation_traces
     WHERE rec_source = 'dna_original_bets'
       AND concept_confidence >= ?
       AND family IS NOT NULL
       AND family != 'generic'
       AND generated_title IS NOT NULL
     GROUP BY channel_id, family
     HAVING trace_count >= 3
     ORDER BY avg_concept_conf DESC, trace_count DESC
     LIMIT ?`
  ).all(MIN_CONCEPT, CHANNEL_LIMIT);

  // For each creator, get their best subjects (from DNA traces with high concept confidence)
  const subjectsByChannel = new Map();
  for (const ch of channelRows) {
    const subjects = db.prepare(
      `SELECT DISTINCT raw_subject, concept_label, concept_confidence
       FROM wtp_generation_traces
       WHERE channel_id = ?
         AND rec_source = 'dna_original_bets'
         AND raw_subject IS NOT NULL
         AND concept_confidence >= ?
       ORDER BY concept_confidence DESC
       LIMIT 10`
    ).all(ch.channel_id, MIN_CONCEPT);
    subjectsByChannel.set(ch.channel_id, { family: ch.family, subjects });
  }

  // Load existing DNA trace titles per channel (for dedup)
  const existingByChannel = new Map();
  for (const ch of channelRows) {
    const existing = db.prepare(
      "SELECT generated_title FROM wtp_generation_traces WHERE channel_id = ? AND rec_source = 'dna_original_bets'"
    ).all(ch.channel_id).map(r => r.generated_title.toLowerCase());
    existingByChannel.set(ch.channel_id, new Set(existing));
  }

  // Load gold labels for dedup / comparison
  const goldByTitle = new Map();
  const goldRows = db.prepare(
    "SELECT generated_title, human_label FROM wtp_human_quality_reviews WHERE human_label IS NOT NULL"
  ).all();
  for (const r of goldRows) goldByTitle.set(r.generated_title, r.human_label);

  db.close();

  // ── Generate hybrid recommendations ───────────────────────────────────────
  // For each adaptable peer pattern found in peer signals:
  //   for each creator channel:
  //     for each creator subject:
  //       apply pattern template → hybrid title
  const hybridRecs = [];
  const usedTitlesGlobal = new Set();

  const activePatterns = Object.entries(adaptedPatterns)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([pattern]) => pattern);

  for (const ch of channelRows) {
    const { family, subjects } = subjectsByChannel.get(ch.channel_id) || {};
    if (!subjects || !subjects.length) continue;
    const existingTitles = existingByChannel.get(ch.channel_id) || new Set();

    for (const patternType of activePatterns) {
      const templates = PATTERN_TEMPLATES[patternType];
      if (!templates) continue;

      for (const { raw_subject: subject, concept_label, concept_confidence } of subjects) {
        for (let ti = 0; ti < templates.length; ti++) {
          const hybridTitle = templates[ti](subject);
          const key = hybridTitle.toLowerCase();

          // Dedup: skip if same as existing DNA bet or already generated
          if (existingTitles.has(key) || usedTitlesGlobal.has(key)) continue;
          usedTitlesGlobal.add(key);

          const { score: structScore } = recommendationStructureScore(hybridTitle);
          const goldLabel = goldByTitle.get(hybridTitle) || null;

          // Find which peer titles demonstrated this pattern
          const peerExamples = classifiedPeers
            .filter(p => p.pattern === patternType)
            .slice(0, 2)
            .map(p => p.title);

          hybridRecs.push({
            channel_id:          ch.channel_id,
            creator_family:      family,
            peer_pattern:        patternType,
            creator_subject:     subject,
            creator_concept:     concept_label,
            concept_confidence:  concept_confidence,
            hybrid_title:        hybridTitle,
            struct_score:        structScore,
            gold_label:          goldLabel,
            peer_examples:       peerExamples,
            template_index:      ti,
          });
        }
      }
    }
  }

  // ── Console report ────────────────────────────────────────────────────────
  process.stdout.write('\n══════════════════════════════════════════════════════════════\n');
  process.stdout.write('  Hybrid Recommendation Generator\n');
  process.stdout.write(`  ${peerRows.length} peer titles → ${classifiedPeers.length} English+adaptable\n`);
  process.stdout.write(`  ${channelRows.length} creator channels → ${hybridRecs.length} hybrid recommendations\n`);
  process.stdout.write('══════════════════════════════════════════════════════════════\n\n');

  process.stdout.write('── Active peer patterns (in peer signal pool) ────────────────\n');
  for (const [pattern, count] of Object.entries(adaptedPatterns).sort((a,b)=>b[1]-a[1])) {
    process.stdout.write(`  ${pattern.padEnd(20)} ${count} peer titles\n`);
  }

  process.stdout.write('\n── Pattern distribution in generated hybrids ─────────────────\n');
  for (const pattern of activePatterns) {
    const forPattern = hybridRecs.filter(r => r.peer_pattern === pattern);
    const avgStruct = forPattern.length ? (forPattern.reduce((s,r)=>s+r.struct_score,0)/forPattern.length).toFixed(1) : '—';
    process.stdout.write(`  ${pattern.padEnd(20)} ${forPattern.length.toString().padEnd(6)} recs  struct_avg=${avgStruct}\n`);
  }

  process.stdout.write('\n── Family distribution ───────────────────────────────────────\n');
  const familyCounts = {};
  for (const r of hybridRecs) familyCounts[r.creator_family] = (familyCounts[r.creator_family] || 0) + 1;
  for (const [fam, n] of Object.entries(familyCounts).sort((a,b)=>b[1]-a[1])) {
    process.stdout.write(`  ${fam.padEnd(28)} ${n}\n`);
  }

  if (VERBOSE) {
    process.stdout.write('\n── Sample hybrid titles (top struct score) ───────────────────\n');
    const topHybrids = [...hybridRecs].sort((a,b) => b.struct_score - a.struct_score).slice(0, 20);
    for (const r of topHybrids) {
      process.stdout.write(`  [${r.peer_pattern}][${r.creator_family}] "${r.hybrid_title}" (struct=${r.struct_score})\n`);
      if (r.peer_examples.length) process.stdout.write(`    peer examples: ${r.peer_examples.slice(0,1).join(' | ')}\n`);
    }
  }

  process.stdout.write('\n══════════════════════════════════════════════════════════════\n\n');

  // ── Write JSON output ─────────────────────────────────────────────────────
  const output = {
    generated: new Date().toISOString().slice(0, 10),
    peer_signal_count: peerRows.length,
    english_adaptable_peer_count: classifiedPeers.length,
    active_patterns: adaptedPatterns,
    creator_channels_analyzed: channelRows.length,
    hybrid_recommendation_count: hybridRecs.length,
    hybrid_recommendations: hybridRecs,
    generation_notes: [
      'Hybrid = peer_video_signal PATTERN applied to creator DNA SUBJECT.',
      'Peer patterns found: ' + Object.entries(adaptedPatterns).filter(([,v])=>v>0).map(([k,v])=>`${k}(${v})`).join(', '),
      'Creator relevance gate: concept_confidence >= ' + MIN_CONCEPT,
      'Deduplication: hybrid titles already in DNA traces are excluded.',
      'Cross-domain adaptation not yet implemented — peer subject replaced by creator subject.',
    ],
  };

  fs.writeFileSync(JSON_OUT, JSON.stringify(output, null, 2));
  process.stdout.write(`  Written: ${JSON_OUT}\n`);
}

main();

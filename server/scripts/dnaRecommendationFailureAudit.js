'use strict';

/**
 * DNA Recommendation Failure Audit (Priority 1)
 *
 * Samples 500 failed DNA recommendations from wtp_generation_traces and classifies
 * each into a primary failure mode:
 *   BAD_SUBJECT  — raw_subject itself is noisy, invalid, or an extraction artifact
 *   BAD_CONCEPT  — subject is recognizable but falls outside the concept taxonomy
 *   BAD_TEMPLATE — subject is valid but template output is generic/mismatched
 *   BAD_OUTPUT   — all inputs seem OK but generated title is incoherent or weak
 *
 * Outputs: failure_breakdown.json
 *
 * Usage:
 *   node dnaRecommendationFailureAudit.js [--limit=N] [--verbose] [--days=N]
 */

const path = require('path');
const fs   = require('fs');
const BetterSqlite3 = require('../node_modules/better-sqlite3');

// ── Specificity scorer (inline from recommendationTruthAudit.js) ─────────────

const STOPWORDS = new Set([
  'the','a','an','and','or','but','in','on','at','to','for','of','with',
  'by','from','up','about','into','through','is','are','was','were','be',
  'been','have','has','had','do','does','did','will','would','could','should',
  'i','my','you','your','we','our','they','their','it','its','this','that',
  'how','what','why','when','where','who','which','can','its','let','got',
]);

const SPECIFIC_SIGNALS = [
  /\b\d{4}\b/,
  /\b(rs\.?|₹|\$|usd|inr)\s*\d+/i,
  /\b\d+\s*(cr|lakh|k|m|b|mn|bn)\b/i,
  /\b[A-Z][a-z]+\s+[A-Z][a-z]+\b/,
  /\b(india|indian|delhi|mumbai|bengaluru|hyderabad|chennai|kolkata|pune|jaipur|ahmedabad|india's)\b/i,
  /\b(upsc|jee|neet|ipl|bcci|bjp|congress|rbi|sebi|sensex|nifty|gst)\b/i,
  /\b(iphone|android|samsung|oneplus|oppo|vivo|realme|pixel|macbook)\b/i,
  /\b(youtube|instagram|twitter|facebook|whatsapp|telegram|snapchat|tiktok)\b/i,
  /\b(covid|inflation|recession|ai|chatgpt|gpt-4|gemini|claude)\b/i,
  /\b\d+\s*(steps?|tips?|ways?|reasons?|things?|facts?|points?|signs?|tricks?)\b/i,
  /\b(beginner|expert|advanced|complete|full|ultimate|honest|practical)\b/i,
];

function meaningfulWords(title) {
  return String(title || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOPWORDS.has(w));
}

const PEER_SIGNAL_SOURCES = new Set([
  'angle_gap','territory_expansion','peer_video_signal','fallback_evergreen',
]);

function scoreSpecificity(title, rec_source) {
  if (!title) return 0;
  const words = title.trim().split(/\s+/);
  const mw = meaningfulWords(title);
  const wordCount = words.length;
  const mwRatio = wordCount > 0 ? mw.length / wordCount : 0;

  if (PEER_SIGNAL_SOURCES.has(rec_source)) {
    let score = 0.40;
    if (mwRatio >= 0.55) score += 0.10;
    let hits = 0;
    for (const sig of SPECIFIC_SIGNALS) { if (sig.test(title)) hits++; }
    score += Math.min(0.40, hits * 0.14);
    if (wordCount >= 5 && wordCount <= 12) score += 0.10;
    return Math.min(1, score);
  }

  let score = 0.40;
  if (mwRatio >= 0.55) score += 0.10;
  let hits = 0;
  for (const sig of SPECIFIC_SIGNALS) { if (sig.test(title)) hits++; }
  score += Math.min(0.40, hits * 0.14);
  if (wordCount >= 5 && wordCount <= 12) score += 0.10;
  return Math.min(1, score);
}

// ── BAD_SUBJECT detection ─────────────────────────────────────────────────────

// TV news channel and brand names that leak into subjects
const TV_BRAND_RE = /\b(etv|tv9|tv5|tv\d+|zee\s*tv|sun\s*tv|asianet|kairali|manorama|india\s*tv|aaj\s*tak|ndtv|republic\s*tv|times\s*now|news18|wion|abp|cnbctv|bbc\s*news|bbc\s*earth)\b/i;

// Music production tags
const MUSIC_PROD_RE = /\b(type\s+beat|lo[\s-]?fi|lofi\s+beat|instrumental\s+loop|free\s+beat|rnb\s+beat)\b/i;

// Known Hindi/transliterated function words with no domain signal
const HINDI_FUNCTION_RE = /\b(karein|karke|karo|karna|karta|karti|karte|kiya|kiye|dekhein|dekho|suno|bolo|jao|aao|chalein|milein|lijiye|dijiye|batao|seekho)\b/i;

// Person name handle patterns (underscore in subject = username leak)
const HANDLE_RE = /_/;

// Conjunction stranded between nouns (preposition-collapse artifact)
const STRANDED_CONJUNCTION_RE = /\s+(because|since|although|unless|until|whilst|therefore|hence|wherein|whereby|therein)\s+/i;

// Alphanumeric ID artifact: letters directly concatenated with 3+ digits
const ALPHANUMERIC_ID_RE = /[a-z]{2,}\d{3,}|\d{3,}[a-z]{2,}/i;

// Multi-slash (multiple topics merged)
const MULTI_SLASH_RE = /\//;

// Repeated content word in short subject
function hasRepeatedWord(subject) {
  const words = String(subject || '').toLowerCase().split(/\s+/).filter(w => w.length >= 3);
  if (words.length <= 1) return false;
  return new Set(words).size < words.length;
}

// Single-word overbroad subjects (identity/language markers with no domain signal)
const OVERBROAD_SINGLE_RE = /^(india|indian|hindi|english|tamil|telugu|kannada|marathi|malayalam|bengali|odia|gujarati|punjabi|home|story|life|world|food|people|media|news|comedy|drama|horror|action|romance|science|nature|culture|history|sports|politics|music|art|technology|film|films|movies|videos|channel|vlog|vlogs)$/i;

// Domain signal words: if subject has NO English word from any domain vocab, likely pure Hindi artifact
const DOMAIN_SIGNAL_WORDS = new Set([
  'food','recipe','cook','eat','drink','travel','trip','hotel','city','place',
  'tech','phone','app','camera','laptop','gadget','review','test','buy',
  'money','finance','invest','stock','tax','loan','budget','salary',
  'business','startup','brand','market','company','product','startup',
  'health','fitness','yoga','workout','diet','exercise','body','weight',
  'education','exam','study','school','college','course','lesson',
  'news','politics','war','election','policy','government','crisis',
  'gaming','game','play','stream','rank','squad',
  'movie','film','series','show','episode','music','song','dance',
  'comedy','sketch','prank','reaction','challenge',
  'science','history','explained','guide','tutorial',
  'family','wedding','festival','culture','tradition',
]);

function hasEnglishDomainSignal(subject) {
  const words = String(subject || '').toLowerCase().split(/\s+/);
  return words.some(w => DOMAIN_SIGNAL_WORDS.has(w));
}

function classifySubject(raw_subject) {
  if (!raw_subject || raw_subject.trim().length === 0) {
    return { mode: 'BAD_SUBJECT', sub_type: 'null_or_empty_subject' };
  }
  const s = raw_subject.trim();

  if (HANDLE_RE.test(s)) {
    return { mode: 'BAD_SUBJECT', sub_type: 'underscore_handle_leak' };
  }
  if (s.includes('&')) {
    return { mode: 'BAD_SUBJECT', sub_type: 'ampersand_artifact' };
  }
  if (ALPHANUMERIC_ID_RE.test(s)) {
    return { mode: 'BAD_SUBJECT', sub_type: 'alphanumeric_id_artifact' };
  }
  if (MULTI_SLASH_RE.test(s)) {
    return { mode: 'BAD_SUBJECT', sub_type: 'multi_slash_merge' };
  }
  if (TV_BRAND_RE.test(s)) {
    return { mode: 'BAD_SUBJECT', sub_type: 'tv_channel_brand_leak' };
  }
  if (MUSIC_PROD_RE.test(s)) {
    return { mode: 'BAD_SUBJECT', sub_type: 'music_production_tag' };
  }
  if (STRANDED_CONJUNCTION_RE.test(s)) {
    return { mode: 'BAD_SUBJECT', sub_type: 'conjunction_collapse_artifact' };
  }
  if (hasRepeatedWord(s)) {
    return { mode: 'BAD_SUBJECT', sub_type: 'repeated_word_artifact' };
  }

  const words = s.split(/\s+/).filter(Boolean);

  if (words.length === 1 && OVERBROAD_SINGLE_RE.test(s)) {
    return { mode: 'BAD_SUBJECT', sub_type: 'overbroad_single_word' };
  }

  // Hindi-function-word dominant: starts with an imperative Hindi verb
  if (HINDI_FUNCTION_RE.test(s)) {
    return { mode: 'BAD_SUBJECT', sub_type: 'hindi_imperative_fragment' };
  }

  // Pure Hindi multi-word with no English domain signal → likely extraction artifact
  // Heuristic: no word matches English domain vocab, and no word has likely English phonology
  const hasEnglish = words.some(w => /^[a-z]{3,}$/.test(w) && !w.match(/^(aur|hai|hain|mein|ko|ka|ki|ke|se|par|yeh|jo|ye|ek|do|teen)$/));
  if (!hasEnglish || !hasEnglishDomainSignal(s)) {
    // Check if it's clearly Hindi-only (non-domain content)
    const looksHindi = words.every(w =>
      !DOMAIN_SIGNAL_WORDS.has(w.toLowerCase()) &&
      !SPECIFIC_SIGNALS.some(sig => sig.test(w))
    );
    if (looksHindi && words.length >= 2 && words.length <= 4) {
      // Could be legitimate but missing domain signal
      return { mode: 'BAD_SUBJECT', sub_type: 'no_domain_signal' };
    }
  }

  return null; // subject passes
}

// ── BAD_CONCEPT detection ─────────────────────────────────────────────────────

function classifyConcept(concept_id) {
  if (!concept_id) {
    return { mode: 'BAD_CONCEPT', sub_type: 'no_concept_assigned' };
  }
  return null;
}

// ── BAD_TEMPLATE detection ────────────────────────────────────────────────────

// Family-domain mismatch: subject domain doesn't fit the template family
const FAMILY_DOMAIN_SIGNALS = {
  news_event:          /\b(war|election|policy|verdict|court|crisis|conflict|government|minister|parliament|protest|geopolitics?|sanction|missile|treaty)\b/i,
  finance_education:   /\b(sip|mutual fund|stock|market|portfolio|loan|tax|insurance|debt|wealth|nifty|sensex|emi|investment|saving)\b/i,
  exam_education:      /\b(upsc|jee|neet|ssc|cbse|icse|exam|prelims|mains|pyq|mock|syllabus|revision|current affairs)\b/i,
  tech_review:         /\b(phone|laptop|app|camera|tablet|smartwatch|earbuds|software|android|iphone|pc|computer)\b/i,
  gaming_entertainment:/\b(game|gaming|gta|minecraft|pubg|bgmi|free\s*fire|rank|squad|boss|level|challenge|pvp)\b/i,
  cooking_food:        /\b(food|recipe|cook|eat|dish|meal|snack|curry|thali|sweet|breakfast|dinner|lunch|chef|ingredient)\b/i,
  fitness_practice:    /\b(workout|exercise|yoga|fitness|gym|posture|weight|back\s*pain|flexibility|breathwork|cardio)\b/i,
  travel_lifestyle:    /\b(travel|trip|tour|hotel|city|place|destination|road\s*trip|itinerary|backpack|explore)\b/i,
};

function classifyTemplate(family, raw_subject, concept_id, generated_title) {
  // Family-domain mismatch
  if (family && FAMILY_DOMAIN_SIGNALS[family]) {
    const subjectMatchesFamily = FAMILY_DOMAIN_SIGNALS[family].test(raw_subject || '');
    if (!subjectMatchesFamily) {
      // Check if another family's signals appear in the subject
      const mismatchedFamily = Object.entries(FAMILY_DOMAIN_SIGNALS)
        .filter(([f]) => f !== family)
        .find(([, re]) => re.test(raw_subject || ''));
      if (mismatchedFamily) {
        return { mode: 'BAD_TEMPLATE', sub_type: `family_domain_mismatch:${family}_vs_${mismatchedFamily[0]}` };
      }
    }
  }

  // Generic template patterns — output is valid English but completely vague
  const GENERIC_OUTPUT_PATTERNS = [
    /^(worth it or overhyped)\s*\??$/i,
    /^(quick version for busy days)$/i,
    /^(honest tradeoff)$/i,
    /\b(your audience|recent upload|viewer confusion|fresh viewer question)\b/i,
    /^(what changed in .{1,20} and why it matters)$/i,
    /^(the practical story behind .{1,15})$/i,
    /^(a fresh angle from your recent uploads?)$/i,
  ];
  const titleEnd = (generated_title || '').replace(/^[^:]+:\s*/, '').trim();
  for (const p of GENERIC_OUTPUT_PATTERNS) {
    if (p.test(titleEnd) || p.test(generated_title || '')) {
      return { mode: 'BAD_TEMPLATE', sub_type: 'generic_template_output' };
    }
  }

  return null;
}

// ── BAD_OUTPUT detection ──────────────────────────────────────────────────────

const HARD_ARTIFACT_PATTERNS = [
  /\b(changes how you play|using only beginner settings|strategy most players? miss|one challenge run|risky choices that create the best comeback)\b/i,
  /\bwin\s+\w+\s+\w+\s+using\b/i,
  /\b(dont)\s+(eat|try|watch|play|read)\b/i,
  /\bthe update in\b.*\bthat changes\b/i,
];

function classifyOutput(generated_title) {
  if (!generated_title) {
    return { mode: 'BAD_OUTPUT', sub_type: 'empty_title' };
  }
  for (const p of HARD_ARTIFACT_PATTERNS) {
    if (p.test(generated_title)) {
      return { mode: 'BAD_OUTPUT', sub_type: 'hard_artifact_in_output' };
    }
  }
  // Title contains a proper name concatenated with a template phrase that doesn't cohere
  const words = generated_title.split(/\s+/);
  const capitalWords = words.filter(w => /^[A-Z][a-z]{2,}/.test(w) && !/^(Why|How|What|Who|The|When|Where|One|Can|If|Before|After|While)\b/i.test(w));
  if (capitalWords.length >= 2) {
    // Multiple proper-case words in template output = likely person/brand name leaked into template
    const titleLower = generated_title.toLowerCase();
    const hasTemplateFrame = /\b(becomes everyone.s problem|situation|had an honest conversation|one character)\b/i.test(titleLower);
    if (hasTemplateFrame) {
      return { mode: 'BAD_OUTPUT', sub_type: 'proper_name_in_comedy_template' };
    }
  }
  return { mode: 'BAD_OUTPUT', sub_type: 'weak_specificity' };
}

// ── Primary classification entry point ────────────────────────────────────────

function classifyTrace(trace) {
  const { raw_subject, concept_id, concept_confidence, family, archetype, generated_title, rec_source } = trace;

  // Priority 1: Is the subject itself broken?
  const subjectResult = classifySubject(raw_subject);
  if (subjectResult) return subjectResult;

  // Priority 2: Is the concept missing (taxonomy gap)?
  const conceptResult = classifyConcept(concept_id);
  if (conceptResult) return conceptResult;

  // Priority 3: Is the template mismatched or producing generic output?
  const templateResult = classifyTemplate(family, raw_subject, concept_id, generated_title);
  if (templateResult) return templateResult;

  // Priority 4: Is the final output still bad?
  return classifyOutput(generated_title);
}

// ── DB ────────────────────────────────────────────────────────────────────────

function openDb() {
  const raw = new BetterSqlite3(path.resolve(__dirname, '../data/scoring.db'), {
    readonly: true, fileMustExist: true, timeout: 60000,
  });
  raw.pragma('query_only = ON');
  raw.pragma('busy_timeout = 60000');
  const cache = new Map();
  const stmt  = sql => { if (!cache.has(sql)) cache.set(sql, raw.prepare(sql)); return cache.get(sql); };
  return {
    all: (sql, p = []) => stmt(sql).all(Array.isArray(p) ? p : [p]),
    get: (sql, p = []) => stmt(sql).get(Array.isArray(p) ? p : [p]),
    close: () => { cache.clear(); raw.close(); },
  };
}

// ── Args ──────────────────────────────────────────────────────────────────────

function parseArgs() {
  const args    = process.argv.slice(2);
  const limit   = parseInt((args.find(a => a.startsWith('--limit='))  || '--limit=500').split('=')[1], 10)  || 500;
  const days    = parseInt((args.find(a => a.startsWith('--days='))   || '--days=30').split('=')[1],  10)   || 30;
  const verbose = args.includes('--verbose');
  return { limit, days, verbose };
}

// ── Main ──────────────────────────────────────────────────────────────────────

function main() {
  const { limit, days, verbose } = parseArgs();
  const db = openDb();

  try {
    const since = new Date(Date.now() - days * 86400_000).toISOString();

    const traces = db.all(
      `SELECT id, channel_id, rec_source, raw_subject, concept_id, concept_confidence,
              concept_label, family, archetype, generated_title, dna_affinity_score
       FROM wtp_generation_traces
       WHERE rec_source = 'dna_original_bets'
         AND created_at >= ?
       ORDER BY RANDOM()
       LIMIT ?`,
      [since, limit],
    );

    if (!traces.length) {
      console.log('No DNA traces found. Run seedRecommendationTraces.js first.');
      return;
    }

    const results = [];
    const byMode    = {};
    const bySubType = {};
    const byFamily  = {};

    for (const trace of traces) {
      const spc   = scoreSpecificity(trace.generated_title, trace.rec_source);
      const cls   = classifyTrace(trace);
      const entry = {
        id:             trace.id,
        channel_id:     trace.channel_id,
        raw_subject:    trace.raw_subject,
        concept_id:     trace.concept_id,
        concept_confidence: trace.concept_confidence,
        family:         trace.family,
        archetype:      trace.archetype,
        generated_title:trace.generated_title,
        specificity_score: +spc.toFixed(3),
        creator_fit_score: trace.dna_affinity_score,
        failure_mode:   cls.mode,
        sub_type:       cls.sub_type,
      };
      results.push(entry);

      byMode[cls.mode] = (byMode[cls.mode] || 0) + 1;
      bySubType[cls.sub_type] = (bySubType[cls.sub_type] || 0) + 1;

      const fam = trace.family || 'unknown';
      if (!byFamily[fam]) byFamily[fam] = { total: 0 };
      byFamily[fam].total++;
      byFamily[fam][cls.mode] = (byFamily[fam][cls.mode] || 0) + 1;
    }

    const total = results.length;

    // Top-5 examples per mode for the JSON output
    const examplesPerMode = {};
    for (const mode of ['BAD_SUBJECT','BAD_CONCEPT','BAD_TEMPLATE','BAD_OUTPUT']) {
      examplesPerMode[mode] = results
        .filter(r => r.failure_mode === mode)
        .slice(0, 5)
        .map(r => ({
          id:            r.id,
          raw_subject:   r.raw_subject,
          concept_id:    r.concept_id,
          family:        r.family,
          generated_title: r.generated_title,
          sub_type:      r.sub_type,
          specificity:   r.specificity_score,
        }));
    }

    // Subjects with no concept — for taxonomy gap analysis
    const missingConceptSubjects = results
      .filter(r => r.failure_mode === 'BAD_CONCEPT')
      .map(r => r.raw_subject)
      .filter(Boolean);

    // Group missing subjects by first meaningful word (theme clustering)
    const subjectThemes = {};
    for (const s of missingConceptSubjects) {
      const words = String(s).toLowerCase().split(/\s+/).filter(w => w.length > 2 && !STOPWORDS.has(w));
      const key = words[0] || 'other';
      subjectThemes[key] = (subjectThemes[key] || 0) + 1;
    }
    const topMissingThemes = Object.entries(subjectThemes)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 30);

    const dominantMode = Object.entries(byMode).sort((a, b) => b[1] - a[1])[0]?.[0] || 'unknown';

    const breakdown = {
      sampled:          total,
      window_days:      days,
      dominant_failure_mode: dominantMode,
      failure_modes:    Object.fromEntries(
        Object.entries(byMode).map(([mode, count]) => [mode, {
          count,
          pct:      +((count / total) * 100).toFixed(1),
          examples: examplesPerMode[mode] || [],
        }])
      ),
      sub_types: Object.fromEntries(
        Object.entries(bySubType)
          .sort((a, b) => b[1] - a[1])
          .map(([sub, count]) => [sub, { count, pct: +((count / total) * 100).toFixed(1) }])
      ),
      by_family: byFamily,
      taxonomy_gap_analysis: {
        bad_concept_count:    byMode['BAD_CONCEPT'] || 0,
        top_missing_subject_themes: topMissingThemes,
        sample_missing_subjects: missingConceptSubjects.slice(0, 40),
      },
    };

    const outPath = path.resolve(__dirname, 'failure_breakdown.json');
    fs.writeFileSync(outPath, JSON.stringify(breakdown, null, 2), 'utf8');

    // ── Console output ────────────────────────────────────────────────────────
    console.log('\n=== DNA Recommendation Failure Audit ===');
    console.log(`Sampled: ${total} DNA traces | Window: last ${days} days`);
    console.log(`Dominant failure mode: ${dominantMode}\n`);
    console.log('Failure mode distribution:');
    for (const [mode, count] of Object.entries(byMode).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${mode.padEnd(14)} ${String(count).padStart(4)}  (${((count / total) * 100).toFixed(1)}%)`);
    }
    console.log('\nTop sub-types:');
    for (const [sub, count] of Object.entries(bySubType).sort((a, b) => b[1] - a[1]).slice(0, 15)) {
      console.log(`  ${sub.padEnd(40)} ${String(count).padStart(4)}  (${((count / total) * 100).toFixed(1)}%)`);
    }
    console.log('\nBy family:');
    for (const [fam, stats] of Object.entries(byFamily).sort((a, b) => b[1].total - a[1].total).slice(0, 12)) {
      const parts = ['BAD_SUBJECT','BAD_CONCEPT','BAD_TEMPLATE','BAD_OUTPUT']
        .filter(m => stats[m])
        .map(m => `${m.replace('BAD_','')}=${stats[m]}`);
      console.log(`  ${fam.padEnd(26)} total=${stats.total}  ${parts.join('  ')}`);
    }
    console.log(`\nTop missing concept themes (taxonomy gaps):`);
    for (const [theme, count] of topMissingThemes.slice(0, 15)) {
      console.log(`  ${theme.padEnd(22)} ${count}`);
    }

    if (verbose) {
      for (const mode of ['BAD_SUBJECT','BAD_CONCEPT','BAD_TEMPLATE','BAD_OUTPUT']) {
        const examples = (examplesPerMode[mode] || []).slice(0, 8);
        if (!examples.length) continue;
        console.log(`\n── ${mode} examples ──`);
        for (const ex of examples) {
          console.log(`  [${ex.sub_type}] raw="${ex.raw_subject}" → "${(ex.generated_title || '').slice(0,60)}"`);
        }
      }
    }

    console.log(`\nFull breakdown written to: ${outPath}`);
    console.log();
  } finally {
    db.close();
  }
}

main();

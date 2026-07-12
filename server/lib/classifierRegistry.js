'use strict';

// ── Classifier Safety Registry ────────────────────────────────────────────────
// Documents and tags terms that are unsafe or ambiguous in routing/format
// classifiers. Any profile that adds these terms must account for the risk.
//
// Usage: consult this registry when adding terms to ROUTING_PROFILES or
// GUEST_PATTERNS. The registry is not auto-enforced at runtime yet — its
// primary purpose is to make false-positive sources discoverable in code review.

// Terms that are substring-unsafe: appear as substrings in common unrelated words.
// e.g. "ias" appears in "bias", "alias"; "ips" in "tips"; "ai" in "daily", "main".
const SUBSTRING_UNSAFE = new Set([
  'ias',  // → bias, alias, alias
  'ips',  // → tips, scripts, chips
  'ai',   // → daily, main, trail, email
  'sas',  // → saas confusion + Devanagari "saas" (mother-in-law)
]);

// Terms that double-count inside compound phrases already covered by other terms.
// Key = shorter/partial term, Value = longer phrase that already covers it.
// If the longer phrase matched, the shorter should not add another point.
const SUBSTRING_DOUBLE_COUNT = {
  'gpt':    'chatgpt',        // chatgpt ⊇ gpt
  'llm':    'large language', // either; both shouldn't score together
};

// Terms that are semantically ambiguous in Hindi/Indian-language contexts.
// Should not be used as positive signals in English-domain classifiers.
const AMBIGUOUS_HINDI = new Set([
  'saas',   // Hindi: mother-in-law (सास); English: SaaS software
  'beta',   // Hindi: son (बेटा); English: software beta version
  'sir',    // Hindi: honorific (e.g. "NV Sir"); English: formal address
  'mam',    // Hindi: honorific; English: madam
]);

// Generic sponsor/partnership boilerplate — present in almost every channel
// regardless of content. Must not inflate scores in business/startup profiles.
const SPONSOR_BOILERPLATE = new Set([
  'partner', 'partnership', 'sponsored by', 'brought to you by',
  'affiliate', 'promo code', 'discount code',
]);

// Terms with dual meaning in science/space vs. general language.
const SCIENCE_SPACE_AMBIGUOUS = new Set([
  'universe', 'galaxy', 'cosmos', 'infinite', 'quantum', 'dimension',
]);

// Terms ambiguous between sports results and business/startup language.
const SPORTS_AMBIGUOUS = new Set([
  'mvp',         // Most Valuable Player (sports) vs. Minimum Viable Product (startup)
  'champion',    // sports winner vs. business advocate
  'draft',       // sports draft vs. content draft
  'league',      // sports league vs. professional league
]);

// Profiles where each listed term is a known false-positive risk.
// Format: { [profileName]: [ { term, risk } ] }
const PROFILE_RISK_NOTES = {
  startup_founder: [
    { term: 'mvp', risk: 'sports_ambiguous — sports channels covering "player mvp" will match' },
    { term: 'partner', risk: 'sponsor_boilerplate — appears in all channels with sponsorship' },
  ],
  tech_ai: [
    { term: 'chatgpt', risk: 'substring_double_count — also matches "gpt" if listed' },
  ],
  upsc_exam: [
    { term: 'ias preparation', risk: 'safe as multi-word; do not shorten to bare "ias"' },
    { term: 'ips officer', risk: 'safe as multi-word; do not shorten to bare "ips"' },
  ],
  manifestation_healing: [
    { term: 'universe', risk: 'science_space_ambiguous — physics/astronomy channels may match' },
  ],
};

module.exports = {
  SUBSTRING_UNSAFE,
  SUBSTRING_DOUBLE_COUNT,
  AMBIGUOUS_HINDI,
  SPONSOR_BOILERPLATE,
  SCIENCE_SPACE_AMBIGUOUS,
  SPORTS_AMBIGUOUS,
  PROFILE_RISK_NOTES,
};

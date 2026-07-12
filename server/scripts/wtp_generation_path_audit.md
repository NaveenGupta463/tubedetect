# WTP Generation Path Audit

Produced: 2026-06-13
Scope: All code paths that contribute recommendations to the WTP response.

---

## Key Finding: Two Idea Streams, Not Three

The WTP response has **two distinct idea streams returned under separate keys**:

| Response Key     | Source Type         | Generation Function             | Trace Coverage |
|------------------|---------------------|---------------------------------|----------------|
| `original_bets`  | dna_original_bets   | `buildOriginalBetsFromDna()`    | ✅ FULL        |
| `ideas`          | peer_signal (5 sub-sources) | `computeWhatToPost()` | ❌ NONE        |

**"Trend" is NOT a separate idea source.** `topic_signal_stats` (trendSignalMap) and
`readRecentTrendSignals()` (googleTrendsMap) are **scoring bonuses** applied to peer-signal
ideas during the scoring loop. They influence ranks but generate no idea objects of their own.

The user-visible task listed 3 buckets (dna, peer, trend). The real split is 2 streams
with trend signals embedded inside the peer-signal scoring.

---

## Stream A — DNA Original Bets

**Response key:** `original_bets`
**File:** `source/server/services/originalBets.js`
**Entry:** `buildOriginalBetsForChannel(db, channelId, { limit: 14 })`
**Called from:** `computeWhatToPost()` line 2426

### Generation pipeline
```
readCreatorIdeaDna()
  → inferFamilyFromCsp()         # family classification
  → buildFamilyCandidates()      # subject pool + template + concept extraction
  → extractConcept(subject)      # conceptNormalizer.js
  → isFamilyConceptMismatch()    # family-concept guard
  → assessOriginalBetCandidateQuality()
  → buildExpansionCandidates()   # fallback if count < 3
  → makeIdea()                   # attaches _generation_trace
  → [trace write to wtp_generation_traces]
  → [strip _generation_trace]
  → return { status, ideas[] }
```

### Output shape (per idea)
- `idea_key` — deterministic hash of channelId + topic
- `topic` — the generated title
- `score` — 0–100 quality score
- `concept` — `{ id, label, confidence, dna_affinity }`
- `archetype` — e.g. `family:gaming_entertainment`
- `why`, `reasons`, `examples`

### Trace coverage
**FULL.** Every idea written to `wtp_generation_traces` with:
`idea_key, channel_id, raw_subject, concept_id, concept_label, concept_confidence,
dna_affinity_score, dna_affinity_reason, family, archetype, generated_title`

### rec_source value
`dna_original_bets`

---

## Stream B — Peer-Signal Ideas

**Response key:** `ideas`
**File:** `source/server/services/whatToPost.js`
**Entry:** `computeWhatToPost(db, params, ctx)`

### Sub-sources (all go through deduplication into `deduped[]`)

#### B1 — angle_gap (primary, ~70% of ideas)
- **How:** anchor × angle bigram gaps extracted from peer video titles
- **Ranking:** base score + trend bonus + gap bonus + saturation penalty + lifecycle adjustment
- **Trend influence:** `trendSignalMap` (topic_signal_stats) applied as +10–15pt bonus
- **source field:** none set explicitly (no `source:` key on the idea object)
- **recommendation_type:** `angle_gap` or `long_form_opportunity` (for news niches)

#### B2 — territory_expansion
- **How:** `buildTerritoryExpansionIdeas()` — topics from creator's accepted content territories
- **source field:** `territory_expansion`
- **idea_type:** `territory_expansion`
- **Cap:** up to 5 per territory, max 3 territories (territoryCap enforced in dedup)

#### B3 — peer_video_signal (fallback)
- **How:** `buildPeerVideoSignalIdeas()` — fired only when `deduped.length < 5`
- **source field:** `peer_video_signal`
- **idea_type:** `peer_video_signal`
- **Basis:** individual high-performing peer videos (1–2 channel evidence, not phrase consensus)

#### B4 — defence_signal (niche-specific)
- **How:** `buildDefenceSignalIdeas()` — 5 hardcoded defence content packages
- **source field:** `defence_signal`
- **idea_type:** `defence_signal`
- **Fired when:** `isDefenceLike === true` (defence/military niches)

#### B5 — fallback_evergreen (last resort)
- **How:** `_getNicheFallbackToFive()` — hardcoded evergreen suggestions per niche
- **source field:** `fallback_evergreen`
- **Fired when:** `deduped.length < 5` after all other sources

### Post-generation processing (both streams affected)
1. **Creator fit scoring** — `computeCreatorFitScore()` reweights each idea's score
2. **Re-sort** — `deduped.sort()` by score after fit weighting
3. **Opportunity packaging** — `buildOpportunityResponse()` decorates with angle fields
4. **Confidence tiers** — `_applyConfidenceTiers()` + `_orderByConfidence()`
5. **Specificity scoring** — `computeSpecificityScore()` on final output

### Trace coverage
**NONE.** No peer-signal idea in `deduped` is currently written to `wtp_generation_traces`.

---

## Stream C — Category B (Creative/Music/Devotional)

**Triggered:** When `_detectedCreativeFamily` is non-null (music, devotional, entertainment)
**File:** `source/server/services/whatToPost.js`
**Returns early** — never reaches the peer-signal pipeline

### Generation
- `computeCreativeOpportunities(peerVideos, { niche })` from `creativeOpportunityEngine.js`
- Fallback: `getEvergreenFallback()` if fewer than 5 ideas
- Source values: returned as `source: 'fallback_evergreen'` for fallback items; format-specific for others

### Trace coverage
**NONE.** Category B returns before any trace write point.

---

## Google Trends / World Signals (Scoring Only)

**File:** `source/server/services/worldSignals.js`
**Function:** `readRecentTrendSignals(db, { maxAgeHours: 48 })`

- Returns a Map of rising Google Trends queries (≤48h old)
- Applied as a score bonus inside the topic scoring loop in `computeWhatToPost()`
- **Does NOT generate idea objects**
- Not a candidate for its own rec_source bucket

**topic_signal_stats** (from `trendSignalJob`):
- Applied as `signal_tier` bonus inside the scoring loop
- **Does NOT generate idea objects**

---

## Ranking Functions

| Source           | Ranking function                        | Notes |
|------------------|-----------------------------------------|-------|
| dna_original_bets | `assessOriginalBetCandidateQuality()`  | tier-based, 0–100 |
| angle_gap        | inline score formula in scoring loop   | anchored to peer median views |
| territory_expansion | `buildTerritoryExpansionIdeas()` internal | peer median + lift bonus |
| peer_video_signal | `buildPeerVideoSignalIdeas()` internal  | avg views + trend status |
| defence_signal   | `buildDefenceSignalIdeas()` internal   | avg views + peer count |
| fallback_evergreen | fixed scores (descending)             | confidence: 'low' |

All Stream B sources enter `deduped[]` together and are **re-ranked by `computeCreatorFitScore()`** before output.

---

## Trace Coverage Gap Summary

| Source               | Writes to wtp_generation_traces? |
|----------------------|----------------------------------|
| dna_original_bets    | ✅ YES                           |
| angle_gap            | ❌ NO                            |
| territory_expansion  | ❌ NO                            |
| peer_video_signal    | ❌ NO                            |
| defence_signal       | ❌ NO                            |
| fallback_evergreen   | ❌ NO                            |
| category_b_creative  | ❌ NO                            |

**Phase 0B action:** Add `rec_source TEXT` column to `wtp_generation_traces`.
Write traces for all Stream B sources from inside `computeWhatToPost()`, after creator-fit
scoring and re-sort (line ~3612), so traces reflect final scored state.

Category B (creative) is low-priority — hardcoded evergreen packages, limited audit value.
Extend later if needed.

---

## Schema Change Required

```sql
ALTER TABLE wtp_generation_traces ADD COLUMN rec_source TEXT;
```

Existing DNA rows will have `rec_source = NULL` until backfilled.
Backfill: `UPDATE wtp_generation_traces SET rec_source = 'dna_original_bets' WHERE rec_source IS NULL`

---

## Output Shape Differences (DNA vs Peer-Signal)

Peer-signal ideas differ from DNA ideas in what's available for tracing:

| Field                | DNA original bets        | Peer-signal ideas         |
|----------------------|--------------------------|---------------------------|
| idea_key             | hash(channelId + topic)  | hash(channelId + topic)   |
| raw_subject          | extracted phrase         | null                      |
| concept_id           | from conceptNormalizer   | null (not run yet)        |
| dna_affinity_score   | from computeConceptAffinity | creator_fit_score      |
| family               | gaming_entertainment etc | null                      |
| archetype            | family:X                 | source field value        |
| generated_title      | topic                    | topic                     |
| rec_source           | dna_original_bets        | angle_gap / territory_expansion / etc |
